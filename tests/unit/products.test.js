'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/products.test.js
 * Couvre routes/products.js
 *
 * Les routes admin (POST/PUT/DELETE produit, images, variantes) délèguent
 * entièrement à services/product-admin-service.js — celui-ci est mocké ici ;
 * on teste la façade HTTP (auth, validation UUID, mapping status/body/erreurs).
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
  products: { create: {}, update: {}, delete: {} },
}));

// upload : on simule single()/array() comme des middlewares posant req.file/req.files
// via un en-tête de test (x-test-file / x-test-files), pour piloter le scénario.
jest.mock('../../middleware/upload', () => {
  const m = {
    single: () => (req, res, next) => {
      if (req.headers['x-test-file'] === '1') {
        req.file = { filename: 'photo123.jpg', path: '/tmp/photo123.jpg' };
      }
      next();
    },
    array: () => (req, res, next) => {
      if (req.headers['x-test-files']) {
        const n = Number(req.headers['x-test-files']);
        req.files = Array.from({ length: n }, (_, i) => ({ filename: `img${i}.jpg`, path: `/tmp/img${i}.jpg` }));
      }
      next();
    },
  };
  return m;
});

jest.mock('../../services/product-admin-service', () => ({
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  deleteProduct: jest.fn(),
  setMainImage: jest.fn(),
  appendImages: jest.fn(),
  replaceVariants: jest.fn(),
  deleteVariant: jest.fn(),
  getSkuCandidates: jest.fn(),
  upsertProductSku: jest.fn(),
  deactivateProductSku: jest.fn(),
  auditProductSkuReadiness: jest.fn(),
}));

jest.mock('fs', () => ({ unlinkSync: jest.fn() }));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const fs = require('fs');
const productAdminService = require('../../services/product-admin-service');
const productsRouter = require('../../routes/products');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
});

describe('GET /api/products — liste', () => {
  it('accès public, sans auth → 200', async () => {
    mockUser = null;
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit A' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const res = await request(buildApp()).get('/api/products');
    expect(res.status).toBe(200);
  });

  it('nominal sans filtre → 200 + structure { products, total, limit, offset }', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Produit A' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const res = await request(buildApp()).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ products: [{ id: 'p1', name: 'Produit A' }], total: 1, limit: 100, offset: 0 });
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('p.is_active = TRUE');
    expect(params).toEqual([100, 0]);
  });

  it('filtres combinés → conditions et params dans l\'ordre', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await request(buildApp()).get('/api/products?category=electro&subcategory=phones&search=iphone&min_price=1000&max_price=5000&in_stock=true');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('p.category = $1');
    expect(sql).toContain('p.subcategory = $2');
    expect(sql).toContain('p.name ILIKE $3 OR p.description ILIKE $3');
    expect(sql).toContain('p.price_kmf >= $4');
    expect(sql).toContain('p.price_kmf <= $5');
    expect(sql).toContain('(p.stock IS NULL OR p.stock > 0)');
    expect(params.slice(0, 5)).toEqual(['electro', 'phones', '%iphone%', 1000, 5000]);
  });

  it('limit fourni → respecté tant que <= 1000', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(buildApp()).get('/api/products?limit=50');
    expect(res.body.limit).toBe(50);
  });

  it('limit > 1000 → plafonné à 1000', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(buildApp()).get('/api/products?limit=5000');
    expect(res.body.limit).toBe(1000);
  });

  it('limit invalide (non-numérique) → fallback 100', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(buildApp()).get('/api/products?limit=abc');
    expect(res.body.limit).toBe(100);
  });

  it('limit négatif ou zéro → plancher à 1', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const res = await request(buildApp()).get('/api/products?limit=-5');
    expect(res.body.limit).toBe(1);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/products');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/products/categories', () => {
  it('200 + liste des catégories avec sous-catégories agrégées', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ category: 'electro', count: '3', subcategories: ['phones'] }] });
    const res = await request(buildApp()).get('/api/products/categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ category: 'electro', count: '3', subcategories: ['phones'] }]);
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get('/api/products/categories');
    expect(res.status).toBe(500);
  });

  it("n'est pas intercepté par GET /:id (pas de validation UUID)", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/products/categories');
    expect(res.status).not.toBe(400);
  });
});

