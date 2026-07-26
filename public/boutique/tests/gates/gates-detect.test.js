'use strict';
/**
 * P2 — Tests de détection des gates boutique.
 *
 * Protocole par gate :
 *   1. état initial    → exit 0
 *   2. injecter une violation minimale et connue dans une COPIE temporaire
 *   3. relancer le gate sur cette copie → exit 1 ET le message pointe la violation
 *   4. vérifier que le message désigne la BONNE violation (pas un exit 1 générique)
 *
 * Les gates opèrent sur le FS réel ; on travaille toujours sur des fichiers
 * temporaires (fs.writeFileSync dans tmp) et on restaure via afterEach.
 *
 * gabarit de référence : scripts/check-sticky-integrity.js (prouvé en session audit)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function run(cmd, args = [], env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runGate(script, extraArgs = []) {
  return run('node', [path.join(ROOT, 'scripts', script), ...extraArgs]);
}

// Sauvegarde/restauration d'un fichier source
const saves = new Map();
function backup(f)  { if (!saves.has(f)) saves.set(f, fs.readFileSync(f, 'utf8')); }
function restore(f) { if (saves.has(f)) { fs.writeFileSync(f, saves.get(f)); saves.delete(f); } }

afterEach(() => {
  for (const [f] of saves) restore(f);
  saves.clear();
});

// ══════════════════════════════════════════════════════════════════════
// 1. check:important — !important hors allowlist
// ══════════════════════════════════════════════════════════════════════
describe('gate check:important', () => {
  const TARGET = path.join(ROOT, 'css', 'tokens.css');

  test('état initial → exit 0', () => {
    const r = runGate('check-important.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('!important injecté → exit 1 + message ciblé', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n/* R2 */ .k-test-detect { color: red !important; }\n');
    const r = runGate('check-important.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/!important|important/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. check:breakpoints — breakpoint hors doctrine
// ══════════════════════════════════════════════════════════════════════
describe('gate check:breakpoints', () => {
  const TARGET = path.join(ROOT, 'css', 'hero.css');

  test('état initial → exit 0', () => {
    const r = runGate('check-breakpoints.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('@media 768px injecté → exit 1 + message ciblé', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n/* R2 */ @media (min-width: 768px) { .k-detect-r2 { color: red; } }\n');
    const r = runGate('check-breakpoints.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/768|REGRESSION|violation/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. check:no-injection — createElement('style') dans un JS
// ══════════════════════════════════════════════════════════════════════
// Ce gate vérifie les injections CSS dans le JS (pas les attributs style= HTML).
// Doctrine §1 : « Le CSS vit dans les .css. Jamais dans le JS. »
describe('gate check:no-injection', () => {
  const TARGET = path.join(ROOT, 'js', 'anti-fouc.js');

  test('état initial → exit 0', () => {
    const r = runGate('check-no-css-injection.js');
    expect(r.code).toBe(0);
  });

  test("createElement('style') injecté dans anti-fouc.js → exit 1", () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(TARGET, src + "\ndocument.createElement('style');\n");
    const r = runGate('check-no-css-injection.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/createElement|injection|style/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. check:body-classes — classe non déclarée sur <body>
// ══════════════════════════════════════════════════════════════════════
describe('gate check:body-classes', () => {
  test('état initial → exit 0', () => {
    const r = runGate('check-body-classes.js');
    expect(r.code).toBe(0);
  });

  // Ce gate scanne les classes JS qui ajoutent sur body — pas trivial à tester
  // sans modifier un fichier JS. On vérifie au moins qu'il passe l'état nominal.
  // La détection complète est dans audit:ownership.
  test('exit 0 signifie que le gate peut s\'exécuter sans erreur fatale', () => {
    const r = runGate('check-body-classes.js');
    expect(typeof r.code).toBe('number');
    expect(r.stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. check:css-dist-only — <link> CSS hors css/dist/
// ══════════════════════════════════════════════════════════════════════
describe('gate check:css-dist-only', () => {
  const TARGET = path.join(ROOT, 'index.html');

  test('état initial → exit 0', () => {
    const r = runGate('check-css-dist-only.js');
    expect(r.code).toBe(0);
  });

  test('<link> vers CSS hors dist/ → exit 1', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(TARGET, src.replace(
      '<head>',
      '<head>\n<link rel="stylesheet" href="/boutique/css/tokens.css">'
    ));
    const r = runGate('check-css-dist-only.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/tokens\.css|hors dist|dist-only/i);
  });
});


// Rebuild le bundle CSS après chaque test qui modifie des sources CSS
// (sinon le bundle pollué impacte les tests suivants)
afterEach(() => {
  const { spawnSync } = require('child_process');
  const path = require('path');
  spawnSync('node', [path.join(ROOT, 'scripts', 'deploy-css.js')],
    { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
});
// ══════════════════════════════════════════════════════════════════════
// 6. check:css-guard — conflit de cascade (parser corrigé)
// ══════════════════════════════════════════════════════════════════════
describe('gate check:css-guard', () => {
  const TARGET = path.join(ROOT, 'css', 'modal-media.css');

  test('état initial → exit 0 (pas de régression)', () => {
    const r = runGate('css-guard.js', ['--strict']);
    // Le gate est en mode baseline — il ne doit pas régresser
    expect(r.code).toBe(0);
  });

  test('conflit align-self injecté → exit 1 + selècteur nommé', () => {
    backup(TARGET);
    // Réinjecter exactement le conflit qui causait le bug sticky
    fs.appendFileSync(TARGET, `
@media (min-width: 900px) {
  #k-modal .k-modal-product-zone .k-modal-img-wrap { align-self: center; margin: auto; }
}
`);
    // rebuild bundle pour que le guard voie le changement
    spawnSync('node', [path.join(ROOT, 'scripts', 'deploy-css.js')],
      { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    const r = runGate('css-guard.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/k-modal-img-wrap|align-self|conflit/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 7. check:sticky — gabarit de référence (déjà prouvé)
// ══════════════════════════════════════════════════════════════════════
describe('gate check:sticky (gabarit)', () => {
  const TARGET = path.join(ROOT, 'css', 'modal-media.css');

  test('état initial → exit 0', () => {
    const r = runGate('check-sticky-integrity.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('align-self:center + margin:auto injectés → exit 1 + deux déclarations nommées', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, `
@media (min-width: 900px) {
  #k-modal .k-modal-product-zone .k-modal-img-wrap { align-self: center; margin: auto; }
}
`);
    spawnSync('node', [path.join(ROOT, 'scripts', 'deploy-css.js')],
      { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
    const r = runGate('check-sticky-integrity.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/align-self|margin/i);
    expect(r.stdout + r.stderr).toMatch(/k-modal-img-wrap/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 8. check:html — balise non fermée
// ══════════════════════════════════════════════════════════════════════
describe('gate check:html', () => {
  const TARGET = path.join(ROOT, 'index.html');

  test('état initial → exit 0', () => {
    const r = runGate('check-html-balance.js');
    expect(r.code).toBe(0);
  });

  test('<div> non fermée dans index.html → exit 1', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(TARGET, src + '\n<div class="k-r2-unclosed-detect">\n');
    const r = runGate('check-html-balance.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/non ferm|unclos|balance|div/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 9. quality:gate — var dans un fichier JS
// ══════════════════════════════════════════════════════════════════════
describe('gate quality:gate', () => {
  const TARGET = path.join(ROOT, 'js', 'anti-fouc.js');

  test('état initial → exit 0', () => {
    const r = runGate('code-quality-gate.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('var injecté dans anti-fouc.js → exit 1 + N2-NO-VAR', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(TARGET, src + '\nvar k_r2_detect = 1;\n');
    const r = runGate('code-quality-gate.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/N2-NO-VAR|var/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 10. audit:registry — champ obligatoire manquant dans un manifeste
// ══════════════════════════════════════════════════════════════════════
describe('gate audit:registry', () => {
  const TARGET = path.join(ROOT, 'features', 'wallet.feature.js');

  test('état initial → exit 0', () => {
    const r = runGate('feature-registry-check.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('champ name retiré du manifeste → exit 1', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    // Commenter la ligne name:
    fs.writeFileSync(TARGET, src.replace(/^\s*name\s*:/m, '  // name:'));
    const r = runGate('feature-registry-check.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/name|manquant|missing|required/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 11. audit:arch — hex non tokenisé dans un CSS
// ══════════════════════════════════════════════════════════════════════
describe('gate audit:arch (hex hors tokens)', () => {
  const TARGET = path.join(ROOT, 'css', 'hero.css');

  test('état initial → exit 0', () => {
    const r = runGate('audit-boutique-arch.js');
    expect(r.code).toBe(0);
  });

  test('hex #abcdef injecté dans hero.css → exit 1 + I-3', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n.k-r2-detect { color: #abcdef; }\n');
    const r = runGate('audit-boutique-arch.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/I-3|hex|#abcdef|hors tokens/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 12. check:imports — import vers module inexistant
// ══════════════════════════════════════════════════════════════════════
describe('gate check:imports', () => {
  const TARGET = path.join(ROOT, 'js', 'anti-fouc.js');

  test('état initial → exit 0', () => {
    const r = runGate('check-js-imports.js');
    expect(r.code).toBe(0);
  });

  test('import vers fichier inexistant → exit 1', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(TARGET, "import { x } from './inexistant-r2-detect.js';\n" + src);
    const r = runGate('check-js-imports.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/inexistant|not found|import|r2-detect/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 13. audit:modal-layout — hauteur fixe px sur une zone de flux
// ══════════════════════════════════════════════════════════════════════
describe('gate audit:modal-layout', () => {
  const TARGET = path.join(ROOT, 'css', 'modal-media.css');

  test('état initial → exit 0', () => {
    const r = runGate('audit-modal-layout.js');
    expect(r.code).toBe(0);
  });

  test('height fixe px sur zone de flux → exit 1 + zone ciblée', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n/* R2 */ .k-modal-scroll { height: 320px; }\n');
    const r = runGate('audit-modal-layout.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/k-modal-scroll/);
    expect(r.stdout + r.stderr).toMatch(/height:320px|320px/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 14. audit:modal-ownership — écrivain non déclaré sur une zone
// ══════════════════════════════════════════════════════════════════════
describe('gate audit:modal-ownership', () => {
  // k-modal-name : owner unique déclaré = b-modal-product-fields.js, allow: []
  const TARGET = path.join(ROOT, 'js', 'b-modal-suggestions.js');

  test('état initial → exit 0', () => {
    const r = runGate('audit-modal-ownership.js');
    expect(r.code).toBe(0);
  });

  test('écrivain non déclaré sur k-modal-name → exit 1 + zone ciblée', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(
      TARGET,
      "document.getElementById('k-modal-name').textContent = 'R2-detect';\n" + src
    );
    const r = runGate('audit-modal-ownership.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/k-modal-name/);
    expect(r.stdout + r.stderr).toMatch(/b-modal-suggestions\.js/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 15. check:group-wording — libellé interdit réintroduit
// ══════════════════════════════════════════════════════════════════════
describe('gate check:group-wording', () => {
  const TARGET = path.join(ROOT, 'js', 'anti-fouc.js');

  test('état initial → exit 0', () => {
    const r = runGate('check-group-wording.js');
    expect(r.code).toBe(0);
  });

  test('libellé interdit injecté → exit 1 + libellé ciblé', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, "\n// R2 detect: 'Enregistrer ma participation'\n");
    const r = runGate('check-group-wording.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/Enregistrer ma participation/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 16. check:assets — nouvelle référence d'asset manquant sur disque
// ══════════════════════════════════════════════════════════════════════
describe('gate check:assets', () => {
  const TARGET = path.join(ROOT, 'index.html');

  test('état initial → exit 0 (baseline gelée, 0 nouvelle régression)', () => {
    const r = runGate('check-assets.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('nouvelle référence manquante hors baseline → exit 1 + asset ciblé', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(TARGET, src + '\n<!-- R2 --><img src="/images/r2-detect-missing.png">\n');
    const r = runGate('check-assets.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/r2-detect-missing\.png/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 17. feature:guard:strict — fichier déclaré absent du disque
//     (gate boutique : public/boutique/scripts/feature-guard.js — distinct
//      du gate backend homonyme scripts/feature-guard.js à la racine repo ;
//      check:all du package.json boutique appelle bien le premier)
// ══════════════════════════════════════════════════════════════════════
describe('gate feature:guard:strict', () => {
  const TARGET = path.join(ROOT, 'features', 'modal-product.feature.js');

  test('état initial → exit 0', () => {
    const r = runGate('feature-guard.js', ['--strict', '--feature', 'modal-product']);
    expect(r.code).toBe(0);
  });

  test("fichier déclaré absent du disque → exit 1 + chemin ciblé", () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    const injected = src.replace(
      "'../js/view-models/modal-selection-model.js',",
      "'../js/view-models/modal-selection-model.js',\n      '../js/view-models/r2-detect-inexistant.js',"
    );
    expect(injected).not.toBe(src); // garde-fou : l'ancrage doit avoir matché
    fs.writeFileSync(TARGET, injected);
    const r = runGate('feature-guard.js', ['--strict', '--feature', 'modal-product']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/r2-detect-inexistant\.js/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 18. check:cache — dist périmé vs sources (deploy-css.js --dry)
//     Lit css/dist/*.css comme check:css-guard et check:sticky (blocs 6-7,
//     plus haut dans ce fichier) : on rebuild explicitement AVANT l'état
//     initial pour ne pas hériter d'un dist resté sale d'un bloc précédent
//     (même risque que documenté par la session P2 précédente).
// ══════════════════════════════════════════════════════════════════════
describe('gate check:cache', () => {
  const TARGET = path.join(ROOT, 'css', 'modal-media.css');

  function rebuild() {
    spawnSync('node', [path.join(ROOT, 'scripts', 'deploy-css.js')],
      { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
  }

  test('état initial → exit 0 (dist synchronisé avec les sources)', () => {
    rebuild(); // neutralise un dist sale hérité des blocs css-guard/sticky précédents
    const r = runGate('deploy-css.js', ['--dry']);
    expect(r.code).toBe(0);
  });

  test('source modifiée sans rebuild → dist périmé → exit 1', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n/* R2 */ .k-r2-detect-cache { color: red; }\n');
    // volontairement PAS de rebuild ici : --dry doit détecter l'écart
    const r = runGate('deploy-css.js', ['--dry']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/périmé|components\.css|bundle/i);
    // restaure et re-synchronise tout de suite (au lieu de compter sur l'afterEach
    // global, qui ne touche que la source, jamais le dist généré)
    restore(TARGET);
    rebuild();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 19. check:css-specificity-guard — override silencieux via classe globale
// ══════════════════════════════════════════════════════════════════════
describe('gate check:css-specificity-guard', () => {
  const TARGET = path.join(ROOT, 'css', 'modal-media.css');

  function rebuild() {
    spawnSync('node', [path.join(ROOT, 'scripts', 'deploy-css.js')],
      { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
  }

  test('état initial → exit 0 (pas de hausse hors baseline)', () => {
    rebuild();
    const r = runGate('css-specificity-guard.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('nouvel override via classe globale connue (k-home-premium-v1) → exit 1', () => {
    backup(TARGET);
    // .k-home-premium-v1 est une classe globale déjà posée sur <html> ailleurs
    // dans le code (détectée par discoverGlobalClasses) — on réutilise ce vrai
    // signal plutôt que d'en inventer un nouveau, pour rester dans le périmètre
    // exact que le gate surveille.
    fs.appendFileSync(TARGET, `
/* R2 */
.k-r2-detect-target {
  color: blue;
}
html.k-home-premium-v1 .k-r2-detect-target {
  color: red;
}
`);
    rebuild();
    const r = runGate('css-specificity-guard.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/k-r2-detect-target/);
    expect(r.stdout + r.stderr).toMatch(/k-home-premium-v1/);
    restore(TARGET);
    rebuild();
  });
});

// ══════════════════════════════════════════════════════════════════════
// 20. check:css-vars — var(--x) sans fallback, jamais défini
// ══════════════════════════════════════════════════════════════════════
describe('gate check:css-vars', () => {
  const TARGET = path.join(ROOT, 'css', 'hero.css');

  test('état initial → exit 0', () => {
    const r = runGate('check-css-vars.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test('var(--x) orpheline sans fallback → exit 1 + nom ciblé', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n.k-r2-detect { color: var(--k-r2-detect-orphan); }\n');
    const r = runGate('check-css-vars.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/--k-r2-detect-orphan/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 21. check:zindex — couche hors bornes déclarées (governance/zindex-contract.json)
// ══════════════════════════════════════════════════════════════════════
describe('gate check:zindex', () => {
  const TARGET = path.join(ROOT, 'css', 'layout.css');

  test('état initial → exit 0', () => {
    const r = runGate('check-zindex-contract.js', ['--strict']);
    expect(r.code).toBe(0);
  });

  test("z-index de '.k-bnav' hors bornes [80,100] → exit 1 + couche ciblée", () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n.k-bnav { z-index: 9999; }\n');
    const r = runGate('check-zindex-contract.js', ['--strict']);
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/chrome-bottom/);
    expect(r.stdout + r.stderr).toMatch(/9999/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 22. check:keyframes — animation référencée sans @keyframes correspondant
// ══════════════════════════════════════════════════════════════════════
describe('gate check:keyframes', () => {
  const TARGET = path.join(ROOT, 'css', 'hero.css');

  test('état initial → exit 0', () => {
    const r = runGate('check-keyframes.js');
    expect(r.code).toBe(0);
  });

  test('animation sans @keyframes correspondant → exit 1 + nom ciblé', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n.k-r2-detect { animation: k-r2-detect-missing-anim 1s ease; }\n');
    const r = runGate('check-keyframes.js');
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/k-r2-detect-missing-anim/);
    restore(TARGET);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 23. check:inline-scripts — script inline mort sous la CSP en vigueur
//     Câblé SANS --strict dans check:visual-lock/check:all : 2 scripts morts
//     déjà connus et volontairement acceptés (Classe C, P0-D — cf. LEDGER.md,
//     "location.reload() mort = actuellement protecteur"). L'état initial
//     réel est donc exit 0 même avec ces 2 violations connues ; le test
//     vérifie que le gate continue de NOMMER toute violation nouvelle dans
//     son rapport (le vrai rôle utile du gate ici), pas un changement de
//     code de sortie.
// ══════════════════════════════════════════════════════════════════════
describe('gate check:inline-scripts', () => {
  const TARGET = path.join(ROOT, '..', 'hub', 'index.html');

  test('état initial → exit 0 (invocation réelle, sans --strict)', () => {
    const r = runGate('check-inline-scripts.js');
    expect(r.code).toBe(0);
  });

  test('nouveau script inline mort sur une page auparavant propre → nommé dans le rapport', () => {
    backup(TARGET);
    const src = fs.readFileSync(TARGET, 'utf8');
    fs.writeFileSync(TARGET, src.replace('</body>', '<script>window.__r2DetectHubInline = true;</script>\n</body>'));
    const r = runGate('check-inline-scripts.js', ['--strict']);
    expect(r.stdout + r.stderr).toMatch(/hub[\\/]index\.html/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 24. audit:arch:live — génération docs/BOUTIQUE_ARCHITECTURE_LIVE.md
//     Générateur pur (pas de --strict, ne bloque jamais volontairement) :
//     le test vérifie sa capacité RÉELLE de détection — un fichier CSS
//     orphelin (non référencé par bundle-css.js) doit apparaître marqué
//     🔴 ORPHELIN dans le document généré.
// ══════════════════════════════════════════════════════════════════════
describe('gate audit:arch:live', () => {
  const TARGET = path.join(ROOT, 'css', 'k-r2-detect-orphan.css');
  const OUT    = path.join(ROOT, 'docs', 'BOUTIQUE_ARCHITECTURE_LIVE.md');

  test('état initial → exit 0, document généré', () => {
    const r = runGate('gen-boutique-arch-live.js');
    expect(r.code).toBe(0);
    expect(fs.existsSync(OUT)).toBe(true);
  });

  test('nouveau fichier CSS hors bundle → marqué ORPHELIN dans le document généré', () => {
    fs.writeFileSync(TARGET, '.k-r2-detect-orphan { color: red; }\n');
    const r = runGate('gen-boutique-arch-live.js');
    expect(r.code).toBe(0);
    const doc = fs.readFileSync(OUT, 'utf8');
    expect(doc).toMatch(/k-r2-detect-orphan\.css.*ORPHELIN/);
    fs.unlinkSync(TARGET);
    runGate('gen-boutique-arch-live.js'); // régénère le document sans le fichier temporaire
  });
});

// ══════════════════════════════════════════════════════════════════════
// 25. audit:ownership — génération docs/BOUTIQUE_OWNERSHIP_LIVE.md
//     Générateur pur, même famille que audit:arch:live : le test vérifie
//     qu'un breakpoint hors charte (ni 900px ni 1200px) injecté dans une
//     feuille CSS est bien signalé 🔴 pour ce fichier précis.
// ══════════════════════════════════════════════════════════════════════
describe('gate audit:ownership', () => {
  const TARGET = path.join(ROOT, 'css', 'hero.css');
  const OUT    = path.join(ROOT, 'docs', 'BOUTIQUE_OWNERSHIP_LIVE.md');

  test('état initial → exit 0, document généré', () => {
    const r = runGate('gen-ownership.js');
    expect(r.code).toBe(0);
    expect(fs.existsSync(OUT)).toBe(true);
  });

  test('breakpoint hors charte (768px) → signalé 🔴 pour le fichier ciblé', () => {
    backup(TARGET);
    fs.appendFileSync(TARGET, '\n@media (max-width: 768px) { .k-r2-detect { color: red; } }\n');
    const r = runGate('gen-ownership.js');
    expect(r.code).toBe(0);
    const doc = fs.readFileSync(OUT, 'utf8');
    expect(doc).toMatch(/hero\.css.*768px/);
    restore(TARGET);
    runGate('gen-ownership.js'); // régénère le document sans l'injection
  });
});

// ══════════════════════════════════════════════════════════════════════
// audit:gate — NON TESTABLE ISOLÉMENT (même famille que les 5 exceptions
//   documentées lors du premier lot de 12 gates).
//   Dépend de `npm audit` réel sur node_modules installés : l'environnement
//   courant a 0 vulnérabilité high/critical (vérifié 2026-07-26). Injecter
//   une fausse vulnérabilité nécessiterait d'installer un paquet réellement
//   vulnérable — fragile, dépendant du registre à un instant T, et non
//   reproductible dans le temps (la base d'advisories change). La logique
//   de cliquet elle-même (baseline accept/nouveau) est vérifiable par
//   lecture de code, pas par un test d'injection fiable. Documenté dans
//   gates-coverage.js comme exclusion connue plutôt que testé pour de faux.
// ══════════════════════════════════════════════════════════════════════
