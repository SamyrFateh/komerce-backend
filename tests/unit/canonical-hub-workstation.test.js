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
    value:'', open:false, textContent:'',
    classList: {
      add(key) { classes.add(key); },
      toggle(key, flag) { if (flag) classes.add(key); else classes.delete(key); },
      contains(key) { return classes.has(key); },
    },
    appendChild(child) { this.children.push(child); child.parentNode=this; return child; },
    replaceChildren(...nodes) { this.children=nodes; nodes.forEach(x=>x.parentNode=this); },
    setAttribute(k,v) { this.attrs[k]=String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
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
const doc = { createElement: el };
const load = () => {
  jest.resetModules();
  delete global.KomerceCanonicalHubWorkstation;
  require('../../public/dashboards/canonical/js/hub-workstation.js');
  return global.KomerceCanonicalHubWorkstation;
};
const mockFetch = data => jest.fn(async url => ({
  ok:true, json:async () => url.startsWith('/api/purchasing') ? {purchase_orders:data.po||[]} : {orders:data.orders||[]},
}));

test('la mini-app administrative compose deux branches et le vrai workspace achats', async () => {
  const app=load(), root=el('main'), admin=jest.fn(), ops=jest.fn();
  const api=app.mount({
    root,user:{role:'admin'},document:doc,location:{search:'?branch=administrative&market=KM'},
    fetch:mockFetch({po:[]}),renderAdministrative:admin,renderOperations:ops,
  });
  await api.reloadCases();
  expect(admin).toHaveBeenCalledTimes(1);
  expect(ops).not.toHaveBeenCalled();
  expect(root.children[1].querySelectorAll('[data-hub-branch]')).toHaveLength(2);
  expect(root.children[2].querySelectorAll('[data-hub-branch-workspace]')).toHaveLength(1);
  expect(root.children[2].querySelectorAll('[data-hub-case-list]')).toHaveLength(1);
});

test('un agent Hub ne peut pas ouvrir le mode administratif par URL', async () => {
  const app=load(),root=el('main'),admin=jest.fn(),ops=jest.fn();
  const api=app.mount({
    root,user:{role:'agent_hub'},document:doc,location:{search:'?branch=administrative&market=KM'},
    fetch:mockFetch({orders:[]}),renderAdministrative:admin,renderOperations:ops,
  });
  await api.reloadCases();
  expect(api.branch).toBe('operations');
  expect(admin).not.toHaveBeenCalled();
  expect(ops).toHaveBeenCalledTimes(1);
  expect(root.children[1].querySelectorAll('[data-hub-branch]')).toHaveLength(1);
});
test('la file administrative vient de GET /api/purchasing et ouvre un détail PO dans la colonne droite', async () => {
  const app=load(),root=el('main'),history={pushState:jest.fn()},location={search:'?branch=administrative&market=KM'};
  const fetch=mockFetch({po:[{id:'PO-42',supplier_name:'Magasin Dubaï',status:'draft'}]});
  const renderAdministrative=jest.fn();
  const api=app.mount({root,user:{role:'admin'},document:doc,location,history,fetch,
    renderAdministrative,renderOperations:jest.fn()});
  await api.reloadCases();
  const entries=root.querySelectorAll('[data-hub-case]');
  expect(entries).toHaveLength(1);
  entries[0].click();
  expect(history.pushState).toHaveBeenCalledWith(null,'','/admin/hub?branch=administrative&market=KM&po=PO-42');
  expect(renderAdministrative).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledWith('/api/purchasing',expect.objectContaining({method:'GET'}));
  expect(entries[0].classList.contains('is-selected')).toBe(true);
});
test('la file opérationnelle affiche les seules commandes IMPORT projetées par le serveur et ouvre leur parcours', async () => {
  const app=load(),root=el('main'),location={search:'?branch=operations&market=KM'};
  const card=el('details'); card.setAttribute('data-hub-order','order-1');
  const operationMount=jest.fn(host=>host.appendChild(card));
  const fetch=mockFetch({orders:[{id:'order-1',reference:'KOM-001',status:'confirmed',items:[{id:'item-1'}]}]});
  const api=app.mount({root,user:{role:'agent_hub'},document:doc,location,fetch,
    renderAdministrative:jest.fn(),renderOperations:operationMount});
  await api.reloadCases();
  expect(fetch).toHaveBeenCalledWith('/api/hub/dossier?market=KM',expect.objectContaining({method:'GET'}));
  const entries=root.querySelectorAll('[data-hub-case]');
  expect(entries).toHaveLength(1);
  entries[0].click();
  expect(card.open).toBe(true);
});
test('marché implicite unique : la file opérationnelle utilise la délégation serveur', async () => {
  const app=load(),root=el('main'),fetch=mockFetch({orders:[]});
  const api=app.mount({root,user:{role:'agent_hub'},document:doc,location:{search:'?branch=operations'},
    adminContext:{access:{allowedMarkets:['KM']}},fetch,
    renderAdministrative:jest.fn(),renderOperations:jest.fn()});
  await api.reloadCases();
  expect(fetch).toHaveBeenCalledWith('/api/hub/dossier?market=KM',expect.anything());
});
test('le retour de branche conserve le marché mais jamais la PO côté opérations', () => {
  const app=load();
  expect(app.href('operations','?market=KM&po=PO-42')).toBe('/admin/hub?market=KM&branch=operations');
  expect(app.href('administrative','?market=KM')).toBe('/admin/hub?market=KM&branch=administrative');
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
  expect(nav).toContain("id: 'hub-workstation'");
  expect(html).toContain('/dashboards/canonical/js/hub-workstation.js');
  expect(routes).toContain("'/admin/hub'");
});
