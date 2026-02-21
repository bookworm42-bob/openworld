const { launchChromium } = require('./lib/launch-playwright.cjs');
(async () => {
  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'artifacts/msg335-forward-held.png' });
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowUp');
  } catch (error) {
    console.error('MSG335_FORWARD_HELD_FAIL', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
