'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

function el(tag) {
  const handlers = {};
  const classes = new Set();
  const node = {
    tagName: tag.toUpperCase(), className:'', children:[], attrs:{},
    value:'', open:false, textContent:'', style:{},
    get lastChild() { return this.children[this.children.length-1] || null; },
    classList: {
      add(key) { classes.add(key); },
      remove(key) { classes.delete(key); },
      toggle(key, flag) { if (flag) classes.add(key); else classes.delete(key); },
      contains(key) { return classes.has(key); },
    },
    appendChild(child) { this.children.push(child); child.parentNode=this; return child; },
    replaceChildren(...nodes) { this.children=nodes; nodes.forEach(x=>x.parentNode=this); },
    setAttribute(k,v) { this.attrs[k]=String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
    removeAttribute(k) { delete this.attrs[k]; },
    contains(child) { for (let node=child; node; node=node.parentNode) if(node===this) return true; return false; },
    addEventListener(evt,fn) { handlers[evt]=fn; },
    click() { if (handlers.click) handlers.click({target:this}); },
    change(target) { if (handlers.change) handlers.change({target}); },
    input(value) { this.value=value; if (handlers.input) handlers.input({target:this}); },
    querySelectorAll(selector) {
      const key=(selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/)||[]);
      if (!key.length) return [];
      const found=[];
      const visit=(item)=>{
        if (Object.prototype.hasOwnProperty.call(item.attrs,key[1]) && (key[2]===undefined || item.attrs[key[1]]===key[2])) found.push(item);
        (item.children||[]).forEach(visit);
      };
      this.children.forEach(visit);
      return found;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    scrollIntoView: jest.fn(),
  };
  return node;
}
const doc = { createElement: el,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};
const load = () => {
  jest.resetModules();
  delete global.KomerceCanonicalHubWorkstation;
  require('../../public/dashboards/canonical/js/hub-workstation.js');
  return global.KomerceCanonicalHubWorkstation;
};
const mockFetch = data => jest.fn(async url => ({
  ok:true, json:async () => url === '/api/hub/administration' ?
    {scope:'HUB_ADMINISTRATION_GLOBAL',kpis:{purchase_orders:(data.po||[]).length},purchase_orders:data.po||[]} :
    url === '/api/hub/board' ? {scope:'HUB_GLOBAL',orders:data.orders||[]} :
    {orders:data.orders||[],purchase_orders:data.po||[]},
}));

test('Administration et Opérations occupent toute la largeur sans rail doublon', async () => {
  const app=load(),root=el('main'),admin=jest.fn(),ops=jest.fn();
  const api=app.mount({root,user:{role:'admin'},document:doc,
    location:{search:'?branch=administrative&market=KM'},fetch:mockFetch({}),
    renderAdministrative:admin,renderOperations:ops});
  expect(api.branch).toBe('administrative');
  expect(root.children[1].querySelectorAll('[data-hub-branch]')).toHaveLength(2);
  expect(root.children[2].className).toContain('is-table');
  expect(root.querySelectorAll('[data-hub-case-list]')).toHaveLength(0);
  expect(admin).toHaveBeenCalledTimes(1);
  expect(ops).not.toHaveBeenCalled();
  await api.reloadCases();
  expect(admin).toHaveBeenCalledTimes(2);
});

test('un agent Hub voit les deux branches, sans autorisation de paiement ajoutée', () => {
  const app=load(),root=el('main'),admin=jest.fn();
  const mounted=app.mount({root,user:{role:'agent_hub'},document:doc,location:{search:'?branch=administrative'},
    renderAdministrative:admin,renderOperations:jest.fn()});
  expect(mounted.branch).toBe('administrative');
  expect(root.querySelectorAll('[data-hub-branch]')).toHaveLength(2);
  expect(admin).toHaveBeenCalledTimes(1);
});

test('un relais reste sur la consultation Opérations malgré une URL Administration', () => {
  const app=load(),root=el('main'),admin=jest.fn(),ops=jest.fn();
  const mounted=app.mount({root,user:{role:'agent_relais'},document:doc,location:{search:'?branch=administrative'},
    renderAdministrative:admin,renderOperations:ops});
  expect(mounted.branch).toBe('operations');
  expect(root.querySelectorAll('[data-hub-branch]')).toHaveLength(1);
  expect(admin).not.toHaveBeenCalled();
  expect(ops).toHaveBeenCalledTimes(1);
});

test('Administration charge le tableau PO de tous les marchés et les preuves sans mutation', async () => {
  const app=load(),root=el('main'),po={id:'10000000-0000-4000-8000-000000000001',
    supplier:'Alpha Trading',market:'KM',stage:'draft',order_count:3,expected:4,received:1,
    payment_count:1,verified_debit_count:0,payment_evidence:'Débit à rapprocher',
    commitment_authorization:'À valider',payment_authorization:'À autoriser'};
  const fetch=mockFetch({po:[po]});
  const payload=await app.renderAdministrationBoard(root,{document:doc,fetch,user:{role:'admin'}});
  expect(payload.scope).toBe('HUB_ADMINISTRATION_GLOBAL');
  expect(fetch).toHaveBeenCalledWith('/api/hub/administration',expect.objectContaining({method:'GET'}));
  expect(root.querySelectorAll('[data-hub-admin-po]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-hub-admin-stage="Engagement"]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-hub-admin-stage="Paiement"]')).toHaveLength(1);
  root.querySelectorAll('[data-hub-admin-stage="Paiement"]')[0].click();
  expect(root.querySelectorAll('[data-hub-admin-menu]')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  const paymentTab=root.querySelectorAll('[data-hub-admin-view="payments"]')[0];
  paymentTab.click();
  expect(root.querySelectorAll('[data-hub-admin-stage="Autorisation"]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-hub-admin-po]')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('Administration ne donne pas accès à un profil non Hub même via appel direct', async () => {
  const app=load();
  await expect(app.renderAdministrationBoard(el('main'),{document:doc,fetch:mockFetch({}),
    user:{role:'agent_relais'}})).rejects.toThrow('hub_admin_board_role_not_allowed');
});

test('la vue Opérations reste globale sans contexte de marché délégué', async () => {
  const app=load(),root=el('main'),fetch=mockFetch({orders:[]});
  const mounted=app.mount({root,user:{role:'agent_hub'},document:doc,
    location:{search:'?branch=operations&market=KM'},fetch,
    renderAdministrative:jest.fn(),
    renderOperations:host=>app.renderGlobalBoard(host,{document:doc,fetch,user:{role:'agent_hub'}})});
  await mounted.reloadCases();
  expect(fetch).toHaveBeenCalledWith('/api/hub/board',expect.anything());
  expect(fetch).not.toHaveBeenCalledWith(expect.stringMatching(/dossier\?market/),expect.anything());
  expect(root.querySelectorAll('[data-hub-case-list]')).toHaveLength(0);
});

test('H4 : la directrice voit les tâches CM et KM depuis /admin/hub, sans writer', async () => {
  const app=load(),root=el('main');
  const task=(market,code,hours,overdue) => ({
    id:'BOX_BAGS',kind:'BOX_BAGS',missing:'Sacs à mettre en carton',
    why:'Attente de préparation physique',market:{code:market},age_hours:hours,overdue,
    subject:{box_unit_id:code},
  });
  const fetch=jest.fn(async (url,opts) => {
    if (url === '/api/hub/director-todo') return {
      ok:true,json:async()=>({scope:'ALL_MARKETS',overdue_count:1,tasks:[
        task('CM','cm-1',53,true),task('KM','km-2',17,false),
      ]})
    };
    return {ok:true,json:async()=>({scope:'HUB_GLOBAL',orders:[]})};
  });
  const mounted=app.mount({
    root,user:{role:'agent_hub'},document:doc,location:{search:'?branch=operations'},fetch,
    renderAdministrative:jest.fn(),renderOperations:jest.fn(),
  });
  await mounted.directorLoad;
  expect(fetch).toHaveBeenCalledWith('/api/hub/director-todo', expect.objectContaining({method:'GET',credentials:'include'}));
  expect(root.querySelectorAll('[data-hub-director-todo]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-hub-director-task="BOX_BAGS"]')).toHaveLength(2);
  const rows=root.querySelectorAll('[data-hub-director-task="BOX_BAGS"]');
  expect(rows[0].className).toContain('is-overdue');
  expect(rows[0].children.some(x=>x.getAttribute('href')==='/admin/hub-live?view=execute&market=CM')).toBe(true);
  expect(rows[1].children.some(x=>x.getAttribute('href')==='/admin/hub-live?view=execute&market=KM')).toBe(true);
  expect(fetch.mock.calls.every(call=>call[1].method === 'GET')).toBe(true);
  const relayRoot=el('main');
  const relay=app.mount({root:relayRoot,user:{role:'agent_relais'},document:doc,location:{search:''},fetch,
    renderAdministrative:jest.fn(),renderOperations:jest.fn()});
  await relay.directorLoad;
  expect(relayRoot.querySelectorAll('[data-hub-director-todo]')).toHaveLength(0);
});

test('les liens Hub ne conservent jamais le paramètre market', () => {
  const app=load();
  expect(app.href('operations','?market=KM&po=PO-42')).toBe('/admin/hub?branch=operations');
  expect(app.href('administrative','?market=KM')).toBe('/admin/hub?branch=administrative');
  expect(app.parseBranch('?branch=unknown')).toBe('operations');
});
test('le poste intégré est raccordé au vrai routeur, pas à une page de démonstration', () => {
  const root=path.join(__dirname,'../..');
  const appSrc=fs.readFileSync(path.join(root,'public/dashboards/canonical/js/app.js'),'utf8');
  const nav=fs.readFileSync(path.join(root,'public/dashboards/canonical/js/navigation-policy-v4.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public/dashboards/canonical/index.html'),'utf8');
  const routes=fs.readFileSync(path.join(root,'bootstrap/html-routes.js'),'utf8');
  expect(appSrc).toContain('renderHubWorkstation(root, user, adminContext)');
  expect(appSrc).toContain("if (path === '/admin/hub')");
  expect(appSrc).toContain('history: global.history, fetch: global.fetch.bind(global), adminContext');
  expect(nav).toContain("id: 'live-hub'");
  expect(html).toContain('/dashboards/canonical/js/hub-workstation.js');
  expect(routes).toContain("'/admin/hub'");
});


test.each(['admin','agent_hub','market_operator','agent_relais','finance','sourcing','support'])(
  'Hub global consultable par %s sans marché explicite', async role => {
    const app=load(),root=el('main'),admin=jest.fn(),ops=jest.fn();
    const fetch=mockFetch({orders:[]});
    const mounted=app.mount({root,user:{role},document:doc,location:{search:''},
      fetch,renderAdministrative:admin,renderOperations:ops});
    expect(mounted.branch).toBe('operations');
    expect(ops).toHaveBeenCalledTimes(1);
    expect(admin).not.toHaveBeenCalled();
    await mounted.reloadCases();
    expect(ops).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/dossier\?market=/),expect.anything());
  }
);

test('le tableau global n’expose aucune action Hub à un relais et agrège plusieurs pays', async () => {
  const app=load(),root=el('main'),fetch=mockFetch({orders:[
    {id:'1',reference:'KM-1',market:'KM',market_name:'Comores',po:'À constituer',supplier:'Non commandé',
      reception:'Non reçue',cartons:'À préparer',departure:'Pas de départ',remaining:'1 non reçue(s)',attention:true},
    {id:'2',reference:'CM-2',market:'CM',market_name:'Cameroun',po:'1 PO liée(s)',supplier:'Attente fournisseur',
      reception:'1 / 2 reçu(s)',cartons:'À préparer',departure:'Pas de départ',remaining:'1 non reçue(s)',attention:true},
  ]});
  const data=await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'agent_relais'}});
  expect(data.scope).toBe('HUB_GLOBAL');
  expect(root.querySelectorAll('[data-hub-global-order]')).toHaveLength(2);
  expect(fetch).toHaveBeenCalledWith('/api/hub/board',expect.objectContaining({method:'GET'}));
  const order=root.querySelectorAll('[data-hub-global-order]')[0];
  const stage=order.querySelectorAll('[data-hub-global-stage]')[0];
  stage.click();
  expect(root.querySelectorAll('[data-hub-global-menu]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-hub-global-menu]')[0].children.some(x=>x.tagName==='A')).toBe(false);
  expect(JSON.stringify(data)).not.toContain('supplier_price');
});

test('Hub global refuse agent_transitaire (acces limite a Expeditions & Douane)', () => {
  const app=load();
  expect(() => app.mount({root:el('main'),user:{role:'agent_transitaire'},document:doc,location:{search:''},
    fetch:mockFetch({orders:[]}),renderAdministrative:jest.fn(),renderOperations:jest.fn()})).toThrow('hub_workstation_role_not_allowed');
});
