/**
 * @komerce-arch
 * @role          logistics-scan-engine
 * @domain        logistics
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/incident-write-service.js, services/notification-service.js, services/order-status-machine.js, utils/logger.js
 * @used-by       routes/parcel-api-v2/scans.js
 * @db-read       incidents, order_items, orders, parcel_items, parcels, products, relais, scan_events
 * @db-write      order_items, parcel_items, parcels, scan_events
 * @db-write-via:incident-write-service incidents
 * @db-write-via:order-status-machine product_variants, order_status_history, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';
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
const { createScanIncident: createIncident } = require('./incident-write-service');
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

    const { parcel, parcelItems, qtyBefore } = await _loadScanContext(client, params);

    const flow = SCAN_FLOW[params.event_type];
    if (!flow) {
      throw new ScanError('UNKNOWN_EVENT', `Type de scan inconnu: ${params.event_type}`);
    }

    const { valid } = await _validateAndCatchup(client, params, parcel, parcelItems, result);
    if (!valid) {
      await client.query('COMMIT');
      return result;
    }

    await _applyEvent(client, params, parcel, parcelItems, flow, result);

    await _finalizeAndLog(client, params, parcel, flow, qtyBefore, result);

    await client.query('COMMIT');

    // ── 13. Résultat ──
    const { rows: [updatedParcel] } = await client.query(
      `SELECT * FROM parcels WHERE id = $1`, [params.parcel_id]
    );
    result.parcel = updatedParcel;
    result.success = true;

    // ── 14. Notifications WhatsApp (après COMMIT, non-bloquant) ──
    if (flow.parcel_status && ['shipped', 'available'].includes(flow.parcel_status)) {
      const { notifyParcelScan } = require('./notification-service');
      notifyParcelScan(params.parcel_id, updatedParcel.reference, flow.parcel_status)
        .catch(err => log.error({ err }, '[SCAN-ENGINE] Notification error'));
    }

    return result;

  } catch (err) {
    await client.query('ROLLBACK');

    if (err instanceof ScanError) {
      // Erreur métier attendue → journaliser comme rejeté
      try {
        const rejectedEvent = await logScanEventDirect({
          ...params,
          status: 'rejected',
          error_message: err.message,
          qty_before: {},
          qty_after: {}
        });
        result.event_id = rejectedEvent.id;
      } catch (logErr) {
        log.error({ err: logErr }, '[scan-engine] Erreur lors de la journalisation du rejet');
      }
      result.error = { code: err.code, message: err.message };
      return result;
    }

    // Erreur système inattendue
    log.error({ err }, '[scan-engine] Erreur système');
    throw err;

  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════════
// SOUS-FONCTIONS PRIVÉES (non exportées)
// ════════════════════════════════════════════════════════════════

/**
 * Étapes 1-3 : charge parcel, parcelItems, construit qtyBefore.
 * Throws ScanError si colis introuvable ou cancelled.
 * @returns {{ parcel, parcelItems, qtyBefore }}
 */
async function _loadScanContext(client, params) {
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

  return { parcel, parcelItems, qtyBefore };
}

/**
 * Étape 4 : vérifie flow + séquence. Si critique → log event rejeté + return { valid: false }.
 * Étape 5 : smart-catchup (CATCHUP_MAP). Mutate parcelItems en place (splice).
 * @returns {{ valid: boolean, flow }}
 */
