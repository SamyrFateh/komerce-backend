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
  const MARKET_ENDPOINT_PREFIX = '/api/admin/entities/clients/market/';
  const SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'recent', label: 'Plus récents' }),
    Object.freeze({ value: 'ltv', label: 'Valeur client' }),
    Object.freeze({ value: 'orders', label: 'Nombre de commandes' }),
  ]);

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_client_index_admin_context_contract_missing');
    }
    const view = contextContract.resolveMarketView(adminContext, requestedMarket);
    return view.mode === 'global'
      ? GLOBAL_ENDPOINT
      : MARKET_ENDPOINT_PREFIX + encodeURIComponent(view.marketCode);
  }

  function buildQueryUrl(endpoint, state = {}) {
    const params = new URLSearchParams();
    const search = String(state.search || '').trim();
    if (search) params.set('search', search);
    params.set('sort', String(state.sort || 'recent'));
    params.set('page', String(state.page || 1));
    params.set('page_size', String(state.page_size || 25));
    return `${endpoint}?${params.toString()}`;
  }

  function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) : '—';
  }

  function formatKmf(value) {
    return `${formatNumber(value)} KMF`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' }).format(date);
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
    header.className = 'kmc-entity-header';
    header.appendChild(text(doc, 'span', 'kmc-entity-kicker', 'CLIENTS'));
    header.appendChild(text(doc, 'h1', 'kmc-entity-title', 'Trouver un client'));
    header.appendChild(text(doc, 'p', 'kmc-entity-subtitle', 'Recherche et navigation vers Client 360. Les analyses commerciales restent dans Commerce.'));

    const nav = doc.createElement('nav');
    nav.className = 'kmc-entity-nav';
    [['/admin/commerce', 'Commerce'], ['/admin/pilotage', 'Pilotage']].forEach(([href, label]) => {
      const link = text(doc, 'a', 'kmc-entity-nav-link', label);
      link.setAttribute('href', href);
      nav.appendChild(link);
    });
    header.appendChild(nav);
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
    const rows = Array.isArray(payload && payload.clients) ? payload.clients : [];
    if (!rows.length) return null;

    const wrap = doc.createElement('div');
    wrap.className = 'kmc-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-data-table';
    const thead = doc.createElement('thead');
    const header = doc.createElement('tr');
    ['Client', 'Téléphone', 'Commandes', 'Valeur client', 'Panier moyen', 'Dernière commande', 'Marchés', ''].forEach(label => {
      const th = text(doc, 'th', '', label);
      th.setAttribute('scope', 'col');
      header.appendChild(th);
    });
    thead.appendChild(header);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      [
        row.name || '—',
        row.phone || '—',
        formatNumber(row.orders_valid),
        formatKmf(row.ltv_kmf),
        formatKmf(row.average_basket_kmf),
        formatDate(row.last_order_at),
        Array.isArray(row.markets) && row.markets.length ? row.markets.join(' · ') : '—',
      ].forEach(value => tr.appendChild(text(doc, 'td', '', value)));
      const actionCell = doc.createElement('td');
      const link = text(doc, 'a', 'kmc-entity-nav-link', 'Client 360');
      link.setAttribute('href', `/admin/clients/${encodeURIComponent(row.phone)}`);
      actionCell.appendChild(link);
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
    const state = { search: '', sort: 'recent', page: 1, page_size: 25 };
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
    formatDate,
    jsonRequest,
    createHeader,
    createFilterForm,
    renderClientTable,
    renderPagination,
    mount,
  });
});
