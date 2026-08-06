/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/finance (Lot B2)
 *
 * Couvre la façade HTTP finance : guard admin, sanitizePeriod (bornes
 * mois/année), génération CSV (/export), rapprochement Stripe
 * (/stripe-proofs), et déclenchement du rapport PDF (/report). `stripe` et
 * `pdfkit` sont mockés — ce ne sont pas des sources de vérité métier à
 * retester ici, seule l'orchestration de la route est couverte.
 *
 * Run : npx jest tests/unit/finance-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));

const mockGetRates = jest.fn();
jest.mock('../../utils/rates', () => ({ getRates: (...args) => mockGetRates(...args) }));

const mockRetrieveIntent = jest.fn();
const mockRetrievePM = jest.fn();
jest.mock('stripe', () => () => ({
  paymentIntents: { retrieve: (...args) => mockRetrieveIntent(...args) },
  paymentMethods: { retrieve: (...args) => mockRetrievePM(...args) },
}));

// pdfkit génère un vrai flux binaire — on le remplace par un stub minimal
// qui expose la même API fluide et pipe un contenu trivial vers la réponse.
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const doc = {};
    const chain = [
      'rect', 'fill', 'fillColor', 'fontSize', 'font', 'text', 'circle',
      'moveDown', 'strokeColor', 'stroke', 'moveTo', 'lineTo', 'fillAndStroke',
    ];
    chain.forEach((m) => { doc[m] = jest.fn(() => doc); });
    doc.page = { width: 595, height: 842 };
    doc.y = 100;
    let target = null;
    doc.pipe = jest.fn((res) => { target = res; res.write('%PDF-stub'); return res; });
    doc.end = jest.fn(() => { if (target) target.end(); });
    return doc;
  });
});

