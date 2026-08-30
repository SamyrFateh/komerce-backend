/**
 * @komerce-arch
 * @role          pickup-collection-recorder
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        client, order, agentId, role, pickupMethod, notes, authorizationVersion?, documentChecked?
 * @outputs       { scanId, collectedAt } | mapped_http_error
 * @depends       services/order-status-machine.js, services/order-mutation-service.js, utils/parcelSync.js
 * @used-by       services/pickup-collection-service.js, services/pickup-exceptional-collection-service.js
 * @db-read       none
 * @db-write      scans, pickup_reveal_codes, pickup_print_tokens
 * @db-write-via:order-status-machine product_variants, order_status_history, orders, products
 * @db-write-via:order-mutation-service orders
 * @db-write-via:parcelSync parcels, parcel_items
 * @db-txn        participant (reçoit le client transactionnel de l'appelant, ne BEGIN/COMMIT/ROLLBACK jamais lui-même)
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-08 (extrait de pickup-collection-service.js, LOT 5A — nettoyage architectural)
 */

'use strict';

/**
 * pickup-collection-recorder.js
 *
 * Extrait de services/pickup-collection-service.js (LOT 5A, nettoyage
 * architectural). Enregistre, dans une transaction déjà ouverte, l'UNIQUE
 * remise physique canonique d'un colis — quelle que soit la méthode
 * d'authentification qui l'a prouvée (code secret au guichet ou
 * autorisation nominative en retrait exceptionnel).
 *
 * Avant ce lot, ce moteur vivait dans pickup-collection-service.js
 * (propriétaire historique de la méthode "code"), et
 * pickup-exceptional-collection-service.js devait recourir à ses exports
 * internes pour l'utiliser depuis la méthode "nominative" — une
 * dépendance d'un fichier-pair vers les internes d'un autre fichier-pair.
 * Les deux méthodes de remise consomment désormais ce moteur commun comme
 * pairs symétriques.
 *
 * Copie exacte du comportement d'origine : mêmes requêtes SQL, même ordre
 * de contrôles, mêmes codes d'erreur, aucun changement transactionnel —
 * ce module ne possède AUCUNE transaction, il reçoit le `client` déjà
 * ouvert par l'appelant (BEGIN posé par lui) et ne fait jamais de
 * BEGIN/COMMIT/ROLLBACK lui-même.
 *
 * Contrat d'appel (inchangé) — recordCanonicalCollection() doit être
 * appelée uniquement :
 *   - dans une transaction déjà ouverte ;
 *   - après verrouillage FOR UPDATE de la commande ;
 *   - après validation de la méthode d'authentification par l'appelant.
 *
 * Exports :
 *   recordCanonicalCollection({ client, order, agentId, role, pickupMethod,
 *                                notes, authorizationVersion?, documentChecked? })
 *     → { scanId, collectedAt }
 *     ✗ throws (err.code = COLLECTION_CONFLICT | TRANSITION_REFUSED | PARCEL_SYNC_INCOMPLETE)
 *   mapCanonicalCollectionError(err)
 *     → { status, body } | null (null si err n'est pas une erreur de ce moteur)
 */

const { finalizePickupCollection } = require('./order-mutation-service');
const { transitionOrderStatus }    = require('./order-status-machine');
const { safeSyncScanToParcels }    = require('../utils/parcelSync');

