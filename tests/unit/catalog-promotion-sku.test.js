'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { planSkuReconciliation } = require('../../services/catalog-promotion/sku');

function manualSku(overrides = {}) {
  return {
    id: 'manual-1', supplier_sku: null, source: 'MANUAL',
    variant_combo: null, stock: 5, is_active: true, ...overrides,
  };
}

function supplierSku(overrides = {}) {
  return {
    id: 'sup-1', supplier_sku: 'SUP-RED-M', source: 'SUPPLIER',
    variant_combo: { couleur: 'Rouge', taille: 'M' }, stock: 10, is_active: true, ...overrides,
  };
}

describe('catalog-promotion/sku — planSkuReconciliation (PDC-8 Lot 4)', () => {
  test('#15 nouveau SKU jamais vu → toCreate', () => {
    const plan = planSkuReconciliation([], [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge', taille: 'M' }, stock_available: 10 },
    ]);
    expect(plan.toCreate).toEqual([
      { supplier_sku: 'SUP-RED-M', variant_combo: { couleur: 'Rouge', taille: 'M' }, stock: 10, stockKnown: true, source: 'SUPPLIER', media_refs: null },
    ]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toReactivate).toEqual([]);
    expect(plan.toDeactivate).toEqual([]);
  });

  test('#11 supplier_sku stable → même id conservé (toUpdate, pas toCreate)', () => {
    const existing = [supplierSku()];
    const plan = planSkuReconciliation(existing, [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge', taille: 'M' }, stock_available: 10 },
    ]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].id).toBe('sup-1');
  });

  test('#12 combo corrigé avec même supplier_sku → même sku_id, jamais un nouveau', () => {
    const existing = [supplierSku()]; // Rouge/M
    const plan = planSkuReconciliation(existing, [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge foncé', taille: 'M' }, stock_available: 10 },
    ]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]).toMatchObject({
      id: 'sup-1',
      variant_combo: { couleur: 'Rouge foncé', taille: 'M' },
    });
  });

  test('#13 stock modifié → reporté sur le SKU exact concerné uniquement', () => {
    const existing = [supplierSku({ stock: 10 })];
    const plan = planSkuReconciliation(existing, [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge', taille: 'M' }, stock_available: 3 },
    ]);
    expect(plan.toUpdate[0].stock).toBe(3);
    expect(plan.toUpdate[0].stockKnown).toBe(true);
  });

  test('#14 stock positif → 0 : le SKU est conservé (update), pas désactivé', () => {
    const existing = [supplierSku({ stock: 10 })];
    const plan = planSkuReconciliation(existing, [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge', taille: 'M' }, stock_available: 0 },
    ]);
    expect(plan.toDeactivate).toEqual([]);
    expect(plan.toUpdate[0]).toMatchObject({ id: 'sup-1', stock: 0, stockKnown: true });
  });

  test('#16 SKU disparu de la source → désactivé, jamais supprimé', () => {
    const existing = [supplierSku(), { id: 'sup-2', supplier_sku: 'SUP-BLK-M', source: 'SUPPLIER', variant_combo: { couleur: 'Noir', taille: 'M' }, stock: 4, is_active: true }];
    const plan = planSkuReconciliation(existing, [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge', taille: 'M' }, stock_available: 10 },
      // SUP-BLK-M absent de ce replay
    ]);
    expect(plan.toDeactivate).toEqual([{ id: 'sup-2', supplier_sku: 'SUP-BLK-M' }]);
  });

  test('#17 SKU réapparu → même id réactivé (toReactivate), pas de nouvel id', () => {
    const existing = [supplierSku({ is_active: false })]; // désactivé précédemment
    const plan = planSkuReconciliation(existing, [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge', taille: 'M' }, stock_available: 7 },
    ]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toReactivate).toHaveLength(1);
    expect(plan.toReactivate[0]).toMatchObject({ id: 'sup-1', stock: 7 });
  });

  test('SKU manuels jamais touchés par le plan (ni update, ni désactivation)', () => {
    const existing = [manualSku(), supplierSku()];
    const plan = planSkuReconciliation(existing, [
      { supplier_sku: 'SUP-RED-M', option_values: { couleur: 'Rouge', taille: 'M' }, stock_available: 10 },
      // rien pour le manuel — il ne doit jamais apparaître dans toDeactivate
    ]);
    const touchedIds = [...plan.toCreate, ...plan.toUpdate, ...plan.toReactivate, ...plan.toDeactivate]
      .map(x => x.id)
      .filter(Boolean);
    expect(touchedIds).not.toContain('manual-1');
  });

  test('stock_available absent → stock=0 mais stockKnown=false (jamais présenté comme un fait fournisseur)', () => {
    const plan = planSkuReconciliation([], [
      { supplier_sku: 'SUP-NEW', option_values: { taille: 'L' } }, // pas de stock_available
    ]);
    expect(plan.toCreate[0]).toMatchObject({ stock: 0, stockKnown: false });
  });

  test('rejette un sellable_unit sans supplier_sku', () => {
    expect(() => planSkuReconciliation([], [{ option_values: {} }])).toThrow();
  });

  test('rejette des arguments qui ne sont pas des tableaux', () => {
    expect(() => planSkuReconciliation(null, [])).toThrow();
    expect(() => planSkuReconciliation([], null)).toThrow();
  });

  test('ne fixe jamais price_kmf (aucun champ price dans le plan)', () => {
    const plan = planSkuReconciliation([], [
      { supplier_sku: 'SUP-X', option_values: {}, stock_available: 1, purchase_price: 42, currency: 'AED' },
    ]);
    expect(plan.toCreate[0]).not.toHaveProperty('price_kmf');
    expect(plan.toCreate[0]).not.toHaveProperty('purchase_price');
  });
});
