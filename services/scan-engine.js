/**
 * scan-engine.js — Moteur de scans PARCEL-FIRST
 * 
 * PRINCIPE: Chaque scan est un ÉVÉNEMENT immutable qui :
 *   1. Est journalisé (append-only dans scan_events)
 *   2. Fait évoluer le statut du colis
 *   3. Met à jour les quantités (cascade parcel_items → order_items)
 *   4. Déclenche des contrôles
 *   5. Génère des incidents si incohérence
 *   6. Rattrape les étapes manquées (smart-scan)
 *
 * RÉSILIENCE: 
 *   - Erreurs récupérables → incident + needs_review
 *   - Erreurs critiques → rejet du scan
 *   - Jamais de suppression, toujours correction append-only
 */
const pool = require('../db');
const log = require('../utils/logger').child({ module: 'scan-engine' });
log.info('[SCAN-ENGINE] version 5ed2bac loaded');

// ════════════════════════════════════════════════════════════════
// MAPPING: event_type → statut colis + étape quantité
// ════════════════════════════════════════════════════════════════

const SCAN_FLOW = {
  preparation_started: { parcel_status: 'preparation', qty_field: null, order: 1 },
  item_scanned:        { parcel_status: null,          qty_field: null, order: 2 },
  packed:              { parcel_status: 'preparation', qty_field: 'qty_packed', order: 3 },
  sealed:              { parcel_status: 'preparation', qty_field: null, order: 4 },
  weight_check:        { parcel_status: null,          qty_field: null, order: 5 },
  ready_to_ship:       { parcel_status: 'preparation', qty_field: null, order: 6 },
  shipped:             { parcel_status: 'shipped',     qty_field: 'qty_shipped', order: 7 },
  transit_confirmed:   { parcel_status: 'in_transit',  qty_field: null, order: 8 },
  relais_received:     { parcel_status: 'available',   qty_field: 'qty_received', order: 9 },
  content_verified:    { parcel_status: null,          qty_field: null, order: 10 },
  customer_collected:  { parcel_status: 'collected',   qty_field: 'qty_collected', order: 11 },
  pickup_failed:       { parcel_status: 'available',   qty_field: null, order: 12 },
  correction:          { parcel_status: null,          qty_field: null, order: 99 },
  anomaly_detected:    { parcel_status: null,          qty_field: null, order: 99 }
};

// Étapes intermédiaires à rattraper automatiquement
const CATCHUP_MAP = {
  shipped:            ['packed'],
  relais_received:    ['packed', 'shipped'],
  customer_collected: ['packed', 'shipped', 'relais_received']
};

// ════════════════════════════════════════════════════════════════
// FONCTION PRINCIPALE: processScan
// ════════════════════════════════════════════════════════════════

/**
 * Traite un scan complet avec :
 *   - Validation
 *   - Smart-catchup des étapes manquées
 *   - Mise à jour des quantités
 *   - Journalisation
 *   - Incidents si anomalie
 *
 * @param {Object} params
 * @param {string} params.parcel_id — UUID du colis
 * @param {string} params.event_type — Type de scan
 * @param {string} [params.scan_code] — Code scanné
 * @param {string} [params.scanned_by] — UUID de l'utilisateur
 * @param {string} [params.actor_name] — Nom de l'acteur
 * @param {string} [params.actor_role] — Role: hub_agent, relay_agent, driver, system, admin
 * @param {string} [params.location] — Lieu du scan
 * @param {number} [params.latitude]
 * @param {number} [params.longitude]
 * @param {string} [params.device_id] — ID device mobile
 * @param {string} [params.notes]
 * @param {Object} [params.metadata] — Données additionnelles
 * @param {number} [params.actual_weight_kg] — Pour weight_check
 * @param {Object[]} [params.items] — Pour content_verified : [{parcel_item_id, verified: bool, qty_found}]
 * @returns {Object} { success, event_id, parcel, catchup_events, incidents }
 */