// ══════════════════════════════════════════════════════════════════════════════
// recordCanonicalCollection
// ══════════════════════════════════════════════════════════════════════════════
//
// Une seule remise physique, quelle que soit la méthode d'authentification.
//
// Ce helper doit être appelé uniquement :
//   - dans une transaction déjà ouverte ;
//   - après verrouillage FOR UPDATE de la commande ;
//   - après validation de la méthode d'authentification.
//
// Il possède :
//   - la création du scan collected ;
//   - la synchronisation des colis ;
//   - le fallback de la machine d'état pour les commandes sans parcel ;
//   - la preuve minimale de la méthode de retrait ;
//   - l'invalidation atomique du secret et de ses caches en clair ;
//   - la remise à zéro des compteurs de tentative.
//
// Toute erreur après la création du scan est levée afin que withTransaction
// exécute un ROLLBACK complet. Aucun état partiel ne doit être commité.

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
  if (!client) {
    throw new Error('_recordCanonicalCollection: client transactionnel requis');
  }

  if (!order || order.status !== 'available') {
    throw new Error(
      '_recordCanonicalCollection: commande non disponible au retrait'
    );
  }

  const isExceptional =
    pickupMethod === 'AUTHORIZED_NAME_ID_CHECK';

  if (
    pickupMethod !== 'PICKUP_CODE' &&
    pickupMethod !== 'AUTHORIZED_NAME_ID_CHECK'
  ) {
    throw new Error(
      '_recordCanonicalCollection: méthode de retrait inconnue'
    );
  }

  if (
    isExceptional &&
    (
      !Number.isInteger(authorizationVersion) ||
      authorizationVersion <= 0 ||
      documentChecked !== true
    )
  ) {
    throw new Error(
      '_recordCanonicalCollection: preuve nominative incomplète'
    );
  }

  if (
    !isExceptional &&
    (
      authorizationVersion !== null ||
      documentChecked !== false
    )
  ) {
    throw new Error(
      '_recordCanonicalCollection: preuve code incohérente'
    );
  }

  const { rows: [scan] } = await client.query(
    `INSERT INTO scans (
       order_id,
       step,
       scan_code,
       scanned_by,
       notes,
       pickup_method,
       authorization_version,
       document_checked,
       pickup_relais_id
     )
     VALUES (
       $1,
       'collected',
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8
     )
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

  const syncResult = await safeSyncScanToParcels({
    order_id:   order.id,
    step:       'collected',
    scan_id:    scan.id,
    scanned_by: agentId,
    notes,
  }, client);

  if (!syncResult.synced) {
    const transition = await transitionOrderStatus({
      orderId:   order.id,
      newStatus: 'collected',
      actor:     { id: agentId, role },
      source:    'scan',
      scanId:    scan.id,
      note:      notes + ' (fallback, pas de colis parcelSync)',
      dbClient:  client,
    });

    if (
      !transition.success ||
      transition.noop ||
      transition.newStatus !== 'collected'
    ) {
      const error = new Error(
        transition.error ||
        'La transition canonique vers collected a été refusée'
      );

      error.code = transition.noop
        ? 'COLLECTION_CONFLICT'
        : 'TRANSITION_REFUSED';

      throw error;
    }
  } else if (syncResult.orderStatus !== 'collected') {
    const error = new Error(
      'La synchronisation des colis n’a pas produit le statut collected'
    );

    error.code = 'PARCEL_SYNC_INCOMPLETE';
    throw error;
  }

  await finalizePickupCollection(client, {
    orderId: order.id,
    method: pickupMethod === 'PICKUP_CODE'
      ? 'PICKUP_CODE'
      : 'AUTHORIZED_NAME_ID_CHECK',
  });

  // Le code devient définitivement inutilisable dans la même transaction
  // que la remise physique, quelle que soit la méthode gagnante.
  //
  // Les tables éphémères peuvent encore contenir le code en clair :
  // elles sont donc purgées avant COMMIT, sans fenêtre post-remise.
  await client.query(
    'DELETE FROM pickup_reveal_codes WHERE order_id = $1',
    [order.id]
  );

  await client.query(
    'DELETE FROM pickup_print_tokens WHERE order_id = $1',
    [order.id]
  );

  return {
    scanId: scan.id,
    collectedAt: new Date(),
  };
}

function mapCanonicalCollectionError(err) {
  const statusByCode = {
    COLLECTION_CONFLICT:   409,
    TRANSITION_REFUSED:    409,
    PARCEL_SYNC_INCOMPLETE: 409,
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

module.exports = {
  recordCanonicalCollection,
  mapCanonicalCollectionError,
};