describe('GET /api/products/subcategories', () => {
  it('200 + sans filtre catégorie', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ category: 'electro', subcategory: 'phones', count: '2' }] });
    const res = await request(buildApp()).get('/api/products/subcategories');
    expect(res.status).toBe(200);
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).not.toContain('category = $1');
    expect(params).toEqual([]);
  });

  it('?category=electro → filtre appliqué', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    await request(buildApp()).get('/api/products/subcategories?category=electro');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('category = $1');
    expect(params).toEqual(['electro']);
  });
});

describe('GET /api/products/:id — détail', () => {
  it('id au format invalide → 400, pas de requête DB', async () => {
    const res = await request(buildApp()).get('/api/products/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'ID produit invalide' });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('produit introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Produit introuvable' });
  });

  it('produit sans variantes → 200, pas de requête supplémentaire', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: VALID_UUID, name: 'Produit A', has_variants: false }] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.variants).toBeUndefined();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('produit avec variantes → groupées par variant_type', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID, name: 'T-shirt', has_variants: true }] })
      .mockResolvedValueOnce({
        rows: [
          { variant_type: 'taille', variant_value: 'M', stock: 5, price_kmf: 1000, image_url: null, sku: 'SKU-M' },
          { variant_type: 'taille', variant_value: 'L', stock: 2, price_kmf: 1000, image_url: null, sku: 'SKU-L' },
          { variant_type: 'couleur', variant_value: 'rouge', stock: 1, price_kmf: null, image_url: null, sku: 'SKU-R' },
        ],
      });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.variants.taille).toHaveLength(2);
    expect(res.body.variants.couleur).toHaveLength(1);
    expect(res.body.variants.taille[0]).toEqual({ value: 'M', stock: 5, price_kmf: 1000, image_url: null, images: [], sku: 'SKU-M' });
  });

  it('erreur DB → 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(500);
  });

  // Doctrine catalogue (DOCTRINE_CATALOGUE.md) : « la boutique ne lit que
  // les champs publiés » — les champs de cuisine de la raffinerie ne
  // doivent jamais atteindre le client, même si la ligne DB (SELECT *)
  // les porte encore.
  it('ne fuit jamais les champs de cuisine raffinerie dans la réponse publique', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: VALID_UUID,
        name: 'Robe fleurie',
        price_kmf: 15000,
        has_variants: false,
        name_source: 'Floral Dress',
        description_source: 'Original EN description',
        source_locale: 'en',
        content_source: 'ai_enriched',
        enrichment_version: 2,
      }],
    });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Robe fleurie');
    expect(res.body).not.toHaveProperty('name_source');
    expect(res.body).not.toHaveProperty('description_source');
    expect(res.body).not.toHaveProperty('source_locale');
    expect(res.body).not.toHaveProperty('content_source');
    expect(res.body).not.toHaveProperty('enrichment_version');
  });
});

