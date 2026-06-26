#!/usr/bin/env node
/**
 * code-quality-gate.js — Komerce Boutique Code Quality Gate
 *
 * Scanne les fichiers JS source de la boutique et vérifie :
 *   N2-STRICT  : 'use strict' en première ligne effective
 *   N2-NO-VAR  : pas de var (const/let uniquement)
 *
 * Usage :
 *   node scripts/code-quality-gate.js              rapport
 *   node scripts/code-quality-gate.js --strict      exit 1 si violations
 *   node scripts/code-quality-gate.js --fix         auto-fix use strict
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['js', 'scripts'];
const IGNORE = ['js/dist', 'js/chunks', 'node_modules', 'playwright-report'];
const STRICT = process.argv.includes('--strict');
const FIX = process.argv.includes('--fix');

function scan() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
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

function checkFile(file) {
  const content = fs.readFileSync(file.abs, 'utf8');
  const lines = content.split('\n');
  const errors = [];

  // N2-STRICT
  const hasStrict = content.slice(0, 2000).includes("'use strict'") || content.slice(0, 2000).includes('"use strict"');
  if (!hasStrict) {
    if (FIX) {
      // Insert after header comment block
      let i = 0;
      if (lines[0] && lines[0].startsWith('#!')) i = 1;
      let inBlock = false;
      while (i < lines.length && i < 50) {
        const l = lines[i].trim();
        if (l.startsWith('/**') || l.startsWith('/*')) inBlock = true;
        if (inBlock) { if (l.includes('*/')) { i++; inBlock = false; } else { i++; } continue; }
        if (l.startsWith('//') || l === '') { i++; continue; }
        break;
      }
      lines.splice(i, 0, "'use strict';", '');
      fs.writeFileSync(file.abs, lines.join('\n'));
      return errors; // Fixed, no error
    }
    errors.push({ line: 1, rule: 'N2-STRICT', msg: "Ajouter 'use strict'; en première ligne effective" });
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

// Main
const files = scan();
let totalErrors = 0;
let totalWarnings = 0;
let filesInViolation = 0;

console.log();
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  KOMERCE BOUTIQUE — Code Quality Gate (N2)              ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log();

for (const file of files) {
  const errors = checkFile(file);
  if (errors.length === 0) continue;
  filesInViolation++;
  console.log(`❌ ${file.rel}`);
  for (const e of errors) {
    totalErrors++;
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
  console.log('   Correctif rapide : node scripts/code-quality-gate.js --fix');
  if (STRICT) process.exit(1);
} else {
  console.log('\n✅ Code propre — aucune violation.');
}
