'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/sourcing-route.test.js
 *
 * Tests du router routes/sourcing.js — façade mince (REFACTO-R2)
 *
 * Doctrine testée : route = auth + appel service + réponse. Toute la logique
 * métier est déjà couverte dans sourcing-analysis.test.js / sourcing-mutations.test.js ;
 * ici on vérifie uniquement le câblage (bon service appelé, bons params, bon code HTTP).
 *
 * Couverture :
 *   ✓ auth : authenticate + requireAdmin sur chaque route
 *   ✓ GET /analysis → sourcingAnalysis.getAnalysis(req.query)
 *   ✓ GET /analysis/:id → 404 si null, sinon 200
 *   ✓ GET /synthesis → sourcingAnalysis.getSynthesis()
 *   ✓ PUT /products/:id → sourcingMutations.updateProduct() + status dynamique
 *   ✓ POST /bulk-rail → sourcingMutations.bulkAssignRail(product_ids, rail)
 *   ✓ GET /config → sourcingAnalysis.getConfig()
 *   ✓ GET /products/:id/variants → 404 si null, sinon 200
 *   ✓ PUT /products/:id/variants → default [] si variants absent
 *   ✓ propagation des erreurs vers next(err)
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockGetAnalysis = jest.fn();
const mockGetAnalysisById = jest.fn();
const mockGetSynthesis = jest.fn();
const mockGetConfig = jest.fn();
const mockGetProductVariants = jest.fn();
jest.mock('../../services/sourcing-analysis', () => ({
  getAnalysis: (...a) => mockGetAnalysis(...a),
  getAnalysisById: (...a) => mockGetAnalysisById(...a),
  getSynthesis: (...a) => mockGetSynthesis(...a),
  getConfig: (...a) => mockGetConfig(...a),
  getProductVariants: (...a) => mockGetProductVariants(...a),
}));

const mockUpdateProduct = jest.fn();
const mockBulkAssignRail = jest.fn();
const mockReplaceVariants = jest.fn();
jest.mock('../../services/sourcing-mutations', () => ({
  updateProduct: (...a) => mockUpdateProduct(...a),
  bulkAssignRail: (...a) => mockBulkAssignRail(...a),
  replaceVariants: (...a) => mockReplaceVariants(...a),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/sourcing');
    app.use('/api/admin/sourcing', router);
  });
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
});

