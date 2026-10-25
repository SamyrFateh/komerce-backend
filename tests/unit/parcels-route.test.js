/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/parcels (Lot B3)
 *
 * Sécurité logistique v1.0 (S1-S7) : external_code/seal_code à la création,
 * event logging, checkpoint poids, vérification scellé. Le `validate`
 * middleware et les schémas Joi réels sont utilisés tels quels (déjà
 * couverts par tests/unit/validators.test.js) — pas de mock ici, on veut le
 * vrai comportement 400 sur payload invalide. `services/parcel-security`,
 * `utils/parcelSync`, `utils/orderParcelLinkRules` sont mockés (logique déjà
 * testée isolément).
 *
 * Run : npx jest tests/unit/parcels-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
  connect: async () => ({ query: (...args) => mockDbQuery(...args), release: jest.fn() }),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

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

jest.mock('../../services/parcel-security', () => ({
  generateExternalCode: jest.fn(() => 'EXT-STUB'),
  generateSealCode: jest.fn(() => 'SEAL-STUB'),
  logParcelEvent: jest.fn().mockResolvedValue({}),
  checkWeightIntegrity: jest.fn(() => null),
  verifySeal: jest.fn(() => ({ valid: true })),
}));

jest.mock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/reference', () => ({ generateParcelRef: jest.fn().mockResolvedValue('COL-000123') }));
jest.mock('../../utils/orderParcelLinkRules', () => ({ evaluateOrderParcelLinkRules: jest.fn().mockResolvedValue(null) }));
jest.mock('../../services/parcel-item-mutation-service', () => ({ addParcelItemTraced: jest.fn() }));

const parcelSecurity = require('../../services/parcel-security');
const { safeSyncScanToParcels } = require('../../utils/parcelSync');
const { evaluateOrderParcelLinkRules } = require('../../utils/orderParcelLinkRules');
const { addParcelItemTraced } = require('../../services/parcel-item-mutation-service');

const router = require('../../routes/parcels');

