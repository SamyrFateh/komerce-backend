/**
 * @komerce-arch
 * @role          boutique-b-bus
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       none
 * @used-by       public/boutique/js/b-cart-core.js, public/boutique/js/b-cart-pill.js, public/boutique/js/b-cart.js, public/boutique/js/b-catalog-desktop-enhancers.js, public/boutique/js/b-catalog.js, public/boutique/js/b-checkout.js, public/boutique/js/b-desktop-sidebar.js, public/boutique/js/group/group-side-cart.js, public/boutique/js/b-home-premium-v1.js, public/boutique/js/b-mini-cart.js, public/boutique/js/b-modal-core.js, public/boutique/js/b-modal-desktop-enhancers.js, public/boutique/js/b-modal-image-ux.js, public/boutique/js/b-modal-nav.js, public/boutique/js/b-modal-product.js, public/boutique/js/b-modal-social-proof.js, public/boutique/js/b-modal-suggestions.js, public/boutique/js/b-nav.js, public/boutique/js/b-pager.js, public/boutique/js/b-pdp-curation-suggestions.js, public/boutique/js/b-product-open-contract.js, public/boutique/js/b-store.js, public/boutique/js/b-subcat.js, public/boutique/js/boutique.js, public/boutique/js/main.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-bus
 * @brief Event bus léger pour découpler les modules sans imports circulaires.
 *
 * Pattern :
 *   import { bus } from './b-bus.js';
 *   bus.on('modal:open', ({ id }) => openModal(id));
 *   bus.emit('modal:open', { id: 42 });
 *
 * Événements standard Komerce :
 *   modal:open       { id }              — ouvrir fiche produit
 *   modal:close      —                  — fermer modal
 *   cart:update      —                  — panier mis à jour (badge sync) [émis par updateCartBadge]
 *   side-cart:render —                  — forcer un re-rendu du side-cart desktop [ARCH-1]
 *   cart-body:render —                  — re-rendre le corps du drawer/side-cart après un
 *     bascule de state.cartSurface [group-side-cart.js → b-cart.js, amendement V2 §A
 *     PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART ; évite un import statique
 *     de b-cart.js depuis group-side-cart.js (mandat §5, pas de dépendance inverse)]
 *   checkout:open    —                  — ouvrir la modale de commande [ARCH-1]
 *   product:open-from-cart { id }        — ouvrir fiche depuis le panier [ARCH-1]
 *   view:switch      { view }           — changer d'onglet (home/favs/suivi)
 *   chip:center      { chip }           — centrer chip active dans le pager [b-pager → b-catalog]
 *   catalog:cat-changed { cat }         — catégorie active changée [b-catalog → b-desktop-upgrade]
 *   modal:suggestions-rendered { product } — suggestions modal rendues, prêtes pour curation PDP
 *   modal:detail-ready —                  — Product Detail Contract résolu ; réconcilier l'état panier modal
 *   nav:goto-track   —                  — ouvrir l'onglet Suivi depuis la confirmation de commande [b-checkout.js → b-nav.js, FIX 2026-07-11]
 *   komerce:show { focus } — ouvrir Mon Komerce après authentification ; focus=wallet depuis le checkout [b-checkout.js → b-nav.js/b-komerce.js, LOT4B]
 *   nav:goto-komerce-wallet — ouvrir Mon Komerce focalisé sur le wallet depuis le checkout [b-checkout.js → b-nav.js, LOT4B]
 *   modal:opened     { product }        — fait : la modal vient de s'ouvrir sur ce produit (≠ modal:open, qui est la commande d'ouverture)
 *   modal:closed     —                  — fait : la modal vient de se fermer (≠ modal:close, qui est la commande de fermeture)
 *   modal:composition-synced —          — fait : la composition responsive de la modal ouverte vient d'être réconciliée après un resize
 *
 * Propriété des contrats (P3b, 2026-07) — owner = feature manifeste propriétaire du
 * contrat ; producer = seul module autorisé à émettre ; payload = arité attendue
 * (none = aucun argument, value = un argument). Toute émission hors du producer
 * déclaré, ou tout écart d'arité au call site, remonte en ATTENTION dans
 * gen-boutique-360.js. Ne couvre que les événements listés ici — les autres
 * événements actifs ci-dessus restent hors du périmètre de cette validation :
 *   modal:opened               owner=modal-product producer=b-modal-core.js payload=value
 *   modal:closed                owner=modal-product producer=b-modal-core.js payload=none
 *   modal:composition-synced    owner=modal-product producer=b-modal-product-detail-bootstrap.js payload=none
 *
 * Consommateurs déclarés (P3b) — tout écouteur observé hors de cette liste remonte
 * en ATTENTION comme consommateur non déclaré (un ajout légitime doit d'abord être
 * ajouté ici, pas seulement câblé) :
 *   modal:opened     : b-modal-product-detail-bootstrap.js, boutique.js, b-pdp-curation-suggestions.js, b-pager.js, b-modal-desktop-enhancers.js
 *   modal:closed     : b-modal-product-detail-bootstrap.js, b-pager.js, group-side-cart.js
 *   modal:composition-synced : b-modal-desktop-enhancers.js, b-modal-core.js
 *
 * Événements retirés du JSDoc (déclarés mais jamais émis ni consommés) :
 *   cart:add, cart:open, cart:close, search:query, pager:navigate
 *   cat:select — retiré REF-2026-07d, seul émetteur (recherche interne modale)
 *     supprimé avec toute la fonctionnalité recherche. Écouteur retiré de
 *     b-catalog.js. Réintroduire si un besoin de découplage circulaire
 *     [b-modal ↔ b-catalog] réapparaît (cf. BUG-M4 historique).
 */

const _listeners = {};

export const bus = {
  /**
   * Abonne une fonction à un événement.
   * @param {string} event - Nom de l'événement
   * @param {Function} fn - Callback appelé avec les données de l'événement
   */
  on(event, fn) {
    (_listeners[event] = _listeners[event] || []).push(fn);
  },

  /**
   * Désabonne une fonction d'un événement.
   * @param {string} event - Nom de l'événement
   * @param {Function} fn - Même référence que celle passée à on()
   */
  off(event, fn) {
    if (_listeners[event]) {
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    }
  },

  /**
   * Émet un événement et notifie tous les abonnés.
   * @param {string} event - Nom de l'événement
   * @param {*} [data] - Données passées aux callbacks
   */
  emit(event, data) {
    (_listeners[event] || []).forEach(fn => {
      try { fn(data); } catch(e) { console.error('[bus] handler error', event, e); }
    });
  },

  /**
   * Abonne une fonction à un seul déclenchement (one-shot).
   * @param {string} event - Nom de l'événement
   * @param {Function} fn - Callback one-shot
   */
  once(event, fn) {
    const wrapper = (data) => { fn(data); this.off(event, wrapper); };
    this.on(event, wrapper);
  },
};

// Expose pour debug en dev/local uniquement (pas en prod)
if (
  typeof window !== 'undefined' &&
  window.location &&
  (() => { const h = window.location.hostname; return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local'); })()
) {
  window._kbus = bus;
}
