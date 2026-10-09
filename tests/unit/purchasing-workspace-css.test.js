'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','css','purchasing-workspace.css'),'utf8');

test('Achats fournisseurs possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-purchasing-workspace[data-workspace-kind="purchasing"] > .kmc-workspace-header');
  expect(css).toContain('linear-gradient(112deg, #faf7ff');
});
