'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * LOT 1B-1 ratchet : le checkout ne doit plus recalculer le fret via
 * FREIGHT_KMF_PER_KG. Prix et coût transport doivent venir du même devis W/M.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../routes/orders/create.js'),
  'utf8'
);

describe('orders/create — transport canonique LOT 1B-1', () => {
  test('consomme le devis combiné coût + prix', () => {
    expect(SOURCE).toMatch(/quoteTransportForOrder/);
    expect(SOURCE).toMatch(/transport_cost_kmf/);
    expect(SOURCE).toMatch(/cost_estimated\s*\+=\s*transport_cost_kmf/);
  });

  test('charge les policies SEA W/M et coût rail', () => {
    expect(SOURCE).toMatch(/SEA_WM_KG_PER_M3/);
    expect(SOURCE).toMatch(/SEA_EUR_PER_M3_COST/);
  });

  test('retire le calcul legacy FREIGHT_KMF_PER_KG du checkout', () => {
    expect(SOURCE).not.toMatch(/getRule\(['"]FREIGHT_KMF_PER_KG['"]/);
    expect(SOURCE).not.toMatch(/const\s+fret_kmf\s*=/);
  });
});
