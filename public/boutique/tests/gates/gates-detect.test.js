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
