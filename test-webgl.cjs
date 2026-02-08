const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu-sandbox',
    ],
  });

  const page = await browser.newPage();
  const ok = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  });

  console.log('WEBGL_OK:', ok);
  await browser.close();
})();
