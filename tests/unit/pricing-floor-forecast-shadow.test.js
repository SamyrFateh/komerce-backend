'use strict';

/** @test-kind unit
 *  @test-runner jest
 *  @test-requires none
 */
const { calculateCase, comparePrices } = require('../../services/pricing-floor-forecast-shadow');

const proof = (status = 'QUOTED') => ({
  status, reference: 'DEVIS-TEST / hypothèse explicitement documentée',
  as_of: '2026-11-11', expires_on: '2027-01-31',
});
const line = (code, stage, basis, value, more = {}) =>
  ({ code, stage, basis, value, market_code: 'KM', circuit: 'import', evidence: proof(), ...more });
const fixture = (overrides = {}) => {
  const components = [
    line('supplier_delivery', 'N1', 'fixed_unit', 100, { cif_included: true }),
    line('freight', 'N1', 'fret_m3_minimum', 1000,
      { cif_included: true, minimum_billable_m3: 1, lot_volume_m3: 0.5 }),
    line('lot_fee', 'N1', 'lot_fixed_m3', 500, { lot_volume_m3: 0.5 }),
    line('bank_fee', 'N1', 'pct_purchase', 1),
    line('customs_duties', 'N1', 'pct_cif', 10),
    line('last_mile', 'N1', 'fixed_order', 80),
    line('relay_commission', 'N2', 'fixed_order', 50),
    line('payment', 'N2', 'fixed_order', 20),
    line('risk_damage', 'N2', 'pct_n1', 2),
    line('risk_pickup', 'N2', 'pct_exposure', 5,
      { base_codes: ['last_mile', 'relay_commission'] }),
    line('stripe_pct', 'N2', 'pct_sale', 2),
  ];
  const f = {
    market_code: 'KM',
    valuation_date: '2026-11-11',
    product: { circuit: 'import', purchase_kmf: 1000,
      volume_m3: 0.01, weight_kg: 0.2, purchase_evidence: proof('CONTRACT') },
    scenarios: {
      favorable: components.map(c => ({ ...c, value: c.code === 'last_mile' ? 60 : c.value })),
      central: components,
      defavorable: components.map(c => ({ ...c, value: c.code === 'last_mile' ? 120 : c.value })),
    },
    candidate_prices_kmf: [1400, 1600],
    n3_monthly_kmf: 2000,
  };
  return { ...f, ...overrides };
};

