'use strict';

/**
 * LOT GPM-1 — Preuve du Product Detail Contract sur le Golden Product.
 *
 * Ce test appelle le VRAI service (services/catalog-product-detail.js,
 * getProductDetail), avec un client DB mocké qui renvoie exactement les
 * lignes que scripts/seed-golden-product.js insère en base (même fixture
 * partagée : tests/fixtures/catalog/golden-elite-pro.js).
 *
 * Ce que ce test verrouille (relations, pas seulement présence de champs) :
 *   Bleu + 42 → GOLD-BLU-42, disponible, 42 000 KMF
 *   Bleu + 43 → GOLD-BLU-43, rupture, 42 000 KMF
 *   Bleu + 44 → GOLD-BLU-44, disponible, 45 000 KMF
 *   Noir + 42 → GOLD-BLK-42, disponible, 42 000 KMF
 *   Noir + 43 → GOLD-BLK-43, disponible, 43 000 KMF
 *   Noir + 44 → aucune unité vendable
 *
 * Ce que ce test NE prouve PAS (hors périmètre GPM-1, cf. livrable) :
 *   - l'insertion réelle en base (nécessite scripts/seed-golden-product.js
 *     exécuté contre une vraie DB) ;
 *   - le rendu de la modal mobile (GPM-2/GPM-3, Playwright) ;
 *   - les captures visuelles (GPM-6).
 *
 * FIX (Lot Content, commit 5) : getProductDetail() lit désormais aussi
 * catalog_media, product_content_profile, product_content_sections et
 * product_attributes (Lot Content, commits 1-3, migration 111). Ce fixture
 * GPM-1 date d'avant ces requêtes — sans catalog_media promu, usingCanonicalMedia
 * reste false donc product_sku_media n'est pas interrogée (voir la garde dans
 * services/catalog-product-detail.js). mockDb() complété avec les 4 réponses
 * manquantes (produit pauvre en contenu à ce stade — la richesse éditoriale
 * réelle du Golden Product est verrouillée séparément par
 * tests/integration/golden-product-content-e2e.test.js).
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/transport-rails', () => ({
  listCommercialTransportRails: jest.fn(),
}));

const { listCommercialTransportRails } = require('../../services/transport-rails');
const { getProductDetail } = require('../../services/catalog-product-detail');
const golden = require('../fixtures/catalog/golden-elite-pro');

function mockDb() {
  return {
    query: jest.fn()
      .mockResolvedValueOnce({ rows: [golden.productRow()] })
      .mockResolvedValueOnce({ rows: golden.variantRows() })
      .mockResolvedValueOnce({ rows: golden.skuRows() })
      .mockResolvedValueOnce({ rows: [] }) // catalog_media (pas de média canonique dans ce fixture historique)
      .mockResolvedValueOnce({ rows: [] }) // product_content_profile
      .mockResolvedValueOnce({ rows: [] }) // product_content_sections
      .mockResolvedValueOnce({ rows: [] }), // product_attributes
  };
}

function findUnit(detail, couleur, taille) {
  return detail.sellable_units.find(
    (u) => u.option_values.Couleur === couleur && u.option_values.Taille === taille
  );
}

describe('GPM-1 — Golden Product "Chaussure de football Elite Pro" — Product Detail Contract', () => {
  let detail;

  beforeEach(async () => {
    jest.clearAllMocks();
    listCommercialTransportRails.mockReturnValue(golden.commercialTransportRails());
    detail = await getProductDetail(mockDb(), golden.PRODUCT_ID);
  });

  test('identité, référence, catégorie et mode d’inventaire', () => {
    expect(detail.contract_version).toBe('1');
    expect(detail.inventory_model).toBe('SKU');
    expect(detail.product).toEqual({
      id: golden.PRODUCT_ID,
      reference: golden.PRODUCT_REF,
      name: 'Chaussure de football Elite Pro',
      description: expect.stringContaining('terrain synthétique'),
      category: 'sport',
      subcategory: 'chaussures-football',
    });
  });

  test('prix de base et absence de fallback prix', () => {
    expect(detail.pricing).toEqual({
      price_kmf: 42000,
      old_price_kmf: null,
      promo_pct: null,
    });
  });

  test('2 axes, 6 valeurs, vignettes couleur uniquement', () => {
    expect(detail.option_axes).toEqual([
      {
        key: 'Couleur',
        display_name: 'Couleur',
        values: [
          { value: 'Bleu', thumbnail_url: `${golden.MEDIA_BASE}/bleu-main.jpg` },
          { value: 'Noir', thumbnail_url: `${golden.MEDIA_BASE}/noir-main.jpg` },
        ],
      },
      {
        key: 'Taille',
        display_name: 'Taille',
        values: [
          { value: '42', thumbnail_url: null },
          { value: '43', thumbnail_url: null },
          { value: '44', thumbnail_url: null },
        ],
      },
    ]);
  });

  test('médias : 1 neutre + 2 Bleu + 2 Noir, exactement', () => {
    expect(detail.media).toHaveLength(5);

    const neutral = detail.media.filter((m) => Object.keys(m.option_values).length === 0);
    const bleu = detail.media.filter((m) => m.option_values.Couleur === 'Bleu');
    const noir = detail.media.filter((m) => m.option_values.Couleur === 'Noir');

    expect(neutral).toHaveLength(1);
    expect(bleu).toHaveLength(2);
    expect(noir).toHaveLength(2);
    expect(neutral[0].url).toBe(`${golden.MEDIA_BASE}/neutral-main.jpg`);
  });

  test('5 sellable units réelles sur 6 combinaisons théoriques', () => {
    expect(detail.sellable_units).toHaveLength(5);
  });

  test('Bleu + 42 → GOLD-BLU-42, disponible, 42 000 KMF, médias Bleu', () => {
    const unit = findUnit(detail, 'Bleu', '42');
    const bleuMediaIds = detail.media.filter((m) => m.option_values.Couleur === 'Bleu').map((m) => m.id);

    expect(unit).toMatchObject({
      sku: 'GOLD-BLU-42',
      stock_status: 'AVAILABLE',
      available_quantity: 8,
      price_kmf: 42000,
    });
    expect(unit.media_ids).toEqual(bleuMediaIds);
  });

  test('Bleu + 43 → GOLD-BLU-43, rupture (stock 0), 42 000 KMF', () => {
    const unit = findUnit(detail, 'Bleu', '43');
    expect(unit).toMatchObject({
      sku: 'GOLD-BLU-43',
      stock_status: 'OUT_OF_STOCK',
      available_quantity: 0,
      price_kmf: 42000,
    });
  });

  test('Bleu + 44 → GOLD-BLU-44, disponible, 45 000 KMF (palier de prix différent), médias Bleu conservés', () => {
    const unit = findUnit(detail, 'Bleu', '44');
    const bleuMediaIds = detail.media.filter((m) => m.option_values.Couleur === 'Bleu').map((m) => m.id);

    expect(unit).toMatchObject({
      sku: 'GOLD-BLU-44',
      stock_status: 'AVAILABLE',
      available_quantity: 5,
      price_kmf: 45000,
    });
    expect(unit.media_ids).toEqual(bleuMediaIds);
  });

  test('Noir + 42 → GOLD-BLK-42, disponible, 42 000 KMF', () => {
    const unit = findUnit(detail, 'Noir', '42');
    expect(unit).toMatchObject({
      sku: 'GOLD-BLK-42',
      stock_status: 'AVAILABLE',
      available_quantity: 4,
      price_kmf: 42000,
    });
  });

  test('Noir + 43 → GOLD-BLK-43, disponible, 43 000 KMF, médias Noir', () => {
    const unit = findUnit(detail, 'Noir', '43');
    const noirMediaIds = detail.media.filter((m) => m.option_values.Couleur === 'Noir').map((m) => m.id);

    expect(unit).toMatchObject({
      sku: 'GOLD-BLK-43',
      stock_status: 'AVAILABLE',
      available_quantity: 3,
      price_kmf: 43000,
    });
    expect(unit.media_ids).toEqual(noirMediaIds);
  });

  test('Noir + 44 → aucune unité vendable, aucun faux SKU de fallback', () => {
    const unit = findUnit(detail, 'Noir', '44');
    expect(unit).toBeUndefined();
    expect(
      detail.sellable_units.some(
        (u) => u.option_values.Couleur === 'Noir' && u.option_values.Taille === '44'
      )
    ).toBe(false);
  });

  test('delivery_options : uniquement les rails réellement commercialisables, aucun label ou prix inventé', () => {
    expect(detail.delivery_options).toEqual(golden.EXPECTED_DELIVERY_OPTIONS);
    // Vérifie explicitement l'écart avec la doctrine initiale du chantier :
    // pas de "Retrait relais", pas de prix ni ETA fabriqués.
    expect(detail.delivery_options).toHaveLength(1);
    expect(detail.delivery_options[0].price_kmf).toBeNull();
    expect(detail.delivery_options[0].eta_label).toBeNull();
  });

  test('le contrat complet est un objet plat conforme au schéma (contract_version "1")', () => {
    expect(Object.keys(detail).sort()).toEqual(
      [
        'contract_version',
        'inventory_model',
        'product',
        'pricing',
        'media',
        'option_axes',
        'sellable_units',
        'delivery_options',
        'content',
      ].sort()
    );
  });
});
