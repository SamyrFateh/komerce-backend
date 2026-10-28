'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/catalog-workspace-wide-v1.css'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/catalog-workspace.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/index.html'), 'utf8');

test('Catalogue: pleine largeur limitée au registre, sans modifier Raffinerie', () => {
  expect(css).toContain('body.kmc-shell-v4:has(.kmc-catalog-main-panel) #canonical-admin-root');
  expect(css).toContain('max-width: none');
  expect(css).toContain('.kmc-catalog-registry-table.kmc-workspace-table');
  expect(css).toContain('table-layout: fixed');
  expect(ui).toContain("' kmc-catalog-main-panel'");
  expect(index).toContain('catalog-workspace-wide-v1.css?v=261028-1');
});

test('Catalogue: nom/references/diagnostics/actions sont distincts et bornés', () => {
  expect(ui).toContain('<th>Référence</th><th>Fournisseur</th>');
  expect(ui).toContain('<th>Statut métier</th><th>Marchés</th><th>Prochaine action</th>');
  expect(ui).toContain("reference.setAttribute('data-label', 'Référence')");
  expect(ui).toContain("statusChip.setAttribute('data-status', row.work_status || 'inactive')");
  expect(ui).toContain("tr.appendChild(actionCell)");
  expect(css).toContain('-webkit-line-clamp: 2');
  expect(css).toContain('overflow-wrap: anywhere');
  expect(css).toContain('min-width: 1020px');
});

test('Mobile 390: cartes produit sans défilement horizontal de la page', () => {
  expect(css).toContain('@media (max-width: 760px)');
  expect(css).toContain('overflow-x: hidden');
  expect(css).toContain('grid-template-columns: minmax(0,1fr) minmax(0,1fr)');
  expect(css).toContain('content: attr(data-label)');
  expect(css).toContain('min-width: 0');
});

test('Aucune donnée fictive: filtres rapides conservent statuts serveur et délégation', () => {
  expect(ui).toContain("context.catalogFilters.status = value");
  expect(ui).toContain("await context.reload()");
  expect(ui).toContain("ENDPOINT + '/products/' + encodeURIComponent(row.product_ref) + '/classify'");
  expect(ui).toContain("row.supplier_product_id");
  expect(ui).toContain("row.image_url");
  expect(ui).toContain("row.work_status");
});

test('V3 : trois rubriques exclusives et aucun panneau sous le registre', () => {
  expect(ui).toContain("['registry', 'Registre produits']");
  expect(ui).toContain("['assortment', 'Assortiment approuvé']");
  expect(ui).toContain("['taxonomy', 'Taxonomie boutique']");
  const render = ui.slice(ui.indexOf('function renderPayload('), ui.indexOf('async function mount('));
  expect(render).toContain("context.catalogTab === 'assortment'");
  expect(render).toContain("context.catalogTab === 'taxonomy'");
  expect(render).toContain('renderCommercial(rootNode, ui, doc, payload)');
  expect(render).toContain('renderTaxonomy(rootNode, ui, doc, payload, context)');
  expect(render).not.toContain('taxonomyPanel');
  expect(ui).not.toContain('kmc-catalog-commercial-panel');
});

test('V3 : statut cliquable suit l’autorité métier, sans publication implicite', () => {
  expect(ui).toContain("function registryNextStep(row)");
  expect(ui).toContain("kind: 'source'");
  expect(ui).toContain("kind: 'classify'");
  expect(ui).toContain("kind: 'refinery'");
  expect(ui).toContain("kind: 'markets'");
  expect(ui).toContain("statusChip.addEventListener('click', () => primary.click())");
  expect(ui).toContain('kmc-catalog-row-more');
  expect(ui).toContain("Approuvé Catalogue");
  expect(ui).not.toContain("status: 'Publié'");
});

test('V3 : indicateurs affichés sur page seulement, sans confondre global et limité', () => {
  expect(ui).toContain("label: 'À classer · page'");
  expect(ui).toContain("label: 'Fiche FR · page'");
  expect(ui).toContain("label: 'Approuvés · page'");
  expect(ui).toContain('payload.registry_page?.total');
  expect(ui).toContain('Marchés de l’assortiment approuvé affiché');
});
