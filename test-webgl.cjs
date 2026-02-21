const { launchChromium } = require('./scripts/lib/launch-playwright.cjs');

(async () => {
  let browser;
  try {
    browser = await launchChromium();
    const page = await browser.newPage();
    const ok = await page.evaluate(() => {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    });

    console.log('WEBGL_OK:', ok);
  } catch (error) {
    console.error('WEBGL_CHECK_FAIL', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
