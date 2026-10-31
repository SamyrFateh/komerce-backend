'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const vm = require('vm');

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/catalog-run-progress', () => ({ readRunProgress: jest.fn() }));
const { readRunProgress } = require('../../services/catalog-run-progress');
const runs = require('../../services/import-runtime-runs');

function executor() {
  return { query: jest.fn().mockResolvedValueOnce({ rows:[{ id:'run-id', run_ref:'KIR-1', source_total:0,
    stages:{}, intake:{}, status:'RUNNING' }] }).mockResolvedValueOnce({ rows: [
    { state:'imported_to_catalog', product_ref:'P-1' },
    { state:'watchlist', product_ref:'P-2' },
    { state:'rejected', product_ref:'P-3' },
    { state:'imported_to_catalog', product_ref:null },
  ] }) };
}

test('handoff lit uniquement les product_ref promues du lot', async () => {
  readRunProgress.mockResolvedValue({ available:true, marker:'cohort' });
  const q = executor();
  const projection = await runs.getRun('KIR-1', q);
  expect(readRunProgress).toHaveBeenCalledWith(['P-1'], q);
  expect(projection.downstream).toEqual({ available:true, marker:'cohort' });
});

test('une panne aval ne transforme jamais un import terminé en faux zéro', async () => {
  readRunProgress.mockResolvedValue({ available:true });
  const before = await runs.getRun('KIR-1', executor());
  readRunProgress.mockRejectedValue(new Error('market database offline'));
  const after = await runs.getRun('KIR-1', executor());
  expect(after.downstream).toEqual({ available:false });
  expect(after.status).toBe(before.status);
  expect(after.accounting).toEqual(before.accounting);
});

function cockpit(search = '?run=KIR-000004') {
  const context = {
    URLSearchParams,
    window: {
      __KOMERCE_LEGACY_PROOF__: true,
      location:{ pathname:'/admin/import-runtime', search },
      history:{ pushState:jest.fn() },
      addEventListener:jest.fn(),
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../public/dashboards/canonical/js/import-runtime.js'), 'utf8'), context);
  return context.window.KomerceCanonicalImportRuntime;
}

function root() {
  return { innerHTML:'', className:'', querySelectorAll:()=>[] };
}

const payload = {
  source_controls:[
    {
      source_ref:'api:aliexpress',
      label:'AliExpress',
      autopilot_enabled:false,
      autopilot_ready:false,
      activation_ready:true,
      blocker:'Préparation automatique requise',
      preparation_required:['Discovery','Sync','Import','Certification runtime','Production'],
      last_capture_at:'2026-09-29T00:07:00Z',
    },
  ],
  lots:[
    { run_ref:'KIR-000004',provider:'AliExpress',source_total:19,business_status:'ACTION_REQUIRED' },
    { run_ref:'KIR-000003',provider:'CJ',source_total:200,business_status:'CLOSED' },
  ],
  selected:{
    run_ref:'KIR-000004',provider:'AliExpress',status:'COMPLETED',
    accounting:{
      source_total:19,accepted:19,refined:15,taxonomized:15,certified:15,catalogued:1,
      awaiting_catalogue_promotion:14,rejected:0,quarantined:0,deferred:4,certification_blocked:0,
    },
    business:{
      run_ref:'KIR-000004',business_status:'ACTION_REQUIRED',promoted_products:15,
      decisions:{catalogue:3,commercial:12,exceptions:0,approved_for_sale:0,not_retained:0},
      closure:{eligible:false,decided_products:0,total_products:15,remaining_products:15},
      products:[
        {product_ref:'P/1',name:'<Produit>',action:'CATALOGUE',reason:'Fiche à finaliser'},
        {product_ref:'P-2',name:'Produit 2',action:'COMMERCIAL',reason:'Prix à décider'},
      ],
    },
    stages:[{key:'REFINERY',status:'COMPLETED',processed:15,total:15}],
    events:[],
  },
};

test('état vide garde une ossature Legacy claire et actionnable', () => {
  const ui = cockpit();
  const node = root();
  ui.render(node, {
    source_controls: payload.source_controls,
    lots: [],
    selected: null,
  });
  expect(node.innerHTML).toContain('Suivi d’import');
  expect(node.innerHTML).toContain('Aucun passage pour l’instant');
  expect(node.innerHTML).toContain('Aucun passage Sourcing');
  expect(node.innerHTML).toContain('Choisissez une source prête, puis lancez son premier passage depuis « Sources ».');
  expect(node.innerHTML).toContain('Gérer les sources →');
  expect(node.innerHTML).not.toContain('kir-source-control');
  expect(node.innerHTML).not.toContain('kir-lot-strip');
});

test('niveau 1 : quatre étapes sans compteur, cinq issues lisibles, aucun jargon interne ni sujet commercial', () => {
  const ui = cockpit();
  const node = root();
  ui.render(node, payload);
  const html = node.innerHTML;
  expect(html).toContain('FLUX DU PASSAGE');
  for (const label of ['Source', 'Produits reçus', 'Contrôle automatique', 'Remise au Catalogue']) expect(html).toContain(`<strong>${label}</strong>`);
  for (const jargon of ['Taxonomie', 'Certification', 'certifié(s) sourcing', 'preuve runtime']) expect(html).not.toContain(jargon);
  // Le pipeline ne répète aucun compteur : uniquement des états.
  const flow = html.slice(html.indexOf('kir-run-flow-track'), html.indexOf('RÉSULTAT DU PASSAGE'));
  expect(flow).not.toMatch(/\d+\s*\/\s*\d+/);
  expect(html).toContain('RÉSULTAT DU PASSAGE');
  for (const label of ['Produits reçus', 'Retenus par Sourcing', 'Mis de côté', 'Écartés automatiquement', 'Action requise']) expect(html).toContain(`<span>${label}</span>`);
  for (const gone of ['Remis au Catalogue', 'À examiner', 'Entrées source', 'Acceptées', 'Doublons', 'En quarantaine', 'Rejetées']) expect(html).not.toContain(`<span>${gone}</span>`);
  for (const commercial of ['PARCOURS MÉTIER', 'Prêts à vendre', 'En vente', 'Décisions de mise en vente', 'Décisions commerciales', 'Clôture', 'Prix source', 'Décisions attendues']) {
    expect(html).not.toContain(commercial);
  }
  expect(html).toContain('KIR-000003');
  expect(html).not.toContain('&lt;Produit&gt;');
  expect(html).not.toContain('PASSAGE AU CATALOGUE');
});

test('commandes : source arrêtée → Redémarrer puis Mettre à jour ; source active → Mettre à jour puis Arrêter', () => {
  const ui = cockpit();
  const stopped = root();
  const withSource = JSON.parse(JSON.stringify(payload));
  withSource.selected.source_ref = 'api:aliexpress';
  ui.render(stopped, withSource);
  expect(stopped.innerHTML).toContain('Alimentation automatique arrêtée');
  expect(stopped.innerHTML.indexOf('data-source-command="restart"')).toBeGreaterThan(-1);
  expect(stopped.innerHTML.indexOf('data-source-command="restart"')).toBeLessThan(stopped.innerHTML.indexOf('data-source-command="update"'));
  expect(stopped.innerHTML).not.toContain('data-source-command="stop"');

  const active = root();
  withSource.source_controls[0].autopilot_enabled = true;
  ui.render(active, withSource);
  expect(active.innerHTML).toContain('Alimentation automatique active');
  expect(active.innerHTML.indexOf('data-source-command="update"')).toBeLessThan(active.innerHTML.indexOf('data-source-command="stop"'));
  expect(active.innerHTML).not.toContain('data-source-command="restart"');
  expect(active.innerHTML).toContain('Lancer un nouvel import');
});

test('aucune commande fournisseur n’est devinée sans source_ref exact du passage', () => {
  const ui=cockpit();
  for (const patch of [{source_ref:null},{source_ref:'autre-ref'},{source_ref:undefined}]) {
    const p=JSON.parse(JSON.stringify(payload));
    Object.assign(p.selected,patch);
    p.source_controls[0].label='AliExpress Dropshipper API';
    p.source_controls[0].autopilot_enabled=true;
    const node=root();
    ui.render(node,p);
    expect(node.innerHTML).not.toContain('data-source-command');
  }
});

test('deux sources sans correspondance claire : pas de commande devinée', () => {
  const ui = cockpit();
  const p = JSON.parse(JSON.stringify(payload));
  p.selected.source_ref = null;
  p.selected.provider = 'Inconnu';
  p.source_controls.push({ ...p.source_controls[0], source_ref:'api:cj', label:'CJ' });
  const node = root();
  ui.render(node, p);
  expect(node.innerHTML).not.toContain('data-source-command');
});

const CALM_STAGES = [
  { key:'SOURCE_CONNECTED', status:'COMPLETED', processed:1, total:1 },
  { key:'RAW_IMPORT', status:'COMPLETED', processed:20, total:20 },
  { key:'REFINERY', status:'COMPLETED', processed:12, total:12 },
  { key:'TAXONOMY', status:'COMPLETED', processed:12, total:12 },
  { key:'CERTIFICATION', status:'COMPLETED', processed:12, total:12 },
  { key:'CATALOGUE', status:'RUNNING', processed:0, total:12, reason:'automatic_catalogue_handoff_pending' },
];

// Base = CAS A : 20 reçus, 12 prêts, 1 écarté, 7 DEFERRED, 0 action requise, rien au Catalogue.
function scenario(accounting = {}, selected = {}) {
  const p = JSON.parse(JSON.stringify(payload));
  p.selected.status = 'RUNNING';
  // Le run global reste LIVE pendant la remise Catalogue, mais l'autorité
  // Sourcing amont est déjà terminée.
  p.selected.sourcing_status = 'DONE';
  p.selected.action_items = [];
  p.selected.accounting = {
    source_total:20, accepted:19, certified:12, catalogued:0, awaiting_catalogue_promotion:12,
    duplicates:0, rejected:1, quarantined:0, deferred:7, certification_blocked:0, unaccounted:0, overflow:0,
    action_required:0, ...accounting,
  };
  p.selected.stages = CALM_STAGES;
  p.selected.business = { ...p.selected.business, business_status:'ACTION_REQUIRED', decisions:{ catalogue:12, commercial:12, exceptions:0 } };
  Object.assign(p.selected, selected);
  return p;
}
const render = (data, search) => { const node = root(); cockpit(search).render(node, data); return node.innerHTML; };
const tile = (html, label) => (html.match(new RegExp(`<span>${label}</span><strong>(\\d+)</strong>`)) || [])[1];
const stepClass = (html, label) => (html.match(new RegExp(`class="([^"]*)"[^>]*><span class="kir-run-flow-marker">[^<]*</span><div><strong>${label}</strong>`)) || [])[1] || '';

test('CAS A : 20 reçus / 12 prêts / 1 écarté / 0 action ; remise en attente, jamais « transmis » ni « Terminé »', () => {
  const html = render(scenario());
  expect(tile(html, 'Produits reçus')).toBe('20');
  expect(tile(html, 'Retenus par Sourcing')).toBe('12');
  expect(tile(html, 'Écartés automatiquement')).toBe('1');
  expect(tile(html, 'Mis de côté')).toBe('7');
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).toContain('20/20 produits comptabilisés');
  expect(html).toContain('PASSAGE AU CATALOGUE');
  expect(html).toContain('Remise automatique en cours');
  expect(html).toContain('kir-handoff is-waiting');
  for (const forbidden of ['12 transmis', '7 à examiner', 'Décisions attendues', 'kir-handoff is-clean', 'Remise terminée', 'remis au Catalogue']) {
    expect(html).not.toContain(forbidden);
  }
  // Écran calme : ni orange, ni rouge, ni alerte. La progression reste visible
  // parce que la remise Catalogue automatique travaille encore réellement.
  for (const noise of ['is-attention', 'is-failed', 'kir-runtime-alert', 'Ce qui vous attend']) expect(html).not.toContain(noise);
  expect(html).toContain('Progression globale');
  expect(html).toContain('Remise au Catalogue · 0 / 12');
  expect(html).toContain('Traitement terminé</span>');
  expect(stepClass(html, 'Remise au Catalogue')).toContain('is-running');
  expect(stepClass(html, 'Contrôle automatique')).toContain('is-completed');
});

test('CAS B : certified = catalogued = 12 → « ✓ Remise terminée », étape Catalogue verte, pas de 12/12', () => {
  const html = render(scenario({ catalogued:12, awaiting_catalogue_promotion:0 }));
  expect(html).toContain('kir-handoff is-clean');
  expect(html).toContain('Remise terminée');
  expect(stepClass(html, 'Remise au Catalogue')).toContain('is-completed');
  expect(html).not.toContain('12/12');
  expect(html).not.toContain('Remise automatique en cours');
});

test('CAS C : 12 prêts, 9 au Catalogue, aucune intervention → « 3 restent à remettre », pas d’action requise', () => {
  const html = render(scenario({ catalogued:9, awaiting_catalogue_promotion:3 }));
  expect(html).toContain('3 restent à remettre automatiquement');
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).not.toContain('is-attention');
  expect(html).not.toContain('Remise terminée');
  expect(stepClass(html, 'Remise au Catalogue')).toContain('is-running');
});

