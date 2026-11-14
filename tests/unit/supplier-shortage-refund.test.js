'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief H1 : clôture sans reliquat -> incident « rupture fournisseur » -> réservation admin possible ; aucun doublon par ligne.
 */
jest.mock('../../db', () => ({ getClient: jest.fn() }));
const { openSupplierShortage } = require('../../services/supplier-shortage-service');
const { reserveVerifiedShortage } = require('../../services/item-refund-reservation-service');
const governance = require('../../services/incident-governance');

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORDER = U(1), ITEM = U(2), LINE = U(3), ACTOR = U(4), INC = U(5), OPKEY = U(6);

/** Base simulée minimale : incidents + alertes en mémoire. */
function fakeDb() {
  const state = { incidents: [], alerts: [] };
  const query = jest.fn(async (sql, params) => {
    if (/FROM order_items WHERE id/.test(sql)) return { rows: [{ order_id: ORDER }] };
    if (/FROM incidents\s+WHERE incident_type = 'reconciliation_error'/.test(sql)) {
      return { rows: state.incidents.filter((i) => i.details.purchase_line_id === params[0]) };
    }
    if (/INSERT INTO incidents/.test(sql)) {
      const inc = { id: INC, order_id: params[0], order_item_id: params[1], details: JSON.parse(params[4]), detected_by: params[5], detected_source: params[6],
        origin_domain: params[7], resolver_domain: params[8], resolution_class: params[9] };
      state.incidents.push(inc); return { rows: [inc] };
    }
    if (/FROM alerts WHERE type = 'supplier_shortage_refund_required'/.test(sql)) return { rows: state.alerts.filter((a) => a.entity_id === params[0]) };
    if (/INSERT INTO alerts/.test(sql)) { const a = { type: params[0], entity_id: params[2], description: params[5] }; state.alerts.push(a); return { rows: [a] }; }
    throw new Error(`SQL inattendu : ${sql}`);
  });
  return { query, state };
}

describe('H1 — incident « rupture fournisseur »', () => {
  test('gouvernance : sous-type supplier_shortage = PURCHASING / UPSTREAM_TRUTH (aucune migration : reconciliation_error existe)', () => {
    expect(governance.resolveGovernance('reconciliation_error', { subtype: 'supplier_shortage' }))
      .toEqual({ origin_domain: 'PURCHASING', resolver_domain: 'PURCHASING', resolution_class: 'UPSTREAM_TRUTH' });
  });

  test('clôture : incident créé avec l\'acteur et la ligne PO en preuve, alerte qui pointe vers l\'incident', async () => {
    const d = fakeDb();
    const r = await openSupplierShortage(d, { purchaseLineId: LINE, orderItemId: ITEM, missingQuantity: 4, receivedQuantity: 6, reason: 'rupture', actorId: ACTOR });
    expect(r).toMatchObject({ created: true, alert_created: true });
    expect(d.state.incidents[0]).toMatchObject({ order_id: ORDER, order_item_id: ITEM, detected_by: ACTOR, origin_domain: 'PURCHASING' });
    expect(d.state.incidents[0].details).toMatchObject({ type: 'supplier_shortage', purchase_line_id: LINE, missing_quantity: 4, closed_by: ACTOR });
    expect(d.state.alerts[0]).toMatchObject({ type: 'supplier_shortage_refund_required', entity_id: INC });
    expect(d.state.alerts[0].description).toContain(`incident_id=${INC}`);
  });

  test('aucun doublon d\'incident ni d\'alerte pour une même ligne rejouée', async () => {
    const d = fakeDb();
    await openSupplierShortage(d, { purchaseLineId: LINE, orderItemId: ITEM, missingQuantity: 4, actorId: ACTOR });
    const again = await openSupplierShortage(d, { purchaseLineId: LINE, orderItemId: ITEM, missingQuantity: 4, actorId: null });
    expect(again).toMatchObject({ created: false, alert_created: false });
    expect(d.state.incidents).toHaveLength(1);
    expect(d.state.alerts).toHaveLength(1);
  });
});

describe('H1 — la réservation admin accepte l\'incident de rupture comme attestation', () => {
  function reservationClient({ supplierMissing }) {
    const log = [];
    const query = jest.fn(async (sql) => {
      log.push(sql);
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql)) return { rows: [] };
      if (/FROM orders WHERE id/.test(sql)) return { rows: [{ id: ORDER, market_id: U(9), payment_status: 'paid', payment_mode: 'stripe_eur', total_kmf: '10000', total_eur: '20.00', stripe_payment_id: 'pi_1' }] };
      if (/FROM order_items WHERE id/.test(sql)) return { rows: [{ id: ITEM, order_id: ORDER, quantity: 10, price_kmf: '1000', qty_collected: 0, qty_refunded: 0 }] };
      if (/FROM order_item_refund_reservations WHERE order_id/.test(sql)) return { rows: [] };
      if (/international_shipment_relay_receipts/.test(sql)) return { rows: [{ verified_missing: 0 }] };
      if (/details->>'type' = 'supplier_shortage'/.test(sql)) return { rows: [{ verified_missing: supplierMissing }] };
      if (/COALESCE\(SUM\(quantity\),0\)::int AS reserved/.test(sql)) return { rows: [{ reserved: 0 }] };
      if (/FROM refunds WHERE order_id/.test(sql) || /status IN \('reserved','processing','unknown'\) LIMIT 1/.test(sql)) return { rows: [] };
      if (/used_eur/.test(sql)) return { rows: [{ used_eur: '0' }] };
      if (/INSERT INTO refund_execution_intents/.test(sql)) return { rows: [{ id: U(7) }] };
      if (/INSERT INTO order_item_refund_reservations/.test(sql)) return { rows: [{ id: U(8) }] };
      throw new Error(`SQL inattendu : ${sql}`);
    });
    return { query, release: jest.fn(), log };
  }
  const run = (client, quantity = 4) => reserveVerifiedShortage({
    orderId: ORDER, orderItemId: ITEM, incidentId: INC, quantity, operationKey: OPKEY, reason: 'Rupture fournisseur ligne soldée',
    actor: { id: ACTOR, role: 'admin' }, db: { getClient: async () => client },
  });

  test('clôture -> incident -> réservation admin créée (incident = source_incident_id)', async () => {
    const c = reservationClient({ supplierMissing: 4 });
    const res = await run(c);
    expect(res).toMatchObject({ status: 'reserved', quantity: 4, paid: false });
    const insert = c.query.mock.calls.find(([sql]) => /INSERT INTO order_item_refund_reservations/.test(sql));
    expect(insert[1][2]).toBe(INC);
  });

  test('quantité au-delà du manquant constaté par l\'incident : refusée', async () => {
    await expect(run(reservationClient({ supplierMissing: 4 }), 5)).rejects.toMatchObject({ code: 'ITEM_REFUND_EXCEEDS_VERIFIED_SHORTAGE' });
  });

  test('incident sans manquant constaté (autre incident) : refusé ; les contraintes admin restent', async () => {
    await expect(run(reservationClient({ supplierMissing: 0 }))).rejects.toMatchObject({ code: 'ITEM_REFUND_EXCEEDS_VERIFIED_SHORTAGE' });
    await expect(reserveVerifiedShortage({ orderId: ORDER, orderItemId: ITEM, incidentId: INC, quantity: 1, operationKey: OPKEY, reason: 'Rupture fournisseur', actor: { id: ACTOR, role: 'hub' }, db: {} }))
      .rejects.toMatchObject({ code: 'ITEM_REFUND_ADMIN_REQUIRED' });
  });
});
