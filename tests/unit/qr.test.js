'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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

// GET /retrait/:token reste sur db.query direct (lecture publique, hors P5 §4.6).
const mockQuery = jest.fn();

// POST /:id/qr-token est désormais une façade transactionnelle sur
// db.getClient() qui délègue à issueOrRotateQrToken (P5 §4.6) — le noyau
// lui-même est testé séparément dans qr-collection-core-emission.test.js ;
// ici on ne teste que l'orchestration de la route (BEGIN/COMMIT/ROLLBACK,
// IDOR via preWriteCheck, mapping résultat → réponse HTTP).
const mockIssueOrRotateQrToken = jest.fn();
jest.mock('../../services/qr-collection-core', () => ({
  issueOrRotateQrToken: (...args) => mockIssueOrRotateQrToken(...args),
}));

function makeFakeClient() {
  const calls = [];
  return {
    calls,
    released: false,
    query: jest.fn(async (sql) => { calls.push(String(sql).trim()); return { rows: [] }; }),
    release: jest.fn(function () { this.released = true; }),
  };
}

let fakeClient;
const mockGetClient = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));
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
  fakeClient = makeFakeClient();
  mockGetClient.mockResolvedValue(fakeClient);
  getRule.mockResolvedValue(48);

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
    expect(mockGetClient).not.toHaveBeenCalled();
  });
});

describe('POST /:id/qr-token — orchestration transactionnelle', () => {
  it('BEGIN posé avant l\'appel au noyau, COMMIT après un résultat ok:true, client libéré', async () => {
    mockIssueOrRotateQrToken.mockResolvedValue({
      ok: true, order: { id: 'order-1', reference: 'ORD-1' }, token: 'a'.repeat(48), expiresAt: new Date(), rotated: false,
    });

    const res = await request(app).post('/api/orders/order-1/qr-token');

    expect(res.status).toBe(200);
    expect(fakeClient.calls[0]).toBe('BEGIN');
    expect(fakeClient.calls).toContain('COMMIT');
    expect(fakeClient.calls).not.toContain('ROLLBACK');
    expect(fakeClient.released).toBe(true);
    expect(mockIssueOrRotateQrToken).toHaveBeenCalledWith(expect.objectContaining({
      client: fakeClient, orderId: 'order-1', expirationHours: 48,
    }));
  });

  it('résultat ok:false → pas de COMMIT (le noyau a déjà fait ROLLBACK), statut/erreur du noyau propagés', async () => {
    mockIssueOrRotateQrToken.mockResolvedValue({
      ok: false, response: { status: 422, body: { error: 'Impossible de générer un QR — statut actuel : shipped (attendu : available)', current_status: 'shipped' } },
    });

    const res = await request(app).post('/api/orders/order-1/qr-token');

    expect(res.status).toBe(422);
    expect(res.body.current_status).toBe('shipped');
    expect(fakeClient.calls).not.toContain('COMMIT');
    expect(fakeClient.released).toBe(true);
  });

  it('commande introuvable (ok:false 404 du noyau) → 404 propagé', async () => {
    mockIssueOrRotateQrToken.mockResolvedValue({
      ok: false, response: { status: 404, body: { error: 'Commande introuvable' } },
    });
    const res = await request(app).post('/api/orders/order-x/qr-token');
    expect(res.status).toBe(404);
  });

  it('le noyau lève une exception → ROLLBACK, client libéré, 500 via next(err)', async () => {
    mockIssueOrRotateQrToken.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(500);
    expect(fakeClient.calls).toContain('ROLLBACK');
    expect(fakeClient.released).toBe(true);
  });

  it('qrHours résolu via getRule est transmis au noyau (expirationHours)', async () => {
    getRule.mockResolvedValue(72);
    mockIssueOrRotateQrToken.mockResolvedValue({
      ok: true, order: { id: 'order-1', reference: 'ORD-1' }, token: 'b'.repeat(48), expiresAt: new Date(), rotated: false,
    });
    await request(app).post('/api/orders/order-1/qr-token');
    expect(mockIssueOrRotateQrToken).toHaveBeenCalledWith(expect.objectContaining({ expirationHours: 72 }));
  });
});

describe('POST /:id/qr-token — IDOR via preWriteCheck', () => {
  it('transmet un preWriteCheck qui bloque un agent_relais sur la commande d\'un autre relais', async () => {
    currentUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
    mockIssueOrRotateQrToken.mockImplementation(async ({ preWriteCheck }) => {
      const authz = preWriteCheck({ id: 'order-1', relais_id: 'relais-B' });
      if (!authz.ok) return authz;
      return { ok: true, order: {}, token: 'c'.repeat(48), expiresAt: new Date(), rotated: false };
    });

    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('relais');
  });

  it('agent_relais sur commande de son propre relais → preWriteCheck ok:true, continue', async () => {
    currentUser = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-A' };
    mockIssueOrRotateQrToken.mockImplementation(async ({ preWriteCheck }) => {
      const authz = preWriteCheck({ id: 'order-1', relais_id: 'relais-A' });
      expect(authz.ok).toBe(true);
      return {
        ok: true,
        order: { id: 'order-1', reference: 'ORD-1', relais_id: 'relais-A', relais_name: 'Relais A' },
        token: 'd'.repeat(48), expiresAt: new Date(), rotated: false,
      };
    });

    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(200);
  });

  it('admin n\'est pas soumis au garde IDOR relais', async () => {
    currentUser = { id: 'admin-1', role: 'admin' };
    mockIssueOrRotateQrToken.mockImplementation(async ({ preWriteCheck }) => {
      const authz = preWriteCheck({ id: 'order-1', relais_id: 'relais-Z' });
      expect(authz.ok).toBe(true);
      return { ok: true, order: {}, token: 'e'.repeat(48), expiresAt: new Date(), rotated: false };
    });
    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(200);
  });
});

describe('POST /:id/qr-token — construction du qr_payload', () => {
  it('nominal → qr_payload complet, distingue rotated:false/true dans le résultat', async () => {
    mockIssueOrRotateQrToken.mockResolvedValue({
      ok: true,
      order: { id: 'order-1', reference: 'ORD-1', recipient_name: 'Jean Client', relais_id: 'relais-A', relais_name: 'Relais Moroni' },
      token: 'f'.repeat(48),
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      rotated: true,
    });

    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBe('f'.repeat(48));
    expect(res.body.qr_payload).toMatchObject({
      orderId: 'order-1',
      reference: 'ORD-1',
      clientName: 'Jean Client',
      relaisId: 'relais-A',
      relaisName: 'Relais Moroni',
    });
  });

  it('pas de recipient_name → fallback "Client"', async () => {
    mockIssueOrRotateQrToken.mockResolvedValue({
      ok: true,
      order: { id: 'order-1', reference: 'ORD-1', recipient_name: null, relais_id: null, relais_name: null },
      token: 'g'.repeat(48),
      expiresAt: new Date(),
      rotated: false,
    });
    const res = await request(app).post('/api/orders/order-1/qr-token');
    expect(res.body.qr_payload.clientName).toBe('Client');
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
