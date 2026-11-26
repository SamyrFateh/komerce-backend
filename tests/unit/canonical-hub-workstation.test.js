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
    append(...nodes) { nodes.forEach(child=>this.appendChild(child)); },
    insertBefore(child, before) { const i=this.children.indexOf(before); if(i<0)return this.appendChild(child); this.children.splice(i,0,child); child.parentNode=this; return child; },
    remove() { if(this.parentNode){const parent=this.parentNode;parent.children=parent.children.filter(child=>child!==this);this.parentNode=null;} },
    replaceChildren(...nodes) { this.children=nodes; nodes.forEach(x=>x.parentNode=this); },
    setAttribute(k,v) { this.attrs[k]=String(v); },
    getAttribute(k) { return this.attrs[k] || null; },
    removeAttribute(k) { delete this.attrs[k]; },
    contains(child) { for (let node=child; node; node=node.parentNode) if(node===this) return true; return false; },
    addEventListener(evt,fn) { handlers[evt]=fn; },
    click() { if (handlers.click) return handlers.click({target:this}); },
    toggle(open) { this.open=open; return handlers.toggle?.({target:this}); },
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

test('Direction Hub et Administration restent dans un seul poste de travail', async () => {
  const app=load(),root=el('main'),admin=jest.fn(),ops=jest.fn();
  const api=app.mount({root,user:{role:'admin'},document:doc,
    location:{search:'?branch=administrative&market=KM'},fetch:mockFetch({}),
    renderAdministrative:admin,renderOperations:ops});
  expect(api.branch).toBe('direction');
  expect(root.querySelector('[data-hub-open-operations]')).toBeNull();
  expect(root.querySelector('[data-hub-branch="operations"]').children[0].children[0].textContent).toBe('Kanban');
  expect(root.children[1].querySelectorAll('[data-hub-branch]')).toHaveLength(2);
  expect(root.querySelectorAll('[data-hub-director-todo]')).toHaveLength(1);
  expect(root.children[2].className).toContain('is-table');
  expect(root.querySelectorAll('[data-hub-case-list]')).toHaveLength(0);
  await Promise.resolve();
  expect(admin).toHaveBeenCalledTimes(1);
  expect(ops).not.toHaveBeenCalled();
  await api.reloadCases();
  expect(admin).toHaveBeenCalledTimes(1);
});

test('un agent Hub voit le Kanban et la Direction avec l’administration comme onglet', async () => {
  const app=load(),root=el('main'),admin=jest.fn();
  const mounted=app.mount({root,user:{role:'agent_hub'},document:doc,location:{search:'?branch=administrative'},
    renderAdministrative:admin,renderOperations:jest.fn()});
  expect(mounted.branch).toBe('direction');
  expect(root.querySelectorAll('[data-hub-branch]')).toHaveLength(2);
  await Promise.resolve();
  expect(admin).toHaveBeenCalledTimes(1);
});

test('un relais reste sur la consultation Opérations malgré une URL Administration', () => {
  const app=load(),root=el('main'),admin=jest.fn(),ops=jest.fn();
  const mounted=app.mount({root,user:{role:'agent_relais'},document:doc,location:{search:'?branch=administrative'},
    renderAdministrative:admin,renderOperations:ops});
  expect(mounted.branch).toBe('operations');
  expect(root.querySelector('[data-hub-open-operations]')).toBeNull();
  expect(root.querySelectorAll('[data-hub-branch]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-hub-branch="direction"]')).toHaveLength(0);
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
    id:'PLACE_COMBOX',kind:'PLACE_COMBOX',missing:'Articles à répartir en COMBOX',
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
    root,user:{role:'agent_hub'},document:doc,location:{search:'?branch=direction'},fetch,
    renderAdministrative:jest.fn(),renderOperations:jest.fn(),
  });
  await mounted.directorLoad;
  expect(fetch).toHaveBeenCalledWith('/api/hub/director-todo', expect.objectContaining({method:'GET',credentials:'include'}));
  expect(mounted.branch).toBe('direction');
  expect(root.querySelectorAll('[data-hub-director-todo]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-hub-director-task="PLACE_COMBOX"]')).toHaveLength(2);
  const rows=root.querySelectorAll('[data-hub-director-task="PLACE_COMBOX"]');
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
  expect(app.href('direction','?market=CM&po=PO-42')).toBe('/admin/hub?branch=direction');
  expect(app.parseBranch('?branch=direction')).toBe('direction');
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

