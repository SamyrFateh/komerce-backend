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
  // Contrat one-glance : montrer les montants canoniques même sans anomalie.
  expect(decisionSource).toContain('decisionUi.SummaryCards.render(totals, { items: summaryCards(items) })');
  expect(decision).toContain("title: 'Cash du marché'");
  expect(decision).toContain("{ label: 'Détenu', value: value('held') }");
  expect(decision).toContain("{ label: 'Clôturé', value: value('closed') }");

  const enhanceStart=decision.indexOf('function enhance');
  const enhanceSource=decision.slice(enhanceStart);
  expect(enhanceSource).not.toContain('appendReconciliationOverview(options');
});

test('Déclaration de dépôt relais : devise + montant d\'origine, jamais un KMF saisi à la main', () => {
  const start = workspace.indexOf('function renderDepositCreation');
  const src = workspace.slice(start, workspace.indexOf('function renderDeposits', start));
  expect(src).toContain("'Devise du montant'");
  expect(src).toContain('declared_amount: Number(amount)');
  expect(src).toContain('declared_currency: currency');
  expect(src).not.toContain('amount_kmf');
});

test('Toutes les actions du workspace passent par runAction, définie dans le module (jamais de ReferenceError au clic)', () => {
  expect(workspace).toMatch(/async function runAction\(context, button, options\)/);
  const calls = (workspace.match(/\brunAction\(/g) || []).length;
  expect(calls).toBeGreaterThan(5);
});

test('Garde des espèces : un conteneur par tableau (DataTable.render vide son conteneur)', () => {
  const start = workspace.indexOf('function renderCustody');
  const src = workspace.slice(start, workspace.indexOf('function renderUncollected', start));
  expect(src).not.toContain('DataTable.render(slot');
  expect((src.match(/DataTable\.render\(part\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
});
