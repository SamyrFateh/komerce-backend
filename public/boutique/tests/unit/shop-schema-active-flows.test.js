'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
function requireFallbackSchema() {
  jest.resetModules();
  window.KOMERCE_FORCE_FALLBACK_CATEGORIES = true;
  global.fetch = jest.fn();
  return require('../../js/shop-schema.js');
}

async function requireApiSchema(rows, responseOverrides = {}) {
  jest.resetModules();
  delete window.KOMERCE_FORCE_FALLBACK_CATEGORIES;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => rows,
    ...responseOverrides,
  });
  const schema = require('../../js/shop-schema.js');
  await schema.loadShopSchema();
  return schema;
}

afterEach(() => {
  delete window.KOMERCE_FORCE_FALLBACK_CATEGORIES;
  jest.restoreAllMocks();
});

describe('shop-schema — fallback déclaratif', () => {
  it('expose toute la taxonomie et les helpers de navigation sans réseau', async () => {
    const schema = requireFallbackSchema();

    await schema.loadShopSchema();
    await schema.loadShopSchema();

    const categories = schema.getCategoryList();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(categories[0].key).toBe('all');
    expect(schema.getRawCategories()).toBeTruthy();
    expect(schema.getRailCategories().length).toBeGreaterThan(1);
    expect(schema.getMobileRailCategories().every(c => c.showInMobileRail !== false)).toBe(true);
    expect(schema.getUniverseCategories().every(c => c.type === schema.NAV_TYPES.UNIVERSE)).toBe(true);
    expect(schema.getCommercialFilters().map(c => c.key)).toContain('Soldes');
    expect(schema.getRailCategoryKeys()).toContain('Tech');
    expect(schema.getSectionOrder()).not.toContain('all');

    expect(schema.getCategoryByKey('Mode').key).toBe('Mode & Beauté');
    expect(schema.normalizeCategoryKey('Beauté')).toBe('Mode & Beauté');
    expect(schema.getCategoryType('Soldes')).toBe(schema.NAV_TYPES.COMMERCIAL_FILTER);
    expect(schema.isCommercialFilter('Soldes')).toBe(true);
    expect(schema.isUniverseCategory('Tech')).toBe(true);
    expect(schema.getCategoryLabel('inconnue')).toBe('inconnue');
    expect(schema.getCategoryIcon('inconnue')).toBeNull();
    expect(schema.getCategorySectionEmoji('inconnue')).toBe('📦');
    expect(schema.getCategoryImage('Tech')).toContain('/boutique/categories/tech.jpg');
    expect(schema.getCategoryFilter('Soldes')).toEqual({ promo: true });
    expect(schema.getDbKeysForCategory('Mode & Beauté')).toEqual(['Mode', 'Beauté']);
    expect(schema.getDbKeysForCategory('inconnue')).toEqual(['inconnue']);

    const techSubcats = schema.getSubcategories('Tech');
    expect(techSubcats.length).toBeGreaterThan(1);
    expect(schema.getSubcategoryMeta('Tech', 'Phones').label).toBe('Tél.');
    expect(schema.getDbKeysForSubcategory('Tech', 'Phones')).toEqual(
      expect.arrayContaining(['Phones', 'Téléphones'])
    );
    expect(schema.matchesSubcategory('Tech', 'Phones', 'Téléphones')).toBe(true);
    expect(schema.matchesSubcategory('Tech', 'Phones', 'Ordinateurs')).toBe(false);
    expect(schema.getSubcategoryMeta('Tech', 'Absent')).toEqual({
      key: 'Absent', label: 'Absent', shortLabel: 'Absent', icon: '✨', dbKeys: ['Absent'],
    });
    expect(schema.getNextSubcategoryKey('Tech', 'Phones')).toBe('Ordi');
    expect(schema.getNextSubcategoryKey('Tech', 'Gaming')).toBeNull();

    expect(schema.createDefaultNavigationState()).toEqual({
      activeUniverse: 'all',
      activeSubcategory: null,
      activeCommercialFilter: null,
      searchQuery: '',
      sort: 'recommended',
    });
    expect(schema.getLegacySubcatsMap().Mode).toEqual(schema.getSubcategories('Mode & Beauté'));
    expect(schema.SHOP_SCHEMA.categories.length).toBe(categories.length);
    expect(schema.SHOP_SCHEMA.universes.length).toBeGreaterThan(0);
    expect(schema.SHOP_SCHEMA.commercialFilters.length).toBeGreaterThan(0);
    expect(schema.SHOP_SCHEMA.navigation.createDefaultState()).toEqual(schema.createDefaultNavigationState());
  });
});