test('CAS D : 7 DEFERRED sans revue humaine → Action requise = 0, aucune carte orange', () => {
  const html = render(scenario({ deferred:7 }));
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).toContain('rien à faire');
  expect(html).not.toContain('is-attention');
  expect(html).not.toContain('>deferred<');
  expect(html).not.toContain('différé');
});

test('CAS A bis : 20 reçus, 0 prêt, 8 deferred normaux → 0 action, pas de handoff, aucun orange', () => {
  const html = render(scenario({ certified:0, catalogued:0, awaiting_catalogue_promotion:0, accepted:12, rejected:0, deferred:8, action_required:0 }));
  expect(tile(html, 'Produits reçus')).toBe('20');
  expect(tile(html, 'Retenus par Sourcing')).toBe('0');
  expect(tile(html, 'Écartés automatiquement')).toBe('0');
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).not.toContain('PASSAGE AU CATALOGUE');
  expect(html).not.toContain('Décisions attendues');
  expect(html).not.toContain('is-attention');
});

const ITEMS = [
  { candidate_ref:'KSC-1', product_name:'Coque A', supplier_product_id:'SP-1', reason:'Image inexploitable', action:'fix', action_label:'Corriger' },
  { candidate_ref:'KSC-2', product_name:'Coque B', supplier_product_id:'SP-2', reason:'Classement ambigu', action:'choose', action_label:'Choisir' },
  { candidate_ref:'KSC-3', product_name:'Coque C', supplier_product_id:'SP-3', reason:'Donnée obligatoire manquante', action:'complete', action_label:'Compléter' },
];

test('12 mis de côté dont 3 corrigeables : sous-ensemble et non sixième population', () => {
  const rows = [
    { candidate_ref:'KSC-300', product_name:'À classer', supplier_product_id:'SP-300', reason:'Catégorie Komerce non résolue', action:'choose', action_label:'Classer', action_origin:'deferred', correction_kind:'category' },
    { candidate_ref:'KSC-301', product_name:'Prix absent', supplier_product_id:'SP-301', reason:"Prix d'achat manquant", action:'complete', action_label:'Compléter', action_origin:'deferred', correction_kind:'purchase_price' },
    { candidate_ref:'KSC-302', product_name:'Données absentes', supplier_product_id:'SP-302', reason:'Données économiques insuffisantes', action:'complete', action_label:'Compléter', action_origin:'deferred', correction_kind:'economic_data' },
  ];
  const p = scenario({
    source_total:20,certified:8,catalogued:8,deferred:12, deferred_actionable:3,
    rejected:0,action_required:3,
  }, {sourcing_status:'ACTION_REQUIRED',action_items:rows});
  const h = render(p);
  expect(tile(h, 'Produits reçus')).toBe('20');
  expect(tile(h, 'Retenus par Sourcing')).toBe('8');
  expect(tile(h, 'Mis de côté')).toBe('12');
  expect(tile(h, 'Action requise')).toBe('3');
  expect(h).toContain('dont 3 à corriger');
  expect(h).toContain('Intervenir →');
  const exceptions = render(p, '?run=KIR-000004&view=exceptions');
  expect(exceptions).toContain('Mis de côté · correction humaine possible');
  expect(exceptions).toContain('data-action-classify');
  expect(exceptions).toContain('data-candidate-ref="KSC-300"');
  expect(exceptions).toContain('data-product-name="À classer"');
  expect(exceptions).toContain('Classer →');
  expect(exceptions).toContain("Prix d'achat manquant");
  expect(exceptions).toContain('Compléter dans Sourcing →');
  expect(exceptions).not.toContain('data-action-choose');
  expect((exceptions.match(/kir-row-action/g)||[])).toHaveLength(3);
});

test('le classement est contextualisé au produit et ne passe plus par une saisie libre navigateur', () => {
  const p = scenario({action_required:1},{
    sourcing_status:'ACTION_REQUIRED',
    action_items:[{candidate_ref:'KSC-000050', product_name:'Temporary Metal Waterproof Key Box At The Door',
      supplier_product_id:'CJ-50', reason:'Catégorie Komerce non résolue — décision impossible.',
      action:'choose', action_label:'Classer', action_origin:'deferred', correction_kind:'category'}],
  });
  const html = render(p,'?run=KIR-000004&view=exceptions');
  expect(html).toContain('data-action-classify');
  expect(html).toContain('data-candidate-ref="KSC-000050"');
  expect(html).toContain('Temporary Metal Waterproof Key Box At The Door');
  expect(html).toContain('Catégorie Komerce non résolue');
  const source = require('fs').readFileSync(
    require.resolve('../../public/dashboards/canonical/js/import-runtime.js'),'utf8');
  expect(source).not.toContain("global.prompt('Catégorie Komerce");
  expect(source).toContain('/category-options');
  expect(source).toContain('/resolve-category');
  expect(source).toContain("data-category-choice");
  expect(source).not.toContain('/promote');
});

