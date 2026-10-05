'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const path = require('node:path');
const reconciliation = require('../../scripts/provider-certification-reconciliation');

const ROOT = path.resolve(__dirname, '../..');

test('R1 — le ledger capability-level réel est cohérent et ne sur-certifie pas une capability CLOSED', () => {
  const report = reconciliation.run({ root: ROOT });
  expect(report.summary.total_capabilities).toBeGreaterThanOrEqual(8);
  expect(report.summary.p4).toBeGreaterThanOrEqual(3);
  expect(report.summary.closed).toBeGreaterThanOrEqual(1);

  const allegroAuto = report.rows.find(
    row => row.provider === 'allegro' && row.capability === 'purchasing.auto_order'
  );
  expect(allegroAuto).toMatchObject({
    classification: 'CONFIRMED',
    availability: 'CLOSED',
    highest_proof: 'UNQUALIFIED',
  });

  const aliAuto = report.rows.find(
    row => row.provider === 'aliexpress' && row.capability === 'purchasing.auto_order'
  );
  expect(aliAuto).toMatchObject({
    classification: 'GAP',
    availability: 'RUNTIME_REGISTERED_GUARDED_NOT_LIVE_PROVEN',
    highest_proof: 'P0',
  });

  const aliReadiness = report.rows.find(
    row => row.provider === 'aliexpress' && row.capability === 'purchasing.readiness'
  );
  expect(aliReadiness).toMatchObject({
    classification: 'GAP',
    highest_proof: 'P3',
  });
});

test('refuse provider inconnu, doublon de capability, evidence absente et CLOSED sur-certifié', () => {
  const registry = { providers: [{ id: 'allegro' }] };
  const base = {
    schema_version: 1,
    providers: {
      allegro: [{
        capability: 'purchasing.auto_order',
        classification: 'CONFIRMED',
        availability: 'CLOSED',
        highest_proof: 'UNQUALIFIED',
        environment: 'SANDBOX',
        evidence: ['docs/external-providers/suppliers/ALLEGRO_SANDBOX.md'],
      }],
    },
  };

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { ghost: base.providers.allegro } },
    ROOT
  )).toThrow('RECONCILIATION_UNKNOWN_PROVIDER:ghost');

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { allegro: [base.providers.allegro[0], base.providers.allegro[0]] } },
    ROOT
  )).toThrow('RECONCILIATION_CAPABILITY_DUPLICATE');

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { allegro: [{ ...base.providers.allegro[0], evidence: ['docs/nope.md'] }] } },
    ROOT
  )).toThrow('RECONCILIATION_EVIDENCE_NOT_FOUND');

  expect(() => reconciliation.validateLedger(
    registry,
    { ...base, providers: { allegro: [{ ...base.providers.allegro[0], highest_proof: 'P4' }] } },
    ROOT
  )).toThrow('RECONCILIATION_CLOSED_PROOF_OVERCLAIM');
});

test('résumé distingue CONFIRMED / RECLASSIFIED / GAP sans confondre highest proof et disponibilité', () => {
  const out = reconciliation.summarize([
    { classification: 'CONFIRMED', highest_proof: 'P4', availability: 'PROVEN' },
    { classification: 'RECLASSIFIED', highest_proof: 'P3', availability: 'PROVEN' },
    { classification: 'GAP', highest_proof: 'UNQUALIFIED', availability: 'CLOSED' },
  ]);
  expect(out).toEqual({
    total_capabilities: 3,
    confirmed: 1,
    reclassified: 1,
    gap: 1,
    p4: 1,
    closed: 1,
  });
});
