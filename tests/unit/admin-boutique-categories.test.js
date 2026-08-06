'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-boutique-categories.test.js
 * Couvre routes/admin-boutique-categories.js
 *
 * CRUD admin categories/subcategories. invalidateCategoriesCache() mocké
 * (pas testé en détail, déjà couvert ailleurs). guard = [authenticate,
 * requireRole(['admin'])].
 */

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant — connectez-vous' });
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

const mockInvalidateCategoriesCache = jest.fn();
jest.mock('../../utils/categories-cache', () => ({
  invalidateCategoriesCache: (...args) => mockInvalidateCategoriesCache(...args),
}));

const categoriesRouter = require('../../routes/admin-boutique-categories');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/boutique-categories', categoriesRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/admin/boutique-categories — liste', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/boutique-categories');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/boutique-categories');
    expect(res.status).toBe(403);
  });

  it('nominal → 200, chaque catégorie reçoit ses sous-catégories regroupées par category_key', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ key: 'phones', display_order: 1 }, { key: 'audio', display_order: 2 }] })
      .mockResolvedValueOnce({ rows: [
        { id: 'sc1', category_key: 'phones', key: 'iphone' },
        { id: 'sc2', category_key: 'phones', key: 'android' },
      ] });
    const res = await request(buildApp()).get('/api/admin/boutique-categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { key: 'phones', display_order: 1, subcategories: [
        { id: 'sc1', category_key: 'phones', key: 'iphone' },
        { id: 'sc2', category_key: 'phones', key: 'android' },
      ] },
      { key: 'audio', display_order: 2, subcategories: [] },
    ]);
  });

  it('sans filtre active → pas de WHERE, ORDER BY display_order', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/boutique-categories');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('ORDER BY display_order');
    expect(params).toEqual([]);
  });

  it('?active=true → filtre is_active = $1, true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/boutique-categories?active=true');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('WHERE is_active = $1');
    expect(params).toEqual([true]);
  });

  it('?active=1 → équivalent à true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/boutique-categories?active=1');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([true]);
  });

  it('?active=false → filtre is_active = false', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/boutique-categories?active=false');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([false]);
  });

  it('erreur 42P01 (table inexistante) → 200 + tableau vide (fallback silencieux)', async () => {
    const err = new Error('relation does not exist');
    err.code = '42P01';
    mockDbQuery.mockRejectedValueOnce(err);
    const res = await request(buildApp()).get('/api/admin/boutique-categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('autre erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/boutique-categories');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/admin/boutique-categories/:key — détail', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Catégorie introuvable' });
  });

  it('trouvée → 200, inclut subcategories via getCategoryWithSubcats', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ key: 'phones', label: 'Téléphones' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sc1', key: 'iphone' }] });
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'phones', label: 'Téléphones', subcategories: [{ id: 'sc1', key: 'iphone' }] });
    expect(mockDbQuery).toHaveBeenNthCalledWith(2,
      'SELECT * FROM boutique_subcategories WHERE category_key = $1 ORDER BY display_order', ['phones']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/boutique-categories — création', () => {
  it('key manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/boutique-categories').send({ label: 'Téléphones' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'key et label obligatoires' });
  });

  it('label manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/boutique-categories').send({ key: 'phones' });
    expect(res.status).toBe(400);
  });

  it('clé déjà existante → 409, pas d\'INSERT', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(buildApp()).post('/api/admin/boutique-categories').send({ key: 'phones', label: 'Téléphones' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Une catégorie avec cette clé existe déjà' });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('nominal → 201, defaults appliqués, subcategories:[], cache invalidé', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'c1', key: 'phones', label: 'Téléphones' }] });
    const res = await request(buildApp()).post('/api/admin/boutique-categories').send({ key: 'phones', label: 'Téléphones' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'c1', key: 'phones', label: 'Téléphones', subcategories: [] });
    expect(mockInvalidateCategoriesCache).toHaveBeenCalledTimes(1);
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params).toEqual([
      'phones', 'Téléphones', 'Téléphones', '📦', null, [], null, 99, true, true, true, null, null, null,
    ]);
  });

  it('short_label fourni → utilisé au lieu du fallback sur label', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
    await request(buildApp()).post('/api/admin/boutique-categories').send({ key: 'phones', label: 'Téléphones', short_label: 'Tel' });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params[2]).toBe('Tel');
  });

  it('show_in_rail:false / show_in_sections:false / is_active:false → conservés (pas écrasés par défaut)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
    await request(buildApp()).post('/api/admin/boutique-categories').send({
      key: 'phones', label: 'Téléphones', show_in_rail: false, show_in_sections: false, is_active: false,
    });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params[8]).toBe(false);
    expect(params[9]).toBe(false);
    expect(params[10]).toBe(false);
  });

  it('display_order = 0 (falsy mais valide) → conservé, pas remplacé par 99', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
    await request(buildApp()).post('/api/admin/boutique-categories').send({ key: 'phones', label: 'Téléphones', display_order: 0 });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params[7]).toBe(0);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('insert failed'));
    const res = await request(buildApp()).post('/api/admin/boutique-categories').send({ key: 'phones', label: 'Téléphones' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/boutique-categories').send({ key: 'phones', label: 'Téléphones' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/boutique-categories/:key — modification', () => {
  it('aucun champ fourni → 400', async () => {
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Aucun champ à mettre à jour' });
  });

  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones').send({ label: 'Nouveau' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Catégorie introuvable' });
  });

  it('nominal → 200, UPDATE avec champs fournis, recharge via getCategoryWithSubcats, cache invalidé', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ key: 'phones', label: 'Nouveau' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ key: 'phones', label: 'Nouveau' }] }) // getCategoryWithSubcats SELECT cat
      .mockResolvedValueOnce({ rows: [{ id: 'sc1' }] }); // SELECT subs

    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones').send({ label: 'Nouveau' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'phones', label: 'Nouveau', subcategories: [{ id: 'sc1' }] });
    expect(mockInvalidateCategoriesCache).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('label = $1');
    expect(sql).toContain('updated_at = NOW()');
    expect(params).toEqual(['Nouveau', 'phones']);
  });

  it('champs ignorés non whitelistés (ex: key) → non inclus dans l\'UPDATE', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ key: 'phones' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'phones' }] })
      .mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).put('/api/admin/boutique-categories/phones').send({ key: 'autre', label: 'Nouveau' });
    const [sql, params] = mockDbQuery.mock.calls[0];
    const setClause = sql.split('WHERE')[0];
    expect(setClause).not.toContain('key =');
    expect(params).toEqual(['Nouveau', 'phones']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones').send({ label: 'Nouveau' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones').send({ label: 'Nouveau' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/boutique-categories/:key — soft-delete', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(404);
  });

  it('nominal → 200, is_active=FALSE, cache invalidé', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'phones', is_active: false }] });
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deactivated: true, category: { key: 'phones', is_active: false } });
    expect(mockInvalidateCategoriesCache).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('SET is_active = FALSE'), ['phones']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/boutique-categories/:key/subcategories — liste', () => {
  it('nominal → 200 + rows triés par display_order', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'sc1' }, { id: 'sc2' }] });
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones/subcategories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'sc1' }, { id: 'sc2' }]);
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY display_order'), ['phones']);
  });

  it('aucune sous-catégorie → 200 + tableau vide', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones/subcategories');
    expect(res.body).toEqual([]);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones/subcategories');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/boutique-categories/phones/subcategories');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/boutique-categories/:key/subcategories — création', () => {
  it('key manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/boutique-categories/phones/subcategories').send({ label: 'iPhone' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'key et label obligatoires' });
  });

  it('label manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/boutique-categories/phones/subcategories').send({ key: 'iphone' });
    expect(res.status).toBe(400);
  });

  it('catégorie parente introuvable → 404, pas d\'INSERT', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).post('/api/admin/boutique-categories/inconnu/subcategories').send({ key: 'iphone', label: 'iPhone' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Catégorie parente introuvable' });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('nominal → 201, defaults appliqués (icon ✨, is_active true, display_order 99), cache invalidé', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // parent existe
      .mockResolvedValueOnce({ rows: [{ id: 'sc1', key: 'iphone' }] }); // INSERT
    const res = await request(buildApp()).post('/api/admin/boutique-categories/phones/subcategories').send({ key: 'iphone', label: 'iPhone' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'sc1', key: 'iphone' });
    expect(mockInvalidateCategoriesCache).toHaveBeenCalledTimes(1);
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params).toEqual(['phones', 'iphone', 'iPhone', 'iPhone', '✨', 99, true]);
  });

  it('clé en doublon (contrainte unique, code 23505) → 409', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const err = new Error('duplicate key');
    err.code = '23505';
    mockDbQuery.mockRejectedValueOnce(err);
    const res = await request(buildApp()).post('/api/admin/boutique-categories/phones/subcategories').send({ key: 'iphone', label: 'iPhone' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Une sous-catégorie avec cette clé existe déjà dans cette catégorie' });
  });

  it('autre erreur DB → 500', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    mockDbQuery.mockRejectedValueOnce(new Error('insert failed'));
    const res = await request(buildApp()).post('/api/admin/boutique-categories/phones/subcategories').send({ key: 'iphone', label: 'iPhone' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/boutique-categories/phones/subcategories').send({ key: 'iphone', label: 'iPhone' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/boutique-categories/:key/subcategories/:subKey — modification', () => {
  it('aucun champ fourni → 400', async () => {
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones/subcategories/iphone').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Aucun champ à mettre à jour' });
  });

  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones/subcategories/iphone').send({ label: 'iPhone 15' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sous-catégorie introuvable' });
  });

  it('nominal → 200, UPDATE scoped sur category_key ET key, cache invalidé', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'sc1', label: 'iPhone 15' }] });
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones/subcategories/iphone').send({ label: 'iPhone 15' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'sc1', label: 'iPhone 15' });
    expect(mockInvalidateCategoriesCache).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('WHERE category_key = $2 AND key = $3');
    expect(params).toEqual(['iPhone 15', 'phones', 'iphone']);
  });

  it('champ "key" non whitelisté → ignoré dans l\'UPDATE', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'sc1' }] });
    await request(buildApp()).put('/api/admin/boutique-categories/phones/subcategories/iphone').send({ key: 'autre', display_order: 2 });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('key = $1');
    expect(params).toEqual([2, 'phones', 'iphone']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones/subcategories/iphone').send({ label: 'X' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put('/api/admin/boutique-categories/phones/subcategories/iphone').send({ label: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/boutique-categories/:key/subcategories/:subKey', () => {
  it('introuvable (soft) → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones/subcategories/iphone');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sous-catégorie introuvable' });
  });

  it('sans ?hard → soft delete (is_active=FALSE), deactivated:true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'sc1', is_active: false }] });
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones/subcategories/iphone');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deactivated: true, subcategory: { id: 'sc1', is_active: false } });
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('SET is_active = FALSE'), ['phones', 'iphone']);
    expect(mockInvalidateCategoriesCache).toHaveBeenCalledTimes(1);
  });

  it('?hard=true → DELETE réel, deleted:true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'sc1' }] });
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones/subcategories/iphone?hard=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, subcategory: { id: 'sc1' } });
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM boutique_subcategories'), ['phones', 'iphone']);
  });

  it('?hard=autre_chose → traité comme falsy, reste en soft-delete', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'sc1' }] });
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones/subcategories/iphone?hard=1');
    expect(res.body.deactivated).toBe(true);
  });

  it('introuvable en hard delete → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones/subcategories/iphone?hard=true');
    expect(res.status).toBe(404);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones/subcategories/iphone');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete('/api/admin/boutique-categories/phones/subcategories/iphone');
    expect(res.status).toBe(403);
  });
});
