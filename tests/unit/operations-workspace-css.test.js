'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','css','operations-workspace.css'),'utf8');

test('Hub / Relais possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-operations-workspace[data-workspace-kind="hub-relay"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #f4fbfa');
});


test('Expéditions & Douane possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-operations-workspace[data-workspace-kind="shipping-customs"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #f5f9ff');
});


test('Sourcing possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-operations-workspace[data-workspace-kind="sourcing"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #fffaf1');
});
