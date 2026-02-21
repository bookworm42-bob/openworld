const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./lib/launch-playwright.cjs');

(async () => {
  const base = process.env.DEV_URL || 'http://127.0.0.1:5173';
  const outPath = process.env.OUT_PATH || path.join('artifacts', `snapshot-${Date.now()}.png`);
  const waitMs = Math.max(0, Number(process.env.WAIT_MS || 3500));
  const width = Math.max(640, Number(process.env.SNAP_W || 1280));
  const height = Math.max(360, Number(process.env.SNAP_H || 720));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(waitMs);
    await page.screenshot({ path: outPath });
    console.log(`[SNAPSHOT] saved ${outPath}`);
  } catch (error) {
    console.error('[SNAPSHOT_ERROR]', error?.message || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();

