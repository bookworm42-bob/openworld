import crypto from 'node:crypto';
import http from 'node:http';

function encodeFrame(opcode, payloadBuffer) {
  const payload = payloadBuffer || Buffer.alloc(0);
  const payloadLen = payload.length;
  let header;
  if (payloadLen < 126) {
    header = Buffer.from([0x80 | opcode, payloadLen]);
  } else if (payloadLen < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLen, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLen), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(state, chunk, onFrame) {
  state.buffer = Buffer.concat([state.buffer, chunk]);

  while (state.buffer.length >= 2) {
    const first = state.buffer[0];
    const second = state.buffer[1];
    const masked = Boolean(second & 0x80);
    let payloadLen = second & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (state.buffer.length < 4) return;
      payloadLen = state.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (state.buffer.length < 10) return;
      const value = Number(state.buffer.readBigUInt64BE(2));
      if (!Number.isFinite(value)) return;
      payloadLen = value;
      offset = 10;
    }

    const maskBytes = masked ? 4 : 0;
    const frameSize = offset + maskBytes + payloadLen;
    if (state.buffer.length < frameSize) return;

    const opcode = first & 0x0f;
    const mask = masked ? state.buffer.subarray(offset, offset + 4) : null;
    const payloadStart = offset + maskBytes;
    const payload = Buffer.from(state.buffer.subarray(payloadStart, payloadStart + payloadLen));

    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }

    state.buffer = state.buffer.subarray(frameSize);
    onFrame(opcode, payload);
  }
}

function normalizeRole(value) {
  return value === 'game' ? 'game' : 'agent';
}

function normalizeGameMode(value) {
  return value === 'observer' ? 'observer' : 'controller';
}

class RelayConnection {
  constructor(socket, server) {
    this.socket = socket;
    this.server = server;
    this.state = { buffer: Buffer.alloc(0) };
    this.role = 'unknown';
    this.id = crypto.randomUUID();
    this.closed = false;

    socket.on('data', (chunk) => {
      decodeFrames(this.state, chunk, (opcode, payload) => this.onFrame(opcode, payload));
    });
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }

  onFrame(opcode, payload) {
    if (opcode === 0x8) {
      this.close();
      return;
    }
    if (opcode === 0x9) {
      this.socket.write(encodeFrame(0xA, payload));
      return;
    }
    if (opcode !== 0x1) return;

    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    this.server.handleMessage(this, msg);
  }

  send(msg) {
    if (this.closed) return;
    this.socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(msg))));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.server.onClose(this);
    try {
      this.socket.end();
    } catch {
      // no-op
    }
  }
}

