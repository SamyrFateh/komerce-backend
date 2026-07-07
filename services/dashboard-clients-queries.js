/**
 * @komerce-arch
 * @role          dashboard-dashboard-clients-queries
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, routes/dashboard-shared.js, utils/logger.js
 * @used-by       routes/dashboard-clients.js
 * @db-read       order_items, orders, parcel_items, parcels, products, recipients, relais, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * services/dashboard-clients-queries.js
 *
 * Extrait de routes/dashboard-clients.js — R9 (2026-06-14)
 *
 * Expose :
 *   getClientsAnalysis(params)   — GET /clients (analyse comportement + segmentation)
 *   getClientsList(params)       — GET /clients/list (liste paginée + filtres)
 *   getClientDetail(phone)       — GET /clients/detail
 *   getHistory(nbMois)           — GET /history
 *   getRelais()                  — GET /relais (colis au stade relais)
 *
 * Aucune logique métier modifiée — extraction pure iso-comportement.
 */

const db  = require('../db');
const log = require('../utils/logger').child({ module: 'dashboard-clients-queries' });
const { getEurKmf } = require('../routes/dashboard-shared');

// ─── Sous-requête identité client (COALESCE user/recipient) ────────────────
const CLIENT_IDENTITY_SQL = `
  SELECT
    o.id              AS order_id,
    o.user_id,
    o.recipient_id,
    o.relais_id,
    o.total_kmf,
    o.status,
    o.created_at,
    o.payment_mode,
    COALESCE(u.phone, r.phone)         AS client_phone,
    COALESCE(u.full_name, r.full_name) AS client_name
  FROM orders o
  LEFT JOIN users u      ON u.id = o.user_id
  LEFT JOIN recipients r ON r.id = o.recipient_id
`;

// ─── getClientsAnalysis ────────────────────────────────────────────────────

