'use strict';

/**
 * Tests unitaires — services/scan-operations.js (REFACTO-R3)
 *
 * Couverture :
 *   recordScan    — nominal, scan_code KOM-ITEM, step invalide, role refusé, 404 commande
 *   collectParcel — nominal, code invalide (404), cross-relais refus, brute-force block,
 *                   agent sans relais_id
 *   verifyQr      — nominal, token invalide, expiré, statut incompatible, machine fail
 *   triggerScan3  — nominal, statut non preparation (skip)
 */

jest.mock('../../db');
jest.mock('../../utils/parcelSync');
jest.mock('../../services/notification-service');
jest.mock('../../services/order-status-machine');

const db                       = require('../../db');
const { safeSyncScanToParcels, STEP_TO_ORDER_STATUS } = require('../../utils/parcelSync');
const { notifyText }           = require('../../services/notification-service');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const scanOps                  = require('../../services/scan-operations');

// STEP_TO_ORDER_STATUS est utilisé dans les fallbacks
STEP_TO_ORDER_STATUS.shipped   = 'shipped';
STEP_TO_ORDER_STATUS.collected = 'collected';

function makeClient(responses = []) {
  let i = 0;
  return {
    query:   jest.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? { rows: [], rowCount: 0 })),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  safeSyncScanToParcels.mockResolvedValue({ synced: true });
  notifyText.mockResolvedValue(true);
  transitionOrderStatus.mockResolvedValue({ success: true });
});

// ─── recordScan ───────────────────────────────────────────────────────────────

