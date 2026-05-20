/**
 * KOMERCE — Tests unitaires : Parcel Optimization Service
 * tests/parcelOptimization.test.js
 *
 * Exécution : npx jest tests/parcelOptimization.test.js --runInBand
 *
 * 19 tests organisés en 3 sections :
 *   1. scoreParcelFit    (6 tests)
 *   2. suggestParcelForItem (6 tests)
 *   3. buildParcelsFromAvailableItems (7 tests)
 */

'use strict';

const {
  DEFAULT_CONFIG,
  scoreParcelFit,
  suggestParcelForItem,
  buildParcelsFromAvailableItems,
  _sortItemsByPriority,
} = require('../services/parcelOptimizationService');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeItem = (overrides = {}) => ({
  order_item_id:      'item-001',
  product_id:         'prod-001',
  quantity_available: 2,
  unit_weight:        1.5,    // kg
  unit_volume:        500,    // cm3
  unit_value:         10000,  // KMF
  category:           'textile',
  is_fragile:         false,
  is_bulky:           false,
  compatibility_group: null,
  ...overrides,
});

const makeParcel = (overrides = {}) => ({
  id:             'parcel-001',
  current_weight: 0,
  current_volume: 0,
  current_value:  0,
  max_weight:     DEFAULT_CONFIG.maxParcelWeightKg,
  max_volume:     DEFAULT_CONFIG.maxParcelVolumeCm3,
  status:         'draft',
  category:       null,
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — scoreParcelFit
// ═══════════════════════════════════════════════════════════════════════════════

describe('scoreParcelFit', () => {

  test('item léger dans colis vide → score valide positif', () => {
    const item   = makeItem({ quantity_available: 1, unit_weight: 1, unit_volume: 1000 });
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.parcelId).toBe('parcel-001');
    expect(result.projected.weight).toBeGreaterThan(0);
  });

  test('item trop lourd → score invalide avec pénalité overweight', () => {
    const item   = makeItem({ quantity_available: 1, unit_weight: 30, unit_volume: 100 }); // 30kg > 25kg max
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    expect(result.valid).toBe(false);
    expect(result.score).toBeLessThanOrEqual(-DEFAULT_CONFIG.overweightPenalty);
    expect(result.reasons.some(r => r.includes('overweight'))).toBe(true);
  });

  test('item trop volumineux → score invalide avec pénalité overvolume', () => {
    const item   = makeItem({ quantity_available: 1, unit_weight: 0.5, unit_volume: 200_000 }); // 200k cm3 > 100k max
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    expect(result.valid).toBe(false);
    expect(result.score).toBeLessThanOrEqual(-DEFAULT_CONFIG.overvolumePenalty);
    expect(result.reasons.some(r => r.includes('overvolume'))).toBe(true);
  });

  test('item fragile → pénalité fragileBulkyPenalty appliquée', () => {
    const itemNormal  = makeItem({ is_fragile: false });
    const itemFragile = makeItem({ is_fragile: true });
    const parcel      = makeParcel();

    const scoreNormal  = scoreParcelFit(itemNormal,  parcel).score;
    const scoreFragile = scoreParcelFit(itemFragile, parcel).score;

    expect(scoreNormal).toBeGreaterThan(scoreFragile);
    expect(scoreFragile).toBe(scoreNormal - DEFAULT_CONFIG.fragileBulkyPenalty);
  });

  test('valeur excessive → pénalité valueOverflowPenalty appliquée', () => {
    const item   = makeItem({ quantity_available: 2, unit_value: 200_000, unit_weight: 0.5, unit_volume: 100 });
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    expect(result.valid).toBe(true);
    expect(result.reasons.some(r => r.includes('value_overflow'))).toBe(true);
  });

  test('colis presque plein → score de remplissage élevé', () => {
    const item   = makeItem({ quantity_available: 1, unit_weight: 3, unit_volume: 1000 });
    const parcel = makeParcel({ current_weight: 20, current_volume: 5000 });
    const result = scoreParcelFit(item, parcel);

    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThan(90);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — suggestParcelForItem
// ═══════════════════════════════════════════════════════════════════════════════

describe('suggestParcelForItem', () => {

  test('parcel disponible → action assign_existing', () => {
    const item    = makeItem();
    const parcel  = makeParcel();
    const result  = suggestParcelForItem(item, [parcel]);

    expect(result.action).toBe('assign_existing');
    expect(result.parcelId).toBe('parcel-001');
  });

  test('aucun parcel — cold start → create_new sans pénalité', () => {
    const item   = makeItem();
    const result = suggestParcelForItem(item, []);

    expect(result.action).toBe('create_new');
    expect(result.parcelId).toBe(null);
    expect(result.score).toBe(0);
    expect(result.reasons[0]).toContain('cold_start');
  });

  test('parcel plein → create_new', () => {
    const item   = makeItem({ unit_weight: 5, quantity_available: 1 });
    const parcel = makeParcel({ current_weight: 23 }); // 23 + 5 = 28 > 25 → plein
    const result = suggestParcelForItem(item, [parcel]);

    expect(result.action).toBe('create_new');
    expect(result.reasons.some(r => r.includes('no_valid_parcel') || r.includes('create_new'))).toBe(true);
  });

  test('parcel fermé (cancelled) → ignoré, create_new', () => {
    const item   = makeItem({ unit_weight: 30, quantity_available: 1 });
    const parcel = makeParcel();
    const result = suggestParcelForItem(item, [parcel]);

    expect(result.action).toBe('create_new');
  });

  test('meilleur colis sélectionné parmi plusieurs', () => {
    const item    = makeItem({ unit_weight: 2, unit_volume: 1000, quantity_available: 1 });
    const parcel1 = makeParcel({ id: 'parcel-best', current_weight: 20, current_volume: 90_000 });
    const parcel2 = makeParcel({ id: 'parcel-empty', current_weight: 0, current_volume: 0 });

    const result = suggestParcelForItem(item, [parcel1, parcel2]);

    expect(result.action).toBe('assign_existing');
    expect(result.parcelId).toBe('parcel-best');
  });

  test('pénalité newParcelBaseCost appliquée quand des colis existent', () => {
    const item   = makeItem({ unit_weight: 10, quantity_available: 1 });
    const parcel = makeParcel({ max_weight: 5 });
    const result = suggestParcelForItem(item, [parcel]);

    expect(result.action).toBe('create_new');
    expect(result.score).toBe(-DEFAULT_CONFIG.newParcelBaseCost);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — buildParcelsFromAvailableItems
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildParcelsFromAvailableItems', () => {

  test('cold start : tout tient dans 1 colis → 1 colis créé (anchor first)', () => {
    const items = [
      makeItem({ order_item_id: 'i1', quantity_available: 2, unit_weight: 1, unit_volume: 500 }),
      makeItem({ order_item_id: 'i2', quantity_available: 1, unit_weight: 0.5, unit_volume: 200 }),
    ];

    const { createdParcels, updatedParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items,
      existingParcels: [],
    });

    expect(createdParcels.length).toBe(1);
    expect(createdParcels[0].items.length).toBe(2);
    expect(updatedParcels.length).toBe(0);
    expect(unassignedItems.length).toBe(0);
  });

  test('cold start : items lourds répartis dans 2 colis (anchor first)', () => {
    const items = [
      makeItem({ order_item_id: 'i1', quantity_available: 1, unit_weight: 20, unit_volume: 1000 }),
      makeItem({ order_item_id: 'i2', quantity_available: 1, unit_weight: 20, unit_volume: 1000 }),
    ];

    const { createdParcels } = buildParcelsFromAvailableItems({ items, existingParcels: [] });

    expect(createdParcels.length).toBe(2);
  });

  test('article trop lourd → colis solo avec warning oversized_item', () => {
    const items = [
      makeItem({ order_item_id: 'big', quantity_available: 1, unit_weight: 40, unit_volume: 500 }),
    ];

    const { createdParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items,
      existingParcels: [],
    });

    expect(createdParcels.length).toBe(1);
    expect(unassignedItems.length).toBe(0);
    expect(createdParcels[0].warnings.some(w => w.includes('oversized_item'))).toBe(true);
  });

  test('quantité zéro → unassigned avec raison no_stock', () => {
    const items = [
      makeItem({ order_item_id: 'no-stock', quantity_available: 0 }),
      makeItem({ order_item_id: 'in-stock', quantity_available: 1, unit_weight: 1, unit_volume: 100 }),
    ];

    const { createdParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items,
      existingParcels: [],
    });

    expect(unassignedItems.length).toBe(1);
    expect(unassignedItems[0].reason).toBe('no_stock');
    expect(createdParcels.length).toBe(1);
  });

  test('items vides → retour vide, pas de colis fantôme', () => {
    const { createdParcels, updatedParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items: [],
      existingParcels: [],
    });

    expect(createdParcels.length).toBe(0);
    expect(updatedParcels.length).toBe(0);
    expect(unassignedItems.length).toBe(0);
  });

  test('ordre de traitement : bulky traité en premier (anchor first)', () => {
    const items = [
      makeItem({ order_item_id: 'small', quantity_available: 1, unit_weight: 0.1, unit_volume: 10, is_bulky: false }),
      makeItem({ order_item_id: 'bulky', quantity_available: 1, unit_weight: 15, unit_volume: 50_000, is_bulky: true }),
    ];

    const sorted = _sortItemsByPriority(items);
    expect(sorted[0].order_item_id).toBe('bulky');
  });

  test('petits items complètent un colis existant (mode enrichissement)', () => {
    const smallItem = makeItem({
      order_item_id: 'small',
      quantity_available: 1,
      unit_weight: 0.2,
      unit_volume: 100,
    });

    const existingParcel = makeParcel({
      id: 'existing-parcel',
      current_weight: 5,
      current_volume: 10_000,
    });

    const { createdParcels, updatedParcels } = buildParcelsFromAvailableItems({
      items: [smallItem],
      existingParcels: [existingParcel],
    });

    expect(updatedParcels.length).toBe(1);
    expect(createdParcels.length).toBe(0);
    expect(updatedParcels[0].parcelId).toBe('existing-parcel');
  });

});
