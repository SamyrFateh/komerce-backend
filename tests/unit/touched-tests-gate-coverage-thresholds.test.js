'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const gatePath = path.join(__dirname, '../../scripts/touched-tests-gate.js');

function runGate({ files, thresholds = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-touched-tests-threshold-'));
  try {
    fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'governance', 'coverage-thresholds.json'),
      JSON.stringify(thresholds, null, 2),
    );

    return cp.spawnSync(process.execPath, [
      gatePath,
      '--root', root,
      '--files', files.join(','),
      '--strict',
    ], {
      encoding: 'utf8',
      env: { ...process.env, PR_BODY: '' },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('touched-tests gate — cliquets de couverture explicites', () => {
  test('n invente jamais un seuil 100/100 pour un fichier sans baseline', () => {
    const result = runGate({
      files: [
        'services/example-runtime.js',
        'tests/unit/example-runtime.test.js',
      ],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('aucun cliquet de couverture explicite');
    expect(result.stdout).not.toContain('100%/100%');
  });

  test('un cliquet explicite reste effectivement enforce', () => {
    const result = runGate({
      files: [
        'services/example-runtime.js',
        'tests/unit/example-runtime.test.js',
      ],
      thresholds: {
        'services/example-runtime.js': { stmts: 80, branch: 70 },
      },
    });

    // Le workspace temporaire ne contient volontairement pas Jest : le gate
    // doit donc tenter la mesure parce qu'un cliquet existe et refuser de
    // valider silencieusement une mesure impossible en mode strict.
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('cliquet configuré');
  });
});
