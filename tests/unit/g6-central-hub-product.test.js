'use strict';
process.env.G6_TARGET_MARKET='KM';
const fs=require('node:fs');
const {ownerStagingGuard,nextStep,SELLABLE_SQL,G6_PREFIX}=require('../../scripts/recette/g6-central-hub-product-chromium');
const ok={GITHUB_REPOSITORY:'SamyrFateh/komerce-backend',GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'o',GITHUB_REPOSITORY_OWNER:'o',
 NODE_ENV:'test',KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',EXPECTED_RAILWAY_ENVIRONMENT:'staging',
 STAGING_BASE_URL:'https://komerce-backend-production.up.railway.app',G6_TARGET_MARKET:'CM',PGOPTIONS:'-c default_transaction_read_only=on'};
describe('g6 central hub product',()=>{
 test('guard strict : propriétaire, staging, PG lecture seule',()=>{
  expect(ownerStagingGuard(ok)).toBe(true);
  expect(ownerStagingGuard({...ok,GITHUB_ACTOR:'x'})).toBe(false);
  expect(ownerStagingGuard({...ok,PGOPTIONS:''})).toBe(false);
  expect(ownerStagingGuard({...ok,G6_TARGET_MARKET:'FR'})).toBe(false);
 });
 test('idempotent : produit vendable existant = PASS sans geste',()=>{
  expect(nextStep({sellable:[{id:1}],candidate:null})).toEqual({verdict:'G6_CENTRAL_HUB_PRODUCT_ALREADY_SELLABLE_PASS',done:true});
  expect(nextStep({sellable:[{id:1},{id:2}],candidate:null}).fail).toBe(true);
 });
 test('sans produit ni candidat : import manuel ; candidat non promu : SCREEN_MISSING, sans contournement',()=>{
  expect(nextStep({sellable:[],candidate:null}).step).toBe('manual-import');
  expect(nextStep({sellable:[],candidate:{candidate_ref:'C',product_ref:null}}).verdict).toBe('SCREEN_MISSING_CANDIDATE_PROMOTE');
  expect(nextStep({sellable:[],candidate:{product_ref:'KPR-1'}}).verdict).toBe('SCREEN_MISSING_CENTRAL_PRODUCT_PRICE_EXPOSURE_DRIVER');
 });
 test('SQL en lecture seule, exige Fournisseur central, LOCAL_ACTIVE, ENABLED, marqueur G6',()=>{
  expect(SELLABLE_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  expect(SELLABLE_SQL).toMatch(/central_hub/);expect(SELLABLE_SQL).toMatch(/LOCAL_ACTIVE/);expect(SELLABLE_SQL).toMatch(/ENABLED/);
  expect(G6_PREFIX).toBe('[G6-HUB] ');
 });
 test('workflow : issue du propriétaire, 3 titres, PG lecture seule, concurrency commune',()=>{
  const w=fs.readFileSync('.github/workflows/staging-g6-central-hub-product.yml','utf8');
  for(const m of ['KM','CM','CG'])expect(w).toContain("'[staging-op] g6-central-hub-product-"+m+"'");
  expect(w).toContain('default_transaction_read_only=on');expect(w).toContain('komerce-g6-canonical-real-transaction');
  expect(w).toContain('github.actor == github.repository_owner');
 });
});
