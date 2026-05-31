'use strict';

/**
 * routes/parcel-api-v2/helpers.js
 * Extrait de routes/parcel-api-v2.js — lot GOD-FILES-4 (2026-05-25)
 *
 * Helpers partagés : cache, SLA, alert engine, reconciliation,
 * middleware relay-scope.
 *
 *     (le POST /scan délègue à scan-engine). Conservée à l'identique —
 *     ne pas supprimer dans ce lot. Signalée dans STATUS.md.
 */

const db = require('../../db');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const log = require('../../utils/logger').child({ module: 'parcel-api-v2' });

// ─── Cache simple en mémoire (TTL 30s) ────────────────────────────────────────
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

// ─── Status ordering ───────────────────────────────────────────────────────────
const STATUS_ORDER = {
  draft: 0, preparation: 1, shipped: 2, in_transit: 3,
  available: 4, collected: 5, cancelled: 6,
};

// ─── SLA rules (hours) ────────────────────────────────────────────────────────
const SLA = {
  preparation_max_hours:    48,
  transit_max_hours:       120,  // 5 jours
  available_max_hours:      72,  // 3 jours avant rappel
  available_critical_hours: 168, // 7 jours = critique
};

// ─── Relay agent security ─────────────────────────────────────────────────────

const RELAY_AGENT_FORBIDDEN_STATIC_PATHS = new Set([
  '/alerts',
  '/critical',
  '/reconciliation',
]);

function stripPickupCodeDeep(value) {
  if (Array.isArray(value)) return value.map(stripPickupCodeDeep);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === 'pickup_code') continue;
    out[key] = stripPickupCodeDeep(val);
  }
  return out;
}

async function getAgentRelaisId(userId) {
  const { rows: [agent] } = await db.query(
    'SELECT relais_id FROM users WHERE id = $1',
    [userId]
  );
  return agent?.relais_id || null;
}

async function parcelBelongsToRelais(parcelRef, relaisId) {
  const { rows } = await db.query(`
    SELECT 1
    FROM parcels p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE p.reference = $1
      AND COALESCE(p.relay_id, p.relais_id, o.relais_id) = $2
    LIMIT 1
  `, [parcelRef, relaisId]);
  return rows.length > 0;
}

