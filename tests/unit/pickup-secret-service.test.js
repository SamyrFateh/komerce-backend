'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/pickup-secret-service.js (Lot B6)
 *
 * Le secret de retrait ne peut pas avoir de régression — ce fichier couvre
 * les 11 fonctions exportées, en mockant db.js (jest.mock automock).
 *
 * Couverture :
 *   helpers          — generatePickupCode, hashCode, normalizeCode
 *   generateAndStoreSecret — anti-collision, saturation, extraUpdates
 *   cacheCodeForReveal     — INSERT ON CONFLICT
 *   issuePrintToken        — token + INSERT pickup_print_tokens
 *   getReceiptHTML         — token manquant / invalide / commande introuvable / nominal
 *   verifyPickupCode       — code requis / commande introuvable / pas de code / bloqué / expiré /
 *                            format invalide / mode court / mode complet / échec+compteur / succès
 *   collectOrder           — introuvable / déjà collecté / transition échouée / nominal
 *   regenerateCode         — motif manquant / introuvable / saturation / nominal
 *   getPickupStatus        — introuvable / nominal (masquage last4)
 *   revealOnce             — introuvable / ownership / pending / déjà révélé / expiré / cache absent / nominal
 */

jest.mock('../../db', () => {
  const query = jest.fn();
  return {
    query,
    // withTransaction(cb) appelle cb({ query }) avec LE MÊME mock que
    // db.query : les tests existants qui empilent des mockResolvedValueOnce
    // sur db.query et inspectent db.query.mock.calls continuent de
    // fonctionner à l'identique, que le code sous test passe par db.query
    // directement ou par client.query à l'intérieur d'une transaction.
    withTransaction: jest.fn((cb) => cb({ query })),
  };
});
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockSafeSyncScanToParcels = jest.fn();
jest.mock('../../utils/parcelSync', () => ({
  safeSyncScanToParcels: (...args) => mockSafeSyncScanToParcels(...args),
  STEP_TO_ORDER_STATUS: { collected: 'collected' },
}));

