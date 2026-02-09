const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:4174/?slow=1';
  const shots = [];
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
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const shot = async (name) => {
      const p = path.join('artifacts', name);
      await page.screenshot({ path: p });
      shots.push(p);
      console.log('SHOT', p);
    };

    await shot('chunk-playtest-1-spawn.png');

    for (let i = 0; i < 18; i += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(250);
    await shot('chunk-playtest-2-midwalk.png');

    for (let i = 0; i < 18; i += 1) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(250);
    await shot('chunk-playtest-3-near-edge.png');

    console.log('SHOTS_JSON', JSON.stringify(shots));
  } catch (err) {
    console.error('PLAYTEST_ERROR', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