describe('POST /api/products — création (admin)', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).post('/api/products').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post('/api/products').send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('nominal → status/body délégués au service', async () => {
    productAdminService.createProduct.mockResolvedValue({ status: 201, body: { id: 'p1', name: 'Produit A' } });
    const res = await request(buildApp()).post('/api/products').send({ name: 'Produit A', category: 'electro' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'p1', name: 'Produit A' });
    expect(productAdminService.createProduct).toHaveBeenCalledWith(
      expect.anything(), { name: 'Produit A', category: 'electro' }, mockUser
    );
  });

  it('le service renvoie un statut 400 (validation métier) → propagé', async () => {
    productAdminService.createProduct.mockResolvedValue({ status: 400, body: { error: 'category invalide' } });
    const res = await request(buildApp()).post('/api/products').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('le service lève une exception → 500 via next', async () => {
    productAdminService.createProduct.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).post('/api/products').send({ name: 'X' });
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/products/:id — modification (admin)', () => {
  it('id invalide → 400, pas d\'appel service', async () => {
    const res = await request(buildApp()).put('/api/products/not-a-uuid').send({ name: 'X' });
    expect(res.status).toBe(400);
    expect(productAdminService.updateProduct).not.toHaveBeenCalled();
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}`).send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('produit introuvable (service renvoie 404) → propagé', async () => {
    productAdminService.updateProduct.mockResolvedValue({ status: 404, body: { error: 'Produit introuvable' } });
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}`).send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('nominal → 200 + body du service', async () => {
    productAdminService.updateProduct.mockResolvedValue({ status: 200, body: { id: VALID_UUID, name: 'Nouveau nom' } });
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}`).send({ name: 'Nouveau nom' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: VALID_UUID, name: 'Nouveau nom' });
  });
});

describe('DELETE /api/products/:id — désactivation (admin)', () => {
  it('id invalide → 400', async () => {
    const res = await request(buildApp()).delete('/api/products/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(403);
  });

  it('nominal → status/body délégués au service (désactivation, pas suppression)', async () => {
    productAdminService.deleteProduct.mockResolvedValue({ status: 200, body: { success: true, deactivated: true } });
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, deactivated: true });
  });

  it('produit introuvable → 404', async () => {
    productAdminService.deleteProduct.mockResolvedValue({ status: 404, body: { error: 'Produit introuvable' } });
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/products/:id/image — upload image principale (admin)', () => {
  it('sans auth → 401', async () => {
    mockUser = null;
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/image`);
    expect(res.status).toBe(401);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/image`);
    expect(res.status).toBe(403);
  });

  it('id invalide → 400', async () => {
    const res = await request(buildApp()).post('/api/products/not-a-uuid/image').set('x-test-file', '1');
    expect(res.status).toBe(400);
  });

  it('aucun fichier envoyé → 400', async () => {
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/image`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Aucune image envoyée. Champ attendu : "image" (multipart/form-data)' });
  });

  it('produit introuvable → 404 + fichier uploadé supprimé du disque', async () => {
    productAdminService.setMainImage.mockResolvedValue({ status: 404, body: { error: 'Produit introuvable ou inactif' } });
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/image`).set('x-test-file', '1');
    expect(res.status).toBe(404);
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/photo123.jpg');
  });

  it('nominal → 200 + image_url construite depuis le filename', async () => {
    productAdminService.setMainImage.mockResolvedValue({
      status: 200,
      body: { success: true, image_url: '/uploads/products/photo123.jpg', product: { id: VALID_UUID, name: 'Produit A' } },
    });
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/image`).set('x-test-file', '1');
    expect(res.status).toBe(200);
    expect(productAdminService.setMainImage).toHaveBeenCalledWith(expect.anything(), VALID_UUID, '/uploads/products/photo123.jpg');
  });
});

describe('POST /api/products/:id/images — upload galerie (admin)', () => {
  it('aucun fichier envoyé → 400', async () => {
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/images`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Aucune image envoyée. Champ attendu : "images" (max 5)' });
  });

  it('produit introuvable → 404 + tous les fichiers supprimés', async () => {
    productAdminService.appendImages.mockResolvedValue({ status: 404, body: { error: 'Produit introuvable ou inactif' } });
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/images`).set('x-test-files', '3');
    expect(res.status).toBe(404);
    expect(fs.unlinkSync).toHaveBeenCalledTimes(3);
  });

  it('nominal → 200, product_name retiré du corps de réponse', async () => {
    productAdminService.appendImages.mockResolvedValue({
      status: 200,
      body: { product_name: 'Produit A', images: ['/uploads/products/img0.jpg'], new_images: ['/uploads/products/img0.jpg'], total_count: 1 },
    });
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/images`).set('x-test-files', '1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ images: ['/uploads/products/img0.jpg'], new_images: ['/uploads/products/img0.jpg'], total_count: 1 });
  });
});

describe('GET /api/products/:id/variants (admin)', () => {
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/variants`);
    expect(res.status).toBe(403);
  });

  it('produit introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/variants`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Produit introuvable' });
  });

  it('nominal → 200 + variants et count', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID, name: 'T-shirt', has_variants: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v1', variant_type: 'taille', variant_value: 'M' }] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/variants`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      product_id: VALID_UUID, product_name: 'T-shirt', has_variants: true,
      variants: [{ id: 'v1', variant_type: 'taille', variant_value: 'M' }], count: 1,
    });
  });
});

