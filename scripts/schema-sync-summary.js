'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-summary-sync
 * @domain       infrastructure
 * @layer        tooling
 * @criticality  medium
 * @purpose      Deriver les compteurs de la vue d'ensemble SCHEMA.md depuis le dump Railway commite.
 * @inputs       docs/db/railway-live-schema.sql, docs/SCHEMA.md
 * @outputs      docs/SCHEMA.md summary counts
 * @depends      node:fs, node:path
 * @used-by      scripts/schema-promote-all.js, .github/workflows/schema-refresh.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 * @version      2026-08
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DUMP = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');
const DEFAULT_SCHEMA = path.join(ROOT, 'docs', 'SCHEMA.md');

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function parseDumpCounts(dump) {
  return {
    tables: countMatches(dump, /^CREATE TABLE public\.[^\s(]+/gm),
    views: countMatches(dump, /^CREATE VIEW public\.[^\s(]+/gm),
    enums: countMatches(dump, /^CREATE TYPE public\.[^\s]+ AS ENUM\s*\(/gm),
    indexes: countMatches(dump, /^CREATE (?:UNIQUE )?INDEX [^\n]+/gm),
    foreignKeys: countMatches(dump, /\bFOREIGN KEY\s*\(/g),
    functions: countMatches(dump, /^CREATE FUNCTION public\.[^\s(]+/gm),
    triggers: countMatches(dump, /^CREATE TRIGGER [^\n]+/gm),
  };
}

const SUMMARY_ROWS = [
  ['Tables', 'tables'],
  ['Vues', 'views'],
  ['ENUMs', 'enums'],
  ['Index', 'indexes'],
  ['Foreign keys', 'foreignKeys'],
  ['Fonctions', 'functions'],
  ['Triggers', 'triggers'],
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function syncSummaryText(schemaText, counts) {
  let next = schemaText;
  const changes = [];

  for (const [label, key] of SUMMARY_ROWS) {
    const regex = new RegExp(`(\\| ${escapeRegex(label)} \\| )([0-9]+)( \\|)`);
    const matches = next.match(new RegExp(regex.source, 'g')) || [];
    if (matches.length !== 1) {
      throw new Error(`SCHEMA.md: ligne de synthese '${label}' attendue exactement une fois, trouvee ${matches.length}`);
    }
    const current = Number(next.match(regex)[2]);
    const expected = counts[key];
    if (current !== expected) {
      changes.push({ label, current, expected });
      next = next.replace(regex, `$1${expected}$3`);
    }
  }

  return { text: next, changes };
}

function run({ dumpPath = DEFAULT_DUMP, schemaPath = DEFAULT_SCHEMA, write = false, check = false } = {}) {
  const dump = fs.readFileSync(dumpPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const counts = parseDumpCounts(dump);
  const result = syncSummaryText(schema, counts);

  console.log('============================================================');
  console.log('SCHEMA-SUMMARY — vue d’ensemble derivee du dump Railway');
  console.log(`Tables       : ${counts.tables}`);
  console.log(`Vues         : ${counts.views}`);
  console.log(`ENUMs        : ${counts.enums}`);
  console.log(`Index        : ${counts.indexes}`);
  console.log(`Foreign keys : ${counts.foreignKeys}`);
  console.log(`Fonctions    : ${counts.functions}`);
  console.log(`Triggers     : ${counts.triggers}`);

  if (!result.changes.length) {
    console.log('✅ Vue d’ensemble deja synchronisee.');
    return { ...result, counts };
  }

  for (const change of result.changes) {
    console.log(`   ${change.label}: ${change.current} -> ${change.expected}`);
  }

  if (check) {
    console.error('❌ SCHEMA.md : compteurs de synthese desynchronises du dump live.');
    process.exitCode = 1;
    return { ...result, counts };
  }

  if (write) {
    fs.writeFileSync(schemaPath, result.text);
    console.log('✅ Vue d’ensemble SCHEMA.md synchronisee depuis le dump live.');
  } else {
    console.log('ℹ️  Utiliser --write pour appliquer ou --check pour bloquer.');
  }

  return { ...result, counts };
}

if (require.main === module) {
  run({
    write: process.argv.includes('--write'),
    check: process.argv.includes('--check'),
  });
}

module.exports = { parseDumpCounts, syncSummaryText, run };
