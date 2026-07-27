#!/usr/bin/env node
'use strict';

/**
 * fix-emoji-mojibake.js — corrige les littéraux emoji corrompus (double
 * encodage UTF-8 → Latin-1/CP1252 → UTF-8) dans b-modal-core.js et
 * b-greeting.js, SANS toucher au reste du fichier (accents français,
 * autres chaînes) qui peuvent être en UTF-8 correct par ailleurs.
 *
 * Contrairement à une passe de "réparation" globale (latin1<->utf8 sur
 * tout le fichier), cette approche cible uniquement les motifs de code
 * connus par leur squelette ASCII fixe (favState ? '...' : '...', etc.)
 * et remplace le littéral entre guillemets, quel que soit le contenu
 * corrompu exact qui s'y trouve — donc robuste même si les octets réels
 * diffèrent un peu de ce qui a été observé dans le terminal.
 *
 * Usage (depuis public/boutique) :
 *   node ../../fix-emoji-mojibake.js          → applique et affiche le diff
 *   node ../../fix-emoji-mojibake.js --dry    → affiche seulement ce qui changerait
 */

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');

const targets = [
  {
    file: 'js/b-modal-core.js',
    fixes: [
      {
        re: /favState \? '.*?' : '.*?'/g,
        to: "favState ? '❤️' : '🤍'",
      },
      {
        re: /isNowFav \? '.*?' : '.*?'/g,
        to: "isNowFav ? '❤️' : '🤍'",
      },
    ],
  },
  {
    file: 'js/b-greeting.js',
    fixes: [
      {
        re: /`Karibu \$\{prenom\}\$\{badge\} .*?`/g,
        to: '`Karibu ${prenom}${badge} 😊`',
      },
      {
        re: /`Karibu\$\{badge\} .*?`/g,
        to: '`Karibu${badge} 😊`',
      },
    ],
  },
];

let anyChange = false;

for (const t of targets) {
  const full = path.join(process.cwd(), t.file);
  if (!fs.existsSync(full)) {
    console.error(`✖ introuvable : ${t.file} (lance ce script depuis public/boutique)`);
    process.exitCode = 1;
    continue;
  }
  let raw = fs.readFileSync(full, 'utf8');
  let changed = 0;
  for (const fx of t.fixes) {
    const matches = raw.match(fx.re) || [];
    for (const m of matches) {
      if (m !== fx.to) {
        console.log(`  ${t.file}`);
        console.log(`    avant : ${JSON.stringify(m)}`);
        console.log(`    après : ${JSON.stringify(fx.to)}`);
        changed++;
      }
    }
    raw = raw.replace(fx.re, fx.to);
  }
  if (changed > 0) {
    anyChange = true;
    if (!DRY) {
      fs.writeFileSync(full, raw, { encoding: 'utf8' });
      console.log(`✔ ${t.file} — ${changed} littéral(aux) corrigé(s), réécrit en UTF-8 (sans BOM).`);
    } else {
      console.log(`(dry-run) ${t.file} — ${changed} littéral(aux) seraient corrigés.`);
    }
  } else {
    console.log(`— ${t.file} : rien à corriger (motifs déjà propres ou absents).`);
  }
}

if (!anyChange) {
  console.log('\nAucun changement. Si les tests échouent toujours, colle-moi les lignes réelles (voir message précédent) — la corruption est peut-être ailleurs.');
}
