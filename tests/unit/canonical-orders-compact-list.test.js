'use strict';

/** @test-kind unit @test-runner jest @test-requires none
 * Commandes must stay a useful list: hero, single file filter, exception signal,
 * full-width rows, and directly accessible Order 360 without extra dashboards.
 */
const orders=require('../../public/dashboards/canonical/js/orders');

function node(tag='div') {
  return {
    tagName:tag.toUpperCase(), className:'', textContent:'', children:[], attrs:{}, events:{},
    value:'', selected:false, classList:{add(){}},
    setAttribute(name,value){this.attrs[name]=String(value);},
    appendChild(child){this.children.push(child);return child;},
    addEventListener(name,cb){this.events[name]=cb;},
  };
}
function find(root,predicate) {
  if(predicate(root)) return root;
  for(const child of root.children) {
    const value=find(child,predicate);
    if(value) return value;
  }
  return null;
}
function findAll(root,predicate,out=[]) {
  if(predicate(root)) out.push(root);
  for(const child of root.children) findAll(child,predicate,out);
  return out;
}
const fixture={
  summary:{ cash_to_confirm:1, orders_to_order:1, active_orders:2 },
  signals:{paiements_en_attente:1,retraits_en_retard:1,litiges_ouverts:0,commandes_bloquees:0},
  funnel:{creees:12,payees:11,expediees:3,disponibles_relais:1,retirees:0},
  work_queues:{
    pending_cash:[{reference:'CMD-1',status:'pending',payment_status:'pending',market_code:'KM',total_kmf:25000}],
    ready_for_parcel:[{reference:'CMD-2',status:'confirmed',payment_status:'paid',market_code:'KM',
      total_kmf:15000,actionable:true,product_lines:1}],
    ready_for_parcel_total:1,ready_for_parcel_shown:1,
  },
  priority_orders:[],
};

async function render(payload,initialSearch='') {
  const root=node('main'), doc={createElement:node};
  const location=globalThis.location, navigation=globalThis.KomerceCanonicalNavigation;
  globalThis.location={pathname:'/admin/orders',search:initialSearch,hash:''};
  globalThis.KomerceCanonicalNavigation={withEntityReturnTo:(path,origin)=>path+'?return_to='+encodeURIComponent(origin)};
  try {
    await orders.mount({root,document:doc,
      fetch:async()=>({ok:true,json:async()=>payload}),
      adminContext:{},contextContract:{resolveMarketView:()=>({mode:'global'})}});
    return root.children[0];
  } finally {
    if(location===undefined) delete globalThis.location; else globalThis.location=location;
    if(navigation===undefined) delete globalThis.KomerceCanonicalNavigation;
    else globalThis.KomerceCanonicalNavigation=navigation;
  }
}

test('only meaningful alert survives; old top cards, bottom funnel and parallel preview do not',async()=>{
  const page=await render(fixture);
  expect(page.children).toHaveLength(2); // illustrated Hero + full-width register
  expect(page.children[0].attrs['data-dashboard-role']).toBe('hero');
  expect(page.children[1].attrs['data-dashboard-role']).toBe('primary');
  for(const old of ['kmc-ord-kpis','kmc-ord-foot','kmc-ord-funnel','kmc-ord-signals','kmc-ord-detail']) {
    expect(find(page,x=>x.className===old)).toBeNull();
  }
  const attention=find(page,x=>x.className==='kmc-ord-attention');
  expect(attention).not.toBeNull();
  expect(attention.textContent).toContain('1 retrait en retard');
  expect(attention.textContent).not.toContain('paiements en attente'); // in file selector already
  expect(attention.textContent).not.toContain('0 litiges');
  expect(find(page,x=>x.className==='kmc-ord-list-count').textContent)
    .toBe('2 commandes affichées');
  const queue=find(page,x=>x.attrs['data-ord-queue']==='');
  expect(queue.children).toHaveLength(orders.TABS.length);
  expect(queue.value).toBe('all');
  const link=find(page,x=>x.attrs['data-ord-open']==='CMD-1');
  expect(link.textContent).toBe('Voir 360');
  expect(link.className).toBe('kmc-entity-360-action');
  // Exactly as in Clients: the last column is a dossier link, not an
  // imaginary action list. Execution remains in Hub/Relais workspaces.
  const headers=findAll(page,x=>x.tagName==='TH').map(x=>x.textContent);
  expect(headers.at(-1)).toBe('Dossier');
  expect(headers).not.toContain('Action');
  const listed=findAll(page,x=>x.tagName==='TR'&&x.attrs['data-ord-row']);
  expect(listed).toHaveLength(2);
  for(const row of listed){
    expect(row.children).toHaveLength(headers.length);
    const last=row.children.at(-1);
    expect(last.className).toBe('kmc-ord-cell-dossier');
    expect(last.children).toHaveLength(1);
    expect(last.children[0].textContent).toBe('Voir 360');
    expect(last.children[0].attrs['data-ord-open']).toBe(row.attrs['data-ord-row']);
    expect(last.textContent).not.toContain('Confirmer le paiement');
  }
  expect(find(page,x=>x.attrs['data-ord-hub-execution'])).toBeNull();
  expect(find(page,x=>x.className==='kmc-ord-action-label')).toBeNull();
});

test('empty and unavailable signals are not converted into zero or decorative cards',async()=>{
  const page=await render({work_queues:{},priority_orders:[],signals:{retraits_en_retard:null}});
  expect(find(page,x=>x.className==='kmc-ord-attention')).toBeNull();
  expect(find(page,x=>x.className==='kmc-ord-empty').textContent).toContain('Aucune commande');
  expect(find(page,x=>x.className==='kmc-ord-list-count').textContent).toBe('0 commande affichée');
});

test('only rendered rows are counted; server projection truncation remains disclosed',async()=>{
  const page=await render({...fixture,work_queues:{
    ...fixture.work_queues,pending_cash_total:30,pending_cash_shown:1,
  }});
  const note=find(page,x=>x.className==='kmc-ord-muted');
  expect(note.textContent).toContain('Liste partielle');
  expect(find(page,x=>x.className==='kmc-ord-list-count').textContent).toBe('2 commandes affichées');
});
