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

describe('Users admin — consultation seule', () => {
  test('rowsFor projette rôle, périmètres et dernière connexion sans inférer de statut', () => {
    const rows = admin.rowsFor({ users: [
      { full_name: 'A', email: 'a@x', role: 'market_operator', last_login_at: '2026-10-01T10:00:00Z', market_scopes: [{ market_code: 'KM', scope_role: 'manager' }] },
      { full_name: null, email: null, role: 'inconnu', last_login_at: null, market_scopes: [] },
    ] });
    expect(rows[0]).toEqual({ name: 'A', email: 'a@x', role: 'Opérateur marché', scopes: 'KM · manager', last_login: '2026-10-01' });
    expect(rows[1].role).toBe('inconnu (non reconnu)');
    expect(rows[1].last_login).toBe('Jamais connecté');
    expect(rows[1].scopes).toBe('—');
    expect(admin.rowsFor(undefined)).toEqual([]);
  });

  test('seuls les rôles réellement acceptés par le backend sont nommés', () => {
    expect(Object.keys(admin.ROLE_LABELS).sort()).toEqual(['admin', 'agent_hub', 'agent_relais', 'client', 'market_operator']);
  });

  test('aucune mutation : un seul GET, aucun verbe mutant, aucun champ secret', () => {
    expect(source).toContain("method: 'GET'");
    expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(source).not.toMatch(/password|<button|<input|<select/i);
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
