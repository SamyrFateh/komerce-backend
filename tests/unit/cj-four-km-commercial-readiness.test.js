'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {assertStaging,assessProduct,expectedDatabasePin,cohortIdentitiesMatch,EXPECTED,QUERY} = require('../../scripts/recette/cj-four-km-commercial-readiness');
const mk = (override={})=>({
  candidate_ref:'KSC-000256',supplier_product_id:'4978336F-15C5-476B-BFE8-C907659B70BB',
  state:'imported_to_catalog',product_id:'x',
  product:{product_ref:'KPR-000098',name:'Key box',description:'Storage',
    is_active:false,is_available:false,lifecycle_status:'candidate',price_kmf:null,
    source_locale:'en',needs_review:true,cost_kmf:1000,weight_kg:0.3},
  normalized_source_contract:{sellable_units:[{stock_available:5}]},
  scan_result:{sourcing_decision:'WATCH',customs_review:{status:'REQUIRED'}},
  skus:[{supplier_sku:'abc',supplier_unit_ref:'ref',source:'SUPPLIER'}],
  media:[{url:'https://example.test/a.jpg',is_active:true}],price_drafts:0,exposure_count:0,
  ...override
});
test('real draft stays blocked for commercial decision, never called sellable',()=>{
  const r=assessProduct(mk());
  expect(r.hard_blockers).toEqual([]);
  expect(r.human_or_economic_decisions).toContain('SOURCE_WATCH_NOT_CERTIFIED_FOR_SALE');
  expect(r.human_or_economic_decisions).toContain('CUSTOMS_REVIEW_REQUIRED');
  expect(r.human_or_economic_decisions).toContain('KM_MARKET_PRICE_DECISION_MISSING');
  expect(r.safe_to_sell).toBe(false);
});
test('English CJ supplier provenance stays en after independently signed French curation',()=>{
  const base=mk();
  const row=mk({
    candidate_ref:'KSC-000257',
    supplier_product_id:'1396999123722440704',
    signed_french_overrides:2,
    product:{...base.product,product_ref:'KPR-000099',source_locale:'en',
      content_source:'manual',name:'Chemise femme verte',
      description:'Chemise femme avec taille et composition précisées',needs_review:false},
    scan_result:{sourcing_decision:'TEST'},
  });
  const result=assessProduct(row);
  expect(result.source_locale).toBe('en'); // provenance preserved, not buyer language
  expect(result.french_editorial_verified).toBe(true);
  expect(result.needs_editorial_review).toBe(false);
  expect(result.signed_french_overrides).toBe(2);
  expect(result.human_or_economic_decisions).not.toContain('FRENCH_EDITORIAL_REVIEW_REQUIRED');
  expect(result.human_or_economic_decisions).toContain('KM_MARKET_PRICE_DECISION_MISSING');
  expect(result.safe_to_sell).toBe(false);
});
test('English source with unsanctioned, incomplete or unsigned French content remains blocked',()=>{
  const draft={...mk().product,source_locale:'en',content_source:'manual',needs_review:false};
  for (const [count,contentSource,needsReview] of [
    [0,'manual',false],[1,'manual',false],[2,'supplier',false],[2,'manual',true]
  ]) {
    const row=mk({product:{...draft,content_source:contentSource,needs_review:needsReview},
      signed_french_overrides:count});
    const result=assessProduct(row);
    expect(result.french_editorial_verified).toBe(false);
    expect(result.human_or_economic_decisions).toContain('FRENCH_EDITORIAL_REVIEW_REQUIRED');
  }
});
test('native French source is not forced into an artificial English-to-French rewrite',()=>{
  const row=mk({product:{...mk().product,source_locale:'fr',needs_review:false}});
  const result=assessProduct(row);
  expect(result.french_editorial_verified).toBe(true);
  expect(result.safe_to_sell).toBe(false);
});
test('altered source supplier identity fails closed',()=>{
  expect(assessProduct(mk({supplier_product_id:'different'})).hard_blockers)
    .toContain('SOURCE_PRODUCT_IDENTITY_DRIFT');
});
test('unapproved live activation and price fails closed',()=>{
  expect(assessProduct(mk({product:{...mk().product,is_active:true,price_kmf:5000}})).hard_blockers)
    .toContain('UNEXPECTED_PREMATURE_ACTIVATION_OR_PRICE');
});
test('missing supplier unit identity fails closed',()=>{
  expect(assessProduct(mk({skus:[{supplier_sku:'abc',source:'SUPPLIER'}]})).hard_blockers)
    .toContain('SUPPLIER_ORDER_IDENTITY_UNPROVEN');
});
test('foreign or unpinned target rejected',()=>{
  const good={GITHUB_ACTIONS:'true',KOMERCE_ENV:'staging',NODE_ENV:'test',
    CJ_FOUR_COMMERCIAL_AUDIT_APPROVED:'1',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
    STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',
    DATABASE_URL:'postgres://user:password@host:1234/railway',
    KOMERCE_STAGING_RESET_DB_PIN:'host:1234/railway'};
  expect(()=>assertStaging(good)).not.toThrow();
  expect(()=>assertStaging({...good,KOMERCE_ENV:'production'})).toThrow();
  expect(()=>assertStaging({...good,KOMERCE_STAGING_RESET_DB_PIN:'another:111/db'})).toThrow();
  expect(expectedDatabasePin(good.DATABASE_URL)).toBe(good.KOMERCE_STAGING_RESET_DB_PIN);
});
test('SQL audit contains no writes',()=>{
  expect(QUERY).toMatch(/FROM import_runtime_runs/);
  expect(QUERY).toContain('FROM catalog_field_overrides o');
  expect(QUERY).toContain('count(DISTINCT o.field_name)::int');
  expect(QUERY).toContain('o.set_by IS NOT NULL');
  expect(QUERY).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE)\b/i);
});

test('G5 audit isolates KIR-000014 four identities from unrelated staging fixture products',()=>{
  const rows=[...EXPECTED.keys()].map(candidate_ref=>({candidate_ref}));
  expect(cohortIdentitiesMatch(rows)).toBe(true); // other 68 staging products are outside QUERY run_ref scope
  expect(cohortIdentitiesMatch(rows.slice(1))).toBe(false);
  expect(cohortIdentitiesMatch([...rows,rows[0]])).toBe(false);
  expect(cohortIdentitiesMatch([...rows.slice(0,3),{candidate_ref:'KSC-UNRELATED'}])).toBe(false);
  const source=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../scripts/recette/cj-four-km-commercial-readiness.js'),'utf8');
  expect(source).not.toContain('report.total_products !== EXPECTED.size');
  expect(source).toContain('cohortIdentitiesMatch(rows)');
});
