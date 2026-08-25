/**
 * @komerce-arch
 * @role          canonical-client-360-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        normalized_client_phone, server_market_scope, global_authority
 * @outputs       client_360_projection
 * @depends       db
 * @used-by       routes/admin-client-360.js
 * @db-read       users, recipients, orders, markets, relais, order_items, products, shared_carts, shared_cart_items, client_notifications, webauthn_credentials
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, server_market_scope_is_authority, client_account_facets_global_only
 * @impact-areas  admin-dashboard, clients, commerce, shared-cart, auth-passkey, notifications, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

const CLIENT_PHONE = /^\+?[0-9]{6,20}$/;
const ORGANIZER_ID_SQL = `COALESCE(
  NULLIF(to_jsonb(sc)->>'organizer_user_id', '')::uuid,
  NULLIF(to_jsonb(sc)->>'beneficiary_user_id', '')::uuid
)`;

function normalizePhone(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[\s().-]+/g, '');
  return CLIENT_PHONE.test(normalized) ? normalized : null;
}

function marketFilter(alias, marketIds, startIndex) {
  if (marketIds === null) return { sql: '', params: [] };
  if (!Array.isArray(marketIds) || marketIds.length === 0) {
    return { sql: ' AND FALSE', params: [] };
  }
  return {
    sql: ` AND ${alias}.market_id = ANY($${startIndex}::uuid[])`,
    params: [marketIds],
  };
}

function publicScope(mode, markets) {
  return Object.freeze({
    mode,
    markets: Object.freeze(markets.map(row => Object.freeze({
      code: row.code,
      name: row.name,
      currency: row.currency,
    }))),
  });
}

async function resolveClient(phone, options = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { invalid: true, client: null };

  const marketIds = options.marketIds === undefined ? null : options.marketIds;
  const scoped = marketFilter('o', marketIds, 2);
  const { rows } = await db.query(`
    SELECT
      COALESCE(u.id, r.user_id) AS user_id,
      COALESCE(u.full_name, r.full_name) AS full_name,
      u.email,
      COALESCE(u.phone, r.phone) AS phone,
      u.country,
      u.currency_pref,
      u.role,
      u.created_at AS account_created_at,
      u.updated_at AS account_updated_at,
      u.last_login_at,
      o.created_at AS latest_order_at
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN recipients r ON r.id = o.recipient_id
    WHERE regexp_replace(COALESCE(u.phone, r.phone, ''), '[^0-9+]', '', 'g') = $1
      ${scoped.sql}
    ORDER BY (u.id IS NOT NULL) DESC, o.created_at DESC
    LIMIT 1
  `, [normalized, ...scoped.params]);

  return {
    invalid: false,
    client: rows[0] ? Object.freeze({ ...rows[0], normalized_phone: normalized }) : null,
  };
}

async function loadClient360(client, options = {}) {
  if (!client || !client.normalized_phone) throw new Error('client_360_resolved_client_required');

  const marketIds = options.marketIds === undefined ? null : options.marketIds;
  const mode = marketIds === null ? 'global' : 'market';
  const includeAccountFacets = Boolean(options.includeSecurity && client.user_id && mode === 'global');
  const phone = client.normalized_phone;

  const profileMarket = marketFilter('o', marketIds, 2);
  const ordersMarket = marketFilter('o', marketIds, 2);
  const productsMarket = marketFilter('o', marketIds, 2);
  const marketsMarket = marketFilter('o', marketIds, 2);
  const notificationsMarket = marketFilter('o', marketIds, 2);

  const profilePromise = db.query(`
    WITH scoped_orders AS (
      SELECT
        o.id, o.total_kmf, o.status::text AS status,
        o.payment_status::text AS payment_status,
        o.created_at,
        COALESCE(u.full_name, r.full_name) AS client_name,
        u.email AS client_email,
        COALESCE(u.phone, r.phone) AS client_phone,
        u.country
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
      WHERE regexp_replace(COALESCE(u.phone, r.phone, ''), '[^0-9+]', '', 'g') = $1
        ${profileMarket.sql}
    )
    SELECT
      MAX(client_name) AS name,
      MAX(client_email) AS email,
      MAX(client_phone) AS phone,
      MAX(country) AS country,
      COUNT(*)::int AS orders_total,
      COUNT(*) FILTER (WHERE status NOT IN ('cancelled','refunded'))::int AS orders_valid,
      COUNT(*) FILTER (WHERE status IN ('cancelled','refunded'))::int AS orders_cancelled,
      COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid_orders,
      COUNT(*) FILTER (WHERE payment_status != 'paid')::int AS unpaid_orders,
      COALESCE(SUM(total_kmf) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0) AS ltv_kmf,
      COALESCE(AVG(total_kmf) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0) AS average_basket_kmf,
      MIN(created_at) AS first_order_at,
      MAX(created_at) AS last_order_at,
      EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS days_since_last_order
    FROM scoped_orders
  `, [phone, ...profileMarket.params]);

  const ordersPromise = db.query(`
    SELECT
      o.reference,
      o.status::text AS status,
      o.payment_status::text AS payment_status,
      o.payment_mode::text AS payment_mode,
      o.total_kmf,
      o.created_at,
      o.collected_at,
      o.cancelled_at,
      m.code AS market_code,
      m.name AS market_name,
      rl.name AS relais_name,
      rl.island AS relais_island
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN recipients r ON r.id = o.recipient_id
    LEFT JOIN markets m ON m.id = o.market_id
    LEFT JOIN relais rl ON rl.id = o.relais_id
    WHERE regexp_replace(COALESCE(u.phone, r.phone, ''), '[^0-9+]', '', 'g') = $1
      ${ordersMarket.sql}
    ORDER BY o.created_at DESC
    LIMIT 100
  `, [phone, ...ordersMarket.params]);

  const productsPromise = db.query(`
    SELECT
      p.name,
      p.category,
      SUM(oi.quantity)::int AS quantity,
      COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS revenue_kmf,
      COUNT(DISTINCT oi.order_id)::int AS orders_count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN recipients r ON r.id = o.recipient_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE regexp_replace(COALESCE(u.phone, r.phone, ''), '[^0-9+]', '', 'g') = $1
      AND o.status NOT IN ('cancelled','refunded')
      ${productsMarket.sql}
    GROUP BY p.id, p.name, p.category
    ORDER BY quantity DESC, revenue_kmf DESC
    LIMIT 20
  `, [phone, ...productsMarket.params]);

  const marketsPromise = db.query(`
    SELECT DISTINCT m.code, m.name, m.currency
    FROM orders o
    JOIN markets m ON m.id = o.market_id
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN recipients r ON r.id = o.recipient_id
    WHERE regexp_replace(COALESCE(u.phone, r.phone, ''), '[^0-9+]', '', 'g') = $1
      ${marketsMarket.sql}
    ORDER BY m.code
  `, [phone, ...marketsMarket.params]);

  const notificationsPromise = client.user_id
    ? db.query(`
        SELECT
          n.event_key,
          n.severity,
          n.title,
          n.message,
          n.status,
          n.order_reference,
          n.created_at,
          n.acknowledged_at,
          n.resolved_at
        FROM client_notifications n
        JOIN orders o ON o.id = n.entity_id
        WHERE n.user_id = $1::uuid
          ${notificationsMarket.sql}
        ORDER BY n.created_at DESC
        LIMIT 50
      `, [client.user_id, ...notificationsMarket.params])
    : Promise.resolve({ rows: [] });

  const sharedListsPromise = includeAccountFacets
    ? db.query(`
        SELECT
          sc.title,
          sc.status,
          sc.created_at,
          sc.closed_at,
          sc.cancelled_at,
          COALESCE(SUM(sci.quantity), 0)::int AS items_count,
          COALESCE(SUM(sci.quantity) FILTER (WHERE oi.id IS NOT NULL), 0)::int AS claimed_count
        FROM shared_carts sc
        LEFT JOIN shared_cart_items sci ON sci.shared_cart_id = sc.id
        LEFT JOIN order_items oi ON oi.shared_cart_item_id = sci.id
        WHERE ${ORGANIZER_ID_SQL} = $1::uuid
        GROUP BY sc.id, sc.title, sc.status, sc.created_at, sc.closed_at, sc.cancelled_at
        ORDER BY sc.created_at DESC
        LIMIT 50
      `, [client.user_id])
    : Promise.resolve({ rows: [] });

  const securityPromise = includeAccountFacets
    ? Promise.all([
        db.query(`
          SELECT role, created_at, updated_at, last_login_at,
                 COALESCE(currency_pref, 'KMF') AS currency_pref,
                 COALESCE(country, 'KM') AS country
          FROM users
          WHERE id = $1::uuid
          LIMIT 1
        `, [client.user_id]),
        db.query(`
          SELECT
            COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active_count,
            COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked_count,
            MAX(last_used_at) FILTER (WHERE revoked_at IS NULL) AS last_used_at,
            MIN(created_at) FILTER (WHERE revoked_at IS NULL) AS first_enrolled_at
          FROM webauthn_credentials
          WHERE user_id = $1::uuid
        `, [client.user_id]),
      ])
    : Promise.resolve(null);

  const [profileResult, ordersResult, productsResult, marketsResult,
    notificationsResult, sharedListsResult, securityResult] = await Promise.all([
    profilePromise,
    ordersPromise,
    productsPromise,
    marketsPromise,
    notificationsPromise,
    sharedListsPromise,
    securityPromise,
  ]);

  const p = profileResult.rows[0] || {};
  const orders = ordersResult.rows.map(row => Object.freeze({
    reference: row.reference,
    market: Object.freeze({ code: row.market_code || null, name: row.market_name || null }),
    status: row.status,
    payment_status: row.payment_status,
    payment_mode: row.payment_mode,
    total_kmf: Number(row.total_kmf) || 0,
    relais: Object.freeze({ name: row.relais_name || null, island: row.relais_island || null }),
    created_at: row.created_at,
    collected_at: row.collected_at,
    cancelled_at: row.cancelled_at,
  }));

  const topProducts = productsResult.rows.map(row => Object.freeze({
    name: row.name || null,
    category: row.category || null,
    quantity: Number(row.quantity) || 0,
    revenue_kmf: Number(row.revenue_kmf) || 0,
    orders_count: Number(row.orders_count) || 0,
  }));

  const sharedLists = sharedListsResult.rows.map(row => Object.freeze({
    title: row.title || null,
    status: row.status,
    items_count: Number(row.items_count) || 0,
    claimed_count: Number(row.claimed_count) || 0,
    created_at: row.created_at,
    closed_at: row.closed_at,
    cancelled_at: row.cancelled_at,
  }));

  const notifications = notificationsResult.rows.map(row => Object.freeze({
    event_key: row.event_key,
    severity: row.severity,
    title: row.title,
    message: row.message,
    status: row.status,
    order_reference: row.order_reference,
    created_at: row.created_at,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
  }));

  const security = securityResult
    ? (() => {
        const account = securityResult[0].rows[0] || {};
        const passkeys = securityResult[1].rows[0] || {};
        return Object.freeze({
          visibility: 'global',
          account: Object.freeze({
            role: account.role || null,
            country: account.country || null,
            currency_pref: account.currency_pref || null,
            created_at: account.created_at || null,
            updated_at: account.updated_at || null,
            last_login_at: account.last_login_at || null,
          }),
          passkeys: Object.freeze({
            active_count: Number(passkeys.active_count) || 0,
            revoked_count: Number(passkeys.revoked_count) || 0,
            last_used_at: passkeys.last_used_at || null,
            first_enrolled_at: passkeys.first_enrolled_at || null,
          }),
        });
      })()
    : Object.freeze({ visibility: 'restricted' });

  const timeline = [];
  orders.forEach(row => timeline.push(Object.freeze({
    type: 'order',
    occurred_at: row.created_at,
    title: `Commande ${row.reference}`,
    detail: [row.market.code, row.status, `${row.total_kmf} KMF`].filter(Boolean).join(' · '),
    order_reference: row.reference,
  })));
  sharedLists.forEach(row => timeline.push(Object.freeze({
    type: 'shared-list',
    occurred_at: row.created_at,
    title: row.title || 'Liste partagée',
    detail: [row.status, `${row.claimed_count}/${row.items_count} article(s) acheté(s)`].filter(Boolean).join(' · '),
  })));
  notifications.forEach(row => timeline.push(Object.freeze({
    type: 'notification',
    occurred_at: row.created_at,
    title: row.title,
    detail: [row.order_reference, row.status].filter(Boolean).join(' · '),
    order_reference: row.order_reference,
  })));
  if (security.visibility === 'global' && security.passkeys.first_enrolled_at) {
    timeline.push(Object.freeze({
      type: 'security',
      occurred_at: security.passkeys.first_enrolled_at,
      title: 'Premier passkey enrôlé',
      detail: `${security.passkeys.active_count} passkey(s) actif(s)`,
    }));
  }
  timeline.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));

  const ordersTotal = Number(p.orders_total) || 0;
  const ordersValid = Number(p.orders_valid) || 0;
  const ordersCancelled = Number(p.orders_cancelled) || 0;
  const paidOrders = Number(p.paid_orders) || 0;
  const unpaidOrders = Number(p.unpaid_orders) || 0;
  const ltvKmf = Number(p.ltv_kmf) || 0;
  const averageBasketKmf = Number(p.average_basket_kmf) || 0;

  return Object.freeze({
    client: Object.freeze({
      name: p.name || client.full_name || null,
      phone: p.phone || client.phone || phone,
      email: p.email || client.email || null,
      country: p.country || client.country || null,
      first_order_at: p.first_order_at || null,
      last_order_at: p.last_order_at || null,
      days_since_last_order: p.days_since_last_order == null ? null : Number(p.days_since_last_order),
    }),
    scope: publicScope(mode, marketsResult.rows),
    summary: Object.freeze({
      orders_total: ordersTotal,
      orders_valid: ordersValid,
      orders_cancelled: ordersCancelled,
      markets: marketsResult.rows.length,
      top_products: topProducts.length,
      shared_lists: sharedLists.length,
      notifications: notifications.length,
    }),
    finance: Object.freeze({
      ltv_kmf: ltvKmf,
      average_basket_kmf: averageBasketKmf,
      paid_orders: paidOrders,
      unpaid_orders: unpaidOrders,
    }),
    orders: Object.freeze(orders),
    top_products: Object.freeze(topProducts),
    shared_lists: Object.freeze(sharedLists),
    notifications: Object.freeze(notifications),
    security,
    timeline: Object.freeze(timeline.slice(0, 150)),
    data_quality: Object.freeze({
      generated_at: new Date().toISOString(),
      scope_mode: mode,
      account_facets: includeAccountFacets ? 'global-visible' : 'restricted',
      source_tables: Object.freeze([
        'users', 'recipients', 'orders', 'markets', 'relais', 'order_items', 'products',
        'shared_carts', 'shared_cart_items', 'client_notifications', 'webauthn_credentials',
      ]),
    }),
  });
}

module.exports = {
  CLIENT_PHONE,
  normalizePhone,
  marketFilter,
  resolveClient,
  loadClient360,
};
