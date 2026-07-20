const { chromium } = require('playwright-core');
const path = require('path');

const CHROME_PATH = '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const EVIDENCE_DIR = '/home/claude/komerce-backend/.agent/evidence/T-018';
const HARNESS = 'file://' + path.join(EVIDENCE_DIR, 'harness-long-content.html');

async function run(viewportWidth) {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
  await page.goto(HARNESS);

  const zone = await page.locator('#probe-zone').boundingBox();
  const wrap = await page.locator('#probe-wrap').boundingBox();
  const details = await page.locator('#probe-details').boundingBox();
  const detailsScrollHeight = await page.locator('#probe-details').evaluate((el) => el.scrollHeight);
  const detailsClientHeight = await page.locator('#probe-details').evaluate((el) => el.clientHeight);
  const detailsOverflowY = await page.locator('#probe-details').evaluate((el) => getComputedStyle(el).overflowY);
  const viewportHeight = page.viewportSize().height;
  const wrapRatio = wrap.width / wrap.height;

  console.log(`\n--- viewport=${viewportWidth} (long content) ---`);
  console.log(`viewport height          : ${viewportHeight}`);
  console.log(`product-zone height      : ${zone.height.toFixed(1)}  (doit être <= viewport, fixe)`);
  console.log(`img-wrap  w=${wrap.width.toFixed(1)} h=${wrap.height.toFixed(1)} ratio=${wrapRatio.toFixed(3)} (doit rester ~1.333, ne pas s'étirer)`);
  console.log(`details clientHeight     : ${detailsClientHeight}`);
  console.log(`details scrollHeight     : ${detailsScrollHeight}  (doit être > clientHeight → contenu scrollable en interne)`);
  console.log(`details overflow-y       : ${detailsOverflowY} (doit être 'auto')`);
  console.log(`zone dépasse le viewport ? ${zone.y + zone.height > viewportHeight ? 'OUI (FAIL)' : 'NON (OK)'}`);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, `long-content-${viewportWidth}.png`) });
  await browser.close();
}

(async () => {
  await run(1024);
  await run(1440);
})().catch((e) => { console.error(e); process.exit(1); });
