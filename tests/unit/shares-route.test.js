/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/shares (P0 shared-cart)
 *
 * Couvre le système "cart_shares" v2 (event shares + contributions) :
 * - POST / : création de lien (simple/event), calcul du total, retry sur
 *   collision de token
 * - GET /:token : lecture, expiration, enrichissement produits (promo),
 *   contributions si type=event
 * - POST /:token/contributions : validations, calcul de prix mode item,
 *   garde-fous statut/type/expiration
 * - PATCH /:token/contributions/:id : confirmation/annulation, recalcul
 *   contributed_kmf
 *
 * Run : npx jest tests/unit/shares-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
  forModule: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const router = require('../../routes/shares');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/shares', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/shares', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  describe('POST /', () => {
    test('rejette si cart_items absent ou vide', async () => {
      const res1 = await request(buildApp()).post('/api/shares').send({});
      expect(res1.status).toBe(400);

      const res2 = await request(buildApp()).post('/api/shares').send({ cart_items: [] });
      expect(res2.status).toBe(400);

      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('crée un lien simple, calcule le total et insère en DB', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rowCount: 0 }) // token unique au 1er essai
        .mockResolvedValueOnce({}); // INSERT cart_shares

      const res = await request(buildApp())
        .post('/api/shares')
        .send({
          cart_items: [
            { product_id: 'p1', price_kmf: 1000, qty: 2 },
            { product_id: 'p2', price_kmf: 500, qty: 1 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.total_kmf).toBe(2500);
      expect(res.body.token).toHaveLength(12); // [TOK-02] genToken CSPRNG, len>=12
      expect(res.body.redirect).toBe(`/boutique/?share=${res.body.token}`);

      const insertCall = mockDbQuery.mock.calls[1];
      expect(insertCall[0]).toMatch(/INSERT INTO cart_shares/);
      // Le type 'simple' est un LITTÉRAL SQL (VALUES ($1, $2, 'simple', ...)),
      // pas un paramètre lié : il n'apparaît pas dans insertCall[1].
      // On prouve que le SQL porte le littéral, et que les paramètres liés
      // sont dans le bon ordre : token[0], items_json[1], sharer_name[2],
      // expiresAt[3] — sharer_name est null quand absent du payload.
      expect(insertCall[0]).toMatch(/'simple'/);
      expect(insertCall[1][0]).toBe(res.body.token);
      expect(insertCall[1][2]).toBeNull(); // sharer_name absent → null
    });

    test('réessaie la génération de token en cas de collision', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rowCount: 1 }) // collision
        .mockResolvedValueOnce({ rowCount: 0 }) // unique au 2e essai
        .mockResolvedValueOnce({}); // INSERT

      const res = await request(buildApp())
        .post('/api/shares')
        .send({ cart_items: [{ product_id: 'p1', price_kmf: 100, qty: 1 }] });

      expect(res.status).toBe(200);
      // 2 vérifications de token + 1 insert
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });

    test('utilise price_kmf du produit imbriqué si non fourni au niveau racine', async () => {
      mockDbQuery.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({});

      const res = await request(buildApp())
        .post('/api/shares')
        .send({ cart_items: [{ product: { price_kmf: 300 }, qty: 3 }] });

      expect(res.body.total_kmf).toBe(900);
    });
  });

  describe('GET /:token', () => {
    test('renvoie 404 si le lien est introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).get('/api/shares/unknown-token');
      expect(res.status).toBe(404);
    });

    test('renvoie 410 si le lien a expiré', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ share_token: 'tok', expires_at: new Date(Date.now() - 1000), cart_items: '[]', type: 'simple' }],
      });

      const res = await request(buildApp()).get('/api/shares/tok');
      expect(res.status).toBe(410);
    });

    test('lit un partage simple, enrichit les items et calcule le total', async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            share_token: 'tok',
            type: 'simple',
            status: 'active',
            expires_at: new Date(Date.now() + 1000000),
            cart_items: JSON.stringify([{ product_id: 'p1', qty: 2 }]),
            contributed_kmf: 0,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'p1', name: 'Produit 1', price_kmf: 1000, is_promo: false }],
        });

      const res = await request(buildApp()).get('/api/shares/tok');

      expect(res.status).toBe(200);
      expect(res.body.items[0].product.price_kmf).toBe(1000);
      expect(res.body.total_kmf).toBe(2000);
    });

    test('applique le prix promo actif lors de l\'enrichissement', async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            share_token: 'tok',
            type: 'simple',
            status: 'active',
            expires_at: null,
            cart_items: JSON.stringify([{ product_id: 'p1', qty: 1 }]),
            contributed_kmf: 0,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'p1', name: 'Produit Promo', price_kmf: 1000,
            is_promo: true, promo_pct: 20, promo_until: null,
          }],
        });

      const res = await request(buildApp()).get('/api/shares/tok');

      expect(res.body.items[0].product.price_kmf).toBe(800);
    });

    test('ignore une promo expirée (promo_until dépassé)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            share_token: 'tok',
            type: 'simple',
            status: 'active',
            expires_at: null,
            cart_items: JSON.stringify([{ product_id: 'p1', qty: 1 }]),
            contributed_kmf: 0,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'p1', name: 'Produit', price_kmf: 1000,
            is_promo: true, promo_pct: 20, promo_until: '2020-01-01',
          }],
        });

      const res = await request(buildApp()).get('/api/shares/tok');

      expect(res.body.items[0].product.price_kmf).toBe(1000);
    });

    test('items vides : enrichItems retourne [] sans appel DB supplémentaire', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          share_token: 'tok',
          type: 'simple',
          status: 'active',
          expires_at: null,
          cart_items: JSON.stringify([]),
          contributed_kmf: 0,
        }],
      });

      const res = await request(buildApp()).get('/api/shares/tok');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total_kmf).toBe(0);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });
  });

});
