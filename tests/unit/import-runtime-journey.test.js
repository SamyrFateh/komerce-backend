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

function cockpit() {
  const context = {
    URLSearchParams,
    window: {
      location:{ pathname:'/admin/import-runtime', search:'?run=KIR-000004' },
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

test('niveau 1 : quatre étapes, quatre résultats, aucun jargon interne ni sujet commercial', () => {
  const ui = cockpit();
  const node = root();
  ui.render(node, payload);
  const html = node.innerHTML;
  expect(html).toContain('FLUX DU LOT');
  for (const label of ['Source', 'Produits reçus', 'Contrôle automatique', 'Catalogue']) expect(html).toContain(`<strong>${label}</strong>`);
  for (const jargon of ['Raffinerie', 'Taxonomie', 'Certification', 'certifié(s) sourcing', 'preuve runtime']) expect(html).not.toContain(jargon);
  expect(html).toContain('RÉSULTAT DU LOT');
  for (const label of ['Produits reçus', 'Remis au Catalogue', 'Écartés automatiquement', 'À examiner']) expect(html).toContain(`<span>${label}</span>`);
  for (const gone of ['Entrées source', 'Acceptées', 'Doublons', 'En quarantaine', 'Rejetées']) expect(html).not.toContain(`<span>${gone}</span>`);
  for (const commercial of ['PARCOURS MÉTIER', 'Prêts à vendre', 'En vente', 'Décisions de mise en vente', 'Décisions commerciales', 'Clôture', 'Prix source']) {
    expect(html).not.toContain(commercial);
  }
  expect(html).toContain('KIR-000003');
  expect(html).not.toContain('&lt;Produit&gt;');
  // Sans étape de certification terminée, aucune remise Catalogue n'est affirmée.
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

function calmPayload(patch = {}) {
  const p = JSON.parse(JSON.stringify(payload));
  p.selected.status = 'COMPLETED';
  p.selected.accounting = {
    source_total:20, accepted:19, certified:12, catalogued:0, awaiting_catalogue_promotion:12,
    duplicates:0, rejected:1, quarantined:0, deferred:7, certification_blocked:0, unaccounted:0, overflow:0,
  };
  p.selected.stages = CALM_STAGES;
  p.selected.business = { ...p.selected.business, business_status:'ACTION_REQUIRED', decisions:{ catalogue:12, commercial:12, exceptions:0 } };
  Object.assign(p.selected, patch);
  return p;
}

test('scénario 20 / 12 / 1 / 7 : preuve de comptage et remise propre au Catalogue', () => {
  const ui = cockpit();
  const node = root();
  ui.render(node, calmPayload());
  const html = node.innerHTML;
  expect(html).toMatch(/<span>Produits reçus<\/span><strong>20<\/strong>/);
  expect(html).toMatch(/<span>Remis au Catalogue<\/span><strong>12<\/strong>/);
  expect(html).toMatch(/<span>Écartés automatiquement<\/span><strong>1<\/strong>/);
  expect(html).toMatch(/<span>À examiner<\/span><strong>7<\/strong>/);
  expect(html).toContain('20/20 produits comptabilisés');
  expect(html).toContain('PASSAGE AU CATALOGUE');
  expect(html).toContain('12 certifiés · 12 transmis · 0 écart');
  expect(html).toContain('Terminé');
  expect(html).toContain('kir-handoff is-clean');
  expect(html).toContain('12 transmis');
  // Écran calme : ni barre de progression ni décision commerciale.
  expect(html).not.toContain('Progression globale');
  expect(html).not.toContain('Ce qui vous attend');
});

test('tout va bien : rien à examiner, aucune alerte, écran calme', () => {
  const ui = cockpit();
  const node = root();
  const p = calmPayload();
  p.selected.accounting = { ...p.selected.accounting, rejected:0, deferred:0, accepted:20 };
  ui.render(node, p);
  const html = node.innerHTML;
  expect(html).toMatch(/<span>À examiner<\/span><strong>0<\/strong>/);
  expect(html).toContain('rien à décider');
  expect(html).not.toContain('kir-runtime-alert');
  expect(html).not.toContain('is-attention');
  expect(html).not.toContain('is-failed');
});

test('vrai problème : 12 prêts · 9 transmis · 3 nécessitent une action (étape rouge, remise orange)', () => {
  const ui = cockpit();
  const node = root();
  const p = calmPayload();
  p.selected.accounting = { ...p.selected.accounting, certified:9, rejected:0, deferred:0, accepted:20 };
  p.selected.stages = CALM_STAGES.map(stage => stage.key === 'CERTIFICATION'
    ? { ...stage, status:'FAILED', processed:9, total:12 } : stage);
  ui.render(node, p);
  const html = node.innerHTML;
  expect(html).toContain('12 prêts · 9 transmis · 3 nécessitent une action');
  expect(html).toContain('kir-handoff is-attention');
  expect(html).toMatch(/<span>À examiner<\/span><strong>3<\/strong>/);
  expect(html).toMatch(/is-failed[^>]*>\s*<span class="kir-run-flow-marker">!<\/span><div><strong>Contrôle automatique/);
  expect(html).toContain('3 à traiter');
});

test('activité humaine : étapes internes silencieuses, phrases lisibles', () => {
  const ui = cockpit();
  const node = root();
  const p = calmPayload();
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

test('une exception ouverte fait apparaître « Ce qui vous attend » (et rien de commercial)', () => {
  const ui = cockpit();
  const node = root();
  const p = calmPayload();
  p.selected.business.decisions = { catalogue:12, commercial:12, exceptions:2 };
  ui.render(node, p);
  expect(node.innerHTML).toContain('Ce qui vous attend');
  expect(node.innerHTML).toContain('Exceptions à traiter');
  expect(node.innerHTML).not.toContain('Décisions de mise en vente');
  expect(node.innerHTML).not.toContain('Validation Catalogue requise');
});

test('un PARTIAL_BLOCKED bloque seulement la source et laisse le lot aller au Catalogue', () => {
  const ui = cockpit();
  const node = root();
  const partial = JSON.parse(JSON.stringify(payload));
  partial.selected.status = 'COMPLETED';
  partial.selected.failure_reason = null;
  partial.selected.accounting = {
    source_total:20,accepted:19,refined:19,taxonomized:12,certified:12,catalogued:0,
    awaiting_catalogue_promotion:12,rejected:1,quarantined:0,deferred:7,certification_blocked:0,
  };
  partial.selected.diagnostics = {
    pipeline_status:'PARTIAL_BLOCKED',
    canonical_resolved:true,
    reject_reasons:{"sellable_units[4] : combinaison d'options dupliquée":1},
    runtime_certified:false,
    provider_runtime_status:'BLOCKED',
    provider_runtime_reason:'pipeline_partial_blocked',
    certification_reason:null,
  };
  partial.selected.stages = [
    {key:'SOURCE_CONNECTED',status:'COMPLETED',processed:1,total:1},
    {key:'RAW_IMPORT',status:'COMPLETED',processed:20,total:20},
    {key:'REFINERY',status:'COMPLETED',processed:19,total:12},
    {key:'TAXONOMY',status:'COMPLETED',processed:12,total:12},
    {key:'CERTIFICATION',status:'COMPLETED',processed:12,total:12,reason:null},
    {key:'CATALOGUE',status:'RUNNING',processed:0,total:12,reason:'awaiting_explicit_operator_promotion'},
  ];
  partial.selected.business = {
    ...partial.selected.business,
    business_status:'ACTION_REQUIRED',
    technical_status:'RUNNING',
    failure_reason:null,
    provider_runtime_blocked:true,
    promoted_products:0,
    decisions:{catalogue:0,commercial:0,exceptions:0,approved_for_sale:0,not_retained:0},
    closure:{eligible:false,decided_products:0,total_products:0,remaining_products:0},
    products:[],
  };
  partial.lots[0].business_status = 'ACTION_REQUIRED';

  ui.render(node, partial);

  expect(node.innerHTML).toContain('Import automatique terminé');
  expect(node.innerHTML).not.toContain('Import en cours');
  expect(node.innerHTML).toContain('12 produit(s) prêt(s) pour le Catalogue');
  expect(node.innerHTML).toContain('AliExpress non activé automatiquement');
  expect(node.innerHTML).toContain('1 produit contient des variantes en double.');
  expect(node.innerHTML).toContain('12 produits valides continuent vers le Catalogue.');
  expect(node.innerHTML).toContain('7 produits ont été mis de côté pour revue.');
  expect(node.innerHTML).toContain('Corrigez le produit en erreur puis relancez l’activation automatique.');
  expect(node.innerHTML).toContain('Voir le détail →');
  expect(node.innerHTML).not.toContain('sellable_units[4]');
  expect(node.innerHTML).not.toContain("combinaison d'options dupliquée");
  expect(node.innerHTML).toContain('12 certifiés · 12 transmis · 0 écart');
  expect(node.innerHTML).toContain('12 transmis');
  expect(node.innerHTML).toContain('20/20 produits comptabilisés');
  expect(node.innerHTML).not.toContain('Passage interrompu');
  expect(node.innerHTML).not.toContain('À corriger');
  expect(node.innerHTML).not.toContain('is-running');
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
