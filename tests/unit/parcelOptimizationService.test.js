'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcelOptimizationService.test.js
 *
 * Tests du moteur d'optimisation de colisage services/parcelOptimizationService.js.
 *
 * Couverture :
 *   ✓ helpers purs (_itemTotalWeight/Volume/Value, _sortItemsByPriority)
 *   ✓ scoreParcelFit : invalid si overweight/overvolume, score de remplissage,
 *     pénalité valeur excessive, pénalité fragile/bulky, pénalité catégorie
 *   ✓ suggestParcelForItem : cold start, aucun colis valide, assign_existing vs create_new
 *   ✓ buildParcelsFromAvailableItems : guard-fous vides, no_stock, anchor first,
 *     oversized → colis solo + warning, répartition multi-colis
 *   ✓ bootstrapOrderParcels (DB mockée) : no-op si rien à assigner, insertion
 *     parcel + parcel_items + recalcul computed_status
 */

const {
  DEFAULT_CONFIG,
  scoreParcelFit,
  suggestParcelForItem,
  buildParcelsFromAvailableItems,
  bootstrapOrderParcels,
  _sortItemsByPriority,
  _itemTotalWeight,
  _itemTotalVolume,
  _itemTotalValue,
} = require('../../services/parcelOptimizationService');

function item(overrides = {}) {
  return {
    unit_weight: 1, unit_volume: 1000, unit_value: 1000, quantity_available: 1,
    is_fragile: false, is_bulky: false, category: null,
    ...overrides,
  };
}

describe('helpers purs — totaux par item', () => {
  test('_itemTotalWeight = unit_weight * quantity_available', () => {
    expect(_itemTotalWeight(item({ unit_weight: 2.5, quantity_available: 3 }))).toBe(7.5);
  });
  test('_itemTotalVolume = unit_volume * quantity_available', () => {
    expect(_itemTotalVolume(item({ unit_volume: 500, quantity_available: 2 }))).toBe(1000);
  });
  test('_itemTotalValue = unit_value * quantity_available', () => {
    expect(_itemTotalValue(item({ unit_value: 2000, quantity_available: 4 }))).toBe(8000);
  });
  test('valeurs manquantes/NaN traitées comme 0', () => {
    expect(_itemTotalWeight({})).toBe(0);
  });
});

describe('_sortItemsByPriority', () => {
  test('bulky toujours en premier', () => {
    const items = [item({ unit_weight: 1 }), item({ is_bulky: true, unit_weight: 0.1 })];
    const sorted = _sortItemsByPriority(items);
    expect(sorted[0].is_bulky).toBe(true);
  });

  test('à bulky égal, poids total décroissant', () => {
    const items = [item({ unit_weight: 1, quantity_available: 1 }), item({ unit_weight: 5, quantity_available: 1 })];
    const sorted = _sortItemsByPriority(items);
    expect(sorted[0].unit_weight).toBe(5);
  });

  test('fragile avant non-fragile à poids/volume égal', () => {
    const a = item({ unit_weight: 1, unit_volume: 1, is_fragile: false });
    const b = item({ unit_weight: 1, unit_volume: 1, is_fragile: true });
    const sorted = _sortItemsByPriority([a, b]);
    expect(sorted[0].is_fragile).toBe(true);
  });

  test('ne mute pas le tableau original', () => {
    const items = [item({ unit_weight: 1 }), item({ unit_weight: 5 })];
    const copy = [...items];
    _sortItemsByPriority(items);
    expect(items).toEqual(copy);
  });
});