async function _validateAndCatchup(client, params, parcel, parcelItems, result) {
  const flow = SCAN_FLOW[params.event_type];
  const qtyBefore = buildQtySnapshot(parcelItems);

  // ── 4. Validation du scan ──
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
      result.success = false;
      return { valid: false, flow };
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
    const catchupQtyBefore = buildQtySnapshot(parcelItems);

    if (catchupFlow.qty_field) {
      await cascadeQuantities(client, params.parcel_id, catchupFlow.qty_field);
    }

    // PATCH P1-5 : snapshot qty_after LU APRÈS cascadeQuantities (et non avant).
    // Avant ce patch, qty_after === qty_before pour tous les catchup events.
    let catchupQtyAfter = catchupQtyBefore;
    if (catchupFlow.qty_field) {
      const { rows: itemsAfterCatchup } = await client.query(
        `SELECT * FROM parcel_items WHERE parcel_id = $1`,
        [params.parcel_id]
      );
      catchupQtyAfter = buildQtySnapshot(itemsAfterCatchup);
      // Mettre à jour parcelItems pour que le prochain catchup parte du bon état
      parcelItems.splice(0, parcelItems.length, ...itemsAfterCatchup);
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
      qty_before: catchupQtyBefore,
      qty_after: catchupQtyAfter,
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

  return { valid: true, flow };
}

/**
 * Étapes 6-9 : quantités + statut + weight_check + content_verified.
 * Modifie la DB dans la transaction courante.
 */
async function _applyEvent(client, params, parcel, parcelItems, flow, result) {
  // ── 6. Appliquer les quantités de l'événement principal ──
  if (flow.qty_field) {
    await cascadeQuantities(client, params.parcel_id, flow.qty_field);
  }

  // ── 7. Mettre à jour le statut du colis (via SSOT parcel-operations) ──
  if (flow.parcel_status) {
    const { transitionParcelStatus } = require('./parcel-operations');
    await transitionParcelStatus(client, params.parcel_id, flow.parcel_status, { skipValidation: true });
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
          await createIncident(client, {
            parcel_id: params.parcel_id,
            order_id: parcel.order_id,
            incident_type: 'weight_mismatch',
            severity: diff > tolerance * 2 ? 'high' : 'medium',
            title: `Écart de poids: ${params.actual_weight_kg}kg vs ${parcel.expected_weight_kg}kg attendu`,
            description: `Différence de ${diff.toFixed(2)}kg (tolérance: ${tolerance.toFixed(2)}kg)`,
            details: {
              expected_kg: parcel.expected_weight_kg,
              actual_kg: params.actual_weight_kg,
              diff_kg: diff,
              tolerance_kg: tolerance
            },
            detected_by: params.scanned_by,
            detected_source: params.actor_role || 'hub_agent'
          })
        );
      }
    }
  }

  // ── 9. Traitement spécifique: content_verified (vérification relais) ──
  if (params.event_type === 'content_verified' && params.items) {
    const verificationResult = await processContentVerification(
      client, params.parcel_id, parcel.order_id, params.items, params.scanned_by, params.actor_role
    );
    result.incidents.push(...verificationResult.incidents);

    // Mettre à jour le statut de vérification du colis
    const allVerified = verificationResult.all_ok;
    await client.query(
      `UPDATE parcels SET
        verification_status = $2,
        verified_at = NOW(),
        verified_by = $3,
        verification_notes = $4
      WHERE id = $1`,
      [
        params.parcel_id,
        allVerified ? 'verified' : 'discrepancy',
        params.scanned_by,
        allVerified ? 'Contenu vérifié OK' : `${verificationResult.issues.length} écart(s) détecté(s)`
      ]
    );
  }
}

/**
 * Étapes 10-14 (hors notifications) : snapshot qty_after + logScanEvent +
 * syncOrderFromParcels + peuple result.event_id.
 * Les notifications post-commit (étape 14) restent dans processScan après COMMIT.
 */
async function _finalizeAndLog(client, params, parcel, flow, qtyBefore, result) {
  // ── 10. Snapshot quantités APRÈS ──
  const { rows: updatedItems } = await client.query(
    `SELECT * FROM parcel_items WHERE parcel_id = $1`,
    [params.parcel_id]
  );
  const qtyAfter = buildQtySnapshot(updatedItems);

  // ── 11. Journaliser l'événement principal ──
  const mainEvent = await logScanEvent(client, {
    ...params,
    order_id: parcel.order_id,
    status: 'applied',
    qty_before: qtyBefore,
    qty_after: qtyAfter
  });
  result.event_id = mainEvent.id;

  // ── 12. Propager vers order_items + recalculer statut commande ──
  await syncOrderFromParcels(client, parcel.order_id);
}

// ════════════════════════════════════════════════════════════════
// HELPERS INTERNES
// ════════════════════════════════════════════════════════════════

/** Cascade les quantités vers le champ cible pour tous les items d'un colis */
async function cascadeQuantities(client, parcelId, qtyField) {
  // Le champ source est toujours le champ précédent dans la chaîne
  const chain = ['qty_allocated', 'qty_packed', 'qty_shipped', 'qty_received', 'qty_collected'];
  const targetIdx = chain.indexOf(qtyField);
  if (targetIdx <= 0) return;

  const sourceField = chain[targetIdx - 1];

  await client.query(
    `UPDATE parcel_items
     SET ${qtyField} = ${sourceField}
     WHERE parcel_id = $1 AND ${qtyField} < ${sourceField}`,
    [parcelId]
  );
}

