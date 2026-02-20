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
  let gameConnection = null;
  const agentConnections = new Set();

  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'agent-bridge', version: 'v1' }));
  });

  function broadcastToAgents(msg) {
    for (const conn of agentConnections) conn.send(msg);
  }

  function handleMessage(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

    if (msg.type === 'HELLO') {
      const role = msg.role === 'game' ? 'game' : 'agent';
      conn.role = role;
      if (role === 'game') {
        gameConnection = conn;
      } else {
        agentConnections.add(conn);
      }
      conn.send({ type: 'HELLO', version: 'v1', caps: ['obs', 'act', 'capture', 'edit'] });
      return;
    }

    if (conn.role === 'unknown') {
      if (msg.type === 'OBS' || msg.type === 'CAPTURED' || msg.type === 'INTERACTED' || msg.type === 'EDITED') {
        conn.role = 'game';
        gameConnection = conn;
      } else {
        conn.role = 'agent';
        agentConnections.add(conn);
      }
    }

    if (conn.role === 'game') {
      if (msg.type === 'OBS' || msg.type === 'CAPTURED' || msg.type === 'INTERACTED' || msg.type === 'EDITED' || msg.type === 'HELLO') {
        broadcastToAgents(msg);
      }
      return;
    }

    if (!gameConnection) return;
    if (msg.type === 'ACT' || msg.type === 'INTERACT' || msg.type === 'CAPTURE' || msg.type === 'EDIT' || msg.type === 'HELLO') {
      gameConnection.send(msg);
    }
  }

  function onClose(conn) {
    connections.delete(conn);
    agentConnections.delete(conn);
    if (gameConnection === conn) gameConnection = null;
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
