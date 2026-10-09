'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const workspace=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','sourcing-workspace.js'),'utf8');
const decision=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','sourcing-workspace-decision.js'),'utf8');

test('Sourcing garde Hero + décisions puis ses vrais outils métier',()=>{
  expect(workspace).toContain("data-workspace-kind', 'sourcing");
  expect(workspace).toContain("'SOURCING'");
  expect(workspace).toContain("'Produits à qualifier'");
  expect(workspace).toContain("'Candidats à qualifier'");
  const headerStart=workspace.indexOf('function createHeader');
  const headerSource=workspace.slice(headerStart, workspace.indexOf('function createSection', headerStart));
  expect(headerSource).not.toContain('Cockpit des imports');
  expect(headerSource).not.toContain('Catalogue global');
  expect(headerSource).not.toContain('Diagnostic technique');

  const start=decision.indexOf('function renderMetricOverview');
  const renderSource=decision.slice(start, decision.indexOf('function decorateUi', start));
  expect(renderSource).toContain("'À arbitrer'");
  expect(renderSource).toContain("'Les candidats qui demandent une décision maintenant.'");
  expect(renderSource).not.toContain('SummaryCards.render');

  expect(workspace).toContain('renderCandidates(rootNode');
  expect(workspace).toContain('renderImports(rootNode');
  expect(workspace).toContain('renderPortfolio(rootNode');
  expect(workspace).toContain('renderSuppliers(rootNode');
});