/** Vérifie si une étape a déjà été complétée pour un colis */
async function isStepCompleted(client, parcelId, eventType) {
  const { rows } = await client.query(
    `SELECT 1 FROM scan_events
     WHERE parcel_id = $1 AND event_type = $2 AND status = 'applied'
     LIMIT 1`,
    [parcelId, eventType]
  );
  return rows.length > 0;
}

/** Retourne l'ordre numérique d'un statut colis */
function getStatusOrder(status) {
  const statusOrder = {
    draft: 0, preparation: 1, shipped: 3, in_transit: 4,
    arrived: 5, available: 5, collected: 6, cancelled: -1
  };
  return statusOrder[status] || 0;
}

/** Vérifie la séquence du scan vs le statut actuel */
function checkSequence(currentStatus, eventType) {
  const flow = SCAN_FLOW[eventType];
  if (!flow || !flow.parcel_status) return null;

  // collected directement depuis draft/preparation → critique
  if (eventType === 'customer_collected' && ['draft', 'preparation'].includes(currentStatus)) {
    return {
      severity: 'critical',
      title: `Séquence invalide: ${eventType} depuis ${currentStatus}`,
      description: `Un colis en ${currentStatus} ne peut pas être collecté directement.`
    };
  }

  // Scan en arrière (ex: preparation quand déjà shipped)
  // PATCH P2-5 : durcissement des sévérités backward scan.
  // Les transitions critiques (régresser depuis collected/available) sont bloquantes.
  // Les autres sont dégradées de 'medium' à 'high' (non bloquant mais visible dans le radar).
  const currentOrder = getStatusOrder(currentStatus);
  const targetOrder = flow.order;
  if (targetOrder < currentOrder && eventType !== 'correction') {
    // Régresser depuis un état terminal ou quasi-terminal → bloquant
    const TERMINAL_STATUSES = ['collected', 'available'];
    if (TERMINAL_STATUSES.includes(currentStatus)) {
      return {
        severity: 'critical',
        title: `Scan rétrograde bloqué: ${eventType} alors que le colis est ${currentStatus}`,
        description: `Un colis en statut terminal (${currentStatus}) ne peut pas revenir à ${eventType}. Utilisez une correction explicite si nécessaire.`
      };
    }
    // Rétrogradation non-terminale → high (signalé dans radar, non bloquant)
    return {
      severity: 'high',
      title: `Scan en arrière: ${eventType} alors que le colis est ${currentStatus}`,
      description: `Le colis est déjà à un stade avancé (${currentStatus}). Ce scan pourrait indiquer une erreur terrain.`
    };
  }

  return null;
}