describe('routes/sourcing — GET /analysis', () => {
  it('appelle getAnalysis avec req.query et renvoie 200', async () => {
    mockGetAnalysis.mockResolvedValueOnce({ items: [] });

    const res = await request(app).get('/api/admin/sourcing/analysis?category=electronics');

    expect(res.status).toBe(200);
    expect(mockGetAnalysis).toHaveBeenCalledWith(expect.objectContaining({ category: 'electronics' }));
    expect(res.body).toEqual({ items: [] });
  });

  it('propage une erreur vers next(err)', async () => {
    mockGetAnalysis.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/analysis');
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — GET /analysis/:id', () => {
  it('404 si produit introuvable', async () => {
    mockGetAnalysisById.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/admin/sourcing/analysis/prod-x');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Produit introuvable');
  });

  it('200 avec le détail si trouvé', async () => {
    mockGetAnalysisById.mockResolvedValueOnce({ id: 'prod-1', name: 'Produit' });
    const res = await request(app).get('/api/admin/sourcing/analysis/prod-1');
    expect(res.status).toBe(200);
    expect(mockGetAnalysisById).toHaveBeenCalledWith('prod-1');
    expect(res.body).toEqual({ id: 'prod-1', name: 'Produit' });
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockGetAnalysisById.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/analysis/prod-1');
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — GET /synthesis', () => {
  it('renvoie la synthèse', async () => {
    mockGetSynthesis.mockResolvedValueOnce({ total: 42 });
    const res = await request(app).get('/api/admin/sourcing/synthesis');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 42 });
  });

  it('propage une erreur vers next(err)', async () => {
    mockGetSynthesis.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/synthesis');
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — PUT /products/:id', () => {
  it('renvoie le status et le body définis par le service', async () => {
    mockUpdateProduct.mockResolvedValueOnce({ status: 200, body: { success: true } });
    const res = await request(app)
      .put('/api/admin/sourcing/products/prod-1')
      .send({ rail: 'air' });
    expect(res.status).toBe(200);
    expect(mockUpdateProduct).toHaveBeenCalledWith('prod-1', { rail: 'air' });
    expect(res.body).toEqual({ success: true });
  });

  it('respecte un status d\'erreur métier renvoyé par le service (ex: 422)', async () => {
    mockUpdateProduct.mockResolvedValueOnce({ status: 422, body: { error: 'invalide' } });
    const res = await request(app).put('/api/admin/sourcing/products/prod-1').send({});
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'invalide' });
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockUpdateProduct.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).put('/api/admin/sourcing/products/prod-1').send({ rail: 'air' });
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — POST /bulk-rail', () => {
  it('transmet product_ids et rail au service', async () => {
    mockBulkAssignRail.mockResolvedValueOnce({ status: 200, body: { updated: 3 } });
    const res = await request(app)
      .post('/api/admin/sourcing/bulk-rail')
      .send({ product_ids: ['a', 'b', 'c'], rail: 'sea' });
    expect(res.status).toBe(200);
    expect(mockBulkAssignRail).toHaveBeenCalledWith(['a', 'b', 'c'], 'sea');
    expect(res.body).toEqual({ updated: 3 });
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockBulkAssignRail.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .post('/api/admin/sourcing/bulk-rail')
      .send({ product_ids: ['a'], rail: 'sea' });
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — GET /config', () => {
  it('renvoie la config sourcing', async () => {
    mockGetConfig.mockResolvedValueOnce({ coefficients: {} });
    const res = await request(app).get('/api/admin/sourcing/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ coefficients: {} });
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockGetConfig.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/config');
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — GET /products/:id/variants', () => {
  it('404 si produit introuvable', async () => {
    mockGetProductVariants.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/admin/sourcing/products/prod-1/variants');
    expect(res.status).toBe(404);
  });

  it('200 avec les variants', async () => {
    mockGetProductVariants.mockResolvedValueOnce({ variants: [{ id: 'v1' }] });
    const res = await request(app).get('/api/admin/sourcing/products/prod-1/variants');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ variants: [{ id: 'v1' }] });
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockGetProductVariants.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/products/prod-1/variants');
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — PUT /products/:id/variants', () => {
  it('utilise un tableau vide par défaut si variants absent du body', async () => {
    mockReplaceVariants.mockResolvedValueOnce({ status: 200, body: { success: true } });
    const res = await request(app).put('/api/admin/sourcing/products/prod-1/variants').send({});
    expect(res.status).toBe(200);
    expect(mockReplaceVariants).toHaveBeenCalledWith('prod-1', []);
  });

  it('transmet les variants fournis', async () => {
    mockReplaceVariants.mockResolvedValueOnce({ status: 200, body: { success: true } });
    const variants = [{ sku: 'A' }, { sku: 'B' }];
    const res = await request(app).put('/api/admin/sourcing/products/prod-1/variants').send({ variants });
    expect(mockReplaceVariants).toHaveBeenCalledWith('prod-1', variants);
  });

  it('gère un body vide (undefined) sans planter', async () => {
    mockReplaceVariants.mockResolvedValueOnce({ status: 200, body: {} });
    const res = await request(app)
      .put('/api/admin/sourcing/products/prod-1/variants')
      .set('Content-Type', 'application/json')
      .send();
    expect(res.status).toBe(200);
    expect(mockReplaceVariants).toHaveBeenCalledWith('prod-1', []);
  });

  it("gère req.body réellement undefined (pas de express.json() monté) via le fallback `|| {}`", async () => {
    mockReplaceVariants.mockResolvedValueOnce({ status: 200, body: { success: true } });

    const bareApp = express(); // pas de express.json() ici : req.body reste undefined
    jest.isolateModules(() => {
      const router = require('../../routes/sourcing');
      bareApp.use('/api/admin/sourcing', router);
    });
    bareApp.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message || 'Internal error' });
    });

    const res = await request(bareApp).put('/api/admin/sourcing/products/prod-1/variants');

    expect(res.status).toBe(200);
    expect(mockReplaceVariants).toHaveBeenCalledWith('prod-1', []);
  });

  it('propage une erreur inattendue vers next(err)', async () => {
    mockReplaceVariants.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .put('/api/admin/sourcing/products/prod-1/variants')
      .send({ variants: [] });
    expect(res.status).toBe(500);
  });
});

describe('routes/sourcing — auth', () => {
  it('403 si le rôle n\'est pas admin', async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'u1', role: 'client' }; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/sourcing');
      app.use('/api/admin/sourcing', router);
    });

    const res = await request(app).get('/api/admin/sourcing/synthesis');
    expect(res.status).toBe(403);
  });
});
