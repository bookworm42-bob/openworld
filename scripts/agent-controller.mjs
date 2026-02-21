#!/usr/bin/env node

const WS_URL = process.env.OPENWORLD_WS_URL || 'ws://localhost:8787';
const ACT_HZ = 20;
const ACT_INTERVAL_MS = Math.round(1000 / ACT_HZ);

let seq = 0;
let ws;
let captureSent = false;
let actTimer = null;
let latestObs = null;
let loggedSchema = false;
let lastInteractAt = 0;
let lastSeenPerceivedAt = Date.now();
let lastObsAt = 0;
let lastActLogAt = 0;
const NO_TARGET_RESTART_SEC = Number(process.env.NO_TARGET_RESTART_SEC || 35);
let restarting = false;
let roamTurnSign = 1;
let lastRoamFlipAt = 0;
let currentTargetId = null;
let lastTurnCmd = 0;

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function safeNum(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}

function summarizePerceived(perceived = []) {
  if (!Array.isArray(perceived) || perceived.length === 0) return 'none';
  return perceived
    .slice(0, 5)
    .map((p) => {
      const d = safeNum(p.dist, NaN);
      const distTxt = Number.isFinite(d) ? d.toFixed(2) : '?';
      return `${p.id ?? 'unknown'}:${p.tag ?? 'obj'}@${distTxt}`;
    })
    .join(', ');
}

function pickTarget(obs, preferredTargetId = null) {
  const perceived = Array.isArray(obs?.perceived) ? obs.perceived : [];
  if (perceived.length === 0) return null;

  if (preferredTargetId) {
    const preferred = perceived.find((p) => p?.id === preferredTargetId);
    if (preferred) return preferred;
  }

  // Prioritize interactables, then nearest.
  const scored = perceived
    .filter((p) => p && p.id)
    .map((p) => {
      const dist = safeNum(p.dist, 9999);
      const isInteractable = Array.isArray(p.aff) && p.aff.includes('interact');
      const priority = isInteractable ? 0 : 1;
      return { p, priority, dist };
    })
    .sort((a, b) => (a.priority - b.priority) || (a.dist - b.dist));

  return scored[0]?.p ?? null;
}

