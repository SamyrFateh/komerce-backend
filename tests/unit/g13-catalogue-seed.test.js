'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { validateManifest, referenceAmount, stagingEconomicReferenceAmount, evaluateG13Census, distinctRefsWithRealImage, hubManualEvidence, PHASES } = require('../../scripts/recette/g13-catalogue-seed');
const manifest = require('../../scripts/recette/g13-catalogue-manifest.json');

describe('G13 catalogue seed (outillage de recette)', () => {

  test('Hub manuel: l\'identité d\'approvisionnement est interne et jamais un SKU CJ imposé', () => {
    const hubs = manifest.entries.filter(e => e.source === 'central_hub');
    expect(hubs).toHaveLength(3);
    for (const e of hubs) {
      const result = hubManualEvidence(e);
      expect(result.applicable).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.blockers).toContain('HUB_MEDIA_CJ_NOT_MANUAL_PROVENANCE');
      expect(result.blockers).toContain('HUB_STOCK_UNATTESTED');
    }
    const realistic = { source:'central_hub', manual_item:{
      image_url:'https://images.operator.example/torchon-reel.jpg' },
      manual_evidence: {media_origin_ref:'PHOTO-HUB-1',cost_ref:'COUT-HUB-1',
        stock_ref:'STOCK-HUB-1',customs_category:'textile-maison'} };
    expect(hubManualEvidence(realistic)).toMatchObject({passed:true,blockers:[]});
    expect(hubManualEvidence({...realistic,source:'cj'}).applicable).toBe(false);
    expect(hubManualEvidence({...realistic,manual_item:{image_url:'http://example.com'}}).passed).toBe(false);
  });
  test('G13 distingue Hub procurement_supplier_id et liens externes supplier_sku',()=>{
    const fs = require('node:fs');
    const code = fs.readFileSync(require('node:path').join(__dirname,'../../scripts/recette/g13-catalogue-seed.js'),'utf8');
    expect(code).toContain("s.id = p.procurement_supplier_id");
    expect(code).toContain("'HUB_PROCUREMENT_OWNER_PROVEN'");
    expect(code).toContain("'HUB_PROCUREMENT_OWNER_ABSENT'");
    expect(code).toContain("entry.source === 'central_hub'");
    expect(code).toContain("HUB_MANUAL_PROOFS_REQUIRED");
    expect(code).toContain("wanted.some(step => step !== 'census' && step !== 'validate')");
    expect(code.indexOf("blocked(r, 'hub-preflight'")).toBeLessThan(code.indexOf('// --- import ---'));
  });

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
  test('le replay CJ16 n’inclut jamais G13-10 aux unités inactives et n’attribue jamais GO complet', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/recette/g13-catalogue-seed.js'), 'utf8');
    const action = fs.readFileSync(path.join(__dirname, '../../.github/workflows/g13-cj16-guarded-phase-replay.yml'), 'utf8');
    expect(source).toContain("e.source==='cj' && e.id!=='G13-10'");
    expect(source).toContain("G13-10:ALL_SUPPLIER_UNITS_INACTIVE");
    expect(source).toContain("SCOPED_PHASE_PASS_NOT_G13_GO");
    expect(source).toContain("SCOPED_PARTIAL_BLOCKED");
    expect(action).toContain('G13_SCOPE: cj-ready-16');
    expect(action).toContain("github.actor == github.repository_owner");
    expect(action).toContain("PGOPTIONS: '-c default_transaction_read_only=on'");
  });
  test('prix de référence : arrondi supérieur du moteur, jamais inventé', () => {
    const observedXaf = { market: { currency: 'XAF' },
      corridor: { local: { status: 'READY', scope: 'market', authority: 'OBSERVED_REFERENCE_NOT_GATE',
        sample_count: 3, target: { observed_amount: 1234.2, currency: 'XAF' } } } };
    expect(referenceAmount(observedXaf, 'CM')).toBe(1235);
    expect(referenceAmount(observedXaf, 'CG')).toBe(1235);
    // XAF is *not* a projection or an economic field in the pricing corridor.
    expect(referenceAmount({ selected: { economics: { coverage_reference_price_xaf: 1234.2, coverage_reference_price_kmf: 1500 } } }, 'CM')).toBeNull();
    expect(referenceAmount({ corridor: { global_reference: { target: { observed_amount: 1234.2, currency: 'XAF' } } } }, 'CM')).toBeNull();
    expect(referenceAmount({ corridor: { local: { status: 'EMERGING', scope:'market', authority:'OBSERVED_REFERENCE_NOT_GATE', sample_count:1, target: { observed_amount: 1234.2, currency: 'XAF' } } } }, 'CM')).toBeNull();
    expect(referenceAmount({ corridor: { local: { status: 'READY', scope:'market', authority:'OBSERVED_REFERENCE_NOT_GATE', sample_count:3, target: { observed_amount: 1234.2, currency: 'KMF' } } } }, 'CM')).toBeNull();
    expect(referenceAmount({ selected: { economics: { minimum_safe_price_kmf: 900 } } }, 'KM')).toBe(900);
    expect(referenceAmount({ selected: { economics: {} } }, 'CG')).toBeNull();
    expect(referenceAmount(null, 'KM')).toBeNull();
  });
  test('G13 : 9x3 prix locaux et HTTP public sans collision de produits, sinon NO GO', () => {
    const cats = [...new Set(manifest.entries.map((e) => e.category))];
    const sql = cats.flatMap((category) => manifest.markets.map((market) => ({ category, market, n: 2 })));
    const http = Object.fromEntries(cats.flatMap((category) => manifest.markets.map((market) =>
      [`${category}|${market}`, { status: 200, total: 2, distinct_with_image: 2 }])));
    const green = evaluateG13Census(manifest, sql, http);
    expect(green.passed).toBe(true);
    expect(green.checked_cells).toBe(27);
    expect(green.passed_cells).toBe(27);

    // Une boutique et un marche non couverts doivent refuser le GO,
    // meme si les 26 autres cellules sont vertes.
    expect(evaluateG13Census(manifest, sql.filter((x) => !(x.category === 'Enfant' && x.market === 'CM')), http).passed).toBe(false);
    expect(evaluateG13Census(manifest, sql, { ...http, 'Maison|CG': { status: 200, total: 2, distinct_with_image: 1 } }).passed).toBe(false);
    expect(evaluateG13Census(manifest, sql, { ...http, 'Tech|KM': { status: 503, total: 2, distinct_with_image: 2 } }).passed).toBe(false);
    expect(evaluateG13Census(manifest, sql, { ...http, 'Auto|KM': { status: 200, total: null, distinct_with_image: 2 } }).passed).toBe(false);
  });

  test('G13 : une image ne compte que si l URL repond 200 avec un content-type image', async () => {
    const answers = {
      'https://x.test/uploads/ok.jpg': { status: 200, type: 'image/jpeg' },
      'https://x.test/uploads/gone.jpg': { status: 200, type: 'text/html; charset=utf-8' },
      'https://cdn.test/a.jpg': { status: 200, type: 'image/jpg' },
      'https://cdn.test/404.jpg': { status: 404, type: 'image/jpeg' },
    };
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (url.includes('boom')) throw new Error('network');
      const a = answers[url];
      return { status: a.status, headers: { get: () => a.type } };
    };
    const products = [
      { product_ref: 'A', image_url: '/uploads/ok.jpg' },
      { product_ref: 'B', image_url: '/uploads/gone.jpg' },
      { product_ref: 'C', image_url: 'https://cdn.test/a.jpg' },
      { product_ref: 'D', image_url: 'https://cdn.test/404.jpg' },
      { product_ref: 'E', image_url: 'https://cdn.test/boom.jpg' },
      { product_ref: 'F' },
      { product_ref: 'A', image_url: '/uploads/ok.jpg' },
    ];
    const cache = new Map();
    const refs = await distinctRefsWithRealImage(products, 'https://x.test/', cache, fetchFn);
    expect([...refs].sort()).toEqual(['A', 'C']);
    expect(calls.filter((u) => u.endsWith('/ok.jpg'))).toHaveLength(1);
  });

  test('G13 staging only : projection locale via Currency Boundary, sans prix concurrent inventé', async () => {
    const economic = {
      market: { currency: 'XAF' },
      selected: { economics: { variable_cost_complete_kmf: 8000,
        minimum_safe_price_kmf: 10000, coverage_reference_price_kmf: 12000, strategy_risk: 'covered' } },
      corridor: { local: { status: 'LOCAL_EVIDENCE_MISSING', sample_count: 0 } },
    };
    const converter = jest.fn(async (amount, from, to) => {
      expect([from, to]).toEqual(['KMF', 'XAF']);
      return 15618.8;
    });
    expect(await stagingEconomicReferenceAmount(economic, 'CM', converter)).toBe(15619);
    expect(await stagingEconomicReferenceAmount(economic, 'CG', converter)).toBe(15619);
    expect(converter).toHaveBeenCalledWith(12000, 'KMF', 'XAF');
    expect(referenceAmount(economic, 'CM')).toBeNull(); // production contract unchanged
    expect(await stagingEconomicReferenceAmount({ selected:{ economics:{ coverage_reference_price_kmf:12000 } } }, 'CM', converter)).toBeNull();
    expect(await stagingEconomicReferenceAmount({ selected:{ economics:{ variable_cost_complete_kmf:15000, coverage_reference_price_kmf:12000 } } }, 'CM', converter)).toBeNull();
    expect(await stagingEconomicReferenceAmount({ selected:{ economics:{ variable_cost_complete_kmf:8000, coverage_reference_price_kmf:12000, strategy_risk:'destructive' } } }, 'CM', converter)).toBeNull();
  });

  test('G13 price trial is owner-only, price-only and remains outside GO', () => {
    const fs = require('node:fs');
    const code = fs.readFileSync(require('node:path').join(__dirname,'../../scripts/recette/g13-catalogue-seed.js'),'utf8');
    expect(code).toContain("priceTrial && !(execute && phaseSel==='price'");
    expect(code).toContain("G13_MARKET_PRICE_TRIAL_GUARD_REFUSED");
    expect(code).toContain("e.source!=='central_hub' && e.id!=='G13-10'");
    expect(code).toContain('MARKET_TEST_PRICES_APPLIED_NOT_G13_GO');
    expect(code).toContain('COST_REFERENCE_STAGING_TEST_NOT_COMPETITOR_OBSERVATION');
  });

});
