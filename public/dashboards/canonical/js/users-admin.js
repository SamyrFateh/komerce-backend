/**
 * @komerce-arch
 * @role          canonical-users-admin
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        authenticated_admin, GET /api/admin/users
 * @outputs       users_table_and_market_assignment_controls
 * @depends       canonical primitives, GET /api/admin/users
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_authorized_market_membership_mutations, no_admin_password_provisioning, dashboard_no_business_recompute
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
    market_operator: 'Responsable marché',
  });

  const COLUMNS = Object.freeze([
    { key: 'name', label: 'Nom' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Rôle' },
    { key: 'scopes', label: 'Marchés / périmètre' },
    { key: 'activation', label: 'Compte' },
    { key: 'last_login', label: 'Dernière connexion' },
  ]);

  function roleLabel(role) {
    return ROLE_LABELS[role] || (role ? `${role} (non reconnu)` : '—');
  }

  function scopesLabel(scopes) {
    if (!Array.isArray(scopes) || scopes.length === 0) return '—';
    return scopes.map(s => s.market_code || '?').join(', ');
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
      activation: u.account_activation_required === true ? 'Invitation en attente' :
        (u.account_activation_required === false ? 'Activé' : '—'),
      last_login: lastLoginLabel(u.last_login_at),
    }));
  }

  function node(doc, tag, className, value) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = String(value);
    return el;
  }

  function renderPayload(rootNode, payload, doc, ui, management = null) {
    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();
    const header = node(doc, 'header', 'kmc-workspace-header');
    header.setAttribute('data-dashboard-role', 'hero');
    const copy = node(doc, 'div', '');
    header.appendChild(copy);
    copy.appendChild(node(doc, 'span', 'kmc-workspace-kicker', 'ADMINISTRATION'));
    copy.appendChild(node(doc, 'h1', 'kmc-workspace-title', 'Utilisateurs'));
    copy.appendChild(node(doc, 'p', 'kmc-workspace-subtitle', 'Gérez les marchés affectés aux responsables. Les comptes sont activés séparément via un parcours sécurisé.'));
    rootNode.appendChild(header);

    const section = node(doc, 'section', 'kmc-decision-surface-card');
    section.setAttribute('data-users-readonly', '');
    const total = payload && Number.isFinite(Number(payload.total)) ? Number(payload.total) : rowsFor(payload).length;
    section.appendChild(node(doc, 'h2', 'kmc-decision-dashboard-section-title', `${total} utilisateur(s)`));
    const body = node(doc, 'div');
    section.appendChild(body);
    if (ui && ui.DenseTable) ui.DenseTable.render(body, { columns: COLUMNS, rows: rowsFor(payload) });
    rootNode.appendChild(section);
    if (management) {
      if (management.notice) rootNode.appendChild(node(doc, 'p', 'kmc-users-action-message', management.notice));
      renderInviteManager(rootNode, doc, management);
      renderMarketAssignments(rootNode, payload, doc, management);
    }
  }

  // Invitation sans mot de passe : l'Admin choisit uniquement le profil et les marchés.
  function renderInviteManager(rootNode, doc, { markets, fetchImpl, refresh }) {
    if (!Array.isArray(markets) || !markets.length) return;
    const section = node(doc, 'section', 'kmc-decision-surface-card');
    section.setAttribute('data-market-manager-invite', '');
    section.appendChild(node(doc, 'h2', 'kmc-decision-dashboard-section-title', 'Inviter un responsable marché'));
    const form = node(doc, 'form', 'kmc-users-invite-form');
    const fullName = node(doc, 'input', 'kmc-users-input');
    fullName.name = 'full_name';
    fullName.type = 'text';
    fullName.required = true;
    fullName.maxLength = 120;
    fullName.placeholder = 'Nom complet';
    fullName.setAttribute('aria-label', 'Nom complet');
    const email = node(doc, 'input', 'kmc-users-input');
    email.name = 'email';
    email.type = 'email';
    email.required = true;
    email.maxLength = 254;
    email.placeholder = 'Adresse email professionnelle';
    email.setAttribute('aria-label', 'Adresse email professionnelle');
    const marketBox = node(doc, 'div', 'kmc-users-invite-markets');
    marketBox.appendChild(node(doc, 'p', '', 'Marchés autorisés'));
    const choices = [];
    for (const market of markets) {
      const code = String(market.code || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) continue;
      const label = node(doc, 'label', 'kmc-users-market-choice');
      const checkbox = node(doc, 'input');
      checkbox.type = 'checkbox';
      checkbox.value = code;
      label.appendChild(checkbox);
      label.appendChild(node(doc, 'span', '', code));
      marketBox.appendChild(label);
      choices.push(checkbox);
    }
    const send = node(doc, 'button', 'kmc-users-invite-submit', 'Envoyer une invitation sécurisée');
    send.type = 'submit';
    const message = node(doc, 'p', 'kmc-users-action-message');
    form.appendChild(fullName);
    form.appendChild(email);
    form.appendChild(marketBox);
    form.appendChild(send);
    form.appendChild(message);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const codes = choices.filter(c => c.checked).map(c => c.value);
      if (!codes.length) {
        message.textContent = 'Sélectionnez au moins un marché.';
        return;
      }
      send.disabled = true;
      try {
        const response = await fetchImpl('/api/admin/users', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            full_name: fullName.value.trim(), email: email.value.trim(),
            role: 'market_operator', market_codes: codes, invite: true,
          }),
        });
        if (!response.ok) {
          message.textContent = `Invitation refusée (${response.status}). Vérifiez le compte et les marchés.`;
          return;
        }
        const result = await response.json();
        await refresh(result.invitation_sent
          ? 'Compte créé et invitation envoyée.'
          : 'Compte créé, mais l’email n’est pas parti. Renvoyez l’invitation après configuration du service email.');
      } catch (_) {
        message.textContent = 'Invitation impossible. Vérifiez la connexion.';
      } finally {
        send.disabled = false;
      }
    });
    section.appendChild(form);
    rootNode.appendChild(section);
  }

  // Le choix des marchés n'accorde aucun droit depuis le navigateur.
  // Les POST/DELETE ci-dessous passent par les validations et audits serveur.
  function renderMarketAssignments(rootNode, payload, doc, { markets, fetchImpl, refresh }) {
    const operators = (payload?.users || []).filter(u => u.role === 'market_operator');
    if (!operators.length || !Array.isArray(markets) || !markets.length) return;
    const section = node(doc, 'section', 'kmc-decision-surface-card');
    section.setAttribute('data-market-assignments', '');
    section.appendChild(node(doc, 'h2', 'kmc-decision-dashboard-section-title', 'Responsables marché'));
    section.appendChild(node(doc, 'p', '', 'Sélectionnez un responsable puis attribuez ou retirez un marché.'));
    const chooser = node(doc, 'select', 'kmc-users-operator-select');
    chooser.setAttribute('aria-label', 'Responsable marché');
    for (const user of operators) {
      const opt = node(doc, 'option', '', `${user.full_name || user.email} — ${user.email}`);
      opt.value = user.id;
      chooser.appendChild(opt);
    }
    section.appendChild(chooser);
    const actions = node(doc, 'div', 'kmc-users-market-actions');
    const message = node(doc, 'p', 'kmc-users-action-message');
    section.appendChild(actions);
    section.appendChild(message);
    async function applyScope(userId, code, granted) {
      const endpoint = `/api/admin/users/${encodeURIComponent(userId)}/market-scopes`;
      const url = granted ? endpoint : `${endpoint}/${encodeURIComponent(code)}`;
      const headers = { Accept: 'application/json' };
      if (granted) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(url, {
        method: granted ? 'POST' : 'DELETE', credentials: 'include',
        headers,
        ...(granted ? { body: JSON.stringify({ market_code: code, scope_role: 'manager' }) } : {}),
      });
      if (!response.ok) {
        message.textContent = `Action refusée (${response.status}). Vérifiez les autorisations du compte.`;
        return;
      }
      await refresh();
    }
    function paint() {
      actions.replaceChildren();
      message.textContent = '';
      const selected = operators.find(u => String(u.id) === String(chooser.value)) || operators[0];
      if (!selected) return;
      if (selected.account_activation_required === true) {
        const resend = node(doc, 'button', 'kmc-users-market-action', 'Renvoyer l’invitation');
        resend.type = 'button';
        resend.addEventListener('click', async () => {
          resend.disabled = true;
          try {
            const response = await fetchImpl(
              `/api/admin/users/${encodeURIComponent(selected.id)}/resend-invitation`,
              { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } }
            );
            if (!response.ok) {
              message.textContent = `Envoi refusé (${response.status}).`;
              return;
            }
            const body = await response.json();
            message.textContent = body.invitation_sent
              ? 'Invitation renvoyée.'
              : 'Email non envoyé. Vérifiez la configuration Brevo.';
          } catch (_) {
            message.textContent = 'Impossible de renvoyer l’invitation.';
          } finally { resend.disabled = false; }
        });
        actions.appendChild(resend);
      }
      const assigned = new Set((selected.market_scopes || []).map(x => x.market_code));
      for (const market of markets) {
        const code = String(market.code || '').toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) continue;
        const granted = assigned.has(code);
        const btn = node(doc, 'button', 'kmc-users-market-action',
          `${granted ? 'Retirer' : 'Attribuer'} ${code}`);
        btn.type = 'button';
        btn.setAttribute('aria-label', `${granted ? 'Retirer' : 'Attribuer'} ${code} pour ${selected.full_name || selected.email}`);
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try { await applyScope(selected.id, code, !granted); }
          catch (_) { message.textContent = 'Action impossible. Réessayez ou consultez les journaux serveur.'; }
          finally { btn.disabled = false; }
        });
        actions.appendChild(btn);
      }
    }
    chooser.addEventListener('change', paint);
    if (operators[0]) chooser.value = operators[0].id;
    paint();
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
    let management = null;
    // L'absence de grant global laisse l'écran lisible, sans boutons d'action.
    try {
      const marketsResponse = await fetchImpl('/api/admin/users/markets', {
        method: 'GET', credentials: 'include', headers: { Accept: 'application/json' },
      });
      if (marketsResponse.ok) {
        const body = await marketsResponse.json();
        management = {
          markets: Array.isArray(body.markets) ? body.markets : [],
          fetchImpl,
          refresh: notice => render(rootNode, { ...options, notice }),
          notice: options.notice || null,
        };
      }
    } catch (_) { /* lecture seule si référentiel indisponible */ }
    renderPayload(rootNode, payload, doc, ui, management);
    return payload;
  }

  return Object.freeze({ ENDPOINT, ROLE_LABELS, COLUMNS, roleLabel, scopesLabel, lastLoginLabel, rowsFor, renderPayload, render });
});
