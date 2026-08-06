/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/dashboard-hub (Lot B4)
 *
 * Contrairement aux autres routes B4, celle-ci contient de la vraie
 * logique : 3 requêtes SQL inline + transformation (toHubParcel, calcul
 * jours/priorité, agrégation KPI). db.query mocké en dur, cache
 * (dashboard-shared) mocké. Couvre aussi l'alias GET /hub → /hub-dubai.
 *
 * Run : npx jest tests/unit/dashboard-hub-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../routes/dashboard-shared', () => ({
  cached: jest.fn(() => null),
  setCache: jest.fn(),
  getEurKmf: jest.fn(),
  loadDashConfig: jest.fn(),
}));

const { cached, setCache } = require('../../routes/dashboard-shared');
const router = require('../../routes/dashboard-hub');

function buildApp() {
  const app = express();
  app.use('/api/dashboard', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/dashboard-hub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockReset();
  });

  describe('GET /hub-dubai', () => {
    test('renvoie le cache si présent (aucune requête DB)', async () => {
      cached.mockReturnValueOnce({ hit: true });
      const res = await request(buildApp()).get('/api/dashboard/hub-dubai');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hit: true });
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('état vide : aucune commande à optimiser, aucun colis (skip la requête items)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // ordersToOptimize
        .mockResolvedValueOnce({ rows: [] }); // parcels

      const res = await request(buildApp()).get('/api/dashboard/hub-dubai');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        a_optimiser: [], a_emballer: [], a_expedier: [],
        kpi: { a_optimiser: 0, a_emballer: 0, a_expedier: 0, total_poids_kg: 0 },
      });
      expect(mockDbQuery).toHaveBeenCalledTimes(2); // pas de 3e requête (parcelIds vide)
      expect(setCache).toHaveBeenCalledWith('hub-dubai', res.body);
    });

    test('scénario complet : commandes à optimiser + colis emballage/expédition avec items', async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'o1', reference: 'CMD-1', status: 'confirmed', total_kmf: '15000',
            created_at: '2026-06-20T00:00:00Z', client_nom: 'Fatima', nb_articles: '2', jours: '8.5',
          }],
        }) // ordersToOptimize
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'p1', reference: 'COL-1', status: 'draft', type: 'standard', weight_kg: '1.2',
              items_count: '2', created_at: '2026-06-15T00:00:00Z', external_code: 'EXT-1', seal_code: 'SEAL-1',
              order_id: 'o2', order_reference: 'CMD-2', order_total_kmf: '20000', client_nom: 'Ali', jours: '9.2',
            },
            {
              id: 'p2', reference: 'COL-2', status: 'shipped', type: 'fragile', weight_kg: null,
              items_count: '1', created_at: '2026-06-28T00:00:00Z', external_code: null, seal_code: null,
              order_id: 'o3', order_reference: 'CMD-3', order_total_kmf: '5000', client_nom: null, jours: '2.1',
            },
          ],
        }) // parcels
        .mockResolvedValueOnce({
          rows: [
            { parcel_id: 'p1', nom: 'T-shirt', quantite: '2', prix_kmf: '3000', stock: 5, stock_status: 'complet' },
          ],
        }); // items

      const res = await request(buildApp()).get('/api/dashboard/hub-dubai');

      expect(res.status).toBe(200);
      expect(res.body.a_optimiser).toEqual([{
        id: 'o1', reference: 'CMD-1', status: 'confirmed', total_kmf: 15000,
        client_nom: 'Fatima', nb_articles: 2, date_commande: '2026-06-20T00:00:00Z', jours: 9,
      }]);

      // p1 (draft) → a_emballer, priorité urgente car jours=9.2 > 7
      const p1 = res.body.a_emballer.find(p => p.id === 'p1');
      expect(p1.priorite).toBe('urgente');
      expect(p1.weight_kg).toBe(1.2);
      expect(p1.produits).toEqual([{ nom: 'T-shirt', quantite: 2, prix_kmf: 3000, stock_status: 'complet' }]);

      // p2 (shipped) → a_expedier, priorité normale car jours=2.1 <= 7, client_nom fallback
      const p2 = res.body.a_expedier[0];
      expect(p2.id).toBe('p2');
      expect(p2.priorite).toBe('normale');
      expect(p2.weight_kg).toBeNull();
      expect(p2.client_nom).toBe('Client');
      expect(p2.produits).toEqual([]);

      expect(res.body.kpi).toEqual({
        a_optimiser: 1, a_emballer: 1, a_expedier: 1, total_poids_kg: 1.2,
      });
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });

    test('propage une erreur DB au middleware next(err)', async () => {
      mockDbQuery.mockRejectedValueOnce(new Error('DB down'));
      const res = await request(buildApp()).get('/api/dashboard/hub-dubai');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /hub (alias)', () => {
    test('redirige en interne vers /hub-dubai et renvoie le même résultat', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).get('/api/dashboard/hub');

      expect(res.status).toBe(200);
      expect(res.body.kpi).toEqual({ a_optimiser: 0, a_emballer: 0, a_expedier: 0, total_poids_kg: 0 });
    });
  });
});