test('le Hub affiche les marchés autorisés depuis la projection serveur du responsable pays', async () => {
  const app=load(),root=el('main'),scope=el('span');
  const previousQuery=doc.querySelector;
  doc.querySelector=jest.fn(selector=>selector==='.kmc-hub-global-scope'?scope:null);
  try {
    const fetch=jest.fn(async()=>({ok:true,json:async()=>({
      scope:'HUB_GLOBAL',audience:'MARKET_SCOPED',markets:['CM'],orders:[
        {id:'cm-1',reference:'KCM001',market:'CM',market_name:'Cameroun',po:'À constituer',supplier:'Non commandé',
          reception:'Non reçue',cartons:'À préparer',departure:'Pas de départ',remaining:'1 non reçue(s)'},
      ],
    })}));
    await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'market_operator'}});
    expect(scope.textContent).toBe('Hub · CM');
  } finally {
    if(previousQuery)doc.querySelector=previousQuery;
    else delete doc.querySelector;
  }
});

test('Hub global refuse agent_transitaire (acces limite a Expeditions & Douane)', () => {
  const app=load();
  expect(() => app.mount({root:el('main'),user:{role:'agent_transitaire'},document:doc,location:{search:''},
    fetch:mockFetch({orders:[]}),renderAdministrative:jest.fn(),renderOperations:jest.fn()})).toThrow('hub_workstation_role_not_allowed');
});

test('Responsable pays voit Hub · Mes marchés (et pas le cockpit central)', () => {
  const app=load(),root=el('main');
  app.mount({root,user:{role:'market_operator'},document:doc,location:{search:''},
    fetch:mockFetch({}),renderAdministrative:jest.fn(),renderOperations:jest.fn()});
  const heading=root.children[0].children[0].children.find(x=>x.tagName==='H1');
  expect(heading.textContent).toBe('Hub · Mes marchés');
});

