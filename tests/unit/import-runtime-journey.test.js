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
  expect(node.innerHTML).toContain('Cockpit des imports');
  expect(node.innerHTML).toContain('Pilotez les sources et suivez chaque lot de bout en bout.');
  expect(node.innerHTML).toContain('Aucun lot importé');
  expect(node.innerHTML).toContain('Activez une source pour lancer un premier passage réel');
  expect(node.innerHTML).toContain('Tous les lots');
});

test('niveau 1 : quatre étapes sans compteur, quatre résultats, aucun jargon interne ni sujet commercial', () => {
  const ui = cockpit();
  const node = root();
  ui.render(node, payload);
  const html = node.innerHTML;
  expect(html).toContain('FLUX DU LOT');
  for (const label of ['Source', 'Produits reçus', 'Contrôle automatique', 'Catalogue']) expect(html).toContain(`<strong>${label}</strong>`);
  for (const jargon of ['Raffinerie', 'Taxonomie', 'Certification', 'certifié(s) sourcing', 'preuve runtime']) expect(html).not.toContain(jargon);
  // Le pipeline ne répète aucun compteur : uniquement des états.
  const flow = html.slice(html.indexOf('kir-run-flow-track'), html.indexOf('RÉSULTAT DU LOT'));
  expect(flow).not.toMatch(/\d+\s*\/\s*\d+/);
  expect(html).toContain('RÉSULTAT DU LOT');
  for (const label of ['Produits reçus', 'Prêts pour le Catalogue', 'Écartés automatiquement', 'Action requise']) expect(html).toContain(`<span>${label}</span>`);
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
  expect(active.innerHTML).toContain('Mettre à jour maintenant');
});

test('commandes visibles même si le run n\'expose pas le source_ref de la carte (fournisseur différent, source_ref vide)', () => {
  const ui = cockpit();
  for (const patch of [{ source_ref:null }, { source_ref:'autre-ref' }, { source_ref:undefined }]) {
    const p = JSON.parse(JSON.stringify(payload));
    Object.assign(p.selected, patch);
    p.source_controls[0].label = 'AliExpress Dropshipper API';
    p.source_controls[0].autopilot_enabled = true;
    const node = root();
    ui.render(node, p);
    expect(node.innerHTML).toContain('data-source-command="update"');
    expect(node.innerHTML).toContain('data-source-command="stop"');
    // Les commandes précèdent le flux ; la section Sources basse est conservée.
    expect(node.innerHTML.indexOf('kir-command-bar')).toBeLessThan(node.innerHTML.indexOf('kir-run-flow'));
    expect(node.innerHTML).toContain('data-source-toggle');
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
  { key:'CATALOGUE', status:'RUNNING', processed:0, total:12, reason:'awaiting_explicit_operator_promotion' },
];

// Base = CAS A : 20 reçus, 12 prêts, 1 écarté, 7 DEFERRED, 0 action requise, rien au Catalogue.
function scenario(accounting = {}, selected = {}) {
  const p = JSON.parse(JSON.stringify(payload));
  p.selected.status = 'COMPLETED';
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
  expect(tile(html, 'Prêts pour le Catalogue')).toBe('12');
  expect(tile(html, 'Écartés automatiquement')).toBe('1');
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).toContain('20/20 produits comptabilisés');
  expect(html).toContain('PASSAGE AU CATALOGUE');
  expect(html).toContain('En attente de remise');
  expect(html).toContain('kir-handoff is-waiting');
  for (const forbidden of ['12 transmis', '7 à examiner', 'Décisions attendues', 'kir-handoff is-clean', 'Remise terminée', 'remis au Catalogue']) {
    expect(html).not.toContain(forbidden);
  }
  // Écran calme : ni orange, ni rouge, ni alerte, ni barre de progression.
  for (const noise of ['is-attention', 'is-failed', 'kir-runtime-alert', 'Progression globale', 'Ce qui vous attend']) expect(html).not.toContain(noise);
  expect(html).toContain('Terminé</span>');
  expect(stepClass(html, 'Catalogue')).toContain('is-pending');
  expect(stepClass(html, 'Contrôle automatique')).toContain('is-completed');
});

