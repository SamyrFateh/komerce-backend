'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const panel=require('../../public/dashboards/canonical/js/international-journey-panel');
const fs=require('fs'),path=require('path');
function node(tag='div'){
  return {tagName:tag.toUpperCase(),children:[],className:'',textContent:'',attributes:{},events:{},
    appendChild(child){this.children.push(child);return child;},
    setAttribute(k,v){this.attributes[k]=String(v);},
    addEventListener(k,fn){this.events[k]=fn;},
  };
}
function all(r,p,out=[]){if(p(r))out.push(r);for(const ch of r.children||[])all(ch,p,out);return out;}
function mount(role='admin',tab='transport',data={}){
  const root=node('main');
  const ctx={user:{role},journeyTab:tab,journeyRef:'INT-KM-1',marketCode:'KM',
    reload:jest.fn(async()=>{}),fetch:jest.fn()};
  const row={reference:'INT-KM-1',stage:'forwarder_received',transport_mode:'sea',
    forwarder_name:'Transitaire A',parcel_count:2,volume_m3:'1.25',
    freight_estimated_kmf:'15000',freight_invoice_kmf:null,estimated_arrival_at:'2026-11-25',
    supplementary_costs_kmf:'0',...data};
  panel.render({createElement:node},root,ctx,[row],{events:[],charges:[]});
  return {root,ctx,row};
}
test('3 tabs, one existing dossier list and clear not yet booked N1 status',()=>{
  const {root}=mount();
  const tabs=all(root,n=>n.tagName==='BUTTON'&&n.className.includes('kmc-journey-tab'));
  expect(tabs.map(x=>x.textContent)).toEqual(['Transport & fret','Arrivée & douane','Vers les relais']);
  expect(tabs.filter(x=>x.className.includes('is-active'))).toHaveLength(1);
  const headings=all(root,n=>n.tagName==='TH').map(n=>n.textContent);
  expect(headings).toEqual(['Référence','Étape','Transitaire','Colis','Volume facturé','Fret réel','ETA','Dossier']);
  expect(all(root,n=>n.className==='kmc-journey-cost-alert').at(0).textContent)
    .toContain('Aucun double compte');
});
test('admin can prepare shipment + freight, market_operator only reads',()=>{
  const admin=mount('admin');
  const tasks=all(admin.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent);
  expect(tasks).toContain('Nouvelle expédition · colis remis par le Hub');
  expect(tasks).toContain('Enregistrer la facture réelle du fret (sans double imputation)');
  const market=mount('market_operator');
  expect(all(market.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .toEqual(['Preuves et historique · 0 événement(s)']);
  expect(all(market.root,n=>n.tagName==='FORM')).toHaveLength(0);
});
test('arrival charge capture, customs link, relay cost restricted to post-release stage',()=>{
  const arrival=mount('admin','arrival',{stage:'arrived'});
  expect(all(arrival.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .toEqual(expect.arrayContaining(['Lier le dossier douane existant','Constater un frais à l’arrivée (justificatif obligatoire)']));
  expect(all(arrival.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .not.toContain('Enregistrer la facture réelle du fret (sans double imputation)');
  const relayEarly=mount('admin','relay',{stage:'arrived'});
  expect(all(relayEarly.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .not.toContain('Coût du transport local jusqu’au relais');
  const relayReleased=mount('admin','relay',{stage:'customs_released'});
  expect(all(relayReleased.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .toContain('Coût du transport local jusqu’au relais');
});
test('roles only see their next authorized physical step, no implicit payment/margin action',()=>{
  const handover=mount('agent_hub','transport',{stage:'hub_ready'});
  expect(all(handover.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .toContain('Confirmer : Remis au transitaire');
  const forwarder=mount('agent_transitaire','transport',{stage:'handed_over'});
  expect(all(forwarder.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .toContain('Confirmer : Réceptionné par le transitaire');
  expect(all(forwarder.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent))
    .not.toContain('Enregistrer la facture réelle du fret (sans double imputation)');
  const file=fs.readFileSync(path.resolve(__dirname,'../../public/dashboards/canonical/js/international-journey-panel.js'),'utf8');
  expect(file).not.toContain('order_item_real_cost_allocations');
  expect(file).not.toMatch(/\bwindow\.prompt\b/);
  expect(file).not.toMatch(/\binnerHTML\b/);
});

test('only an admin sees N1 reconciliation after customs dossier is linked',()=>{
  const admin=mount('admin','arrival',{customs_reference:'CUS-1',cost_reconciliation:'pending_reconciliation'});
  const controls=all(admin.root,n=>n.tagName==='BUTTON').map(n=>n.textContent);
  expect(controls).toContain('Rapprocher les coûts réels (N1)');
  expect(all(admin.root,n=>n.className==='kmc-journey-cost-alert')[0].textContent).toContain('N1 à actualiser');
  const market=mount('market_operator','arrival',{customs_reference:'CUS-1'});
  expect(all(market.root,n=>n.tagName==='BUTTON').map(n=>n.textContent))
    .not.toContain('Rapprocher les coûts réels (N1)');
});
