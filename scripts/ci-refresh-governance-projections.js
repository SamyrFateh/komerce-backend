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

const COMMANDS = Object.freeze([
  Object.freeze(['node', Object.freeze(['scripts/business-graph-gen.js', '--dash-root', 'public', '--boutique-root', 'public/boutique'])]),
  Object.freeze(['node', Object.freeze(['scripts/gen-feature-360.js'])]),
  Object.freeze(['node', Object.freeze(['scripts/gen-agent-remediation-index.js'])]),
]);

function main() {
  for (const [cmd, args] of COMMANDS) {
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
      return result.status || 1;
    }
  }

  console.log('\n✔ Governance projections hydrated from canonical sources.');
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { COMMANDS, main };
