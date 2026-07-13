'use strict';

/**
 * tests/unit/verify-qr-collection.test.js
 * Couvre services/verify-qr-collection.js
 *
 * ⚠️ I-SWEEP-2 — Tout (transition orders→collected + invalidation QR + scan +
 * parcelSync) doit se faire dans UNE transaction (BEGIN/COMMIT explicites via
 * db.getClient()). Tester erreurs EN PREMIER, puis vérifier rollback systématique
 * sur chaque sortie anticipée.
 */

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockGetClient = jest.fn();
jest.mock('../../db', () => ({ getClient: (...args) => mockGetClient(...args) }));

const mockNotifyText = jest.fn();
jest.mock('../../services/notification-service', () => ({ notifyText: (...args) => mockNotifyText(...args) }));

const mockSafeSyncScanToParcels = jest.fn();
jest.mock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: (...args) => mockSafeSyncScanToParcels(...args) }));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args) }));

const mockPickupProofIssue = jest.fn();
jest.mock('../../services/documents/pickup-proof', () => ({ issue: (...args) => mockPickupProofIssue(...args) }));

const mockRecalculateLoyalty = jest.fn();
jest.mock('../../services/loyalty-service', () => ({ recalculateLoyalty: (...args) => mockRecalculateLoyalty(...args) }));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const { verifyQrCollection } = require('../../services/verify-qr-collection');

function baseOrder(overrides = {}) {
  return {
    id: 'o1',
    reference: 'CMD-1',
    status: 'available',
    qr_token: 'TOKEN-123',
    qr_expires_at: null,
    recipient_name: 'Ali Said',
    relais_name: 'Relais Moroni',
    user_phone: '+269300000',
    user_id: 'u-client-1',
    ...overrides,
  };
}

const VALID_USER = { id: 'agent-1', role: 'agent_relais' };

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifyText.mockResolvedValue({});
  mockSafeSyncScanToParcels.mockResolvedValue({ synced: true, parcelsUpdated: 1, orderStatus: 'collected' });
  mockTransitionOrderStatus.mockResolvedValue({ success: true, noop: false });
  mockPickupProofIssue.mockResolvedValue({});
  mockRecalculateLoyalty.mockResolvedValue({});
});

