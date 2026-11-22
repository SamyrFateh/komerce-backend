/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(ROOT,'scripts/recette/g6-n34b-continuation-chromium.js'),'utf8');
const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/staging-g6-n34b-continuation.yml'),'utf8');
describe('N34b continuation — no second import, explicit operator family, PG supplier lineage',()=>{
 test('must reference the real, already imported unique supplier fixture',()=>{
  expect(source).toContain("REF='KSC-000828'");
  expect(source).toContain("SOURCE_REF='G6-N34B-45021746722-A1'");
  expect(source).toContain("SUPPLIER='00f5609d-9bb0-4559-b688-8dc28db2f5ae'");
  expect(source).toContain("WHERE candidate_ref=$1 AND supplier_product_id=$2 AND supplier_id=$3");
  expect(source).toContain('EXISTING_CANDIDATE_NOT_UNIQUE');
  expect(source).toContain('Coffret de tournevis');
  expect(source).toContain('Bricolage > Outillage');
  expect(source).not.toContain("submit-manual-import");
  expect(source).not.toMatch(/(?:page|actor\.page)\.request\.(?:post|put|patch|delete)\(/);
 });
 test('category is selected from the actual UI, not imagined as engine prediction',()=>{
  expect(source).toContain("FAMILY='materiels'");
  expect(source).toContain("data-catalog-economic-category-choice");
  expect(source).toContain("Petits Materiels");
  expect(source).toContain("humanSelect(null,select,applicable[0].value)");
  expect(source).toContain('auto_suggested:false');
  expect(source).toContain("b?.category_key===FAMILY");
  expect(source).toContain("after.komerce_category===FAMILY");
  expect(source).toContain('BOUTIQUE_OUTILLAGE_NOT_OFFERED');
  // Catalogue already calls loadBoutiqueProposal() on inspector open, then hides Recharger.
  const boutique=source.slice(source.indexOf('async function boutiqueCategory('),source.indexOf('async function promote('));
  expect(boutique).toContain('const select=panel.locator');
  expect(boutique).toContain("if(!await visible(select,12000))");
  expect(boutique.indexOf("if(!await visible(select,12000))")).toBeLessThan(boutique.indexOf("await humanClick(null,refresh)"));
  expect(boutique).not.toContain('await humanClick(null,open)');
  // Server stores subcategory key Outillage; UI labels it Outils & Fixation.
  expect(boutique).toContain('Outils & Fixation');
  expect(boutique).toContain("b?.category==='Bricolage'&&b?.subcategory==='Outillage'");
  expect(boutique).toContain("candidate-apply-boutique-suggestion");
  expect(boutique).toContain("check(await select.inputValue()===choose.value");
  expect(boutique).toContain("await humanClick(null,apply)");
  expect(boutique).toContain("choose.label.startsWith('Proposé · ')");

  expect(source).toContain('if(!cand.product_id){');
  expect(source.indexOf('await boutiqueCategory(actor)')).toBeLessThan(source.indexOf('await promote(actor)'));
  expect(source).toContain("b?.category==='Bricolage'&&b?.subcategory==='Outillage'");
 });
 test('canonical supplier identity and economic side effects remain independently checked',()=>{
  expect(source).toContain("centralHubIdentity(db)");
  expect(source).toContain("explicitSupplierProvenance(db,");
  expect(source).toContain("expectedSupplierId:SUPPLIER");
  expect(source).toContain("FICTITIOUS_HUB_DEBT_OR_PO");
  expect(source).toContain("scenario_bound:false");
  expect(source).toContain('N34B_REAL_SOURCE_DRAFT_CHROMIUM_PG_PASS_NOT_FULL');
  expect(source).not.toMatch(/db\.query\(\s*['`"]\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
 });
 test('owner-only staging and shared single-writer lock, exact SHA',()=>{
  expect(workflow).toContain("github.actor == github.repository_owner");
  expect(workflow).toContain("group: komerce-g6-canonical-real-transaction");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("node scripts/recette/target-guard.js");
  expect(workflow).toContain("E2E_EXPECTED_DEPLOY_SHA");
  expect(workflow).toContain("node scripts/recette/g6-n34b-continuation-chromium.js");
  expect(source).toContain("check(h.ok===true,'HEALTH_UNAVAILABLE')");
 });
});
