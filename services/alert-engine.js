/**
 * @komerce-arch
 * @role          notification-alert-engine
 * @domain        notification
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/incident-write-service.js
 * @used-by       routes/alerts.js
 * @db-read       incidents, orders, parcels, scan_events
 * @db-write-via:incident-write-service incidents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  notification
 * @version       2026-06
 */

/**
 * KOMERCE — Alert Engine v1.0 — Détection anomalies terrain
 * 
 * Détecte automatiquement :
 * 1. Colis bloqués (aucun scan depuis X jours)
 * 2. Poids incohérents (attendu vs réel > seuil)
 * 3. SLA dépassé (colis en transit trop longtemps)
 * 4. Colis non vérifiés au relais
 * 5. Cash non encaissé
 * 6. Anomalies de séquence de scans
 * 
 * Utilise la table incidents pour stocker les alertes.
 * Chaque alerte = un incident de type spécifique.
 */

'use strict';

const db = require('../db');
const {
  createAlertEngineIncidentIfNew,
  acknowledgeAlertEngineIncident,
} = require('./incident-write-service');

const DEFAULTS = {
  STUCK_DAYS: 7,           // Colis sans scan depuis 7 jours
  TRANSIT_MAX_DAYS: 21,    // Transit max avant alerte SLA
  WEIGHT_TOLERANCE_PCT: 20, // Tolérance poids ±20%
  UNVERIFIED_HOURS: 48,    // Colis au relais non vérifié après 48h
  CASH_PENDING_HOURS: 72,  // Cash non encaissé après 72h
};

