'use strict';

/**
 * tests/unit/qr.test.js
 *
 * Couvre routes/orders/qr.js
 *   POST /:id/qr-token   — génération token QR (admin/agent_relais)
 *   GET  /retrait/:token — page HTML retrait client (publique)
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../utils/rules', () => ({ getRule: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const { getRule } = require('../../utils/rules');
const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.QR_SECRET = 'test_qr_secret_min_32_chars_aaaaaaaaaaaaaaaa';
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/orders/qr');
    app.use('/api/orders', router);
  });
});

describe('POST /:id/qr-token — accès', () => {
  it('refuse un rôle non autorisé (403)', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(403);
  });
});

describe('POST /:id/qr-token — nominal', () => {
  it('commande introuvable → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/orders/order-x/qr-token');
    expect(res.status).toBe(404);
  });

  it('agent_relais sur commande d\'un autre relais → 403 (IDOR guard)', async () => {
    currentUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available', relais_id: 'relais-B' }] });
    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('relais');
  });

  it('agent_relais sur commande de son propre relais → autorisé (continue)', async () => {
    currentUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available', relais_id: 'relais-A', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE
    getRule.mockResolvedValue(48);

    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(200);
  });

  it('statut commande != available → 422 avec statut courant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'shipped', relais_id: 'r1' }] });
    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(422);
    expect(res.body.current_status).toBe('shipped');
  });

  it('nominal → genere un token, l\'enregistre, retourne le qr_payload', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'order-1', status: 'available', relais_id: 'relais-A',
        reference: 'ORD-1', recipient_name: 'Jean Client', relais_name: 'Relais Moroni',
      }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE
    getRule.mockResolvedValue(48);

    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token).toHaveLength(48); // [TOK-01] crypto.randomBytes(24).toString('hex')
    expect(res.body.qr_payload).toMatchObject({
      orderId: 'order-1',
      reference: 'ORD-1',
      clientName: 'Jean Client',
      relaisId: 'relais-A',
      relaisName: 'Relais Moroni',
    });
  });

  it('pas de recipient_name → fallback "Client"', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available', relais_id: null, reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    getRule.mockResolvedValue(48);

    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.body.qr_payload.clientName).toBe('Client');
  });

  it('erreur DB → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(500);
  });
});

// [TOK-01] Preuve : token QR = CSPRNG pur, non dérivé des inputs connus.
// Le fail-closed QR_SECRET au boot est déjà prouvé par
// tests/unit/bootstrap-env.test.js (préexistant, inchangé) — non dupliqué ici.
describe('POST /:id/qr-token — TOK-01 (entropie token)', () => {
  it('génère un token différent à chaque appel pour la même commande (non-déterministe)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available', relais_id: 'relais-A', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    getRule.mockResolvedValue(48);
    const res1 = await request(app).post('/api/orders/order-1/qr-token');

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available', relais_id: 'relais-A', reference: 'ORD-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    getRule.mockResolvedValue(48);
    const res2 = await request(app).post('/api/orders/order-1/qr-token');

    expect(res1.body.token).not.toBe(res2.body.token);
  });

  it('le token ne dépend pas de QR_SECRET au runtime (génération indépendante du secret)', async () => {
    const originalSecret = process.env.QR_SECRET;
    try {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'available', relais_id: 'relais-A', reference: 'ORD-1' }] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      getRule.mockResolvedValue(48);
      process.env.QR_SECRET = 'un_autre_secret_completement_different_xx';
      const res = await request(app).post('/api/orders/order-1/qr-token');

      expect(res.status).toBe(200);
      expect(res.body.token).toHaveLength(48);
      expect(res.body.token).toMatch(/^[0-9a-f]{48}$/);
    } finally {
      process.env.QR_SECRET = originalSecret;
    }
  });
});

describe('GET /retrait/:token — publique', () => {
  it('token invalide/inexistant → 404 page HTML "Lien invalide"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/orders/retrait/token-inexistant');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Lien invalide');
  });

  it('token valide non expiré → 200 page HTML avec QR + pas de bandeau expiré', async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{
      reference: 'ORD-1', qr_expires_at: future,
      client_name: 'Jean', client_phone: '0001', relais_name: 'Relais A', relais_address: 'Moroni',
    }] });
    const res = await request(app).get('/api/orders/retrait/valid-token');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('ORD-1');
    expect(res.text).not.toMatch(/<div class="expired-banner">/);
  });

  it('token expiré → 200 avec bandeau "expiré" et bouton désactivé', async () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{
      reference: 'ORD-1', qr_expires_at: past, client_name: 'Jean', relais_name: 'Relais A', relais_address: null,
    }] });
    const res = await request(app).get('/api/orders/retrait/expired-token');
    expect(res.status).toBe(200);
    expect(res.text).toContain('expired-banner');
    expect(res.text).toContain('disabled');
  });

  it('client_name absent → affiche "—" en fallback', async () => {
    const future = new Date(Date.now() + 1000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{
      reference: 'ORD-1', qr_expires_at: future, client_name: null, relais_name: null, relais_address: null,
    }] });
    const res = await request(app).get('/api/orders/retrait/some-token');
    expect(res.status).toBe(200);
    expect(res.text).toContain('—');
  });

  it('erreur DB → 500 avec page erreur simple', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/orders/retrait/some-token');
    expect(res.status).toBe(500);
    expect(res.text).toContain('Erreur serveur');
  });
});
