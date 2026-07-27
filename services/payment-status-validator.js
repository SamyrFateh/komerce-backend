/**
 * @komerce-arch
 * @role          payment-status-transition-validator
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        from, to, options { paymentEvent }
 * @outputs       {allowed, reason} | source-status arrays for SQL guards
 * @depends       (aucune — pure logique, pas de DB)
 * @used-by       services/payment-service.js, services/order-status-machine.js
 * @doctrine      payment_status_single_entry, payment_status_transition_matrix (P5-N2/N3)
 * @version       2026-07
 */

'use strict';

/**
 * KOMERCE — Payment Status Transition Validator (services/payment-status-validator.js)
 *
 * SOURCE UNIQUE de la matrice de transitions orders.payment_status.
 * Consommée par les DEUX écrivains autorisés (invariant I-BACK-4 / N1) :
 *   - services/payment-service.js   (markPaid, markRefunded, markFailed)
 *   - services/order-status-machine.js (effet de bord pending→confirmed)
 *
 * Règles tranchées (transcrites depuis la revue N2, non redéduites du code) :
 *
 *   1. refunded → paid   : BLOQUÉ explicitement (état terminal financier).
 *   2. failed → paid     : autorisé UNIQUEMENT via un événement de paiement
 *                          identifiable (paymentEvent: { type, externalId }),
 *                          jamais via un markPaid(orderId) nu.
 *   3. → failed           : uniquement depuis 'pending' (aucun bypass —
 *                          l'ancien flag guardPending:false est retiré).
 *   4. → refunded         : PERMISSIF côté source (pending/paid/failed) — seul
 *                          paid→refunded est observé en usage réel
 *                          (admin-order-refund.js, payment-paypal.js), mais
 *                          aucune règle métier n'a tranché s'il faut restreindre
 *                          les autres sources. Point NON résolu, laissé ouvert
 *                          à dessein plutôt qu'inventé — cf. NOTE_DE_PASSATION
 *                          P5-N2/N3. À confirmer avant de resserrer.
 *   5. partially_paid     : jamais une cible valide. N'est écrit nulle part
 *                          dans orders.payment_status — c'est un libellé
 *                          calculé à l'affichage (collective-workspace-reads.js),
 *                          pas un état réel de la colonne.
 */

const PAYMENT_STATUSES = Object.freeze(['pending', 'paid', 'refunded', 'failed']);

/**
 * Table des transitions autorisées, par statut CIBLE.
 *   from          — sources toujours autorisées.
 *   fromWithEvent — sources autorisées uniquement si un paymentEvent
 *                   { type, externalId } identifiable est fourni.
 */
const TRANSITIONS = Object.freeze({
  paid: {
    from: ['pending'],
    fromWithEvent: ['failed'],
  },
  failed: {
    from: ['pending'],
    fromWithEvent: [],
  },
  refunded: {
    from: ['pending', 'paid', 'failed'],
    fromWithEvent: [],
  },
});

function hasIdentifiablePaymentEvent(paymentEvent) {
  return !!(paymentEvent && paymentEvent.type && paymentEvent.externalId);
}

/**
 * @param {string} from statut courant (peut être null/undefined pour une commande neuve)
 * @param {string} to   statut cible
 * @param {object} [opts]
 * @param {object} [opts.paymentEvent] { type, externalId } — requis pour failed→paid
 * @returns {{allowed:boolean, reason:string}}
 */
function validateTransition(from, to, { paymentEvent = null } = {}) {
  if (to === 'partially_paid') {
    return { allowed: false, reason: 'partially_paid_never_written' };
  }
  const rule = TRANSITIONS[to];
  if (!rule) {
    return { allowed: false, reason: `unknown_target_status:${to}` };
  }
  if (from === to) {
    return { allowed: true, reason: 'noop' };
  }
  if (rule.from.includes(from)) {
    return { allowed: true, reason: `${from}_to_${to}` };
  }
  if (hasIdentifiablePaymentEvent(paymentEvent) && rule.fromWithEvent.includes(from)) {
    return { allowed: true, reason: `${from}_to_${to}_via_payment_event` };
  }
  return { allowed: false, reason: `blocked:${from}_to_${to}` };
}

/**
 * Sources autorisées pour une cible donnée — sert à construire la clause
 * WHERE atomique des mutations SQL (évite le pattern SELECT-puis-UPDATE,
 * qui serait sujet à une course hors transaction explicite).
 * @returns {string[]}
 */
function sourceStatusesFor(to, { paymentEvent = null } = {}) {
  const rule = TRANSITIONS[to];
  if (!rule) return [];
  return hasIdentifiablePaymentEvent(paymentEvent)
    ? [...rule.from, ...rule.fromWithEvent]
    : [...rule.from];
}

/**
 * Construit le fragment SQL `payment_status = '...'` ou `payment_status IN (...)`
 * à partir d'une liste de statuts sources. Les valeurs proviennent exclusivement
 * de TRANSITIONS (jamais d'une entrée utilisateur) — interpolation sûre.
 */
function sqlGuard(sourceStatuses) {
  if (!sourceStatuses.length) return 'FALSE'; // aucune source autorisée => no-op garanti
  if (sourceStatuses.length === 1) return `payment_status = '${sourceStatuses[0]}'`;
  return `payment_status IN (${sourceStatuses.map((s) => `'${s}'`).join(', ')})`;
}

module.exports = {
  PAYMENT_STATUSES,
  TRANSITIONS,
  validateTransition,
  sourceStatusesFor,
  sqlGuard,
};