/** Traite la vérification de contenu au relais */
async function processContentVerification(client, parcelId, orderId, items, verifiedBy, actorRole) {
  const result = { all_ok: true, issues: [], incidents: [] };

  // Charger les items attendus
  const { rows: expectedItems } = await client.query(
    `SELECT pi.*, oi.product_name AS oi_product_name, oi.product_id
     FROM parcel_items pi
     LEFT JOIN order_items oi ON oi.id = pi.order_item_id
     WHERE pi.parcel_id = $1`,
    [parcelId]
  );

  const expectedMap = new Map(expectedItems.map(i => [i.id, i]));
  const checkedIds = new Set();

  for (const item of items) {
    const expected = expectedMap.get(item.parcel_item_id);

    if (!expected) {
      // Article scanné mais pas dans le manifeste → UNEXPECTED
      result.all_ok = false;
      result.issues.push({ type: 'unexpected', parcel_item_id: item.parcel_item_id });
      result.incidents.push(
        await createIncident(client, {
          parcel_id: parcelId,
          order_id: orderId,
          incident_type: 'unexpected_item',
          severity: 'high',
          title: `Article non attendu dans colis`,
          description: `Un article non prévu dans le manifeste a été trouvé lors de la vérification.`,
          client_impact: 'wrong_item',
          details: { parcel_item_id: item.parcel_item_id, qty_found: item.qty_found || 0 },
          detected_by: verifiedBy,
          detected_source: actorRole || 'relay_agent'
        })
      );
      continue;
    }

    checkedIds.add(item.parcel_item_id);
    const qtyExpected = expected.qty_shipped || expected.qty_packed || expected.qty_allocated;
    const qtyFound = item.qty_found != null ? item.qty_found : (item.verified ? qtyExpected : 0);

    // Marquer comme vérifié
    await client.query(
      `UPDATE parcel_items SET verified = $2, verified_at = NOW(), verified_by = $3 WHERE id = $1`,
      [item.parcel_item_id, item.verified !== false, verifiedBy]
    );

    if (qtyFound < qtyExpected) {
      // MISSING — quantité insuffisante
      result.all_ok = false;
      result.issues.push({
        type: 'missing',
        parcel_item_id: item.parcel_item_id,
        expected: qtyExpected,
        found: qtyFound
      });
      result.incidents.push(
        await createIncident(client, {
          parcel_id: parcelId,
          order_id: orderId,
          order_item_id: expected.order_item_id,
          incident_type: 'missing_item',
          severity: qtyFound === 0 ? 'critical' : 'high',
          title: `Article manquant: ${qtyFound}/${qtyExpected} trouvé(s)`,
          description: `${expected.oi_product_name || expected.product_name || 'Article'}: ${qtyExpected - qtyFound} unité(s) manquante(s)`,
          client_impact: 'partial_delivery',
          details: {
            parcel_item_id: item.parcel_item_id,
            order_item_id: expected.order_item_id,
            product_name: expected.oi_product_name || expected.product_name,
            qty_expected: qtyExpected,
            qty_found: qtyFound,
            qty_missing: qtyExpected - qtyFound
          },
          detected_by: verifiedBy,
          detected_source: actorRole || 'relay_agent'
        })
      );
    } else if (qtyFound > qtyExpected) {
      // SURPLUS — trop d'articles
      result.all_ok = false;
      result.issues.push({
        type: 'surplus',
        parcel_item_id: item.parcel_item_id,
        expected: qtyExpected,
        found: qtyFound
      });
      result.incidents.push(
        await createIncident(client, {
          parcel_id: parcelId,
          order_id: orderId,
          incident_type: 'quantity_mismatch',
          severity: 'medium',
          title: `Surplus: ${qtyFound}/${qtyExpected} trouvé(s)`,
          description: `${expected.oi_product_name || expected.product_name || 'Article'}: ${qtyFound - qtyExpected} unité(s) en trop`,
          client_impact: 'none',
          details: {
            parcel_item_id: item.parcel_item_id,
            qty_expected: qtyExpected,
            qty_found: qtyFound,
            qty_surplus: qtyFound - qtyExpected
          },
          detected_by: verifiedBy,
          detected_source: actorRole || 'relay_agent'
        })
      );
    }
  }

  // Articles attendus mais NON vérifiés
  for (const [id, expected] of expectedMap) {
    if (!checkedIds.has(id)) {
      result.all_ok = false;
      const qtyExpected = expected.qty_shipped || expected.qty_packed || expected.qty_allocated;
      result.issues.push({ type: 'not_checked', parcel_item_id: id });
      result.incidents.push(
        await createIncident(client, {
          parcel_id: parcelId,
          order_id: orderId,
          order_item_id: expected.order_item_id,
          incident_type: 'missing_item',
          severity: 'high',
          title: `Article non vérifié/manquant lors du contrôle`,
          description: `${expected.oi_product_name || expected.product_name || 'Article'}: ${qtyExpected} unité(s) attendue(s), non trouvée(s)`,
          client_impact: 'partial_delivery',
          details: {
            parcel_item_id: id,
            order_item_id: expected.order_item_id,
            product_name: expected.oi_product_name || expected.product_name,
            qty_expected: qtyExpected,
            not_checked: true
          },
          detected_by: verifiedBy,
          detected_source: actorRole || 'relay_agent'
        })
      );
    }
  }

  return result;
}

