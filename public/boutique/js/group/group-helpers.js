/**
 * @module group/group-helpers.js
 * @owner group refactor — helpers de calcul pur (aucun effet de bord)
 *
 * Fonctions stateless partagées par tous les modules group/*.
 * Aucun import réseau, aucune mutation de state, aucun accès DOM.
 * Testables unitairement sans setup.
 */

/**
 * Arrondit n à l'entier le plus proche. Tolère null / undefined / NaN.
 * @param {number|string|null} n
 * @returns {number}
 */
export function r(n) { return Math.round(Number(n) || 0); }

/**
 * Calcule le pourcentage de progression (0–100, arrondi).
 * Utilisé pour la barre "payé" — toujours plafonné à 100 %.
 * @param {number} confirmed  montant confirmé / payé
 * @param {number} total      montant total
 * @returns {number}
 */
export function pct(confirmed, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((confirmed / total) * 100)));
}

/**
 * Calcule le pourcentage d'engagement (plafonné à 100 % pour affichage barre).
 * La valeur brute (> 100) est renvoyée séparément pour le badge sur-couvert.
 *
 * @param {Array}  commitments  liste des engagements du panier
 * @param {number} total        total du panier (cart.total_kmf_snapshot)
 * @returns {{ pctCapped: number, pctRaw: number, engagementsTotal: number }}
 *   pctCapped       : 0–100, pour la largeur de la barre intention
 *   pctRaw          : valeur réelle (peut dépasser 100)
 *   engagementsTotal: somme brute des amount_kmf
 */
export function engagementCoverage(commitments = [], total = 0) {
  const engagementsTotal = commitments.reduce((s, c) => s + r(c.amount_kmf), 0);
  if (!total) return { pctCapped: 0, pctRaw: 0, engagementsTotal };
  const pctRaw    = Math.round((engagementsTotal / total) * 100);
  const pctCapped = Math.min(100, pctRaw);
  return { pctCapped, pctRaw, engagementsTotal };
}

/**
 * Retourne un label emoji + texte selon le statut d'un panier partagé.
 * Si le règlement est ouvert, le statut est écrasé par "En règlement".
 * @param {string}  status           cart.status
 * @param {boolean} isSettlementOpen résultat de isSettlementOpen(cart)
 * @returns {string}
 */
export function statusLabel(status, isSettlementOpen) {
  if (isSettlementOpen) return '🔐 En règlement';
  return {
    active:             '🟢 Ouvert',
    partially_funded:   '🟡 Partiellement financé',
    fully_funded:       '✅ Financé',
    converted_to_order: '📦 Clôturé',
    finalized:          '📦 Clôturé',
    cancelled:          '❌ Annulé',
    expired:            '⏱️ Expiré',
  }[status] || status;
}

/**
 * Parse cart.metadata quel que soit son type (string JSON ou objet).
 * Retourne toujours un objet (vide si absent ou invalide).
 * @param {object|null} cart
 * @returns {object}
 */
export function metaOf(cart) {
  if (!cart?.metadata) return {};
  if (typeof cart.metadata === 'object') return cart.metadata;
  try { return JSON.parse(cart.metadata); } catch (_) { return {}; }
}

/**
 * Indique si la phase règlement est ouverte pour ce panier.
 * @param {object} cart
 * @returns {boolean}
 */
export function isSettlementOpen(cart) {
  return metaOf(cart).settlement_open === true;
}

/**
 * Calcule le montant restant à payer (KMF).
 * PR2 — utilise cart.remaining_kmf (calculé par le backend, source de vérité)
 * si disponible, sinon fallback total − confirmé.
 * Ne renvoie jamais de valeur négative.
 * @param {object} cart
 * @returns {number}
 */
export function remainingKmf(cart) {
  const total     = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  return Math.max(0, r(cart.remaining_kmf) || total - confirmed);
}

/**
 * Calcule la date d'expiration du règlement.
 * Retourne null si le règlement n'est pas ouvert ou si la date d'ouverture manque.
 * @param {object} cart
 * @returns {Date|null}
 */
export function settlementExpiresAt(cart) {
  const meta = metaOf(cart);
  if (!meta.settlement_open || !meta.settlement_opened_at) return null;
  const windowH = Number(meta.settlement_window_hours) || 48;
  return new Date(new Date(meta.settlement_opened_at).getTime() + windowH * 3_600_000);
}

/**
 * Retourne une chaîne lisible indiquant le temps restant avant une échéance.
 * Exemples : "3j restants", "12h30min restantes", "45min restantes", "Expiré".
 * @param {Date|null} expiresAt
 * @returns {string|null}  null si expiresAt est falsy
 */
export function timeRemaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return 'Expiré';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}j restants`;
  if (h >= 1)  return `${h}h${m > 0 ? m + 'min' : ''} restantes`;
  return `${Math.max(1, m)}min restantes`;
}

/**
 * Retourne l'étape courante du parcours créateur (3 étapes max).
 *
 * @param {object} cart  panier partagé
 * @returns {'ORDER_CREATED'|'CONFIRM'|'SHARE_AND_LOCK'}
 */
export function getGroupStep(cart) {
  if (cart.status === 'converted_to_order' || cart.finalized_order_id) {
    return 'ORDER_CREATED';
  }

  if (isSettlementOpen(cart) ||
      ['closed_for_settlement', 'settlement_in_progress', 'ready_to_finalize'].includes(cart.status)) {
    return 'CONFIRM';
  }

  return 'SHARE_AND_LOCK';
}