describe('scoreParcelFit', () => {
  test('invalid si le poids projeté dépasse max_weight', () => {
    const res = scoreParcelFit(item({ unit_weight: 30, quantity_available: 1 }), { current_weight: 0, max_weight: 25, max_volume: 100000 });
    expect(res.valid).toBe(false);
    expect(res.reasons[0]).toContain('overweight');
  });

  test('invalid si le volume projeté dépasse max_volume', () => {
    const res = scoreParcelFit(item({ unit_volume: 200000, quantity_available: 1 }), { current_volume: 0, max_weight: 25, max_volume: 100000 });
    expect(res.valid).toBe(false);
    expect(res.reasons[0]).toContain('overvolume');
  });

  test('valide : score = fillWeight% + fillVolume%', () => {
    const res = scoreParcelFit(
      item({ unit_weight: 5, unit_volume: 10000, unit_value: 1000, quantity_available: 1 }),
      { current_weight: 0, current_volume: 0, current_value: 0, max_weight: 25, max_volume: 100000 },
      DEFAULT_CONFIG
    );
    expect(res.valid).toBe(true);
    // fillWeight = 5/25*100=20, fillVolume = 10000/100000*100=10 -> score=30
    expect(res.score).toBeCloseTo(30, 1);
  });

  test('pénalité si la valeur projetée dépasse targetParcelValueKmf', () => {
    const cfg = { ...DEFAULT_CONFIG, targetParcelValueKmf: 1000, valueOverflowPenalty: 50 };
    const res = scoreParcelFit(
      item({ unit_weight: 1, unit_volume: 1, unit_value: 2000, quantity_available: 1 }),
      { current_weight: 0, current_volume: 0, current_value: 0, max_weight: 25, max_volume: 100000 },
      cfg
    );
    expect(res.reasons.some(r => r.includes('value_overflow'))).toBe(true);
  });

  test('pénalité fragile_bulky appliquée si item fragile ou bulky', () => {
    const res = scoreParcelFit(
      item({ is_fragile: true, unit_weight: 1, unit_volume: 1, quantity_available: 1 }),
      { current_weight: 0, current_volume: 0, max_weight: 25, max_volume: 100000 },
      DEFAULT_CONFIG
    );
    expect(res.reasons.some(r => r.includes('fragile_bulky_penalty'))).toBe(true);
  });

  test('pénalité catégorie si allowMixedCategories=false et catégories différentes', () => {
    const cfg = { ...DEFAULT_CONFIG, allowMixedCategories: false };
    const res = scoreParcelFit(
      item({ category: 'electronics', unit_weight: 1, unit_volume: 1, quantity_available: 1 }),
      { current_weight: 0, current_volume: 0, max_weight: 25, max_volume: 100000, category: 'food' },
      cfg
    );
    expect(res.reasons.some(r => r.includes('category_mismatch'))).toBe(true);
  });
});

describe('suggestParcelForItem', () => {
  test('cold start : aucun colis ouvert -> create_new sans pénalité', () => {
    const res = suggestParcelForItem(item(), []);
    expect(res.action).toBe('create_new');
    expect(res.score).toBe(0);
    expect(res.reasons[0]).toContain('cold_start');
  });

  test('aucun colis valide parmi les ouverts -> create_new', () => {
    const overweightParcel = { id: 'P1', current_weight: 24.9, max_weight: 25, max_volume: 100000 };
    const res = suggestParcelForItem(item({ unit_weight: 5, quantity_available: 1 }), [overweightParcel]);
    expect(res.action).toBe('create_new');
    expect(res.reasons[0]).toContain('no_valid_parcel');
  });

  test('assign_existing si le meilleur score valide bat le coût de création', () => {
    const parcel = { id: 'P1', current_weight: 20, current_volume: 0, max_weight: 25, max_volume: 100000 };
    const res = suggestParcelForItem(item({ unit_weight: 1, unit_volume: 1, quantity_available: 1 }), [parcel], DEFAULT_CONFIG);
    expect(res.action).toBe('assign_existing');
    expect(res.parcelId).toBe('P1');
  });

  test('create_new si newParcelBaseCost est très négatif (création très "rentable")', () => {
    const cfg = { ...DEFAULT_CONFIG, newParcelBaseCost: -1000 };
    const parcel = { id: 'P1', current_weight: 0, current_volume: 0, max_weight: 25, max_volume: 100000 };
    const res = suggestParcelForItem(item({ unit_weight: 0.01, unit_volume: 1, quantity_available: 1 }), [parcel], cfg);
    expect(res.action).toBe('create_new');
  });
});

