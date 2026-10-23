'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * RC-2 : preuves SQL sur tables temporaires et SAVEPOINTS, sans toucher aux
 * commandes réelles de staging ni aux tables applicatives de la base de test.
 */
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const crypto = require('crypto');
const { describeE2E } = require('../helpers/e2eDbKit');
const { syncOrderFromParcels } = require('../../services/scan-engine');
const { transitionOrderStatus } = require('../../services/order-status-machine');

describeE2E('E2E-LOG-RC2 — clôture physique de commande, SQL canonique', ({ db }) => {
  let client;
  const id = () => crypto.randomUUID();
  async function orderItem(orderId, qty = 1) {
    const oiId = id();
    await client.query(
      'INSERT INTO order_items (id, order_id, quantity) VALUES ($1,$2,$3)',
      [oiId, orderId, qty]
    );
    return oiId;
  }
  async function parcel(carrierOrderId, status = 'collected') {
    const pId = id();
    await client.query(
      'INSERT INTO parcels (id, order_id, status) VALUES ($1,$2,$3)',
      [pId, carrierOrderId, status]
    );
    return pId;
  }
  async function lineInParcel(parcelId, lineId, qty = 1) {
    await client.query(
      'INSERT INTO parcel_items (id,parcel_id,order_item_id,qty_allocated,qty_packed,qty_shipped,qty_received,qty_collected) VALUES ($1,$2,$3,$4,$4,$4,$4,$4)',
      [id(), parcelId, lineId, qty]
    );
  }

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    await client.query(
      'CREATE TEMP TABLE order_items (id uuid PRIMARY KEY, order_id uuid, quantity integer, qty_allocated integer DEFAULT 0, qty_packed integer DEFAULT 0, qty_shipped integer DEFAULT 0, qty_received integer DEFAULT 0, qty_collected integer DEFAULT 0)'
    );
    await client.query(
      'CREATE TEMP TABLE parcels (id uuid PRIMARY KEY, order_id uuid, status text)'
    );
    await client.query(
      'CREATE TEMP TABLE parcel_items (id uuid PRIMARY KEY, parcel_id uuid, order_item_id uuid, qty_allocated integer DEFAULT 0, qty_packed integer DEFAULT 0, qty_shipped integer DEFAULT 0, qty_received integer DEFAULT 0, qty_collected integer DEFAULT 0)'
    );
  });
  beforeEach(async () => {
    transitionOrderStatus.mockClear();
    await client.query('SAVEPOINT rc2_case');
  });
  afterEach(async () => {
    await client.query('ROLLBACK TO SAVEPOINT rc2_case');
    await client.query('RELEASE SAVEPOINT rc2_case');
  });
  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  test('une ligne due hors colis interdit collected malgré le dernier colis collecté', async () => {
    const oid = id();
    const first = await orderItem(oid);
    await orderItem(oid); // jamais affectée
    const p = await parcel(oid);
    await lineInParcel(p, first);
    await syncOrderFromParcels(client, oid);
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  test('quantité 1 sur 2 collectée : pas de clôture', async () => {
    const oid = id();
    const line = await orderItem(oid, 2);
    const p = await parcel(oid);
    await lineInParcel(p, line, 1);
    await syncOrderFromParcels(client, oid);
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  test('toutes les quantités collectées : collected via state machine', async () => {
    const oid = id();
    const line = await orderItem(oid, 2);
    const p = await parcel(oid);
    await lineInParcel(p, line, 2);
    await syncOrderFromParcels(client, oid);
    expect(transitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: oid, newStatus: 'collected', dbClient: client })
    );
  });

  test('colis groupé : chaque commande est évaluée via ses propres lignes', async () => {
    const carrier = id(), represented = id();
    const carrierLine = await orderItem(carrier, 1);
    const representedLine = await orderItem(represented, 2);
    const p = await parcel(carrier);
    await lineInParcel(p, carrierLine, 1);
    await lineInParcel(p, representedLine, 1);
    await syncOrderFromParcels(client, represented);
    expect(transitionOrderStatus).not.toHaveBeenCalled();
    await client.query(
      'UPDATE parcel_items SET qty_collected = 2 WHERE order_item_id = $1', [representedLine]
    );
    await syncOrderFromParcels(client, represented);
    expect(transitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: represented, newStatus: 'collected' })
    );
  });
});
