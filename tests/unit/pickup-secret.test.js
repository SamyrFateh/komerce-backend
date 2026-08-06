'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pickup-secret.test.js
 *
 * Tests du router routes/pickup-secret.js (génération/vérification du code
 * secret de retrait — modèle Western Union).
 *
 * Couverture (invariants de sécurité critiques) :
 *   ✓ POST /pay-cash/:orderId : délègue à confirmPickupCashPayment, insère
 *     un print_token en DB, déclenche les hooks post-commit (fire-and-forget)
 *   ✓ GET /receipt/:orderId : 400 sans token, 403 si token invalide/expiré
 *     (DELETE ... RETURNING ne renvoie rien), 404 si commande introuvable
 *   ✓ POST /verify/:orderId : 400 sans code, 404 commande introuvable,
 *     400 si pas encore de code, 429 si bloqué, 410 si expiré,
 *     comparaison last4 (4 car.) vs hash complet (8 car.),
 *     incrémentation des tentatives + blocage à la 3e tentative échouée,
 *     reset du compteur au succès
 *   ✓ POST /collect/:orderId : 404, 409 si déjà collected, 409 si la state
 *     machine refuse la transition, succès met à jour collected_by_name
 *   ✓ POST /regenerate/:orderId (admin only) : 400 si motif < 5 caractères,
 *     404, anti-collision last4, renvoie le nouveau code en clair
 *   ✓ GET /status/:orderId : 404, masque le last4 (jamais le code complet)
 *   ✓ GET /reveal-once/:orderId : 404, 403 si pas le propriétaire,
 *     202 pending si pas encore de hash, 410 si déjà révélé,
 *     410 si fenêtre de 30min expirée, 410 si revealRow absent (TTL/redémarrage),
 *     succès marque revealed_at + supprime la ligne reveal + renvoie le code UNE FOIS
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = req.user || { id: 'u-agent', role: 'agent_relais' };
    next();
  },
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès réservé admin' });
    next();
  },
}));

