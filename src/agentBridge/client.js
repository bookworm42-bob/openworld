import { agentBridgeConfig } from './config.js';

const NEUTRAL_ACT = Object.freeze({
  forward: 0,
  strafe: 0,
  turn: 0,
  jump: false,
  interact: false
});

function clampAxis(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function normalizeAct(msg) {
  return {
    forward: clampAxis(msg.forward),
    strafe: clampAxis(msg.strafe),
    turn: clampAxis(msg.turn),
    jump: Boolean(msg.jump),
    interact: Boolean(msg.interact)
  };
}

export class AgentBridgeClient {
  constructor({ onCapture, onEdit }) {
    this.onCapture = onCapture;
    this.onEdit = onEdit;
    this.socket = null;
    this.enabled = agentBridgeConfig.bridgeEnabled;
    this.connected = false;
    this.lastObsSentAt = 0;
    this.lastAct = NEUTRAL_ACT;
    this.lastActAt = 0;
    this.lastActInteract = false;
    this.interactQueue = [];
    this.captureQueue = [];
    this.editQueue = [];
  }

  connect() {
    if (!this.enabled) return;

    const ws = new WebSocket(agentBridgeConfig.wsUrl);
    this.socket = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      this.send({
        type: 'HELLO',
        version: agentBridgeConfig.version,
        role: 'game',
        mode: agentBridgeConfig.bridgeMode,
        clientLabel: agentBridgeConfig.clientLabel,
        sessionId: agentBridgeConfig.sessionId,
        controllerPriority: agentBridgeConfig.controllerPriority,
        caps: ['obs', 'act', 'capture', 'edit']
      });
    });

    ws.addEventListener('close', () => {
      this.connected = false;
      this.lastAct = NEUTRAL_ACT;
      this.lastActAt = 0;
      this.lastActInteract = false;
      this.interactQueue.length = 0;
      this.captureQueue.length = 0;
      this.editQueue.length = 0;
    });

    ws.addEventListener('error', () => {
      this.connected = false;
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handleMessage(msg);
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'ACT':
        this.lastAct = normalizeAct(msg);
        this.lastActAt = performance.now();
        break;
      case 'INTERACT':
        if (typeof msg.targetId === 'string' && msg.targetId) {
          this.interactQueue.push(msg);
        }
        break;
      case 'CAPTURE':
        this.captureQueue.push(msg);
        break;
      case 'EDIT':
        this.editQueue.push(msg);
        break;
      default:
        break;
    }
  }

  send(msg) {
    if (!this.enabled) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  shouldSendObs(nowMs) {
    if (!this.enabled) return false;
    return nowMs - this.lastObsSentAt >= agentBridgeConfig.obsIntervalMs;
  }

  sendObs(obs) {
    this.lastObsSentAt = performance.now();
    this.send(obs);
  }

  getActState(nowMs) {
    if (!this.enabled || !this.connected) return NEUTRAL_ACT;
    if (nowMs - this.lastActAt > agentBridgeConfig.actTimeoutMs) return NEUTRAL_ACT;
    return this.lastAct;
  }

  consumeOneShotInteract(nowMs) {
    const act = this.getActState(nowMs);
    const risingEdge = act.interact && !this.lastActInteract;
    this.lastActInteract = act.interact;
    return risingEdge;
  }

  consumeInteractRequest() {
    return this.interactQueue.shift() || null;
  }

  async pumpCaptureRequests(ctx) {
    const next = this.captureQueue.shift();
    if (!next) return;
    try {
      const response = await this.onCapture(next, ctx);
      if (response) this.send(response);
    } catch {
      this.send({ type: 'CAPTURED', cam: next.cam || 'follow', imgB64: '' });
    }
  }

  async pumpEditRequests(ctx) {
    const next = this.editQueue.shift();
    if (!next) return;
    try {
      const response = await this.onEdit(next, ctx);
      if (response) this.send(response);
    } catch {
      this.send({ type: 'EDITED', op: next.op || 'UNKNOWN', result: 'error' });
    }
  }
}
