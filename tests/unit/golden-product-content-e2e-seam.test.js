'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * LOT CONTENT — commit 5 : preuve bout-en-bout du Golden Product enrichi.
 *
 * Ce test ferme la boucle promise par la doctrine du chantier (§ FINISH LINE) :
 *
 *   contentContract() (fixture, forme normalized_source_contract V2)
 *     → services/catalog-promotion/content.js (mêmes mappers PURS que la
 *       vraie promotion, commit 3 : mapContentToProfileRow /
 *       mapContentToSectionRows / mapContentToAttributeRows)
 *     → lignes canoniques (mêmes formes que product_content_profile /
 *       product_content_sections / product_attributes après upsert réel,
 *       migration 111)
 *     → services/catalog-product-detail.js::getProductDetail (VRAI service,
 *       commit 1-2, DB mockée) → contrat public product_detail_v1 validé
 *       AJV en interne (assertContract)
 *
 * Ce test NE remplace PAS :
 *   - tests/unit/catalog-promotion-content.test.js (mapping pur, cas limites) ;
 *   - tests/unit/catalog-promotion-content-db.test.js (séquence SQL réelle,
 *     idempotence de l'upsert au niveau requête) ;
 *   - tests/unit/golden-product-gpm1.test.js (verrouillage SKU/prix/stock) ;
 * il prouve la COUTURE entre ces trois couches sur un produit réellement riche,
 * ce qu'aucun des tests ci-dessus ne fait isolément.
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/transport-rails', () => ({
  listCommercialTransportRails: jest.fn(),
}));

const db = require('../../db');
const { listCommercialTransportRails } = require('../../services/transport-rails');
const { getProductDetail } = require('../../services/catalog-product-detail');
const {
  mapContentToProfileRow,
  mapContentToSectionRows,
  mapContentToAttributeRows,
} = require('../../services/catalog-promotion/content');
const golden = require('../fixtures/catalog/golden-elite-pro');

/**
 * Construit les lignes canoniques exactement comme la lecture DB les
 * renverrait après une promotion réelle : les mappers purs produisent déjà
 * les colonnes lues par getProductDetail (content_json pour les sections,
 * kind/group_key/attribute_key/label/value_text/unit pour les attributs,
 * brand/short_description/source/enrichment_version/reviewed pour le
 * profil) — aucune transformation supplémentaire n'est légitime ici.
 */
function promotedRowsFromContract() {
  const contract = golden.contentContract();
  return {
    profileRow: mapContentToProfileRow(contract),
    sectionRows: mapContentToSectionRows(contract),
    attributeRows: mapContentToAttributeRows(contract),
  };
}

function mockDbRich() {
  const { profileRow, sectionRows, attributeRows } = promotedRowsFromContract();
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM products')) return { rows: [golden.productRow()] };
      if (sql.includes('FROM product_variants')) return { rows: golden.variantRows() };
      if (sql.includes('FROM product_skus')) return { rows: golden.skuRows() };
      if (sql.includes('FROM catalog_media')) return { rows: golden.catalogMediaRows() };
      if (sql.includes('FROM product_sku_media')) return { rows: golden.skuMediaRows() };
      if (sql.includes('FROM product_content_profile')) return { rows: [profileRow] };
      if (sql.includes('FROM product_content_sections')) return { rows: sectionRows };
      if (sql.includes('FROM product_attributes')) return { rows: attributeRows };
      throw new Error(`Requête SQL inattendue dans mockDbRich: ${sql}`);
    }),
  };
}

function mockDbPoor() {
  const poorProduct = {
    ...golden.productRow(),
    id: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb0001',
    product_ref: 'POOR-1',
    has_variants: false,
    inventory_model: 'LEGACY_VARIANTS',
  };
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM products')) return { rows: [poorProduct] };
      if (
        sql.includes('FROM product_variants')
        || sql.includes('FROM catalog_media')
        || sql.includes('FROM product_content_profile')
        || sql.includes('FROM product_content_sections')
        || sql.includes('FROM product_attributes')
      ) return { rows: [] };
      throw new Error(`Requête SQL inattendue dans mockDbPoor: ${sql}`);
    }),
  };
}

