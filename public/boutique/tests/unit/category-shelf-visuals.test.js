/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const {
  getShelfSubcategoryProductImage,
  getShelfCategoryVisual,
  getShelfSubcategoryVisual,
} = require('../../js/render/category-shelf-visuals.js');

function product(overrides) {
  return Object.assign({
    id: 'p1',
    product_ref: 'KPR-1',
    image_url: 'https://cf.cjdropshipping.com/a.jpg',
    category: 'Maison',
    subcategory: 'Cuisine',
    sort_order: 10,
    is_shelf_curated: true,
  }, overrides);
}

describe('getShelfSubcategoryProductImage', () => {
  it('sans aucun produit curaté (is_shelf_curated absent/false) → aucune photo, jamais de retombée implicite', () => {
    const products = [
      product({ is_shelf_curated: false }),
      product({ is_shelf_curated: undefined, id: 'p2' }),
    ];
    expect(getShelfSubcategoryProductImage(products, 'Maison', 'Cuisine')).toBeNull();
  });

  it('un produit curaté qui correspond catégorie + sous-catégorie → son image', () => {
    const products = [product({ image_url: 'https://cf.cjdropshipping.com/good.jpg' })];
    expect(getShelfSubcategoryProductImage(products, 'Maison', 'Cuisine'))
      .toBe('https://cf.cjdropshipping.com/good.jpg');
  });

  it('plusieurs curatés correspondants → celui au plus petit sort_order gagne (ordre déterministe)', () => {
    const products = [
      product({ id: 'p1', image_url: 'https://cf.cjdropshipping.com/first.jpg', sort_order: 5 }),
      product({ id: 'p2', image_url: 'https://cf.cjdropshipping.com/second.jpg', sort_order: 2 }),
    ];
    expect(getShelfSubcategoryProductImage(products, 'Maison', 'Cuisine'))
      .toBe('https://cf.cjdropshipping.com/second.jpg');
  });

  it('curaté mais mauvaise sous-catégorie, avec un curaté de la même catégorie disponible → fallback catégorie', () => {
    const products = [
      product({ id: 'p1', product_ref: 'KPR-1', sort_order: 20, subcategory: 'Autre-chose', image_url: 'https://cf.cjdropshipping.com/wrong-sub.jpg' }),
      product({ id: 'p2', product_ref: 'KPR-2', sort_order: 5, subcategory: 'Autre-chose-2', image_url: 'https://cf.cjdropshipping.com/cat-fallback.jpg' }),
    ];
    // Aucun des deux ne matche Cuisine précisément, mais les deux sont
    // curatés et dans la bonne catégorie : fallback catégorie déterministe
    // (plus petit sort_order gagne, comme le tri primaire).
    expect(getShelfSubcategoryProductImage(products, 'Maison', 'Cuisine'))
      .toBe('https://cf.cjdropshipping.com/cat-fallback.jpg');
  });

  it('curaté mais mauvaise catégorie → aucune photo (jamais la photo d’un autre univers)', () => {
    const products = [product({ category: 'Tech', is_shelf_curated: true })];
    expect(getShelfSubcategoryProductImage(products, 'Maison', 'Cuisine')).toBeNull();
  });

  it('curaté sans image_url valide → ignoré, pas de crash', () => {
    const products = [product({ image_url: '' })];
    expect(getShelfSubcategoryProductImage(products, 'Maison', 'Cuisine')).toBeNull();
  });

  it('un mélange curaté/non-curaté → seul le curaté peut être choisi, jamais le non-curaté même mieux classé', () => {
    const products = [
      product({ id: 'uncurated', sort_order: 1, is_shelf_curated: false, image_url: 'https://cf.cjdropshipping.com/bad-uncurated.jpg' }),
      product({ id: 'curated', sort_order: 99, is_shelf_curated: true, image_url: 'https://cf.cjdropshipping.com/good-curated.jpg' }),
    ];
    expect(getShelfSubcategoryProductImage(products, 'Maison', 'Cuisine'))
      .toBe('https://cf.cjdropshipping.com/good-curated.jpg');
  });

  it('liste de produits vide ou absente → null sans throw', () => {
    expect(getShelfSubcategoryProductImage([], 'Maison', 'Cuisine')).toBeNull();
    expect(getShelfSubcategoryProductImage(null, 'Maison', 'Cuisine')).toBeNull();
    expect(getShelfSubcategoryProductImage(undefined, 'Maison', 'Cuisine')).toBeNull();
  });

  it('subcategoryKey manquant → null (rien à illustrer)', () => {
    const products = [product()];
    expect(getShelfSubcategoryProductImage(products, 'Maison', null)).toBeNull();
  });
});

describe('getShelfCategoryVisual / getShelfSubcategoryVisual — visuel de secours toujours disponible', () => {
  it('chaque univers connu a un cutout de secours (fallback propre garanti)', () => {
    ['all', 'Soldes', 'Mode & Beauté', 'Maison', 'Tech', 'Bricolage', 'Créations personnelles', 'Auto']
      .forEach((key) => {
        expect(getShelfCategoryVisual(key)).toBeTruthy();
      });
  });

  it('Maison/Cuisine a un visuel de secours défini (pas de trou visuel quand aucune photo curatée)', () => {
    expect(getShelfSubcategoryVisual('Maison', 'Cuisine')).toBeTruthy();
  });
});
