#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          modal-layout-gate
 * @domain        boutique
 * @layer         build-gate
 * @criticality   high
 * @purpose       Rend l'invariant DENSITÉ-ROBUSTE exécutable. La modale produit
 *                doit être UN conteneur qui scrolle + CTA sticky ; ses zones de
 *                FLUX ne portent aucune hauteur fixe en px. Interdit le retour du
 *                fold-fitting (hauteurs calculées pour « faire tenir au fold »).
 * @used-by       npm run audit:modal-layout  (+ CI)
 * @version       2026-07
 *
 * DUR (exit 1)  : height:<N>px sur une zone de flux déclarée (sujet du sélecteur).
 *                 min-height / max-height / %/vh/dvh/flex/100% = OK.
 * SOUPLE (warn) : lecture/écriture de hauteur en JS dans un contexte modale
 *                 (souvent bénin : pager, offset CTA sticky, détection bas-scroll).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'modal-layout.contract.json'), 'utf8'));
const C = { r: '\x1b[0m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m', b: '\x1b[1m', dim: '\x1b[2m' };

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

// dernier compound d'un sélecteur (le SUJET : ce qui est réellement stylé)
function lastCompound(sel) {
  const parts = sel.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return parts[parts.length - 1] || sel.trim();
}
// une zone est le sujet si sa classe/id apparaît comme token complet dans le compound final
function zoneMatch(compound, zone) {
  const esc = zone.replace(/[.#]/g, '\\$&');
  return new RegExp(esc + '(?![\\w-])').test(compound);
}

const RULE = /([^{}]+)\{([^{}]+)\}/g;           // règles feuilles (marche même dans @media)
const FIXED_H = /(?:^|[;{]|\s)height\s*:\s*([0-9.]+)px/i;  // height px, PAS min/max/line-height

const violations = [];
const warnings = [];

// 1) CSS — height fixe (px) sur une zone de flux (comme sujet)
for (const file of glob(cfg.cssGlobs)) {
  const css = fs.readFileSync(file, 'utf8');
  let m;
  RULE.lastIndex = 0;
  while ((m = RULE.exec(css))) {
    const sel = m[1], body = m[2];
    const comp = lastCompound(sel);
    if (!cfg.flowZones.some((z) => zoneMatch(comp, z))) continue;
    const h = body.match(FIXED_H);
    if (h) {
      violations.push(`${path.relative(ROOT, file)} — ${sel.trim().slice(0, 60)} { height:${h[1]}px } → zone de flux : hauteur relative/flex requise`);
    }
  }
}

// 2) JS — hauteur imposée / fold-math en contexte modale (souple)
const heightSet = /\.(style\.(height|maxHeight))\s*=[^=]/;
const foldMath = /(innerHeight|clientHeight|offsetHeight|getBoundingClientRect\(\)\.height)/;
const modalCtx = /(modal|hero|variants|pdc|scroll)/i;
for (const file of glob(cfg.jsGlobs)) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, n) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if ((heightSet.test(line) || foldMath.test(line)) && modalCtx.test(line)) {
      warnings.push(`${path.relative(ROOT, file)}:${n + 1} — ${t.slice(0, 88)}`);
    }
  });
}

console.log(`\n${C.b}═══ AUDIT LAYOUT MODALE — densité-robuste ═══${C.r}\n`);
console.log(`${C.dim}Zones de flux surveillées : ${cfg.flowZones.join(', ')}${C.r}\n`);

if (warnings.length) {
  console.log(`${C.ylw}○ À VÉRIFIER — lecture/écriture de hauteur en JS (OK si ce n'est pas du fold-fitting)${C.r}`);
  warnings.forEach((w) => console.log('   ' + w));
  console.log('');
}

if (violations.length) {
  console.log(`${C.red}${C.b}✖ ${violations.length} VIOLATION(S) DE L'INVARIANT LAYOUT${C.r}`);
  violations.forEach((v) => console.log('   ' + C.red + v + C.r));
  console.log(`\n${C.cyn}→ Règle : un seul conteneur qui scrolle + CTA sticky. Zones de flux sans`);
  console.log(`  height fixe (relatif/flex/vh + min/max px OK). Variantes en flex-wrap.${C.r}\n`);
  process.exit(1);
}

console.log(`${C.grn}${C.b}✓ Invariant layout respecté${C.r} — aucune hauteur fixe sur les ${cfg.flowZones.length} zones de flux.\n`);
process.exit(0);
