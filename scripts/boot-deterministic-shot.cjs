const { chromium } = require('playwright');
const path = require('path');

(async () => {
  let browser;
  let page;
  const outPath = path.join('artifacts', 'boot-deterministic.png');
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--use-gl=swiftshader',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu-sandbox',
      ],
    });

    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('BROWSER_ERROR:', m.text());
    });

    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForFunction(() => {
      const boot = window.__BOOT_DEBUG__;
      const overlayHidden = !document.getElementById('boot-loading-overlay');
      return !!(
        boot &&
        boot.stages?.renderStarted &&
        boot.stages?.firstFrameRendered &&
        boot.stages?.characterReady &&
        boot.stages?.setDressingReady &&
        boot.stages?.landmarksReady &&
        overlayHidden
      );
    }, null, { timeout: 90000 });

    const debug = await page.evaluate(() => ({
      boot: window.__BOOT_DEBUG__ || null,
      overlayVisible: !!document.getElementById('boot-loading-overlay')
    }));

    await page.screenshot({ path: outPath });
    console.log('BOOT_CHECK_OK', JSON.stringify(debug));
    console.log('SHOT', outPath);
  } catch (e) {
    if (page) {
      try {
        await page.screenshot({ path: outPath });
        console.log('SHOT', outPath);
      } catch {}
    }
    console.error('BOOT_CHECK_FAIL', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
