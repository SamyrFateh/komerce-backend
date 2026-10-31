'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

function cockpit(search = '?run=KIR-000013') {
  const window = { URLSearchParams, location:{pathname:'/admin/import-runtime',search},
    history:{pushState(){}}, addEventListener(){} };
  vm.runInNewContext(read('public/dashboards/canonical/js/import-runtime.js'),{window,URLSearchParams});
  return window.KomerceCanonicalImportRuntime;
}
function rendered(payload,search) {
  const node={innerHTML:'',className:'',setAttribute(){},querySelectorAll:()=>[]};
  cockpit(search).render(node,payload);
  return node.innerHTML;
}
const sample=()=>({
  selected:{run_ref:'KIR-000013',source_ref:'api:cj',provider:'CJdropshipping',
    started_at:'2026-10-27T10:05:00Z',status:'RUNNING',sourcing_status:'ACTION_REQUIRED',
    accounting:{source_total:20,certified:16,catalogued:12,action_required:2},
    action_items:[
      {candidate_ref:'KSC-000194',correction_kind:'category',reason:'Catégorie économique manquante',product_name:'Stain Treater'},
      {candidate_ref:'KSC-000195',correction_kind:'purchase_price',reason:'Prix d’achat manquant',product_name:'Article à compléter'}],
    stages:[{key:'CERTIFICATION',status:'COMPLETED'}]},
  lots:[{run_ref:'KIR-000013',source_ref:'api:cj',provider:'CJdropshipping',business_status:'ACTION_REQUIRED'}],
  source_controls:[{source_ref:'api:cj',state:'active',label:'CJdropshipping',
    autopilot_enabled:true,autopilot_ready:true,activation_ready:true,
    import_enabled:true,connector_ready:true,last_capture_at:'2026-10-27T10:05:00Z'}],
  source_requests:[],
});
test('Un seul écran Sourcing Live : décision puis sources et passages repliés',()=>{
  const html=rendered(sample());
  expect(html).toContain('data-sourcing-single-screen');
  expect(html).toContain('<h1>Sourcing Live</h1>');
  expect(html).toContain('data-unified-sources');
  expect(html).toContain('data-unified-passages');
  expect(html).toContain('2 actions signalées sur ce passage');
  expect(html).toContain('>20</strong><span>Reçus');
  expect(html).toContain('>16</strong><span>Retenus');
  expect(html).toContain('>12</strong><span>Remis au Catalogue');
  expect(html).not.toContain('kir-command-bar');
  expect(html).not.toContain('kir-domain-nav');
  expect(html).not.toContain('data-action-classify');
  expect(html).not.toContain('Mettre à jour maintenant');
  expect(html).not.toContain('Redémarrer');
});
test('Une catégorie va au Catalogue, un fait fournisseur à la correction source',()=>{
  const html=rendered(sample());
  expect(html).toContain('/admin/workspaces/catalog?search=KSC-000194');
  expect(html).toContain('/admin/workspaces/sourcing?candidate_ref=KSC-000195');
  expect(html).toContain('Compléter dans le Catalogue');
  expect(html).not.toContain('data-category-remediation');
});
test('Le contrôle actif correspond à une source exacte et propose un import explicite',()=>{
  const html=rendered(sample());
  expect(html).toContain('data-source-ref="api:cj"');
  expect(html).toContain('data-source-command="update"');
  expect(html).toContain('Importer maintenant');
  expect(html).toContain('data-add-source');
});
test('Une source sans correspondance KIR certaine ne reçoit aucun faux lien de suivi',()=>{
  const data=sample();
  data.selected.source_ref=null;
  data.lots[0].source_ref=null;
  const html=rendered(data);
  const card=html.match(/<article class="kir-source-card[\s\S]*?<\/article>/)?.[0]||'';
  expect(card).not.toContain('Voir le suivi');
  expect(html).not.toContain('kir-command-bar');
});
test('Anciennes URLs ouvrent toujours le même écran et la section demandée',()=>{
  const sources=rendered(sample(),'?view=sources');
  const passages=rendered(sample(),'?view=passages');
  for(const html of [sources,passages]){
    expect(html).toContain('data-sourcing-single-screen');
    expect(html).not.toContain('kir-domain-nav');
  }
  expect(sources).toMatch(/data-unified-sources[\s\S]*?open/);
  expect(passages).toMatch(/data-unified-passages[\s\S]*?open/);
});
test('La navigation officielle possède une seule entrée Sourcing Live',()=>{
  const nav=read('public/dashboards/canonical/js/navigation-policy-v4.js');
  expect(nav).toContain("id:'sourcing-live', label:'Sourcing Live'");
  for(const old of ["id: 'sourcing-suivi'","id: 'sourcing-passages'","id: 'sourcing-sources'","id: 'sourcing-candidats'"]) {
    expect(nav).not.toContain(old);
  }
});
test('Le formulaire manuel historique obéit au masquage et n’est plus une page de navigation',()=>{
  const css=read('public/dashboards/canonical/css/operations-workspace.css');
  const legacy=read('public/dashboards/canonical/js/sourcing-workspace.js');
  expect(css).toContain('.kmc-sourcing-workspace [hidden] { display: none !important; }');
  expect(legacy).toContain('redirected: true');
  expect(legacy).toContain('partnerManagement');
});
