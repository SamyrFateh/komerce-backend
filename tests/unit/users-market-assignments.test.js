/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('../../public/dashboards/canonical/js/users-admin');

function fakeElement(tag) {
  const item = {
    tag, children: [], attrs: {}, listeners: {}, value: '', checked: false, disabled: false,
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...next) { this.children = next; },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(key, callback) { this.listeners[key] = callback; },
  };
  let text = '';
  Object.defineProperty(item, 'textContent', {
    get() { return text; },
    set(value) { text = String(value); item.children = []; },
  });
  return item;
}
function descendants(parent) {
  return [parent, ...(parent.children || []).flatMap(descendants)];
}
function http(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const markets = [
  { code: 'KM', name: 'Comores' },
  { code: 'CM', name: 'Cameroun' },
  { code: 'CG', name: 'Congo' },
];
function setup(options = {}) {
  const users = [
    { id: 'u1', role: 'market_operator', full_name: 'Responsable A',
      email: 'a@example.com', account_activation_required: false,
      market_scopes: [{ market_code: 'KM' }] },
    { id: 'u2', role: 'market_operator', full_name: 'Responsable B',
      email: 'b@example.com', account_activation_required: true,
      market_scopes: [{ market_code: 'CM' }] },
  ];
  const requests = [];
  const doc = { createElement: fakeElement };
  const root = fakeElement('main');
  root.ownerDocument = doc;
  const fetch = jest.fn(async (url, args) => {
    requests.push({ url, args });
    if (url === '/api/admin/users?limit=200') return http({ users, total: 2 });
    if (url === '/api/admin/users/markets') return http({ markets });
    if (url.endsWith('/resend-invitation')) return http({ invitation_sent: true });
    if (args?.method === 'POST' && url.endsWith('/market-scopes')) {
      const code = JSON.parse(args.body).market_code;
      const user = users.find(u => url.includes('/' + u.id + '/'));
      if (options.failPost) return http({ error: 'Interdit' }, 403);
      user.market_scopes.push({ market_code: code });
      return http({ success: true }, 201);
    }
    if (args?.method === 'DELETE' && url.includes('/market-scopes/')) {
      if (options.failDelete) return http({ error: 'Interdit' }, 403);
      const user = users.find(u => url.includes('/' + u.id + '/'));
      const code = url.split('/').at(-1);
      user.market_scopes = user.market_scopes.filter(s => s.market_code !== code);
      return http({ success: true });
    }
    throw new Error('Unexpected request: ' + url);
  });
  const render = async ui => admin.render(root, { document: doc, fetch, ui: ui || null });
  const panel = () => descendants(root).find(n => n.attrs?.['data-market-assignments'] === '');
  const within = selector => descendants(panel()).find(selector);
  return { users, requests, root, fetch, render, panel, within };
}

describe('Affectations marchés — panneau administrateur', () => {
  test('affichage accessible, état serveur et aucune mutation avant Enregistrer', async () => {
    const app = setup();
    await app.render();
    const card = app.panel();
    expect(card.className).toContain('kmc-users-assignment-card');
    expect(app.within(n => n.tag === 'h2').textContent).toBe('Gérer les responsables marché');
    expect(app.within(n => n.tag === 'fieldset')).toBeTruthy();
    expect(app.within(n => n.tag === 'select').value).toBe('u1');
    const boxes = descendants(card).filter(n => n.tag === 'input' && n.type === 'checkbox');
    expect(boxes.map(n => n.value)).toEqual(['KM', 'CM', 'CG']);
    expect(boxes.map(n => n.checked)).toEqual([true, false, false]);
    expect(app.within(n => n.className === 'kmc-users-assignment-save').disabled).toBe(true);
    expect(app.within(n => n.attrs?.role === 'status').attrs['aria-live']).toBe('polite');
    expect(app.requests.filter(r => r.args?.method && r.args.method !== 'GET')).toHaveLength(0);
  });

  test('un seul clic enregistre ajout et retrait successifs avec les API existantes', async () => {
    const app = setup();
    await app.render();
    const boxes = descendants(app.panel()).filter(n => n.tag === 'input' && n.type === 'checkbox');
    boxes.find(n => n.value === 'KM').checked = false;
    boxes.find(n => n.value === 'KM').listeners.change();
    boxes.find(n => n.value === 'CG').checked = true;
    boxes.find(n => n.value === 'CG').listeners.change();
    const save = app.within(n => n.className === 'kmc-users-assignment-save');
    expect(save.disabled).toBe(false);
    await save.listeners.click();
    const edits = app.requests.filter(r => ['POST', 'DELETE'].includes(r.args?.method));
    expect(edits).toHaveLength(2);
    expect(edits.map(r => r.args.method)).toEqual(['POST', 'DELETE']);
    expect(edits[0].url).toBe('/api/admin/users/u1/market-scopes');
    expect(edits[0].args.credentials).toBe('include');
    expect(JSON.parse(edits[0].args.body)).toEqual({ market_code: 'CG', scope_role: 'manager' });
    expect(edits[1].url).toBe('/api/admin/users/u1/market-scopes/KM');
    expect(app.users[0].market_scopes).toEqual([{ market_code: 'CG' }]);
    expect(app.within(n => n.className === 'kmc-users-assignment-save').disabled).toBe(true);
    expect(app.within(n => n.attrs?.role === 'status').textContent).toContain('2 modification(s)');
  });

  test('échec partiel affiché sans simuler un rollback, et relecture des droits effectifs', async () => {
    const app = setup({ failDelete: true });
    await app.render();
    const boxes = descendants(app.panel()).filter(n => n.tag === 'input');
    boxes.find(n => n.value === 'CG').checked = true;
    boxes.find(n => n.value === 'CG').listeners.change();
    boxes.find(n => n.value === 'KM').checked = false;
    boxes.find(n => n.value === 'KM').listeners.change();
    await app.within(n => n.className === 'kmc-users-assignment-save').listeners.click();
    expect(app.users[0].market_scopes.map(m => m.market_code)).toEqual(['KM', 'CG']);
    expect(app.within(n => n.attrs?.role === 'status').textContent).toContain('Mise à jour incomplète');
    expect(app.within(n => n.attrs?.role === 'status').attrs['data-tone']).toBe('error');
    expect(descendants(app.panel()).filter(n => n.tag === 'input').map(n => n.checked))
      .toEqual([true, false, true]);
  });

  test('sélection d’un autre responsable et renvoi d’invitation conservé', async () => {
    const app = setup();
    await app.render();
    const chooser = app.within(n => n.tag === 'select');
    chooser.value = 'u2';
    chooser.listeners.change();
    expect(descendants(app.panel()).filter(n => n.tag === 'input').map(n => n.checked))
      .toEqual([false, true, false]);
    const resend = app.within(n => n.className === 'kmc-users-assignment-secondary' && n.textContent === 'Renvoyer l’invitation');
    expect(resend.hidden).toBe(false);
    await resend.listeners.click();
    expect(app.requests.find(r => r.url === '/api/admin/users/u2/resend-invitation').args.method).toBe('POST');
    expect(app.within(n => n.attrs?.role === 'status').textContent).toContain('Invitation renvoyée');
  });

  test('lien explicite dans la table : accès au bon responsable, sans seconde navigation', async () => {
    const app = setup();
    const td = () => ({ children: [], appendChild(child) { this.children.push(child); } });
    const cellA = td(), cellB = td();
    const rows = [{ children: [{}, {}, {}, cellA] }, { children: [{}, {}, {}, cellB] }];
    await app.render({ DenseTable: { render: () => ({ querySelectorAll: () => rows }) } });
    expect(cellA.children[0].textContent).toBe('Modifier le périmètre');
    cellB.children[0].listeners.click();
    expect(app.within(n => n.tag === 'select').value).toBe('u2');
  });

  test('styles isolés, chargés après le formulaire et adaptés au mobile', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/users-market-assignments-v1.css'), 'utf8');
    expect(html).toContain('users-market-assignments-v1.css?v=261106-1');
    expect(html.indexOf('users-market-assignments-v1.css')).toBeGreaterThan(html.indexOf('users-invitation-v1.css'));
    expect(css).toContain('[data-market-assignments]');
    expect(css).toContain('@media (max-width: 600px)');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('.kmc-users-inline-edit');
  });
});
