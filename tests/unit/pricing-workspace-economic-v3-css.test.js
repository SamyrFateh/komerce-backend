'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','css','pricing-workspace-economic-v3.css'),'utf8');

test('Atelier économique possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-pricing-decision-overview > .kmc-dashboard-header');
  expect(css).toContain('linear-gradient(112deg, #faf7ff');
  expect(css).toContain('min-height: 126px');
});
