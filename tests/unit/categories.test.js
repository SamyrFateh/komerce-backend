'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/categories.test.js
 * Couvre routes/categories.js
 *
 * Route publique (pas d'auth) : GET /api/categories.
 * Cache HTTP via ETag/X-Schema-Version (utils/categories-cache.js).
 */

const express = require('express');
const request = require('supertest');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

jest.mock('../../utils/categories-cache', () => ({
  getCategoriesETag: jest.fn(),
  getCategoriesVersion: jest.fn(),
}));

const { getCategoriesETag, getCategoriesVersion } = require('../../utils/categories-cache');
const categoriesRouter = require('../../routes/categories');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/categories', categoriesRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  getCategoriesETag.mockReturnValue('"v1-1000"');
  getCategoriesVersion.mockReturnValue(1);
});

describe('GET /api/categories — accès public', () => {
  it("pas d'auth requise → 200 sans token", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/categories');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/categories — nominal', () => {
  it('retourne le tableau des catégories avec leurs sous-catégories', async () => {
    const rows = [
      { key: 'electro', label: 'Électronique', display_order: 1, subcategories: [{ key: 'tel', label: 'Téléphones' }] },
    ];
    mockDbQuery.mockResolvedValueOnce({ rows });
    const res = await request(buildApp()).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
  });

  it('pose les en-têtes Cache-Control, ETag et X-Schema-Version', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/categories');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['etag']).toBe('"v1-1000"');
    expect(res.headers['x-schema-version']).toBe('1');
  });

  it('aucune catégorie active → tableau vide, pas une erreur', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/categories — revalidation If-None-Match', () => {
  it('ETag identique → 304 sans interroger la base', async () => {
    const res = await request(buildApp())
      .get('/api/categories')
      .set('If-None-Match', '"v1-1000"');
    expect(res.status).toBe(304);
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(res.headers['etag']).toBe('"v1-1000"');
    expect(res.headers['x-schema-version']).toBe('1');
  });

  it('ETag different (version perimee) → 200, requete la base, nouveau ETag', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .get('/api/categories')
      .set('If-None-Match', '"v0-999"');
    expect(res.status).toBe(200);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/categories — tables absentes (pré-migration)', () => {
  it('erreur PostgreSQL 42P01 → 200 + tableau vide, Cache-Control no-store', async () => {
    const err = new Error('relation "boutique_categories" does not exist');
    err.code = '42P01';
    mockDbQuery.mockRejectedValueOnce(err);

    const res = await request(buildApp()).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/categories — erreur inattendue', () => {
  it('autre erreur DB → propagee via next, 500', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('connexion perdue'));
    const res = await request(buildApp()).get('/api/categories');
    expect(res.status).toBe(500);
  });
});
