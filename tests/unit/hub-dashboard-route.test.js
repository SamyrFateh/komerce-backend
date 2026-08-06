/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/hub-dashboard (Lot B3)
 *
 * Centre de contrôle opérateur hub (Dubai). Lectures déléguées à
 * services/hub-dashboard-queries.js (mocké — non retesté ici). Mutations
 * faites en ligne dans la route (db.query direct) ou via services partagés
 * (transitionOrderStatus, safeSyncScanToParcels, generateParcelRef,
 * parcel-security — tous mockés). /orders/:id/auto-prepare est la seule
 * route transactionnelle (db.getClient) — testée via le harness mock-db.
 *
 * Run : npx jest tests/unit/hub-dashboard-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockDbQuery = jest.fn();
const mockGetClient = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args), getClient: (...args) => mockGetClient(...args) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockUser = { id: 'op-1', role: 'agent_hub', full_name: 'Opérateur Un' };
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

jest.mock('../../services/hub-dashboard-queries', () => ({
  getDashboardKPIs: jest.fn(),
  getQueue: jest.fn(),
  getOrderDetail: jest.fn(),
  getValidation: jest.fn(),
}));

jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/reference', () => ({ generateParcelRef: jest.fn().mockResolvedValue('COL-000123') }));
jest.mock('../../services/parcel-security', () => ({
  generateExternalCode: jest.fn(() => 'EXT-STUB'),
  generateSealCode: jest.fn(() => 'SEAL-STUB'),
}));

const hubQueries = require('../../services/hub-dashboard-queries');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const { safeSyncScanToParcels } = require('../../utils/parcelSync');
const router = require('../../routes/hub-dashboard');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hub-dashboard', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

const VALID_ORDER = { id: 'order-1', reference: 'CMD-1' };

