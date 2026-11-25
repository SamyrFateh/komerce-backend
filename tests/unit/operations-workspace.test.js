/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/operations-workspace.css'), 'utf8');

describe('operations-workspace.css — chaîne et actions du Catalogue', () => {
  test('la chaîne de curation porte les états current / done / pending', () => {
    ['.kmc-catalog-chain-stage.is-current', '.kmc-catalog-chain-stage.is-pending', '.kmc-catalog-chain-count'].forEach(sel => {
      expect(css).toContain(sel);
    });
  });

  test('hiérarchie des actions : valider (vert), prix (bleu), écarter (rouge discret)', () => {
    expect(css).toContain('.kmc-workspace-action.is-approve');
    expect(css).toContain('a.kmc-workspace-action.is-price');
    expect(css).toContain('.kmc-workspace-action.is-danger');
  });

  test('la chaîne reste sans style inline et passe en colonne sur mobile', () => {
    expect(css).toMatch(/@media \(max-width:760px\)\{\.kmc-catalog-chain\{grid-template-columns:1fr/);
  });
});

describe('tableau des candidats Sourcing', () => {
  test('colonnes État et Décision élargies pour les libellés français', () => {
    expect(css).toMatch(/td:nth-child\(5\) \{ width: 14%; \}/);
    expect(css).toMatch(/td:nth-child\(6\) \{ width: 11%; \}/);
  });
});

test('operations-workspace.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('operations-workspace.css')).toEqual([]);
});

describe('L9a — répartition Hub dans Opérations', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('le bouton « Répartir ce marché » n’est ajouté que s’il reste des commandes à répartir', () => {
    expect(src).toMatch(/distribution\.unassigned\.length > 0\)\s*\{\s*distributionBar\.appendChild\(distributeButton\)/);
  });
});

describe('réception Hub — confirmer une référence inconnue', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('HUB_PHYSICAL_CODE_UNKNOWN propose « Confirmer cette référence » vers la route canonique, puis relance l\'identification', () => {
    expect(src).toContain("const PHYSICAL_CODE_CONFIRM_ENDPOINT = '/api/hub/physical-codes/confirm';");
    expect(src).toMatch(/error\.code === 'HUB_PHYSICAL_CODE_UNKNOWN'/);
    expect(src).toContain("'Confirmer cette référence', 'open-physical-confirm'");
    expect(src).toMatch(/purchase_order_id: po\.purchase_order_id,\s*product_sku_id: variant\.value,\s*code,\s*code_type: type\.value,\s*proof_ref:/);
    expect(src).toMatch(/closeConfirm\(\);\s*await identify\(code\);/);
  });
  test('les trois types de code de la doctrine sont proposés', () => {
    ['EAN_GTIN', 'SUPPLIER_BARCODE', 'KOM_LOT_LABEL'].forEach(type => expect(src).toContain(`'${type}'`));
  });
});

describe('répartition d\'une seule commande', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('chaque ligne à répartir porte « Répartir » vers orders/:reference/distribute, et « Répartir ce marché » reste', () => {
    expect(src).toContain("makeActionButton(doc, 'Répartir', 'distribute-order')");
    expect(src).toContain('orders/${encodeURIComponent(row.reference)}/distribute');
    expect(src).toContain("'Répartir ce marché', 'run-distribution'");
  });
});

