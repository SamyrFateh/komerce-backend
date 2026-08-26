'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

function runGitScript(spec, target) {
  const source = execFileSync('git', ['show', spec], { encoding: 'utf8' });
  fs.writeFileSync(target, source);
  delete require.cache[require.resolve(target)];
  require(target);
}

// Rejoue le core de câblage qui a déjà produit 476 routes / 18 UNKNOWN.
runGitScript(
  '01c704e56676ba776c496203cfc4b8f7d3d63baf:scripts/ci-wire-accounting-4d.js',
  '/tmp/ci-wire-accounting-4d-core.js'
);

// Aligne ensuite les deux témoins de test sur la vérité Canonical actuelle.
runGitScript(
  'origin/ci/canonical-accounting-4d-wire:scripts/ci-fix-accounting-4d-tests.js',
  '/tmp/ci-fix-accounting-4d-tests.js'
);

console.log('LOT 4D core wiring + witness fixes applied');
