#!/usr/bin/env node

const WS_URL = process.env.OPENWORLD_WS_URL || 'ws://localhost:8787';
const ACT_HZ = 20;
const ACT_INTERVAL_MS = Math.round(1000 / ACT_HZ);

let seq = 0;
let ws;
let lastObs = null;
let interacted = false;
let captureSent = false;
let actTimer = null;

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function summarizePerceived(perceived = []) {
  if (!Array.isArray(perceived) || perceived.length === 0) return 'none';
  return perceived
    .slice(0, 5)
    .map((p) => `${p.id ?? 'unknown'}:${p.kind ?? 'obj'}@${Number(p.distance ?? NaN).toFixed(2)}`)
    .join(', ');
}

function startActLoop() {
  if (actTimer) clearInterval(actTimer);
  const start = Date.now();

  actTimer = setInterval(() => {
    const t = (Date.now() - start) / 1000;

    // Simple movement pattern: move forward while weaving/turning.
    const forward = 1.0;
    const strafe = Math.sin(t * 0.8) * 0.5;
    const turn = Math.sin(t * 0.6) * 0.35;

    send({
      type: 'ACT',
      seq: ++seq,
      forward,
      strafe,
      turn,
      jump: false,
      interact: false,
    });
  }, ACT_INTERVAL_MS);
}

function maybeInteract(obs) {
  if (interacted) return;
  const perceived = Array.isArray(obs?.perceived) ? obs.perceived : [];
  const first = perceived.find((p) => p && p.id);
  if (!first) return;

  interacted = true;
  console.log(`[INTERACT] targetId=${first.id}`);
  send({ type: 'INTERACT', targetId: first.id });
}

function maybeCapture() {
  if (captureSent) return;
  captureSent = true;
  console.log('[CAPTURE] requesting follow cam 256x256 jpg quality=70');
  send({
    type: 'CAPTURE',
    cam: 'follow',
    w: 256,
    h: 256,
    format: 'jpg',
    quality: 70,
  });
}

function connect() {
  console.log(`[CONNECT] ${WS_URL}`);
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    console.log('[OPEN] connected');
    send({
      type: 'HELLO',
      version: 'v1',
      role: 'agent',
      caps: ['obs', 'act', 'capture', 'edit'],
    });
    startActLoop();
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data.toString());
    } catch {
      console.log('[RAW]', event.data.toString());
      return;
    }

    if (msg.type === 'HELLO') {
      console.log(`[HELLO] protocol=${msg.version ?? 'unknown'} role=${msg.role ?? 'unknown'}`);
      maybeCapture();
      return;
    }

    if (msg.type === 'OBS') {
      lastObs = msg;
      const tick = msg.tick ?? msg.frame ?? '?';
      const perceivedCount = Array.isArray(msg.perceived) ? msg.perceived.length : 0;
      console.log(`[OBS] tick=${tick} perceived=${perceivedCount} -> ${summarizePerceived(msg.perceived)}`);
      maybeInteract(msg);
      return;
    }

    if (msg.type === 'CAPTURE') {
      const bytes = msg.bytes?.length ?? 0;
      console.log(`[CAPTURE] response format=${msg.format ?? 'unknown'} bytes=${bytes}`);
      return;
    }

    console.log('[MSG]', msg);
  });

  ws.addEventListener('close', (ev) => {
    console.log(`[CLOSE] code=${ev.code} reason=${ev.reason || '(none)'}`);
    if (actTimer) clearInterval(actTimer);
    setTimeout(connect, 1000);
  });

  ws.addEventListener('error', (err) => {
    console.log('[ERROR]', err.message || err);
  });
}

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN]');
  if (actTimer) clearInterval(actTimer);
  if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'agent shutdown');
  process.exit(0);
});

connect();