test('Direction Hub : engagements, paiements, arbitrages, exécution séparés et liens de dossiers contextuels', async () => {
  const app=load(), host=el('section'), po='11111111-1111-4111-8111-111111111111';
  const tasks=[
    {kind:'PLACE_COMBOX',owner:'agent_hub',market:{code:'CG'},missing:'Articles à répartir en COMBOX',age_hours:9},
    {kind:'BOX_BAGS',owner:'agent_hub',market:{code:'CG'},missing:'Ancien sac',age_hours:50,overdue:true},
    {kind:'AUTHORIZE_PAYMENT',owner:'responsable_hub',market:{code:'KM'},subject:{po_id:po},
      missing:'Autoriser le paiement',why:'Engagement distinct',viewer_can_act:false,
      blocked_reason:'réservé à la responsable Hub',age_hours:50,overdue:true},
    {kind:'AUTHORIZE_COMMITMENT',owner:'responsable_hub',market:{code:'KM'},subject:{po_id:po},
      missing:'Valider engagement',age_hours:8,viewer_can_act:true},
    {kind:'BLOCKED_BY_SHORTFALL',owner:'responsable_hub',market:{code:'CM'},
      subject:{order_id:'22222222-2222-4222-8222-222222222222'},missing:'Rupture à arbitrer',age_hours:12},
  ];
  const fetch=jest.fn(async ()=>({ok:true,json:async()=>({
    scope:'ALL_MARKETS',total:5,overdue_count:2,tasks,
  })}));
  const data=await app.renderDirectorQueue(host,{document:doc,fetch,user:{role:'admin'}});
  expect(data.total).toBe(5);
  expect(host.querySelectorAll('[data-hub-director-task="BOX_BAGS"]')).toHaveLength(0);
  expect(host.querySelector('[data-hub-legacy-review]').textContent).toContain('1 dossier(s) historiques');
  expect(host.querySelectorAll('[data-hub-director-list]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-hub-director-group="commitment"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-hub-director-group="payment"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-hub-director-group="arbitrage"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-hub-director-group="execution"]')).toHaveLength(1);
  const payments=host.querySelectorAll('[data-hub-director-task="AUTHORIZE_PAYMENT"]');
  expect(payments).toHaveLength(1);
  expect(payments[0].className).toContain('is-readonly');
  expect(payments[0].children.some(x=>x.getAttribute('href')===
    '/admin/hub?branch=operations&sel=po%3A'+po+'&decision=payment')).toBe(true);
  const physical=host.querySelectorAll('[data-hub-director-task="PLACE_COMBOX"]')[0];
  expect(physical.children.some(x=>x.getAttribute('href')===
    '/admin/hub-live?view=execute&market=CG')).toBe(true);
  expect(fetch).toHaveBeenCalledWith('/api/hub/director-todo',expect.objectContaining({method:'GET'}));
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('la vue Kanban conserve la priorité et ne charge plus la file Direction', async()=>{
  const app=load(),root=el('main'),admin=jest.fn(),ops=jest.fn();
  const fetch=mockFetch({});
  const mounted=app.mount({root,user:{role:'admin'},document:doc,fetch,
    location:{search:'?branch=operations'},renderAdministrative:admin,renderOperations:ops});
  await mounted.directorLoad;
  expect(mounted.branch).toBe('operations');
  expect(ops).toHaveBeenCalledTimes(1);
  expect(admin).not.toHaveBeenCalled();
  expect(root.querySelectorAll('[data-hub-director-todo]')).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalledWith('/api/hub/director-todo',expect.anything());
});

test('les profils non autorisés ne peuvent ouvrir Direction Hub via URL', async()=>{
  const app=load(),root=el('main'),ops=jest.fn(),admin=jest.fn();
  const mounted=app.mount({root,user:{role:'market_operator'},document:doc,
    location:{search:'?branch=direction'},fetch:mockFetch({}),
    renderAdministrative:admin,renderOperations:ops});
  expect(mounted.branch).toBe('operations');
  expect(root.querySelectorAll('[data-hub-branch="direction"]')).toHaveLength(0);
  expect(root.querySelectorAll('[data-hub-director-todo]')).toHaveLength(0);
  expect(ops).toHaveBeenCalledTimes(1);
  expect(admin).not.toHaveBeenCalled();
});

test('Direction Hub ne rend aucun workspace administratif ou physique concurrent', async()=>{
  const app=load(),root=el('main'),ops=jest.fn(),admin=jest.fn();
  const fetch=jest.fn(async ()=>({ok:true,json:async()=>({scope:'ALL_MARKETS',tasks:[],overdue_count:0})}));
  const mounted=app.mount({root,user:{role:'admin'},document:doc,
    location:{search:'?branch=direction'},fetch,
    renderAdministrative:admin,renderOperations:ops});
  await mounted.directorLoad;
  expect(mounted.branch).toBe('direction');
  expect(ops).not.toHaveBeenCalled();
  expect(admin).not.toHaveBeenCalled();
  expect(root.querySelectorAll('[data-hub-director-todo]')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('Direction Hub Kanban : quatre colonnes stables, y compris sans tâches', async () => {
  const app=load(), host=el('section');
  const fetch=jest.fn(async () => ({ ok:true, json:async () => ({
    scope:'ALL_MARKETS', overdue_count:0, tasks:[],
  }) }));
  await app.renderDirectorQueue(host,{document:doc,fetch,user:{role:'admin'}});
  for (const lane of ['commitment','payment','arbitrage','execution']) {
    expect(host.querySelectorAll('[data-hub-director-group="'+lane+'"]')).toHaveLength(1);
  }
  expect(host.querySelectorAll('[data-hub-director-task]')).toHaveLength(0);
  expect(host.querySelectorAll('[data-hub-director-group]')).toHaveLength(4);
});

test('Direction Hub : relecture SSE ne duplique pas les cartes et suit les mutations ailleurs', async()=>{
  const app=load(), host=el('section');
  let tasks=[{kind:'AUTHORIZE_PAYMENT',owner:'responsable_hub',market:{code:'KM'},
    subject:{po_id:'11111111-1111-4111-8111-111111111111'},missing:'Paiement à autoriser',age_hours:1}];
  const fetch=jest.fn(async()=>({ok:true,json:async()=>({
    scope:'ALL_MARKETS',tasks,overdue_count:0,
  })}));
  await app.renderDirectorQueue(host,{document:doc,fetch,user:{role:'admin'}});
  const first=host.querySelector('[data-hub-director-todo]');
  expect(host.querySelectorAll('[data-hub-director-task]')).toHaveLength(1);
  await app.renderDirectorQueue(host,{document:doc,fetch,user:{role:'admin'}});
  expect(host.querySelector('[data-hub-director-todo]')).toBe(first);
  expect(host.querySelectorAll('[data-hub-director-task]')).toHaveLength(1);
  tasks=[];
  await app.renderDirectorQueue(host,{document:doc,fetch,user:{role:'admin'}});
  expect(host.querySelectorAll('[data-hub-director-todo]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-hub-director-task]')).toHaveLength(0);
  expect(host.querySelector('[data-hub-director-todo]')).not.toBe(first);
});


test('Direction Hub : un refus 403 efface les cartes de supervision précédemment autorisées', async () => {
  const app = load(), host = el('section');
  let denied = false;
  const fetch = jest.fn(async () => ({
    ok: !denied, status: denied ? 403 : 200,
    json: async () => denied ? {error:'Rôle révoqué'} : {
      scope:'ALL_MARKETS', overdue_count:0,
      tasks:[{kind:'AUTHORIZE_COMMITMENT',owner:'responsable_hub',
        market:{code:'KM'}, missing:'Engagement à valider', age_hours:1,
        subject:{po_id:'11111111-1111-4111-8111-111111111111'}}],
    },
  }));
  await app.renderDirectorQueue(host, { document:doc, fetch, user:{role:'admin'} });
  expect(host.querySelectorAll('[data-hub-director-task]')).toHaveLength(1);
  denied = true;
  await app.renderDirectorQueue(host, { document:doc, fetch, user:{role:'admin'} });
  expect(host.querySelectorAll('[data-hub-director-task]')).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Accès expiré ou non autorisé');
});

test('Kanban : destination relais visible, attendu réservé au détail contextuel',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-workstation.js'),'utf8');
 expect(src).toContain("relay.setAttribute('data-hub-relay-destination','')");
 expect(src).toContain('[o.reference, o.market, o.market_name, o.relay_name]');
 expect(src).not.toContain("'kmc-hub-phase-expected'");
 expect(src).toContain("'kmc-hub-board-menu-expected'");
});

test('Kanban global : les actions métier sont déléguées et aucun formulaire de sourcing inline ne subsiste',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-workstation.js'),'utf8');
 const board=src.slice(src.indexOf('async function renderGlobalBoard'),src.indexOf('async function renderAdministrationBoard'));
 expect(board).toContain('KomerceHubContextActions.operations(menu');
 expect(board).toContain('Ouvrir l’atelier · ');
 expect(board).not.toContain('launchSourcing');
 expect(board).not.toContain('openManualSourcing');
});

test('le pilote PO conserve le Kanban et revient à la vue commandes sans mutation', async () => {
  const app=load(), root=el('main');
  const po={id:'p1',reference:'PO-1',market:'KM',supplier:'Fournisseur A',order_count:2,
    order_references:['KAAAAAA','KBBBBBB'],ordered:5,expected:5,received:3,missing:2,
    anomalies:0,purchase_step:'received',sent:true};
  const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'
    ?{scope:'HUB_GLOBAL',purchase_orders:[po]}:{scope:'HUB_GLOBAL',orders:[]}}));
  await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'agent_hub'},location:{search:'?ux=legacy'}});
  const toggle=root.querySelector('[data-hub-po-pilot-toggle]');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  await toggle.click();
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelectorAll('[data-hub-pilot-po]')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith('/api/hub/board?view=po',expect.objectContaining({method:'GET'}));
  await toggle.click();
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(root.querySelectorAll('[data-hub-pilot-po]')).toHaveLength(0);
  expect(fetch).toHaveBeenCalledTimes(2);
});
test('le responsable marché ne reçoit pas de bascule PO fournisseurs', async () => {
  const app=load(),root=el('main'),fetch=mockFetch({orders:[]});
  await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'market_operator'}});
  expect(root.querySelector('[data-hub-po-pilot-toggle]')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('la cellule Achat monte le module canonique seulement au dépliage',async()=>{
  const app=load(),root=el('main');
  const po={id:'p1',reference:'PO-1',market:'KM',supplier:'Fournisseur A',order_count:1,
    order_references:['KAAAAAA'],ordered:2,expected:2,received:0,missing:2,anomalies:0,purchase_step:'draft'};
  const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'
    ?{scope:'HUB_GLOBAL',purchase_orders:[po]}:{scope:'HUB_GLOBAL',orders:[]}}));
  const mountPurchaseActions=jest.fn(async()=>({busy:()=>false,reload:jest.fn()}));
  const previous=global.KomerceCanonicalOperationsWorkspace;
  global.KomerceCanonicalOperationsWorkspace={mountPurchaseActions};
  try{
    await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'agent_hub'},location:{search:'?ux=legacy'}});
    await root.querySelector('[data-hub-po-pilot-toggle]').click();
    const host=root.querySelector('[data-hub-inline-purchase]');
    expect(host).not.toBeNull();
    expect(mountPurchaseActions).not.toHaveBeenCalled();
    await host.parentNode.toggle(true);
    expect(mountPurchaseActions).toHaveBeenCalledWith(host,expect.objectContaining({
      marketCode:'KM',poId:'p1',user:{role:'agent_hub'},fetch,
    }));
    expect(fetch).toHaveBeenCalledTimes(2);
  }finally{global.KomerceCanonicalOperationsWorkspace=previous;}
});

