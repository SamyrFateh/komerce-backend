'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
let store;

beforeEach(() => {
  jest.resetModules();
  window.KOMERCE_FORCE_FALLBACK_CATEGORIES = true;
  localStorage.clear();
  delete global.K;
  store = require('../../js/product-store.js');
  store.setProducts([]);
});

afterEach(() => {
  delete window.KOMERCE_FORCE_FALLBACK_CATEGORIES;
  delete global.K;
  jest.restoreAllMocks();
});

describe('product-store — normalisation et sélections', () => {
  const products = [
    {
      id: 1,
      name: 'Téléphone',
      category: 'Tech',
      subcategory: 'Téléphones',
      image_url: '/phone.jpg',
      promo_pct: 10,
    },
    {
      id: '2',
      name: 'Casque',
      category: 'Tech',
      subcategory: 'Audio',
      images: ['/audio-a.jpg', '/audio-b.jpg'],
      promo_pct: 0,
    },
    {
      id: 3,
      name: 'Robe',
      category: 'Mode',
      subcategory: 'Femme',
      is_available: false,
    },
    {
      id: 4,
      name: 'Mystère',
      category: '',
    },
  ];

  it('normalise les catégories, images et disponibilités sans muter la source', () => {
    const source = products[0];
    const normalized = store.normalizeProduct(source);

    expect(normalized).not.toBe(source);
    expect(normalized.rawCategory).toBe('Tech');
    expect(normalized.displayCategory).toBe('Tech');
    expect(normalized.images).toEqual(['/phone.jpg']);
    expect(normalized.is_available).toBe(true);
    expect(store.normalizeProduct(products[1]).images).toEqual(['/audio-a.jpg', '/audio-b.jpg']);
    expect(store.normalizeProduct(products[2]).is_available).toBe(false);
  });

  it('alimente le cache mémoire et retourne des copies de la liste', () => {
    const cached = store.setProducts(products);
    const all = store.getAllProducts();

    expect(cached).toHaveLength(4);
    expect(all).toEqual(cached);
    expect(all).not.toBe(cached);
    all.pop();
    expect(store.getAllProducts()).toHaveLength(4);
    expect(store.getProductById('1').name).toBe('Téléphone');
    expect(store.getProductById(999)).toBeNull();
  });

  it('filtre promotions, catégories et sous-catégories', () => {
    store.setProducts(products);

    expect(store.getPromoProducts().map(p => p.id)).toEqual([1]);
    expect(store.getProductsByCategory()).toHaveLength(4);
    expect(store.getProductsByCategory('all')).toHaveLength(4);
    expect(store.getProductsByCategory('Tech').map(p => p.id)).toEqual([1, '2']);
    expect(store.getProductsByCategory('Mode & Beauté').map(p => p.id)).toEqual([3]);
    expect(store.getProductsBySubcategory('Tech').map(p => p.id)).toEqual([1, '2']);
    expect(store.getProductsBySubcategory('Tech', 'Phones').map(p => p.id)).toEqual([1]);
    expect(store.getProductsBySubcategory('Tech', 'Audio').map(p => p.id)).toEqual(['2']);
  });

  it('partitionne et recommande des produits du même univers en excluant le produit courant', () => {
    const cached = store.setProducts(products);
    const partition = store.partitionProductsByCategory(cached);

    expect(partition.Tech).toHaveLength(2);
    expect(partition['Mode & Beauté']).toHaveLength(1);
    expect(partition.Autres).toHaveLength(1);
    expect(store.getRecommendedProducts(null)).toEqual([]);
    expect(store.getRecommendedProducts(cached[0], 1).map(p => p.id)).toEqual(['2']);
    expect(store.getRecommendedProducts(cached[1]).map(p => p.id)).toEqual([1]);
  });
});

describe('product-store — cache local et API', () => {
  it('écrit explicitement le cache local', () => {
    const products = [{ id: 10, category: 'Maison' }];
    store.writeCache(products);
    expect(JSON.parse(localStorage.getItem('komerce_products_cache'))).toEqual(products);
  });

  it('charge une liste API, retire les indisponibles et persiste le résultat brut disponible', async () => {
    global.K = {
      products: {
        list: jest.fn().mockResolvedValue([
          { id: 1, category: 'Tech', is_available: true },
          { id: 2, category: 'Tech', is_available: false },
        ]),
      },
    };

    const result = await store.fetchProducts();

    expect(global.K.products.list).toHaveBeenCalledWith({ limit: 1000 });
    expect(result.map(p => p.id)).toEqual([1]);
    expect(JSON.parse(localStorage.getItem('komerce_products_cache')).map(p => p.id)).toEqual([1]);
    expect(store.getAllProducts().map(p => p.id)).toEqual([1]);
  });

  it('accepte aussi la forme API { products: [...] }', async () => {
    global.K = {
      products: {
        list: jest.fn().mockResolvedValue({ products: [{ id: 7, category: 'Maison' }] }),
      },
    };

    await expect(store.fetchProducts()).resolves.toEqual([
      expect.objectContaining({ id: 7, displayCategory: 'Maison' }),
    ]);
  });

  it('retombe sur le cache local si K est absent ou si l’API échoue', async () => {
    localStorage.setItem('komerce_products_cache', JSON.stringify([
      { id: 5, category: 'Tech', is_available: true },
      { id: 6, category: 'Tech', is_available: false },
    ]));

    const result = await store.fetchProducts();
    expect(result.map(p => p.id)).toEqual([5]);

    global.K = {
      products: {
        list: jest.fn().mockRejectedValue(new Error('offline')),
      },
    };
    await expect(store.fetchProducts()).resolves.toEqual([
      expect.objectContaining({ id: 5 }),
    ]);
  });

  it('propage l’erreur si aucun cache valide ne permet la dégradation', async () => {
    localStorage.setItem('komerce_products_cache', '{json-invalide');
    await expect(store.fetchProducts()).rejects.toThrow('K non disponible');

    localStorage.removeItem('komerce_products_cache');
    await expect(store.fetchProducts()).rejects.toThrow('K non disponible');
  });
});
