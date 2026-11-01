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
  expect(index).toContain('catalog-workspace-wide-v1.css?v=261031-hero-1');
});

test('Catalogue: nom/references/diagnostics/actions sont distincts et bornés', () => {
  expect(ui).toContain('<th>Produit</th><th>Fournisseur</th><th>Classement boutique</th>');
  expect(ui).toContain('kmc-catalog-product-reference');
  expect(ui).toContain('<th>Arbitrage requis</th><th>Action</th>');
  expect(ui).toContain("productCopy.appendChild(text(doc, 'small', 'kmc-catalog-product-reference', ref))");
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

test('Catalogue global : registre et taxonomie uniquement, ancien assortiment retiré sans perdre le passage marché', () => {
  expect(ui).toContain("['registry', 'Registre produits']");
  expect(ui).toContain("['taxonomy', 'Taxonomie boutique']");
  expect(ui).not.toContain("['assortment', 'Assortiment approuvé']");
  const render = ui.slice(ui.indexOf('function renderPayload('), ui.indexOf('async function mount('));
  expect(render).toContain("context.catalogTab === 'taxonomy'");
  expect(render).toContain('renderFocusedHandoff(rootNode, ui, doc, payload)');
  expect(render).toContain('renderProducts(rootNode, ui, doc, payload, context)');
  expect(render).not.toContain('renderCommercial(');
  expect(ui).toContain("['registry', 'taxonomy'].includes");
  expect(ui).not.toContain('function renderCommercial(');
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
  expect(ui).toContain('data-catalog-inline-editor');
});

test('Catalogue actionnable : en-tête compact, onglets et filtres, sans navigation ni KPI passifs', () => {
  const header = ui.slice(ui.indexOf('function createHeader('), ui.indexOf('function createSection('));
  const products = ui.slice(ui.indexOf('function renderProducts('), ui.indexOf('function renderTaxonomy('));
  const render = ui.slice(ui.indexOf('function renderPayload('), ui.indexOf('async function mount('));
  expect(header).toContain('kmc-catalog-compact-header');
  expect(header).toContain("header.setAttribute('data-dashboard-role', 'hero')");
  expect(header).toContain("'CATALOGUE GLOBAL'");
  expect(header).toContain('Prix et mise en vente : Catalogue marché.');
  expect(css).toContain('.kmc-catalog-compact-header[data-dashboard-role="hero"]');
  expect(css).toContain('commerce-hero-gold.svg');
  expect(css).toContain('height: var(--kmc-layout-hero-h, 150px)');

  expect(header).toContain('if (refinery) {');
  expect(products).not.toContain('kmc-catalog-toolbar-links');
  expect(products).not.toContain('Ouvrir le Sourcing');
  expect(render).not.toContain('ui.MetricStrip.render');
  expect(render).toContain('renderCatalogTabs(rootNode, doc, context)');
  expect(render).toContain('renderProducts(rootNode, ui, doc, payload, context)');
  expect(ui).toContain("statusChip.addEventListener('click', () => primary.click())");
  expect(css).toContain('.kmc-catalog-compact-header');
});

test('Suggestion : la paire boutique actuelle active est proposée sans mutation', () => {
  const catalog = require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const categories = [
    { key:'tech', label:'Tech', is_active:true, subcategories:[
      {key:'phones',label:'Téléphones',is_active:true},
      {key:'cases',label:'Accessoires',is_active:true},
    ] },
  ];
  expect(catalog.suggestBoutiquePair({
    boutique_category_key:'tech',boutique_subcategory_key:'phones',
    supplier_category:'Mobile Phone Protective Film',
  },categories)).toEqual({category:'tech',subcategory:'phones',basis:'current_pair'});
});
test('Suggestion : seule sous-catégorie active proposée quand la catégorie est établie', () => {
  const catalog=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  expect(catalog.suggestBoutiquePair({boutique_category_key:'maison'},
    [{key:'maison',label:'Maison',is_active:true,subcategories:[
      {key:'cuisine',label:'Cuisine',is_active:true},
      {key:'inactif',label:'Non actif',is_active:false},
    ]}])).toEqual({category:'maison',subcategory:'cuisine',basis:'single_active_child'});
});
test('Suggestion : correspondance exacte fournisseur unique, jamais de classement arbitraire', () => {
  const catalog=require('../../public/dashboards/canonical/js/catalog-workspace.js');
  const cats=[
    {key:'tech',label:'Tech',is_active:true,subcategories:[
      {key:'phones',label:'Téléphones',is_active:true},
      {key:'films',label:'Films protecteurs',is_active:true}]},
    {key:'maison',label:'Maison',is_active:true,subcategories:[
      {key:'cuisine',label:'Cuisine',is_active:true}]},
  ];
  expect(catalog.suggestBoutiquePair({supplier_category:'Accessories > Films protecteurs'},cats))
    .toEqual({category:'tech',subcategory:'films',basis:'supplier_exact'});
  expect(catalog.suggestBoutiquePair({supplier_category:'Mobile Phone Protective Film'},cats))
    .toEqual({category:'',subcategory:'',basis:'none'});
  expect(catalog.suggestBoutiquePair({supplier_category:'Tech'},cats))
    .toEqual({category:'tech',subcategory:'',basis:'supplier_parent'});
});
test('Classement : formulaire accessible et pas de prompt/confirm avec indices', () => {
  const source=ui.slice(ui.indexOf('function openProductClassificationDialog'),
    ui.indexOf('function inspectorFrame('));
  expect(source).toContain("doc.createElement('dialog')");
  expect(source).toContain("doc.createElement('select')");
  expect(source).toContain("dialog.showModal()");
  expect(source).toContain("suggestBoutiquePair(row, active)");
  expect(source).toContain("type = 'submit'");
  expect(source).toContain("feedbackTarget: feedback");
  expect(source).toContain("body: { category: category.key, subcategory: subcategory.key }");
  expect(source).not.toContain("context.prompt(");
  expect(source).not.toContain("context.confirm(");
  expect(source).toContain("Si une seule feuille reste possible, la proposer d'emblée.");
});

test('V4 : seules les corrections s’affichent, conformité contrôlée par serveur lors des mutations', () => {
  expect(ui).toContain('function registryCorrectionItems(row = {})');
  expect(ui).toContain('renderRegistryCorrections(doc, diagnostic, row, context, nextStep)');
  expect(ui).toContain('?diagnose_product_ref=');
  expect(ui).toContain('renderProductQuickFields(context, doc, panel, row, categories, feedback)');
  expect(ui).toContain('data-catalog-quick-category');
  expect(ui).toContain('data-catalog-quick-subcategory');
  expect(ui).toContain('data-catalog-inline-editor');
  expect(ui).not.toContain("status: 'Publié'");
  expect(css).toContain('.kmc-catalog-readiness-reasons');
  expect(css).toContain('.kmc-catalog-primary-action');
});

test('V4 : fiches inactives hors candidats restent éditables, sans activation implicite', () => {
  expect(ui).toContain("ENDPOINT+'/products/'+encodeURIComponent(row.product_ref)+'/update'");
  expect(ui).toContain("const active=row.lifecycle_status==='active'&&row.is_active===true");
  expect(ui).toContain('data-catalog-quick-field');
  expect(ui).not.toContain('Aucune correction à apporter.');
});

test('V4 : un produit réparé ne redevient pas une correction fantôme', () => {
  expect(ui).toContain("row.work_status === 'catalog_approved_inactive'");
  expect(ui).toContain("row.work_status === 'approval_to_review'");
  expect(ui).toContain("readyCandidate ? 'Finaliser' : hasMissingContent ? 'Compléter' : 'Voir fiche'");
  expect(ui).toContain("diagnosis?.certification?.certified !== true");
  expect(ui).not.toContain("status: 'À diagnostiquer'");
});

test('V4.1 : priorité visuelle aux écarts avant marchés et à la prochaine action', () => {
  expect(css).toContain('V4.1 — registre');
  expect(css).toContain('.kmc-catalog-main-panel .kmc-catalog-registry-table th:nth-child(4) { width: 29%; }');
  expect(css).toContain('.kmc-catalog-main-panel .kmc-catalog-diagnostic');
  expect(css).toContain('.kmc-catalog-main-panel .kmc-catalog-correction-item');
  expect(css).toContain('.kmc-catalog-main-panel .kmc-catalog-primary-action');
  expect(css).toContain('@media (max-width: 760px)');
  expect(ui).toContain('renderRegistryCorrections(doc, diagnostic, row, context, nextStep)');
  expect(ui).toContain('statusChip.addEventListener');
});

test('Dossier opérateur : correction source accessible sans chiffres économiques globaux', () => {
  expect(ui).not.toContain('function appendCatalogEconomicSummary(panel, doc, row)');
  expect(ui).not.toContain('Prix test indicatif');
  expect(ui).not.toContain('Coût variable complet');
  expect(ui).not.toContain('Prix de référence · non décision marché');
  expect(ui).toContain("sourceDetails.appendChild(facts)");
  expect(ui).toContain("classify.addEventListener('click', loadBoutiqueProposal)");
  expect(ui).toContain("void loadBoutiqueProposal()");
  expect(ui).toContain("select.value = suggestion ? '0' : ''");
  expect(ui).toContain("Number.parseInt(select.value, 10)");
  expect(ui).toContain("method: 'POST'");
  expect(css).toContain('width: min(660px, calc(100vw - 40px))');
  expect(ui).not.toContain('appendCatalogEconomicSummary');
  expect(index).toContain('catalog-workspace.js?v=261102-arbitration-1');
});

test('Catalogue : dossier produit complet, y compris les produits approuvés', () => {
  expect(ui).toContain("function renderProductDossierDetails(slot, doc, dossier, row)");
  expect(ui).toContain("?dossier_product_ref=");
  expect(ui).toContain("title_fr");
  expect(ui).toContain("description_fr");
  expect(ui).toContain("supplier_identity_complete");
  expect(ui).toContain("active_canonical");
  expect(ui).toContain("weight_kg");
  expect(ui).toContain("commercial_exposure");
  expect(ui).toContain("price_status");
  expect(ui).not.toContain('local_price_amount');
  expect(ui).toContain("market_data_scope");
  expect(ui).toContain("certificationReasonLabel(reason)");
  expect(ui).toContain("primary.addEventListener('click', () =>");
  expect(ui).toContain("openProductInspector(context, slot, doc, row, categories)");
  expect(css).toContain(".kmc-catalog-dossier-group");
  expect(css).toContain(".kmc-catalog-market-row");
});

test('Fiche commerciale complète : galerie, variantes et correction FR disponibles depuis Catalogue', () => {
  expect(ui).toContain("data-catalog-canonical-gallery");
  expect(ui).toContain("Images canoniques actives");
  expect(ui).toContain("img.loading = 'lazy'");
  expect(ui).toContain("data-catalog-variants");
  expect(ui).toContain("stock_semantics");
  expect(ui).toContain("Géré par les SKU · voir ci-dessous");
  expect(ui).toContain("availability.dimensions_cm");
  expect(ui).toContain("availability.fragility");
  expect(ui).toContain("availability.requires_secure_transport");
  expect(ui).toContain("row._catalogueDossier = dossier");
  expect(ui).toContain("identity.description_fr || row.description");
  expect(ui).toContain("issues.includes('editorial_to_complete')");
  expect(ui).toContain("'Compléter titre et description FR' : 'Modifier titre / description FR'");
  expect(css).toContain(".kmc-catalog-dossier-image-strip");
  expect(css).toContain(".kmc-catalog-variant-line");
});
test('Un candidat Sourcing à examiner n’est plus absent du compteur des actions', () => {
  expect(ui).toContain('row.requires_arbitration === true');
  expect(ui).toContain('operator_arbitrations');
  expect(ui).toContain("'arbitration', 'À arbitrer'");
});

test('Actions éditoriales toujours visibles avant lecture longue de la fiche', () => {
  expect(ui).toContain("actionDock.setAttribute('data-catalog-action-dock', '')");
  expect(ui).toContain("panel.appendChild(actionDock)");
  expect(ui).toContain("sourceDetails.setAttribute('data-catalog-source-details', '')");
  expect(ui).toContain("additional.appendChild(dossierSlot)");
  expect(ui).toContain("additional.setAttribute('data-catalog-complementary-info', '')");
  expect(ui).toContain("Compléter titre et description FR");
  expect(ui).toContain("Modifier titre / description FR");
  expect(ui).toContain("openFrenchEditor(context, {");
  expect(css).toContain(".kmc-catalog-inspector-action-dock");
  expect(css).toContain("position: sticky");
  expect(css).toContain('min-height: 42px');
  expect(index).toContain('catalog-workspace.js?v=261102-arbitration-1');
  expect(index).toContain('catalog-workspace-wide-v1.css?v=261031-hero-1');
});

test('Validation Catalogue : la préparation française et le contrôle sont distincts de la décision humaine',()=>{
  expect(ui).toContain("status: 'Validation Catalogue requise'");
  expect(ui).toContain('français enregistré automatiquement');
  expect(ui).toContain('finishCatalogueAfterCorrection(context, row)');
  expect(ui).toContain("stepNotice.setAttribute('data-catalog-approval-explanation', '')");
  expect(ui).toContain("'Contrôler les prérequis', 'inspector-check-approval'");
  expect(ui).toContain('Contrôler les prérequis (lecture seule)');
  expect(ui).toContain('Prérequis techniques satisfaits.');
  expect(ui).toContain("'Valider le Catalogue', 'inspector-approve'");
  expect(ui).toContain("ENDPOINT + '/approval/'");
  expect(ui).toContain('Validation refusée : ');
  expect(ui).not.toContain("status: 'À valider en Raffinerie'");
  expect(index).toContain('catalog-workspace.js?v=261102-arbitration-1');
});

test('Examiner V4 : aucun double Enregistrer/Confirmer visible et conformité garantie par serveur', () => {
  expect(ui).toContain('save.hidden = true;');
  expect(ui).toContain('validate.hidden = true;');
  expect(ui).toContain("nameField.control.addEventListener('change', () => autosaveFrench())");
  expect(ui).toContain("descriptionField.control.addEventListener('change', () => autosaveFrench())");
  expect(ui).toContain("select.addEventListener('change', () => {");
  expect(ui).toContain("form.requestSubmit()");
  expect(ui).toContain("diagnosis?.certification?.certified !== true");
  expect(ui).toContain("ENDPOINT + '/approval/'");
  expect(ui).toContain("approvalDetails.setAttribute('data-catalog-approval-details', '')");
  expect(ui).toContain("correctionIssues = issues.filter(code => code !== 'approval_pending')");
  expect(css).toContain(".kmc-catalog-complementary");
  expect(css).toContain(".kmc-catalog-fr-footer-buttons [hidden]");
});

test('Registre et Taxonomie réutilisent le même Hero, sans reconstituer un second bandeau', () => {
  const header = ui.slice(ui.indexOf('function createHeader('), ui.indexOf('function createSection('));
  const render = ui.slice(ui.indexOf('function renderPayload('), ui.indexOf('async function mount('));
  const oneHeader = 'rootNode.appendChild(createHeader(doc, refinery));';
  expect(render).toContain(oneHeader);
  expect(render.indexOf(oneHeader)).toBeLessThan(render.indexOf('renderCatalogTabs(rootNode, doc, context)'));
  expect(render.indexOf(oneHeader)).toBeLessThan(render.indexOf("context.catalogTab === 'taxonomy'"));
  expect(header).toContain("if (!refinery) header.setAttribute('data-dashboard-role', 'hero')");
  expect(header).not.toContain('kmc-catalog-decision-overview');
});


test('Registre : seuls les vrais arbitrages produisent un statut humain',()=>{
  expect(ui).toContain('function registryCorrectionItems(row = {})');
  expect(ui).toContain('if (row.requires_arbitration !== true) return [];');
  expect(ui).toContain("sourcing_category_review: { code:'family'");
  expect(ui).toContain("sourcing_review: { code:'boutique'");
  expect(ui).toContain("taxonomy_to_confirm: { code:'taxonomy'");
  expect(ui).toContain("editorial_to_complete: { code:'editorial'");
  expect(ui).toContain("approval_pending: { code:'approval'");
  expect(ui).toContain("row.record_kind === 'candidate'");
  expect(ui).not.toContain('Catégorie économique manquante');
  expect(ui).not.toContain('Classement boutique à confirmer');
  expect(ui).not.toContain('Candidat fournisseur · aucune validation Catalogue implicite.');
});
