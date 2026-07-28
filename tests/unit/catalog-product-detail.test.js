'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/transport-rails', () => ({
  listCommercialTransportRails: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const sharedDb = require('../../db');
const { listCommercialTransportRails } = require('../../services/transport-rails');
const {
  getProductDetail,
  _buildMedia,
  _buildDeliveryOptions,
  _assertContract,
} = require('../../services/catalog-product-detail');
const productDetailRouter = require('../../routes/catalog-product-detail');

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
    series: null,
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

function dbFor({
  product = skuProduct(),
  variants = variantRows(),
  skus = skuRows(),
  catalogMedia = [],
  skuMedia = [],
  contentProfile = null,
  contentSections = [],
  attributes = [],
} = {}) {
  const calls = [
    { rows: product ? [product] : [] },
    { rows: variants },
    { rows: skus },
    { rows: catalogMedia },
  ];
  if (catalogMedia.length > 0 && skus.length > 0) {
    calls.push({ rows: skuMedia });
  }
  calls.push(
    { rows: contentProfile ? [contentProfile] : [] },
    { rows: contentSections },
    { rows: attributes }
  );
  const query = jest.fn();
  calls.forEach((result) => query.mockResolvedValueOnce(result));
  return { query };
}

function commercialSeaOnly() {
  listCommercialTransportRails.mockReturnValue([
    {
      code: 'SEA_STANDARD',
      capacity_status: 'ACTIVE',
      pricing_status: 'ACTIVE',
      commercial_exposure: 'PUBLIC',
    },
  ]);
}

function routeApp() {
  const app = express();
  app.use('/api/products', productDetailRouter);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message, code: err.code || null });
  });
  return app;
}

describe('catalog product detail contract v1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commercialSeaOnly();
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
      series: null,
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

  test('expose une série produit non nulle dans le contrat public', async () => {
    const product = skuProduct({ series: 'Golden Performance Series' });
    const detail = await getProductDetail(dbFor({ product }), PRODUCT_ID);

    expect(detail.product.series).toBe('Golden Performance Series');
  });

  test('reste compatible quand aucune série produit n’est renseignée', async () => {
    const product = skuProduct({ series: null });
    const detail = await getProductDetail(dbFor({ product }), PRODUCT_ID);

    expect(detail.product).toHaveProperty('series', null);
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
        .mockResolvedValueOnce({ rows: variantRows() })
        .mockResolvedValueOnce({ rows: [] }) // catalog_media
        .mockResolvedValueOnce({ rows: [] }) // product_content_profile
        .mockResolvedValueOnce({ rows: [] }) // product_content_sections
        .mockResolvedValueOnce({ rows: [] }), // product_attributes
    };

    const detail = await getProductDetail(db, PRODUCT_ID);

    expect(detail.inventory_model).toBe('LEGACY_VARIANTS');
    expect(detail.option_axes).toHaveLength(2);
    expect(detail.sellable_units).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(6);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM product_skus'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('FROM product_sku_media'))).toBe(false);
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

  test('AIR_EXPRESS apparaît quand logistics le rend commercial et le produit est éligible', () => {
    listCommercialTransportRails.mockReturnValue([
      { code: 'SEA_STANDARD' },
      { code: 'AIR_EXPRESS' },
    ]);

    expect(_buildDeliveryOptions({ air_eligibility_status: 'ELIGIBLE' })
      .map((option) => [option.code, option.label])).toEqual([
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

describe('GET /api/products/:id/detail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commercialSeaOnly();
  });

  test('renvoie le contrat détail public v1', async () => {
    const prepared = dbFor();
    sharedDb.query.mockImplementation((...args) => prepared.query(...args));

    const response = await request(routeApp())
      .get(`/api/products/${PRODUCT_ID}/detail`)
      .expect(200);

    expect(response.body.contract_version).toBe('1');
    expect(response.body.product.id).toBe(PRODUCT_ID);
    expect(response.body.product.series).toBeNull();
    expect(response.body.sellable_units).toHaveLength(2);
  });

  test('refuse un identifiant produit invalide avant toute lecture DB', async () => {
    const response = await request(routeApp())
      .get('/api/products/not-a-uuid/detail')
      .expect(400);

    expect(response.body).toEqual({ error: 'ID produit invalide' });
    expect(sharedDb.query).not.toHaveBeenCalled();
  });

  test('renvoie 404 pour un produit absent', async () => {
    sharedDb.query.mockResolvedValueOnce({ rows: [] });

    const response = await request(routeApp())
      .get(`/api/products/${PRODUCT_ID}/detail`)
      .expect(404);

    expect(response.body).toEqual({ error: 'Produit introuvable' });
  });

  test('propage une erreur de composition au middleware d’erreur', async () => {
    const failure = new Error('DB indisponible');
    failure.code = 'DB_DOWN';
    sharedDb.query.mockRejectedValueOnce(failure);

    const response = await request(routeApp())
      .get(`/api/products/${PRODUCT_ID}/detail`)
      .expect(500);

    expect(response.body).toEqual({ error: 'DB indisponible', code: 'DB_DOWN' });
  });
});
