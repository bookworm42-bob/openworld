#!/usr/bin/env node
import { spawn } from 'node:child_process';

const WORKDIR = process.cwd();
const MAX_RESTARTS = Number(process.env.MAX_GAME_RESTARTS || 20);

let dev = null;
let agent = null;
let restarts = 0;
let stopping = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startDev() {
  console.log('[SUP] starting game dev server');
  dev = spawn('npm', ['run', 'dev'], { cwd: WORKDIR, stdio: 'pipe', env: process.env });

  dev.stdout.on('data', (d) => process.stdout.write(`[DEV] ${d}`));
  dev.stderr.on('data', (d) => process.stderr.write(`[DEV] ${d}`));
  dev.on('exit', (code, signal) => {
    console.log(`[SUP] dev exited code=${code} signal=${signal}`);
  });
}

function startAgent() {
  console.log('[SUP] starting agent controller');
  agent = spawn('node', ['scripts/agent-controller.mjs'], { cwd: WORKDIR, stdio: 'pipe', env: process.env });

  agent.stdout.on('data', (d) => process.stdout.write(`[AGENT] ${d}`));
  agent.stderr.on('data', (d) => process.stderr.write(`[AGENT] ${d}`));
}

async function stopChild(child, name) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await sleep(500);
  if (!child.killed) child.kill('SIGKILL');
  console.log(`[SUP] stopped ${name}`);
}

async function restartStack(reason = 'watchdog') {
  if (stopping) return;
  restarts += 1;
  console.log(`[SUP] restarting stack (#${restarts}) reason=${reason}`);
  if (restarts > MAX_RESTARTS) {
    console.log('[SUP] max restarts exceeded, exiting');
    process.exit(1);
  }
  await stopChild(agent, 'agent');
  await stopChild(dev, 'dev');
  await sleep(600);
  startDev();
  await sleep(1500);
  startAgent();
  wireAgentExitHandler();
}

function wireAgentExitHandler() {
  agent.on('exit', async (code, signal) => {
    console.log(`[SUP] agent exited code=${code} signal=${signal}`);
    if (stopping) return;
    if (code === 42) {
      await restartStack('no perceived targets watchdog');
      return;
    }
    // unexpected crash -> restart agent only
    await sleep(400);
    startAgent();
    wireAgentExitHandler();
  });
}

process.on('SIGINT', async () => {
  stopping = true;
  console.log('\n[SUP] shutdown requested');
  await stopChild(agent, 'agent');
  await stopChild(dev, 'dev');
  process.exit(0);
});

(async function main() {
  startDev();
  await sleep(1500);
  startAgent();
  wireAgentExitHandler();
})();
