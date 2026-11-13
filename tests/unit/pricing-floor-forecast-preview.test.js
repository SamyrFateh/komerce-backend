'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../utils/currency', () => ({
  projectAmount: jest.fn(async (amount, from, to) => {
    if (from === to) return amount;
    if (from === 'XAF' && to === 'KMF') return Number(amount) * .75;
    if (from === 'KMF' && to === 'XAF') return Number(amount) / .75;
    throw new Error('FX_UNSUPPORTED_IN_TEST');
  }),
}));
const { preview, previewForMarket, ForecastPreviewError, IMPORT_FIELDS, LOCAL_FIELDS } =
  require('../../services/pricing-floor-forecast-preview');

const DATE = '2026-11-11';
const market = { code: 'KM', id: 'internal-server-side' };
const product = {
  product_ref: 'KPR-SHADOW', cost_kmf: '3936',
  volume_m3: '0.0008', weight_kg: '0.15',
};
const points = {
  favorable: { supplier_delivery: 500, bank_pct: 1, hub_packaging: 40,
    freight: 70000, lot_volume_m3: 5, minimum_billable_m3: 1,
    lot_fee: 80000, insurance_pct: .5, customs_duties: 0,
    last_mile: 400, relay_commission: 600, payment: 200,
    payment_pct: 0, risk_damage_pct: .5, risk_pickup_pct: 2 },
  central: { supplier_delivery: 738, bank_pct: 1.5, hub_packaging: 56,
    freight: 88552.8, lot_volume_m3: 3, minimum_billable_m3: 1,
    lot_fee: 110000, insurance_pct: .5, customs_duties: 20,
    last_mile: 500, relay_commission: 600, payment: 200,
    payment_pct: 0, risk_damage_pct: 1, risk_pickup_pct: 5 },
  defavorable: { supplier_delivery: 800, bank_pct: 2, hub_packaging: 80,
    freight: 122990, lot_volume_m3: 1.5, minimum_billable_m3: 1,
    lot_fee: 150000, insurance_pct: .5, customs_duties: 42,
    last_mile: 700, relay_commission: 600, payment: 200,
    payment_pct: 0, risk_damage_pct: 3, risk_pickup_pct: 10 },
};
const payload = (overrides = {}) => ({
  circuit: 'import', commission_basis: 'fixed_unit',
  scenarios: JSON.parse(JSON.stringify(points)),
  candidate_prices_kmf: [7500, 9000],
  ...overrides,
});
const calculate = (body = payload(), more = {}) =>
  preview({ market, product, payload: body, date: DATE, ...more });
const localPayload = prices => {
  const body = payload();
  delete body.candidate_prices_kmf; // no legacy KMF authority on XAF markets
  body.candidate_prices_local = prices;
  return body;
};

describe('projection de la simulation selon la devise du marché', () => {
  test('CM : montants XAF convertis côté serveur, physique et taux inchangés, restitution XAF', async () => {
    const result = await previewForMarket({
      market: { code: 'CM', currency: 'XAF' }, product,
      payload: localPayload([10000]),
      date: DATE,
    });
    expect(result.market_currency).toBe('XAF');
    expect(result.internal_currency).toBe('KMF');
    expect(result.fx_authority).toBe('fx-authority');
    expect(result.forecast.prices[0].price_kmf).toBe(7500);
    expect(result.local_display.prices[0].price).toBe(10000);
    expect(result.forecast.cases.central.lines.find(l => l.code === 'supplier_delivery').charged_value).toBe(738 * .75);
    expect(result.forecast.cases.central.lines.find(l => l.code === 'bank_fee').charged_value).toBe(1.5);
    expect(result.forecast.cases.central.lines.find(l => l.code === 'freight').charged_value).toBe(88552.8 * .75);
    expect(result.forecast.cases.central.lines.find(l => l.code === 'freight').amount_kmf).toBeGreaterThan(0);
    expect(result.simulation_only).toBe(true);
    expect(result.writes).toBe(false);
  });
  test('XAF : injection candidate_prices_kmf ou devise manquante refusée sans conversion implicite', async () => {
    await expect(previewForMarket({
      market: { code: 'CM', currency: 'XAF' }, product, date: DATE, payload: payload(),
    })).rejects.toThrow(ForecastPreviewError);
    await expect(previewForMarket({
      market: { code: 'CM' }, product, date: DATE, payload: payload(),
    })).rejects.toThrow(ForecastPreviewError);
  });
  test('KM : les hypothèses et prix restent en KMF, sans variation', async () => {
    const x = await previewForMarket({
      market: { code: 'KM', currency: 'KMF' }, product,
      payload: localPayload([9000]),
      date: DATE,
    });
    expect(x.forecast.prices[0].price_kmf).toBe(9000);
    expect(x.local_display.prices[0].price).toBe(9000);
  });
});

