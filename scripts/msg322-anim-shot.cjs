const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true,args:['--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox']});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  await page.screenshot({path:'artifacts/msg322-1-idle.png'});

  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowUp');
  await page.screenshot({path:'artifacts/msg322-2-forward-walk.png'});

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowRight');
  await page.screenshot({path:'artifacts/msg322-3-right-walk.png'});

  await page.keyboard.press(' ');
  await page.waitForTimeout(120);
  await page.screenshot({path:'artifacts/msg322-4-jump-start.png'});

  await page.waitForTimeout(450);
  await page.screenshot({path:'artifacts/msg322-5-jump-mid.png'});

  await browser.close();
})();
