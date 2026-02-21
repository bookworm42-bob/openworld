#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const WS_URL = process.env.OPENWORLD_WS_URL || 'ws://127.0.0.1:8787';
const ACT_HZ = Number(process.env.ACT_HZ || 20);
const RUN_SEC = Number(process.env.RUN_SEC || 45);
const ACT_INTERVAL_MS = Math.max(20, Math.round(1000 / Math.max(1, ACT_HZ)));
const CAPTURE_ENABLED = process.env.CAPTURE_ENABLED !== '0';
const CAPTURE_EVERY_SEC = Number(process.env.CAPTURE_EVERY_SEC || 10);
const CAPTURE_W = Number(process.env.CAPTURE_W || 1280);
const CAPTURE_H = Number(process.env.CAPTURE_H || 720);
const CAPTURE_FORMAT = (process.env.CAPTURE_FORMAT || 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg';
const SHOTS_DIR = process.env.SHOTS_DIR || path.join('artifacts', `try-${new Date().toISOString().replace(/[:.]/g, '-')}`);

let ws;
let seq = 0;
let obsSeen = false;
let actTimer = null;
let shutdownTimer = null;
let noObsWarnTimer = null;
let latestObs = null;
let runStartedAtMs = 0;
let nextCaptureAtSec = Math.max(1, CAPTURE_EVERY_SEC);
let captureIndex = 0;
let capturePending = false;
let currentTargetId = null;
let lastTurnCmd = 0;
let lastInteractAt = 0;
let lastObsAt = 0;
let prevTargetSample = null;
let targetProgress = null;
let roamHeadingBias = 0;
let roamUntilMs = 0;
let roamNoise = 0;

const RNG_SEED = Number(process.env.ROAM_SEED || Date.now());
let rngState = (RNG_SEED >>> 0) || 1;
const visitedTargets = new Map();
const VISITED_COOLDOWN_MS = Number(process.env.VISITED_COOLDOWN_MS || 25000);
const ARRIVAL_DIST = Number(process.env.ARRIVAL_DIST || 1.7);
const INTERACTABLE_ARRIVAL_DIST = Number(process.env.INTERACTABLE_ARRIVAL_DIST || 2.1);
const TARGET_STALL_MS = Number(process.env.TARGET_STALL_MS || 4500);
const TARGET_MAX_LOCK_MS = Number(process.env.TARGET_MAX_LOCK_MS || 9000);
const REVISIT_AFTER_MS = Number(process.env.REVISIT_AFTER_MS || 120000);

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}

function rand01() {
  // xorshift32: fast deterministic RNG for repeatable roaming.
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return ((rngState >>> 0) & 0xffffffff) / 0x100000000;
}

function randRange(min, max) {
  return min + (max - min) * rand01();
}

