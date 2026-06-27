#!/usr/bin/env node
/*
 * @komerce-arch
 * @domain platform-ops
 * @owner platform-ops
 * @responsibility Agrège les gates qui prouvent que la carte applicative reste reconstructible.
 * @inputs package scripts, feature cards, generated checks
 * @outputs process exit code + grouped diagnostics
 * @depends child_process
 * @used-by npm run map:check, CI governance
 * @db-read none
 * @db-write none
 * @db-txn none
 * @doctrine docs/INDEX.md, AGENTS.md
 * @impact-areas documentation-governance, feature-governance, ci-gates
 */
'use strict';

const { spawnSync } = require('child_process');

const STEPS = [
  ['npm', ['run', 'feature:registry']],
  ['npm', ['run', 'carte-first:check']],
  ['npm', ['run', 'feature:check']],
  ['npm', ['run', 'arch:gate']],
  ['npm', ['run', 'dashboards:360:check']],
  ['npm', ['run', 'boutique:360:check']],
  ['npm', ['run', 'security:360:check']],
  ['npm', ['run', 'meta:graph:check']],
];

function runStep(command, args) {
  const label = [command, ...args].join(' ');
  console.log(`\n── ${label} ──`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`❌ ${label}: ${result.error.message}`);
    return false;
  }

  if (result.status !== 0) {
    console.error(`❌ ${label}: exit ${result.status}`);
    return false;
  }

  return true;
}

function main() {
  const failed = [];

  for (const [command, args] of STEPS) {
    if (!runStep(command, args)) failed.push([command, ...args].join(' '));
  }

  if (failed.length > 0) {
    console.error('\n❌ map:check échoué. Gates en échec :');
    for (const item of failed) console.error(` - ${item}`);
    process.exit(1);
  }

  console.log('\n✅ map:check: big map reconstructible par les cartes + générateurs disponibles.');
}

main();
