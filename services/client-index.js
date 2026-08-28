/**
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
