/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * The Playwright calibration must agree with the actual mobile nav markup.
 * Never mark a removed 'group' tab as a runtime navigation defect.
 */
'use strict';
const fs=require('fs');
const path=require('path');
const {EXPECTED_MOBILE_TABS}=require('../e2e/helpers/mobile-nav-contract');

const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const nav=html.match(/<nav class="k-bnav" id="k-bnav">([\s\S]*?)<\/nav>/);

test('canonical mobile footer has the exact tabs expected by Playwright',()=>{
  expect(nav).toBeTruthy();
  const actual=[...nav[1].matchAll(/<button class="k-bnav-item[^"]*" data-tab="([^"]+)"/g)]
    .map(match=>match[1]);
  expect(actual).toEqual([...EXPECTED_MOBILE_TABS]);
  expect(actual).not.toContain('group');
  expect(actual).toContain('shares');
  expect(actual).toContain('komerce');
});

test('calibration uses the same canonical mobile navigation contract',()=>{
  const calibration=fs.readFileSync(
    path.join(__dirname,'../e2e/calibration.spec.js'),'utf8'
  );
  expect(calibration).toMatch(/require\('\.\/helpers\/mobile-nav-contract'\)/);
  expect(calibration).toMatch(/expect\(tabs\)\.toEqual\(\[\.\.\.EXPECTED_MOBILE_TABS\]\)/);
  expect(calibration).not.toMatch(/expect\(tabs\)\.toContain\('group'\)/);
});

test('empty catalog must remain an explicit E2E failure, not a skipped test',()=>{
  const helper=fs.readFileSync(
    path.join(__dirname,'../e2e/helpers/boutique.helpers.js'),'utf8'
  );
  expect(helper).toContain('CATALOG_NO_SELLABLE_PRODUCTS');
  expect(helper).toContain('CATALOG_LOAD_FAILED');
  expect(helper).toContain("if (state !== 'PRODUCTS_READY')");
  expect(helper).not.toMatch(/test\.skip.*CATALOG_NO_SELLABLE_PRODUCTS/);
});
