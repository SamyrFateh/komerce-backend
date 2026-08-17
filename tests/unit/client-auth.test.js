'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/client-auth.test.js
 *
 * Couvre routes/client-auth.js
 * maskPhone, canEchoMagicLink, getStatusLabel ne sont pas exportées —
 * testées indirectement via le comportement des routes.
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockSendMagicLink = jest.fn();
jest.mock('../../services/notification-service', () => ({ sendMagicLink: (...args) => mockSendMagicLink(...args) }));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
  forModule: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'test_secret_min_32_chars_aaaaaaaaaaaaaaaa';
  delete process.env.NODE_ENV;
  delete process.env.MAGIC_LINK_DEV_ECHO;
  currentUser = null;

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/client-auth');
    app.use('/api/auth', router);
  });

  app.use((err, _req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({
      error: err.message,
    });
  });
});


describe('POST /magic-link', () => {
  it('telephone manquant → 400', async () => {
    const res = await request(app).post('/api/auth/magic-link').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('utilisateur inexistant → 200 message generique (ne revele pas l\'existence)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/auth/magic-link').send({ phone: '0612345678' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Si ce numéro est enregistré');
  });

  it('nominal → genere un token, met a jour le user, envoie le lien', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', phone: '0612345678', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockSendMagicLink.mockResolvedValue({ success: true, channel: 'whatsapp' });

    const res = await request(app).post('/api/auth/magic-link').send({ phone: '0612345678' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('WhatsApp');
    expect(res.body._dev_link).toBeUndefined();
  });

  it('echec envoi WhatsApp → message generique malgre tout (succes 200)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', phone: '0612345678', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockSendMagicLink.mockResolvedValue({ success: false, reason: 'provider_down' });

    const res = await request(app).post('/api/auth/magic-link').send({ phone: '0612345678' });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Si ce numéro est enregistré');
  });

  it('mode dev avec echo active → expose _dev_link', async () => {
    process.env.NODE_ENV = 'development';
    process.env.MAGIC_LINK_DEV_ECHO = 'true';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', phone: '0612345678', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockSendMagicLink.mockResolvedValue({ success: true });

    const res = await request(app).post('/api/auth/magic-link').send({ phone: '0612345678' });
    expect(res.body._dev_link).toContain('token=');
  });

  it('erreur DB → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/auth/magic-link').send({ phone: '0612345678' });
    expect(res.status).toBe(500);
  });
});

describe('GET /magic-link/validate', () => {
  it('token manquant → redirige avec error=token_missing', async () => {
    const res = await request(app).get('/api/auth/magic-link/validate');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=token_missing');
  });

  it('token invalide ou expire → redirige avec error=token_invalid', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/auth/magic-link/validate?token=xxx');
    expect(res.headers.location).toContain('error=token_invalid');
  });

  it('token valide → invalide le token, pose le cookie JWT, redirige vers /mon-compte', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'Jean', phone: '061', email: null, role: 'client' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // invalidate token

    const res = await request(app).get('/api/auth/magic-link/validate?token=valid-token');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/mon-compte');
    expect(res.headers['set-cookie'][0]).toContain('kmrc_jwt=');
  });

  it('erreur DB → redirige avec error=server_error (pas de crash)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/auth/magic-link/validate?token=xxx');
    expect(res.headers.location).toContain('error=server_error');
  });
});

describe('GET /orders — authentification requise', () => {
  it('sans utilisateur authentifie → 401', async () => {
    const res = await request(app).get('/api/auth/orders');
    expect(res.status).toBe(401);
  });

  it('nominal → liste les commandes avec items, colis et statusLabel', async () => {
    currentUser = { id: 'u1', role: 'client' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', reference: 'ORD-1', status: 'shipped', total_kmf: 5000 }] }) // orders
      .mockResolvedValueOnce({ rows: [{ quantity: 2, price_kmf: 1000, name: 'Riz', emoji: '🍚' }] }) // items
      .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'PCL-1', status: 'shipped', weight_kg: 3 }] }); // parcels

    const res = await request(app).get('/api/auth/orders');
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].items[0].name).toBe('Riz');
    expect(res.body.orders[0].parcels).toHaveLength(1);
    expect(res.body.orders[0].statusLabel).toBe('Expédiée');
    expect(res.body.orders[0].totalKmf).toBe(5000);
  });

  it('aucune commande → tableau vide', async () => {
    currentUser = { id: 'u1', role: 'client' };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/auth/orders');
    expect(res.body.orders).toEqual([]);
  });

  it('statut inconnu → getStatusLabel retombe sur le statut brut', async () => {
    currentUser = { id: 'u1', role: 'client' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'mystere' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/auth/orders');
    expect(res.body.orders[0].statusLabel).toBe('mystere');
  });

  it('erreur DB → 500', async () => {
    currentUser = { id: 'u1', role: 'client' };
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/auth/orders');
    expect(res.status).toBe(500);
  });
});

describe('GET /invoices — authentification requise', () => {
  it('sans utilisateur authentifie → 401', async () => {
    const res = await request(app).get('/api/auth/invoices');
    expect(res.status).toBe(401);
  });

  it('nominal → mappe les factures en camelCase', async () => {
    currentUser = { id: 'u1', role: 'client' };
    mockQuery.mockResolvedValueOnce({
      rows: [{
        invoice_number: 'INV-1', order_reference: 'ORD-1',
        subtotal_kmf: 4000, shipping_kmf: 1000, total_kmf: 5000,
        payment_mode: 'cash_relais', created_at: '2026-01-01',
      }],
    });
    const res = await request(app).get('/api/auth/invoices');
    expect(res.status).toBe(200);
    expect(res.body.invoices[0]).toMatchObject({
      invoiceNumber: 'INV-1', orderReference: 'ORD-1', totalKmf: 5000,
    });
  });

  it('aucune facture → tableau vide', async () => {
    currentUser = { id: 'u1', role: 'client' };
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/auth/invoices');
    expect(res.body.invoices).toEqual([]);
  });

  it('erreur DB → 500', async () => {
    currentUser = { id: 'u1', role: 'client' };
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/api/auth/invoices');
    expect(res.status).toBe(500);
  });
});