test('la cellule Réception monte seulement la PO expédiée, au dépliage',async()=>{
  const app=load(),root=el('main');
  const po={id:'p1',reference:'PO-1',market:'KM',supplier:'Fournisseur A',order_count:1,
    order_references:['KAAAAAA'],ordered:2,expected:2,received:1,missing:1,anomalies:0,purchase_step:'sent',sent:true};
  const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'
    ?{scope:'HUB_GLOBAL',purchase_orders:[po]}:{scope:'HUB_GLOBAL',orders:[]}}));
  const mountReceptionActions=jest.fn(async()=>({busy:()=>false,reload:jest.fn()}));
  const previous=global.KomerceCanonicalOperationsWorkspace;
  global.KomerceCanonicalOperationsWorkspace={mountReceptionActions};
  try{
    await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'agent_hub'},location:{search:'?ux=legacy'}});
    await root.querySelector('[data-hub-po-pilot-toggle]').click();
    const host=root.querySelector('[data-hub-inline-reception]');
    expect(host).not.toBeNull();
    expect(mountReceptionActions).not.toHaveBeenCalled();
    await host.parentNode.toggle(true);
    expect(mountReceptionActions).toHaveBeenCalledWith(host,expect.objectContaining({marketCode:'KM',poId:'p1',receiveRefs:expect.any(Map),fetch}));
    expect(fetch).toHaveBeenCalledTimes(2);
  }finally{global.KomerceCanonicalOperationsWorkspace=previous;}
});

