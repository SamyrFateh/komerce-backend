#!/usr/bin/env node
'use strict';

/**
 * check-no-market-id-mutation.js — freeze §DATABASE : "règle Joi jamais
 * market_id en update".
 *
 * market_id est résolu SERVEUR uniquement (requireMarketScope, freeze §3).
 * Aucun schéma Joi ne doit jamais accepter market_id comme un champ écrit
 * par le client (mutable, requis, optionnel...) — il doit être absent, ou
 * explicitement .forbidden().
 *
 * Ce gate est un scan statique de texte, volontairement simple : il cherche
 * une déclaration `market_id:` dans un fichier validators/*.js et vérifie
 * que la même ligne (ou la continuation immédiate) porte `.forbidden()`.
 * Il ne remplace pas une revue de code — il attrape l'oubli mécanique.
 *
 * Usage : node scripts/check-no-market-id-mutation.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VALIDATORS_DIR = path.join(ROOT, 'validators');

function listValidatorFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(dir, f));
}

const violations = [];

for (const file of listValidatorFiles(VALIDATORS_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, i) => {
    const m = line.match(/\bmarket_id\s*:\s*(.+?)(?:,\s*)?$/);
    if (!m) return;

    // Ignore la déclaration de la primitive partagée elle-même
    // (const forbidMarketId = Joi.forbidden()...).
    if (/^const\s/.test(line.trim())) return;

    const rhs = m[1];
    if (!/forbidden\s*\(\s*\)/.test(rhs) && !/forbidMarketId\b/.test(rhs)) {
      violations.push({
        file: path.relative(ROOT, file),
        lineNumber: i + 1,
        line: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error('\x1b[31m\x1b[1m✖ market_id détecté comme champ potentiellement mutable :\x1b[0m');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.lineNumber}  ${v.line}`);
  }
  console.error('\x1b[2m  Utilise forbidMarketId (validators/index.js) ou Joi.forbidden() explicitement.\x1b[0m');
  process.exit(1);
}

console.log('\x1b[32m\x1b[1m✔ Aucun schéma Joi n\'accepte market_id comme champ mutable.\x1b[0m');
process.exit(0);