async function getClientsAnalysis({ top = 20, debut = '2024-01-01', fin, seuilVipKmf = 200000 }) {
  if (!fin) fin = new Date().toISOString().split('T')[0];
  const finExcl = new Date(new Date(fin).getTime() + 86400000).toISOString().split('T')[0];

  const [kpiRes, topClientsRes, topProdsRes, relaisRes, evoRes,
         segmentationRes, atRiskRes, vipRes] = await Promise.all([

    // ── KPI globaux ──
    db.query(`
      WITH oc AS (${CLIENT_IDENTITY_SQL} WHERE o.created_at >= $1 AND o.created_at < $2)
      SELECT
        COUNT(DISTINCT (oc.client_phone, oc.client_name)) FILTER (
          WHERE oc.client_phone IS NOT NULL
        ) AS nb_clients,
        COUNT(DISTINCT oc.order_id) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')) AS commandes_valides,
        COALESCE(SUM(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf,
        COALESCE(AVG(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS panier_moyen,
        COUNT(DISTINCT (oc.client_phone, oc.client_name)) FILTER (
          WHERE oc.client_phone IN (
            SELECT client_phone FROM (${CLIENT_IDENTITY_SQL}) inner_oc
            GROUP BY client_phone, client_name
            HAVING COUNT(*) >= 2
          )
        ) AS clients_recurrents
      FROM oc
    `, [debut, finExcl]),

    // ── Top clients par CA ──
    db.query(`
      WITH oc AS (${CLIENT_IDENTITY_SQL})
      SELECT
        oc.client_name AS name,
        oc.client_phone AS phone,
        COUNT(*) AS nb_commandes,
        COALESCE(SUM(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf,
        MAX(oc.created_at) AS derniere_commande,
        MIN(oc.created_at) AS premiere_commande
      FROM oc
      WHERE oc.created_at >= $1 AND oc.created_at < $2
        AND oc.client_phone IS NOT NULL
      GROUP BY oc.client_phone, oc.client_name
      ORDER BY ca_kmf DESC LIMIT $3
    `, [debut, finExcl, top]),

    // ── Top produits ──
    db.query(`
      SELECT p.name, p.category, SUM(oi.quantity) AS qty,
        COUNT(DISTINCT oi.order_id) AS nb_commandes,
        COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS ca_kmf
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status NOT IN ('cancelled','refunded')
      GROUP BY p.id, p.name, p.category ORDER BY qty DESC LIMIT $3
    `, [debut, finExcl, top]),

    // ── Par relais ──
    db.query(`
      SELECT r.name AS relais, r.island,
        COUNT(DISTINCT o.id) AS nb_commandes,
        COALESCE(SUM(o.total_kmf) FILTER (WHERE o.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf,
        COUNT(*) FILTER (WHERE o.status = 'collected') AS livrees
      FROM orders o JOIN relais r ON r.id = o.relais_id
      WHERE o.created_at >= $1 AND o.created_at < $2
      GROUP BY r.id, r.name, r.island ORDER BY ca_kmf DESC
    `, [debut, finExcl]),

    // ── Évolution mensuelle ──
    db.query(`
      WITH oc AS (${CLIENT_IDENTITY_SQL})
      SELECT TO_CHAR(DATE_TRUNC('month', oc.created_at), 'YYYY-MM') AS mois,
        COUNT(DISTINCT oc.order_id) AS nb_commandes,
        COUNT(DISTINCT (oc.client_phone, oc.client_name)) FILTER (WHERE oc.client_phone IS NOT NULL) AS nb_clients,
        COALESCE(SUM(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf
      FROM oc
      WHERE oc.created_at >= $1 AND oc.created_at < $2
      GROUP BY 1 ORDER BY 1 ASC
    `, [debut, finExcl]),

    // ── Segmentation (photo actuelle — toute l'histoire) ──
    db.query(`
      WITH oc AS (${CLIENT_IDENTITY_SQL} WHERE o.status NOT IN ('cancelled','refunded')),
      client_agg AS (
        SELECT
          client_phone, client_name,
          COUNT(*) AS nb_orders,
          SUM(total_kmf) AS ltv_kmf,
          MIN(created_at) AS first_order,
          MAX(created_at) AS last_order,
          EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS days_since_last
        FROM oc
        WHERE client_phone IS NOT NULL
        GROUP BY client_phone, client_name
      )
      SELECT
        COUNT(*) FILTER (WHERE nb_orders = 1 AND days_since_last <= 30)              AS nb_new,
        COUNT(*) FILTER (WHERE nb_orders >= 2 AND days_since_last <= 90)             AS nb_recurrent,
        COUNT(*) FILTER (WHERE (ltv_kmf >= $1 OR nb_orders >= 5) AND days_since_last <= 180) AS nb_vip,
        COUNT(*) FILTER (WHERE nb_orders >= 2 AND days_since_last > 60 AND days_since_last <= 180) AS nb_at_risk,
        COUNT(*) FILTER (WHERE days_since_last > 180)                                AS nb_dormant,
        COUNT(*)                                                                      AS nb_total
      FROM client_agg
    `, [seuilVipKmf]),

    // ── Clients à risque ──
    db.query(`
      WITH oc AS (${CLIENT_IDENTITY_SQL} WHERE o.status NOT IN ('cancelled','refunded'))
      SELECT
        client_phone AS phone,
        client_name AS name,
        COUNT(*) AS nb_commandes,
        SUM(total_kmf) AS ltv_kmf,
        MAX(created_at) AS derniere_commande,
        EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
      FROM oc
      WHERE client_phone IS NOT NULL
      GROUP BY client_phone, client_name
      HAVING COUNT(*) >= 2
         AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int BETWEEN 60 AND 180
      ORDER BY ltv_kmf DESC
      LIMIT 30
    `),

    // ── VIP actifs ──
    db.query(`
      WITH oc AS (${CLIENT_IDENTITY_SQL} WHERE o.status NOT IN ('cancelled','refunded'))
      SELECT
        client_phone AS phone,
        client_name AS name,
        COUNT(*) AS nb_commandes,
        SUM(total_kmf) AS ltv_kmf,
        MAX(created_at) AS derniere_commande,
        EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
      FROM oc
      WHERE client_phone IS NOT NULL
      GROUP BY client_phone, client_name
      HAVING (SUM(total_kmf) >= $1 OR COUNT(*) >= 5)
         AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 180
      ORDER BY ltv_kmf DESC
      LIMIT 20
    `, [seuilVipKmf]),
  ]);

  const kpi = kpiRes.rows[0];
  const nbClients = parseInt(kpi.nb_clients);
  const seg = segmentationRes.rows[0];

  return {
    periode: { debut, fin, vip_threshold_kmf: seuilVipKmf },
    kpi: {
      nb_clients:         nbClients,
      commandes_valides:  parseInt(kpi.commandes_valides),
      ca_total_kmf:       Math.round(parseFloat(kpi.ca_kmf)),
      panier_moyen_kmf:   Math.round(parseFloat(kpi.panier_moyen)),
      clients_recurrents: parseInt(kpi.clients_recurrents),
      taux_recurrence_pct: nbClients > 0 ? +(parseInt(kpi.clients_recurrents) / nbClients * 100).toFixed(1) : 0,
    },
    segments: {
      nb_total:  parseInt(seg.nb_total),
      new:       parseInt(seg.nb_new),
      recurrent: parseInt(seg.nb_recurrent),
      vip:       parseInt(seg.nb_vip),
      at_risk:   parseInt(seg.nb_at_risk),
      dormant:   parseInt(seg.nb_dormant),
    },
    at_risk_clients: atRiskRes.rows.map(c => ({
      name: c.name, phone: c.phone,
      nb_commandes: parseInt(c.nb_commandes),
      ltv_kmf: Math.round(parseFloat(c.ltv_kmf)),
      derniere_commande: c.derniere_commande,
      jours_silence: parseInt(c.jours_silence),
    })),
    vip_clients: vipRes.rows.map(c => ({
      name: c.name, phone: c.phone,
      nb_commandes: parseInt(c.nb_commandes),
      ltv_kmf: Math.round(parseFloat(c.ltv_kmf)),
      derniere_commande: c.derniere_commande,
      jours_silence: parseInt(c.jours_silence),
    })),
    top_clients: topClientsRes.rows.map(c => ({
      name: c.name, phone: c.phone,
      nb_commandes: parseInt(c.nb_commandes),
      ca_kmf: Math.round(parseFloat(c.ca_kmf)),
      derniere_commande: c.derniere_commande,
      premiere_commande: c.premiere_commande,
    })),
    top_produits: topProdsRes.rows.map(p => ({
      name: p.name, categorie: p.category, qty: parseInt(p.qty),
      nb_commandes: parseInt(p.nb_commandes), ca_kmf: Math.round(parseFloat(p.ca_kmf)),
    })),
    par_relais: relaisRes.rows.map(r => ({
      relais: r.relais, ile: r.island, nb_commandes: parseInt(r.nb_commandes),
      ca_kmf: Math.round(parseFloat(r.ca_kmf)), livrees: parseInt(r.livrees),
    })),
    evolution: evoRes.rows,
  };
}

