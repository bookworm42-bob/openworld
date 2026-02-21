const { launchChromium } = require('./lib/launch-playwright.cjs');
(async () => {
  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'artifacts/msg322-1-idle.png' });

    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(900);
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: 'artifacts/msg322-2-forward-walk.png' });

    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(700);
    await page.keyboard.up('ArrowRight');
    await page.screenshot({ path: 'artifacts/msg322-3-right-walk.png' });

    await page.keyboard.press(' ');
    await page.waitForTimeout(120);
    await page.screenshot({ path: 'artifacts/msg322-4-jump-start.png' });

    await page.waitForTimeout(450);
    await page.screenshot({ path: 'artifacts/msg322-5-jump-mid.png' });
  } catch (error) {
    console.error('MSG322_ANIM_SHOT_FAIL', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
