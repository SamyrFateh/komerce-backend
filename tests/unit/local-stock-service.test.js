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
 *                       qty>0 → AVAILABLE_NOW ; jamais lu depuis products.stock ;
 *                       déduit les allocations actives (Vague 2 D2)
 *   setLocalStock     : produit introuvable → throw ; marché introuvable/inactif → throw ;
 *                       qty négatif/non entier → throw ; nominal → upsert, updated_by tracé
 *   getLocalStock     : distingue ligne absente (null) de ligne à qty=0 (objet)
 *   isStockExposable  : exposure ENABLED requis ET quantité réellement disponible
 *                       (allocations actives déduites) — Vague 2 D2
 *   allocateForOrderItem      : client requis ; quantity invalide → throw ;
 *                       pas de local_stock → no-op (null) ; stock insuffisant →
 *                       throw code local_stock_insufficient ; nominal → verrou
 *                       FOR UPDATE, ligne d'allocation créée
 *   consumeAllocationsForOrder : idempotent (WHERE consumed_at IS NULL AND
 *                       released_at IS NULL) ; décrémente qty_physical
 *   releaseAllocationsForOrder : idempotent, ne touche jamais qty_physical
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

// Client de transaction factice pour allocateForOrderItem/consumeAllocationsForOrder/
// releaseAllocationsForOrder — ces fonctions EXIGENT un client explicite, jamais
// le pool global db (voir doctrine du fichier source).
function fakeClient(...responses) {
  const query = jest.fn();
  for (const r of responses) query.mockResolvedValueOnce(r);
  return { query };
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
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ product_id: PRODUCT_ID, market_id: MARKET_ID, qty_physical: 0 }],
      })
      .mockResolvedValueOnce({ rows: [{ active: 0 }] }); // Vague 2 D2 : _activeAllocatedQuantity
    const result = await svc.getAvailability(PRODUCT_ID, MARKET_ID);
    expect(result).toBe('UNAVAILABLE');
  });

  it('ligne à qty_physical > 0 → AVAILABLE_NOW', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ product_id: PRODUCT_ID, market_id: MARKET_ID, qty_physical: 3 }],
      })
      .mockResolvedValueOnce({ rows: [{ active: 0 }] }); // Vague 2 D2 : _activeAllocatedQuantity
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

// ─── isStockExposable ───────────────────────────────────────────────────────

const LOCAL_STOCK_ID = '44444444-4444-4444-4444-444444444444';
const ORDER_ID = '55555555-5555-5555-5555-555555555555';

describe('isStockExposable — Vague 2 D2', () => {
  it('aucune ligne locale → false', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await svc.isStockExposable(PRODUCT_ID, MARKET_ID)).toBe(false);
  });

  it('exposure DISABLED, même avec du stock physique → false', async () => {
    const svc = loadService();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: LOCAL_STOCK_ID, qty_physical: 5, commercial_exposure: 'DISABLED' }],
    });
    expect(await svc.isStockExposable(PRODUCT_ID, MARKET_ID)).toBe(false);
  });

  it('exposure ENABLED mais entièrement alloué (available=0) → false — exposer mentirait', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: LOCAL_STOCK_ID, qty_physical: 2, commercial_exposure: 'ENABLED' }],
      })
      .mockResolvedValueOnce({ rows: [{ active: 2 }] }); // 2 allouées sur 2 physiques
    expect(await svc.isStockExposable(PRODUCT_ID, MARKET_ID)).toBe(false);
  });

  it('exposure ENABLED et quantité réellement disponible → true', async () => {
    const svc = loadService();
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: LOCAL_STOCK_ID, qty_physical: 5, commercial_exposure: 'ENABLED' }],
      })
      .mockResolvedValueOnce({ rows: [{ active: 2 }] }); // 2 allouées, 3 restent
    expect(await svc.isStockExposable(PRODUCT_ID, MARKET_ID)).toBe(true);
  });
});

// ─── allocateForOrderItem ───────────────────────────────────────────────────

