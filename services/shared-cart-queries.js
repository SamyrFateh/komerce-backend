/**
 * @komerce-arch
 * @role          shared-cart-db-query-service
 * @domain        shared-cart
 * @layer         data-service
 * @criticality   high
 * @inputs        shared_cart_id, token, user_id, status_filters
 * @outputs       shared_cart_records, contribution_records, participant_records
 * @depends       db.js
 * @used-by       routes/shared-cart.js, shared-cart-engine.js, shared-cart-services
 * @doctrine      backend_source_verite, lookup_centralise, token_public_controle
 * @impact-areas  shared-cart, participant-flow, creator-flow, admin-debug, crons
 * @version       2026-06
 */

'use strict';

/**
 * shared-cart-queries.js
 * ══════════════════════
 * Fonctions de lookup / coordination DB pour le domaine panier partagé.
 * Pas de transactions inline — les mutations multi-étapes restent dans les
 * services métier (shared-cart-engine, cancel-shared-cart-with-refunds, etc.).
 *
 * Pattern : fonctions pures async, db importé directement, aucune logique métier.
 */

const db = require('../db');

// ─── Finance config ────────────────────────────────────────────────────────

const DEFAULT_FX_KMF_TO_EUR = 0.00203;

/**
 * Retourne le taux KMF→EUR depuis finance_config.
 * Fallback sur DEFAULT_FX_KMF_TO_EUR si absent.
 */
async function getFxKmfToEur() {
  const { rows } = await db.query(
    `SELECT value FROM finance_config WHERE key = 'fx_kmf_to_eur' LIMIT 1`
  );
  return rows.length ? parseFloat(rows[0].value) : DEFAULT_FX_KMF_TO_EUR;
}

// ─── Stripe idempotence ────────────────────────────────────────────────────

/**
 * Vérifie si un event Stripe a déjà été traité.
 * @param {object} event - objet Stripe event (id, type)
 * @returns {boolean}
 */
async function isStripeEventProcessed(event) {
  const { rows } = await db.query(
    `SELECT id FROM stripe_events_log
      WHERE stripe_event_id = $1 AND event_type = $2`,
    [event.id, event.type]
  );
  return rows.length > 0;
}

/**
 * Marque un event Stripe comme traité (INSERT idempotent via ON CONFLICT).
 * @param {object} event
 * @param {string} payloadSummary
 */
