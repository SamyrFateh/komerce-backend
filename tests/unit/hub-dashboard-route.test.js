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

// Hors périmètre de ce test suite (couvert par ses propres tests dédiés) —
// la projection de rôle délégué marché ne doit pas interférer avec la
// vérification requireRole testée ici.
jest.mock('../../middleware/require-market-delegated-role', () => ({
  attachMarketDelegatedRoleFor: () => (req, res, next) => next(),
}));

// D4 : les lectures market_operator sont bornées par operations.read, tandis
// que les mutations de supervision restent bornées par hub.supervise.
let mockOperationsReadGranted = true;
const CM_MARKET = '11111111-1111-4111-8111-111111111111';

// hub.supervise (audit manager-capabilities) : requireMarketDelegatedCapability
// remplace ensureMarketOperatorCanSupervise pour un market_operator — on
// simule directement le verdict de capability plutôt que de rejouer
// resolveAuthorization/market-delegation-service (déjà testé ailleurs).
let mockHubSuperviseGranted = true;
jest.mock('../../middleware/require-market-delegated-capability', () => ({
  attachAuthorizedMarketsForCapability: (capability) => (req, res, next) => {
    if (!mockOperationsReadGranted) {
      return res.status(403).json({ error: `Capability ${capability} requise.`, code: 'MARKET_CAPABILITY_REQUIRED' });
    }
    req.authorizedMarkets = new Set([CM_MARKET]);
    req.marketDelegatedMarkets = [{ market_id: CM_MARKET, market_code: 'CM' }];
    return next();
  },
  requireMarketDelegatedCapability: (capability) => (req, res, next) => {
    if (mockHubSuperviseGranted) {
      req.marketDelegatedCapability = { capability, market_id: CM_MARKET, market_code: req.params.marketCode };
      return next();
    }
    return res.status(403).json({ error: `Capability ${capability} requise.`, code: 'MARKET_CAPABILITY_REQUIRED' });
  },
}));

jest.mock('../../services/hub-dashboard-queries', () => ({
  getDashboardKPIs: jest.fn(),
  getQueue: jest.fn(),
  getOrderDetail: jest.fn(),
  getValidation: jest.fn(),
}));

