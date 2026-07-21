'use strict';

/**
 * code-quality-gate-core.js — logique partagée du gate N2 « léger »
 * (boutique / dashboards / public), utilisée par les 3 wrappers :
 *   public/boutique/scripts/code-quality-gate.js
 *   public/dashboards/scripts/code-quality-gate.js
 *   public/scripts/code-quality-gate.js
 *
 * Ces 3 emplacements scannaient un code strictement identique (seul `ROOT`
 * changeait, calculé en relatif à `__dirname`) — dédupliqué ici pour qu'un
 * futur correctif (ex. le fix N2-STRICT directive-prologue) ne puisse plus
 * être appliqué à un seul endroit et oublié ailleurs.
 *
 * Vérifie :
 *   N2-STRICT  : 'use strict' en première ligne effective
 *   N2-NO-VAR  : pas de var (const/let uniquement)
 *
 * Ne fait AUCUNE hypothèse sur son emplacement : tout est paramétré via
 * l'option `root` passée par le wrapper appelant.
 */

const fs = require('fs');
const path = require('path');

const SCAN_DIRS = ['js', 'scripts'];
const IGNORE = ['js/dist', 'js/chunks', 'node_modules', 'playwright-report'];

function scan(root) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    walk(abs, dir, files);
  }
  return files;
}

function walk(abs, rel, result) {
  for (const entry of fs.readdirSync(abs)) {
    const full = path.join(abs, entry);
    const relPath = path.join(rel, entry);
    if (IGNORE.some(ig => relPath.replace(/\\/g, '/').includes(ig))) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, relPath, result);
    else if (entry.endsWith('.js')) result.push({ abs: full, rel: relPath });
  }
}

// Trouve l'index de la « première ligne effective » : après un éventuel
// shebang, après tout bloc de commentaires (/* ... */, y compris JSDoc, quelle
// que soit sa longueur) et les lignes // ou vides. Utilisée à la fois par la
// détection et par --fix, pour que les deux ne puissent jamais diverger.
function findFirstEffectiveLineIndex(lines) {
  let i = 0;
  if (lines[0] && lines[0].startsWith('#!')) i = 1;
  let inBlock = false;
  while (i < lines.length) {
    const l = lines[i].trim();
    if (inBlock) {
      if (l.includes('*/')) inBlock = false;
      i++;
      continue;
    }
    if (l.startsWith('/**') || l.startsWith('/*')) {
      if (!l.includes('*/')) inBlock = true;
      i++;
      continue;
    }
    if (l.startsWith('//') || l === '') { i++; continue; }
    break;
  }
  return i;
}

// Pure, sans I/O : à partir du contenu d'un fichier, dit si la directive
// 'use strict'; est bien sur la première ligne effective, et donne l'index
// où l'insérer si ce n'est pas le cas. Testable directement sur des chaînes.
function hasStrictDirective(content) {
  const lines = content.split('\n');
  const idx = findFirstEffectiveLineIndex(lines);
  const firstEffectiveLine = (lines[idx] || '').trim();
  const ok = /^(['"])use strict\1;?$/.test(firstEffectiveLine);
  return { ok, insertAt: idx };
}

function checkFile(file, { fix }) {
  const content = fs.readFileSync(file.abs, 'utf8');
  const lines = content.split('\n');
  const errors = [];

  // N2-STRICT — directive réelle sur la première ligne effective, pas une
  // recherche de sous-chaîne n'importe où dans le fichier (ancien bug : un
  // header JSDoc long donnait un faux négatif, et une simple mention en
  // commentaire donnait un faux positif).
  const { ok: hasStrict, insertAt: idx } = hasStrictDirective(content);
  if (!hasStrict) {
    if (fix) {
      lines.splice(idx, 0, "'use strict';", '');
      fs.writeFileSync(file.abs, lines.join('\n'));
      return errors; // Fixed, no error
    }
    errors.push({ line: idx + 1, rule: 'N2-STRICT', msg: "Ajouter 'use strict'; en première ligne effective" });
  }

  // N2-NO-VAR
  for (let i = 0; i < lines.length; i++) {
    if (/\bvar\s+/.test(lines[i]) && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
      const snippet = lines[i].trim().slice(0, 40);
      errors.push({ line: i + 1, rule: 'N2-NO-VAR', msg: `var→const ou let : "${snippet}"` });
    }
  }

  return errors;
}

/**
 * Point d'entrée appelé par chaque wrapper.
 * @param {object} opts
 * @param {string} opts.root   Racine à scanner (ex. path.join(__dirname, '..'))
 * @param {string} opts.label  Nom affiché dans l'en-tête du rapport (ex. "BOUTIQUE")
 * @param {string[]} [opts.argv]  Args CLI (défaut : process.argv)
 */
function run({ root, label, argv = process.argv }) {
  const STRICT = argv.includes('--strict');
  const FIX = argv.includes('--fix');

  const files = scan(root);
  let totalErrors = 0;
  let strictErrors = 0;
  let noVarErrors = 0;
  let filesInViolation = 0;

  console.log();
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log(`║  KOMERCE ${label} — Code Quality Gate (N2)`.padEnd(61) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  for (const file of files) {
    const errors = checkFile(file, { fix: FIX });
    if (errors.length === 0) continue;
    filesInViolation++;
    console.log(`❌ ${file.rel}`);
    for (const e of errors) {
      totalErrors++;
      if (e.rule === 'N2-STRICT') strictErrors++;
      if (e.rule === 'N2-NO-VAR') noVarErrors++;
      console.log(`     ❌ L${e.line}: [${e.rule}] ${e.msg}`);
    }
  }

  console.log();
  console.log(`Fichiers analysés  : ${files.length}`);
  console.log(`Fichiers en cause  : ${filesInViolation}`);
  console.log(`Erreurs (bloquant) : ${totalErrors}`);

  if (FIX && totalErrors === 0) {
    console.log('\n✅ Auto-fix appliqué — relancer sans --fix pour vérifier.');
  }

  if (totalErrors > 0) {
    console.log('\n❌ Violations bloquantes détectées.');
    if (strictErrors > 0) {
      console.log(`   ${strictErrors} violation(s) [N2-STRICT] — correctif auto : node scripts/code-quality-gate.js --fix`);
    }
    if (noVarErrors > 0) {
      console.log(`   ${noVarErrors} violation(s) [N2-NO-VAR] — PAS de correctif auto (risque de casser des scopes de boucle/closure) : conversion var→let/const à faire à la main.`);
    }
    if (STRICT) process.exitCode = 1;
  } else {
    console.log('\n✅ Code propre — aucune violation.');
  }

  return { totalErrors, strictErrors, noVarErrors, filesScanned: files.length };
}

module.exports = {
  findFirstEffectiveLineIndex,
  hasStrictDirective,
  checkFile,
  scan,
  run,
};
