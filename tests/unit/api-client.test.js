'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs'); const path=require('path');
const s=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','admin','js','api-client.js'),'utf8');
test('admin api client exposes Market Control Plane calls',()=>{
  expect(s).toMatch(/function getMarkets/);
  expect(s).toMatch(/function provisionMarket/);
  expect(s).toMatch(/function setMarketLifecycle/);
});
test('admin api client n’expose plus les appels Settings Legacy (L9)',()=>{
  expect(s).not.toMatch(/function getSettings\b/);
  expect(s).not.toMatch(/function putSettingsTaxes/);
});
