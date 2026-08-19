'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

const {
  TAXONOMY_TARGETS,
  profileFor,
  buildSlots,
  cartesianAxes,
  buildV2Contract,
  summary,
} = require('../../scripts/showcase-v2-plan');
const {
  parseArgs: parseSeedArgs,
  hydrateResumeProduct,
  resumeProductProblems,
  isResumeProductComplete,
} = require('../../scripts/showcase-v2-seed');
const { PROMPT_VERSION } = require('../../services/prompts/catalog-enrichment.prompt');
const manualConnector = require('../../services/suppliers/connectors/manual-connector');

const PRODUCT = {
  name: 'Produit test',
  source_title: 'Original supplier gift box title',
  source_description: 'Original supplier description kept verbatim for lineage.',
  description: 'Description fournisseur de test suffisamment riche.',
  price_kmf: 10000,
  stock: 9,
  image_url: 'https://res.cloudinary.com/fj7utq0g/image/upload/komerce/staging/showcase-v2/hero.jpg',
  images: [
    'https://res.cloudinary.com/fj7utq0g/image/upload/komerce/staging/showcase-v2/hero.jpg',
    'https://res.cloudinary.com/fj7utq0g/image/upload/komerce/staging/showcase-v2/scene.jpg',
  ],
  source: 'commons:123',
  source_url: 'https://commons.wikimedia.org/?curid=123',
  source_attribution: { license: 'CC BY 4.0' },
  source_locale: 'en',
};

describe('showcase-v2-plan', () => {
  test('couvre exactement 500 produits et 350 fiches riches', () => {
    expect(TAXONOMY_TARGETS.reduce((sum, row) => sum + row.count, 0)).toBe(500);
    expect(TAXONOMY_TARGETS.reduce((sum, row) => sum + row.rich, 0)).toBe(350);
    expect(summary()).toMatchObject({ products: 500, rich_products: 350 });
  });

  test('crée des références V2 uniques et couvre les 6 univers métier', () => {
    const slots = buildSlots();
    expect(new Set(slots.map((slot) => slot.product_ref)).size).toBe(500);
    expect(slots[0].product_ref).toBe('SHOWCASE-V2-0001');
    expect(slots.at(-1).product_ref).toBe('SHOWCASE-V2-0500');
    expect(new Set(slots.map((slot) => slot.category))).toEqual(new Set([
      'Mode & Beauté', 'Maison', 'Tech', 'Bricolage', 'Créations personnelles', 'Auto',
    ]));
    expect(summary().subcategories).toHaveLength(21);
  });

  test('attribue des axes métier adaptés aux principaux rayons', () => {
    expect(profileFor('Tech', 'Phones').map((axis) => axis.key)).toEqual(['Couleur', 'Stockage']);
    expect(profileFor('Auto', 'Freinage').map((axis) => axis.key)).toEqual(['Essieu']);
    expect(profileFor('Mode & Beauté', 'Beauté').map((axis) => axis.key)).toEqual(['Teinte']);
    expect(profileFor('Inconnu', 'Inconnu').map((axis) => axis.key)).toEqual(['Format']);
  });

  test('construit le produit cartésien uniquement dans le flux source de test', () => {
    expect(cartesianAxes([
      { key: 'Couleur', values: ['Noir', 'Bleu'] },
      { key: 'Taille', values: ['M', 'L'] },
    ])).toEqual([
      { Couleur: 'Noir', Taille: 'M' },
      { Couleur: 'Noir', Taille: 'L' },
      { Couleur: 'Bleu', Taille: 'M' },
      { Couleur: 'Bleu', Taille: 'L' },
    ]);
  });

  test('produit un contrat V2 riche avec SKU, stock et couture média explicites', () => {
    const slot = buildSlots()[0]; // rich + globalIndex 0 => matrice volontairement incomplète
    const contract = buildV2Contract(PRODUCT, slot);

    expect(contract.schema_version).toBe('2');
    expect(contract.supplier_name).toBe('Komerce Showcase V2');
    expect(contract.option_axes).toHaveLength(2);
    expect(contract.sellable_units).toHaveLength(5); // 2x3, dernière combinaison absente volontairement
    expect(contract.sellable_units.every((unit) => unit.supplier_sku.startsWith('SHOWCASE-V2-0001-SUP-'))).toBe(true);
    expect(contract.sellable_units.every((unit) => unit.currency === 'KMF')).toBe(true);
    expect(contract.media[1].option_values).toEqual({ Couleur: 'Noir' });
    expect(contract.raw_payload.showcase_v2.rich).toBe(true);
  });

  test('préserve la vérité source au bon niveau après passage par le connecteur manuel', () => {
    const slot = buildSlots()[0];
    const contract = buildV2Contract(PRODUCT, slot);
    expect(contract.source_title).toBe(PRODUCT.source_title);
    expect(contract.source_description).toBe(PRODUCT.source_description);

    const normalized = manualConnector.normalizeFormItem(contract, 'Komerce Showcase V2');
    expect(normalized.raw_payload.source_title).toBe(PRODUCT.source_title);
    expect(normalized.raw_payload.source_description).toBe(PRODUCT.source_description);
    expect(normalized.raw_payload.raw_payload.source).toBe(PRODUCT.source);
  });

  test('un slot simple reste honnêtement sans axes ni unités inventées', () => {
    const slot = buildSlots().find((row) => !row.rich);
    const contract = buildV2Contract(PRODUCT, slot);
    expect(contract.option_axes).toBeNull();
    expect(contract.sellable_units).toBeNull();
    expect(contract.stock_available).toBe(9);
  });
});

