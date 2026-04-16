/**
 * ═══════════════════════════════════════════════════════════════════════
 * PARCEL-FIRST API v2 — Komerce
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Principe fondamental : Le terrain manipule des COLIS, pas des commandes.
 * 
 * Hiérarchie : COLIS → CLIENTS → COMMANDES → ARTICLES
 * 
 * Endpoints:
 *   GET  /api/v2/parcels              → Liste colis + agrégats
 *   GET  /api/v2/parcels/kpis         → KPIs par statut
 *   GET  /api/v2/parcels/alerts       → Alertes calculées
 *   GET  /api/v2/parcels/critical     → File colis critiques
 *   GET  /api/v2/parcels/reconciliation → File réconciliation
 *   GET  /api/v2/parcels/:ref         → Détail complet hiérarchique
 *   GET  /api/v2/parcels/:ref/timeline → Timeline scans
 *   POST /api/v2/parcels/:ref/scan    → Scanner + sync commandes
 * ═══════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { transitionOrderStatus } = require('../services/order-status-machine');

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

/** Cache simple en mémoire (TTL 30s) */
const _cache = {};
function cached(key) {
  const entry = _cache[key];
  if (entry && Date.now() - entry.ts < 30_000) return entry.data;
  return null;
}
function setCache(key, data) {
  _cache[key] = { data, ts: Date.now() };
}
function clearCache() {
  for (const k of Object.keys(_cache)) delete _cache[k];
}

/** Status ordering for parcels */
const STATUS_ORDER = {
  draft: 0, preparation: 1, shipped: 2, in_transit: 3,
  available: 4, collected: 5, cancelled: 6
};

/** SLA rules (hours) */
const SLA = {
  preparation_max_hours: 48,
  transit_max_hours: 120,     // 5 jours
  available_max_hours: 72,    // 3 jours avant rappel
  available_critical_hours: 168, // 7 jours = critique
};

// ═══════════════════════════════════════════════════════════════════════
// SYNC LOGIC — syncParcelToOrders
// ═══════════════════════════════════════════════════════════════════════

/**
 * Synchronise le statut d'un colis vers toutes ses commandes.
 * Règle : si parcel = in_transit → orders = in_transit, etc.
 * 
 * ✅ Phase 3 FIX: Uses transitionOrderStatus() instead of direct SQL.
 *    State machine handles: validation, timestamps, history, side effects.
 */
async function syncParcelToOrders(client, parcelId, newStatus) {
  const statusMap = {
    shipped: 'shipped',
    in_transit: 'in_transit',
    available: 'available',
    collected: 'collected',
    cancelled: 'cancelled',
  };

  const orderStatus = statusMap[newStatus];
  if (!orderStatus) return 0; // draft, preparation → no sync

  // Find all orders linked to this parcel (via parcel_items or parcels.order_id)
  const { rows: orderIds } = await client.query(`
    SELECT DISTINCT o.id 
    FROM orders o
    WHERE o.id IN (
      -- Via parcels.order_id (direct 1:1)
      SELECT order_id FROM parcels WHERE id = $1 AND order_id IS NOT NULL
      UNION
      -- Via parcel_items → order_items → orders (multi-order)
      SELECT oi.order_id
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      WHERE pi.parcel_id = $1
    )
  `, [parcelId]);

  let synced = 0;
  for (const { id: orderId } of orderIds) {
    const result = await transitionOrderStatus({
      orderId,
      newStatus: orderStatus,
      actor: { id: null, role: 'system' },
      source: 'scan',
      note: `Synced from parcel scan: ${newStatus}`,
      dbClient: client,
    });
    if (result.success) {
      synced++;
    } else {
      // Non-fatal: log and continue (e.g. order already at target status)
      console.warn(`[PARCEL-SYNC] transition ${orderStatus} failed for order ${orderId}: ${result.error}`);
    }
  }

  return synced;
}