function maybeInteractWithTarget(target) {
  if (!target?.id) return;
  const now = Date.now();
  const dist = safeNum(target.dist, 999);

  // Try interact near target, no spam.
  if (dist <= 2.2 && now - lastInteractAt > 2500) {
    lastInteractAt = now;
    console.log(`[INTERACT] targetId=${target.id} tag=${target.tag ?? 'obj'} dist=${dist.toFixed(2)}`);
    send({ type: 'INTERACT', targetId: target.id });
  }
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

function startActLoop() {
  if (actTimer) clearInterval(actTimer);
  const start = Date.now();

  actTimer = setInterval(() => {
    const t = (Date.now() - start) / 1000;

    let forward = 0.8;
    let strafe = 0;
    let turn = 0.35 * Math.sin(t * 0.8); // search scan fallback

    const target = pickTarget(latestObs, currentTargetId);
    if (target) {
      currentTargetId = target.id;
      const bearing = safeNum(target.bearing, 0);
      const dist = safeNum(target.dist, 999);
      const absBearing = Math.abs(bearing);

      // Turn mostly to face target first, then move more aggressively.
      const TURN_DEADZONE = 0.08;
      const TURN_HARD_ANGLE = 0.85;
      const turnGain = 1.05;
      const desiredTurn =
        absBearing < TURN_DEADZONE
          ? 0
          : clamp1(Math.sign(bearing) * Math.min(0.65, ((absBearing - TURN_DEADZONE) / (TURN_HARD_ANGLE - TURN_DEADZONE)) * turnGain));

      // Smooth steering to avoid over-correct/oscillation.
      turn = lastTurnCmd * 0.7 + desiredTurn * 0.3;
      lastTurnCmd = turn;

      // Gate forward speed by alignment and distance.
      if (absBearing > 0.7) forward = 0.05;
      else if (dist > 3.0) forward = 0.95 * (1 - Math.min(absBearing, 0.7));
      else if (dist > 2.0) forward = 0.6 * (1 - Math.min(absBearing, 0.7));
      else forward = 0.18;
      strafe = 0;

      maybeInteractWithTarget(target);
    } else {
      currentTargetId = null;
      // Nothing perceived: roam with obstacle avoidance so we keep exploring.
      const ray = latestObs?.sensors?.ray || {};
      const front = safeNum(ray.front, 99);
      const frontLeft = safeNum(ray.frontLeft, 99);
      const frontRight = safeNum(ray.frontRight, 99);
      const stuck = Boolean(latestObs?.sensors?.stuck);

      const now = Date.now();
      if (now - lastRoamFlipAt > 2500) {
        lastRoamFlipAt = now;
        roamTurnSign *= -1;
      }

      if (stuck || front < 1.2) {
        forward = -0.25;
        turn = frontLeft > frontRight ? -0.9 : 0.9;
      } else if (front < 2.5) {
        forward = 0.35;
        turn = frontLeft > frontRight ? -0.75 : 0.75;
      } else {
        forward = 0.9;
        turn = 0.45 * roamTurnSign;
      }
      lastTurnCmd = turn;

      // Only engage watchdog after OBS stream has been seen at least once.
      if (lastObsAt > 0) {
        const blindForMs = Date.now() - lastSeenPerceivedAt;
        if (!restarting && blindForMs > NO_TARGET_RESTART_SEC * 1000) {
          restarting = true;
          console.log(`[WATCHDOG] no perceived targets for ${(blindForMs / 1000).toFixed(1)}s -> requesting game restart`);
          if (actTimer) clearInterval(actTimer);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(4000, 'no targets watchdog');
          }
          setTimeout(() => process.exit(42), 250);
          return;
        }
      } else if (Date.now() - lastActLogAt > 5000) {
        console.log('[WAIT] no OBS received yet; continuing ACT roam loop');
      }
    }

    const act = {
      type: 'ACT',
      seq: ++seq,
      forward: clamp1(forward),
      strafe: clamp1(strafe),
      turn: clamp1(turn),
      jump: false,
      interact: false,
    };

    const nowMs = Date.now();
    if (nowMs - lastActLogAt > 1000) {
      lastActLogAt = nowMs;
      const mode = target ? 'target' : 'roam';
      console.log(`[ACT] mode=${mode} seq=${act.seq} f=${act.forward.toFixed(2)} s=${act.strafe.toFixed(2)} t=${act.turn.toFixed(2)}`);
    }

    send(act);
  }, ACT_INTERVAL_MS);
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
      lastObsAt = Date.now();
      const tick = msg.tick ?? msg.frame ?? '?';
      const perceivedCount = Array.isArray(msg.perceived) ? msg.perceived.length : 0;
      if (perceivedCount > 0) lastSeenPerceivedAt = Date.now();
      const target = pickTarget(msg, currentTargetId);
      const targetTxt = target
        ? ` | target=${target.id} tag=${target.tag ?? 'obj'} dist=${safeNum(target.dist, NaN).toFixed(2)} bearing=${safeNum(target.bearing, NaN).toFixed(3)}`
        : '';

      console.log(`[OBS] tick=${tick} perceived=${perceivedCount} -> ${summarizePerceived(msg.perceived)}${targetTxt}`);

      if (!loggedSchema && Array.isArray(msg.perceived) && msg.perceived[0]) {
        loggedSchema = true;
        console.log('[DEBUG] sample perceived object:', msg.perceived[0]);
      }
      return;
    }

    if (msg.type === 'CAPTURED') {
      const bytes = msg.imgB64 ? msg.imgB64.length : 0;
      console.log(`[CAPTURED] cam=${msg.cam ?? 'unknown'} imgB64_length=${bytes}`);
      return;
    }

    if (msg.type === 'INTERACTED') {
      console.log(`[INTERACTED] targetId=${msg.targetId} result=${msg.result}`);
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
