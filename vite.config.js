import { defineConfig } from 'vite';
import { createAgentRelayServer } from './agentBridge/wsRelayServer.js';

const bridgePort = Number(process.env.VITE_AGENT_BRIDGE_WS_PORT || 8787);

function agentBridgePlugin() {
  let relay = null;

  return {
    name: 'agent-bridge-relay',
    apply: 'serve',
    configureServer(server) {
      relay = createAgentRelayServer({ port: bridgePort });
      // eslint-disable-next-line no-console
      console.log(`[agent-bridge] relay listening on ws://127.0.0.1:${bridgePort}`);
      server.httpServer?.once('close', () => {
        relay?.close();
        relay = null;
      });
    },
    closeBundle() {
      relay?.close();
      relay = null;
    }
  };
}

export default defineConfig({
  plugins: [agentBridgePlugin()]
});