/** Synchronise les quantités order_items depuis les parcel_items + recalcule le statut commande */
async function syncOrderFromParcels(client, orderId) {
  if (!orderId) return;

  const { transitionOrderStatus } = require('./order-status-machine');

  // Agréger les quantités des parcel_items par order_item_id
  await client.query(`
    UPDATE order_items oi SET
      qty_allocated = COALESCE(agg.total_allocated, 0),
      qty_packed    = COALESCE(agg.total_packed, 0),
      qty_shipped   = COALESCE(agg.total_shipped, 0),
      qty_received  = COALESCE(agg.total_received, 0),
      qty_collected = COALESCE(agg.total_collected, 0)
    FROM (
      SELECT
        pi.order_item_id,
        SUM(pi.qty_allocated) AS total_allocated,
        SUM(pi.qty_packed) AS total_packed,
        SUM(pi.qty_shipped) AS total_shipped,
        SUM(pi.qty_received) AS total_received,
        SUM(pi.qty_collected) AS total_collected
      FROM parcel_items pi
      JOIN parcels p ON p.id = pi.parcel_id AND p.order_id = $1 AND p.status != 'cancelled'
      WHERE pi.order_item_id IS NOT NULL
      GROUP BY pi.order_item_id
    ) agg
    WHERE oi.id = agg.order_item_id
  `, [orderId]);

  // ── Recalculer le statut commande depuis les colis ──
  // ✅ FIX: Uses VALID statuses from the order_status ENUM only
  // ✅ FIX: Uses transitionOrderStatus (state machine SSOT) instead of direct SQL
  const { rows: [stats] } = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('cancelled')) AS active,
      COUNT(*) FILTER (WHERE status = 'collected') AS collected,
      COUNT(*) FILTER (WHERE status = 'available') AS available,
      COUNT(*) FILTER (WHERE status IN ('shipped', 'in_transit')) AS in_transit,
      COUNT(*) FILTER (WHERE status IN ('draft', 'preparation')) AS pending
    FROM parcels WHERE order_id = $1
  `, [orderId]);

  // Map parcel aggregate status → valid order status
  let newStatus = null;
  if (!stats || parseInt(stats.active) === 0) {
    newStatus = null; // No change
  } else if (parseInt(stats.collected) === parseInt(stats.active)) {
    newStatus = 'collected';        // ✅ Was 'delivered' (INVALID)
  } else if (parseInt(stats.available) > 0) {
    newStatus = 'available';        // ✅ Valid
  } else if (parseInt(stats.in_transit) > 0) {
    newStatus = 'in_transit';       // ✅ Valid
  } else if (parseInt(stats.pending) > 0) {
    newStatus = 'preparation';      // ✅ Was 'processing' (INVALID)
  }
  // ❌ Removed 'partially_delivered' — not in ENUM

  if (newStatus) {
    // Use state machine SSOT — NOT direct SQL
    const result = await transitionOrderStatus({
      orderId,
      newStatus,
      actor: { id: null, role: 'system' },
      source: 'scan_engine_sync',
      note: `Auto-sync from parcel aggregation`,
      dbClient: client,
    });
    if (!result.success) {
      log.warn({ order_id: orderId, new_status: newStatus, error: result.error }, '[SCAN-ENGINE] syncOrderFromParcels: transition failed');
    }
  }
}

/** Journalise un événement scan dans la transaction courante */
async function logScanEvent(client, params) {
  const { rows: [event] } = await client.query(`
    INSERT INTO scan_events (
      parcel_id, order_id, event_type, scan_code,
      scanned_by, actor_name, actor_role,
      location, latitude, longitude, device_id,
      notes, metadata, qty_before, qty_after,
      status, error_message, corrects_event_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *
  `, [
    params.parcel_id, params.order_id, params.event_type, params.scan_code || null,
    params.scanned_by || null, params.actor_name || null, params.actor_role || null,
    params.location || null, params.latitude || null, params.longitude || null, params.device_id || null,
    params.notes || null, JSON.stringify(params.metadata || {}),
    JSON.stringify(params.qty_before || {}), JSON.stringify(params.qty_after || {}),
    params.status || 'applied', params.error_message || null, params.corrects_event_id || null
  ]);
  return event;
}

/** Journalise hors transaction (pour les rejets après rollback) */
async function logScanEventDirect(params) {
  const { rows: [event] } = await pool.query(`
    INSERT INTO scan_events (
      parcel_id, order_id, event_type, scan_code,
      scanned_by, actor_name, actor_role,
      location, notes, metadata, qty_before, qty_after,
      status, error_message
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `, [
    params.parcel_id, params.order_id || null, params.event_type, params.scan_code || null,
    params.scanned_by || null, params.actor_name || null, params.actor_role || null,
    params.location || null, params.notes || null, JSON.stringify(params.metadata || {}),
    JSON.stringify(params.qty_before || {}), JSON.stringify(params.qty_after || {}),
    params.status || 'rejected', params.error_message || null
  ]);
  return event;
}

/** Construit un snapshot des quantités pour un ensemble d'items */
function buildQtySnapshot(items) {
  const snapshot = {};
  for (const item of items) {
    snapshot[item.id] = {
      allocated: item.qty_allocated || 0,
      packed: item.qty_packed || 0,
      shipped: item.qty_shipped || 0,
      received: item.qty_received || 0,
      collected: item.qty_collected || 0
    };
  }
  return snapshot;
}

/** Crée un incident dans la transaction courante */

// ════════════════════════════════════════════════════════════════
// CORRECTION D'ÉVÉNEMENT (append-only)
// ════════════════════════════════════════════════════════════════

/**
 * Corrige un scan précédent sans supprimer l'historique.
 * Crée un événement "correction" qui référence l'original.
 */
async function correctScanEvent(originalEventId, correctionParams) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Charger l'événement original
    const { rows: [original] } = await client.query(
      `SELECT * FROM scan_events WHERE id = $1`,
      [originalEventId]
    );
    if (!original) throw new ScanError('EVENT_NOT_FOUND', 'Événement introuvable');

    // Marquer l'original comme corrigé (reversed)
    await client.query(
      `UPDATE scan_events SET status = 'reversed' WHERE id = $1`,
      [originalEventId]
    );

    // Créer l'événement correctif
    const correctionEvent = await logScanEvent(client, {
      parcel_id: original.parcel_id,
      order_id: original.order_id,
      event_type: 'correction',
      scanned_by: correctionParams.corrected_by,
      actor_name: correctionParams.actor_name,
      actor_role: correctionParams.actor_role || 'admin',
      notes: correctionParams.reason || `Correction de l'événement ${originalEventId}`,
      metadata: {
        original_event_id: originalEventId,
        original_type: original.event_type,
        correction_reason: correctionParams.reason
      },
      corrects_event_id: originalEventId,
      status: 'applied',
      qty_before: original.qty_after,
      qty_after: correctionParams.qty_after || original.qty_before
    });

    await client.query('COMMIT');
    return correctionEvent;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════════
