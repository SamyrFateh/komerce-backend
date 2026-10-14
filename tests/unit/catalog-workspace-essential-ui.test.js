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

test('Raffinerie et Catalogue gardent des identités de Hero distinctes',()=>{
  const start=decision.indexOf('function prependDecisionView');
  const source=decision.slice(start, decision.indexOf('function enhance', start));
  expect(source).toContain("data-dashboard-role', 'hero");
  expect(source).toContain("data-dashboard-role', 'attention");
  expect(source).toContain("data-dashboard-role', 'primary");
  expect(source).toContain("refinery ? 'Produits à finaliser' : 'Catalogue commercial'");
  expect(source).toContain("refinery ? 'RAFFINERIE' : 'CATALOGUE'");
  expect(source).toContain("data-dashboard-id', refinery ? 'refinery' : 'catalog'");
  expect(decision).toContain("new URLSearchParams(search).get('view') === 'refinery'");
  expect(source).not.toContain("'État du catalogue'");
  expect(source).not.toContain("'Assortiment commercial'");
  expect(source).not.toContain("'Santé de la taxonomie'");
  expect(source).not.toContain('TrustFooter.render');
  expect(decision).toContain("href: '#catalog-curation'");
  expect(workspace).toContain("'Produits à finaliser'");
  expect(workspace).toContain("'Préparez les fiches, définissez les prix et validez les produits proposés.'");
});
