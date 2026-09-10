'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const exposureService = require('../../services/catalog-market-exposure-service');

function executor() {
  return { query: jest.fn() };
}

describe('catalog-market-exposure-service (catalog write boundary)', () => {
  test('getExposure renvoie DISABLED (fail-closed) si aucune ligne n’existe', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [] });
    const exposure = await exposureService.getExposure('p1', 'mkt-cm', db);
    expect(exposure).toBe('DISABLED');
  });

  test('getExposure renvoie la valeur stockée si une ligne existe', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ commercial_exposure: 'ENABLED' }] });
    const exposure = await exposureService.getExposure('p1', 'mkt-cm', db);
    expect(exposure).toBe('ENABLED');
  });

  test('setExposure refuse une valeur hors ENABLED/DISABLED', async () => {
    const db = executor();
    await expect(exposureService.setExposure('p1', 'mkt-cm', 'MAYBE', 'u1', db))
      .rejects.toThrow(/exposition invalide/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('setExposure refuse un produit introuvable, avant toute écriture', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [] }); // productExists -> false
    await expect(exposureService.setExposure('ghost', 'mkt-cm', 'ENABLED', 'u1', db))
      .rejects.toThrow(/produit introuvable/);
    expect(db.query).toHaveBeenCalledTimes(1); // uniquement le SELECT d'existence
  });

  test('setExposure fait un upsert (INSERT ... ON CONFLICT), jamais deux lignes pour la même paire', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] }); // productExists -> true
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO product_market_exposure/);
      expect(sql).toMatch(/ON CONFLICT \(product_id, market_id\)/);
      expect(params).toEqual(['p1', 'mkt-cm', 'ENABLED', 'u1']);
      return { rows: [{ id: 'e1', product_id: 'p1', market_id: 'mkt-cm', commercial_exposure: 'ENABLED' }] };
    });
    const result = await exposureService.setExposure('p1', 'mkt-cm', 'ENABLED', 'u1', db);
    expect(result.commercial_exposure).toBe('ENABLED');
  });

  test('listExposureForMarket scope au marché et joint le nom produit', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ product_id: 'p1', commercial_exposure: 'ENABLED', product_name: 'Samsung A16' }] });
    const rows = await exposureService.listExposureForMarket('mkt-cm', db);
    expect(rows).toHaveLength(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WHERE pme\.market_id = \$1/);
    expect(params).toEqual(['mkt-cm']);
  });

  test('le module n’écrit jamais dans products — le catalogue reste unique et intact', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'catalog-market-exposure-service.js'), 'utf8');
    expect(source).not.toMatch(/UPDATE products/i);
    expect(source).not.toMatch(/INSERT INTO products/i);
    expect(source).not.toMatch(/DELETE FROM products/i);
  });
});
