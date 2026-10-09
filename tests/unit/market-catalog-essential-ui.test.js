'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..','..');

test('Catalogue pays possède un Hero contextuel avec sélecteur intégré',()=>{
  const css=fs.readFileSync(path.join(ROOT,'public','dashboards','canonical','css','market-catalog-essential.css'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'public','dashboards','canonical','market-catalog.html'),'utf8');
  expect(css).toContain('#market-catalog-root[data-workspace-kind="market-catalog"] > .kmc-workspace-header');
  expect(css).toContain('.kmc-market-catalog-hero-controls');
  expect(css).toContain('linear-gradient(112deg, #fbf8ff');
  expect(html).toContain('/dashboards/canonical/css/market-catalog-essential.css');
});
