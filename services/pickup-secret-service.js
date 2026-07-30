/**
 * @komerce-arch
 * @role          pickup-secret-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/order-status-machine.js, utils/pickup-receipt-html.js
 * @used-by       routes/pickup-secret.js, services/payment-stripe.js, services/payment-paypal.js, routes/pickup-pay-cash.js
 * @db-read       order_items, orders, pickup_print_tokens, pickup_reveal_codes, products, relais, users
 * @db-write      orders, pickup_print_tokens, pickup_reveal_codes
 * @db-write-via:order-status-machine product_variants, order_status_history, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Pickup Secret Service (Lot B6, 2026-06-23)
 *
 * Toute la logique métier du secret de retrait, extraite de routes/pickup-secret.js.
 * Les fonctions retournent { status, body } ou { status, html/error } — jamais res.*
 *
 * Exports :
 *   helpers          — generatePickupCode, hashCode, normalizeCode
 *   generateAndStoreSecret  — anti-collision + UPDATE orders
 *   ensureSecretGenerated   — (Lot 2) point d'entrée idempotent pour tous les
 *                             canaux de confirmation de paiement ; no-op si un
 *                             secret existe déjà pour la commande
 *   cacheCodeForReveal      — INSERT pickup_reveal_codes (one-shot reveal cache)
 *   issuePrintToken         — INSERT pickup_print_tokens
 *   getReceiptHTML          — HTML imprimable du reçu
 *   verifyPickupCode        — vérification code au retrait (rate-limited)
 *   collectOrder            — transition → collected
 *   regenerateCode          — admin : régénère un code
 *   getPickupStatus         — status masqué (jamais le code clair)
 *   revealOnce              — révélation one-shot au payeur
 */

'use strict';

const crypto = require('crypto');
const db     = require('../db');
const { transitionOrderStatus } = require('./order-status-machine');
const { buildReceiptHTML }      = require('../utils/pickup-receipt-html');
const log = require('../utils/logger').child({ module: 'pickup-secret-service' });

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS PURS — exportés pour les tests
// ══════════════════════════════════════════════════════════════════════════════

// Alphabet sans confusion visuelle : pas de 0/O/I/1/l
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH   = 8;

/**
 * Génère un code secret de 8 caractères groupés : "A7K-3M9-P2"
 * Espace : 32^8 = 1.1e12 combinaisons
 */
function generatePickupCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6, 8);
}

/**
 * Hash un code avec salt (sha256).
 * Normalise avant hash : retire tirets/espaces, upper-case.
 */
function hashCode(code, salt) {
  const normalized = String(code || '').replace(/[-\s]/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized + salt).digest('hex');
}

/**
 * Normalise un code saisi (retire tirets et espaces, upper-case).
 * Gère null/undefined sans crasher.
 */
function normalizeCode(input) {
  return String(input || '').replace(/[-\s]/g, '').toUpperCase();
}

/**
 * Formate un pickup_secret_last4 en affichage masqué "•••-•XX-XX".
 * Usage : tous les lecteurs (dashboards, tracking) qui affichaient
 * auparavant orders.pickup_code en clair (Lot 2).
 */
function maskLast4(last4) {
  if (!last4) return null;
  return '•••-•' + last4.slice(0, 2) + '-' + last4.slice(2);
}

// ══════════════════════════════════════════════════════════════════════════════
// generateAndStoreSecret
// ══════════════════════════════════════════════════════════════════════════════
//
// Génération anti-collision + stockage DB.
// Utilisée par tous les canaux d'émission :
//   cash_relais, stripe, mobile_money, wallet, admin_regenerate
//
// Renvoie { code, last4 } — le code clair ne doit être utilisé qu'UNE FOIS.
//
// dbClient : si fourni, utilise cette connexion (transaction) sinon pool global.
// excludeOrderId : pour regenerate, ignore la commande elle-même.
// extraUpdates : colonnes additionnelles à UPDATE au même moment (stripe metadata…).

