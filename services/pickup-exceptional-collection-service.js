/**
 * @komerce-arch
 * @role          pickup-exceptional-collection-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/pickup-collection-recorder.js, services/pickup-collection-service.js, services/pickup-authorization-service.js, services/notifications/notification-service.js, services/order-mutation-service.js, utils/name-normalize.js
 * @used-by       services/pickup-secret-service.js
 * @db-read       orders, relais, users
 * @db-write      alerts
 * @db-write-via:pickup-collection-recorder scans, pickup_reveal_codes, pickup_print_tokens, product_variants, order_status_history, orders, products, parcels, parcel_items
 * @db-write-via:pickup-collection-service alerts
 * @db-write-via:order-mutation-service orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-08 (LOT 5A — recordCanonicalCollection/mapCanonicalCollectionError consommés
 *                depuis services/pickup-collection-recorder.js, en pair symétrique de
 *                pickup-collection-service.js, au lieu d'un reach-in dans ses exports internes ;
 *                extrait initialement de services/pickup-collection-service.js, warning I-BACK-2)
 */

/**
 * KOMERCE — Pickup Exceptional Collection Service (Lot 5, extrait de
 * services/pickup-collection-service.js)
 *
 * Sous-domaine retrait EXCEPTIONNEL (autorisation nominative, sans code
 * secret) : getExceptionalPickupAvailability + collectByAuthorizedName.
 * Copie exacte du comportement d'origine — mêmes requêtes SQL, même ordre
 * de contrôles, mêmes messages/codes d'erreur, même transaction. Préserve
 * strictement :
 *   - l'anti-fraude cross-relais (I-10, même doctrine que collectByPickupCode) ;
 *   - l'ordre des contrôles (statut → blocage → pièce → autorisation → nom) ;
 *   - le verrouillage FOR UPDATE (commande ET autorisation) ;
 *   - le compteur de tentatives DÉDIÉ (exceptional_pickup_attempts /
 *     exceptional_pickup_blocked_until — jamais mélangé avec le code secret) ;
 *   - le blocage après EXCEPTIONAL_PICKUP_MAX_ATTEMPTS ;
 *   - la vérification document (documentChecked === true requis) ;
 *   - l'autorisation active consultée au moment exact de la remise
 *     (getActiveAuthorizationForUpdate, jamais figée, jamais de requête
 *     directe sur user_pickup_authorizations) ;
 *   - la notification post-commit fire-and-forget ;
 *   - l'absence totale de fuite du nom autorisé (saisi ou attendu) dans les
 *     logs, réponses ou alertes de sécurité.
 *
 * Consomme recordCanonicalCollection / mapCanonicalCollectionError depuis
 * services/pickup-collection-recorder.js (LOT 5A, nettoyage architectural)
 * — une seule remise physique canonique, quelle que soit la méthode
 * d'authentification. pickup-collection-service.js consomme ce même
 * moteur pour sa propre méthode (code) : les deux fichiers sont désormais
 * des pairs symétriques vis-à-vis de ce moteur, plus une dépendance de
 * l'un vers les internes de l'autre. _logSecurityAlert reste consommé
 * depuis pickup-collection-service.js (alerte sécurité générique, pas
 * partie du moteur de remise).
 *
 * services/pickup-secret-service.js reste la façade publique unique — il
 * réexporte getExceptionalPickupAvailability et collectByAuthorizedName
 * tels quels, aucun appelant externe n'est modifié.
 *
 * Exports :
 *   getExceptionalPickupAvailability — dispo procédure exceptionnelle
 *   collectByAuthorizedName          — remise après contrôle nominatif
 */

'use strict';

const { setExceptionalPickupAttemptState } = require('./order-mutation-service');

const db = require('../db');
const { namesMatch } = require('../utils/name-normalize');
const {
  getActiveAuthorizationForUpdate,
  hasActiveAuthorization,
} = require('./pickup-authorization-service');
const { notifyText } = require('./notifications/notification-service');
// LOT 5A — le moteur canonique de remise physique vit désormais dans
// pickup-collection-recorder.js, consommé ici comme un pair symétrique de
// pickup-collection-service.js (qui l'utilise pour la méthode "code")
// plutôt qu'en reach-in dans les exports internes d'un fichier-frère.
const {
  recordCanonicalCollection: _recordCanonicalCollection,
  mapCanonicalCollectionError: _mapCanonicalCollectionError,
} = require('./pickup-collection-recorder');
const {
  _logSecurityAlert,
} = require('./pickup-collection-service');
const log = require('../utils/logger').child({ module: 'pickup-exceptional-collection-service' });