describe('L9c — gestes Hub réservés à Hub live', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('hors mode execution, les boutons Commander, Répartir, Expédier et Affecter ne sont pas rendus', () => {
    expect(src).toMatch(/function isHubReadOnly\(context\)\s*\{\s*return context\.mode !== 'execution';/);
    expect(src).toMatch(/config\.hub && isHubReadOnly\(context\)\) return;/);
    expect(src).toMatch(/!isHubReadOnly\(context\) && Array\.isArray\(payload\.distribution/);
    expect(src).toMatch(/if \(isHubReadOnly\(context\)\) \{ select\.disabled = true/);
  });
  test('le lien « Exécuter dans Hub live » porte le marché', () => {
    expect(src).toContain('/admin/hub-live?view=execute&market=${encodeURIComponent(context.marketCode)}');
  });
});

test('Catalogue global : filtres accessibles et panneau taxonomie secondaire sur mobile', () => {
  expect(css).toContain('.kmc-catalog-filter-bar');
  expect(css).toContain('.kmc-catalog-filter input');
  expect(css).toContain('.kmc-catalog-filter select');
  expect(css).toContain('.kmc-catalog-taxonomy-panel summary');
  expect(css).toContain('@media (max-width: 650px)');
  expect(css).toContain('.kmc-catalog-filter { flex-basis: 100%; }');
});

describe('operations-workspace.js — composition directe COMBOX (#3900)', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('COMBOX et articles exposent la preuve SCAN ou MANUAL', () => {
    expect(ui).toContain("boxScan.setAttribute('data-hub-box-scan','')");
    expect(ui).toContain("['SCAN','Scanner le code article'],['MANUAL','Mode dégradé · constat manuel']");
    expect(ui).toContain("evidence_method:'SCAN',evidence_code:code.value.trim()");
    expect(ui).toContain("evidence_method:'MANUAL',evidence_ref:proofRef");
    expect(ui).toContain('data-receive-manual-proof');
    expect(ui).toContain('data-receive-manual-toggle');
    expect(ui).not.toContain('data-hub-bag-preparation');
    expect(ui).toContain("'Fermer la COMBOX'");
  });
});

describe('T8 — arrivée fournisseur sans manifeste (HB-08)', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  const ops = fs.readFileSync(path.join(__dirname, '../../services/hub-operations.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../../routes/scans.js'), 'utf8');

  test('le poste expose le constat même sans PO et sans inventer de contenu', () => {
    expect(ui).toContain("data-hub-unmanifested-arrival");
    expect(ui).toContain("data-hub-unmanifested-form");
    expect(ui).toContain("data-hub-unmanifested-reference");
    expect(ui).toContain("data-hub-unmanifested-location");
    expect(ui).toContain("data-hub-unmanifested-tracking");
    expect(ui).toContain("arrival.appendChild(createUnmanifestedArrivalCard(doc,context));");
    expect(ui).toContain("arrival.open=Boolean(context.unmanifestedArrivalOpen)");
    expect(ui).toMatch(/url: RECEIVE_ENDPOINT,[\s\S]*contents: \[\],/);
    expect(ui).not.toContain("data-hub-unmanifested-purchase-order");
  });

  test('la confirmation explicite appelle uniquement le writer physique canonique et garde sa référence sur erreur', () => {
    expect(routes).toContain("router.post('/hub/receive'");
    expect(routes).toContain("hubOps.receiveSupplierPackageCommand(req.body || {}, req.user.id)");
    expect(ops).toContain("reconciliation_mode: parsedPurchaseOrderId ? 'PRE_RECONCILED_TAG' : 'UNRECONCILED'");
    expect(ui).toContain('context.unmanifestedArrivalReference = null;');
    expect(ui).toContain('Vérifiez le dossier par référence avant de recommencer');
    expect(ui).toContain('Aucun article n’est attribué à une commande avant déballage et rapprochement.');
  });
});

describe('G6 Ergonomie UX3 — marché et sélection du Hub', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('un remontage de la même session et du même marché conserve le cockpit', () => {
    expect(src).toContain('const activeHubMounts = new WeakMap()');
    expect(src).toContain("previous.marketCode === marketCode && previous.role === options.user?.role");
    expect(src).toContain("rootNode.querySelector?.('[data-hub-cockpit]')");
    expect(src).toContain('return previous.handle');
  });
  test('le changement de marché exige un nouveau dossier et garde les routes existantes', () => {
    expect(src).toContain('if (!MARKET_CODE.test(marketCode))');
    expect(src).toContain("endpointFor(marketCode, 'supply')");
    expect(src).toContain("context.mode === 'execution'");
  });
});