async function generateAndStoreSecret({
  orderId,
  relaisId = null,
  channel,
  dbClient = null,
  excludeOrderId = null,
  extraUpdates = {},
}) {
  if (!orderId) throw new Error('generateAndStoreSecret: orderId requis');
  if (!channel) throw new Error('generateAndStoreSecret: channel requis');

  const dbHandle = dbClient || db;
  const salt = crypto.randomBytes(16).toString('hex');
  const MAX_GEN_ATTEMPTS = 50;
  let code, last4;
  let attempts = 0;

  while (attempts < MAX_GEN_ATTEMPTS) {
    code  = generatePickupCode();
    last4 = code.replace(/-/g, '').slice(-4);

    const params = [last4, relaisId];
    let query = `
      SELECT id FROM orders
      WHERE pickup_secret_last4 = $1
        AND relais_id IS NOT DISTINCT FROM $2
        AND status NOT IN ('collected', 'cancelled', 'refunded')
        AND (pickup_secret_expires_at IS NULL OR pickup_secret_expires_at > NOW())
    `;
    if (excludeOrderId) {
      query += ` AND id <> $3`;
      params.push(excludeOrderId);
    }
    query += ` LIMIT 1`;

    const { rows: [dup] } = await dbHandle.query(query, params);
    if (!dup) break;
    attempts++;
  }

  if (attempts >= MAX_GEN_ATTEMPTS) {
    log.error(`[PICKUP-SECRET] Saturation anti-collision relais=${relaisId} channel=${channel}`);
    throw new Error('Génération du code impossible (saturation)');
  }

  const hash    = hashCode(code, salt);
  const now     = new Date();
  const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // +60 jours

  const baseCols = {
    pickup_secret_hash:           hash,
    pickup_secret_salt:           salt,
    pickup_secret_last4:          last4,
    pickup_secret_created_at:     now,
    pickup_secret_expires_at:     expires,
    pickup_secret_attempts:       0,
    pickup_secret_blocked_until:  null,
    pickup_secret_channel:        channel,
    pickup_secret_emitted_at:     now,
  };
  const allCols    = Object.assign({}, baseCols, extraUpdates || {});
  const colNames   = Object.keys(allCols);
  const setClauses = colNames.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values     = colNames.map(c => allCols[c]);
  values.push(orderId);

  await dbHandle.query(
    `UPDATE orders SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length}`,
    values
  );

  log.info(`[PICKUP-SECRET] ✅ Code généré channel=${channel} order=${orderId} last4=${last4}`);

  return { code, last4 };
}

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
// cacheCodeForReveal
// ══════════════════════════════════════════════════════════════════════════════
// Persiste le code clair dans pickup_reveal_codes (TTL 30 min).
// Remplace la Map REVEAL_CACHE in-memory (SEC-1 / migration 070).

async function cacheCodeForReveal(orderId, code) {
  await db.query(
    `INSERT INTO pickup_reveal_codes (order_id, code, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
     ON CONFLICT (order_id) DO UPDATE
       SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
    [orderId, code]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// issuePrintToken
// ══════════════════════════════════════════════════════════════════════════════
// Génère un token d'impression et l'insère en DB (valable 2 min).

async function issuePrintToken({ orderId, code, payerName }) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.query(
    `INSERT INTO pickup_print_tokens (token, order_id, code, payer_name, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '2 minutes')
     ON CONFLICT (token) DO NOTHING`,
    [token, orderId, code, payerName || null]
  );
  return token;
}

// ══════════════════════════════════════════════════════════════════════════════
// getReceiptHTML
// ══════════════════════════════════════════════════════════════════════════════
// Retourne { status: 200, html } ou { status, error }.

async function getReceiptHTML({ orderId, token }) {
  if (!token) {
    return { status: 400, error: 'Token manquant' };
  }

  // Consomme le token (DELETE … RETURNING, one-shot)
  const { rows: [tokenData] } = await db.query(
    `DELETE FROM pickup_print_tokens
      WHERE token = $1 AND order_id = $2 AND expires_at > NOW()
      RETURNING order_id, code, payer_name`,
    [token, orderId]
  );
  if (!tokenData) {
    return { status: 403, error: 'Token invalide ou expiré' };
  }

  const { rows: [order] } = await db.query(`
    SELECT
      o.reference, o.total_kmf, o.created_at,
      o.payment_received_at,
      o.payer_name,
      r.name AS relais_name, r.zone AS relais_city,
      u.full_name AS agent_name
    FROM orders o
    LEFT JOIN relais r ON r.id = o.relais_id
    LEFT JOIN users u ON u.id = o.payment_received_by_agent_id
    WHERE o.id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, error: 'Commande introuvable' };
  }

  const { rows: items } = await db.query(`
    SELECT oi.quantity, oi.price_kmf, p.name AS product_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
  `, [orderId]);

  const html = buildReceiptHTML({
    code:  tokenData.code,
    order,
    items,
  });

  return { status: 200, html };
}

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

    await db.query(`
      UPDATE orders
      SET pickup_secret_attempts      = $1,
          pickup_secret_blocked_until = $2,
          updated_at                  = NOW()
      WHERE id = $3
    `, [attempts, blockUntil, orderId]);

    log.warn(`[PICKUP-SECRET] Tentative échouée ${attempts}/3 pour ${order.reference} agent=${agentId}`);

    return { status: 401, body: {
      error: 'Code incorrect',
      attempts,
      remaining:     Math.max(0, 3 - attempts),
      blocked_until: blockUntil,
    }};
  }

  // Succès : reset compteur
  await db.query(`
    UPDATE orders
    SET pickup_secret_attempts      = 0,
        pickup_secret_blocked_until = NULL,
        updated_at                  = NOW()
    WHERE id = $1
  `, [orderId]);

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

    await client.query(`
      UPDATE orders
      SET collected_by_name = $1,
          updated_at        = NOW()
      WHERE id = $2
    `, [collectedByName || null, orderId]);

    log.info(`[PICKUP-SECRET] 📦 Colis remis pour ${order.reference} à "${collectedByName || '(anonyme)'}"`);

    return { status: 200, body: {
      success:   true,
      message:   'Colis remis. Commande marquée comme récupérée.',
      order_ref: order.reference,
    }};
  });
}


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
  await db.query(`
    UPDATE orders
    SET pickup_secret_regen_count  = COALESCE(pickup_secret_regen_count, 0) + 1,
        pickup_secret_regen_reason = $1,
        updated_at                 = NOW()
    WHERE id = $2
  `, [reason.trim(), orderId]);

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
// revealOnce
// ══════════════════════════════════════════════════════════════════════════════
// Révélation one-shot du code clair au payeur.
// Fenêtre 30 min, user_id match, 410 si déjà révélé ou expiré.

