'use strict';

/** @test-kind unit @test-runner jest @test-requires none
 * Consistent 360 entry + exact return context, without business mutations.
 */
const orders = require('../../public/dashboards/canonical/js/orders');
const clients = require('../../public/dashboards/canonical/js/client-index');
const order360 = require('../../public/dashboards/canonical/js/order-360');
const client360 = require('../../public/dashboards/canonical/js/client-360');

function node(tag='div') {
  return {
    tagName:tag.toLowerCase(), className:'', children:[], textContent:'',
    attributes:{}, listeners:{}, classList:{add(){}},
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children=children; },
    setAttribute(name,value) {this.attributes[name]=String(value);},
    addEventListener(name,cb) {this.listeners[name]=cb;},
    querySelector(selector) {
      return selector === '.kmc-entity-extras'
        ? this.children.find(x=>x.className==='kmc-entity-extras') || null : null;
    },
  };
}
function all(root, out=[]) {
  out.push(root);
  for (const child of root.children || []) all(child,out);
  return out;
}
const doc={createElement:tag=>node(tag)};
const ui={
  Section:{create:()=>({element:node('section'),slot:node()})},
  DataTable:{render:()=>{}}, MetricStrip:{render:()=>{}}, AlertPanel:{render:()=>{}},
};
const oldNav=globalThis.KomerceCanonicalNavigation;
const oldLocation=globalThis.location;
const oldHistory=globalThis.history;

afterEach(()=>{
  if(oldNav===undefined) delete globalThis.KomerceCanonicalNavigation;
  else globalThis.KomerceCanonicalNavigation=oldNav;
  if(oldLocation===undefined) delete globalThis.location;
  else globalThis.location=oldLocation;
  if(oldHistory===undefined) delete globalThis.history;
  else globalThis.history=oldHistory;
});

function installNavigation() {
  // This legacy browser-first module writes to globalThis, not module.exports.
  jest.isolateModules(() => require('../../public/dashboards/canonical/js/navigation-policy-v4'));
  const nav = globalThis.KomerceCanonicalNavigation;
  if (!nav || typeof nav.withReturnTo !== 'function') throw Error('Navigation API missing');
  return nav;
}

test('both list links share Voir 360 + compact class; market and selected queue remain in origin', async()=>{
  const nav=installNavigation();
  globalThis.location={pathname:'/admin/orders',search:'?market=KM&queue=cash',hash:''};
  const orderHref=orders.orderHref('CMD-KM-42');
  const query=new URLSearchParams(orderHref.split('?')[1]);
  expect(query.get('return_to')).toBe('/admin/orders?market=KM&queue=cash');
  expect(orders.initialQueue('?market=KM&queue=cash')).toBe('cash');
  expect(orders.initialQueue('?queue=arbitrary')).toBe('all');

  const root=node('main');
  await orders.mount({root,document:doc,fetch:async()=>({ok:true,json:async()=>({
    work_queues:{pending_cash:[{
      reference:'CMD-KM-42',status:'pending',market_code:'KM',payment_status:'pending',
    }]},priority_orders:[],summary:{},signals:{},
  })}),adminContext:{},contextContract:{resolveMarketView:()=>({mode:'global'})}});
  const action=all(root).find(x=>x.tagName==='a' && x.attributes['data-ord-open']==='CMD-KM-42');
  expect(action.textContent).toBe('Voir 360');
  expect(action.className).toBe('kmc-entity-360-action');
  const href=action.attributes.href || action.href;
  expect(new URLSearchParams(href.split('?')[1]).get('return_to')).toBe('/admin/orders?market=KM&queue=cash');

  globalThis.location={pathname:'/admin/clients',search:'?market=KM&search=Amina&sort=ltv&page=2'};
  const clientHref=clients.clientHref('+2691234567');
  expect(new URLSearchParams(clientHref.split('?')[1]).get('return_to'))
    .toBe('/admin/clients?market=KM&search=Amina&sort=ltv&page=2');
  const wrap=node('div');
  clients.renderClientTable(wrap,doc,{clients:[{name:'Amina',phone:'+2691234567'}]});
  const clientAction=all(wrap).find(x=>x.tagName==='a' && x.textContent==='Voir 360');
  expect(clientAction.className).toBe(action.className);
  expect(new URLSearchParams(clientAction.attributes.href.split('?')[1]).get('return_to'))
    .toBe('/admin/clients?market=KM&search=Amina&sort=ltv&page=2');
});

