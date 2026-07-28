'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schema = require('../../../../schemas/catalog/product-detail.v1.schema.json');
const {
  FIXTURE_ORDER,
  FIXTURES,
  FIXTURE_EXPECTATIONS,
  fixtureCatalogList,
  getFixture,
  searchFixtureCatalog,
} = require('../fixtures/modal-v3-fixture-catalog');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function combinationCapacity(detail) {
  return detail.option_axes.reduce((total, current) => total * current.values.length, 1);
}

function isRich(detail) {
  const c = detail.content || {};
  return Boolean(
    c.brand ||
    c.short_description ||
    (c.highlights || []).length ||
    (c.specifications || []).length ||
    (c.sections || []).length ||
    (c.materials || []).length ||
    (c.care || []).length ||
    (c.warnings || []).length
  );
}

describe('catalogue de fixtures modale v3', () => {
  test('expose six topologies déterministes avec identifiants et références uniques', () => {
    expect(FIXTURE_ORDER).toHaveLength(6);
    const details = FIXTURE_ORDER.map((key) => FIXTURES[key]);
    expect(new Set(details.map((detail) => detail.product.id)).size).toBe(6);
    expect(new Set(details.map((detail) => detail.product.reference)).size).toBe(6);
    expect(fixtureCatalogList()).toHaveLength(6);
  });

  test.each(FIXTURE_ORDER)('%s respecte product-detail.v1.schema.json', (key) => {
    const valid = validate(FIXTURES[key]);
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  test.each(FIXTURE_ORDER)('%s respecte sa topologie déclarée', (key) => {
    const detail = FIXTURES[key];
    const expected = FIXTURE_EXPECTATIONS[key];
    expect(detail.inventory_model).toBe(expected.inventory);
    expect(detail.option_axes).toHaveLength(expected.axes);
    expect(isRich(detail)).toBe(expected.rich);
    if (expected.irregularMatrix) {
      expect(detail.sellable_units.length).toBeLessThan(combinationCapacity(detail));
    }
  });

  test('la recherche trouve Golden Elite par nom et référence', () => {
    expect(searchFixtureCatalog('elite').map((product) => product.product_ref)).toEqual(['GOLDEN-ELITE-PRO']);
    expect(searchFixtureCatalog('golden-elite-pro')).toHaveLength(1);
  });

  test('la recherche est insensible aux accents et couvre les nouveaux produits', () => {
    expect(searchFixtureCatalog('vetement').map((product) => product.product_ref)).toContain('FIX-VETEMENT-PREMIUM');
    expect(searchFixtureCatalog('meuble').map((product) => product.product_ref)).toContain('FIX-MEUBLE-CONFIGURABLE');
  });

  test('le produit éditorial riche reste sans variantes', () => {
    const detail = FIXTURES.editorialSimple;
    expect(detail.inventory_model).toBe('LEGACY_VARIANTS');
    expect(detail.option_axes).toHaveLength(0);
    expect(detail.sellable_units).toHaveLength(0);
    expect(detail.media.length).toBeGreaterThanOrEqual(5);
    expect(detail.content.highlights.length).toBeGreaterThanOrEqual(4);
    expect(detail.content.specifications.length).toBeGreaterThanOrEqual(6);
  });

  test('le produit SKU minimal garde variantes et matrice sans dépendre du contenu riche', () => {
    const detail = FIXTURES.skuMinimal;
    expect(detail.inventory_model).toBe('SKU');
    expect(detail.option_axes).toHaveLength(2);
    expect(detail.sellable_units.length).toBeGreaterThan(0);
    expect(detail.content.highlights).toHaveLength(0);
    expect(detail.content.specifications).toHaveLength(0);
    expect(detail.sellable_units.some((entry) => entry.stock_status === 'OUT_OF_STOCK')).toBe(true);
  });

  test('la fixture meuble éprouve trois axes, prix variables, rupture et incompatibilités', () => {
    const detail = FIXTURES.configurableFurniture;
    expect(detail.option_axes).toHaveLength(3);
    expect(new Set(detail.sellable_units.map((entry) => entry.price_kmf)).size).toBeGreaterThan(3);
    expect(detail.sellable_units.some((entry) => entry.stock_status === 'OUT_OF_STOCK')).toBe(true);
    expect(detail.sellable_units.length).toBeLessThan(combinationCapacity(detail));
  });

  test('la fixture stress éprouve quatre axes, huit médias et un vrai volume de contenu', () => {
    const detail = FIXTURES.stressLayout;
    expect(detail.option_axes).toHaveLength(4);
    expect(detail.media).toHaveLength(8);
    expect(detail.sellable_units.length).toBeGreaterThanOrEqual(40);
    expect(detail.sellable_units.some((entry) => entry.stock_status === 'OUT_OF_STOCK')).toBe(true);
    expect(detail.content.highlights.length).toBeGreaterThanOrEqual(8);
    expect(detail.content.specifications.length).toBeGreaterThanOrEqual(10);
  });

  test('getFixture retourne un clone et accepte clé, UUID ou référence', () => {
    const byKey = getFixture('premiumGarment');
    const byId = getFixture(byKey.product.id);
    const byRef = getFixture(byKey.product.reference);
    expect(byId).toEqual(byKey);
    expect(byRef).toEqual(byKey);
    byKey.product.name = 'mutation locale';
    expect(FIXTURES.premiumGarment.product.name).not.toBe('mutation locale');
  });
});
