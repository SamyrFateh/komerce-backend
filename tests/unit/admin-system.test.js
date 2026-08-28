'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-system.test.js
 *
 * Tests du router routes/admin/system.js (D3, 0% branches avant ce lot).
 *
 * 4 endpoints :
 *   GET  /counts                              — compteurs simples
 *   POST /reset                               — flush destructif (dev/staging only)
 *   POST /seed-test                           — rich seed v2 (20 scénarios hardcodés)
 *   POST /purchasing/repair-ordered-without-pos — délègue à un service
 *
 * Stratégie de mock : db.getClient() renvoie un client dont `.query` est un
 * dispatcher par sous-chaîne SQL (pattern déjà utilisé sur pricing-strategy-
 * service-full.test.js). Les BEGIN/COMMIT/ROLLBACK/SAVEPOINT non explicitement
 * mockés résolvent par défaut à { rows: [], rowCount: 0 } pour ne pas avoir à
 * étiqueter chaque requête technique.
 *
 * `resolveFrozenClassification` et `deleteOrderCascade` sont mockés
 * entièrement (testés ailleurs) pour isoler la logique propre à ce router.
 *
 * Gaps de couverture acceptés (100% funcs/lines, 98.85% stmts, 82.85%
 * branches — tous les gaps sont du code défensif structurellement
 * inatteignable avec les 20 scénarios hardcodés actuels, pas des trous de
 * test) :
 *   - L107, L315 : gardes AUD-07 "safety net" (`if (!ALLOWLIST.includes(tbl))
 *     throw`) — tbl provient toujours du même tableau qu'on vient d'itérer,
 *     donc cette branche ne peut être vraie que si le code source lui-même
 *     change l'allowlist en cours de route.
 *   - L572 : `if (!def) continue;` (incidentDefs) — les 5 types d'incidents
 *     utilisés dans les 20 scénarios (weight_mismatch, missing_item,
 *     damaged_item, unexpected_item, sequence_violation) existent tous dans
 *     la map `incidentDefs`.
 *   - L423, L433, L463, L498-L573, L610-L630 : fallbacks `X[s.rid] || '...'`
 *     (relaisAgentOf, relaisNameOf, islandOf) et `s.shipped_at`/`s.available_at`
 *     toujours-truthy — les 4 relais (R.volo_volo/mutsamudu/domoni/fomboni)
 *     utilisés par les 20 scénarios sont systématiquement présents dans ces
 *     3 maps, et les timestamps requis sont toujours renseignés pour les
 *     scénarios qui atteignent ces branches. Non atteignable sans modifier
 *     les scénarios hardcodés du fichier source (hors périmètre de ce lot).
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin', email: 'admin@komerce.test' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../validators', () => ({ admin: { reset: {} } }));

jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const mockGetClient = jest.fn();
const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  getClient: (...args) => mockGetClient(...args),
  query: (...args) => mockDbQuery(...args),
}));

const mockDeleteOrderCascade = jest.fn();
jest.mock('../../routes/admin/delete-order-cascade', () => ({
  deleteOrderCascade: (...args) => mockDeleteOrderCascade(...args),
}));

const mockResolveFrozenClassification = jest.fn();
jest.mock('../../services/customs-classification', () => ({
  resolveFrozenClassification: (...args) => mockResolveFrozenClassification(...args),
}));

const mockRepairOrderedWithoutPurchaseOrders = jest.fn();
jest.mock('../../services/repair-ordered-without-purchase-orders', () => ({
  repairOrderedWithoutPurchaseOrders: (...args) => mockRepairOrderedWithoutPurchaseOrders(...args),
}));

const express = require('express');
const request = require('supertest');

let app;
let currentUser;
const ORIGINAL_ENV = { ...process.env };

/**
 * Construit un client mocké dont `.query` route par sous-chaîne SQL.
 * `routes`: array de [matcher (string|RegExp), réponse|fonction|Error].
 * Si aucune route ne correspond, résout { rows: [], rowCount: 0 }.
 */