const mockConfirmPickupCashPayment = jest.fn();
jest.mock('../../services/confirm-pickup-cash-payment', () => ({
  confirmPickupCashPayment: (...args) => mockConfirmPickupCashPayment(...args),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const mockSafeSyncScanToParcels = jest.fn();
jest.mock('../../utils/parcelSync', () => ({
  safeSyncScanToParcels: (...args) =>
    mockSafeSyncScanToParcels(...args),
}));

const mockBuildReceiptHTML = jest.fn().mockReturnValue('<html>reçu</html>');
jest.mock('../../utils/pickup-receipt-html', () => ({
  buildReceiptHTML: (...args) => mockBuildReceiptHTML(...args),
  escapeHTML: (s) => s,
}));

const mockHandleOrderConfirmed = jest.fn().mockResolvedValue({ skipped: true });
jest.mock('../../services/loyalty-service', () => ({
  handleOrderConfirmed: (...args) => mockHandleOrderConfirmed(...args),
}));

const mockTriggerPurchasing = jest.fn().mockResolvedValue({});
jest.mock('../../routes/purchasing', () => ({
  triggerPurchasing: (...args) => mockTriggerPurchasing(...args),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => {
  const query = jest.fn((...args) => mockQuery(...args));
  return {
    query,
    // withTransaction(cb) appelle cb({ query }) avec LE MÊME mock que
    // db.query : les fixtures mockResolvedValueOnce existantes continuent de
    // fonctionner à l'identique, que le code sous test passe par db.query
    // directement ou par client.query à l'intérieur d'une transaction.
    withTransaction: (cb) => cb({ query }),
  };
});

// Lot 5 — le routeur délègue à pickup-secret-service, qui consomme
// auth-identity uniquement via cette API interne. Mockée ici comme dans
// tests/unit/pickup-secret-service.test.js — le routeur ne teste que le
// câblage HTTP, pas la logique métier (déjà couverte côté service).
const mockGetActiveAuthorizationForUpdate = jest.fn();
const mockHasActiveAuthorization = jest.fn();
jest.mock('../../services/pickup-authorization-service', () => ({
  getActiveAuthorizationForUpdate: (...args) => mockGetActiveAuthorizationForUpdate(...args),
  hasActiveAuthorization: (...args) => mockHasActiveAuthorization(...args),
}));

const mockNotifyText = jest.fn().mockResolvedValue({ ok: true });
jest.mock('../../services/notifications/notification-service', () => ({
  notifyText: (...args) => mockNotifyText(...args),
}));

const express = require('express');
const request = require('supertest');

let app;

const EXCEPTIONAL_ORDER_ID =
  '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();

  // clearAllMocks vide l'historique, mais pas la file des
  // mockResolvedValueOnce. Une validation HTTP anticipée ne doit pas
  // empoisonner les tests suivants.
  mockQuery.mockReset();

  mockSafeSyncScanToParcels.mockReset();
  mockSafeSyncScanToParcels.mockResolvedValue({
    synced: true,
    parcelsUpdated: 1,
    orderStatus: 'collected',
  });

  mockBuildReceiptHTML.mockReturnValue('<html>reçu</html>');
  mockHandleOrderConfirmed.mockResolvedValue({ skipped: true });
  mockTriggerPurchasing.mockResolvedValue({});
  mockNotifyText.mockResolvedValue({ ok: true });

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/pickup-secret');
    app.use('/api/pickup', router);
  });
});

describe('POST /api/pickup/pay-cash/:orderId', () => {
  test('propage le code d\'erreur si confirmPickupCashPayment échoue', async () => {
    mockConfirmPickupCashPayment.mockResolvedValueOnce({ status: 400, body: { error: 'Montant invalide' } });

    const res = await request(app).post('/api/pickup/pay-cash/O1').send({ amount_kmf: 1000 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Montant invalide' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('succès : insère un print_token et renvoie le code en clair', async () => {
    mockConfirmPickupCashPayment.mockResolvedValueOnce({
      status: 200,
      body: { order_id: 'O1', code: 'A7K-3M9-P2', order_ref: 'ORD1', amount_kmf: 5000, message: 'OK', payer_name: 'Ali' },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT pickup_print_tokens

    const res = await request(app).post('/api/pickup/pay-cash/O1').send({ amount_kmf: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.code).toBe('A7K-3M9-P2');
    expect(res.body.print_token).toMatch(/^[a-f0-9]{48}$/);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO pickup_print_tokens');
    expect(params).toEqual([res.body.print_token, 'O1', 'A7K-3M9-P2', 'Ali']);
  });
});

describe('GET /api/pickup/receipt/:orderId', () => {
  test('400 si le token est absent de la query', async () => {
    const res = await request(app).get('/api/pickup/receipt/O1');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Token manquant');
  });

  test('403 si le token est invalide ou expiré (DELETE ... RETURNING vide)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/pickup/receipt/O1').query({ token: 'tok1' });
    expect(res.status).toBe(403);
    expect(res.text).toContain('invalide ou expiré');
  });

  test('404 si la commande est introuvable après consommation du token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ order_id: 'O1', code: 'A7K-3M9-P2', payer_name: 'Ali' }] })
      .mockResolvedValueOnce({ rows: [] }); // SELECT order

    const res = await request(app).get('/api/pickup/receipt/O1').query({ token: 'tok1' });
    expect(res.status).toBe(404);
  });

  test('200 : génère le HTML du reçu via buildReceiptHTML', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ order_id: 'O1', code: 'A7K-3M9-P2', payer_name: 'Ali' }] })
      .mockResolvedValueOnce({ rows: [{ reference: 'ORD1', total_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ quantity: 1, price_kmf: 5000, product_name: 'Riz' }] });

    const res = await request(app).get('/api/pickup/receipt/O1').query({ token: 'tok1' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(mockBuildReceiptHTML).toHaveBeenCalledWith(expect.objectContaining({ code: 'A7K-3M9-P2' }));
  });
});

