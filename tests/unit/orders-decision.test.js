'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','orders-decision.js'),'utf8');

test('Commandes overview garde Hero + décisions + état/progression + files d’action',()=>{
  const start=source.indexOf('function render(rootNode');
  const renderSource=source.slice(start, source.indexOf('function enhance', start));
  expect(renderSource).toContain("data-dashboard-role', 'hero");
  expect(renderSource).toContain("data-dashboard-role', 'attention");
  expect(renderSource).toContain("data-dashboard-role', 'primary");
  expect(renderSource).toContain("'État des commandes'");
  expect(renderSource).toContain("'Progression des commandes'");
  expect(renderSource).toContain("'Cash à confirmer'");
  expect(renderSource).toContain("'Colis à créer'");
  expect(renderSource).not.toContain("'SLA & promesse client'");
  expect(renderSource).not.toContain("'Cycle de vie'");
  expect(renderSource).not.toContain("'Mix de paiement'");
  expect(renderSource).not.toContain("'Commandes prioritaires'");
  expect(renderSource).not.toContain('TrustFooter.render');
});

test('le bandeau Commandes nomme son seuil (paiements en attente > 72 h)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/orders-decision.js'), 'utf8');
  expect(src).toContain("label: 'Paiements en attente > 72 h'");
});
