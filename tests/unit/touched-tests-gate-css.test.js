'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const gatePath = path.join(__dirname, '../../scripts/touched-tests-gate.js');

function runGate(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-touched-tests-css-'));
  try {
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

describe('touched-tests gate — complétion CSS', () => {
  test('accepte en strict un CSS avec un test correspondant touché sans exiger une couverture Jest', () => {
    const result = runGate([
      'public/boutique/css/modal-product-price-normalization.css',
      'public/boutique/tests/unit/modal-product-price-normalization.test.js',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('test CSS correspondant touché — couverture Jest non applicable');
  });

  test('refuse toujours un CSS sans test correspondant ni justification', () => {
    const result = runGate([
      'public/boutique/css/modal-product-price-normalization.css',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('aucun test touché');
  });

  test('la dérogation de mesure reste limitée au CSS et ne contourne pas une source JS', () => {
    const result = runGate([
      'public/boutique/js/example-runtime.js',
      'public/boutique/tests/unit/example-runtime.test.js',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('couverture non mesurable isolément');
  });
});