describe('Hub UX guidée — atelier physique canonique', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');

  test('réception et ateliers ouvrent les gestes existants, jamais une seconde écriture', () => {
    expect(src).toContain("secondary.setAttribute('data-hub-physical-details', '');");
    expect(src).toContain('secondary.open = true');
    expect(src).toContain("context.view = 'reception';");
    expect(src).toContain("context.renderCurrent();");
    expect(src).not.toContain("bags: '[data-hub-bag-preparation]'");
    expect(src).toContain("boxes: '[data-supply-box-create]'");
    expect(src).toContain("shipments: '[data-supply-shipment-bar]'");
    expect(src).toContain("'create-shipment-from-boxes'");
    expect(src).toContain("'receive-supplier'");
  });

  test('les champs de réception ont des labels visibles avec état manuel explicite', () => {
    expect(src).toContain("const manualProofLabel = text(doc, 'label'");
    expect(src).toContain("const trackingLabel = text(doc, 'label'");
    expect(src).toContain('manualProofLabel.hidden = !manualToggle.checked;');
    expect(src).toContain("scannerInput.setAttribute('aria-label'");
  });
});

test('Hub UX : accès directs COMBOX puis Expéditions sans animation parasite', () => {
  const src=fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
  expect(src).not.toContain("bags: '[data-hub-bag-preparation]'");
  expect(src).toContain("boxes: '[data-supply-box-create]'");
  expect(src).toContain("shipments: '[data-supply-shipment-bar]'");
  expect(src).toContain("anchor.scrollIntoView?.({ block: 'start', behavior: 'auto' });");
  expect(src).not.toContain("anchor.scrollIntoView?.({ block: 'start', behavior: 'smooth' });");
});

test('Hub Live compose directement les articles reçus sans créer de sac numérique', () => {
  const src=fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
  expect(src).toContain("endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/fill')");
  expect(src).toContain("endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/close')");
  expect(src).not.toContain('data-hub-bag-preparation');
  expect(src).not.toContain('bag_reference_scan');
});

test('Relais guidé : zone unique synchronisée sur le choix de file, non sur un nouveau writer',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
  expect(src).toContain("guide.setAttribute('data-relay-next', '')");
  expect(src).toContain("link.setAttribute('data-relay-item-count',String(choice.count))");
  expect(src).toContain("title.textContent='À faire maintenant · '+label;");
  expect(src).toContain("rootNode.setAttribute('data-relay-active-operation',key)");
  expect(src).toContain('showRelayOperation(rootNode,context.activeRelayQueue)');
});

test('Hub : retour au Kanban et station étiquettes même lorsque la file est vide', () => {
  const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
  expect(src).toContain("execution ? '/admin/hub?branch=operations'");
  expect(src).toContain("labels: '[data-hub-label-printing]'");
  expect(src).toContain("if(!labelRows.size)");
  expect(src).toContain('Aucun article reçu disponible');
  expect(src).toContain("pdfLink('articles',line.allocation_id,'a4')");
  expect(src).toContain("pdfLink('articles',line.allocation_id,'thermal')");
});

test('réimpression après placement : lien vers les archives, aucune seconde émission',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
 const history=src.slice(src.indexOf('const history=doc.createElement(\'button\');',src.indexOf('const labelRows=new Map();')),src.indexOf('return labelSection;',src.indexOf('function renderArticleLabelActions')));
 const center=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-label-center.js'),'utf8');
 expect(history).toContain("data-hub-article-label-reprints");
 expect(history).toContain("context.view='labels'");
 expect(history).not.toContain('runAction(');
 expect(history).not.toContain('pdfLink(');
 expect(center).toContain("labels/index");
 expect(center).toContain("method:'GET'");
 expect(center).not.toContain("+'/issue'");
});

test('atelier Hub : l’ordre visible suit étiquettes, préparation COMBOX, puis départ',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
 const labels=src.indexOf('boxes.appendChild(renderArticleLabelActions(doc,context,fillable,true));');
 const init=src.indexOf('boxes.appendChild(createBar);');
 const table=src.indexOf('boxes.appendChild(boxTable);');
 const departure=src.indexOf('boxes.appendChild(bar);');
 expect(labels).toBeGreaterThan(0);
 expect(init).toBeGreaterThan(labels);
 expect(table).toBeGreaterThan(init);
 expect(departure).toBeGreaterThan(table);
});

test('COMBOX : destination connue ou écart explicite, état lisible sans changer les codes métier',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
 expect(src).toContain("PACKED:'Fermée',DISPATCHED:'Prête au départ'");
 expect(src).toContain("relayIds.size>1||relayCodes.size>1?'Écart de destination à contrôler'");
 expect(src).toContain('box.contents.every(c=>c.relais_id&&c.relais_code)');
 expect(src).toContain('data-hub-box-destination');
});