test('COMBOX : la préparation commune est montée uniquement au dépliage de la PO reçue',async()=>{
  const app=load(),root=el('main');
  const po={id:'p1',reference:'PO-1',market:'KM',supplier:'Fournisseur A',order_count:1,order_references:['KAAAAAA'],ordered:2,expected:2,received:1,missing:1,anomalies:0,purchase_step:'sent',sent:true};
  const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'?{scope:'HUB_GLOBAL',purchase_orders:[po]}:{scope:'HUB_GLOBAL',orders:[]}}));
  const mountBoxActions=jest.fn(async()=>({busy:()=>false,reload:jest.fn()}));
  const previous=global.KomerceCanonicalOperationsWorkspace;
  global.KomerceCanonicalOperationsWorkspace={mountBoxActions};
  try{
    await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'agent_hub'},location:{search:'?ux=legacy'}});
    await root.querySelector('[data-hub-po-pilot-toggle]').click();
    const host=root.querySelector('[data-hub-inline-combox]');
    expect(host).not.toBeNull();
    expect(mountBoxActions).not.toHaveBeenCalled();
    await host.parentNode.toggle(true);
    expect(mountBoxActions).toHaveBeenCalledWith(host,expect.objectContaining({marketCode:'KM',poId:'p1',boxCreateKeys:expect.any(Map),fetch}));
    expect(fetch).toHaveBeenCalledTimes(2);
  }finally{global.KomerceCanonicalOperationsWorkspace=previous;}
});

