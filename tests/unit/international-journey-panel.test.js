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
  expect(headings).toEqual(['Référence','Étape','Transitaire','KOM-BOX','Volume facturé','Fret réel','ETA','Dossier']);
  expect(all(root,n=>n.className==='kmc-journey-cost-alert').at(0).textContent)
    .toContain('Un coût inconnu ne signifie jamais zéro');
});
test('nouveaux dossiers depuis Hub Live, fret admin et lecture seule responsable marché',()=>{
  const admin=mount('admin');
  const tasks=all(admin.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent);
  expect(tasks).not.toContain('Nouvelle expédition · colis remis par le Hub');
  expect(all(admin.root,n=>n.tagName==='A').map(n=>n.textContent)).toContain('Ouvrir Hub Live · Approvisionnement');
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
  expect(controls).toContain('Actualiser les coûts constatés de l’expédition');
  expect(all(admin.root,n=>n.className==='kmc-journey-cost-alert')[0].textContent).toContain('actualiser le relevé');
  const market=mount('market_operator','arrival',{customs_reference:'CUS-1'});
  expect(all(market.root,n=>n.tagName==='BUTTON').map(n=>n.textContent))
    .not.toContain('Actualiser les coûts constatés de l’expédition');
});

test('un dossier KOM-BOX distingue les vrais cartons des colis historiques et demande transitaire à la remise',()=>{
  const x=mount('agent_hub','transport',{
    stage:'hub_ready',hub_draft:true,parcel_count:0,hub_unit_count:2,forwarder_name:null,transport_mode:null,
  });
  const tr=all(x.root,n=>n.tagName==='TR').at(1);
  expect(all(tr,n=>n.tagName==='TD').map(n=>n.textContent)).toEqual(
    expect.arrayContaining(['2','À désigner'])
  );
  const summaries=all(x.root,n=>n.tagName==='SUMMARY').map(n=>n.textContent);
  expect(summaries).toContain('Confirmer : Remis au transitaire');
  const names=all(x.root,n=>n.tagName==='INPUT'||n.tagName==='SELECT').map(n=>n.name);
  expect(names).toContain('forwarder_name');
  expect(names).toContain('transport_mode');
  expect(names).toContain('proof_ref');
});

test('remise transitaire visible par défaut pour le Hub, sans ouvrir les actions secondaires ni élargir les droits',()=>{
  const data={stage:'hub_ready',hub_draft:true,forwarder_name:null,transport_mode:null};
  const findTask=root=>all(root,n=>n.tagName==='DETAILS'&&n.children[0]?.textContent==='Confirmer : Remis au transitaire');
  for(const role of ['agent_hub','admin']){
    const {root}=mount(role,'transport',data);
    const tasks=findTask(root);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].open).toBe(true);
    expect(all(tasks[0],n=>n.tagName==='BUTTON'&&n.type==='submit')).toHaveLength(1);
    expect(all(tasks[0],n=>n.name==='proof_ref')[0].required).toBe(true);
    const custody=all(root,n=>n.attributes?.['data-journey-custody-scan']==='HUB_HANDOVER');
    expect(custody).toHaveLength(1);
    expect(custody[0].open).toBe(true);
    expect(all(root,n=>n.tagName==='DETAILS'&&n!==tasks[0]&&n!==custody[0]).every(n=>!n.open)).toBe(true);
  }
  for(const role of ['agent_transitaire','market_operator','agent_relais']){
    expect(findTask(mount(role,'transport',data).root)).toHaveLength(0);
  }
  expect(findTask(mount('agent_hub','transport',{...data,stage:'handed_over'}).root)).toHaveLength(0);
});

test('chaque tâche possède une clé distincte et le panneau expose sa génération',()=>{
  const {root,ctx,row}=mount();
  const keys=all(root,n=>n.tagName==='DETAILS').map(n=>n.attributes['data-journey-task']);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.every(k=>JSON.parse(k).includes(ctx.marketCode))).toBe(true);
  const section=panel.render({createElement:node},root,ctx,[row]);
  expect(section.attributes).toMatchObject({'data-ready':'true','data-render-epoch':'2'});
});

test('Prochain geste Hub : remonter à la remise transitaire avec la preuve existante, sans POST',()=>{
  const {root,ctx}=mount('agent_hub','transport',{stage:'hub_ready',hub_draft:true});
  const cards=all(root,n=>n.attributes?.['data-journey-next-action']!==undefined);
  expect(cards).toHaveLength(1);
  expect(all(cards[0],n=>n.className==='kmc-journey-next-state').map(n=>n.textContent))
    .toEqual(expect.arrayContaining(['Actuel : En préparation au Hub','Prochaine preuve : Remis au transitaire']));
  const go=all(cards[0],n=>n.attributes?.['data-journey-next-cta']==='open');
  expect(go).toHaveLength(1);
  const physical=all(root,n=>n.attributes?.['data-journey-next-task']!==undefined);
  expect(physical).toHaveLength(1);
  physical[0].open=false;
  go[0].events.click();
  expect(physical[0].open).toBe(true);
  expect(ctx.fetch).not.toHaveBeenCalled();
  expect(ctx.reload).not.toHaveBeenCalled();
});