// ═══════════════════════════════════════════════════════════════════════
// RECONCILIATION LOGIC
// ═══════════════════════════════════════════════════════════════════════

function reconcileParcel(parcel) {
  const checks = {
    content_match: true,
    status_sync: true,
    payment_sync: true,
    scan_sequence_ok: true,
    delivery_ready: true,
  };
  const issues = [];

  // 1. Content match: articles colis == articles commandes
  if (parcel.clients) {
    let expectedItems = 0;
    let actualItems = parcel.items_count || 0;
    for (const cl of parcel.clients) {
      for (const ord of cl.orders || []) {
        for (const it of ord.items || []) {
          expectedItems += it.quantity || 1;
        }
      }
    }
    if (expectedItems > 0 && actualItems > 0 && expectedItems !== actualItems) {
      checks.content_match = false;
      issues.push({
        check: 'content_match',
        message: `Attendu ${expectedItems} articles, trouvé ${actualItems} dans le colis`,
        severity: 'warning'
      });
    }
  }

  // 2. Status sync: toutes les commandes ont le même statut que le colis
  if (parcel.clients) {
    for (const cl of parcel.clients) {
      for (const ord of cl.orders || []) {
        if (ord.status !== parcel.status && parcel.status !== 'preparation' && parcel.status !== 'draft') {
          checks.status_sync = false;
          issues.push({
            check: 'status_sync',
            message: `Commande ${ord.reference} en "${ord.status}" mais colis en "${parcel.status}"`,
            severity: 'warning'
          });
        }
      }
    }
  }

  // 3. Scan sequence: prep → ship → transit → avail → collected
  if (parcel.scans && parcel.scans.length > 0) {
    const seqOrder = { preparation: 0, shipped: 1, in_transit: 2, arrived: 3, available: 4, collected: 5 };
    let lastSeq = -1;
    for (const scan of parcel.scans) {
      const seq = seqOrder[scan.event_type] ?? -1;
      if (seq >= 0 && seq < lastSeq) {
        checks.scan_sequence_ok = false;
        issues.push({
          check: 'scan_sequence_ok',
          message: `Scan "${scan.event_type}" après un scan plus avancé`,
          severity: 'high'
        });
        break;
      }
      if (seq >= 0) lastSeq = seq;
    }
  }

  // 4. Payment sync
  if (parcel.clients) {
    for (const cl of parcel.clients) {
      for (const ord of cl.orders || []) {
        if (ord.payment_mode === 'cash_relais' && ord.payment_status !== 'paid') {
          // RÈGLE MÉTIER: Pas de paiement confirmé = pas de commande = pas de colis
          // Un colis ne devrait JAMAIS exister avec une commande cash_relais impayée
          checks.payment_sync = false;
          issues.push({
            check: 'payment_sync',
            message: `⚠️ ÉTAT IMPOSSIBLE: Colis existe avec commande ${ord.reference} cash relais impayée`,
            severity: 'critical'
          });
        }
      }
    }
  }

  // 5. Delivery ready
  if (parcel.status === 'available') {
    if (parcel.incidents && parcel.incidents.some(i => i.status === 'open' && i.severity === 'critical')) {
      checks.delivery_ready = false;
      issues.push({
        check: 'delivery_ready',
        message: 'Incident critique non résolu — remise bloquée',
        severity: 'critical'
      });
    }
  }

  // Overall status
  const hasBlocking = issues.some(i => i.severity === 'critical' || i.severity === 'high');
  const hasWarning = issues.some(i => i.severity === 'warning');

  return {
    status: hasBlocking ? 'blocked' : hasWarning ? 'warning' : 'ok',
    checks,
    issues,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ALERT ENGINE
// ═══════════════════════════════════════════════════════════════════════

function computeParcelAlerts(parcel) {
  const alerts = [];
  const now = new Date();

  function hoursSince(dateStr) {
    if (!dateStr) return Infinity;
    return (now - new Date(dateStr)) / 3_600_000;
  }

  // Stuck in preparation
  if (parcel.status === 'preparation') {
    const hours = hoursSince(parcel.created_at);
    if (hours > SLA.preparation_max_hours) {
      alerts.push({
        type: 'stuck_preparation',
        severity: 'warning',
        message: `Colis en préparation depuis ${Math.round(hours)}h (SLA: ${SLA.preparation_max_hours}h)`,
        parcel_ref: parcel.reference,
      });
    }
  }

  // Transit out of SLA
  if (parcel.status === 'in_transit') {
    const hours = hoursSince(parcel.shipped_at || parcel.in_transit_at);
    if (hours > SLA.transit_max_hours) {
      alerts.push({
        type: 'sla_breach_transit',
        severity: 'critical',
        message: `Colis en transit depuis ${Math.round(hours)}h (SLA: ${SLA.transit_max_hours}h)`,
        parcel_ref: parcel.reference,
      });
    }
  }

  // Available not collected
  if (parcel.status === 'available') {
    const hours = hoursSince(parcel.available_at);
    if (hours > SLA.available_critical_hours) {
      alerts.push({
        type: 'uncollected_critical',
        severity: 'critical',
        message: `Colis disponible non retiré depuis ${Math.round(hours / 24)} jours`,
        parcel_ref: parcel.reference,
      });
    } else if (hours > SLA.available_max_hours) {
      alerts.push({
        type: 'uncollected_warning',
        severity: 'warning',
        message: `Colis disponible non retiré depuis ${Math.round(hours / 24)} jours`,
        parcel_ref: parcel.reference,
      });
    }
  }

  // Open incidents
  if (parcel.open_incidents > 0) {
    alerts.push({
      type: 'open_incident',
      severity: parcel.critical_incidents > 0 ? 'critical' : 'warning',
      message: `${parcel.open_incidents} incident(s) ouvert(s)${parcel.critical_incidents > 0 ? ' dont critique(s)' : ''}`,
      parcel_ref: parcel.reference,
    });
  }

  return alerts;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. GET /api/v2/parcels — Liste complète avec agrégats
// ═══════════════════════════════════════════════════════════════════════

router.get('/', async (req, res, next) => {
  try {
    const { status, island, search, sort, order: sortOrder } = req.query;

    let where = [];
    let params = [];
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

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const sortCol = {
      reference: 'p.reference',
      status: 'p.status',
      created_at: 'p.created_at',
      total_kmf: 'total_kmf',
      island: 'p.destination_island',
    }[sort] || 'p.created_at';
    const sortDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const { rows } = await db.query(`
      SELECT 
        p.id, p.reference, p.status, p.destination_island,
        p.recipient_name, p.recipient_phone,
        p.weight_kg, p.eta, p.pickup_code,
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
          SUM(DISTINCT sub_o.total_kmf) AS total_kmf
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

    // Fallback: si pas de parcel_items, utiliser parcels.order_id
    const parcels = rows.map(p => {
      // Si agrégats vides, fallback sur la commande principale
      if (p.nb_orders === 0 && p.main_order_ref) {
        p.nb_clients = 1;
        p.nb_orders = 1;
      }
      
      // Calculer alertes
      p.alerts = computeParcelAlerts(p);

      return {
        id: p.id,
        reference: p.reference,
        status: p.status,
        destination_island: p.destination_island,
        recipient_name: p.recipient_name,
        recipient_phone: p.recipient_phone,
        relais_name: p.relais_name,
        relais_island: p.relais_island,
        weight_kg: p.weight_kg ? Number(p.weight_kg) : null,
        eta: p.eta,
        pickup_code: p.pickup_code,
        created_at: p.created_at,
        shipped_at: p.shipped_at,
        in_transit_at: p.in_transit_at,
        available_at: p.available_at,
        collected_at: p.collected_at,
        nb_clients: p.nb_clients,
        nb_orders: p.nb_orders,
        nb_items: p.nb_items,
        total_kmf: Number(p.total_kmf) || 0,
        last_scan: p.last_scan_type ? {
          type: p.last_scan_type,
          at: p.last_scan_at,
          location: p.last_scan_location,
          actor: p.last_scan_actor,
        } : null,
        open_incidents: p.open_incidents,
        critical_incidents: p.critical_incidents,
        alerts: p.alerts,
        main_order_ref: p.main_order_ref,
      };
    });

    res.json({
      count: parcels.length,
      parcels,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 2. GET /api/v2/parcels/kpis — KPIs par statut
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

    // Group by island
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
        total: kpi.total,
        active: kpi.active,
        by_status: {
          draft: kpi.draft,
          preparation: kpi.preparation,
          shipped: kpi.shipped,
          in_transit: kpi.in_transit,
          available: kpi.available,
          collected: kpi.collected,
          cancelled: kpi.cancelled,
        },
        by_island: islands,
      },
      finance: {
        ca_total_kmf: Number(finance.ca_total_kmf),
        ca_active_kmf: Number(finance.ca_active_kmf),
        ca_collected_kmf: Number(finance.ca_collected_kmf),
        avg_basket_kmf: Number(finance.avg_basket_kmf),
        nb_clients: finance.nb_clients,
      },
      incidents: {
        total: incKpi.total_incidents,
        open: incKpi.open_incidents,
        critical: incKpi.critical_incidents,
      },
    };

    setCache('parcel_kpis', result);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 3. GET /api/v2/parcels/alerts — Alertes calculées
// ═══════════════════════════════════════════════════════════════════════

router.get('/alerts', async (req, res, next) => {
  try {
    // Only active parcels
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
          parcel_id: p.id,
          parcel_ref: p.reference,
          destination_island: p.destination_island,
          recipient_name: p.recipient_name,
          relais_name: p.relais_name,
        });
      }
    }

    // Sort: critical first, then warning
    const severityOrder = { critical: 0, high: 1, warning: 2, info: 3 };
    allAlerts.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

    // Operational alerts (aggregate)
    const operational = [];
    const byIsland = {};
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

    res.json({
      count: allAlerts.length,
      alerts: allAlerts,
      operational,
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 4. GET /api/v2/parcels/critical — File colis critiques
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
          -- Colis avec incident critique
          inc.critical_count > 0
          -- OU en transit depuis trop longtemps
          OR (p.status = 'in_transit' AND p.shipped_at < NOW() - INTERVAL '5 days')
          -- OU disponible non retiré depuis 3+ jours
          OR (p.status = 'available' AND p.available_at < NOW() - INTERVAL '3 days')
          -- OU en préparation depuis 2+ jours
          OR (p.status = 'preparation' AND p.created_at < NOW() - INTERVAL '2 days')
        )
      ORDER BY 
        CASE WHEN inc.critical_count > 0 THEN 0 ELSE 1 END,
        p.created_at ASC
    `);

    res.json({
      count: rows.length,
      parcels: rows.map(p => ({
        id: p.id,
        reference: p.reference,
        status: p.status,
        destination_island: p.destination_island,
        recipient_name: p.recipient_name,
        relais_name: p.relais_name,
        main_order_ref: p.main_order_ref,
        total_kmf: Number(p.total_kmf) || 0,
        open_incidents: p.open_incidents,
        critical_incidents: p.critical_incidents,
        alerts: computeParcelAlerts(p),
      })),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 5. GET /api/v2/parcels/reconciliation — File réconciliation
// ═══════════════════════════════════════════════════════════════════════

router.get('/reconciliation', async (req, res, next) => {
  try {
    // Get all active parcels with full data for reconciliation
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

    // Get scan info for each parcel
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
      
      // Simplified reconciliation
      const checks = {
        content_match: true, // Need parcel_items data for full check
        status_sync: p.order_status === p.status || p.status === 'preparation',
        payment_sync: !(p.payment_mode === 'cash_relais' && p.payment_status !== 'paid'), // RÈGLE: cash_relais impayé + colis = impossible
        scan_sequence_ok: checkScanSequence(scans.sequence),
        delivery_ready: p.payment_status === 'paid' || p.payment_mode !== 'cash_relais', // RÈGLE: cash_relais non payé = pas de colis
      };

      const issues = [];
      if (!checks.status_sync) issues.push(`Statut désynchronisé: colis=${p.status}, commande=${p.order_status}`);
      if (!checks.payment_sync) issues.push(`⚠️ ÉTAT IMPOSSIBLE: Cash relais non payé — ce colis ne devrait pas exister`);
      if (!checks.scan_sequence_ok) issues.push(`Séquence de scans incohérente`);
      if (!checks.delivery_ready) issues.push(`⚠️ ÉTAT IMPOSSIBLE: Paiement non confirmé — ce colis ne devrait pas exister`);

      const hasBlocking = issues.length > 0 && (!checks.scan_sequence_ok || !checks.delivery_ready);
      const hasWarning = issues.length > 0;

      return {
        reference: p.reference,
        status: p.status,
        destination_island: p.destination_island,
        recipient_name: p.recipient_name,
        main_order_ref: p.main_order_ref,
        total_kmf: Number(p.total_kmf) || 0,
        payment_mode: p.payment_mode,
        scan_count: scans.count,
        reconciliation: {
          status: hasBlocking ? 'blocked' : hasWarning ? 'warning' : 'ok',
          checks,
          issues,
        }
      };
    });

    const blocked = result.filter(r => r.reconciliation.status === 'blocked');
    const warnings = result.filter(r => r.reconciliation.status === 'warning');
    const ok = result.filter(r => r.reconciliation.status === 'ok');

    res.json({
      summary: {
        total: result.length,
        blocked: blocked.length,
        warning: warnings.length,
        ok: ok.length,
      },
      parcels: [...blocked, ...warnings, ...ok],
    });
  } catch (err) { next(err); }
});

function checkScanSequence(sequence) {
  if (!sequence || sequence.length === 0) return true;
  const order = { preparation: 0, shipped: 1, in_transit: 2, arrived: 3, available: 4, collected: 5 };
  let last = -1;
  for (const evt of sequence) {
    const idx = order[evt] ?? -1;
    if (idx >= 0) {
      if (idx < last) return false;
      last = idx;
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// 6. GET /api/v2/parcels/:ref — Détail complet hiérarchique
// ═══════════════════════════════════════════════════════════════════════

router.get('/:ref', async (req, res, next) => {
  try {
    const { ref } = req.params;

    // Parcel de base
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

    // Scans (timeline)
    const { rows: scans } = await db.query(`
      SELECT event_type, status, actor_name, actor_role, location,
        notes, created_at
      FROM scan_events
      WHERE parcel_id = $1
      ORDER BY created_at ASC
    `, [parcel.id]);

    // Incidents
    const { rows: incidents } = await db.query(`
      SELECT id, incident_type, severity, status, title, description,
        client_impact, detected_source, created_at, resolved_at
      FROM incidents
      WHERE parcel_id = $1
      ORDER BY created_at DESC
    `, [parcel.id]);

    // Clients → Commandes → Articles (via parcel_items)
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

    // Group by client → orders → items
    const clientMap = new Map();
    for (const row of itemRows) {
      const clientKey = row.user_id || 'unknown';
      if (!clientMap.has(clientKey)) {
        clientMap.set(clientKey, {
          user_id: row.user_id,
          name: row.client_name || parcel.recipient_name || 'Client',
          phone: row.client_phone || parcel.recipient_phone || '',
          orders: new Map(),
        });
      }
      const client = clientMap.get(clientKey);

      if (!client.orders.has(row.order_id)) {
        client.orders.set(row.order_id, {
          id: row.order_id,
          reference: row.order_ref,
          status: row.order_status,
          total_kmf: Number(row.total_kmf),
          payment_mode: row.payment_mode,
          payment_status: row.payment_status,
          items: [],
        });
      }
      client.orders.get(row.order_id).items.push({
        id: row.item_id,
        product_name: row.product_name || row.pi_product_name || 'Produit inconnu',
        quantity: row.quantity,
        price_kmf: Number(row.price_kmf),
        image_url: row.image_url,
        emoji: row.product_emoji,
      });
    }

    // Convert maps to arrays
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
          name: mainOrder.client_name || parcel.recipient_name || 'Client',
          phone: mainOrder.client_phone || parcel.recipient_phone || '',
          orders: [{
            id: mainOrder.id,
            reference: mainOrder.reference,
            status: mainOrder.status,
            total_kmf: Number(mainOrder.total_kmf),
            payment_mode: mainOrder.payment_mode,
            payment_status: mainOrder.payment_status,
            items: mainItems.map(i => ({
              id: i.item_id,
              product_name: i.product_name || 'Produit',
              quantity: i.quantity,
              price_kmf: Number(i.price_kmf),
              image_url: i.image_url,
              emoji: i.product_emoji,
            })),
          }],
        });
      }
    }

    // Build reconciliation
    const parcelForRecon = {
      ...parcel,
      clients,
      scans,
      incidents,
    };
    const reconciliation = reconcileParcel(parcelForRecon);

    // Build response
    const result = {
      id: parcel.id,
      reference: parcel.reference,
      status: parcel.status,
      type: parcel.type,
      destination_island: parcel.destination_island,
      relais: {
        name: parcel.relais_name,
        island: parcel.relais_island,
        address: parcel.relais_address,
      },
      recipient_name: parcel.recipient_name,
      recipient_phone: parcel.recipient_phone,
      weight_kg: parcel.weight_kg ? Number(parcel.weight_kg) : null,
      eta: parcel.eta,
      pickup_code: parcel.pickup_code,
      
      // Timestamps
      created_at: parcel.created_at,
      shipped_at: parcel.shipped_at,
      in_transit_at: parcel.in_transit_at,
      available_at: parcel.available_at,
      collected_at: parcel.collected_at,
      
      // Hierarchy
      clients,
      
      // Totals
      nb_clients: clients.length,
      nb_orders: clients.reduce((sum, c) => sum + c.orders.length, 0),
      nb_items: clients.reduce((sum, c) => sum + c.orders.reduce((s2, o) => s2 + o.items.reduce((s3, i) => s3 + i.quantity, 0), 0), 0),
      total_kmf: clients.reduce((sum, c) => sum + c.orders.reduce((s2, o) => s2 + o.total_kmf, 0), 0),
      
      // Timeline
      scans,
      
      // Incidents
      incidents,
      
      // Reconciliation
      reconciliation,
      
      // Alerts
      alerts: computeParcelAlerts({
        ...parcel,
        open_incidents: incidents.filter(i => ['open','investigating'].includes(i.status)).length,
        critical_incidents: incidents.filter(i => i.severity === 'critical' && ['open','investigating'].includes(i.status)).length,
      }),
    };

    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// 7. GET /api/v2/parcels/:ref/timeline — Timeline scans
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

    // Build timeline with expected next step
    const steps = ['preparation', 'shipped', 'in_transit', 'arrived', 'available', 'collected'];
    const completed = new Set(scans.map(s => s.event_type));
    const currentIdx = steps.findIndex(s => s === parcel.status);
    const nextStep = currentIdx < steps.length - 1 ? steps[currentIdx + 1] : null;

    res.json({
      reference: parcel.reference,
      status: parcel.status,
      eta: parcel.eta,
      scans,
      next_expected_step: nextStep,
      steps: steps.map(s => ({
        step: s,
        completed: completed.has(s),
        current: s === parcel.status,
      })),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════

// Temporary debug route to find the PG trigger
router.get('/debug-triggers', async (req, res) => {
  try {
    // List all triggers on parcels table
    const { rows: triggers } = await db.query(`
      SELECT tgname, pg_get_triggerdef(oid) AS def
      FROM pg_trigger
      WHERE tgrelid = 'parcels'::regclass
        AND NOT tgisinternal
    `);
    
    // List all functions that mention 'ANTI' or 'destination'
    const { rows: functions } = await db.query(`
      SELECT proname, prosrc FROM pg_proc
      WHERE prosrc ILIKE '%ANTI-ERREUR%' OR prosrc ILIKE '%sans destination%'
    `);
    
    res.json({ triggers, functions });
  } catch (e) {
    res.json({ error: e.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// DEBUG: Test scan step by step (TEMPORARY — REMOVE AFTER FIX)
// ═══════════════════════════════════════════════════════════════════════

router.post('/:ref/debug-scan', async (req, res) => {
  const steps = [];
  let client;
  try {
    client = await db.getClient();
    steps.push({ step: 'getClient', ok: true });
    
    await client.query('BEGIN');
    steps.push({ step: 'BEGIN', ok: true });
    
    const { ref } = req.params;
    const { rows: [parcel] } = await client.query(
      `SELECT id, reference, status FROM parcels WHERE reference = $1 OR id::text = $1`, [ref]
    );
    steps.push({ step: 'find_parcel', ok: !!parcel, data: parcel ? { id: parcel.id, status: parcel.status } : null });
    
    if (!parcel) {
      await client.query('ROLLBACK');
      return res.json({ steps, error: 'parcel not found' });
    }
    
    // Test scan_events INSERT
    try {
      const { rows: [se] } = await client.query(`
        INSERT INTO scan_events (parcel_id, event_type, location, notes, scanned_by, actor_name, actor_role, status)
        VALUES ($1, 'shipped', NULL, 'debug test', NULL, 'Debug', 'system', 'applied')
        RETURNING id
      `, [parcel.id]);
      steps.push({ step: 'insert_scan_event', ok: true, id: se.id });
    } catch (e) {
      steps.push({ step: 'insert_scan_event', ok: false, error: e.message, code: e.code });
    }
    
    // Test parcel UPDATE
    try {
      await client.query(`UPDATE parcels SET status = 'shipped', updated_at = NOW(), shipped_at = NOW() WHERE id = $1`, [parcel.id]);
      steps.push({ step: 'update_parcel', ok: true });
    } catch (e) {
      steps.push({ step: 'update_parcel', ok: false, error: e.message, code: e.code });
    }
    
    // Test syncParcelToOrders
    try {
      const { rows: orderIds } = await client.query(`
        SELECT DISTINCT o.id FROM orders o
        WHERE o.id IN (
          SELECT order_id FROM parcels WHERE id = $1 AND order_id IS NOT NULL
          UNION
          SELECT oi.order_id FROM parcel_items pi
          JOIN order_items oi ON oi.id = pi.order_item_id
          WHERE pi.parcel_id = $1
        )
      `, [parcel.id]);
      steps.push({ step: 'find_orders', ok: true, count: orderIds.length, ids: orderIds.map(r => r.id) });
      
      for (const { id: oid } of orderIds) {
        try {
          const { rows: [ord] } = await client.query('SELECT id, status FROM orders WHERE id = $1', [oid]);
          steps.push({ step: 'order_status', ok: true, orderId: oid, status: ord?.status });
          
          // Test the actual UPDATE
          try {
            await client.query(`
              UPDATE orders SET status = 'shipped'::order_status, updated_at = NOW(), shipped_at = COALESCE(shipped_at, NOW())
              WHERE id = $1
            `, [oid]);
            steps.push({ step: 'update_order', ok: true, orderId: oid });
          } catch (e) {
            steps.push({ step: 'update_order', ok: false, orderId: oid, error: e.message, code: e.code });
          }
        } catch (e) {
          steps.push({ step: 'order_check', ok: false, orderId: oid, error: e.message });
        }
      }
    } catch (e) {
      steps.push({ step: 'sync_orders', ok: false, error: e.message, code: e.code });
    }
    
    // Test notification require
    try {
      const notif = require('../services/notification-service');
      steps.push({ step: 'require_notif', ok: true, hasNotifyParcelScan: typeof notif.notifyParcelScan === 'function' });
    } catch (e) {
      steps.push({ step: 'require_notif', ok: false, error: e.message });
    }
    
    await client.query('ROLLBACK'); // Always rollback debug
    steps.push({ step: 'ROLLBACK', ok: true });
    
    res.json({ steps });
  } catch (e) {
    steps.push({ step: 'fatal', ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3) });
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    res.json({ steps });
  } finally {
    if (client) client.release();
  }
});


// 8. POST /api/v2/parcels/:ref/scan — Scanner + sync auto
// ═══════════════════════════════════════════════════════════════════════

router.post('/:ref/scan', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { ref } = req.params;
    const { event_type, location, notes, actor_name, actor_role } = req.body;

    if (!event_type) {
      return res.status(400).json({ error: 'event_type requis' });
    }

    // Find parcel
    const { rows: [parcel] } = await client.query(
      `SELECT id, reference, status FROM parcels WHERE reference = $1 OR id::text = $1`, [ref]
    );
    if (!parcel) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Colis ${ref} introuvable` });
    }

    // Determine new parcel status
    const eventToStatus = {
      preparation: 'preparation',
      shipped: 'shipped',
      in_transit: 'in_transit',
      arrived: 'available',
      available: 'available',
      collected: 'collected',
    };
    const newStatus = eventToStatus[event_type] || parcel.status;

    // Get actor from JWT if available
    const actorId = req.user?.id || null;
    const actorNameFinal = actor_name || req.user?.full_name || 'Système';
    const actorRoleFinal = actor_role || (req.user?.role === 'agent_hub' ? 'hub_agent' : req.user?.role === 'agent_relais' ? 'relay_agent' : 'system');

    // Insert scan event
    const { rows: [scanEvent] } = await client.query(`
      INSERT INTO scan_events (parcel_id, event_type, location, notes, scanned_by, actor_name, actor_role, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied')
      RETURNING id, event_type, created_at
    `, [parcel.id, event_type, location || null, notes || null, actorId, actorNameFinal, actorRoleFinal]);

    // Update parcel status + timestamp
    const timestampCol = {
      preparation: 'prepared_at',
      shipped: 'shipped_at',
      in_transit: 'in_transit_at',
      arrived: 'available_at',
      available: 'available_at',
      collected: 'collected_at',
    }[event_type];

    const setClauses = ['status = $2', 'updated_at = NOW()'];
    const params = [parcel.id, newStatus];
    if (timestampCol) {
      setClauses.push(`${timestampCol} = NOW()`);
    }

    await client.query(`UPDATE parcels SET ${setClauses.join(', ')} WHERE id = $1`, params);

    // SYNC: propagate to orders
    const syncedOrders = await syncParcelToOrders(client, parcel.id, newStatus);

    await client.query('COMMIT');

    clearCache();

    // ── NOTIFICATIONS (fire-and-forget) ──
    const notif = require('../services/notification-service');
    notif.notifyParcelScan(parcel.id, parcel.reference, newStatus)
      .catch(e => console.error('[SCAN-NOTIF] ❌', e.message));

    res.json({
      success: true,
      scan: {
        id: scanEvent.id,
        event_type: scanEvent.event_type,
        created_at: scanEvent.created_at,
      },
      parcel: {
        reference: parcel.reference,
        old_status: parcel.status,
        new_status: newStatus,
      },
      synced_orders: syncedOrders,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;

