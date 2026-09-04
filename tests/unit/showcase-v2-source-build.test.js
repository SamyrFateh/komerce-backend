'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { TAXONOMY_TARGETS, buildSlots } = require('../../scripts/showcase-v2-plan');
const {
  FIXTURE_TYPES,
  segmentKey,
  parseArgs,
  fixtureProductForSlot,
  buildCatalogue,
  fixtureSummary,
} = require('../../scripts/showcase-v2-source-build');

describe('showcase-v2 deterministic supplier fixtures', () => {
  test('chaque sous-catégorie du plan possède une banque produit propre', () => {
    for (const target of TAXONOMY_TARGETS) {
      const bank = FIXTURE_TYPES[segmentKey(target)];
      expect(Array.isArray(bank)).toBe(true);
      expect(bank.length).toBeGreaterThanOrEqual(5);
      for (const name of bank) expect(name.length).toBeGreaterThanOrEqual(8);
    }
  });

  test('construit exactement 500 fixtures, dont 350 riches, sur 21 sous-catégories', () => {
    const products = buildCatalogue();
    expect(fixtureSummary(products)).toEqual({
      products: 500,
      rich: 350,
      categories: 6,
      subcategories: 21,
      unique_sources: 500,
      unique_heroes: 500,
    });
  });

  test('respecte exactement les quotas du plan', () => {
    const products = buildCatalogue();
    for (const target of TAXONOMY_TARGETS) {
      const count = products.filter(
        (row) => row.category === target.category && row.subcategory === target.subcategory
      ).length;
      expect(count).toBe(target.count);
    }
  });

  test('les données ressemblent à un flux fournisseur marchand français', () => {
    for (const product of buildCatalogue()) {
      expect(product.source).toMatch(/^fixture:SHOWCASE-V2-\d{4}$/);
      expect(product.source_locale).toBe('fr');
      expect(product.source_title).toBeTruthy();
      expect(product.source_description).toContain('Gamme ');
      expect(product.source_description).toContain(`catégorie ${product.category} / ${product.subcategory}`);
      expect(product.source_description).not.toMatch(/Commercial supplier catalogue item|Supplier commercial line|Sellable physical product/i);
      expect(product.source_description).not.toMatch(/Paul Klee|Hirohito|museum collection|work of art/i);
      expect(product.source_url).toMatch(/^https:\/\/fixtures\.komerce\.test\/products\//);
      expect(product.image_url).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(product.images).toEqual([product.image_url]);
    }
  });

  test('régression run 58 : la banque Cuisine ne génère plus le couteau exclu', () => {
    const kitchen = buildCatalogue().filter(
      (product) => product.category === 'Maison' && product.subcategory === 'Cuisine'
    );
    expect(kitchen).toHaveLength(25);
    expect(kitchen.some((product) => /\bcouteau\b/i.test(product.source_title))).toBe(false);
    expect(kitchen.filter((product) => /\bménagère\b/i.test(product.source_title))).toHaveLength(5);
  });

  test('régression run 59 : les gammes ne portent plus de suffixe numérique ambigu', () => {
    const products = buildCatalogue();
    expect(products.some((product) => /—\s+[\p{L}-]+\s+\d+\s*$/u.test(product.source_title))).toBe(false);

    const product70 = products.find((product) => product.product_ref === 'SHOWCASE-V2-0070');
    expect(product70).toBeDefined();
    expect(product70.source_title).toBe('Ensemble uniforme scolaire enfant — Essentiel');
    expect(product70.source_description).toContain('Gamme Essentiel');
    expect(product70.source_locale).toBe('fr');
  });

  test('régression run 60 : les identités produit vagues sont remplacées par des objets marchands concrets', () => {
    const products = buildCatalogue();
    const product419 = products.find((product) => product.product_ref === 'SHOWCASE-V2-0419');
    const product420 = products.find((product) => product.product_ref === 'SHOWCASE-V2-0420');

    expect(product419).toBeDefined();
    expect(product419.source_title).toBe('Cadre photo décoratif en bois — Compact');
    expect(product420).toBeDefined();
    expect(product420.source_title).toBe('Sac cadeau en tissu — Compact');

    for (const product of products) {
      expect(product.source_title).not.toMatch(/\bobjet cadeau décoratif\b|\bboîte cadeau générique\b|\btéléphone mobile générique\b|\blampe automobile\b|\bkit filtre automobile\b/i);
    }
  });

  test('le générateur est déterministe', () => {
    expect(buildCatalogue()).toEqual(buildCatalogue());
  });

  test('une fixture garde une identité produit explicite en français et la taxonomie du slot', () => {
    const slot = buildSlots()[6];
    const product = fixtureProductForSlot(slot);
    expect(product.product_ref).toBe('SHOWCASE-V2-0007');
    expect(product.category).toBe(slot.category);
    expect(product.subcategory).toBe(slot.subcategory);
    expect(product.source_locale).toBe('fr');
    expect(product.source_title).toMatch(/robe|blouse|jupe|sac à main|veste/i);
    expect(product.showcase_v2).toMatchObject({ fixture: true, rich: slot.rich });
  });

  test('le builder reste réservé à la campagne exacte de 500 produits', () => {
    expect(parseArgs(['--target', '500']).target).toBe(500);
    expect(() => parseArgs(['--target', '499'])).toThrow(/exactement 500/);
    expect(() => parseArgs(['--unknown'])).toThrow(/Argument inconnu/);
  });
});
