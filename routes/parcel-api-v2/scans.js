/**
 * @komerce-arch
 * @role          logistics-scans
 * @domain        logistics
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       parcels
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * routes/parcel-api-v2/scans.js
 * Extrait de routes/parcel-api-v2.js — lot GOD-FILES-4 (2026-05-25)
 *
 * POST /api/v2/parcels/:ref/scan — Scanner + sync auto via scan-engine
 *
 * I-03 : transitions forward-only + idempotentes.
 * Les conditions de guard sont dans scan-engine.processScan() — ne pas modifier.
 * I-09 : chaque colis est une unité autonome.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const log     = require('../../utils/logger').child({ module: 'parcel-api-v2' });
const { clearCache } = require('./helpers');

// Mapping event_type API v2 → scan-engine event_type canonique
const V2_TO_ENGINE_EVENT = {
  preparation: 'packed',
  shipped:     'shipped',
  in_transit:  'transit_confirmed',
  arrived:     'relais_received',
  available:   'relais_received',
  collected:   'customer_collected',
};

router.post('/:ref/scan', async (req, res, next) => {
  try {
    const { ref } = req.params;
    const { event_type, location, notes, actor_name, actor_role } = req.body;

    if (!event_type) {
      return res.status(400).json({ error: 'event_type requis' });
    }

    // Résoudre le parcel (hors transaction — processScan ouvre la sienne)
    const { rows: [parcel] } = await db.query(
      `SELECT id, reference, status FROM parcels WHERE reference = $1 OR id::text = $1`, [ref]
    );
    if (!parcel) {
      return res.status(404).json({ error: `Colis ${ref} introuvable` });
    }

    // Mapper l'event_type v2 vers l'event_type canonique scan-engine
    const engineEventType = V2_TO_ENGINE_EVENT[event_type];
    if (!engineEventType) {
      return res.status(400).json({
        error: `event_type inconnu: ${event_type}. Valeurs: ${Object.keys(V2_TO_ENGINE_EVENT).join(', ')}`,
      });
    }

    const actorId       = req.user?.id || null;
    const actorRoleFinal = actor_role
      || (req.user?.role === 'agent_hub'    ? 'hub_agent'
        : req.user?.role === 'agent_relais' ? 'relay_agent'
        : 'system');

    // Déléguer à scan-engine (gère sa propre transaction)
    const scanEngine = require('../../services/scan-engine');
    const result = await scanEngine.processScan({
      parcel_id:  parcel.id,
      event_type: engineEventType,
      scanned_by: actorId,
      actor_name: actor_name || req.user?.full_name || 'Système',
      actor_role: actorRoleFinal,
      location:   location || null,
      notes:      notes    || null,
    });

    if (!result.success) {
      const incident = result.incidents?.[0];
      return res.status(409).json({
        error:     incident?.title || 'Scan rejeté par le moteur de séquence',
        incidents: result.incidents || [],
      });
    }

    clearCache();

    // ── Notifications (fire-and-forget) ──────────────────────────────────
    const notif = require('../../services/notification-service');
    notif.notifyParcelScan(parcel.id, parcel.reference, result.parcel?.status || engineEventType)
      .catch(e => log.error({ err: e }, '[SCAN-NOTIF] ❌'));

    res.json({
      success: true,
      scan: {
        id:         result.event_id,
        event_type: engineEventType,
      },
      parcel: {
        reference:  parcel.reference,
        old_status: parcel.status,
        new_status: result.parcel?.status,
      },
      catchup_events: result.catchup_events || [],
      incidents:      result.incidents      || [],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
