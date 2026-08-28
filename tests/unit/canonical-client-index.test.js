'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const index = require('../../public/dashboards/canonical/js/client-index.js');

function node(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    children: [],
    textContent: '',
    value: '',
    selected: false,
    disabled: false,
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute: jest.fn(),
    addEventListener: jest.fn(),
  };
}

function doc() {
  return { createElement: jest.fn(tag => node(tag)) };
}

function ui() {
  return {
    UIState: { render: jest.fn((container) => container.replaceChildren(node('state'))) },
    Section: { create: jest.fn(() => ({ element: node('section'), slot: node('div') })) },
  };
}

function context(mode = 'global') {
  return {
    resolveMarketView: jest.fn(() => mode === 'global'
      ? { mode: 'global', marketCode: null }
      : { mode: 'market', marketCode: 'KM' }),
  };
}

test('endpointForContext choisit global ou route marché sans market_id navigateur', () => {
  expect(index.endpointForContext({}, context('global'))).toBe('/api/admin/entities/clients');
  expect(index.endpointForContext({}, context('market'), 'KM')).toBe('/api/admin/entities/clients/market/KM');
  expect(() => index.endpointForContext({}, null)).toThrow('canonical_client_index_admin_context_contract_missing');
});

test('buildQueryUrl encode recherche, tri et pagination et les formatters restent présentationnels', () => {
  expect(index.buildQueryUrl('/clients', { search: 'Amina +269', sort: 'ltv', page: 2, page_size: 10 }))
    .toBe('/clients?search=Amina+%2B269&sort=ltv&page=2&page_size=10');
  expect(index.formatKmf(12500)).toContain('KMF');
  expect(index.formatNumber('bad')).toBe('—');
  expect(index.formatDate(null)).toBe('—');
});

test('renderClientTable produit un drill Client 360 sur le téléphone métier', () => {
  const document = doc();
  const container = node();
  const table = index.renderClientTable(container, document, {
    clients: [{
      name: 'Amina', phone: '+2691234567', orders_valid: 2, ltv_kmf: 120000,
      average_basket_kmf: 60000, last_order_at: '2026-08-20T10:00:00Z', markets: ['KM'],
    }],
  });
  expect(table).not.toBeNull();
  const all = [];
  (function walk(n) { all.push(n); (n.children || []).forEach(walk); })(container);
  const link = all.find(n => n.tagName === 'A' && n.textContent === 'Client 360');
  expect(link.setAttribute).toHaveBeenCalledWith('href', '/admin/clients/%2B2691234567');
  expect(index.renderClientTable(container, document, { clients: [] })).toBeNull();
});

test('mount charge la projection serveur et affiche la table sans segmentation locale', async () => {
  const root = node();
  const document = doc();
  const fakeUi = ui();
  const fetchFn = jest.fn(async url => ({
    ok: true,
    status: 200,
    json: async () => ({
      clients: [{ name: 'Amina', phone: '+2691234567', orders_valid: 1, ltv_kmf: 50000, average_basket_kmf: 50000, markets: ['KM'] }],
      pagination: { page: 1, total_pages: 1 },
    }),
    url,
  }));

  const result = await index.mount({
    root,
    document,
    ui: fakeUi,
    fetch: fetchFn,
    adminContext: {},
    contextContract: context('global'),
  });

  expect(result.endpoint).toBe('/api/admin/entities/clients');
  expect(fetchFn).toHaveBeenCalledWith(
    '/api/admin/entities/clients?sort=recent&page=1&page_size=25',
    expect.objectContaining({ credentials: 'include' })
  );
  expect(root.className).toBe('kmc-client-index');
  expect(fakeUi.UIState.render).toHaveBeenCalledWith(expect.any(Object), 'loading', expect.any(String));
});

test('mount gère état vide et erreur HTTP via UIState', async () => {
  const document = doc();
  const fakeUi = ui();
  let fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ clients: [], pagination: { page: 1, total_pages: 0 } }) }));
  await index.mount({ root: node(), document, ui: fakeUi, fetch: fetchFn, adminContext: {}, contextContract: context('global') });
  expect(fakeUi.UIState.render).toHaveBeenCalledWith(expect.any(Object), 'empty', expect.any(String));

  fetchFn = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'down' }) }));
  await expect(index.mount({ root: node(), document, ui: fakeUi, fetch: fetchFn, adminContext: {}, contextContract: context('global') }))
    .rejects.toThrow('down');
  expect(fakeUi.UIState.render).toHaveBeenCalledWith(expect.any(Object), 'error', 'down');
});