describe('PUT /api/products/:id/variants (admin)', () => {
  it('nominal → 200 + résultat du service', async () => {
    productAdminService.replaceVariants.mockResolvedValue({ message: 'ok', product_id: VALID_UUID, count: 2, variants: [] });
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}/variants`).send({ variants: [] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('erreur métier status 400 → 400 + message', async () => {
    const err = Object.assign(new Error('variants doit être un tableau'), { status: 400 });
    productAdminService.replaceVariants.mockRejectedValue(err);
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}/variants`).send({ variants: 'oops' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'variants doit être un tableau' });
  });

  it('erreur métier status 404 → 404 + message', async () => {
    const err = Object.assign(new Error('Produit introuvable'), { status: 404 });
    productAdminService.replaceVariants.mockRejectedValue(err);
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}/variants`).send({ variants: [] });
    expect(res.status).toBe(404);
  });

  it('erreur métier status 409 → 409 + message + hint', async () => {
    const err = Object.assign(new Error('Commandes en cours'), { status: 409, hint: 'Attendez la finalisation' });
    productAdminService.replaceVariants.mockRejectedValue(err);
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}/variants`).send({ variants: [] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Commandes en cours', hint: 'Attendez la finalisation' });
  });

  it('doublon PostgreSQL (code 23505) → 409 avec detail', async () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505', detail: 'Key (type, value) already exists' });
    productAdminService.replaceVariants.mockRejectedValue(err);
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}/variants`).send({ variants: [] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Doublon détecté — deux variantes ont le même type et la même valeur', detail: 'Key (type, value) already exists' });
  });

  it('erreur technique inattendue (sans status) → 500 via next', async () => {
    productAdminService.replaceVariants.mockRejectedValue(new Error('db cassee'));
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}/variants`).send({ variants: [] });
    expect(res.status).toBe(500);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).put(`/api/products/${VALID_UUID}/variants`).send({ variants: [] });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/products/:id/variants/:variantId (admin)', () => {
  it('nominal → status/body délégués au service', async () => {
    productAdminService.deleteVariant.mockResolvedValue({ status: 200, body: { success: true } });
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}/variants/variant-1`);
    expect(res.status).toBe(200);
    expect(productAdminService.deleteVariant).toHaveBeenCalledWith(expect.anything(), VALID_UUID, 'variant-1');
  });

  it('variante introuvable → 404', async () => {
    productAdminService.deleteVariant.mockResolvedValue({ status: 404, body: { error: 'Variante introuvable' } });
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}/variants/variant-x`);
    expect(res.status).toBe(404);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}/variants/variant-1`);
    expect(res.status).toBe(403);
  });

  it('id produit invalide → 400', async () => {
    const res = await request(buildApp()).delete('/api/products/not-a-uuid/variants/variant-1');
    expect(res.status).toBe(400);
  });
});

// ─── SKU (Lot 1) ────────────────────────────────────────────────────────────

describe('GET /api/products/:id/skus (admin)', () => {
  it('id invalide → 400', async () => {
    const res = await request(buildApp()).get('/api/products/not-a-uuid/skus');
    expect(res.status).toBe(400);
  });

  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/skus`);
    expect(res.status).toBe(403);
  });

  it('?candidates=1 → délègue à getSkuCandidates', async () => {
    productAdminService.getSkuCandidates.mockResolvedValue({ product_id: VALID_UUID, candidates: [] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/skus?candidates=1`);
    expect(res.status).toBe(200);
    expect(productAdminService.getSkuCandidates).toHaveBeenCalledWith(expect.anything(), VALID_UUID);
  });

  it('produit introuvable → 404', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/skus`);
    expect(res.status).toBe(404);
  });

  it('nominal → 200 + skus déclarés', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID, name: 'Riz', has_variants: false, inventory_model: 'LEGACY_VARIANTS' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sku-1', sku: null, variant_combo: null, stock: 10 }] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/skus`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ product_id: VALID_UUID, product_name: 'Riz', count: 1 });
  });
});