test('cellule Départ : chargement lazy du module canonique pour une PO reçue',async()=>{
  const app=load(),root=el('main');
  const po={id:'p1',reference:'PO-1',market:'KM',supplier:'Fournisseur A',order_count:1,order_references:['KAAAAAA'],ordered:2,expected:2,received:1,missing:1,anomalies:0,purchase_step:'received',sent:true,boxed_quantity:1,box_count:1,dispatched_quantity:0,handed_quantity:0};
  const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'?{scope:'HUB_GLOBAL',purchase_orders:[po]}:{scope:'HUB_GLOBAL',orders:[]}}));
  const mountDepartureActions=jest.fn(async()=>({busy:()=>false,reload:jest.fn()}));
  const previous=global.KomerceCanonicalOperationsWorkspace;
  global.KomerceCanonicalOperationsWorkspace={mountDepartureActions};
  try{
    await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'agent_hub'},location:{search:'?ux=legacy'}});
    await root.querySelector('[data-hub-po-pilot-toggle]').click();
    const host=root.querySelector('[data-hub-inline-departure]');
    expect(host).not.toBeNull();
    expect(mountDepartureActions).not.toHaveBeenCalled();
    await host.parentNode.toggle(true);
    expect(mountDepartureActions).toHaveBeenCalledWith(host,expect.objectContaining({marketCode:'KM',poId:'p1',fetch}));
    expect(fetch).toHaveBeenCalledTimes(2);
  }finally{global.KomerceCanonicalOperationsWorkspace=previous;}
});

test('aperçu PO V8 : deux dossiers distincts, retour Kanban et chargement par PO exacte',async()=>{
  const app=load(),root=el('main');
  const po=id=>({id,reference:'PO-'+id,market:'KM',supplier:'Fournisseur',order_count:1,order_references:['KAAAAAA'],ordered:2,expected:2,received:0,missing:2,purchase_step:'sent',order_lines:[{order_ref:'KAAAAAA',product:'Article '+id,ordered:2,expected:2,received:0,missing:2}]});
  const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'?{scope:'HUB_GLOBAL',purchase_orders:[po('p1'),po('p2')]}:{scope:'HUB_GLOBAL',orders:[]}}));
  const mountPurchaseActions=jest.fn(async()=>({busy:()=>false,reload:jest.fn()}));
  const prev=global.KomerceCanonicalOperationsWorkspace;
  const loc=Object.getOwnPropertyDescriptor(global,'location');
  Object.defineProperty(global,'location',{configurable:true,value:{search:''}});
  global.KomerceCanonicalOperationsWorkspace={mountPurchaseActions};
  const walk=(node,predicate)=>[node,...node.children.flatMap(n=>walk(n,predicate))].filter(predicate);
  try{
    await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'agent_hub'}});
    expect(root.querySelector('[data-hub-po-v8]')).not.toBeNull();
    root.querySelector('[data-hub-po-v8-card="p1"]').click();
    await Promise.resolve();await Promise.resolve();
    expect(mountPurchaseActions).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({poId:'p1',marketCode:'KM',compactPO:true}));
    walk(root,n=>n.tagName==='BUTTON'&&n.textContent==='Kanban')[0].click();
    root.querySelector('[data-hub-po-v8-card="p2"]').click();
    await Promise.resolve();await Promise.resolve();
    expect(mountPurchaseActions).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({poId:'p2'}));
    expect(walk(root,n=>n.className==='kmc-hub-po-v8-panel')).toHaveLength(2);
    expect(walk(root,n=>n.className==='kmc-hub-po-v8-panel'&&!n.hidden)).toHaveLength(1);
  }finally{
    global.KomerceCanonicalOperationsWorkspace=prev;
    if(loc)Object.defineProperty(global,'location',loc);else delete global.location;
  }
});
test('Direction Hub : masquage des lignes filtrées sans !important, même avec la grille des tâches',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/css/hub-workstation.css'),'utf8');
  expect(css).toContain('.kmc-hub-app [data-hub-active-branch="direction"] [hidden][hidden] { display:none; }');
  expect(css).not.toContain('display:none !important');
  expect(css).toContain('.kmc-hub-app [data-hub-active-branch="direction"] .hlc-director-task { display:grid;');
});