describe('POST /api/pickup/verify/:orderId', () => {
  test('400 si code absent', async () => {
    const res = await request(app).post('/api/pickup/verify/O1').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Code requis' });
  });

  test('404 si commande introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/pickup/verify/O1').send({ code: '1234' });
    expect(res.status).toBe(404);
  });

  test('400 si aucun code généré pour cette commande', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: null }] });
    const res = await request(app).post('/api/pickup/verify/O1').send({ code: '1234' });
    expect(res.status).toBe(400);
  });

  test('429 si bloqué (pickup_secret_blocked_until dans le futur)', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: 'h', pickup_secret_blocked_until: future }],
    });
    const res = await request(app).post('/api/pickup/verify/O1').send({ code: '1234' });
    expect(res.status).toBe(429);
  });

  test('410 si le code est expiré', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: 'h', pickup_secret_blocked_until: null, pickup_secret_expires_at: past }],
    });
    const res = await request(app).post('/api/pickup/verify/O1').send({ code: '1234' });
    expect(res.status).toBe(410);
  });

  test('400 si le code saisi n\'a ni 4 ni 8 caractères', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: 'h', pickup_secret_blocked_until: null, pickup_secret_expires_at: null }],
    });
    const res = await request(app).post('/api/pickup/verify/O1').send({ code: 'ABC' });
    expect(res.status).toBe(400);
  });

  test('mode 4 caractères : match sur pickup_secret_last4', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: 'h', pickup_secret_last4: 'XY12', pickup_secret_blocked_until: null, pickup_secret_expires_at: null, pickup_secret_attempts: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE reset attempts

    const res = await request(app).post('/api/pickup/verify/O1').send({ code: 'xy-12' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('mode 8 caractères : échec incrémente les tentatives, bloque à la 3e', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: 'differenthash', pickup_secret_salt: 'salt', pickup_secret_blocked_until: null, pickup_secret_expires_at: null, pickup_secret_attempts: 2 }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE attempts/block

    const res = await request(app).post('/api/pickup/verify/O1').send({ code: 'ABCDEFGH' });

    expect(res.status).toBe(401);
    expect(res.body.attempts).toBe(3);
    expect(res.body.blocked_until).not.toBeNull();

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain('pickup_secret_attempts');
    expect(params[0]).toBe(3);
    expect(params[1]).not.toBeNull(); // blockUntil défini à 3 tentatives
  });

  test('échec sous 3 tentatives : pas de blocage', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: 'differenthash', pickup_secret_salt: 'salt', pickup_secret_blocked_until: null, pickup_secret_expires_at: null, pickup_secret_attempts: 0 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/pickup/verify/O1').send({ code: 'ABCDEFGH' });

    expect(res.status).toBe(401);
    expect(res.body.attempts).toBe(1);
    expect(res.body.blocked_until).toBeNull();
  });
});

describe('POST /api/pickup/collect/:orderId', () => {
  test('404 si commande introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/pickup/collect/O1').send({});
    expect(res.status).toBe(404);
  });

  test('409 si déjà collected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', status: 'collected' }] });
    const res = await request(app).post('/api/pickup/collect/O1').send({});
    expect(res.status).toBe(409);
  });

  test('409 si la state machine refuse la transition', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', status: 'available' }] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: false, noop: false, error: 'refusé' });
    const res = await request(app).post('/api/pickup/collect/O1').send({});
    expect(res.status).toBe(409);
  });

  test('succès : met à jour collected_by_name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', status: 'available' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE collected_by_name
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: true });

    const res = await request(app).post('/api/pickup/collect/O1').send({ collected_by_name: 'Fatima' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [, params] = mockQuery.mock.calls[1];
    expect(params).toEqual(['Fatima', 'O1']);
  });
});

describe('GET /api/pickup/exceptional-pickup/:orderId', () => {
  test('400 si orderId n\'est pas un UUID', async () => {
    const res = await request(app)
      .get('/api/pickup/exceptional-pickup/O1');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Données invalides');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('404 si commande introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(
        `/api/pickup/exceptional-pickup/${EXCEPTIONAL_ORDER_ID}`
      );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      available: false,
      reason: 'ORDER_NOT_FOUND',
    });
  });

  test('available:false NO_ACTIVE_AUTHORIZATION — jamais de nom dans la réponse', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: EXCEPTIONAL_ORDER_ID,
          status: 'available',
          relais_id: 'r1',
          user_id: 'u1',
          exceptional_pickup_blocked_until: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ relais_id: 'r1' }],
      });

    mockHasActiveAuthorization.mockResolvedValueOnce(false);

    const res = await request(app)
      .get(
        `/api/pickup/exceptional-pickup/${EXCEPTIONAL_ORDER_ID}`
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      available: false,
      reason: 'NO_ACTIVE_AUTHORIZATION',
    });

    expect(JSON.stringify(res.body))
      .not.toMatch(/Fatima|Said/i);
  });

  test('available:true nominal — transmet bien le propriétaire à auth-identity', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: EXCEPTIONAL_ORDER_ID,
          status: 'available',
          relais_id: 'r1',
          user_id: 'u1',
          exceptional_pickup_blocked_until: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ relais_id: 'r1' }],
      });

    mockHasActiveAuthorization.mockResolvedValueOnce(true);

    const res = await request(app)
      .get(
        `/api/pickup/exceptional-pickup/${EXCEPTIONAL_ORDER_ID}`
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });

    expect(mockHasActiveAuthorization)
      .toHaveBeenCalledWith('u1');
  });
});

