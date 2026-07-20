const { chromium } = require('playwright-core');
const path = require('path');

const CHROME_PATH = '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const EVIDENCE_DIR = '/home/claude/komerce-backend/.agent/evidence/T-018';
const HARNESS = 'file://' + path.join(EVIDENCE_DIR, 'harness.html');

async function run(viewportWidth) {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
  await page.goto(HARNESS);
  const box = await page.locator('#k-modal-img-wrap-probe').boundingBox();
  const ratio = box.width / box.height;
  console.log(`viewport=${viewportWidth} wrap: w=${box.width.toFixed(1)} h=${box.height.toFixed(1)} ratio=${ratio.toFixed(3)} (4:3=${(4/3).toFixed(3)})`);
  await page.locator('#k-modal-img-wrap-probe').screenshot({ path: path.join(EVIDENCE_DIR, `desktop-hero-${viewportWidth}.png`) });
  await browser.close();
}

(async () => {
  await run(1024);
  await run(1440);
})().catch((e) => { console.error(e); process.exit(1); });
