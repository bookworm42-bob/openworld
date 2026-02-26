const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./lib/launch-playwright.cjs');

(async () => {
  const base = process.env.DEV_URL || 'http://127.0.0.1:5173';
  const outPath = process.env.OUT_PATH || path.join('artifacts', `snapshot-${Date.now()}.png`);
  const waitMs = Math.max(0, Number(process.env.WAIT_MS || 3500));
  const width = Math.max(640, Number(process.env.SNAP_W || 1280));
  const height = Math.max(360, Number(process.env.SNAP_H || 720));
  const bridgeMode = (process.env.SNAPSHOT_BRIDGE_MODE || 'observer').toLowerCase();
  const bridgeLabel = process.env.SNAPSHOT_BRIDGE_LABEL || `snapshot-${Date.now()}`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let browser;
  try {
    const url = new URL(base);
    url.searchParams.set('agentBridgeMode', bridgeMode === 'disabled' ? 'disabled' : 'observer');
    url.searchParams.set('agentBridgeLabel', bridgeLabel);

    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(waitMs);
    await page.screenshot({ path: outPath });
    console.log(`[SNAPSHOT] saved ${outPath}`);
    console.log(`[SNAPSHOT] bridge_mode=${url.searchParams.get('agentBridgeMode')} label=${bridgeLabel}`);
  } catch (error) {
    console.error('[SNAPSHOT_ERROR]', error?.message || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
