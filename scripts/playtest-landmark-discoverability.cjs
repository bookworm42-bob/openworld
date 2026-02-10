const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:4174/?slow=1';
  const shots = [];
  let browser;

  const takeShot = async (page, name) => {
    const p = path.join('artifacts', name);
    await page.screenshot({ path: p });
    shots.push(p);
    console.log('SHOT', p);
  };

  const turn = async (page, key, ms) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };

  const walk = async (page, ms) => {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(ms);
    await page.keyboard.up('ArrowUp');
  };

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
    await page.waitForTimeout(3000);

    // Spawn scan for landmark visibility (within ~5s total scan window)
    await takeShot(page, 'landmark-playtest-tower-1-spawn.png');

    await turn(page, 'ArrowLeft', 900);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-ruins-1-spawn-scan.png');

    await turn(page, 'ArrowRight', 1800);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-windmill-1-spawn-scan.png');

    // Tower route (near landmark around +x/-z)
    await turn(page, 'ArrowLeft', 900);
    await walk(page, 4200);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-tower-2-mid.png');

    await walk(page, 3800);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-tower-3-near-base.png');

    // Ruins route (left side)
    await turn(page, 'ArrowLeft', 1150);
    await walk(page, 3200);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-ruins-2-mid.png');

    await walk(page, 3500);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-ruins-3-near-base.png');

    // Windmill route (far right side)
    await turn(page, 'ArrowRight', 2350);
    await walk(page, 4200);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-windmill-2-mid.png');

    await walk(page, 5200);
    await page.waitForTimeout(250);
    await takeShot(page, 'landmark-playtest-windmill-3-near-base.png');

    console.log('SHOTS_JSON', JSON.stringify(shots));
  } catch (err) {
    console.error('PLAYTEST_ERROR', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
