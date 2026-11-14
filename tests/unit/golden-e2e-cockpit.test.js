'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/hub-inbound-reconciliation', () => ({
  reconcileHubInbound: jest.fn().mockResolvedValue({ verdict:'INBOUND_MATCHED' }),
}));
jest.mock('../../services/customer-handoff-reconciliation', () => ({
  reconcileCustomerHandoff: jest.fn().mockResolvedValue({ verdict:'HANDOFF_MATCHED' }),
}));
jest.mock('../../services/order-financial-closure-reconciliation', () => ({
  reconcileOrderFinancialClose: jest.fn().mockResolvedValue({ verdict:'FINANCIAL_CLOSE_MATCHED' }),
}));

const { projectGoldenEvidence, evaluatePhysicalLines, evaluatePurchaseCoverage, evaluateInboundIndependence } = require('../../services/golden-e2e-cockpit');

test('projette 10 preuves réelles sans mutation DB', async () => {
  const db = { query: jest.fn()
    .mockResolvedValueOnce({ rows:[{ order_item_id:'oi-1', ordered_qty:1, purchased_qty:1, paid_qty:1 }] })
    .mockResolvedValueOnce({ rows:[{ id:'fulfillment-1', tracking_number:'TRK-1', reconciliation_status:'matched', expected_quantity:1, observed_quantity:1 }] })
    .mockResolvedValueOnce({ rows:[{ order_item_id:'oi-1', ordered_qty:1, parcel_id:'p-1', line_qty:1, qty_received:0, qty_collected:0, parcel_ref:'P1', parcel_status:'collected', customs_ok:true }] }) };
  const result = await projectGoldenEvidence(db, {
    id:'order-1', reference:'K-GOLDEN-TEST', market_code:'KM', status:'collected', payment_status:'paid',
  });
  expect(result.order).toMatchObject({ reference:'K-GOLDEN-TEST', market_code:'KM' });
  expect(result.steps).toHaveLength(10);
  expect(result.steps.every(step => step.passed)).toBe(true);
  expect(result.verdict).toBe('FINANCIAL_CLOSE_MATCHED');
  expect(result.doctrine).toBe('read_only_projection_no_business_authority');
  expect(db.query).toHaveBeenCalledTimes(3);
  expect(db.query.mock.calls.every(([sql]) => /^SELECT/i.test(sql.trim()))).toBe(true);
  const purchaseSql = db.query.mock.calls[0][0];
  expect(purchaseSql.match(/pl\.product_sku_id\s*=\s*oi\.sku_id/g)).toHaveLength(2);
  expect(purchaseSql.match(/oi\.sku_id IS NOT NULL/g)).toHaveLength(2);
});


// Preuve par unités : le Hub organise librement ses colis, la Golden ne certifie que lignes et quantités.
const line = (o) => ({ order_item_id:'oi-1', ordered_qty:2, parcel_id:'p-1', line_qty:2, qty_received:0, qty_collected:0, parcel_ref:'P1', parcel_status:'available', customs_ok:true, ...o });
const stepsOf = (rows) => { const r = evaluatePhysicalLines(rows); return { customs:r.customs, relay:r.relay }; };

describe('preuves physiques par lignes et quantités', () => {
  test('deux commandes regroupées dans un colis : chaque commande est prouvée par SES lignes', () => {
    // Le colis P-G est rattaché (parcels.order_id) à une autre commande ; seules les lignes de cette commande sont lues.
    const r = stepsOf([line({ parcel_id:'p-G', parcel_ref:'P-G', ordered_qty:2, line_qty:2 })]);
    expect(r.customs.passed).toBe(true);
    expect(r.relay.passed).toBe(true);
    expect(r.relay.evidence).toMatch(/1 colis · 2 unité/);
  });

  test('une commande répartie entre plusieurs colis : preuve seulement si toutes les parts sont prouvées', () => {
    const both = [line({ parcel_id:'p-1', line_qty:1 }), line({ parcel_id:'p-2', parcel_ref:'P2', line_qty:1 })];
    expect(stepsOf(both).relay.passed).toBe(true);
    const oneLate = [both[0], { ...both[1], parcel_status:'in_transit', customs_ok:false }];
    expect(stepsOf(oneLate).relay).toMatchObject({ passed:false });
    expect(stepsOf(oneLate).relay.evidence).toContain('RELAY_PARTIAL 1/2');
    expect(stepsOf(oneLate).customs.passed).toBe(false);
  });

  test('douane confirmée pour un seul colis sur plusieurs : jamais de validation globale', () => {
    const r = stepsOf([line({ parcel_id:'p-1', line_qty:1, customs_ok:true }), line({ parcel_id:'p-2', parcel_ref:'P2', line_qty:1, customs_ok:false })]);
    expect(r.customs.passed).toBe(false);
    expect(r.customs.evidence).toContain('CUSTOMS_PARTIAL 1/2');
  });

  test('réaffectation physique : l’ancien colis annulé ne compte plus, la ligne suit son nouveau colis', () => {
    // LEFT JOIN : la ligne restée sur un colis annulé remonte sans statut de colis → ignorée ; la part réaffectée compte.
    const moved = [line({ parcel_id:'p-old', parcel_status:null, parcel_ref:null, line_qty:2 }), line({ parcel_id:'p-new', parcel_ref:'PN', line_qty:2 })];
    const r = stepsOf(moved);
    expect(r.relay.passed).toBe(true);
    expect(r.relay.evidence).toMatch(/1 colis/);
  });

  test('quantité partiellement allouée, reçue ou sur-allouée : jamais de preuve complète', () => {
    expect(stepsOf([line({ line_qty:1 })]).relay.evidence).toContain('QUANTITY_NOT_FULLY_ALLOCATED');
    expect(stepsOf([line({ line_qty:3 })]).relay.evidence).toContain('QUANTITY_OVER_ALLOCATED');
    const partial = stepsOf([line({ qty_received:1 })]);
    expect(partial.relay).toMatchObject({ passed:false });
    expect(partial.relay.evidence).toContain('QUANTITY_PARTIALLY_RECEIVED');
    expect(partial.customs.passed).toBe(false);
  });

  test('quantités divergentes (collecté > reçu > ligne) → refus', () => {
    expect(stepsOf([line({ qty_received:3 })]).relay.passed).toBe(false);
    expect(stepsOf([line({ qty_received:1, qty_collected:2, parcel_status:'collected' })]).relay.evidence).toContain('QUANTITY_TELEMETRY_INCONSISTENT');
  });

  test('aucun colis alloué : simple attente, pas de succès', () => {
    const r = stepsOf([{ order_item_id:'oi-1', ordered_qty:2, parcel_id:null, line_qty:null, parcel_status:null }]);
    expect(r.customs).toEqual({ passed:false, evidence:'PENDING' });
    expect(r.relay).toEqual({ passed:false, evidence:'PENDING' });
  });

  test('commande sans lignes → non prouvé', () => {
    expect(stepsOf([]).relay.evidence).toBe('NON_PROUVE:NO_ORDER_ITEMS');
  });
});

