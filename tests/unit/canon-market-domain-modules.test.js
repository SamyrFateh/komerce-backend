'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function el(tag) {
  const classes = new Set(['kmc-workspace']);
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, style: {},
    className: 'kmc-workspace', textContent: '',
    classList: { contains: x => classes.has(x), add: x => classes.add(x) },
    appendChild(n) { this.children.push(n); return n; },
    append(...n) { n.forEach(x => this.appendChild(x)); },
    replaceChildren(...n) { this.children = n; },
    setAttribute(k,v) { this.attrs[k] = v; },
    addEventListener() {}, querySelector() { return null; },
    insertBefore(n) { this.children.unshift(n); }, remove() {},
  };
}
const payload = {
  market: { name: 'Cameroun', currency: 'XAF' },
  actor_capabilities: [], actor_grantable_capabilities: [],
  members: [], invitations: [], relais: [], providers: [], settlements: [],
  disputes: [], policy: {}, services: [], offers: [],
  stock: [{ product_id: 'p1', name: 'Article local', qty_physical: 5 }],
  accounts: [], can_manage: false,
};
function createModule(file, apiName) {
  const context = {
    actor: { id: 'u', role: 'market_operator' },
    access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM',
      capabilities: [], delegatedCapabilities: { CM: [] } },
  };
  const global = {
    document: { getElementById: () => null, createElement: el, createTextNode: () => el('text') },
    location: { search: '?market=CG' },
    KomerceAdminContext: require('../../public/dashboards/canonical/js/admin-context'),
    fetch: jest.fn(async url => ({
      ok: true, json: async () => url.endsWith('/context') ? context : payload,
    })),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../../public/dashboards/canonical/js', file + '.js'), 'utf8'),
    { window: global, URL, URLSearchParams });
  return { global, api: global[apiName] };
}
const specs = [
  ['market-team', 'KomerceMarketTeam', '/team'],
  ['market-network', 'KomerceMarketNetwork', '/network/relais'],
  ['market-cash-control', 'KomerceMarketCashControl', '/cash-control-policy'],
  ['market-local-offer', 'KomerceMarketLocalOffer', '/local-stock'],
  ['market-settlement', 'KomerceMarketSettlement', '/settlements'],
  ['market-client-case', 'KomerceMarketClientCase', '/client-cases/disputes'],
  ['market-readonly-views', 'KomerceMarketReadonlyViews', '/payment-accounts'],
];
test.each(specs)('%s monte seulement le marché sélectionné et autorisé', async (file, apiName, suffix) => {
  const { global, api } = createModule(file, apiName);
  const root = el('div');
  await api.mount({ root, marketCode: 'CM', viewKeys: ['payment-accounts'] });
  expect(root.children.length).toBeGreaterThan(0);
  expect(global.fetch.mock.calls.some(([url]) => url.includes('/CM/') && url.endsWith(suffix))).toBe(true);
  expect(global.fetch.mock.calls.every(([url, opts]) => !url.includes('/CG/') && opts.method === 'GET')).toBe(true);
  global.fetch.mockClear();
  const denied = el('div');
  await api.mount({ root: denied, marketCode: 'CG', viewKeys: ['payment-accounts'] });
  expect(denied.children).toHaveLength(0);
  expect(global.fetch.mock.calls.every(([url]) => url.endsWith('/context'))).toBe(true);
});
test('stock local : une lecture centrale ne rend ni exposition ni formulaire de réception', async () => {
  const { api } = createModule('market-local-offer', 'KomerceMarketLocalOffer');
  const root = el('div');
  await api.mount({ root, marketCode: 'CM' });
  const walk = n => [n, ...n.children.flatMap(walk)];
  const all = walk(root);
  expect(all.some(n => n.dataset.localStockCard === 'p1')).toBe(true);
  expect(all.some(n => Object.hasOwn(n.dataset, 'localStockExpose'))).toBe(false);
  expect(all.some(n => n.tagName === 'FORM' && n.children.some(x => x.name === 'qty_received'))).toBe(false);
});

test('config marché : projection limitée au marché choisi et lecture seule', async () => {
  const { global, api } = createModule('market-readonly-views', 'KomerceMarketReadonlyViews');
  const root = el('div');
  await api.mount({ root, marketCode: 'CM', viewKeys: ['market-config'] });
  expect(root.children.length).toBe(1);
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/CM/config'))).toBe(true);
  expect(global.fetch.mock.calls.every(([url, opts]) => !url.includes('/CG/') && opts.method === 'GET')).toBe(true);
});