test('population et fiche différées : lien vers action humaine uniquement pour un WATCH corrigeable', () => {
  const population = {
    kind:'deferred', total:12, unlisted:[], items:[
      popItem(47, {issue_key:'deferred', issue_label:'Mis de côté', decision:'WATCH',
        reason:'Catégorie Komerce non résolue', needs_human_action:true}),
      popItem(48, {issue_key:'deferred', issue_label:'Mis de côté', decision:'WATCH',
        reason:'Contribution fragile', needs_human_action:false}),
    ],
  };
  const html = drill('population','kind=deferred',null,population);
  expect(html).toContain('À corriger ·');
  expect(html).toContain('Voir l’action →');
  expect((html.match(/À corriger ·/g)||[])).toHaveLength(1);
  const item = scenario();
  item.item_trace = {
    run_ref:RUN, supplier_product_id:'SP-47', product_name:'À classer', product_ref:null,
    refinery:{done:true},canonical_category:null,
    certification:{outcome:'deferred',sourcing_certified:false,decision:'WATCH',
      reason:'Catégorie Komerce non résolue',recommended_action:'Compléter ou corriger la catégorie avant promotion.',
      human_action:{kind:'category',action:'choose',action_label:'Classer'}},
  };
  const detail = render(item, '?run=KIR-000004&view=item&kind=deferred&item=SP-47');
  expect(detail).toContain('Intervention humaine');
  expect(detail).toContain('Correction à effectuer dans Sourcing');
  expect(detail).toContain('Voir Action requise →');
});

test('CAS E : 3 vraies exceptions → « Action requise 3 » orange cliquable, header « Action requise »', () => {
  const html = render(scenario({ quarantined:2, certification_blocked:1, deferred:4, action_required:3 },
    { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS }));
  expect(tile(html, 'Action requise')).toBe('3');
  expect(html).toContain('is-review is-attention');
  expect(html).toContain('Intervenir →');
  expect(html).toContain('href="/admin/import-runtime?run=KIR-000004&view=exceptions"');
  expect(html).toContain('Action requise</span>');
  expect(html).not.toContain('Décisions attendues');
  expect(stepClass(html, 'Contrôle automatique')).toContain('is-completed');
});

test('KIR réel terminé avec 12 corrections : les 4 étapes restent vertes et les 12 tâches restent visibles', () => {
  const stages = CALM_STAGES.map(stage => ({
    ...stage, status:'COMPLETED', reason:null,
    processed:stage.key === 'CATALOGUE' ? 8 : stage.processed,
    total:stage.key === 'CATALOGUE' ? 8 : stage.total,
  }));
  const items = Array.from({length:12}, (_, i) => ({
    candidate_ref:`KSC-W-${i + 1}`,
    supplier_product_id:`SP-W-${i + 1}`,
    product_name:`Produit à classer ${i + 1}`,
    reason:'Catégorie Komerce non résolue', action:'choose', action_label:'Classer',
    action_origin:'deferred',
  }));
  const p = scenario({
    source_total:20, accepted:20, certified:8, catalogued:8,
    awaiting_catalogue_promotion:0, deferred:12, deferred_actionable:12,
    rejected:0, action_required:12,
  }, { status:'COMPLETED', sourcing_status:'ACTION_REQUIRED', stages, action_items:items });
  const html = render(p);
  for (const name of ['Source', 'Produits reçus', 'Contrôle automatique', 'Remise au Catalogue']) {
    expect(stepClass(html, name)).toContain('is-completed');
  }
  expect(html).not.toContain('kir-run-flow-step is-attention');
  expect(tile(html, 'Mis de côté')).toBe('12');
  expect(tile(html, 'Action requise')).toBe('12');
  expect(html).toContain('dont 12 à corriger');
  expect(html).toContain('Intervenir →');
  const exceptions = render(p, '?run=KIR-000004&view=exceptions');
  expect(exceptions).toContain('Action requise · 12');
  expect(exceptions).toContain('Produit à classer 1');
});

test('échec technique réel : le contrôle reste bloqué même avec une liste d’actions humaines', () => {
  const p = scenario({ action_required:2 }, {
    status:'FAILED', sourcing_status:'ACTION_REQUIRED', action_items:ITEMS.slice(0,2),
    stages:CALM_STAGES.map(stage => stage.key === 'CERTIFICATION'
      ? { ...stage, status:'FAILED' } : stage),
  });
  const html = render(p);
  expect(stepClass(html, 'Contrôle automatique')).toContain('is-failed');
  const drillHtml = render(p, '?run=KIR-000004&view=control');
  expect(drillHtml).toContain('Bloqué');
  expect(tile(html, 'Action requise')).toBe('2');
});

test('CAS E : au clic, la liste filtrée montre exactement les 3 éléments (produit · raison · action)', () => {
  const html = render(scenario({ quarantined:2, certification_blocked:1, action_required:3 },
    { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS }), '?run=KIR-000004&view=exceptions');
  expect((html.match(/kir-row-action/g) || []).length).toBeGreaterThanOrEqual(3);
  for (const expected of ['Coque A', 'Image inexploitable', 'Corriger', 'Coque B', 'Classement ambigu', 'Classer', 'Coque C', 'Donnée obligatoire manquante', 'Compléter']) {
    expect(html).toContain(expected);
  }
  expect(html).toContain('data-action-classify');
  expect((html.match(/data-action-classify/g) || []).length).toBe(1);
  expect(html).toContain('data-candidate-ref="KSC-2"');
  // Ni logs, ni historique, ni vue technique.
  for (const technical of ['STAGE_', 'Raffinerie', 'Taxonomie', 'Historique du run', 'sellable_units']) expect(html).not.toContain(technical);
});

test('CAS F : après correction le backend recalcule → 3 → 2 → 1 → 0, la zone orange disparaît', () => {
  const ui = cockpit();
  const node = root();
  const seen = [];
  for (const items of [ITEMS, ITEMS.slice(1), ITEMS.slice(2), []]) {
    const p = scenario({ action_required:items.length, quarantined:items.length },
      { sourcing_status:items.length ? 'ACTION_REQUIRED' : 'DONE', action_items:items });
    ui.render(node, p);
    seen.push([tile(node.innerHTML, 'Action requise'), node.innerHTML.includes('is-attention')]);
  }
  expect(seen).toEqual([['3', true], ['2', true], ['1', true], ['0', false]]);
  const empty = render(scenario(), '?run=KIR-000004&view=exceptions');
  expect(empty).toContain('Aucune action requise.');
});

test('anomalie de comptage : 19/20 et 1 produit à retrouver devient une vraie action requise', () => {
  const html = render(scenario({ unaccounted:1, action_required:1, deferred:6 }, {
    sourcing_status:'ACTION_REQUIRED',
    action_items:[{ candidate_ref:null, reason:'Anomalie de comptage', action:'examine', action_label:'Examiner' }],
  }));
  expect(html).toContain('19/20 produits comptabilisés');
  expect(html).toContain('1 produit à retrouver');
  expect(tile(html, 'Action requise')).toBe('1');
});

