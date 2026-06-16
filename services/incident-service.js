/**
 * @komerce-arch
 * @role          incident-service
 * @domain        unknown
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * incident-service.js — Gestion des incidents Komerce
 * 
 * Incidents = écarts entre l'état attendu et l'état réel.
 * Chaque incident a :
 *   - Un type (content_mismatch, missing_item, etc.)
 *   - Une sévérité (low → critical)
 *   - Un impact client (none → blocked)
 *   - Un statut (open → investigating → resolved/dismissed)
 *   - Un historique de résolution (append-only)
 *
 * PRINCIPES :
 *   - Jamais de suppression (soft-close uniquement)
 *   - Résolution explicite avec raison
 *   - Notification client si impact
 */

const pool = require('../db');

// ════════════════════════════════════════════════════════════════
// LISTER LES INCIDENTS
// ════════════════════════════════════════════════════════════════

async function listIncidents(filters = {}) {
  const conditions = [];
  const values = [];
  let paramIdx = 1;

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      conditions.push(`i.status = ANY($${paramIdx++})`);
      values.push(filters.status);
    } else {
      conditions.push(`i.status = $${paramIdx++}`);
      values.push(filters.status);
    }
  }

  if (filters.severity) {
    conditions.push(`i.severity = $${paramIdx++}`);
    values.push(filters.severity);
  }

  if (filters.incident_type) {
    conditions.push(`i.incident_type = $${paramIdx++}`);
    values.push(filters.incident_type);
  }

  if (filters.parcel_id) {
    conditions.push(`i.parcel_id = $${paramIdx++}`);
    values.push(filters.parcel_id);
  }

  if (filters.order_id) {
    conditions.push(`i.order_id = $${paramIdx++}`);
    values.push(filters.order_id);
  }

  if (filters.client_impact && filters.client_impact !== 'all') {
    if (filters.client_impact === 'any') {
      conditions.push(`i.client_impact != 'none'`);
    } else {
      conditions.push(`i.client_impact = $${paramIdx++}`);
      values.push(filters.client_impact);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const { rows } = await pool.query(`
    SELECT 
      i.*,
      p.reference AS parcel_ref,
      p.status AS parcel_status,
      o.reference AS order_ref,
      o.client_name,
      o.client_phone
    FROM incidents i
    LEFT JOIN parcels p ON p.id = i.parcel_id
    LEFT JOIN orders o ON o.id = i.order_id
    ${where}
    ORDER BY 
      CASE i.severity 
        WHEN 'critical' THEN 0 
        WHEN 'high' THEN 1 
        WHEN 'medium' THEN 2 
        WHEN 'low' THEN 3 
      END,
      i.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `, values);

  const { rows: [count] } = await pool.query(
    `SELECT COUNT(*) AS total FROM incidents i ${where}`, values
  );

  return { incidents: rows, total: parseInt(count.total), limit, offset };
}

// ════════════════════════════════════════════════════════════════
// DÉTAIL D'UN INCIDENT
// ════════════════════════════════════════════════════════════════

async function getIncident(incidentId) {
  const { rows: [incident] } = await pool.query(`
    SELECT 
      i.*,
      p.reference AS parcel_ref,
      p.status AS parcel_status,
      p.verification_status,
      o.reference AS order_ref,
      o.client_name, o.client_phone, o.client_email,
      o.total_amount, o.payment_method,
      se.event_type AS trigger_event,
      se.created_at AS trigger_event_at,
      se.actor_name AS trigger_actor
    FROM incidents i
    LEFT JOIN parcels p ON p.id = i.parcel_id
    LEFT JOIN orders o ON o.id = i.order_id
    LEFT JOIN scan_events se ON se.id = i.scan_event_id
    WHERE i.id = $1
  `, [incidentId]);

  if (!incident) return null;

  // Incidents liés (même colis ou même commande)
  const { rows: related } = await pool.query(`
    SELECT id, incident_type, severity, status, title, created_at
    FROM incidents
    WHERE id != $1
    AND (parcel_id = $2 OR order_id = $3)
    ORDER BY created_at DESC
    LIMIT 10
  `, [incidentId, incident.parcel_id, incident.order_id]);

  // Scans récents du colis concerné
  let recentScans = [];
  if (incident.parcel_id) {
    const { rows } = await pool.query(`
      SELECT id, event_type, actor_name, status, created_at, notes
      FROM scan_events
      WHERE parcel_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [incident.parcel_id]);
    recentScans = rows;
  }

  return { ...incident, related, recentScans };
}

// ════════════════════════════════════════════════════════════════
// RÉSOUDRE UN INCIDENT
// ════════════════════════════════════════════════════════════════

async function resolveIncident(incidentId, resolution) {
  const {
    resolution_type, // 'reship', 'refund', 'manual_fix', 'dismissed', 'auto_resolved'
    resolved_by,
    notes,
    actions_taken = [],
    notify_client = false,
    client_message
  } = resolution;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Charger l'incident
    const { rows: [incident] } = await client.query(
      `SELECT * FROM incidents WHERE id = $1`, [incidentId]
    );
    if (!incident) throw new Error('Incident introuvable');
    if (incident.status === 'resolved') throw new Error('Incident déjà résolu');

    // Mettre à jour l'incident
    await client.query(`
      UPDATE incidents SET
        status = $2,
        resolution_type = $3,
        resolution = $4,
        resolved_at = NOW(),
        resolved_by = $5,
        client_notified = $6,
        client_notification = $7
      WHERE id = $1
    `, [
      incidentId,
      resolution_type === 'dismissed' ? 'dismissed' : 'resolved',
      resolution_type,
      JSON.stringify({
        notes,
        actions_taken,
        resolved_at: new Date().toISOString(),
        previous_status: incident.status
      }),
      resolved_by || null,
      notify_client,
      client_message || null
    ]);

    // Si reship → créer les actions nécessaires
    if (resolution_type === 'reship' && incident.parcel_id && incident.order_item_id) {
      // Marquer pour réexpédition (le hub devra créer un nouveau colis)
      await client.query(`
        INSERT INTO incidents (
          parcel_id, order_id, order_item_id,
          incident_type, severity, status, title, description,
          details, parent_incident_id, detected_source
        ) VALUES ($1, $2, $3, 'blocked', 'medium', 'open',
          'Réexpédition requise suite à incident',
          $4,
          $5, $6, 'system')
      `, [
        incident.parcel_id, incident.order_id, incident.order_item_id,
        `Réexpédition des articles manquants/endommagés suite à l'incident ${incidentId}`,
        JSON.stringify({
          action: 'reship',
          source_incident: incidentId,
          ...incident.details
        }),
        incidentId
      ]);
    }

    await client.query('COMMIT');

    return { success: true, incident_id: incidentId, resolution_type };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════════
// ESCALADER UN INCIDENT
// ════════════════════════════════════════════════════════════════

async function escalateIncident(incidentId, params) {
  const { new_severity, escalated_by, reason } = params;

  await pool.query(`
    UPDATE incidents SET
      severity = $2,
      status = 'investigating',
      details = details || $3
    WHERE id = $1
  `, [
    incidentId,
    new_severity,
    JSON.stringify({
      escalation: {
        previous_severity: null, // Will be read from current
        new_severity,
        escalated_by,
        reason,
        escalated_at: new Date().toISOString()
      }
    })
  ]);

  return { success: true };
}

// ════════════════════════════════════════════════════════════════
// STATISTIQUES INCIDENTS POUR DASHBOARD
// ════════════════════════════════════════════════════════════════

async function getIncidentDashboard() {
  // Compteurs par sévérité et statut
  const { rows: byStatus } = await pool.query(`
    SELECT 
      status,
      severity,
      COUNT(*) AS count
    FROM incidents
    WHERE status IN ('open', 'investigating')
    GROUP BY status, severity
    ORDER BY 
      CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
  `);

  // Top types d'incidents ouverts
  const { rows: byType } = await pool.query(`
    SELECT 
      incident_type,
      COUNT(*) AS count,
      COUNT(*) FILTER (WHERE client_impact != 'none') AS client_impacting
    FROM incidents
    WHERE status IN ('open', 'investigating')
    GROUP BY incident_type
    ORDER BY count DESC
  `);

  // Incidents les plus récents
  const { rows: recent } = await pool.query(`
    SELECT 
      i.id, i.incident_type, i.severity, i.status, i.title,
      i.client_impact, i.created_at,
      p.reference AS parcel_ref,
      o.reference AS order_ref, o.client_name
    FROM incidents i
    LEFT JOIN parcels p ON p.id = i.parcel_id
    LEFT JOIN orders o ON o.id = i.order_id
    WHERE i.status IN ('open', 'investigating')
    ORDER BY 
      CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      i.created_at DESC
    LIMIT 20
  `);

  // Temps moyen de résolution (7 derniers jours)
  const { rows: [avgRes] } = await pool.query(`
    SELECT 
      AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) AS avg_hours,
      COUNT(*) AS resolved_count
    FROM incidents
    WHERE resolved_at > NOW() - INTERVAL '7 days'
    AND status = 'resolved'
  `);

  return {
    by_status: byStatus,
    by_type: byType,
    recent,
    resolution: {
      avg_hours: avgRes?.avg_hours ? parseFloat(avgRes.avg_hours).toFixed(1) : null,
      resolved_7d: parseInt(avgRes?.resolved_count || 0)
    }
  };
}

module.exports = {
  listIncidents,
  getIncident,
  resolveIncident,
  escalateIncident,
  getIncidentDashboard
};
