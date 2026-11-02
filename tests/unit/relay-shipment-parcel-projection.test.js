'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief La réception relais ne projette que les quantités réellement expédiées et attestées.
 */
jest.mock('../../db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../services/incident-write-service', () => ({ createScanIncident: jest.fn() }));
const { projectRelayReceiptToClientParcels } = require('../../services/relay-shipment-receipt');

const ITEM = '00000000-0000-4000-8000-000000000011';
const pid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function clientWith({ shipped, received, parcels = [] }) {
  const updates = [];
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('SELECT id FROM order_items')) return { rows: [{ id: ITEM }] };
    if (sql.includes('physically_shipped')) return { rows: [{ physically_shipped: shipped, attested_received: received }] };
    if (sql.includes('FOR UPDATE OF pi')) return { rows: parcels };
    if (sql.includes('UPDATE parcel_items')) {
      updates.push({ id: params[0], shipped: params[1], received: params[2] });
      return { rows: [] };
    }
    throw new Error('Unexpected SQL in parcel projection: ' + sql);
  });
  return { query, updates };
}
const parcel = (n, quantity, packed, shipped = 0, received = 0) => ({
  id: pid(n), quantity, qty_packed: packed, qty_shipped: shipped, qty_received: received,
});

describe('projection relais → articles colis client', () => {
  test('reçu partiel : 3 expédiés et 2 reçus sur une commande de 4', async () => {
    const q = clientWith({ shipped: 3, received: 2, parcels: [parcel(1, 4, 3)] });
    const out = await projectRelayReceiptToClientParcels(q, ITEM);
    expect(out).toEqual({ projected_received: 2, parcels_updated: 1 });
    expect(q.updates).toEqual([{ id: pid(1), shipped: 3, received: 2 }]);
  });
  test('répartit sans double comptage sur deux colis clients du même article', async () => {
    const q = clientWith({ shipped: 5, received: 4, parcels: [parcel(1, 3, 3), parcel(2, 4, 2)] });
    const out = await projectRelayReceiptToClientParcels(q, ITEM);
    expect(out.projected_received).toBe(4);
    expect(q.updates).toEqual([
      { id: pid(1), shipped: 3, received: 3 }, { id: pid(2), shipped: 2, received: 1 },
    ]);
  });
  test('excédent reçu : jamais créditer au colis plus que les cartons expédiés', async () => {
    const q = clientWith({ shipped: 2, received: 3, parcels: [parcel(1, 2, 2)] });
    const out = await projectRelayReceiptToClientParcels(q, ITEM);
    expect(out.projected_received).toBe(2);
    expect(q.updates[0]).toMatchObject({ shipped: 2, received: 2 });
  });
  test('aucune preuve KOM-BOX : refuse de créditer la réception client', async () => {
    const q = clientWith({ shipped: 2, received: 2, parcels: [parcel(1, 3, 1)] });
    await expect(projectRelayReceiptToClientParcels(q, ITEM))
      .rejects.toMatchObject({ status: 409, code: 'RELAY_PARCEL_PACKING_PROOF_MISSING' });
    expect(q.updates).toEqual([]);
  });
  test('une preuve précédente ne peut pas être abaissée', async () => {
    const q = clientWith({ shipped: 3, received: 1, parcels: [parcel(1, 3, 3, 3, 2)] });
    await expect(projectRelayReceiptToClientParcels(q, ITEM))
      .rejects.toMatchObject({ status: 409, code: 'RELAY_PARCEL_RECEIPT_REGRESSION' });
    expect(q.updates).toEqual([]);
  });
});
