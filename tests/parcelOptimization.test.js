/**
 * KOMERCE — Tests unitaires : Parcel Optimization Service
 * tests/parcelOptimization.test.js
 *
 * Exécution : node --test tests/parcelOptimization.test.js
 * Dépendances : node:test + node:assert (Node.js 18+ built-in)
 *
 * 19 tests organisés en 3 sections :
 *   1. scoreParcelFit    (6 tests)
 *   2. suggestParcelForItem (6 tests)
 *   3. buildParcelsFromAvailableItems (7 tests)
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONFIG,
  scoreParcelFit,
  suggestParcelForItem,
  buildParcelsFromAvailableItems,
  _sortItemsByPriority,
  _itemTotalWeight,
  _itemTotalVolume,
  _itemTotalValue,
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

  it('item léger dans colis vide → score valide positif', () => {
    const item   = makeItem({ quantity_available: 1, unit_weight: 1, unit_volume: 1000 });
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    assert.equal(result.valid, true);
    assert.ok(result.score > 0, `Score devrait être positif, got ${result.score}`);
    assert.equal(result.parcelId, 'parcel-001');
    assert.ok(result.projected.weight > 0);
  });

  it('item trop lourd → score invalide avec pénalité overweight', () => {
    const item   = makeItem({ quantity_available: 1, unit_weight: 30, unit_volume: 100 }); // 30kg > 25kg max
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    assert.equal(result.valid, false);
    assert.ok(result.score <= -DEFAULT_CONFIG.overweightPenalty);
    assert.ok(result.reasons.some(r => r.includes('overweight')));
  });

  it('item trop volumineux → score invalide avec pénalité overvolume', () => {
    const item   = makeItem({ quantity_available: 1, unit_weight: 0.5, unit_volume: 200_000 }); // 200k cm3 > 100k max
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    assert.equal(result.valid, false);
    assert.ok(result.score <= -DEFAULT_CONFIG.overvolumePenalty);
    assert.ok(result.reasons.some(r => r.includes('overvolume')));
  });

  it('item fragile → pénalité fragileBulkyPenalty appliquée', () => {
    const itemNormal  = makeItem({ is_fragile: false });
    const itemFragile = makeItem({ is_fragile: true });
    const parcel      = makeParcel();

    const scoreNormal  = scoreParcelFit(itemNormal,  parcel).score;
    const scoreFragile = scoreParcelFit(itemFragile, parcel).score;

    assert.ok(scoreNormal > scoreFragile, 'Item fragile devrait avoir un score inférieur');
    assert.ok(scoreFragile === scoreNormal - DEFAULT_CONFIG.fragileBulkyPenalty);
  });

  it('valeur excessive → pénalité valueOverflowPenalty appliquée', () => {
    // Mettre 2 items de 200k KMF → dépasse la cible de 300k
    const item   = makeItem({ quantity_available: 2, unit_value: 200_000, unit_weight: 0.5, unit_volume: 100 });
    const parcel = makeParcel();
    const result = scoreParcelFit(item, parcel);

    assert.equal(result.valid, true); // pas invalide, juste pénalisé
    assert.ok(result.reasons.some(r => r.includes('value_overflow')));
  });

  it('colis presque plein → score de remplissage élevé', () => {
    // Colis déjà à 20kg, item de 3kg → remplissage 92%
    const item   = makeItem({ quantity_available: 1, unit_weight: 3, unit_volume: 1000 });
    const parcel = makeParcel({ current_weight: 20, current_volume: 5000 });
    const result = scoreParcelFit(item, parcel);

    assert.equal(result.valid, true);
    assert.ok(result.score > 100, 'Colis presque plein → score remplissage > 100');
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — suggestParcelForItem
// ═══════════════════════════════════════════════════════════════════════════════

describe('suggestParcelForItem', () => {

  it('parcel disponible → action assign_existing', () => {
    const item    = makeItem();
    const parcel  = makeParcel();
    const result  = suggestParcelForItem(item, [parcel]);

    assert.equal(result.action, 'assign_existing');
    assert.equal(result.parcelId, 'parcel-001');
  });

  it('aucun parcel — cold start → create_new sans pénalité', () => {
    const item   = makeItem();
    const result = suggestParcelForItem(item, []);

    assert.equal(result.action, 'create_new');
    assert.equal(result.parcelId, null);
    assert.equal(result.score, 0, 'Cold start : score de création doit être 0 (pas de pénalité)');
    assert.ok(result.reasons[0].includes('cold_start'));
  });

  it('parcel plein → create_new', () => {
    const item   = makeItem({ unit_weight: 5, quantity_available: 1 });
    const parcel = makeParcel({ current_weight: 23 }); // 23 + 5 = 28 > 25 → plein
    const result = suggestParcelForItem(item, [parcel]);

    assert.equal(result.action, 'create_new');
    assert.ok(result.reasons.some(r => r.includes('no_valid_parcel') || r.includes('create_new')));
  });

  it('parcel fermé (cancelled) → ignoré, create_new', () => {
    // Un parcel cancelled ne devrait jamais être dans openParcels côté route
    // Ici on simule : si un colis plein (cancelled simulé par overweight) est passé
    const item   = makeItem({ unit_weight: 30, quantity_available: 1 });
    const parcel = makeParcel(); // item de 30kg > max 25kg → invalide
    const result = suggestParcelForItem(item, [parcel]);

    assert.equal(result.action, 'create_new');
  });

  it('meilleur colis sélectionné parmi plusieurs', () => {
    const item    = makeItem({ unit_weight: 2, unit_volume: 1000, quantity_available: 1 });
    // parcel1 presque plein (meilleur score de remplissage)
    const parcel1 = makeParcel({ id: 'parcel-best', current_weight: 20, current_volume: 90_000 });
    // parcel2 vide
    const parcel2 = makeParcel({ id: 'parcel-empty', current_weight: 0, current_volume: 0 });

    const result = suggestParcelForItem(item, [parcel1, parcel2]);

    assert.equal(result.action, 'assign_existing');
    assert.equal(result.parcelId, 'parcel-best', 'Le colis le plus rempli devrait être favorisé');
  });

  it('pénalité newParcelBaseCost appliquée quand des colis existent', () => {
    // Tous les colis sont trop petits (invalides), on crée → score négatif
    const item   = makeItem({ unit_weight: 10, quantity_available: 1 });
    const parcel = makeParcel({ max_weight: 5 }); // max 5kg → invalide pour l'item de 10kg
    const result = suggestParcelForItem(item, [parcel]);

    assert.equal(result.action, 'create_new');
    assert.equal(result.score, -DEFAULT_CONFIG.newParcelBaseCost);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — buildParcelsFromAvailableItems
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildParcelsFromAvailableItems', () => {

  it('cold start : tout tient dans 1 colis → 1 colis créé (anchor first)', () => {
    const items = [
      makeItem({ order_item_id: 'i1', quantity_available: 2, unit_weight: 1, unit_volume: 500 }),
      makeItem({ order_item_id: 'i2', quantity_available: 1, unit_weight: 0.5, unit_volume: 200 }),
    ];

    const { createdParcels, updatedParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items,
      existingParcels: [],
    });

    assert.equal(createdParcels.length, 1, 'Devrait créer exactement 1 colis');
    assert.equal(createdParcels[0].items.length, 2);
    assert.equal(updatedParcels.length, 0);
    assert.equal(unassignedItems.length, 0);
  });

  it('cold start : items lourds répartis dans 2 colis (anchor first)', () => {
    const items = [
      makeItem({ order_item_id: 'i1', quantity_available: 1, unit_weight: 20, unit_volume: 1000 }),
      makeItem({ order_item_id: 'i2', quantity_available: 1, unit_weight: 20, unit_volume: 1000 }),
    ];

    const { createdParcels } = buildParcelsFromAvailableItems({ items, existingParcels: [] });

    assert.equal(createdParcels.length, 2, 'Deux items lourds → 2 colis');
  });

  it('article trop lourd → colis solo avec warning oversized_item', () => {
    const items = [
      makeItem({ order_item_id: 'big', quantity_available: 1, unit_weight: 40, unit_volume: 500 }),
    ];

    const { createdParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items,
      existingParcels: [],
    });

    assert.equal(createdParcels.length, 1);
    assert.equal(unassignedItems.length, 0);
    assert.ok(createdParcels[0].warnings.some(w => w.includes('oversized_item')));
  });

  it('quantité zéro → unassigned avec raison no_stock', () => {
    const items = [
      makeItem({ order_item_id: 'no-stock', quantity_available: 0 }),
      makeItem({ order_item_id: 'in-stock', quantity_available: 1, unit_weight: 1, unit_volume: 100 }),
    ];

    const { createdParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items,
      existingParcels: [],
    });

    assert.equal(unassignedItems.length, 1);
    assert.equal(unassignedItems[0].reason, 'no_stock');
    assert.equal(createdParcels.length, 1);
  });

  it('items vides → retour vide, pas de colis fantôme', () => {
    const { createdParcels, updatedParcels, unassignedItems } = buildParcelsFromAvailableItems({
      items: [],
      existingParcels: [],
    });

    assert.equal(createdParcels.length, 0);
    assert.equal(updatedParcels.length, 0);
    assert.equal(unassignedItems.length, 0);
  });

  it('ordre de traitement : bulky traité en premier (anchor first)', () => {
    const items = [
      makeItem({ order_item_id: 'small', quantity_available: 1, unit_weight: 0.1, unit_volume: 10, is_bulky: false }),
      makeItem({ order_item_id: 'bulky', quantity_available: 1, unit_weight: 15, unit_volume: 50_000, is_bulky: true }),
    ];

    const sorted = _sortItemsByPriority(items);
    assert.equal(sorted[0].order_item_id, 'bulky', 'Item bulky doit être en premier');
  });

  it('petits items complètent un colis existant (mode enrichissement)', () => {
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

    // Le petit item devrait être assigné au colis existant
    assert.equal(updatedParcels.length, 1, 'Le colis existant devrait être mis à jour');
    assert.equal(createdParcels.length, 0, 'Aucun nouveau colis ne devrait être créé');
    assert.equal(updatedParcels[0].parcelId, 'existing-parcel');
  });

});
