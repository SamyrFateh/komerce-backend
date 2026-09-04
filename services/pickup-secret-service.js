/**
 * @komerce-arch
 * @role          pickup-secret-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/pickup-code-helpers.js, services/pickup-secret-access-service.js, services/pickup-collection-service.js, services/pickup-exceptional-collection-service.js, services/order-mutation-service.js
 * @used-by       routes/pickup-secret.js, services/payment-stripe.js, services/payment-paypal.js, routes/pickup-pay-cash.js, services/scan-operations.js
 * @db-read       orders, users
 * @db-write      orders
 * @db-write-via:order-mutation-service orders
 * @db-write-via:pickup-secret-access-service orders, pickup_print_tokens, pickup_reveal_codes
 * @db-write-via:pickup-collection-service alerts, orders, pickup_print_tokens, pickup_reveal_codes, scans, product_variants, order_status_history, products
 * @db-write-via:pickup-exceptional-collection-service alerts, orders, pickup_print_tokens, pickup_reveal_codes, scans, product_variants, order_status_history, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-08 (LOT 5B — cacheCodeForReveal/issuePrintToken/getReceiptHTML/revealOnce
 *                extraits vers services/pickup-secret-access-service.js ; nettoyage architectural —
 *                getExceptionalPickupAvailability/collectByAuthorizedName réexportés depuis
 *                services/pickup-exceptional-collection-service.js)
 */

/**
 * KOMERCE — Pickup Secret Service (Lot B6, 2026-06-23 ; scindé Lot B7,
 * 2026-08 — domaine 5/5)
 *
 * Façade publique unique pour le secret de retrait. Cette façade couvre
 * désormais trois sous-domaines répartis sur 5 fichiers :
 *   - cycle de vie cryptographique du secret (ce fichier) : génération
 *     anti-collision, régénération admin, statut masqué.
 *   - accès contrôlé et temporaire au secret déjà généré
 *     (services/pickup-secret-access-service.js, LOT 5B) : cache one-shot
 *     pour révélation, token d'impression, reçu, révélation one-shot au
 *     destinataire autorisé.
 *   - remise physique par code (services/pickup-collection-service.js) :
 *     vérification du code, transition → collected, retrait par code
 *     (guichet).
 *   - remise physique exceptionnelle, sans code
 *     (services/pickup-exceptional-collection-service.js) : retrait par
 *     autorisation nominative (nettoyage architectural, extrait de
 *     pickup-collection-service.js).
 *   - primitives pures partagées (services/pickup-code-helpers.js) :
 *     génération/hash/normalisation du code, sans dépendance, pour éviter
 *     tout cycle entre l'émission et la remise.
 *
 * Tous les appelants historiques continuent d'importer
 * services/pickup-secret-service.js sans aucun changement : l'API publique
 * (module.exports) est strictement identique à avant le découpage.
 *
 * Exports :
 *   helpers          — generatePickupCode, hashCode, normalizeCode, maskLast4
 *                       (ré-exportés depuis pickup-code-helpers.js)
 *   generateAndStoreSecret  — anti-collision + UPDATE orders
 *   ensureSecretGenerated   — (Lot 2) point d'entrée idempotent pour tous les
 *                             canaux de confirmation de paiement ; no-op si un
 *                             secret existe déjà pour la commande
 *   cacheCodeForReveal      — (ré-exporté depuis pickup-secret-access-service.js)
 *   issuePrintToken         — (ré-exporté depuis pickup-secret-access-service.js)
 *   getReceiptHTML          — (ré-exporté depuis pickup-secret-access-service.js)
 *   verifyPickupCode        — (ré-exporté depuis pickup-collection-service.js)
 *   collectOrder            — (ré-exporté depuis pickup-collection-service.js)
 *   collectByPickupCode     — (ré-exporté depuis pickup-collection-service.js)
 *   regenerateCode          — admin : régénère un code
 *   getPickupStatus         — status masqué (jamais le code clair)
 *   revealOnce              — (ré-exporté depuis pickup-secret-access-service.js)
 *   getExceptionalPickupAvailability — (ré-exporté depuis pickup-exceptional-collection-service.js)
 *   collectByAuthorizedName — (ré-exporté depuis pickup-exceptional-collection-service.js)
 */

