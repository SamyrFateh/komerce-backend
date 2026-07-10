'use strict';

/**
 * tests/unit/product-store.test.js
 *
 * Module js/product-store.js (127L) — source unique des produits
 * normalisés de la boutique. @criticality high, @used-by b-catalog.js,
 * boutique.js, suggestion-modules.
 *
 * Avant cette session : 33% lignes / 21% branches, aucun test dédié.
 * Non testés : normalizeProduct (branches images/is_available),
 * getProductById, getPromoProducts, getProductsByCategory/Subcategory,
 * partitionProductsByCategory, getRecommendedProducts, le cache
 * localStorage (readCache/writeCache) et fetchProducts (succès + les deux
 * branches de fallback).
 *
 * shop-schema.js est utilisé réel (pas mocké) : ses fonctions
 * normalizeCategoryKey/getDbKeysForCategory sont pures et retombent sur
 * _FALLBACK_CATEGORIES en environnement de test (pas de window.K ni de
 * fetch réseau déclenché tant que loadShopSchema() n'est pas appelé).
 */

const {
  normalizeProduct,
  setProducts,
  getAllProducts,
  getProductById,
  getPromoProducts,
  getProductsByCategory,
  getProductsBySubcategory,
  partitionProductsByCategory,
  getRecommendedProducts,
  writeCache,
  fetchProducts,
} = require('../../js/product-store.js');

const { resetLocalStorage } = require('./helpers/boutiqueTestKit');

function makeProduct(overrides = {}) {
  return {
    id: 1,
    name: 'Produit test',
    category: 'Mode',
    price_kmf: 10000,
    is_available: true,
    ...overrides,
  };
}

beforeEach(() => {
  resetLocalStorage();
  setProducts([]); // reset le store partagé entre tests
  delete global.K;
  delete window.K;
});

describe('product-store — normalizeProduct', () => {
  test('calcule rawCategory et displayCategory', () => {
    const n = normalizeProduct(makeProduct({ category: 'Mode' }));
    expect(n.rawCategory).toBe('Mode');
    expect(n.displayCategory).toBe('Mode & Beauté');
  });

  test('rawCategory est vide si category absente', () => {
    const n = normalizeProduct(makeProduct({ category: undefined }));
    expect(n.rawCategory).toBe('');
  });

  test('conserve un tableau images non vide existant', () => {
    const n = normalizeProduct(makeProduct({ images: ['a.jpg', 'b.jpg'] }));
    expect(n.images).toEqual(['a.jpg', 'b.jpg']);
  });

  test('retombe sur [image_url] si images absent/vide', () => {
    const n = normalizeProduct(makeProduct({ images: [], image_url: 'fallback.jpg' }));
    expect(n.images).toEqual(['fallback.jpg']);
  });

  test('images vide si ni images ni image_url', () => {
    const n = normalizeProduct(makeProduct({ images: undefined, image_url: undefined }));
    expect(n.images).toEqual([]);
  });

  test('is_available est true par défaut sauf si explicitement false', () => {
    expect(normalizeProduct(makeProduct({ is_available: undefined })).is_available).toBe(true);
    expect(normalizeProduct(makeProduct({ is_available: false })).is_available).toBe(false);
    expect(normalizeProduct(makeProduct({ is_available: true })).is_available).toBe(true);
  });
});

describe('product-store — setProducts / getAllProducts', () => {
  test('normalise et stocke la liste, getAllProducts retourne une copie', () => {
    setProducts([makeProduct({ id: 1 }), makeProduct({ id: 2 })]);
    const all = getAllProducts();
    expect(all).toHaveLength(2);
    all.push(makeProduct({ id: 3 }));
    expect(getAllProducts()).toHaveLength(2); // copie défensive, pas mutée
  });
});

describe('product-store — getProductById', () => {
  test('retrouve un produit par id (comparaison en string)', () => {
    setProducts([makeProduct({ id: 42 })]);
    expect(getProductById('42')).not.toBeNull();
    expect(getProductById(42).id).toBe(42);
  });

  test('retourne null si introuvable', () => {
    setProducts([makeProduct({ id: 1 })]);
    expect(getProductById(999)).toBeNull();
  });
});

describe('product-store — getPromoProducts', () => {
  test('filtre les produits avec promo_pct > 0', () => {
    setProducts([
      makeProduct({ id: 1, promo_pct: 0 }),
      makeProduct({ id: 2, promo_pct: 10 }),
      makeProduct({ id: 3 }), // promo_pct absent
    ]);
    const promos = getPromoProducts();
    expect(promos).toHaveLength(1);
    expect(promos[0].id).toBe(2);
  });
});

