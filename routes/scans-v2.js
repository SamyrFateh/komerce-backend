/**
 * scans-v2.js — API Scans PARCEL-FIRST
 * 
 * TOUTES les opérations de scan passent par le scan-engine.
 * Pas de manipulation directe de statuts.
 * 
 * Routes :
 *   POST   /api/v2/scans                    — Traiter un scan
 *   POST   /api/v2/scans/:eventId/correct   — Corriger un scan
 *   GET    /api/v2/scans/parcel/:parcelId   — Timeline d'un colis
 *   GET    /api/v2/scans/order/:orderId     — Scans d'une commande
 *   POST   /api/v2/parcels/:id/verify       — Vérification contenu relais
 *   GET    /api/v2/parcels/:id/trace        — Traçabilité complète
 *   POST   /api/v2/reconciliation/order/:id — Réconcilier une commande
 *   POST   /api/v2/reconciliation/batch     — Réconciliation batch
 *   GET    /api/v2/reconciliation/stats     — Stats réconciliation
 *   GET    /api/v2/incidents                — Lister incidents
 *   GET    /api/v2/incidents/:id            — Détail incident
 *   POST   /api/v2/incidents/:id/resolve    — Résoudre incident
 *   POST   /api/v2/incidents/:id/escalate   — Escalader incident
 *   GET    /api/v2/incidents/dashboard      — Dashboard incidents
 */

const express = require('express');
const router = express.Router();
const { processScan, correctScanEvent, getParcelTrace } = require('../services/scan-engine');
const { reconcileOrder, reconcileAll, getReconciliationStats } = require('../services/reconciliation-service');
const { listIncidents, getIncident, resolveIncident, escalateIncident, getIncidentDashboard } = require('../services/incident-service');
const pool = require('../db');

// ════════════════════════════════════════════════════════════════
// SCANS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/v2/scans — Traiter un scan
 * Body: {
 *   parcel_id, event_type, scan_code?,
 *   scanned_by?, actor_name?, actor_role?,
 *   location?, latitude?, longitude?, device_id?,
 *   notes?, metadata?,
 *   actual_weight_kg? (pour weight_check),
 *   items? (pour content_verified)
 * }
 */
router.post('/scans', async (req, res) => {
  try {
    const { parcel_id, event_type } = req.body;

    if (!parcel_id) return res.status(400).json({ error: 'parcel_id requis' });
    if (!event_type) return res.status(400).json({ error: 'event_type requis' });

    // Si l'utilisateur est authentifié, utiliser son ID
    const scanned_by = req.body.scanned_by || req.user?.id;
    const actor_name = req.body.actor_name || req.user?.name || req.user?.email;

    const result = await processScan({
      ...req.body,
      scanned_by,
      actor_name
    });

    if (!result.success) {
      return res.status(422).json({
        error: result.error?.message || 'Scan rejeté',
        code: result.error?.code,
        event_id: result.event_id,
        incidents: result.incidents.map(formatIncident)
      });
    }

    res.json({
      success: true,
      event_id: result.event_id,
      parcel: formatParcel(result.parcel),
      catchup_events: result.catchup_events,
      incidents: result.incidents.map(formatIncident),
      message: result.catchup_events.length > 0
        ? `Scan ${event_type} appliqué + ${result.catchup_events.length} étape(s) rattrapée(s)`
        : `Scan ${event_type} appliqué`
    });

  } catch (err) {
    console.error('[scans-v2] Erreur processScan:', err);
    res.status(500).json({ error: 'Erreur serveur lors du scan' });
  }
});

/**
 * POST /api/v2/scans/:eventId/correct — Corriger un scan
 * Body: { corrected_by?, actor_name?, actor_role?, reason }
 */
