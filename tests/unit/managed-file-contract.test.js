'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  validateManagedFileBundle,
  assertManagedFileBundle,
} = require('../../services/suppliers/managed-file-contract');

function validBundle(overrides = {}) {
  return {
    schema_version: '1',
    source_type: 'xlsx',
    supplier_name: 'Grossiste local',
    fulfillment_mode: 'SUPPLIER_DIRECT',
    products: [{
      source_product_key: 'ROBE-001',
      product_name: 'Robe lin',
      supplier_product_id: 'ROBE-001',
      currency: 'EUR',
      purchase_price: 18.5,
    }],
    units: [
      {
        source_product_key: 'ROBE-001',
        supplier_sku: 'ROBE-BEI-M',
        supplier_unit_ref: 'BEI-M',
        option_values: { Couleur: 'Beige', Taille: 'M' },
        stock_available: 4,
        purchase_price: 18.5,
        currency: 'EUR',
      },
      {
        source_product_key: 'ROBE-001',
        supplier_sku: 'ROBE-BEI-L',
        supplier_unit_ref: 'BEI-L',
        option_values: { Couleur: 'Beige', Taille: 'L' },
        stock_available: 0,
        purchase_price: 18.5,
        currency: 'EUR',
      },
    ],
    media: [{
      source_product_key: 'ROBE-001',
      media_ref: 'img-1',
      url: 'https://cdn.example.com/robe.jpg',
      role: 'PRODUCT',
      option_values: { Couleur: 'Beige' },
      display_order: 0,
    }],
    ...overrides,
  };
}

test('M1 — bundle riche valide : produit, unités exactes, stock 0 explicite et média optionné', () => {
  const verdict = validateManagedFileBundle(validBundle());
  expect(verdict).toEqual({ valid: true, errors: [] });
  expect(assertManagedFileBundle(validBundle())).toEqual(validBundle());
});

test('M1 — INTERNAL_STOCK utilise le même contrat sans inventer de provider', () => {
  const bundle = validBundle({
    source_type: 'csv',
    supplier_name: 'Komerce Managed Stock',
    fulfillment_mode: 'INTERNAL_STOCK',
    units: [{
      source_product_key: 'ROBE-001',
      supplier_sku: 'KOM-ROBE-001-M',
      supplier_unit_ref: 'KOM-ROBE-001-M',
      option_values: { Taille: 'M' },
      stock_available: 3,
      purchase_price: 12,
      currency: 'EUR',
      supplier_order_identity: null,
    }],
    media: [],
  });
  expect(validateManagedFileBundle(bundle)).toEqual({ valid: true, errors: [] });
});

test.each([
  ['produit dupliqué', (b) => b.products.push({ ...b.products[0] }), 'DUPLICATE_SOURCE_PRODUCT_KEY'],
  ['unité orpheline', (b) => { b.units[0].source_product_key = 'ABSENT'; }, 'ORPHAN_UNIT'],
  ['media orphelin', (b) => { b.media[0].source_product_key = 'ABSENT'; }, 'ORPHAN_MEDIA'],
  ['SKU dupliqué', (b) => { b.units[1].supplier_sku = b.units[0].supplier_sku; }, 'DUPLICATE_SUPPLIER_SKU'],
  ['combinaison dupliquée', (b) => { b.units[1].option_values = { ...b.units[0].option_values }; }, 'DUPLICATE_OPTION_COMBINATION'],
  ['axes incohérents', (b) => { b.units[1].option_values = { Taille: 'L' }; }, 'INCONSISTENT_OPTION_AXES'],
  ['media ref dupliquée', (b) => b.media.push({ ...b.media[0] }), 'DUPLICATE_MEDIA_REF'],
  ['option media inconnue', (b) => { b.media[0].option_values = { Couleur: 'Rouge' }; }, 'MEDIA_OPTION_UNKNOWN'],
])('M1 fail-closed — %s', (_label, mutate, code) => {
  const bundle = validBundle();
  mutate(bundle);
  const verdict = validateManagedFileBundle(bundle);
  expect(verdict.valid).toBe(false);
  expect(verdict.errors.some(error => error.startsWith(code))).toBe(true);
  expect(() => assertManagedFileBundle(bundle)).toThrow('MANAGED_FILE_CONTRACT_INVALID');
});

test('M1 — bornes structurelles : devise invalide, stock négatif et prix nul sont rejetés par le schema', () => {
  const bundle = validBundle();
  bundle.products[0].currency = 'XYZ';
  bundle.units[0].stock_available = -1;
  bundle.units[1].purchase_price = 0;

  const verdict = validateManagedFileBundle(bundle);
  expect(verdict.valid).toBe(false);
  expect(verdict.errors.some(error => error.startsWith('SCHEMA:'))).toBe(true);
});

test('M1 — une simple absence de ligne ne signifie jamais suppression', () => {
  const bundle = validBundle();
  bundle.units = [bundle.units[0]];
  const verdict = validateManagedFileBundle(bundle);
  expect(verdict.valid).toBe(true);
  expect(verdict.errors).toEqual([]);
});