describe('product-store — getProductsByCategory', () => {
  beforeEach(() => {
    setProducts([
      makeProduct({ id: 1, category: 'Mode' }),
      makeProduct({ id: 2, category: 'Tech' }),
      makeProduct({ id: 3, category: 'Beauté' }),
    ]);
  });

  test('"all" ou vide retourne tous les produits', () => {
    expect(getProductsByCategory('all')).toHaveLength(3);
    expect(getProductsByCategory(null)).toHaveLength(3);
  });

  test('filtre via les dbKeys de la catégorie (Mode & Beauté → Mode + Beauté)', () => {
    const result = getProductsByCategory('Mode & Beauté');
    expect(result.map((p) => p.id).sort()).toEqual([1, 3]);
  });

  test('catégorie sans correspondance retourne une liste vide', () => {
    expect(getProductsByCategory('Inexistante')).toEqual([]);
  });
});

describe('product-store — getProductsBySubcategory', () => {
  test('sans subcategoryKey, retourne la liste de la catégorie', () => {
    setProducts([makeProduct({ id: 1, category: 'Mode' })]);
    expect(getProductsBySubcategory('Mode & Beauté', null)).toHaveLength(1);
  });

  test('filtre en plus sur la sous-catégorie', () => {
    setProducts([
      makeProduct({ id: 1, category: 'Mode', subcategory: 'Femme' }),
      makeProduct({ id: 2, category: 'Mode', subcategory: 'Homme' }),
    ]);
    const result = getProductsBySubcategory('Mode & Beauté', 'Femme');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});

describe('product-store — partitionProductsByCategory', () => {
  test('regroupe les produits par displayCategory normalisée', () => {
    const products = setProducts([
      makeProduct({ id: 1, category: 'Mode' }),
      makeProduct({ id: 2, category: 'Tech' }),
      makeProduct({ id: 3, category: 'Mode' }),
    ]);
    const grouped = partitionProductsByCategory(products);
    expect(grouped['Mode & Beauté']).toHaveLength(2);
    expect(grouped['Tech']).toHaveLength(1);
  });

  test('catégorie inconnue tombe dans "Autres"', () => {
    const products = setProducts([makeProduct({ id: 1, category: '' })]);
    const grouped = partitionProductsByCategory(products);
    expect(grouped['Autres']).toHaveLength(1);
  });
});

describe('product-store — getRecommendedProducts', () => {
  test('retourne [] si aucun produit fourni', () => {
    expect(getRecommendedProducts(null)).toEqual([]);
  });

  test('exclut le produit lui-même et matche la même catégorie', () => {
    const products = setProducts([
      makeProduct({ id: 1, category: 'Mode' }),
      makeProduct({ id: 2, category: 'Mode' }),
      makeProduct({ id: 3, category: 'Tech' }),
    ]);
    const target = products[0];
    const recos = getRecommendedProducts(target);
    expect(recos.map((p) => p.id)).toEqual([2]);
  });

  test('respecte la limite passée en paramètre', () => {
    const products = setProducts([
      makeProduct({ id: 1, category: 'Mode' }),
      makeProduct({ id: 2, category: 'Mode' }),
      makeProduct({ id: 3, category: 'Mode' }),
    ]);
    const recos = getRecommendedProducts(products[0], 1);
    expect(recos).toHaveLength(1);
  });
});

describe('product-store — writeCache / fetchProducts', () => {
  test('writeCache sérialise la liste en localStorage', () => {
    writeCache([{ id: 1 }]);
    expect(JSON.parse(localStorage.getItem('komerce_products_cache'))).toEqual([{ id: 1 }]);
  });

  test('fetchProducts : succès via K.products.list, filtre is_available et écrit le cache', async () => {
    global.K = {
      products: {
        list: jest.fn().mockResolvedValue({
          products: [
            makeProduct({ id: 1, is_available: true }),
            makeProduct({ id: 2, is_available: false }),
          ],
        }),
      },
    };
    const result = await fetchProducts();
    expect(global.K.products.list).toHaveBeenCalledWith({ limit: 1000 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(JSON.parse(localStorage.getItem('komerce_products_cache'))).toHaveLength(1);
  });

  test('fetchProducts : accepte une réponse array brute (toArray)', async () => {
    global.K = {
      products: { list: jest.fn().mockResolvedValue([makeProduct({ id: 5 })]) },
    };
    const result = await fetchProducts();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
  });

  test('fetchProducts : retombe sur le cache localStorage si K indisponible', async () => {
    delete global.K;
    writeCache([makeProduct({ id: 9, is_available: true })]);
    const result = await fetchProducts();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(9);
  });

  test('fetchProducts : relance l\u2019erreur d\u2019origine si aucun cache disponible', async () => {
    delete global.K;
    localStorage.clear();
    await expect(fetchProducts()).rejects.toThrow('K non disponible');
  });

  test('fetchProducts : cache corrompu (JSON invalide) est traité comme vide', async () => {
    delete global.K;
    localStorage.setItem('komerce_products_cache', '{not valid json');
    await expect(fetchProducts()).rejects.toThrow();
  });

  test('fetchProducts : propage l\u2019erreur de K.products.list si pas de fallback', async () => {
    global.K = {
      products: { list: jest.fn().mockRejectedValue(new Error('réseau HS')) },
    };
    localStorage.clear();
    await expect(fetchProducts()).rejects.toThrow('réseau HS');
  });
});