const VALID_UUID_1 = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_2 = '22222222-2222-2222-2222-222222222222';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parcels', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/parcels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    addParcelItemTraced.mockReset();
    mockUser = { id: 'admin-1', role: 'admin' };
    parcelSecurity.generateExternalCode.mockReturnValue('EXT-STUB');
    parcelSecurity.generateSealCode.mockReturnValue('SEAL-STUB');
    parcelSecurity.logParcelEvent.mockResolvedValue({});
    parcelSecurity.checkWeightIntegrity.mockReturnValue(null);
    parcelSecurity.verifySeal.mockReturnValue({ valid: true });
    safeSyncScanToParcels.mockResolvedValue({});
    evaluateOrderParcelLinkRules.mockResolvedValue(null);
  });

  describe('GET /', () => {
    test('refuse un rôle non autorisé', async () => {
      mockUser = { id: 'u1', role: 'client' };
      const res = await request(buildApp()).get('/api/parcels');
      expect(res.status).toBe(403);
    });

    test('liste paginée avec filtres par défaut', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).get('/api/parcels');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });
      expect(mockDbQuery.mock.calls[0][1]).toEqual([null, null, null, null, false, 'admin-1']);
    });

    test('400 si un paramètre de requête est invalide (validate réel)', async () => {
      const res = await request(buildApp()).get('/api/parcels').query({ order_id: 'pas-un-uuid' });
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('les filtres restent dans les paramètres et jamais dans le SQL', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1' }] });

      const res = await request(buildApp()).get('/api/parcels').query({ status: 'shipped', search: 'COL-1' });
      expect(res.status).toBe(200);
      const countSql = mockDbQuery.mock.calls[0][0];
      const countParams = mockDbQuery.mock.calls[0][1];
      expect(countSql).not.toContain('COL-1');
      expect(countParams[0]).toBe('shipped');
      expect(countParams[3]).toBe('%COL-1%');
    });

    test('agent_relais est restreint à son point relais', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais' };
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1' }, { id: 'p2' }] });

      const res = await request(buildApp()).get('/api/parcels');

      expect(res.status).toBe(200);
      const countSql = mockDbQuery.mock.calls[0][0];
      expect(countSql).toMatch(/FROM relais r\s+WHERE r\.phone/);
      expect(mockDbQuery.mock.calls[0][1][4]).toBe(true);
    });
  });

  describe('GET /:ref', () => {
    test('404 si colis introuvable via service canonique', async () => {
      addParcelItemTraced.mockRejectedValueOnce(
        Object.assign(new Error('Colis introuvable'), { code: 'PARCEL_NOT_FOUND', status: 404 }));
      const res = await request(buildApp())
        .post('/api/parcels/'+VALID_UUID_1+'/items')
        .send({ order_item_id: VALID_UUID_2, quantity: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PARCEL_NOT_FOUND');
      expect(mockDbQuery.mock.calls.map(x => x[0])).toEqual(['BEGIN', 'ROLLBACK']);
    });

    test('404 si order_item introuvable via service canonique', async () => {
      addParcelItemTraced.mockRejectedValueOnce(
        Object.assign(new Error('Article introuvable'), { code: 'ORDER_ITEM_NOT_FOUND', status: 404 }));
      const res = await request(buildApp())
        .post('/api/parcels/'+VALID_UUID_1+'/items')
        .send({ order_item_id: VALID_UUID_2, quantity: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ORDER_ITEM_NOT_FOUND');
    });

    test('ajoute via une transaction et le service canonique', async () => {
      addParcelItemTraced.mockResolvedValueOnce({
        row: { id: 'pi1', product_id: VALID_UUID_1, quantity: 2 }
      });
      const res = await request(buildApp())
        .post('/api/parcels/'+VALID_UUID_1+'/items')
        .send({ order_item_id: VALID_UUID_2, quantity: 2 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'pi1', product_id: VALID_UUID_1, quantity: 2 });
      expect(addParcelItemTraced).toHaveBeenCalledWith(expect.objectContaining({ query: expect.any(Function) }),
        { parcelId: VALID_UUID_1, orderItemId: VALID_UUID_2, quantity: 2, actorId: 'admin-1' });
      expect(mockDbQuery.mock.calls.map(x => x[0])).toEqual(['BEGIN', 'COMMIT']);
    });

    test('409 déjà assigné sans réponse de création trompeuse', async () => {
      addParcelItemTraced.mockResolvedValueOnce({ row: null, already_assigned: true });
      const res = await request(buildApp())
        .post('/api/parcels/'+VALID_UUID_1+'/items')
        .send({ order_item_id: VALID_UUID_2, quantity: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PARCEL_ITEM_ALREADY_ASSIGNED');
      expect(mockDbQuery.mock.calls.map(x => x[0])).toEqual(['BEGIN', 'ROLLBACK']);
    });

    test('409 marché incompatible suivi de rollback', async () => {
      addParcelItemTraced.mockRejectedValueOnce(
        Object.assign(new Error('Marché différent'), { code: 'MARKET_MISMATCH', status: 409 }));
      const res = await request(buildApp())
        .post('/api/parcels/'+VALID_UUID_1+'/items')
        .send({ order_item_id: VALID_UUID_2, quantity: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MARKET_MISMATCH');
      expect(mockDbQuery.mock.calls.map(x => x[0])).toEqual(['BEGIN', 'ROLLBACK']);
    });
  });

  describe('DELETE /:id/items/:item_id', () => {
    test('404 si article de colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).delete(`/api/parcels/${VALID_UUID_1}/items/${VALID_UUID_2}`);
      expect(res.status).toBe(404);
    });

    test('retire un article du colis', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID_2 }] });
      const res = await request(buildApp()).delete(`/api/parcels/${VALID_UUID_1}/items/${VALID_UUID_2}`);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toEqual({ id: VALID_UUID_2 });
    });
  });

  describe('endpoints démantelés (DOUANE_DECLARATION_PIVOT)', () => {
    test('POST /optimize renvoie 410 Gone', async () => {
      const res = await request(buildApp()).post('/api/parcels/optimize');
      expect(res.status).toBe(410);
    });

    test('POST /bootstrap/:orderId renvoie 410 Gone', async () => {
      const res = await request(buildApp()).post(`/api/parcels/bootstrap/${VALID_UUID_1}`);
      expect(res.status).toBe(410);
    });

    test('les endpoints démantelés restent réservés admin/agent_hub', async () => {
      mockUser = { id: 'agent-1', role: 'agent_relais' };
      const res = await request(buildApp()).post('/api/parcels/optimize');
      expect(res.status).toBe(403);
    });
  });
});