function safeNum(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function maybeRequestCapture(elapsedSec) {
  if (!CAPTURE_ENABLED) return;
  if (!obsSeen) return;
  if (capturePending) return;
  if (elapsedSec < nextCaptureAtSec) return;

  captureIndex += 1;
  capturePending = true;
  const reqId = `cap-${captureIndex}-${Date.now()}`;
  send({
    type: 'CAPTURE',
    reqId,
    cam: 'follow',
    w: CAPTURE_W,
    h: CAPTURE_H,
    format: CAPTURE_FORMAT,
    quality: 80
  });
  nextCaptureAtSec += Math.max(1, CAPTURE_EVERY_SEC);
}

async function saveCapturedImage(msg) {
  capturePending = false;
  const imgB64 = typeof msg?.imgB64 === 'string' ? msg.imgB64 : '';
  if (!imgB64) {
    console.warn('[CAPTURED] empty image payload');
    return;
  }
  const ext = CAPTURE_FORMAT === 'png' ? 'png' : 'jpg';
  const elapsedSec = runStartedAtMs > 0 ? Math.round((Date.now() - runStartedAtMs) / 1000) : 0;
  const fileName = `${String(captureIndex).padStart(2, '0')}-t${String(elapsedSec).padStart(2, '0')}s.${ext}`;
  const outPath = path.join(SHOTS_DIR, fileName);
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  await fs.writeFile(outPath, Buffer.from(imgB64, 'base64'));
  console.log(`[CAPTURED] saved ${outPath}`);
}

function pickTarget(obs) {
  const perceived = Array.isArray(obs?.perceived) ? obs.perceived : [];
  if (perceived.length === 0) return null;

  if (currentTargetId) {
    const locked = perceived.find((p) => p?.id === currentTargetId);
    if (locked) return locked;
  }

  const nowMs = Date.now();
  for (const [id, t] of visitedTargets.entries()) {
    if (nowMs - t > REVISIT_AFTER_MS) visitedTargets.delete(id);
  }

  const freshCandidates = perceived
    .filter((p) => p && p.id)
    .filter((p) => {
      const visitedAt = visitedTargets.get(p.id);
      return !visitedAt || nowMs - visitedAt > VISITED_COOLDOWN_MS;
    })
    .map((p) => {
      const dist = safeNum(p.dist, 9999);
      const interactable = Array.isArray(p.aff) && p.aff.includes('interact');
      return { p, dist, prio: interactable ? 0 : 1 };
    })
    .sort((a, b) => (a.prio - b.prio) || (a.dist - b.dist));

  if (freshCandidates.length === 0) {
    // Everything in view has been visited recently. Keep roaming instead of
    // immediately reacquiring stale targets.
    return null;
  }

  return freshCandidates[0]?.p ?? null;
}

function updateTargetSample(target, nowMs) {
  const bearing = safeNum(target?.bearing, 0);
  const dist = safeNum(target?.dist, 999);
  let bearingRate = 0;
  let distRate = 0;
  if (prevTargetSample && prevTargetSample.id === target?.id) {
    const dt = Math.max(0.02, (nowMs - prevTargetSample.t) / 1000);
    bearingRate = (bearing - prevTargetSample.bearing) / dt;
    distRate = (dist - prevTargetSample.dist) / dt;
  }
  prevTargetSample = { id: target?.id ?? null, bearing, dist, t: nowMs };
  return { bearing, dist, bearingRate, distRate };
}

function getArrivalDistForTarget(target) {
  const isInteractable = Array.isArray(target?.aff) && target.aff.includes('interact');
  if (isInteractable) return INTERACTABLE_ARRIVAL_DIST;
  const size = String(target?.size || '').toUpperCase();
  if (size === 'L') return Math.max(ARRIVAL_DIST, 5.0);
  if (size === 'M') return Math.max(ARRIVAL_DIST, 2.8);
  return ARRIVAL_DIST;
}

function markVisitedTarget(targetId, nowMs) {
  if (!targetId) return;
  visitedTargets.set(targetId, nowMs);
  currentTargetId = null;
  prevTargetSample = null;
  targetProgress = null;
}

function chooseRoamGoal(ray, nowMs, forced = false) {
  if (!forced && nowMs < roamUntilMs) return;
  const front = safeNum(ray?.front, 99);
  const left = safeNum(ray?.frontLeft, 99);
  const right = safeNum(ray?.frontRight, 99);
  const opennessBias = clamp1((right - left) / Math.max(1, front));
  const randomComponent = randRange(-0.7, 0.7);
  roamHeadingBias = clamp1(0.55 * opennessBias + 0.45 * randomComponent);
  roamUntilMs = nowMs + randRange(1300, 3800);
}

function buildActFromObs(obs) {
  const nowMs = Date.now();
  const target = pickTarget(obs);
  if (target) {
    currentTargetId = target.id;
    const ray = obs?.sensors?.ray || {};
    const front = safeNum(ray.front, 99);
    const left = safeNum(ray.frontLeft, 99);
    const right = safeNum(ray.frontRight, 99);
    const blocked = front < 1.5;
    const avoidBias = blocked ? clamp1((left - right) / 1.5) : 0;

    // Trajectory tracking: PD steering with small predictive lead and obstacle avoidance.
    const sample = updateTargetSample(target, nowMs);
    if (!targetProgress || targetProgress.id !== target.id) {
      targetProgress = {
        id: target.id,
        startedAt: nowMs,
        lastImproveAt: nowMs,
        minDist: sample.dist
      };
    } else {
      if (sample.dist + 0.12 < targetProgress.minDist) {
        targetProgress.minDist = sample.dist;
        targetProgress.lastImproveAt = nowMs;
      }
    }

    const leadBearing = sample.bearing + sample.bearingRate * 0.22;
    const desiredBearing = leadBearing + avoidBias * 0.35;
    const absBearing = Math.abs(desiredBearing);

    const KP = 1.15;
    const KD = 0.38;
    const rawTurn = KP * desiredBearing + KD * sample.bearingRate;
    const desiredTurn = absBearing < 0.03 ? 0 : clamp1(rawTurn);
    const turn = clamp1(lastTurnCmd * 0.68 + desiredTurn * 0.32);
    lastTurnCmd = turn;

    let forward = 0;
    const isNearAndFacing = sample.dist < 6.2 && Math.abs(sample.bearing) < 0.2;
    if (absBearing > 0.9 || (front < 1.0 && !isNearAndFacing)) {
      forward = 0.0;
    } else if (absBearing > 0.55) {
      forward = 0.18;
    } else {
      const align = Math.max(0, 1 - absBearing / 0.55);
      if (sample.dist > 4.0) forward = 0.95 * align;
      else if (sample.dist > 2.4) forward = 0.72 * align;
      else if (sample.dist > 1.6) forward = 0.28 * align;
      else forward = 0;
    }
    if (sample.distRate > 0.2) forward = Math.max(0.1, forward - 0.12);

    const isInteractable = Array.isArray(target.aff) && target.aff.includes('interact');
    const arrivalDist = getArrivalDistForTarget(target);
    const arrived = sample.dist <= arrivalDist;
    const interact = isInteractable && sample.dist <= INTERACTABLE_ARRIVAL_DIST && Math.abs(sample.bearing) < 0.22 && nowMs - lastInteractAt > 2200;
    if (interact) lastInteractAt = nowMs;
    const stalled = targetProgress && nowMs - targetProgress.lastImproveAt > TARGET_STALL_MS;
    const timedOut = targetProgress && nowMs - targetProgress.startedAt > TARGET_MAX_LOCK_MS;

    if (arrived || interact || stalled || timedOut) {
      markVisitedTarget(target.id, nowMs);
    }

    return {
      mode: 'target',
      targetId: target.id,
      targetDist: sample.dist,
      targetBearing: sample.bearing,
      forward,
      strafe: 0,
      turn,
      jump: false,
      interact
    };
  }

  currentTargetId = null;
  prevTargetSample = null;
  targetProgress = null;
  const ray = obs?.sensors?.ray || {};
  const front = safeNum(ray.front, 99);
  const left = safeNum(ray.frontLeft, 99);
  const right = safeNum(ray.frontRight, 99);
  const stuck = Boolean(obs?.sensors?.stuck);

  chooseRoamGoal(ray, nowMs, stuck);
  // Correlated noise so roam feels organic, not jittery.
  roamNoise = clamp1(roamNoise * 0.82 + randRange(-0.22, 0.22) * 0.18);

  let forward = 0.75;
  let turn = clamp1(roamHeadingBias + roamNoise);
  if (stuck || front < 1.2) {
    forward = -0.22;
    turn = left > right ? -0.9 : 0.9;
    chooseRoamGoal(ray, nowMs, true);
  } else if (front < 2.2) {
    forward = 0.25;
    turn = left > right ? -0.62 : 0.62;
  } else if (front < 3.2) {
    forward = 0.48;
    turn = left > right ? -0.38 : 0.38;
  }

  turn = clamp1(lastTurnCmd * 0.72 + turn * 0.28);
  lastTurnCmd = turn;

  return {
    mode: 'roam',
    targetId: null,
    targetDist: NaN,
    targetBearing: NaN,
    forward,
    strafe: 0,
    turn,
    jump: false,
    interact: false
  };
}

function stop(exitCode = 0) {
  if (actTimer) clearInterval(actTimer);
  if (shutdownTimer) clearTimeout(shutdownTimer);
  if (noObsWarnTimer) clearTimeout(noObsWarnTimer);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.close(1000, 'force-move done');
    } catch {
      // no-op
    }
  }
  setTimeout(() => process.exit(exitCode), 50);
}

