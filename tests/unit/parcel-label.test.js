'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-label.test.js
 *
 * Tests du router routes/parcel-label.js (génération HTML étiquette + QR)
 *
 * Pas de logique métier complexe ici (pas de transaction) — on vérifie les
 * invariants de sécurité et de contenu plutôt que de parser tout le HTML :
 *
 *   ✓ 404 si le colis n'existe pas
 *   ✓ fallback parcel_items → orders via parcels.order_id si aucun parcel_item
 *   ✓ fallback items → order_items directs si aucun parcel_item pour la commande
 *   ✓ pickup_code affiché uniquement si présent
 *   ✓ format=thermal change la largeur de l'étiquette (80mm vs 148mm)
 *   ✓ Content-Type: text/html
 *   ✓ totaux (commandes/articles/montant) calculés correctement
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'u1', role: 'agent_hub' }; next(); },
  requireRole: () => (req, res, next) => next(),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  jest.isolateModules(() => {
    const router = require('../../routes/parcel-label');
    app.use('/api/v2/parcels', router);
  });
});

function parcelRow(overrides = {}) {
  return {
    id: 'PID1', reference: 'P1', status: 'shipped', pickup_code: null, weight_kg: 2.5,
    destination_island: 'Grande Comore', created_at: '2026-06-01', shipped_at: null, available_at: null,
    relais_name: 'Relais Moroni', island: 'Grande Comore', relais_city: 'Moroni',
    ...overrides,
  };
}

describe('GET /:ref/label — colis introuvable', () => {
  test('404 si le colis n\'existe pas', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v2/parcels/INCONNU/label');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Colis non trouvé');
  });
});

describe('GET /:ref/label — résolution des commandes/items', () => {
  test('utilise parcel_items quand disponibles, pas de fallback', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow()] }) // parcel
      .mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', total_kmf: 5000, client_name: 'Ali', client_phone: '321' }] }) // orders via parcel_items
      .mockResolvedValueOnce({ rows: [{ quantity: 2, unit_price: 2500, product_name: 'Sucre' }] }); // items via parcel_items

    const res = await request(app).get('/api/v2/parcels/P1/label');

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(res.text).toContain('Sucre');
    expect(res.text).toContain('Ali');
  });

  test('fallback orders via parcels.order_id si aucun parcel_item', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow()] })
      .mockResolvedValueOnce({ rows: [] }) // pas d'orders via parcel_items
      .mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', total_kmf: 3000, client_name: 'Fatima', client_phone: '111' }] }) // fallback
      .mockResolvedValueOnce({ rows: [{ quantity: 1, unit_price: 3000, product_name: 'Riz' }] }); // items pour O1

    const res = await request(app).get('/api/v2/parcels/P1/label');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Fatima');
    expect(res.text).toContain('Riz');
  });

  test('fallback items via order_items directs si aucun parcel_item pour la commande', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'O1', reference: 'ORD1', total_kmf: 1000, client_name: 'Bob', client_phone: '222' }] })
      .mockResolvedValueOnce({ rows: [] }) // pas d'items via parcel_items
      .mockResolvedValueOnce({ rows: [{ quantity: 1, unit_price: 1000, product_name: 'Huile' }] }); // fallback order_items

    const res = await request(app).get('/api/v2/parcels/P1/label');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Huile');
  });
});

describe('GET /:ref/label — pickup_code', () => {
  test('le code de retrait est affiché si présent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow({ pickup_code: '4521' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/P1/label');
    expect(res.text).toContain('4521');
    expect(res.text).toContain('CODE DE RETRAIT');
  });

  test('aucune section pickup_code si absent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow({ pickup_code: null })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/P1/label');
    expect(res.text).not.toContain('CODE DE RETRAIT');
  });
});

describe('GET /:ref/label — format thermal vs A5', () => {
  test('format=thermal -> largeur 80mm', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/P1/label').query({ format: 'thermal' });
    expect(res.text).toContain('80mm');
  });

  test('sans format -> largeur 148mm (A5)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/P1/label');
    expect(res.text).toContain('148mm');
  });
});

describe('GET /:ref/label — Content-Type et totaux', () => {
  test('répond en text/html', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v2/parcels/P1/label');
    expect(res.headers['content-type']).toContain('text/html');
  });

  test('le total KMF agrège les total_kmf de toutes les commandes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [parcelRow()] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'O1', reference: 'ORD1', total_kmf: 2000, client_name: 'A', client_phone: '1' },
          { id: 'O2', reference: 'ORD2', total_kmf: 3000, client_name: 'A', client_phone: '1' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // items O1 (parcel_items)
      .mockResolvedValueOnce({ rows: [] }) // fallback order_items O1
      .mockResolvedValueOnce({ rows: [] }) // items O2 (parcel_items)
      .mockResolvedValueOnce({ rows: [] }); // fallback order_items O2

    const res = await request(app).get('/api/v2/parcels/P1/label');
    // 2000 + 3000 = 5000 KMF, formaté fr-FR avec séparateur de milliers
    expect(res.text).toMatch(/5[\s\u00A0]000\s*KMF/);
  });
});

describe('GET /:ref/label — erreurs', () => {
  test('erreur DB -> 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/v2/parcels/P1/label');
    expect(res.status).toBe(500);
  });
});