const AlertEngine = {
  /**
   * Exécute tous les checks et retourne les alertes détectées
   */
  async runAll() {
    const results = await Promise.allSettled([
      this.checkStuckParcels(),
      this.checkWeightMismatches(),
      this.checkSLABreaches(),
      this.checkUnverifiedParcels(),
      this.checkCashPending(),
    ]);

    const alerts = [];
    for (const r of results) {
      if (r.status === 'fulfilled') alerts.push(...r.value);
    }
    return alerts;
  },

  /**
   * 1. Colis bloqués — aucun scan depuis X jours
   */
  async checkStuckParcels() {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.order_id,
        o.reference AS order_ref,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(
          (SELECT MAX(se.created_at) FROM scan_events se WHERE se.parcel_id = p.id AND se.status = 'applied'),
          p.updated_at, p.created_at
        ))) / 86400 AS days_since_activity
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.status NOT IN ('collected', 'cancelled', 'archived')
      HAVING EXTRACT(EPOCH FROM (NOW() - COALESCE(
        (SELECT MAX(se.created_at) FROM scan_events se WHERE se.parcel_id = p.id AND se.status = 'applied'),
        p.updated_at, p.created_at
      ))) / 86400 > $1
      ORDER BY days_since_activity DESC
      LIMIT 100
    `, [DEFAULTS.STUCK_DAYS]);

    const alerts = [];
    for (const r of rows) {
      const days = Math.round(Number(r.days_since_activity));
      const severity = days > 21 ? 'critical' : days > 14 ? 'high' : 'medium';
      alerts.push(await this._createAlertIfNew('stuck_parcel', r.id, r.order_id, severity,
        `Colis ${r.reference} bloqué depuis ${days} jours (statut: ${r.status})`,
        { days_stuck: days, parcel_status: r.status }
      ));
    }
    return alerts.filter(Boolean);
  },

  /**
   * 2. Poids incohérents
   */
  async checkWeightMismatches() {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.order_id,
        p.expected_weight_kg, p.actual_weight_kg,
        ABS(p.expected_weight_kg - p.actual_weight_kg) / NULLIF(p.expected_weight_kg, 0) * 100 AS diff_pct
      FROM parcels p
      WHERE p.expected_weight_kg IS NOT NULL 
        AND p.actual_weight_kg IS NOT NULL
        AND p.expected_weight_kg > 0
        AND ABS(p.expected_weight_kg - p.actual_weight_kg) / p.expected_weight_kg * 100 > $1
        AND p.status NOT IN ('cancelled', 'archived')
      ORDER BY diff_pct DESC
      LIMIT 50
    `, [DEFAULTS.WEIGHT_TOLERANCE_PCT]);

    const alerts = [];
    for (const r of rows) {
      const diff = Math.round(Number(r.diff_pct));
      const severity = diff > 50 ? 'high' : 'medium';
      alerts.push(await this._createAlertIfNew('content_mismatch', r.id, r.order_id, severity,
        `Colis ${r.reference}: poids attendu ${r.expected_weight_kg}kg vs réel ${r.actual_weight_kg}kg (écart ${diff}%)`,
        { expected: Number(r.expected_weight_kg), actual: Number(r.actual_weight_kg), diff_pct: diff }
      ));
    }
    return alerts.filter(Boolean);
  },

  /**
   * 3. SLA Transit — colis en transit trop longtemps
   */
  async checkSLABreaches() {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.order_id, p.status,
        o.reference AS order_ref,
        EXTRACT(EPOCH FROM (NOW() - p.shipped_at)) / 86400 AS days_in_transit
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.status IN ('shipped', 'in_transit')
        AND p.shipped_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (NOW() - p.shipped_at)) / 86400 > $1
      ORDER BY days_in_transit DESC
      LIMIT 100
    `, [DEFAULTS.TRANSIT_MAX_DAYS]);

    const alerts = [];
    for (const r of rows) {
      const days = Math.round(Number(r.days_in_transit));
      const severity = days > 35 ? 'critical' : days > 28 ? 'high' : 'medium';
      alerts.push(await this._createAlertIfNew('delay', r.id, r.order_id, severity,
        `Colis ${r.reference} en transit depuis ${days} jours (SLA: ${DEFAULTS.TRANSIT_MAX_DAYS}j)`,
        { days_in_transit: days, sla_days: DEFAULTS.TRANSIT_MAX_DAYS }
      ));
    }
    return alerts.filter(Boolean);
  },

  /**
   * 4. Colis au relais non vérifiés
   */
  async checkUnverifiedParcels() {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.order_id,
        EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 3600 AS hours_since_arrival
      FROM parcels p
      WHERE p.status = 'available'
        AND (p.verification_status IS NULL OR p.verification_status = 'pending')
        AND EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 3600 > $1
      ORDER BY hours_since_arrival DESC
      LIMIT 50
    `, [DEFAULTS.UNVERIFIED_HOURS]);

    const alerts = [];
    for (const r of rows) {
      const hours = Math.round(Number(r.hours_since_arrival));
      alerts.push(await this._createAlertIfNew('scan_anomaly', r.id, r.order_id, 'medium',
        `Colis ${r.reference} au relais depuis ${hours}h sans vérification de contenu`,
        { hours_at_relais: hours }
      ));
    }
    return alerts.filter(Boolean);
  },

  /**
   * 5. Cash non encaissé
   */
  async checkCashPending() {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.order_id,
        o.reference AS order_ref, o.total_kmf,
        EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 3600 AS hours_available
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'available'
        AND o.payment_mode = 'cash_relais'
        AND o.payment_status != 'paid'
        AND EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 3600 > $1
      ORDER BY hours_available DESC
      LIMIT 50
    `, [DEFAULTS.CASH_PENDING_HOURS]);

    const alerts = [];
    for (const r of rows) {
      const hours = Math.round(Number(r.hours_available));
      alerts.push(await this._createAlertIfNew('payment_issue', r.id, r.order_id, 'high',
        `Colis ${r.reference} disponible depuis ${hours}h — cash non encaissé (${Number(r.total_kmf).toLocaleString('fr-FR')} KMF)`,
        { hours_pending: hours, amount_kmf: Number(r.total_kmf) }
      ));
    }
    return alerts.filter(Boolean);
  },

  /**
   * Crée un incident-alerte seulement s'il n'en existe pas déjà un ouvert
   * pour le même colis + même type
   */
  async _createAlertIfNew(type, parcelId, orderId, severity, description, metadata) {
    return createAlertEngineIncidentIfNew(db, {
      type,
      parcelId,
      orderId,
      severity,
      description,
      metadata,
    });
  },

  async getActiveAlerts(filters) {
    const conditions = ["i.status IN ('open', 'investigating')"];
    const params = [];
    let idx = 1;

    if (filters && filters.type) {
      conditions.push(`i.type = $${idx++}`);
      params.push(filters.type);
    }
    if (filters && filters.severity) {
      conditions.push(`i.severity = $${idx++}`);
      params.push(filters.severity);
    }

    const { rows } = await db.query(`
      SELECT i.*, 
        p.reference AS parcel_ref, p.status AS parcel_status,
        o.reference AS order_ref
      FROM incidents i
      LEFT JOIN parcels p ON p.id = i.parcel_id
      LEFT JOIN orders o ON o.id = i.order_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY 
        CASE i.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        i.created_at DESC
      LIMIT 200
    `, params);

    return rows;
  },

  /**
   * Acquitte une alerte
   */
  async acknowledgeAlert(alertId, acknowledgedBy) {
    return acknowledgeAlertEngineIncident(
      db,
      alertId,
      acknowledgedBy
    );
  }
};

module.exports = AlertEngine;
