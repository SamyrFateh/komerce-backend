from pathlib import Path


def write(path, content):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_ANCHOR_MISSING {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


write('services/client-index.js', r'''/**
 * @komerce-arch
 * @role          canonical-client-index-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        client_search, client_sort, pagination, server_market_scope
 * @outputs       canonical_client_index_projection
 * @depends       db
 * @used-by       routes/admin-client-index.js
 * @db-read       orders, users, recipients, markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, server_market_scope_is_authority, client_index_finds_client_360
 * @impact-areas  admin-dashboard, clients, commerce, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const SORTS = Object.freeze({
  recent: 'last_order_at DESC, phone ASC',
  ltv: 'ltv_kmf DESC, last_order_at DESC, phone ASC',
  orders: 'orders_valid DESC, last_order_at DESC, phone ASC',
});

function normalizeSearch(value) {
  return String(value || '').trim().slice(0, 80);
}

function normalizePage(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePageSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return PAGE_SIZE_DEFAULT;
  return Math.min(parsed, PAGE_SIZE_MAX);
}

function normalizeSort(value) {
  const key = String(value || 'recent');
  return Object.prototype.hasOwnProperty.call(SORTS, key) ? key : 'recent';
}

function scopeFilter(marketIds, startIndex) {
  if (marketIds === null) return { sql: '', params: [] };
  if (!Array.isArray(marketIds) || marketIds.length === 0) {
    return { sql: ' AND FALSE', params: [] };
  }
  return {
    sql: ` AND o.market_id = ANY($${startIndex}::uuid[])`,
    params: [marketIds],
  };
}

function publicScope(marketIds, market) {
  const mode = marketIds === null ? 'global' : 'market';
  return Object.freeze({
    mode,
    market: market ? Object.freeze({
      code: market.code,
      name: market.name,
      currency: market.currency,
    }) : null,
  });
}

async function listClients(query = {}, options = {}) {
  const page = normalizePage(query.page);
  const pageSize = normalizePageSize(query.page_size);
  const sort = normalizeSort(query.sort);
  const search = normalizeSearch(query.search);
  const marketIds = options.marketIds === undefined ? null : options.marketIds;
  const market = options.market || null;
  const offset = (page - 1) * pageSize;

  const params = [];
  const scoped = scopeFilter(marketIds, params.length + 1);
  params.push(...scoped.params);

  let searchSql = '';
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const idx = params.length;
    searchSql = `WHERE LOWER(COALESCE(name, '')) LIKE $${idx} OR LOWER(phone) LIKE $${idx}`;
  }

  params.push(pageSize);
  const limitIndex = params.length;
  params.push(offset);
  const offsetIndex = params.length;

  const { rows } = await db.query(`
    WITH scoped_orders AS (
      SELECT
        regexp_replace(COALESCE(u.phone, r.phone, ''), '[^0-9+]', '', 'g') AS phone,
        COALESCE(u.full_name, r.full_name) AS name,
        o.total_kmf,
        o.status::text AS status,
        o.created_at,
        m.code AS market_code
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
      LEFT JOIN markets m ON m.id = o.market_id
      WHERE regexp_replace(COALESCE(u.phone, r.phone, ''), '[^0-9+]', '', 'g') <> ''
        ${scoped.sql}
    ), client_agg AS (
      SELECT
        phone,
        MAX(name) AS name,
        COUNT(*)::int AS orders_total,
        COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded'))::int AS orders_valid,
        COALESCE(SUM(total_kmf) FILTER (WHERE status NOT IN ('cancelled', 'refunded')), 0)::bigint AS ltv_kmf,
        COALESCE(AVG(total_kmf) FILTER (WHERE status NOT IN ('cancelled', 'refunded')), 0)::bigint AS average_basket_kmf,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at,
        EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS days_since_last_order,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT market_code), NULL) AS markets
      FROM scoped_orders
      GROUP BY phone
    ), filtered AS (
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM client_agg
      ${searchSql}
    )
    SELECT *
    FROM filtered
    ORDER BY ${SORTS[sort]}
    LIMIT $${limitIndex} OFFSET $${offsetIndex}
  `, params);

  const total = rows.length ? Number(rows[0].total_count) || 0 : 0;
  const clients = rows.map(row => Object.freeze({
    name: row.name || null,
    phone: row.phone,
    orders_total: Number(row.orders_total) || 0,
    orders_valid: Number(row.orders_valid) || 0,
    ltv_kmf: Number(row.ltv_kmf) || 0,
    average_basket_kmf: Number(row.average_basket_kmf) || 0,
    first_order_at: row.first_order_at || null,
    last_order_at: row.last_order_at || null,
    days_since_last_order: row.days_since_last_order == null ? null : Number(row.days_since_last_order),
    markets: Object.freeze(Array.isArray(row.markets) ? row.markets.filter(Boolean) : []),
  }));

  return Object.freeze({
    scope: publicScope(marketIds, market),
    query: Object.freeze({ search, sort }),
    pagination: Object.freeze({
      page,
      page_size: pageSize,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
    }),
    clients: Object.freeze(clients),
    data_quality: Object.freeze({
      generated_at: new Date(options.now || Date.now()).toISOString(),
      scope_enforced: true,
      scope_mode: marketIds === null ? 'global' : 'market',
      source_tables: Object.freeze(['orders', 'users', 'recipients', 'markets']),
    }),
  });
}

module.exports = {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  SORTS,
  normalizeSearch,
  normalizePage,
  normalizePageSize,
  normalizeSort,
  scopeFilter,
  publicScope,
  listClients,
};
''')

write('routes/admin-client-index.js', r'''/**
 * @komerce-arch
 * @role          canonical-client-index-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, requested_market_code, client_search, client_sort, pagination
 * @outputs       authorized_client_index_projection
 * @depends       db, middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/client-index
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes, dashboard_global_access_grants, orders, users, recipients
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority, server_global_context_explicit, client_index_finds_client_360
 * @impact-areas  admin-dashboard, clients, market-authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachAuthorizedMarkets, requireMarketScope } = require('../middleware/require-market-scope');
const {
  hasDashboardGlobalAuthority,
  requireDashboardGlobalAuthority,
} = require('../middleware/require-dashboard-global-authority');
const clientIndex = require('../services/client-index');
const log = require('../utils/logger').child({ module: 'admin-client-index' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;

function rejectClientMarketIdentity(req, res, next) {
  const query = req.query || {};
  if (Object.prototype.hasOwnProperty.call(query, 'market_id') ||
      Object.prototype.hasOwnProperty.call(query, 'marketId')) {
    return res.status(400).json({
      error: 'Identifiant marché client interdit — utilisez le code marché de la route',
      code: 'client_market_identity_forbidden',
    });
  }
  return next();
}

function queryFor(req) {
  return {
    search: req.query.search || '',
    sort: req.query.sort || 'recent',
    page: req.query.page || '1',
    page_size: req.query.page_size || '25',
  };
}

async function resolveRequestedMarket(req, res, next) {
  const code = String(req.params.marketCode || '').trim().toUpperCase();
  if (!MARKET_CODE.test(code)) {
    return res.status(400).json({ error: 'Code marché invalide', code: 'invalid_market_code' });
  }
  try {
    const { rows } = await db.query(
      `SELECT id, code, name, currency
       FROM markets
       WHERE code = $1 AND is_active = TRUE
       LIMIT 1`,
      [code]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Marché introuvable ou inactif', code: 'market_not_found' });
    }
    req.clientIndexMarket = rows[0];
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireClientIndexMarketRead(req, res, next) {
  const targetMarketId = req.clientIndexMarket && req.clientIndexMarket.id;
  const marketGuard = requireMarketScope(() => targetMarketId);

  if (req.authorizedMarkets && req.authorizedMarkets.has(targetMarketId)) {
    return marketGuard(req, res, next);
  }

  return hasDashboardGlobalAuthority(req.user && req.user.id)
    .then(globalAllowed => globalAllowed ? next() : marketGuard(req, res, next))
    .catch(next);
}

async function marketHandler(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const payload = await clientIndex.listClients(queryFor(req), {
      marketIds: [req.clientIndexMarket.id],
      market: req.clientIndexMarket,
    });
    return res.json(payload);
  } catch (err) {
    log.error({ err, market: req.clientIndexMarket && req.clientIndexMarket.code }, '[admin-client-index] market read failed');
    return next(err);
  }
}

async function globalHandler(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const payload = await clientIndex.listClients(queryFor(req), { marketIds: null });
    return res.json(payload);
  } catch (err) {
    log.error({ err }, '[admin-client-index] global read failed');
    return next(err);
  }
}

router.get(
  '/clients/market/:marketCode',
  authenticate,
  requireAdmin,
  rejectClientMarketIdentity,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireClientIndexMarketRead,
  marketHandler
);

router.get(
  '/clients',
  authenticate,
  requireAdmin,
  rejectClientMarketIdentity,
  requireDashboardGlobalAuthority,
  globalHandler
);

module.exports = router;
module.exports._test = {
  MARKET_CODE,
  rejectClientMarketIdentity,
  queryFor,
  resolveRequestedMarket,
  requireClientIndexMarketRead,
  marketHandler,
  globalHandler,
};
''')

write('public/dashboards/canonical/js/client-index.js', r'''/**
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
''')

write('docs/contract/CLIENT_INDEX_4I.md', r'''# LOT 4I — Client Index Canonical

## But

`/admin/clients` devient une surface Canonical de **recherche et navigation** vers Client 360.
Elle ne devient ni un cinquième Overview Dashboard, ni un Workspace métier, ni un CRM.

## Frontière

- **Commerce** analyse la performance et les segments commerciaux.
- **Client Index** trouve un client visible dans le périmètre autorisé.
- **Client 360** explique ce client et ses facettes visibles.

## Autorité

La sécurité est résolue avant lecture côté serveur :

- `GET /api/admin/entities/clients` : autorité dashboard globale explicite obligatoire ;
- `GET /api/admin/entities/clients/market/:marketCode` : marché actif résolu serveur puis `MarketScope` obligatoire, sauf autorité globale explicite ;
- `market_id` et `marketId` fournis par le navigateur sont refusés ;
- aucune UUID de marché, utilisateur ou commande n'est publiée.

## Projection

L'index expose uniquement des observations préparées côté serveur :

- nom et téléphone métier ;
- nombre de commandes ;
- valeur client et panier moyen ;
- première / dernière commande ;
- marchés métier visibles ;
- pagination et tri bornés.

Aucune segmentation VIP / risque / dormant n'est recalculée dans cette surface.

## Cutover

- `/admin/clients` → Canonical ;
- `/admin/clients/:phone` → Client 360 Canonical ;
- `/admin/clients?legacy=1` → rollback Legacy 1 ;
- `/admin-next/clients` → redirection vers `/admin/clients`.

## Vérification

```bash
npx jest tests/unit/client-index-service.test.js tests/unit/admin-client-index-route.test.js tests/unit/canonical-client-index.test.js --runInBand
npm run feature:registry
npm run gate:schema
npm run gate:touched-files
npm run gate:docs-lint
npm run gate:feature-audit
npm run map:check
```
''')

write('tests/unit/client-index-service.test.js', r''''use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const service = require('../../services/client-index');

const MARKET_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => jest.clearAllMocks());

function row(overrides = {}) {
  return {
    name: 'Amina',
    phone: '+2691234567',
    orders_total: 4,
    orders_valid: 3,
    ltv_kmf: 180000,
    average_basket_kmf: 60000,
    first_order_at: '2026-06-01T10:00:00Z',
    last_order_at: '2026-08-20T10:00:00Z',
    days_since_last_order: 8,
    markets: ['KM'],
    total_count: 1,
    ...overrides,
  };
}

test('normalise recherche, pagination et tri dans des bornes fermées', () => {
  expect(service.normalizeSearch('  Amina  ')).toBe('Amina');
  expect(service.normalizeSearch('x'.repeat(100))).toHaveLength(80);
  expect(service.normalizePage('3')).toBe(3);
  expect(service.normalizePage('0')).toBe(1);
  expect(service.normalizePageSize('500')).toBe(100);
  expect(service.normalizePageSize('bad')).toBe(25);
  expect(service.normalizeSort('ltv')).toBe('ltv');
  expect(service.normalizeSort('DROP TABLE')).toBe('recent');
});

test('scopeFilter reste global avec null et échoue fermé sans marché', () => {
  expect(service.scopeFilter(null, 1)).toEqual({ sql: '', params: [] });
  expect(service.scopeFilter([], 1)).toEqual({ sql: ' AND FALSE', params: [] });
  expect(service.scopeFilter([MARKET_ID], 2)).toEqual({
    sql: ' AND o.market_id = ANY($2::uuid[])',
    params: [[MARKET_ID]],
  });
});

test('index marché applique le scope avant agrégation et ne publie aucune UUID', async () => {
  db.query.mockResolvedValue({ rows: [row()] });
  const payload = await service.listClients(
    { search: 'Amina', sort: 'orders', page: 2, page_size: 10 },
    { marketIds: [MARKET_ID], market: { code: 'KM', name: 'Comores', currency: 'KMF' }, now: '2026-08-28T10:00:00Z' }
  );

  const [sql, params] = db.query.mock.calls[0];
  expect(sql).toContain('o.market_id = ANY($1::uuid[])');
  expect(sql).toContain('ORDER BY orders_valid DESC');
  expect(sql).toContain('LOWER(COALESCE(name');
  expect(params).toEqual([[MARKET_ID], '%amina%', 10, 10]);
  expect(payload.scope).toEqual({ mode: 'market', market: { code: 'KM', name: 'Comores', currency: 'KMF' } });
  expect(payload.pagination).toEqual({ page: 2, page_size: 10, total: 1, total_pages: 1 });
  expect(payload.clients[0]).toMatchObject({ phone: '+2691234567', orders_valid: 3, ltv_kmf: 180000, markets: ['KM'] });
  expect(JSON.stringify(payload)).not.toContain(MARKET_ID);
});

test('index global sans résultat garde total_pages à zéro et paramètres strictement bornés', async () => {
  db.query.mockResolvedValue({ rows: [] });
  const payload = await service.listClients({ sort: 'invalid' }, { marketIds: null, now: 0 });

  const [sql, params] = db.query.mock.calls[0];
  expect(sql).not.toContain('market_id = ANY');
  expect(sql).toContain('ORDER BY last_order_at DESC');
  expect(params).toEqual([25, 0]);
  expect(payload.scope).toEqual({ mode: 'global', market: null });
  expect(payload.pagination.total_pages).toBe(0);
  expect(payload.clients).toEqual([]);
});
''')

write('tests/unit/admin-client-index-route.test.js', r''''use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let globalAllowed = false;
let allowedMarkets = new Set(['market-km-id']);

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => { req.authorizedMarkets = new Set(allowedMarkets); next(); },
  requireMarketScope: resolver => (req, res, next) => {
    const id = resolver(req);
    return req.authorizedMarkets && req.authorizedMarkets.has(id)
      ? next()
      : res.status(403).json({ code: 'market_scope_forbidden' });
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => globalAllowed),
  requireDashboardGlobalAuthority: (req, res, next) => globalAllowed
    ? next()
    : res.status(403).json({ code: 'dashboard_global_authority_required' }),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/client-index', () => ({ listClients: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const clientIndex = require('../../services/client-index');
const router = require('../../routes/admin-client-index');

function app() {
  const instance = express();
  instance.use('/api/admin/entities', router);
  instance.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  globalAllowed = false;
  allowedMarkets = new Set(['market-km-id']);
  db.query.mockResolvedValue({ rows: [{ id: 'market-km-id', code: 'KM', name: 'Comores', currency: 'KMF' }] });
  clientIndex.listClients.mockResolvedValue({ clients: [], pagination: { page: 1, total: 0 } });
});

test('route marché résout KM côté serveur puis transmet uniquement son UUID interne au service', async () => {
  const res = await request(app()).get('/api/admin/entities/clients/market/km?search=Amina&sort=ltv&page=2&page_size=10');
  expect(res.status).toBe(200);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM markets'), ['KM']);
  expect(clientIndex.listClients).toHaveBeenCalledWith(
    { search: 'Amina', sort: 'ltv', page: '2', page_size: '10' },
    { marketIds: ['market-km-id'], market: expect.objectContaining({ code: 'KM' }) }
  );
  expect(res.headers['cache-control']).toContain('no-store');
});

test('opérateur sans MarketScope ne peut pas lister un autre marché', async () => {
  allowedMarkets = new Set();
  const res = await request(app()).get('/api/admin/entities/clients/market/KM');
  expect(res.status).toBe(403);
  expect(clientIndex.listClients).not.toHaveBeenCalled();
});

test('autorité globale explicite peut sélectionner un marché sans scope local', async () => {
  allowedMarkets = new Set();
  globalAllowed = true;
  const res = await request(app()).get('/api/admin/entities/clients/market/KM');
  expect(res.status).toBe(200);
  expect(clientIndex.listClients).toHaveBeenCalled();
});

test('index global exige le grant global explicite', async () => {
  let res = await request(app()).get('/api/admin/entities/clients');
  expect(res.status).toBe(403);
  expect(clientIndex.listClients).not.toHaveBeenCalled();

  globalAllowed = true;
  res = await request(app()).get('/api/admin/entities/clients?search=269');
  expect(res.status).toBe(200);
  expect(clientIndex.listClients).toHaveBeenCalledWith(
    { search: '269', sort: 'recent', page: '1', page_size: '25' },
    { marketIds: null }
  );
});

test('market_id navigateur, code invalide et marché inconnu sont refusés avant la lecture clients', async () => {
  let res = await request(app()).get('/api/admin/entities/clients/market/KM?market_id=forged');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('client_market_identity_forbidden');

  res = await request(app()).get('/api/admin/entities/clients/market/KMF');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('invalid_market_code');

  db.query.mockResolvedValueOnce({ rows: [] });
  res = await request(app()).get('/api/admin/entities/clients/market/CG');
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('market_not_found');
  expect(clientIndex.listClients).not.toHaveBeenCalled();
});

test('erreurs DB/service passent au middleware erreur sans fuite de données', async () => {
  db.query.mockRejectedValueOnce(new Error('market db down'));
  let res = await request(app()).get('/api/admin/entities/clients/market/KM');
  expect(res.status).toBe(500);
  expect(res.body.error).toBe('market db down');

  globalAllowed = true;
  clientIndex.listClients.mockRejectedValueOnce(new Error('index down'));
  res = await request(app()).get('/api/admin/entities/clients');
  expect(res.status).toBe(500);
  expect(res.body.error).toBe('index down');
});
''')

write('tests/unit/canonical-client-index.test.js', r''''use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const index = require('../../public/dashboards/canonical/js/client-index.js');

function node(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    children: [],
    textContent: '',
    value: '',
    selected: false,
    disabled: false,
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute: jest.fn(),
    addEventListener: jest.fn(),
  };
}

function doc() {
  return { createElement: jest.fn(tag => node(tag)) };
}

function ui() {
  return {
    UIState: { render: jest.fn((container) => container.replaceChildren(node('state'))) },
    Section: { create: jest.fn(() => ({ element: node('section'), slot: node('div') })) },
  };
}

function context(mode = 'global') {
  return {
    resolveMarketView: jest.fn(() => mode === 'global'
      ? { mode: 'global', marketCode: null }
      : { mode: 'market', marketCode: 'KM' }),
  };
}

test('endpointForContext choisit global ou route marché sans market_id navigateur', () => {
  expect(index.endpointForContext({}, context('global'))).toBe('/api/admin/entities/clients');
  expect(index.endpointForContext({}, context('market'), 'KM')).toBe('/api/admin/entities/clients/market/KM');
  expect(() => index.endpointForContext({}, null)).toThrow('canonical_client_index_admin_context_contract_missing');
});

test('buildQueryUrl encode recherche, tri et pagination et les formatters restent présentationnels', () => {
  expect(index.buildQueryUrl('/clients', { search: 'Amina +269', sort: 'ltv', page: 2, page_size: 10 }))
    .toBe('/clients?search=Amina+%2B269&sort=ltv&page=2&page_size=10');
  expect(index.formatKmf(12500)).toContain('KMF');
  expect(index.formatNumber('bad')).toBe('—');
  expect(index.formatDate(null)).toBe('—');
});

test('renderClientTable produit un drill Client 360 sur le téléphone métier', () => {
  const document = doc();
  const container = node();
  const table = index.renderClientTable(container, document, {
    clients: [{
      name: 'Amina', phone: '+2691234567', orders_valid: 2, ltv_kmf: 120000,
      average_basket_kmf: 60000, last_order_at: '2026-08-20T10:00:00Z', markets: ['KM'],
    }],
  });
  expect(table).not.toBeNull();
  const all = [];
  (function walk(n) { all.push(n); (n.children || []).forEach(walk); })(container);
  const link = all.find(n => n.tagName === 'A' && n.textContent === 'Client 360');
  expect(link.setAttribute).toHaveBeenCalledWith('href', '/admin/clients/%2B2691234567');
  expect(index.renderClientTable(container, document, { clients: [] })).toBeNull();
});

test('mount charge la projection serveur et affiche la table sans segmentation locale', async () => {
  const root = node();
  const document = doc();
  const fakeUi = ui();
  const fetchFn = jest.fn(async url => ({
    ok: true,
    status: 200,
    json: async () => ({
      clients: [{ name: 'Amina', phone: '+2691234567', orders_valid: 1, ltv_kmf: 50000, average_basket_kmf: 50000, markets: ['KM'] }],
      pagination: { page: 1, total_pages: 1 },
    }),
    url,
  }));

  const result = await index.mount({
    root,
    document,
    ui: fakeUi,
    fetch: fetchFn,
    adminContext: {},
    contextContract: context('global'),
  });

  expect(result.endpoint).toBe('/api/admin/entities/clients');
  expect(fetchFn).toHaveBeenCalledWith(
    '/api/admin/entities/clients?sort=recent&page=1&page_size=25',
    expect.objectContaining({ credentials: 'include' })
  );
  expect(root.className).toBe('kmc-client-index');
  expect(fakeUi.UIState.render).toHaveBeenCalledWith(expect.any(Object), 'loading', expect.any(String));
});

test('mount gère état vide et erreur HTTP via UIState', async () => {
  const document = doc();
  const fakeUi = ui();
  let fetchFn = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ clients: [], pagination: { page: 1, total_pages: 0 } }) }));
  await index.mount({ root: node(), document, ui: fakeUi, fetch: fetchFn, adminContext: {}, contextContract: context('global') });
  expect(fakeUi.UIState.render).toHaveBeenCalledWith(expect.any(Object), 'empty', expect.any(String));

  fetchFn = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'down' }) }));
  await expect(index.mount({ root: node(), document, ui: fakeUi, fetch: fetchFn, adminContext: {}, contextContract: context('global') }))
    .rejects.toThrow('down');
  expect(fakeUi.UIState.render).toHaveBeenCalledWith(expect.any(Object), 'error', 'down');
});
''')

# bootstrap API: mount Client Index before the /clients/:phone detail router.
replace_once(
    'bootstrap/api-routes.js',
    "  const adminOrder360Router = require('../routes/admin-order-360');\n  const adminClient360Router = require('../routes/admin-client-360');",
    "  const adminOrder360Router = require('../routes/admin-order-360');\n  const adminClientIndexRouter = require('../routes/admin-client-index');\n  const adminClient360Router = require('../routes/admin-client-360');"
)
replace_once(
    'bootstrap/api-routes.js',
    "  app.use('/api/admin/entities',    adminOrder360Router);\n  app.use('/api/admin/entities',    adminClient360Router);",
    "  app.use('/api/admin/entities',    adminOrder360Router);\n  // LOT 4I — l'index doit précéder /clients/:clientPhone pour que /clients/market/:code ne soit jamais capturé comme téléphone.\n  app.use('/api/admin/entities',    adminClientIndexRouter);\n  app.use('/api/admin/entities',    adminClient360Router);"
)

# HTML cutover: /admin/clients becomes Canonical with immediate Legacy rollback.
replace_once(
    'bootstrap/html-routes.js',
    "  // LOT 3B — Client 360 Canonical. L'URL détaillée est canonique, tandis que\n  // `/admin/clients` sans identifiant reste Legacy 1 jusqu'à reconstruction\n  // d'une vraie surface de recherche/navigation clients.\n  app.get('/admin/clients/:clientPhone', (req, res) => {",
    "  // LOT 4I — Client Index Canonical : recherche/navigation légère vers Client 360.\n  // Legacy 1 reste disponible par query explicite pour rollback immédiat.\n  app.get('/admin/clients', (req, res) => {\n    if (req.query && req.query.legacy === '1') return sendLegacyAdmin(res);\n    sendCanonicalAdmin(res);\n  });\n\n  // LOT 3B — Client 360 Canonical détaillé.\n  app.get('/admin/clients/:clientPhone', (req, res) => {"
)
replace_once(
    'bootstrap/html-routes.js',
    "    '/admin-next/action-center': '/admin/action-center',\n    '/admin-next/demo': '/admin/demo',",
    "    '/admin-next/action-center': '/admin/action-center',\n    '/admin-next/clients': '/admin/clients',\n    '/admin-next/demo': '/admin/demo',"
)
replace_once(
    'bootstrap/html-routes.js',
    "    '/admin/sales',\n    '/admin/clients',\n    '/admin/problems',",
    "    '/admin/sales',\n    '/admin/problems',"
)

# Canonical runtime wiring.
replace_once(
    'public/dashboards/canonical/index.html',
    '  <script src="/dashboards/canonical/js/order-360.js"></script>\n  <script src="/dashboards/canonical/js/client-360.js"></script>',
    '  <script src="/dashboards/canonical/js/order-360.js"></script>\n  <script src="/dashboards/canonical/js/client-index.js"></script>\n  <script src="/dashboards/canonical/js/client-360.js"></script>'
)

replace_once(
    'public/dashboards/canonical/js/app.js',
    ' * @depends       canonical admin-context, pilotage, commerce, operations, finance, operations-workspace, shipping-customs-workspace, catalog-workspace, finance-accounting-workspace, sourcing-workspace, pricing-workspace, action-center, order-360, client-360, product-360, demo-order-flow',
    ' * @depends       canonical admin-context, pilotage, commerce, operations, finance, operations-workspace, shipping-customs-workspace, catalog-workspace, finance-accounting-workspace, sourcing-workspace, pricing-workspace, action-center, order-360, client-index, client-360, product-360, demo-order-flow'
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    ' * @used-by       /admin, /admin/pilotage, /admin/commerce, /admin/operations, /admin/finance, /admin/workspaces/operations, /admin/workspaces/shipping-customs, /admin/workspaces/catalog, /admin/workspaces/accounting, /admin/workspaces/sourcing, /admin/workspaces/pricing, /admin/action-center, /admin/orders/:reference, /admin/clients/:phone, /admin/products/:productRef, /admin/demo, /admin-next aliases',
    ' * @used-by       /admin, /admin/pilotage, /admin/commerce, /admin/operations, /admin/finance, /admin/workspaces/operations, /admin/workspaces/shipping-customs, /admin/workspaces/catalog, /admin/workspaces/accounting, /admin/workspaces/sourcing, /admin/workspaces/pricing, /admin/action-center, /admin/orders/:reference, /admin/clients, /admin/clients/:phone, /admin/products/:productRef, /admin/demo, /admin-next aliases'
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    "    ORDER_360: 'order-360',\n    CLIENT_360: 'client-360',",
    "    ORDER_360: 'order-360',\n    CLIENT_INDEX: 'client-index',\n    CLIENT_360: 'client-360',"
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    "    if (/^\\/admin\\/orders\\/[^/]+$/.test(path)) return SURFACES.ORDER_360;\n    if (/^\\/admin\\/clients\\/[^/]+$/.test(path)) return SURFACES.CLIENT_360;",
    "    if (/^\\/admin\\/orders\\/[^/]+$/.test(path)) return SURFACES.ORDER_360;\n    if (path === '/admin/clients' || path === '/admin-next/clients') return SURFACES.CLIENT_INDEX;\n    if (/^\\/admin\\/clients\\/[^/]+$/.test(path)) return SURFACES.CLIENT_360;"
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    "  function renderClient360(root, user) {\n    if (!global.KomerceCanonicalClient360) throw new Error('canonical_client_360_module_missing');",
    "  function renderClientIndex(root, user, adminContext, requestedMarket) {\n    if (!global.KomerceCanonicalClientIndex) throw new Error('canonical_client_index_module_missing');\n    return global.KomerceCanonicalClientIndex.mount({\n      root,\n      user,\n      adminContext,\n      requestedMarket,\n      contextContract: global.KomerceAdminContext,\n      document: global.document,\n      fetch: global.fetch.bind(global),\n      ui: global.KomerceCanonicalUI,\n    });\n  }\n\n  function renderClient360(root, user) {\n    if (!global.KomerceCanonicalClient360) throw new Error('canonical_client_360_module_missing');"
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    "  function renderCommerceShell(root, user, adminContext) {\n    return renderMarketSurfaceShell(root, user, adminContext, {\n      surface: 'commerce',\n      title: 'Vue Commerce',\n      render: renderCommerce,\n    });\n  }",
    "  function renderCommerceShell(root, user, adminContext) {\n    return renderMarketSurfaceShell(root, user, adminContext, {\n      surface: 'commerce',\n      title: 'Vue Commerce',\n      render: renderCommerce,\n    });\n  }\n\n  function renderClientIndexShell(root, user, adminContext) {\n    return renderMarketSurfaceShell(root, user, adminContext, {\n      surface: 'client-index',\n      title: 'Clients visibles',\n      render: renderClientIndex,\n    });\n  }"
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    "    if (surface === SURFACES.ORDER_360) return renderOrder360(root, user);\n    if (surface === SURFACES.CLIENT_360) return renderClient360(root, user);",
    "    if (surface === SURFACES.ORDER_360) return renderOrder360(root, user);\n    if (surface === SURFACES.CLIENT_INDEX) return renderClientIndexShell(root, user, adminContext);\n    if (surface === SURFACES.CLIENT_360) return renderClient360(root, user);"
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    "    renderOrder360,\n    renderClient360,",
    "    renderOrder360,\n    renderClientIndex,\n    renderClient360,"
)
replace_once(
    'public/dashboards/canonical/js/app.js',
    "    renderCommerceShell,\n    renderOperationsShell,",
    "    renderCommerceShell,\n    renderClientIndexShell,\n    renderOperationsShell,"
)

# Feature card: intention + ownership of the new slice.
replace_once(
    'features/dashboard.feature.js',
    "      'docs/contract/ACTION_CENTER_4G.md',",
    "      'docs/contract/ACTION_CENTER_4G.md',\n      'docs/contract/CLIENT_INDEX_4I.md',"
)
replace_once(
    'features/dashboard.feature.js',
    "      'GET /api/dashboard/clients',\n      'GET /api/dashboard/ops',",
    "      'GET /api/dashboard/clients',\n      'GET /api/admin/entities/clients',\n      'GET /api/admin/entities/clients/market/:marketCode',\n      'GET /api/dashboard/ops',"
)
replace_once(
    'features/dashboard.feature.js',
    "      'services/client-360.js',\n      'services/dashboard-admin-context.js',",
    "      'services/client-360.js',\n      'services/client-index.js',\n      'services/dashboard-admin-context.js',"
)
replace_once(
    'features/dashboard.feature.js',
    "      'routes/admin-client-360.js',\n      'routes/admin-dashboard-market.js',",
    "      'routes/admin-client-360.js',\n      'routes/admin-client-index.js',\n      'routes/admin-dashboard-market.js',"
)
replace_once(
    'features/dashboard.feature.js',
    "      'dashboards/canonical/js/action-center.js',\n",
    "      'dashboards/canonical/js/action-center.js',\n      'dashboards/canonical/js/client-index.js',\n"
)
replace_once(
    'features/dashboard.feature.js',
    "      'tests/unit/admin-client-360-route.test.js',\n      'tests/unit/admin-dashboard-market.test.js',",
    "      'tests/unit/admin-client-360-route.test.js',\n      'tests/unit/admin-client-index-route.test.js',\n      'tests/unit/client-index-service.test.js',\n      'tests/unit/canonical-client-index.test.js',\n      'tests/unit/admin-dashboard-market.test.js',"
)

print('CLIENT_INDEX_4I_PATCH_APPLIED')
