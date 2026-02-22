const { launchChromium } = require('./lib/launch-playwright.cjs');

async function main() {
  const devUrl = process.env.DEV_URL || 'http://127.0.0.1:5173';
  const hardRefresh = process.env.BROWSER_CLIENT_HARD_REFRESH !== '0';
  const navTimeoutMs = Math.max(5000, Number(process.env.BROWSER_CLIENT_NAV_TIMEOUT_MS || 45000));

  let browser;
  let closing = false;

  const shutdown = async (reason) => {
    if (closing) return;
    closing = true;
    try {
      if (browser) {
        await browser.close();
      }
    } catch (_) {
      // Ignore close errors during shutdown.
    }
    console.log(`[BROWSER_CLIENT] closed (${reason})`);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    browser = await launchChromium();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(devUrl, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });

    if (hardRefresh) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
    }

    console.log(`[BROWSER_CLIENT] ready ${devUrl} hardRefresh=${hardRefresh}`);
  } catch (error) {
    console.error('[BROWSER_CLIENT_ERROR]', error?.message || error);
    process.exit(1);
  }

  // Keep this process alive while the game client remains connected.
  setInterval(() => {}, 60000);
}

main();