describe('Lot Content — preuve E2E Golden Product enrichi (commit 5)', () => {
  let detail;

  beforeEach(async () => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
    listCommercialTransportRails.mockReturnValue(golden.commercialTransportRails());
    detail = await getProductDetail(mockDbRich(), golden.PRODUCT_ID);
  });

  test('le contrat est retourné sans lever — assertContract (AJV, additionalProperties:false) valide déjà content réel', () => {
    expect(detail).toBeTruthy();
    expect(detail.contract_version).toBe('1');
  });

  test('richesse éditoriale minimale exigée par la doctrine pilote', () => {
    expect(detail.content.brand).toBe('Elite Pro');
    expect(detail.content.short_description).toEqual(expect.any(String));
    expect(detail.content.highlights.length).toBeGreaterThanOrEqual(4);
    expect(detail.content.specifications.length).toBeGreaterThanOrEqual(6);
    expect(new Set(detail.content.specifications.map((s) => s.group)).size).toBeGreaterThanOrEqual(2);
    expect(detail.content.materials.length).toBeGreaterThanOrEqual(1);
    expect(detail.content.care.length).toBeGreaterThanOrEqual(1);
    expect(detail.content.warnings.length).toBeGreaterThanOrEqual(1);
  });

  test('au moins une section éditoriale KEY_VALUE (guide des tailles), rendue textContent-safe', () => {
    const sizeGuide = detail.content.sections.find((s) => s.key === 'size-guide');
    expect(sizeGuide).toBeTruthy();
    expect(sizeGuide.type).toBe('KEY_VALUE');
    expect(sizeGuide.entries).toEqual([
      { label: '42', value: 'EU 42 / UK 8' },
      { label: '43', value: 'EU 43 / UK 9' },
      { label: '44', value: 'EU 44 / UK 9.5' },
    ]);
  });

  test('provenance explicite, jamais silencieuse', () => {
    expect(detail.content.provenance).toEqual({
      source: 'SUPPLIER',
      enrichment_version: null,
      reviewed: false,
    });
  });

  test('médias canoniques : rôles PRODUCT/SCENE/DETAIL/SIZE_GUIDE tous représentés, jamais reconvertis en PRODUCT par défaut', () => {
    const roles = new Set(detail.media.map((m) => m.role));
    expect(roles).toEqual(new Set(['PRODUCT', 'SCENE', 'DETAIL', 'SIZE_GUIDE']));
    expect(detail.media.find((m) => m.role === 'SIZE_GUIDE').option_values).toEqual({});
  });

  test('association SKU↔média explicite gagne toujours sur le matching heuristique par couleur (jamais un mélange)', () => {
    const bleu44 = detail.sellable_units.find(
      (u) => u.option_values.Couleur === 'Bleu' && u.option_values.Taille === '44'
    );
    // Bleu-44 a une association explicite product_sku_media → uniquement le
    // média explicite, jamais les médias Bleu dérivés par heuristique couleur.
    expect(bleu44.media_ids).toEqual([golden.MEDIA_IDS.bleuDetail]);

    const bleu42 = detail.sellable_units.find(
      (u) => u.option_values.Couleur === 'Bleu' && u.option_values.Taille === '42'
    );
    // Bleu-42 n'a aucune association explicite → matching heuristique par
    // couleur (les médias PRODUCT/SCENE/DETAIL portant option_values.Couleur=Bleu).
    expect(bleu42.media_ids).toEqual(
      expect.arrayContaining([golden.MEDIA_IDS.bleuProduct, golden.MEDIA_IDS.bleuScene, golden.MEDIA_IDS.bleuDetail])
    );
  });

  test('stock, prix multi-paliers et livraison restent corrects malgré la richesse éditoriale (aucune régression croisée)', () => {
    expect(detail.sellable_units.some((u) => u.stock_status === 'OUT_OF_STOCK')).toBe(true);
    const prices = new Set(detail.sellable_units.map((u) => u.price_kmf));
    expect(prices.size).toBeGreaterThanOrEqual(2);
    expect(detail.delivery_options.length).toBeGreaterThanOrEqual(1);
  });

  test('mapping idempotent : reprojeter deux fois le même contrat produit des lignes strictement identiques', () => {
    const first = promotedRowsFromContract();
    const second = promotedRowsFromContract();
    expect(second).toEqual(first);
  });

  test('produit pauvre (aucune ligne content) : content reste présent et valide, collections vides, jamais de coquille inventée', async () => {
    const poorDetail = await getProductDetail(mockDbPoor(), 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbb0001');
    expect(poorDetail.content).toEqual({
      brand: null,
      short_description: null,
      highlights: [],
      specifications: [],
      sections: [],
      materials: [],
      care: [],
      warnings: [],
      provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
    });
  });
});
