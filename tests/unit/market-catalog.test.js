'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * L1 — market-catalog : aucun marché implicite, aucune requête marché avant un choix explicite.
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

async function boot(context, search) {
  jest.resetModules();
  const root = fakeNode('main');
  const document = { getElementById: id => (id === 'market-catalog-root' ? root : null), createElement: fakeNode, body: fakeNode('body') };
  const calls = [];
  const fetch = jest.fn(async url => {
    calls.push(url);
    const json = url.includes('/api/admin/dashboard/context') ? context : url.includes('/api/auth/me') ? { id: 'u', role: 'admin' } : {};
    return { ok: true, status: 200, json: async () => json };
  });
  global.window = { location: { href: 'https://komerce.test/x' + search, search, pathname: '/x', replace: jest.fn() }, document, fetch };
  global.window.KomerceAdminContext = require('../../public/dashboards/canonical/js/admin-context.js');
  global.window.KomerceMarketPrompt = require('../../public/dashboards/canonical/js/market-prompt.js');
  Object.assign(global, { document, location: global.window.location, fetch });
  global.KomerceAdminContext = global.window.KomerceAdminContext;
  global.KomerceMarketPrompt = global.window.KomerceMarketPrompt;
  require('../../public/dashboards/canonical/js/market-catalog.js');
  await new Promise(r => setTimeout(r, 20));
  return { root, calls };
}

afterEach(() => {
  ['window', 'document', 'location', 'fetch', 'KomerceAdminContext', 'KomerceMarketPrompt', 'KomerceMarketCatalog'].forEach(k => { delete global[k]; });
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


function descend(node, test) {
  if (!node) return null;
  if (test(node)) return node;
  for (const child of node.children || []) {
    const hit = descend(child, test);
    if (hit) return hit;
  }
  return null;
}
function descendants(node, predicate, found = []) {
  if (!node) return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) descendants(child, predicate, found);
  return found;
}

test('handoff Produit 360 -> pays : affiche la référence et des choix autorisés, sans marché implicite', async () => {
  const { root, calls } = await boot(globalCtx, '?product_ref=KPR-000092');
  const chooser = descend(root, node => node.dataset?.marketHandoff === 'choose');
  expect(chooser).toBeTruthy();
  expect(descend(chooser, node => node.textContent === 'KPR-000092')).toBeTruthy();
  const links = descendants(chooser, node => Boolean(node.attributes?.['data-handoff-market']));
  expect(links.map(node => node.attributes['data-handoff-market'])).toEqual(['CG','CM','KM']);
  expect(links.map(node => node.href)).toEqual([
    'https://komerce.test/x?product_ref=KPR-000092&market=CG',
    'https://komerce.test/x?product_ref=KPR-000092&market=CM',
    'https://komerce.test/x?product_ref=KPR-000092&market=KM',
  ]);
  expect(marketCalls(calls)).toEqual([]);
  const back=descend(chooser,node=>node.textContent?.includes('Retour au Catalogue global'));
  expect(back.href).toContain('product_ref=KPR-000092');
});

test('handoff avec marché non autorisé ne charge pas des données pays et propose uniquement les marchés autorisés', async () => {
  const { root, calls } = await boot(globalCtx, '?product_ref=KPR-000092&market=XX');
  const chooser = descend(root, node => node.dataset?.marketHandoff === 'choose');
  expect(chooser).toBeTruthy();
  const links = descendants(chooser, node => Boolean(node.attributes?.['data-handoff-market']));
  expect(links.map(node => node.attributes['data-handoff-market'])).toEqual(['CG','CM','KM']);
  expect(links.some(node => node.href.includes('market=XX'))).toBe(false);
  expect(marketCalls(calls)).toEqual([]);
});

test('écran pays générique sans référence conserve la seule invite de sélection habituelle', async () => {
  const { root } = await boot(globalCtx, '');
  expect(descend(root, node => node.dataset?.marketHandoff === 'choose')).toBeNull();
});
