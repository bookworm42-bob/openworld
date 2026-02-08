const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true,args:['--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox']});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1200);
  await page.screenshot({path:'artifacts/msg335-forward-held.png'});
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowUp');
  await browser.close();
})();