describe('contrat HTTP pur : preview du plancher non persistant', () => {
  test('la simulation réaliste reste PROVISOIRE, sans prix activé', () => {
    const x = calculate();
    expect(x.simulation_only).toBe(true);
    expect(x.writes).toBe(false);
    expect(x.evidence_policy).toBe('ALL_BROWSER_AMOUNTS_ARE_UNVERIFIED_ASSUMPTIONS');
    expect(x.forecast.status).toBe('PROVISOIRE');
    expect(x.forecast.plancher_central_kmf).toBeGreaterThan(7000);
    expect(x.forecast.plancher_prudent_kmf).toBeGreaterThan(x.forecast.plancher_central_kmf);
    expect(x.forecast.prices).toHaveLength(2);
    expect(x.forecast.prices[0].decision_quality).toBe('PROVISOIRE');
  });

  test('toute valeur navigateur reste ASSUMED, même une fausse pièce CONTRACT', () => {
    const body = payload();
    body.scenarios.central.supplier_delivery_evidence = {
      status: 'CONTRACT', reference: 'fake contract', as_of: DATE,
    };
    const x = calculate(body);
    expect(x.forecast.cases.central.lines.every(l => l.evidence === 'ASSUMED')).toBe(true);
    expect(x.forecast.cases.central.lines.some(l => l.source.includes('fake'))).toBe(false);
  });

  test('la référence marché serveur prévaut sur toute indication dans le corps', () => {
    const body = payload({ market_code: 'CG' });
    const x = calculate(body);
    expect(x.forecast.market_code).toBe('KM');
    expect(x.forecast.cases.central.lines.every(l => l.code === 'purchase' ||
      !l.source.includes('CG'))).toBe(true);
  });

  test('montant omis, NaN, objet ou chaîne ne deviennent jamais 0', () => {
    for (const value of [undefined, null, NaN, {}, '0']) {
      const body = payload();
      body.scenarios.central.supplier_delivery = value;
      expect(() => calculate(body)).toThrow(ForecastPreviewError);
    }
  });

  test('le vrai zéro explicite est permis pour des hypothèses documentées', () => {
    const x = calculate();
    expect(x.forecast.cases.central.lines.find(x => x.code === 'payment_pct').charged_value).toBe(0);
    expect(x.forecast.cases.favorable.lines.find(x => x.code === 'customs_duties').charged_value).toBe(0);
  });

  test('aucun produit importé sans volume et poids valides', () => {
    expect(() => calculate(payload(), { product: { ...product, weight_kg: null } }))
      .toThrow('Le poids et le volume');
    expect(() => calculate(payload(), { product: { ...product, volume_m3: 0 } }))
      .toThrow('Le poids et le volume');
  });

  test('stock local n hérite pas du Hub, du fret ou de la douane', () => {
    const s = {
      favorable: { local_delivery: 300, relay_commission: 600, payment: 200, payment_pct: 0,
        risk_damage_pct: 1, risk_pickup_pct: 2 },
      central: { local_delivery: 400, relay_commission: 600, payment: 200, payment_pct: 0,
        risk_damage_pct: 1, risk_pickup_pct: 5 },
      defavorable: { local_delivery: 700, relay_commission: 600, payment: 200, payment_pct: 0,
        risk_damage_pct: 2, risk_pickup_pct: 10 },
    };
    const x = calculate(payload({ circuit: 'local', scenarios: s }));
    expect(x.forecast.status).toBe('PROVISOIRE');
    expect(x.forecast.cases.central.lines.map(x => x.code))
      .not.toContain('freight');
    expect(x.forecast.cases.central.lines.map(x => x.code))
      .not.toContain('hub_packaging');
    expect(x.forecast.cases.central.lines.map(x => x.code))
      .not.toContain('customs_duties');
    expect(x.forecast.cases.central.n1_kmf).toBe(4336);
  });

  test('unité relais par commande ou par article : arbitrage non présélectionné', () => {
    const unit = calculate();
    const order = calculate(payload({ commission_basis: 'fixed_order' }));
    expect(unit.forecast.cases.central.p0_kmf).toBe(order.forecast.cases.central.p0_kmf);
    expect(() => calculate(payload({ commission_basis: '' }))).toThrow(ForecastPreviewError);
  });

  test('deux extrêmes non ordonnés sont rejetés', () => {
    const body = payload();
    body.scenarios.favorable.customs_duties = 99;
    expect(calculate(body).forecast.status).toBe('NON_DECISIONNEL');
  });

  test('toute saisie marché étranger ou circuit absent est refusée', () => {
    expect(() => calculate(payload(), { market: { code: 'KOMET' } })).toThrow(ForecastPreviewError);
    expect(() => calculate(payload({ circuit: 'external' }))).toThrow(ForecastPreviewError);
  });

  test('exige explicitement tous les champs de chaque scénario', () => {
    expect(IMPORT_FIELDS).toContain('customs_duties');
    expect(LOCAL_FIELDS).toContain('risk_damage_pct');
    const body = payload();
    delete body.scenarios.defavorable.lot_fee;
    try { calculate(body); throw new Error('should fail'); }
    catch (e) {
      expect(e).toBeInstanceOf(ForecastPreviewError);
      expect(e.fields).toContain('defavorable.lot_fee: montant ou taux requis');
    }
  });
});
