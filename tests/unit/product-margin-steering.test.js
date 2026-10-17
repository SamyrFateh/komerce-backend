'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * Pilotage par la marge : douane jamais estimée, NULL ≠ 0, final vs provisoire,
 * cumul pondéré, écart en points, seuils configurables, impact douane par expédition.
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
const { computeLineMargin, summarizeProduct, applyFinalOrderReal, DEFAULT_RULES } = require('../../services/cost-allocation/product-margin-steering');

const BD = { landed_relay: { product_purchase: 4000, freight: 300, customs: 500 }, business: { payment: 0 }, target_margin_pct: 40 };
const line = (extra = {}) => ({
  quantity: 1, sale_total_kmf: 10000, cost_breakdown: BD, customs_expected: true, customs_known: true,
  real: { customs: { actual: 600, non_actual: 0 }, freight: { actual: 300, non_actual: 0 } }, ...extra,
});

describe('computeLineMargin', () => {
  it('douane réelle ventilée, jamais l\'estimé figé (500) ; achat estimé → provisional', () => {
    const r = computeLineMargin(line());
    expect(r.costs.customs).toEqual({ state: 'real', amount_kmf: 600 });
    expect(r.costs.product_purchase.state).toBe('estimated');
    expect(r.status).toBe('provisional');
    expect(r.margin_kmf).toBe(10000 - 4000 - 300 - 600);
    expect(r.margin_pct).toBe(51);
  });

  it('ligne importée non groupée : douane inconnue → incomplete, marge NULL (jamais 0)', () => {
    const r = computeLineMargin(line({ customs_known: false, real: {} }));
    expect(r.status).toBe('incomplete');
    expect(r.costs.customs.amount_kmf).toBeNull();
    expect(r.margin_pct).toBeNull();
  });

  it('ventilation non certifiée seule (is_actual=false) → inconnue', () => {
    const r = computeLineMargin(line({ real: { customs: { actual: 0, non_actual: 600 } } }));
    expect(r.status).toBe('incomplete');
  });

  it('stock local : douane non attendue, estimé théorique ignoré', () => {
    const r = computeLineMargin(line({ customs_expected: false, real: {} }));
    expect(r.costs.customs.state).toBe('not_expected');
    expect(r.margin_kmf).toBe(10000 - 4000 - 300);
  });

  it('quantité : estimé unitaire × quantité', () => {
    const r = computeLineMargin(line({ quantity: 2, sale_total_kmf: 20000, real: { customs: { actual: 0, non_actual: 0 } } }));
    expect(r.costs.product_purchase.amount_kmf).toBe(8000);
    expect(r.costs.freight).toEqual({ state: 'estimated', amount_kmf: 600 });
    expect(r.costs.customs).toEqual({ state: 'real', amount_kmf: 0 });
  });

  it('snapshot absent → incomplete', () => {
    expect(computeLineMargin(line({ cost_breakdown: null })).status).toBe('incomplete');
  });
});

describe('applyFinalOrderReal', () => {
  it('achat réel de la commande ventilé au prorata, conservé, statut final', () => {
    const lines = [{ result: computeLineMargin(line()) }, { result: computeLineMargin(line({ cost_breakdown: { ...BD, landed_relay: { ...BD.landed_relay, product_purchase: 2000 } } })) }];
    applyFinalOrderReal(lines, { costs: { by_type: { product_purchase: { state: 'real', real_kmf: 6001 }, payment: { state: 'not_expected' } } } });
    expect(lines[0].result.costs.product_purchase.amount_kmf + lines[1].result.costs.product_purchase.amount_kmf).toBe(6001);
    expect(lines.every((l) => l.result.status === 'final')).toBe(true);
  });
});

describe('summarizeProduct', () => {
  const mk = (marginPct, target = 40, extra = {}) => ({
    target_pct: target,
    shipments: [{ shipment_id: 's1', reference: 'S1', shipment_date: '2026-10-01', status: 'confirmed', customs_kmf: 600, fees_kmf: 100 }],
    result: { status: 'provisional', sale_kmf: 10000, cost_kmf: 10000 * (1 - marginPct / 100), margin_pct: marginPct, costs: { customs: { state: 'real', amount_kmf: 600 } } },
    ...extra,
  });

  it('cumul pondéré, écart en points, impact douane par expédition', () => {
    const s = summarizeProduct([mk(30), mk(32), mk(28)], DEFAULT_RULES);
    expect(s.cumulative_margin_pct).toBe(30);
    expect(s.target_margin_pct).toBe(40);
    expect(s.gap_pts).toBe(-10);
    expect(s.customs_impact_pts).toBe(6);
    expect(s.by_shipment[0]).toMatchObject({ shipment_id: 's1', sales: 3, customs_kmf: 1800, customs_impact_pts: 6, customs_and_fees_impact_pts: 7 });
    expect(s.signal).toBe('review_suggested');
    expect(s.proposal).toMatch(/aucun ajustement automatique/);
  });

  it('dégradation ponctuelle sous le seuil cumulé : pas de review ; douane significative → watch', () => {
    const s = summarizeProduct([mk(30), mk(45), mk(45)], DEFAULT_RULES);
    expect(s.gap_pts).toBe(0);
    expect(s.signal).toBe('watch');
  });

  it('seuils configurables ; données insuffisantes ; incomplètes exclues du cumul', () => {
    const inc = { target_pct: 40, shipments: [], result: { status: 'incomplete', sale_kmf: 10000, cost_kmf: null, margin_pct: null, costs: {} } };
    const s = summarizeProduct([mk(45), inc], DEFAULT_RULES);
    expect(s.sales_incomplete).toBe(1);
    expect(s.signal).toBe('insufficient_data');
    const strict = summarizeProduct([mk(38)], { ...DEFAULT_RULES, MARGIN_STEERING_MIN_SALES: 1, MARGIN_STEERING_GAP_ALERT_PTS: 1, MARGIN_STEERING_CUSTOMS_IMPACT_PTS: 50 });
    expect(strict.signal).toBe('review_suggested');
  });
});