const mockCreateAlert = jest.fn(() => Promise.resolve());
jest.mock('../../utils/alerts', () => ({
  createAlert: (...args) => mockCreateAlert(...args),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const mockBuildReceiptHTML = jest.fn(() => '<html>reçu</html>');
jest.mock('../../utils/pickup-receipt-html', () => ({
  buildReceiptHTML: (...args) => mockBuildReceiptHTML(...args),
  escapeHTML: (s) => s,
}));

// Lot 5 — autorisation nominative de retrait exceptionnel. auth-identity
// n'est consommée que via cette API interne, jamais de requête directe sur
// user_pickup_authorizations (cf. features/auth-identity.feature.js).
const mockGetActiveAuthorizationForUpdate = jest.fn();
const mockHasActiveAuthorization          = jest.fn();
jest.mock('../../services/pickup-authorization-service', () => ({
  getActiveAuthorizationForUpdate: (...args) => mockGetActiveAuthorizationForUpdate(...args),
  hasActiveAuthorization:          (...args) => mockHasActiveAuthorization(...args),
}));

const mockNotifyText = jest.fn(() => Promise.resolve({ ok: true }));
jest.mock('../../services/notifications/notification-service', () => ({
  notifyText: (...args) => mockNotifyText(...args),
}));

const db = require('../../db');

const {
  generatePickupCode,
  hashCode,
  normalizeCode,
  generateAndStoreSecret,
  cacheCodeForReveal,
  issuePrintToken,
  getReceiptHTML,
  verifyPickupCode,
  collectOrder,
  collectByPickupCode,
  regenerateCode,
  getPickupStatus,
  revealOnce,
  getExceptionalPickupAvailability,
  collectByAuthorizedName,
} = require('../../services/pickup-secret-service');

beforeEach(() => {
  // clearAllMocks ne vide pas les files mockResolvedValueOnce.
  // Chaque test doit repartir avec un double SQL réellement vierge.
  jest.clearAllMocks();

  db.query.mockReset();

  mockSafeSyncScanToParcels.mockReset();
  mockSafeSyncScanToParcels.mockResolvedValue({
    synced: true,
    parcelsUpdated: 1,
    orderStatus: 'collected',
  });

  mockCreateAlert.mockReset();
  mockCreateAlert.mockResolvedValue();

  mockTransitionOrderStatus.mockReset();
  mockGetActiveAuthorizationForUpdate.mockReset();
  mockHasActiveAuthorization.mockReset();

  mockNotifyText.mockReset();
  mockNotifyText.mockResolvedValue({ ok: true });

  mockBuildReceiptHTML.mockReset();
  mockBuildReceiptHTML.mockReturnValue('<html>reçu</html>');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers purs
// ═══════════════════════════════════════════════════════════════════════════════

describe('generatePickupCode', () => {
  it('génère un code au format XXX-XXX-XX (8 caractères + 2 tirets)', () => {
    const code = generatePickupCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{2}$/);
  });

  it('ne contient jamais 0/O/I/1/l (alphabet sans confusion)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePickupCode();
      expect(code).not.toMatch(/[0OI1l]/);
    }
  });
});

describe('hashCode', () => {
  it('est déterministe pour un même code+salt', () => {
    expect(hashCode('A7K-3M9-P2', 'salt1')).toBe(hashCode('A7K-3M9-P2', 'salt1'));
  });

  it('ignore tirets/espaces et la casse', () => {
    expect(hashCode('a7k3m9p2', 'salt1')).toBe(hashCode('A7K-3M9-P2', 'salt1'));
  });

  it('change si le salt change', () => {
    expect(hashCode('A7K-3M9-P2', 'salt1')).not.toBe(hashCode('A7K-3M9-P2', 'salt2'));
  });
});

describe('normalizeCode', () => {
  it('retire tirets et espaces, upper-case', () => {
    expect(normalizeCode('a7k-3m9-p2')).toBe('A7K3M9P2');
    expect(normalizeCode(' a7 k ')).toBe('A7K'); // espaces internes aussi retirés
  });

  it('gère undefined/null sans crasher', () => {
    expect(normalizeCode(undefined)).toBe('');
    expect(normalizeCode(null)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// generateAndStoreSecret
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateAndStoreSecret', () => {
  it('lève une erreur si orderId manquant', async () => {
    await expect(generateAndStoreSecret({ channel: 'cash_relais' })).rejects.toThrow('orderId requis');
  });

  it('lève une erreur si channel manquant', async () => {
    await expect(generateAndStoreSecret({ orderId: 'o1' })).rejects.toThrow('channel requis');
  });

  it('génère un code et UPDATE orders au premier essai (pas de collision)', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id FROM orders')) return Promise.resolve({ rows: [] }); // pas de doublon
      if (sql.includes('UPDATE orders SET')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const result = await generateAndStoreSecret({ orderId: 'o1', relaisId: 'r1', channel: 'cash_relais' });

    expect(result.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{2}$/);
    expect(result.last4).toHaveLength(4);

    const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE orders SET'));
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('pickup_secret_channel');
    expect(updateCall[1]).toContain('o1'); // orderId en dernier param
  });

  it('réessaie en cas de collision puis réussit', async () => {
    let selectCount = 0;
    db.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id FROM orders')) {
        selectCount++;
        // 1ère tentative = collision, 2e = libre
        return Promise.resolve({ rows: selectCount === 1 ? [{ id: 'dup' }] : [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await generateAndStoreSecret({ orderId: 'o1', channel: 'stripe' });
    expect(result.code).toBeDefined();
    expect(selectCount).toBe(2);
  });

  it('lève une erreur de saturation après 50 tentatives en collision', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id FROM orders')) return Promise.resolve({ rows: [{ id: 'dup' }] });
      return Promise.resolve({ rows: [] });
    });

    await expect(generateAndStoreSecret({ orderId: 'o1', channel: 'wallet' }))
      .rejects.toThrow('Génération du code impossible (saturation)');
  });

  it('exclut excludeOrderId de la requête anti-collision (regenerate)', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await generateAndStoreSecret({ orderId: 'o1', channel: 'admin_regenerate', excludeOrderId: 'o1' });

    const selectCall = db.query.mock.calls.find(c => c[0].includes('SELECT id FROM orders'));
    expect(selectCall[0]).toContain('AND id <> $3');
    expect(selectCall[1]).toContain('o1');
  });

  it('fusionne extraUpdates dans les colonnes UPDATE', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await generateAndStoreSecret({
      orderId: 'o1',
      channel: 'stripe',
      extraUpdates: { stripe_payment_intent_id: 'pi_123' },
    });

    const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE orders SET'));
    expect(updateCall[0]).toContain('stripe_payment_intent_id');
    expect(updateCall[1]).toContain('pi_123');
  });

  it('utilise dbClient fourni au lieu du pool global', async () => {
    const customClient = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await generateAndStoreSecret({ orderId: 'o1', channel: 'cash_relais', dbClient: customClient });

    expect(customClient.query).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// cacheCodeForReveal
// ═══════════════════════════════════════════════════════════════════════════════

describe('cacheCodeForReveal', () => {
  it('INSERT ... ON CONFLICT DO UPDATE avec orderId et code', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await cacheCodeForReveal('o1', 'A7K-3M9-P2');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pickup_reveal_codes'),
      ['o1', 'A7K-3M9-P2']
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// issuePrintToken
// ═══════════════════════════════════════════════════════════════════════════════

describe('issuePrintToken', () => {
  it('génère un token hex et INSERT pickup_print_tokens', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const token = await issuePrintToken({ orderId: 'o1', code: 'A7K-3M9-P2', payerName: 'Ali' });

    expect(token).toMatch(/^[a-f0-9]{48}$/); // 24 bytes hex
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pickup_print_tokens'),
      [token, 'o1', 'A7K-3M9-P2', 'Ali']
    );
  });

  it('payerName absent → null', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await issuePrintToken({ orderId: 'o1', code: 'X' });
    const call = db.query.mock.calls[0];
    expect(call[1][3]).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getReceiptHTML
// ═══════════════════════════════════════════════════════════════════════════════

describe('getReceiptHTML', () => {
  it('400 si token manquant', async () => {
    const result = await getReceiptHTML({ orderId: 'o1', token: undefined });
    expect(result).toEqual({ status: 400, error: 'Token manquant' });
  });

  it('403 si token invalide ou expiré', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // DELETE ... RETURNING vide
    const result = await getReceiptHTML({ orderId: 'o1', token: 't1' });
    expect(result).toEqual({ status: 403, error: 'Token invalide ou expiré' });
  });

  it('404 si commande introuvable après consommation du token', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ order_id: 'o1', code: 'A7K-3M9-P2', payer_name: 'Ali' }] }) // DELETE token
      .mockResolvedValueOnce({ rows: [] }); // commande introuvable
    const result = await getReceiptHTML({ orderId: 'o1', token: 't1' });
    expect(result).toEqual({ status: 404, error: 'Commande introuvable' });
  });

  it('200 + html nominal', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ order_id: 'o1', code: 'A7K-3M9-P2', payer_name: 'Ali' }] })
      .mockResolvedValueOnce({ rows: [{ reference: 'KMC-001', total_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ quantity: 2, price_kmf: 2500, product_name: 'Savon' }] });

    const result = await getReceiptHTML({ orderId: 'o1', token: 't1' });
    expect(result.status).toBe(200);
    expect(result.html).toBe('<html>reçu</html>');
    expect(mockBuildReceiptHTML).toHaveBeenCalledWith(expect.objectContaining({ code: 'A7K-3M9-P2' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// verifyPickupCode
// ═══════════════════════════════════════════════════════════════════════════════

describe('verifyPickupCode', () => {
  it('400 si code manquant', async () => {
    const result = await verifyPickupCode({ orderId: 'o1', code: '', agentId: 'a1' });
    expect(result).toEqual({ status: 400, body: { error: 'Code requis' } });
  });

  it('404 si commande introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await verifyPickupCode({ orderId: 'o1', code: '1234', agentId: 'a1' });
    expect(result.status).toBe(404);
  });

  it('400 si pas encore de code (paiement non effectué)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: null }] });
    const result = await verifyPickupCode({ orderId: 'o1', code: '1234', agentId: 'a1' });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/paiement non effectué/);
  });

  it('429 si bloqué (rate limit actif)', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: 'h', pickup_secret_blocked_until: future }],
    });
    const result = await verifyPickupCode({ orderId: 'o1', code: '1234', agentId: 'a1' });
    expect(result.status).toBe(429);
    expect(result.body.blocked_until).toEqual(future);
  });

  it('410 si code expiré', async () => {
    const past = new Date(Date.now() - 1000);
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: 'h', pickup_secret_expires_at: past }],
    });
    const result = await verifyPickupCode({ orderId: 'o1', code: '1234', agentId: 'a1' });
    expect(result.status).toBe(410);
  });

  it('400 si longueur de code ni 4 ni 8', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: 'h' }] });
    const result = await verifyPickupCode({ orderId: 'o1', code: '123', agentId: 'a1' });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/4 caractères/);
  });

  it('mode court (4 chars) : succès si match last4', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: 'h', pickup_secret_last4: 'WXP2' }] })
      .mockResolvedValueOnce({ rows: [] }); // reset compteur
    const result = await verifyPickupCode({ orderId: 'o1', code: 'wxp2', agentId: 'a1' });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });

  it('mode complet (8 chars) : succès si hash match', async () => {
    const salt = 'salt1';
    const hash = hashCode('A7K3M9P2', salt);
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: hash, pickup_secret_salt: salt }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await verifyPickupCode({ orderId: 'o1', code: 'A7K-3M9-P2', agentId: 'a1' });
    expect(result.status).toBe(200);
  });

  it('échec : incrémente le compteur, bloque à la 3e tentative', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: 'h', pickup_secret_last4: 'WXP2', pickup_secret_attempts: 2 }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE attempts
    const result = await verifyPickupCode({ orderId: 'o1', code: '0000', agentId: 'a1' });
    expect(result.status).toBe(401);
    expect(result.body.attempts).toBe(3);
    expect(result.body.remaining).toBe(0);
    expect(result.body.blocked_until).not.toBeNull();

    const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE orders') && c[0].includes('pickup_secret_attempts'));
    expect(updateCall[1][0]).toBe(3); // attempts
  });

  it('échec sous le seuil : pas de blocage', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', pickup_secret_hash: 'h', pickup_secret_last4: 'WXP2', pickup_secret_attempts: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await verifyPickupCode({ orderId: 'o1', code: '0000', agentId: 'a1' });
    expect(result.status).toBe(401);
    expect(result.body.attempts).toBe(1);
    expect(result.body.blocked_until).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// collectOrder
// ═══════════════════════════════════════════════════════════════════════════════

describe('collectOrder', () => {
  it('404 si commande introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await collectOrder({ orderId: 'o1', agentId: 'a1', role: 'agent_relais' });
    expect(result.status).toBe(404);
  });

  it('409 si déjà collecté', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', status: 'collected' }] });
    const result = await collectOrder({ orderId: 'o1', agentId: 'a1', role: 'agent_relais' });
    expect(result.status).toBe(409);
  });

  it('409 si la transition échoue (pas noop)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', status: 'confirmed' }] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: false, noop: false, error: 'transition invalide' });
    const result = await collectOrder({ orderId: 'o1', agentId: 'a1', role: 'agent_relais' });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('transition invalide');
  });

  it('200 nominal : transition OK + UPDATE collected_by_name', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', status: 'confirmed' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: true });

    const result = await collectOrder({ orderId: 'o1', agentId: 'a1', role: 'agent_relais', collectedByName: 'Fatima' });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);

    const updateCall = db.query.mock.calls.find(c => c[0].includes('collected_by_name'));
    expect(updateCall[1]).toEqual(['Fatima', 'o1']);
  });

  it('accepte un transition.noop=true comme un succès', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'KMC-001', status: 'confirmed' }] })
      .mockResolvedValueOnce({ rows: [] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: false, noop: true });

    const result = await collectOrder({ orderId: 'o1', agentId: 'a1', role: 'agent_relais' });
    expect(result.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// regenerateCode
// ═══════════════════════════════════════════════════════════════════════════════

describe('regenerateCode', () => {
  it('400 si motif absent ou trop court', async () => {
    const result = await regenerateCode({ orderId: 'o1', adminId: 'admin1', reason: 'abc' });
    expect(result.status).toBe(400);
  });

  it('404 si commande introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await regenerateCode({ orderId: 'o1', adminId: 'admin1', reason: 'reçu perdu' });
    expect(result.status).toBe(404);
  });

  it('500 si saturation anti-collision', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id, reference, pickup_secret_hash')) {
        return Promise.resolve({ rows: [{ id: 'o1', reference: 'KMC-001', relais_id: 'r1' }] });
      }
      if (sql.includes('SELECT id FROM orders')) return Promise.resolve({ rows: [{ id: 'dup' }] });
      return Promise.resolve({ rows: [] });
    });
    const result = await regenerateCode({ orderId: 'o1', adminId: 'admin1', reason: 'reçu perdu' });
    expect(result.status).toBe(500);
  });

  it('200 nominal : nouveau code renvoyé en clair', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id, reference, pickup_secret_hash')) {
        return Promise.resolve({ rows: [{ id: 'o1', reference: 'KMC-001', relais_id: 'r1' }] });
      }
      if (sql.includes('SELECT id FROM orders')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE orders')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const result = await regenerateCode({ orderId: 'o1', adminId: 'admin1', reason: 'reçu perdu, pièce vérifiée' });
    expect(result.status).toBe(200);
    expect(result.body.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{2}$/);
    expect(result.body.order_ref).toBe('KMC-001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getPickupStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe('getPickupStatus', () => {
  it('404 si commande introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await getPickupStatus({ orderId: 'o1' });
    expect(result.status).toBe(404);
  });

  it('200 : masque le code (last4 visible seulement)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'o1', reference: 'KMC-001', status: 'confirmed', payment_status: 'paid', total_kmf: '5000',
        pickup_secret_created_at: new Date(), pickup_secret_last4: 'WXP2',
      }],
    });
    const result = await getPickupStatus({ orderId: 'o1' });
    expect(result.status).toBe(200);
    expect(result.body.secret.last4).toBe('WXP2');
    expect(result.body.secret.masked).toBe('•••-•WX-P2');
    expect(result.body.total_kmf).toBe(5000);
    // Le code clair n'est JAMAIS exposé dans le status
    expect(JSON.stringify(result.body)).not.toContain('pickup_secret_hash');
  });

  it('200 : secret.exists=false si jamais généré', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'o1', reference: 'KMC-001', status: 'pending', payment_status: 'pending', total_kmf: 0 }],
    });
    const result = await getPickupStatus({ orderId: 'o1' });
    expect(result.body.secret.exists).toBe(false);
    expect(result.body.secret.masked).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// revealOnce
