/**
 * @komerce-arch
 * @role          shared-cart-v41-transition-projector
 * @domain        shared-cart
 * @layer         machine
 * @criticality   critical
 * @inputs        shared_cart_status, event_date, payment_window, creator_choice, contribution_state
 * @outputs       projected_status, deadline_state, allowed_actions
 * @depends       doctrine/V4.1, utils/rules.js
 * @used-by       services/shared-cart-engine.js, services/shared-cart-items-service.js, routes/shared-cart.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        pure_projection_no_db_write
 * @doctrine      panier_ouvert_ferme, fenetre_paiement_48h, choix_createur_72h, paiement_seul_acte_engageant
 * @impact-areas  shared-cart, participant-flow, creator-flow, checkout, crons
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Panier partagé V4.1 : projection métier & machine d'état
 *
 * Référence : DOCTRINE-PANIER-PARTAGE-V4.1-FINALE.md (gelée, juin 2026)
 * Plan      : ARCHITECTURE-REFONTE-PANIER-PARTAGE-V4.1.md §2
 *
 * Rôle :
 *   - businessStatusOf(cart)  : projette l'enum SQL hérité (12 valeurs)
 *                               vers les 5 états métier visibles de la
 *                               doctrine (+ 2 états techniques invisibles).
 *   - canTransition / assertTransition : table des transitions autorisées.
 *   - Fenêtre de paiement : défaut 48 h, presets fermés, prolongation
 *                           unique de 48 h par le créateur (décision
 *                           produit juin 2026 — amendement V4.2 à acter
 *                           dans la doctrine si les presets sont exposés).
 *
 * AUCUN écran ni endpoint ne doit raisonner sur l'enum brut :
 * ce module est l'unique source de vérité de l'état métier.
 */

/* ── Feature flag ──────────────────────────────────────────────────── */

function isV41Enabled() {
  return process.env.SHARED_CART_V41 === '1';
}

/* ── États métier (doctrine §Machine d'état) ───────────────────────── */

const BUSINESS = Object.freeze({
  OPEN: 'OPEN',                       // panier en cours, modifications libres
  CLOSED: 'CLOSED',                   // fenêtre de paiement ouverte
  AWAITING_CHOICE: 'AWAITING_CHOICE', // fin de fenêtre, financement < 100 %
  ORDERED: 'ORDERED',                 // commande créée
  CANCELLED: 'CANCELLED',             // annulé (remboursements inclus)
  // Techniques — JAMAIS affichés (doctrine : « invisible pour les utilisateurs »)
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED',
});

const VISIBLE_STATUSES = Object.freeze([
  BUSINESS.OPEN, BUSINESS.CLOSED, BUSINESS.AWAITING_CHOICE,
  BUSINESS.ORDERED, BUSINESS.CANCELLED,
]);

/* ── Projection enum SQL → état métier ─────────────────────────────── */

function metadataOf(cart) {
  if (!cart || cart.metadata == null) return {};
  if (typeof cart.metadata === 'object') return cart.metadata;
  try { return JSON.parse(cart.metadata); } catch (_) { return {}; }
}

/** Hérités → CLOSED (mapping migration 080 §3). */
const LEGACY_CLOSED = new Set([
  'closed_for_settlement', 'settlement_in_progress',
  'partially_funded', 'fully_funded', 'ready_to_finalize',
]);

/** Hérités → ORDERED (mapping migration 080 §3). */
const LEGACY_ORDERED = new Set(['converted_to_order', 'finalized']);

/** Hérités → OPEN (mapping migration 080 §3). */
const LEGACY_OPEN = new Set(['draft', 'active', 'commitment_open']);

function businessStatusOf(cart) {
  if (!cart || !cart.status) return null;
  const s = String(cart.status);

  // ── Statuts canoniques V4.1 (migration 080) ──────────────────────
  if (s === 'open')            return BUSINESS.OPEN;
  if (s === 'closed')          return BUSINESS.CLOSED;
  if (s === 'awaiting_choice') return BUSINESS.AWAITING_CHOICE;
  if (s === 'ordered')         return BUSINESS.ORDERED;
  if (s === 'cancelled')       return BUSINESS.CANCELLED;
  if (s === 'expired')         return BUSINESS.EXPIRED;
  if (s === 'archived')        return BUSINESS.ARCHIVED;

  // ── Défense : valeurs héritées V4 (alignées sur le mapping de la
  //    migration 080 — toute ligne échappée à l'UPDATE projette pareil) ──
  if (s === 'refunded')      return BUSINESS.CANCELLED;
  if (LEGACY_ORDERED.has(s)) return BUSINESS.ORDERED;
  if (LEGACY_CLOSED.has(s))  return BUSINESS.CLOSED;
  if (metadataOf(cart).settlement_open === true) return BUSINESS.CLOSED;
  if (LEGACY_OPEN.has(s)) return BUSINESS.OPEN;

  // Statut inconnu : on échoue bruyamment plutôt que d'afficher n'importe quoi.
  const err = new Error(`businessStatusOf: statut shared_cart inconnu « ${s} »`);
  err.code = 'UNKNOWN_SHARED_CART_STATUS';
  throw err;
}