function makeClient(routes = []) {
  const calls = [];
  const client = {
    calls,
    query: jest.fn((sql, params) => {
      calls.push(sql);
      for (const [matcher, resp] of routes) {
        const matches = typeof matcher === 'string' ? sql.includes(matcher) : matcher.test(sql);
        if (matches) {
          if (resp instanceof Error) return Promise.reject(resp);
          if (typeof resp === 'function') {
            const r = resp(sql, params);
            return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
          }
          return Promise.resolve(resp);
        }
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: jest.fn(),
  };
  return client;
}

/** Route qui échoue exactement à la Nième invocation matchant `matcher`, réussit sinon. */
function failNth(matcher, n, err, successResp = { rows: [], rowCount: 0 }) {
  let count = 0;
  return [matcher, () => {
    count++;
    if (count === n) return err;
    return successResp;
  }];
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NODE_ENV;
  delete process.env.KOMERCE_ENV;
  delete process.env.ALLOW_FLUSH;
  delete process.env.ALLOW_SEED;
  currentUser = { id: 'admin-1', role: 'admin', email: 'admin@komerce.test' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/admin/system');
    app.use('/api/admin', router);
  });
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message || 'error' }); });
});

afterAll(() => { process.env = ORIGINAL_ENV; });

// ═══════════════════════════════════════════════════════════════════════
// GET /counts
// ═══════════════════════════════════════════════════════════════════════
describe('admin/system — GET /counts', () => {
  it('agrège les 5 compteurs', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ c: 10 }] })  // orders
      .mockResolvedValueOnce({ rows: [{ c: 25 }] })  // order_items
      .mockResolvedValueOnce({ rows: [{ c: 8 }] })   // products
      .mockResolvedValueOnce({ rows: [{ c: 4 }] })   // relais
      .mockResolvedValueOnce({ rows: [{ c: 50 }] }); // users non-admin

    const res = await request(app).get('/api/admin/counts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders: 10, order_items: 25, products: 8, relais: 4, users_non_admin: 50 });
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/counts');
    expect(res.status).toBe(500);
  });

  it('403 si le rôle n\'est pas admin (requireRole)', async () => {
    currentUser = { id: 'u1', role: 'client' };
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = currentUser; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/admin/system');
      app.use('/api/admin', router);
    });
    const res = await request(app).get('/api/admin/counts');
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /reset
// ═══════════════════════════════════════════════════════════════════════
describe('admin/system — POST /reset', () => {
  it('403 en production sans ALLOW_FLUSH', async () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'development';
    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(403);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('autorisé en production si ALLOW_FLUSH=true', async () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_FLUSH = 'true';
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '3' }] }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(200);
  });

  it('400 si mode invalide', async () => {
    const res = await request(app).post('/api/admin/reset').send({ mode: 'bogus', confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Mode invalide/);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('400 si confirm absent', async () => {
    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Confirmation obligatoire/);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('mode défaut = "orders" quand absent', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = await request(app).post('/api/admin/reset').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('orders');
  });

  it('succès mode=orders : TRUNCATE CASCADE + sms nullifiés + tables nettoyées + restock', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '7' }] }],
      ['UPDATE sms_log SET order_id', { rowCount: 2 }],
      [/DELETE FROM basket_items/, { rowCount: 3 }],
      [/DELETE FROM baskets/, { rowCount: 1 }],
      [/DELETE FROM recipients/, { rowCount: 0 }],
      ['SET stock = 15', { rowCount: 5, rows: [{ id: '1' }] }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.deleted.orders).toBe('7'); // pas de Number() dans le code source, reste string PG
    expect(res.body.deleted.sms_log_nullified).toBe(2);
    expect(res.body.deleted.basket_items).toBe(3);
    expect(res.body.restocked).toBe(5);
    expect(client.calls).toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('branche catch sp_sms : échec UPDATE sms_log → ROLLBACK TO SAVEPOINT, reset continue', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      ['UPDATE sms_log SET order_id', new Error('sms_log absente')],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.deleted.sms_log_nullified).toBeUndefined();
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_sms');
  });

  it('branche catch sp_clean_<table> : DELETE FROM baskets échoue → "table absente"', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      [/^DELETE FROM baskets$/, new Error('relation "baskets" does not exist')],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.deleted.baskets).toBe('table absente');
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_clean_baskets');
  });

  it('mode=users : nettoie les dépendances utilisateur puis supprime les non-admin', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      [/DELETE FROM users WHERE role/, { rowCount: 12 }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'users', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.deleted.users_non_admin).toBe(12);
    // toutes les 15 requêtes user-deps ont réussi (wallet_consumptions + wallet_credit_lots
    // ajoutées à l'ordre FK — cf. fix ordre de nettoyage wallets en factory reset)
    expect(res.body.deleted.user_deps_cleaned).toBe(15);
    // mode !== factory → restock exécuté
    expect(client.calls.some(c => c.includes('UPDATE products') && c.includes("inventory_model = 'LEGACY_VARIANTS'"))).toBe(true);
  });

  it('mode=users : branche catch sp_udep_i quand une dépendance échoue', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      ['DELETE FROM wallets WHERE user_id', new Error('fk violation')],
      [/DELETE FROM users WHERE role/, { rowCount: 0 }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'users', confirm: true });
    expect(res.status).toBe(200);
    // une des 15 a échoué → 14 comptées comme réussies
    expect(res.body.deleted.user_deps_cleaned).toBe(14);
    expect(client.calls.some(c => c.startsWith('ROLLBACK TO SAVEPOINT sp_udep_'))).toBe(true);
  });

  it('mode=factory : supprime aussi products/relais/partners et n\'exécute pas le restock', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      [/DELETE FROM users WHERE role/, { rowCount: 5 }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'factory', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.reseeded).toContain('factory reset (re-seed manual requis)');
    expect(client.calls).toContain('DELETE FROM products');
    expect(client.calls).toContain('DELETE FROM relais');
    expect(client.calls).toContain('DELETE FROM partners');
    // mode === factory → pas de restock
    expect(client.calls.some(c => c.includes('SET stock = 15'))).toBe(false);
    expect(res.body.restocked).toBeUndefined();
  });

  it('PDC-7 : le restock global ne cible que inventory_model = LEGACY_VARIANTS (jamais les produits SKU)', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      [/DELETE FROM users WHERE role/, { rowCount: 0 }],
      ['SET stock = 15', { rowCount: 3, rows: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'users', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.restocked).toBe(3);

    const restockCall = client.calls.find(c => c.includes('UPDATE products') && c.includes('stock = 15'));
    expect(restockCall).toBeDefined();
    expect(restockCall).toMatch(/inventory_model\s*=\s*'LEGACY_VARIANTS'/);
    // Non-régression : la requête ne doit jamais retomber sur l'ancienne
    // forme sans filtre de modèle (qui toucherait aussi les produits SKU).
    expect(restockCall).not.toBe('UPDATE products SET stock = 15 WHERE stock < 5 RETURNING id');
  });

  it('mode=factory : DELETE FROM partners peut échouer silencieusement (catch vide)', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      [/DELETE FROM users WHERE role/, { rowCount: 0 }],
      ['DELETE FROM partners', new Error('table absente')],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'factory', confirm: true });
    expect(res.status).toBe(200); // ne crashe pas malgré l'échec silencieux
  });

  it('restock non appliqué si aucun produit sous le seuil (rowCount=0)', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', { rows: [{ count: '0' }] }],
      ['SET stock = 15', { rowCount: 0, rows: [] }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.restocked).toBeUndefined();
  });

  it('chemin erreur global → ROLLBACK + next(err) + release', async () => {
    const client = makeClient([
      ['SELECT COUNT(*)::int AS count FROM orders', new Error('db down')],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/reset').send({ mode: 'orders', confirm: true });
    expect(res.status).toBe(500);
    expect(client.calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /seed-test
// ═══════════════════════════════════════════════════════════════════════
describe('admin/system — POST /seed-test', () => {
  function baseClient(routes = []) {
    return makeClient([
      ...routes,
      ['SELECT id, name, price_kmf, category FROM products', {
        rows: Array.from({ length: 10 }, (_, i) => ({
          id: `prod-${i}`, name: `Produit ${i}`, price_kmf: 1000 + i * 100, category: 'electronique',
        })),
      }],
      ["SELECT id FROM orders WHERE reference LIKE 'KT-%'", { rows: [] }],
    ]);
  }

  beforeEach(() => {
    mockResolveFrozenClassification.mockResolvedValue({
      customs_category_key: 'electronique', sh_code: '8517', douane_pct: 0.05, tva_pct: 0.1, taxe_add_pct: 0, classification_defaulted: false,
    });
  });

  it('403 en production sans ALLOW_SEED', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(403);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it('autorisé en production si ALLOW_SEED=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_SEED = 'true';
    const client = baseClient();
    mockGetClient.mockResolvedValueOnce(client);
    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
  });

  it('400 si confirm absent (client tout de même libéré via finally)', async () => {
    const client = baseClient();
    mockGetClient.mockResolvedValueOnce(client);
    const res = await request(app).post('/api/admin/seed-test').send({});
    expect(res.status).toBe(400);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.calls).not.toContain('BEGIN');
  });

  it('400 + ROLLBACK si aucun produit actif', async () => {
    const client = makeClient([
      ['SELECT id, name, price_kmf, category FROM products', { rows: [] }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Aucun produit actif/);
    expect(client.calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('run complet réussi : 20 scénarios, nettoyage KT- précédents, TRUNC allowlist, commit', async () => {
    const client = baseClient([
      ["SELECT id FROM orders WHERE reference LIKE 'KT-%'", { rows: [{ id: 'old-order-1' }, { id: 'old-order-2' }] }],
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    mockDeleteOrderCascade.mockResolvedValue({});

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.orders).toHaveLength(20);
    // scénarios avec pcl:false (1,2,3,17,19) ne créent pas de colis → 15 colis
    expect(res.body.summary.parcels).toHaveLength(15);
    expect(res.body.deleted_previous).toBe(2);
    expect(mockDeleteOrderCascade).toHaveBeenCalledTimes(2);
    expect(res.body.products_available).toBe(10);
    expect(client.calls).toContain('COMMIT');
    // les 5 types d'incidents des 20 scénarios sont tous représentés
    const incidentTypes = res.body.summary.incidents.map(i => i.type);
    expect(incidentTypes).toEqual(expect.arrayContaining([
      'weight_mismatch', 'missing_item', 'damaged_item', 'unexpected_item', 'sequence_violation',
    ]));
    // 3 commandes collected+inv:true → 3 factures
    expect(res.body.summary.invoices).toHaveLength(3);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('branche catch TRUNC_TABLES_ALLOWLIST : une table absente → ROLLBACK TO SAVEPOINT, suite continue', async () => {
    const client = baseClient([
      ['TRUNCATE incidents CASCADE', new Error('relation absente')],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_trunc_incidents');
  });

  it('branche catch sp_osh : échec insertion order_status_history n\'interrompt pas le seed', async () => {
    const client = baseClient([
      failNth('INSERT INTO order_status_history', 1, new Error('boom')),
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_osh');
    expect(res.body.summary.orders).toHaveLength(20); // toutes les commandes sont quand même comptées
  });

  it('branche catch sp_parcel (pErr) : échec insertion colis → continue (pas de parcel_items/scans pour ce colis)', async () => {
    const client = baseClient([
      failNth('INSERT INTO parcels', 1, new Error('parcel insert failed')),
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_parcel');
    // 1 colis en moins que le run nominal (15 → 14)
    expect(res.body.summary.parcels).toHaveLength(14);
  });

  it('branche catch sp_pi : échec insertion parcel_items n\'interrompt pas le seed', async () => {
    const client = baseClient([
      failNth('INSERT INTO parcel_items', 1, new Error('boom')),
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_pi');
  });

  it('branche catch sp_scan : échec insertion scan_events n\'interrompt pas le seed', async () => {
    const client = baseClient([
      failNth('INSERT INTO scan_events', 1, new Error('boom')),
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_scan');
    // le compteur scan_events n'est incrémenté que sur succès
    expect(res.body.summary.scan_events).toBeGreaterThan(0);
  });

  it('branche catch sp_inc : échec insertion incidents n\'interrompt pas le seed', async () => {
    const client = baseClient([
      failNth('INSERT INTO incidents', 1, new Error('boom')),
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_inc');
    // un incident en moins que le run nominal (5 → 4)
    expect(res.body.summary.incidents).toHaveLength(4);
  });

  it('branche catch sp_inv : échec insertion invoices n\'interrompt pas le seed', async () => {
    const client = baseClient([
      failNth('INSERT INTO invoices', 1, new Error('boom')),
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(200);
    expect(client.calls).toContain('ROLLBACK TO SAVEPOINT sp_inv');
    // une facture en moins que le run nominal (3 → 2)
    expect(res.body.summary.invoices).toHaveLength(2);
  });

  it('chemin erreur global → ROLLBACK + next(err) + release', async () => {
    const client = makeClient([
      ['SELECT id, name, price_kmf, category FROM products', new Error('db down')],
    ]);
    mockGetClient.mockResolvedValueOnce(client);

    const res = await request(app).post('/api/admin/seed-test').send({ confirm: true });
    expect(res.status).toBe(500);
    expect(client.calls).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /purchasing/repair-ordered-without-pos
// ═══════════════════════════════════════════════════════════════════════
describe('admin/system — POST /purchasing/repair-ordered-without-pos', () => {
  it('dryRun=true par défaut (dry_run absent), limit=25 par défaut', async () => {
    mockRepairOrderedWithoutPurchaseOrders.mockResolvedValueOnce({ status: 200, body: { fixed: 0, dryRun: true } });
    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({});
    expect(res.status).toBe(200);
    expect(mockRepairOrderedWithoutPurchaseOrders).toHaveBeenCalledWith({ dryRun: true, limit: 25, user: currentUser });
  });

  it('dry_run=false transmis → dryRun=false', async () => {
    mockRepairOrderedWithoutPurchaseOrders.mockResolvedValueOnce({ status: 200, body: { fixed: 3, dryRun: false } });
    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({ dry_run: false });
    expect(res.status).toBe(200);
    expect(mockRepairOrderedWithoutPurchaseOrders).toHaveBeenCalledWith({ dryRun: false, limit: 25, user: currentUser });
  });

  it('limit custom transmis', async () => {
    mockRepairOrderedWithoutPurchaseOrders.mockResolvedValueOnce({ status: 200, body: { fixed: 0 } });
    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({ limit: 10 });
    expect(res.status).toBe(200);
    expect(mockRepairOrderedWithoutPurchaseOrders).toHaveBeenCalledWith({ dryRun: true, limit: 10, user: currentUser });
  });

  it('body absent → dryRun=true, limit=25 (optional chaining req.body?.)', async () => {
    mockRepairOrderedWithoutPurchaseOrders.mockResolvedValueOnce({ status: 200, body: {} });
    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos');
    expect(res.status).toBe(200);
    expect(mockRepairOrderedWithoutPurchaseOrders).toHaveBeenCalledWith({ dryRun: true, limit: 25, user: currentUser });
  });

  it('renvoie le status/body délégués tels quels (ex: 403 accès refusé par le service)', async () => {
    mockRepairOrderedWithoutPurchaseOrders.mockResolvedValueOnce({ status: 403, body: { error: 'Accès réservé admin' } });
    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Accès réservé admin' });
  });

  it('chemin erreur → 500 via next(err)', async () => {
    mockRepairOrderedWithoutPurchaseOrders.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/admin/purchasing/repair-ordered-without-pos').send({});
    expect(res.status).toBe(500);
  });
});
