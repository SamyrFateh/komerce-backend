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

test('Raffinerie garde le Hero ; Catalogue affiche directement les actions',()=>{
  const start=decision.indexOf('function prependDecisionView');
  const source=decision.slice(start, decision.indexOf('function enhance', start));
  expect(source).toContain('if (!refinery) return null;');
  expect(source).toContain("data-dashboard-role', 'hero");
  expect(source).toContain("data-dashboard-role', 'attention");
  expect(source).toContain("data-dashboard-role', 'primary");
  expect(source).toContain("refinery ? 'Produits à finaliser' : 'Catalogue global'");
  expect(source).toContain("refinery ? 'RAFFINERIE' : 'CATALOGUE'");
  expect(source).toContain("data-dashboard-id', refinery ? 'refinery' : 'catalog'");
  expect(decision).toContain("new URLSearchParams(search).get('view') === 'refinery'");
  expect(source).not.toContain("'État du catalogue'");
  expect(source).not.toContain("'Assortiment commercial'");
  expect(source).not.toContain("'Santé de la taxonomie'");
  expect(source).not.toContain('TrustFooter.render');
  expect(decision).toContain("href: '#catalog-products'");
  expect(workspace).toContain("refinery ? 'Raffinerie produits' : 'Catalogue global'");
  expect(workspace).toContain("'Préparer, contrôler et soumettre les fiches à validation. Les prix se décident dans l’Atelier.'");
});

test('Curation : un produit peut rester sans prix global, sans afficher ses coûts dans le Catalogue',()=>{
  expect(workspace).toContain('function priceExplanation');
  expect(workspace).toContain('la fixation du prix et les coûts commerciaux appartiennent au marché');
  expect(workspace).not.toContain('Coût d’achat estimé');
  expect(workspace).not.toContain('Prix de référence global');
  expect(workspace).not.toContain('Prix test indicatif');
  expect(workspace).toContain('data-price-explanation');
});

test('Suite marché : le Catalogue global indique l’état sans exposer un prix local',()=>{
  expect(workspace).toContain('function marketPriceLabel');
  expect(workspace).toContain('Prix à décider par le marché');
  expect(workspace).toContain('Décision tarifaire en cours');
  expect(workspace).not.toContain('market.local_price_amount');
});

test('C4 : le repli « autre » est signalé comme non validé, avec la catégorie fournisseur conservée',()=>{
  expect(workspace).toContain('function classificationNote');
  expect(workspace).toContain('data-classification-status');
  expect(workspace).toContain('Classement non validé');
  expect(workspace).toContain('Catégorie fournisseur');
  expect(workspace).toContain("'fallback_unresolved'");
});

test('Bandeau paramètres : provenance, usage, conséquence et accès à la configuration',()=>{
  expect(workspace).toContain('function renderPricingParameters');
  expect(workspace).toContain('data-pricing-parameters');
  expect(workspace).toContain('Valeur par défaut non validée');
  expect(workspace).toContain('Provenance : ');
  expect(workspace).toContain('Conséquence : ');
  expect(workspace).toContain('Configurer (');
  expect(workspace).toContain('pas un prix publié ni un coût réel');
});
