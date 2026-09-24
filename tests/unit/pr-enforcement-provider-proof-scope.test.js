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

const fs = require('node:fs');
const path = require('node:path');

const {
  classify,
  isProviderProofOnlyFile,
  isCjPilotProofOnlyFile,
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


describe('strict CJ isolated pilot proof-only CI scope', () => {
  const pilot = 'scripts/cj-three-real-staging-pilot.js';
  test('exact isolated pilot file stays under targeted syntax and governance gates', () => {
    const m = classify([pilot]);
    expect(isCjPilotProofOnlyFile(pilot)).toBe(true);
    expect(m.cjPilotProofOnly).toBe(true);
    expect(m.governance).toBe(true);
    expect(m.backend).toBe(false);
    expect(m.migrations).toBe(false);
    expect(m.providerProofOnly).toBe(false);
  });
  test('any additional file revokes exemption, including shared importer, test or CI files', () => {
    for (const file of [
      'services/suppliers/catalog-import-orchestrator.js',
      'tests/unit/cj-connector.test.js',
      'scripts/pr-enforcement-scope.js',
      '.github/workflows/pr-enforcement.yml',
      '.github/workflows/cj-three-real-staging-refinery-pilot.yml',
      'migrations/245_example.sql',
      'docs/README.md',
    ]) {
      expect(classify([pilot, file]).cjPilotProofOnly).toBe(false);
    }
    expect(classify([]).cjPilotProofOnly).toBe(false);
    expect(classify(['scripts/other-proof.js']).cjPilotProofOnly).toBe(false);
  });
  test('mandatory workflow retains the full gates for anything outside the exact pilot scope', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/pr-enforcement.yml'), 'utf8');
    expect(workflow).toContain("if: steps.scope.outputs.cj_pilot_proof_only == 'true'");
    expect(workflow).toContain('node --check scripts/cj-three-real-staging-pilot.js');
    expect(workflow).toContain("needs.changes.outputs.cj_pilot_proof_only != 'true'");
    expect(workflow).toContain("needs.changes.outputs.backend == 'true' || needs.changes.outputs.migrations == 'true'");
  });
});

test('mandatory PR workflow requires focused gate; standalone batch remains manual only', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/pr-enforcement.yml'), 'utf8');
  const batch = fs.readFileSync(
    path.join(__dirname, '../../.github/workflows/external-provider-contract-batch.yml'), 'utf8',
  );
  expect(workflow).toContain("if: needs.changes.outputs.provider_proof_only == 'true'");
  expect(workflow).toContain("needs: [changes, provider_contracts, backend, migrations, from_scratch, dashboard, boutique, governance]");
  expect(workflow).toContain('for result in "$PROVIDER_CONTRACTS_RESULT"');
  expect(workflow).toContain("needs.changes.outputs.provider_proof_only != 'true'");
  expect(workflow).toContain("needs.changes.outputs.backend == 'true' || needs.changes.outputs.migrations == 'true'");
  expect(batch).toContain('  workflow_dispatch:');
  expect(batch).not.toMatch(/^\s{2}pull_request:/m);
});