function isVisibleStatus(business) {
  return VISIBLE_STATUSES.includes(business);
}

/* ── Table des transitions (doctrine §Machine d'état, plan §2.2) ───── */

const TRANSITIONS = Object.freeze({
  [BUSINESS.OPEN]:            Object.freeze([BUSINESS.CLOSED, BUSINESS.CANCELLED]),
  [BUSINESS.CLOSED]:          Object.freeze([BUSINESS.ORDERED, BUSINESS.AWAITING_CHOICE, BUSINESS.CANCELLED]),
  [BUSINESS.AWAITING_CHOICE]: Object.freeze([BUSINESS.ORDERED, BUSINESS.CLOSED, BUSINESS.CANCELLED, BUSINESS.EXPIRED]),
  [BUSINESS.EXPIRED]:         Object.freeze([BUSINESS.ARCHIVED]),
  [BUSINESS.ORDERED]:         Object.freeze([]),
  [BUSINESS.CANCELLED]:       Object.freeze([]),
  [BUSINESS.ARCHIVED]:        Object.freeze([]),
});

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`Transition interdite : ${from} → ${to}`);
    err.status = 409;
    err.code = 'INVALID_SHARED_CART_TRANSITION';
    throw err;
  }
}

/* ── Fenêtre de paiement ───────────────────────────────────────────── */

/** Défaut doctrine. Centralisé : un seul endroit à changer après retour terrain. */
const DEFAULT_PAYMENT_WINDOW_HOURS = 48;

/** Presets fermés — jamais de saisie libre (décision produit juin 2026). */
const PAYMENT_WINDOW_PRESETS_HOURS = Object.freeze([48, 96, 168]);

/** Prolongations créateur autorisées pendant CLOSED (action unique). */
const MAX_WINDOW_EXTENSIONS = 1;
const WINDOW_EXTENSION_HOURS = 48;

const HOUR_MS = 3600 * 1000;

/** Durée de fenêtre du panier : preset valide en metadata, sinon défaut. */
function paymentWindowHoursOf(cart) {
  const raw = Number(metadataOf(cart).payment_window_hours);
  return PAYMENT_WINDOW_PRESETS_HOURS.includes(raw) ? raw : DEFAULT_PAYMENT_WINDOW_HOURS;
}

/** Nombre de prolongations déjà consommées. */
function windowExtensionsOf(cart) {
  const n = Number(metadataOf(cart).payment_window_extensions);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function canExtendWindow(cart) {
  return businessStatusOf(cart) === BUSINESS.CLOSED
    && windowExtensionsOf(cart) < MAX_WINDOW_EXTENSIONS;
}

/** Fin de fenêtre = closed_at + durée + prolongations consommées. */
function computePaymentWindowEnd(closedAt, cart) {
  const base = closedAt instanceof Date ? closedAt : new Date(closedAt);
  if (Number.isNaN(base.getTime())) {
    throw new Error('computePaymentWindowEnd: closedAt invalide');
  }
  const hours = paymentWindowHoursOf(cart)
    + windowExtensionsOf(cart) * WINDOW_EXTENSION_HOURS;
  return new Date(base.getTime() + hours * HOUR_MS);
}

/** Délai AWAITING_CHOICE → expired (doctrine : 72 h). */
const AWAITING_CHOICE_HOURS = 72;

module.exports = {
  isV41Enabled,
  BUSINESS,
  VISIBLE_STATUSES,
  businessStatusOf,
  isVisibleStatus,
  TRANSITIONS,
  canTransition,
  assertTransition,
  DEFAULT_PAYMENT_WINDOW_HOURS,
  PAYMENT_WINDOW_PRESETS_HOURS,
  MAX_WINDOW_EXTENSIONS,
  WINDOW_EXTENSION_HOURS,
  AWAITING_CHOICE_HOURS,
  paymentWindowHoursOf,
  windowExtensionsOf,
  canExtendWindow,
  computePaymentWindowEnd,
};