function startActLoop() {
  const startedAt = Date.now();
  runStartedAtMs = startedAt;
  let lastLogAt = 0;

  actTimer = setInterval(() => {
    const tSec = (Date.now() - startedAt) / 1000;
    maybeRequestCapture(tSec);
    const base = buildActFromObs(latestObs);
    const act = {
      type: 'ACT',
      seq: ++seq,
      forward: clamp1(base.forward),
      strafe: clamp1(base.strafe),
      turn: clamp1(base.turn),
      jump: Boolean(base.jump),
      interact: Boolean(base.interact)
    };

    if (Date.now() - lastLogAt > 1000) {
      lastLogAt = Date.now();
      const targetTxt = base.targetId
        ? ` target=${base.targetId} dist=${base.targetDist.toFixed(2)} bearing=${base.targetBearing.toFixed(3)}`
        : '';
      console.log(
        `[ACT] mode=${base.mode} seq=${act.seq} t=${tSec.toFixed(1)} f=${act.forward.toFixed(2)} s=${act.strafe.toFixed(2)} turn=${act.turn.toFixed(2)} interact=${act.interact}${targetTxt} obsSeen=${obsSeen}`
      );
    }

    send(act);
  }, ACT_INTERVAL_MS);

  shutdownTimer = setTimeout(() => {
    console.log(`[DONE] ran for ${RUN_SEC}s`);
    stop(0);
  }, RUN_SEC * 1000);
}