test('Seul un acteur habilité voit une action ; la transition douane change seulement d’onglet',()=>{
  const readOnly=mount('market_operator','transport',{stage:'hub_ready'});
  expect(all(readOnly.root,n=>n.attributes?.['data-journey-next-cta']!==undefined)).toHaveLength(0);
  expect(all(readOnly.root,n=>n.className==='kmc-journey-next-wait')).toHaveLength(1);
  const otherActor=mount('agent_transitaire','transport',{stage:'hub_ready'});
  expect(all(otherActor.root,n=>n.attributes?.['data-journey-next-cta']!==undefined)).toHaveLength(0);
  const admin=mount('admin','transport',{stage:'arrived'});
  const switchTab=all(admin.root,n=>n.attributes?.['data-journey-next-cta']==='switch-tab');
  expect(switchTab).toHaveLength(1);
  expect(switchTab[0].textContent).toBe('Aller à Arrivée & douane');
  switchTab[0].events.click();
  expect(admin.ctx.journeyTab).toBe('arrival');
  expect(admin.ctx.reload).toHaveBeenCalledTimes(1);
  expect(admin.ctx.fetch).not.toHaveBeenCalled();
  const arrival=mount('admin','arrival',{stage:'arrived'});
  expect(all(arrival.root,n=>n.attributes?.['data-journey-next-task']!==undefined)).toHaveLength(1);
});

test('Bloc de guidage Shipping responsive, sans modifier les états ni créer un second writer',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../../public/dashboards/canonical/css/international-journey-panel.css'),'utf8');
  expect(css).toContain('.kmc-journey-next {');
  expect(css).toContain('@media(max-width:760px)');
  expect(css).toContain('.kmc-journey-next-button:focus-visible');
  const source=fs.readFileSync(path.resolve(__dirname,'../../public/dashboards/canonical/js/international-journey-panel.js'),'utf8');
  expect(source).toContain("transitionTask.setAttribute('data-journey-next-task','');");
  expect(source).toContain("transitionTask.scrollIntoView?.({block:'start',behavior:'auto'});");
  expect(source).not.toContain('window.prompt');
});

test('la chaîne COMBOX expose un scan distinct par étape et aucune action au responsable lecture seule',()=>{
  const hub=mount('agent_hub','transport',{stage:'hub_ready',hub_draft:true});
  expect(all(hub.root,n=>n.attributes?.['data-journey-custody-scan']==='HUB_HANDOVER')).toHaveLength(1);
  const accepted=mount('agent_transitaire','transport',{stage:'handed_over',hub_draft:true});
  expect(all(accepted.root,n=>n.attributes?.['data-journey-custody-scan']==='CARRIER_ACCEPTED')).toHaveLength(1);
  const loaded=mount('agent_transitaire','transport',{stage:'forwarder_received',hub_draft:true});
  expect(all(loaded.root,n=>n.attributes?.['data-journey-custody-scan']==='CARRIER_LOADED')).toHaveLength(1);
  const names=all(loaded.root,n=>n.tagName==='SELECT'||n.tagName==='INPUT').map(n=>n.name);
  expect(names).toContain('container_sealed');
  const readOnly=mount('market_operator','transport',{stage:'handed_over',hub_draft:true});
  expect(all(readOnly.root,n=>n.attributes?.['data-journey-custody-scan']!==undefined)).toHaveLength(0);
});

test('Kanban départ : manifeste complet avant remise, aucune tâche transitaire ou financière',()=>{
  const doc={createElement:node},root=node('main');
  const ctx={user:{role:'agent_hub'},marketCode:'KM',journeyTab:'transport',fetch:jest.fn(),reload:jest.fn()};
  const shipment={reference:'S1',stage:'hub_ready',hub_draft:true};
  const boxes=[{reference:'BOX-A',state:'DISPATCHED'},{reference:'BOX-B',state:'PACKED'}];
  panel.renderHubHandover(doc,root,ctx,{shipment,hub_units:boxes});
  expect(all(root,n=>n.tagName==='FORM')).toHaveLength(0);
  boxes[1].state='DISPATCHED';
  const ready=node('main');
  panel.renderHubHandover(doc,ready,ctx,{shipment,hub_units:boxes});
  expect(all(ready,n=>n.tagName==='SUMMARY').map(n=>n.textContent)).toEqual(['Hub · scanner et confirmer la remise de chaque COMBOX','Confirmer : Remis au transitaire']);
  expect(all(ready,n=>n.name==='transport_mode')[0].children[0].value).toBe('');
  expect(panel.renderHubHandover(doc,node('main'),{...ctx,user:{role:'agent_transitaire'}},{shipment,hub_units:boxes})).toBeNull();
  expect(panel.renderHubHandover(doc,node('main'),ctx,{shipment:{...shipment,stage:'handed_over'},hub_units:boxes})).toBeNull();
});
