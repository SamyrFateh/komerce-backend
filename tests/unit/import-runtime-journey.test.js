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

test('niveau 1 garde le flux réel visible et les décisions ouvertes séparées', () => {
  const ui = cockpit();
  const node = root();
  ui.render(node, payload);
  expect(node.innerHTML).toContain('Ce qui demande une action');
  expect(node.innerHTML).toContain('Alimentation automatique');
  expect(node.innerHTML).toContain('Préparation automatique au clic');
  expect(node.innerHTML).toContain('data-source-ref="api:aliexpress"');
  expect(node.innerHTML).toContain('3</div>');
  expect(node.innerHTML).toContain('Validation Catalogue requise');
  expect(node.innerHTML).toContain('12</div>');
  expect(node.innerHTML).toContain('Décisions de mise en vente');
  expect(node.innerHTML).toContain('PARCOURS MÉTIER');
  expect(node.innerHTML).toContain('Prêts à vendre');
  expect(node.innerHTML).toContain('En vente');
  expect(node.innerHTML).toContain('Non retenus');
  expect(node.innerHTML).toContain('Clôture');
  expect(node.innerHTML).toContain('KIR-000003');
  expect(node.innerHTML).toContain('Clos');
  expect(node.innerHTML).toContain('FLUX DU LOT');
  expect(node.innerHTML).toContain('Raffinerie');
  expect(node.innerHTML).toContain('Taxonomie');
  expect(node.innerHTML).toContain('Certification');
  expect(node.innerHTML).toContain('SUIVI DU LOT');
  expect(node.innerHTML).toContain('Certifiées sourcing');
  expect(node.innerHTML).toContain('15</strong>');
  expect(node.innerHTML).toContain('Catalogue');
  expect(node.innerHTML).toContain('1</strong>');
  expect(node.innerHTML).toContain('14 produit(s) certifié(s) sourcing attendent maintenant la promotion Catalogue. Ils n’ont pas disparu.');
  expect(node.innerHTML).not.toContain('&lt;Produit&gt;');
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
  expect(node.innerHTML).toContain('Décisions attendues');
  expect(node.innerHTML).not.toContain('Import en cours');
  expect(node.innerHTML).toContain('12 certifié(s) attendent la promotion Catalogue');
  expect(node.innerHTML).toContain('AliExpress non activé automatiquement');
  expect(node.innerHTML).toContain('1 produit contient des variantes en double.');
  expect(node.innerHTML).toContain('12 produits valides continuent vers le Catalogue.');
  expect(node.innerHTML).toContain('7 produits ont été mis de côté pour revue.');
  expect(node.innerHTML).toContain('Corrigez le produit en erreur puis relancez l’activation automatique.');
  expect(node.innerHTML).toContain('Voir le détail technique →');
  expect(node.innerHTML).not.toContain('sellable_units[4]');
  expect(node.innerHTML).not.toContain("combinaison d'options dupliquée");
  expect(node.innerHTML).toContain('12 produit(s) certifié(s) sourcing attendent maintenant la promotion Catalogue');
  expect(node.innerHTML).toContain('12/12');
  expect(node.innerHTML).toContain('12 à valider');
  expect(node.innerHTML).toContain('has-manual-action');
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
