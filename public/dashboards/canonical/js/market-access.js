/**
 * @komerce-arch
 * @role          canonical-market-access-admin
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        admin_session, active_markets, admin_users, market_scope_mutations
 * @outputs       market_operator_provisioning_ui, demo_credentials
 * @depends       /api/auth/me, /api/admin/users, /api/admin/dashboard/context
 * @used-by       /dashboards/canonical/access.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority, no_client_market_id_authority
 * @impact-areas  admin-dashboard, market-authorization, demo
 * @version       2026-09
 */

'use strict';

(function initMarketAccess(global) {
  'use strict';

  const ACCESS_PATH = '/dashboards/canonical/access.html';
  const state = {
    markets: [],
    users: [],
    lastCredentials: null,
  };

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function field(doc, label, control, options = {}) {
    const wrapper = el(doc, 'label', `kmc-access-field${options.wide ? ' is-wide' : ''}`);
    wrapper.appendChild(el(doc, 'span', '', label));
    wrapper.appendChild(control);
    return wrapper;
  }

  function input(doc, name, type, placeholder) {
    const control = doc.createElement('input');
    control.className = 'kmc-access-input';
    control.name = name;
    control.type = type;
    control.placeholder = placeholder || '';
    control.autocomplete = type === 'password' ? 'new-password' : 'off';
    return control;
  }

  function select(doc, name, options) {
    const control = doc.createElement('select');
    control.className = 'kmc-access-select';
    control.name = name;
    (options || []).forEach(option => {
      const node = doc.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      control.appendChild(node);
    });
    return control;
  }

  async function requestJson(fetchImpl, url, options = {}) {
    const response = await fetchImpl(url, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) {
      const error = new Error((payload && payload.error) || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload && payload.code;
      throw error;
    }
    return payload;
  }

  function randomHex(bytes = 8) {
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      const buffer = new Uint8Array(bytes);
      global.crypto.getRandomValues(buffer);
      return Array.from(buffer, value => value.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, bytes * 2);
  }

  function buildDemoCredentials(markets) {
    const preferred = (markets || []).find(market => market.code === 'CM') || (markets || [])[0] || null;
    const stamp = Date.now().toString(36);
    return Object.freeze({
      fullName: 'Démo Responsable Pays',
      email: `demo.market.${stamp}@example.com`,
      password: `Kmc!${randomHex(7)}A9`,
      marketCode: preferred ? preferred.code : '',
      scopeRole: 'manager',
    });
  }

  function marketOptions(markets) {
    return (markets || []).map(market => ({
      value: market.code,
      label: `${market.code} · ${market.name || market.code}`,
    }));
  }

  function marketsFromAdminContext(rawContext) {
    const contract = global.KomerceAdminContext;
    const context = contract && typeof contract.validateAdminContext === 'function'
      ? contract.validateAdminContext(rawContext)
      : rawContext;
    const codes = context && context.access && Array.isArray(context.access.allowedMarkets)
      ? context.access.allowedMarkets
      : [];
    return codes.map(code => Object.freeze({ code, name: code }));
  }

  function setFeedback(node, message, kind) {
    node.className = `kmc-access-feedback${kind ? ` is-${kind}` : ''}`;
    node.textContent = message || '';
  }

  function renderCredentials(doc, container, credentials) {
    container.replaceChildren();
    if (!credentials) return;

    const box = el(doc, 'div', 'kmc-access-credentials');
    box.appendChild(el(doc, 'strong', '', 'Compte démo créé — identifiants à conserver maintenant'));
    box.appendChild(el(doc, 'code', '', credentials.email));
    box.appendChild(el(doc, 'code', '', credentials.password));

    const actions = el(doc, 'div', 'kmc-access-actions');
    const copy = el(doc, 'button', 'kmc-access-button', 'Copier les identifiants');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      const text = `${credentials.email}\n${credentials.password}`;
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
        await global.navigator.clipboard.writeText(text);
        copy.textContent = 'Copié ✓';
      }
    });
    actions.appendChild(copy);

    const login = el(doc, 'a', 'kmc-access-login-link', 'Tester ce compte →');
    login.href = '/login.html?next=' + encodeURIComponent('/admin/pilotage');
    actions.appendChild(login);
    box.appendChild(actions);
    container.appendChild(box);
  }

  function scopeBadge(doc, scope, user, refresh, fetchImpl, feedback) {
    const row = el(doc, 'div', 'kmc-access-scope-row');
    const badge = el(
      doc,
      'span',
      `kmc-access-badge is-${scope.scope_role}`,
      `${scope.market_code} · ${scope.market_name || scope.market_code} · ${scope.scope_role}`
    );
    row.appendChild(badge);

    const revoke = el(doc, 'button', 'kmc-access-button is-danger', 'Révoquer');
    revoke.type = 'button';
    revoke.addEventListener('click', async () => {
      revoke.disabled = true;
      try {
        await requestJson(
          fetchImpl,
          `/api/admin/users/${encodeURIComponent(user.id)}/market-scopes/${encodeURIComponent(scope.market_code)}`,
          { method: 'DELETE' }
        );
        setFeedback(feedback, `${scope.market_code} révoqué pour ${user.full_name || user.email}.`, 'success');
        await refresh();
      } catch (error) {
        setFeedback(feedback, error.message, 'error');
      } finally {
        revoke.disabled = false;
      }
    });
    row.appendChild(revoke);
    return row;
  }

  function renderOperators(doc, container, users, markets, refresh, fetchImpl, feedback) {
    container.replaceChildren();
    const operators = (users || []).filter(user => user.role === 'market_operator');
    if (!operators.length) {
      container.appendChild(el(doc, 'div', 'kmc-access-empty', 'Aucun responsable pays provisionné.'));
      return;
    }

    operators.forEach(user => {
      const card = el(doc, 'article', 'kmc-access-operator');
      const head = el(doc, 'div', 'kmc-access-operator-head');
      const identity = el(doc, 'div', '');
      identity.appendChild(el(doc, 'h3', '', user.full_name || 'Responsable pays'));
      identity.appendChild(el(doc, 'p', 'kmc-access-muted', user.email || user.phone || user.id));
      head.appendChild(identity);
      head.appendChild(el(doc, 'span', 'kmc-access-badge', 'market_operator'));
      card.appendChild(head);

      const scopes = Array.isArray(user.market_scopes) ? user.market_scopes : [];
      const scopeList = el(doc, 'div', 'kmc-access-operator-actions');
      if (!scopes.length) {
        scopeList.appendChild(el(doc, 'span', 'kmc-access-muted', 'Aucun scope actif — accès pays bloqué.'));
      } else {
        scopes.forEach(scope => scopeList.appendChild(scopeBadge(doc, scope, user, refresh, fetchImpl, feedback)));
      }
      card.appendChild(scopeList);

      const editor = el(doc, 'div', 'kmc-access-scope-editor');
      const market = select(doc, 'market_code', marketOptions(markets));
      const role = select(doc, 'scope_role', [
        { value: 'viewer', label: 'Viewer · lecture du pays' },
        { value: 'manager', label: 'Manager · supervision + gestion pays' },
      ]);
      if (scopes[0]) {
        market.value = scopes[0].market_code;
        role.value = scopes[0].scope_role;
      }
      editor.appendChild(field(doc, 'Marché', market));
      editor.appendChild(field(doc, 'Niveau', role));

      const actions = el(doc, 'div', 'kmc-access-actions');
      const save = el(doc, 'button', 'kmc-access-button is-primary', 'Attribuer / modifier');
      save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await requestJson(fetchImpl, `/api/admin/users/${encodeURIComponent(user.id)}/market-scopes`, {
            method: 'POST',
            body: JSON.stringify({ market_code: market.value, scope_role: role.value }),
          });
          setFeedback(feedback, `${market.value} · ${role.value} appliqué à ${user.full_name || user.email}.`, 'success');
          await refresh();
        } catch (error) {
          setFeedback(feedback, error.message, 'error');
        } finally {
          save.disabled = false;
        }
      });
      actions.appendChild(save);
      editor.appendChild(actions);
      card.appendChild(editor);
      container.appendChild(card);
    });
  }

  function renderShell(options) {
    const doc = options.document;
    const root = options.root;
    const fetchImpl = options.fetch;
    root.className = 'kmc-access-shell';
    root.replaceChildren();

    const hero = el(doc, 'section', 'kmc-access-hero');
    hero.appendChild(el(doc, 'p', 'kmc-access-kicker', 'GOUVERNANCE · ACCÈS PAYS'));
    hero.appendChild(el(doc, 'h1', '', 'Responsables pays'));
    hero.appendChild(el(doc, 'p', '', 'Créer un market_operator, attribuer ses marchés et choisir viewer ou manager. Les droits restent résolus côté serveur ; aucun market_id du navigateur ne fait autorité.'));

    const demo = el(doc, 'div', 'kmc-access-demo');
    const demoCopy = el(doc, 'div', '');
    demoCopy.appendChild(el(doc, 'strong', '', 'Démo immédiate'));
    demoCopy.appendChild(el(doc, 'p', '', 'Préremplis un responsable pays de démonstration, crée-le, puis reconnecte-toi avec les identifiants générés.'));
    demo.appendChild(demoCopy);
    hero.appendChild(demo);
    root.appendChild(hero);

    const createPanel = el(doc, 'section', 'kmc-access-panel');
    const createHeader = el(doc, 'div', 'kmc-access-panel-header');
    createHeader.appendChild(el(doc, 'h2', '', 'Créer un responsable pays'));
    createHeader.appendChild(el(doc, 'p', '', 'Le premier scope est obligatoire. Les marchés autorisés sont résolus par le contexte Canonical côté serveur.'));
    createPanel.appendChild(createHeader);

    const form = el(doc, 'form', 'kmc-access-form');
    const fullName = input(doc, 'full_name', 'text', 'Ex. Ibrahim — Cameroun');
    const email = input(doc, 'email', 'email', 'responsable@exemple.com');
    const password = input(doc, 'password', 'password', 'Mot de passe initial');
    const market = select(doc, 'market_code', marketOptions(state.markets));
    const role = select(doc, 'scope_role', [
      { value: 'viewer', label: 'Viewer · lecture du pays' },
      { value: 'manager', label: 'Manager · supervision + gestion pays' },
    ]);
    role.value = 'manager';

    form.appendChild(field(doc, 'Nom', fullName));
    form.appendChild(field(doc, 'Email', email));
    form.appendChild(field(doc, 'Mot de passe initial', password));
    form.appendChild(field(doc, 'Marché', market));
    form.appendChild(field(doc, 'Niveau', role));

    const actions = el(doc, 'div', 'kmc-access-actions');
    const demoButton = el(doc, 'button', 'kmc-access-button', 'Préremplir une démo');
    demoButton.type = 'button';
    demoButton.addEventListener('click', () => {
      const credentials = buildDemoCredentials(state.markets);
      fullName.value = credentials.fullName;
      email.value = credentials.email;
      password.value = credentials.password;
      market.value = credentials.marketCode;
      role.value = credentials.scopeRole;
      setFeedback(feedback, 'Démo préremplie. Vérifie le pays puis clique Créer.', 'success');
    });
    actions.appendChild(demoButton);

    const submit = el(doc, 'button', 'kmc-access-button is-primary', 'Créer le market_operator');
    submit.type = 'submit';
    actions.appendChild(submit);
    form.appendChild(actions);
    createPanel.appendChild(form);

    const feedback = el(doc, 'div', 'kmc-access-feedback', 'Prêt.');
    createPanel.appendChild(feedback);
    const credentialsSlot = el(doc, 'div', '');
    createPanel.appendChild(credentialsSlot);
    root.appendChild(createPanel);

    const listPanel = el(doc, 'section', 'kmc-access-panel');
    const listHeader = el(doc, 'div', 'kmc-access-panel-header');
    listHeader.appendChild(el(doc, 'h2', '', 'Accès actifs'));
    listHeader.appendChild(el(doc, 'p', '', 'Un même opérateur peut recevoir plusieurs pays. Un changement de niveau conserve l’historique côté serveur.'));
    listPanel.appendChild(listHeader);
    const operators = el(doc, 'div', 'kmc-access-operators');
    listPanel.appendChild(operators);
    root.appendChild(listPanel);

    async function refresh() {
      const usersPayload = await requestJson(fetchImpl, '/api/admin/users?role=market_operator&limit=100');
      state.users = Array.isArray(usersPayload.users) ? usersPayload.users : [];
      renderOperators(doc, operators, state.users, state.markets, refresh, fetchImpl, feedback);
    }

    form.addEventListener('submit', async event => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      submit.disabled = true;
      try {
        const credentials = { email: email.value.trim(), password: password.value };
        await requestJson(fetchImpl, '/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            full_name: fullName.value.trim(),
            email: credentials.email,
            password: credentials.password,
            role: 'market_operator',
            market_scope: { market_code: market.value, scope_role: role.value },
          }),
        });
        state.lastCredentials = credentials;
        renderCredentials(doc, credentialsSlot, credentials);
        setFeedback(feedback, `${market.value} · ${role.value} créé.`, 'success');
        form.reset();
        role.value = 'manager';
        await refresh();
      } catch (error) {
        setFeedback(feedback, error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });

    renderOperators(doc, operators, state.users, state.markets, refresh, fetchImpl, feedback);
    return { refresh, form, feedback, operators, demoButton, credentialsSlot };
  }

  async function requireAdmin(fetchImpl) {
    const user = await requestJson(fetchImpl, '/api/auth/me');
    if (!user || user.role !== 'admin') {
      const error = new Error('admin_required');
      error.status = 403;
      throw error;
    }
    return user;
  }

  async function boot(options = {}) {
    const doc = options.document || global.document;
    const fetchImpl = options.fetch || global.fetch.bind(global);
    const root = options.root || (doc && doc.getElementById && doc.getElementById('canonical-admin-root'));
    if (!doc || !root) throw new Error('canonical_market_access_root_missing');

    try {
      await requireAdmin(fetchImpl);
    } catch (error) {
      if (error.status === 401) {
        global.location.replace('/login.html?next=' + encodeURIComponent(ACCESS_PATH));
        throw error;
      }
      root.className = 'kmc-access-shell';
      root.replaceChildren();
      const denied = el(doc, 'section', 'kmc-access-panel');
      denied.appendChild(el(doc, 'h1', '', 'Accès réservé aux administrateurs'));
      denied.appendChild(el(doc, 'p', '', 'Les responsables pays peuvent utiliser leurs dashboards, mais seul un admin central peut attribuer ou révoquer les scopes.'));
      root.appendChild(denied);
      return { denied: true };
    }

    const [contextPayload, usersPayload] = await Promise.all([
      requestJson(fetchImpl, '/api/admin/dashboard/context'),
      requestJson(fetchImpl, '/api/admin/users?role=market_operator&limit=100'),
    ]);
    state.markets = marketsFromAdminContext(contextPayload);
    state.users = Array.isArray(usersPayload.users) ? usersPayload.users : [];
    return renderShell({ document: doc, root, fetch: fetchImpl });
  }

  const api = Object.freeze({
    ACCESS_PATH,
    boot,
    requireAdmin,
    requestJson,
    buildDemoCredentials,
    marketOptions,
    marketsFromAdminContext,
    renderShell,
  });

  global.KomerceCanonicalMarketAccess = api;
  global.KomerceCanonicalAdmin = Object.freeze({
    surfaceForPath(pathname) {
      return pathname === ACCESS_PATH || pathname === '/admin/access' || pathname === '/admin-next/access'
        ? 'market-access'
        : 'pilotage';
    },
  });

  function autoBoot() {
    boot().catch(error => {
      if (error && error.status !== 401) console.error('[canonical-admin] market access boot failed', error);
    });
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', autoBoot, { once: true });
  } else if (global.document) {
    autoBoot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
