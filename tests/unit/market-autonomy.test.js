'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * L1 — market-autonomy : aucun marché implicite, aucune requête marché avant un choix explicite.
 */

function fakeNode(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(), className: '', textContent: '', children: [], attributes: {}, dataset: {},
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...c) { this.children = c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener() {},
    querySelector() { return null; },
  };
}

async function boot(context, search, options = {}) {
  jest.resetModules();
  const root = fakeNode('main');
  const document = { getElementById: id => (id === 'market-autonomy-root' ? root : null), createElement: fakeNode, body: fakeNode('body') };
  const calls = [];
  const fetch = jest.fn(async url => {
    calls.push(url);
    if (options.deniedDashboard && url.includes('/api/admin/dashboard/context')) {
      return { ok: false, status: 403, json: async () => ({ code: 'dashboard_access_denied' }) };
    }
    if (options.deniedNetwork && url.includes('/network/relais')) {
      return { ok: false, status: 403, json: async () => ({ code: 'MARKET_CAPABILITY_REQUIRED' }) };
    }
    const json = url.includes('/api/admin/dashboard/context') ? context : url.includes('/api/auth/me') ? { id: 'u', role: 'admin' } : {};
    return { ok: true, status: 200, json: async () => json };
  });
  global.window = { location: { href: 'https://komerce.test/x' + search, search, pathname: '/x', replace: jest.fn() }, document, fetch };
  global.window.KomerceAdminContext = require('../../public/dashboards/canonical/js/admin-context.js');
  global.window.KomerceMarketPrompt = require('../../public/dashboards/canonical/js/market-prompt.js');
  Object.assign(global, { document, location: global.window.location, fetch });
  global.KomerceAdminContext = global.window.KomerceAdminContext;
  global.KomerceMarketPrompt = global.window.KomerceMarketPrompt;
  require('../../public/dashboards/canonical/js/market-autonomy.js');
  await new Promise(r => setTimeout(r, 20));
  return { root, calls };
}

afterEach(() => {
  ['window', 'document', 'location', 'fetch', 'KomerceAdminContext', 'KomerceMarketPrompt', 'KomerceMarketCatalog', 'KomerceMarketLocalPrices'].forEach(k => { delete global[k]; });
});

const globalCtx = { actor: { id: 'a', role: 'admin' }, access: { mode: 'global', allowedMarkets: ['CG', 'CM', 'KM'], defaultMarket: null, capabilities: [] } };
const monoCtx = { actor: { id: 'o', role: 'market_operator' }, access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: [] } };
const marketCalls = calls => calls.filter(u => /\/market(?:s)?\/[A-Z]{2}/.test(u));

test('Global sans ?market= : invite, aucune requête marché (jamais CG)', async () => {
  const { root, calls } = await boot(globalCtx, '');
  expect(root.children.find(c => c.attributes && c.attributes['data-market-prompt']).attributes['data-market-prompt']).toBe('prompt');
  expect(marketCalls(calls)).toEqual([]);
});

test('?market=XX non autorisé : invite « non autorisé », aucune requête marché', async () => {
  const { root, calls } = await boot(globalCtx, '?market=XX');
  expect(root.children.find(c => c.attributes && c.attributes['data-market-prompt']).attributes['data-market-prompt']).toBe('unauthorized');
  expect(marketCalls(calls)).toEqual([]);
});

test('?market=KM autorisé : requêtes KM uniquement', async () => {
  const { calls } = await boot(globalCtx, '?market=KM');
  expect(marketCalls(calls).length).toBeGreaterThan(0);
  expect(marketCalls(calls).every(u => /\/KM(\/|$)/.test(u))).toBe(true);
});

test('délégation mono-marché : CM automatique', async () => {
  const { calls } = await boot(monoCtx, '');
  expect(marketCalls(calls).length).toBeGreaterThan(0);
  expect(marketCalls(calls).every(u => /\/CM(\/|$)/.test(u))).toBe(true);
});

test('les ancres de navigation sont résolues après le montage asynchrone des sections', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/market-autonomy.js'), 'utf8');
  expect(source).toContain("new Set(['market-team', 'market-network', 'market-providers', 'market-cash-control'])");
  expect(source).toContain('scrollToRequestedSection');
  expect(source).toContain('anchorObserver?.observe(root, { childList: true, subtree: true })');
});

test('la page autonome invalide aussi le cache de son menu canonical', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/market-autonomy.html'), 'utf8');
  expect(html).toContain('navigation-policy-v4.js?v=261128-l3a-market-currency');
});

test('un prix global nul ou absent est présenté comme non renseigné, jamais comme zéro KMF', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/market-autonomy.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/market-autonomy.html'), 'utf8');
  expect(source).toContain("? 'Non renseigné'");
  expect(source).toContain('globalPrice <= 0');
  expect(source).not.toContain('row.global_price_kmf || 0');
  expect(html).toContain('market-autonomy.js?v=261126-canon-market-prices-1');
});

test('délégation réseau granulaire : contexte dashboard refusé, accès réseau serveur autorisé', async () => {
  const { root, calls } = await boot(monoCtx, '?market=KM', { deniedDashboard: true });
  expect(calls).toContain('/api/market-delegation/markets/KM/network/relais');
  expect(root.className).toBe('kmc-workspace');
  expect(root.dataset.networkOnlyMarket).toBe('KM');
  expect(calls.some(url => url.includes('/workspaces/pricing/'))).toBe(false);
});

test('délégation réseau refusée : aucune section accordée par la query string', async () => {
  const { root, calls } = await boot(monoCtx, '?market=KM', { deniedDashboard: true, deniedNetwork: true });
  expect(calls).toContain('/api/market-delegation/markets/KM/network/relais');
  expect(root.dataset.networkOnlyMarket).toBeUndefined();
  expect(root.className).toBe('canonical-boot');
});

test('sans marché explicite : aucune tentative de fallback réseau', async () => {
  const { root, calls } = await boot(monoCtx, '', { deniedDashboard: true });
  expect(calls.some(url => url.includes('/network/relais'))).toBe(false);
  expect(root.dataset.networkOnlyMarket).toBeUndefined();
});

test('module de prix intégré : le marché sélectionné est la seule cible, sans repli URL', async () => {
  await boot(monoCtx, '?market=CM');
  const api = global.KomerceMarketLocalPrices;
  expect(api).toBeDefined();
  global.fetch.mockClear();
  const host = fakeNode('div');
  host.remove = () => {};
  const create = global.document.createElement;
  global.document.createElement = (...args) => Object.assign(create(...args), { remove() {} });
  await api.mount({ root: host, marketCode: 'CG' });
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/admin/dashboard/context']);
  global.fetch.mockClear();
  await api.mount({ root: host, marketCode: 'CM' });
  const calls = global.fetch.mock.calls.map(([url]) => url);
  expect(calls.some(url => url.includes('/market/CM/commercial-prices'))).toBe(true);
  expect(calls.every(url => !url.includes('/market/CG'))).toBe(true);
});
