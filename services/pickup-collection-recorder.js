/**
 * @komerce-arch
 * @role          pickup-collection-recorder
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        client, order, agentId, role, pickupMethod, notes, authorizationVersion?, documentChecked?
 * @outputs       { scanId, collectedAt, parcelId, parcelReference, orderStatus, partial }
 * @depends       services/order-status-machine.js, services/order-mutation-service.js, services/pickup-secret-rotation-service.js, utils/parcelSync.js
 * @used-by       services/pickup-collection-service.js, services/pickup-exceptional-collection-service.js
 * @db-write      scans, pickup_reveal_codes, pickup_print_tokens
 * @db-write-via:order-status-machine product_variants, order_status_history, orders, products
 * @db-write-via:order-mutation-service orders
 * @db-write-via:parcelSync parcels, parcel_items
 * @db-txn        participant (client transactionnel obligatoire)
 * @doctrine      docs/architecture/IMPACT_FEATURE_FIRST_FULFILLMENT_MIXTE.md R9-R10
 * @impact-areas  logistics, pickup
 * @version       2026-09
 */
'use strict';

const {
  finalizePickupCollection,
  setExceptionalPickupAttemptState,
} = require('./order-mutation-service');
const { transitionOrderStatus } = require('./order-status-machine');
const { rotatePickupSecretAfterPartialCollection } = require('./pickup-secret-rotation-service');
const { safeSyncScanToParcels } = require('../utils/parcelSync');

async function purgePickupCaches(client, orderId) {
  await client.query('DELETE FROM pickup_reveal_codes WHERE order_id = $1', [orderId]);
  await client.query('DELETE FROM pickup_print_tokens WHERE order_id = $1', [orderId]);
}

async function recordCanonicalCollection({
  client,
  order,
  agentId,
  role,
  pickupMethod,
  notes,
  authorizationVersion = null,
  documentChecked = false,
}) {
  if (!client) throw new Error('_recordCanonicalCollection: client transactionnel requis');
  if (!order || order.status !== 'available') {
    throw new Error('_recordCanonicalCollection: commande non disponible au retrait');
  }

  const isExceptional = pickupMethod === 'AUTHORIZED_NAME_ID_CHECK';
  if (pickupMethod !== 'PICKUP_CODE' && !isExceptional) {
    throw new Error('_recordCanonicalCollection: méthode de retrait inconnue');
  }
  if (isExceptional && (
    !Number.isInteger(authorizationVersion) || authorizationVersion <= 0 || documentChecked !== true
  )) {
    throw new Error('_recordCanonicalCollection: preuve nominative incomplète');
  }
  if (!isExceptional && (authorizationVersion !== null || documentChecked !== false)) {
    throw new Error('_recordCanonicalCollection: preuve code incohérente');
  }

  const { rows: [scan] } = await client.query(
    `INSERT INTO scans (
       order_id, step, scan_code, scanned_by, notes, pickup_method,
       authorization_version, document_checked, pickup_relais_id
     ) VALUES ($1, 'collected', $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      order.id,
      order.reference,
      agentId,
      notes,
      pickupMethod,
      authorizationVersion,
      documentChecked,
      order.relais_id,
    ]
  );

  // V1 fulfillment mixte : la collecte normale cible exactement UN parcel
  // AVAILABLE. parcelSync choisit le premier prêt selon un ordre stable,
  // verrouille ce lot et recalcule ensuite le parent sur TOUS les parcels.
  const syncResult = await safeSyncScanToParcels({
    order_id: order.id,
    step: 'collected',
    scan_id: scan.id,
    target_one_available: true,
    scanned_by: agentId,
    notes,
  }, client);

  if (!syncResult.synced) {
    if (syncResult.reason === 'no_available_parcel') {
      const error = new Error('Aucun colis de cette commande n’est prêt au retrait');
      error.code = 'NO_PARCEL_AVAILABLE';
      throw error;
    }

    if (syncResult.reason && syncResult.reason !== 'no_parcels') {
      const error = new Error('La synchronisation du colis ciblé a échoué');
      error.code = 'PARCEL_SYNC_INCOMPLETE';
      throw error;
    }

    // Compatibilité commandes historiques sans parcels : le parent reste la
    // seule unité physique connue, donc l'ancien fallback order-level demeure.
    const transition = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'collected',
      actor: { id: agentId, role },
      source: 'scan',
      scanId: scan.id,
      note: notes + ' (fallback legacy, aucun parcel)',
      dbClient: client,
    });

    if (!transition.success || transition.noop || transition.newStatus !== 'collected') {
      const error = new Error(
        transition.error || 'La transition canonique vers collected a été refusée'
      );
      error.code = transition.noop ? 'COLLECTION_CONFLICT' : 'TRANSITION_REFUSED';
      throw error;
    }

    await finalizePickupCollection(client, { orderId: order.id, method: pickupMethod });
    await purgePickupCaches(client, order.id);

    return {
      scanId: scan.id,
      collectedAt: new Date(),
      parcelId: null,
      parcelReference: null,
      orderStatus: 'collected',
      partial: false,
    };
  }

  if (syncResult.parcelsUpdated !== 1) {
    const error = new Error('Le retrait doit cibler exactement un colis');
    error.code = 'PARCEL_SYNC_INCOMPLETE';
    throw error;
  }

  if (!['available', 'collected'].includes(syncResult.orderStatus)) {
    const error = new Error('Le statut parent après retrait est incohérent');
    error.code = 'PARCEL_SYNC_INCOMPLETE';
    throw error;
  }

  const partial = syncResult.orderStatus === 'available';

  if (partial) {
    // Le lot est bien retiré mais la commande reste vivante. L'ancien secret
    // a servi une fois : on le remplace atomiquement par un nouveau secret
    // order-level, révélation one-shot réouverte pour le prochain lot.
    await setExceptionalPickupAttemptState(client, {
      orderId: order.id,
      attempts: 0,
      blockedUntil: null,
    });
    await rotatePickupSecretAfterPartialCollection({
      client,
      orderId: order.id,
      relaisId: order.relais_id || null,
    });
  } else {
    await finalizePickupCollection(client, { orderId: order.id, method: pickupMethod });
    await purgePickupCaches(client, order.id);
  }

  return {
    scanId: scan.id,
    collectedAt: new Date(),
    parcelId: syncResult.parcelId || null,
    parcelReference: syncResult.parcelReference || null,
    orderStatus: syncResult.orderStatus,
    partial,
  };
}

function mapCanonicalCollectionError(err) {
  const statusByCode = {
    COLLECTION_CONFLICT: 409,
    TRANSITION_REFUSED: 409,
    PARCEL_SYNC_INCOMPLETE: 409,
    NO_PARCEL_AVAILABLE: 409,
  };
  const status = err && statusByCode[err.code];
  if (!status) return null;
  return {
    status,
    body: {
      error: err.message || 'La remise ne peut pas être enregistrée',
      code: err.code,
    },
  };
}

module.exports = { recordCanonicalCollection, mapCanonicalCollectionError };
