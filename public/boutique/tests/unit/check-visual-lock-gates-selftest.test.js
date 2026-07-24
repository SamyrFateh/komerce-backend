'use strict';

/**
 * tests/unit/check-visual-lock-gates-selftest.test.js
 *
 * Self-test des 3 gates de verrouillage visuel créés le 2026-07-24 :
 *   - scripts/check-css-vars.js
 *   - scripts/check-zindex-contract.js
 *   - scripts/check-keyframes.js
 *
 * Fige les cas motivants trouvés lors de l'audit manuel qui a précédé ces
 * gates (hero.css:274 --font-body inexistant, var(--ocean, var(--cta))
 * fallback mort, ordre z-index SIBLING_ORDER) et les faux positifs déjà
 * rencontrés en triant les résultats sur le vrai repo.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  collectDefinedVars,
  collectJsSetVars,
  collectUsages,
} = require('../../scripts/check-css-vars.js');

const {
  findZIndexesForSelector,
} = require('../../scripts/check-zindex-contract.js');

const {
  collectDefinedKeyframes,
  collectAnimationRefs,
  splitTopLevel,
} = require('../../scripts/check-keyframes.js');

function writeTmpFile(content, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-gate-test-'));
  const file = path.join(dir, `fixture${ext}`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('check-css-vars — cas motivant --font-body', () => {
  test('var(--x) sans fallback et jamais défini est bien détecté comme usage sans fallback', () => {
    const css = writeTmpFile(`
      .k-hero-pill { font-family: var(--font-body); }
      .k-hero-title { font-family: var(--font); }
    `, '.css');
    const defined = collectDefinedVars([]); // aucune définition nulle part
    const usages = collectUsages([css]);
    const fontBody = usages.find(u => u.name === '--font-body');
    expect(fontBody).toBeDefined();
    expect(fontBody.hasFallback).toBe(false);
    expect(defined.has('--font-body')).toBe(false);
  });

  test('cas motivant réel : --font est bien défini, --font-body ne l\'est jamais (tokens.css)', () => {
    const tokens = writeTmpFile(`:root { --font: 'Plus Jakarta Sans', sans-serif; }`, '.css');
    const defined = collectDefinedVars([tokens]);
    expect(defined.has('--font')).toBe(true);
    expect(defined.has('--font-body')).toBe(false);
  });

  test('fallback imbriqué var(--ocean, var(--cta)) : --cta est bien vu sans SON propre fallback', () => {
    const css = writeTmpFile(`.x { background: var(--ocean, var(--cta)); }`, '.css');
    const usages = collectUsages([css]);
    const outer = usages.find(u => u.name === '--ocean');
    const inner = usages.find(u => u.name === '--cta');
    expect(outer.hasFallback).toBe(true);   // a bien une virgule à son niveau
    expect(inner.hasFallback).toBe(false);  // pas de virgule dans ses propres parenthèses
  });

  test('var(--x, fallback) simple est bien marqué avec fallback', () => {
    const css = writeTmpFile(`.x { border: 1px solid var(--leaf-border, var(--border)); }`, '.css');
    const usages = collectUsages([css]);
    const v = usages.find(u => u.name === '--leaf-border');
    expect(v.hasFallback).toBe(true);
  });

  test('une variable posée en JS via setProperty est reconnue (pas orpheline)', () => {
    const js = writeTmpFile(`
      document.documentElement.style.setProperty('--pager-h', h + 'px');
    `, '.js');
    const { set } = collectJsSetVars([js]);
    expect(set.has('--pager-h')).toBe(true);
  });

  test('setProperty avec nom dynamique (template literal) est écarté, pas faussement "trouvé"', () => {
    const js = writeTmpFile(`
      el.style.setProperty(\`--k-\${n}-offset\`, val);
    `, '.js');
    const { set, dynamic } = collectJsSetVars([js]);
    expect(set.size).toBe(0);
    expect(dynamic.length).toBe(1);
  });
});

describe('check-zindex-contract — ordre réel des couches', () => {
  test('cas motivant : cart-overlay (1100) < cart-drawer (1150), conforme SIBLING_ORDER', () => {
    const css = writeTmpFile(`
      .k-cart-overlay { position: fixed; inset: 0; z-index: 1100; }
      .k-cart-drawer { position: fixed; z-index: 1150; }
    `, '.css');
    const overlay = findZIndexesForSelector([css], '.k-cart-overlay');
    const drawer = findZIndexesForSelector([css], '.k-cart-drawer');
    expect(overlay[0].value).toBe(1100);
    expect(drawer[0].value).toBe(1150);
    expect(Math.max(...overlay.map(o => o.value))).toBeLessThan(Math.min(...drawer.map(d => d.value)));
  });

  test('faux positif évité : .k-modal ne doit pas matcher .k-modal-overlay', () => {
    const css = writeTmpFile(`
      .k-modal-overlay { z-index: 300; }
      .k-modal { z-index: 999; }
    `, '.css');
    const modal = findZIndexesForSelector([css], '.k-modal');
    expect(modal.length).toBe(1);
    expect(modal[0].value).toBe(999);
  });

  test('sélecteur sur une seule ligne minifiée (css/dist) est bien lu', () => {
    const css = writeTmpFile(`.a{color:red}.k-toast{position:fixed;z-index:2000;top:0}.b{color:blue}`, '.css');
    const toast = findZIndexesForSelector([css], '.k-toast');
    expect(toast[0].value).toBe(2000);
  });
});

describe('check-keyframes — cohérence animation ↔ @keyframes', () => {
  test('animation référencée sans @keyframes correspondante est détectée', () => {
    const css = writeTmpFile(`.x { animation: fadeInTypo .3s ease; }`, '.css');
    const defined = collectDefinedKeyframes([]);
    const refs = collectAnimationRefs([css]);
    const ref = refs.find(r => r.name === 'fadeInTypo');
    expect(ref).toBeDefined();
    expect(defined.has('fadeInTypo')).toBe(false);
  });

  test('mots-clés CSS (none, infinite, ease...) ne sont jamais pris pour un nom d\'animation', () => {
    const css = writeTmpFile(`.x { animation: kSpin .7s linear infinite; } .y { animation: none; }`, '.css');
    const refs = collectAnimationRefs([css]);
    const names = refs.map(r => r.name);
    expect(names).toContain('kSpin');
    expect(names).not.toContain('linear');
    expect(names).not.toContain('infinite');
    expect(names).not.toContain('none');
  });

  test('cubic-bezier(...) et var(...) dans la déclaration ne sont jamais pris pour un nom', () => {
    const css = writeTmpFile(`.x { animation: k-card-in .28s cubic-bezier(.22, 1, .36, 1) both; }`, '.css');
    const refs = collectAnimationRefs([css]);
    const names = refs.map(r => r.name);
    expect(names).toEqual(['k-card-in']);
  });

  test('bloc minifié sans espace après } n\'avale pas la règle suivante (splitTopLevel)', () => {
    const parts = splitTopLevel('kGroupFlowUp .22s ease', ',');
    expect(parts.length).toBe(1);
    expect(parts[0].trim()).toBe('kGroupFlowUp .22s ease');
  });

  test('animation définie dans @keyframes est reconnue même préfixée -webkit-', () => {
    const css = writeTmpFile(`@-webkit-keyframes kSpin { to { transform: rotate(360deg); } }`, '.css');
    const defined = collectDefinedKeyframes([css]);
    expect(defined.has('kSpin')).toBe(true);
  });
});
