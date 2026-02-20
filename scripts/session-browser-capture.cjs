const path = require('path');
const { launchChromium } = require('./lib/launch-playwright.cjs');

(async () => {
  const base = process.env.DEV_URL || 'http://localhost:5173';
  const outDir = process.env.SHOTS_DIR;
  if (!outDir) throw new Error('SHOTS_DIR required');

  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    await page.screenshot({ path: path.join(outDir, '00-start.png') });

    for (let i = 0; i < 28; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, '01-first-target.png') });

    await page.keyboard.press('KeyE');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, '02-first-interaction.png') });

    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(70);
    }
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, '03-later-exploration.png') });
  } finally {
    if (browser) await browser.close();
  }
})();