test('styles V8 limités au nouveau poste, masquage des panneaux et cartes compactes',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/css/hub-workstation.css'),'utf8');
  expect(css).toContain('.kmc-hub-po-visual [hidden]');
  expect(css).toMatch(/\.kmc-hub-po-v8-board\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  expect(css).toMatch(/\.kmc-hub-po-v8-card\{[^}]*width:100%/);
});

test('V8 : filtre marché, six étapes du mock, exceptions et bilan non déduit de la réception',async()=>{
 const app=load(),root=el('main');
 const base={market:'KM',supplier:'Fournisseur',order_count:1,order_references:[],ordered:2,expected:2,received:0,missing:2,purchase_step:'sent'};
 const pos=[{...base,id:'active',reference:'PO-A'},{...base,id:'received',reference:'PO-R',reception_complete:true,received:2,missing:0},
  {...base,id:'other',reference:'PO-CG',market:'CG',exceptions:[{kind:'PO_MISSING_QTY',reason:'Écart confirmé'}]}];
 const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'?{scope:'HUB_GLOBAL',markets:['CG','KM'],purchase_orders:pos}:{scope:'HUB_GLOBAL',orders:[]}}));
 await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'admin'},location:{search:''}});
 expect(root.querySelectorAll('[data-hub-v8-lane]')).toHaveLength(6);
 expect(root.querySelector('[data-hub-v8-lane="4"]').querySelector('[data-hub-po-v8-card="received"]')).not.toBeNull();
 expect(root.querySelector('[data-hub-v8-lane="5"]').querySelectorAll('[data-hub-po-v8-card]')).toHaveLength(0);
 const filter=root.querySelector('[data-hub-v8-market]');filter.value='KM';filter.change(filter);
 expect(root.querySelector('[data-hub-po-v8-card="other"]')).toBeNull();
 expect(root.querySelector('[data-hub-po-v8-card="active"]')).not.toBeNull();
 filter.value='ALL';filter.change(filter);
 root.querySelector('[data-hub-v8-view="exceptions"]').click();
 expect(root.querySelectorAll('[data-hub-po-v8-card]')).toHaveLength(1);
 expect(root.querySelector('[data-hub-po-v8-card="other"]')).not.toBeNull();
 root.querySelector('[data-hub-v8-view="archive"]').click();
 expect(root.querySelectorAll('[data-hub-po-v8-card]')).toHaveLength(0);
});

test('Direction V8 : ouvre exactement la PO demandée, décision distincte même après réception',async()=>{
 const app=load(),root=el('main');
 const po={id:'p1',reference:'PO-1',market:'KM',supplier:'Fournisseur',order_count:0,ordered:2,expected:2,received:2,missing:0,reception_complete:true};
 const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'?{scope:'HUB_GLOBAL',purchase_orders:[po]}:{scope:'HUB_GLOBAL',orders:[]}}));
 const mountPurchaseActions=jest.fn(async()=>({busy:()=>false}));
 const mountReceptionActions=jest.fn();
 const prev=global.KomerceCanonicalOperationsWorkspace;
 global.KomerceCanonicalOperationsWorkspace={mountPurchaseActions,mountReceptionActions};
 try{
  await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'admin'},location:{search:'?branch=operations&sel=po%3Ap1&decision=payment'}});
  await Promise.resolve();await Promise.resolve();
  expect(mountPurchaseActions).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({poId:'p1',marketCode:'KM',decisionOnly:'payment'}));
  expect(mountReceptionActions).not.toHaveBeenCalled();
  expect(fetch.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
 }finally{global.KomerceCanonicalOperationsWorkspace=prev;}
});