describe('buildParcelsFromAvailableItems', () => {
  test('items vides -> tout vide', () => {
    expect(buildParcelsFromAvailableItems({ items: [] })).toEqual({ createdParcels: [], updatedParcels: [], unassignedItems: [] });
  });

  test('item sans stock -> unassignedItems avec reason no_stock', () => {
    const res = buildParcelsFromAvailableItems({ items: [item({ quantity_available: 0 })] });
    expect(res.unassignedItems).toEqual([{ item: expect.any(Object), reason: 'no_stock' }]);
    expect(res.createdParcels).toEqual([]);
  });

  test('premier item -> colis ancre créé sans scoring (cold start)', () => {
    const res = buildParcelsFromAvailableItems({ items: [item({ unit_weight: 1, unit_volume: 1, quantity_available: 1 })] });
    expect(res.createdParcels).toHaveLength(1);
    expect(res.createdParcels[0].items).toHaveLength(1);
  });

  test('item oversized (poids seul > maxParcelWeightKg) -> colis solo avec warning', () => {
    const res = buildParcelsFromAvailableItems({
      items: [item({ unit_weight: 30, quantity_available: 1 })],
    });
    expect(res.createdParcels).toHaveLength(1);
    expect(res.createdParcels[0].warnings[0]).toContain('oversized_item');
  });

  test('deux petits items tiennent dans le même colis ancre', () => {
    const res = buildParcelsFromAvailableItems({
      items: [
        item({ unit_weight: 1, unit_volume: 100, quantity_available: 1 }),
        item({ unit_weight: 1, unit_volume: 100, quantity_available: 1 }),
      ],
    });
    expect(res.createdParcels).toHaveLength(1);
    expect(res.createdParcels[0].items).toHaveLength(2);
  });

  test('items existingParcels remplis -> updatedParcels (pas createdParcels)', () => {
    const res = buildParcelsFromAvailableItems({
      items: [item({ unit_weight: 1, unit_volume: 100, quantity_available: 1 })],
      existingParcels: [{ id: 'EXIST1', current_weight: 0, current_volume: 0, max_weight: 25, max_volume: 100000 }],
    });
    expect(res.updatedParcels).toHaveLength(1);
    expect(res.updatedParcels[0].parcelId).toBe('EXIST1');
    expect(res.createdParcels).toHaveLength(0);
  });
});

describe('bootstrapOrderParcels (DB mockée)', () => {
  test('aucun order_item non assigné -> no-op', async () => {
    const pool = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    const res = await bootstrapOrderParcels('O1', pool);
    expect(res).toEqual({ createdParcels: [], assignedItems: 0, unassignedItems: [] });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('happy path : crée 1 colis, insère parcel_items, recalcule computed_status', async () => {
    jest.resetModules();
    jest.doMock('../../utils/reference', () => ({ generateParcelRef: jest.fn().mockResolvedValue('KOM-P-2026-000001') }));
    jest.doMock('../../utils/parcelSync', () => ({ safeSyncScanToParcels: jest.fn() }));
    jest.doMock('../../utils/parcels', () => ({ computeOrderStatus: jest.fn().mockReturnValue('preparation') }));

    const { bootstrapOrderParcels: bootstrap } = require('../../services/parcelOptimizationService');

    const rawItems = [{
      order_item_id: 'OI1', product_id: 'PR1', quantity_available: 2, unit_value: 1000,
      unit_weight: 1, unit_volume: 100, category: 'food', is_fragile: false, is_bulky: false,
    }];

    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: rawItems }) // SELECT order_items non assignés
        .mockResolvedValueOnce({ rows: [{ id: 'PID1', reference: 'KOM-P-2026-000001' }] }) // INSERT parcels
        .mockResolvedValueOnce({ rows: [] }) // INSERT parcel_items
        .mockResolvedValueOnce({ rows: [{ status: 'draft', type: 'standard' }] }) // SELECT parcels for computeOrderStatus
        .mockResolvedValueOnce({ rows: [] }), // UPDATE orders.computed_status
    };

    const res = await bootstrap('O1', pool);

    expect(res.createdParcels).toHaveLength(1);
    expect(res.assignedItems).toBe(1);
    expect(res.unassignedItems).toEqual([]);

    const updateCall = pool.query.mock.calls.find(c => c[0].includes('UPDATE orders SET computed_status'));
    expect(updateCall[1]).toEqual(['preparation', 'O1']);

    jest.dontMock('../../utils/reference');
    jest.dontMock('../../utils/parcelSync');
    jest.dontMock('../../utils/parcels');
  });
});
