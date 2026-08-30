/**
 * @komerce-arch
 * @role          pickup-collection-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/order-status-machine.js, services/pickup-code-helpers.js, services/pickup-collection-recorder.js, utils/alerts.js
 * @used-by       services/pickup-secret-service.js, services/scan-operations.js, services/pickup-exceptional-collection-service.js
 * @db-read       orders, relais, users
 * @db-write      alerts, pickup_print_tokens, pickup_reveal_codes, scans
 * @db-write-via:order-status-machine product_variants, order_status_history, orders, products
 * @db-write-via:pickup-collection-recorder scans, pickup_reveal_codes, pickup_print_tokens, product_variants, order_status_history, orders, products, parcels, parcel_items
 * @db-write-via:order-mutation-service orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-08 (LOT 5A — moteur canonique de remise (_recordCanonicalCollection/
 *                _mapCanonicalCollectionError) extrait vers services/pickup-collection-recorder.js,
 *                désormais consommé en pair par pickup-exceptional-collection-service.js ;
 *                getExceptionalPickupAvailability/collectByAuthorizedName déjà extraits vers
 *                services/pickup-exceptional-collection-service.js)
 */

/**
 * KOMERCE — Pickup Collection Service (Lot B7, 2026-08, extrait de
 * services/pickup-secret-service.js domaine 5/5)
 *
 * Toute la logique de REMISE physique du colis PAR CODE (vérification,
 * retrait par code), extraite du service d'émission du secret.
 * services/pickup-secret-service.js reste la façade publique unique : ce
 * fichier n'est jamais require() en dehors de lui (sauf
 * services/scan-operations.js pour collectByPickupCode, même doctrine
 * d'accès direct que pour les autres sous-domaines déplacés).
 *
 * Le moteur canonique de remise physique (une seule remise, quelle que soit
 * la méthode d'authentification) vit désormais dans
 * services/pickup-collection-recorder.js (LOT 5A, nettoyage architectural) :
 * ce fichier le consomme pour collectByPickupCode, et
 * services/pickup-exceptional-collection-service.js le consomme
 * symétriquement pour collectByAuthorizedName — les deux méthodes de
 * remise sont désormais des pairs vis-à-vis de ce moteur, plutôt que l'une
 * dépende des exports internes de l'autre. Seul _logSecurityAlert reste
 * exporté en interne depuis CE fichier (alerte sécurité générique,
 * toujours consommée par pickup-exceptional-collection-service.js).
 *
 * Le sous-domaine retrait EXCEPTIONNEL (autorisation nominative, sans code)
 * vit désormais dans services/pickup-exceptional-collection-service.js
 * (nettoyage architectural, warning I-BACK-2) — copie exacte du
 * comportement d'origine, anti-fraude cross-relais, FOR UPDATE, compteur de
 * tentatives dédié et non-fuite du nom autorisé strictement préservés.
 *
 * Exports :
 *   verifyPickupCode              — vérification code au retrait (rate-limited)
 *   collectOrder                  — transition → collected (voie admin/dashboard)
 *   collectByPickupCode           — (Lot 2C) orchestrateur canonique de remise
 *                                    aveugle par hash salé
 *   (getExceptionalPickupAvailability / collectByAuthorizedName —
 *    services/pickup-exceptional-collection-service.js)
 */

'use strict';

const {
  setPickupAttemptsOnly,
  setPickupAttemptState,
  setCollectedByName,
} = require('./order-mutation-service');

const db     = require('../db');
const { transitionOrderStatus }                    = require('./order-status-machine');
const { createAlert }                               = require('../utils/alerts');
const { hashCode, normalizeCode, CODE_ALPHABET, CODE_LENGTH } = require('./pickup-code-helpers');
// LOT 5A — moteur canonique de remise physique, extrait pour que les deux
// méthodes de remise (code, nominative) le consomment comme des pairs
// symétriques (voir pickup-exceptional-collection-service.js), au lieu que
// l'une dépende des exports internes de l'autre. Importé sous les noms
// historiques _recordCanonicalCollection/_mapCanonicalCollectionError pour
// ne changer aucun appel dans ce fichier.
const {
  recordCanonicalCollection: _recordCanonicalCollection,
  mapCanonicalCollectionError: _mapCanonicalCollectionError,
} = require('./pickup-collection-recorder');
const log = require('../utils/logger').child({ module: 'pickup-collection-service' });

// ══════════════════════════════════════════════════════════════════════════════
// verifyPickupCode
// ══════════════════════════════════════════════════════════════════════════════
// Retourne { status, body }.

