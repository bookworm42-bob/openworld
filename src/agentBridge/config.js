function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const wsPort = parseNumber(import.meta.env.VITE_AGENT_BRIDGE_WS_PORT, 8787);
const obsHz = Math.max(1, parseNumber(import.meta.env.VITE_AGENT_OBS_HZ, 20));
const perceptionRange = Math.max(1, parseNumber(import.meta.env.VITE_AGENT_PERCEPTION_RANGE, 15));
const perceptionFovDeg = Math.min(180, Math.max(10, parseNumber(import.meta.env.VITE_AGENT_PERCEPTION_FOV_DEG, 95)));
const mode = (import.meta.env.VITE_AGENT_OBS_MODE || 'realistic').toLowerCase();
const enableEdit = import.meta.env.VITE_AGENT_ENABLE_EDIT === '1';
const host = window.location.hostname || 'localhost';

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
  enableEdit
};
