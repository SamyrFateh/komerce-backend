'use strict';

jest.mock('../../services/transport-rails', () => ({
  listCommercialTransportRails: jest.fn(),
}));

const { listCommercialTransportRails } = require('../../services/transport-rails');
const {
  getProductDetail,
  _buildMedia,
  _buildDeliveryOptions,
  _assertContract,
} = require('../../services/catalog-product-detail');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SKU_M = '22222222-2222-4222-8222-222222222222';
const SKU_L = '33333333-3333-4333-8333-333333333333';

function skuProduct(overrides = {}) {
  return {
    id: PRODUCT_ID,
    product_ref: 'ROB-001',
    sku: null,
    name: 'Robe Dubaï',
    description: 'Robe fluide',
    category: 'vetements',
    subcategory: 'robes',
    price_kmf: 12500,
    promo_pct: 10,
    image_url: 'https://cdn.example.com/main.jpg',
    images: [
      'https://cdn.example.com/main.jpg',
      'https://cdn.example.com/detail.jpg',
    ],
    has_variants: true,
    inventory_model: 'SKU',
    ...overrides,
  };
}

function variantRows() {
  return [
    {
      variant_type: 'Couleur',
      variant_value: 'Marron',
      image_url: 'https://cdn.example.com/brown.jpg',
      images: [
        'https://cdn.example.com/brown.jpg',
        'https://cdn.example.com/brown-scene.jpg',
      ],
      display_order: 1,
    },
    {
      variant_type: 'Couleur',
      variant_value: 'Beige',
      image_url: 'https://cdn.example.com/beige.jpg',
      images: ['https://cdn.example.com/beige.jpg'],
      display_order: 2,
    },
    {
      variant_type: 'Taille',
      variant_value: 'M',
      image_url: null,
      images: [],
      display_order: 1,
    },
    {
      variant_type: 'Taille',
      variant_value: 'L',
      image_url: null,
      images: [],
      display_order: 2,
    },
  ];
}

function skuRows() {
  return [
    {
      id: SKU_M,
      sku: 'ROB-MAR-M',
      variant_combo: { Taille: 'M', Couleur: 'Marron' },
      stock: 4,
      price_kmf: null,
    },
    {
      id: SKU_L,
      sku: 'ROB-MAR-L',
      variant_combo: { Couleur: 'Marron', Taille: 'L' },
      stock: 0,
      price_kmf: 13000,
    },
  ];
}

function dbFor({ product = skuProduct(), variants = variantRows(), skus = skuRows() } = {}) {
  return {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: product ? [product] : [] })
      .mockResolvedValueOnce({ rows: variants })
      .mockResolvedValueOnce({ rows: skus }),
  };
}

