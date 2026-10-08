/**
 * @komerce-arch
 * @role          canonical-users-admin
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        authenticated_admin, GET /api/admin/users
 * @outputs       users_readonly_dom
 * @depends       canonical primitives, GET /api/admin/users
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      read_only_projection, no_user_mutation_until_role_model_aligned, dashboard_no_business_recompute
 * @impact-areas  admin-dashboard, auth-identity
 * @version       2026-10
 */
'use strict';

(function initUsersAdmin(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalUsersAdmin = api;
})(typeof window !== 'undefined' ? window : null, function createUsersAdmin() {
  const ENDPOINT = '/api/admin/users?limit=200';

  // Rôles que le backend sait réellement porter aujourd'hui (routes/admin/users.js).
  // Les autres rôles opérationnels n'existent pas encore comme rôles users : on n'en
  // affiche aucun et on ne laisse rien en attribuer.
  const ROLE_LABELS = Object.freeze({
    client: 'Client',
    agent_relais: 'Agent relais',
    agent_hub: 'Agent hub',
    admin: 'Administrateur',
    market_operator: 'Opérateur marché',
  });

  const COLUMNS = Object.freeze([
    { key: 'name', label: 'Nom' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Rôle' },
    { key: 'scopes', label: 'Marchés / périmètre' },
    { key: 'last_login', label: 'Dernière connexion' },
  ]);

  function roleLabel(role) {
    return ROLE_LABELS[role] || (role ? `${role} (non reconnu)` : '—');
  }

  function scopesLabel(scopes) {
    if (!Array.isArray(scopes) || scopes.length === 0) return '—';
    return scopes.map(s => `${s.market_code || '?'} · ${s.scope_role || '?'}`).join(', ');
  }

  // Aucun statut actif/inactif n'existe côté backend : on n'en infère pas.
  function lastLoginLabel(value) {
    if (!value) return 'Jamais connecté';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
  }

  function rowsFor(payload) {
    const users = payload && Array.isArray(payload.users) ? payload.users : [];
    return users.map(u => ({
      name: u.full_name || '—',
      email: u.email || '—',
      role: roleLabel(u.role),
      scopes: scopesLabel(u.market_scopes),
      last_login: lastLoginLabel(u.last_login_at),
    }));
  }

  function node(doc, tag, className, value) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = String(value);
    return el;
  }

  function renderPayload(rootNode, payload, doc, ui) {
    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();
    const header = node(doc, 'header', 'kmc-entity-header');
    header.appendChild(node(doc, 'span', 'kmc-entity-kicker', 'ADMINISTRATION'));
    header.appendChild(node(doc, 'h1', 'kmc-entity-title', 'Utilisateurs'));
    header.appendChild(node(doc, 'p', 'kmc-entity-subtitle', 'Consultation seule : rôles actuels et périmètres marché. Aucune création, modification ni suppression depuis cet écran.'));
    rootNode.appendChild(header);

    const section = node(doc, 'section', 'kmc-decision-surface-card');
    section.setAttribute('data-users-readonly', '');
    const total = payload && Number.isFinite(Number(payload.total)) ? Number(payload.total) : rowsFor(payload).length;
    section.appendChild(node(doc, 'h2', 'kmc-decision-dashboard-section-title', `${total} utilisateur(s)`));
    const body = node(doc, 'div');
    section.appendChild(body);
    if (ui && ui.DenseTable) ui.DenseTable.render(body, { columns: COLUMNS, rows: rowsFor(payload) });
    rootNode.appendChild(section);
  }

  async function render(rootNode, options = {}) {
    const doc = options.document || rootNode.ownerDocument || document;
    const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null);
    const ui = options.ui || (typeof window !== 'undefined' ? window.KomerceDecisionUI : null);
    if (ui && ui.Skeleton) ui.Skeleton.render(rootNode, { shape: 'table' });
    const response = await fetchImpl(ENDPOINT, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      rootNode.replaceChildren();
      rootNode.appendChild(node(doc, 'p', 'kmc-users-error', `Impossible de charger les utilisateurs (${response.status}).`));
      return null;
    }
    const payload = await response.json();
    renderPayload(rootNode, payload, doc, ui);
    return payload;
  }

  return Object.freeze({ ENDPOINT, ROLE_LABELS, COLUMNS, roleLabel, scopesLabel, lastLoginLabel, rowsFor, renderPayload, render });
});
