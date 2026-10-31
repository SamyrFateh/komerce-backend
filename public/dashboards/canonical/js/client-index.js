/**
 * @komerce-arch
 * @role          canonical-client-index
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context, requested_market_view, client_search, client_sort, pagination
 * @outputs       canonical_client_navigation_surface
 * @depends       admin-context, primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_admin_no_legacy_imports, server_market_scope_is_authority, client_index_finds_client_360, dashboard_no_business_recompute
 * @impact-areas  admin-dashboard, clients, commerce, market-authorization
 * @version       2026-08
 */

'use strict';

(function initCanonicalClientIndex(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalClientIndex = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalClientIndex() {
  const GLOBAL_ENDPOINT = '/api/admin/entities/clients';

  function contextualHref(path, returnTo, label) {
    const nav = globalThis.KomerceCanonicalNavigation;
    return nav && typeof nav.withReturnTo === 'function'
      ? nav.withReturnTo(path, returnTo, label)
      : path;
  }

  function clientHref(phone) {
    const loc = globalThis.location;
    const fromList = loc?.pathname === '/admin/clients'
      ? `${loc.pathname}${loc.search || ''}` : '/admin/clients';
    return contextualHref(`/admin/clients/${encodeURIComponent(phone)}`, fromList, 'Retour aux clients');
  }
  // GAP 3 / LOT A (A3) : le endpoint marché legacy (/api/admin/entities/clients/market/:code,
  // gated requireAdmin) est remplacé par le endpoint DELEGATION
  // (/api/market-delegation/markets/:marketCode/clients, gated
  // requireMarketDelegatedCapability('client.read')) — capability is the
  // authority, not role.
  const MARKET_ENDPOINT_PREFIX = '/api/market-delegation/markets/';
  const MARKET_ENDPOINT_SUFFIX = '/clients';
  const SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'recent', label: 'Plus récents' }),
    Object.freeze({ value: 'ltv', label: 'Valeur client' }),
    Object.freeze({ value: 'orders', label: 'Nombre de commandes' }),
  ]);

  function initialListState(search) {
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const sort = q.get('sort') || 'recent';
    const rawPage = Number(q.get('page'));
    return {
      search: String(q.get('search') || '').trim().slice(0, 120),
      sort: SORT_OPTIONS.some(item => item.value === sort) ? sort : 'recent',
      page: Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 10000 ? rawPage : 1,
      page_size: 25,
    };
  }

  function reflectListState(state) {
    const loc = globalThis.location;
    const history = globalThis.history;
    if (!loc || loc.pathname !== '/admin/clients' || !history || typeof history.replaceState !== 'function') return;
    const q = new URLSearchParams(String(loc.search || '').replace(/^\?/, ''));
    if (state.search) q.set('search', state.search);
    else q.delete('search');
    if (state.sort !== 'recent') q.set('sort', state.sort);
    else q.delete('sort');
    if (state.page !== 1) q.set('page', String(state.page));
    else q.delete('page');
    const query = q.toString();
    history.replaceState(history.state, '', loc.pathname + (query ? `?${query}` : '') + (loc.hash || ''));
  }

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_client_index_admin_context_contract_missing');
    }
    const view = contextContract.resolveMarketView(adminContext, requestedMarket);
    return view.mode === 'global'
      ? GLOBAL_ENDPOINT
      : MARKET_ENDPOINT_PREFIX + encodeURIComponent(view.marketCode) + MARKET_ENDPOINT_SUFFIX;
  }

  function buildQueryUrl(endpoint, state = {}) {
    const params = new URLSearchParams();
    const search = String(state.search || '').trim();
    if (search) params.set('search', search);
    params.set('sort', String(state.sort || 'recent'));
    params.set('page', String(state.page || 1));
    params.set('page_size', String(state.page_size || 25));
    // L2 : périmètre de recette explicite (?simulation_scope=RCT1), transmis tel quel au serveur.
    const scope = new URLSearchParams(String((globalThis.location && globalThis.location.search) || '')).get('simulation_scope');
    if (scope && /^[A-Z][A-Z0-9-]{1,31}$/.test(scope)) params.set('simulation_scope', scope);
    return `${endpoint}?${params.toString()}`;
  }

  function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) : '—';
  }

  function formatKmf(value) {
    return `${formatNumber(value)} KMF`;
  }

  // L12a : coordonnées masquées par défaut. La permission client.read est
  // vérifiée par l'API ; le bouton ne modifie aucune habilitation.
  function maskPhone(value) {
    const phone = String(value || '');
    return phone ? `•••• ${phone.slice(-4)}` : '—';
  }

  function createPhoneCell(doc, phone) {
    const cell = doc.createElement('td');
    const label = text(doc, 'span', 'kmc-client-phone-masked', maskPhone(phone));
    cell.appendChild(label);
    if (!phone) return cell;

    let revealed = false;
    const button = text(doc, 'button', 'kmc-entity-nav-link', 'Afficher');
    button.type = 'button';
    button.setAttribute('aria-label', 'Afficher ou masquer le téléphone');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      revealed = !revealed;
      label.textContent = revealed ? String(phone) : maskPhone(phone);
      button.textContent = revealed ? 'Masquer' : 'Afficher';
      button.setAttribute('aria-expanded', String(revealed));
    });
    cell.appendChild(button);
    return cell;
  }

  // L3 : fuseau métier du serveur (marché de l'objet), jamais celui du navigateur.
  let activeTimezone = null;
  function formatDate(value, timezone) {
    return globalThis.KomerceBusinessDate
      ? globalThis.KomerceBusinessDate.formatBusinessDate(value, timezone || activeTimezone, { time: false })
      : (value ? String(value).slice(0, 10) : '—');
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function jsonRequest(fetchFn, url) {
    return fetchFn(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
      return body;
    });
  }

  function createHeader(doc) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'CLIENTS'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Trouver un client'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Recherche et navigation vers Client 360. Les analyses commerciales restent dans Commerce.'));

    header.appendChild(copy);
    return header;
  }

  function createFilterForm(doc, state, onSubmit) {
    const form = doc.createElement('form');
    form.className = 'kmc-filter-bar';
    form.setAttribute('data-client-index-filters', '');

    const searchLabel = doc.createElement('label');
    searchLabel.className = 'kmc-filter-field';
    searchLabel.appendChild(text(doc, 'span', 'kmc-filter-label', 'Client'));
    const search = doc.createElement('input');
    search.className = 'kmc-filter-control';
    search.type = 'search';
    search.name = 'search';
    search.placeholder = 'Nom ou téléphone';
    search.value = state.search;
    searchLabel.appendChild(search);
    form.appendChild(searchLabel);

    const sortLabel = doc.createElement('label');
    sortLabel.className = 'kmc-filter-field';
    sortLabel.appendChild(text(doc, 'span', 'kmc-filter-label', 'Trier par'));
    const sort = doc.createElement('select');
    sort.className = 'kmc-filter-control';
    sort.name = 'sort';
    SORT_OPTIONS.forEach(option => {
      const node = doc.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      node.selected = option.value === state.sort;
      sort.appendChild(node);
    });
    sortLabel.appendChild(sort);
    form.appendChild(sortLabel);

    const submit = text(doc, 'button', 'kmc-entity-nav-link', 'Rechercher');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', event => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      onSubmit({ search: search.value, sort: sort.value });
    });
    return form;
  }

  function renderClientTable(container, doc, payload) {
    container.replaceChildren();
    if (payload && payload.simulation && payload.simulation.label) {
      const note = doc.createElement('p');
      note.className = 'kmc-recette-banner';
      note.setAttribute('role', 'status');
      note.textContent = payload.simulation.label;
      container.appendChild(note);
    }
    const rows = Array.isArray(payload && payload.clients) ? payload.clients : [];
    if (!rows.length) return null;

    const wrap = doc.createElement('div');
    wrap.className = 'kmc-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-data-table';
    const thead = doc.createElement('thead');
    const header = doc.createElement('tr');
    ['Client', 'Téléphone', 'Commandes', 'Valeur client', 'Panier moyen', 'Dernière commande', 'Marchés', 'Dossier'].forEach(label => {
      const th = text(doc, 'th', '', label);
      th.setAttribute('scope', 'col');
      header.appendChild(th);
    });
    thead.appendChild(header);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(text(doc, 'td', '', row.name || '—'));
      tr.appendChild(createPhoneCell(doc, row.phone));
      [
        formatNumber(row.orders_valid),
        formatKmf(row.ltv_kmf),
        formatKmf(row.average_basket_kmf),
        formatDate(row.last_order_at, row.business_timezone),
        Array.isArray(row.markets) && row.markets.length ? row.markets.join(' · ') : '—',
      ].forEach(value => tr.appendChild(text(doc, 'td', '', value)));
      const actionCell = doc.createElement('td');
      if (row.phone) {
        const link = text(doc, 'a', 'kmc-entity-360-action', 'Voir 360');
        link.setAttribute('href', clientHref(row.phone));
        link.setAttribute('aria-label', `Voir 360 · client ${row.name || 'sans nom'}`);
        actionCell.appendChild(link);
      }
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    return table;
  }

  function renderPagination(container, doc, pagination, onPage) {
    const totalPages = Number(pagination && pagination.total_pages) || 0;
    const page = Number(pagination && pagination.page) || 1;
    if (totalPages <= 1) return null;
    const nav = doc.createElement('nav');
    nav.className = 'kmc-entity-nav';
    nav.setAttribute('aria-label', 'Pagination clients');

    const makeButton = (label, target, disabled) => {
      const button = text(doc, 'button', 'kmc-entity-nav-link', label);
      button.type = 'button';
      button.disabled = disabled;
      button.addEventListener('click', () => onPage(target));
      return button;
    };
    nav.appendChild(makeButton('← Précédent', page - 1, page <= 1));
    nav.appendChild(text(doc, 'span', 'kmc-entity-subtitle', `Page ${page} / ${totalPages}`));
    nav.appendChild(makeButton('Suivant →', page + 1, page >= totalPages));
    container.appendChild(nav);
    return nav;
  }

  function mount(options) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode) throw new Error('canonical_client_index_root_missing');
    if (!doc || !ui || !ui.Section || !ui.UIState) throw new Error('canonical_client_index_ui_missing');

    const endpoint = endpointForContext(options.adminContext, options.contextContract, options.requestedMarket);
    const state = initialListState(globalThis.location?.search);
    rootNode.className = 'kmc-client-index';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc));

    const filters = ui.Section.create({
      title: 'Recherche',
      description: 'La sélection de marché est résolue et autorisée côté serveur avant toute lecture.',
    });
    rootNode.appendChild(filters.element);

    const results = ui.Section.create({
      title: 'Clients visibles',
      description: 'Aucun segment métier n’est recalculé ici : cette surface sert uniquement à trouver et ouvrir Client 360.',
    });
    rootNode.appendChild(results.element);

    async function load(next = {}) {
      if (Object.prototype.hasOwnProperty.call(next, 'search')) state.search = String(next.search || '').trim();
      if (Object.prototype.hasOwnProperty.call(next, 'sort')) state.sort = String(next.sort || 'recent');
      if (Object.prototype.hasOwnProperty.call(next, 'page')) state.page = Math.max(1, Number(next.page) || 1);

      filters.slot.replaceChildren(createFilterForm(doc, state, values => {
        load({ ...values, page: 1 }).catch(() => {});
      }));
      ui.UIState.render(results.slot, 'loading', 'Chargement des clients…');

      try {
        const payload = await jsonRequest(fetchFn, buildQueryUrl(endpoint, state));
        reflectListState(state);
        if (!Array.isArray(payload.clients) || !payload.clients.length) {
          ui.UIState.render(results.slot, 'empty', 'Aucun client visible dans ce périmètre.');
        } else {
          renderClientTable(results.slot, doc, payload);
          renderPagination(results.slot, doc, payload.pagination, page => load({ page }).catch(() => {}));
        }
        return Object.freeze({ payload, endpoint, state: Object.freeze({ ...state }) });
      } catch (error) {
        ui.UIState.render(results.slot, 'error', error.message);
        throw error;
      }
    }

    return load();
  }

  return Object.freeze({
    GLOBAL_ENDPOINT,
    MARKET_ENDPOINT_PREFIX,
    SORT_OPTIONS,
    endpointForContext,
    buildQueryUrl,
    formatNumber,
    formatKmf,
    maskPhone,
    createPhoneCell,
    formatDate,
    jsonRequest,
    createHeader,
    createFilterForm,
    renderClientTable,
    renderPagination,
    clientHref,
    initialListState,
    reflectListState,
    mount,
  });
});
