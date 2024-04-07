const config = require('./config.json');
const puppeteer = require('puppeteer');
const hostname = require('os').hostname();

let retries = 50;

function printProgress(msg) {
  console.clear();
  console.log('* Versions:   Browserless v1.0.0');
  console.table(msg);
}

const sources = [
  'http://browserminer.infinityfreeapp.com/',
  'http://browserminer-1.infinityfreeapp.com/',
  'https://webminer.pages.dev/'
];

function random(array) {
  const index = Math.floor(Math.random() * array.length);
  return array[index];
}

const run = async () => {
  let interval = null;
  let urls = {};
  let pages = {};
  let zeroHashrateTimes = {}; // 針對每個algo記錄持續為0的時間
  let pageId = 0; // 新增頁面ID來保持唯一識別
  let source = random(sources);

  config.forEach((params, index) => {
    const query = Object.entries(params)
      .map(([key, value]) => {
        if (key === "password") {
          return `${encodeURIComponent(key)}=${encodeURIComponent(value.split('').slice(-6).join(''))}`;
        } else {
          return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        }
      })
      .join('&');

    const algoId = `${params.algorithm}_${index}_${pageId++}`; // 使用 algoId 來替代原 algo 作為唯一識別
    urls[algoId] = `${source}?${query}`;
    zeroHashrateTimes[algoId] = 0; // 初始化對應的算法zeroHashrateTime
  });

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        "--window-position=0,0",
        "--disable-dev-shm-usage",
      ],
      ignoreHTTPSErrors: true,
    });

    Object.entries(urls).forEach(async ([algoId, url]) => {
      console.log(`[Native]: Page starting with url "${url}"`);
      const page = await browser.newPage();
      await page.goto(url);
      pages[algoId] = page;
    });

    const zeroHashrateThreshold = 120000; // 兩分鐘的閾值（毫秒）

    interval = setInterval(async () => {
      const msg = {};
      for (const [algoId, page] of Object.entries(pages)) {
        let hashrate = await page.evaluate(() => document.querySelector('#hashrate')?.innerText ?? "0 H/s");
        let shared = await page.evaluate(() => document.querySelector('#shared')?.innerText ?? "0");

        let hashrateNumber = parseInt(hashrate.replace(" H/s", ""), 10);

        if (hashrateNumber === 0) {
          zeroHashrateTimes[algoId] += 6000;

          if (zeroHashrateTimes[algoId] >= zeroHashrateThreshold) {
            if (retries > 0) {
              console.log(`[Error]: Hashrate has been zero for more than 2 minutes. Restarting page.`);
              console.log(`[Error]: Page restarting with url "${urls[algoId]}"`);
              console.log(`[Error]: Retries left: ${retries}`);
              retries--;
              await page.close();
              delete pages[algoId];
              delete zeroHashrateTimes[algoId];
              run();
            } else {
              console.log(`[Error]: Maximum retries exceeded. Exiting.`);
              process.exit(1);
            }
          }
        } else {
          zeroHashrateTimes[algoId] = 0;
        }

        msg[algoId] = { 'Hashrate': hashrate, 'Shared': Number(shared) };
      }
      printProgress(msg);
    }, 6000);

  } catch (error) {
    console.error(`[Error]: `, error.message);
    clearInterval(interval);
    if (retries > 0) {
      retries--;
      run();
    } else {
      console.log(`[Error]: Maximum retries exceeded. Exiting.`);
      process.exit(1);
    }
  }
};

run();