'use strict';

const { recordPickupRegeneration } = require('./order-mutation-service');
const { generateAndStoreSecret } = require('./pickup-secret-issuer');

const db     = require('../db');
const {
  generatePickupCode,
  hashCode,
  normalizeCode,
  maskLast4,
}                                                    = require('./pickup-code-helpers');
const {
  verifyPickupCode,
  collectOrder,
  collectByPickupCode,
}                                                    = require('./pickup-collection-service');
const {
  getExceptionalPickupAvailability,
  collectByAuthorizedName,
}                                                    = require('./pickup-exceptional-collection-service');
// LOT 5B — accès contrôlé/temporaire au secret déjà généré (cache reveal,
// print token, reçu, révélation one-shot), extrait vers
// pickup-secret-access-service.js. Importé sous les mêmes noms pour ne
// changer aucun appel, réexporté ci-dessous pour API publique inchangée.
const {
  cacheCodeForReveal,
  issuePrintToken,
  getReceiptHTML,
  revealOnce,
} = require('./pickup-secret-access-service');
const log = require('../utils/logger').child({ module: 'pickup-secret-service' });

// ══════════════════════════════════════════════════════════════════════════════
// generateAndStoreSecret — implémentation canonique extraite
// ══════════════════════════════════════════════════════════════════════════════
// Déléguée à services/pickup-secret-issuer.js afin que la rotation après
// retrait partiel réutilise exactement le même générateur anti-collision sans
// créer de cycle pickup-secret-service ↔ pickup-collection-recorder.

// ══════════════════════════════════════════════════════════════════════════════
// ensureSecretGenerated
// ══════════════════════════════════════════════════════════════════════════════
//
// Point d'entrée idempotent pour tous les canaux de confirmation de paiement
// (Lot 2 — convergence). Ne régénère JAMAIS un secret existant : si la
// commande a déjà un pickup_secret_hash, la fonction est un no-op et renvoie
// { code: null, last4, alreadyExisted: true } pour que l'appelant sache qu'il
// n'a pas de code en clair à mettre en cache pour la révélation one-shot.
//
// dbClient : à fournir systématiquement pour rester dans la même transaction
// que l'écriture de statut de paiement (résout @db-txn resolve_before_behavior_change).

async function ensureSecretGenerated({ orderId, relaisId = null, channel, dbClient = null }) {
  if (!orderId) throw new Error('ensureSecretGenerated: orderId requis');
  if (!channel) throw new Error('ensureSecretGenerated: channel requis');

  const dbHandle = dbClient || db;
  const { rows: [existing] } = await dbHandle.query(
    `SELECT pickup_secret_hash, pickup_secret_last4 FROM orders WHERE id = $1`,
    [orderId]
  );

  if (existing && existing.pickup_secret_hash) {
    return { code: null, last4: existing.pickup_secret_last4, alreadyExisted: true };
  }

  const { code, last4 } = await generateAndStoreSecret({
    orderId,
    relaisId,
    channel,
    dbClient,
  });

  return { code, last4, alreadyExisted: false };
}

// ══════════════════════════════════════════════════════════════════════════════
// cacheCodeForReveal / issuePrintToken / getReceiptHTML / revealOnce — LOT 5B
// ══════════════════════════════════════════════════════════════════════════════
// Extraits vers services/pickup-secret-access-service.js (nettoyage
// architectural) : accès contrôlé et temporaire au secret APRÈS sa
// génération (cache reveal, token d'impression, reçu, révélation
// one-shot), distinct du cycle de vie cryptographique (génération,
// anti-collision, régénération) qui reste ci-dessous dans ce fichier.
// Importés sous les mêmes noms pour ne changer aucun appel interne
// (regenerateCode appelle generateAndStoreSecret, pas ces 4 fonctions —
// aucun appel interne concerné en réalité) et réexportés ci-dessous pour
// API publique inchangée.

// ══════════════════════════════════════════════════════════════════════════════
// regenerateCode
// ══════════════════════════════════════════════════════════════════════════════
// Admin uniquement. Invalide l'ancien code, génère un nouveau, renvoie le clair UNE FOIS.