async function sendScopedRelayKpis(req, res) {
  const relaisId = req.agentRelaisId;

  const { rows: [kpi] } = await db.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE p.status = 'draft')::int AS draft,
      COUNT(*) FILTER (WHERE p.status = 'preparation')::int AS preparation,
      COUNT(*) FILTER (WHERE p.status = 'shipped')::int AS shipped,
      COUNT(*) FILTER (WHERE p.status = 'in_transit')::int AS in_transit,
      COUNT(*) FILTER (WHERE p.status = 'available')::int AS available,
      COUNT(*) FILTER (WHERE p.status = 'collected')::int AS collected,
      COUNT(*) FILTER (WHERE p.status = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (WHERE p.status NOT IN ('collected','cancelled'))::int AS active
    FROM parcels p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE COALESCE(p.relay_id, p.relais_id, o.relais_id) = $1
  `, [relaisId]);

  const { rows: byIsland } = await db.query(`
    SELECT p.destination_island AS island, p.status, COUNT(*)::int AS count
    FROM parcels p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE p.status NOT IN ('collected','cancelled')
      AND COALESCE(p.relay_id, p.relais_id, o.relais_id) = $1
    GROUP BY p.destination_island, p.status
    ORDER BY p.destination_island, p.status
  `, [relaisId]);

  const islands = {};
  for (const r of byIsland) {
    const island = r.island || 'Inconnu';
    if (!islands[island]) islands[island] = {};
    islands[island][r.status] = r.count;
  }

  return res.json({
    parcels: {
      total: kpi.total,
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
    finance:   null,
    incidents: null,
    scope:     'agent_relais',
  });
}

/**
 * Middleware relay-scope.
 * P0 security: agent_relais must never see another relay's parcels.
 * Résout le relais_id, stripe pickup_code de toutes les réponses,
 * et fail-close si le scope ne peut pas être établi.
 */
async function relayAgentScopeMiddleware(req, res, next) {
  try {
    if (req.user?.role !== 'agent_relais') return next();

    const relaisId = await getAgentRelaisId(req.user.id);
    if (!relaisId) {
      return res.status(403).json({
        error: 'Configuration agent incomplète — aucun relais associé',
      });
    }

    req.agentRelaisId = relaisId;

    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(stripPickupCodeDeep(payload));

    if (req.method === 'GET' && req.path === '/kpis') {
      return sendScopedRelayKpis(req, res);
    }

    if (req.method === 'GET' && RELAY_AGENT_FORBIDDEN_STATIC_PATHS.has(req.path)) {
      return res.status(403).json({
        error: 'Vue réservée au hub/admin — non disponible pour agent relais',
        scope: 'agent_relais',
      });
    }

    if (req.method === 'GET' && req.path === '/') return next();

    const match = req.path.match(/^\/([^/]+)/);
    if (match) {
      const parcelRef = decodeURIComponent(match[1]);
      const allowed = await parcelBelongsToRelais(parcelRef, relaisId);
      if (!allowed) {
        return res.status(403).json({
          error: 'Ce colis appartient à un autre relais',
        });
      }
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

function reconcileParcel(parcel) {
  const checks = {
    content_match:    true,
    status_sync:      true,
    payment_sync:     true,
    scan_sequence_ok: true,
    delivery_ready:   true,
  };
  const issues = [];

  // 1. Content match
  if (parcel.clients) {
    let expectedItems = 0;
    const actualItems = parcel.items_count || 0;
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
        check:    'content_match',
        message:  `Attendu ${expectedItems} articles, trouvé ${actualItems} dans le colis`,
        severity: 'warning',
      });
    }
  }

  // 2. Status sync
  if (parcel.clients) {
    for (const cl of parcel.clients) {
      for (const ord of cl.orders || []) {
        if (ord.status !== parcel.status && parcel.status !== 'preparation' && parcel.status !== 'draft') {
          checks.status_sync = false;
          issues.push({
            check:    'status_sync',
            message:  `Commande ${ord.reference} en "${ord.status}" mais colis en "${parcel.status}"`,
            severity: 'warning',
          });
        }
      }
    }
  }

  // 3. Scan sequence
  if (parcel.scans && parcel.scans.length > 0) {
    const seqOrder = { preparation: 0, shipped: 1, in_transit: 2, arrived: 3, available: 4, collected: 5 };
    let lastSeq = -1;
    for (const scan of parcel.scans) {
      const seq = seqOrder[scan.event_type] ?? -1;
      if (seq >= 0 && seq < lastSeq) {
        checks.scan_sequence_ok = false;
        issues.push({
          check:    'scan_sequence_ok',
          message:  `Scan "${scan.event_type}" après un scan plus avancé`,
          severity: 'high',
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
          checks.payment_sync = false;
          issues.push({
            check:    'payment_sync',
            message:  `⚠️ ÉTAT IMPOSSIBLE: Colis existe avec commande ${ord.reference} cash relais impayée`,
            severity: 'critical',
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
        check:    'delivery_ready',
        message:  'Incident critique non résolu — remise bloquée',
        severity: 'critical',
      });
    }
  }

  const hasBlocking = issues.some(i => i.severity === 'critical' || i.severity === 'high');
  const hasWarning  = issues.some(i => i.severity === 'warning');

  return {
    status: hasBlocking ? 'blocked' : hasWarning ? 'warning' : 'ok',
    checks,
    issues,
  };
}

// ─── Alert engine ─────────────────────────────────────────────────────────────

function computeParcelAlerts(parcel) {
  const alerts = [];
  const now    = new Date();

  function hoursSince(dateStr) {
    if (!dateStr) return Infinity;
    return (now - new Date(dateStr)) / 3_600_000;
  }

  if (parcel.status === 'preparation') {
    const hours = hoursSince(parcel.created_at);
    if (hours > SLA.preparation_max_hours) {
      alerts.push({
        type:       'stuck_preparation',
        severity:   'warning',
        message:    `Colis en préparation depuis ${Math.round(hours)}h (SLA: ${SLA.preparation_max_hours}h)`,
        parcel_ref: parcel.reference,
      });
    }
  }

  if (parcel.status === 'in_transit') {
    const hours = hoursSince(parcel.shipped_at || parcel.in_transit_at);
    if (hours > SLA.transit_max_hours) {
      alerts.push({
        type:       'sla_breach_transit',
        severity:   'critical',
        message:    `Colis en transit depuis ${Math.round(hours)}h (SLA: ${SLA.transit_max_hours}h)`,
        parcel_ref: parcel.reference,
      });
    }
  }

  if (parcel.status === 'available') {
    const hours = hoursSince(parcel.available_at);
    if (hours > SLA.available_critical_hours) {
      alerts.push({
        type:       'uncollected_critical',
        severity:   'critical',
        message:    `Colis disponible non retiré depuis ${Math.round(hours / 24)} jours`,
        parcel_ref: parcel.reference,
      });
    } else if (hours > SLA.available_max_hours) {
      alerts.push({
        type:       'uncollected_warning',
        severity:   'warning',
        message:    `Colis disponible non retiré depuis ${Math.round(hours / 24)} jours`,
        parcel_ref: parcel.reference,
      });
    }
  }

  if (parcel.open_incidents > 0) {
    alerts.push({
      type:       'open_incident',
      severity:   parcel.critical_incidents > 0 ? 'critical' : 'warning',
      message:    `${parcel.open_incidents} incident(s) ouvert(s)${parcel.critical_incidents > 0 ? ' dont critique(s)' : ''}`,
      parcel_ref: parcel.reference,
    });
  }

  return alerts;
}

// ─── checkScanSequence (utilisé par /reconciliation) ─────────────────────────

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

module.exports = {
  cached,
  setCache,
  clearCache,
  STATUS_ORDER,
  SLA,
  stripPickupCodeDeep,
  getAgentRelaisId,
  parcelBelongsToRelais,
  sendScopedRelayKpis,
  relayAgentScopeMiddleware,
  reconcileParcel,
  computeParcelAlerts,
  checkScanSequence,
};