describe('catalog product detail contract v1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listCommercialTransportRails.mockReturnValue([
      {
        code: 'SEA_STANDARD',
        capacity_status: 'ACTIVE',
        pricing_status: 'ACTIVE',
        commercial_exposure: 'PUBLIC',
      },
    ]);
  });

  test('compose un produit SKU sans reconstruire un stock par axe', async () => {
    const db = dbFor();
    const detail = await getProductDetail(db, PRODUCT_ID);

    expect(detail.contract_version).toBe('1');
    expect(detail.inventory_model).toBe('SKU');
    expect(detail.product).toEqual({
      id: PRODUCT_ID,
      reference: 'ROB-001',
      name: 'Robe Dubaï',
      description: 'Robe fluide',
      category: 'vetements',
      subcategory: 'robes',
    });
    expect(detail.pricing).toEqual({
      price_kmf: 12500,
      old_price_kmf: null,
      promo_pct: 10,
    });

    expect(detail.option_axes).toEqual([
      {
        key: 'Couleur',
        display_name: 'Couleur',
        values: [
          { value: 'Marron', thumbnail_url: 'https://cdn.example.com/brown.jpg' },
          { value: 'Beige', thumbnail_url: 'https://cdn.example.com/beige.jpg' },
        ],
      },
      {
        key: 'Taille',
        display_name: 'Taille',
        values: [
          { value: 'M', thumbnail_url: null },
          { value: 'L', thumbnail_url: null },
        ],
      },
    ]);

    expect(detail.sellable_units).toHaveLength(2);
    expect(detail.sellable_units[0]).toMatchObject({
      sku_id: SKU_M,
      sku: 'ROB-MAR-M',
      option_values: { Couleur: 'Marron', Taille: 'M' },
      stock_status: 'AVAILABLE',
      available_quantity: 4,
      price_kmf: 12500,
    });
    expect(detail.sellable_units[1]).toMatchObject({
      sku_id: SKU_L,
      sku: 'ROB-MAR-L',
      option_values: { Couleur: 'Marron', Taille: 'L' },
      stock_status: 'OUT_OF_STOCK',
      available_quantity: 0,
      price_kmf: 13000,
    });

    // Beige existe comme valeur d'axe, mais aucune unité Beige n'est fabriquée.
    expect(detail.sellable_units.some((unit) => unit.option_values.Couleur === 'Beige')).toBe(false);
  });

  test('associe les médias d’une valeur d’option aux SKU compatibles, sans heuristique de fichier', async () => {
    const detail = await getProductDetail(dbFor(), PRODUCT_ID);
    const brownMediaIds = detail.media
      .filter((media) => media.option_values.Couleur === 'Marron')
      .map((media) => media.id);

    expect(brownMediaIds).toHaveLength(2);
    expect(detail.sellable_units[0].media_ids).toEqual(brownMediaIds);
    expect(detail.sellable_units[1].media_ids).toEqual(brownMediaIds);
    expect(detail.media.find((media) => media.url.endsWith('/brown-scene.jpg'))).toMatchObject({
      role: 'PRODUCT',
      option_values: { Couleur: 'Marron' },
    });
  });

  test('déduplique uniquement un média ayant même URL, rôle et association explicite', () => {
    const media = _buildMedia(
      skuProduct(),
      [
        ...variantRows(),
        {
          variant_type: 'Couleur',
          variant_value: 'Marron',
          image_url: 'https://cdn.example.com/brown.jpg',
          images: ['https://cdn.example.com/brown.jpg'],
          display_order: 3,
        },
      ]
    );

    expect(media.filter((item) =>
      item.url === 'https://cdn.example.com/main.jpg' && Object.keys(item.option_values).length === 0
    )).toHaveLength(1);
    expect(media.filter((item) =>
      item.url === 'https://cdn.example.com/brown.jpg' && item.option_values.Couleur === 'Marron'
    )).toHaveLength(1);
  });

  test('un produit legacy expose ses axes mais aucune fausse unité vendable', async () => {
    const product = skuProduct({ inventory_model: 'LEGACY_VARIANTS' });
    const db = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [product] })
        .mockResolvedValueOnce({ rows: variantRows() }),
    };

    const detail = await getProductDetail(db, PRODUCT_ID);

    expect(detail.inventory_model).toBe('LEGACY_VARIANTS');
    expect(detail.option_axes).toHaveLength(2);
    expect(detail.sellable_units).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM product_skus'))).toBe(false);
  });

  test('un produit inconnu retourne null sans lire variantes ou SKU', async () => {
    const db = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    await expect(getProductDetail(db, PRODUCT_ID)).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('n’expose que les rails déjà commercialement exposables et n’invente ni prix ni délai', async () => {
    const detail = await getProductDetail(dbFor(), PRODUCT_ID);

    expect(detail.delivery_options).toEqual([
      {
        code: 'SEA_STANDARD',
        label: 'Livraison standard',
        available: true,
        price_kmf: null,
        eta_label: null,
        unavailable_reason: null,
      },
    ]);
    expect(detail.delivery_options.some((option) => option.code === 'AIR_EXPRESS')).toBe(false);
  });

  test('AIR_EXPRESS apparaît automatiquement quand logistics le rend commercial', () => {
    listCommercialTransportRails.mockReturnValue([
      { code: 'SEA_STANDARD' },
      { code: 'AIR_EXPRESS' },
    ]);

    expect(_buildDeliveryOptions().map((option) => [option.code, option.label])).toEqual([
      ['SEA_STANDARD', 'Livraison standard'],
      ['AIR_EXPRESS', 'Livraison express'],
    ]);
  });

  test('échoue bruyamment si logistics expose un rail sans wording public explicite', () => {
    listCommercialTransportRails.mockReturnValue([{ code: 'DRONE_SAME_DAY' }]);
    expect(() => _buildDeliveryOptions()).toThrow('Rail commercial sans label public produit : DRONE_SAME_DAY');
  });

  test('le schéma de sortie bloque un contrat public incomplet', () => {
    expect(() => _assertContract({ contract_version: '1' })).toThrow('Contrat détail produit v1 invalide');
  });

  test('les données numériques invalides deviennent null au lieu de fuir hors contrat', async () => {
    const product = skuProduct({ price_kmf: 'not-a-price', promo_pct: -5 });
    const skus = [{ ...skuRows()[0], price_kmf: -1 }];
    const detail = await getProductDetail(dbFor({ product, skus }), PRODUCT_ID);

    expect(detail.pricing.price_kmf).toBeNull();
    expect(detail.pricing.promo_pct).toBeNull();
    expect(detail.sellable_units[0].price_kmf).toBeNull();
  });
});
