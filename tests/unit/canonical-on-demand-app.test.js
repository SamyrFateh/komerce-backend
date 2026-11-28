/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

function node() {
  return {
    children: [], attributes: {}, isConnected: true,
    appendChild(child) { this.children.push(child); return child; },
    append(child) { this.appendChild(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; },
  };
}

function load(pathname = '/admin/clients') {
  jest.resetModules();
  const root = node();
  const document = { readyState: 'loading', addEventListener: jest.fn(), createElement: node };
  const requests = jest.fn(async ({ root: host }) => host.appendChild(node()));
  const hub = jest.fn().mockResolvedValue({ ok: true });
  const clients = jest.fn().mockResolvedValue({ ok: true });
  global.document = document;
  global.window = {
    document, location: { pathname, search: '', hash: '' }, fetch: jest.fn(),
    KomerceCanonicalClientIndex: { mount: clients },
    KomerceCanonicalHubWorkstation: { mount: hub },
    KomerceClientRequests: { mount: requests },
    KomerceAdminContext: {}, KomerceCanonicalUI: {},
  };
  require('../../public/dashboards/canonical/js/app.js');
  return { root, requests, hub, clients, api: window.KomerceCanonicalAdmin };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('canonical app — On Demand mounting boundaries', () => {
  test.each(['market_operator', 'admin'])('Clients transmet le marché choisi à %s', async role => {
    const { api, root, requests, clients } = load();
    const user = { role };
    const context = { access: { mode: 'market', defaultMarket: 'CM', allowedMarkets: ['CM'] } };
    await api.renderClientIndex(root, user, context, 'CM');
    expect(clients).toHaveBeenCalledWith(expect.objectContaining({ user, adminContext: context, requestedMarket: 'CM' }));
    expect(requests).toHaveBeenCalledTimes(1);
    const host = root.children[1].children[0];
    expect(host.attributes['data-market-domain-module']).toBe('client-requests');
    expect(requests).toHaveBeenCalledWith({ root: host, marketCode: 'CM' });
  });

  test.each([['admin', null], ['agent_hub', 'CM'], ['agent_relais', 'CM']])('Clients ne monte pas On Demand pour %s sans contexte autorisé', async (role, market) => {
    const { api, root, requests } = load();
    await api.renderClientIndex(root, { role }, {}, market);
    expect(requests).not.toHaveBeenCalled();
  });

  test.each(['admin', 'agent_hub'])('Hub monte le dossier interne pour %s', async role => {
    const { api, root, requests, hub } = load('/admin/hub');
    const user = { role };
    await expect(api.renderReady(root, user, {})).resolves.toEqual({ ok: true });
    expect(hub).toHaveBeenCalledWith(expect.objectContaining({ root, user }));
    expect(requests).toHaveBeenCalledWith({ root: root.children[0], hub: true });
  });

  test.each([['agent_relais', true], ['market_operator', true], ['agent_hub', false]])('Hub ne monte pas le dossier pour %s / connecté=%s', async (role, connected) => {
    const { api, root, requests } = load('/admin/hub');
    root.isConnected = connected;
    await api.renderReady(root, { role }, {});
    expect(requests).not.toHaveBeenCalled();
  });
});
