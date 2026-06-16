/**
 * @komerce-arch
 * @role          logistics-read
 * @domain        logistics
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       incidents, order_items, orders, parcel_items, parcels, products, relais, scan_events, users
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * routes/parcel-api-v2/read.js
 * Extrait de routes/parcel-api-v2.js — lot GOD-FILES-4 (2026-05-25)
 *
 * GET /api/v2/parcels
 * GET /api/v2/parcels/kpis
 * GET /api/v2/parcels/alerts
 * GET /api/v2/parcels/critical
 * GET /api/v2/parcels/reconciliation
 * GET /api/v2/parcels/:ref
 * GET /api/v2/parcels/:ref/timeline
 */

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const {
  cached,
  setCache,
  computeParcelAlerts,
  reconcileParcel,
  checkScanSequence,
} = require('./helpers');

// ═══════════════════════════════════════════════════════════════════════
// 1. GET / — Liste complète avec agrégats
// ═══════════════════════════════════════════════════════════════════════

router.get('/', async (req, res, next) => {
  try {
    const { status, island, search, sort, order: sortOrder } = req.query;

    const where  = [];
    const params = [];
    let idx = 1;

    if (status) {
      where.push(`p.status = $${idx++}`);
      params.push(status);
    }
    if (island) {
      where.push(`p.destination_island = $${idx++}`);
      params.push(island);
    }
    if (search) {
      where.push(`(p.reference ILIKE $${idx} OR p.recipient_name ILIKE $${idx} OR o.reference ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    if (req.user?.role === 'agent_relais') {
      where.push(`COALESCE(p.relay_id, p.relais_id, o.relais_id) = $${idx++}`);
      params.push(req.agentRelaisId);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const sortCol = {
      reference:  'p.reference',
      status:     'p.status',
      created_at: 'p.created_at',
      total_kmf:  'total_kmf',
      island:     'p.destination_island',
    }[sort] || 'p.created_at';
    const sortDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const { rows } = await db.query(`
      SELECT
        p.id, p.reference, p.status, p.destination_island,
        p.recipient_name, p.recipient_phone,
        p.weight_kg, p.eta,
        p.created_at, p.shipped_at, p.in_transit_at,
        p.available_at, p.collected_at,
        r.name AS relais_name, r.island AS relais_island,

        -- Agrégats via parcel_items → order_items → orders
        COALESCE(agg.nb_clients, 0)::int AS nb_clients,
        COALESCE(agg.nb_orders, 0)::int AS nb_orders,
        COALESCE(agg.nb_items, 0)::int AS nb_items,
        COALESCE(agg.total_kmf, 0)::int AS total_kmf,

        -- Dernier scan
        ls.event_type AS last_scan_type,
        ls.created_at AS last_scan_at,
        ls.location AS last_scan_location,
        ls.actor_name AS last_scan_actor,

        -- Incidents
        COALESCE(inc.open_count, 0)::int AS open_incidents,
        COALESCE(inc.critical_count, 0)::int AS critical_incidents,

        -- Ordre principal (fallback 1:1)
        o.reference AS main_order_ref

      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = COALESCE(p.relay_id, p.relais_id, o.relais_id)

      -- Agrégats multi-client via parcel_items
      LEFT JOIN LATERAL (
        SELECT
          COUNT(DISTINCT sub_o.user_id) AS nb_clients,
          COUNT(DISTINCT sub_o.id) AS nb_orders,
          SUM(pi.quantity) AS nb_items,
          (
            SELECT COALESCE(SUM(order_totals.total_kmf), 0)
            FROM (
              SELECT DISTINCT sub_o2.id, sub_o2.total_kmf
              FROM parcel_items pi2
              JOIN order_items oi2 ON oi2.id = pi2.order_item_id
              JOIN orders sub_o2 ON sub_o2.id = oi2.order_id
              WHERE pi2.parcel_id = p.id
            ) order_totals
          ) AS total_kmf
        FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN orders sub_o ON sub_o.id = oi.order_id
        WHERE pi.parcel_id = p.id
      ) agg ON true

      -- Dernier scan
      LEFT JOIN LATERAL (
        SELECT se.event_type, se.created_at, se.location, se.actor_name
        FROM scan_events se
        WHERE se.parcel_id = p.id
        ORDER BY se.created_at DESC
        LIMIT 1
      ) ls ON true

      -- Incidents ouverts
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE i.status IN ('open','investigating')) AS open_count,
          COUNT(*) FILTER (WHERE i.severity = 'critical' AND i.status IN ('open','investigating')) AS critical_count
        FROM incidents i
        WHERE i.parcel_id = p.id
      ) inc ON true

      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
    `, params);

    const parcels = rows.map(p => {
      if (p.nb_orders === 0 && p.main_order_ref) {
        p.nb_clients = 1;
        p.nb_orders  = 1;
      }
      p.alerts = computeParcelAlerts(p);

      return {
        id:                 p.id,
        reference:          p.reference,
        status:             p.status,
        destination_island: p.destination_island,
        recipient_name:     p.recipient_name,
        recipient_phone:    p.recipient_phone,
        relais_name:        p.relais_name,
        relais_island:      p.relais_island,
        weight_kg:          p.weight_kg ? Number(p.weight_kg) : null,
        eta:                p.eta,
        created_at:         p.created_at,
        shipped_at:         p.shipped_at,
        in_transit_at:      p.in_transit_at,
        available_at:       p.available_at,
        collected_at:       p.collected_at,
        nb_clients:         p.nb_clients,
        nb_orders:          p.nb_orders,
        nb_items:           p.nb_items,
        total_kmf:          Number(p.total_kmf) || 0,
        last_scan: p.last_scan_type ? {
          type:     p.last_scan_type,
          at:       p.last_scan_at,
          location: p.last_scan_location,
          actor:    p.last_scan_actor,
        } : null,
        open_incidents:     p.open_incidents,
        critical_incidents: p.critical_incidents,
        alerts:             p.alerts,
        main_order_ref:     p.main_order_ref,
      };
    });

    res.json({ count: parcels.length, parcels });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 2. GET /kpis — KPIs par statut
// ═══════════════════════════════════════════════════════════════════════

router.get('/kpis', async (req, res, next) => {
  try {
    const hit = cached('parcel_kpis');
    if (hit) return res.json(hit);

    const { rows: [kpi] } = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE status = 'preparation')::int AS preparation,
        COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped,
        COUNT(*) FILTER (WHERE status = 'in_transit')::int AS in_transit,
        COUNT(*) FILTER (WHERE status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE status = 'collected')::int AS collected,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled'))::int AS active
      FROM parcels
    `);

    const { rows: byIsland } = await db.query(`
      SELECT destination_island AS island, status, COUNT(*)::int AS count
      FROM parcels
      WHERE status NOT IN ('collected','cancelled')
      GROUP BY destination_island, status
      ORDER BY destination_island, status
    `);

    const islands = {};
    for (const r of byIsland) {
      if (!islands[r.island]) islands[r.island] = {};
      islands[r.island][r.status] = r.count;
    }

    const { rows: [finance] } = await db.query(`
      SELECT
        COALESCE(SUM(o.total_kmf), 0)::int AS ca_total_kmf,
        COALESCE(SUM(o.total_kmf) FILTER (WHERE p.status NOT IN ('collected','cancelled')), 0)::int AS ca_active_kmf,
        COALESCE(SUM(o.total_kmf) FILTER (WHERE p.status = 'collected'), 0)::int AS ca_collected_kmf,
        COALESCE(AVG(o.total_kmf), 0)::int AS avg_basket_kmf,
        COUNT(DISTINCT o.user_id)::int AS nb_clients
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
    `);

    const { rows: [incKpi] } = await db.query(`
      SELECT
        COUNT(*)::int AS total_incidents,
        COUNT(*) FILTER (WHERE status IN ('open','investigating'))::int AS open_incidents,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status IN ('open','investigating'))::int AS critical_incidents
      FROM incidents
    `);

    const result = {
      parcels: {
        total:  kpi.total,
        active: kpi.active,
        by_status: {
          draft:       kpi.draft,
          preparation: kpi.preparation,
          shipped:     kpi.shipped,
          in_transit:  kpi.in_transit,
          available:   kpi.available,
          collected:   kpi.collected,
          cancelled:   kpi.cancelled,
        },
        by_island: islands,
      },
      finance: {
        ca_total_kmf:     Number(finance.ca_total_kmf),
        ca_active_kmf:    Number(finance.ca_active_kmf),
        ca_collected_kmf: Number(finance.ca_collected_kmf),
        avg_basket_kmf:   Number(finance.avg_basket_kmf),
        nb_clients:       finance.nb_clients,
      },
      incidents: {
        total:    incKpi.total_incidents,
        open:     incKpi.open_incidents,
        critical: incKpi.critical_incidents,
      },
    };

    setCache('parcel_kpis', result);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 3. GET /alerts — Alertes calculées
// ═══════════════════════════════════════════════════════════════════════

router.get('/alerts', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        p.id, p.reference, p.status, p.destination_island,
        p.recipient_name, p.recipient_phone,
        p.created_at, p.shipped_at, p.in_transit_at, p.available_at,
        r.name AS relais_name,
        COALESCE(inc.open_count, 0)::int AS open_incidents,
        COALESCE(inc.critical_count, 0)::int AS critical_incidents
      FROM parcels p
      LEFT JOIN relais r ON r.id = COALESCE(p.relay_id, p.relais_id)
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE i.status IN ('open','investigating')) AS open_count,
          COUNT(*) FILTER (WHERE i.severity = 'critical' AND i.status IN ('open','investigating')) AS critical_count
        FROM incidents i WHERE i.parcel_id = p.id
      ) inc ON true
      WHERE p.status NOT IN ('collected','cancelled')
    `);

    const allAlerts = [];
    for (const p of rows) {
      const alerts = computeParcelAlerts(p);
      for (const a of alerts) {
        allAlerts.push({
          ...a,
          parcel_id:          p.id,
          parcel_ref:         p.reference,
          destination_island: p.destination_island,
          recipient_name:     p.recipient_name,
          relais_name:        p.relais_name,
        });
      }
    }

    const severityOrder = { critical: 0, high: 1, warning: 2, info: 3 };
    allAlerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

    const operational = [];
    const byIsland    = {};
    for (const p of rows) {
      const isl = p.destination_island || 'Inconnu';
      if (!byIsland[isl]) byIsland[isl] = { stagnant: 0, delayed: 0, incidents: 0 };
      if (p.status === 'in_transit' || p.status === 'shipped') byIsland[isl].stagnant++;
      if (p.open_incidents > 0) byIsland[isl].incidents += p.open_incidents;
    }
    for (const [isl, counts] of Object.entries(byIsland)) {
      if (counts.stagnant >= 5) {
        operational.push({ type: 'island_congestion', severity: 'warning', island: isl, count: counts.stagnant, message: `${counts.stagnant} colis en attente vers ${isl}` });
      }
      if (counts.incidents >= 3) {
        operational.push({ type: 'island_incidents', severity: 'high', island: isl, count: counts.incidents, message: `${counts.incidents} incidents ouverts sur ${isl}` });
      }
    }

    res.json({ count: allAlerts.length, alerts: allAlerts, operational });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 4. GET /critical — File colis critiques
// ═══════════════════════════════════════════════════════════════════════

router.get('/critical', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        p.id, p.reference, p.status, p.destination_island,
        p.recipient_name, p.recipient_phone,
        p.created_at, p.shipped_at, p.in_transit_at, p.available_at,
        r.name AS relais_name,
        o.reference AS main_order_ref, o.total_kmf,
        COALESCE(inc.open_count, 0)::int AS open_incidents,
        COALESCE(inc.critical_count, 0)::int AS critical_incidents
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = COALESCE(p.relay_id, p.relais_id, o.relais_id)
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE i.status IN ('open','investigating')) AS open_count,
          COUNT(*) FILTER (WHERE i.severity = 'critical' AND i.status IN ('open','investigating')) AS critical_count
        FROM incidents i WHERE i.parcel_id = p.id
      ) inc ON true
      WHERE p.status NOT IN ('collected','cancelled')
        AND (
          inc.critical_count > 0
          OR (p.status = 'in_transit' AND p.shipped_at < NOW() - INTERVAL '5 days')
          OR (p.status = 'available' AND p.available_at < NOW() - INTERVAL '3 days')
          OR (p.status = 'preparation' AND p.created_at < NOW() - INTERVAL '2 days')
        )
      ORDER BY
        CASE WHEN inc.critical_count > 0 THEN 0 ELSE 1 END,
        p.created_at ASC
    `);

    res.json({
      count:   rows.length,
      parcels: rows.map(p => ({
        id:                 p.id,
        reference:          p.reference,
        status:             p.status,
        destination_island: p.destination_island,
        recipient_name:     p.recipient_name,
        relais_name:        p.relais_name,
        main_order_ref:     p.main_order_ref,
        total_kmf:          Number(p.total_kmf) || 0,
        open_incidents:     p.open_incidents,
        critical_incidents: p.critical_incidents,
        alerts:             computeParcelAlerts(p),
      })),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 5. GET /reconciliation — File réconciliation
// ═══════════════════════════════════════════════════════════════════════

router.get('/reconciliation', async (req, res, next) => {
  try {
    const { rows: parcels } = await db.query(`
      SELECT
        p.id, p.reference, p.status, p.destination_island,
        p.recipient_name, p.items_count, p.total_qty,
        p.created_at, p.available_at,
        o.reference AS main_order_ref, o.status AS order_status,
        o.total_kmf, o.payment_mode, o.payment_status
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.status NOT IN ('collected','cancelled','draft')
      ORDER BY p.reference
    `);

    const { rows: scanCounts } = await db.query(`
      SELECT parcel_id, COUNT(*)::int AS scan_count,
        array_agg(event_type ORDER BY created_at) AS scan_sequence
      FROM scan_events
      GROUP BY parcel_id
    `);
    const scanMap = {};
    for (const s of scanCounts) {
      scanMap[s.parcel_id] = { count: s.scan_count, sequence: s.scan_sequence };
    }

    const result = parcels.map(p => {
      const scans = scanMap[p.id] || { count: 0, sequence: [] };

      const checks = {
        content_match:    true,
        status_sync:      p.order_status === p.status || p.status === 'preparation',
        payment_sync:     !(p.payment_mode === 'cash_relais' && p.payment_status !== 'paid'),
        scan_sequence_ok: checkScanSequence(scans.sequence),
        delivery_ready:   p.payment_status === 'paid' || p.payment_mode !== 'cash_relais',
      };

      const issues = [];
      if (!checks.status_sync)      issues.push(`Statut désynchronisé: colis=${p.status}, commande=${p.order_status}`);
      if (!checks.payment_sync)     issues.push(`⚠️ ÉTAT IMPOSSIBLE: Cash relais non payé — ce colis ne devrait pas exister`);
      if (!checks.scan_sequence_ok) issues.push(`Séquence de scans incohérente`);
      if (!checks.delivery_ready)   issues.push(`⚠️ ÉTAT IMPOSSIBLE: Paiement non confirmé — ce colis ne devrait pas exister`);

      const hasBlocking = issues.length > 0 && (!checks.scan_sequence_ok || !checks.delivery_ready);
      const hasWarning  = issues.length > 0;

      return {
        reference:          p.reference,
        status:             p.status,
        destination_island: p.destination_island,
        recipient_name:     p.recipient_name,
        main_order_ref:     p.main_order_ref,
        total_kmf:          Number(p.total_kmf) || 0,
        payment_mode:       p.payment_mode,
        scan_count:         scans.count,
        reconciliation: {
          status: hasBlocking ? 'blocked' : hasWarning ? 'warning' : 'ok',
          checks,
          issues,
        },
      };
    });

    const blocked  = result.filter(r => r.reconciliation.status === 'blocked');
    const warnings = result.filter(r => r.reconciliation.status === 'warning');
    const ok       = result.filter(r => r.reconciliation.status === 'ok');

    res.json({
      summary: {
        total:   result.length,
        blocked: blocked.length,
        warning: warnings.length,
        ok:      ok.length,
      },
      parcels: [...blocked, ...warnings, ...ok],
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 6. GET /:ref — Détail complet hiérarchique
// ═══════════════════════════════════════════════════════════════════════

router.get('/:ref', async (req, res, next) => {
  try {
    const { ref } = req.params;

    const { rows: [parcel] } = await db.query(`
      SELECT
        p.*,
        r.name AS relais_name, r.island AS relais_island, r.address AS relais_address,
        o.reference AS main_order_ref
      FROM parcels p
      LEFT JOIN relais r ON r.id = COALESCE(p.relay_id, p.relais_id)
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.reference = $1 OR p.id::text = $1
    `, [ref]);

    if (!parcel) {
      return res.status(404).json({ error: `Colis ${ref} introuvable` });
    }

    const { rows: scans } = await db.query(`
      SELECT event_type, status, actor_name, actor_role, location,
        notes, created_at
      FROM scan_events
      WHERE parcel_id = $1
      ORDER BY created_at ASC
    `, [parcel.id]);

    const { rows: incidents } = await db.query(`
      SELECT id, incident_type, severity, status, title, description,
        client_impact, detected_source, created_at, resolved_at
      FROM incidents
      WHERE parcel_id = $1
      ORDER BY created_at DESC
    `, [parcel.id]);

    const { rows: itemRows } = await db.query(`
      SELECT
        u.id AS user_id, u.full_name AS client_name, u.phone AS client_phone,
        o.id AS order_id, o.reference AS order_ref, o.status AS order_status,
        o.total_kmf, o.payment_mode, o.payment_status,
        oi.id AS item_id, oi.quantity, oi.price_kmf,
        pr.name AS product_name, pr.image_url, pr.emoji AS product_emoji,
        pi.product_name AS pi_product_name
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE pi.parcel_id = $1
      ORDER BY u.full_name, o.reference, pr.name
    `, [parcel.id]);

    const clientMap = new Map();
    for (const row of itemRows) {
      const clientKey = row.user_id || 'unknown';
      if (!clientMap.has(clientKey)) {
        clientMap.set(clientKey, {
          user_id: row.user_id,
          name:    row.client_name || parcel.recipient_name || 'Client',
          phone:   row.client_phone || parcel.recipient_phone || '',
          orders:  new Map(),
        });
      }
      const client = clientMap.get(clientKey);

      if (!client.orders.has(row.order_id)) {
        client.orders.set(row.order_id, {
          id:             row.order_id,
          reference:      row.order_ref,
          status:         row.order_status,
          total_kmf:      Number(row.total_kmf),
          payment_mode:   row.payment_mode,
          payment_status: row.payment_status,
          items:          [],
        });
      }
      client.orders.get(row.order_id).items.push({
        id:           row.item_id,
        product_name: row.product_name || row.pi_product_name || 'Produit inconnu',
        quantity:     row.quantity,
        price_kmf:    Number(row.price_kmf),
        image_url:    row.image_url,
        emoji:        row.product_emoji,
      });
    }

    const clients = Array.from(clientMap.values()).map(cl => ({
      ...cl,
      orders: Array.from(cl.orders.values()),
    }));

    // Fallback: si pas de parcel_items, utiliser parcels.order_id
    if (clients.length === 0 && parcel.order_id) {
      const { rows: [mainOrder] } = await db.query(`
        SELECT o.*, u.full_name AS client_name, u.phone AS client_phone
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.id = $1
      `, [parcel.order_id]);

      if (mainOrder) {
        const { rows: mainItems } = await db.query(`
          SELECT oi.id AS item_id, oi.quantity, oi.price_kmf,
            pr.name AS product_name, pr.image_url, pr.emoji AS product_emoji
          FROM order_items oi
          LEFT JOIN products pr ON pr.id = oi.product_id
          WHERE oi.order_id = $1
        `, [mainOrder.id]);

        clients.push({
          user_id: mainOrder.user_id,
          name:    mainOrder.client_name || parcel.recipient_name || 'Client',
          phone:   mainOrder.client_phone || parcel.recipient_phone || '',
          orders: [{
            id:             mainOrder.id,
            reference:      mainOrder.reference,
            status:         mainOrder.status,
            total_kmf:      Number(mainOrder.total_kmf),
            payment_mode:   mainOrder.payment_mode,
            payment_status: mainOrder.payment_status,
            items: mainItems.map(i => ({
              id:           i.item_id,
              product_name: i.product_name || 'Produit',
              quantity:     i.quantity,
              price_kmf:    Number(i.price_kmf),
              image_url:    i.image_url,
              emoji:        i.product_emoji,
            })),
          }],
        });
      }
    }

    const parcelForRecon = { ...parcel, clients, scans, incidents };
    const reconciliation = reconcileParcel(parcelForRecon);

    res.json({
      id:                 parcel.id,
      reference:          parcel.reference,
      status:             parcel.status,
      type:               parcel.type,
      destination_island: parcel.destination_island,
      relais: {
        name:    parcel.relais_name,
        island:  parcel.relais_island,
        address: parcel.relais_address,
      },
      recipient_name:  parcel.recipient_name,
      recipient_phone: parcel.recipient_phone,
      weight_kg:       parcel.weight_kg ? Number(parcel.weight_kg) : null,
      eta:             parcel.eta,
      pickup_code:     parcel.pickup_code,
      created_at:      parcel.created_at,
      shipped_at:      parcel.shipped_at,
      in_transit_at:   parcel.in_transit_at,
      available_at:    parcel.available_at,
      collected_at:    parcel.collected_at,
      clients,
      nb_clients: clients.length,
      nb_orders:  clients.reduce((sum, c) => sum + c.orders.length, 0),
      nb_items:   clients.reduce((sum, c) => sum + c.orders.reduce((s2, o) => s2 + o.items.reduce((s3, i) => s3 + i.quantity, 0), 0), 0),
      total_kmf:  clients.reduce((sum, c) => sum + c.orders.reduce((s2, o) => s2 + o.total_kmf, 0), 0),
      scans,
      incidents,
      reconciliation,
      alerts: computeParcelAlerts({
        ...parcel,
        open_incidents:     incidents.filter(i => ['open','investigating'].includes(i.status)).length,
        critical_incidents: incidents.filter(i => i.severity === 'critical' && ['open','investigating'].includes(i.status)).length,
      }),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 7. GET /:ref/timeline — Timeline scans
// ═══════════════════════════════════════════════════════════════════════

router.get('/:ref/timeline', async (req, res, next) => {
  try {
    const { ref } = req.params;

    const { rows: [parcel] } = await db.query(
      `SELECT id, reference, status, eta FROM parcels WHERE reference = $1 OR id::text = $1`, [ref]
    );
    if (!parcel) return res.status(404).json({ error: `Colis ${ref} introuvable` });

    const { rows: scans } = await db.query(`
      SELECT event_type, status, actor_name, actor_role, location,
        notes, created_at
      FROM scan_events
      WHERE parcel_id = $1
      ORDER BY created_at ASC
    `, [parcel.id]);

    const steps      = ['preparation', 'shipped', 'in_transit', 'arrived', 'available', 'collected'];
    const completed  = new Set(scans.map(s => s.event_type));
    const currentIdx = steps.findIndex(s => s === parcel.status);
    const nextStep   = currentIdx < steps.length - 1 ? steps[currentIdx + 1] : null;

    res.json({
      reference:          parcel.reference,
      status:             parcel.status,
      eta:                parcel.eta,
      scans,
      next_expected_step: nextStep,
      steps: steps.map(s => ({
        step:      s,
        completed: completed.has(s),
        current:   s === parcel.status,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
