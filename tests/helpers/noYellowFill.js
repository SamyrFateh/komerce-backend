'use strict';
const fs = require('fs');
const path = require('path');

// Garde « fond blanc » : aucune déclaration de fond jaune/crème pâle dans une feuille canonical.
function paleYellowFills(cssFile) {
  const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css', cssFile), 'utf8');
  const found = [];
  for (const decl of css.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/g)) {
    for (const hex of decl[1].match(/#[0-9a-fA-F]{6}\b/g) || []) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      if (max === min) continue;
      const d = max - min;
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = ((h * 60) + 360) % 360 / 360;
      if (h >= 0.05 && h <= 0.17 && s >= 0.3 && l >= 0.88) found.push(hex);
    }
  }
  return found;
}

module.exports = { paleYellowFills };