router.post('/scans/:eventId/correct', async (req, res) => {
  try {
    const correctionEvent = await correctScanEvent(req.params.eventId, {
      corrected_by: req.body.corrected_by || req.user?.id,
      actor_name: req.body.actor_name || req.user?.name,
      actor_role: req.body.actor_role || 'admin',
      reason: req.body.reason
    });

    res.json({
      success: true,
      correction_event: correctionEvent,
      message: 'Correction enregistrée (l\'événement original est marqué reversed)'
    });

  } catch (err) {
    console.error('[scans-v2] Erreur correction:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/scans/parcel/:parcelId — Timeline d'un colis
 */
router.get('/scans/parcel/:parcelId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM scan_events
      WHERE parcel_id = $1
      ORDER BY created_at ASC
    `, [req.params.parcelId]);

    res.json({ timeline: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/scans/order/:orderId — Scans de tous les colis d'une commande
 */
router.get('/scans/order/:orderId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT se.*, p.reference AS parcel_ref
      FROM scan_events se
      JOIN parcels p ON p.id = se.parcel_id
      WHERE se.order_id = $1 OR p.order_id = $1
      ORDER BY se.created_at ASC
    `, [req.params.orderId]);

    res.json({ events: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PARCELS — Vérification & Traçabilité
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/v2/parcels/:id/verify — Vérification contenu au relais
 * Body: {
 *   items: [{ parcel_item_id, verified: bool, qty_found: number }],
 *   actual_weight_kg?,
 *   notes?
 * }
 */
router.post('/parcels/:id/verify', async (req, res) => {
  try {
    const result = await processScan({
      parcel_id: req.params.id,
      event_type: 'content_verified',
      items: req.body.items,
      actual_weight_kg: req.body.actual_weight_kg,
      scanned_by: req.body.verified_by || req.user?.id,
      actor_name: req.body.actor_name || req.user?.name,
      actor_role: req.body.actor_role || 'relay_agent',
      location: req.body.location,
      notes: req.body.notes
    });

    res.json({
      success: result.success,
      event_id: result.event_id,
      verification_status: result.parcel?.verification_status,
      incidents: result.incidents.map(formatIncident),
      message: result.incidents.length === 0
        ? '✅ Contenu vérifié — aucun écart'
        : `⚠️ ${result.incidents.length} écart(s) détecté(s)`
    });

  } catch (err) {
    console.error('[scans-v2] Erreur vérification:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/parcels/:id/trace — Traçabilité complète d'un colis
 */
router.get('/parcels/:id/trace', async (req, res) => {
  try {
    const trace = await getParcelTrace(req.params.id);
    if (!trace) return res.status(404).json({ error: 'Colis introuvable' });

    res.json(trace);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// RECONCILIATION
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/v2/reconciliation/order/:id — Réconcilier une commande
 */
router.post('/reconciliation/order/:id', async (req, res) => {
  try {
    const result = await reconcileOrder(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v2/reconciliation/batch — Réconciliation en batch
 * Body: { limit?: number, onlyActive?: boolean }
 */
router.post('/reconciliation/batch', async (req, res) => {
  try {
    const result = await reconcileAll({
      limit: req.body.limit || 100,
      onlyActive: req.body.onlyActive !== false
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/reconciliation/stats — Stats de réconciliation
 */
router.get('/reconciliation/stats', async (req, res) => {
  try {
    const stats = await getReconciliationStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// INCIDENTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v2/incidents — Lister les incidents
 * Query: status, severity, incident_type, parcel_id, order_id, client_impact, limit, offset
 */
router.get('/incidents', async (req, res) => {
  try {
    const result = await listIncidents({
      status: req.query.status ? req.query.status.split(',') : ['open', 'investigating'],
      severity: req.query.severity,
      incident_type: req.query.incident_type,
      parcel_id: req.query.parcel_id,
      order_id: req.query.order_id,
      client_impact: req.query.client_impact,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/incidents/dashboard — Dashboard incidents
 */
router.get('/incidents/dashboard', async (req, res) => {
  try {
    const dashboard = await getIncidentDashboard();
    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/incidents/:id — Détail d'un incident
 */
router.get('/incidents/:id', async (req, res) => {
  try {
    const incident = await getIncident(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident introuvable' });
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v2/incidents/:id/resolve — Résoudre un incident
 * Body: { resolution_type, notes?, actions_taken?, notify_client?, client_message? }
 */
router.post('/incidents/:id/resolve', async (req, res) => {
  try {
    const result = await resolveIncident(req.params.id, {
      ...req.body,
      resolved_by: req.body.resolved_by || req.user?.id
    });
    res.json(result);
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

/**
 * POST /api/v2/incidents/:id/escalate — Escalader un incident
 * Body: { new_severity, reason }
 */
router.post('/incidents/:id/escalate', async (req, res) => {
  try {
    const result = await escalateIncident(req.params.id, {
      ...req.body,
      escalated_by: req.body.escalated_by || req.user?.id
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD PARCEL-FIRST (Hub + Relais + Ops)
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/v2/dashboard/hub — Vue Hub Dubaï
 */
router.get('/dashboard/hub', async (req, res) => {
  try {
    const { rows: [counts] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft') AS to_prepare,
        COUNT(*) FILTER (WHERE status = 'preparation') AS in_preparation,
        COUNT(*) FILTER (WHERE status = 'preparation' AND 
          EXISTS (SELECT 1 FROM scan_events se WHERE se.parcel_id = p.id AND se.event_type = 'sealed' AND se.status = 'applied')
        ) AS ready_to_ship,
        COUNT(*) FILTER (WHERE status = 'shipped') AS shipped_today,
        COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled') AND
          EXISTS (SELECT 1 FROM incidents i WHERE i.parcel_id = p.id AND i.status = 'open')
        ) AS blocked,
        COUNT(*) FILTER (WHERE verification_status = 'discrepancy') AS with_issues
      FROM parcels p
      WHERE status NOT IN ('collected', 'cancelled')
    `);

    // Colis à préparer
    const { rows: toPrepare } = await pool.query(`
      SELECT p.id, p.reference, p.order_id, p.items_count, p.total_qty,
             p.expected_weight_kg, p.destination_relais, p.recipient_name,
             o.reference AS order_ref, o.client_name,
             r.name AS relais_name
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = p.relais_id
      WHERE p.status = 'draft'
      ORDER BY p.created_at ASC
      LIMIT 50
    `);

    // Colis en préparation
    const { rows: inPrep } = await pool.query(`
      SELECT p.id, p.reference, p.order_id, p.items_count, p.total_qty,
             p.expected_weight_kg, p.actual_weight_kg,
             o.reference AS order_ref, o.client_name,
             r.name AS relais_name,
             (SELECT event_type FROM scan_events WHERE parcel_id = p.id AND status = 'applied' 
              ORDER BY created_at DESC LIMIT 1) AS last_step
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = p.relais_id
      WHERE p.status = 'preparation'
      ORDER BY p.created_at ASC
      LIMIT 50
    `);

    res.json({
      counts,
      parcels_to_prepare: toPrepare,
      parcels_in_preparation: inPrep
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/dashboard/relais — Vue Relais
 */
router.get('/dashboard/relais', async (req, res) => {
  try {
    const relaisId = req.query.relais_id;
    const relaisFilter = relaisId ? `AND p.relais_id = '${relaisId}'` : '';

    const { rows: [counts] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'available' AND collected_at IS NULL) AS to_deliver,
        COUNT(*) FILTER (WHERE status = 'available' AND collected_at IS NULL
          AND EXISTS (SELECT 1 FROM orders o WHERE o.id = p.order_id AND o.payment_method = 'cash' AND o.payment_status != 'paid')
        ) AS cash_pending,
        COUNT(*) FILTER (WHERE status IN ('shipped', 'in_transit')) AS in_transit,
        COUNT(*) FILTER (WHERE status = 'available' AND 
          received_at < NOW() - INTERVAL '48 hours' AND collected_at IS NULL
        ) AS delayed_pickup,
        COUNT(*) FILTER (WHERE verification_status = 'pending' AND status = 'available') AS unverified
      FROM parcels p
      WHERE status NOT IN ('cancelled') ${relaisFilter}
    `);

    // Colis à remettre
    const { rows: toDeliver } = await pool.query(`
      SELECT p.id, p.reference, p.pickup_code, p.items_count, p.total_qty,
             p.verification_status, p.received_at, p.recipient_name, p.recipient_phone,
             o.reference AS order_ref, o.client_name, o.client_phone,
             o.total_amount, o.payment_method, o.payment_status,
             r.name AS relais_name
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = p.relais_id
      WHERE p.status = 'available' AND p.collected_at IS NULL ${relaisFilter}
      ORDER BY p.received_at ASC
      LIMIT 50
    `);

    res.json({ counts, parcels_to_deliver: toDeliver });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v2/dashboard/ops — Vue Opérations (colis-centric)
 */
router.get('/dashboard/ops', async (req, res) => {
  try {
    const { rows: [pipeline] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE status = 'preparation') AS preparation,
        COUNT(*) FILTER (WHERE status = 'shipped') AS shipped,
        COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit,
        COUNT(*) FILTER (WHERE status IN ('available', 'arrived')) AS available,
        COUNT(*) FILTER (WHERE status = 'collected') AS collected,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        COUNT(*) AS total
      FROM parcels
    `);

    // Incidents ouverts
    const { rows: [incidentCounts] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
        COUNT(*) FILTER (WHERE severity = 'high') AS high,
        COUNT(*) FILTER (WHERE severity = 'medium') AS medium,
        COUNT(*) FILTER (WHERE severity = 'low') AS low
      FROM incidents
      WHERE status IN ('open', 'investigating')
    `);

    // Scans des 24h
    const { rows: [scanActivity] } = await pool.query(`
      SELECT
        COUNT(*) AS total_scans,
        COUNT(*) FILTER (WHERE status = 'applied') AS applied,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'needs_review') AS needs_review
      FROM scan_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);

    res.json({ pipeline, incidents: incidentCounts, scan_activity_24h: scanActivity });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// FORMATTERS
// ════════════════════════════════════════════════════════════════

function formatParcel(p) {
  if (!p) return null;
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    verification_status: p.verification_status,
    items_count: p.items_count,
    total_qty: p.total_qty,
    expected_weight_kg: p.expected_weight_kg,
    actual_weight_kg: p.actual_weight_kg,
    shipped_at: p.shipped_at,
    received_at: p.received_at,
    collected_at: p.collected_at
  };
}

function formatIncident(i) {
  return {
    id: i.id,
    type: i.incident_type,
    severity: i.severity,
    status: i.status,
    title: i.title,
    client_impact: i.client_impact,
    created_at: i.created_at
  };
}

module.exports = router;
