'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const catalog = require('../../services/market-delegation-catalog-service');

function executor() {
  return { query: jest.fn() };
}

function mockAuthz(db, { marketId = 'mkt-cm', marketCode = 'CM', assignmentId = 'a-cm', membershipId = 'm1', capabilities = ['catalog.expose'] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: marketId, market_code: marketCode, market_name: 'Cameroun', currency: 'XAF', assignment_id: assignmentId, assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: membershipId, assignment_id: assignmentId, user_id: 'u1', status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
}

describe('market-delegation catalog service — capabilities et audit', () => {
  test('exposer un produit appelle la frontière catalog avec le marché résolu serveur et audite CATALOG_PRODUCT_EXPOSED', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [] }); // getExposure (before) -> DISABLED
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] }); // productExists
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO product_market_exposure/);
      expect(params[1]).toBe('mkt-cm'); // market_id résolu serveur
      return { rows: [{ id: 'e1', product_id: 'p1', market_id: 'mkt-cm', commercial_exposure: 'ENABLED' }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
      expect(params[4]).toBe('CATALOG_PRODUCT_EXPOSED');
      return { rows: [] };
    });

    const result = await catalog.setExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', productId: 'p1', exposure: 'ENABLED',
    });
    expect(result.commercial_exposure).toBe('ENABLED');
  });

  test('masquer un produit audite CATALOG_PRODUCT_HIDDEN', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ commercial_exposure: 'ENABLED' }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'e1', product_id: 'p1', market_id: 'mkt-cm', commercial_exposure: 'DISABLED' }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(params[4]).toBe('CATALOG_PRODUCT_HIDDEN');
      return { rows: [] };
    });

    const result = await catalog.setExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', productId: 'p1', exposure: 'DISABLED',
    });
    expect(result.commercial_exposure).toBe('DISABLED');
  });

  test('capability absente → 403, aucune écriture tentée', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: [] });

    await expect(catalog.setExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', productId: 'p1', exposure: 'ENABLED',
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });

    expect(db.query).toHaveBeenCalledTimes(3);
  });

  test('produit introuvable renvoie 404 avec le code CATALOG_PRODUCT_NOT_FOUND', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [] }); // getExposure (before)
    db.query.mockResolvedValueOnce({ rows: [] }); // productExists -> false

    await expect(catalog.setExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', productId: 'ghost', exposure: 'ENABLED',
    })).rejects.toMatchObject({ code: 'CATALOG_PRODUCT_NOT_FOUND', status: 404 });
  });

  test('exposition invalide renvoie 400 avec le code CATALOG_EXPOSURE_INVALID', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [] }); // getExposure (before)

    await expect(catalog.setExposure(db, {
      marketCode: 'CM', actorUserId: 'u1', productId: 'p1', exposure: 'MAYBE',
    })).rejects.toMatchObject({ code: 'CATALOG_EXPOSURE_INVALID', status: 400 });
  });

  test('le catalogue global (products) n’est jamais modifié par cette couche', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-catalog-service.js'), 'utf8');
    expect(source).not.toMatch(/UPDATE products/i);
    expect(source).not.toMatch(/users\.role/);
  });
});

describe('market-delegation catalog service — résumé pays', () => {
  test('résume exposition, décisions explicites et relectures sans inventer de seuil', () => {
    const rows = [
      { product_id: 'p1', commercial_exposure: 'ENABLED', decision_recorded: true, needs_review: false },
      { product_id: 'p2', commercial_exposure: 'ENABLED', decision_recorded: true, needs_review: true },
      { product_id: 'p3', commercial_exposure: 'DISABLED', decision_recorded: true, needs_review: false },
      { product_id: 'p4', commercial_exposure: 'DISABLED', decision_recorded: false, needs_review: false },
    ];

    expect(catalog.summarizeExposure(rows)).toEqual({
      catalog_products: 4,
      exposed_products: 2,
      hidden_products: 2,
      undecided_products: 1,
      decided_products: 3,
      explicit_hidden_products: 1,
      exposed_needs_review: 1,
      exposure_pct: 50,
    });
  });

  test('catalogue vide garde le taux inconnu au lieu de fabriquer 0 %', () => {
    expect(catalog.summarizeExposure([])).toEqual({
      catalog_products: 0,
      exposed_products: 0,
      hidden_products: 0,
      undecided_products: 0,
      decided_products: 0,
      explicit_hidden_products: 0,
      exposed_needs_review: 0,
      exposure_pct: null,
    });
  });
});
