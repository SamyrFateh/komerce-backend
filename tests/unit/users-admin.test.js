/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('../../public/dashboards/canonical/js/users-admin');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'public/dashboards/canonical/js/users-admin.js'), 'utf8');

describe('Users admin — rôles V1 et affectation marchés', () => {
  test('rowsFor projette rôle, périmètres et dernière connexion sans inférer de statut', () => {
    const rows = admin.rowsFor({ users: [
      { full_name: 'A', email: 'a@x', role: 'market_operator', last_login_at: '2026-10-01T10:00:00Z', market_scopes: [{ market_code: 'KM', scope_role: 'manager' }], account_activation_required: false },
      { full_name: null, email: null, role: 'inconnu', last_login_at: null, market_scopes: [] },
    ] });
    expect(rows[0]).toEqual({ name: 'A', email: 'a@x', role: 'Responsable marché', scopes: 'KM', activation: 'Activé', last_login: '2026-10-01' });
    expect(rows[1].role).toBe('inconnu (non reconnu)');
    expect(rows[1].activation).toBe('—');
    expect(rows[1].last_login).toBe('Jamais connecté');
    expect(rows[1].scopes).toBe('—');
    expect(admin.rowsFor(undefined)).toEqual([]);
  });

  test('seuls les rôles réellement acceptés par le backend sont nommés', () => {
    expect(Object.keys(admin.ROLE_LABELS).sort()).toEqual(['admin', 'agent_hub', 'agent_relais', 'client', 'market_operator']);
  });

  test('gestion des affectations : actions serveur, pas de mot de passe administrateur', () => {
    expect(source).toContain("method: granted ? 'POST' : 'DELETE'");
    expect(source).toContain("scope_role: 'manager'");
    expect(source).toContain("'/api/admin/users/markets'");
    expect(source).toContain('data-market-assignments');
    expect(source).not.toMatch(/new_password|password_hash|Mot de passe provisoire/);
  });

  test('render : erreur HTTP → message, pas de table', async () => {
    const children = [];
    const doc = { createElement: tag => ({ tag, appendChild: c => children.push(c), replaceChildren: () => { children.length = 0; } }) };
    const rootNode = { ownerDocument: doc, replaceChildren: () => { children.length = 0; }, appendChild: c => children.push(c) };
    const out = await admin.render(rootNode, { document: doc, fetch: async () => ({ ok: false, status: 403 }), ui: null });
    expect(out).toBeNull();
    expect(children).toHaveLength(1);
    expect(children[0].textContent).toContain('403');
  });
});

test('l\'en-tête est un hero au canon (rôle hero, kicker/titre/sous-titre workspace)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/users-admin.js'), 'utf8');
  expect(src).toContain("header.setAttribute('data-dashboard-role', 'hero')");
  expect(src).toContain("'kmc-workspace-kicker', 'ADMINISTRATION'");
  expect(src).not.toContain("'header', 'kmc-entity-header'");
});


