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
  expect(workspace).toContain("'Acquisition fournisseurs'");
  expect(workspace).toContain('function renderCandidates(');
  const headerStart=workspace.indexOf('function createHeader');
  const headerSource=workspace.slice(headerStart, workspace.indexOf('function createSection', headerStart));
  expect(headerSource).not.toContain('Cockpit des imports');
  expect(headerSource).not.toContain('Catalogue global');
  expect(headerSource).not.toContain('Diagnostic technique');

  const start=decision.indexOf('function renderMetricOverview');
  const renderSource=decision.slice(start, decision.indexOf('function decorateUi', start));
  expect(fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','import-runtime.js'),'utf8')).toContain("tab('sources', 'Sources'");
  expect(decision).toContain('No artificial source decisions from scanned/WATCH totals');
  expect(renderSource).not.toContain('SummaryCards.render');

  expect(workspace).toContain('renderCandidates(rootNode');
  expect(workspace).toContain('renderImports(rootNode');
  expect(workspace).toContain('renderPortfolio(rootNode');
  expect(workspace).toContain('renderSuppliers(rootNode');
});

test('front sourcing shows commercial suggestion and hides customs category correction',()=>{
  expect(workspace).not.toContain('boutique-category-options');
  expect(workspace).not.toContain('confirm-boutique-category');
  expect(workspace).toContain("'/admin/workspaces/catalog?search='");
  expect(workspace).toContain('sourcingRemedy');
  expect(workspace).not.toContain('Catégorie Komerce ·');
});
