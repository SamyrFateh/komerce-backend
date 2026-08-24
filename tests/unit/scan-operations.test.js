'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/scan-operations.js (REFACTO-R3)
 *
 * Couverture :
 *   recordScan    — nominal, scan_code KOM-ITEM, step invalide, role refusé, 404 commande
 *   collectParcel — façade mince (Lot 2C) : délègue la logique métier (résolution
 *                   par hash salé, anti-fraude cross-relais, brute-force, remise
 *                   atomique) à services/pickup-secret-service.js::collectByPickupCode
 *                   (couverte exhaustivement dans pickup-secret-service.test.js).
 *                   Ce fichier ne teste que le contrat de délégation : forwarding
 *                   des paramètres, passthrough des erreurs métier, traduction de
 *                   la réponse HTTP et notification post-commit du commanditaire.
 *   verifyQr      — nominal, token invalide, expiré, statut incompatible, machine fail
 *   triggerScan3  — nominal, statut non preparation (skip)
 */

jest.mock('../../db');
jest.mock('../../utils/parcelSync');
jest.mock('../../services/notification-service');
jest.mock('../../services/order-status-machine');
jest.mock('../../services/loyalty-service', () => ({ recalculateLoyalty: jest.fn().mockResolvedValue() }), { virtual: true });

const mockCollectByPickupCode = jest.fn();
jest.mock('../../services/pickup-secret-service', () => ({
  collectByPickupCode: (...args) => mockCollectByPickupCode(...args),
}));

const db                       = require('../../db');
const { safeSyncScanToParcels, STEP_TO_ORDER_STATUS } = require('../../utils/parcelSync');
const { notifyText, appendRelayLocation } = require('../../services/notification-service');
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
  appendRelayLocation.mockImplementation(
    (...args) => require('../../services/notifications/relay-location').appendRelayLocation(...args),
  );
  transitionOrderStatus.mockResolvedValue({ success: true });
});

