'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FEATURES_DIR = path.join(ROOT, 'features');

const REQUIRED_PROVIDER_PROOF_WORKFLOWS = Object.freeze([
  '.github/workflows/external-provider-contract-batch.yml',
  '.github/workflows/isolated-aliexpress-business-certification.yml',
  '.github/workflows/isolated-cj-billing-history-readonly.yml',
  '.github/workflows/isolated-cj-golden-trigger-purchasing.yml',
  '.github/workflows/isolated-cj-p1-create-readback.yml',
  '.github/workflows/isolated-cj-p2-confirm-pay-sandbox.yml',
  '.github/workflows/isolated-cj-p2-grouped-parent-sandbox.yml',
]);

function featureSources() {
  return fs.readdirSync(FEATURES_DIR)
    .filter(name => name.endsWith('.feature.js'))
    .map(name => ({
      name,
      source: fs.readFileSync(path.join(FEATURES_DIR, name), 'utf8'),
    }));
}

describe('provider proof workflow ownership', () => {
  test.each(REQUIRED_PROVIDER_PROOF_WORKFLOWS)('%s existe et possède exactement un owner feature', workflow => {
    expect(fs.existsSync(path.join(ROOT, workflow))).toBe(true);

    const owners = featureSources()
      .filter(feature => feature.source.includes(`'${workflow}'`))
      .map(feature => feature.name);

    expect(owners).toEqual(['external-provider-contracts.feature.js']);
  });

  test('le feature registry traite workflows comme un groupe backend audité', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'scripts', 'feature-registry-check.js'),
      'utf8'
    );
    expect(source).toContain("'workflows'");
  });

  test('le manifest external-provider-contracts garde explicitement la collection workflows', () => {
    const source = fs.readFileSync(
      path.join(FEATURES_DIR, 'external-provider-contracts.feature.js'),
      'utf8'
    );
    expect(source).toContain('workflows: [');
    REQUIRED_PROVIDER_PROOF_WORKFLOWS.forEach(workflow => {
      expect(source).toContain(`'${workflow}'`);
    });
  });
});
