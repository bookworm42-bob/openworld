const { chromium } = require('playwright');
const path = require('path');

(async () => {
  let browser;
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

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
        overlayHidden
      );
    }, { timeout: 45000 });

    const debug = await page.evaluate(() => ({
      boot: window.__BOOT_DEBUG__ || null,
      overlayVisible: !!document.getElementById('boot-loading-overlay')
    }));

    const outPath = path.join('artifacts', 'boot-deterministic.png');
    await page.screenshot({ path: outPath });
    console.log('BOOT_CHECK_OK', JSON.stringify(debug));
    console.log('SHOT', outPath);
  } catch (e) {
    console.error('BOOT_CHECK_FAIL', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