// ═══════════════════════════════════════════════════════════════════════════════

describe('revealOnce', () => {
  it('404 si commande introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(404);
  });

  it('403 si l’utilisateur n’est pas le destinataire du code', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'u2' }] });
    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(403);
  });

  it('autorise l’organisateur désigné et refuse le payeur quand le code lui est délégué', async () => {
    const emitted = new Date();
    const delegatedOrder = {
      id: 'o1', reference: 'KMC-001', user_id: 'buyer-1',
      pickup_code_recipient_user_id: 'organizer-1',
      pickup_secret_hash: 'h', pickup_secret_emitted_at: emitted,
      pickup_secret_channel: 'cash', total_kmf: 5000,
    };

    db.query.mockResolvedValueOnce({ rows: [delegatedOrder] });
    const denied = await revealOnce({ orderId: 'o1', userId: 'buyer-1' });
    expect(denied.status).toBe(403);

    db.query
      .mockResolvedValueOnce({ rows: [delegatedOrder] })
      .mockResolvedValueOnce({ rows: [{ code: 'A7K-3M9-P2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const allowed = await revealOnce({ orderId: 'o1', userId: 'organizer-1' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.code).toBe('A7K-3M9-P2');
  });

  it('202 pending si pas encore de hash (webhook en retard)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'u1', pickup_secret_hash: null }] });
    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(202);
    expect(result.body.status).toBe('pending');
  });

  it('410 si déjà révélé', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'o1', user_id: 'u1', pickup_secret_hash: 'h', pickup_secret_revealed_at: new Date(), pickup_secret_last4: 'WXP2' }],
    });
    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(410);
    expect(result.body.masked).toBe('•••-•••-P2');
  });

  it('410 si fenêtre de 30 min expirée', async () => {
    const emitted = new Date(Date.now() - 31 * 60 * 1000);
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'o1', user_id: 'u1', pickup_secret_hash: 'h', pickup_secret_emitted_at: emitted, pickup_secret_last4: 'WXP2' }],
    });
    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(410);
    expect(result.body.error).toMatch(/Fenêtre de révélation expirée/);
  });

  it('410 si cache de révélation absent/expiré en DB', async () => {
    const emitted = new Date();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'o1', user_id: 'u1', pickup_secret_hash: 'h', pickup_secret_emitted_at: emitted, pickup_secret_last4: 'WXP2' }] })
      .mockResolvedValueOnce({ rows: [] }); // pickup_reveal_codes vide
    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(410);
    expect(result.body.error).toBe('Code non disponible');
  });

  it('200 nominal : révèle le code, marque revealed_at, purge le cache, génère le QR', async () => {
    const emitted = new Date();
    db.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'o1', reference: 'KMC-001', user_id: 'u1', pickup_secret_hash: 'h',
          pickup_secret_emitted_at: emitted, pickup_secret_channel: 'stripe', total_kmf: 5000,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ code: 'A7K-3M9-P2' }] }) // pickup_reveal_codes
      .mockResolvedValueOnce({ rows: [] }) // UPDATE revealed_at
      .mockResolvedValueOnce({ rows: [] }); // DELETE reveal_codes

    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(200);
    expect(result.body.code).toBe('A7K-3M9-P2');
    expect(result.body.qr_payload).toMatch(/^KMR1\./);
    expect(result.body.total_kmf).toBe(5000);
  });

  it('autorise la révélation si user_id de la commande est null (invité)', async () => {
    const emitted = new Date();
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'o1', reference: 'KMC-001', user_id: null, pickup_secret_hash: 'h', pickup_secret_emitted_at: emitted, pickup_secret_channel: 'wallet', total_kmf: 1000 }],
      })
      .mockResolvedValueOnce({ rows: [{ code: 'X' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(result.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// collectByPickupCode — Lot 2C : orchestrateur canonique de remise aveugle
// ═══════════════════════════════════════════════════════════════════════════════

describe('collectByPickupCode', () => {
  const SALT = 'testsalt0123456789';
  const CODE = 'A7K3M9P2'; // 8 caractères canoniques, normalisé (sans tirets)
  const LAST4 = CODE.slice(-4);
  const HASH = hashCode(CODE, SALT);

  function buildOrder(overrides = {}) {
    return {
      id: 'o1', reference: 'KOM-001', relais_id: 'r1', relais_name: 'Relais A',
      recipient_name: 'Jean Dupont', status: 'available',
      pickup_secret_hash: HASH, pickup_secret_salt: SALT, pickup_secret_last4: LAST4,
      pickup_secret_expires_at: null, pickup_secret_attempts: 0, pickup_secret_blocked_until: null,
      ...overrides,
    };
  }

  const admin       = { id: 'u0', role: 'admin' };
  const agentRelais = { id: 'u3', role: 'agent_relais' };

  test('pickup_code manquant → 400, aucune transaction ouverte', async () => {
    const result = await collectByPickupCode({ code: '', user: admin });
    expect(result.status).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('code à 6 chiffres (legacy) → 400', async () => {
    const result = await collectByPickupCode({ code: '123456', user: admin });
    expect(result.status).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('code à 4 caractères (recherche aveugle last4 seul) → 400', async () => {
    const result = await collectByPickupCode({ code: LAST4, user: admin });
    expect(result.status).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('code complet valide (admin) → 200, scan_code = référence (jamais le secret)', async () => {
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })       // SELECT candidates FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] }) // INSERT scans
      .mockResolvedValueOnce({});                      // UPDATE reset attempts

    const result = await collectByPickupCode({ code: CODE, user: admin, ip: '1.2.3.4', userAgent: 'UA' });

    expect(result.status).toBe(200);
    expect(result.body.reference).toBe('KOM-001');
    expect(result.body.order_id).toBe('o1');
    expect(result.body.code).toBeUndefined();
    expect(result.body.pickup_code).toBeUndefined();

    const insertCall = db.query.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO scans/);
    // scan_code doit être la référence de commande, jamais le secret saisi
    expect(insertCall[1]).toContain(order.reference);
    expect(insertCall[1]).not.toContain(CODE);

    // Preuve minimale de la méthode normale.
    expect(insertCall[1][4]).toBe('PICKUP_CODE');
    expect(insertCall[1][5]).toBeNull();
    expect(insertCall[1][6]).toBe(false);
    expect(insertCall[1][7]).toBe(order.relais_id);

    // notes neutres, jamais le secret
    expect(insertCall[1].join(' ')).not.toMatch(new RegExp(CODE));
  });

  test('code avec tirets de présentation → accepté (normalisation)', async () => {
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({});

    const dashed = CODE.slice(0, 3) + '-' + CODE.slice(3, 6) + '-' + CODE.slice(6);
    const result = await collectByPickupCode({ code: dashed, user: admin });
    expect(result.status).toBe(200);
  });

  test('code invalide (hash ne correspond à aucun candidat) → 404, alerte sécurité', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // aucun candidat pour ce last4

    const result = await collectByPickupCode({ code: CODE, user: admin, ip: '1.2.3.4', userAgent: 'UA' });
    expect(result.status).toBe(404);
    expect(mockCreateAlert).toHaveBeenCalled();
    const alertPayload = mockCreateAlert.mock.calls[0][1];
    expect(alertPayload.description).not.toMatch(new RegExp(CODE));
  });

  test('commande déjà collectée (absente de la recherche "available") → 404, pas de second retrait', async () => {
    // Le WHERE status='available' exclut naturellement une commande déjà
    // collected : aucun candidat renvoyé, même comportement que "code invalide".
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await collectByPickupCode({ code: CODE, user: admin });
    expect(result.status).toBe(404);
  });

  test('secret expiré → 410', async () => {
    const order = buildOrder({ pickup_secret_expires_at: new Date(Date.now() - 60000).toISOString() });
    db.query.mockResolvedValueOnce({ rows: [order] });

    const result = await collectByPickupCode({ code: CODE, user: admin });
    expect(result.status).toBe(410);
  });

  test('commande bloquée (brute-force) → 429', async () => {
    const order = buildOrder({ pickup_secret_blocked_until: new Date(Date.now() + 60000).toISOString() });
    db.query.mockResolvedValueOnce({ rows: [order] });

    const result = await collectByPickupCode({ code: CODE, user: agentRelais });
    expect(result.status).toBe(429);
    expect(result.body.blocked_until).toBeDefined();
  });

  test('agent du bon relais → succès (cross-relais check OK)', async () => {
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })            // candidates
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] }) // users.relais_id
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })       // INSERT scans
      .mockResolvedValueOnce({});                             // reset attempts

    const result = await collectByPickupCode({ code: CODE, user: agentRelais });
    expect(result.status).toBe(200);
  });

  test('agent d\'un autre relais → 403, compteur incrémenté dans la même transaction', async () => {
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })            // candidates
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r2' }] }) // users.relais_id (mismatch)
      .mockResolvedValueOnce({});                             // UPDATE attempts (cross-relais)

    const result = await collectByPickupCode({ code: CODE, user: agentRelais, ip: '1.2.3.4', userAgent: 'UA' });
    expect(result.status).toBe(403);
    expect(result.body.attempts).toBe(1);
    expect(mockCreateAlert).toHaveBeenCalled();
  });

  test('agent_relais sans relais_id → 403, configuration incomplète', async () => {
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ relais_id: null }] });

    const result = await collectByPickupCode({ code: CODE, user: agentRelais });
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/incomplète/);
  });

  test('admin → succès quel que soit le relais (pas de cross-relais check)', async () => {
    const order = buildOrder({ relais_id: 'r-autre' });
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({});

    const result = await collectByPickupCode({ code: CODE, user: admin });
    expect(result.status).toBe(200);
  });

  test('appelle transitionOrderStatus si le sync colis a échoué (synced=false)', async () => {
    const order = buildOrder();
    mockSafeSyncScanToParcels.mockResolvedValueOnce({ synced: false });
    mockTransitionOrderStatus.mockResolvedValueOnce({
      success: true,
      noop: false,
      newStatus: 'collected',
    });
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({});

    await collectByPickupCode({ code: CODE, user: admin });

    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'collected', source: 'scan' })
    );
  });

  test('erreur pendant parcelSync → transaction rejetée (rollback)', async () => {
    mockSafeSyncScanToParcels.mockRejectedValueOnce(new Error('parcelSync down'));
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] });

    await expect(collectByPickupCode({ code: CODE, user: admin })).rejects.toThrow('parcelSync down');
  });

  test('erreur pendant la transition (fallback) → transaction rejetée (rollback)', async () => {
    mockSafeSyncScanToParcels.mockResolvedValueOnce({ synced: false });
    mockTransitionOrderStatus.mockRejectedValueOnce(new Error('transition failed'));
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] });

    await expect(collectByPickupCode({ code: CODE, user: admin })).rejects.toThrow('transition failed');
  });

  test('reset le compteur de tentatives au succès', async () => {
    const order = buildOrder({ pickup_secret_attempts: 2 });
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({});

    await collectByPickupCode({ code: CODE, user: admin });

    const resetCall = db.query.mock.calls[2];
    expect(resetCall[0]).toMatch(/pickup_secret_attempts\s*=\s*0/);
  });

  test('utilise le verrou FOR UPDATE pour la résolution par last4', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await collectByPickupCode({ code: CODE, user: admin });
    expect(db.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
  });

  test('scans.scan_code ne contient jamais le secret complet', async () => {
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({});

    await collectByPickupCode({ code: CODE, user: admin });

    const insertParams = db.query.mock.calls[1][1];
    expect(insertParams).not.toContain(CODE);
    expect(insertParams).toContain(order.reference);
  });

  test('scans.notes ne contient jamais le secret complet', async () => {
    const order = buildOrder();
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({});

    await collectByPickupCode({ code: CODE, user: admin });

    const insertParams = db.query.mock.calls[1][1];
    const notesValue = insertParams[3];
    expect(notesValue).not.toMatch(new RegExp(CODE));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getExceptionalPickupAvailability — Lot 5
// ═══════════════════════════════════════════════════════════════════════════════

describe('getExceptionalPickupAvailability', () => {
  const agent = { orderId: 'O1', agentId: 'u-agent', role: 'agent_relais' };

  test('404 ORDER_NOT_FOUND si la commande n\'existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await getExceptionalPickupAvailability(agent);
    expect(result).toEqual({ status: 404, body: { available: false, reason: 'ORDER_NOT_FOUND' } });
    expect(mockHasActiveAuthorization).not.toHaveBeenCalled();
  });

  test('CROSS_RELAIS si l\'agent n\'appartient pas au relais de la commande', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'O1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null }] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r2' }] });
    const result = await getExceptionalPickupAvailability(agent);
    expect(result).toEqual({ status: 200, body: { available: false, reason: 'CROSS_RELAIS' } });
    expect(mockHasActiveAuthorization).not.toHaveBeenCalled();
  });

  test('CROSS_RELAIS si l\'agent n\'a pas de relais_id configuré', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'O1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null }] })
      .mockResolvedValueOnce({ rows: [{ relais_id: null }] });
    const result = await getExceptionalPickupAvailability(agent);
    expect(result.body).toEqual({ available: false, reason: 'CROSS_RELAIS' });
  });

  test('admin ne subit pas le contrôle cross-relais (pas de requête agent)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'O1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null }] });
    mockHasActiveAuthorization.mockResolvedValueOnce(true);
    const result = await getExceptionalPickupAvailability({ orderId: 'O1', agentId: 'admin1', role: 'admin' });
    expect(result.body).toEqual({ available: true });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('BLOCKED si exceptional_pickup_blocked_until est dans le futur', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'O1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: future }] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });
    const result = await getExceptionalPickupAvailability(agent);
    expect(result).toEqual({ status: 200, body: { available: false, reason: 'BLOCKED' } });
    expect(mockHasActiveAuthorization).not.toHaveBeenCalled();
  });

  test('NO_ACTIVE_AUTHORIZATION — jamais de nom dans la réponse', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'O1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null }] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });
    mockHasActiveAuthorization.mockResolvedValueOnce(false);
    const result = await getExceptionalPickupAvailability(agent);
    expect(result).toEqual({ status: 200, body: { available: false, reason: 'NO_ACTIVE_AUTHORIZATION' } });
  });

  test('available:true — transmet bien user_id à hasActiveAuthorization', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'O1', status: 'available', relais_id: 'r1', user_id: 'u1', exceptional_pickup_blocked_until: null }] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });
    mockHasActiveAuthorization.mockResolvedValueOnce(true);
    const result = await getExceptionalPickupAvailability(agent);
    expect(result).toEqual({ status: 200, body: { available: true } });
    expect(mockHasActiveAuthorization).toHaveBeenCalledWith('u1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// collectByAuthorizedName — Lot 5
// ═══════════════════════════════════════════════════════════════════════════════

describe('collectByAuthorizedName', () => {
  const base = {
    orderId: 'O1',
    agentId: 'u-agent',
    role: 'agent_relais',
    givenNames: 'Fatima',
    familyName: 'Said',
    documentChecked: true,
  };

  function buildOrder(overrides) {
    return Object.assign({
      id: 'O1',
      reference: 'ORD1',
      status: 'available',
      relais_id: 'r1',
      user_id: 'u1',
      exceptional_pickup_attempts: 0,
      exceptional_pickup_blocked_until: null,
      relais_name: 'Moroni Centre',
      buyer_phone: '+269000000',
    }, overrides || {});
  }

  function activeAuthorization(overrides) {
    return Object.assign({
      normalizedGivenNames: 'fatima',
      normalizedFamilyName: 'said',
      version: 1,
    }, overrides || {});
  }

  function mockSuccessfulAgentCollection(order = buildOrder()) {
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ relais_id: order.relais_id }] })
      .mockResolvedValueOnce({ rows: [{ id: 'scan-exceptional-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    mockGetActiveAuthorizationForUpdate.mockResolvedValueOnce(
      activeAuthorization()
    );
  }

  function mockSuccessfulAdminCollection(order = buildOrder()) {
    db.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [{ id: 'scan-exceptional-admin' }] })
      .mockResolvedValueOnce({ rows: [] });

    mockGetActiveAuthorizationForUpdate.mockResolvedValueOnce(
      activeAuthorization()
    );
  }

  test('404 ORDER_NOT_FOUND si la commande n\'existe pas', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await collectByAuthorizedName(base);

    expect(result).toEqual({
      status: 404,
      body: {
        error: 'Commande introuvable',
        code: 'ORDER_NOT_FOUND',
      },
    });

    expect(mockGetActiveAuthorizationForUpdate).not.toHaveBeenCalled();
  });

  test('403 CROSS_RELAIS_BLOCKED si l\'agent est d\'un autre relais', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [buildOrder()] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r-autre' }] });

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(403);
    expect(result.body.code).toBe('CROSS_RELAIS_BLOCKED');
  });

  test('admin ne subit pas le contrôle cross-relais', async () => {
    mockSuccessfulAdminCollection();

    const result = await collectByAuthorizedName({
      ...base,
      agentId: 'admin1',
      role: 'admin',
    });

    expect(result.status).toBe(200);

    const agentLookup = db.query.mock.calls.find(([sql]) =>
      sql.includes('SELECT relais_id FROM users')
    );

    expect(agentLookup).toBeUndefined();
  });

  test('429 BLOCKED si exceptional_pickup_blocked_until est dans le futur', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.query
      .mockResolvedValueOnce({
        rows: [buildOrder({
          exceptional_pickup_blocked_until: future,
        })],
      })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(429);
    expect(result.body.code).toBe('BLOCKED');
    expect(result.body.blocked_until).toBe(future);
  });

  test('400 DOCUMENT_NOT_CHECKED si l\'attestation n\'est pas envoyée', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [buildOrder()] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });

    const result = await collectByAuthorizedName({
      ...base,
      documentChecked: false,
    });

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('DOCUMENT_NOT_CHECKED');
    expect(mockGetActiveAuthorizationForUpdate).not.toHaveBeenCalled();
  });

  test('400 DOCUMENT_NOT_CHECKED pour la chaîne "false"', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [buildOrder()] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });

    const result = await collectByAuthorizedName({
      ...base,
      documentChecked: 'false',
    });

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('DOCUMENT_NOT_CHECKED');
  });

  test('409 ALREADY_COLLECTED si déjà remis', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [buildOrder({ status: 'collected' })],
      })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(409);
    expect(result.body.code).toBe('ALREADY_COLLECTED');
  });

  test.each([
    'pending',
    'pending_group_payment',
    'confirmed',
    'ordered',
    'preparation',
    'shipped',
    'in_transit',
    'cancelled',
    'refunded',
  ])('409 ORDER_NOT_READY pour le statut %s', async (status) => {
    db.query
      .mockResolvedValueOnce({
        rows: [buildOrder({ status })],
      })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(409);
    expect(result.body.code).toBe('ORDER_NOT_READY');
    expect(mockGetActiveAuthorizationForUpdate).not.toHaveBeenCalled();
    expect(mockSafeSyncScanToParcels).not.toHaveBeenCalled();
  });

  test('404 NO_ACTIVE_AUTHORIZATION si aucune autorisation active', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [buildOrder()] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] });

    mockGetActiveAuthorizationForUpdate.mockResolvedValueOnce(null);

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(404);
    expect(result.body.code).toBe('NO_ACTIVE_AUTHORIZATION');
  });

  test('401 NAME_MISMATCH — incrémente le compteur DÉDIÉ, jamais pickup_secret_attempts', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [buildOrder({ exceptional_pickup_attempts: 0 })],
      })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] })
      .mockResolvedValueOnce({ rows: [] });

    mockGetActiveAuthorizationForUpdate.mockResolvedValueOnce(
      activeAuthorization({
        normalizedGivenNames: 'autrenom',
        normalizedFamilyName: 'autrefamille',
      })
    );

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(401);
    expect(result.body.code).toBe('NAME_MISMATCH');
    expect(result.body.attempts).toBe(1);
    expect(result.body.remaining).toBe(2);
    expect(result.body.blocked_until).toBeNull();

    const [sql, params] = db.query.mock.calls[2];

    expect(sql).toContain('exceptional_pickup_attempts');
    expect(sql).not.toContain('pickup_secret_attempts');
    expect(params[0]).toBe(1);

    expect(mockCreateAlert).toHaveBeenCalled();

    const alertArg = mockCreateAlert.mock.calls[0][1];

    expect(alertArg.description)
      .not.toMatch(/Fatima|Said|autrenom|autrefamille/);
  });

  test('bloque à la 3e tentative échouée (compteur dédié)', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [buildOrder({ exceptional_pickup_attempts: 2 })],
      })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] })
      .mockResolvedValueOnce({ rows: [] });

    mockGetActiveAuthorizationForUpdate.mockResolvedValueOnce(
      activeAuthorization({
        normalizedGivenNames: 'autrenom',
        normalizedFamilyName: 'autrefamille',
      })
    );

    const result = await collectByAuthorizedName(base);

    expect(result.body.attempts).toBe(3);
    expect(result.body.remaining).toBe(0);
    expect(result.body.blocked_until).not.toBeNull();
  });

  test('tolère casse, accents et tirets après normalisation stricte', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [buildOrder()] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'scan-normalized-name' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    mockGetActiveAuthorizationForUpdate.mockResolvedValueOnce(
      activeAuthorization({
        normalizedGivenNames: 'jean pierre',
        normalizedFamilyName: 'ali',
      })
    );

    const result = await collectByAuthorizedName({
      ...base,
      givenNames: 'JEAN-PIERRE',
      familyName: 'ALI',
    });

    expect(result.status).toBe(200);
  });

  test('409 si transitionOrderStatus refuse le fallback sans colis', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [buildOrder()] })
      .mockResolvedValueOnce({ rows: [{ relais_id: 'r1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'scan-transition-refused' }],
      });

    mockGetActiveAuthorizationForUpdate.mockResolvedValueOnce(
      activeAuthorization()
    );

    mockSafeSyncScanToParcels.mockResolvedValueOnce({
      synced: false,
      parcelsUpdated: 0,
      orderStatus: null,
    });

    mockTransitionOrderStatus.mockResolvedValueOnce({
      success: false,
      noop: false,
      error: 'Transition refusée',
    });

    const result = await collectByAuthorizedName(base);

    expect(result).toEqual({
      status: 409,
      body: {
        error: 'Transition refusée',
        code: 'TRANSITION_REFUSED',
      },
    });
  });

  test('succès : scan canonique, preuve durable, reset et notification post-commit', async () => {
    mockSuccessfulAgentCollection();

    const result = await collectByAuthorizedName(base);

    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        message: 'Colis remis. Commande marquée comme récupérée (retrait exceptionnel).',
        order_ref: 'ORD1',
      },
    });

    const [scanSql, scanParams] = db.query.mock.calls[2];

    expect(scanSql).toContain('INSERT INTO scans');
    expect(scanSql).toContain('pickup_method');
    expect(scanSql).toContain('authorization_version');
    expect(scanSql).toContain('document_checked');
    expect(scanSql).toContain('pickup_relais_id');

    expect(scanParams[0]).toBe('O1');
    expect(scanParams[1]).toBe('ORD1');
    expect(scanParams[2]).toBe('u-agent');
    expect(scanParams[4]).toBe('AUTHORIZED_NAME_ID_CHECK');
    expect(scanParams[5]).toBe(1);
    expect(scanParams[6]).toBe(true);
    expect(scanParams[7]).toBe('r1');

    expect(scanParams.join(' '))
      .not.toMatch(/Fatima|Said/);

    expect(mockSafeSyncScanToParcels).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'O1',
        step: 'collected',
        scan_id: 'scan-exceptional-1',
        scanned_by: 'u-agent',
      }),
      expect.any(Object)
    );

    const [updateSql, updateParams] = db.query.mock.calls[3];

    expect(updateSql).toContain('pickup_collected_via');
    expect(updateSql).toContain('AUTHORIZED_NAME_ID_CHECK');
    expect(updateSql).toContain('exceptional_pickup_attempts');
    expect(updateParams).toEqual(['O1']);

    await new Promise(process.nextTick);

    expect(mockNotifyText).toHaveBeenCalledWith(
      '+269000000',
      expect.stringContaining('ORD1'),
      'exceptional_pickup_collected',
      'O1',
    );
  });

  test('succès sans téléphone connu : pas de notification', async () => {
    mockSuccessfulAgentCollection(
      buildOrder({ buyer_phone: null })
    );

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(200);

    await new Promise(process.nextTick);

    expect(mockNotifyText).not.toHaveBeenCalled();
  });

  test('échec notifyText non bloquant après COMMIT', async () => {
    mockSuccessfulAgentCollection();

    mockNotifyText.mockRejectedValueOnce(
      new Error('gateway down')
    );

    const result = await collectByAuthorizedName(base);

    expect(result.status).toBe(200);

    await new Promise(process.nextTick);
  });
});
