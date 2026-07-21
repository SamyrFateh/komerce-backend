'use strict';

/**
 * tests/unit/audit-modal-ownership-selftest.test.js
 *
 * Self-test du gate scripts/audit-modal-ownership.js — pas un test du code
 * de la modale, un test du GATE lui-même. Trouvé le 2026-07 : le gate
 * documentait dans son propre changelog la couverture des écritures
 * "forEach-tableau" et "fonction relais", mais deux trous rendaient la
 * seconde couverture inopérante :
 *
 *   1. forwardingFunctions()/writersViaForwarding() étaient définies mais
 *      jamais appelées depuis main() — zéro site d'appel dans tout le
 *      fichier. Documenté comme corrigé, jamais exécuté.
 *   2. Une fois branchées, writersViaForwarding() utilisait une regex
 *      naïve `\(([^)]*)\)` pour capturer les arguments d'appel — qui
 *      s'arrête à la PREMIÈRE parenthèse fermante rencontrée. Sur le cas
 *      motivant réel, `wireBuyNowButton(document.getElementById('id'))`,
 *      elle tronquait l'argument à la parenthèse de getElementById et
 *      manquait la cible.
 *
 * Ce fichier fige les 3 formes d'écriture ET un cas négatif, pour que ce
 * gate ne puisse plus régresser silencieusement une troisième fois — c'est
 * le "gate anti-récidive" appliqué au gate anti-récidive lui-même
 * (Axe 2 de AUDIT-integrite-gouvernance-3-surfaces.md : les docs de vérité
 * correspondent-elles au code, appliqué récursivement à ce script).
 */

const {
  writesZone,
  zoneWriters,
  forwardingFunctions,
  writersViaForwarding,
} = require('../../scripts/audit-modal-ownership.js');

const ZONE = { id: 'k-fixture-zone', owner: 'owner.js', allow: [] };

describe('audit-modal-ownership — self-test du gate', () => {
  test('forme 1 — écriture directe : el.innerHTML = … est détectée', () => {
    const src = `
      const el = document.getElementById('k-fixture-zone');
      el.innerHTML = '<span>x</span>';
    `;
    expect(writesZone(src, ZONE)).toBe(true);
  });

  test('forme 2 — forEach sur tableau littéral : [a, getElementById(id)].forEach(x => x.disabled = …) est détectée', () => {
    const src = `
      [dom.other, document.getElementById('k-fixture-zone')].forEach((btn) => {
        btn.disabled = true;
      });
    `;
    expect(writesZone(src, ZONE)).toBe(true);
  });

  test('forme 3 — fonction relais avec appel imbriqué : f(document.getElementById(id)) est détectée, y compris avec parenthèses imbriquées', () => {
    const definerSrc = `
      export function wireThing(target) {
        target.onclick = () => {};
      }
    `;
    const callerSrc = `
      wireThing(document.getElementById('k-fixture-zone'));
    `;
    const sources = new Map([
      ['definer.js', definerSrc],
      ['caller.js', callerSrc],
    ]);
    const reachable = new Set(['definer.js', 'caller.js']);

    const forwarders = forwardingFunctions(sources, reachable);
    expect(forwarders).toEqual(
      expect.arrayContaining([{ file: 'definer.js', fnName: 'wireThing' }])
    );

    // Le point précis du bug §2 trouvé aujourd'hui : sans extraction à
    // parenthèses équilibrées, cette assertion échouait silencieusement.
    const writers = writersViaForwarding(sources, ZONE, forwarders, reachable);
    expect(writers.has('definer.js')).toBe(true);

    // zoneWriters (utilisée par main()) doit attribuer l'écriture au
    // fichier qui DÉFINIT la fonction relais. Le simple appelant, qui ne
    // fait que transmettre la cible sans la muter lui-même, n'est PAS un
    // écrivain — c'est tout l'intérêt du repérage : l'attribution suit la
    // mutation réelle, pas le site d'appel textuel.
    const allWriters = zoneWriters(sources, ZONE, reachable, forwarders);
    expect(allWriters).toContain('definer.js');
    expect(allWriters).not.toContain('caller.js');
  });

  test('cas négatif — un fichier qui ne référence pas la zone n’est jamais un faux positif', () => {
    const src = `
      const el = document.getElementById('k-completely-unrelated-zone');
      el.innerHTML = '<span>x</span>';
    `;
    expect(writesZone(src, ZONE)).toBe(false);
  });

  test('cas négatif — une fonction relais qui ne mute pas son paramètre n’est jamais retenue comme écrivain', () => {
    // getAttribute ne figure dans aucun WRITE_OPS : lecture pure, sans
    // ambiguïté. (textContent/innerHTML sont volontairement dans WRITE_OPS
    // même en lecture — doctrine assumée du gate : zéro faux négatif quitte
    // à demander une allowlist explicite pour les cas légitimes.)
    const definerSrc = `
      export function readOnly(target) {
        console.log(target.getAttribute('data-id'));
      }
    `;
    const callerSrc = `
      readOnly(document.getElementById('k-fixture-zone'));
    `;
    const sources = new Map([
      ['definer.js', definerSrc],
      ['caller.js', callerSrc],
    ]);
    const reachable = new Set(['definer.js', 'caller.js']);
    const forwarders = forwardingFunctions(sources, reachable);
    expect(forwarders).toEqual([]);
  });
});
