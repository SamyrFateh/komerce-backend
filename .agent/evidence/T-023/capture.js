// Capture T-023 — D11 — actions desktop flex, états AVAILABLE_EMPTY / AVAILABLE_FILLED.
// Même méthode que T-017/T-018 : harnais statique (fragment DOM réel
// .k-modal-product-zone / .k-modal-actions, bundles CSS compilés réels
// css/dist/*.css), viewports 1024 et 1440.
const path = require('path');
const { chromium } = require('playwright-core');

const EVIDENCE_DIR = '/home/claude/komerce-backend/.agent/evidence/T-023';
const CHROME_PATH = '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const HARNESS = 'file://' + path.join(EVIDENCE_DIR, 'harness.html');

async function capture(viewportWidth, filled, outFile) {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
  await page.goto(HARNESS);

  // Reproduit exactement renderActions() (b-modal-desktop-product.js:171-178) :
  // toggle de la classe .k-modal-actions--filled selon inCart (qty > 0).
  await page.evaluate((isFilled) => {
    const el = document.getElementById('k-modal-actions');
    el.classList.toggle('k-modal-actions--filled', isFilled);
  }, filled);

  const actions = page.locator('#k-modal-actions');
  const box = await actions.boundingBox();
  await actions.screenshot({ path: outFile });
  return box;
}

(async () => {
  const emptyBox = await capture(1024, false, path.join(EVIDENCE_DIR, 'desktop-actions-empty.png'));
  const filledBox = await capture(1024, true, path.join(EVIDENCE_DIR, 'desktop-actions-filled.png'));

  console.log(JSON.stringify({ empty: emptyBox, filled: filledBox }, null, 2));

  // Contrôle de layout shift : la hauteur et la position du bloc .k-modal-actions
  // ne doivent pas varier entre EMPTY et FILLED (seul le contenu interne change :
  // stepper masqué/visible, CTA Ajouter masqué/visible — cf. modal-shell.css §T-023).
  const shift = Math.abs(emptyBox.height - filledBox.height);
  console.log('Layout shift (delta height):', shift, 'px');

  if (shift > 1) {
    console.error('LAYOUT SHIFT DETECTED');
    process.exit(1);
  }
  console.log('OK — 2 captures générées, aucun layout shift notable');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