describe('allocateForOrderItem — engage AVANT tout paiement (Vague 2 D2)', () => {
  it('lève si aucun client de transaction n\'est fourni', async () => {
    const svc = loadService();
    await expect(
      svc.allocateForOrderItem(null, { productId: PRODUCT_ID, marketId: MARKET_ID, orderId: ORDER_ID, quantity: 1 })
    ).rejects.toThrow(/client de transaction requis/);
  });

  it('lève si quantity n\'est pas un entier positif', async () => {
    const svc = loadService();
    const client = fakeClient();
    await expect(
      svc.allocateForOrderItem(client, { productId: PRODUCT_ID, marketId: MARKET_ID, orderId: ORDER_ID, quantity: 0 })
    ).rejects.toThrow(/quantity doit être un entier positif/);
    await expect(
      svc.allocateForOrderItem(client, { productId: PRODUCT_ID, marketId: MARKET_ID, orderId: ORDER_ID, quantity: -1 })
    ).rejects.toThrow(/quantity doit être un entier positif/);
    await expect(
      svc.allocateForOrderItem(client, { productId: PRODUCT_ID, marketId: MARKET_ID, orderId: ORDER_ID, quantity: 1.5 })
    ).rejects.toThrow(/quantity doit être un entier positif/);
  });

  it('no-op silencieux (null) si le produit n\'a pas de ligne local_stock — stock local strictement opt-in', async () => {
    const svc = loadService();
    const client = fakeClient({ rows: [] }); // SELECT local_stock FOR UPDATE : rien
    const result = await svc.allocateForOrderItem(client, {
      productId: PRODUCT_ID, marketId: MARKET_ID, orderId: ORDER_ID, quantity: 1,
    });
    expect(result).toBeNull();
  });

  it('lève avec code local_stock_insufficient si le disponible est inférieur à la demande', async () => {
    const svc = loadService();
    const client = fakeClient(
      { rows: [{ id: LOCAL_STOCK_ID, qty_physical: 3 }] }, // SELECT FOR UPDATE
      { rows: [{ active: 2 }] }, // _activeAllocatedQuantity : 2 déjà allouées, 1 restant
    );
    let caught;
    try {
      await svc.allocateForOrderItem(client, {
        productId: PRODUCT_ID, marketId: MARKET_ID, orderId: ORDER_ID, quantity: 2,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('local_stock_insufficient');
    expect(caught.message).toMatch(/disponible 1, demandé 2/);
  });

  it('nominal : verrou FOR UPDATE posé, allocation créée', async () => {
    const svc = loadService();
    const client = fakeClient(
      { rows: [{ id: LOCAL_STOCK_ID, qty_physical: 5 }] },
      { rows: [{ active: 1 }] }, // 1 déjà allouée, 4 disponibles
      { rows: [{
        id: 'alloc-1', local_stock_id: LOCAL_STOCK_ID, order_id: ORDER_ID, quantity: 2,
        allocated_at: '2026-08-28T10:00:00Z', consumed_at: null, released_at: null,
      }] },
    );

    const result = await svc.allocateForOrderItem(client, {
      productId: PRODUCT_ID, marketId: MARKET_ID, orderId: ORDER_ID, quantity: 2,
    });

    expect(result.quantity).toBe(2);
    expect(result.consumed_at).toBeNull();
    expect(result.released_at).toBeNull();
    const [lockSql] = client.query.mock.calls[0];
    expect(lockSql).toMatch(/FOR UPDATE/);
    const [insertSql, insertParams] = client.query.mock.calls[2];
    expect(insertSql).toMatch(/INSERT INTO local_stock_allocations/);
    expect(insertParams).toEqual([LOCAL_STOCK_ID, ORDER_ID, 2]);
  });
});

// ─── consumeAllocationsForOrder ─────────────────────────────────────────────

describe('consumeAllocationsForOrder — paiement confirmé, décrémente réellement qty_physical', () => {
  it('lève si aucun client de transaction n\'est fourni', async () => {
    const svc = loadService();
    await expect(svc.consumeAllocationsForOrder(null, ORDER_ID)).rejects.toThrow(/client de transaction requis/);
  });

  it('aucune allocation active → 0 consommée, aucune mutation qty_physical', async () => {
    const svc = loadService();
    const client = fakeClient({ rows: [] }); // SELECT ... FOR UPDATE : rien
    const count = await svc.consumeAllocationsForOrder(client, ORDER_ID);
    expect(count).toBe(0);
    expect(client.query).toHaveBeenCalledTimes(1); // pas d'UPDATE si rien à consommer
  });

  it('nominal : consomme chaque allocation active, décrémente qty_physical d\'autant', async () => {
    const svc = loadService();
    const client = fakeClient(
      { rows: [{ id: 'alloc-1', local_stock_id: LOCAL_STOCK_ID, quantity: 3 }] }, // SELECT FOR UPDATE
      { rows: [] }, // UPDATE local_stock_allocations SET consumed_at
      { rows: [] }, // UPDATE local_stock SET qty_physical -= 3
    );

    const count = await svc.consumeAllocationsForOrder(client, ORDER_ID);

    expect(count).toBe(1);
    const [consumeSql, consumeParams] = client.query.mock.calls[1];
    expect(consumeSql).toMatch(/UPDATE local_stock_allocations SET consumed_at/);
    // Idempotence : la garde WHERE consumed_at IS NULL AND released_at IS NULL
    // est dans la requête elle-même, pas seulement en amont.
    expect(consumeSql).toMatch(/WHERE id = \$1 AND consumed_at IS NULL AND released_at IS NULL/);
    expect(consumeParams).toEqual(['alloc-1']);

    const [decrementSql, decrementParams] = client.query.mock.calls[2];
    expect(decrementSql).toMatch(/UPDATE local_stock SET qty_physical = qty_physical - \$2/);
    expect(decrementParams).toEqual([LOCAL_STOCK_ID, 3]);
  });

  it('la requête de sélection porte elle-même la garde consumed_at/released_at IS NULL — idempotence structurelle', async () => {
    const svc = loadService();
    const client = fakeClient({ rows: [] });
    await svc.consumeAllocationsForOrder(client, ORDER_ID);
    const [selectSql] = client.query.mock.calls[0];
    expect(selectSql).toMatch(/WHERE order_id = \$1 AND consumed_at IS NULL AND released_at IS NULL/);
  });
});

// ─── releaseAllocationsForOrder ─────────────────────────────────────────────

describe('releaseAllocationsForOrder — annulation/échec, ne touche JAMAIS qty_physical', () => {
  it('lève si aucun client de transaction n\'est fourni', async () => {
    const svc = loadService();
    await expect(svc.releaseAllocationsForOrder(null, ORDER_ID)).rejects.toThrow(/client de transaction requis/);
  });

  it('nominal : libère, retourne le nombre de lignes affectées, jamais un UPDATE sur local_stock', async () => {
    const svc = loadService();
    const client = fakeClient({ rows: [], rowCount: 2 });
    const count = await svc.releaseAllocationsForOrder(client, ORDER_ID);
    expect(count).toBe(2);
    expect(client.query).toHaveBeenCalledTimes(1); // une seule requête, jamais de second UPDATE qty_physical
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE local_stock_allocations SET released_at = now\(\)/);
    expect(sql).not.toMatch(/qty_physical/); // jamais l'unité réellement prélevée
    expect(sql).toMatch(/WHERE order_id = \$1 AND consumed_at IS NULL AND released_at IS NULL/);
    expect(params).toEqual([ORDER_ID]);
  });

  it('aucune allocation active → 0 libérée, idempotent (rowCount=0)', async () => {
    const svc = loadService();
    const client = fakeClient({ rows: [], rowCount: 0 });
    const count = await svc.releaseAllocationsForOrder(client, ORDER_ID);
    expect(count).toBe(0);
  });
});
