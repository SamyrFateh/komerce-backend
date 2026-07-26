'use strict';

/**
 * [P0-A #5] Verrouille le correctif du parser css-guard sur les règles
 * compactes (cf. scripts/css-guard.js — commentaire "FIX 2026-07").
 *
 * Avant ce correctif, une déclaration posée SUR la ligne d'ouverture d'une
 * règle (`.sel { color: red; }`, style compact) était perdue par le parser :
 * la règle ressortait avec `props:{}`, invisible au détecteur de conflit.
 * C'est exactement ce qui a rendu invisible le conflit réel
 * `align-self:start` / `align-self:center` — cause racine du bug hero
 * sticky (correctif #1).
 *
 * Ce test n'appelle pas css-guard.js comme un module (il exécute sa logique
 * CLI, y compris process.exit, au chargement) : il l'invoque comme le fait
 * réellement `npm run check:css-guard`, en injectant un conflit connu sur
 * une ligne compacte dans un des bundles scannés (css/dist/desktop.css),
 * puis en restaurant l'état d'origine dans tous les cas (succès ou échec).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BOUTIQUE_ROOT = path.resolve(__dirname, '..', '..');
const GUARD_SCRIPT = path.join(BOUTIQUE_ROOT, 'scripts', 'css-guard.js');
const TARGET_CSS = path.join(BOUTIQUE_ROOT, 'css', 'dist', 'desktop.css');

const MARKER_SELECTOR = '.p0a-css-guard-compact-line-test';
// Deux règles, sur UNE SEULE LIGNE chacune (style compact), même sélecteur,
// même propriété, valeurs différentes — le cas précis que le parser
// perdait avant le correctif.
const COMPACT_CONFLICT = `\n${MARKER_SELECTOR} { color: red; }\n${MARKER_SELECTOR} { color: blue; }\n`;

function runGuard() {
  try {
    const out = execFileSync('node', [GUARD_SCRIPT], { cwd: BOUTIQUE_ROOT, encoding: 'utf8' });
    return { out, code: 0 };
  } catch (err) {
    // css-guard.js sort en 1 uniquement en mode --strict avec régression ;
    // en mode par défaut (sans --strict, notre cas ici) il sort toujours 0.
    // On capture quand même stdout au cas où un run --strict amont laisse
    // un exit non nul.
    return { out: err.stdout || '', code: err.status };
  }
}

describe('css-guard — détection sur ligne compacte (P0-A #5)', () => {
  let original;

  beforeAll(() => {
    original = fs.readFileSync(TARGET_CSS, 'utf8');
  });

  afterEach(() => {
    // R4/R7 : jamais laisser le dépôt dans un état muté après le test,
    // succès ou échec.
    fs.writeFileSync(TARGET_CSS, original);
  });

  test('un conflit posé sur une ligne compacte est signalé', () => {
    fs.writeFileSync(TARGET_CSS, original + COMPACT_CONFLICT);
    const { out } = runGuard();
    expect(out).toContain(MARKER_SELECTOR);
    expect(out).toContain('color');
  });

  test('test de détection : sans le conflit injecté, le sélecteur de test est absent du rapport', () => {
    // état inchangé (original restauré par afterEach du test précédent)
    const { out } = runGuard();
    expect(out).not.toContain(MARKER_SELECTOR);
  });
});
