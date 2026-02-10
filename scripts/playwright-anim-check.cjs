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
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));

    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const webglOk = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return false;
      const gl = c.getContext('webgl2');
      return !!gl;
    });
    console.log('WEBGL2_OK:', webglOk);

    await page.screenshot({ path: path.join('artifacts', 'step-1-idle.png') });

    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(700);
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: path.join('artifacts', 'step-2-forward.png') });

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
    await page.screenshot({ path: path.join('artifacts', 'step-3-right.png') });

    await page.keyboard.press(' ');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join('artifacts', 'step-4-jump.png') });

    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join('artifacts', 'step-5-idle.png') });

    console.log('DONE_SCREENSHOTS');
  } catch (e) {
    console.error('SCRIPT_ERROR:', e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
