'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('node:fs');
const path = require('node:path');
const { BASE, REFS, ALL, EXPECTED_MEDIA, guard } =
  require('../../scripts/recette/p1-cj-four-chromium-readonly');
const workflow = fs.readFileSync(path.resolve(__dirname,
  '../../.github/workflows/staging-p1-cj-four-commercial-boundary-chromium.yml'),'utf8');
const source = fs.readFileSync(path.resolve(__dirname,
  '../../scripts/recette/p1-cj-four-chromium-readonly.js'),'utf8');

const ok = {
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'test-owner',
  GITHUB_REPOSITORY_OWNER:'test-owner',KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',
  EXPECTED_RAILWAY_ENVIRONMENT:'staging',STAGING_BASE_URL:BASE,NODE_ENV:'test',
  E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40)
};

test('G6 P1 matches only the three sourced TEST candidates and preserves WATCH refusal',()=>{
  expect(REFS).toEqual(['KPR-000099','KPR-000100','KPR-000101']);
  expect(ALL).toEqual(['KPR-000098',...REFS]);
});

test('real Chromium P1 is owner-only exact protected staging SHA, fails closed',()=>{
  expect(()=>guard(ok)).not.toThrow();
  expect(()=>guard({...ok,GITHUB_ACTOR:'foreign'})).toThrow();
  expect(()=>guard({...ok,KOMERCE_ENV:'production'})).toThrow();
  expect(()=>guard({...ok,KOMERCE_TARGET_ENV:'production'})).toThrow();
  expect(()=>guard({...ok,STAGING_BASE_URL:'https://komerce.co'})).toThrow();
  expect(()=>guard({...ok,E2E_EXPECTED_DEPLOY_SHA:''})).toThrow();
  expect(workflow).toContain("github.event.issue.title == '[staging-op] p1-cj-four-commercial-chromium-readonly'");
  expect(workflow).toContain('github.actor == github.repository_owner');
  expect(workflow).toContain('default_transaction_read_only=on');
  expect(workflow).toContain('resolve-staging-deploy-pin.js');
});

test('Chromium uses real pages and canonical GET contracts, with business mutation blocked',()=>{
  expect(source).toContain('chromium.launch({headless:true})');
  expect(source).toContain('viewport:{width:1440,height:900}');
  expect(source).toContain('/admin/workspaces/catalog?search=');
  expect(source).toContain('/admin/workspaces/pricing?market=KM&product_ref=');
  expect(source).toContain('/dashboards/canonical/market-catalog.html?market=KM');
  expect(source).toContain('/boutique/?market=KM');
  expect(source).toContain('/api/products?market=KM');
  expect(source).toContain("['GET','HEAD','OPTIONS'].includes(method)");
  expect(source).toContain("route.abort('blockedbyclient')");
  expect(source).not.toContain('route.fulfill(');
  expect(source).not.toMatch(/(?:db|client|pool)\.query\(/);
  expect(source).toContain('never_claims');
  expect(source).toContain("P1_KM_NOT_YET_VISIBLE");
});

test('canonical certification is read inside the same READ ONLY source audit',()=>{
  const audit=fs.readFileSync(path.resolve(__dirname,
    '../../scripts/recette/cj-four-km-commercial-readiness.js'),'utf8');
  expect(audit).toContain("await client.query('BEGIN READ ONLY')");
  expect(audit).toContain('certifyCatalogProduct(client, row.product_id)');
  expect(audit).toContain('inspectCatalogVisualFrEvidence(client, row.product_id)');
  expect(audit).toContain('allowed_to_approve_from_this_report: false');
});

test('G6 real Chromium verifies exactly 16 individual supplier images and their original source IDs',()=>{
  expect(EXPECTED_MEDIA).toEqual({
    'KPR-000099':5,'KPR-000100':5,'KPR-000101':6
  });
  expect(Object.values(EXPECTED_MEDIA).reduce((a,b)=>a+b,0)).toBe(16);
  expect(source).toContain("await complementary.locator(':scope > summary').click()");
  expect(source).toContain("await review.locator(':scope > summary').click()");
  expect(source).toContain("new URL(imageUrl,BASE).href!==canonical.url");
  expect(source).toContain('canonical?.source_media_id');
  expect(source).toContain('canonical?.media_id');
  expect(source).toContain('img.decode()');
  expect(source).toContain("SUPPLIER_PIXELS_NOT_LOADED");
  expect(source).toContain("REAL_CHROMIUM_ALL_MEDIA_INSPECTED_NO_SIGNATURE");
  expect(source).toContain('row.media_review_probe.source_image_screenshots.push(file)');
  expect(source).toContain('report.media_review_evidence_count===16');
  expect(source).toContain("CHROMIUM_MEDIA_REVIEW_UI_NOT_PROVEN");
  expect(source).toContain('if(!mediaProven)process.exitCode=2');
});

test('G6 focused UX: real browser checks sequential navigation, 3 close methods and 390px mobile',()=>{
  expect(source).toContain("'[data-catalog-review-navigation]'");
  expect(source).toContain("'[data-catalog-media-progress]'");
  expect(source).toContain("'[data-workspace-action=\"catalog-media-next\"]'");
  expect(source).toContain("'[data-workspace-action=\"catalog-media-previous\"]'");
  expect(source).toContain("await nextImage.click()");
  expect(source).toContain("await figure.waitFor({state:'visible'");
  expect(source).toContain("MEDIA_NAVIGATION_STEP_DRIFT");
  expect(source).toContain("MEDIA_DRAWER_CLOSE_BUTTON_FAILED");
  expect(source).toContain("MEDIA_DRAWER_ESCAPE_FAILED");
  expect(source).toContain("MEDIA_DRAWER_BACKDROP_FAILED");
  expect(source).toContain("await page.keyboard.press('Escape')");
  expect(source).toContain("viewport:{width:390,height:844}");
  expect(source).toContain("PASS_ONE_IMAGE_AT_A_TIME_ESCAPE");
  expect(source).toContain("report.mobile_ux?.status==='PASS_ONE_IMAGE_AT_A_TIME_ESCAPE'");
  expect(source).toContain('blocked.length>0');
});

test('review proof is human-only: Chromium rejects empty consent, never signs or posts decisions',()=>{
  expect(source).toContain("['','NONE','PRESENT','UNREADABLE']");
  expect(source).toContain("await state.inputValue()!==''");
  expect(source).toContain("locator('input[type=\"checkbox\"]').isChecked()");
  expect(source).toContain("name:'Enregistrer la revue humaine'");
  expect(source).toContain("EMPTY_REVIEW_REFUSED_NO_WRITE");
  expect(source).toContain("HUMAN_REVIEW_EMPTY_CLICK_NOT_REFUSED");
  expect(source).toContain("human_reviews_written:0");
  expect(source).not.toContain("route.fulfill(");
  expect(source).not.toMatch(/route\.continue\(\).*?\/visual-fr-review/s);
});
