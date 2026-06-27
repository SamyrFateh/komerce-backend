#!/usr/bin/env node
/*
 * @komerce-arch
 * @domain platform-ops
 * @owner platform-ops
 * @responsibility Lance les checks carte-first avec bootstrap CI par défaut et strict sur demande.
 * @inputs local repository checkout, process.argv, package.json scripts
 * @outputs process exit code + diagnostics
 * @depends child_process
 * @used-by npm run carte-first:check, npm run map:check
 * @db-read none
 * @db-write none
 * @db-txn none
 * @doctrine docs/INDEX.md, AGENTS.md
 * @impact-areas documentation-governance, feature-governance, ci-gates
 */
'use strict';

const { spawnSync } = require('child_process');

const strict = process.argv.includes('--strict');

const STEPS = [
  ['npm', ['run', strict ? 'feature:cards:strict' : 'feature:cards']],
  ['npm', ['run', 'docs:history-lint']],
  ['npm', ['run', 'feature:touched']],
];

function run(command, args) {
  const label = [command, ...args].join(' ');
  console.log(`\n-- ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

let ok = true;
for (const [command, args] of STEPS) {
  if (!run(command, args)) ok = false;
}

if (!ok) process.exit(1);
console.log(`\nOK carte-first ${strict ? 'strict' : 'bootstrap'} checks.`);