describe('Golden coverage must be complete', () => {
  test('two lines with only one purchased cannot pass', () => {
    expect(evaluatePurchaseCoverage([
      { ordered_qty:2, purchased_qty:2, paid_qty:2 },
      { ordered_qty:3, purchased_qty:0, paid_qty:0 },
    ])).toEqual({ purchasing:false, payment:false });
  });

  test('partial supplier payment cannot pass despite full purchasing', () => {
    expect(evaluatePurchaseCoverage([
      { ordered_qty:2, purchased_qty:2, paid_qty:2 },
      { ordered_qty:3, purchased_qty:3, paid_qty:1 },
    ])).toEqual({ purchasing:true, payment:false });
  });

  test('missing lines, over-purchasing and overpayment fail closed', () => {
    expect(evaluatePurchaseCoverage([]).payment).toBe(false);
    expect(evaluatePurchaseCoverage([{ ordered_qty:1, purchased_qty:2, paid_qty:2 }]).purchasing).toBe(false);
  });

  test('all fulfillments must reconcile at the Hub', async () => {
    const { reconcileHubInbound } = require('../../services/hub-inbound-reconciliation');
    reconcileHubInbound.mockReset().mockResolvedValueOnce({ verdict:'INBOUND_MATCHED' })
      .mockResolvedValueOnce({ verdict:'PENDING' });
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows:[{ ordered_qty:2, purchased_qty:2, paid_qty:2 }] })
      .mockResolvedValueOnce({ rows:[
        { id:'f1', tracking_number:'T1', reconciliation_status:'matched', expected_quantity:1, observed_quantity:1 },
        { id:'f2', tracking_number:'T2', reconciliation_status:'matched', expected_quantity:1, observed_quantity:1 },
      ] })
      .mockResolvedValueOnce({ rows:[{ order_item_id:'oi1', ordered_qty:2, parcel_id:'p1', line_qty:2, parcel_status:'available', customs_ok:true }] }) };
    const result = await projectGoldenEvidence(db, { id:'o1', reference:'K-GOLDEN-1', status:'collected', payment_status:'paid' });
    expect(result.steps.find(s => s.key === 'HUB_INBOUND').passed).toBe(false);
    expect(reconcileHubInbound).toHaveBeenCalledTimes(2);
  });
});

describe('Golden Hub inbound independence (Lot 1B)', () => {
  const matched = (id, lines, units) => ({
    verdict: 'INBOUND_MATCHED', supplier_fulfillment_id: id,
    purchase_line_ids: lines, hub_unit_refs: units,
  });

  test('two fulfillments cannot reuse the same purchase line receipt', () => {
    const proof = evaluateInboundIndependence([
      matched('f1', ['line-1'], ['unit-1']),
      matched('f2', ['line-1'], ['unit-1']),
    ]);
    expect(proof.independent).toBe(false);
    expect(proof.conflicts).toEqual(expect.arrayContaining([
      'SHARED_PURCHASE_LINE:line-1', 'SHARED_HUB_UNIT:unit-1',
    ]));
  });

  test('independent receipt lineages remain eligible', () => {
    expect(evaluateInboundIndependence([
      matched('f1', ['line-1'], ['unit-1']),
      matched('f2', ['line-2'], ['unit-2']),
    ])).toEqual({ independent: true, conflicts: [] });
  });

  test('one fulfillment with repeated references does not self-conflict', () => {
    expect(evaluateInboundIndependence([
      matched('f1', ['line-1', 'line-1'], ['unit-1', 'unit-1']),
    ]).independent).toBe(true);
  });
});
