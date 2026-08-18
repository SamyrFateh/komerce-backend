'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const golden = require('../../tools/golden-cdr/golden/cdr.golden.json');
const witnesses = require('../../tools/golden-cdr/witnesses');
const legacy = require('../../services/pricing-cdr-legacy');
const target = require('../../services/pricing-cdr');

function firstWitness() {
  return witnesses.find(w => w.id === 'phones__cash');
}

describe('LOT 1B-1 — pricing CDR transport canonization', () => {
  test('Golden CURRENT est bien enrichi avec les policies SEA nécessaires', () => {
    const p = golden.frozen_config.transport_policies;
    expect(p.SEA_WM_KG_PER_M3).toBe(1000);
    expect(p.SEA_EUR_PER_M3_COST).toBe(180);
    expect(p.EUR_KMF).toBe(495);
  });

  test('le target retire toute valorisation freight/transit générique', () => {
    const filtered = target.withoutGenericFreightComponents(golden.frozen_config);
    expect(filtered.some(c => ['freight', 'transit'].includes(String(c.category).toLowerCase()))).toBe(false);
    expect(filtered.length).toBeLessThan(golden.frozen_config.components.length);
  });

  test('phones cash: freight devient le coût SEA W/M canonique', () => {
    const w = firstWitness();
    const out = target.computeCDR(w.product, {
      config: golden.frozen_config,
      volume_m3: w.ctx.volume_m3,
      channel: w.ctx.channel,
    });

    // max(0.004 m3, 0.4kg / 1000) = 0.004 m3
    // 0.004 * 180 EUR/m3 * 495 KMF/EUR = 356.4 -> 356 KMF
    expect(out.details.freight).toBe(356);
    expect(out._meta.freight_authority).toBe('transport-rails');
    expect(out._meta.freight_dominant_measure).toBe('volume');
    expect(out._meta.freight_cost_rate_key).toBe('SEA_EUR_PER_M3_COST');
    expect((out.details._allocations || []).some(a => a.category === 'freight')).toBe(false);
  });

  test('la correction produit bien un delta économique explicite contre CURRENT', () => {
    const w = firstWitness();
    const current = legacy.computeCDR(w.product, {
      config: golden.frozen_config,
      volume_m3: w.ctx.volume_m3,
      channel: w.ctx.channel,
    });
    const corrected = target.computeCDR(w.product, {
      config: golden.frozen_config,
      volume_m3: w.ctx.volume_m3,
      channel: w.ctx.channel,
    });

    expect(current.cost_complete_estimated_kmf).toBe(golden.snapshots.find(s => s.id === w.id).totals.total);
    expect(corrected.cost_complete_estimated_kmf).not.toBe(current.cost_complete_estimated_kmf);
    expect(corrected.cost_complete_estimated_kmf).toBeLessThan(current.cost_complete_estimated_kmf);
  });
});