describe('Hub: no old SAC and QR/PDF immediately reachable',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
  const hubCockpit=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/index.html'),'utf8');
  test('front no longer creates or deposits in customer bags',()=>{
    expect(source).not.toContain('Préparer les sacs clients');
    expect(source).not.toContain('Déposer dans le sac');
    expect(source).not.toContain('Ateliers physiques · Sacs');
    expect(hubCockpit).toContain("filter(item => !['PREPARE_BAG'");
    // The cockpit may filter old bag events, but never enables bag mutations.
    expect(hubCockpit).not.toContain("ctx.endpoint('bags')");
  });
  test('QR station is a first-class tab and immediate dossier shortcut',()=>{
    expect(source).toContain("{ id: 'labels', label: 'Étiquettes QR' }");
    expect(source).toContain("labelJump.setAttribute('data-hub-label-shortcut','')");
    expect(source).toContain("context.view='labels';context.renderCurrent()");
    expect(source).toContain("station.setAttribute('data-hub-labels-station','')");
    expect(source).toContain('KomerceHubLabelCenter');
    expect(source).toContain('openPreparation:()=>');
    expect(source).not.toContain('fillable:Array.isArray(context.dossier?.fillable)');
  });
  test('new script and CSS version IDs are different from the stale November 13 immutable assets',()=>{
    expect(html).toContain('hub-label-center.js?v=261124-hub-domain-2');
    expect(html).toContain('operations-workspace.js?v=261125-hub-reception-focus');
    expect(html).not.toContain('operations-workspace.js?v=261124-hub-po-inline-2');
    expect(html).toContain('hub-live-cockpit.js?v=261124-hub-po-inline-2');
    expect(html).toContain('operations-workspace.css?v=261125-hub-reception-focus');
    expect(html).not.toContain('operations-workspace.js?v=261113-director-h4');
    expect(html).toContain('hub-workstation.js?v=261125-hub-po-departure-5');
    expect(html).not.toContain('hub-workstation.js?v=261124-hub-po-inline-2');
    for(const name of ['hub-context-actions.js','app.js'])expect(html).toContain(name+'?v=261124-hub-domain-2');
  });
  test('historic COMBOX rows remain accessible but no longer occupy full page',()=>{
    expect(source).toContain("boxSearch.setAttribute('aria-label','Filtrer les COMBOX physiques')");
    expect(source).toContain("boxTable.setAttribute('data-hub-combox-scroll','')");
    expect(source).toContain("boxSearch.addEventListener('input',filterBoxes)");
    expect(css).toContain('max-height:480px;overflow:auto;scrollbar-gutter:stable');
    expect(css).toContain("[data-hub-combox-scroll] tbody tr[hidden]");
  });
  test('QR search and download layout is compact and accessible on mobile',()=>{
    expect(css).toContain('.kmc-hub-label-grid');
    expect(css).toContain('.kmc-hub-label-controls');
    expect(css).toContain('.kmc-hub-label-download');
    expect(css).toContain('grid-template-columns:1fr');
  });
});

test('Jalons Hub : projection serveur, pas de calcul local, étape terminée désactivée',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
  expect(src).toContain('context.dossier?.hub_journeys');
  expect(src).toContain("(j.physical_focus||j.current_key)===key");
  expect(src).toContain("step.disabled=done");
  expect(src).toContain("hub_journeys: dossier?.hub_journeys");
});

test('jalon QR distinct et destination autoritative',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
 expect(src).toContain("['labels','4 · QR articles']");
 expect(src).toContain('data-hub-journey-destination');
});

test('Direction Hub : surface dédiée, sans ateliers physiques ni onglets opérationnels',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
 expect(src).toContain("hubQuery.get('entry')==='direction'");
 expect(src).toContain('if(context.decisionOnly)return;');
 expect(src).toContain('data-hub-decision-workspace');
});

test('Direction écart fournisseur : PO du marché et droits avant formulaire',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/operations-workspace.js'),'utf8');
 expect(src).toContain("context.decisionKind==='variance'");
 expect(src).toContain("context.dossier?.purchase_orders?.some(po=>po.id===id)");
 expect(src).toContain('api.directionVariance(panel');
});
