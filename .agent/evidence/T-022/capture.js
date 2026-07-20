// Capture T-022 — D10 — suggestions desktop en aplat page-bg, border-top
// dashed, titre 15/500, grille 4 cols (1024px) / 5 cols (1440px, réutilise
// le seuil déjà baseliné T-020), retrait ombres cards.
// Même méthode que T-017/T-018/T-019/T-023 : harnais statique (fragment DOM
// réel #k-modal-suggestions, bundles CSS compilés réels css/dist/*.css).
const path = require('path');
const { chromium } = require('playwright-core');

const EVIDENCE_DIR = '/home/claude/repo/.agent/evidence/T-022';
const CHROME_PATH = '/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
const HARNESS = 'file://' + path.join(EVIDENCE_DIR, 'harness.html');

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    timeout: 15000,
  });

  const block = { width: 1024, height: 1400, file: 'desktop-suggestions-1024.png' };
  const large = { width: 1600, height: 1400, file: 'desktop-suggestions-1600.png' };

  const computed = {};

  for (const vp of [block, large]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(HARNESS, { timeout: 15000 });
    const section = page.locator('#k-modal-suggestions');
    await section.screenshot({ path: path.join(EVIDENCE_DIR, vp.file) });

    const values = await page.evaluate(() => {
      const sec = document.querySelector('#k-modal-suggestions');
      const title = document.querySelector('.k-sug-title-text');
      const card = document.querySelector('.k-sug-card');
      const grid = document.querySelector('.k-sug-grid--same');
      const secStyle = getComputedStyle(sec);
      const titleStyle = getComputedStyle(title);
      const cardStyle = getComputedStyle(card);
      const gridStyle = getComputedStyle(grid);
      return {
        sectionBackground: secStyle.backgroundImage === 'none' ? secStyle.backgroundColor : secStyle.backgroundImage,
        borderTop: secStyle.borderTopStyle + ' ' + secStyle.borderTopWidth,
        titleFontSize: titleStyle.fontSize,
        titleFontWeight: titleStyle.fontWeight,
        cardBoxShadow: cardStyle.boxShadow,
        gridTemplateColumns: gridStyle.gridTemplateColumns,
        columnCount: gridStyle.gridTemplateColumns.split(' ').length,
      };
    });
    computed[`${vp.width}px`] = values;
    await page.close();
  }

  await browser.close();
  require('fs').writeFileSync(
    path.join(EVIDENCE_DIR, 'computed-validation.json'),
    JSON.stringify(computed, null, 2)
  );
  console.log('OK —', block.file, 'et', large.file, 'générés');
  console.log(JSON.stringify(computed, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