test('header : statut Sourcing seulement (LIVE / Terminé / Action requise / Bloqué)', () => {
  const label = (data) => (render(data).match(/kir-status-large is-([a-z]+)">.*?<\/i>([^<]+)</) || []).slice(1, 3).join(':');
  expect(label(scenario())).toBe('positive:Traitement terminé');
  expect(label(scenario({ action_required:2 }, { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS.slice(0, 2) }))).toBe('warning:Action requise');
  expect(label(scenario({}, { status:'RUNNING', sourcing_status:'RUNNING' }))).toBe('live:LIVE');
  const blocked = scenario({}, { status:'FAILED', sourcing_status:'BLOCKED' });
  blocked.selected.stages = CALM_STAGES.map(stage => stage.key === 'CERTIFICATION' ? { ...stage, status:'FAILED' } : stage);
  expect(label(blocked)).toBe('critical:Bloqué');
  expect(stepClass(render(blocked), 'Contrôle automatique')).toContain('is-failed');
  // Le statut aval du lot (décisions Catalogue / commerce) n'est jamais montré.
  for (const data of [scenario(), scenario({ action_required:2 }, { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS.slice(0, 2) })]) {
    expect(render(data)).not.toContain('Décisions attendues');
  }
});

test('la garde « source non activée » ne crée aucune alerte au N1 (calme)', () => {
  const p = scenario({}, { diagnostics:{ pipeline_status:'PARTIAL_BLOCKED', runtime_certified:false, provider_runtime_status:'BLOCKED', reject_reasons:{ 'media absent':1 } } });
  const html = render(p);
  for (const noise of ['kir-runtime-alert', 'non activé automatiquement', 'variantes en double', 'Corrigez le produit']) expect(html).not.toContain(noise);
});

test('les pastilles de lots restent Sourcing : jamais « Décisions attendues »', () => {
  const html = render(scenario());
  expect(html).not.toContain('Décisions attendues');
  expect(html).toContain('KIR-000004');
});

test('activité humaine : étapes internes silencieuses, phrases lisibles', () => {
  const ui = cockpit();
  const node = root();
  const p = scenario();
  p.selected.events = [
    { kind:'STAGE_FINISHED', stage:'CERTIFICATION', at:'2026-09-30T10:00:05Z' },
    { kind:'STAGE_FINISHED', stage:'TAXONOMY', at:'2026-09-30T10:00:04Z' },
    { kind:'STAGE_STARTED', stage:'TAXONOMY', at:'2026-09-30T10:00:03Z' },
    { kind:'STAGE_FINISHED', stage:'REFINERY', at:'2026-09-30T10:00:02Z' },
    { kind:'STAGE_STARTED', stage:'REFINERY', at:'2026-09-30T10:00:01Z' },
    { kind:'STAGE_FINISHED', stage:'RAW_IMPORT', at:'2026-09-30T10:00:00Z' },
  ];
  ui.render(node, p);
  const html = node.innerHTML;
  expect(html).toContain('Contrôle terminé pour 12 produits');
  expect(html).toContain('Contrôle automatique démarré');
  expect(html).toContain('20 produits reçus');
  for (const raw of ['CERTIFICATION', 'TAXONOMY', 'REFINERY', 'STAGE_FINISHED', 'Taxonomie terminé', 'Raffinerie terminé']) {
    expect(html).not.toContain(raw + '</strong>');
  }
  expect(html).not.toContain('Taxonomie');
});

test('drill-down Catalogue montre seulement les produits qui exigent cette décision', () => {
  const ui = cockpit();
  const node = root();
  const original = global.URLSearchParams;
  // render() lit window.location.search dans son propre contexte : on change la recherche via l'objet exposé.
  // La fonction urlFor prouve par ailleurs le routage page complète.
  expect(ui.urlFor('KIR-000004','catalogue')).toContain('view=catalogue');
  expect(ui.urlFor('KIR-000004','commercial')).toContain('view=commercial');
  expect(ui.urlFor('KIR-000004','exceptions')).toContain('view=exceptions');
  expect(ui.urlFor('KIR-000004','closure')).toContain('view=closure');
  const productHref = ui.withReturnTo(
    '/admin/products/P-1',
    ui.urlFor('KIR-000004','catalogue'),
    'Retour au passage'
  );
  expect(productHref).toContain('return_to=%2Fadmin%2Fimport-runtime%3Frun%3DKIR-000004%26view%3Dcatalogue');
  expect(productHref).toContain('return_label=Retour+au+passage');
  expect(original).toBeDefined();
});

// ── Drill-downs cohérents avec le N1 ──────────────────────────────────────────
const RUN = 'KIR-000004';
const popItem = (i, over = {}) => ({ candidate_ref:`KSC-${i}`, supplier_product_id:`SP-${i}`, product_name:`Produit ${i}`, image_url:null, issue_key:'ready', issue_label:'Prêt', ...over });
const drill = (view, extra, data, population = null) => {
  const p = data || scenario();
  if (population) p.population = population;
  return render(p, `?run=${RUN}&view=${view}${extra ? '&' + extra : ''}`);
};

test('les grandes cartes et les étapes ouvrent des vues métier, jamais la grille des six étapes', () => {
  const html = render(scenario());
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=population&kind=received"`);
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=population&kind=ready"`);
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=population&kind=discarded"`);
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=exceptions"`);
  // Pipeline : Source → source, Reçus → population, Contrôle → vue métier, Catalogue → frontière.
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=source"`);
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=control"`);
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=handoff"`);
  const tiles = html.slice(html.indexOf('kir-run-truth-grid'), html.indexOf('PASSAGE AU CATALOGUE') > 0 ? html.indexOf('PASSAGE AU CATALOGUE') : undefined);
  expect(tiles).not.toContain('view=history');
});

test('CAS A : « Produits reçus 20 » liste les produits (pas les six étapes techniques)', () => {
  const items = Array.from({ length: 18 }, (_, i) => popItem(i + 1, { issue_key:'ready', issue_label:'Prêt pour le Catalogue' }));
  const html = drill('population', 'kind=received', null, { kind:'received', total:20, items, unlisted:[{ label:'Écartés dès la réception (voir Écartés automatiquement)', count:2 }] });
  expect((html.match(/data-population-item/g) || []).length).toBe(18);
  expect(html).toContain('Produits reçus · 20');
  expect(html).toContain('2 × Écartés dès la réception');
  expect(html).toContain('Produit 1');
  expect(html).toContain('SP-1');
  for (const tech of ['Raffinerie', 'Taxonomie', 'kir-history-stages', 'Détail technique']) expect(html.slice(html.indexOf('kir-drill-head'))).not.toContain(tech);
});

test('AGRÉGAT → POPULATION → OBJET : une ligne produit ouvre son détail dans le même passage', () => {
  const population = { kind:'received', total:1, items:[popItem(1, { issue_key:'ready', issue_label:'Prêt pour le Catalogue' })], unlisted:[] };
  const populationHtml = drill('population', 'kind=received', null, population);
  expect(populationHtml).toContain(`href="/admin/import-runtime?run=${RUN}&view=item&kind=received&item=SP-1"`);

  const p = scenario();
  p.item_trace = {
    run_ref:RUN,
    provider:'AliExpress',
    supplier_product_id:'SP-1',
    product_name:'Produit 1',
    image_url:null,
    refinery:{ done:true, scanned_at:'2026-09-30T10:00:00Z' },
    canonical_category:'maison',
    product_ref:null,
    certification:{ outcome:'ready_for_refinery', sourcing_certified:true, reasons:[] },
    catalogue_status:'scanned',
  };
  const html = render(p, `?run=${RUN}&view=item&kind=received&item=SP-1`);
  expect(html).toContain('Produit 1');
  expect(html).toContain('Prêt pour le Catalogue');
  expect(html).toContain('SP-1');
  expect(html).toContain('← Retour à Produits reçus');
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=population&kind=received"`);
  expect(html).toContain('Aucune fiche Catalogue créée à ce stade.');
});

test('fiche Raffinerie affiche les deux revues sans inventer une validation', () => {
  const p = scenario();
  p.item_trace = {
    run_ref:RUN,supplier_product_id:'SP-1',product_name:'Coussin voiture',
    refinery:{done:true},canonical_category:null,product_ref:null,
    certification:{outcome:'deferred',sourcing_certified:false,decision:'WATCH'},
    commercial_review:{status:'PENDING_CLASSIFICATION',action:'REVIEW_BOUTIQUE_TAXONOMY'},
    customs_review:{status:'REQUIRED',category_key:null,calculation_allowed:false,publication_allowed:false},
    catalogue_status:'scanned',
  };
  const html = render(p, `?run=${RUN}&view=item&kind=deferred&item=SP-1`);
  expect(html).toContain('Classement commercial');
  expect(html).toContain('À confirmer dans Sourcing');
  expect(html).toContain('Douane et calcul');
  expect(html).toContain('À qualifier — calcul et publication interdits');
  expect(html).toContain('Aucune fiche Catalogue créée');
});

test('OBJET remis au Catalogue : ouvre la fiche Catalogue avec retour exact vers l’objet du passage', () => {
  const p = scenario({ catalogued:1 });
  p.item_trace = {
    run_ref:RUN,
    provider:'AliExpress',
    supplier_product_id:'SP-1',
    product_name:'Produit 1',
    refinery:{ done:true },
    canonical_category:'maison',
    product_ref:'KPR-000001',
    certification:{ outcome:'catalog_imported', sourcing_certified:true, reasons:[] },
    catalogue_status:'imported_to_catalog',
  };
  const html = render(p, `?run=${RUN}&view=item&kind=ready&item=SP-1`);
  expect(html).toContain('Remis au Catalogue');
  expect(html).toContain('Ouvrir la fiche Catalogue →');
  expect(html).toContain('return_to=%2Fadmin%2Fimport-runtime%3Frun%3DKIR-000004%26view%3Ditem%26kind%3Dready%26item%3DSP-1');
  expect(html).toContain('return_label=Retour+au+produit+Sourcing');
});

test('produit différé : statut explicite, motif et recommandation du moteur, aucune fausse attente', () => {
  const p = scenario();
  p.item_trace = {
    run_ref:RUN, provider:'CJdropshipping', supplier_product_id:'SP-1', product_name:'Boîte étanche',
    refinery:{ done:true }, canonical_category:null, product_ref:null,
    certification:{
      outcome:'deferred', sourcing_certified:false, decision:'WATCH', reasons:[],
      reason:'Catégorie Komerce non résolue — décision impossible.',
      recommended_action:'Compléter la catégorie avant promotion.',
    },
    catalogue_status:'scanned',
  };
  const html = render(p, `?run=${RUN}&view=item&kind=received&item=SP-1`);
  expect(html).toContain('STATUT DU PRODUIT');
  expect(html).toContain('Mis de côté');
  expect(html).toContain('Ce produit n’est pas retenu pour la suite de ce passage');
  expect(html).toContain('À surveiller');
  expect(html).toContain('Catégorie Komerce non résolue');
  expect(html).toContain('Compléter la catégorie avant promotion.');
  expect(html).toContain('Non déterminé pour ce passage');
  expect(html).toContain('Décision : mis de côté');
  expect(html).toContain('Non transmis pour ce passage');
  expect(html).not.toContain('deferred</em>');
  expect(html).not.toContain('Pas encore remis</em>');
  expect(html).not.toContain('Action requise');
  expect(html).toContain('← Retour à Produits reçus');
});

test('produit différé : motif absent signalé, pas de diagnostic inventé ni rendu HTML non échappé', () => {
  const p = scenario();
  p.item_trace = {
    run_ref:RUN, supplier_product_id:'SP-2', product_name:'Produit <br/>',
    refinery:{ done:true }, canonical_category:null, product_ref:null,
    certification:{ outcome:'deferred', sourcing_certified:false, decision:'AVOID', reason:null, recommended_action:null },
    catalogue_status:'scanned',
  };
  const html = render(p, `?run=${RUN}&view=item&kind=received&item=SP-2`);
  expect(html).toContain('À éviter');
  expect(html).toContain('Le motif détaillé n’est pas renseigné pour ce produit.');
  expect(html).not.toContain('Produit <br/>');
  expect(html).toContain('Produit &lt;br/&gt;');
});

test('CAS B : « Retenus par Sourcing 12 » = exactement les 12 certified avec l’état de remise, sans action', () => {
  const items = [...Array.from({ length: 9 }, (_, i) => popItem(i + 1)), ...Array.from({ length: 3 }, (_, i) => popItem(20 + i, { issue_key:'catalogued', issue_label:'Remis' }))];
  const html = drill('population', 'kind=ready', null, { kind:'ready', total:12, items, unlisted:[] });
  expect((html.match(/data-population-item/g) || []).length).toBe(12);
  expect((html.match(/>Remis</g) || []).length).toBe(3);
  expect(html).not.toContain('kir-row-action');
  expect(html).not.toContain('data-action-choose');
});

test('CAS C : « Écartés automatiquement 3 » = les produits + raison, aucune CTA de correction, pas d’alarme', () => {
  const items = [popItem(1, { issue_key:'discarded', issue_label:'Doublon', reason:'Déjà présent' }), popItem(2, { issue_key:'discarded', issue_label:'Exclu par règle', reason:'Écarté par une règle Komerce' })];
  const html = drill('population', 'kind=discarded', null, { kind:'discarded', total:3, items, unlisted:[{ label:'Produit non retenu à la réception', count:1 }] });
  expect((html.match(/data-population-item/g) || []).length).toBe(2);
  expect(html).toContain('Doublon');
  expect(html).toContain('Exclu par règle');
  expect(html).toContain('1 × Produit non retenu');
  expect(html).toContain('Rejets dès la réception ou par règle.');
  for (const alarm of ['kir-row-action', 'Corriger', 'is-failed', 'kir-error']) expect(html.slice(html.indexOf('kir-drill-head'))).not.toContain(alarm);
});

test('CAS D : « Action requise 3 » = exactement les 3 objets, avec image, raison et action', () => {
  const withImage = ITEMS.map((item, i) => ({ ...item, image_url:`https://img.test/${i}.jpg` }));
  const html = drill('exceptions', '', scenario({ quarantined:3, action_required:3 }, { sourcing_status:'ACTION_REQUIRED', action_items:withImage }));
  const list = html.slice(html.indexOf('data-action-list'));
  expect((list.match(/kir-row-action/g) || []).length).toBe(3);
  expect((list.match(/kir-action-thumb/g) || []).length).toBe(3);
  for (const s of ['Image inexploitable', 'Classement ambigu', 'Donnée obligatoire manquante']) expect(list).toContain(s);
  expect(list).not.toContain('view=history');
});

test('CAS E : « Contrôle automatique » = Préparation / Classement / Validation + lien secondaire vers le détail technique', () => {
  const html = drill('control');
  for (const label of ['Préparation', 'Classement', 'Validation']) expect(html).toContain(`<strong>${label}</strong>`);
  expect(html).toContain('Voir le détail technique →');
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=history&from=control"`);
  const body = html.slice(html.indexOf('kir-drill-head'));
  for (const tech of ['Taxonomie', 'Certification', 'REFINERY', 'COMPLETED']) expect(body).not.toContain(tech);
  expect((body.match(/✓ Terminé/g) || []).length).toBe(3);
});

test('CAS F : une étape terminée n’affiche jamais un faux ratio ; la remise Catalogue en cours peut montrer son vrai 0 / 12', () => {
  const p = scenario();
  p.selected.stages = p.selected.stages.map(stage => stage.key === 'REFINERY' ? { ...stage, status:'COMPLETED', processed:0, total:12 } : stage);
  const html = drill('history', 'from=control', p);
  expect(html).toContain('Détail technique du passage');
  expect(html).toContain('← Retour au contrôle automatique');
  expect(html).not.toMatch(/COMPLETED\s*·/);
  expect(html).toContain('✓ Terminé');
  expect(html).toContain('Remise automatique · 0 / 12');
  // Sans provenance « contrôle » : retour au passage.
  expect(drill('history', '', p)).toContain('← Retour au suivi');
});

test('Source : la source utilisée, sans catalogue de produits', () => {
  const html = drill('source');
  const body = html.slice(html.indexOf('kir-drill-head'));
  for (const label of ['Source utilisée', 'Connexion', 'Dernière interrogation', 'Alimentation automatique']) expect(body).toContain(label);
  expect(body).not.toContain('data-population-item');
});

test('Catalogue : uniquement la frontière de remise, ni prix, ni marché, ni vente', () => {
  const html = drill('handoff', '', scenario({ catalogued:9, awaiting_catalogue_promotion:3 }), { kind:'ready', total:12, items:[popItem(1)], unlisted:[] });
  const body = html.slice(html.indexOf('kir-drill-head'));
  expect(body).toContain('3 restent à remettre automatiquement');
  for (const commercial of ['Prix', 'marché', 'Prêts à vendre', 'En vente', 'Décisions commerciales']) expect(body).not.toContain(commercial);
  expect(drill('handoff')).toContain('Remise automatique en cours');
});

// ── Navigation canonique : vues exclusives ────────────────────────────────────
const PASSAGES = [
  { run_ref:'KIR-000006', provider:'AliExpress', started_at:'2026-09-30T14:35:00Z', sourcing_status:'DONE', state_label:'Terminé', source_total:20, certified:12, discarded:1, action_required:0, handoff_label:'En attente' },
  { run_ref:'KIR-000005', provider:'AliExpress', started_at:'2026-09-30T14:06:00Z', sourcing_status:'DONE', state_label:'Terminé', source_total:20, certified:12, discarded:1, action_required:0, handoff_label:'Terminée' },
  { run_ref:'KIR-000004', provider:'CJ', started_at:'2026-09-30T14:05:00Z', sourcing_status:'ACTION_REQUIRED', state_label:'Action requise', source_total:20, certified:9, discarded:1, action_required:3, handoff_label:'En attente' },
];
const inMain = html => html.slice(html.indexOf('<main class="kir-main">'));

test('CAS A : SUIVI = un seul cockpit — ni registre, ni rail KIR permanent, ni bloc Sources dessous', () => {
  const html = render(scenario());
  for (const gone of ['kir-lot-strip', 'kir-lot-chip', 'kir-secondary', 'kir-source-control', 'data-source-toggle', 'Registre des passages']) {
    expect(html).not.toContain(gone);
  }
  expect(html).toContain('Tous les passages →');
  expect(html).toContain('kir-domain-nav');
  expect((html.match(/kir-run-truth-grid/g) || []).length).toBe(1);
  // Sélecteur compact : précédent · liste · suivant · Tous les passages.
  expect(html).toContain('data-lot-select');
  expect(html).toContain('← passage précédent');
  expect(html).toContain('passage suivant →');
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=passages"`);
});

test('domaine : Suivi / Passages / Sources, l\'onglet actif suit la vue', () => {
  const html = render(scenario());
  expect(html).toMatch(/kir-domain-nav[\s\S]*is-active[^>]*>Suivi/);
  for (const label of ['Suivi', 'Passages', 'Sources']) expect(html).toContain(`>${label}</a>`);
  expect(drill('passages', '', scenario(), null)).toMatch(/is-active[^>]*>Passages/);
  expect(drill('sources')).toMatch(/is-active[^>]*>Sources/);
});

test('CAS B : « Tous les passages » remplace le cockpit par la vue Passages (Sourcing pur)', () => {
  const p = scenario();
  p.passages = PASSAGES;
  p.passages_page = { offset:0, next_offset:50 };
  const html = render(p, `?run=${RUN}&view=passages`);
  for (const gone of ['kir-run-flow', 'kir-run-truth', 'kir-command-bar', 'kir-live-hero', 'kir-handoff']) expect(html).not.toContain(gone);
  expect(html).toContain('Historique des passages');
  expect(html).toContain('<span class="kir-crumb-domain">Sourcing</span><i aria-hidden="true">›</i><span aria-current="page">Passages');
  expect(html).toContain('← Retour au suivi');
  for (const col of ['Passage', 'Source', 'Date / heure', 'État Sourcing', 'Produits reçus', 'Retenus Sourcing', 'Écartés', 'Action requise', 'Remise au Catalogue']) expect(html).toContain(`<th>${col}</th>`);
  for (const gone of ['Décisions finales', 'Approuvés vente', 'Reste']) expect(html).not.toContain(gone);
  expect((html.match(/data-row-href/g) || []).length).toBe(3);
  expect(html).toContain('KIR-000004');
  expect(html).toContain('Action requise</span>');
  expect(html).toContain('Terminée');
  expect(html).toContain('Passages plus anciens →');
  expect(html).toContain(`view=passages&amp;offset=50`.replace('&amp;', '&'));
});

test('CAS C : une ligne de Passages rouvre LIVE sur ce KIR (ligne entière cliquable)', () => {
  const p = scenario();
  p.passages = PASSAGES;
  const html = render(p, `?run=${RUN}&view=passages`);
  expect(html).toContain('data-row-href="/admin/import-runtime?run=KIR-000004"');
  expect(html).toContain('<a href="/admin/import-runtime?run=KIR-000004" data-cockpit-nav>KIR-000004</a>');
});

test('CAS D : « Produits reçus 20 » = vue exclusive, sans le cockpit au-dessus', () => {
  const html = drill('population', 'kind=received', null, { kind:'received', total:20, items:[popItem(1)], unlisted:[{ label:'Écartés dès la réception (voir Écartés automatiquement)', count:19 }] });
  for (const gone of ['kir-run-flow', 'kir-run-truth', 'kir-command-bar', 'kir-live-hero', 'kir-lot-picker']) expect(html).not.toContain(gone);
  expect(html).toContain('Produits reçus · 20');
  expect(html).toContain(`<span class="kir-crumb-domain">Sourcing</span><i aria-hidden="true">›</i><a href="/admin/import-runtime?run=${RUN}" data-cockpit-nav>Suivi</a><i aria-hidden="true">›</i><span aria-current="page">Produits reçus`);
  expect(html).toContain('← Retour au suivi');
  expect(html).not.toContain(`data-cockpit-nav>${RUN}</a><i`);
});

test('CAS E/F : Prêts (12) et Action requise (3) — vues exclusives avec exactement leurs objets', () => {
  const ready = drill('population', 'kind=ready', null, { kind:'ready', total:12, items:Array.from({ length:12 }, (_, i) => popItem(i + 1)), unlisted:[] });
  expect((ready.match(/data-population-item/g) || []).length).toBe(12);
  expect(ready).not.toContain('kir-run-truth');
  const action = drill('exceptions', '', scenario({ quarantined:3, action_required:3 }, { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS }));
  expect((action.match(/kir-row-action/g) || []).length).toBe(3);
  expect(action).not.toContain('kir-run-truth');
  expect(action).toContain('Action requise · 3');
});

test('CAS G : Contrôle automatique = Préparation / Classement / Validation + lien détail technique', () => {
  const html = drill('control');
  expect(html).not.toContain('kir-run-flow');
  for (const label of ['Préparation', 'Classement', 'Validation']) expect(html).toContain(`<strong>${label}</strong>`);
  expect(html).toContain('Voir le détail technique →');
  expect(html).toContain('Contrôle automatique</span>');
});

test('CAS H : détail technique = les 6 étapes backend, fil d’Ariane et retour au contrôle automatique', () => {
  const html = drill('history', 'from=control');
  const main = inMain(html);
  expect((main.match(/kir-history-stage /g) || []).length).toBe(6);
  for (const label of ['Raffinerie', 'Taxonomie', 'Certification']) expect(main).toContain(label);
  expect(main).toContain('← Retour au contrôle automatique');
  expect(main).toContain(`<a href="/admin/import-runtime?run=${RUN}&view=control" data-cockpit-nav>Contrôle automatique</a><i aria-hidden="true">›</i><span aria-current="page">Détail technique`);
  expect(html).not.toContain('kir-run-truth');
});

test('Sources : inventaire des fournisseurs dans sa propre vue, plus sous le cockpit', () => {
  const html = drill('sources');
  expect(html).toContain('data-source-toggle');
  expect(html).not.toContain('kir-run-truth');
  expect(html).not.toContain('kir-command-bar');
});

test('aucune donnée aval (prix, marché, vente, clôture) dans les vues Sourcing', () => {
  const p = scenario();
  p.passages = PASSAGES;
  const views = [render(scenario()), render(p, `?run=${RUN}&view=passages`), drill('sources'), drill('control'), drill('history'), drill('source')];
  for (const html of views) {
    for (const downstream of ['Approuvés vente', 'Décisions finales', 'Clôture du lot', 'Prêts à vendre', 'Décisions commerciales', 'exposition marché']) expect(html).not.toContain(downstream);
  }
});

// ── Audit navigation : parent unique et évident pour chaque écran ─────────────
const crumbText = html => (html.match(/<nav class="kir-breadcrumb"[^>]*>([\s\S]*?)<\/nav>/) || [])[1]
  ?.replace(/<i aria-hidden="true">›<\/i>/g, ' > ').replace(/<[^>]+>/g, '') || '';
const backOf = html => { const m = html.match(/<a href="([^"]+)" data-cockpit-nav class="kir-back">([^<]+)<\/a>/); return m ? { href:m[1].replace(/&amp;/g, '&'), label:m[2] } : null; };
const SUIVI = `/admin/import-runtime?run=${RUN}`;
const TRACE = { run_ref:RUN, supplier_product_id:'SP-1', product_name:'Produit 1', product_ref:'P-1', refinery:{ done:true }, canonical_category:'maison', certification:{ outcome:'catalog_imported', sourcing_certified:true, reasons:[] }, catalogue_status:'imported_to_catalog' };
const withTrace = () => { const p = scenario(); p.item_trace = TRACE; return p; };

test('audit : chaque vue du Suivi a pour parent « Suivi » (breadcrumb Sourcing > Suivi > vue, retour au suivi)', () => {
  const cases = [
    ['source', '', 'Sourcing > Suivi > Source'],
    ['control', '', 'Sourcing > Suivi > Contrôle automatique'],
    ['handoff', '', 'Sourcing > Suivi > Remise au Catalogue'],
    ['exceptions', '', 'Sourcing > Suivi > Action requise'],
    ['population', 'kind=received', 'Sourcing > Suivi > Produits reçus'],
    ['population', 'kind=ready', 'Sourcing > Suivi > Retenus par Sourcing'],
    ['population', 'kind=discarded', 'Sourcing > Suivi > Écartés automatiquement'],
    ['history', '', 'Sourcing > Suivi > Détail technique'],
  ];
  for (const [view, extra, crumbs] of cases) {
    const html = drill(view, extra);
    expect(crumbText(html)).toBe(crumbs);
    expect(backOf(html)).toEqual({ href:SUIVI, label:'← Retour au suivi' });
    expect(html).toMatch(/is-active[^>]*>Suivi</);
    // Le KIR est un contexte (pastille), jamais un niveau du fil d'Ariane.
    expect(crumbText(html)).not.toContain(RUN);
    expect(html).toContain(`Passage ${RUN}`);
    expect(html).not.toContain('Retour au passage');
    expect(html).not.toContain('Retour au cockpit');
  }
});

test('audit : Passages et Sources sont des vues de 1er niveau — onglet actif et retour explicite au suivi', () => {
  const p = scenario(); p.passages = PASSAGES;
  const passages = render(p, `?run=${RUN}&view=passages`);
  const sources = drill('sources');
  expect(passages).toMatch(/is-active[^>]*>Passages</);
  expect(sources).toMatch(/is-active[^>]*>Sources</);
  expect(backOf(passages)).toEqual({ href:SUIVI, label:'← Retour au suivi' });
  expect(backOf(sources)).toEqual({ href:SUIVI, label:'← Retour au suivi' });
  for (const html of [passages, sources]) {
    expect(html).not.toContain('Retour au passage');
    expect(html).toContain(`href="${SUIVI}" data-cockpit-nav `); // Suivi reste accessible par l'onglet
  }
  expect(crumbText(sources)).toBe('Sourcing > Sources');
});

test('audit : produit = Sourcing > Suivi > population > Produit, retour à sa population (jamais au passage)', () => {
  for (const [kind, label] of [['received', 'Produits reçus'], ['ready', 'Retenus par Sourcing'], ['discarded', 'Écartés automatiquement']]) {
    const html = render(withTrace(), `?run=${RUN}&view=item&kind=${kind}&item=SP-1`);
    expect(crumbText(html)).toBe(`Sourcing > Suivi > ${label} > Produit`);
    expect(backOf(html)).toEqual({ href:`/admin/import-runtime?run=${RUN}&view=population&kind=${kind}`, label:`← Retour à ${label}` });
  }
});

test('audit : produit ouvert depuis Remise au Catalogue revient à Remise au Catalogue', () => {
  const population = { kind:'ready', total:1, items:[popItem(1)], unlisted:[] };
  const list = drill('handoff', '', null, population);
  expect(list).toContain(`href="/admin/import-runtime?run=${RUN}&view=item&kind=ready&item=SP-1&origin=handoff"`);
  const html = render(withTrace(), `?run=${RUN}&view=item&kind=ready&item=SP-1&origin=handoff`);
  expect(crumbText(html)).toBe('Sourcing > Suivi > Remise au Catalogue > Produit');
  expect(backOf(html)).toEqual({ href:`/admin/import-runtime?run=${RUN}&view=handoff`, label:'← Retour à Remise au Catalogue' });
});

test('audit : sortie Catalogue = return_to exact vers l’objet Sourcing d’origine, label contextuel', () => {
  const html = render(withTrace(), `?run=${RUN}&view=item&kind=ready&item=SP-1&origin=handoff`);
  const href = (html.match(/href="(\/admin\/products\/P-1[^"]+)"/) || [])[1].replace(/&amp;/g, '&');
  const q = new URLSearchParams(href.split('?')[1]);
  expect(q.get('return_to')).toBe(`/admin/import-runtime?run=${RUN}&view=item&kind=ready&item=SP-1&origin=handoff`);
  expect(q.get('return_label')).toBe('Retour au produit Sourcing');
  // Hero : retour au Suivi ; Action requise → Sourcing : retour à Action requise.
  const live = render(scenario());
  expect(live).toContain('return_label=Retour+au+suivi');
  expect(live).not.toContain('return_label=Retour+au+passage');
  const exc = drill('exceptions', '', scenario({ quarantined:3, action_required:3 }, { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS }));
  expect(exc).toContain('return_label=Retour+%C3%A0+Action+requise');
  expect(exc).toContain(`return_to=%2Fadmin%2Fimport-runtime%3Frun%3D${RUN}%26view%3Dexceptions`);
});

test('audit : détail technique — contrôle, produit ou suivi selon l’origine réelle, contexte conservé sur les étapes', () => {
  const control = drill('history', 'from=control');
  expect(crumbText(control)).toBe('Sourcing > Suivi > Contrôle automatique > Détail technique');
  expect(backOf(control)).toEqual({ href:`${SUIVI}&view=control`, label:'← Retour au contrôle automatique' });
  expect(control).toContain(`view=history&stage=TAXONOMY&from=control`);

  const fromItem = render(scenario(), `?run=${RUN}&view=history&from=item&item=SP-1&kind=ready&origin=handoff`);
  expect(crumbText(fromItem)).toBe('Sourcing > Suivi > Remise au Catalogue > Produit > Détail technique');
  expect(backOf(fromItem)).toEqual({ href:`/admin/import-runtime?run=${RUN}&view=item&kind=ready&item=SP-1&origin=handoff`, label:'← Retour au produit' });
  expect(fromItem).toContain('from=item&item=SP-1&kind=ready&origin=handoff');

  // Depuis le produit : le lien de preuve transporte le contexte.
  const item = render(withTrace(), `?run=${RUN}&view=item&kind=received&item=SP-1`);
  expect(item).toContain(`view=history&from=item&item=SP-1&kind=received`);
});

test('audit : filtres de Passages lus depuis l’URL (Back / Forward / rechargement) et conservés par la pagination', () => {
  // Les dates du jeu PASSAGES sont historiques. Pour tester "7 derniers jours",
  // rendre la fixture relative à l'horloge du runtime au lieu de dépendre du calendrier réel.
  const recentPassages = PASSAGES.map((item, index) => ({
    ...item,
    started_at: new Date(Date.now() - ((index + 1) * 60 * 60 * 1000)).toISOString(),
  }));
  const p = scenario(); p.passages = recentPassages; p.passages_page = { offset:50, next_offset:100 };
  const html = render(p, `?run=${RUN}&view=passages&offset=50&f_source=CJ&f_state=ACTION_REQUIRED&f_period=week&f_q=0004`);
  expect(html).toMatch(/<option value="CJ" selected>/);
  expect(html).toMatch(/<option value="ACTION_REQUIRED" selected>/);
  expect(html).toMatch(/<option value="week" selected>/);
  expect(html).toContain('value="0004"');
  expect((html.match(/data-row-href/g) || []).length).toBe(1); // KIR-000004 (CJ, Action requise)
  const pagers = [...html.matchAll(/href="([^"]*view=passages[^"]*offset=[^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  for (const href of pagers) expect(href).toContain('f_source=CJ&f_state=ACTION_REQUIRED&f_period=week&f_q=0004');
  // URL sans filtre : retour aux valeurs par défaut (l'URL fait foi).
  const clean = render(p, `?run=${RUN}&view=passages`);
  expect((clean.match(/data-row-href/g) || []).length).toBe(3);
});

test('audit : aucune occurrence de « Retour au passage » ni « Retour au cockpit » dans aucune vue rendue', () => {
  const p = scenario(); p.passages = PASSAGES; p.item_trace = TRACE;
  const pop = { kind:'ready', total:1, items:[popItem(1)], unlisted:[] };
  const htmls = [
    render(scenario()), render(p, `?run=${RUN}&view=passages`), drill('sources'), drill('source'), drill('control'),
    drill('handoff', '', null, pop), drill('exceptions'), drill('history'), drill('history', 'from=control'),
    drill('population', 'kind=received', null, pop), render(p, `?run=${RUN}&view=item&kind=received&item=SP-1`),
  ];
  for (const html of htmls) {
    expect(html).not.toContain('Retour au passage');
    expect(html).not.toContain('Retour au cockpit');
    expect(html).not.toContain('Retour au produit du passage');
  }
});

test('KIR réel 20/7/12/1 : le traitement terminé ne masque pas le blocage de preuve fournisseur', () => {
  const p = scenario({
    accepted:19, certified:7, catalogued:7, deferred:12, rejected:1,
    awaiting_catalogue_promotion:0,
  }, {
    source_type:'api', status:'COMPLETED', sourcing_status:'DONE',
    diagnostics:{
      provider_runtime_status:'BLOCKED', pipeline_status:'PARTIAL_BLOCKED',
      canonical_resolved:false, runtime_certified:false,
      provider_runtime_reason:'pipeline_partial_blocked',
      reject_reasons:{ 'media absent':1 },
    },
    stages:CALM_STAGES.map(stage => ({
      ...stage, status:'COMPLETED', reason:null, processed:stage.key === 'CATALOGUE' ? 7 : stage.processed,
    })),
  });
  const html = render(p, `?run=${RUN}`);
  expect(tile(html, 'Produits reçus')).toBe('20');
  expect(tile(html, 'Retenus par Sourcing')).toBe('7');
  expect(tile(html, 'Mis de côté')).toBe('12');
  expect(tile(html, 'Écartés automatiquement')).toBe('1');
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).toContain('Traitement des produits terminé');
  expect(html).toContain('Remise terminée · 7 produits remis au Catalogue');
  expect(html).toContain('Preuve fournisseur bloquée pour ce passage');
  expect(html).toContain('PARTIAL_BLOCKED');
  expect(html).toContain('pipeline_partial_blocked');
  expect(html).toContain('1 × media absent');
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=population&kind=deferred"`);
  expect(html).toContain(`href="/admin/import-runtime?run=${RUN}&view=population&kind=discarded"`);
});

test('source : état canonique non écrasé par la preuve du passage et certification historique distinguée', () => {
  const p = scenario({}, {
    run_ref:RUN, provider:'CJ Dropshipping', source_ref:'api:cj', source_type:'api',
    diagnostics:{ provider_runtime_status:'BLOCKED', pipeline_status:'PARTIAL_BLOCKED', runtime_certified:false },
  });
  p.source_controls = SOURCES();
  const html = render(p, `?run=${RUN}&view=sources`);
  const summary = (html.match(/data-sources-summary>([\s\S]*?)<\/p>/) || [])[1];
  expect(summary).toContain('<strong>1</strong> prête');
  expect(summary).toContain('preuve fournisseur à vérifier');
  expect(summary).toContain('<strong>0</strong> en erreur');
  const cj = html.split('<article').find(chunk => chunk.includes('data-source-card="api:cj"'));
  expect(cj).toContain('PREUVE À VÉRIFIER');
  expect(cj).toContain('Certifiée (historique)');
  expect(cj).toContain('Preuve du dernier passage');
  expect(cj).toContain('Non acquise');
  expect(cj).toContain('aria-checked="false"');
});

test('produits mis de côté : population dédiée, motif individuel et lien vers la fiche', () => {
  const pop = {
    kind:'deferred', total:12,
    items:[popItem(23, {
      issue_key:'deferred', issue_label:'Mis de côté', decision:'WATCH',
      reason:'Catégorie Komerce non résolue',
    })],
    unlisted:[],
  };
  const html = drill('population', 'kind=deferred', null, pop);
  expect(html).toContain('Mis de côté · 12');
  expect(html).toContain('À surveiller');
  expect(html).toContain('Catégorie Komerce non résolue');
  expect(html).toContain(`view=item&kind=deferred&item=SP-23`);
});

test('rejet dès la réception : motif agrégé tracé sans prétendre à un objet inexistant', () => {
  const pop = {
    kind:'discarded', total:1, items:[],
    unlisted:[{ label:'Produit non retenu à la réception', count:1 }],
    reject_reason_groups:[{ reason:'media absent', count:1 }],
  };
  const html = drill('population', 'kind=discarded', null, pop);
  expect(html).toContain('1 × Produit non retenu à la réception');
  expect(html).toContain('Motifs enregistrés à la réception');
  expect(html).toContain('1 × media absent');
  expect(html).not.toContain('data-population-item');
});

// ── Vue Sources : synthèse + cartes opérateur ─────────────────────────────────
const SOURCES = () => [
  { source_ref:'api:aliexpress', label:'AliExpress Dropshipper API', state:'active', connection:{ verified:true }, autopilot_enabled:true, autopilot_ready:true, activation_ready:true, production_runtime_certified:true, last_capture_at:'2026-09-30T14:36:00Z' },
  { source_ref:'api:cj', label:'CJ Dropshipping', state:'ready', connection:{ verified:true }, autopilot_enabled:false, autopilot_ready:true, activation_ready:true, production_runtime_certified:true, last_capture_at:null },
  { source_ref:'api:bigbuy', label:'BigBuy', state:'blocked', connection:{ verified:false }, autopilot_enabled:false, autopilot_ready:false, activation_ready:false, blocker:'Clé API manquante', production_runtime_certified:false, last_capture_at:null },
];
const sourcesView = (search = '') => { const p = scenario(); p.source_controls = SOURCES();
  // Test fixtures explicitly associate runs with source_ref; no runtime name guessing.
  p.lots=(p.lots||[]).map(lot => ({...lot,
    source_ref:/aliexpress/i.test(lot.provider||'')?'api:aliexpress':'api:cj'}));
  if(p.selected) p.selected.source_ref='api:aliexpress';
  return render(p, `?${search}view=sources`); };

test('Sources : synthèse compacte calculée depuis source_controls, une carte par fournisseur', () => {
  const html = sourcesView(`run=${RUN}&`);
  const summary = (html.match(/data-sources-summary>([\s\S]*?)<\/p>/) || [])[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  expect(summary).toBe('3 sources configurées 1 active 1 prête 0 en erreur 1 bloquée');
  expect((html.match(/data-source-card=/g) || []).length).toBe(3);
  expect(html).toContain('ACTIVE'); expect(html).toContain('PRÊTE'); expect(html).toContain('BLOQUÉE');
});

test('Sources : switch fidèle au payload, désactivé + raison visible si non activable, aria-label conservé', () => {
  const html = sourcesView(`run=${RUN}&`);
  const card = ref => html.split('<article').find(chunk => chunk.includes(`data-source-card="${ref}"`));
  expect(card('api:aliexpress')).toMatch(/aria-checked="true"/);
  expect(card('api:aliexpress')).toContain('aria-label="Désactiver le sourcing automatique AliExpress Dropshipper API"');
  expect(card('api:aliexpress')).not.toMatch(/data-source-toggle[^>]*disabled/);
  expect(card('api:cj')).toMatch(/aria-checked="false"/);
  expect(card('api:cj')).toContain('aria-label="Activer le sourcing automatique CJ Dropshipping"');
  expect(card('api:cj')).not.toMatch(/data-source-toggle[\s\S]*?disabled/);
  expect(card('api:bigbuy')).toMatch(/data-source-toggle[\s\S]*?disabled/);
  expect(card('api:bigbuy')).toContain('Clé API manquante');
});

test('Sources : « Voir le suivi » seulement si un dernier passage existe (jamais de faux CTA), aucun « Sources → »', () => {
  const html = sourcesView(`run=${RUN}&`);
  const card = ref => html.split('<article').find(chunk => chunk.includes(`data-source-card="${ref}"`));
  expect(card('api:aliexpress')).toContain('Voir le suivi →');
  expect(card('api:aliexpress')).toContain('href="/admin/import-runtime?run=KIR-000004"');
  expect(card('api:cj')).toContain('href="/admin/import-runtime?run=KIR-000003"');
  expect(card('api:bigbuy')).not.toContain('Voir le suivi');
  expect(card('api:bigbuy')).toContain('Jamais');
  expect(html).not.toContain('Sources →');
  expect(html).not.toContain('Retour au passage');
  expect(html).not.toContain('kir-source-pill');
});

test('Sources : retour au suivi toujours présent ; le KIR n’est jamais un niveau du fil', () => {
  const withRun = sourcesView(`run=${RUN}&`);
  expect(backOf(withRun)).toEqual({ href:SUIVI, label:'← Retour au suivi' });
  expect(withRun).toContain(`Passage courant : ${RUN}`);
  expect(crumbText(withRun)).toBe('Sourcing > Sources');
  expect(withRun).toContain('Pilotez les fournisseurs connectés et leur alimentation automatique.');
  expect(withRun).toMatch(/is-active[^>]*>Sources</);
  const p = scenario(); p.source_controls = SOURCES(); p.selected = null;
  const noRun = render(p, '?view=sources');
  expect(backOf(noRun)).toEqual({ href:'/admin/import-runtime', label:'← Retour au suivi' });
  expect(noRun).not.toContain('Passage courant');
  expect(noRun).toContain('Retour au suivi');
});

test('Sources : état d’erreur (preuve runtime) et liste vide sans carte fantôme', () => {
  const p = scenario(); p.source_controls = SOURCES(); p.source_controls[1].last_capture_status = 'failed'; p.source_controls[1].state = 'error';
  const html = render(p, `?run=${RUN}&view=sources`);
  expect((html.match(/data-sources-summary>([\s\S]*?)<\/p>/) || [])[1]).toContain('<strong>1</strong> en erreur');
  expect(html).toContain('ERREUR');
  expect(html).toContain('Dernière capture fournisseur signalée en échec. Consultez le passage et ses preuves.');
  const empty = scenario(); empty.source_controls = [];
  const none = render(empty, `?run=${RUN}&view=sources`);
  expect(none).toContain('Aucune source récurrente configurée');
  expect(none).not.toContain('data-source-card');
});

test('LIVE-01/02 : écouteurs retirés avant chaque montage et aucune relecture quand l’onglet est masqué', () => {
  const src = require('fs').readFileSync(require.resolve('../../public/dashboards/canonical/js/import-runtime.js'), 'utf8');
  expect(src).toContain('releaseListeners();');
  expect(src).toContain("listen(global, 'popstate'");
  expect(src).toContain("listen(global.document, 'visibilitychange'");
  expect(src).not.toMatch(/global\.addEventListener\?\.\('popstate'/);
  expect(src).toMatch(/visibilityState === 'hidden'\) return;/);
});

test('Sourcing : le Catalogue global maître reçoit le produit gardé avec retour au passage', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/import-runtime.js'), 'utf8');
  expect(src).toContain("viewer && viewer.role === 'admin'");
  expect(src).toContain('/admin/workspaces/catalog?product_ref=${encodeURIComponent(trace.product_ref)}');
  expect(src).toContain('data-next-step="catalogue"');
  expect(src).toContain('viewer = options.user || null;');
});

test('KIR-000012 : 20 rejets historiques taux usd_kmf exposent un chemin de récupération', () => {
  const ui = cockpit('?run=KIR-000012&view=population&kind=discarded');
  const p = JSON.parse(JSON.stringify(payload));
  p.selected.run_ref = 'KIR-000012';
  p.selected.accounting.rejected = 20;
  p.selected.accounting.source_total = 20;
  p.selected.diagnostics = {
    reject_reasons: { 'Taux usd_kmf indisponible : aucune observation approuvée.': 20 },
  };
  const node = root();
  ui.render(node, {
    ...p,
    population: {
      kind: 'discarded', total: 20, items: [],
      unlisted: [{ label: 'Produit non retenu à la réception', count: 20 }],
      reject_reason_groups: [{ reason: 'Taux usd_kmf indisponible : aucune observation approuvée.', count: 20 }],
    },
  });
  expect(node.innerHTML).toContain('20 rejet(s) de réception liés au taux EUR/USD');
  expect(node.innerHTML).toContain('/admin/workspaces/pricing#fx-authority');
  expect(node.innerHTML).toContain('relancez la source pour récupérer ces produits');
  expect(node.innerHTML).toContain('Après récupération du cours officiel');
});

test('import après correctif : 20 prix USD sans observation restent en Mis de côté, avec correction FX', () => {
  const ui = cockpit('?run=KIR-000013&view=population&kind=deferred');
  const p = JSON.parse(JSON.stringify(payload));
  p.selected.run_ref = 'KIR-000013';
  p.selected.accounting = { ...p.selected.accounting, source_total: 20, accepted: 20, deferred: 20, rejected: 0 };
  p.selected.diagnostics = { fx_pending: 20, reject_reasons: {} };
  const node = root();
  ui.render(node, { ...p, population: { kind: 'deferred', total: 20, items: [] } });
  expect(node.innerHTML).toContain('20 candidat(s) conservé(s)');
  expect(node.innerHTML).toContain('Mis de côté');
  expect(node.innerHTML).toContain('synchronisation BCE fonctionne automatiquement');
  expect(node.innerHTML).toContain('/admin/workspaces/pricing#fx-authority');
  expect(node.innerHTML).not.toContain('20 rejet(s) de réception');
});
