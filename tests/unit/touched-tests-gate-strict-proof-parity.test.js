'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Régression : le mode --strict ne doit renforcer QUE la preuve A (test
 * touché → règle de complétion au contact, cf.
 * touched-tests-gate-coverage-thresholds.test.js). Les preuves B (exemption)
 * et C (section ## Tests du body PR) sont de rang égal à la preuve A selon
 * la doctrine documentée en tête de scripts/touched-tests-gate.js — --strict
 * ne doit jamais les transformer en échec.
 *
 * PR #1820 a été bloquée à tort par cette confusion : la justification
 * ## Tests du body PR downgradait bien un FAIL en WARN, mais --strict
 * remontait ensuite ce WARN en échec (exit 1), rendant les preuves B/C
 * inutiles dès que --strict est actif. Ces tests verrouillent le correctif.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const gatePath = path.join(__dirname, '../../scripts/touched-tests-gate.js');

function runGate({ files, prBody = '', exemptions = null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-touched-tests-parity-'));
  try {
    fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'governance', 'coverage-thresholds.json'),
      JSON.stringify({}, null, 2),
    );
    if (exemptions) {
      fs.writeFileSync(
        path.join(root, 'governance', 'test-exemptions.json'),
        JSON.stringify(exemptions, null, 2),
      );
    }

    return cp.spawnSync(process.execPath, [
      gatePath,
      '--root', root,
      '--files', files.join(','),
      '--strict',
    ], {
      encoding: 'utf8',
      env: { ...process.env, PR_BODY: prBody },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('touched-tests gate — parité des preuves A/B/C en --strict', () => {
  test('preuve C seule (## Tests du body PR) suffit en --strict', () => {
    const result = runGate({
      files: ['public/boutique/js/boutique.js'],
      prBody: '## Tests\n\n- suite verte',
    });

    expect(result.stdout).toContain('justifié par section ## Tests du body PR');
    expect(result.status).toBe(0);
  });

  test('preuve B seule (exemption documentée) suffit en --strict', () => {
    const result = runGate({
      files: ['public/boutique/js/boutique.js'],
      exemptions: { 'public/boutique/js/boutique.js': 'raison documentée' },
    });

    expect(result.stdout).toContain('exempté : raison documentée');
    expect(result.status).toBe(0);
  });

  test('sans aucune des trois preuves, --strict échoue toujours', () => {
    const result = runGate({
      files: ['public/boutique/js/boutique.js'],
    });

    expect(result.stdout).toContain('aucun test touché, pas d\'exemption, pas de ## Tests PR');
    expect(result.status).toBe(1);
  });

  test('un vrai échec (proof A incomplète) reste bloquant même avec une preuve C sur un autre fichier', () => {
    const result = runGate({
      files: ['public/boutique/js/boutique.js', 'public/boutique/js/autre-fichier-sans-preuve.js'],
      prBody: '',
    });

    expect(result.status).toBe(1);
  });
});
