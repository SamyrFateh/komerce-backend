'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — local-stock-service.js
 *
 * Invariants couverts :
 *   getAvailability   : aucune ligne locale → UNAVAILABLE ; qty=0 → UNAVAILABLE ;
 *                       qty>0 → AVAILABLE_NOW ; jamais lu depuis products.stock
 *   setLocalStock     : produit introuvable → throw ; marché introuvable/inactif → throw ;
 *                       qty négatif/non entier → throw ; nominal → upsert, updated_by tracé
 *   getLocalStock     : distingue ligne absente (null) de ligne à qty=0 (objet)
 *   isolation         : jamais un JOIN ni une lecture de products.stock/product_skus.stock
 *
 * DB mockée — aucune connexion Postgres.
 */

let mockQuery;
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
  return require('../../services/local-stock-service');
}

beforeEach(() => {
  mockQuery = jest.fn();
});

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const MARKET_ID  = '22222222-2222-2222-2222-222222222222';
const USER_ID    = '33333333-3333-3333-3333-333333333333';

// ─── getLocalStock ────────────────────────────────────────────────────────────

describe('getLocalStock', () => {
  it('lève si product_id manquant', async () => {
    const svc = loadService();
    await expect(svc.getLocalStock(null, MARKET_ID)).rejects.toThrow(/product_id/);
  });

  it('lève si market_id manquant', async () => {
    const svc = loadService();
    await expect(svc.getLocalStock(PRODUCT_ID, null)).rejects.toThrow(/market_id/);
  });

  it('aucune ligne : retourne null (pas un objet à qty=0)', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await svc.getLocalStock(PRODUCT_ID, MARKET_ID);
    expect(result).toBeNull();
  });

  it('ligne existante à qty=0 : retourne l\'objet, distinct de null', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'ls-1', product_id: PRODUCT_ID, market_id: MARKET_ID,
                location: 'KM_MAIN', qty_physical: 0 }],
    });
    const result = await svc.getLocalStock(PRODUCT_ID, MARKET_ID);
    expect(result).not.toBeNull();
    expect(result.qty_physical).toBe(0);
  });

  it('utilise KM_MAIN comme location par défaut', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await svc.getLocalStock(PRODUCT_ID, MARKET_ID);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([PRODUCT_ID, MARKET_ID, 'KM_MAIN']);
  });

  it('ne lit jamais products.stock ni product_skus.stock', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await svc.getLocalStock(PRODUCT_ID, MARKET_ID);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/product_skus/i);
    expect(sql).toMatch(/FROM local_stock/i);
    expect(sql).not.toMatch(/products\.stock/i);
  });
});

// ─── getAvailability ──────────────────────────────────────────────────────────

describe('getAvailability — projection calculée, jamais persistée', () => {
  it('aucune ligne locale (jamais suivi) → UNAVAILABLE', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await svc.getAvailability(PRODUCT_ID, MARKET_ID);
    expect(result).toBe('UNAVAILABLE');
  });

  it('ligne à qty_physical=0 (suivi, épuisé) → UNAVAILABLE — même résultat client que "jamais suivi"', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ product_id: PRODUCT_ID, market_id: MARKET_ID, qty_physical: 0 }],
    });
    const result = await svc.getAvailability(PRODUCT_ID, MARKET_ID);
    expect(result).toBe('UNAVAILABLE');
  });

  it('ligne à qty_physical > 0 → AVAILABLE_NOW', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ product_id: PRODUCT_ID, market_id: MARKET_ID, qty_physical: 3 }],
    });
    const result = await svc.getAvailability(PRODUCT_ID, MARKET_ID);
    expect(result).toBe('AVAILABLE_NOW');
  });

  it('n\'expose jamais ETA — seulement AVAILABLE_NOW ou UNAVAILABLE', async () => {
    const svc = loadService();
    expect(Object.values(svc.AVAILABILITY)).toEqual(
      expect.arrayContaining(['AVAILABLE_NOW', 'UNAVAILABLE'])
    );
    expect(Object.values(svc.AVAILABILITY)).not.toContain('ETA');
    expect(Object.keys(svc.AVAILABILITY)).toHaveLength(2);
  });
});

