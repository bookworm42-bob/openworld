const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    const targetUrl = process.env.BOOT_CHECK_URL || 'http://127.0.0.1:4173/';
    browser = await chromium.launch({
      headless: true,
      args: [
        '--use-gl=swiftshader',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu-sandbox'
      ]
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(25000);
    const boot = await page.evaluate(() => window.__BOOT_DEBUG__ || null);
    await page.screenshot({ path: 'artifacts/boot-quick-shot.png' });
    console.log('BOOT_QUICK_SHOT_OK', JSON.stringify({
      targetUrl,
      lastStage: boot?.lastStage,
      elapsedMs: boot?.elapsedMs,
      stages: boot?.stages || null
    }));
  } catch (error) {
    console.error('BOOT_QUICK_SHOT_FAIL', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