async function markStripeEventProcessed(event, payloadSummary) {
  await db.query(
    `INSERT INTO stripe_events_log (stripe_event_id, event_type, payload_summary)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
    [event.id, event.type, payloadSummary]
  );
}

// ─── Lookup panier par token ───────────────────────────────────────────────

/**
 * Retourne le panier partagé correspondant au token public.
 * @param {string} token
 * @returns {object|null}
 */
async function getSharedCartByToken(token) {
  const { rows } = await db.query(
    `SELECT * FROM shared_carts WHERE token = $1`,
    [token]
  );
  return rows[0] || null;
}

/**
 * Invalide les contributions en attente d'un panier (status → 'cancelled').
 * Utilisé lors d'une nouvelle contribution pour annuler les sessions Stripe
 * précédentes non finalisées.
 * @param {number} cartId
 */
async function invalidatePendingContributions(cartId) {
  await db.query(
    `UPDATE shared_cart_contributions
        SET status = 'cancelled', updated_at = NOW()
      WHERE shared_cart_id = $1 AND status = 'pending'`,
    [cartId]
  );
}

// ─── Notifications batch — participants par statut ─────────────────────────

/**
 * Récupère les participants ayant une estimation sur le panier (route /items).
 * @param {number} cartId
 * @returns {Array<{phone: string}>}
 */
async function getParticipantsWithEstimation(cartId) {
  const { rows } = await db.query(
    `SELECT DISTINCT participant_phone AS phone
       FROM shared_cart_estimations
      WHERE shared_cart_id = $1
        AND participant_phone IS NOT NULL`,
    [cartId]
  );
  return rows;
}

/**
 * Récupère les estimants (route /close).
 * @param {number} cartId
 * @returns {Array<{phone: string, name: string}>}
 */
async function getEstimants(cartId) {
  const { rows } = await db.query(
    `SELECT DISTINCT participant_phone AS phone,
            participant_name AS name
       FROM shared_cart_estimations
      WHERE shared_cart_id = $1
        AND participant_phone IS NOT NULL`,
    [cartId]
  );
  return rows;
}

/**
 * Récupère les contributeurs ayant payé (route /finalize).
 * @param {number} cartId
 * @returns {Array<{phone: string, first_name: string}>}
 */
async function getPaidContributors(cartId) {
  const { rows } = await db.query(
    `SELECT DISTINCT contributor_phone AS phone,
            SPLIT_PART(contributor_name, ' ', 1) AS first_name
       FROM shared_cart_contributions
      WHERE shared_cart_id = $1
        AND status = 'paid'
        AND contributor_phone IS NOT NULL`,
    [cartId]
  );
  return rows;
}

// ─── Lookup panier par id ──────────────────────────────────────────────────

/**
 * Retourne les champs nécessaires au handler awaiting-choice/complete.
 * @param {number} cartId
 * @returns {object|null}
 */
async function getCartForAwaitingChoice(cartId) {
  const { rows: [cart] } = await db.query(
    `SELECT id, status, token, title, beneficiary_name_snapshot,
            total_kmf_snapshot, remaining_kmf, beneficiary_user_id
       FROM shared_carts WHERE id = $1`,
    [cartId]
  );
  return cart || null;
}

/**
 * Retourne le panier partagé appartenant à un utilisateur (extend-window).
 * @param {number} cartId
 * @param {number} userId
 * @returns {object|null}
 */
async function getCartByOwner(cartId, userId) {
  const { rows } = await db.query(
    `SELECT * FROM shared_carts WHERE id = $1 AND beneficiary_user_id = $2`,
    [cartId, userId]
  );
  return rows[0] || null;
}

// ─── Mutations fenêtre de paiement ────────────────────────────────────────

/**
 * Prolonge la fenêtre de paiement d'un panier CLOSED.
 * Incrémente metadata.payment_window_extensions.
 * @param {number} cartId
 * @param {number} hours
 * @returns {object|null} panier mis à jour, null si statut incompatible
 */
async function extendPaymentWindow(cartId, hours) {
  const { rows: [updated] } = await db.query(
    `UPDATE shared_carts
        SET payment_window_ends_at = payment_window_ends_at + ($2 || ' hours')::INTERVAL,
            metadata = COALESCE(metadata, '{}'::jsonb) ||
              jsonb_build_object('payment_window_extensions',
                COALESCE((metadata->>'payment_window_extensions')::int, 0) + 1),
            updated_at = NOW()
      WHERE id = $1 AND status = 'closed'
      RETURNING *`,
    [cartId, String(hours)]
  );
  return updated || null;
}

// ─── Log d'événements ─────────────────────────────────────────────────────

/**
 * Insère un événement dans shared_cart_events.
 * actor_id est nullable (omis pour les acteurs 'system').
 * @param {number} cartId
 * @param {string} eventType
 * @param {string} actorType  'system' | 'user' | 'admin'
 * @param {number|null} actorId
 * @param {object} payload
 */
async function logEvent(cartId, eventType, actorType, actorId, payload) {
  await db.query(
    `INSERT INTO shared_cart_events (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, $3, $4, $5)`,
    [cartId, eventType, actorType, actorId ?? null, payload]
  );
}

// ─── Admin — liste ─────────────────────────────────────────────────────────

/**
 * Liste les paniers partagés (vue admin) avec filtres optionnels.
 * @param {{ status?: string, user_id?: number }} filters
 * @returns {Array}
 */
async function adminListCarts(filters = {}) {
  const conditions = [];
  const params = [];
  let i = 1;

  if (filters.status) {
    conditions.push(`sc.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.user_id) {
    conditions.push(`sc.beneficiary_user_id = $${i++}`);
    params.push(filters.user_id);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const { rows } = await db.query(
    `SELECT sc.*,
            u.full_name AS beneficiary_full_name,
            u.email AS beneficiary_email,
            (SELECT COUNT(*) FROM shared_cart_contributions
              WHERE shared_cart_id = sc.id AND status = 'paid')::int AS contributors_count,
            (SELECT COUNT(*) FROM shared_cart_contributions
              WHERE shared_cart_id = sc.id)::int AS contributions_total_count
       FROM shared_carts sc
       LEFT JOIN users u ON u.id = sc.beneficiary_user_id
       ${where}
      ORDER BY sc.created_at DESC
      LIMIT 200`,
    params
  );
  return rows;
}

// ─── Admin — détail ────────────────────────────────────────────────────────

/**
 * Retourne le détail complet d'un panier (cart + items + contributions + estimations + events).
 * @param {number} cartId
 * @returns {{ cart: object, items: Array, contributions: Array, estimations: Array, events: Array } | null}
 */
async function adminGetCartDetail(cartId) {
  const { rows: cartRows } = await db.query(
    `SELECT * FROM shared_carts WHERE id = $1`,
    [cartId]
  );
  if (!cartRows.length) return null;

  const [items, contribs, ests, events] = await Promise.all([
    db.query(`SELECT * FROM shared_cart_items WHERE shared_cart_id = $1 ORDER BY created_at`, [cartId]),
    db.query(`SELECT * FROM shared_cart_contributions WHERE shared_cart_id = $1 ORDER BY created_at DESC`, [cartId]),
    db.query(`SELECT * FROM shared_cart_estimations WHERE shared_cart_id = $1 ORDER BY created_at`, [cartId]),
    db.query(`SELECT * FROM shared_cart_events WHERE shared_cart_id = $1 ORDER BY created_at DESC LIMIT 100`, [cartId]),
  ]);

  return {
    cart:          cartRows[0],
    items:         items.rows,
    contributions: contribs.rows,
    estimations:   ests.rows,
    events:        events.rows,
  };
}

// ─── Admin — mutations ─────────────────────────────────────────────────────

/**
 * Force-expire un panier (statuts open / closed / awaiting_choice → expired).
 * @param {number} cartId
 * @returns {object|null} panier mis à jour, null si statut incompatible
 */
async function adminExpireCart(cartId) {
  const { rows } = await db.query(
    `UPDATE shared_carts SET status = 'expired', updated_at = NOW()
      WHERE id = $1
        AND status IN ('open', 'closed', 'awaiting_choice')
     RETURNING *`,
    [cartId]
  );
  return rows[0] || null;
}

/**
 * Étend la date cible d'un panier OPEN (admin SAV).
 * @param {number} cartId
 * @param {number} days
 * @returns {object|null} panier mis à jour, null si non trouvé / non OPEN
 */
async function adminExtendCartDate(cartId, days) {
  const { rows } = await db.query(
    `UPDATE shared_carts
        SET target_date = COALESCE(target_date, CURRENT_DATE) + ($1 || ' days')::INTERVAL,
            updated_at = NOW()
      WHERE id = $2 AND status = 'open'
     RETURNING *`,
    [String(days), cartId]
  );
  return rows[0] || null;
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  // Finance
  getFxKmfToEur,
  // Stripe idempotence
  isStripeEventProcessed,
  markStripeEventProcessed,
  // Lookup token
  getSharedCartByToken,
  invalidatePendingContributions,
  // Notifications batch
  getParticipantsWithEstimation,
  getEstimants,
  getPaidContributors,
  // Lookup id
  getCartForAwaitingChoice,
  getCartByOwner,
  // Mutations fenêtre
  extendPaymentWindow,
  // Logs
  logEvent,
  // Admin
  adminListCarts,
  adminGetCartDetail,
  adminExpireCart,
  adminExtendCartDate,
};
