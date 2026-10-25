'use strict';

/** @test-kind unit @test-runner jest @test-requires none — RC-3/RC-4 */
jest.mock('../../db', () => ({
  connect: jest.fn(), query: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../services/notification-service', () => ({
  notifyParcelScan: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../../db');
const { processScan, _assertCollectionScanAuthorized } = require('../../services/scan-engine');

const parcel = { id: 'p1', reference: 'P1', order_id: 'o1',
  status: 'available', relais_id: 'r1', relay_id: null };
const actor = { id: 'u1', role: 'agent_relais', relais_id: 'r1' };
const paidOrder = { id: 'o1', payment_status: 'paid', relais_id: 'r1' };
function fixture({ user = actor, orders = [paidOrder], pkg = parcel } = {}) {
  const sql = [];
  const client = {
    query: jest.fn(async (q) => {
      sql.push(q);
      if (String(q).includes('FROM users WHERE id')) return { rows: user ? [user] : [] };
      if (String(q).includes('FROM orders o') && String(q).includes('FOR SHARE OF o')) {
        return { rows: orders };
      }
      if (String(q).includes('SELECT p.*, o.reference')) return { rows: [pkg] };
      if (String(q).includes('SELECT pi.*, oi.product_id')) return { rows: [] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return { client, sql, params: { scanned_by: 'u1', parcel_id: 'p1', actor_role: 'relay_agent' } };
}
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [{ id: 'rejected-id' }] });
});

describe('RC-3/RC-4 — autorité de remise prouvée dans le moteur de scan', () => {
  test.each(['pending', 'partially_paid', 'failed', 'refunded'])(
    'RC-3 : commande %s non recevable, même pour agent du bon relais', async status => {
      const { client, params, sql } = fixture({
        orders: [{ ...paidOrder, payment_status: status }],
      });
      await expect(_assertCollectionScanAuthorized(client, params, parcel))
        .rejects.toMatchObject({ code: 'COLLECTION_PAYMENT_REQUIRED' });
      expect(sql.some(x => String(x).includes('FOR SHARE OF o'))).toBe(true);
    }
  );

  test('RC-3 : colis multi-commandes dont une seule non payée est bloqué', async () => {
    const { client, params } = fixture({ orders: [
      paidOrder, { id: 'o2', relais_id: 'r1', payment_status: 'pending' },
    ] });
    await expect(_assertCollectionScanAuthorized(client, params, parcel))
      .rejects.toMatchObject({ code: 'COLLECTION_PAYMENT_REQUIRED' });
  });

  test('RC-4 : agent d un autre relais non autorisé', async () => {
    const { client, params } = fixture({ user: { ...actor, relais_id: 'r2' } });
    await expect(_assertCollectionScanAuthorized(client, params, parcel))
      .rejects.toMatchObject({ code: 'COLLECTION_RELAY_FORBIDDEN' });
  });

  test('RC-4 : relais physique contradictoires => refus même si l agent correspond', async () => {
    const pkg = { ...parcel, relay_id: 'r2' };
    const { client, params } = fixture({ pkg });
    await expect(_assertCollectionScanAuthorized(client, params, pkg))
      .rejects.toMatchObject({ code: 'COLLECTION_RELAY_CONFLICT' });
  });

  test('RC-4 : commandes de plusieurs relais dans un même colis => refus', async () => {
    const { client, params } = fixture({ orders: [
      paidOrder, { id: 'o2', relais_id: 'r2', payment_status: 'paid' },
    ] });
    await expect(_assertCollectionScanAuthorized(client, params, parcel))
      .rejects.toMatchObject({ code: 'COLLECTION_RELAY_FORBIDDEN' });
  });

  test('le rôle client dans le body ne confère aucune autorisation : role en base', async () => {
    const { client, params } = fixture({ user: { ...actor, role: 'client' } });
    await expect(_assertCollectionScanAuthorized(client,
      { ...params, actor_role: 'admin' }, parcel))
      .rejects.toMatchObject({ code: 'COLLECTION_ACTOR_FORBIDDEN' });
  });

  test('sans identité agent en base : refus fermé', async () => {
    const { client, params } = fixture({ user: null });
    await expect(_assertCollectionScanAuthorized(client, params, parcel))
      .rejects.toMatchObject({ code: 'COLLECTION_ACTOR_FORBIDDEN' });
    await expect(_assertCollectionScanAuthorized(client,
      { ...params, scanned_by: null }, parcel))
      .rejects.toMatchObject({ code: 'COLLECTION_ACTOR_REQUIRED' });
  });

  test('nominal : commande payée, bon agent relais, accepte sans écrire', async () => {
    const { client, params, sql } = fixture();
    await expect(_assertCollectionScanAuthorized(client, params, parcel))
      .resolves.toBeUndefined();
    expect(sql).toHaveLength(2);
    expect(sql.every(x => String(x).trim().startsWith('SELECT'))).toBe(true);
  });

  test('nominal multi-commandes payées au même relais accepté', async () => {
    const { client, params } = fixture({ orders: [
      paidOrder, { id: 'o2', relais_id: 'r1', payment_status: 'paid' },
    ] });
    await expect(_assertCollectionScanAuthorized(client, params, parcel))
      .resolves.toBeUndefined();
  });

  test.each([
    ['RC-3', 'COLLECTION_PAYMENT_REQUIRED', { orders: [{ ...paidOrder, payment_status: 'pending' }] }],
    ['RC-4', 'COLLECTION_RELAY_FORBIDDEN', { user: { ...actor, relais_id: 'r2' } }],
  ])('%s : processScan lui-même rejette et rollback avant tout changement physique',
    async (_, code, options) => {
      const { client, params, sql } = fixture(options);
      db.connect.mockResolvedValue(client);
      const result = await processScan({ ...params, event_type: 'customer_collected' });
      expect(result).toMatchObject({ success: false, error: { code } });
      expect(sql).toContain('BEGIN');
      expect(sql).toContain('ROLLBACK');
      expect(sql).not.toContain('COMMIT');
      expect(sql.some(x => /^\s*(UPDATE|INSERT|DELETE)\s/i.test(String(x)))).toBe(false);
      expect(client.release).toHaveBeenCalledTimes(1);
    }
  );
});