console.log(`[CONNECT] ${WS_URL}`);
ws = new WebSocket(WS_URL);

ws.addEventListener('open', () => {
  console.log('[OPEN] connected');
  send({
    type: 'HELLO',
    version: 'v1',
    role: 'agent',
    caps: ['obs', 'act', 'capture']
  });
  startActLoop();
  noObsWarnTimer = setTimeout(() => {
    if (!obsSeen) {
      console.error(
        '[DIAG] No OBS received after 8s. Relay is up, but game client is not connected/sending OBS to this relay.'
      );
      console.error(
        '[DIAG] Open http://127.0.0.1:5173, hard refresh, and keep that tab active. Then re-run this script.'
      );
    }
  }, 8000);
});

ws.addEventListener('message', (event) => {
  let msg;
  try {
    msg = JSON.parse(event.data.toString());
  } catch {
    return;
  }

  if (msg.type === 'HELLO') {
    console.log(`[HELLO] protocol=${msg.version ?? 'unknown'} role=${msg.role ?? 'unknown'}`);
    return;
  }

  if (msg.type === 'OBS') {
    latestObs = msg;
    lastObsAt = Date.now();
    if (!obsSeen) {
      obsSeen = true;
      console.log('[OBS] first observation received');
    }
    return;
  }

  if (msg.type === 'CAPTURED') {
    void saveCapturedImage(msg).catch((err) => {
      console.error('[CAPTURED_ERROR]', err?.message || err);
    });
  }
});

ws.addEventListener('close', (ev) => {
  console.log(`[CLOSE] code=${ev.code} reason=${ev.reason || '(none)'}`);
});

ws.addEventListener('error', (err) => {
  console.error('[ERROR]', err?.message || err);
  stop(1);
});

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN]');
  stop(0);
});
