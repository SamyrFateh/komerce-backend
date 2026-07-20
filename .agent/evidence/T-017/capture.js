// Capture T-017 — série produit desktop, viewports 1024 et 1440.
// Réutilise le harnais statique (fragment DOM réel de .k-modal-info,
// bundles CSS compilés réels css/dist/*.css) — même méthode que
// T-002/T-003/T-004 (voir CAPTURE-METHOD.md).
const path = require('path');
const { chromium } = require('playwright-core');

const EVIDENCE_DIR = '/home/claude/komerce-backend/.agent/evidence/T-017';
const CHROME_PATH = '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const HARNESS = 'file://' + path.join(EVIDENCE_DIR, 'harness.html');

async function capture(viewportWidth, seriesValue, outFile) {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
  await page.goto(HARNESS);

  // Applique exactement la logique de renderIdentity() (b-modal-desktop-product.js:84-88) :
  // series présent -> textContent = série, hidden = false
  // series absent  -> textContent = '', hidden = true (fallback silencieux, pas de ligne vide)
  await page.evaluate((series) => {
    const el = document.getElementById('k-modal-cat');
    el.textContent = series || '';
    el.hidden = !series;
  }, seriesValue);

  const details = page.locator('#k-modal-details');
  await details.screenshot({ path: outFile });
  await browser.close();
}

(async () => {
  await capture(1024, 'Golden Performance Series', path.join(EVIDENCE_DIR, 'desktop-series-1024.png'));
  await capture(1440, 'Golden Performance Series', path.join(EVIDENCE_DIR, 'desktop-series-1440.png'));
  // Preuve complémentaire du fallback silencieux (série absente) aux deux largeurs.
  await capture(1024, null, path.join(EVIDENCE_DIR, 'desktop-series-1024-fallback.png'));
  await capture(1440, null, path.join(EVIDENCE_DIR, 'desktop-series-1440-fallback.png'));
  console.log('OK — 4 captures générées');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
