const { chromium } = require('playwright');

function resolveLaunchOptions() {
  const mode = process.env.PLAYWRIGHT_LAUNCH_MODE || 'gpu';
  const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
  const commonArgs = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion'
  ];

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
        ...commonArgs
      ]
    };
  }

  return {
    headless,
    args: commonArgs
  };
}

async function launchChromium() {
  return chromium.launch(resolveLaunchOptions());
}

module.exports = {
  launchChromium,
  resolveLaunchOptions
};
