#!/usr/bin/env node
/*
 * @komerce-arch
 * @domain platform-ops
 * @owner platform-ops
 * @responsibility Lance les checks carte-first ajoutés sur cette branche, avec bootstrap CI par défaut et strict sur demande.
 * @inputs local repository checkout, process.argv
 * @outputs process exit code + diagnostics
 * @depends child_process
 * @used-by manual governance bootstrap, future npm run map:check
 * @db-read none
 * @db-write none
 * @db-txn none
 * @doctrine docs/INDEX.md, AGENTS.md
 * @impact-areas documentation-governance, feature-governance, ci-gates
 */
'use strict';

const { spawnSync } = require('child_process');

const strict = process.argv.includes('--strict');
const featureCardArgs = ['scripts/feature-card-schema-check.js'];
if (strict) featureCardArgs.push('--strict');

const STEPS = [
  ['node', featureCardArgs],
  ['node', ['scripts/docs-history-lint.js']],
  ['node', ['scripts/touched-files-feature-gate.js']],
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