describe('verifyQrCollection — gardes d\'entrée', () => {
  it('token absent → 400, pas de connexion DB', async () => {
    const result = await verifyQrCollection({ orderId: 'o1', user: VALID_USER });
    expect(result).toEqual({ status: 400, body: { error: 'token est requis' } });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('user absent → throw, pas de connexion DB', async () => {
    await expect(verifyQrCollection({ token: 'T1', orderId: 'o1' }))
      .rejects.toThrow('[verifyQrCollection] user requis');
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('user sans id → throw', async () => {
    await expect(verifyQrCollection({ token: 'T1', orderId: 'o1', user: { role: 'agent_relais' } }))
      .rejects.toThrow('[verifyQrCollection] user requis');
  });

  it('user sans role → throw', async () => {
    await expect(verifyQrCollection({ token: 'T1', orderId: 'o1', user: { id: 'u1' } }))
      .rejects.toThrow('[verifyQrCollection] user requis');
  });
});

describe('verifyQrCollection — commande introuvable', () => {
  it('aucune ligne → 404, ROLLBACK, client libéré', async () => {
    const client = makeClient([{ rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result).toEqual({ status: 404, body: { error: 'Commande introuvable' } });
    expectTransactionRolledBack(client);
  });

  it('orderId fourni → SELECT filtré par o.id ET o.qr_token, FOR UPDATE', async () => {
    const client = makeClient([{ rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    const selectCall = client.calls.find(c => c.sql.includes('FROM orders'));
    expect(selectCall.sql).toContain('WHERE o.id = $1 AND o.qr_token = $2');
    expect(selectCall.sql).toContain('FOR UPDATE OF o');
    expect(selectCall.params).toEqual(['o1', 'TOKEN-123']);
  });

  it('orderId absent → SELECT uniquement par qr_token', async () => {
    const client = makeClient([{ rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    await verifyQrCollection({ token: 'TOKEN-123', user: VALID_USER });
    const selectCall = client.calls.find(c => c.sql.includes('FROM orders'));
    expect(selectCall.sql).toContain('WHERE o.qr_token = $1');
    expect(selectCall.sql).not.toContain('o.id = $1 AND');
    expect(selectCall.params).toEqual(['TOKEN-123']);
  });
});

describe('verifyQrCollection — statut incompatible', () => {
  it('status déjà collected → 422, message dédié, ROLLBACK', async () => {
    const client = makeClient([{ rows: [baseOrder({ status: 'collected' })] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result).toEqual({
      status: 422,
      body: { error: 'Ce colis a déjà été remis au client', current_status: 'collected' },
    });
    expectTransactionRolledBack(client);
  });

  it('autre statut (ex: in_transit) → 422, message générique avec statut', async () => {
    const client = makeClient([{ rows: [baseOrder({ status: 'in_transit' })] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result).toEqual({
      status: 422,
      body: { error: 'Statut incompatible : in_transit', current_status: 'in_transit' },
    });
  });
});

describe('verifyQrCollection — validation du QR', () => {
  it('aucun qr_token sur la commande → 400, ROLLBACK', async () => {
    const client = makeClient([{ rows: [baseOrder({ qr_token: null })] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result).toEqual({ status: 400, body: { error: 'Aucun QR code généré pour cette commande' } });
    expectTransactionRolledBack(client);
  });

  it('qr_expires_at dépassé → 400, expired_at renvoyé, ROLLBACK', async () => {
    const past = '2020-01-01T00:00:00.000Z';
    const client = makeClient([{ rows: [baseOrder({ qr_expires_at: past })] }]);
    mockGetClient.mockResolvedValue(client);

    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result).toEqual({
      status: 400,
      body: { error: 'QR code expiré — veuillez en générer un nouveau', expired_at: past },
    });
    expectTransactionRolledBack(client);
  });

  it('qr_expires_at dans le futur → ne bloque pas (passe à la transition)', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    const client = makeClient([
      { rows: [baseOrder({ qr_expires_at: future })] },
      { rows: [] }, // UPDATE qr_token/qr_expires_at
      { rows: [{ id: 'scan-1' }] }, // INSERT scans
    ]);
    mockGetClient.mockResolvedValue(client);

    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result.status).toBe(200);
  });
});

describe('verifyQrCollection — échec de la machine à états', () => {
  it('transitionOrderStatus échoue → 422, ROLLBACK, pas de scan/parcelSync', async () => {
    const client = makeClient([{ rows: [baseOrder()] }]);
    mockGetClient.mockResolvedValue(client);
    mockTransitionOrderStatus.mockResolvedValue({ success: false, error: 'commande verrouillée' });

    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result).toEqual({ status: 422, body: { error: 'commande verrouillée' } });
    expectTransactionRolledBack(client);
    expect(mockSafeSyncScanToParcels).not.toHaveBeenCalled();
  });

  it('appelle transitionOrderStatus avec actor/source/note/dbClient corrects', async () => {
    const client = makeClient([
      { rows: [baseOrder()] },
      { rows: [] },
      { rows: [{ id: 'scan-1' }] },
    ]);
    mockGetClient.mockResolvedValue(client);

    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith({
      orderId: 'o1',
      newStatus: 'collected',
      actor: { id: 'agent-1', role: 'agent_relais' },
      source: 'patch',
      note: 'Remise client via QR Code',
      dbClient: client,
    });
  });
});

describe('verifyQrCollection — nominal (succès transactionnel)', () => {
  function setupNominalClient(overrides = {}) {
    const order = baseOrder(overrides);
    const client = makeClient([
      { rows: [order] },
      { rows: [] }, // UPDATE orders qr_token/qr_expires_at
      { rows: [{ id: 'scan-1' }] }, // INSERT scans RETURNING id
    ]);
    mockGetClient.mockResolvedValue(client);
    return { client, order };
  }

  it('succès → 200, COMMIT, client libéré', async () => {
    const { client } = setupNominalClient();
    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({
      success: true,
      message: 'Remise enregistrée avec succès',
      reference: 'CMD-1',
      recipient: 'Ali Said',
      relais: 'Relais Moroni',
    }));
    expect(typeof result.body.collected_at).toBe('string');
    expectTransactionCommitted(client);
  });

  it('invalide le QR (qr_token/qr_expires_at remis à NULL)', async () => {
    const { client } = setupNominalClient();
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    const updateCall = client.calls.find(c => c.sql.includes('UPDATE orders SET qr_token'));
    expect(updateCall.sql).toContain('qr_token = NULL, qr_expires_at = NULL');
    expect(updateCall.params).toEqual(['o1']);
  });

  it('insère un scan "collected" avec scan_code tronqué (8 premiers caractères du token)', async () => {
    const { client } = setupNominalClient({ qr_token: 'TOKEN-123456789' });
    await verifyQrCollection({ token: 'TOKEN-123456789', orderId: 'o1', user: VALID_USER });
    const scanInsert = client.calls.find(c => c.sql.includes('INSERT INTO scans'));
    expect(scanInsert.sql).toContain("'collected'");
    expect(scanInsert.params).toEqual(['o1', 'agent-1', 'Relais Moroni', 'QR-TOKEN-12']);
  });

  it('relais_name absent → chaîne vide dans le scan', async () => {
    const { client } = setupNominalClient({ relais_name: null });
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    const scanInsert = client.calls.find(c => c.sql.includes('INSERT INTO scans'));
    expect(scanInsert.params[2]).toBe('');
  });

  it('appelle safeSyncScanToParcels avec le scan_id et le client transactionnel', async () => {
    setupNominalClient();
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockSafeSyncScanToParcels).toHaveBeenCalledWith(
      {
        order_id: 'o1',
        step: 'collected',
        scan_id: 'scan-1',
        scanned_by: 'agent-1',
        notes: 'Retrait client via QR Code — token validé',
      },
      expect.anything(),
    );
  });

  it('émet la preuve de retrait après COMMIT (non bloquant)', async () => {
    setupNominalClient();
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockPickupProofIssue).toHaveBeenCalledWith('o1', { issuedBy: 'agent-1' });
  });

  it('échec de la preuve de retrait → ne fait pas échouer la requête (catch silencieux)', async () => {
    setupNominalClient();
    mockPickupProofIssue.mockRejectedValue(new Error('pdf service down'));
    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result.status).toBe(200);
  });

  it('user_phone présent → notifyText appelé avec le message de remise', async () => {
    setupNominalClient();
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockNotifyText).toHaveBeenCalledWith(
      '+269300000',
      expect.stringContaining('CMD-1'),
      'collected',
      'o1',
    );
  });

  it('user_phone absent → notifyText non appelé', async () => {
    setupNominalClient({ user_phone: null });
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockNotifyText).not.toHaveBeenCalled();
  });

  it('recipient_name absent → message de notification utilise le fallback "le destinataire"', async () => {
    setupNominalClient({ recipient_name: null });
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockNotifyText).toHaveBeenCalledWith(
      '+269300000',
      expect.stringContaining('le destinataire'),
      'collected',
      'o1',
    );
  });

  it('échec de notifyText → non bloquant, réponse toujours 200', async () => {
    setupNominalClient();
    mockNotifyText.mockRejectedValue(new Error('sms gateway down'));
    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result.status).toBe(200);
  });

  it('user_id présent → recalcule la fidélité (non bloquant)', async () => {
    setupNominalClient();
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockRecalculateLoyalty).toHaveBeenCalledWith(expect.anything(), 'u-client-1');
  });

  it('user_id absent → pas de recalcul fidélité', async () => {
    setupNominalClient({ user_id: null });
    await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(mockRecalculateLoyalty).not.toHaveBeenCalled();
  });

  it('échec du recalcul fidélité → non bloquant, réponse toujours 200', async () => {
    setupNominalClient();
    mockRecalculateLoyalty.mockRejectedValue(new Error('loyalty service down'));
    const result = await verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER });
    expect(result.status).toBe(200);
  });
});

describe('verifyQrCollection — robustesse transactionnelle', () => {
  it('erreur inattendue pendant la transaction → ROLLBACK puis re-throw, client libéré', async () => {
    const client = makeClient([{ error: new Error('db cassée') }]);
    mockGetClient.mockResolvedValue(client);

    await expect(verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER }))
      .rejects.toThrow('db cassée');
    expectTransactionRolledBack(client);
  });

  it("le ROLLBACK lui-même échoue → l'erreur d'origine est tout de même propagée, client libéré", async () => {
    const client = makeClient([{ error: new Error('db cassée') }]);
    client.query = jest.fn(async (sql) => {
      client.calls.push({ sql, params: [] });
      const normalized = String(sql).trim();
      if (normalized === 'BEGIN') return { rows: [] };
      if (normalized === 'ROLLBACK') throw new Error('rollback impossible');
      throw new Error('db cassée');
    });
    mockGetClient.mockResolvedValue(client);

    await expect(verifyQrCollection({ token: 'TOKEN-123', orderId: 'o1', user: VALID_USER }))
      .rejects.toThrow('db cassée');
    expect(client.release).toHaveBeenCalled();
  });
});