const flushPromises = () => new Promise(setImmediate);

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

  test('KOM-ITEM introuvable → 404 + ROLLBACK', async () => {
    const client = makeClient([{}, { rows: [] }, {}]); // BEGIN, SELECT order_items vide, ROLLBACK
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.recordScan({ scan_code: 'KOM-ITEM-XYZ', step: 'preparation' }, user, null);
    expect(result.status).toBe(404);
    expect(result.body.error).toMatch(/Article introuvable/);
  });

  test('appelle transitionOrderStatus si le sync colis a échoué (synced=false)', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [{ status: 'shipped', reference: 'KOM-001' }] });
    safeSyncScanToParcels.mockResolvedValueOnce({ synced: false });

    await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'shipped' }, user, null);

    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'shipped', source: 'scan' }));
  });

  test('is_anomaly=true → déclenche la notification anomalie aux admins', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'preparation', reference: 'KOM-001' }] }) // post-commit select
      .mockResolvedValueOnce({ rows: [{ phone: '+269900000' }] }); // _notifyAnomaly admins

    const result = await scanOps.recordScan(
      { scan_code: 'KOM-2026-001', step: 'preparation', is_anomaly: true, notes: 'colis abîmé' },
      user, null
    );
    await flushPromises();

    expect(result.body.is_anomaly).toBe(true);
    expect(result.body.sms_triggered).toBe(false);
    expect(notifyText).toHaveBeenCalledWith('+269900000', expect.stringContaining('Anomalie'), 'anomaly_alert', 'o1');
  });

  test('notification "shipped" avec téléphone présent → sms_triggered=true', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [{ user_phone: '+269111111' }] });

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'shipped' }, user, null);

    expect(result.body.sms_triggered).toBe(true);
    expect(notifyText).toHaveBeenCalledWith('+269111111', expect.stringContaining('remise au transitaire'), 'shipped', 'o1');
  });

  test('notification "in_transit" avec téléphone présent → sms_triggered=true', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'in_transit', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [{ user_phone: '+269222222' }] });

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'in_transit' }, user, null);

    expect(result.body.sms_triggered).toBe(true);
    expect(notifyText).toHaveBeenCalledWith('+269222222', expect.stringContaining('embarquée'), 'in_transit', 'o1');
  });

  test('notification "relais_received" avec téléphone destinataire présent → sms_triggered=true', async () => {
    const agentRelais = { id: 'u4', role: 'agent_relais' };
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'available', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [{ pickup_secret_last4: '56AB', pickup_code_phone: '+269333333', pickup_code_name: 'Jean', relais_name: 'Relais A', relais_address: 'Moroni' }] });

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'relais_received' }, agentRelais, null);

    expect(result.body.sms_triggered).toBe(true);
    expect(notifyText).toHaveBeenCalledWith('+269333333', expect.stringContaining('disponible'), 'available', 'o1');
    expect(notifyText.mock.calls[0][1]).toContain('https://www.google.com/maps/search/?api=1&query=');
    const recipientQuery = db.query.mock.calls[1][0];
    expect(recipientQuery).toMatch(/pickup_code_recipient_user_id/);
    expect(recipientQuery).toMatch(/COALESCE\(pcu\.phone, rc\.phone\)/);
  });

  test('rollback et propage l\'erreur si une requete echoue', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'o1' }] }) // SELECT orders
        .mockRejectedValueOnce(new Error('insert failed')) // INSERT scans
        .mockResolvedValueOnce({}), // ROLLBACK
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);

    await expect(scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'shipped' }, user, null)).rejects.toThrow('insert failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('notification "shipped" échoue → catch géré silencieusement', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [{ user_phone: '+269111111' }] });
    notifyText.mockRejectedValueOnce(new Error('sms down'));

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'shipped' }, user, null);
    await flushPromises();

    expect(result.body.sms_triggered).toBe(true);
  });

  test('notification "in_transit" échoue → catch géré silencieusement', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'in_transit', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [{ user_phone: '+269222222' }] });
    notifyText.mockRejectedValueOnce(new Error('sms down'));

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'in_transit' }, user, null);
    await flushPromises();

    expect(result.body.sms_triggered).toBe(true);
  });

  test('notification "relais_received" échoue → catch géré silencieusement', async () => {
    const agentRelais = { id: 'u4', role: 'agent_relais' };
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'available', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [{ pickup_secret_last4: '56AB', pickup_code_phone: '+269333333', pickup_code_name: 'Jean', relais_name: 'Relais A', relais_address: 'Moroni' }] });
    notifyText.mockRejectedValueOnce(new Error('sms down'));

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'relais_received' }, agentRelais, null);
    await flushPromises();

    expect(result.body.sms_triggered).toBe(true);
  });

  test('_notifyPostScan : erreur DB interne → catch global, sms_triggered=false', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', reference: 'KOM-001' }] })
      .mockRejectedValueOnce(new Error('db down dans notifyPostScan'));

    const result = await scanOps.recordScan({ scan_code: 'KOM-2026-001', step: 'shipped' }, user, null);

    expect(result.body.sms_triggered).toBe(false);
  });

  test('is_anomaly=true avec échec d\'envoi à un admin → catch géré silencieusement', async () => {
    const client = makeClient([
      {}, { rows: [{ id: 'o1' }] }, { rows: [{ id: 's1', order_id: 'o1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    db.query
      .mockResolvedValueOnce({ rows: [{ status: 'preparation', reference: 'KOM-001' }] })
      .mockResolvedValueOnce({ rows: [{ phone: '+269900000' }] });
    notifyText.mockRejectedValueOnce(new Error('sms down'));

    const result = await scanOps.recordScan(
      { scan_code: 'KOM-2026-001', step: 'preparation', is_anomaly: true, notes: 'colis abîmé' },
      user, null
    );
    await flushPromises();

    expect(result.body.is_anomaly).toBe(true);
  });
});

// ─── collectParcel ────────────────────────────────────────────────────────────

describe('collectParcel', () => {
  const agentRelais = { id: 'u3', role: 'agent_relais' };
  const admin       = { id: 'u0', role: 'admin' };

  function successBody(overrides = {}) {
    return {
      success: true, order_id: 'o1', reference: 'KOM-001',
      recipient: 'Jean Dupont', relais: 'Relais A',
      collected_at: '2026-07-31T00:00:00.000Z',
      ...overrides,
    };
  }

  test('délègue à collectByPickupCode avec code/user/ip/userAgent', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 200, body: successBody() });
    db.query.mockResolvedValue({ rows: [{ user_phone: '+269123456' }] });

    await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, admin, '127.0.0.1', 'UA');

    expect(mockCollectByPickupCode).toHaveBeenCalledWith({
      code: 'A7K3M9P2', user: admin, ip: '127.0.0.1', userAgent: 'UA',
    });
  });

  test('succès (200) — traduit la réponse, masque order_id, déclenche la notification', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 200, body: successBody() });
    db.query.mockResolvedValue({ rows: [{ user_phone: '+269123456' }] });

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, admin, '127.0.0.1', 'UA');

    expect(result.status).toBe(200);
    expect(result.body.reference).toBe('KOM-001');
    expect(result.body.recipient).toBe('Jean Dupont');
    expect(result.body.order_id).toBeUndefined(); // jamais exposé au contrat HTTP public
    expect(notifyText).toHaveBeenCalledWith(
      '+269123456',
      expect.stringContaining('KOM-001'),
      'collected', 'o1'
    );
  });

  test('succès mais commanditaire sans téléphone → pas de notification, toujours 200', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 200, body: successBody() });
    db.query.mockResolvedValue({ rows: [{ user_phone: null }] });

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, admin, '127.0.0.1', 'UA');

    expect(result.status).toBe(200);
    expect(notifyText).not.toHaveBeenCalled();
  });

  test('notification commanditaire échoue → catch géré silencieusement, réponse déjà 200', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 200, body: successBody() });
    db.query.mockResolvedValue({ rows: [{ user_phone: '+269123456' }] });
    notifyText.mockRejectedValueOnce(new Error('sms provider down'));

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, admin, '127.0.0.1', 'UA');
    await flushPromises();

    expect(result.status).toBe(200);
  });

  test('code invalide (400 format) → passthrough intact, pas de lookup notification', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 400, body: { error: 'Code de retrait invalide — format attendu : 8 caractères (tirets de présentation autorisés)' } });

    const result = await scanOps.collectParcel({ pickup_code: '123456' }, agentRelais, '1.2.3.4', 'UA');

    expect(result.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('code introuvable (404) → passthrough intact', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 404, body: { error: 'Code de retrait introuvable ou déjà utilisé' } });

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, agentRelais, '1.2.3.4', 'UA');

    expect(result.status).toBe(404);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('commande bloquée anti-brute-force (429) → passthrough intact', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({
      status: 429,
      body: { error: 'Trop de tentatives. Réessayez dans 15 min.', blocked_until: '2026-07-31T01:00:00.000Z' },
    });

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, agentRelais, '1.2.3.4', 'UA');

    expect(result.status).toBe(429);
    expect(result.body.blocked_until).toBeDefined();
  });

  test('secret expiré (410) → passthrough intact', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 410, body: { error: 'Code expiré. Escalade admin nécessaire.' } });

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, admin, '127.0.0.1', 'UA');

    expect(result.status).toBe(410);
  });

  test('cross-relais refusé (403) → passthrough intact, corps métier (attempts) préservé', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({
      status: 403,
      body: { error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider', attempts: 1 },
    });

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, agentRelais, '1.2.3.4', 'UA');

    expect(result.status).toBe(403);
    expect(result.body.attempts).toBe(1);
  });

  test('agent_relais sans relais_id (403 configuration incomplète) → passthrough intact', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({
      status: 403,
      body: { error: 'Configuration agent incomplète — contactez un admin' },
    });

    const result = await scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, agentRelais, '1.2.3.4', 'UA');

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch('incomplète');
  });

  test('la requête de lookup notification échoue → propage l\'erreur (pas de swallow silencieux)', async () => {
    mockCollectByPickupCode.mockResolvedValueOnce({ status: 200, body: successBody() });
    db.query.mockRejectedValueOnce(new Error('db timeout'));

    await expect(
      scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, admin, '127.0.0.1', 'UA')
    ).rejects.toThrow('db timeout');
  });

  test('erreur métier propagée par collectByPickupCode (ex: rollback transactionnel) → propage', async () => {
    mockCollectByPickupCode.mockRejectedValueOnce(new Error('parcelSync down'));

    await expect(
      scanOps.collectParcel({ pickup_code: 'A7K3M9P2' }, admin, '127.0.0.1', 'UA')
    ).rejects.toThrow('parcelSync down');
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

  test('P5-L5 : le SELECT verrouille la ligne (FOR UPDATE) — absent avant l\'extraction du noyau partagé', async () => {
    const client = makeClient([
      {}, { rows: [order] }, {}, { rows: [{ id: 'sc1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);

    await scanOps.verifyQr({ token }, user);
    const selectCall = client.query.mock.calls.find(c => String(c[0]).includes('FROM orders'));
    expect(String(selectCall[0])).toContain('FOR UPDATE OF o');
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

  test('aucun qr_token généré pour la commande → 400', async () => {
    const noTokenOrder = { ...order, qr_token: null };
    const client = makeClient([{}, { rows: [noTokenOrder] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token }, user);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Aucun QR code/);
  });

  test('token ne correspond pas au qr_token de la commande → 400', async () => {
    const client = makeClient([{}, { rows: [order] }, {}]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token: 'un-autre-token' }, user);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/QR code invalide/);
  });

  test('recalcule la fidélité si order.user_id est présent (non bloquant)', async () => {
    const { recalculateLoyalty } = require('../../services/loyalty-service');
    const client = makeClient([
      {}, { rows: [order] }, {}, { rows: [{ id: 'sc1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);

    await scanOps.verifyQr({ token }, user);
    await flushPromises();

    expect(recalculateLoyalty).toHaveBeenCalledWith(db, 'uid1');
  });

  test('rollback et propage l\'erreur si une requete echoue', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [order] }) // SELECT order par token
        .mockRejectedValueOnce(new Error('update failed')), // UPDATE qr_token
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);

    await expect(scanOps.verifyQr({ token }, user)).rejects.toThrow('update failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('notification commanditaire echoue → catch géré silencieusement', async () => {
    const client = makeClient([
      {}, { rows: [order] }, {}, { rows: [{ id: 'sc1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);
    notifyText.mockRejectedValueOnce(new Error('sms provider down'));

    const result = await scanOps.verifyQr({ token }, user);
    await flushPromises();

    expect(result.status).toBe(200);
  });

  test('échec du recalcul de fidélité → catch géré silencieusement', async () => {
    const { recalculateLoyalty } = require('../../services/loyalty-service');
    recalculateLoyalty.mockRejectedValueOnce(new Error('loyalty engine down'));
    const client = makeClient([
      {}, { rows: [order] }, {}, { rows: [{ id: 'sc1' }] }, {},
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await scanOps.verifyQr({ token }, user);
    await flushPromises();

    expect(result.status).toBe(200);
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

  test('échec du log INSERT scans → géré silencieusement, pas de sync', async () => {
    const order = {
      id: 'o1', reference: 'KOM-001', status: 'preparation',
      client_phone: '+269111', first_name: 'Ali',
    };
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockRejectedValueOnce(new Error('insert failed'));

    const result = await scanOps.triggerScan3('o1', 'agent1');

    expect(result.success).toBe(true);
    expect(safeSyncScanToParcels).not.toHaveBeenCalled();
  });

  test('échec de la notification préparation → catch géré silencieusement', async () => {
    const order = {
      id: 'o1', reference: 'KOM-001', status: 'preparation',
      client_phone: '+269111', first_name: 'Ali',
    };
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 'sc1' }] });
    notifyText.mockRejectedValueOnce(new Error('sms provider down'));

    const result = await scanOps.triggerScan3('o1', 'agent1');
    await flushPromises();

    expect(result.success).toBe(true);
  });
});
