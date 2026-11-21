/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
jest.mock('../../scripts/recette/target-guard',()=>({confirmTarget:jest.fn()}));
process.env.G6_TARGET_MARKET='KM';
const fs=require('node:fs');
const {nextStep,CANDIDATE_SQL,canonicalMediaFile}=require('../../scripts/recette/g6-central-hub-product-chromium');
const SOURCE=fs.readFileSync('scripts/recette/g6-central-hub-product-chromium.js','utf8');
const WORKFLOW=fs.readFileSync('.github/workflows/staging-g6-central-hub-product.yml','utf8');
const candidate={candidate_ref:'KSC-1',product_ref:'KPR-1',lifecycle_status:'candidate',is_active:false,
 description:'En français',needs_review:false,boutique_category_key:'Bricolage',boutique_subcategory_key:'Outillage'};
describe('G6 preparer source Hub centrale — contrat #4920 + media canonique',()=>{
 test('le candidat est identifié par nom exact + fournisseur système, sans identité vendeur inventée',()=>{
  expect(CANDIDATE_SQL).toContain('sc.product_name=$1');
  expect(CANDIDATE_SQL).toContain("s.system_key='central_hub'");
  expect(CANDIDATE_SQL).toContain("sc.normalized_source_contract->>'source_kind'='central_hub_manual'");
  expect(CANDIDATE_SQL).toContain("ARRAY['supplier_name','supplier_product_id','sellable_units']");
  expect(CANDIDATE_SQL).not.toMatch(/WHERE sc.supplier_product_id=\$1/);
  const importBody=SOURCE.slice(SOURCE.indexOf('async function manualImport('),SOURCE.indexOf('async function openCandidate('));
  expect(importBody).not.toMatch(/supplier_product_id\s*:/);
  expect(importBody).not.toMatch(/sellable_units\s*:/);
  expect(importBody).toContain('product_name:PRODUCT_NAME');
  expect(importBody).toContain("selected==='central_hub'");
 });
 test('une image canonique manque => geste media avant approbation, pas de contournement',()=>{
  expect(nextStep({sellable:[],candidate:{...candidate,media_count:0}})).toEqual({
   step:'catalog-media',product_ref:'KPR-1'});
  expect(nextStep({sellable:[],candidate:{...candidate,media_count:1}})).toEqual({
   step:'catalog-approve',product_ref:'KPR-1'});
  expect(SOURCE).toContain("catalog-media':'admin'");
  expect(SOURCE).toContain("catalog-media':(a,s)=>catalogMedia(a,s.product_ref)");
 });
 test('l upload intervient sur l input Chromium officiel #4920 : 1 POST, jamais un URL injecté',()=>{
  expect(SOURCE).toContain("[data-catalog-media-upload-file]");
  expect(SOURCE).toContain("details[data-catalog-complementary-info] > summary");
  expect(SOURCE).toContain("await input.setInputFiles(media.file)");
  expect(SOURCE).toContain("const endpoint=CAT+'/products/'+ref+'/media'");
  expect(SOURCE).toContain("await arm(actor,'POST',endpoint)");
  expect(SOURCE).toContain("await fire(actor,'POST',endpoint");
  expect(SOURCE).not.toContain("data:image/png;base64");
 });
 test('pas de fixture approuvée + checksum absent = refus, pas de mutation sourcing',()=>{
  const oldFile=process.env.G6_CENTRAL_MEDIA_IMAGE_FILE;
  const oldSha=process.env.G6_CENTRAL_MEDIA_IMAGE_SHA256;
  try{
   delete process.env.G6_CENTRAL_MEDIA_IMAGE_FILE;
   delete process.env.G6_CENTRAL_MEDIA_IMAGE_SHA256;
   expect(canonicalMediaFile()).toBeNull();
   process.env.G6_CENTRAL_MEDIA_IMAGE_FILE='tests/fixtures/no-such-product.png';
   process.env.G6_CENTRAL_MEDIA_IMAGE_SHA256='0'.repeat(64);
   expect(canonicalMediaFile()).toBeNull();
  }finally{
   if(oldFile===undefined)delete process.env.G6_CENTRAL_MEDIA_IMAGE_FILE;
   else process.env.G6_CENTRAL_MEDIA_IMAGE_FILE=oldFile;
   if(oldSha===undefined)delete process.env.G6_CENTRAL_MEDIA_IMAGE_SHA256;
   else process.env.G6_CENTRAL_MEDIA_IMAGE_SHA256=oldSha;
  }
  expect(SOURCE).toContain("step.step==='manual-import'&&!canonicalMediaFile()");
  expect(SOURCE).toContain("PREREQ_MISSING_CANONICAL_PRODUCT_IMAGE");
  expect(SOURCE).toContain("fs.readFileSync(file)");
  expect(SOURCE).toContain("crypto.createHash('sha256')");
  expect(WORKFLOW).toContain('vars.G6_CENTRAL_MEDIA_IMAGE_FILE');
  expect(WORKFLOW).toContain('vars.G6_CENTRAL_MEDIA_IMAGE_SHA256');
 });
 test('meme run peut finir le parcours entier sans bypass en 12 etapes maximum',()=>{
  expect(SOURCE).toContain('for(let i=0;i<12&&step.step;i++)');
  expect(SOURCE).toContain('G6_CENTRAL_NO_PROGRESS_');
 });
});