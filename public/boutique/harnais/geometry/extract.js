// Extraction du markup par MARQUEURS (jamais par numéro de ligne : index.html bouge).
const fs = require('fs'), path = require('path');
const IDX = path.resolve(__dirname, '..', 'public', 'boutique', 'index.html');
function between(startRe, endRe) {
  const s = fs.readFileSync(IDX, 'utf8');
  const a = s.search(startRe);
  const b = s.search(endRe);
  if (a < 0 || b < 0 || b <= a) throw new Error(`marqueurs introuvables : ${startRe} … ${endRe}`);
  return s.slice(a, b);
}
module.exports = {
  modal: () => between(/<div class="k-modal-overlay" id="k-modal-overlay">/, /<!-- ═══ CART DRAWER ═══ -->/),
  hero:  () => between(/<div id="k-hero-fixed-wrap">/, /<div id="k-bar-spacer"|<main|<section class="k-cats-shell"/),
};
