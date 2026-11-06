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
    const table = ui && ui.DenseTable
      ? ui.DenseTable.render(body, { columns: COLUMNS, rows: rowsFor(payload) }) : null;
    rootNode.appendChild(section);
    if (management) {
      if (management.notice) rootNode.appendChild(node(doc, 'p', 'kmc-users-action-message', management.notice));
      renderInviteManager(rootNode, doc, management);
      const selectOperator = renderMarketAssignments(rootNode, payload, doc, management);
      if (selectOperator && table && typeof table.querySelectorAll === 'function') {
        const tableRows = table.querySelectorAll('tbody tr');
        (payload.users || []).forEach((user, index) => {
          if (user.role !== 'market_operator' || !tableRows[index]) return;
          const scopeCell = tableRows[index].children[3];
          if (!scopeCell) return;
          const link = node(doc, 'button', 'kmc-users-inline-edit', 'Modifier le périmètre');
          link.type = 'button';
          link.setAttribute('aria-label', 'Modifier le périmètre de ' + (user.full_name || user.email));
          link.addEventListener('click', () => selectOperator(user.id));
          scopeCell.appendChild(link);
        });
      }
    }
  }

  // Invitation sans mot de passe : les marchés sont les seuls périmètres choisis ici.
  // Le POST reste le writer serveur existant, sans permissions individuelles.
  function renderInviteManager(rootNode, doc, { markets, fetchImpl, refresh }) {
    if (!Array.isArray(markets) || !markets.length) return;
    const section = node(doc, 'section', 'kmc-decision-surface-card kmc-users-invite-card');
    section.setAttribute('data-market-manager-invite', '');

    const intro = node(doc, 'div', 'kmc-users-invite-intro');
    const icon = node(doc, 'span', 'kmc-users-invite-icon');
    icon.setAttribute('aria-hidden', 'true');
    const introCopy = node(doc, 'div', 'kmc-users-invite-intro-copy');
    const heading = node(doc, 'h2', 'kmc-users-invite-title', 'Inviter un responsable marché');
    const description = node(doc, 'p', 'kmc-users-invite-description',
      'Créez un compte responsable marché et définissez immédiatement son périmètre d’action.');
    introCopy.appendChild(heading);
    introCopy.appendChild(description);
    intro.appendChild(icon);
    intro.appendChild(introCopy);
    section.appendChild(intro);

    const form = node(doc, 'form', 'kmc-users-invite-form');
    const fieldGrid = node(doc, 'div', 'kmc-users-invite-fields');

    const fullNameField = node(doc, 'div', 'kmc-users-invite-field');
    const fullNameLabel = node(doc, 'label', 'kmc-users-invite-label', 'Nom complet');
    fullNameLabel.htmlFor = 'kmc-users-invite-name';
    const fullName = node(doc, 'input', 'kmc-users-input');
    fullName.id = 'kmc-users-invite-name';
    fullName.name = 'full_name';
    fullName.type = 'text';
    fullName.required = true;
    fullName.maxLength = 120;
    fullName.autoComplete = 'name';
    fullName.placeholder = 'Ex. : Jean Dupont';
    fullNameField.appendChild(fullNameLabel);
    fullNameField.appendChild(fullName);

    const emailField = node(doc, 'div', 'kmc-users-invite-field');
    const emailLabel = node(doc, 'label', 'kmc-users-invite-label', 'Adresse e-mail professionnelle');
    emailLabel.htmlFor = 'kmc-users-invite-email';
    const email = node(doc, 'input', 'kmc-users-input');
    email.id = 'kmc-users-invite-email';
    email.name = 'email';
    email.type = 'email';
    email.required = true;
    email.maxLength = 254;
    email.autoComplete = 'email';
    email.placeholder = 'Ex. : jean.dupont@komerce.km';
    emailField.appendChild(emailLabel);
    emailField.appendChild(email);

    fieldGrid.appendChild(fullNameField);
    fieldGrid.appendChild(emailField);
    form.appendChild(fieldGrid);

    const marketBox = node(doc, 'fieldset', 'kmc-users-invite-markets');
    marketBox.appendChild(node(doc, 'legend', 'kmc-users-invite-label', 'Marchés autorisés'));
    const marketGrid = node(doc, 'div', 'kmc-users-invite-market-grid');
    const choices = [];
    for (const market of markets) {
      const code = String(market.code || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) continue;
      const label = node(doc, 'label', 'kmc-users-market-choice');
      const checkbox = node(doc, 'input', 'kmc-users-market-checkbox');
      checkbox.type = 'checkbox';
      checkbox.name = 'market_codes';
      checkbox.value = code;
      checkbox.setAttribute('aria-label',
        (market.name ? String(market.name) + ' (' + code + ')' : 'Marché ' + code));
      label.appendChild(checkbox);
      label.appendChild(node(doc, 'span', 'kmc-users-market-code', code));
      marketGrid.appendChild(label);
      choices.push(checkbox);
    }
    marketBox.appendChild(marketGrid);
    form.appendChild(marketBox);

    const footer = node(doc, 'div', 'kmc-users-invite-footer');
    const send = node(doc, 'button', 'kmc-users-invite-submit');
    send.type = 'submit';
    const sendIcon = node(doc, 'span', 'kmc-users-invite-send-icon');
    sendIcon.setAttribute('aria-hidden', 'true');
    send.appendChild(sendIcon);
    send.appendChild(node(doc, 'span', '', 'Envoyer une invitation sécurisée'));
    footer.appendChild(send);

    const hint = node(doc, 'p', 'kmc-users-invite-hint');
    const hintIcon = node(doc, 'span', 'kmc-users-invite-hint-icon', 'i');
    hintIcon.setAttribute('aria-hidden', 'true');
    hint.appendChild(hintIcon);
    hint.appendChild(node(doc, 'span', '',
      'Un e-mail d’activation sera envoyé au destinataire avec un lien sécurisé.'));
    footer.appendChild(hint);
    form.appendChild(footer);

    const message = node(doc, 'p', 'kmc-users-action-message kmc-users-invite-message');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    form.appendChild(message);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (send.disabled) return;
      const codes = choices.filter(choice => choice.checked).map(choice => choice.value);
      message.textContent = '';
      message.removeAttribute('data-tone');
      if (!codes.length) {
        message.setAttribute('data-tone', 'error');
        message.textContent = 'Sélectionnez au moins un marché.';
        return;
      }
      send.disabled = true;
      send.setAttribute('aria-busy', 'true');
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
          message.setAttribute('data-tone', 'error');
          message.textContent = 'Invitation refusée (' + response.status + '). Vérifiez le compte et les marchés.';
          return;
        }
        const result = await response.json();
        await refresh(result.invitation_sent
          ? 'Compte créé et invitation envoyée.'
          : 'Compte créé, mais l’email n’est pas parti. Renvoyez l’invitation après configuration du service email.');
      } catch (_) {
        message.setAttribute('data-tone', 'error');
        message.textContent = 'Invitation impossible. Vérifiez la connexion.';
      } finally {
        send.disabled = false;
        send.removeAttribute('aria-busy');
      }
    });
    section.appendChild(form);
    rootNode.appendChild(section);
  }


  // Panneau de gestion : la sélection est locale, chaque mutation reste
  // autorisée et auditée par les routes serveur canoniques.
  function renderMarketAssignments(rootNode, payload, doc, management) {
    const { markets, fetchImpl, refreshAssignment, selectedUserId, assignmentNotice, assignmentTone } = management;
    const operators = (payload?.users || []).filter(user => user.role === 'market_operator');
    const available = (Array.isArray(markets) ? markets : []).filter(market =>
      /^[A-Z]{2}$/.test(String(market.code || '').toUpperCase()));
    if (!operators.length || !available.length) return null;
    const section = node(doc, 'section', 'kmc-decision-surface-card kmc-users-assignment-card');
    section.setAttribute('data-market-assignments', '');
    const heading = node(doc, 'div', 'kmc-users-assignment-heading');
    const emblem = node(doc, 'span', 'kmc-users-assignment-emblem');
    emblem.setAttribute('aria-hidden', 'true');
    const headingCopy = node(doc, 'div', 'kmc-users-assignment-heading-copy');
    headingCopy.appendChild(node(doc, 'h2', 'kmc-users-assignment-title', 'Gérer les responsables marché'));
    headingCopy.appendChild(node(doc, 'p', 'kmc-users-assignment-description',
      'Modifiez les marchés accessibles à chaque responsable, sans permissions individuelles.'));
    heading.appendChild(emblem);
    heading.appendChild(headingCopy);
    section.appendChild(heading);

    const field = node(doc, 'div', 'kmc-users-assignment-field');
    const label = node(doc, 'label', 'kmc-users-assignment-label', 'Responsable sélectionné');
    label.htmlFor = 'kmc-users-assignment-select';
    const chooser = node(doc, 'select', 'kmc-users-assignment-select');
    chooser.id = 'kmc-users-assignment-select';
    operators.forEach(user => {
      const option = node(doc, 'option', '', (user.full_name || user.email) + ' — ' + user.email);
      option.value = String(user.id);
      chooser.appendChild(option);
    });
    field.appendChild(label);
    field.appendChild(chooser);
    section.appendChild(field);

    const identity = node(doc, 'div', 'kmc-users-assignment-identity');
    const avatar = node(doc, 'span', 'kmc-users-assignment-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    const identityCopy = node(doc, 'div', 'kmc-users-assignment-identity-copy');
    const identityName = node(doc, 'strong', 'kmc-users-assignment-name');
    const identityEmail = node(doc, 'span', 'kmc-users-assignment-email');
    const badge = node(doc, 'span', 'kmc-users-assignment-badge');
    identityCopy.appendChild(identityName);
    identityCopy.appendChild(identityEmail);
    identity.appendChild(avatar);
    identity.appendChild(identityCopy);
    identity.appendChild(badge);
    section.appendChild(identity);

    const marketField = node(doc, 'fieldset', 'kmc-users-assignment-markets');
    marketField.appendChild(node(doc, 'legend', 'kmc-users-assignment-label', 'Marchés autorisés'));
    marketField.appendChild(node(doc, 'p', 'kmc-users-assignment-help',
      'Sélectionnez les marchés à administrer, puis enregistrez.'));
    const grid = node(doc, 'div', 'kmc-users-assignment-grid');
    marketField.appendChild(grid);
    section.appendChild(marketField);

    const footer = node(doc, 'div', 'kmc-users-assignment-footer');
    const counter = node(doc, 'span', 'kmc-users-assignment-counter');
    const buttons = node(doc, 'div', 'kmc-users-assignment-buttons');
    const resend = node(doc, 'button', 'kmc-users-assignment-secondary', 'Renvoyer l’invitation');
    resend.type = 'button';
    const reset = node(doc, 'button', 'kmc-users-assignment-secondary', 'Annuler');
    reset.type = 'button';
    const save = node(doc, 'button', 'kmc-users-assignment-save', 'Enregistrer les modifications');
    save.type = 'button';
    buttons.appendChild(resend);
    buttons.appendChild(reset);
    buttons.appendChild(save);
    footer.appendChild(counter);
    footer.appendChild(buttons);
    section.appendChild(footer);
    const message = node(doc, 'p', 'kmc-users-assignment-message');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    section.appendChild(message);

    let current = null, original = new Set(), choices = [], busy = false;
    function selectedCodes() {
      return new Set(choices.filter(choice => choice.checked).map(choice => choice.value));
    }
    function updateState() {
      const chosen = selectedCodes();
      const changed = chosen.size !== original.size || [...chosen].some(code => !original.has(code));
      counter.textContent = chosen.size + ' marché' + (chosen.size === 1 ? '' : 's') +
        ' sélectionné' + (chosen.size === 1 ? '' : 's');
      badge.textContent = original.size + ' marché' + (original.size === 1 ? '' : 's') + ' actuel' + (original.size === 1 ? '' : 's');
      save.disabled = busy || !changed;
      reset.disabled = busy || !changed;
    }
    function setBusy(value) {
      busy = value;
      chooser.disabled = value;
      resend.disabled = value;
      choices.forEach(choice => { choice.disabled = value; });
      section.setAttribute('aria-busy', String(value));
      updateState();
    }
    function paint() {
      current = operators.find(user => String(user.id) === String(chooser.value)) || operators[0];
      if (!current) return;
      grid.replaceChildren();
      message.textContent = '';
      message.removeAttribute('data-tone');
      identityName.textContent = current.full_name || current.email;
      identityEmail.textContent = current.email;
      resend.hidden = current.account_activation_required !== true;
      original = new Set((current.market_scopes || []).map(scope =>
        String(scope.market_code || '').toUpperCase()).filter(Boolean));
      choices = [];
      available.forEach(market => {
        const code = String(market.code).toUpperCase();
        const tile = node(doc, 'label', 'kmc-users-assignment-tile');
        const checkbox = node(doc, 'input', 'kmc-users-assignment-checkbox');
        checkbox.type = 'checkbox';
        checkbox.value = code;
        checkbox.checked = original.has(code);
        checkbox.setAttribute('aria-label', market.name ? String(market.name) + ' (' + code + ')' : 'Marché ' + code);
        checkbox.addEventListener('change', () => {
          message.textContent = '';
          message.removeAttribute('data-tone');
          updateState();
        });
        const copy = node(doc, 'span', 'kmc-users-assignment-tile-copy');
        copy.appendChild(node(doc, 'strong', 'kmc-users-assignment-code', code));
        if (market.name) copy.appendChild(node(doc, 'small', 'kmc-users-assignment-market-name', market.name));
        tile.appendChild(checkbox);
        tile.appendChild(copy);
        grid.appendChild(tile);
        choices.push(checkbox);
      });
      updateState();
    }
    async function applyScope(userId, code, granted) {
      const endpoint = '/api/admin/users/' + encodeURIComponent(userId) + '/market-scopes';
      const url = granted ? endpoint : endpoint + '/' + encodeURIComponent(code);
      const headers = { Accept: 'application/json' };
      if (granted) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(url, {
        method: granted ? 'POST' : 'DELETE', credentials: 'include', headers,
        ...(granted ? { body: JSON.stringify({ market_code: code, scope_role: 'manager' }) } : {}),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
    }
    chooser.addEventListener('change', paint);
    reset.addEventListener('click', () => { if (!busy) paint(); });
    save.addEventListener('click', async () => {
      if (busy || save.disabled || !current) return;
      const userId = String(current.id), chosen = selectedCodes();
      const additions = [...chosen].filter(code => !original.has(code));
      const removals = [...original].filter(code =>
        available.some(market => String(market.code).toUpperCase() === code) && !chosen.has(code));
      setBusy(true);
      let done = 0, failed = null;
      try {
        for (const code of additions) { await applyScope(userId, code, true); done++; }
        for (const code of removals) { await applyScope(userId, code, false); done++; }
      } catch (error) { failed = error; }
      const detail = failed
        ? 'Mise à jour incomplète : ' + done + ' changement(s) appliqué(s), ' + failed.message +
          '. Les droits réels sont rechargés ; vérifiez les marchés restants.'
        : 'Périmètre mis à jour : ' + done + ' modification(s) enregistrée(s).';
      try {
        await refreshAssignment(userId, detail, failed ? 'error' : 'success');
      } catch (_) {
        setBusy(false);
        message.setAttribute('data-tone', 'error');
        message.textContent = 'Relecture impossible. Rechargez la page avant de poursuivre.';
      }
    });
    resend.addEventListener('click', async () => {
      if (busy || !current || current.account_activation_required !== true) return;
      setBusy(true);
      message.textContent = '';
      try {
        const response = await fetchImpl('/api/admin/users/' + encodeURIComponent(current.id) + '/resend-invitation', {
          method: 'POST', credentials: 'include', headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const result = await response.json();
        message.textContent = result.invitation_sent ? 'Invitation renvoyée.' :
          'Email non envoyé. Vérifiez la configuration du service email.';
        message.setAttribute('data-tone', result.invitation_sent ? 'success' : 'error');
      } catch (_) {
        message.setAttribute('data-tone', 'error');
        message.textContent = 'Impossible de renvoyer l’invitation.';
      } finally { setBusy(false); }
    });
    chooser.value = String(operators.some(user => String(user.id) === String(selectedUserId))
      ? selectedUserId : operators[0].id);
    paint();
    if (assignmentNotice) {
      message.textContent = assignmentNotice;
      message.setAttribute('data-tone', assignmentTone === 'error' ? 'error' : 'success');
    }
    rootNode.appendChild(section);
    return function selectOperator(userId) {
      chooser.value = String(userId);
      paint();
      if (typeof section.scrollIntoView === 'function') section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (typeof chooser.focus === 'function') chooser.focus({ preventScroll: true });
    };
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
          refreshAssignment: (selectedUserId, assignmentNotice, assignmentTone) =>
            render(rootNode, { ...options, selectedUserId, assignmentNotice, assignmentTone }),
          selectedUserId: options.selectedUserId || null,
          assignmentNotice: options.assignmentNotice || null,
          assignmentTone: options.assignmentTone || null,
          notice: options.notice || null,
        };
      }
    } catch (_) { /* lecture seule si référentiel indisponible */ }
    renderPayload(rootNode, payload, doc, ui, management);
    return payload;
  }

  return Object.freeze({ ENDPOINT, ROLE_LABELS, COLUMNS, roleLabel, scopesLabel, lastLoginLabel, rowsFor, renderPayload, render });
});
