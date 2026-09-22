'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * A PR that only modifies the dedicated external-provider proof collector,
 * its test, documentation, registry or isolated workflow must not wake the
 * expensive runtime suite. Any other file must immediately revoke the shortcut.
 */

const {
  classify,
  isProviderProofOnlyFile,
  isBackendFile,
} = require('../../scripts/pr-enforcement-scope');

const ISOLATED = [
  'scripts/external-provider-batch-proof.js',
  'tests/unit/external-provider-batch-proof.test.js',
  'docs/external-providers/messaging/META_WHATSAPP.md',
  'docs/external-providers/EXTERNAL_PROVIDER_BATCH.md',
  'governance/external-provider-registry.json',
  '.github/workflows/external-provider-contract-batch.yml',
];

describe('strict external-provider proof-only CI scope', () => {
  test('known proof-only paths require targeted gate, keep governance, do not wake backend', () => {
    const m = classify(ISOLATED);
    expect(m.changedFiles).toEqual([...ISOLATED].sort());
    expect(m.providerProofOnly).toBe(true);
    expect(m.backend).toBe(false);
    expect(m.backendFiles).toEqual([]);
    expect(m.governance).toBe(true);
    expect(m.migrations).toBe(false);
    expect(ISOLATED.every(isProviderProofOnlyFile)).toBe(true);
    // Raw predicate is not globally weakened for the test file: exemption
    // applies only to the *entire* pure-tooling PR.
    expect(isBackendFile('tests/unit/external-provider-batch-proof.test.js')).toBe(true);
  });

  test('deletion/rename of a strictly allowlisted path is still seen as a scoped change', () => {
    const m = classify(['tests/unit/external-provider-batch-proof.test.js']);
    expect(m.providerProofOnly).toBe(true);
    expect(m.backend).toBe(false);
  });

  test('unrelated tests, scripts, feature manifests and runtime changes always revoke shortcut', () => {
    const unsafe = [
      'tests/unit/wallet.test.js',
      'tests/integration/order.test.js',
      'scripts/provider-contract-proof.js',
      'scripts/pr-enforcement-scope.js',
      'features/external-provider-contracts.feature.js',
      'services/whatsapp-meta.js',
      'routes/payments.js',
      'migrations/242_any.sql',
      'package.json',
      '.github/workflows/pr-enforcement.yml',
      'governance/feature-guard-test-coverage-exemptions.json',
      'docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md',
      'docs/external-providers/../db/railway-live-schema.sql',
      'docs/external-providers/NOT_A_PROOF.js',
    ];
    for (const file of unsafe) {
      const model = classify([...ISOLATED, file]);
      expect(model.providerProofOnly).toBe(false);
      expect(model.backend).toBe(isBackendFile(file) || isBackendFile(
        'tests/unit/external-provider-batch-proof.test.js'
      ));
    }
  });

  test('mixed runtime+proof PR retains exact backend tests and full governance checks', () => {
    const m = classify([
      'scripts/external-provider-batch-proof.js',
      'tests/unit/external-provider-batch-proof.test.js',
      'services/orders.js',
    ]);
    expect(m.providerProofOnly).toBe(false);
    expect(m.backend).toBe(true);
    expect(m.backendFiles).toEqual([
      'services/orders.js', 'tests/unit/external-provider-batch-proof.test.js',
    ]);
    expect(m.governance).toBe(true);
  });

  test('empty or generic docs PR cannot impersonate provider-only gate', () => {
    expect(classify([]).providerProofOnly).toBe(false);
    expect(classify(['docs/README.md']).providerProofOnly).toBe(false);
  });
});
