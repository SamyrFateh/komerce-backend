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

  test('listExposureForMarket projette tous les produits actifs, y compris sans décision explicite', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({
      rows: [
        { product_id: 'p1', commercial_exposure: 'ENABLED', decision_recorded: true, product_name: 'Samsung A16' },
        { product_id: 'p2', commercial_exposure: 'DISABLED', decision_recorded: false, product_name: 'Bouilloire' },
      ],
    });
    const rows = await exposureService.listExposureForMarket('mkt-cm', db);
    expect(rows).toHaveLength(2);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/FROM products p/i);
    expect(sql).toMatch(/LEFT JOIN product_market_exposure pme/i);
    expect(sql).toMatch(/pme\.market_id = \$1/);
    expect(sql).toMatch(/WHERE p\.is_active = TRUE/i);
    expect(sql).toMatch(/COALESCE\(pme\.commercial_exposure, 'DISABLED'\)/i);
    expect(sql).toMatch(/pme\.product_id IS NOT NULL\) AS decision_recorded/i);
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

describe('isProductExposedForMarketCode', () => {
  test('renvoie true quand une ligne ENABLED existe pour ce code marché', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const exposed = await exposureService.isProductExposedForMarketCode('p1', 'CM', db);
    expect(exposed).toBe(true);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/JOIN markets m ON m\.id = pme\.market_id/);
    expect(sql).toMatch(/m\.code = \$2/);
    expect(sql).toMatch(/commercial_exposure = 'ENABLED'/);
    expect(params).toEqual(['p1', 'CM']);
  });

  test('renvoie false — fail-closed — en l’absence de ligne (nouveau produit ou nouveau marché)', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [] });
    const exposed = await exposureService.isProductExposedForMarketCode('p1', 'CG', db);
    expect(exposed).toBe(false);
  });
});
