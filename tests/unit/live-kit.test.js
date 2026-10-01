'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const vm = require('vm');

function loadKit(extra = {}) {
  const win = { URLSearchParams, Date, Promise, Math, JSON, Number, String, Object, Array, Set, Map, Error, setInterval:() => 1, clearInterval:() => {},
    location:{ pathname:'/admin/x-live', search:'' }, history:{ pushState:jest.fn() }, addEventListener:jest.fn(), ...extra };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../public/dashboards/canonical/js/live-kit.js'), 'utf8'), win);
  return { kit:win.KomerceLiveKit, win };
}

test('esc neutralise le HTML ; ageLabel et queryString sont stables', () => {
  const { kit } = loadKit();
  expect(kit.esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  expect(kit.ageLabel(5)).toBe('5 h');
  expect(kit.ageLabel(60)).toBe('2 j 12 h');
  expect(kit.ageLabel(48)).toBe('2 j');
  expect(kit.ageLabel(-3)).toBe('0 h');
  expect(kit.queryString({ view:'queue', tab:'', page:null, n:2 })).toBe('?view=queue&n=2');
  expect(kit.queryString({})).toBe('');
});

test('pager : rien pour une seule page, liens précédent/suivant sinon', () => {
  const { kit } = loadKit();
  expect(kit.pager(1, 1, n => `?p=${n}`)).toBe('');
  const html = kit.pager(2, 3, n => `?p=${n}`);
  expect(html).toContain('href="?p=1"');
  expect(html).toContain('href="?p=3"');
  expect(html).toContain('Page 2 / 3');
  expect(kit.pager(1, 3, n => `?p=${n}`)).not.toContain('Plus récents');
});

test('table : message vide explicite, jamais une table sans ligne', () => {
  const { kit } = loadKit();
  expect(kit.table(['A'], [], { empty:'Rien.' })).toContain('Rien.');
  expect(kit.table(['A'], ['<tr><td>1</td></tr>'])).toContain('<th>A</th>');
});

function engine(kit, views) {
  return kit.createCockpit({
    basePath:'/admin/x-live', domainLabel:'X', defaultView:'home',
    tabs:[{ key:'a', label:'A', href:'/admin/x-live' }, { key:'b', label:'B', href:'/admin/x-live?view=list' }],
    views,
  });
}
const VIEWS = {
  home:{ tab:() => 'a', load:async () => ({}), render:() => ({ hero:'<header>HOME</header>', body:'' }) },
  list:{ tab:() => 'b', load:async () => ({}), render:() => ({ title:'Liste', body:'' }),
    nav:() => ({ crumbs:[{ label:'X', plain:true }, { label:'Liste' }], back:null }) },
  deep:{ tab:() => 'a', load:async () => ({}), render:() => ({ title:'Détail', copy:'c', body:'' }),
    nav:() => ({ crumbs:[{ label:'X', plain:true }, { label:'A', href:'/admin/x-live' }, { label:'Détail' }], back:{ href:'/admin/x-live', label:'← Retour à A' } }) },
};

test('moteur : vue inconnue → vue par défaut ; onglet actif et retour viennent de la vue', () => {
  const { kit } = loadKit();
  const cockpit = engine(kit, VIEWS);
  expect(cockpit.parseSearch('?view=zzz').view).toBe('home');
  expect(cockpit.renderHtml('?view=zzz', {})).toContain('HOME');
  const deep = cockpit.renderHtml('?view=deep', {});
  expect(deep).toContain('<a href="/admin/x-live" data-cockpit-nav class="kir-back">← Retour à A</a>');
  expect(deep).toMatch(/is-active[^>]*>A</);
  const list = cockpit.renderHtml('?view=list', {});
  expect(list).toMatch(/is-active[^>]*>B</);
  expect(list).not.toContain('kir-back');
});

test('moteur : urlFor omet la vue par défaut et les paramètres vides', () => {
  const { kit } = loadKit();
  const cockpit = engine(kit, VIEWS);
  expect(cockpit.urlFor('home')).toBe('/admin/x-live');
  expect(cockpit.urlFor('deep', { id:'7', from:'' })).toBe('/admin/x-live?view=deep&id=7');
});

test('moteur : une relecture lente d’une vue précédente n’écrase jamais la vue courante', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const views = {
    home:{ tab:() => 'a', load:() => slow, render:() => ({ hero:'<header>ANCIENNE</header>', body:'' }) },
    list:{ tab:() => 'b', load:async () => ({}), render:() => ({ title:'NOUVELLE', body:'' }), nav:() => ({ crumbs:[], back:null }) },
  };
  const root = { innerHTML:'', setAttribute() {}, addEventListener() {}, querySelector:() => null };
  const { kit, win } = loadKit({ document:{ contains:() => true, addEventListener() {}, visibilityState:'visible' }, fetch:async () => ({ ok:true, json:async () => ({}) }) });
  const cockpit = kit.createCockpit({ basePath:'/admin/x-live', domainLabel:'X', defaultView:'home', tabs:[{ key:'a', label:'A', href:'/admin/x-live' }, { key:'b', label:'B', href:'/b' }], views });
  const mounting = cockpit.mount({ root });          // vue home en attente
  win.location.search = '?view=list';
  win.addEventListener.mock.calls.find(([name]) => name === 'popstate')[1](); // navigation vers list
  await new Promise(resolve => setTimeout(resolve, 0));
  release({});
  await mounting;
  expect(root.innerHTML).toContain('NOUVELLE');
  expect(root.innerHTML).not.toContain('ANCIENNE');
});

test('le moteur ne contient aucune écriture : GET uniquement', () => {
  const source = fs.readFileSync(require.resolve('../../public/dashboards/canonical/js/live-kit.js'), 'utf8');
  expect(source).toContain("method:'GET'");
  expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
});

test('live-kit.css : lignes de tableau et tuiles gardent le gabarit noir (calque legacy neutralisé)', () => {
  const css = fs.readFileSync(require.resolve('../../public/dashboards/canonical/css/live-kit.css'), 'utf8');
  expect(css).toContain('.lk-table tbody tr');
  expect(css).toContain('background:#0A1625 !important');
  expect(css).toContain('.lk-flow-track');
});

test('moteur : une première lecture en erreur garde la coque noire et affiche l’erreur sous les onglets', async () => {
  const views = { home:{ tab:() => 'a', load:async () => { throw new Error('Erreur interne du serveur'); }, render:() => ({ hero:'', body:'' }) } };
  const attrs = {};
  const root = { className:'', innerHTML:'', setAttribute:(k, v) => { attrs[k] = v; }, addEventListener() {}, querySelector:() => null };
  const { kit } = loadKit({ document:{ contains:() => true, addEventListener() {}, visibilityState:'visible' } });
  const cockpit = kit.createCockpit({ basePath:'/admin/x-live', domainLabel:'X', defaultView:'home', tabs:[{ key:'a', label:'A', href:'/admin/x-live' }], views });
  await cockpit.mount({ root });
  expect(root.className).toBe('kmc-import-runtime kmc-domain-cockpit');
  expect(attrs['data-cockpit-language']).toBe('live-ops');
  expect(root.innerHTML).toContain('Cockpit indisponible · Erreur interne du serveur');
  expect(root.innerHTML).toContain('kir-domain-nav');
});
