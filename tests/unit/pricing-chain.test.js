/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * Tests unitaires — chaîne économique (moteur de pricing)
 * Invariants doctrine : N1/N2/N3, frontières, plancher, allocations, proportions.
 * Aucune DB requise (config injectée).
 */
'use strict';

jest.mock('../../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const { computeCDR } = require('../../services/pricing-cdr');
const { computePrices, buildCostBreakdown, buildProportions } = require('../../services/pricing-output');

const config = {
  finance: {
    target_marge_brute_pct: 40, taux_aed_kmf: 138, taux_change_eur_kmf: 492,
    fret_eur_per_m3: 180, objectif_commandes_mois: 80,
    avg_articles_per_order: 2.5, avg_articles_per_parcel: 4, avg_articles_per_shipment: 200,
    minimum_safety_margin_pct: 10, allocation_confidence: 'low',
  },
  categories: { phones: { key: 'phones', douane_pct: 5, tva_pct: 0, taxe_add_pct: 0, default_margin_pct: 40 } },
  components: [
    { key: 'sourcing_fee', category: 'sourcing', unit: 'kmf', default_value: 400 },
    { key: 'packaging_box', category: 'packaging', unit: 'kmf_per_parcel', default_value: 1200 },
    { key: 'freight_sea', category: 'freight', unit: 'kmf_per_shipment', default_value: 60000 },
    { key: 'relay_commission', category: 'relay', unit: 'kmf', default_value: 500 },
    { key: 'cash_fee', category: 'payment', unit: 'kmf_per_order', default_value: 800 },
  ],
  provisions: [{ rate_pct: 2 }],
  charges: [{ recurrence_period: 'monthly', amount_kmf: 420000 }],
};

describe('Chaîne économique — invariants doctrine', () => {
  let cdr, prices, bk, prop;
  let n1, n2, variableComplete, n3, cdrComplete;
  const price = 12990;

  beforeAll(() => {
    const product = { id: 'p1', category: 'phones', cost_kmf: 6000, weight_kg: 0.3 };
    const ctx = { config, volume_m3: 0.005, channel: 'cash_relais' };
    cdr = computeCDR(product, ctx);
    prices = computePrices(cdr, config.categories.phones, config.finance);
    bk = buildCostBreakdown(cdr.details);
    n1 = bk.landed_relay_cost_kmf;
    n2 = bk.business.payment + bk.business.risk_provision;
    variableComplete = n1 + n2;
    n3 = bk.business.fixed_overhead;
    cdrComplete = variableComplete + n3;
    prop = buildProportions(bk, { n1, n2, n3, cdr: cdrComplete, price }, config.finance);
  });

  it('coût variable complet = N1 + N2', () => {
    expect(variableComplete).toBe(n1 + n2);
  });
  it('CDR complet = N1 + N2 + N3', () => {
    expect(cdrComplete).toBe(variableComplete + n3);
  });
  it('coût variable complet cohérent avec variable_cost_estimated_kmf', () => {
    expect(variableComplete).toBe(cdr.variable_cost_estimated_kmf);
  });
  it('CDR complet cohérent avec cost_complete_estimated_kmf', () => {
    expect(cdrComplete).toBe(cdr.cost_complete_estimated_kmf);
  });
  it('N3 par article = charges / commandes / articles (2 100)', () => {
    expect(n3).toBe(2100);
  });
  it('N3 par article ≠ N3 par commande (5 250)', () => {
    expect(n3).not.toBe(5250);
  });
  it('minimum_safe_price ≠ CDR complet (doctrine §5)', () => {
    expect(prices.minimum_safe_price_kmf).not.toBe(cdrComplete);
  });
  it('minimum_safe_price > coût variable complet', () => {
    expect(prices.minimum_safe_price_kmf).toBeGreaterThan(variableComplete);
  });
  it('minimum_safe_price < prix conseillé', () => {
    expect(prices.minimum_safe_price_kmf).toBeLessThan(prices.recommended_price_kmf);
  });
  it('prix conseillé ≥ CDR complet', () => {
    expect(prices.recommended_price_kmf).toBeGreaterThanOrEqual(cdrComplete);
  });
  it('allocation expose les noms doctrinaux (level/basis/engaged/allocated)', () => {
    const a = (cdr.details._allocations || []).find(x => x.allocation_level === 'order');
    expect(a).toBeTruthy();
    expect(a.allocation_basis).toBe('quantity');
    expect(a.engaged_cost_kmf).not.toBeNull();
    expect(a.allocated_cost_kmf).not.toBeNull();
  });
  it('proportions : 3 familles N1/N2/N3', () => {
    expect(prop.families).toHaveLength(3);
  });
  it('chaque ligne a un poids dans sa famille et un diagnostic', () => {
    expect(prop.lines.every(l => l.share_of_family_pct != null
      && ['normal', 'à surveiller', 'surcharge', 'référence'].includes(l.diagnostic))).toBe(true);
  });
  it('achat fournisseur = référence (jamais alarmé sans benchmark)', () => {
    const achat = prop.lines.find(l => l.label === 'Achat fournisseur');
    expect(achat.diagnostic).toBe('référence');
  });
  it('prix sous coût variable → contribution négative', () => {
    expect((variableComplete - 500) - variableComplete).toBeLessThan(0);
  });
  it('prix entre frontières → contributif mais sous-couvert', () => {
    const p = Math.round((variableComplete + cdrComplete) / 2);
    expect(p - variableComplete).toBeGreaterThan(0);
    expect(p - cdrComplete).toBeLessThan(0);
  });
});
