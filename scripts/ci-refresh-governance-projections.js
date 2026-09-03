#!/usr/bin/env node
'use strict';

/**
 * CI preflight — hydrate les projections de gouvernance dérivées avant les gates.
 *
 * Doctrine : les sources canoniques sont bloquantes ; les projections générées
 * ne doivent jamais rendre une PR rouge uniquement parce qu'elles n'ont pas été
 * régénérées/commitées manuellement.
 *
 * Ce script écrit uniquement les artefacts dérivés connus. Le workflow restaure
 * ensuite ces fichiers avant `git diff --exit-code`, de sorte que toute mutation
 * hors projection reste détectée.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const commands = [
  ['node', ['scripts/business-graph-gen.js', '--dash-root', 'public', '--boutique-root', 'public/boutique']],
  ['node', ['scripts/gen-feature-360.js']],
  ['node', ['scripts/gen-agent-remediation-index.js']],
];

for (const [cmd, args] of commands) {
  const label = [cmd, ...args].join(' ');
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`✖ Governance projection preflight failed: ${label}`);
    process.exit(result.status || 1);
  }
}

console.log('\n✔ Governance projections hydrated from canonical sources.');
