'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { validateManifest, referenceAmount, PHASES } = require('../../scripts/recette/g13-catalogue-seed');
const manifest = require('../../scripts/recette/g13-catalogue-manifest.json');

describe('G13 catalogue seed (outillage de recette)', () => {
  test('le manifeste versionné respecte la cible du brief (au moins 2 produits par catégorie couverte)', () => {
    expect(validateManifest(manifest)).toEqual([]);
    const cats = new Set(manifest.entries.map((e) => e.category));
    for (const c of cats) expect(manifest.entries.filter((e) => e.category === c).length).toBeGreaterThanOrEqual(2);
    for (const e of manifest.entries) expect(e.supplier_ref).toBeTruthy();
    expect(new Set(manifest.entries.map((e) => e.category)).size).toBe(9);
    expect(manifest.entries.filter((e) => e.source === 'aliexpress').length).toBeGreaterThanOrEqual(2);
  });
  test('chaque produit épinglé a un verdict visuel par URL ou média', () => {
    const verdicts = require('../../scripts/recette/g13-visual-verdicts.json').verdicts;
    for (const e of manifest.entries) expect(Object.keys(verdicts[e.id] || {}).length).toBeGreaterThan(0);
  });
  test('refuse un manifeste incomplet', () => {
    const bad = { markets: ['KM'], entries: [{ id: 'x', category: 'A', subcategory: 'B', source: 'cj', name_fr: 'n', description_fr: 'd', keyword: 'k' }] };
    const errors = validateManifest(bad);
    expect(errors).toEqual(expect.arrayContaining(['MOINS_DE_3_FOURNISSEUR_CENTRAL', 'PRODUIT_VOLUMINEUX_ABSENT', 'PRODUIT_MULTI_SKU_ABSENT', 'STOCK_LOCAL_ABSENT:KM']));
  });
  test('refuse une taxonomie inconnue', () => {
    const tax = new Map([['Tech', new Set(['Phones'])]]);
    expect(validateManifest(manifest, tax).some((e) => e.startsWith('TAXONOMIE_INCONNUE'))).toBe(true);
  });

  test('D3 : liaison du fournisseur en brouillon AVANT approbation et jamais publication aveugle', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/recette/g13-catalogue-seed.js'), 'utf8');
    expect(PHASES.indexOf('supplier-link')).toBeLessThan(PHASES.indexOf('publish'));
    expect(source.indexOf('// --- supplier-link')).toBeLessThan(source.indexOf('// --- publish'));
    expect(source).not.toContain("blocked(r, 'supplier-link', 'PRODUIT_NON_PUBLIE')");
    expect(source).toContain("'MAPPING_NON_RESOLU_APRES_HTTP'");
    expect(source).toContain("JOIN product_skus sku ON sku.product_id = ps.product_id");
  });
  test('diagnostic économique G13 est explicitement lecture seule et sans dérogation WATCH', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/recette/g13-catalogue-seed.js'), 'utf8');
    expect(source).toContain("if (phaseSel === 'diagnose')");
    expect(source).toContain("G13_DIAGNOSTIC_MUST_BE_READ_ONLY");
    expect(source.indexOf("const execute = mode === 'execute';")).toBeLessThan(
      source.indexOf("if (phaseSel === 'diagnose')"));
    expect(source).toContain("DIAGNOSTIC_OK_NOT_G13_GO");
    expect(source).not.toContain("scan_result.sourcing_decision = 'TEST'");
  });
  test('prix de référence : arrondi supérieur du moteur, jamais inventé', () => {
    expect(referenceAmount({ selected: { economics: { coverage_reference_price_xaf: 1234.2 } } }, 'CM')).toBe(1235);
    expect(referenceAmount({ selected: { economics: { minimum_safe_price_kmf: 900 } } }, 'KM')).toBe(900);
    expect(referenceAmount({ selected: { economics: {} } }, 'CG')).toBeNull();
    expect(referenceAmount(null, 'KM')).toBeNull();
  });
});
