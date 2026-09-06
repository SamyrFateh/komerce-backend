/**
 * @komerce-arch
 * @role          boutique-b-bus
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       none
 * @used-by       public/boutique/js/b-cart-core.js, public/boutique/js/b-cart-pill.js, public/boutique/js/b-cart.js, public/boutique/js/b-catalog-desktop-enhancers.js, public/boutique/js/b-catalog.js, public/boutique/js/b-checkout.js, public/boutique/js/b-desktop-sidebar.js, public/boutique/js/group/group-side-cart.js, public/boutique/js/b-home-premium-v1.js, public/boutique/js/b-mini-cart.js, public/boutique/js/b-modal-core.js, public/boutique/js/b-modal-desktop-enhancers.js, public/boutique/js/b-modal-image-ux.js, public/boutique/js/b-modal-nav.js, public/boutique/js/b-modal-product.js, public/boutique/js/b-modal-suggestions.js, public/boutique/js/b-nav.js, public/boutique/js/b-notifications.js, public/boutique/js/b-pager.js, public/boutique/js/b-pdp-curation-suggestions.js, public/boutique/js/b-product-open-contract.js, public/boutique/js/b-store.js, public/boutique/js/b-subcat.js, public/boutique/js/boutique.js, public/boutique/js/main.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  boutique
 * @version       2026-09
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
 *   side-cart:render —                  — forcer un re-rendu du side-cart desktop [ARCH-1] ;
 *     couvre aussi la bascule desktop [Panier]/[Liste] (group-side-cart.js::setCartSurface(),
 *     amendement V2 §A), seule surface où ce sélecteur est atteignable (isDesktop())
 *   checkout:open    —                  — ouvrir la modale de commande [ARCH-1]
 *   view:changed     { view }           — notifier le changement effectif de vue aux enrichissements desktop
 *   chip:center      { chip }           — centrer chip active dans le pager [b-pager → b-catalog]
 *   catalog:cat-changed { cat }         — catégorie active changée [b-catalog → b-desktop-upgrade]
 *   favorites:view-refresh —               — rafraîchir la vue Favoris après mutation du catalogue
 *   discovery:request { kind, ref, source, requestedWindow } — agir sur une offre/service Discovery ; requestedWindow est facultatif ; catalog → providers-services
 *   modal:suggestions-rendered { product } — suggestions modal rendues, prêtes pour curation PDP
 *   carousel:changed { index }             — slide produit actif changé ; synchroniser l'UX image
 *   modal:detail-ready —                  — Product Detail Contract résolu ; réconcilier l'état panier modal
 *   nav:goto-track   —                  — ouvrir l'onglet Suivi depuis la confirmation de commande [b-checkout.js → b-nav.js, FIX 2026-07-11]
 *   checkout:order-failed { code, status } — fait : la commande vient d'échouer côté
 *     backend (code métier optionnel, ex. 'shared_cart_item_already_claimed'). Signal
 *     générique et neutre : b-checkout.js reste agnostique de la logique métier
 *     de la liste partagée (doctrine checkout_logic_agnostic_of_shared_list,
 *     group-checkout-adapter.js — seul lien métier réel : shared_cart_item_id
 *     pour le claim atomique) — à
 *     charge de l'écouteur de filtrer sur `code` s'il est concerné
 *     [b-checkout.js → group-side-cart.js, correctif V2-B.1 §5]
 *   komerce:show { focus } — ouvrir Mon Komerce après authentification ; focus=wallet depuis le checkout [b-checkout.js → b-nav.js/b-komerce.js, LOT4B]
 *   nav:goto-komerce-wallet — ouvrir Mon Komerce focalisé sur le wallet depuis le checkout [b-checkout.js → b-nav.js, LOT4B]
 *   modal:opened     { product }        — fait : la modal vient de s'ouvrir sur ce produit (≠ modal:open, qui est la commande d'ouverture)
 *   modal:discovery-opened { kind, ref, detail } — fait : le shell modal Komerce vient de s'ouvrir sur une offre/service Discovery
 *   modal:closed     —                  — fait : la modal vient de se fermer (≠ modal:close, qui est la commande de fermeture)
 *   modal:composition-synced —          — fait : la composition responsive de la modal ouverte vient d'être réconciliée après un resize
 *   cart-snapshot:render { context, items, actions } — rendre le snapshot liste
 *     partagée dans les surfaces canoniques (side cart + drawer) [group-side-cart.js
 *     → b-cart.js::renderCartSnapshot, correctif cycle d'import, point ouvert #2
 *     rapport clôture Lot D — remplace l'ancien import direct]
 *   cart-snapshot:cleanup —             — retirer les traces DOM du mode liste des
 *     surfaces canoniques [group-side-cart.js → b-cart.js::cleanupCartSnapshotDom,
 *     même correctif]
 *   cart-body:render-personal —         — pendant mobile de cart-snapshot:render :
 *     rappelle b-cart.js::renderCartBody() (#k-cart-body, drawer mobile) quand la
 *     surface repasse à 'personal' (tab "Mon panier", fermeture/annulation de
 *     liste). 'side-cart:render' seul ne couvre que renderSideCart() (#k-side-cart,
 *     desktop) — sans ce signal dédié le drawer mobile gardait les lignes de la
 *     liste affichées après la bascule [group-side-cart.js::setCartSurface()/
 *     clearSharedListContext() → b-cart.js::renderCartBody(), P0 audit terrain §2]
 *
 * Propriété des contrats (P3b, 2026-07) — owner = feature manifeste propriétaire du
 * contrat ; producer = seul module autorisé à émettre ; payload = arité attendue
 * (none = aucun argument, value = un argument). Toute émission hors du producer
 * déclaré, ou tout écart d'arité au call site, remonte en ATTENTION dans
 * gen-boutique-360.js. Ne couvre que les événements listés ici — les autres
 * événements actifs ci-dessus restent hors du périmètre de cette validation :
 *   modal:opened               owner=modal-product producer=b-modal-core.js payload=value
 *   modal:discovery-opened     owner=catalog producer=b-modal-core.js payload=value
 *   modal:closed                owner=modal-product producer=b-modal-core.js payload=none
 *   modal:composition-synced    owner=modal-product producer=b-modal-product-detail-bootstrap.js payload=none
 *   discovery:request           owner=catalog producer=discovery-actions.js payload=value
 *
 * Consommateurs déclarés (P3b) — tout écouteur observé hors de cette liste remonte
 * en ATTENTION comme consommateur non déclaré (un ajout légitime doit d'abord être
 * ajouté ici, pas seulement câblé) :
 *   modal:opened     : b-modal-product-detail-bootstrap.js, boutique.js, b-pdp-curation-suggestions.js, b-pager.js, b-modal-desktop-enhancers.js, spike-vertical-shell.js
 *   modal:discovery-opened : b-modal-discovery-detail.js
 *   modal:closed     : b-modal-product-detail-bootstrap.js, b-modal-discovery-detail.js, b-pager.js, group-side-cart.js, local-stock-badge-mount.js, spike-vertical-shell.js
 *   modal:composition-synced : b-modal-desktop-enhancers.js, b-modal-core.js, b-modal-suggestions.js
 *   discovery:request : discovery-inquiry.js
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
   * Désabonne une fonction à un événement.
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
   * Abonne une fonction à un seul déclenchement (one-shot)
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
