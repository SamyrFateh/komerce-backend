'use strict';
const fs = require('fs');
const path = require('path');

// Garde « plancher typographique » : aucune taille de police en px sous 10 px dans la feuille.
function tinyFonts(cssFile) {
  const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css', cssFile), 'utf8');
  return [...css.matchAll(/font-size\s*:\s*([0-9.]+)px/g)].map(m => Number(m[1])).filter(v => v < 10);
}

module.exports = { tinyFonts };
