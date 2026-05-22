/**
 * b-modal-social-proof-mock.js — Module ES · Chantier 2
 *
 * ⚠️ FICHIER TEMPORAIRE — À SUPPRIMER QUAND LA DB AURA LES COLONNES SOCIAL PROOF
 *
 * But : démontrer le rendu visuel du social proof (#9 Bestseller · 432 vendus
 *       · ★ 4,8 · 218 avis) dans la modale produit, conformément au mockup
 *       chantier 2, pendant la période où la table `products` Railway n'a pas
 *       encore les colonnes `rank`, `sold_count`, `rating`, `review_count`.
 *
 * Stratégie : hook le bus `modal:opened` (émis dans b-modal.js openModal()
 *       AVANT setupSocialProof()) pour enrichir state.modalProduct avec des
 *       valeurs pseudo-aléatoires STABLES par produit (hash de l'ID).
 *       `b-modal-social-proof.js` lit ensuite ces propriétés comme s'il
 *       s'agissait de données API — son code reste 100% inchangé et son
 *       invariant "aucun chiffre inventé" reste valide à son niveau : c'est
 *       l'amont qui invente, le module reste honnête.
 *
 * Retrait propre :
 *   1. Migration SQL : ALTER TABLE products ADD COLUMN rank smallint,
 *      ADD COLUMN sold_count integer, ADD COLUMN rating numeric(2,1),
 *      ADD COLUMN review_count integer;
 *   2. Backfill : remplir au moins les produits affichés
 *   3. Côté frontend : supprimer ce fichier + retirer son import dans b-modal.js
 *   4. Le module b-modal-social-proof.js continue de marcher tel quel
 *      (il lit product.rank / .sold_count / .rating / .review_count, peu
 *      lui importe d'où ça vient).
 *
 * Flag de contrôle : window.__komerceSocialProofMock (default true).
 *       Pour le couper en runtime : `window.__komerceSocialProofMock = false`
 */

import { bus }   from './b-bus.js';

'use strict';

// ═══════════════════════════════════════════════════════════════
//  HASH STABLE (FNV-1a 32-bit simplifié)
// ═══════════════════════════════════════════════════════════════

/**
 * Retourne un entier non signé stable et bien dispersé pour une string.
 * Sert à dériver rank/sold/rating/reviews d'un même produit de manière
 * reproductible entre sessions (pas de Math.random qui changerait à chaque
 * rechargement, ce qui ruinerait la confiance utilisateur).
 */
function _hash(str) {
  var s = String(str || '');
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

// ═══════════════════════════════════════════════════════════════
//  DÉRIVATION DES VALEURS MOCK
// ═══════════════════════════════════════════════════════════════

/**
 * Produit identifié par product.id (UUID, string ou int — peu importe).
 * Sortie : objet { rank, sold_count, rating, review_count } — toutes les
 * propriétés sont définies, jamais null.
 *
 * Distribution voulue (pour un mix réaliste à l'œil) :
 *   rank          1..50         (uniforme)
 *   sold_count    50..800       (uniforme)
 *   rating        3.7..4.9      (pas de 0.1)
 *   review_count  10..350       (uniforme, sans corrélation forcée
 *                                avec sold pour rester simple)
 */
function _deriveSocialProof(productId) {
  var h = _hash(productId);
  // 4 sous-hash dérivés par bit-shift pour décorréler les 4 valeurs
  var h1 = h & 0xFFFF;
  var h2 = (h >>> 8) & 0xFFFF;
  var h3 = (h >>> 16) & 0xFFFF;
  var h4 = ((h >>> 4) ^ (h >>> 20)) & 0xFFFF;

  return {
    rank:         1 + (h1 % 50),                 // 1..50
    sold_count:   50 + (h2 % 751),               // 50..800
    rating:       Number((3.7 + (h3 % 13) / 10).toFixed(1)), // 3.7..4.9 pas 0.1
    review_count: 10 + (h4 % 341),               // 10..350
  };
}

// ═══════════════════════════════════════════════════════════════
//  ENRICHISSEMENT — bus hook
// ═══════════════════════════════════════════════════════════════

/**
 * Enrichit l'objet product passé par référence si :
 *   - le flag global est actif (par défaut)
 *   - et aucune des 4 propriétés n'est déjà présente (l'API a priorité)
 *
 * On considère qu'une seule des 4 propriétés présente = données API arrivées,
 * et on ne touche pas du tout au produit (pas de mock partiel).
 */
function _enrichWithMock(product) {
  if (!product) return;
  if (window.__komerceSocialProofMock === false) return;

  var hasAnyReal = (
    product.rank != null ||
    product.sold_count != null ||
    product.rating != null ||
    product.review_count != null
  );
  if (hasAnyReal) return;

  // Identifiant stable pour le hash : id en priorité, fallback name + price.
  // Si le produit n'a vraiment rien d'identifiable, on skip plutôt que de
  // générer une valeur dépendante du contexte (mauvaise reproductibilité).
  var seed = product.id != null
    ? product.id
    : (product.name && product.price_kmf != null
        ? product.name + '#' + product.price_kmf
        : null);
  if (seed == null) return;

  var mock = _deriveSocialProof(seed);
  product.rank         = mock.rank;
  product.sold_count   = mock.sold_count;
  product.rating       = mock.rating;
  product.review_count = mock.review_count;
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════

let _installed = false;

export function setupSocialProofMock() {
  if (_installed) return;
  _installed = true;

  // Flag global (peut être fixé avant que ce module ne se charge)
  if (typeof window.__komerceSocialProofMock === 'undefined') {
    window.__komerceSocialProofMock = true;
  }

  // modal:opened est émis dans openModal() AVANT setupSocialProof().
  // On enrichit le produit ici → setupSocialProof verra les valeurs au
  // moment de son requestAnimationFrame.
  //
  // Note : la navigation produit suivant/précédent (navigateModal dans
  // b-modal.js) appelle openModal() qui ré-émet modal:opened. Un seul
  // hook suffit donc à couvrir tous les cas d'ouverture/changement.
  bus.on('modal:opened', _enrichWithMock);
}

// Pas d'export auto : c'est b-modal.js qui appelle setupSocialProofMock()
// à l'init (cf. import en haut de b-modal.js, à côté de setupSocialProof).