// ─── setLocalStock ────────────────────────────────────────────────────────────

describe('setLocalStock', () => {
  it('lève si product_id manquant', async () => {
    const svc = loadService();
    await expect(svc.setLocalStock({ marketId: MARKET_ID, qtyPhysical: 5 }))
      .rejects.toThrow(/product_id/);
  });

  it('lève si qty_physical négatif', async () => {
    const svc = loadService();
    await expect(
      svc.setLocalStock({ productId: PRODUCT_ID, marketId: MARKET_ID, qtyPhysical: -1 })
    ).rejects.toThrow(/qty_physical/);
  });

  it('lève si qty_physical non entier', async () => {
    const svc = loadService();
    await expect(
      svc.setLocalStock({ productId: PRODUCT_ID, marketId: MARKET_ID, qtyPhysical: 2.5 })
    ).rejects.toThrow(/qty_physical/);
  });

  it('lève si le produit est introuvable', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT products
    await expect(
      svc.setLocalStock({ productId: PRODUCT_ID, marketId: MARKET_ID, qtyPhysical: 5 })
    ).rejects.toThrow(/produit introuvable/);
  });

  it('lève si le marché est introuvable ou inactif', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: PRODUCT_ID }] })  // SELECT products : trouvé
      .mockResolvedValueOnce({ rows: [] });                    // SELECT markets : absent/inactif
    await expect(
      svc.setLocalStock({ productId: PRODUCT_ID, marketId: MARKET_ID, qtyPhysical: 5 })
    ).rejects.toThrow(/marché introuvable/);
  });

  it('nominal : upsert avec updated_by tracé', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: PRODUCT_ID }] })   // SELECT products
      .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })    // SELECT markets
      .mockResolvedValueOnce({ rows: [{               // INSERT ... ON CONFLICT
        id: 'ls-1', product_id: PRODUCT_ID, market_id: MARKET_ID,
        location: 'KM_MAIN', qty_physical: 8, updated_by: USER_ID,
      }] });

    const result = await svc.setLocalStock({
      productId: PRODUCT_ID, marketId: MARKET_ID, qtyPhysical: 8, actorUserId: USER_ID,
    });

    expect(result.qty_physical).toBe(8);
    expect(result.updated_by).toBe(USER_ID);
    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(sql).toMatch(/INSERT INTO local_stock/i);
    expect(params).toEqual([PRODUCT_ID, MARKET_ID, 'KM_MAIN', 8, USER_ID]);
  });

  it('accepte qty_physical = 0 (constat de rupture, pas une erreur)', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: PRODUCT_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })
      .mockResolvedValueOnce({ rows: [{
        id: 'ls-1', product_id: PRODUCT_ID, market_id: MARKET_ID,
        location: 'KM_MAIN', qty_physical: 0, updated_by: null,
      }] });

    const result = await svc.setLocalStock({
      productId: PRODUCT_ID, marketId: MARKET_ID, qtyPhysical: 0,
    });
    expect(result.qty_physical).toBe(0);
  });
});

// ─── Isolation stricte inventory / catalog ────────────────────────────────────

describe('isolation — jamais de mélange avec inventory (hub) ou catalog (import)', () => {
  it('setLocalStock ne référence jamais inventory_items dans son SQL', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: PRODUCT_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: MARKET_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ls-1', qty_physical: 1 }] });

    await svc.setLocalStock({ productId: PRODUCT_ID, marketId: MARKET_ID, qtyPhysical: 1 });

    for (const call of mockQuery.mock.calls) {
      expect(call[0]).not.toMatch(/inventory_items/i);
    }
  });
});
