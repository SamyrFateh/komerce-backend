/**
 * @komerce-arch
 * @role          canonical-action-center-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_action_center_operator, server_admin_context, canonical_action_center_projection
 * @outputs       canonical_action_center_dom, authorized_signal_lifecycle_requests
 * @depends       canonical primitives, /api/admin/dashboard/context
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      action_center_handles_derived_signals_only, server_admin_context_selects_market_endpoint, browser_signal_ref_only, canonical_admin_no_legacy_imports, agent_view_is_same_surface_filtered_by_server_scope, agent_actions_acknowledge_snooze_only
 * @impact-areas  admin-dashboard, decision-signals, market-authorization
 * @version       2026-09
 */

'use strict';

(function initActionCenter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalActionCenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createActionCenter() {
  const ENDPOINT = '/api/admin/action-center';
  const CONTEXT_ENDPOINT = '/api/admin/dashboard/context';
  const AGENT_ENDPOINT = '/api/agent/action-center';
  const AGENT_ROLES = Object.freeze(['agent_hub', 'agent_relais', 'agent_transitaire']);

  function isAgentUser(user) {
    return Boolean(user && AGENT_ROLES.includes(user.role));
  }

  const FAMILY_LABELS = Object.freeze({
    ops: 'Opérations',
    eco: 'Économie',
    sourcing: 'Sourcing',
    disputes: 'Incidents & litiges',
    other: 'Autres signaux',
  });

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function selectedMarketCode(adminContext, locationLike) {
    const access = adminContext && adminContext.access ? adminContext.access : {};
    const allowed = Array.isArray(access.allowedMarkets) ? access.allowedMarkets.map(code => String(code).toUpperCase()) : [];
    if (!allowed.length || access.mode !== 'market') return null;

    let requested = null;
    try {
      if (locationLike && locationLike.href) requested = new URL(locationLike.href).searchParams.get('market');
    } catch (_) {}
    if (requested && allowed.includes(String(requested).toUpperCase())) return String(requested).toUpperCase();

    const preferred = access.defaultMarket ? String(access.defaultMarket).toUpperCase() : null;
    if (preferred && allowed.includes(preferred)) return preferred;
    return allowed[0] || null;
  }

  function severityFilterFromLocation(locationLike) {
    try {
      if (!locationLike || !locationLike.href) return null;
      const raw = new URL(locationLike.href).searchParams.get('severity');
      if (!raw) return null;
      // Liste blanche stricte — jamais une valeur arbitraire du navigateur
      // envoyée telle quelle au serveur au-delà de ce que le contrat
      // signals.severity accepte réellement.
      const allowed = new Set(['urgent', 'critical', 'warning', 'info']);
      const values = raw.split(',').map(s => s.trim()).filter(v => allowed.has(v));
      return values.length ? values.join(',') : null;
    } catch (_) {
      return null;
    }
  }

  async function resolveRuntimeScope(options) {
    const adminContext = options.adminContext || await jsonRequest(options.fetch, CONTEXT_ENDPOINT);
    const locationLike = options.location || (typeof globalThis !== 'undefined' ? globalThis.location : null);
    const marketCode = selectedMarketCode(adminContext, locationLike);
    const severity = severityFilterFromLocation(locationLike);
    const query = severity ? `?severity=${encodeURIComponent(severity)}` : '';
    if (adminContext && adminContext.access && adminContext.access.mode === 'market') {
      if (!marketCode) {
        const error = new Error('Aucun Market ID autorisé pour le Centre d’actions');
        error.code = 'action_center_market_context_missing';
        throw error;
      }
      const endpoint = `${ENDPOINT}/market/${encodeURIComponent(marketCode)}`;
      return {
        mode: 'market',
        marketCode,
        severity,
        endpoint,
        loadEndpoint: `${endpoint}${query}`,
        adminContext,
      };
    }
    return {
      mode: 'global', marketCode: null, severity,
      endpoint: ENDPOINT, loadEndpoint: `${ENDPOINT}${query}`, adminContext,
    };
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-action-center-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function header(doc, payload, severity) {
    const node = doc.createElement('header');
    node.className = 'kmc-workspace-header';
    node.setAttribute('data-dashboard-role', 'hero');
    const market = payload && payload.scope && payload.scope.market;

    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'ACTION CENTER'));
    if (payload && payload.role) {
      copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Mes actions'));
      copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Ce qui demande votre intervention maintenant.'));
    } else {
      copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', market ? `Décisions · ${market.name || market.code}` : 'Décisions à traiter'));
      copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', market
        ? 'Les points qui demandent une décision sur ce marché.'
        : 'Les points qui demandent une décision maintenant.'));
    }

    if (severity) {
      const filterLine = doc.createElement('p');
      filterLine.className = 'kmc-workspace-subtitle kmc-action-center-filter';
      filterLine.appendChild(text(doc, 'strong', '', `Filtre · ${severity.split(',').map(severityLabel).join(', ')}`));
      filterLine.appendChild(doc.createTextNode(' · '));
      const clear = text(doc, 'a', 'kmc-workspace-nav-link', 'Tout afficher');
      clear.href = market ? `/admin/action-center?market=${encodeURIComponent(market.code)}` : '/admin/action-center';
      filterLine.appendChild(clear);
      copy.appendChild(filterLine);
    }
    node.appendChild(copy);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.dataset.actionCenterFeedback = '';
    feedback.setAttribute('role', 'status');
    node.appendChild(feedback);
    return node;
  }

  function metricItems(summary = {}) {
    const critical = Number(summary.urgent || 0);
    const warning = Number(summary.warning || 0);
    return [
      { key: 'urgent', label: 'Critiques', value: critical, tone: critical ? 'critical' : 'neutral' },
      { key: 'warning', label: 'Avertissements', value: warning, tone: warning ? 'warning' : 'neutral' },
      { key: 'total', label: 'Total à traiter', value: Number(summary.total_active || 0), tone: 'neutral' },
    ];
  }

  function actionButton(doc, label, action, signalRef, secondary = true) {
    const button = text(doc, 'button', secondary ? 'kmc-workspace-action is-secondary' : 'kmc-workspace-action', label);
    button.type = 'button';
    button.dataset.actionCenterAction = action;
    button.dataset.signalRef = signalRef;
    return button;
  }

  function severityLabel(severity) {
    return ({ urgent: 'Urgent', critical: 'Critique', warning: 'Attention', info: 'Info' })[severity] || severity || '—';
  }

  // Retour vers l'Action Center (filtres conservés) depuis les fiches 360 et les PO.
  function withReturn(href) {
    const nav = globalThis.KomerceCanonicalNavigation;
    const loc = globalThis.location;
    if (!nav || typeof nav.withEntityReturnTo !== 'function' || !loc) return href;
    return nav.withEntityReturnTo(href, `${loc.pathname || '/admin/action-center'}${loc.search || ''}`, 'Retour à À traiter');
  }

  function ageLabel(value, now = Date.now()) {
    const t = Date.parse(value);
    if (!Number.isFinite(t)) return '';
    const minutes = Math.max(0, Math.round((now - t) / 60000));
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
    return `${Math.round(minutes / 1440)} j`;
  }

  function renderSignal(doc, row) {
    const card = doc.createElement('article');
    const severity = ['urgent', 'critical', 'warning', 'info'].includes(String(row.severity || '').toLowerCase())
      ? String(row.severity).toLowerCase()
      : 'info';
    card.className = `kmc-action-signal is-${severity}`;
    card.dataset.signalRef = row.signal_ref;
    card.dataset.severity = severity;

    const refLabel = (row.entity && (row.entity.ref || row.entity.label)) || row.signal_ref;
    const top = doc.createElement('div');
    top.className = 'kmc-action-signal-top';
    top.appendChild(text(doc, 'strong', 'kmc-action-signal-ref', refLabel));
    top.appendChild(text(doc, 'span', 'kmc-action-signal-domain', FAMILY_LABELS[row.family] || ''));
    const age = ageLabel(row.created_at);
    if (age) top.appendChild(text(doc, 'span', 'kmc-action-signal-age', age));
    card.appendChild(top);

    card.appendChild(text(doc, 'p', 'kmc-action-signal-cause', row.summary || row.title));
    if (row.recommendation) card.appendChild(text(doc, 'p', 'kmc-action-signal-next', `Prochaine action · ${row.recommendation}`));

    const bar = doc.createElement('div');
    bar.className = 'kmc-action-signal-bar';
    if (row.work_item && row.work_item.actionable && row.work_item.href) {
      const work = text(doc, 'a', 'kmc-workspace-action', 'Traiter');
      work.href = withReturn(row.work_item.href);
      work.dataset.actionCenterWorkItem = row.signal_ref;
      bar.appendChild(work);
    } else if (row.entity && row.entity.href) {
      const link = text(doc, 'a', 'kmc-workspace-action', 'Traiter');
      link.href = withReturn(row.entity.href);
      bar.appendChild(link);
    }
    const allowed = new Set(row.actions || []);
    if (allowed.size) {
      const more = doc.createElement('details');
      more.className = 'kmc-action-signal-more';
      more.appendChild(text(doc, 'summary', '', '⋯'));
      const actions = doc.createElement('div');
      actions.className = 'kmc-workspace-nav';
      if (allowed.has('acknowledge')) actions.appendChild(actionButton(doc, 'Vu', 'acknowledge', row.signal_ref));
      if (allowed.has('snooze')) actions.appendChild(actionButton(doc, 'Reporter 24 h', 'snooze', row.signal_ref));
      if (allowed.has('resolve')) actions.appendChild(actionButton(doc, 'Résolu', 'resolve', row.signal_ref, false));
      more.appendChild(actions);
      bar.appendChild(more);
    }
    card.appendChild(bar);
    return card;
  }

  // Regroupe les incidents de même nature sans masquer les dossiers : le groupe se déplie.
  function renderSignalGroups(doc, host, rows) {
    const groups = new Map();
    rows.forEach(row => {
      const key = `${row.family || 'other'}|${row.title}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    groups.forEach(list => {
      if (list.length === 1) { host.appendChild(renderSignal(doc, list[0])); return; }
      const details = doc.createElement('details');
      details.className = 'kmc-action-group';
      const head = doc.createElement('summary');
      head.appendChild(text(doc, 'strong', '', `${list[0].title} · ${list.length}`));
      head.appendChild(text(doc, 'span', 'kmc-action-signal-domain', FAMILY_LABELS[list[0].family] || ''));
      details.appendChild(head);
      list.forEach(row => details.appendChild(renderSignal(doc, row)));
      host.appendChild(details);
    });
  }

  function renderAgentSignals(rootNode, ui, doc, payload) {
    const rows = payload.signals || [];
    const section = ui.Section.create({
      title: rows.length ? `Signaux de mon périmètre · ${rows.length}` : 'Aucun signal actif',
      description: rows.length
        ? 'Traitez uniquement ce qui demande votre intervention.'
        : 'Aucune décision n’est actuellement requise dans votre périmètre.',
    });
    rows.forEach(row => section.slot.appendChild(renderSignal(doc, row)));
    rootNode.appendChild(section.element);
  }

  function renderFamilies(rootNode, ui, doc, payload, state = {}) {
    const all = payload.signals || [];
    const domain = state.domain || '';
    const rows = all.filter(signal => !domain || (signal.family || 'other') === domain);

    const bar = doc.createElement('div');
    bar.className = 'kmc-action-filters';
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'Filtrer par domaine');
    select.dataset.actionCenterDomain = '';
    [['', 'Tous les domaines'], ...Object.entries(FAMILY_LABELS)].forEach(([value, label]) => {
      const option = text(doc, 'option', '', label);
      option.value = value;
      if (value === domain) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => { if (state.onDomain) state.onDomain(select.value); });
    bar.appendChild(select);
    const markets = state.markets || [];
    if (markets.length > 1) {
      const market = doc.createElement('select');
      market.setAttribute('aria-label', 'Filtrer par marché');
      market.dataset.actionCenterMarket = '';
      [['', 'Tous les marchés'], ...markets.map(code => [code, code])].forEach(([value, label]) => {
        const option = text(doc, 'option', '', label);
        option.value = value;
        if (value === (state.market || '')) option.selected = true;
        market.appendChild(option);
      });
      market.addEventListener('change', () => { if (state.onMarket) state.onMarket(market.value); });
      bar.appendChild(market);
    }
    bar.appendChild(text(doc, 'span', 'kmc-action-signal-age', 'Se ferme automatiquement quand la cause disparaît.'));
    rootNode.appendChild(bar);

    const grid = doc.createElement('div');
    grid.className = 'kmc-action-columns';
    const columns = [
      ['Urgent / critique', signal => ['urgent', 'critical'].includes(String(signal.severity).toLowerCase()), 'critical'],
      ['Avertissements', signal => !['urgent', 'critical'].includes(String(signal.severity).toLowerCase()), 'warning'],
    ];
    columns.forEach(([title, pick, tone]) => {
      const list = rows.filter(pick);
      const col = doc.createElement('section');
      col.className = `kmc-action-column is-${tone}`;
      col.appendChild(text(doc, 'h2', 'kmc-action-column-title', `${title} · ${list.length}`));
      if (!list.length) col.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Rien à traiter.'));
      else renderSignalGroups(doc, col, list);
      grid.appendChild(col);
    });
    rootNode.appendChild(grid);
  }

  async function runAction(context, button, path, body, successMessage) {
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, path, { method: 'POST', body: body || {} });
      setFeedback(context.root, successMessage, 'positive');
      await context.reload();
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    }
  }

  function bind(rootNode, context) {
    rootNode.addEventListener('click', async event => {
      const button = event.target.closest('[data-action-center-action]');
      if (!button) return;
      const action = button.dataset.actionCenterAction;
      const signalRef = button.dataset.signalRef;

      if (action === 'generate') {
        if (context.scopeMode !== 'global') return;
        await runAction(context, button, `${ENDPOINT}/generate`, {}, 'Signaux régénérés.');
        return;
      }
      if (!signalRef) return;
      const signalPath = context.scopeMode === 'agent'
        ? `${context.endpoint}/${encodeURIComponent(signalRef)}`
        : `${context.endpoint}/signals/${encodeURIComponent(signalRef)}`;
      if (action === 'acknowledge') {
        await runAction(context, button, `${signalPath}/acknowledge`, {}, 'Signal acquitté.');
      }
      if (action === 'snooze') {
        await runAction(context, button, `${signalPath}/snooze`, { hours: 24 }, 'Signal reporté de 24 h.');
      }
      if (action === 'resolve') {
        const ask = context.prompt || (typeof globalThis.prompt === 'function' ? globalThis.prompt.bind(globalThis) : null);
        const note = ask ? String(ask('Preuve de résolution (obligatoire) : qu’est-ce qui a été fait ?', '') || '').trim() : '';
        if (note.length < 3) {
          setFeedback(context.root, 'Une note de résolution est obligatoire pour clore ce signal.', 'critical');
          return;
        }
        await runAction(context, button, `${signalPath}/resolve`, { note }, 'Signal résolu.');
      }
    });
  }

  async function mount(options) {
    const runtime = isAgentUser(options.user)
      ? { mode: 'agent', marketCode: null, severity: null, endpoint: AGENT_ENDPOINT, loadEndpoint: AGENT_ENDPOINT }
      : await resolveRuntimeScope(options);
    const context = {
      root: options.root,
      user: options.user,
      document: options.document,
      fetch: options.fetch,
      ui: options.ui,
      endpoint: runtime.endpoint,
      loadEndpoint: runtime.loadEndpoint,
      severity: runtime.severity,
      scopeMode: runtime.mode,
      marketCode: runtime.marketCode,
      adminContext: runtime.adminContext || null,
      domain: '',
      reload: null,
    };

    async function load() {
      const payload = await jsonRequest(context.fetch, context.loadEndpoint);
      const rootNode = context.root;
      rootNode.replaceChildren();
      rootNode.classList.add('kmc-action-center');
      rootNode.dataset.actionCenterMode = context.scopeMode;
      rootNode.appendChild(header(context.document, payload, context.severity));
      rootNode.appendChild(context.ui.KpiStrip.create(metricItems(payload.summary)).element);
      if (context.scopeMode === 'agent') {
        renderAgentSignals(rootNode, context.ui, context.document, payload);
        bind(rootNode, context);
        return payload;
      }



      const markets = ((context.adminContext && context.adminContext.access && context.adminContext.access.allowedMarkets) || []).map(String);
      renderFamilies(rootNode, context.ui, context.document, payload, {
        domain: context.domain || '',
        markets: context.scopeMode === 'global' ? markets : [],
        market: context.marketCode || '',
        onDomain: value => { context.domain = value; load(); },
        onMarket: value => {
          const loc = globalThis.location;
          if (loc) loc.href = value ? `/admin/action-center?market=${encodeURIComponent(value)}` : '/admin/action-center';
        },
      });
      bind(rootNode, context);
      return payload;
    }

    context.reload = load;
    return load();
  }

  return {
    ENDPOINT,
    AGENT_ENDPOINT,
    CONTEXT_ENDPOINT,
    isAgentUser,
    mount,
    jsonRequest,
    metricItems,
    severityLabel,
    selectedMarketCode,
    resolveRuntimeScope,
  };
});
