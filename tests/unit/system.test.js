'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/system.test.js
 * Couvre routes/admin/system.js
 *
 * Route volumineuse (4 endpoints) : on teste la garde auth admin sur chacun,
 * le cas nominal de /counts, les branches de garde/validation de /reset et
 * /seed-test (la logique de seed elle-même est hors-scope : ~500 lignes
 * d'inserts SQL séquentiels, non rentables à mocker finement ici), et la
 * délégation de /purchasing/repair-ordered-without-pos.
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

jest.mock('../../services/repair-ordered-without-purchase-orders', () => ({
  repairOrderedWithoutPurchaseOrders: jest.fn(),
}));

jest.mock('./delete-order-cascade', () => ({ deleteOrderCascade: jest.fn() }), { virtual: true });

let mockUser = null;
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Non authentifié' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Accès refusé — rôle requis : ${roles.join(' ou ')}`, your_role: req.user.role });
    }
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const { repairOrderedWithoutPurchaseOrders } = require('../../services/repair-ordered-without-purchase-orders');

let app;
const ADMIN = { id: 'admin-1', email: 'admin@komerce.km', role: 'admin' };

function setAuth(user) { mockUser = user; }

function makeFlexibleClient({ orderCount = 0, restockedCount = 0, failOn = null } = {}) {
  const calls = [];
  const query = jest.fn(async (sql) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    calls.push(normalized);
    if (failOn && failOn.test(normalized)) throw new Error('boom: ' + normalized.slice(0, 40));
    if (/^BEGIN$|^COMMIT$|^ROLLBACK/.test(normalized) || /^SAVEPOINT|^RELEASE SAVEPOINT/.test(normalized)) {
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT COUNT\(\*\)::int AS count FROM orders/.test(normalized)) {
      return { rows: [{ count: orderCount }], rowCount: 1 };
    }
    if (/UPDATE products SET stock = 15.*RETURNING id/.test(normalized)) {
      const rows = Array.from({ length: restockedCount }, (_, i) => ({ id: `p${i}` }));
      return { rows, rowCount: restockedCount };
    }
    if (/SELECT id, name, price_kmf, category FROM products/.test(normalized)) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query, release: jest.fn(), calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  setAuth(ADMIN);
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/admin/system');
    app.use('/api/admin', router);
  });
  // error handler pour capter next(err)
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
});

describe('garde auth admin', () => {
  it.each([
    ['get', '/api/admin/counts'],
    ['post', '/api/admin/reset'],
    ['post', '/api/admin/seed-test'],
    ['post', '/api/admin/purchasing/repair-ordered-without-pos'],
  ])('%s %s sans authentification → 401', async (method, url) => {
    setAuth(null);
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(401);
  });

  it.each([
    ['get', '/api/admin/counts'],
    ['post', '/api/admin/reset'],
    ['post', '/api/admin/seed-test'],
    ['post', '/api/admin/purchasing/repair-ordered-without-pos'],
  ])('%s %s authentifie non-admin → 403', async (method, url) => {
    setAuth({ id: 'u1', role: 'agent_relais' });
    const res = await request(app)[method](url).send({ confirm: true });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/counts', () => {
  it('nominal → 200 + compteurs agreges', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ c: 10 }] })  // orders
      .mockResolvedValueOnce({ rows: [{ c: 30 }] })  // order_items
      .mockResolvedValueOnce({ rows: [{ c: 50 }] })  // products
      .mockResolvedValueOnce({ rows: [{ c: 4 }] })   // relais
      .mockResolvedValueOnce({ rows: [{ c: 7 }] });  // users non-admin

    const res = await request(app).get('/api/admin/counts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders: 10, order_items: 30, products: 50, relais: 4, users_non_admin: 7 });
  });
});

describe('POST /api/admin/reset', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_FLUSH = process.env.ALLOW_FLUSH;
  afterEach(() => { process.env.NODE_ENV = ORIGINAL_ENV; process.env.ALLOW_FLUSH = ORIGINAL_FLUSH; });

  it('bloque en production sans ALLOW_FLUSH → 403', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_FLUSH;
    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/désactivé en production/);
  });

  it('mode invalide → 400 (rejete par le validateur Joi)', async () => {
    const res = await request(app).post('/api/admin/reset').send({ mode: 'bogus', confirm: true });
    expect(res.status).toBe(400);
  });

  it('confirm manquant ou false → 400 (rejete par le validateur Joi)', async () => {
    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders' });
    expect(res.status).toBe(400);
  });

  it('nominal mode "orders" → 200, BEGIN puis COMMIT, rapport de suppression', async () => {
    const client = makeFlexibleClient({ orderCount: 5, restockedCount: 2 });
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted.orders).toBe(5);
    expect(res.body.restocked).toBe(2);
    expect(client.calls).toContain('BEGIN');
    expect(client.calls).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('mode "factory" → pas de requete de restock, reseeded mentionne factory reset', async () => {
    const client = makeFlexibleClient({ orderCount: 0 });
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'factory', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.reseeded).toContain('factory reset (re-seed manual requis)');
    expect(res.body.restocked).toBeUndefined();
  });

  it('erreur en cours de transaction → ROLLBACK + 500, client toujours release', async () => {
    const client = makeFlexibleClient({ orderCount: 1, failOn: /TRUNCATE orders CASCADE/ });
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(500);
    expect(client.calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('POST /api/admin/seed-test', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_SEED = process.env.ALLOW_SEED;
  afterEach(() => { process.env.NODE_ENV = ORIGINAL_ENV; process.env.ALLOW_SEED = ORIGINAL_SEED; });

  it('bloque en production sans ALLOW_SEED → 403', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_SEED;
    const client = makeFlexibleClient();
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(403);
  });

  it('confirm manquant → 400', async () => {
    const client = makeFlexibleClient();
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/seed-test').send({});
    expect(res.status).toBe(400);
  });

  it('aucun produit actif → 400, transaction annulee', async () => {
    const client = makeFlexibleClient(); // SELECT products → rows: []
    db.getClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Aucun produit actif/);
    expect(client.calls).toContain('ROLLBACK');
  });
});

describe('POST /api/admin/purchasing/repair-ordered-without-pos', () => {
  it('nominal → delegue au service avec dry_run=true par defaut et limit=25', async () => {
    repairOrderedWithoutPurchaseOrders.mockResolvedValue({ status: 200, body: { repaired: 0, dry_run: true } });

    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({});
    expect(res.status).toBe(200);
    expect(repairOrderedWithoutPurchaseOrders).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true, limit: 25, user: ADMIN,
    }));
  });

  it('dry_run:false et limit personnalise → transmis tels quels', async () => {
    repairOrderedWithoutPurchaseOrders.mockResolvedValue({ status: 200, body: { repaired: 3 } });

    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({ dry_run: false, limit: 5 });
    expect(res.status).toBe(200);
    expect(repairOrderedWithoutPurchaseOrders).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: false, limit: 5,
    }));
  });

  it('le statut/body retourne par le service est reflete tel quel (ex: erreur 500 controlee)', async () => {
    repairOrderedWithoutPurchaseOrders.mockResolvedValue({ status: 500, body: { error: 'echec reparation' } });
    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('echec reparation');
  });
});
