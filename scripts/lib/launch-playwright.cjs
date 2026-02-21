const { chromium } = require('playwright');

function resolveLaunchOptions() {
  const mode = process.env.PLAYWRIGHT_LAUNCH_MODE || 'gpu';
  const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';

  if (mode === 'legacy-software') {
    return {
      headless,
      args: [
        '--use-gl=swiftshader',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu-sandbox',
      ],
    };
  }

  return { headless };
}

async function launchChromium() {
  return chromium.launch(resolveLaunchOptions());
}

module.exports = {
  launchChromium,
  resolveLaunchOptions,
};
