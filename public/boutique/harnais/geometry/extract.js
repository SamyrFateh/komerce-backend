// Extraction du markup par MARQUEURS (jamais par numéro de ligne : index.html bouge).
const fs = require('fs'), path = require('path');
// FIX 2026-07 (P0-A) : ce fichier vit sous public/boutique/harnais/geometry/,
// pas à la racine du dépôt à côté de public/ — index.html est donc deux
// niveaux au-dessus (harnais/geometry → harnais → boutique), jamais sous
// un sous-dossier public/boutique/ imaginaire. L'ancien chemin
// ('..','public','boutique','index.html') pointait vers
// harnais/public/boutique/index.html, qui n'a jamais existé : measure-hero.js
// et verify-backtop-zindex.js (correctifs #3 et #4 du tableau P0-A)
// crashaient tous les deux en ENOENT avant ce correctif.
const IDX = path.resolve(__dirname, '..', '..', 'index.html');
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
