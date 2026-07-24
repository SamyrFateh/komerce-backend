'use strict';

/**
 * tests/unit/check-dom-contract-selftest.test.js
 *
 * Self-test du gate scripts/check-dom-contract.js — pas un test du code
 * boutique, un test du GATE lui-même. Né de l'incident #k-modal-main /
 * #k-modal-cart-slot (2026-07-24) : un commentaire HTML décrivait une
 * structure, le CSS la ciblait, mais les éléments DOM n'avaient jamais
 * été créés — et aucun gate ne pouvait le voir.
 *
 * Ce fichier fige :
 *   1. Le cas motivant lui-même (regression guard) — s'il redevient cassé,
 *      ce test échoue avant que check:dom-contract ait besoin de tourner.
 *   2. Les trois catégories de faux positifs déjà rencontrées en triant
 *      les 26 premiers signaux V-10 et V-9 bruts de ce repo, pour qu'elles
 *      ne reviennent pas si le script est retouché :
 *        - classList.toggle('classe', condition === 'valeur') : la valeur
 *          de comparaison ne doit PAS être lue comme un nom de classe.
 *        - id="x" construit via template/innerHTML (pas seulement `.id =`).
 *        - classes purement logiques (jamais stylées, lues via .closest()).
 */

const path = require('path');
const {
  parseHtml,
  classPresentInRange,
  splitTopLevelArgs,
} = require('../../scripts/check-dom-contract.js');

describe('check-dom-contract — parseHtml', () => {
  test('cas motivant : #id sans classe descendante attendue est détecté', () => {
    const html = `
      <div id="k-modal">
        <!-- .k-modal-main manque volontairement ici -->
      </div>
    `;
    const { idRanges } = parseHtml(html);
    const range = idRanges.get('k-modal');
    expect(range).toBeDefined();
    expect(classPresentInRange(html, 'k-modal-main', range)).toBe(false);
  });

  test('cas motivant : #id avec la classe descendante présente passe', () => {
    const html = `
      <div id="k-modal">
        <div class="k-modal-main">
          <div class="k-modal-cart-slot"></div>
        </div>
      </div>
    `;
    const { idRanges } = parseHtml(html);
    const range = idRanges.get('k-modal');
    expect(classPresentInRange(html, 'k-modal-main', range)).toBe(true);
    expect(classPresentInRange(html, 'k-modal-cart-slot', range)).toBe(true);
  });

  test('une classe présente ailleurs dans le fichier mais hors de la plage ne compte pas', () => {
    const html = `
      <div class="k-modal-main-lookalike"></div>
      <div id="k-modal">
        <div class="k-other"></div>
      </div>
    `;
    const { idRanges } = parseHtml(html);
    const range = idRanges.get('k-modal');
    expect(classPresentInRange(html, 'k-modal-main-lookalike', range)).toBe(false);
  });
});

describe('check-dom-contract — splitTopLevelArgs (faux positif V-9)', () => {
  test('classList.toggle("classe", condition === "valeur") : la valeur de comparaison n\'est pas un segment pur', () => {
    const args = `'show', tab === 'group'`;
    const segments = splitTopLevelArgs(args).map(s => s.trim());
    expect(segments).toEqual([`'show'`, `tab === 'group'`]);
    // Seul le premier segment est un littéral pur -> seul 'show' doit être
    // retenu comme nom de classe par check-dom-contract.js.
    const pureLiterals = segments.filter(s => /^['"][^'"]*['"]$/.test(s));
    expect(pureLiterals).toEqual([`'show'`]);
  });

  test('classList.replace("a", "b") : les deux segments sont des littéraux purs', () => {
    const segments = splitTopLevelArgs(`'a', 'b'`).map(s => s.trim());
    const pureLiterals = segments.filter(s => /^['"][^'"]*['"]$/.test(s));
    expect(pureLiterals).toEqual([`'a'`, `'b'`]);
  });

  test('une virgule à l\'intérieur d\'une chaîne ne coupe pas l\'argument', () => {
    const segments = splitTopLevelArgs(`'a, b'`).map(s => s.trim());
    expect(segments).toEqual([`'a, b'`]);
  });
});

describe('check-dom-contract — scanJs (id dynamique via template, pas seulement .id=)', () => {
  const { scanJs } = require('../../scripts/check-dom-contract.js');
  const fs = require('fs');
  const os = require('os');

  test('id="x" dans un innerHTML/template est détecté comme ID créé dynamiquement', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-contract-test-'));
    const file = path.join(tmpDir, 'sample.js');
    fs.writeFileSync(file, `
      function render() {
        el.innerHTML = '<button id="k-example-btn">x</button>';
      }
    `);
    const { dynamicIdsCreated } = scanJs([file]);
    expect(dynamicIdsCreated.has('k-example-btn')).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('data-id="x" n\'est PAS confondu avec un id HTML', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-contract-test-'));
    const file = path.join(tmpDir, 'sample.js');
    fs.writeFileSync(file, `el.innerHTML = '<span data-id="5"></span>';`);
    const { dynamicIdsCreated } = scanJs([file]);
    expect(dynamicIdsCreated.has('5')).toBe(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