export function createAgentRelayServer({ port = 8787 } = {}) {
  const connections = new Set();
  const agentConnections = new Set();
  const gamePeers = new Map();
  const bridgeEvents = [];
  let gamePeerOrder = 0;
  let activeControllerId = null;

  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'agent-bridge', version: 'v1' }));
  });

  function queueBridgeEvent(type, fields = {}) {
    bridgeEvents.push({
      type,
      at: Date.now(),
      ...fields
    });
    if (bridgeEvents.length > 24) bridgeEvents.splice(0, bridgeEvents.length - 24);
  }

  function listEligibleControllers() {
    return [...gamePeers.values()]
      .filter((peer) => peer.mode === 'controller' && !peer.conn.closed)
      .sort((a, b) => {
        if (a.controllerPriority !== b.controllerPriority) return b.controllerPriority - a.controllerPriority;
        if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
        return a.order - b.order;
      });
  }

  function getActiveController() {
    if (!activeControllerId) return null;
    const peer = gamePeers.get(activeControllerId);
    if (!peer || peer.conn.closed || peer.mode !== 'controller') return null;
    return peer;
  }

  function buildBridgeMeta() {
    const active = getActiveController();
    return {
      activeControllerId: active?.id || null,
      activeControllerLabel: active?.clientLabel || null,
      activeControllerSessionId: active?.sessionId || null,
      activeControllerMode: active?.mode || null,
      controllerCandidates: listEligibleControllers().map((peer) => ({
        id: peer.id,
        label: peer.clientLabel || null,
        sessionId: peer.sessionId || null,
        mode: peer.mode,
        priority: peer.controllerPriority || 0
      }))
    };
  }

  function pickController(preferredConn = null) {
    const current = getActiveController();
    if (current) return current;

    if (preferredConn) {
      const preferred = gamePeers.get(preferredConn.id);
      if (preferred && preferred.mode === 'controller' && !preferred.conn.closed) return preferred;
    }

    const [next] = listEligibleControllers();
    return next || null;
  }

  function setActiveController(nextPeer, reason = 'unknown') {
    const previous = getActiveController();
    const nextId = nextPeer?.id || null;
    const prevId = previous?.id || null;

    activeControllerId = nextId;

    if (prevId === nextId) return;

    if (previous) {
      queueBridgeEvent('bridge_controller_lost', {
        reason,
        previousControllerId: previous.id,
        previousControllerLabel: previous.clientLabel || null,
        previousControllerSessionId: previous.sessionId || null
      });
    }

    if (nextPeer) {
      queueBridgeEvent('bridge_controller_acquired', {
        reason,
        activeControllerId: nextPeer.id,
        activeControllerLabel: nextPeer.clientLabel || null,
        activeControllerSessionId: nextPeer.sessionId || null,
        activeControllerMode: nextPeer.mode
      });
    }
  }

  function ensureController(reason = 'unknown', preferredConn = null) {
    const next = pickController(preferredConn);
    setActiveController(next, reason);
    return next;
  }

  function updateGamePeerFromHello(conn, msg) {
    const now = Date.now();
    const existing = gamePeers.get(conn.id);
    const peer = existing || {
      id: conn.id,
      conn,
      order: ++gamePeerOrder,
      sessionId: null,
      clientLabel: null,
      mode: 'controller',
      controllerPriority: 0,
      lastSeenAt: now,
      helloAt: now
    };

    if (!existing) gamePeers.set(conn.id, peer);

    peer.lastSeenAt = now;
    peer.sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() ? msg.sessionId.trim() : peer.sessionId;
    peer.clientLabel = typeof msg.clientLabel === 'string' && msg.clientLabel.trim() ? msg.clientLabel.trim() : peer.clientLabel;
    peer.mode = normalizeGameMode(msg.mode);
    peer.controllerPriority = Number.isFinite(Number(msg.controllerPriority)) ? Number(msg.controllerPriority) : peer.controllerPriority;

    if (peer.mode === 'observer' && activeControllerId === peer.id) {
      ensureController('observer_mode', null);
      return;
    }

    if (peer.mode === 'controller') {
      ensureController('hello_controller', conn);
    }
  }

  function annotateObs(msg) {
    const baseEvents = Array.isArray(msg.events) ? msg.events : [];
    const queued = agentConnections.size > 0 ? bridgeEvents.splice(0, bridgeEvents.length) : [];
    return {
      ...msg,
      bridge: {
        ...(msg.bridge && typeof msg.bridge === 'object' ? msg.bridge : {}),
        ...buildBridgeMeta()
      },
      events: queued.length ? [...baseEvents, ...queued] : baseEvents
    };
  }

  function broadcastToAgents(msg) {
    for (const conn of agentConnections) conn.send(msg);
  }

  function routeToController(msg) {
    const active = ensureController('route_request', null);
    if (!active) return false;
    active.conn.send(msg);
    return true;
  }

  function handleMessage(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

    if (msg.type === 'HELLO') {
      const role = normalizeRole(msg.role);
      conn.role = role;

      if (role === 'game') {
        updateGamePeerFromHello(conn, msg);
      } else {
        agentConnections.add(conn);
      }

      conn.send({
        type: 'HELLO',
        version: 'v1',
        caps: ['obs', 'act', 'capture', 'edit'],
        bridge: buildBridgeMeta()
      });
      return;
    }

    if (conn.role === 'unknown') {
      if (msg.type === 'OBS' || msg.type === 'CAPTURED' || msg.type === 'INTERACTED' || msg.type === 'EDITED') {
        conn.role = 'game';
        updateGamePeerFromHello(conn, { mode: 'controller' });
      } else {
        conn.role = 'agent';
        agentConnections.add(conn);
      }
    }

    if (conn.role === 'game') {
      const peer = gamePeers.get(conn.id);
      if (peer) peer.lastSeenAt = Date.now();

      if (msg.type === 'OBS') {
        broadcastToAgents(annotateObs(msg));
        return;
      }

      if (msg.type === 'CAPTURED' || msg.type === 'INTERACTED' || msg.type === 'EDITED' || msg.type === 'HELLO') {
        broadcastToAgents(msg);
      }
      return;
    }

    if (msg.type === 'ACT' || msg.type === 'INTERACT' || msg.type === 'CAPTURE' || msg.type === 'EDIT' || msg.type === 'HELLO') {
      routeToController(msg);
    }
  }

  function onClose(conn) {
    connections.delete(conn);
    agentConnections.delete(conn);

    const peer = gamePeers.get(conn.id);
    if (!peer) return;

    gamePeers.delete(conn.id);

    if (activeControllerId === conn.id) {
      setActiveController(null, 'disconnect');
      ensureController('failover_after_disconnect', null);
    }
  }

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || typeof key !== 'string') {
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
      ].join('\r\n')
    );

    const conn = new RelayConnection(socket, { handleMessage, onClose });
    connections.add(conn);
  });

  server.listen(port, '127.0.0.1');

  return {
    port,
    close() {
      for (const conn of connections) conn.close();
      server.close();
    }
  };
}