describe('prix plancher prévisionnel — shadow pur et sans valeur par défaut', () => {
  test('N1 calculé par unité physique, CIF, lot et frais commande ; pas de double comptage', () => {
    const c = calculateCase(fixture(), 'central');
    expect(c.status).toBe('EXPLOITABLE');
    expect(c.cif_kmf).toBe(1120); // achat + fournisseur + fret minimal
    expect(c.lines.filter(x => x.code === 'freight')[0].amount_kmf).toBe(20);
    expect(c.lines.filter(x => x.code === 'lot_fee')[0].amount_kmf).toBe(10);
    expect(c.lines.filter(x => x.code === 'customs_duties')[0].amount_kmf).toBe(112);
    expect(c.n1_kmf).toBe(1332);
    expect(c.n2_fixed_kmf).toBe(103.14); // relais, paiement, 2% N1 et 5% aval
    expect(c.p0_kmf).toBeCloseTo((1332 + 103.14) / 0.98, 2);
  });

  test('l ordre des composants ne change pas les montants', () => {
    const a = fixture();
    const b = fixture({ scenarios: Object.fromEntries(
      Object.entries(a.scenarios).map(([k,v]) => [k, [...v].reverse()])) });
    expect(calculateCase(a, 'central').p0_kmf).toBe(calculateCase(b, 'central').p0_kmf);
    expect(calculateCase(a, 'central').cif_kmf).toBe(calculateCase(b, 'central').cif_kmf);
  });

  test('Stripe est résolu sur le prix, jamais sur le coût ; contribution vérifiable', () => {
    const f = fixture();
    const r = comparePrices(f);
    const c = r.cases.central;
    const salePrice = 1600;
    const variableAtSale = c.n1_kmf + c.n2_fixed_kmf + salePrice * 0.02;
    expect(r.prices[1].contribution_centrale_kmf).toBeCloseTo(salePrice - variableAtSale, 2);
    expect(r.plancher_central_kmf).toBeCloseTo((c.n1_kmf + c.n2_fixed_kmf) / .98, 2);
    expect(r.n3_coverage_reference_only[1].equivalent_sales_to_cover_n3)
      .toBe(Math.ceil(2000 / (salePrice - variableAtSale)));
    expect(r.authority).toBe('SHADOW_REFERENCE_ONLY');
    expect(r.decisions_automatiques).toBe(false);
  });

  test('périmètres marché/circuit contradictoires -> NON_DECISIONNEL', () => {
    const f = fixture();
    f.scenarios.central[0] = { ...f.scenarios.central[0], market_code: 'CM' };
    expect(calculateCase(f, 'central').status).toBe('NON_DECISIONNEL');
    expect(comparePrices(f).plancher_central_kmf).toBeNull();
  });

  test('absence de livraison fournisseur -> jamais zéro implicite', () => {
    const f = fixture();
    f.scenarios.central = f.scenarios.central.filter(c => c.code !== 'supplier_delivery');
    expect(calculateCase(f, 'central').problems.join(' ')).toMatch(/supplier_delivery/);
    expect(comparePrices(f).status).toBe('NON_DECISIONNEL');
  });

  test('absence de volume avec fret volumétrique -> NON_DECISIONNEL', () => {
    const f = fixture();
    f.product.volume_m3 = null;
    expect(calculateCase(f, 'central').status).toBe('NON_DECISIONNEL');
  });

  test('devis expiré ou hypothèse non mesurée -> PROVISOIRE même si le prix tient', () => {
    const f = fixture();
    f.scenarios.central[0] = { ...f.scenarios.central[0],
      evidence: { ...proof('ASSUMED'), expires_on: '2026-10-01' } };
    const r = comparePrices(f);
    expect(r.status).toBe('PROVISOIRE');
    expect(r.cases.central.notes.join(' ')).toMatch(/expirée/);
    expect(r.prices[1].decision_quality).toBe('PROVISOIRE');
  });

  test('montant inconnu n est pas interprété comme zéro', () => {
    const f = fixture();
    f.scenarios.defavorable[0] = { ...f.scenarios.defavorable[0],
      value: null, evidence: { status: 'UNKNOWN' } };
    expect(comparePrices(f).status).toBe('NON_DECISIONNEL');
  });

  test('commande mono-article vs panier explicite : divise seulement les forfaits commande', () => {
    const f = fixture();
    const single = calculateCase(f, 'central', 1);
    const group = calculateCase(f, 'central', 3);
    expect(group.n1_kmf).toBeLessThan(single.n1_kmf);
    expect(group.lines.find(x => x.code === 'freight').amount_kmf)
      .toBe(single.lines.find(x => x.code === 'freight').amount_kmf);
    expect(group.lines.find(x => x.code === 'last_mile').amount_kmf)
      .toBeCloseTo(single.lines.find(x => x.code === 'last_mile').amount_kmf / 3, 2);
  });

  test('lot plus petit que le produit : le fret ne peut pas fabriquer un coût exploitable', () => {
    const f = fixture();
    f.product.volume_m3 = 0.6; // lot simulé de 0.5 m3
    const c = calculateCase(f, 'central');
    expect(c.status).toBe('NON_DECISIONNEL');
    expect(c.problems).toContain('freight: volume produit supérieur au volume du lot');
    expect(c.problems).toContain('lot_fee: volume produit supérieur au volume du lot');
    expect(comparePrices(f).plancher_prudent_kmf).toBeNull();
  });

  test('local ne supporte aucun coût import; N3 n augmente jamais le plancher', () => {
    const costs = [
      line('local_delivery', 'N1', 'fixed_order', 20, { circuit: 'local' }),
      line('relay_commission', 'N2', 'fixed_order', 40, { circuit: 'local' }),
      line('payment', 'N2', 'pct_sale', 3, { circuit: 'local' }),
    ];
    const f = fixture({ product: {
      circuit: 'local', purchase_kmf: 500, purchase_evidence: proof('CONTRACT'),
    }, scenarios: { favorable: costs, central: costs, defavorable: costs } });
    const one = comparePrices(f);
    expect(one.cases.central.p0_kmf).toBeCloseTo(560 / .97, 2);
    const second = comparePrices({ ...f, n3_monthly_kmf: 999999 });
    expect(second.plancher_central_kmf).toBe(one.plancher_central_kmf);
    expect(one.cases.central.lines.some(x => x.code === 'freight')).toBe(false);
  });

  test('écarts entre scénarios non ordonnés ou composants divergents -> bloqués', () => {
    const f = fixture();
    f.scenarios.favorable = f.scenarios.favorable.filter(x => x.code !== 'payment');
    expect(comparePrices(f).status).toBe('NON_DECISIONNEL');
  });
});