const router = require('../../routes/finance');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/finance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    mockUser = { id: 'admin-1', role: 'admin' };
  });

  test('toutes les routes exigent le rôle admin', async () => {
    mockUser = { id: 'user-1', role: 'client' };
    const res1 = await request(buildApp()).get('/api/finance/export');
    const res2 = await request(buildApp()).get('/api/finance/stripe-proofs');
    const res3 = await request(buildApp()).get('/api/finance/report');
    expect(res1.status).toBe(403);
    expect(res2.status).toBe(403);
    expect(res3.status).toBe(403);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('toutes les routes exigent une authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/finance/export');
    expect(res.status).toBe(401);
  });

  describe('GET /summary (déplacée)', () => {
    test('renvoie une redirection 301 vers /api/dashboard/finance', async () => {
      const res = await request(buildApp()).get('/api/finance/summary');
      expect(res.status).toBe(301);
      expect(res.body.redirect).toBe('/api/dashboard/finance');
      expect(mockDbQuery).not.toHaveBeenCalled();
    });
  });

  describe('GET /export', () => {
    test('exporte un CSV avec BOM UTF-8 et en-têtes corrects', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          reference: 'CMD-001', created_at: '2026-03-05T10:00:00Z', status: 'delivered',
          payment_mode: 'cash_relais', payment_status: 'paid', total_kmf: 10000, total_eur: null,
          cost_real_kmf: 6000, cost_estimated_kmf: 5500, margin_real_pct: 40,
          order_occasion: 'Ramadan', client_name: 'Fatima', client_phone: '+269...',
          relais_name: 'Relais Moroni', taux_eur_kmf: 492, taux_aed_kmf: 138,
        }],
      });

      const res = await request(buildApp()).get('/api/finance/export').query({ month: 3, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/komerce-export-03-2026\.csv/);
      expect(res.text.charCodeAt(0)).toBe(0xFEFF);
      expect(res.text).toContain('Référence');
      expect(res.text).toContain('CMD-001');
    });

    test('exporte un CSV vide (aucune commande sur la période)', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).get('/api/finance/export');

      expect(res.status).toBe(200);
      expect(res.text).toContain('Référence'); // en-tête toujours présent
    });

    test('échappe correctement les valeurs contenant des virgules/guillemets', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          reference: 'CMD-002', created_at: '2026-03-05T10:00:00Z', status: 'delivered',
          payment_mode: 'cash_relais', payment_status: 'paid', total_kmf: 5000, total_eur: null,
          client_name: 'Doe, "Jean"', relais_name: null,
        }],
      });

      const res = await request(buildApp()).get('/api/finance/export');

      expect(res.text).toContain('"Doe, ""Jean"""');
    });

    test('propage une erreur DB au handler global', async () => {
      mockDbQuery.mockRejectedValueOnce(new Error('db down'));

      const res = await request(buildApp()).get('/api/finance/export');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /stripe-proofs', () => {
    test('renvoie une liste vide si aucune commande stripe payée ce mois', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).get('/api/finance/stripe-proofs').query({ month: 3, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ month: 3, year: 2026, count: 0, transactions: [] });
      expect(mockGetRates).not.toHaveBeenCalled();
    });

    test('enrichit les transactions avec les détails Stripe si STRIPE_SECRET_KEY est configurée', async () => {
      const prevKey = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';

      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          reference: 'CMD-010', stripe_payment_id: 'pi_123', total_eur: '49.90', total_kmf: 24550,
          created_at: '2026-03-10T00:00:00Z', client_name: 'Amina', client_email: 'amina@example.com',
        }],
      });
      mockRetrieveIntent.mockResolvedValueOnce({
        status: 'succeeded', amount: 4990, created: 1700000000, receipt_email: 'amina@example.com',
        payment_method: 'pm_123',
      });
      mockRetrievePM.mockResolvedValueOnce({ card: { last4: '4242' } });
      mockGetRates.mockResolvedValueOnce({ eur_kmf: 492, aed_kmf: 138 });

      const res = await request(buildApp()).get('/api/finance/stripe-proofs').query({ month: 3, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.transactions[0].stripe_status).toBe('succeeded');
      expect(res.body.transactions[0].stripe_last4).toBe('4242');
      expect(res.body.transactions[0].stripe_dashboard_url).toBe('https://dashboard.stripe.com/payments/pi_123');
      expect(res.body.total_eur).toBeCloseTo(49.9);

      process.env.STRIPE_SECRET_KEY = prevKey;
    });

    test('n\'échoue pas si Stripe renvoie une erreur pour un PaymentIntent', async () => {
      const prevKey = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';

      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          reference: 'CMD-011', stripe_payment_id: 'pi_bad', total_eur: '10.00', total_kmf: 4920,
          created_at: '2026-03-10T00:00:00Z', client_name: 'X', client_email: 'x@example.com',
        }],
      });
      mockRetrieveIntent.mockRejectedValueOnce(new Error('No such payment_intent'));
      mockGetRates.mockResolvedValueOnce({ eur_kmf: 492, aed_kmf: 138 });

      const res = await request(buildApp()).get('/api/finance/stripe-proofs').query({ month: 3, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.body.transactions[0].stripe_error).toBe('No such payment_intent');

      process.env.STRIPE_SECRET_KEY = prevKey;
    });

    test('ne tente pas de récupérer les détails Stripe si la clé n\'est pas configurée', async () => {
      const prevKey = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;

      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          reference: 'CMD-012', stripe_payment_id: 'pi_999', total_eur: '10.00', total_kmf: 4920,
          created_at: '2026-03-10T00:00:00Z', client_name: 'X', client_email: 'x@example.com',
        }],
      });
      mockGetRates.mockResolvedValueOnce({ eur_kmf: 492, aed_kmf: 138 });

      const res = await request(buildApp()).get('/api/finance/stripe-proofs').query({ month: 3, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.body.transactions[0].stripe_status).toBeUndefined();
      expect(mockRetrieveIntent).not.toHaveBeenCalled();

      process.env.STRIPE_SECRET_KEY = prevKey;
    });
  });

  describe('GET /report', () => {
    test('génère un PDF avec les en-têtes corrects', async () => {
      mockGetRates.mockResolvedValueOnce({ eur_kmf: 492, aed_kmf: 138 });
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          nb_commandes: 42, nb_cash: 30, nb_stripe: 12,
          ca_kmf: 1000000, ca_eur: 500, ca_cash_kmf: 700000, ca_stripe_eur: 500,
          couts_reels_kmf: 600000, marge_moy_pct: 35.5, nb_annulations: 2, nb_livrees: 38,
        }],
      });

      const res = await request(buildApp()).get('/api/finance/report').query({ month: 3, year: 2026 });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['content-disposition']).toMatch(/komerce-rapport-03-2026\.pdf/);
    });

    test('propage une erreur DB au handler global', async () => {
      mockGetRates.mockResolvedValueOnce({ eur_kmf: 492, aed_kmf: 138 });
      mockDbQuery.mockRejectedValueOnce(new Error('db down'));

      const res = await request(buildApp()).get('/api/finance/report');

      expect(res.status).toBe(500);
    });
  });

  describe('sanitizePeriod (bornes via /export)', () => {
    test('clamp le mois et l\'année aux bornes valides', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).get('/api/finance/export').query({ month: 15, year: 1999 });

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/komerce-export-12-2024\.csv/);
    });

    test('utilise le mois/année courants si absents', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const now = new Date();
      const expectedLabel = `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

      const res = await request(buildApp()).get('/api/finance/export');

      expect(res.headers['content-disposition']).toContain(`komerce-export-${expectedLabel}.csv`);
    });
  });
});