describe('recordScan', () => {
  const user = { id: 'u1', role: 'agent_hub' };

  test('nominal — scan par référence commande, step shipped → 201', async () => {
    const scan = { id: 's1', order_id: 'o1' };
    const client = makeClient([
      {},                          // BEGIN
      { rows: [{ id: 'o1' }] },   // SELECT orders WHERE reference
      { rows: [scan] },            // INSERT scans
      {},                          // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [{ status: 'shipped', reference: 'KOM-001' }] });

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'shipped' }, user, null);

    expect(result.status).toBe(201);
    expect(result.body.step).toBe('shipped');
    expect(safeSyncScanToParcels).toHaveBeenCalled();
  });

  test('scan KOM-ITEM — résout order_item_id', async () => {
    const client = makeClient([
      {},                                                      // BEGIN
      { rows: [{ id: 'item1', order_id: 'o1' }] },           // SELECT order_items
      { rows: [{ id: 's2', order_id: 'o1' }] },              // INSERT scans
      {},                                                      // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [{ status: 'preparation', reference: 'KOM-001' }] });

    const result = await scanOps.recordScan({ scan_code: 'KOM-ITEM-XYZ', step: 'preparation' }, user, 'device-abc');
    expect(result.status).toBe(201);
  });

  test('step invalide → 400, pas de DB', async () => {
    const result = await scanOps.recordScan({ scan_code: 'KOM-001', step: 'collected' }, user, null);
    expect(result.status).toBe(400);
    expect(db.getClient).not.toHaveBeenCalled();
  });

  test('role non autorisé pour l\'étape → 403', async () => {
    const agentRelais = { id: 'u2', role: 'agent_relais' };
    const result = await scanOps.recordScan({ scan_code: 'KOM-001', step: 'shipped' }, agentRelais, null);
    expect(result.status).toBe(403);
  });

  test('commande introuvable → 404 + ROLLBACK', async () => {
    const client = makeClient([{}, { rows: [] }, {}]); // BEGIN, SELECT vide, ROLLBACK
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.recordScan({ scan_code: 'KOM-INCONNU', step: 'shipped' }, user, null);
    expect(result.status).toBe(404);
  });

  test('scan_code et step manquants → 400', async () => {
    const result = await scanOps.recordScan({}, user, null);
    expect(result.status).toBe(400);
    expect(db.getClient).not.toHaveBeenCalled();
  });
});

// ─── collectParcel ────────────────────────────────────────────────────────────

describe('collectParcel', () => {
  const agentRelais = { id: 'u3', role: 'agent_relais' };
  const admin       = { id: 'u0', role: 'admin' };
  const order = {
    id: 'o1', reference: 'KOM-001', relais_id: 'r1', relais_name: 'Relais A',
    recipient_name: 'Jean Dupont', status: 'available',
    pickup_secret_attempts: 0, pickup_secret_blocked_until: null,
  };

  test('nominal admin — retrait enregistré → 200', async () => {
    const client = makeClient([
      {},                    // BEGIN
      { rows: [order] },     // SELECT orders FOR UPDATE
      { rows: [{ id: 's1' }] }, // INSERT scans
      {},                    // UPDATE reset attempts
      {},                    // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [{ user_phone: '+269123456' }] });

    const result = await scanOps.collectParcel({ pickup_code: '123456' }, admin, '127.0.0.1', 'UA');
    expect(result.status).toBe(200);
    expect(result.body.reference).toBe('KOM-001');
  });

  test('code invalide → 404 + log alert', async () => {
    const client = makeClient([{}, { rows: [] }, {}]); // BEGIN, SELECT vide, ROLLBACK
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] }); // alert INSERT

    const result = await scanOps.collectParcel({ pickup_code: '000000' }, agentRelais, '1.2.3.4', 'UA');
    expect(result.status).toBe(404);
  });

  test('commande bloquée anti-brute-force → 429', async () => {
    const blockedOrder = { ...order, pickup_secret_blocked_until: new Date(Date.now() + 60000).toISOString() };
    const client = makeClient([{}, { rows: [blockedOrder] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.collectParcel({ pickup_code: '123456' }, agentRelais, '1.2.3.4', 'UA');
    expect(result.status).toBe(429);
    expect(result.body.blocked_until).toBeDefined();
  });

  test('cross-relais refus — agent mauvais relais → 403', async () => {
    // agent affecté à relais r2, commande sur relais r1
    const client = makeClient([
      {},                                  // BEGIN
      { rows: [order] },                   // SELECT orders FOR UPDATE
      { rows: [{ relais_id: 'r2' }] },    // SELECT users.relais_id
      {},                                  // ROLLBACK
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] }); // UPDATE attempts + alert INSERT

    const result = await scanOps.collectParcel({ pickup_code: '123456' }, agentRelais, '1.2.3.4', 'UA');
    expect(result.status).toBe(403);
    expect(result.body.attempts).toBe(1);
  });

  test('agent sans relais_id → 403', async () => {
    const client = makeClient([
      {},
      { rows: [order] },
      { rows: [{ relais_id: null }] }, // relais_id null
      {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });

    const result = await scanOps.collectParcel({ pickup_code: '123456' }, agentRelais, '1.2.3.4', 'UA');
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch('incomplète');
  });

  test('pickup_code manquant → 400', async () => {
    const result = await scanOps.collectParcel({}, agentRelais, '1.2.3.4', 'UA');
    expect(result.status).toBe(400);
    expect(db.getClient).not.toHaveBeenCalled();
  });
});

// ─── verifyQr ─────────────────────────────────────────────────────────────────

describe('verifyQr', () => {
  const user  = { id: 'u1', role: 'agent_relais' };
  const token = 'tok-valid-123';
  const order = {
    id: 'o1', reference: 'KOM-001', status: 'available',
    qr_token: token, qr_expires_at: null,
    recipient_name: 'Marie', relais_name: 'Relais B',
    user_phone: '+269000000', user_id: 'uid1',
  };

  test('nominal — remise enregistrée → 200', async () => {
    const client = makeClient([
      {},                    // BEGIN
      { rows: [order] },     // SELECT order par token
      {},                    // UPDATE qr_token = NULL
      { rows: [{ id: 'sc1' }] }, // INSERT scans
      {},                    // COMMIT
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token }, user);
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'collected' }));
  });

  test('token manquant → 400', async () => {
    const result = await scanOps.verifyQr({}, user);
    expect(result.status).toBe(400);
    expect(db.getClient).not.toHaveBeenCalled();
  });

  test('commande introuvable → 404', async () => {
    const client = makeClient([{}, { rows: [] }]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token: 'bad' }, user);
    expect(result.status).toBe(404);
  });

  test('statut pas "available" → 422', async () => {
    const collectedOrder = { ...order, status: 'collected' };
    const client = makeClient([{}, { rows: [collectedOrder] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token }, user);
    expect(result.status).toBe(422);
    expect(result.body.error).toMatch('déjà été remis');
  });

  test('QR expiré → 400', async () => {
    const expiredOrder = { ...order, qr_expires_at: new Date(Date.now() - 1000).toISOString() };
    const client = makeClient([{}, { rows: [expiredOrder] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token }, user);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch('expiré');
  });

  test('machine retourne erreur → 422', async () => {
    transitionOrderStatus.mockResolvedValue({ success: false, error: 'Transition refusée' });
    const client = makeClient([{}, { rows: [order] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token }, user);
    expect(result.status).toBe(422);
    expect(result.body.error).toBe('Transition refusée');
  });

  test('recherche avec order_id + token', async () => {
    const client = makeClient([
      {},
      { rows: [order] },
      {},
      { rows: [{ id: 'sc2' }] },
      {},
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token, order_id: 'o1' }, user);
    expect(result.status).toBe(200);
    // La query doit inclure o.id = $1 AND o.qr_token = $2
    const queryArg = client.query.mock.calls[1][1];
    expect(queryArg).toContain('o1');
    expect(queryArg).toContain(token);
  });
});

// ─── triggerScan3 ─────────────────────────────────────────────────────────────

describe('triggerScan3', () => {
  test('nominal — commande en preparation → success + notification', async () => {
    const order = {
      id: 'o1', reference: 'KOM-001', status: 'preparation',
      client_phone: '+269111', first_name: 'Ali',
    };
    db.query
      .mockResolvedValueOnce({ rows: [order] })   // SELECT order
      .mockResolvedValueOnce({ rows: [{ id: 'sc1' }] }); // INSERT scans

    const result = await scanOps.triggerScan3('o1', 'agent1');
    expect(result.success).toBe(true);
    expect(notifyText).toHaveBeenCalledWith('+269111', expect.stringContaining('KOM-001'), 'preparation', 'o1');
    expect(safeSyncScanToParcels).toHaveBeenCalled();
  });

  test('commande pas en preparation → skipped', async () => {
    const order = { id: 'o1', reference: 'KOM-001', status: 'shipped', client_phone: '+269111', first_name: 'Ali' };
    db.query.mockResolvedValueOnce({ rows: [order] });

    const result = await scanOps.triggerScan3('o1');
    expect(result.skipped).toBe(true);
    expect(notifyText).not.toHaveBeenCalled();
    expect(safeSyncScanToParcels).not.toHaveBeenCalled();
  });

  test('commande introuvable → throw', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(scanOps.triggerScan3('inconnu')).rejects.toThrow('introuvable');
  });
});