describe('Invitation responsable marché — composant premium conservant le contrat serveur', () => {
  function fakeElement(tag) {
    const el = {
      tag,
      children: [],
      attrs: {},
      listeners: {},
      value: '',
      checked: false,
      disabled: false,
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...next) { this.children = next; },
      setAttribute(key, value) { this.attrs[key] = String(value); },
      removeAttribute(key) { delete this.attrs[key]; },
      addEventListener(event, callback) { this.listeners[event] = callback; },
    };
    let value = '';
    Object.defineProperty(el, 'textContent', {
      get() { return value; },
      set(v) { value = String(v); this.children = []; },
    });
    return el;
  }
  function allChildren(el) {
    return [el, ...(el.children || []).flatMap(allChildren)];
  }
  function http(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
  }
  const markets = [{ code: 'KM', name: 'Comores' }, { code: 'CM', name: 'Cameroun' },
    { code: 'CG', name: 'Congo' }];

  test('affiche les champs labellisés, un fieldset de marchés et le footer, sans HTML brut', async () => {
    const doc = { createElement: fakeElement };
    const root = fakeElement('main');
    root.ownerDocument = doc;
    const fetch = jest.fn(async url => url === '/api/admin/users?limit=200'
      ? http({ users: [], total: 0 }) : http({ markets }));
    await admin.render(root, { document: doc, fetch, ui: null });
    const nodes = allChildren(root);
    const card = nodes.find(n => n.attrs?.['data-market-manager-invite'] === '');
    expect(card).toBeTruthy();
    expect(card.className).toContain('kmc-users-invite-card');
    expect(nodes.find(n => n.tag === 'h2' && n.textContent === 'Inviter un responsable marché')).toBeTruthy();
    const labels = nodes.filter(n => n.tag === 'label');
    expect(labels.map(n => n.textContent)).toEqual(expect.arrayContaining([
      'Nom complet', 'Adresse e-mail professionnelle',
    ]));
    expect(nodes.find(n => n.tag === 'fieldset')).toBeTruthy();
    expect(nodes.find(n => n.tag === 'legend').textContent).toBe('Marchés autorisés');
    const boxes = nodes.filter(n => n.tag === 'input' && n.type === 'checkbox');
    expect(boxes.map(b => b.value)).toEqual(['KM', 'CM', 'CG']);
    expect(nodes.find(n => n.tag === 'button' && n.type === 'submit').className)
      .toBe('kmc-users-invite-submit');
    expect(nodes.find(n => n.attrs?.role === 'status' && n.attrs?.['aria-live'] === 'polite')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('sans marché, refuse le POST ; avec marché envoie le même payload sécurisé', async () => {
    const doc = { createElement: fakeElement };
    const root = fakeElement('main');
    root.ownerDocument = doc;
    const requests = [];
    const fetch = jest.fn(async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/admin/users?limit=200') return http({ users: [], total: 0 });
      if (url === '/api/admin/users/markets') return http({ markets });
      if (url === '/api/admin/users' && options?.method === 'POST') return http({ invitation_sent: true });
      throw Error('Unexpected request');
    });
    await admin.render(root, { document: doc, fetch, ui: null });
    let nodes = allChildren(root);
    const form = nodes.find(n => n.tag === 'form' && n.className === 'kmc-users-invite-form');
    const msg = nodes.find(n => n.attrs?.role === 'status');
    const event = { preventDefault: jest.fn() };
    await form.listeners.submit(event);
    expect(msg.textContent).toBe('Sélectionnez au moins un marché.');
    expect(requests.filter(x => x.options?.method === 'POST')).toHaveLength(0);
    const name = nodes.find(n => n.tag === 'input' && n.name === 'full_name');
    const email = nodes.find(n => n.tag === 'input' && n.name === 'email');
    name.value = '  Marie  ';
    email.value = '  marie@example.com  ';
    nodes.find(n => n.tag === 'input' && n.type === 'checkbox' && n.value === 'KM').checked = true;
    await form.listeners.submit(event);
    const calls = requests.filter(x => x.url === '/api/admin/users' && x.options?.method === 'POST');
    expect(calls).toHaveLength(1);
    expect(calls[0].options.credentials).toBe('include');
    expect(JSON.parse(calls[0].options.body)).toEqual({
      full_name: 'Marie', email: 'marie@example.com', role: 'market_operator',
      market_codes: ['KM'], invite: true,
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(5); // GET users + GET markets, POST, then refresh
  });

  test('CSS isolé et versionné après le chrome canonique (desktop + mobile)', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/users-invitation-v1.css'), 'utf8');
    expect(html).toMatch(/users-invitation-v1\.css\?v=261106-1/);
    expect(html.indexOf('users-invitation-v1.css')).toBeGreaterThan(html.indexOf('canonical-unified-chrome-v1.css'));
    expect(html).toContain('users-admin.js?v=261106-1');
    expect(css).toContain('[data-market-manager-invite]');
    expect(css).toContain('@media (max-width: 600px)');
    expect(css).toContain('.kmc-users-invite-fields');
    expect(css).toContain(':focus-visible');
  });
});