describe('GET /api/products/:id/skus/readiness (admin)', () => {
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/skus/readiness`);
    expect(res.status).toBe(403);
  });

  it('nominal → 200 + résultat du service', async () => {
    productAdminService.auditProductSkuReadiness.mockResolvedValue({ product_id: VALID_UUID, ready: true, reasons: [] });
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/skus/readiness`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ready: true });
  });

  it('produit introuvable → 404', async () => {
    productAdminService.auditProductSkuReadiness.mockRejectedValue(Object.assign(new Error('Produit introuvable'), { status: 404 }));
    const res = await request(buildApp()).get(`/api/products/${VALID_UUID}/skus/readiness`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/products/:id/skus (admin)', () => {
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/skus`).send({ stock: 5 });
    expect(res.status).toBe(403);
  });

  it('nominal → 201 + résultat du service', async () => {
    productAdminService.upsertProductSku.mockResolvedValue({ message: 'SKU enregistré', sku: { id: 'sku-1' } });
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/skus`).send({ stock: 5 });
    expect(res.status).toBe(201);
    expect(productAdminService.upsertProductSku).toHaveBeenCalledWith(expect.anything(), VALID_UUID, { stock: 5 });
  });

  it('erreur métier 400 → 400 + message', async () => {
    productAdminService.upsertProductSku.mockRejectedValue(Object.assign(new Error('stock invalide'), { status: 400 }));
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/skus`).send({ stock: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'stock invalide' });
  });

  it('erreur métier 409 (doublon combo) → 409', async () => {
    productAdminService.upsertProductSku.mockRejectedValue(Object.assign(new Error('Combo déjà déclaré'), { status: 409 }));
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/skus`).send({ stock: 1, variant_combo: { couleur: 'Noir' } });
    expect(res.status).toBe(409);
  });

  it('erreur technique inattendue (sans status) → 500 via next', async () => {
    productAdminService.upsertProductSku.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post(`/api/products/${VALID_UUID}/skus`).send({ stock: 1 });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/products/:id/skus/:skuId (admin)', () => {
  it('non-admin → 403', async () => {
    mockUser = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}/skus/sku-1`);
    expect(res.status).toBe(403);
  });

  it('nominal → status/body délégués au service (désactivation, pas suppression)', async () => {
    productAdminService.deactivateProductSku.mockResolvedValue({ status: 200, body: { message: 'SKU désactivé' } });
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}/skus/sku-1`);
    expect(res.status).toBe(200);
    expect(productAdminService.deactivateProductSku).toHaveBeenCalledWith(expect.anything(), VALID_UUID, 'sku-1');
  });

  it('SKU introuvable → 404', async () => {
    productAdminService.deactivateProductSku.mockResolvedValue({ status: 404, body: { error: 'SKU introuvable pour ce produit' } });
    const res = await request(buildApp()).delete(`/api/products/${VALID_UUID}/skus/sku-x`);
    expect(res.status).toBe(404);
  });

  it('id produit invalide → 400', async () => {
    const res = await request(buildApp()).delete('/api/products/not-a-uuid/skus/sku-1');
    expect(res.status).toBe(400);
  });
});
