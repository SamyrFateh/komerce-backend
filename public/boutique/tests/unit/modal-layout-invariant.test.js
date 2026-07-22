/**
 * Double garantie (côté tests) de l'invariant DENSITÉ-ROBUSTE de la modale :
 * aucune hauteur fixe (px) sur les zones de flux — un seul conteneur qui scrolle.
 * Miroir de scripts/audit-modal-layout.js ; échoue si un `height:Npx` réapparaît
 * sur une zone de flux, en plus du gate CI.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/modal-layout.contract.json'), 'utf8'));

function glob(patterns) {
  const out = [];
  for (const pat of patterns) {
    const dir = path.join(ROOT, path.dirname(pat));
    const base = path.basename(pat);
    if (!fs.existsSync(dir)) continue;
    const re = new RegExp('^' + base.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    for (const f of fs.readdirSync(dir)) if (re.test(f)) out.push(path.join(dir, f));
  }
  return out;
}
const lastCompound = (sel) => {
  const p = sel.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return p[p.length - 1] || sel.trim();
};
const zoneMatch = (comp, zone) => new RegExp(zone.replace(/[.#]/g, '\\$&') + '(?![\\w-])').test(comp);

const RULE = /([^{}]+)\{([^{}]+)\}/g;
const FIXED_H = /(?:^|[;{]|\s)height\s*:\s*([0-9.]+)px/i;

function findViolations() {
  const v = [];
  for (const file of glob(cfg.cssGlobs)) {
    const css = fs.readFileSync(file, 'utf8');
    let m;
    RULE.lastIndex = 0;
    while ((m = RULE.exec(css))) {
      const comp = lastCompound(m[1]);
      if (!cfg.flowZones.some((z) => zoneMatch(comp, z))) continue;
      const h = m[2].match(FIXED_H);
      if (h) v.push(`${path.basename(file)} — ${m[1].trim().slice(0, 50)} { height:${h[1]}px }`);
    }
  }
  return v;
}

describe('invariant densité-robuste — modale produit', () => {
  test('aucune hauteur fixe px sur les zones de flux (un seul conteneur qui scrolle)', () => {
    expect(findViolations()).toEqual([]);
  });
});