describe('routes/hub-dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQuery.mockReset();
    mockGetClient.mockReset();
    mockUser = { id: 'op-1', role: 'agent_hub', full_name: 'Opérateur Un' };
    transitionOrderStatus.mockResolvedValue({ success: true });
  });

  test('refuse un rôle non autorisé (ex: client)', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/hub-dashboard/dashboard');
    expect(res.status).toBe(403);
    expect(hubQueries.getDashboardKPIs).not.toHaveBeenCalled();
  });

  test('refuse sans authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/hub-dashboard/dashboard');
    expect(res.status).toBe(401);
  });

  describe('GET /dashboard', () => {
    test('renvoie les KPIs', async () => {
      hubQueries.getDashboardKPIs.mockResolvedValueOnce({ to_prepare: 2 });
      const res = await request(buildApp()).get('/api/hub-dashboard/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ to_prepare: 2 });
    });
  });

  describe('GET /queue', () => {
    test('transmet les filtres de requête', async () => {
      hubQueries.getQueue.mockResolvedValueOnce({ items: [] });
      const res = await request(buildApp()).get('/api/hub-dashboard/queue').query({ status: 'urgent' });
      expect(res.status).toBe(200);
      expect(hubQueries.getQueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'urgent' }));
    });
  });

  describe('GET /orders/:id', () => {
    test('404 si commande introuvable', async () => {
      hubQueries.getOrderDetail.mockResolvedValueOnce(null);
      const res = await request(buildApp()).get('/api/hub-dashboard/orders/o1');
      expect(res.status).toBe(404);
    });

    test('renvoie le détail commande', async () => {
      hubQueries.getOrderDetail.mockResolvedValueOnce({ id: 'o1' });
      const res = await request(buildApp()).get('/api/hub-dashboard/orders/o1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'o1' });
    });
  });

  describe('GET /validate/:id', () => {
    test('404 si commande introuvable', async () => {
      hubQueries.getValidation.mockResolvedValueOnce(null);
      const res = await request(buildApp()).get('/api/hub-dashboard/validate/o1');
      expect(res.status).toBe(404);
    });

    test('renvoie les validations', async () => {
      hubQueries.getValidation.mockResolvedValueOnce({ checks_passed: true });
      const res = await request(buildApp()).get('/api/hub-dashboard/validate/o1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ checks_passed: true });
    });
  });

  describe('POST /orders/:id/start-prep', () => {
    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/start-prep');
      expect(res.status).toBe(404);
    });

    test('400 si statut non préparable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'shipped', reference: 'CMD-1' }] });
      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/start-prep');
      expect(res.status).toBe(400);
      expect(transitionOrderStatus).not.toHaveBeenCalled();
    });

    test('démarre la préparation (statut confirmed)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'confirmed', reference: 'CMD-1' }] })
        .mockResolvedValueOnce({ rows: [] }) // INSERT scans
        .mockResolvedValueOnce({ rows: [] }); // INSERT order_comments

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/start-prep');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Commande CMD-1 en préparation', status: 'preparation' });
      expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'o1', newStatus: 'preparation', source: 'hub_start_prep',
      }));
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });

    test('continue même si la state machine échoue (log warn, non bloquant)', async () => {
      transitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'transition invalide' });
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', status: 'ordered', reference: 'CMD-1' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/start-prep');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /orders/:id/create-parcel', () => {
    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/create-parcel').send({});
      expect(res.status).toBe(404);
    });

    test('crée un colis sans articles (type par défaut standard)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] }) // order lookup
        .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'COL-000123' }] }) // INSERT parcels
        .mockResolvedValueOnce({ rows: [] }); // INSERT order_comments

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/order-1/create-parcel').send({});

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Colis COL-000123 créé');
      expect(res.body.items_assigned).toBe(0);
    });

    test('crée un colis et assigne les item_ids fournis', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] })
        .mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'COL-000123' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'pi1' }] }) // INSERT parcel_items item1
        .mockResolvedValueOnce({ rows: [{ id: 'pi2' }] }) // INSERT parcel_items item2
        .mockResolvedValueOnce({ rows: [] }); // INSERT order_comments

      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/create-parcel')
        .send({ type: 'fragile', item_ids: ['item1', 'item2'] });

      expect(res.status).toBe(201);
      expect(res.body.items_assigned).toBe(2);
    });
  });

  describe('POST /orders/:id/auto-prepare', () => {
    test('404 si commande introuvable (rollback)', async () => {
      const client = makeClient([{ rows: [] }]);
      mockGetClient.mockResolvedValue(client);

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/auto-prepare');

      expect(res.status).toBe(404);
      expectTransactionRolledBack(client);
    });

    test('400 si statut non éligible (rollback)', async () => {
      const client = makeClient([{ rows: [{ id: 'o1', reference: 'CMD-1', status: 'shipped' }] }]);
      mockGetClient.mockResolvedValue(client);

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/auto-prepare');

      expect(res.status).toBe(400);
      expectTransactionRolledBack(client);
    });

    test('déjà complet si aucun article non assigné (rollback, 200)', async () => {
      const client = makeClient([
        { rows: [{ id: 'o1', reference: 'CMD-1', status: 'preparation' }] },
        { rows: [] }, // unassigned = []
      ]);
      mockGetClient.mockResolvedValue(client);

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/auto-prepare');

      expect(res.status).toBe(200);
      expect(res.body.already_complete).toBe(true);
      expectTransactionRolledBack(client);
    });

    test('auto-prépare : crée le colis, assigne les articles, commit', async () => {
      const unassigned = [
        { id: 'oi1', quantity: 2, product_id: 'p1', product_name: 'Article A', weight_kg: 0.3 },
        { id: 'oi2', quantity: 1, product_id: 'p2', product_name: 'Article B', weight_kg: null },
      ];
      const client = makeClient([
        { rows: [{ id: 'o1', reference: 'CMD-1', status: 'confirmed' }] }, // order lock
        { rows: unassigned }, // unassigned items
        { rows: [{ id: 'p1', reference: 'COL-000123' }] }, // INSERT parcels
        { rows: [] }, // INSERT parcel_items oi1
        { rows: [] }, // INSERT parcel_items oi2
        { rows: [] }, // UPDATE weight_kg
        { rows: [] }, // SAVEPOINT sp_scans_auto_prepare
        { rows: [] }, // INSERT scans
        { rows: [] }, // RELEASE SAVEPOINT sp_scans_auto_prepare
        { rows: [] }, // INSERT order_comments
      ]);
      mockGetClient.mockResolvedValue(client);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', reference: 'COL-000123', weight_kg: 1.1 }] }); // post-commit fetch

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/auto-prepare');

      expect(res.status).toBe(201);
      expect(res.body.items_assigned).toBe(2);
      expect(res.body.next_action).toBe('ready');
      expectTransactionCommitted(client);
    });

    test('rollback propre si une requête échoue en cours de transaction', async () => {
      const client = makeClient([
        { rows: [{ id: 'o1', reference: 'CMD-1', status: 'confirmed' }] },
        { error: new Error('DB down') },
      ]);
      mockGetClient.mockResolvedValue(client);

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/auto-prepare');

      expect(res.status).toBe(500);
      expectTransactionRolledBack(client);
    });
  });

  describe('POST /parcels/:id/add-item', () => {
    test('400 si order_item_id manquant', async () => {
      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/add-item').send({});
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/parcels/p1/add-item')
        .send({ order_item_id: 'oi1' });
      expect(res.status).toBe(404);
    });

    test("400 si l'article n'appartient pas à la commande du colis", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1' }] })
        .mockResolvedValueOnce({ rows: [] }); // item lookup miss
      const res = await request(buildApp())
        .post('/api/hub-dashboard/parcels/p1/add-item')
        .send({ order_item_id: 'oi1' });
      expect(res.status).toBe(400);
    });

    test("ajoute l'article (quantity par défaut = quantité de l'item)", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'oi1', quantity: 3 }] })
        .mockResolvedValueOnce({ rows: [{ id: 'pi1', quantity: 3 }] });

      const res = await request(buildApp())
        .post('/api/hub-dashboard/parcels/p1/add-item')
        .send({ order_item_id: 'oi1' });

      expect(res.status).toBe(200);
      expect(res.body.item).toEqual({ id: 'pi1', quantity: 3 });
    });

    test('already_assigned si ON CONFLICT DO NOTHING ne renvoie aucune ligne', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'oi1', quantity: 3 }] })
        .mockResolvedValueOnce({ rows: [] }); // conflit, rien inséré

      const res = await request(buildApp())
        .post('/api/hub-dashboard/parcels/p1/add-item')
        .send({ order_item_id: 'oi1' });

      expect(res.status).toBe(200);
      expect(res.body.item).toEqual({ already_assigned: true });
    });
  });

  describe('POST /parcels/:id/remove-item', () => {
    test('400 si order_item_id manquant', async () => {
      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/remove-item').send({});
      expect(res.status).toBe(400);
    });

    test("404 si l'article n'est pas dans ce colis", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/parcels/p1/remove-item')
        .send({ order_item_id: 'oi1' });
      expect(res.status).toBe(404);
    });

    test("retire l'article", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ order_item_id: 'oi1' }] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/parcels/p1/remove-item')
        .send({ order_item_id: 'oi1' });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toEqual({ order_item_id: 'oi1' });
    });
  });

  describe('POST /parcels/:id/ready', () => {
    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ready');
      expect(res.status).toBe(404);
    });

    test('400 si colis incomplet (tous les articles pas emballés)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'draft' }] })
        .mockResolvedValueOnce({ rows: [{ total: '3', packed: '1' }] });

      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ready');

      expect(res.status).toBe(400);
      expect(safeSyncScanToParcels).not.toHaveBeenCalled();
    });

    test('400 si la commande n\'a aucun article (total = 0)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'draft' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0', packed: '0' }] });

      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ready');
      expect(res.status).toBe(400);
    });

    test('marque prêt quand tous les articles sont emballés', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'draft' }] })
        .mockResolvedValueOnce({ rows: [{ total: '3', packed: '3' }] });

      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ready');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'Colis COL-1 prêt', status: 'preparation' });
      expect(safeSyncScanToParcels).toHaveBeenCalledWith(expect.objectContaining({
        order_id: 'order-1', step: 'preparation',
      }));
    });
  });

  describe('POST /parcels/:id/ship', () => {
    test('404 si colis introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ship').send({});
      expect(res.status).toBe(404);
    });

    test('400 si colis encore en statut draft', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'draft' }] });
      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ship').send({});
      expect(res.status).toBe(400);
    });

    test('400 si colis vide (aucun article)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'preparation' }] })
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ship').send({});
      expect(res.status).toBe(400);
    });

    test('400 si commande non payée (hors cash_relais)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'preparation' }] })
        .mockResolvedValueOnce({ rows: [{ cnt: '2' }] })
        .mockResolvedValueOnce({ rows: [{ payment_mode: 'card', payment_status: 'pending', reference: 'CMD-1' }] });
      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ship').send({});
      expect(res.status).toBe(400);
      expect(safeSyncScanToParcels).not.toHaveBeenCalled();
    });

    test('autorise expédition cash_relais même si payment_status != paid', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'preparation' }] })
        .mockResolvedValueOnce({ rows: [{ cnt: '2' }] })
        .mockResolvedValueOnce({ rows: [{ payment_mode: 'cash_relais', payment_status: 'pending', reference: 'CMD-1' }] })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE parcels
        .mockResolvedValueOnce({ rows: [] }); // INSERT order_comments

      const res = await request(buildApp())
        .post('/api/hub-dashboard/parcels/p1/ship')
        .send({ transport: 'DHL', batch_id: 'B1' });

      expect(res.status).toBe(200);
      expect(res.body.transport).toBe('DHL');
      expect(safeSyncScanToParcels).toHaveBeenCalledWith(expect.objectContaining({ step: 'shipped' }));
    });

    test('expédie une commande payée par carte', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'p1', order_id: 'order-1', reference: 'COL-1', status: 'preparation' }] })
        .mockResolvedValueOnce({ rows: [{ cnt: '2' }] })
        .mockResolvedValueOnce({ rows: [{ payment_mode: 'card', payment_status: 'paid', reference: 'CMD-1' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp()).post('/api/hub-dashboard/parcels/p1/ship').send({});
      expect(res.status).toBe(200);
    });
  });

  describe('POST /orders/:id/incident', () => {
    test('400 si type ou description manquant', async () => {
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/o1/incident')
        .send({ type: 'retard' });
      expect(res.status).toBe(400);
    });

    test('400 si type invalide', async () => {
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/o1/incident')
        .send({ type: 'invalide', description: 'x' });
      expect(res.status).toBe(400);
    });

    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/o1/incident')
        .send({ type: 'retard', description: 'colis en retard' });
      expect(res.status).toBe(404);
    });

    test('crée un incident et journalise un commentaire auto', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc1', type: 'retard' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/incident')
        .send({ type: 'retard', description: 'colis en retard' });

      expect(res.status).toBe(201);
      expect(res.body.incident).toEqual({ id: 'inc1', type: 'retard' });
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });
  });

  describe('POST /orders/:id/escalate', () => {
    test('400 si raison manquante', async () => {
      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/escalate').send({});
      expect(res.status).toBe(400);
    });

    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/o1/escalate')
        .send({ reason: 'stock manquant' });
      expect(res.status).toBe(404);
    });

    test('escalade et crée un incident urgent', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] })
        .mockResolvedValueOnce({ rows: [{ id: 'inc1', priority: 'urgent' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/escalate')
        .send({ reason: 'stock manquant' });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Commande CMD-1 escaladée');
      expect(res.body.priority).toBe('high'); // priorité par défaut de la réponse (pas celle de l'incident)
    });
  });

  describe('POST /orders/:id/comment', () => {
    test('400 si contenu manquant', async () => {
      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/comment').send({});
      expect(res.status).toBe(400);
    });

    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/o1/comment')
        .send({ content: 'RAS' });
      expect(res.status).toBe(404);
    });

    test('ajoute le commentaire', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] })
        .mockResolvedValueOnce({ rows: [{ id: 'c1', text: 'RAS' }] });

      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/comment')
        .send({ content: 'RAS' });

      expect(res.status).toBe(200);
      expect(res.body.comment).toEqual({ id: 'c1', text: 'RAS' });
    });
  });

  describe('POST /orders/:id/backorder', () => {
    test('404 si commande introuvable', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp()).post('/api/hub-dashboard/orders/o1/backorder').send({});
      expect(res.status).toBe(404);
    });

    test('marque en attente fournisseur (raison optionnelle)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] })
        .mockResolvedValueOnce({ rows: [] }) // INSERT order_incidents
        .mockResolvedValueOnce({ rows: [] }); // INSERT order_comments

      const res = await request(buildApp()).post('/api/hub-dashboard/orders/order-1/backorder').send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('backorder');
    });

    test('inclut le nombre d\'articles en attente si fourni', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/backorder')
        .send({ reason: 'Rupture fournisseur', items_waiting: ['i1', 'i2'] });

      expect(res.status).toBe(200);
    });
  });
});
