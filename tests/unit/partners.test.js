'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/partners.test.js
 * Couvre routes/admin/partners.js
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

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../validators', () => ({
  admin: { createPartner: {}, updatePartner: {}, deletePartner: {} },
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const partnersRouter = require('../../routes/admin/partners');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', partnersRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/admin/partners — liste', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/partners');
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/admin/partners');
    expect(res.status).toBe(403);
  });

  it('sans filtre → 200 + where minimal "1=1"', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Fournisseur Dubai' }] });
    const res = await request(buildApp()).get('/api/admin/partners');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'p1', name: 'Fournisseur Dubai' }]);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('WHERE 1=1');
    expect(params).toEqual([]);
  });

  it('tous les filtres combinés → conditions et params dans l\'ordre', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/partners?type=supplier&island=Ngazidja&country=AE&active=true');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('1=1 AND partner_type = $1 AND island = $2 AND country_code = $3 AND is_active = $4');
    expect(params).toEqual(['supplier', 'Ngazidja', 'AE', true]);
  });

  it('table partners absente → fallback [] sans planter', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('relation "partners" does not exist'));
    const res = await request(buildApp()).get('/api/admin/partners');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/admin/partners/stats', () => {
  it('admin → 200 + lignes de suppliers_stats', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ partner_id: 'p1', total_orders: 12 }] });
    const res = await request(buildApp()).get('/api/admin/partners/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ partner_id: 'p1', total_orders: 12 }]);
  });

  it('vue suppliers_stats absente → fallback [] sans planter', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('relation "suppliers_stats" does not exist'));
    const res = await request(buildApp()).get('/api/admin/partners/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("n'est pas intercepté par /partners/:id", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/admin/partners/stats');
    expect(mockDbQuery).toHaveBeenCalledWith('SELECT * FROM suppliers_stats');
  });
});

describe('GET /api/admin/partners/:id — détail', () => {
  it('partenaire introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/admin/partners/p1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Partenaire introuvable' });
  });

  it('trouvé avec stats disponibles → 200 + partner et stats', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Fournisseur Dubai' }] })
      .mockResolvedValueOnce({ rows: [{ partner_id: 'p1', total_orders: 5 }] });
    const res = await request(buildApp()).get('/api/admin/partners/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      partner: { id: 'p1', name: 'Fournisseur Dubai' },
      stats: { partner_id: 'p1', total_orders: 5 },
    });
  });

  it('trouvé mais vue stats absente → stats:null, pas d\'erreur 500', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Fournisseur Dubai' }] })
      .mockRejectedValueOnce(new Error('vue absente'));
    const res = await request(buildApp()).get('/api/admin/partners/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ partner: { id: 'p1', name: 'Fournisseur Dubai' }, stats: null });
  });

  it('erreur sur la requête principale → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/admin/partners/p1');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/partners — création', () => {
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/admin/partners').send({ name: 'Fournisseur', partner_type: 'supplier' });
    expect(res.status).toBe(403);
  });

  it('nominal → 201, defaults appliqués (commission_kmf=0, is_active=true)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Fournisseur Dubai' }] });
    const res = await request(buildApp())
      .post('/api/admin/partners')
      .send({ name: 'Fournisseur Dubai', partner_type: 'supplier' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'p1', name: 'Fournisseur Dubai' });
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params[0]).toBe('Fournisseur Dubai');
    expect(params[1]).toBe('supplier');
    expect(params[15]).toBe(0); // commission_kmf default
    expect(params[20]).toBe(true); // is_active default
  });

  it('is_active:false explicite → conservé', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
    await request(buildApp())
      .post('/api/admin/partners')
      .send({ name: 'Fournisseur', partner_type: 'supplier', is_active: false });
    const [, params] = mockDbQuery.mock.calls[0];
    expect(params[20]).toBe(false);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('insert failed'));
    const res = await request(buildApp())
      .post('/api/admin/partners')
      .send({ name: 'Fournisseur', partner_type: 'supplier' });
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/admin/partners/:id — modification', () => {
  it('aucun champ fourni → 400', async () => {
    const res = await request(buildApp()).put('/api/admin/partners/p1').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Aucun champ à mettre à jour' });
  });

  it('partenaire introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).put('/api/admin/partners/p1').send({ name: 'Nouveau nom' });
    expect(res.status).toBe(404);
  });

  it('nominal (champs partiels) → 200, UPDATE avec uniquement les champs fournis', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Nouveau nom' }] });
    const res = await request(buildApp()).put('/api/admin/partners/p1').send({ name: 'Nouveau nom', rating: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'p1', name: 'Nouveau nom' });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('name = $1, rating = $2');
    expect(params).toEqual(['Nouveau nom', 4, 'p1']);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('update failed'));
    const res = await request(buildApp()).put('/api/admin/partners/p1').send({ name: 'X' });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put('/api/admin/partners/p1').send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/partners/:id — suppression', () => {
  it('partenaire introuvable → 404', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // shipments count
      .mockResolvedValueOnce({ rows: [{ c: 0 }] }) // orders count
      .mockResolvedValueOnce({ rowCount: 0 }); // DELETE
    const res = await request(buildApp()).delete('/api/admin/partners/p1');
    expect(res.status).toBe(404);
  });

  it('nominal sans liens → message simple', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(buildApp()).delete('/api/admin/partners/p1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deleted: true,
      id: 'p1',
      links_unset: { shipments: 0, orders: 0 },
      message: 'Partenaire supprimé.',
    });
  });

  it('nominal avec liens existants → message détaillé avec comptes', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ c: 3 }] }) // shipments
      .mockResolvedValueOnce({ rows: [{ c: 2 }] }) // orders
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(buildApp()).delete('/api/admin/partners/p1');
    expect(res.status).toBe(200);
    expect(res.body.links_unset).toEqual({ shipments: 3, orders: 2 });
    expect(res.body.message).toBe('Partenaire supprimé. 3 envois et 2 commandes ont été dissociés.');
  });

  it('comptage des liens échoue (table absente) → reste à 0, suppression continue', async () => {
    mockDbQuery
      .mockRejectedValueOnce(new Error('table absente')) // shipments count fails
      .mockRejectedValueOnce(new Error('table absente')) // orders count fails
      .mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(buildApp()).delete('/api/admin/partners/p1');
    expect(res.status).toBe(200);
    expect(res.body.links_unset).toEqual({ shipments: 0, orders: 0 });
  });

  it('erreur sur le DELETE lui-même → 500', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      .mockRejectedValueOnce(new Error('delete failed'));
    const res = await request(buildApp()).delete('/api/admin/partners/p1');
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete('/api/admin/partners/p1');
    expect(res.status).toBe(403);
  });
});