async function verifyPickupCode({ orderId, code, agentId }) {
  if (!code) {
    return { status: 400, body: { error: 'Code requis' } };
  }

  const { rows: [order] } = await db.query(`
    SELECT id, reference, status,
           pickup_secret_hash, pickup_secret_salt, pickup_secret_last4,
           pickup_secret_expires_at,
           pickup_secret_attempts, pickup_secret_blocked_until
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, body: { error: 'Commande introuvable' } };
  }
  if (!order.pickup_secret_hash) {
    return { status: 400, body: { error: 'Cette commande n\'a pas encore de code (paiement non effectué ?)' } };
  }

  const now = new Date();

  // Rate limit
  if (order.pickup_secret_blocked_until && new Date(order.pickup_secret_blocked_until) > now) {
    const retryAfter = Math.ceil((new Date(order.pickup_secret_blocked_until) - now) / 1000 / 60);
    return { status: 429, body: {
      error: `Trop de tentatives. Réessayez dans ${retryAfter} min.`,
      blocked_until: order.pickup_secret_blocked_until,
    }};
  }

  // Expiration
  if (order.pickup_secret_expires_at && new Date(order.pickup_secret_expires_at) < now) {
    return { status: 410, body: { error: 'Code expiré. Escalade admin nécessaire.' } };
  }

  const normalized = normalizeCode(code);
  let matched = false;

  if (normalized.length === 4) {
    matched = !!(order.pickup_secret_last4 && normalized === order.pickup_secret_last4);
  } else if (normalized.length === 8) {
    const testHash = hashCode(normalized, order.pickup_secret_salt);
    matched = (testHash === order.pickup_secret_hash);
  } else {
    return { status: 400, body: { error: 'Code attendu : 4 caractères (raccourci) ou 8 caractères (complet)' } };
  }

  if (!matched) {
    const attempts  = (order.pickup_secret_attempts || 0) + 1;
    const blockUntil = attempts >= 3 ? new Date(now.getTime() + 15 * 60 * 1000) : null;

    await setPickupAttemptState(db, {
      orderId,
      attempts,
      blockedUntil: blockUntil,
    });

    log.warn(`[PICKUP-SECRET] Tentative échouée ${attempts}/3 pour ${order.reference} agent=${agentId}`);

    return { status: 401, body: {
      error: 'Code incorrect',
      attempts,
      remaining:     Math.max(0, 3 - attempts),
      blocked_until: blockUntil,
    }};
  }

  // Succès : reset compteur
  await setPickupAttemptState(db, {
    orderId,
    attempts: 0,
    blockedUntil: null,
  });

  log.info(`[PICKUP-SECRET] ✅ Code vérifié pour ${order.reference}`);

  return { status: 200, body: {
    success:   true,
    message:   'Code valide. Vous pouvez remettre le colis.',
    order_ref: order.reference,
  }};
}

// ══════════════════════════════════════════════════════════════════════════════
// collectOrder
// ══════════════════════════════════════════════════════════════════════════════

async function collectOrder({ orderId, agentId, role, collectedByName }) {
  return db.withTransaction(async (client) => {
    // Verrou de ligne (résout @db-txn resolve_before_behavior_change, en-tête
    // de fichier) : élimine la fenêtre check-then-act entre la lecture du
    // statut et son écriture. FOR UPDATE bloque toute transaction concurrente
    // qui voudrait lire/écrire cette même ligne tant que celle-ci n'a pas
    // COMMIT/ROLLBACK — les appels concurrents se mettent en file, chacun
    // relit alors un statut à jour au lieu d'un statut périmé.
    const { rows: [order] } = await client.query(`
      SELECT id, reference, status FROM orders WHERE id = $1 FOR UPDATE
    `, [orderId]);

    if (!order) {
      return { status: 404, body: { error: 'Commande introuvable' } };
    }
    // Relecture APRÈS l'acquisition du verrou : la valeur lue avant FOR
    // UPDATE serait déjà périmée si un appel concurrent a committé pendant
    // l'attente du verrou. C'est cette relecture, pas la requête elle-même,
    // qui ferme la course.
    if (order.status === 'collected') {
      return { status: 409, body: { error: 'Cette commande est déjà marquée comme récupérée' } };
    }

    const transition = await transitionOrderStatus({
      orderId,
      newStatus: 'collected',
      actor:  { id: agentId, role },
      source: 'patch',
      note:   'Colis remis apres verification du code retrait',
      dbClient: client, // même transaction, même verrou — transitionOrderStatus
                         // sait déjà poser FOR UPDATE quand dbClient est fourni.
    });

    if (!transition.success && !transition.noop) {
      return { status: 409, body: { error: transition.error } };
    }

    await setCollectedByName(client, {
      orderId,
      collectedByName: collectedByName || null,
    });

    log.info(`[PICKUP-SECRET] 📦 Colis remis pour ${order.reference} à "${collectedByName || '(anonyme)'}"`);

    return { status: 200, body: {
      success:   true,
      message:   'Colis remis. Commande marquée comme récupérée.',
      order_ref: order.reference,
    }};
  });
}
// ══════════════════════════════════════════════════════════════════════════════
// collectByPickupCode (Lot 2C)
// ══════════════════════════════════════════════════════════════════════════════
//
// Orchestrateur canonique de remise "aveugle" : l'agent relais saisit le
// code secret complet sans que l'UI connaisse l'orderId à l'avance (modèle
// guichet). Toute la logique métier auparavant dupliquée dans
// services/scan-operations.js::collectParcel vit désormais ici, comme seul
// propriétaire :
//   - résolution de la commande par hash salé (via pickup_secret_last4 pour
//     restreindre le candidat set, puis comparaison hash exacte) ;
//   - contrôles expiration / blocage brute-force ;
//   - anti-fraude cross-relais (I-10, ZONE_IMPACT.md) ;
//   - remise atomique : INSERT scans (scan_code = référence commande,
//     JAMAIS le secret), sync parcelSync, fallback transitionOrderStatus,
//     reset du compteur de tentatives — dans une unique transaction
//     (FOR UPDATE posé dès la résolution, @db-txn resolve_before_behavior_change).
//
// Ne renvoie jamais le code saisi ni un dérivé dans body/logs/alertes.

const CODE_FORMAT_REGEX = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

async function collectByPickupCode({ code, user, ip = null, userAgent = null }) {
  const normalized = normalizeCode(code);

  if (!CODE_FORMAT_REGEX.test(normalized)) {
    return { status: 400, body: {
      error: 'Code de retrait invalide — format attendu : 8 caractères (tirets de présentation autorisés)',
    }};
  }

  const last4   = normalized.slice(-4);
  const agentId = user?.id || null;
  const role    = user?.role || null;

  try {
    return await db.withTransaction(async (client) => {
    // FOR UPDATE dès la résolution : élimine la fenêtre check-then-act entre
    // la lecture de la commande candidate et sa remise (même doctrine que
    // collectOrder ci-dessus). last4 restreint le candidate set ; la
    // correspondance exacte se fait ensuite par comparaison de hash salé —
    // jamais par égalité directe sur le secret.
    const { rows: candidates } = await client.query(`
      SELECT o.id, o.reference, o.relais_id, o.payer_name, o.status,
             r.name AS relais_name,
             o.pickup_secret_hash, o.pickup_secret_salt, o.pickup_secret_last4,
             o.pickup_secret_expires_at, o.pickup_secret_attempts, o.pickup_secret_blocked_until
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.pickup_secret_last4 = $1
        AND o.status = 'available'
      FOR UPDATE OF o
    `, [last4]);

    const order = candidates.find(c =>
      c.pickup_secret_hash && hashCode(normalized, c.pickup_secret_salt) === c.pickup_secret_hash
    );

    if (!order) {
      await _logSecurityAlert(client, {
        type:        'pickup_collect_invalid_code',
        entityId:    null,
        title:       `Tentative de retrait avec un code invalide (last4=${last4})`,
        description: `agent_id=${agentId} role=${role} ip=${ip || 'inconnue'} user_agent=${userAgent || 'inconnu'}`,
      });
      return { status: 404, body: { error: 'Code de retrait introuvable ou déjà utilisé' } };
    }

    const now = new Date();

    if (order.pickup_secret_blocked_until && new Date(order.pickup_secret_blocked_until) > now) {
      const retryAfter = Math.ceil((new Date(order.pickup_secret_blocked_until) - now) / 1000 / 60);
      return { status: 429, body: {
        error: `Trop de tentatives. Réessayez dans ${retryAfter} min.`,
        blocked_until: order.pickup_secret_blocked_until,
      }};
    }

    if (order.pickup_secret_expires_at && new Date(order.pickup_secret_expires_at) < now) {
      return { status: 410, body: { error: 'Code expiré. Escalade admin nécessaire.' } };
    }

    // I-10 — un agent_relais ne peut remettre que les colis de son propre
    // relais. Les admins ne sont pas soumis à ce contrôle (multi-relais).
    const crossCheckFailure = await _crossRelaisCheck(client, { order, user, ip, userAgent });
    if (crossCheckFailure) return crossCheckFailure;

    const notes = 'Retrait confirmé — code secret vérifié au guichet relais';

    const collection = await _recordCanonicalCollection({
      client,
      order,
      agentId,
      role,
      pickupMethod: 'PICKUP_CODE',
      notes,
    });

    log.info(`[PICKUP-SECRET] 📦 Retrait aveugle confirmé pour ${order.reference} par agent=${agentId}`);

    return { status: 200, body: {
      success:      true,
      order_id:     order.id,
      reference:    order.reference,
      recipient:    order.payer_name,
      relais:       order.relais_name,
      collected_at: collection.collectedAt.toISOString(),
    }};
    });
  } catch (err) {
    const mapped = _mapCanonicalCollectionError(err);
    if (mapped) return mapped;
    throw err;
  }
}

/**
 * Anti-fraude cross-relais (I-10). Renvoie une réponse { status, body } si
 * l'agent doit être bloqué, ou null si la vérification passe (ou ne
 * s'applique pas — admin).
 */
async function _crossRelaisCheck(client, { order, user, ip, userAgent }) {
  if (!user || user.role === 'admin') return null;

  const { rows: [agent] } = await client.query(
    'SELECT relais_id FROM users WHERE id = $1', [user.id]
  );
  const agentRelaisId = agent?.relais_id || null;

  if (!agentRelaisId) {
    return { status: 403, body: { error: 'Configuration agent incomplète — contactez un admin' } };
  }

  if (String(agentRelaisId) !== String(order.relais_id)) {
    const attempts = (order.pickup_secret_attempts || 0) + 1;

    await setPickupAttemptsOnly(client, {
      orderId: order.id,
      attempts,
    });

    log.warn(`[PICKUP-SECRET] ⛔ Cross-relais refusé — agent ${user.id} (relais ${agentRelaisId}) tentait ${order.reference} (relais ${order.relais_id})`);

    await _logSecurityAlert(client, {
      type:        'pickup_collect_cross_relais_blocked',
      entityId:    order.id,
      title:       `Cross-relais refusé — ${order.reference}`,
      description: `agent_id=${user.id} agent_relais_id=${agentRelaisId} order_relais_id=${order.relais_id} ip=${ip || 'inconnue'} user_agent=${userAgent || 'inconnu'}`,
    });

    return { status: 403, body: {
      error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider',
      attempts,
    }};
  }

  return null;
}

/** Persiste une alerte sécurité — jamais le secret en clair (Lot 2C). */
async function _logSecurityAlert(client, { type, entityId, title, description }) {
  try {
    await createAlert(client, {
      type,
      entityType:  'order',
      entityId,
      severity:    'high',
      title,
      description,
    });
  } catch (e) {
    log.error({ err: e }, '[PICKUP-SECRET] _logSecurityAlert error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// getExceptionalPickupAvailability / collectByAuthorizedName — Lot 5
// ══════════════════════════════════════════════════════════════════════════════
// Extraits vers services/pickup-exceptional-collection-service.js (nettoyage
// architectural, warning I-BACK-2). Ce sous-domaine consomme désormais
// recordCanonicalCollection/mapCanonicalCollectionError directement depuis
// services/pickup-collection-recorder.js (LOT 5A — pairs symétriques, plus
// de reach-in), et _logSecurityAlert exporté en interne ci-dessous depuis
// CE fichier — pickup-secret-service.js continue d'importer
// getExceptionalPickupAvailability/collectByAuthorizedName directement
// depuis pickup-exceptional-collection-service.js.

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  verifyPickupCode,
  collectOrder,
  collectByPickupCode,
  // Export interne — consommé UNIQUEMENT par
  // services/pickup-exceptional-collection-service.js (alerte sécurité sur
  // échec nominatif, même fonction générique que le rejet cross-relais
  // ci-dessus). Jamais une API publique : ne pas require() ce nom depuis
  // un autre fichier. _recordCanonicalCollection/_mapCanonicalCollectionError
  // ont migré vers services/pickup-collection-recorder.js (LOT 5A) — les
  // deux méthodes de remise les consomment désormais depuis là, en pairs.
  _logSecurityAlert,
};
