'use strict';

/**
 * Tests unitaires — services/repair-ordered-without-purchase-orders.js
 *
 * Objectif : couvrir la forme du corps de réponse de
 * POST /api/admin/purchasing/repair-ordered-without-pos (GOV-04 — dernière
 * route UNKNOWN du contrat OpenAPI hors refund). Source de vérité pour
 * KNOWN_RESPONSES dans scripts/contract-generate.js.
 */

jest.mock('../../db');
jest.mock('../../routes/purchasing', () => ({ triggerPurchasing: jest.fn() }));

const db = require('../../db');
const { triggerPurchasing } = require('../../routes/purchasing');
const { repairOrderedWithoutPurchaseOrders } = require('../../services/repair-ordered-without-purchase-orders');

const ADMIN = { id: 'admin-1', role: 'admin' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('repairOrderedWithoutPurchaseOrders', () => {
  test('rejette un non-admin (403)', async () => {
    const result = await repairOrderedWithoutPurchaseOrders({ user: { id: 'u1', role: 'client' } });
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Accès réservé admin' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rejette un appel sans user (403)', async () => {
    const result = await repairOrderedWithoutPurchaseOrders({});
    expect(result.status).toBe(403);
  });

  test('dry_run (défaut) : liste les candidats sans déclencher de sourcing', async () => {
    const candidates = [
      { id: 'o1', reference: 'KM-1', created_at: '2026-06-01', updated_at: '2026-06-02' },
    ];
    db.query.mockResolvedValue({ rows: candidates });

    const result = await repairOrderedWithoutPurchaseOrders({ user: ADMIN });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      dry_run: true,
      count: 1,
      candidates,
    });
    expect(triggerPurchasing).not.toHaveBeenCalled();
  });

  test('dry_run=false : relance le sourcing pour chaque candidat, 200 si tout réussit', async () => {
    const candidates = [
      { id: 'o1', reference: 'KM-1' },
      { id: 'o2', reference: 'KM-2' },
    ];
    db.query.mockResolvedValueOnce({ rows: candidates }); // SELECT candidates
    triggerPurchasing.mockResolvedValue({ created_pos: 1 });

    const result = await repairOrderedWithoutPurchaseOrders({ user: ADMIN, dryRun: false });

    expect(result.status).toBe(200);
    expect(result.body.dry_run).toBe(false);
    expect(result.body.scanned).toBe(2);
    expect(result.body.repaired_count).toBe(2);
    expect(result.body.failed_count).toBe(0);
    expect(result.body.repaired).toEqual([
      { order_id: 'o1', reference: 'KM-1', result: { created_pos: 1 } },
      { order_id: 'o2', reference: 'KM-2', result: { created_pos: 1 } },
    ]);
    expect(result.body.failed).toEqual([]);
    expect(triggerPurchasing).toHaveBeenCalledWith('o1');
    expect(triggerPurchasing).toHaveBeenCalledWith('o2');
  });

  test('dry_run=false : un échec partiel renvoie 207 et crée une alerte', async () => {
    const candidates = [{ id: 'o1', reference: 'KM-1' }];
    db.query.mockResolvedValueOnce({ rows: candidates }); // SELECT candidates
    triggerPurchasing.mockRejectedValue(new Error('sourcing down'));
    db.query.mockResolvedValueOnce({ rows: [] }); // INSERT INTO alerts

    const result = await repairOrderedWithoutPurchaseOrders({ user: ADMIN, dryRun: false });

    expect(result.status).toBe(207);
    expect(result.body.repaired_count).toBe(0);
    expect(result.body.failed_count).toBe(1);
    expect(result.body.failed).toEqual([
      { order_id: 'o1', reference: 'KM-1', error: 'sourcing down' },
    ]);

    const alertCall = db.query.mock.calls.find(c => /INSERT INTO alerts/.test(String(c[0])));
    expect(alertCall).toBeDefined();
    expect(alertCall[1]).toEqual(expect.arrayContaining(['purchasing_repair_failed', 'order', 'medium']));
    expect(alertCall[1][4]).toMatch(/KM-1/);
  });

  test('limit est borné entre 1 et 100', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await repairOrderedWithoutPurchaseOrders({ user: ADMIN, limit: 9999 });
    expect(db.query.mock.calls[0][1][0]).toBe(100);

    db.query.mockClear();
    await repairOrderedWithoutPurchaseOrders({ user: ADMIN, limit: -5 });
    expect(db.query.mock.calls[0][1][0]).toBe(1);
  });
});
