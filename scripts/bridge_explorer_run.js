const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const sessionId = fs.readFileSync('/tmp/openworld_session_id','utf8').trim();
const base = path.join(process.cwd(), 'sessions', sessionId);
const shotsDir = path.join(base, 'screenshots');
const summaryPath = path.join(base, 'summary.json');

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

let seq = 1;
let lastObs = null;
let currentTarget = null;
const cooldown = new Map(); // targetId -> ts ms until
const targetsVisited = [];
const seenTargets = new Set();
let interactionAttempts = 0;
const interactionResults = [];
let lastInteractAt = 0;
let firstTargetCaptured = false;
let firstInteractionCaptured = false;
let startShotDone = false;
let laterShotDone = false;
const screenshotFiles = [];
const pendingCaptures = [];
let turnDirection = 1;
let lastToggle = Date.now();

function saveShot(name, imgB64){
  const file = path.join(shotsDir, name);
  fs.writeFileSync(file, Buffer.from(imgB64, 'base64'));
  screenshotFiles.push(path.relative(path.join(process.cwd(),'sessions',sessionId), file));
}

function requestCapture(name){
  return new Promise((resolve,reject)=>{
    pendingCaptures.push({name, resolve, reject, ts: Date.now()});
    ws.send(JSON.stringify({type:'CAPTURE'}));
    setTimeout(()=>reject(new Error('capture timeout')),4000);
  });
}

function chooseTarget(obs){
  const now = Date.now();
  const perceived = Array.isArray(obs?.perceived) ? obs.perceived.filter(o=>o && o.id!=null) : [];
  if (!perceived.length) return null;

  const available = perceived.filter(o=>!(cooldown.get(String(o.id))>now));
  if (!available.length) return null;

  const interactables = available.filter(o=>Array.isArray(o.aff) && o.aff.includes('interact'));
  const pool = interactables.length ? interactables : available;
  pool.sort((a,b)=>(a.dist??1e9)-(b.dist??1e9));
  return pool[0] || null;
}

const ws = new WebSocket('ws://localhost:8787');

ws.on('open', async ()=>{
  ws.send(JSON.stringify({type:'HELLO',version:'v1',role:'agent',caps:['obs','act','capture','edit']}));
  try {
    await requestCapture('00-start.png');
    startShotDone = true;
  } catch {}
});

ws.on('message', async (raw)=>{
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  if (msg.type === 'OBS') {
    lastObs = msg;
  }

  if (msg.type && msg.type.toUpperCase().includes('INTERACT')) {
    interactionResults.push(msg);
  }

  if (msg.imgB64 && pendingCaptures.length) {
    const c = pendingCaptures.shift();
    try {
      saveShot(c.name, msg.imgB64);
      c.resolve();
    } catch (e) { c.reject(e); }
  }
});

const tick = setInterval(async ()=>{
  const now = Date.now();
  if (!lastObs) return;

  const prevTargetId = currentTarget ? String(currentTarget.id) : null;
  const nextTarget = chooseTarget(lastObs);

  if (prevTargetId && (!nextTarget || String(nextTarget.id)!==prevTargetId)) {
    cooldown.set(prevTargetId, now + 5000);
  }
  currentTarget = nextTarget;

  let forward=0, turn=0, strafe=0;

  if (currentTarget) {
    turn = clamp((currentTarget.bearing ?? 0) * 1.6, -1, 1);
    const d = currentTarget.dist ?? 999;
    if (d > 8) forward = 1.0;
    else if (d > 4) forward = 0.8;
    else if (d > 2) forward = 0.45;
    else forward = 0.15;

    const id = String(currentTarget.id);
    if (!seenTargets.has(id)) {
      seenTargets.add(id);
      targetsVisited.push(id);
    }

    if (!firstTargetCaptured) {
      try { await requestCapture('01-first-target.png'); firstTargetCaptured=true; } catch {}
    }

    if ((currentTarget.dist ?? 999) <= 2.2 && (now - lastInteractAt) > 2000) {
      ws.send(JSON.stringify({type:'INTERACT',targetId:id}));
      interactionAttempts += 1;
      lastInteractAt = now;
      if (!firstInteractionCaptured) {
        try { await requestCapture('02-first-interaction.png'); firstInteractionCaptured=true; } catch {}
      }
    }
  } else {
    const ray = lastObs?.sensors?.ray || {};
    const front = ray.front ?? 999;
    const fl = ray.frontLeft ?? 0;
    const fr = ray.frontRight ?? 0;
    const stuck = !!lastObs?.sensors?.stuck;

    if (stuck || front < 1.2) {
      forward = -0.25;
      turn = (fl > fr ? -0.9 : 0.9);
    } else if (front < 2.5) {
      forward = 0.35;
      turn = (fl > fr ? -0.75 : 0.75);
    } else {
      forward = 0.9;
      if (now - lastToggle > 2500) { turnDirection *= -1; lastToggle = now; }
      turn = 0.75 * turnDirection;
    }
  }

  ws.send(JSON.stringify({
    type:'ACT',
    seq: seq++,
    forward: clamp(forward,-1,1),
    strafe: 0,
    turn: clamp(turn,-1,1),
    jump:false,
    interact:false
  }));
}, 50);

setTimeout(async ()=>{
  if (!laterShotDone) {
    try { await requestCapture('03-later-exploration.png'); laterShotDone = true; } catch {}
  }
}, 45000);

setTimeout(()=>{
  clearInterval(tick);
  const summary = {
    sessionId,
    targetsVisited,
    interactionAttempts,
    interactionResults,
    screenshotFiles,
    endedAt: new Date().toISOString()
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  try { ws.close(); } catch {}
  process.exit(0);
}, 70000);
