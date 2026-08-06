'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-customs-categories.test.js
 * Couvre routes/admin-customs-categories.js
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

const customsCategoriesRouter = require('../../routes/admin-customs-categories');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/customs-categories', customsCategoriesRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/admin/customs-categories — liste', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/customs-categories');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/customs-categories');
    expect(res.status).toBe(403);
  });

  it('admin sans filtre → 200 + toutes les catégories', async () => {
    const rows = [{ key: 'electro', label: 'Électronique' }];
    mockDbQuery.mockResolvedValueOnce({ rows });
    const res = await request(buildApp()).get('/api/admin/customs-categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([]);
  });

  it('?active=true → filtre is_active = true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/customs-categories?active=true');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('WHERE is_active = $1');
    expect(params).toEqual([true]);
  });

  it('?active=false → filtre is_active = false', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/customs-categories?active=false');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([false]);
  });

  it('table absente (migration non jouée) → fallback [] sans planter', async () => {
    mockDbQuery.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const res = await request(buildApp()).get('/api/admin/customs-categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/admin/customs-categories/:key — détail', () => {
  it('catégorie introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/customs-categories/inexistant');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Catégorie introuvable' });
  });

  it('trouvée → 200 + objet', async () => {
    const row = { key: 'electro', label: 'Électronique' };
    mockDbQuery.mockResolvedValueOnce({ rows: [row] });
    const res = await request(buildApp()).get('/api/admin/customs-categories/electro');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
  });

  it('erreur DB inattendue → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('connexion perdue'));
    const res = await request(buildApp()).get('/api/admin/customs-categories/electro');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/customs-categories — création', () => {
  it('key manquante → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/customs-categories').send({ label: 'Électronique' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'key et label obligatoires' });
  });

  it('label manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/customs-categories').send({ key: 'electro' });
    expect(res.status).toBe(400);
  });

  it('clé déjà existante → 409, pas d\'INSERT', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // duplicat check
    const res = await request(buildApp()).post('/api/admin/customs-categories').send({ key: 'electro', label: 'Électronique' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Une catégorie avec cette clé existe déjà' });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('nominal → 201, defaults appliqués (tva_pct=10, display_order=99, is_active=true)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // pas de doublon
      .mockResolvedValueOnce({ rows: [{ key: 'electro', label: 'Électronique', tva_pct: 10 }] }); // INSERT

    const res = await request(buildApp()).post('/api/admin/customs-categories').send({ key: 'electro', label: 'Électronique' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ key: 'electro', label: 'Électronique', tva_pct: 10 });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params).toEqual(['electro', 'Électronique', null, null, 0, 10, 0, null, null, null, null, null, null, 99, true]);
  });

  it('is_active:false explicite → conservé tel quel (pas écrasé par defaut true)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ key: 'electro', is_active: false }] });

    await request(buildApp()).post('/api/admin/customs-categories').send({ key: 'electro', label: 'Électronique', is_active: false });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params[14]).toBe(false);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).post('/api/admin/customs-categories').send({ key: 'electro', label: 'Électronique' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/customs-categories').send({ key: 'electro', label: 'Électronique' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/customs-categories/:key — modification', () => {
  it('aucun champ autorisé fourni → 400', async () => {
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro').send({ champ_inconnu: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Aucun champ à mettre à jour' });
  });

  it('catégorie introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro').send({ label: 'Nouveau label' });
    expect(res.status).toBe(404);
  });

  it('nominal (un champ) → 200, UPDATE avec seul ce champ + key en dernier paramètre', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'electro', label: 'Nouveau label' }] });
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro').send({ label: 'Nouveau label' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'electro', label: 'Nouveau label' });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('label = $1');
    expect(params).toEqual(['Nouveau label', 'electro']);
  });

  it('plusieurs champs → tous inclus dans la clause SET, dans l\'ordre de "allowed"', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'electro' }] });
    await request(buildApp()).put('/api/admin/customs-categories/electro').send({ douane_pct: 5, label: 'X', is_active: false });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('label = $1, douane_pct = $2, is_active = $3');
    expect(params).toEqual(['X', 5, false, 'electro']);
  });

  it('champ non-autorisé (ex: key) → ignoré silencieusement', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'electro' }] });
    await request(buildApp()).put('/api/admin/customs-categories/electro').send({ key: 'autre_cle', label: 'X' });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('SET key');
    expect(params).toEqual(['X', 'electro']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro').send({ label: 'X' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro').send({ label: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/customs-categories/:key/toggle', () => {
  it('catégorie introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro/toggle');
    expect(res.status).toBe(404);
  });

  it('nominal → 200, inverse is_active', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ key: 'electro', is_active: false }] });
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro/toggle');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: 'electro', is_active: false });
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('NOT is_active'), ['electro']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).put('/api/admin/customs-categories/electro/toggle');
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/admin/customs-categories/:key — soft-delete', () => {
  it('catégorie introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).delete('/api/admin/customs-categories/electro');
    expect(res.status).toBe(404);
  });

  it('nominal → 200, deactivated:true + category, is_active=FALSE (pas de DELETE réel)', async () => {
    const row = { key: 'electro', is_active: false };
    mockDbQuery.mockResolvedValueOnce({ rows: [row] });
    const res = await request(buildApp()).delete('/api/admin/customs-categories/electro');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deactivated: true, category: row });
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE customs_categories SET is_active = FALSE'), ['electro']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).delete('/api/admin/customs-categories/electro');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete('/api/admin/customs-categories/electro');
    expect(res.status).toBe(403);
  });
});
