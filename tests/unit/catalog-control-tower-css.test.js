'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','css','catalog-control-tower.css'),'utf8');

test('Catalogue possède un Hero contextuel propre',()=>{
  expect(css).toContain('.kmc-catalog-decision-overview > .kmc-dashboard-header');
  expect(css).toContain('linear-gradient(112deg, #f5fbf8');
  expect(css).toContain('min-height: 126px');
});

test('la table cbt garde une vraie cellule produit (pas de display:grid sur td)',()=>{
  expect(css).not.toMatch(/\.kmc-cbt-table td:first-child \{[^}]*display:\s*grid/);
  expect(css).toMatch(/\.kmc-cbt-table td:first-child \{[^}]*display:\s*table-cell/);
});