jest.mock('../../services/hub-dubai-projection', () => ({ buildHubDubai: jest.fn() }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: jest.fn().mockResolvedValue({ synced: true }) }));
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
    mockHubSuperviseGranted = true;
    mockOperationsReadGranted = true;
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

  describe('D4 market_operator authority', () => {
    test('operations.read est obligatoire pour les lectures Hub', async () => {
      mockUser = { id: 'manager-cm', role: 'market_operator', full_name: 'Manager CM' };
      mockOperationsReadGranted = false;

      const res = await request(buildApp()).get('/api/hub-dashboard/dashboard');

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
      expect(hubQueries.getDashboardKPIs).not.toHaveBeenCalled();
    });

    test('operations.read injecte uniquement les Market IDs autorisés dans les queries Hub', async () => {
      mockUser = { id: 'manager-cm', role: 'market_operator', full_name: 'Manager CM' };
      hubQueries.getDashboardKPIs.mockResolvedValueOnce({ to_prepare: 1 });

      const res = await request(buildApp()).get('/api/hub-dashboard/dashboard');

      expect(res.status).toBe(200);
      expect(hubQueries.getDashboardKPIs).toHaveBeenCalledWith({
        authorizedMarkets: new Set([CM_MARKET]),
      });
    });
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
      expect(hubQueries.getQueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'urgent' }), { includeSimulation: false });
    });

    test('include_simulation=1 : honoré pour admin uniquement, ignoré pour agent_hub', async () => {
      const prev = mockUser;
      try {
        mockUser = { id: 'admin-1', role: 'admin' };
        hubQueries.getQueue.mockResolvedValueOnce({ data: [] });
        await request(buildApp()).get('/api/hub-dashboard/queue').query({ include_simulation: '1' });
        expect(hubQueries.getQueue).toHaveBeenLastCalledWith(expect.any(Object), { includeSimulation: true });
        mockUser = { id: 'op-1', role: 'agent_hub' };
        hubQueries.getQueue.mockResolvedValueOnce({ data: [] });
        const res = await request(buildApp()).get('/api/hub-dashboard/queue').query({ include_simulation: '1' });
        expect(res.status).toBe(200);
        expect(hubQueries.getQueue).toHaveBeenLastCalledWith(expect.any(Object), { includeSimulation: false });
      } finally { mockUser = prev; }
    });
  });

  describe('projection Live sans contact (LIVE-07)', () => {
    const FULL_ROW = { reference: 'CMD-1', client_name: 'A', client_phone: '+2691', client_email: 'a@b.c' };

    test('/queue?projection=live ne renvoie ni téléphone ni e-mail ; sans paramètre (/hub) la réponse est complète', async () => {
      hubQueries.getQueue.mockResolvedValueOnce({ data: [FULL_ROW] }).mockResolvedValueOnce({ data: [FULL_ROW] });
      const live = await request(buildApp()).get('/api/hub-dashboard/queue').query({ projection: 'live' });
      expect(live.body.data[0]).toEqual({ reference: 'CMD-1', client_name: 'A' });
      const full = await request(buildApp()).get('/api/hub-dashboard/queue');
      expect(full.body.data[0]).toEqual(FULL_ROW);
    });

    test('/orders/:id?projection=live retire les contacts du détail', async () => {
      hubQueries.getOrderDetail.mockResolvedValueOnce({ id: 'o1', client_phone: '+2691', relais_phone: '+2693', relais_name: 'R' });
      const res = await request(buildApp()).get('/api/hub-dashboard/orders/o1').query({ projection: 'live' });
      expect(res.body).toEqual({ id: 'o1', relais_name: 'R' });
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

  describe('HB-09 : anciens écrivains fermés après authentification', () => {
    const paths = ["/orders/:id/start-prep","/orders/:id/create-parcel","/orders/:id/auto-prepare","/parcels/:id/add-item","/parcels/:id/reassign-item","/parcels/:id/remove-item","/parcels/:id/ready","/parcels/:id/ship","/orders/:id/backorder"];
    test.each(paths)('%s renvoie 410 sans SQL, transition ni colis', async (url) => {
      const res = await request(buildApp()).post('/api/hub-dashboard' + url.replace(':id', 'order-1'))
        .send({ order_item_id: 'oi-1', quantity: 7, reason: 'test' });
      expect(res.status).toBe(410);
      expect(res.body).toMatchObject({ code: 'HUB_LEGACY_WRITER_CLOSED', canonical: '/admin/hub' });
      expect(mockDbQuery).not.toHaveBeenCalled();
      expect(mockGetClient).not.toHaveBeenCalled();
      expect(transitionOrderStatus).not.toHaveBeenCalled();
    });

    test('l\'authentification et le rôle restent obligatoires', async () => {
      mockUser = { id: 'u-1', role: 'client' };
      let r = await request(buildApp()).post('/api/hub-dashboard/orders/order-1/auto-prepare');
      expect(r.status).toBe(403);
      mockUser = null;
      r = await request(buildApp()).post('/api/hub-dashboard/orders/order-1/auto-prepare');
      expect(r.status).toBe(401);
      expect(mockDbQuery).not.toHaveBeenCalled();
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

    test('une note d’étape est publiée uniquement par un agent Hub, auteur et étape déterminés côté serveur', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [VALID_ORDER] })
        .mockResolvedValueOnce({ rows: [{
          id: 'note-1', text: 'Fournisseur relancé', hub_stage_key: 'supplier',
          author_name: 'Opérateur Un', author_role: 'agent_hub',
        }] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/comment')
        .send({ content: '  Fournisseur relancé  ', hub_stage_key: 'supplier',
          author_name: 'Usurpateur', author_role: 'admin' });
      expect(res.status).toBe(201);
      expect(res.body.comment.hub_stage_key).toBe('supplier');
      expect(res.body.comment.author_name).toBe('Opérateur Un');
      expect(mockDbQuery).toHaveBeenCalledTimes(2);
      const [statement, params] = mockDbQuery.mock.calls[1];
      expect(statement).toMatch(/INSERT INTO order_comments/);
      expect(statement).toMatch(/hub_stage_key/);
      expect(params).toEqual([VALID_ORDER.id, 'op-1', 'Opérateur Un', 'agent_hub',
        'Fournisseur relancé', 'supplier']);
    });

    test.each([
      ['étape hors nomenclature', { content:'Vérifier fournisseur', hub_stage_key:'payment' }],
      ['vide', { content:'  ', hub_stage_key:'po' }],
      ['trop longue', { content:'X'.repeat(1501), hub_stage_key:'po' }],
    ])('rejette la note d’étape %s sans INSERT', async (_label, body) => {
      mockDbQuery.mockResolvedValueOnce({ rows: [VALID_ORDER] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/comment').send(body);
      expect(res.status).toBe(400);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
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

  // Audit manager-capabilities : admin/agent_hub gardent leur bypass rôle
  // (déjà couvert plus haut) — seul un market_operator doit désormais prouver
  // la capability hub.supervise, résolue à partir du marché de la commande.
  describe('hub.supervise (market_operator)', () => {
    const ORDER_WITH_MARKET = { id: 'order-1', reference: 'CMD-1', market_id: 'market-cm', market_code: 'CM' };

    beforeEach(() => {
      mockUser = { id: 'mo-1', role: 'market_operator', full_name: 'Manager CM' };
    });

    test('incident : refusé sans hub.supervise même avec une commande valide', async () => {
      mockHubSuperviseGranted = false;
      mockDbQuery.mockResolvedValueOnce({ rows: [ORDER_WITH_MARKET] }); // resolveOrderMarket
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/incident')
        .send({ type: 'retard', description: 'colis en retard' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
    });

    test('incident : autorisé avec hub.supervise, marché résolu avant la capability', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [ORDER_WITH_MARKET] }) // resolveOrderMarket
        .mockResolvedValueOnce({ rows: [{ id: 'inc1', type: 'retard' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/incident')
        .send({ type: 'retard', description: 'colis en retard' });
      expect(res.status).toBe(201);
      expect(res.body.incident).toEqual({ id: 'inc1', type: 'retard' });
    });

    test('incident : le corps invalide reste rejeté en 400 avant toute requête DB (ordre préservé)', async () => {
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/incident')
        .send({ type: 'retard' }); // description manquante
      expect(res.status).toBe(400);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    test('escalate : refusé sans hub.supervise', async () => {
      mockHubSuperviseGranted = false;
      mockDbQuery.mockResolvedValueOnce({ rows: [ORDER_WITH_MARKET] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/escalate')
        .send({ reason: 'stock manquant' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
    });

    test('un responsable marché ne peut pas écrire dans le journal interne Hub', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [ORDER_WITH_MARKET] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/comment')
        .send({ content:'Suivi interne du Hub', hub_stage_key:'supplier' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('HUB_STAGE_NOTE_FORBIDDEN');
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });

    test('comment : refusé sans hub.supervise', async () => {
      mockHubSuperviseGranted = false;
      mockDbQuery.mockResolvedValueOnce({ rows: [ORDER_WITH_MARKET] });
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/comment')
        .send({ content: 'RAS' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
    });

    test('incident : 404 si commande introuvable, résolu avant la capability', async () => {
      mockHubSuperviseGranted = false; // même sans la capability, le 404 doit primer
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // resolveOrderMarket ne trouve rien
      const res = await request(buildApp())
        .post('/api/hub-dashboard/orders/order-1/incident')
        .send({ type: 'retard', description: 'colis en retard' });
      expect(res.status).toBe(404);
    });
  });


});


describe('GET /dubai — flux Hub Dubaï (lecture seule)', () => {
  const hubDubai = require('../../services/hub-dubai-projection');
  beforeEach(() => { hubDubai.buildHubDubai.mockReset(); mockUser = { id: 'op-1', role: 'agent_hub' }; });

  test('hub global : aucun périmètre marché imposé', async () => {
    hubDubai.buildHubDubai.mockResolvedValue({ units: {} });
    const res = await request(buildApp()).get('/api/hub-dashboard/dubai');
    expect(res.status).toBe(200);
    expect(hubDubai.buildHubDubai).toHaveBeenCalledWith({});
  });

  test('market_operator : périmètre serveur transmis, jamais celui du client', async () => {
    mockUser = { id: 'mo-1', role: 'market_operator' };
    hubDubai.buildHubDubai.mockResolvedValue({ units: {} });
    const res = await request(buildApp()).get('/api/hub-dashboard/dubai?market_id=autre');
    expect(res.status).toBe(200);
    expect([...hubDubai.buildHubDubai.mock.calls[0][0].authorizedMarkets]).toEqual([CM_MARKET]);
  });
});
