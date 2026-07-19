// Capture T-019 — D7 — zone produit + panneau détails en aplat page-bg.
// Même méthode que T-017/T-018/T-023 : harnais statique (fragment DOM réel
// .k-modal-product-zone, bundles CSS compilés réels css/dist/*.css).
const path = require('path');
const { chromium } = require('playwright-core');

const EVIDENCE_DIR = '/home/claude/komerce-backend/.agent/evidence/T-019';
const CHROME_PATH = '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const HARNESS = 'file://' + path.join(EVIDENCE_DIR, 'harness.html');

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    timeout: 15000,
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  await page.goto(HARNESS, { timeout: 15000 });
  const zone = page.locator('.k-modal-product-zone');
  await zone.screenshot({ path: path.join(EVIDENCE_DIR, 'desktop-zone.png') });
  await browser.close();
  console.log('OK — desktop-zone.png généré');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
