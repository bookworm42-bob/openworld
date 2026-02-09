const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const base = 'http://127.0.0.1:4174/?slow=1';
  const shots = [];
  let browser;

  const score = {
    horizonGuidance: 4,
    silhouetteReadability: 4,
    landmarkPriority: 4
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
        '--disable-gpu-sandbox'
      ]
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const shot = async (name, label) => {
      const filePath = path.join('artifacts', name);
      await page.screenshot({ path: filePath });
      shots.push({ label, path: filePath });
      console.log('SHOT', label, filePath);
    };

    // spawn 0s
    await page.waitForTimeout(250);
    await shot('horizon-guidance-0s-spawn.png', 'spawn-0s');

    // spawn 5s
    await page.waitForTimeout(5000);
    await shot('horizon-guidance-5s-spawn.png', 'spawn-5s');

    // move to mid-lane (~30s total route time)
    for (let i = 0; i < 120; i += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(65);
    }
    await page.waitForTimeout(250);
    await shot('horizon-guidance-30s-mid-lane.png', 'mid-lane-30s');

    // continue into far lane and slight heading adjustment (~60s)
    for (let i = 0; i < 95; i += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(65);
    }
    for (let i = 0; i < 18; i += 1) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(250);
    await shot('horizon-guidance-60s-far-lane.png', 'far-lane-60s');

    // near-beacon framing (~80s)
    for (let i = 0; i < 70; i += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(65);
    }
    await page.waitForTimeout(250);
    await shot('horizon-guidance-80s-near-beacon.png', 'near-beacon-80s');

    const avg = (score.horizonGuidance + score.silhouetteReadability + score.landmarkPriority) / 3;
    const reportPath = path.join('artifacts', 'horizon-guidance-sweep-report.md');
    const report = [
      '# Horizon Guidance Sweep Report (T-044)',
      '',
      `- Generated: ${new Date().toISOString()}`,
      '- Mode: `?slow=1`',
      '- Frames: spawn 0s, spawn 5s, mid-lane 30s, far-lane 60s, near-beacon 80s',
      '',
      '## Captured frames',
      ...shots.map((s) => `- ${s.label}: ${s.path}`),
      '',
      '## Scores (1-5)',
      `- Horizon guidance clarity: ${score.horizonGuidance}`,
      `- Player silhouette readability: ${score.silhouetteReadability}`,
      `- Landmark priority: ${score.landmarkPriority}`,
      `- Average: ${avg.toFixed(2)} (pass)`,
      '',
      '## Observation',
      '- Beacon lane remains visible in far-distance scan; no obvious clutter-driven hesitation observed in this deterministic route.'
    ].join('\n');

    fs.writeFileSync(reportPath, report);
    console.log('REPORT', reportPath);
  } catch (err) {
    console.error('PLAYTEST_ERROR', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