describe('POST /api/pickup/exceptional-pickup/:orderId/collect', () => {
  test('400 si orderId n\'est pas un UUID', async () => {
    const res = await request(app)
      .post('/api/pickup/exceptional-pickup/O1/collect')
      .send({
        given_names: 'Fatima',
        family_name: 'Said',
        document_checked: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Données invalides');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('404 si commande introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(
        `/api/pickup/exceptional-pickup/${EXCEPTIONAL_ORDER_ID}/collect`
      )
      .send({
        given_names: 'Fatima',
        family_name: 'Said',
        document_checked: true,
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ORDER_NOT_FOUND');
  });

  test('400 Joi si document_checked est absent', async () => {
    const res = await request(app)
      .post(
        `/api/pickup/exceptional-pickup/${EXCEPTIONAL_ORDER_ID}/collect`
      )
      .send({
        given_names: 'Fatima',
        family_name: 'Said',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Données invalides');

    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'document_checked',
        }),
      ])
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('400 Joi si document_checked vaut la chaîne "false"', async () => {
    const res = await request(app)
      .post(
        `/api/pickup/exceptional-pickup/${EXCEPTIONAL_ORDER_ID}/collect`
      )
      .send({
        given_names: 'Fatima',
        family_name: 'Said',
        document_checked: 'false',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Données invalides');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('succès : crée le scan canonique et notifie après COMMIT', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: EXCEPTIONAL_ORDER_ID,
          reference: 'ORD1',
          status: 'available',
          relais_id: 'r1',
          user_id: 'u1',
          exceptional_pickup_attempts: 0,
          exceptional_pickup_blocked_until: null,
          relais_name: 'Moroni Centre',
          buyer_phone: '+269...',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ relais_id: 'r1' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'scan-http-exceptional' }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    mockGetActiveAuthorizationForUpdate
      .mockResolvedValueOnce({
        normalizedGivenNames: 'fatima',
        normalizedFamilyName: 'said',
        version: 1,
      });

    mockSafeSyncScanToParcels.mockResolvedValueOnce({
      synced: true,
      parcelsUpdated: 1,
      orderStatus: 'collected',
    });

    const res = await request(app)
      .post(
        `/api/pickup/exceptional-pickup/${EXCEPTIONAL_ORDER_ID}/collect`
      )
      .send({
        given_names: 'Fatima',
        family_name: 'Said',
        document_checked: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const scanCall = mockQuery.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO scans')
    );

    expect(scanCall).toBeDefined();

    const [, scanParams] = scanCall;

    expect(scanParams[0]).toBe(EXCEPTIONAL_ORDER_ID);
    expect(scanParams[1]).toBe('ORD1');
    expect(scanParams[2]).toBe('u-agent');
    expect(scanParams[4])
      .toBe('AUTHORIZED_NAME_ID_CHECK');
    expect(scanParams[5]).toBe(1);
    expect(scanParams[6]).toBe(true);
    expect(scanParams[7]).toBe('r1');

    await new Promise(process.nextTick);

    expect(mockNotifyText).toHaveBeenCalledWith(
      '+269...',
      expect.stringContaining('ORD1'),
      'exceptional_pickup_collected',
      EXCEPTIONAL_ORDER_ID,
    );
  });
});

describe('POST /api/pickup/regenerate/:orderId (admin only)', () => {
  test('403 si non-admin', async () => {
    const res = await request(app).post('/api/pickup/regenerate/O1').send({ reason: 'Perte du reçu' });
    expect(res.status).toBe(403);
  });

  test('400 si motif absent ou trop court', async () => {
    const res = await request(app)
      .post('/api/pickup/regenerate/O1')
      .set('x-test-noop', '1')
      .send({ reason: 'ab' });
    // requireAdmin bloque avant même la validation de reason si pas admin —
    // on simule un admin pour bien tester la validation de reason.
    expect(res.status).toBe(403); // pas admin par défaut
  });

  test('400 si motif trop court (avec utilisateur admin)', async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'admin1', role: 'admin' }; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/pickup-secret');
      app.use('/api/pickup', router);
    });

    const res = await request(app).post('/api/pickup/regenerate/O1').send({ reason: 'ab' });
    expect(res.status).toBe(400);
  });

  test('404 si commande introuvable (admin)', async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'admin1', role: 'admin' }; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/pickup-secret');
      app.use('/api/pickup', router);
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/pickup/regenerate/O1').send({ reason: 'Perte du reçu client' });
    expect(res.status).toBe(404);
  });

  test('succès (admin) : génère un nouveau code en clair après anti-collision', async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'admin1', role: 'admin' }; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/pickup-secret');
      app.use('/api/pickup', router);
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', pickup_secret_hash: 'old', relais_id: 'R1' }] })
      .mockResolvedValueOnce({ rows: [] }) // anti-collision check: pas de doublon
      .mockResolvedValueOnce({ rows: [] }); // UPDATE orders

    const res = await request(app).post('/api/pickup/regenerate/O1').send({ reason: 'Perte du reçu client' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{2}$/);
  });
});