test('V8 uses the mock visual tokens and scoped styles for real forms',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/css/hub-workstation.css'),'utf8');
 for(const token of ['--nav:#13273a','--ink:#182c3b','--muted:#647588','--line:#dce4e9','--bg:#f3f6f8','--blue:#1765ad'])expect(css).toContain(token);
 expect(css).toContain('.kmc-hub-po-visual .hlc-form .hlc-btn.is-primary');
 const app=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/app.js'),'utf8');
 expect(app).toContain("global.location.replace('/admin/hub?branch=operations&sel='+encodeURIComponent(sel)+'&decision='+(params.get('decision')||'review')+(market?'&market='+encodeURIComponent(market):''))");
});

test('PO partagée : arbitrage V8 ouvre le marché explicitement choisi, sans basculer sur le premier dossier',async()=>{
 const app=load(),root=el('main');
 const po={id:'p1',reference:'PO-1',supplier:'Fournisseur',order_count:0,ordered:2,expected:2,received:1,missing:1,purchase_step:'received'};
 const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'?{scope:'HUB_GLOBAL',purchase_orders:[{...po,market:'CM'},{...po,market:'KM'}]}:{scope:'HUB_GLOBAL',orders:[]}}));
 const mountVarianceActions=jest.fn(async()=>({busy:()=>false}));
 const prev=global.KomerceCanonicalOperationsWorkspace;
 global.KomerceCanonicalOperationsWorkspace={mountVarianceActions};
 try{
  await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'admin'},location:{search:'?branch=operations&sel=po%3Ap1&decision=variance&market=KM'}});
  await Promise.resolve();await Promise.resolve();
  expect(mountVarianceActions).toHaveBeenCalledTimes(1);
  expect(mountVarianceActions).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({poId:'p1',marketCode:'KM'}));
  expect(fetch.mock.calls.every(([,opts])=>opts.method==='GET')).toBe(true);
 }finally{global.KomerceCanonicalOperationsWorkspace=prev;}
});

test('mount Hub conserve le marché uniquement pour un dossier PO explicite',async()=>{
 const app=load(),root=el('main'),history={replaceState:jest.fn()},ops=jest.fn();
 app.mount({root,user:{role:'admin'},document:doc,location:{search:'?branch=operations&sel=po%3Ap1&market=KM&decision=variance'},history,fetch:mockFetch({}),renderOperations:ops,renderAdministrative:jest.fn()});
 expect(history.replaceState).not.toHaveBeenCalled();
 expect(root.querySelector('[data-hub-branch="operations"]').getAttribute('href')).toBe('/admin/hub?branch=operations');
 expect(ops).toHaveBeenCalledTimes(1);
});
test('projection V8 indisponible : aucune bascule historique, puis récupération par actualisation',async()=>{
 const app=load(),root=el('main');
 let available=false;
 const fetch=jest.fn(async url=>({ok:true,json:async()=>url==='/api/hub/board?view=po'
  ? available?{scope:'HUB_GLOBAL',markets:['KM'],purchase_orders:[]}:{scope:'UNAVAILABLE'}
  : {scope:'HUB_GLOBAL',orders:[{id:'o1',reference:'K123456',market:'KM'}]}}));
 await app.renderGlobalBoard(root,{document:doc,fetch,user:{role:'admin'},location:{search:''}});
 expect(root.querySelectorAll('[data-hub-global-order]')).toHaveLength(0);
 expect(root.querySelectorAll('[data-hub-po-pilot-toggle]')).toHaveLength(0);
 const retry=root.querySelector('[data-hub-v8-retry]');expect(retry).not.toBeNull();
 available=true;await retry.click();
 expect(root.querySelector('[data-hub-po-v8]')).not.toBeNull();
 expect(root.querySelectorAll('[data-hub-v8-lane]')).toHaveLength(6);
 expect(root.querySelectorAll('[data-hub-global-order]')).toHaveLength(0);
});