async function processScan(params) {
  const client = await pool.connect();
  const result = {
    success: false,
    event_id: null,
    catchup_events: [],
    incidents: [],
    parcel: null
  };

  try {
    await client.query('BEGIN');

    // ── 1. Charger le colis ──
    const { rows: [parcel] } = await client.query(
      `SELECT p.*, o.reference AS order_ref, o.id AS order_id
       FROM parcels p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.id = $1`,
      [params.parcel_id]
    );

    if (!parcel) {
      throw new ScanError('PARCEL_NOT_FOUND', `Colis ${params.parcel_id} introuvable`);
    }

    if (parcel.status === 'cancelled') {
      throw new ScanError('PARCEL_CANCELLED', `Colis ${parcel.reference} est annulé`);
    }

    // ── 2. Charger les items du colis ──
    const { rows: parcelItems } = await client.query(
      `SELECT pi.*, oi.product_id, oi.product_name AS oi_product_name
       FROM parcel_items pi
       LEFT JOIN order_items oi ON oi.id = pi.order_item_id
       WHERE pi.parcel_id = $1`,
      [params.parcel_id]
    );

    // ── 3. Snapshot quantités AVANT ──
    const qtyBefore = buildQtySnapshot(parcelItems);

    // ── 4. Validation du scan ──
    const flow = SCAN_FLOW[params.event_type];
    if (!flow) {
      throw new ScanError('UNKNOWN_EVENT', `Type de scan inconnu: ${params.event_type}`);
    }

    // Vérification de séquence (soft: incident au lieu de blocage)
    const sequenceIssue = checkSequence(parcel.status, params.event_type);
    if (sequenceIssue) {
      result.incidents.push(
        await createIncident(client, {
          parcel_id: params.parcel_id,
          order_id: parcel.order_id,
          incident_type: 'sequence_violation',
          severity: sequenceIssue.severity,
          title: sequenceIssue.title,
          description: sequenceIssue.description,
          details: { current_status: parcel.status, attempted_event: params.event_type },
          detected_by: params.scanned_by,
          detected_source: params.actor_role || 'system'
        })
      );

      // Si critique → rejeter le scan
      if (sequenceIssue.severity === 'critical') {
        const rejectedEvent = await logScanEvent(client, {
          ...params,
          order_id: parcel.order_id,
          status: 'rejected',
          error_message: sequenceIssue.title,
          qty_before: qtyBefore,
          qty_after: qtyBefore
        });
        result.event_id = rejectedEvent.id;
        await client.query('COMMIT');
        result.success = false;
        return result;
      }
    }

    // ── 5. Smart Catchup — rattraper les étapes manquées ──
    const catchups = CATCHUP_MAP[params.event_type] || [];
    for (const catchupType of catchups) {
      const catchupFlow = SCAN_FLOW[catchupType];
      if (!catchupFlow) continue;

      // Vérifier si l'étape a déjà été faite
      const alreadyDone = await isStepCompleted(client, params.parcel_id, catchupType);
      if (alreadyDone) continue;

      // Appliquer le rattrapage
      if (catchupFlow.qty_field) {
        await cascadeQuantities(client, params.parcel_id, catchupFlow.qty_field);
      }

      if (catchupFlow.parcel_status) {
        // Ne mettre à jour le statut que s'il progresse
        const currentOrder = getStatusOrder(parcel.status);
        const catchupOrder = catchupFlow.order;
        if (catchupOrder > currentOrder) {
          // On ne met pas à jour ici, on le fera avec l'événement principal
        }
      }

      // Journaliser le rattrapage
      const catchupEvent = await logScanEvent(client, {
        parcel_id: params.parcel_id,
        order_id: parcel.order_id,
        event_type: catchupType,
        scanned_by: params.scanned_by,
        actor_name: params.actor_name || 'Système (rattrapage)',
        actor_role: 'system',
        location: params.location,
        notes: `Rattrapage automatique déclenché par scan ${params.event_type}`,
        metadata: { triggered_by: params.event_type, auto_catchup: true },
        status: 'applied',
        qty_before: buildQtySnapshot(parcelItems),
        qty_after: buildQtySnapshot(parcelItems) // Will be updated below
      });

      result.catchup_events.push({
        id: catchupEvent.id,
        type: catchupType,
        auto: true
      });

      // Créer un incident informatif pour le rattrapage
      result.incidents.push(
        await createIncident(client, {
          parcel_id: params.parcel_id,
          order_id: parcel.order_id,
          scan_event_id: catchupEvent.id,
          incident_type: 'scan_anomaly',
          severity: 'low',
          title: `Étape ${catchupType} rattrapée automatiquement`,
          description: `L'étape ${catchupType} n'avait pas été scannée. Rattrapage auto lors de ${params.event_type}.`,
          details: { catchup_type: catchupType, triggered_by: params.event_type },
          detected_source: 'system'
        })
      );
    }

    // ── 6. Appliquer les quantités de l'événement principal ──
    if (flow.qty_field) {
      await cascadeQuantities(client, params.parcel_id, flow.qty_field);
    }

    // ── 7. Mettre à jour le statut du colis ──
    if (flow.parcel_status) {
      const updateFields = [`status = $2`];
      const updateValues = [params.parcel_id, flow.parcel_status];
      let paramIdx = 3;

      // Timestamps automatiques selon le statut
      if (flow.parcel_status === 'shipped') {
        updateFields.push(`shipped_at = COALESCE(shipped_at, NOW())`);
      } else if (flow.parcel_status === 'available') {
        updateFields.push(`received_at = COALESCE(received_at, NOW())`);
      } else if (flow.parcel_status === 'collected') {
        updateFields.push(`collected_at = COALESCE(collected_at, NOW())`);
      }

      await client.query(
        `UPDATE parcels SET ${updateFields.join(', ')} WHERE id = $1`,
        updateValues
      );
    }

    // ── 8. Traitement spécifique: weight_check ──
    if (params.event_type === 'weight_check' && params.actual_weight_kg != null) {
      await client.query(
        `UPDATE parcels SET actual_weight_kg = $2 WHERE id = $1`,
        [params.parcel_id, params.actual_weight_kg]
      );

      // Comparer avec le poids attendu
      if (parcel.expected_weight_kg) {
        const diff = Math.abs(params.actual_weight_kg - parcel.expected_weight_kg);
        const tolerance = parcel.expected_weight_kg * 0.15; // 15% tolérance
        if (diff > tolerance) {
          result.incidents.push(