test('queue and client filters survive a return; unrelated parameters remain intact',()=>{
  installNavigation();
  const edits=[];
  globalThis.location={pathname:'/admin/orders',search:'?market=KM&simulation_scope=RCT1',hash:''};
  globalThis.history={state:null,replaceState(_s,_t,next) {
    edits.push(next);
    globalThis.location.search=next.slice(next.indexOf('?'));
  }};
  orders.reflectQueueInUrl('parcel');
  expect(edits.at(-1)).toContain('queue=parcel');
  expect(edits.at(-1)).toContain('market=KM');
  expect(edits.at(-1)).toContain('simulation_scope=RCT1');

  globalThis.location={pathname:'/admin/clients',search:'?market=CM&simulation_scope=RCT1',hash:''};
  clients.reflectListState({search:'Amina',sort:'orders',page:3});
  const q=new URLSearchParams(edits.at(-1).split('?')[1]);
  expect(q.get('market')).toBe('CM');
  expect(q.get('simulation_scope')).toBe('RCT1');
  expect(q.get('search')).toBe('Amina');
  expect(q.get('sort')).toBe('orders');
  expect(q.get('page')).toBe('3');
  expect(clients.initialListState('?market=CM&search=Amina&sort=orders&page=3')).toEqual({
    search:'Amina',sort:'orders',page:3,page_size:25,
  });
  expect(clients.initialListState('?sort=unknown&page=-2').sort).toBe('recent');
  expect(clients.initialListState('?sort=unknown&page=-2').page).toBe(1);
});

test('both dossiers show one discreet return to validated origin and refuse external URL',()=>{
  const nav=installNavigation();
  globalThis.location={pathname:'/admin/orders/CMD-KM-42',
    search:'?return_to=%2Fadmin%2Forders%3Fmarket%3DKM%26queue%3Dcash&return_label=Retour+aux+commandes'};
  const orderRoot=node('main');
  order360.renderPayload(orderRoot,ui,doc,{
    order:{reference:'CMD-KM-42',status:'pending',customer:{phone:'+2691234567'},payment:{status:'pending'}},
    summary:{},items:[],
  });
  const o=all(orderRoot).find(x=>x.attributes['data-entity-return']==='order-360');
  expect(o.className).toBe('kmc-entity-return');
  expect(o.textContent).toBe('← Retour aux commandes');
  expect(o.attributes.href).toBe('/admin/orders?market=KM&queue=cash');

  globalThis.location={pathname:'/admin/clients/%2B2691234567',
    search:'?return_to=https%3A%2F%2Fevil.example&return_label=Out'};
  const clientRoot=node('main');
  client360.renderPayload(clientRoot,ui,doc,{
    client:{name:'Amina',phone:'+2691234567'},
    scope:{mode:'market',markets:[{code:'KM'}]},summary:{},finance:{},
    security:{visibility:'restricted'},orders:[],
  });
  const c=all(clientRoot).find(x=>x.attributes['data-entity-return']==='client-360');
  expect(c.textContent).toBe('← Retour aux clients');
  expect(c.attributes.href).toBe('/admin/clients');
  expect(nav.resolveBackTarget('client-360','?return_to=%2Fadmin%2Fclients%3Fsearch%3DAmina').href)
    .toBe('/admin/clients?search=Amina');
});

test('360 list actions and dossier links are read-only and keep CSS dedicated to entity routes',()=>{
  const fs=require('fs'),path=require('path');
  const base=path.resolve(__dirname,'../../public/dashboards/canonical');
  const css=fs.readFileSync(path.join(base,'css/entity-360.css'),'utf8');
  expect(css).toContain('.kmc-entity-360-action');
  expect(css).toContain('.kmc-entity-return');
  expect(css).toContain('[data-kmc-surface="order-360"] .kmc-admin-back');
  expect(css).toContain('[data-kmc-surface="client-360"] .kmc-admin-back');
  const order=fs.readFileSync(path.join(base,'js/orders.js'),'utf8');
  const client=fs.readFileSync(path.join(base,'js/client-index.js'),'utf8');
  expect(order).not.toMatch(/method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
  expect(client).not.toMatch(/method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
});
