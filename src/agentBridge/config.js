function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const params = new URLSearchParams(window.location.search);
const wsPort = parseNumber(import.meta.env.VITE_AGENT_BRIDGE_WS_PORT, 8787);
const obsHz = Math.max(1, parseNumber(import.meta.env.VITE_AGENT_OBS_HZ, 20));
const perceptionRange = Math.max(1, parseNumber(import.meta.env.VITE_AGENT_PERCEPTION_RANGE, 15));
const perceptionFovDeg = Math.min(180, Math.max(10, parseNumber(import.meta.env.VITE_AGENT_PERCEPTION_FOV_DEG, 95)));
const mode = (import.meta.env.VITE_AGENT_OBS_MODE || 'realistic').toLowerCase();
const enableEdit = import.meta.env.VITE_AGENT_ENABLE_EDIT === '1';
const host = window.location.hostname || 'localhost';

const bridgeModeRaw = firstNonEmpty(params.get('agentBridgeMode'), import.meta.env.VITE_AGENT_BRIDGE_MODE, 'controller').toLowerCase();
const bridgeMode = bridgeModeRaw === 'disabled' ? 'disabled' : bridgeModeRaw === 'observer' ? 'observer' : 'controller';
const bridgeEnabled = bridgeMode !== 'disabled';
const controllerPriority = parseNumber(
  firstNonEmpty(params.get('agentBridgePriority'), import.meta.env.VITE_AGENT_BRIDGE_CONTROLLER_PRIORITY, '0'),
  0
);

const clientLabel = firstNonEmpty(
  params.get('agentBridgeLabel'),
  import.meta.env.VITE_AGENT_BRIDGE_CLIENT_LABEL,
  `game-${window.location.pathname || '/'}-${window.location.port || 'default'}`
);

const sessionId = firstNonEmpty(
  params.get('agentBridgeSessionId'),
  import.meta.env.VITE_AGENT_BRIDGE_SESSION_ID,
  `${clientLabel}-${Date.now()}`
);

export const agentBridgeConfig = {
  wsUrl: import.meta.env.VITE_AGENT_BRIDGE_WS_URL || `ws://${host}:${wsPort}`,
  version: 'v1',
  obsHz,
  obsIntervalMs: 1000 / obsHz,
  perceptionRange,
  perceptionFovRad: (perceptionFovDeg * Math.PI) / 180,
  obsMode: mode === 'dev' ? 'dev' : 'realistic',
  includeSelfPos: mode === 'dev',
  actTimeoutMs: 500,
  enableEdit,
  bridgeMode,
  bridgeEnabled,
  clientLabel,
  sessionId,
  controllerPriority
};
