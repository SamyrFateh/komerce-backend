'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const evidence = require('../../services/suppliers/provider-capability-certifications');

test('purchasing modes restent des preuves observationnelles séparées', () => {
  const registry = {
    providers: {
      allegro: [
        {
          capability: 'purchasing.manual_procurement',
          classification: 'RECLASSIFIED',
          availability: 'PROVEN',
          highest_proof: 'P4',
          environment: 'SANDBOX',
          evidence: ['manual-proof'],
          limitations: ['human buyer'],
        },
        {
          capability: 'purchasing.auto_order',
          classification: 'CONFIRMED',
          availability: 'CLOSED',
          highest_proof: 'UNQUALIFIED',
          environment: 'SANDBOX',
          evidence: ['auto-proof'],
          limitations: ['no buyer API'],
        },
      ],
    },
  };

  const result = evidence.projectPurchasingModeEvidence('Allegro', registry);
  expect(result).toEqual(expect.objectContaining({
    provider: 'allegro',
    authority: 'observational_proof_only',
    manual_procurement: expect.objectContaining({
      resolution: 'RECORDED',
      availability: 'PROVEN',
      highest_proof: 'P4',
      environment: 'SANDBOX',
    }),
    auto_order: expect.objectContaining({
      resolution: 'RECORDED',
      availability: 'CLOSED',
      highest_proof: 'UNQUALIFIED',
    }),
  }));
});

test('absence de record et provider inconnu restent explicites, jamais convertis en false runtime', () => {
  const registry = { providers: { cj: [] } };
  expect(evidence.projectPurchasingModeEvidence('cj', registry).manual_procurement)
    .toEqual(expect.objectContaining({ resolution: 'NO_RECORD', availability: null }));
  expect(evidence.projectPurchasingModeEvidence('unknown', registry).auto_order)
    .toEqual(expect.objectContaining({ resolution: 'UNSUPPORTED_PROVIDER', availability: null }));
});
