'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs'); const path=require('path');
const s=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','admin','js','views','MarketsView.js'),'utf8');
test('MarketsView uses canonical Control Plane APIs',()=>{
  expect(s).toMatch(/KmcApi\.provisionMarket/);
  expect(s).toMatch(/KmcApi\.getMarketControlPlane/);
  expect(s).toMatch(/KmcApi\.setMarketLifecycle/);
  expect(s).not.toMatch(/fetch\(/);
});
