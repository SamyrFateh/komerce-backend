'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const mgmt = require('../../public/dashboards/canonical/js/markets-management.js');

function fakeDoc() {
  const make = tag => ({
    tag, children: [], className: '', textContent: '', dataset: {}, listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren() { this.children = []; },
    setAttribute() {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
  });
  return { createElement: make };
}

function walk(node, out = []) {
  out.push(node);
  (node.children || []).forEach(child => walk(child, out));
  return out;
}

function response(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

describe('markets-management — transitions affichées', () => {
  test('ouvrir depuis PROVISIONING, suspendre/rouvrir ensuite, jamais de clôture dans l’UI', () => {
    expect(mgmt.actionsFor('PROVISIONING')).toEqual([{ target: 'ACTIVE', label: 'Ouvrir' }]);
    expect(mgmt.actionsFor('ACTIVE')).toEqual([{ target: 'SUSPENDED', label: 'Suspendre' }]);
    expect(mgmt.actionsFor('SUSPENDED')).toEqual([{ target: 'ACTIVE', label: 'Rouvrir' }]);
    expect(mgmt.actionsFor('CLOSED')).toEqual([]);
    expect(mgmt.statusLabel('ACTIVE')).toBe('Ouvert');
    expect(mgmt.confirmMessage({ code: 'CM', name: 'Cameroun' }, { target: 'SUSPENDED' })).toContain('suspendre');
  });
});

describe('markets-management — montage', () => {
  const markets = [{ code: 'CM', name: 'Cameroun', currency: 'XAF', lifecycle_status: 'PROVISIONING', active_members: 1 }];

  test('liste via /api/admin/markets et POST lifecycle après confirmation', async () => {
    const calls = [];
    const fetchImpl = jest.fn((url, options) => {
      calls.push([url, options.method]);
      if (url.endsWith('/lifecycle')) return response({ changed: true });
      return response({ markets });
    });
    const host = fakeDoc().createElement('section');
    const doc = fakeDoc();
    await mgmt.mount(host, { document: doc, fetch: fetchImpl, confirm: () => true });
    expect(calls[0]).toEqual(['/api/admin/markets', 'GET']);
    const open = walk(host).find(n => n.dataset && n.dataset.lifecycleTarget === 'ACTIVE');
    expect(open).toBeTruthy();
    await open.listeners.click();
    expect(calls).toContainEqual(['/api/admin/markets/CM/lifecycle', 'POST']);
    expect(JSON.parse(fetchImpl.mock.calls.find(c => c[0].endsWith('/lifecycle'))[1].body)).toEqual({ status: 'ACTIVE' });
  });

  test('sans confirmation aucune mutation ; refus serveur affiché', async () => {
    const fetchImpl = jest.fn(() => response({ markets }));
    const host = fakeDoc().createElement('section');
    await mgmt.mount(host, { document: fakeDoc(), fetch: fetchImpl, confirm: () => false });
    const open = walk(host).find(n => n.dataset && n.dataset.lifecycleTarget === 'ACTIVE');
    await open.listeners.click();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const failing = jest.fn((url) => (url.endsWith('/lifecycle')
      ? response({ error: 'Activation refusée', code: 'MARKET_NOT_READY_FOR_ACTIVATION' }, false, 409)
      : response({ markets })));
    const host2 = fakeDoc().createElement('section');
    await mgmt.mount(host2, { document: fakeDoc(), fetch: failing, confirm: () => true });
    await walk(host2).find(n => n.dataset && n.dataset.lifecycleTarget === 'ACTIVE').listeners.click();
    expect(walk(host2).some(n => n.textContent === 'Activation refusée')).toBe(true);
  });

  test('écarts : lecture du control-plane serveur', async () => {
    const fetchImpl = jest.fn(url => (url.endsWith('/control-plane')
      ? response({ gaps: [{ code: 'NO_RELAIS', message: 'Aucun relais actif.' }] })
      : response({ markets })));
    const host = fakeDoc().createElement('section');
    await mgmt.mount(host, { document: fakeDoc(), fetch: fetchImpl });
    const gaps = walk(host).find(n => n.textContent === 'Voir les écarts');
    await gaps.listeners.click();
    expect(walk(host).some(n => n.textContent === 'Aucun relais actif.')).toBe(true);
  });

  test('access.html charge le script et il réutilise uniquement /api/admin/markets', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/access.html'), 'utf8');
    expect(html).toContain('/dashboards/canonical/js/markets-management.js');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/markets-management.js'), 'utf8');
    expect(src).not.toMatch(/\/api\/(?!admin\/markets)/);
  });
});
