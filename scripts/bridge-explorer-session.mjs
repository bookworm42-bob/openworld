#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const sessionId = process.env.SESSION_ID;
const sessionDir = process.env.SESSION_DIR;
const shotsDir = process.env.SHOTS_DIR;
const WS_URL = process.env.BRIDGE_URL || 'ws://localhost:8787';
const RUN_MS = Number(process.env.RUN_MS || 70000);

if (!sessionId || !sessionDir || !shotsDir) {
  console.error('Missing required env: SESSION_ID, SESSION_DIR, SHOTS_DIR');
  process.exit(1);
}

const ACT_INTERVAL_MS = 50; // 20Hz
let ws;
let seq = 0;
let latestObs = null;
let actTimer = null;
let ending = false;

const visitedTargets = new Set();
const targetCooldownUntil = new Map();
const targetFailCount = new Map();
let lastTargetId = null;
let lastInteractAt = 0;
const interactions = [];
const screenshots = [];
let pendingShotName = null;
let gotStartShot = false;
let gotFirstTargetShot = false;
let gotFirstInteractionShot = false;
let gotLaterShot = false;

function clamp(v) { return Math.max(-1, Math.min(1, v)); }
function num(v, fallback = NaN) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function now() { return Date.now(); }

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function queueCapture(name) {
  if (screenshots.includes(name) || pendingShotName) return;
  pendingShotName = name;
  send({ type: 'CAPTURE', cam: 'follow', w: 1280, h: 720, format: 'png', quality: 90 });
}

function pickTarget(obs) {
  const perceived = Array.isArray(obs?.perceived) ? obs.perceived.filter(Boolean) : [];
  if (!perceived.length) return null;
  const t = now();

  const scored = perceived
    .filter((p) => p.id)
    .map((p) => {
      const dist = num(p.dist, 9999);
      const bearing = Math.abs(num(p.bearing, 999));
      const interactable = Array.isArray(p.aff) && p.aff.includes('interact') ? 0 : 1;
      const cooldown = (targetCooldownUntil.get(p.id) || 0) > t ? 1 : 0;
      const samePenalty = p.id === lastTargetId ? 1 : 0;
      return { p, interactable, cooldown, samePenalty, dist, bearing };
    })
    .sort((a, b) =>
      a.cooldown - b.cooldown ||
      a.interactable - b.interactable ||
      a.dist - b.dist ||
      a.bearing - b.bearing
    );

  return scored[0]?.p || null;
}

function maybeInteract(target) {
  const dist = num(target?.dist, 999);
  if (!target?.id) return;
  if (dist > 2.2) return;
  if (now() - lastInteractAt < 1800) return;
  lastInteractAt = now();
  interactions.push({ at: new Date().toISOString(), targetId: target.id, action: 'attempt' });
  send({ type: 'INTERACT', targetId: target.id });
  if (!gotFirstInteractionShot) queueCapture('02-first-interaction.png');
}

function startAct() {
  actTimer = setInterval(() => {
    const target = pickTarget(latestObs);
    let forward = 0.8;
    let strafe = 0;
    let turn = 0.3;

    if (target) {
      const bearing = num(target.bearing, 0);
      const dist = num(target.dist, 999);
      turn = clamp(bearing * 1.6);
      forward = dist > 4 ? 1.0 : dist > 2 ? 0.65 : 0.25;
      visitedTargets.add(target.id);
      if (lastTargetId && lastTargetId !== target.id) targetCooldownUntil.set(lastTargetId, now() + 5000);
      lastTargetId = target.id;

      if (!gotFirstTargetShot) queueCapture('01-first-target.png');
      maybeInteract(target);
    } else {
      const r = latestObs?.sensors?.ray || {};
      const front = num(r.front, 99);
      const left = num(r.frontLeft, 99);
      const right = num(r.frontRight, 99);
      const stuck = Boolean(latestObs?.sensors?.stuck);

      if (stuck || front < 1.2) {
        forward = -0.2;
        turn = left > right ? -0.9 : 0.9;
      } else if (front < 2.5) {
        forward = 0.35;
        turn = left > right ? -0.7 : 0.7;
      } else {
        forward = 0.9;
        turn = 0.35;
      }
    }

    send({ type: 'ACT', seq: ++seq, forward: clamp(forward), strafe: clamp(strafe), turn: clamp(turn), jump: false, interact: false });
  }, ACT_INTERVAL_MS);
}

function finish() {
  if (ending) return;
  ending = true;
  if (actTimer) clearInterval(actTimer);

  const summary = {
    sessionId,
    targetsVisited: Array.from(visitedTargets),
    interactionAttempts: interactions.filter((i) => i.action === 'attempt').length,
    interactionResults: interactions.filter((i) => i.action === 'result'),
    screenshotFiles: screenshots,
    endedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(sessionDir, 'summary.json'), JSON.stringify(summary, null, 2));
  if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'done');
  setTimeout(() => process.exit(0), 150);
}

ws = new WebSocket(WS_URL);
ws.addEventListener('open', () => {
  send({ type: 'HELLO', version: 'v1', role: 'agent', caps: ['obs', 'act', 'capture', 'edit'] });
  startAct();
  setTimeout(() => { if (!gotLaterShot) queueCapture('03-later-exploration.png'); }, 45000);
  setTimeout(finish, RUN_MS);
});

ws.addEventListener('message', (event) => {
  let msg;
  try { msg = JSON.parse(event.data.toString()); } catch { return; }

  if (msg.type === 'OBS') {
    latestObs = msg;
    if (!gotStartShot) queueCapture('00-start.png');
    return;
  }

  if (msg.type === 'CAPTURED' && msg.imgB64 && pendingShotName) {
    const out = path.join(shotsDir, pendingShotName);
    fs.writeFileSync(out, Buffer.from(msg.imgB64, 'base64'));
    screenshots.push(pendingShotName);
    if (pendingShotName === '00-start.png') gotStartShot = true;
    if (pendingShotName === '01-first-target.png') gotFirstTargetShot = true;
    if (pendingShotName === '02-first-interaction.png') gotFirstInteractionShot = true;
    if (pendingShotName === '03-later-exploration.png') gotLaterShot = true;
    pendingShotName = null;
    return;
  }

  if (msg.type === 'INTERACTED') {
    interactions.push({ at: new Date().toISOString(), action: 'result', targetId: msg.targetId, result: msg.result });
    if (msg.result !== 'ok' && msg.targetId) {
      const c = (targetFailCount.get(msg.targetId) || 0) + 1;
      targetFailCount.set(msg.targetId, c);
      if (c >= 2) targetCooldownUntil.set(msg.targetId, now() + 12000);
    }
  }
});

ws.addEventListener('error', (e) => {
  console.error('WS_ERROR', e?.message || e);
  finish();
});

ws.addEventListener('close', () => {
  if (!ending) finish();
});
