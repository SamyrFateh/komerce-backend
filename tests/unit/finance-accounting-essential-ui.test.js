'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const workspace=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','finance-accounting-workspace.js'),'utf8');
const decision=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','finance-accounting-workspace-decision.js'),'utf8');

test('Finance Comptabilité garde Hero filtrable + décisions + rapprochement + dépôts + cash à traiter',()=>{
  expect(workspace).toContain("data-workspace-kind', 'accounting");
  expect(workspace).toContain("'COMPTABILITÉ'");
  expect(workspace).toContain("'Cash & dépôts'");
  // UX-04 : le filtre n'est plus dans le Hero
  expect(workspace).not.toContain('header.appendChild(filterControls(doc, payload, context))');
  expect(workspace).toContain("'Période'");

  const renderStart=workspace.indexOf('function renderPayload');
  const renderSource=workspace.slice(renderStart, workspace.indexOf('async function mount', renderStart));
  expect(renderSource).toContain('renderReconciliation(rootNode');
  expect(renderSource).toContain('renderDeposits(rootNode');
  expect(renderSource).toContain('renderUncollected(rootNode');
  expect(renderSource).not.toContain('renderFilters(rootNode');
  expect(renderSource).not.toContain('renderCollections(rootNode');
  expect(renderSource).not.toContain('renderInvoices(rootNode');

  const decisionStart=decision.indexOf('function renderMetricOverview');
  const decisionSource=decision.slice(decisionStart, decision.indexOf('function decorateUi', decisionStart));
  expect(decisionSource).toContain("'À contrôler maintenant'");
  expect(decisionSource).not.toContain('SummaryCards.render');

  const enhanceStart=decision.indexOf('function enhance');
  const enhanceSource=decision.slice(enhanceStart);
  expect(enhanceSource).not.toContain('appendReconciliationOverview(options');
});
