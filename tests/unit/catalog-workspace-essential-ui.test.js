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

test('Catalogue global est la seule surface de correction, diagnostic Raffinerie explicite',()=>{
  const source=decision.slice(decision.indexOf('function prependDecisionView'),decision.indexOf('function enhance'));
  expect(source).toContain("query.get('diagnostic') === '1'");
  expect(source).toContain('if (!refinery) return null;');
  expect(workspace).toContain("get('diagnostic') === '1'");
  expect(workspace).toContain('function renderRefineryMonitoring');
  expect(workspace).not.toContain('function renderApproval(');
  expect(workspace).toContain('function renderProducts');
  expect(workspace).toContain('function openProductInspector');
  expect(workspace).toContain('function openCandidateInspector');
});

test('Curation : un produit peut rester sans prix global, sans afficher ses coûts dans le Catalogue',()=>{
  expect(workspace).toContain('function priceExplanation');
  expect(workspace).toContain('la fixation du prix et les coûts commerciaux appartiennent au marché');
  expect(workspace).not.toContain('Coût d’achat estimé');
  expect(workspace).not.toContain('Prix de référence global');
  expect(workspace).not.toContain('Prix test indicatif');
  expect(workspace).toContain('function marketPriceLabel');
});

test('Suite marché : le Catalogue global indique l’état sans exposer un prix local',()=>{
  expect(workspace).toContain('function marketPriceLabel');
  expect(workspace).toContain('Prix à décider par le marché');
  expect(workspace).toContain('Décision tarifaire en cours');
  expect(workspace).not.toContain('market.local_price_amount');
});

test('C4 : le repli « autre » est signalé comme non validé, avec la catégorie fournisseur conservée',()=>{
  expect(workspace).toContain('function classificationNote');
  expect(workspace).toContain('function renderRegistryCorrections');
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


test('Catalogue : retour du Produit 360 conserve tous les filtres et la pagination',()=>{
  const catalog=require('../../public/dashboards/canonical/js/catalog-workspace');
  const filters=catalog.readCatalogFilters('?search=robe&supplier=CJ&category=Mode&subcategory=Femme&status=validated&catalog_offset=100');
  expect(filters).toEqual({search:'robe',supplier:'CJ',category:'Mode',subcategory:'Femme',status:'validated',offset:100});
  const url=new URL(catalog.catalogContextTarget({catalogFilters:filters,catalogTab:'registry'},'KPR-000123',{search:'?market=CM'}),'https://komerce.co');
  expect(url.searchParams.get('market')).toBe('CM');
  expect(url.searchParams.get('product_ref')).toBe('KPR-000123');
  expect(catalog.readCatalogFilters(url.search)).toEqual(filters);
  expect(catalog.readCatalogFilters('?catalog_offset=-1&status=bad')).toMatchObject({offset:0,status:''});
});
