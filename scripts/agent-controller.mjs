#!/usr/bin/env node

const WS_URL = process.env.OPENWORLD_WS_URL || 'ws://localhost:8787';
const ACT_HZ = 20;
const ACT_INTERVAL_MS = Math.round(1000 / ACT_HZ);

let seq = 0;
let ws;
let interacted = false;
let captureSent = false;
let actTimer = null;
let latestObs = null;
let loggedSchema = false;

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function safeNum(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function summarizePerceived(perceived = []) {
  if (!Array.isArray(perceived) || perceived.length === 0) return 'none';
  return perceived
    .slice(0, 5)
    .map((p) => {
      const dist = safeNum(p.distance, NaN);
      const d = Number.isFinite(dist) ? dist.toFixed(2) : '?';
      return `${p.id ?? 'unknown'}:${p.kind ?? p.type ?? 'obj'}@${d}`;
    })
    .join(', ');
}

function objectLooksLikeTower(p) {
  if (!p || typeof p !== 'object') return false;
  const hay = JSON.stringify(p).toLowerCase();
  return (
    hay.includes('tower') ||
    hay.includes('big_tower') ||
    hay.includes('watchtower') ||
    hay.includes('monolith')
  );
}

function bearingOf(p) {
  // Try common fields seen in these bridge payloads.
  const candidates = [p.bearing, p.yaw, p.relYaw, p.angle, p.azimuth, p.theta, p.dir];
  for (const c of candidates) {
    const n = safeNum(c, NaN);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function pickTowerTarget(obs) {
  const perceived = Array.isArray(obs?.perceived) ? obs.perceived : [];
  const towers = perceived.filter(objectLooksLikeTower);
  if (towers.length === 0) return null;

  towers.sort((a, b) => {
    const da = safeNum(a.distance, Number.POSITIVE_INFINITY);
    const db = safeNum(b.distance, Number.POSITIVE_INFINITY);
    return da - db;
  });
  return towers[0];
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}

function startActLoop() {
  if (actTimer) clearInterval(actTimer);
  const start = Date.now();

  actTimer = setInterval(() => {
    const t = (Date.now() - start) / 1000;

    let forward = 0.8;
    let strafe = 0;
    let turn = 0.3 * Math.sin(t * 0.7); // search pattern default

    const target = pickTowerTarget(latestObs);
    if (target) {
      const b = bearingOf(target);
      if (Number.isFinite(b)) {
        // Assume bearing in radians if small-ish, degrees if larger.
        const bNorm = Math.abs(b) > Math.PI * 2 ? (b * Math.PI) / 180 : b;
        turn = clamp1(bNorm * 1.2);
      } else {
        // If no angular data, still bias movement to keep going forward.
        turn = 0;
      }

      const dist = safeNum(target.distance, NaN);
      forward = Number.isFinite(dist) ? (dist > 4 ? 1.0 : 0.35) : 1.0;
      strafe = 0;
    }

    send({
      type: 'ACT',
      seq: ++seq,
      forward: clamp1(forward),
      strafe: clamp1(strafe),
      turn: clamp1(turn),
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
      latestObs = msg;
      const tick = msg.tick ?? msg.frame ?? '?';
      const perceivedCount = Array.isArray(msg.perceived) ? msg.perceived.length : 0;
      const tower = pickTowerTarget(msg);
      const towerTxt = tower ? ` | tower=${tower.id ?? 'unknown'} dist=${safeNum(tower.distance, NaN)}` : '';

      console.log(`[OBS] tick=${tick} perceived=${perceivedCount} -> ${summarizePerceived(msg.perceived)}${towerTxt}`);

      if (!loggedSchema && Array.isArray(msg.perceived) && msg.perceived[0]) {
        loggedSchema = true;
        console.log('[DEBUG] sample perceived object:', msg.perceived[0]);
      }

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