describe('shop-schema — chargement DB', () => {
  const rows = [
    {
      key: 'all', label: 'Tout', display_order: 0,
      show_in_sections: false, section_emoji: '🔥',
    },
    {
      key: 'Custom', label: 'Univers custom', short_label: 'Custom', type: 'universe',
      display_order: 1, section_emoji: '🧩', image_url: '/custom.jpg',
      theme_token: 'theme-custom', accent_token: 'accent-custom', db_keys: ['AliasCustom'],
      filter: { custom: true },
      subcategories: [
        { key: 'Sub', label: 'Sous-catégorie', short_label: 'Sous', icon: '⭐', db_keys: ['SubAlias'] },
      ],
    },
    {
      key: 'Deals', label: 'Promotions', display_order: 2, filter_type: 'promo',
      icon_svg: '<svg></svg>', show_in_mobile_rail: false,
    },
    {
      key: 'JsonFilter', label: 'JSON', display_order: 3, filter_type: 'stock',
      filter_json: { stock: true }, show_in_rail: false,
    },
    {
      key: 'TypedFilter', label: 'Nouveautés', display_order: 4, filter_type: 'new',
      show_in_sections: false,
    },
  ];

  it('normalise les lignes DB, construit les index et applique les filtres', async () => {
    const schema = await requireApiSchema(rows);

    expect(global.fetch).toHaveBeenCalledWith('/api/categories');
    expect(schema.getCategoryList().map(c => c.key)).toEqual([
      'all', 'Custom', 'Deals', 'JsonFilter', 'TypedFilter',
    ]);

    const custom = schema.getCategoryByKey('AliasCustom');
    expect(custom).toMatchObject({
      key: 'Custom',
      shortLabel: 'Custom',
      image: '/custom.jpg',
      imageUrl: '/custom.jpg',
      themeToken: 'theme-custom',
      accentToken: 'accent-custom',
      filter: { custom: true },
    });
    expect(custom.railBadge).toEqual({ kind: 'text', text: '🧩' });
    expect(schema.getSubcategories('AliasCustom')[0]).toEqual({
      key: 'Sub', label: 'Sous-catégorie', shortLabel: 'Sous', icon: '⭐', dbKeys: ['SubAlias'],
    });
    expect(schema.matchesSubcategory('Custom', 'Sub', 'SubAlias')).toBe(true);
    expect(schema.getCategoryByKey('Deals').railBadge).toEqual({ kind: 'svg', svg: '<svg></svg>' });
    expect(schema.getCategoryFilter('Deals')).toEqual({ promo: true });
    expect(schema.getCategoryFilter('JsonFilter')).toEqual({ stock: true });
    expect(schema.getCategoryFilter('TypedFilter')).toEqual({ type: 'new' });
    expect(schema.getMobileRailCategories().map(c => c.key)).not.toContain('Deals');
    expect(schema.getRailCategoryKeys()).not.toContain('JsonFilter');
    expect(schema.getCategoryImage('inconnue')).toBeNull();
  });

  it('retombe sur le fallback si l’API renvoie une liste vide', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const schema = await requireApiSchema([]);

    expect(schema.getCategoryByKey('Tech')).not.toBeNull();
    expect(schema.getCategoryList().length).toBeGreaterThan(1);
    expect(warn).toHaveBeenCalledWith(
      '[shop-schema] API indisponible, fallback hardcodé',
      'empty'
    );
  });

  it('retombe sur le fallback en cas d’erreur HTTP', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const schema = await requireApiSchema(null, {
      ok: false,
      status: 503,
      json: async () => null,
    });

    expect(schema.getCategoryByKey('Maison')).not.toBeNull();
  });
});