// TRAÇABILITÉ — historique complet d'un colis
// ════════════════════════════════════════════════════════════════

async function getParcelTrace(parcelId) {
  // Colis + commande + client
  const { rows: [parcel] } = await pool.query(`
    SELECT
      p.*,
      o.reference AS order_ref, o.status AS order_status,
      o.client_name, o.client_phone, o.client_email,
      o.total_amount, o.payment_method,
      r.name AS relais_name, r.zone AS relais_city, r.address AS relais_address
    FROM parcels p
    LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN relais r ON r.id = p.relais_id
    WHERE p.id = $1
  `, [parcelId]);

  if (!parcel) return null;

  // Items du colis avec détail order_item
  const { rows: items } = await pool.query(`
    SELECT
      pi.*,
      oi.product_name AS oi_product_name,
      oi.product_id,
      oi.price,
      oi.qty_ordered AS oi_qty_ordered,
      pr.name AS product_ref_name
    FROM parcel_items pi
    LEFT JOIN order_items oi ON oi.id = pi.order_item_id
    LEFT JOIN products pr ON pr.id = oi.product_id
    WHERE pi.parcel_id = $1
    ORDER BY pi.created_at
  `, [parcelId]);

  // Timeline complète (tous les scans, même rejetés/inversés)
  const { rows: timeline } = await pool.query(`
    SELECT * FROM scan_events
    WHERE parcel_id = $1
    ORDER BY created_at ASC
  `, [parcelId]);

  // Incidents liés
  const { rows: incidents } = await pool.query(`
    SELECT * FROM incidents
    WHERE parcel_id = $1
    ORDER BY created_at DESC
  `, [parcelId]);

  return { parcel, items, timeline, incidents };
}

// ════════════════════════════════════════════════════════════════
// ERROR CLASS
// ════════════════════════════════════════════════════════════════

class ScanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'ScanError';
  }
}

// ════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════

module.exports = {
  processScan,
  correctScanEvent,
  getParcelTrace,
  syncOrderFromParcels,
  ScanError,
  // @test-only — helpers internes exposés pour les tests de caractérisation
  _getStatusOrder: getStatusOrder,
  _checkSequence: checkSequence,
  _buildQtySnapshot: buildQtySnapshot,
  _processContentVerification: processContentVerification,
  _logScanEventDirect: logScanEventDirect,
};