// ══════════════════════════════════════════════════════════════════════════════
// getExceptionalPickupAvailability — Lot 5
// ══════════════════════════════════════════════════════════════════════════════
// Disponibilité de la procédure exceptionnelle pour un agent relais donné.
// Ne révèle JAMAIS le nom attendu ni son existence détaillée — seulement un
// booléen + une raison technique (§10 du lot : "ne jamais révéler le nom
// attendu au relais"). Séparé du compteur/blocage du code secret : lit
// exceptional_pickup_blocked_until, jamais pickup_secret_blocked_until.

async function getExceptionalPickupAvailability({ orderId, agentId, role }) {
  const { rows: [order] } = await db.query(`
    SELECT id, status, relais_id, user_id, exceptional_pickup_blocked_until
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, body: { available: false, reason: 'ORDER_NOT_FOUND' } };
  }

  // La procédure exceptionnelle n'est disponible que pour une commande
  // physiquement prête au retrait. Elle ne doit jamais permettre de sauter
  // les états logistiques intermédiaires.
  if (order.status === 'collected') {
    return { status: 200, body: { available: false, reason: 'ALREADY_COLLECTED' } };
  }

  if (order.status !== 'available') {
    return { status: 200, body: { available: false, reason: 'ORDER_NOT_READY' } };
  }

  // I-10 — même doctrine cross-relais que le code secret (_crossRelaisCheck) :
  // un agent ne voit la disponibilité que pour son propre relais.
  if (role !== 'admin') {
    const { rows: [agent] } = await db.query('SELECT relais_id FROM users WHERE id = $1', [agentId]);
    const agentRelaisId = agent?.relais_id || null;
    if (!agentRelaisId || String(agentRelaisId) !== String(order.relais_id)) {
      return { status: 200, body: { available: false, reason: 'CROSS_RELAIS' } };
    }
  }

  const now = new Date();
  if (order.exceptional_pickup_blocked_until && new Date(order.exceptional_pickup_blocked_until) > now) {
    return { status: 200, body: { available: false, reason: 'BLOCKED' } };
  }

  const hasAuth = await hasActiveAuthorization(order.user_id);
  if (!hasAuth) {
    return { status: 200, body: { available: false, reason: 'NO_ACTIVE_AUTHORIZATION' } };
  }

  return { status: 200, body: { available: true } };
}

// ══════════════════════════════════════════════════════════════════════════════
// collectByAuthorizedName — Lot 5
// ══════════════════════════════════════════════════════════════════════════════
// Remise après contrôle visuel de pièce + comparaison nominative stricte.
// Doctrine (migration 121, § du lot) :
//   - compteur de tentatives DÉDIÉ (exceptional_pickup_attempts /
//     exceptional_pickup_blocked_until) — jamais mélangé avec le code secret
//   - autorisation consultée au moment exact de la remise, verrouillée
//     FOR UPDATE dans la même transaction (getActiveAuthorizationForUpdate)
//   - comparaison strictement normalisée (namesMatch) — jamais le nom
//     autorisé en clair dans la réponse, les logs ou l'audit
//   - méthode de remise tracée : orders.pickup_collected_via = 'AUTHORIZED_NAME_ID_CHECK'
//   - notification post-commit fire-and-forget (même doctrine que les autres
//     hooks non-bloquants de pickup-collection-service.js)

const EXCEPTIONAL_PICKUP_MAX_ATTEMPTS = 3;

async function collectByAuthorizedName({
  orderId, agentId, role, givenNames, familyName, documentChecked,
}) {
  let result;

  try {
    result = await db.withTransaction(async (client) => {
    const { rows: [order] } = await client.query(`
      SELECT o.id, o.reference, o.status, o.relais_id, o.user_id,
             o.exceptional_pickup_attempts, o.exceptional_pickup_blocked_until,
             r.name AS relais_name,
             COALESCE(o.tracking_phone, u.phone) AS buyer_phone
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      FOR UPDATE OF o
    `, [orderId]);

    if (!order) {
      return { status: 404, body: { error: 'Commande introuvable', code: 'ORDER_NOT_FOUND' } };
    }

    // I-10 — même doctrine cross-relais que collectByPickupCode.
    if (role !== 'admin') {
      const { rows: [agent] } = await client.query('SELECT relais_id FROM users WHERE id = $1', [agentId]);
      const agentRelaisId = agent?.relais_id || null;
      if (!agentRelaisId || String(agentRelaisId) !== String(order.relais_id)) {
        return { status: 403, body: {
          error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider',
          code: 'CROSS_RELAIS_BLOCKED',
        }};
      }
    }

    // La commande doit être prête au retrait au moment exact de la
    // transaction. Le verrou FOR UPDATE empêche une remise concurrente.
    if (order.status === 'collected') {
      return {
        status: 409,
        body: {
          error: 'Cette commande est déjà marquée comme récupérée',
          code: 'ALREADY_COLLECTED',
        },
      };
    }

    if (order.status !== 'available') {
      return {
        status: 409,
        body: {
          error: 'Cette commande n’est pas disponible au retrait',
          code: 'ORDER_NOT_READY',
        },
      };
    }

    const now = new Date();
    if (order.exceptional_pickup_blocked_until && new Date(order.exceptional_pickup_blocked_until) > now) {
      const retryAfter = Math.ceil((new Date(order.exceptional_pickup_blocked_until) - now) / 1000 / 60);
      return { status: 429, body: {
        error: `Trop de tentatives. Réessayez dans ${retryAfter} min.`,
        code: 'BLOCKED',
        blocked_until: order.exceptional_pickup_blocked_until,
      }};
    }

    if (documentChecked !== true) {
      return { status: 400, body: {
        error: 'Contrôle de la pièce d\'identité requis avant remise',
        code: 'DOCUMENT_NOT_CHECKED',
      }};
    }

    // Lecture verrouillée de l'autorisation courante — au moment exact de la
    // remise (§4 du lot), jamais figée. Seule API autorisée, jamais de
    // requête directe sur user_pickup_authorizations ici (§9/§18).
    const authorization = await getActiveAuthorizationForUpdate(client, order.user_id);
    if (!authorization) {
      return { status: 404, body: { error: 'Aucune autorisation active pour cette commande', code: 'NO_ACTIVE_AUTHORIZATION' } };
    }

    const matches = namesMatch(
      { givenNames, familyName },
      { givenNames: authorization.normalizedGivenNames, familyName: authorization.normalizedFamilyName },
    );

    if (!matches) {
      const attempts = (order.exceptional_pickup_attempts || 0) + 1;
      const blocked  = attempts >= EXCEPTIONAL_PICKUP_MAX_ATTEMPTS;
      const blockUntil = blocked ? new Date(now.getTime() + 30 * 60 * 1000) : null;

      await setExceptionalPickupAttemptState(client, {
        orderId,
        attempts,
        blockedUntil: blockUntil,
      });

      log.warn(`[PICKUP-SECRET] Tentative nominative échouée ${attempts}/${EXCEPTIONAL_PICKUP_MAX_ATTEMPTS} pour ${order.reference} agent=${agentId}`);

      // Jamais le nom saisi ni le nom attendu dans l'alerte (§18).
      await _logSecurityAlert(client, {
        type:        'exceptional_pickup_name_mismatch',
        entityId:    order.id,
        title:       `Retrait exceptionnel — nom non concordant (${order.reference})`,
        description: `agent_id=${agentId} role=${role} attempts=${attempts}`,
      });

      return { status: 401, body: {
        error: 'Le nom ne correspond pas à l\'autorisation enregistrée',
        code: 'NAME_MISMATCH',
        attempts,
        remaining:     Math.max(0, EXCEPTIONAL_PICKUP_MAX_ATTEMPTS - attempts),
        blocked_until: blockUntil,
      }};
    }

    const collection = await _recordCanonicalCollection({
      client,
      order,
      agentId,
      role,
      pickupMethod:        'AUTHORIZED_NAME_ID_CHECK',
      notes:               'Colis remis après autorisation nominative (retrait exceptionnel, pièce contrôlée)',
      authorizationVersion: authorization.version,
      documentChecked:      true,
    });

    log.info(
      `[PICKUP-SECRET] 📦 Retrait exceptionnel confirmé pour ${order.reference} par agent=${agentId} scan=${collection.scanId} authorization_version=${authorization.version}`
    );

    return {
      status: 200,
      body: {
        success:   true,
        message:   'Colis remis. Commande marquée comme récupérée (retrait exceptionnel).',
        order_ref: order.reference,
      },
      _notify: { phone: order.buyer_phone || null, reference: order.reference },
    };
    });
  } catch (err) {
    const mapped = _mapCanonicalCollectionError(err);
    if (mapped) return mapped;
    throw err;
  }

  // Notification post-commit — fire-and-forget, hors transaction (même
  // doctrine que les autres hooks non-bloquants de pickup-collection-service.js).
  if (result.status === 200 && result._notify && result._notify.phone) {
    notifyText(
      result._notify.phone,
      `Votre colis ${result._notify.reference} a été remis (retrait exceptionnel autorisé).`,
      'exceptional_pickup_collected',
      orderId,
    ).catch(e => log.warn({ err: e }, '[PICKUP-SECRET] notifyText exceptional_pickup_collected error'));
  }

  return { status: result.status, body: result.body };
}

module.exports = {
  getExceptionalPickupAvailability,
  collectByAuthorizedName,
};