// ─── getClientsList ────────────────────────────────────────────────────────

async function getClientsList({ page = 1, pageSize = 25, search = '', segment = 'all', island = null, seuilVipKmf = 200000 }) {
  const offset = (page - 1) * pageSize;
  const havingClauses = [];
  const params = [];

  let searchClauseSql = '';
  if (search) {
    params.push('%' + search.toLowerCase() + '%');
    const idx = params.length;
    searchClauseSql = `(LOWER(client_name) LIKE $${idx} OR LOWER(client_phone) LIKE $${idx})`;
    havingClauses.push(searchClauseSql);
  }

  if (segment === 'new') {
    havingClauses.push(`COUNT(*) = 1 AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 30`);
  } else if (segment === 'recurrent') {
    havingClauses.push(`COUNT(*) >= 2 AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 90`);
  } else if (segment === 'vip') {
    params.push(seuilVipKmf);
    const idx = params.length;
    havingClauses.push(`(SUM(total_kmf) >= $${idx} OR COUNT(*) >= 5) AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 180`);
  } else if (segment === 'at_risk') {
    havingClauses.push(`COUNT(*) >= 2 AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int BETWEEN 60 AND 180`);
  } else if (segment === 'dormant') {
    havingClauses.push(`EXTRACT(DAY FROM NOW() - MAX(created_at))::int > 180`);
  }

  const havingSql = havingClauses.length ? 'HAVING ' + havingClauses.join(' AND ') : '';

  let islandClauseSql = '';
  if (island) {
    params.push(island);
    const idx = params.length;
    islandClauseSql = `AND rl.island = $${idx}`;
  }

  const sql = `
    WITH oc AS (
      SELECT
        o.id AS order_id, o.total_kmf, o.status, o.created_at, o.relais_id,
        COALESCE(u.phone, r.phone) AS client_phone,
        COALESCE(u.full_name, r.full_name) AS client_name
      FROM orders o
      LEFT JOIN users u      ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
      LEFT JOIN relais rl    ON rl.id = o.relais_id
      WHERE o.status NOT IN ('cancelled','refunded')
        AND COALESCE(u.phone, r.phone) IS NOT NULL
        ${islandClauseSql}
    )
    SELECT
      client_phone AS phone,
      client_name AS name,
      COUNT(*) AS nb_commandes,
      SUM(total_kmf) AS ltv_kmf,
      AVG(total_kmf) AS panier_moyen_kmf,
      MIN(created_at) AS premiere_commande,
      MAX(created_at) AS derniere_commande,
      EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
    FROM oc
    GROUP BY client_phone, client_name
    ${havingSql}
    ORDER BY ltv_kmf DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const countSql = `
    WITH oc AS (
      SELECT
        o.id AS order_id, o.total_kmf, o.status, o.created_at,
        COALESCE(u.phone, r.phone) AS client_phone,
        COALESCE(u.full_name, r.full_name) AS client_name
      FROM orders o
      LEFT JOIN users u      ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
      LEFT JOIN relais rl    ON rl.id = o.relais_id
      WHERE o.status NOT IN ('cancelled','refunded')
        AND COALESCE(u.phone, r.phone) IS NOT NULL
        ${islandClauseSql}
    ),
    grouped AS (
      SELECT client_phone, client_name, COUNT(*) AS cnt, SUM(total_kmf) AS ltv, MAX(created_at) AS last_o
      FROM oc GROUP BY client_phone, client_name
      ${havingSql}
    )
    SELECT COUNT(*)::int AS total FROM grouped
  `;

  const [listRes, countRes] = await Promise.all([
    db.query(sql, params),
    db.query(countSql, params),
  ]);

  return {
    page, page_size: pageSize,
    total: countRes.rows[0].total,
    total_pages: Math.ceil(countRes.rows[0].total / pageSize),
    filters: { search, segment, island, vip_threshold_kmf: seuilVipKmf },
    clients: listRes.rows.map(c => ({
      name: c.name, phone: c.phone,
      nb_commandes: parseInt(c.nb_commandes),
      ltv_kmf: Math.round(parseFloat(c.ltv_kmf)),
      panier_moyen_kmf: Math.round(parseFloat(c.panier_moyen_kmf)),
      premiere_commande: c.premiere_commande,
      derniere_commande: c.derniere_commande,
      jours_silence: parseInt(c.jours_silence),
    })),
  };
}

// ─── getClientDetail ──────────────────────────────────────────────────────

async function getClientDetail(phone) {
  const [profileRes, ordersRes, productsRes] = await Promise.all([
    db.query(`
      WITH oc AS (
        SELECT
          o.id, o.total_kmf, o.status, o.created_at, o.payment_mode, o.relais_id,
          COALESCE(u.phone, r.phone) AS client_phone,
          COALESCE(u.full_name, r.full_name) AS client_name,
          u.email AS client_email,
          u.country AS country
        FROM orders o
        LEFT JOIN users u      ON u.id = o.user_id
        LEFT JOIN recipients r ON r.id = o.recipient_id
      )
      SELECT
        MAX(client_name) AS name,
        client_phone AS phone,
        MAX(client_email) AS email,
        MAX(country) AS country,
        COUNT(*) AS nb_orders_total,
        COUNT(*) FILTER (WHERE status NOT IN ('cancelled','refunded')) AS nb_orders_valid,
        COUNT(*) FILTER (WHERE status IN ('cancelled','refunded')) AS nb_orders_cancelled,
        COALESCE(SUM(total_kmf) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0) AS ltv_kmf,
        COALESCE(AVG(total_kmf) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0) AS panier_moyen_kmf,
        MIN(created_at) AS premiere_commande,
        MAX(created_at) AS derniere_commande,
        EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
      FROM oc
      WHERE client_phone = $1
      GROUP BY client_phone
    `, [phone]),

    db.query(`
      SELECT
        o.id, o.reference, o.total_kmf, o.status, o.payment_mode,
        o.created_at, o.collected_at, o.cancelled_at,
        rl.name AS relais_name, rl.island
      FROM orders o
      LEFT JOIN users u      ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
      LEFT JOIN relais rl    ON rl.id = o.relais_id
      WHERE COALESCE(u.phone, r.phone) = $1
      ORDER BY o.created_at DESC
      LIMIT 100
    `, [phone]),

    db.query(`
      SELECT p.name, p.category,
        SUM(oi.quantity) AS qty,
        COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS total_kmf,
        COUNT(DISTINCT oi.order_id) AS nb_orders
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN users u      ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
      WHERE COALESCE(u.phone, r.phone) = $1
        AND o.status NOT IN ('cancelled','refunded')
      GROUP BY p.id, p.name, p.category
      ORDER BY qty DESC
      LIMIT 20
    `, [phone]),
  ]);

  if (!profileRes.rows.length) return null;

  const p = profileRes.rows[0];
  return {
    profile: {
      name: p.name, phone: p.phone, email: p.email, country: p.country,
      nb_orders_total: parseInt(p.nb_orders_total),
      nb_orders_valid: parseInt(p.nb_orders_valid),
      nb_orders_cancelled: parseInt(p.nb_orders_cancelled),
      ltv_kmf: Math.round(parseFloat(p.ltv_kmf)),
      panier_moyen_kmf: Math.round(parseFloat(p.panier_moyen_kmf)),
      premiere_commande: p.premiere_commande,
      derniere_commande: p.derniere_commande,
      jours_silence: parseInt(p.jours_silence),
    },
    orders: ordersRes.rows.map(o => ({
      id: o.id, reference: o.reference, total_kmf: o.total_kmf,
      status: o.status, payment_mode: o.payment_mode,
      created_at: o.created_at, collected_at: o.collected_at, cancelled_at: o.cancelled_at,
      relais: o.relais_name, ile: o.island,
    })),
    top_products: productsRes.rows.map(p => ({
      name: p.name, categorie: p.category,
      qty: parseInt(p.qty),
      total_kmf: Math.round(parseFloat(p.total_kmf)),
      nb_orders: parseInt(p.nb_orders),
    })),
  };
}

// ─── getHistory ──────────────────────────────────────────────────────────

async function getHistory(nbMois = 6) {
  const rates = await getEurKmf();

  const { rows } = await db.query(`
    SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mois,
      COUNT(*) AS total_commandes,
      COUNT(*) FILTER (WHERE status = 'collected') AS livrees,
      COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_kmf,
      COALESCE(SUM(total_eur) FILTER (WHERE status != 'cancelled'), 0) AS ca_eur
    FROM orders WHERE created_at >= NOW() - ($1 || ' months')::INTERVAL
    GROUP BY 1 ORDER BY 1 ASC
  `, [nbMois]);

  return {
    nb_mois: nbMois, taux: rates,
    history: rows.map(r => ({
      mois: r.mois,
      total_commandes: parseInt(r.total_commandes),
      livrees: parseInt(r.livrees),
      ca_kmf: Math.round(parseFloat(r.ca_kmf)),
      ca_eur: Math.round(parseFloat(r.ca_eur)),
    })),
  };
}

// ─── getRelais ───────────────────────────────────────────────────────────

async function getRelais() {
  const { rows: parcels } = await db.query(`
    SELECT p.id, p.reference, p.status, p.type, p.weight_kg,
      p.external_code, p.seal_code, p.pickup_code, p.items_count,
      p.created_at, p.updated_at,
      o.id AS order_id, o.reference AS order_reference,
      o.total_kmf AS order_total_kmf,
      o.payment_mode, o.payment_status,
      COALESCE(p.recipient_name, u.full_name, rc.full_name) AS client_nom,
      COALESCE(p.recipient_phone, u.phone, rc.phone) AS client_phone,
      r.name AS relais_nom, r.island AS ile,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - COALESCE(p.updated_at, p.created_at))) / 3600, 0) AS heures_attente
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    LEFT JOIN recipients rc ON rc.id = o.recipient_id
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE p.status IN ('in_transit', 'available')
    ORDER BY p.updated_at ASC NULLS LAST, p.created_at ASC
  `);

  const parcelIds = parcels.map(p => p.id);
  const itemsMap = {};
  if (parcelIds.length > 0) {
    const { rows: items } = await db.query(`
      SELECT pi.parcel_id, pr.name AS nom, pi.quantity AS quantite,
        oi.price_kmf AS prix_kmf
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      JOIN products pr ON pr.id = oi.product_id
      WHERE pi.parcel_id = ANY($1)
    `, [parcelIds]);
    for (const item of items) {
      if (!itemsMap[item.parcel_id]) itemsMap[item.parcel_id] = [];
      itemsMap[item.parcel_id].push({
        nom: item.nom, quantite: Number(item.quantite), prix_kmf: Number(item.prix_kmf),
      });
    }
  }

  function toRelaisParcel(p) {
    const heures = Math.round(Number(p.heures_attente));
    return {
      id: p.id, reference: p.reference, status: p.status, type: p.type,
      weight_kg: p.weight_kg ? Number(p.weight_kg) : null,
      external_code: p.external_code, seal_code: p.seal_code, pickup_code: p.pickup_code,
      items_count: Number(p.items_count || 0),
      order_id: p.order_id, order_reference: p.order_reference,
      order_total_kmf: Number(p.order_total_kmf),
      client_nom: p.client_nom || 'Client', client_phone: p.client_phone || '',
      produits: itemsMap[p.id] || [],
      payment_mode: p.payment_mode === 'stripe_eur' ? 'stripe' : 'cash_relais',
      payment_status: p.payment_status === 'paid' ? 'paid' : 'pending',
      relais_nom: p.relais_nom || 'Relais inconnu', ile: p.ile || 'Comores',
      heures_attente: heures,
      priorite: heures > 120 ? 'urgente' : 'normale',
    };
  }

  return {
    en_transit: parcels.filter(p => p.status === 'in_transit').map(toRelaisParcel),
    a_remettre: parcels.filter(p => p.status === 'available').map(toRelaisParcel),
    kpi: {
      en_transit: parcels.filter(p => p.status === 'in_transit').length,
      a_remettre: parcels.filter(p => p.status === 'available').length,
      cash_pending: parcels.filter(p => p.status === 'available' && p.payment_mode === 'cash_relais' && p.payment_status !== 'paid').length,
    },
  };
}

module.exports = { getClientsAnalysis, getClientsList, getClientDetail, getHistory, getRelais };
