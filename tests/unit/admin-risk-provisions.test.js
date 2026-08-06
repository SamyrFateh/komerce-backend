'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-risk-provisions.test.js
 * Couvre routes/admin-risk-provisions.js
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

const riskProvisionsRouter = require('../../routes/admin-risk-provisions');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/risk-provisions', riskProvisionsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/admin/risk-provisions — liste', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/risk-provisions');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/risk-provisions');
    expect(res.status).toBe(403);
  });

  it('sans filtre → 200 + toutes les provisions, pas de WHERE', async () => {
    const rows = [{ id: 'p1', key: 'retours', label: 'Retours' }];
    mockDbQuery.mockResolvedValueOnce({ rows });
    const res = await request(buildApp()).get('/api/admin/risk-provisions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('ORDER BY display_order, label');
    expect(params).toEqual([]);
  });

  it('?active=true → filtre is_active = true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/risk-provisions?active=true');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('WHERE is_active = $1');
    expect(params).toEqual([true]);
  });

  it('?active=1 → équivalent à true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/risk-provisions?active=1');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([true]);
  });

  it('?active=false → filtre is_active = false', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/risk-provisions?active=false');
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params).toEqual([false]);
  });

  it('erreur DB → 200 + tableau vide (fallback silencieux, pas de 500)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('relation does not exist'));
    const res = await request(buildApp()).get('/api/admin/risk-provisions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/admin/risk-provisions/:id — détail', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Provision introuvable' });
  });

  it('trouvée → 200 + objet', async () => {
    const row = { id: 'p1', key: 'retours' };
    mockDbQuery.mockResolvedValueOnce({ rows: [row] });
    const res = await request(buildApp()).get('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/risk-provisions — création', () => {
  it('key manquante → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ label: 'Retours', rate_pct: 2 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Champs requis: key, label, rate_pct' });
  });

  it('label manquant → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', rate_pct: 2 });
    expect(res.status).toBe(400);
  });

  it('rate_pct manquant (undefined) → 400', async () => {
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', label: 'Retours' });
    expect(res.status).toBe(400);
  });

  it('rate_pct = 0 (falsy mais valide) → ne déclenche pas le 400', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // pas de doublon
      .mockResolvedValueOnce({ rows: [{ id: 'p1', rate_pct: 0 }] });
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', label: 'Retours', rate_pct: 0 });
    expect(res.status).toBe(201);
  });

  it('clé déjà existante → 409, pas d\'INSERT', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', label: 'Retours', rate_pct: 2 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Une clé "retours" existe déjà' });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('nominal → 201, defaults appliqués (applies_to=all, is_active=true, is_editable/is_deletable=true, display_order=999)', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', key: 'retours' }] });
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', label: 'Retours', rate_pct: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'p1', key: 'retours' });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params).toEqual(['retours', 'Retours', null, 2, 'all', true, true, true, 999, null]);
  });

  it('is_active:false explicite → conservé', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
    await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', label: 'Retours', rate_pct: 2, is_active: false });
    const [, params] = mockDbQuery.mock.calls[1];
    expect(params[5]).toBe(false);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('insert failed'));
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', label: 'Retours', rate_pct: 2 });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/risk-provisions').send({ key: 'retours', label: 'Retours', rate_pct: 2 });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/risk-provisions/:id — modification', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({ rate_pct: 3 });
    expect(res.status).toBe(404);
  });

  it('provision éditable, aucun champ fourni → 400', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', is_editable: true }] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Aucun champ à mettre à jour' });
  });

  it('provision éditable, champs autorisés (incl. label/key) → 200, UPDATE avec les champs fournis', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', is_editable: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', label: 'Nouveau label' }] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({ label: 'Nouveau label', rate_pct: 5 });
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[1];
    expect(sql).toContain('label = $1, rate_pct = $2');
    expect(params).toEqual(['Nouveau label', 5, 'p1']);
  });

  it('provision système (is_editable:false), tente de modifier "key"/"label" → 403, locked_fields', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', is_editable: false }] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({ label: 'Nouveau label' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Provision système : ces champs sont verrouillés', locked_fields: ['label'] });
  });

  it('provision système, modifie un champ autorisé (rate_pct) → 200', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', is_editable: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', rate_pct: 5 }] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({ rate_pct: 5 });
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[1];
    expect(sql).toContain('rate_pct = $1');
    expect(params).toEqual([5, 'p1']);
  });

  it('provision système, "key" ET "label" tentés → les deux dans locked_fields', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', is_editable: false }] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({ key: 'autre', label: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.locked_fields).toEqual(['key', 'label']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({ rate_pct: 3 });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1').send({ rate_pct: 3 });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/risk-provisions/:id/toggle', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1/toggle');
    expect(res.status).toBe(404);
  });

  it('nominal → 200, inverse is_active', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', is_active: false }] });
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1/toggle');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'p1', is_active: false });
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('NOT is_active'), ['p1']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1/toggle');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put('/api/admin/risk-provisions/p1/toggle');
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/risk-provisions/:id — soft/hard delete', () => {
  it('introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).delete('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(404);
  });

  it('sans force → soft delete (is_active=FALSE), mode "soft"', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', is_deletable: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', is_active: false }] });
    const res = await request(buildApp()).delete('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deleted: true, id: 'p1', mode: 'soft',
      hint: 'Provision désactivée. Pour suppression définitive : DELETE ?force=true',
      provision: { id: 'p1', is_active: false },
    });
    expect(mockDbQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE risk_provisions SET is_active = FALSE'), ['p1']);
  });

  it('force=true sur provision non supprimable → 403', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', is_deletable: false }] });
    const res = await request(buildApp()).delete('/api/admin/risk-provisions/p1?force=true');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Provision système : suppression définitive interdite',
      hint: 'Tu peux la désactiver via toggle (is_active=false)',
    });
  });

  it('force=true sur provision supprimable → 200, mode "hard", DELETE réel', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', is_deletable: true }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(buildApp()).delete('/api/admin/risk-provisions/p1?force=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true, id: 'p1', mode: 'hard' });
    expect(mockDbQuery).toHaveBeenCalledWith('DELETE FROM risk_provisions WHERE id = $1', ['p1']);
  });

  it('force=1 → équivalent à force=true', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', is_deletable: true }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(buildApp()).delete('/api/admin/risk-provisions/p1?force=1');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hard');
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).delete('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete('/api/admin/risk-provisions/p1');
    expect(res.status).toBe(403);
  });
});
