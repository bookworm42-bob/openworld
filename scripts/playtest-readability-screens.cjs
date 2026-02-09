const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

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
        '--disable-gpu-sandbox'
      ]
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    const shot = async (name) => {
      const filePath = path.join('artifacts', name);
      await page.screenshot({ path: filePath });
      shots.push(filePath);
      console.log('SHOT', filePath);
    };

    // Near: default spawn framing.
    await shot('readability-near-spawn.png');

    // Mid: move forward toward central landmark lane.
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(65);
    }
    await page.waitForTimeout(300);
    await shot('readability-mid-route.png');

    // Far: continue farther and slight rotate for horizon + landmark read.
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(65);
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(300);
    await shot('readability-far-horizon.png');

    const reportPath = path.join('artifacts', 'readability-check-report.md');
    const report = [
      '# Readability Check Report',
      '',
      `- Generated: ${new Date().toISOString()}`,
      '- Mode: `?slow=1`',
      '- Route: spawn -> mid forward path -> far horizon scan',
      '',
      '## Captured frames',
      ...shots.map((s) => `- ${s}`),
      '',
      '## Manual scoring rubric (1-5)',
      '- [ ] Player silhouette legibility against terrain/fog',
      '- [ ] Landmark visibility from spawn (within a short camera scan)',
      '- [ ] Horizon contrast/separation through fog',
      '',
      '## Notes',
      '- Fill in reviewer/playtest observations here.'
    ].join('\n');
    fs.writeFileSync(reportPath, report);
    console.log('REPORT', reportPath);

    console.log('SHOTS_JSON', JSON.stringify(shots));
  } catch (err) {
    console.error('PLAYTEST_ERROR', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
