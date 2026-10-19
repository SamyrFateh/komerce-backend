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

test('Curation : le prix explique coût estimé, prix global absent et responsable',()=>{
  expect(workspace).toContain('function priceExplanation');
  expect(workspace).toContain("Coût d’achat estimé");
  expect(workspace).toContain('Prix de vente global non défini');
  expect(workspace).toContain('data-price-explanation');
  expect(workspace).toContain('Responsable : décision prix');
  expect(workspace).not.toContain("'Prix —'");
});

test('Suite marché : un prix local absent est expliqué, jamais un code brut',()=>{
  expect(workspace).toContain('function marketPriceLabel');
  expect(workspace).toContain('Prix local non défini pour ce marché');
  expect(workspace).toContain('Prix local en brouillon, à activer');
});

test('C4 : le repli « autre » est signalé comme non validé, avec la catégorie fournisseur conservée',()=>{
  expect(workspace).toContain('function classificationNote');
  expect(workspace).toContain('data-classification-status');
  expect(workspace).toContain('Classement non validé');
  expect(workspace).toContain('Catégorie fournisseur');
  expect(workspace).toContain("'fallback_unresolved'");
});
