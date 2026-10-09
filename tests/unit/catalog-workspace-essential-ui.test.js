'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const decision=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','catalog-workspace-decision.js'),'utf8');
const workspace=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','catalog-workspace.js'),'utf8');

test('Catalogue garde Hero + décisions + produits à valider uniquement dans sa synthèse',()=>{
  const start=decision.indexOf('function prependDecisionView');
  const source=decision.slice(start, decision.indexOf('function enhance', start));
  expect(source).toContain("data-dashboard-role', 'hero");
  expect(source).toContain("data-dashboard-role', 'attention");
  expect(source).toContain("data-dashboard-role', 'primary");
  expect(source).toContain("'Produits à valider'");
  expect(source).not.toContain("'État du catalogue'");
  expect(source).not.toContain("'Assortiment commercial'");
  expect(source).not.toContain("'Santé de la taxonomie'");
  expect(source).not.toContain('TrustFooter.render');
  expect(decision).toContain("href: '#catalog-curation'");
  expect(workspace).toContain("'Produits à valider'");
  expect(workspace).toContain("'Relisez, corrigez ou ajoutez les produits proposés.'");
});