describe('showcase-v2 resume — économie sans faux vert', () => {
  function resumeFixture() {
    const slot = buildSlots()[0];
    const contract = buildV2Contract(PRODUCT, slot);
    const candidate = {
      id: 'candidate-1',
      supplier_product_id: slot.product_ref,
      state: 'imported_to_catalog',
      product_id: 'product-1',
      raw_payload: {
        source_title: PRODUCT.source_title,
        source_description: PRODUCT.source_description,
        source_locale: PRODUCT.source_locale,
      },
      normalized_source_contract: contract,
    };
    const row = {
      id: 'product-1',
      product_ref: slot.product_ref,
      category: slot.category,
      subcategory: slot.subcategory,
      is_active: true,
      is_available: true,
      quality_validated: true,
      lifecycle_status: 'active',
      content_source: 'ai_enriched',
      enrichment_version: PROMPT_VERSION,
      enrichment_confidence: 0.96,
      needs_review: false,
      inventory_model: 'SKU',
      name_source: PRODUCT.source_title,
      description_source: PRODUCT.source_description,
      source_locale: PRODUCT.source_locale,
      image_url: PRODUCT.image_url,
      active_skus: contract.sellable_units.length,
    };
    return { slot, contract, candidate, row };
  }

  test('le CLI direct reste fresh mais accepte explicitement resume', () => {
    expect(parseSeedArgs(['--target', '500', '--manifest', 'x.json']).mode).toBe('fresh');
    expect(parseSeedArgs(['--target', '500', '--manifest', 'x.json', '--mode', 'resume']).mode).toBe('resume');
    expect(() => parseSeedArgs(['--mode', 'cheap-but-unsafe'])).toThrow(/fresh ou resume/);
  });

  test('hydrate le manifest source depuis le contrat média déjà ingéré sans remirroring', () => {
    const { slot, candidate } = resumeFixture();
    const sourceOnly = {
      ...PRODUCT,
      product_ref: slot.product_ref,
      category: slot.category,
      subcategory: slot.subcategory,
      image_url: 'https://upload.wikimedia.org/source.jpg',
      images: ['https://upload.wikimedia.org/source.jpg'],
    };
    const hydrated = hydrateResumeProduct(sourceOnly, slot, candidate);
    expect(hydrated.image_url).toBe(PRODUCT.image_url);
    expect(hydrated.images).toEqual(PRODUCT.images);
  });

  test('un produit réellement complet est sauté sans nouvel appel Luna', () => {
    const { slot, candidate, row } = resumeFixture();
    expect(resumeProductProblems(row, slot, candidate, { mediaProvider: 'cloudinary' })).toEqual([]);
    expect(isResumeProductComplete(row, slot, candidate, { mediaProvider: 'cloudinary' })).toBe(true);
  });

  test('une version Luna obsolète ou un SKU manquant force le replay du seul produit', () => {
    const { slot, candidate, row } = resumeFixture();
    expect(resumeProductProblems({ ...row, enrichment_version: PROMPT_VERSION - 1 }, slot, candidate, { mediaProvider: 'cloudinary' }))
      .toContain('version enrichissement obsolète');
    expect(resumeProductProblems({ ...row, active_skus: row.active_skus - 1 }, slot, candidate, { mediaProvider: 'cloudinary' }))
      .toContain('SKU incomplets');
  });

  test('une source modifiée depuis le fresh interdit la reprise silencieuse', () => {
    const { slot, candidate } = resumeFixture();
    expect(() => hydrateResumeProduct({
      ...PRODUCT,
      product_ref: slot.product_ref,
      category: slot.category,
      subcategory: slot.subcategory,
      source_title: 'Supplier title changed after ingestion',
    }, slot, candidate)).toThrow(/source modifiée/);
  });
});
