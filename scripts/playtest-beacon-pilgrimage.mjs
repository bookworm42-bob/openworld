#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const WS_URL = process.env.OPENWORLD_WS_URL || 'ws://127.0.0.1:8787';
const ACT_HZ = Number(process.env.ACT_HZ || 20);
const RUN_SEC = Number(process.env.RUN_SEC || 180);
const ACT_INTERVAL_MS = Math.max(20, Math.round(1000 / Math.max(1, ACT_HZ)));
const TARGET_ARRIVAL_DIST = Number(process.env.TARGET_ARRIVAL_DIST || 2.55);
const TARGET_STALL_MS = Number(process.env.TARGET_STALL_MS || 7000);
const RECOVERY_TIMEOUT_MS = Number(process.env.RECOVERY_TIMEOUT_MS || 5500);
const CAPTURE_ENABLED = process.env.CAPTURE_ENABLED !== '0';
const CAPTURE_EVERY_SEC = Number(process.env.CAPTURE_EVERY_SEC || 18);
const CAPTURE_W = Number(process.env.CAPTURE_W || 1280);
const CAPTURE_H = Number(process.env.CAPTURE_H || 720);
const CAPTURE_FORMAT = (process.env.CAPTURE_FORMAT || 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg';
const SHOTS_DIR = process.env.SHOTS_DIR || path.join('artifacts', `beacon-playtest-${new Date().toISOString().replace(/[:.]/g, '-')}`);

let ws;
let seq = 0;
let obsSeen = false;
let latestObs = null;
let actTimer = null;
let shutdownTimer = null;
let runStartedAtMs = 0;
let questCompleted = false;
let completedObjectives = new Set();
let currentTargetId = null;
let targetLockStartedAt = 0;
let lastTargetProgressAt = 0;
let targetBestDist = Number.POSITIVE_INFINITY;
let lastTurn = 0;
let lastInteractAt = 0;
let roamBias = 0;
let roamUntilMs = 0;
let roamNoise = 0;
let captureIndex = 0;
let capturePending = false;
let nextCaptureAtSec = Math.max(1, CAPTURE_EVERY_SEC);

const RNG_SEED = Number(process.env.ROAM_SEED || Date.now());
let rngState = (RNG_SEED >>> 0) || 1;

function clamp1(v) {
  return Math.max(-1, Math.min(1, v));
}

function rand01() {
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
  if (!CAPTURE_ENABLED || !obsSeen || capturePending || elapsedSec < nextCaptureAtSec) return;
  captureIndex += 1;
  capturePending = true;
  send({
    type: 'CAPTURE',
    reqId: `cap-${captureIndex}-${Date.now()}`,
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
  if (!imgB64) return;
  const ext = CAPTURE_FORMAT === 'png' ? 'png' : 'jpg';
  const elapsedSec = runStartedAtMs > 0 ? Math.round((Date.now() - runStartedAtMs) / 1000) : 0;
  const fileName = `${String(captureIndex).padStart(2, '0')}-t${String(elapsedSec).padStart(3, '0')}s.${ext}`;
  const outPath = path.join(SHOTS_DIR, fileName);
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  await fs.writeFile(outPath, Buffer.from(imgB64, 'base64'));
  console.log(`[CAPTURED] ${outPath}`);
}

function targetFromObjective(obs) {
  const objective = obs?.objective || null;
  const activeId = objective?.activeObjectiveId || null;
  const perceived = Array.isArray(obs?.perceived) ? obs.perceived : [];
  const perceivedBeacons = perceived.filter((p) => p?.id && (p.tag === 'beacon' || (Array.isArray(p.aff) && p.aff.includes('interact'))));

  if (activeId) {
    const activeTarget = perceivedBeacons.find((p) => p.id === activeId);
    if (activeTarget) return activeTarget;
  }

  const fallback = perceivedBeacons
    .filter((p) => !completedObjectives.has(p.id))
    .sort((a, b) => safeNum(a.dist, 999) - safeNum(b.dist, 999))[0];

  return fallback || null;
}

function updateTargetProgress(target, nowMs) {
  const dist = safeNum(target?.dist, 999);
  if (target?.id !== currentTargetId) {
    currentTargetId = target?.id || null;
    targetLockStartedAt = nowMs;
    lastTargetProgressAt = nowMs;
    targetBestDist = dist;
    return;
  }

  if (dist + 0.1 < targetBestDist) {
    targetBestDist = dist;
    lastTargetProgressAt = nowMs;
  }
}

function chooseRoam(ray, nowMs, forced = false) {
  if (!forced && nowMs < roamUntilMs) return;
  const front = safeNum(ray?.front, 99);
  const left = safeNum(ray?.frontLeft, 99);
  const right = safeNum(ray?.frontRight, 99);
  const opennessBias = clamp1((right - left) / Math.max(1, front));
  roamBias = clamp1(0.55 * opennessBias + 0.45 * randRange(-0.8, 0.8));
  roamUntilMs = nowMs + randRange(1200, 3400);
}

function buildAct(obs) {
  const nowMs = Date.now();
  const ray = obs?.sensors?.ray || {};
  const front = safeNum(ray.front, 99);
  const left = safeNum(ray.frontLeft, 99);
  const right = safeNum(ray.frontRight, 99);
  const stuck = Boolean(obs?.sensors?.stuck);

  const target = targetFromObjective(obs);
  if (target) {
    updateTargetProgress(target, nowMs);
    const bearing = safeNum(target.bearing, 0);
    const dist = safeNum(target.dist, 999);
    const avoid = front < 1.5 ? clamp1((left - right) / 1.6) : 0;
    const desiredBearing = bearing + avoid * 0.35;
    const absBearing = Math.abs(desiredBearing);

    const desiredTurn = absBearing < 0.03 ? 0 : clamp1(desiredBearing * 1.18);
    const turn = clamp1(lastTurn * 0.68 + desiredTurn * 0.32);
    lastTurn = turn;

    let forward = 0;
    if (absBearing > 1.0) forward = 0.22;
    else if (absBearing > 0.6) forward = 0.34;
    else if (dist > 6.5) forward = 0.95;
    else if (dist > 3.2) forward = 0.72;
    else if (dist > 2.3) forward = 0.36;

    const readyToInteract = dist <= TARGET_ARRIVAL_DIST && Math.abs(bearing) < 0.24 && nowMs - lastInteractAt > 1800;
    const stalled = nowMs - lastTargetProgressAt > TARGET_STALL_MS;
    const timedOut = nowMs - targetLockStartedAt > RECOVERY_TIMEOUT_MS * 2;

    const interact = readyToInteract;
    if (interact) lastInteractAt = nowMs;

    if (stalled || timedOut) {
      currentTargetId = null;
      chooseRoam(ray, nowMs, true);
      console.log(`[RECOVERY] target=${target.id} stalled=${stalled} timedOut=${timedOut}`);
    }

    return {
      mode: 'objective',
      targetId: target.id,
      targetDist: dist,
      targetBearing: bearing,
      forward: clamp1(forward),
      strafe: 0,
      turn,
      jump: false,
      interact
    };
  }

  const guidance = obs?.objective?.guidance || null;
  if (guidance && Number.isFinite(guidance.dist) && Number.isFinite(guidance.bearing)) {
    const bearing = safeNum(guidance.bearing, 0);
    const dist = safeNum(guidance.dist, 999);
    const absBearing = Math.abs(bearing);
    const desiredTurn = absBearing < 0.03 ? 0 : clamp1(bearing * 1.1);
    const turn = clamp1(lastTurn * 0.66 + desiredTurn * 0.34);
    lastTurn = turn;

    let forward = 0;
    if (absBearing > 1.0) forward = 0.28;
    else if (absBearing > 0.7) forward = 0.32;
    else if (dist > 8.0) forward = 0.92;
    else if (dist > 4.0) forward = 0.7;
    else if (dist > 2.6) forward = 0.34;

    const interact = Boolean(guidance.inInteractionRange) && absBearing < 0.24 && nowMs - lastInteractAt > 1800;
    if (interact) lastInteractAt = nowMs;

    return {
      mode: 'objective_hint',
      targetId: obs?.objective?.activeObjectiveId || null,
      targetDist: dist,
      targetBearing: bearing,
      forward: clamp1(forward),
      strafe: 0,
      turn,
      jump: false,
      interact
    };
  }

  chooseRoam(ray, nowMs, stuck);
  roamNoise = clamp1(roamNoise * 0.82 + randRange(-0.28, 0.28) * 0.18);

  let forward = 0.76;
  let turn = clamp1(roamBias + roamNoise);
  if (stuck || front < 1.15) {
    forward = -0.22;
    turn = left > right ? -0.9 : 0.9;
    chooseRoam(ray, nowMs, true);
  } else if (front < 2.1) {
    forward = 0.25;
    turn = left > right ? -0.62 : 0.62;
  }

  turn = clamp1(lastTurn * 0.72 + turn * 0.28);
  lastTurn = turn;

  return {
    mode: 'search',
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
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.close(1000, 'playtest done');
    } catch {
      // noop
    }
  }
  setTimeout(() => process.exit(exitCode), 40);
}

function startActLoop() {
  runStartedAtMs = Date.now();
  let lastLogAt = 0;

  actTimer = setInterval(() => {
    const tSec = (Date.now() - runStartedAtMs) / 1000;
    maybeRequestCapture(tSec);

    const base = buildAct(latestObs);
    send({
      type: 'ACT',
      seq: ++seq,
      forward: clamp1(base.forward),
      strafe: clamp1(base.strafe),
      turn: clamp1(base.turn),
      jump: Boolean(base.jump),
      interact: Boolean(base.interact)
    });

    if (Date.now() - lastLogAt > 1000) {
      lastLogAt = Date.now();
      const objective = latestObs?.objective || {};
      const active = objective?.activeObjectiveId || 'none';
      const progress = Number(objective?.progress || 0).toFixed(2);
      const targetTxt = base.targetId ? ` target=${base.targetId} dist=${safeNum(base.targetDist, NaN).toFixed(2)}` : '';
      console.log(`[ACT] mode=${base.mode} t=${tSec.toFixed(1)} active=${active} progress=${progress} interact=${base.interact}${targetTxt}`);
    }

    if (questCompleted) {
      console.log('[SUCCESS] quest_completed observed; finishing run');
      stop(0);
    }
  }, ACT_INTERVAL_MS);

  shutdownTimer = setTimeout(() => {
    if (!questCompleted) {
      console.error(`[FAIL] RUN_SEC reached (${RUN_SEC}s) without quest_completed`);
      stop(2);
      return;
    }
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
});

ws.addEventListener('message', (event) => {
  let msg;
  try {
    msg = JSON.parse(event.data.toString());
  } catch {
    return;
  }

  if (msg.type === 'OBS') {
    latestObs = msg;
    if (!obsSeen) {
      obsSeen = true;
      console.log('[OBS] first observation received');
    }

    const events = Array.isArray(msg.events) ? msg.events : [];
    for (const ev of events) {
      if (ev.type === 'objective_started') {
        console.log(`[MISSION] objective_started ${ev.objectiveId || 'unknown'} progress=${ev.progress ?? 'n/a'}`);
      }
      if (ev.type === 'objective_completed') {
        if (ev.objectiveId) completedObjectives.add(ev.objectiveId);
        console.log(`[MISSION] objective_completed ${ev.objectiveId || 'unknown'} progress=${ev.progress ?? 'n/a'}`);
      }
      if (ev.type === 'rejected') {
        console.log(`[MISSION] rejected objective=${ev.objectiveId || 'unknown'} expected=${ev.expectedObjectiveId || 'unknown'}`);
      }
      if (ev.type === 'quest_completed') {
        questCompleted = true;
        console.log(`[MISSION] quest_completed progress=${ev.progress ?? 'n/a'}`);
      }
    }
    return;
  }

  if (msg.type === 'INTERACTED') {
    console.log(`[INTERACTED] targetId=${msg.targetId} result=${msg.result}`);
    return;
  }

  if (msg.type === 'CAPTURED') {
    void saveCapturedImage(msg).catch((err) => {
      console.error('[CAPTURE_ERROR]', err?.message || err);
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