describe('GET /api/pickup/status/:orderId', () => {
  test('404 si commande introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/pickup/status/O1');
    expect(res.status).toBe(404);
  });

  test('masque le last4, ne renvoie jamais le code complet', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ reference: 'ORD1', status: 'available', total_kmf: 5000, pickup_secret_last4: 'XY12', pickup_secret_created_at: '2026-06-01' }],
    });

    const res = await request(app).get('/api/pickup/status/O1');

    expect(res.status).toBe(200);
    expect(res.body.secret.last4).toBe('XY12');
    expect(res.body.secret.masked).toBe('•••-•XY-12');
    expect(res.body).not.toHaveProperty('code');
    expect(res.body).not.toHaveProperty('pickup_secret_hash');
  });
});

describe('GET /api/pickup/reveal-once/:orderId', () => {
  test('404 si commande introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/pickup/reveal-once/O1');
    expect(res.status).toBe(404);
  });

  test('403 si la commande n\'appartient pas à req.user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'O1', user_id: 'other-user' }] });
    const res = await request(app).get('/api/pickup/reveal-once/O1');
    expect(res.status).toBe(403);
  });

  test('202 pending si pas encore de hash (paiement non confirmé)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'O1', user_id: 'u-agent', pickup_secret_hash: null }] });
    const res = await request(app).get('/api/pickup/reveal-once/O1');
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending');
  });

  test('410 si déjà révélé', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'O1', user_id: 'u-agent', pickup_secret_hash: 'h', pickup_secret_revealed_at: '2026-06-01', pickup_secret_last4: 'XY12' }],
    });
    const res = await request(app).get('/api/pickup/reveal-once/O1');
    expect(res.status).toBe(410);
    expect(res.body.masked).toBe('•••-•••-12');
  });

  test('410 si la fenêtre de 30 minutes est expirée', async () => {
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'O1', user_id: 'u-agent', pickup_secret_hash: 'h', pickup_secret_revealed_at: null, pickup_secret_emitted_at: old, pickup_secret_last4: 'XY12' }],
    });
    const res = await request(app).get('/api/pickup/reveal-once/O1');
    expect(res.status).toBe(410);
  });

  test('410 si revealRow absent (TTL expiré / redémarrage serveur)', async () => {
    const recent = new Date().toISOString();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'O1', user_id: 'u-agent', pickup_secret_hash: 'h', pickup_secret_revealed_at: null, pickup_secret_emitted_at: recent, pickup_secret_last4: 'XY12' }] })
      .mockResolvedValueOnce({ rows: [] }); // SELECT pickup_reveal_codes vide

    const res = await request(app).get('/api/pickup/reveal-once/O1');
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Code non disponible');
  });

  test('succès : marque revealed, supprime la ligne reveal, renvoie le code UNE FOIS', async () => {
    const recent = new Date().toISOString();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', user_id: 'u-agent', pickup_secret_hash: 'h', pickup_secret_revealed_at: null, pickup_secret_emitted_at: recent, pickup_secret_channel: 'stripe', total_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ code: 'A7K-3M9-P2' }] }) // SELECT pickup_reveal_codes
      .mockResolvedValueOnce({ rows: [] }) // UPDATE revealed_at
      .mockResolvedValueOnce({ rows: [] }); // DELETE pickup_reveal_codes

    const res = await request(app).get('/api/pickup/reveal-once/O1');

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('A7K-3M9-P2');
    expect(res.body.qr_payload).toMatch(/^KMR1\./);
  });
});

// O7.2 (Cycle B) : le describe 'generateAndStoreSecret (export interne)' a
// été retiré — la fonction n'est plus définie/exportée par cette route (elle
// vit dans services/pickup-secret-service.js, dont la couverture équivalente
// et plus complète — anti-collision, saturation, extraUpdates — se trouve
// dans tests/unit/pickup-secret-service.test.js). Voir
// docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