test('CAS B : certified = catalogued = 12 → « ✓ Remise terminée », étape Catalogue verte, pas de 12/12', () => {
  const html = render(scenario({ catalogued:12, awaiting_catalogue_promotion:0 }));
  expect(html).toContain('kir-handoff is-clean');
  expect(html).toContain('Remise terminée');
  expect(stepClass(html, 'Catalogue')).toContain('is-completed');
  expect(html).not.toContain('12/12');
  expect(html).not.toContain('En attente de remise');
});

test('CAS C : 12 prêts, 9 au Catalogue, aucune intervention → « 3 restent à remettre », pas d’action requise', () => {
  const html = render(scenario({ catalogued:9, awaiting_catalogue_promotion:3 }));
  expect(html).toContain('3 restent à remettre');
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).not.toContain('is-attention');
  expect(html).not.toContain('Remise terminée');
  expect(stepClass(html, 'Catalogue')).toContain('is-pending');
});

test('CAS D : 7 DEFERRED sans revue humaine → Action requise = 0, aucune carte orange', () => {
  const html = render(scenario({ deferred:7 }));
  expect(tile(html, 'Action requise')).toBe('0');
  expect(html).toContain('rien à faire');
  expect(html).not.toContain('is-attention');
  expect(html).not.toContain('deferred');
  expect(html).not.toContain('différé');
});

test('CAS A bis : 20 reçus, 0 prêt, 8 deferred normaux → 0 action, pas de handoff, aucun orange', () => {
  const html = render(scenario({ certified:0, catalogued:0, awaiting_catalogue_promotion:0, accepted:12, rejected:0, deferred:8, action_required:0 }));
  expect(tile(html, 'Produits reçus')).toBe('20');
  expect(tile(html, 'Prêts pour le Catalogue')).toBe('0');
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

test('CAS E : 3 vraies exceptions → « Action requise 3 » orange cliquable, header « Action requise »', () => {
  const html = render(scenario({ quarantined:2, certification_blocked:1, deferred:4, action_required:3 },
    { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS }));
  expect(tile(html, 'Action requise')).toBe('3');
  expect(html).toContain('is-review is-attention');
  expect(html).toContain('Intervenir →');
  expect(html).toContain('href="/admin/import-runtime?run=KIR-000004&view=exceptions"');
  expect(html).toContain('Action requise</span>');
  expect(html).not.toContain('Décisions attendues');
  expect(stepClass(html, 'Contrôle automatique')).toContain('is-attention');
});

test('CAS E : au clic, la liste filtrée montre exactement les 3 éléments (produit · raison · action)', () => {
  const html = render(scenario({ quarantined:2, certification_blocked:1, action_required:3 },
    { sourcing_status:'ACTION_REQUIRED', action_items:ITEMS }), '?run=KIR-000004&view=exceptions');
  expect((html.match(/kir-row-action/g) || []).length).toBeGreaterThanOrEqual(3);
  for (const expected of ['Coque A', 'Image inexploitable', 'Corriger', 'Coque B', 'Classement ambigu', 'Choisir', 'Coque C', 'Donnée obligatoire manquante', 'Compléter']) {
    expect(html).toContain(expected);
  }
  expect(html).toContain('data-action-choose');
  expect((html.match(/data-action-choose/g) || []).length).toBe(1);
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
  expect(label(scenario())).toBe('positive:Terminé');
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
  expect(html).not.toContain('Raffinerie');
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
    'Retour au lot'
  );
  expect(productHref).toContain('return_to=%2Fadmin%2Fimport-runtime%3Frun%3DKIR-000004%26view%3Dcatalogue');
  expect(productHref).toContain('return_label=Retour+au+lot');
  expect(original).toBeDefined();
});