async function revealOnce({ orderId, userId }) {
  const { rows: [order] } = await db.query(`
    SELECT id, reference, user_id,
           pickup_secret_channel,
           pickup_secret_emitted_at,
           pickup_secret_revealed_at,
           pickup_secret_last4,
           pickup_secret_hash,
           pickup_secret_salt,
           total_kmf
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, body: { error: 'Commande introuvable' } };
  }

  if (order.user_id && order.user_id !== userId) {
    return { status: 403, body: { error: 'Cette commande ne vous appartient pas' } };
  }

  if (!order.pickup_secret_hash) {
    return { status: 202, body: {
      status:  'pending',
      message: 'Paiement en cours de validation, réessayez dans quelques secondes',
    }};
  }

  if (order.pickup_secret_revealed_at) {
    return { status: 410, body: {
      error:               'Code déjà révélé une fois',
      already_revealed_at: order.pickup_secret_revealed_at,
      message:             'Pour retrouver votre code, utilisez la procédure de perte.',
      masked:              order.pickup_secret_last4
                             ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                             : null,
    }};
  }

  const emittedAt = new Date(order.pickup_secret_emitted_at);
  const windowEnd = new Date(emittedAt.getTime() + 30 * 60 * 1000);
  if (new Date() > windowEnd) {
    return { status: 410, body: {
      error:   'Fenêtre de révélation expirée',
      message: 'Le code ne peut plus être affiché. Utilisez la procédure de perte.',
      masked:  order.pickup_secret_last4
                 ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                 : null,
    }};
  }

  const { rows: [revealRow] } = await db.query(
    'SELECT code FROM pickup_reveal_codes WHERE order_id = $1 AND expires_at > NOW()',
    [orderId]
  );
  if (!revealRow) {
    return { status: 410, body: {
      error:   'Code non disponible',
      message: 'Le code n\'est plus disponible (redémarrage serveur ou expiration). Utilisez la procédure de perte.',
      masked:  order.pickup_secret_last4
                 ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                 : null,
    }};
  }

  // Marquer révélé + purger le cache (one-shot)
  await Promise.all([
    db.query('UPDATE orders SET pickup_secret_revealed_at = NOW() WHERE id = $1', [orderId]),
    db.query('DELETE FROM pickup_reveal_codes WHERE order_id = $1', [orderId]),
  ]);

  log.info(`[PICKUP-SECRET] 👁 Code révélé (one-shot) order=${orderId} channel=${order.pickup_secret_channel}`);

  const qrPayloadRaw = JSON.stringify({ c: revealRow.code, o: order.reference });
  const qrPayload = 'KMR1.' + Buffer.from(qrPayloadRaw)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return { status: 200, body: {
    order_ref:       order.reference,
    code:            revealRow.code,
    qr_payload:      qrPayload,
    channel:         order.pickup_secret_channel,
    total_kmf:       Number(order.total_kmf || 0),
    expires_in_days: 60,
    warning:         'Ce code ne s\'affichera qu\'une seule fois. Notez-le ou prenez une capture d\'écran maintenant.',
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
  regenerateCode,
  getPickupStatus,
  revealOnce,
};