async function regenerateCode({ orderId, adminId, reason }) {
  if (!reason || reason.trim().length < 5) {
    return { status: 400, body: { error: 'Motif obligatoire (min 5 caractères)' } };
  }

  const { rows: [order] } = await db.query(`
    SELECT id, reference, pickup_secret_hash, relais_id FROM orders WHERE id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, body: { error: 'Commande introuvable' } };
  }

  let newCode, newLast4;
  try {
    const result = await generateAndStoreSecret({
      orderId,
      relaisId:       order.relais_id || null,
      channel:        'admin_regenerate',
      excludeOrderId: orderId,
      extraUpdates: {
        pickup_secret_regen_count:  db.raw ? undefined : undefined, // géré dans SQL ci-dessous
        pickup_secret_regen_reason: reason.trim(),
      },
    });
    newCode  = result.code;
    newLast4 = result.last4;
  } catch (err) {
    if (err.message.includes('saturation')) {
      return { status: 500, body: { error: 'Génération du code impossible (saturation)' } };
    }
    throw err;
  }

  // Incrémenter le compteur de régénération séparément (extraUpdates ne supporte pas COALESCE)
  await recordPickupRegeneration(db, {
    orderId,
    reason: reason.trim(),
  });

  log.info(`[PICKUP-SECRET] 🔄 Régénéré pour ${order.reference} par admin ${adminId} motif="${reason}"`);

  return { status: 200, body: {
    success:   true,
    message:   'Nouveau code généré. Transmettez-le par canal sécurisé à l\'agent relais.',
    code:      newCode,
    order_ref: order.reference,
  }};
}

// ══════════════════════════════════════════════════════════════════════════════
// getPickupStatus
// ══════════════════════════════════════════════════════════════════════════════
// Retourne le statut masqué — jamais le code clair.

async function getPickupStatus({ orderId }) {
  const { rows: [order] } = await db.query(`
    SELECT o.id, o.reference, o.status, o.payment_status, o.total_kmf,
           o.payer_name,
           o.tracking_phone,
           o.tracking_phone_secondary,
           o.tracking_phone_confirmed_at,
           o.pickup_secret_created_at,
           o.pickup_secret_expires_at,
           o.pickup_secret_attempts,
           o.pickup_secret_blocked_until,
           o.pickup_secret_regen_count,
           o.pickup_secret_last4,
           o.collected_at, o.collected_by_name,
           u.full_name AS client_name,
           u.phone     AS client_phone
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, body: { error: 'Commande introuvable' } };
  }

  return { status: 200, body: {
    order_ref:      order.reference,
    status:         order.status,
    payment_status: order.payment_status,
    total_kmf:      Number(order.total_kmf || 0),
    client_name:    order.client_name,
    payer_name:     order.payer_name,
    tracking: {
      primary:      order.tracking_phone || order.client_phone || null,
      secondary:    order.tracking_phone_secondary || null,
      confirmed_at: order.tracking_phone_confirmed_at,
    },
    secret: {
      exists:       !!order.pickup_secret_created_at,
      created_at:   order.pickup_secret_created_at,
      expires_at:   order.pickup_secret_expires_at,
      attempts:     order.pickup_secret_attempts || 0,
      blocked_until: order.pickup_secret_blocked_until,
      regen_count:  order.pickup_secret_regen_count || 0,
      last4:        order.pickup_secret_last4 || null,
      masked:       order.pickup_secret_last4
                      ? ('•••-•' + order.pickup_secret_last4.slice(0, 2) + '-' + order.pickup_secret_last4.slice(2))
                      : null,
    },
    collected: {
      at:      order.collected_at,
      by_name: order.collected_by_name,
    },
  }};
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // helpers purs
  generatePickupCode,
  hashCode,
  normalizeCode,
  maskLast4,
  // fonctions métier
  generateAndStoreSecret,
  ensureSecretGenerated,
  cacheCodeForReveal,
  issuePrintToken,
  getReceiptHTML,
  verifyPickupCode,
  collectOrder,
  collectByPickupCode,
  regenerateCode,
  getPickupStatus,
  revealOnce,
  // Lot 5 — retrait exceptionnel par autorisation nominative
  getExceptionalPickupAvailability,
  collectByAuthorizedName,
};
