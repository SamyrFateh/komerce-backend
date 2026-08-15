/**
 * @komerce-arch
 * @role          product-modal-orchestrator
 * @domain        shared-cart-modal
 * @layer         ui-component
 * @criticality   high
 * @inputs        product_id, product_data, cart_state, modal_events
 * @outputs       product_detail_modal, add_to_cart_path, suggestions_slot, modal_lifecycle
 * @depends       b-store.js, b-cart.js, b-cart-core.js, b-modal-product.js, b-modal-suggestions.js, b-modal-nav.js, b-modal-cart.js, b-modal-image-ux.js
 * @used-by       b-modal.js, b-catalog.js, b-subcat.js, b-cart.js
 * @doctrine      participant_peut_verifier, boutique_preuve_confiance, modal_produit_sans_chevauchement
 * @impact-areas  product-discovery, participant-flow, creator-flow, modal-layout, cart, suggestions
 * @version       2026-06
 */
'use strict';

/**
 * @module b-modal-core
 * @brief Cycle open/close, state, overlay, body-lock, historique, setupModal
 *        — extrait de b-modal.js (ARCH-2, PR5 — extraction finale).
 *
 * Périmètre : tout ce qui constitue le cycle de vie de la modal produit :
 *   - openModal / closeModal : ouverture, rendu, overlay, body-lock, scroll.
 *   - modalGoBack : retour dans la pile d'historique modal.
 *   - setupModal : câblage complet (listeners, search inline, clavier,
 *     buyNowBtn, modalCartBtn, image-zone, …).
 *   - Gestion de l'historique navigateur (_modalHistoryPushed, _closingFromPopstate,
 *     _pendingHistoryBack, handler popstate) — flags mutables, intra-module, non exportables.
 *   - Image-zone : setupImageZoneDesktopClick, setupImageZoneTouch, openImageFullscreen.
 *   - Handlers bus modal:open / modal:close (openModal/closeModal accessibles
 *     directement ici, sans typeof-guard).
 *
 * Façade : b-modal.js est désormais une façade pure qui ré-exporte la surface
 *   publique inchangée (11 noms). Aucun consommateur externe n'a à changer.
 *
 * Acyclique : b-modal-core.js importe les 4 sous-modules ARCH-2 (product,
 *   suggestions, nav, cart) mais jamais b-modal.js → pas de cycle
 *   (garde-fou check:imports I-2).
 *
 * Dépendances : b-bus.js, b-store.js, b-utils.js, b-cart-core.js, b-cart.js,
 *   shop-schema.js, b-scroll-owner.js, b-modal-image-ux.js,
 *   b-modal-social-proof.js, b-modal-product.js, b-modal-suggestions.js,
 *   b-modal-nav.js, b-modal-cart.js.
 */

import { bus }           from './b-bus.js';
import {
  state, dom, $, $$,
}                         from './b-store.js';
import {
  sanitize, fmt, fmtPrice, optimizeImgUrl,
  renderProductCarousel, bindCarouselDots,
}                         from './b-utils.js';
import {
  showToast, updateCartBadge, saveCart, cartQty,
}                         from './b-cart-core.js';
import {
  quickAdd, quickRemove, toggleFav, setQty,
  openCart, closeCart, markAllCartButtons,
}                         from './b-cart.js';
import {
  normalizeCategoryKey, getCategorySectionEmoji,
}                         from './shop-schema.js';
import { isDesktop, getScrollY, scrollToPosition } from './b-scroll-owner.js';
import { setupImageUX }     from './b-modal-image-ux.js';
import { setupSocialProof } from './b-modal-social-proof.js';
import { paintProvisionalFields } from './b-modal-product-fields.js';
import {
  buildCarouselSlides, goToSlide, openSizeGuide, closeSizeGuide,
  _syncScrollPadding,
  setupModalFAB, hideModalFAB,
}                           from './b-modal-product.js';
import { renderSuggestions }                 from './b-modal-suggestions.js';
import { updateModalNavArrows, navigateModal } from './b-modal-nav.js';
import { _syncModalQtyUI, setupModalCart, resetAddCartButtonState }   from './b-modal-cart.js';

'use strict';

// Receive close-modal signal from external modules (b-cart, b-checkout, …)
bus.on('modal:close', function() { closeModal(); });

// Receive open-modal signal; relays pushHistory so navigateModal(false) is preserved
bus.on('modal:open', function({ id, pushHistory }) { openModal(String(id), pushHistory); });


  // ║  §9 · MODAL — Fiche produit, carousel, suggestions, subcat       ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-modal.js



  /**
   * @brief openModal — Ouvre la fiche produit (modal Shein-style)
   * Mémorise scrollY du catalogue pour restauration à la fermeture
   * Charge carousel images + suggestions + subcats filtrants
   * @param {string|number} id - ID du produit
   * @param {boolean} [pushHistory] - Pousser dans l'historique navigateur (retour natif)
   */


  /**
   * RANK-01 — Appelle GET /api/boutique/suggestions et délègue l'affichage
   * à renderSuggestions (surface passive). Fallback local si réseau KO.
   * @param {Object} product - Produit actif (modalProduct)
   */
  function _fetchAndRenderSuggestions(product) {
    // Construction des signaux disponibles
    const params = new URLSearchParams({ limit: '20' });
    if (product.id)       params.set('viewed_product_id', String(product.id));
    if (product.category) params.set('category', product.category);
    if (product.subcategory) params.set('subcategory', product.subcategory);

    // Signal panier
    const cartIds = (state.cart || []).map(i => String(i.product?.id ?? i.id)).filter(Boolean);
    if (cartIds.length) params.set('cart_product_ids', cartIds.join(','));

    // Signal historique produits vus
    const viewed = (state.viewedHistory || []).filter(id => String(id) !== String(product.id));
    if (viewed.length) params.set('recently_viewed', viewed.slice(-10).join(','));

    fetch('/api/boutique/suggestions?' + params.toString(), { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(payload => {
        // FIX : la route renvoie un OBJET { count, suggestions, ... }, pas un tableau.
        // items.filter() levait une TypeError -> catch -> fallback systématique.
        const items = Array.isArray(payload) ? payload : (payload && payload.suggestions) || [];
        if (!items.length) throw new Error('empty-suggestions');
        // Reconstruire sameCat / otherCat depuis la réponse enrichie (reason_label inclus)
        const sameCat = items
          .filter(s => s.category === product.category)
          .map(s => Object.assign({}, state.products.find(p => String(p.id) === String(s.product_id)) || {}, s))
          .filter(p => p.id);
        const otherCat = items
          .filter(s => s.category !== product.category)
          .map(s => Object.assign({}, state.products.find(p => String(p.id) === String(s.product_id)) || {}, s))
          .filter(p => p.id);
        renderSuggestions(sameCat, otherCat, product.category);
      })
      .catch(() => {
        // Fallback éditorial si API indisponible — pas de Math.random()
        const sameCat = state.products
          .filter(p => p.category === product.category && p.id !== product.id)
          .slice(0, 20);
        const otherCat = state.products
          .filter(p => p.category !== product.category && p.id !== product.id)
          .slice(0, 16);
        renderSuggestions(sameCat, otherCat, product.category);
      });
  }

  /* ── FIX: Back button = fermer modal au lieu de quitter le site ── */
  let _modalHistoryPushed = false;
  // BUG-02 — garde contre la boucle popstate → closeModal → history.back() → popstate
  // Sur Chrome Android / Samsung Internet, history.back() peut déclencher popstate
  // de façon synchrone dans la même pile, rappelant closeModal() une seconde fois
  // (double scroll-restore, saut visuel). Le flag _closingFromPopstate coupe court.
  let _closingFromPopstate = false;
  // BUG-03 — race condition mobile : ré-ouverture rapide après fermeture
  // Scénario : closeModal() appelle history.back() [asynchrone]. Si l'utilisateur
  // retouche un produit avant que le popstate arrive, openModal() a déjà posé un
  // nouveau pushState + _modalHistoryPushed=true. Quand le popstate "retardé" de
  // la fermeture précédente arrive, la modal est à nouveau open → closeModal() la
  // ferme immédiatement. Sur mobile le délai est variable (50–300ms) selon le
  // thread de navigation → le bug est intermittent mais fréquent.
  //
  // Solution : _pendingHistoryBack est posé juste avant history.back() programmatique
  // (dans closeModal). Dans le popstate handler :
  //   - _pendingHistoryBack=true  + _modalHistoryPushed=true
  //     => une nouvelle modal a rouvert entre le back() et ce popstate => ignorer
  //   - _pendingHistoryBack=false (bouton retour physique de l'utilisateur)
  //     => fermer normalement
  let _pendingHistoryBack = false;
  window.addEventListener('popstate', (e) => {
    if (_closingFromPopstate) return;
    // Popstate entrant vers un etat kModal (navigation avant, pas retour) => ignorer.
    if (e.state && e.state.kModal) return;
    // Popstate cause par notre history.back() ET une nouvelle modal entre-temps => ignorer.
    if (_pendingHistoryBack && _modalHistoryPushed) {
      _pendingHistoryBack = false;
      return;
    }
    _pendingHistoryBack = false;
    if (dom.modalOverlay && dom.modalOverlay.classList.contains('open')) {
      _closingFromPopstate = true;
      _modalHistoryPushed = false;
      closeModal();
      _closingFromPopstate = false;
    }
  });


    function openModal(id, pushHistory) {
    const product = state.products.find(p => String(p.id) === String(id));
    if (!product) return;

    // Mémoriser la position de scroll du catalogue pour y revenir à la fermeture
    if (!dom.modalOverlay.classList.contains('open')) {
      state._savedCatalogScrollY = getScrollY();
      // FIX: Push history state so browser back button closes modal
      if (!_modalHistoryPushed) {
        history.pushState({ kModal: true }, '');
        _modalHistoryPushed = true;
      }
    }

    if (pushHistory !== false && state.modalProduct) {
      state.modalHistory.push(state.modalProduct.id);
    }

    state.modalProduct = product;

    // FIX: Stepper = panier direct. Affiche la quantité déjà dans le panier.
    const _cartItem = state.cart.find(i => String(i.product?.id ?? i.id) === String(product.id));
    state.modalQty = _cartItem ? _cartItem.qty : 1; /* BUGFIX: défaut 1 → cohérent avec _syncModalQtyUI */

    // MDP-PROP1 : reset état bouton "Ajouter" — owner b-modal-cart.js
    resetAddCartButtonState();
    // Sync stepper display with cart qty
    _syncModalQtyUI();

    buildCarouselSlides(product);

    // PDC-6 : le fetch legacy /api/products/:id + _renderVariants est supprimé.
    // La vérité variantes/disponibilité vient désormais exclusivement du
    // Product Detail Contract (b-modal-product-detail-bootstrap.js) via
    // state.modalSelection. #k-modal-variants reste nettoyé à l'ouverture par
    // hygiène générique (ancien conteneur DOM), sans lien avec ce fetch.
    // MDP-PROP1 : le clear de #k-modal-variants est déjà fait par les renderers PDC
    // (b-modal-desktop-product.js / b-modal-mobile-product.js) — ne plus le dupliquer ici.
    state.modalVariantCombo = {}; // Lot 2 — reset à chaque ouverture (couture de transport, cf. étape 7)

    // MDP-PROP1 : contenu produit scalaire délégué à l'owner unique
    // (b-modal-product-fields.js). Voir gate scripts/audit-modal-ownership.js.
    paintProvisionalFields(product);
    // MDP-PROP1 : #k-modal-qty-val — écriture conservée ICI (pas seulement dans
    // _syncModalQtyUI). Tenté en suppression pure (redondance apparente avec
    // _syncModalQtyUI, appelée juste au-dessus) : casse tests/unit/b-modal-core.test.js
    // (2 tests), qui mocke intégralement b-modal-cart.js — _syncModalQtyUI y est un
    // no-op, donc cette ligne est la seule à renseigner #k-modal-qty-val dans ce test.
    // Redondant en prod, nécessaire en isolation testée : on garde les deux écritures.
    if (dom.modalQtyVal) dom.modalQtyVal.textContent = state.modalQty;

    // FIX #1 — Bouton favori dans la modal (concern favoris, hors contenu produit)
    const modalFavBtn = document.getElementById('k-modal-fav-btn');
    if (modalFavBtn) {
      const favState = state.favs.includes(product.id);
      modalFavBtn.classList.toggle('liked', favState);
      modalFavBtn.innerHTML = favState ? '❤️' : '🤍';
      modalFavBtn.setAttribute('aria-pressed', String(favState));
      modalFavBtn.setAttribute('aria-label', favState ? 'Retirer des favoris' : 'Ajouter aux favoris');
    }

    dom.modalBackLabel.textContent = state.modalHistory.length > 0 ? 'Retour' : 'Catalogue';
    updateCartBadge();

    // Compteur de position dans la liste + boutons ← →
    const list = state.filtered.length ? state.filtered : state.products;
    const currentIdx = list.findIndex(p => p.id === product.id);
    updateModalNavArrows(list, currentIdx);

    // RANK-01 : appel API ranking — surface passive, pas de tri local
    state.modalSubcatFilter = null; // Reset subcategory filter for new product
    _fetchAndRenderSuggestions(product);

    dom.modalOverlay.classList.add('open');

    // FIX SCROLL-TO-TOP : scrollTop = 0 doit être posé APRÈS classList.add('open').
    // Quand l'overlay est display:none (fermé), le browser ignore scrollTop sur les
    // éléments descendants — la valeur ne s'applique pas sur un noeud non-rendu.
    // On reset donc APRÈS que l'overlay soit display:flex, dans un rAF pour laisser
    // le browser calculer le reflow. Belt+suspenders : on tente aussi avant pour
    // les cas où le modal était déjà ouvert (navigation suggestion → suggestion).
    if (dom.modalDetails) dom.modalDetails.scrollTop = 0;
    const _scrollEl = document.querySelector('.k-modal-scroll');
    if (_scrollEl) _scrollEl.scrollTop = 0;
    requestAnimationFrame(function() {
      if (dom.modalDetails) dom.modalDetails.scrollTop = 0;
      let _sEl = dom.modal && dom.modal.querySelector('.k-modal-scroll');
      if (_sEl) _sEl.scrollTop = 0;
    });

    // PR-D 2.3 : historique des produits vus (persisté localStorage).
    // On retire d'abord toute occurrence de l'id courant (déduplication),
    // puis on push à la fin pour que "le plus récent" reste en queue.
    // Limité à 30 entrées pour éviter l'inflation localStorage.
    try {
      let vh = state.viewedHistory.filter(function(x) { return x !== product.id; });
      vh.push(product.id);
      if (vh.length > 30) vh = vh.slice(-30);
      state.viewedHistory = vh;
      localStorage.setItem('k_viewed_history', JSON.stringify(vh));
    } catch (_) { /* localStorage indispo : ignoré */ }

    // FIX scroll auto post-modal : la garde state.modalOpen dans b-pager.js
    // n'avait jamais été posée. On l'écrit AVANT d'émettre le bus pour que
    // tout listener qui purgerait les timers le voie déjà à true.
    state.modalOpen = true;

    // LOT 12: notify desktop-upgrade module
    bus.emit('modal:opened', product);
    // PR-3 / PR-4 — modules image UX + social proof
    setupImageUX();
    setupSocialProof();
    // PDC-6 : l'encart livraison n'est plus injecté ici en dur depuis
    // product.delivery_delay. Les options de livraison viennent désormais
    // exclusivement du contrat détail (delivery_options), rendues par le
    // renderer PDC après le fetch /detail.
    // Lock body scroll — CSS handles layout via body.modal-open
    state._savedCatalogScrollY = getScrollY();
    document.body.style.setProperty('--modal-scroll-y', `-${state._savedCatalogScrollY}px`);
    document.body.classList.add('modal-open');
    // Signaler au CSS si le side-cart est visible (pour ajuster la largeur de la modal)
    if (document.getElementById('k-side-cart')?.classList.contains('has-items')) {
      document.body.classList.add('modal-has-cart');
    }

    // REFONTE COQUE DESKTOP — reparentage #k-side-cart dans .k-modal-cart-slot.
    // Pas de clone : le même noeud DOM change de parent, ses listeners
    // (délégation sur #k-sc-items + IDs individuels) survivent intacts.
    // Restauré à sa position d'origine dans closeModal() / au passage mobile
    // (reconcileComposition / resize) — voir _cartHome ci-dessous.
    mountSideCartInModal();

    // LOT 3 : (re)synchroniser .k-modal-actions avec le viewport courant à
    // chaque ouverture — même raison que mountSideCartInModal ci-dessus.
    reconcileActionsComposition();

    // MOBILE SCROLL FIX — neutralise les styles inline posés par le pager
    // (#k-page-scroll.k-pager-active = position:fixed + overflow:hidden crée un
    // stacking context sur Chrome Android qui bride le scroll de .k-modal-scroll).
    // On garde la classe k-pager-active intacte (état logique) mais on efface
    // les propriétés physiques bloquantes pour la durée de la modal.
    if (window.innerWidth < 900) {
      let _ps = dom.pageScroll;
      if (_ps) {
        state._savedPagerInlineStyles = {
          position:  _ps.style.position,
          top:       _ps.style.top,
          left:      _ps.style.left,
          right:     _ps.style.right,
          bottom:    _ps.style.bottom,
          width:     _ps.style.width,
          height:    _ps.style.height,
          overflow:  _ps.style.overflow,
          overflowX: _ps.style.overflowX,
          overflowY: _ps.style.overflowY,
        };
        _ps.style.position  = '';
        _ps.style.top       = '';
        _ps.style.left      = '';
        _ps.style.right     = '';
        _ps.style.bottom    = '';
        _ps.style.width     = '';
        _ps.style.height    = '';
        _ps.style.overflow  = '';
        _ps.style.overflowX = '';
        _ps.style.overflowY = '';
      }
    }

    // VIS-6 — voir docs/BOUTIQUE_VISUAL_FIXES.md. Figer scrollLeft du grid pendant la modal.
    // Le grid #k-grid.k-grid-flat-subcat est un container overflow-x:auto +
    // scroll-snap dont le scrollLeft persiste. Si la modal laisse passer
    // un pixel à droite (Samsung Edge Panels / 100vw < viewport visuel),
    // on voit la page 2 du pager horizontal en arrière-plan. On le ramène
    // à 0 pour la durée de la modal, on restaure dans closeModal.
    if (window.innerWidth < 900) {
      let _grid = document.getElementById('k-grid');
      if (_grid && _grid.classList.contains('k-grid-flat-subcat')) {
        state._savedGridScrollLeft = _grid.scrollLeft;
        _grid.style.scrollSnapType = 'none'; // évite l'animation de snap visible
        _grid.scrollLeft = 0;
      }
    }

    // Les actions restent hors du scroll : bouton Acheter toujours visible.
    // La topbar enrichie rappelle le produit ouvert pendant le scroll.
    _syncScrollPadding();
    setupModalFAB();
  }





  /**
   * Retour arrière dans l'historique modal (produit précédent dans la pile).
   * Utilisé par le bouton ← dans le topbar modal.
   */
  function modalGoBack() {
    if (state.modalHistory.length === 0) { closeModal(); return; }
    const prevId = state.modalHistory.pop();
    openModal(prevId, false);
  }

  /**
   * @brief closeModal — Ferme la fiche produit et restaure l'état catalogue
   * Restaure le scroll Y du catalogue sauvegardé dans state._savedCatalogScrollY
   * Reset les subcats modal + suggestions
   */
    function closeModal(options) {
    const skipHistoryBack = Boolean(options && options.skipHistoryBack);
    hideModalFAB();
    // FIX: Pop history entry if we pushed one (don't pop if back button already did)
    // BUG-02 — si on est déjà dans le handler popstate (_closingFromPopstate), ne pas
    // rappeler history.back() : c'est le popstate lui-même qui a déjà consommé l'entrée.
    if (_modalHistoryPushed && !_closingFromPopstate) {
      _modalHistoryPushed = false;
      // BUG-04 — clic sur le panier depuis la modal : on ferme la fiche produit
      // pour enchaîner sur l'ouverture du panier (setTimeout(openCart, 150)),
      // ce n'est PAS un retour arrière voulu par l'utilisateur. Appeler
      // history.back() ici déclenche une vraie navigation d'historique : sur
      // certains navigateurs/mobiles ça restaure la page depuis le bfcache
      // (ou force un reload), ce qui tue le setTimeout en cours et l'utilisateur
      // atterrit sur le catalogue (« page d'accueil ») sans jamais voir le
      // panier s'ouvrir. Dans ce cas précis on se contente de neutraliser
      // l'entrée d'historique kModal via replaceState (même URL, pas de
      // navigation), pour laisser le flux JS (openCart) se dérouler normalement.
      if (skipHistoryBack) {
        try { history.replaceState({}, ''); } catch (_) {}
      } else {
        _pendingHistoryBack = true; // BUG-03 : signale au handler popstate que ce back() est programmatique
        history.back();
      }
    } else {
      _modalHistoryPushed = false;
    }
    dom.modalOverlay.classList.remove('open');
    // Unlock body scroll — CSS class drives layout
    const scrollY = state._savedCatalogScrollY || 0;
    document.body.classList.remove('modal-open');
    document.body.classList.remove('modal-has-cart');
    document.body.style.removeProperty('--modal-scroll-y');

    restoreSideCartHome();

    // LOT 3 : restaurer .k-modal-actions à sa home canonique (.k-modal-configurator)
    // si elle avait été montée en enfant direct de #k-modal côté mobile —
    // sans ça, une réouverture desktop ultérieure la retrouverait au mauvais endroit.
    restoreActionsHome();

    // MOBILE SCROLL FIX — restaurer les styles inline du pager
    if (window.innerWidth < 900 && state._savedPagerInlineStyles) {
      let _ps = dom.pageScroll;
      if (_ps) {
        let s = state._savedPagerInlineStyles;
        _ps.style.position  = s.position  || '';
        _ps.style.top       = s.top       || '';
        _ps.style.left      = s.left      || '';
        _ps.style.right     = s.right     || '';
        _ps.style.bottom    = s.bottom    || '';
        _ps.style.width     = s.width     || '';
        _ps.style.height    = s.height    || '';
        _ps.style.overflow  = s.overflow  || '';
        _ps.style.overflowX = s.overflowX || '';
        _ps.style.overflowY = s.overflowY || '';
      }
      state._savedPagerInlineStyles = null;
    }

    // VIS-6 — restaurer le scrollLeft du grid (voir docs/BOUTIQUE_VISUAL_FIXES.md).
    // rAF : on laisse le browser repeindre l'overlay disparu AVANT de scroller,
    // sinon flash visuel du décalage.
    if (window.innerWidth < 900 && typeof state._savedGridScrollLeft === 'number') {
      let _gridRestore = document.getElementById('k-grid');
      if (_gridRestore && _gridRestore.classList.contains('k-grid-flat-subcat')) {
        let _restoreLeft = state._savedGridScrollLeft;
        requestAnimationFrame(function() {
          _gridRestore.scrollLeft = _restoreLeft;
          _gridRestore.style.scrollSnapType = '';
        });
      }
      state._savedGridScrollLeft = null;
    }

    // FIX scroll auto post-modal : on ferme le flag AVANT le window.scrollTo
    // qui va déclencher un événement scroll sur la page interne du pager.
    // Sans ça, le bounce vertical s'arme à la frame suivante alors que
    // l'utilisateur n'a rien fait → page suivante en horizontal.
    state.modalOpen = false;
    // Notifier le pager pour qu'il purge ses timers de bounce en cours
    // (un setTimeout(_, 350) peut être armé juste avant l'ouverture).
    bus.emit('modal:closed');

    scrollToPosition(scrollY);
    state.modalProduct = null;
    state.modalHistory = [];
    // Réinitialiser le choix de livraison — ne pas conserver entre deux produits
    state.modalDeliverySelection = { requested_transport_rail: null };
  }


  // FIX ARCHITECTURE v5: extraire .k-modal-actions du flux scrollable
  // Sur mobile, position:fixed sur .k-modal-actions cause un bug subtil:
  // l'animation k-slide-up (transform) sur .k-modal cree un containing block
  // pour ses enfants position:fixed => ils sont positionnes par rapport a
  // .k-modal en cours de transformation, pas le viewport.
  // + offsetHeight peut valoir 0 pendant l'animation => padding compensatoire
  // faux => scroll sous la CTA.
  // Solution: deplacer .k-modal-actions en enfant flex direct de #k-modal
  // (display:flex flex-direction:column). Flex l'ancre en bas sans position:fixed.
  //
  // [MDM-8 phase 2] Auparavant exécuté une seule fois au DOMContentLoaded,
  // figé sur window.innerWidth *à cet instant précis* : un chargement en
  // largeur desktop suivi d'un resize/rotation vers mobile (ou l'inverse)
  // laissait .k-modal-actions dans le mauvais parent, avec --k-modal-cta-h
  // désynchronisé. Extrait en fonction idempotente, appelée à l'ouverture
  // ET rebranchée sur le même signal de resize que le reste du PDC
  // (bus 'modal:composition-synced', émis par
  // b-modal-product-detail-bootstrap.js::syncResponsiveComposition) plutôt
  // que de dupliquer un second listener resize/debounce.
  // _actionsHome mémorise la position d'origine desktop (.k-modal-configurator,
  // via parent + nextSibling) pour un reparentage réversible sans clone —
  // même doctrine que _cartHome ci-dessous pour #k-side-cart. Corrige un
  // trou fonctionnel réel (LOT 3) : .k-modal-actions restait piégé en enfant
  // direct de #k-modal après un premier passage mobile, jamais restauré au
  // retour desktop ni à la fermeture — le fichier qui était censé porter ce
  // retour (b-modal-approche-c-hybrid.js::restoreActionsHome) a été supprimé
  // lors d'un nettoyage antérieur sans que sa doctrine soit reportée ici.
  let _actionsHome = null;

  function mountActionsInMobileShell() {
    if (!dom.modal) return;
    const act = dom.modal.querySelector('.k-modal-actions');
    if (!act || isDesktop() || act.parentNode === dom.modal) return;
    _actionsHome = { parent: act.parentNode, nextSibling: act.nextSibling };
    dom.modal.appendChild(act);
    // --k-modal-cta-h dépend de act.parentNode (isStatic) : la resynchroniser
    // à chaque reparentage, pas seulement au ResizeObserver de hauteur.
    _syncScrollPadding();
  }

  function restoreActionsHome() {
    if (!dom.modal) return;
    const act = dom.modal.querySelector('.k-modal-actions');
    if (!act || act.parentNode !== dom.modal) return;
    if (_actionsHome && _actionsHome.nextSibling && _actionsHome.nextSibling.parentNode === _actionsHome.parent) {
      _actionsHome.parent.insertBefore(act, _actionsHome.nextSibling);
    } else if (_actionsHome) {
      _actionsHome.parent.appendChild(act);
    } else {
      // Pas de home mémorisée (ex. setup initial déjà desktop) : home
      // canonique connue = .k-modal-configurator.
      const canonicalHome = dom.modal.querySelector('.k-modal-configurator');
      if (canonicalHome) canonicalHome.appendChild(act);
    }
    _actionsHome = null;
    _syncScrollPadding();
  }

  // Switch desktop↔mobile pendant que la modale reste ouverte (resize/rotation),
  // et montage initial (setupModal) : idempotent, ne déplace rien si la
  // composition est déjà correcte pour le viewport courant.
  function reconcileActionsComposition() {
    if (!dom.modalOverlay.classList.contains('open')) return;
    if (isDesktop()) {
      restoreActionsHome();
    } else {
      mountActionsInMobileShell();
    }
  }

  bus.on('modal:composition-synced', reconcileActionsComposition);

  // ── REFONTE COQUE DESKTOP — reparentage #k-side-cart ────────────────────
  // _cartHome mémorise la position d'origine (parent + nextSibling) pour un
  // reparentage réversible, sans clone. Idempotent : appelable plusieurs
  // fois sans effet si déjà dans le bon état (même doctrine que
  // reorderActionsForViewport/restoreActionsHome ci-dessus/dans le hybrid).
  let _cartHome = null;

  function mountSideCartInModal() {
    if (!isDesktop()) return;
    const cart = document.getElementById('k-side-cart');
    const slot = document.getElementById('k-modal-cart-slot');
    if (!cart || !slot || cart.parentNode === slot) return;
    _cartHome = { parent: cart.parentNode, nextSibling: cart.nextSibling };
    slot.appendChild(cart);
    cart.classList.add('k-side-cart--in-modal');
    // Le panier standalone vide n'a volontairement aucun contenu. Une fois
    // monté dans la fiche produit il devient toutefois une colonne visible :
    // demander au renderer canonique de produire son état vide utile.
    bus.emit('side-cart:render');
  }

  function restoreSideCartHome() {
    const cart = document.getElementById('k-side-cart');
    if (!cart) return;
    cart.classList.remove('k-side-cart--in-modal');
    if (!_cartHome || cart.parentNode !== document.getElementById('k-modal-cart-slot')) return;
    if (_cartHome.nextSibling && _cartHome.nextSibling.parentNode === _cartHome.parent) {
      _cartHome.parent.insertBefore(cart, _cartHome.nextSibling);
    } else {
      _cartHome.parent.appendChild(cart);
    }
    _cartHome = null;
  }

  // Switch desktop↔mobile pendant que la modale reste ouverte (resize/rotation) :
  // même signal que reorderActionsForViewport, cohérent avec le reste du PDC.
  function reconcileSideCartComposition() {
    if (!dom.modalOverlay.classList.contains('open')) return;
    if (isDesktop()) {
      mountSideCartInModal();
    } else {
      restoreSideCartHome();
    }
  }

  bus.on('modal:composition-synced', reconcileSideCartComposition);

  /**
   * Initialise le modal produit complet (carousel, topbar, suggestions, swipe).
   * Point d'entrée appelé une seule fois au DOMContentLoaded.
   * Doctrine : structure HTML + CSS, JS = comportements uniquement.
   */
  function setupModal() {

    mountActionsInMobileShell();

    dom.modalBack.addEventListener('click', modalGoBack);
    dom.modalClose.addEventListener('click', closeModal);
    dom.modalCartBtn.addEventListener('click', () => {
      // Même contrat que l'avatar panier du header : sur desktop, le panier
      // résident est déjà visible et le raccourci utile est le récapitulatif
      // canonique du checkout. checkoutCart (listener checkout:open) garde la
      // fiche ouverte si le panier est vide, sinon il la ferme et ouvre le récap.
      if (isDesktop()) {
        bus.emit('checkout:open');
        return;
      }

      // Mobile : comportement canonique inchangé.
      // On neutralise l'entrée d'historique modal sans navigation puis
      // on ouvre le drawer panier.
      closeModal({ skipHistoryBack: true });
      setTimeout(openCart, 150);
    });
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) closeModal();
    });

    setupModalCart();

    // ── FIX #1 : Bouton favori dans la modal ──
    const modalFavBtn = document.getElementById('k-modal-fav-btn');
    if (modalFavBtn) {
      modalFavBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.modalProduct) return;
        toggleFav(state.modalProduct.id, modalFavBtn);
        // Aussi mettre à jour le cœur sur la carte grille correspondante
        const gridFavBtn = dom.grid
          ? dom.grid.querySelector(`.k-card-fav[data-fav="${state.modalProduct.id}"]`)
          : null;
        if (gridFavBtn) {
          const isNowFav = state.favs.includes(state.modalProduct.id);
          gridFavBtn.classList.toggle('liked', isNowFav);
          gridFavBtn.innerHTML = isNowFav ? '❤️' : '🤍';
          gridFavBtn.setAttribute('aria-pressed', String(isNowFav));
          gridFavBtn.setAttribute('aria-label', isNowFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
        }
      });
    }

    // ── FIX #3 : Bloquer scroll passthrough sur la barre d'actions ──
    // passive:false + preventDefault() empêche le browser de scroller
    // quand le doigt touche la barre sticky Ajouter/Acheter.
    const actionsBar = dom.modal.querySelector('.k-modal-actions');
    if (actionsBar) {
      actionsBar.addEventListener('touchmove', (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    }

    // MDP-PROP1 : le câblage du bouton "⚡ Acheter" (#k-buy-now-btn) est
    // désormais dans b-modal-buybox-shared.js (`wireBuyNowButton`, appelé
    // depuis `renderActions()` des deux renderers PDC) — core ne gère plus
    // que le cycle de vie de la modale.

    // ── Image zone: carousel swipe + pull-to-close (Temu-style)
    setupImageZoneTouch();

    // ── Image zone desktop : click gauche/droite pour naviguer dans le carousel
    setupImageZoneDesktopClick();

    // ── Navigation clavier ← → entre produits (desktop)
    // Hint visuel injecté une seule fois dans la topbar
    (function setupKeyboardNavHint() {
      if (window.innerWidth < 900) return;
      if (document.getElementById('k-modal-keyboard-hint')) return;
      let topbar = dom.modal ? dom.modal.querySelector('.k-modal-topbar') : null;
      if (!topbar) return;
      let hint = document.createElement('div');
      hint.id = 'k-modal-keyboard-hint';
      hint.className = 'k-modal-keyboard-hint';
      hint.innerHTML =
        '<kbd>←</kbd><span>produit précédent</span>' +
        '<kbd>→</kbd><span>produit suivant</span>';
      let right = topbar.querySelector('.k-modal-topbar-right');
      if (right) topbar.insertBefore(hint, right);
      else topbar.appendChild(hint);
    })();

    document.addEventListener('keydown', (e) => {
      if (!dom.modalOverlay.classList.contains('open')) return;
      if (e.key === 'ArrowRight') navigateModal(1);
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'Escape') closeModal();
    });
  }

  /**
   * Desktop uniquement : zones cliquables gauche/droite sur l'image du modal
   * pour naviguer dans le carousel sans devoir viser une miniature précise.
   * Reste discret (cursor change, pas de bouton visible) pour ne pas casser
   * le zoom-on-hover existant.
   */
  function _isImageZoneInteractiveTarget(target) {
    return Boolean(
      target &&
      typeof target.closest === 'function' &&
      target.closest(
        '.k-modal-view-full, button, a, input, select, textarea, [role="button"]'
      )
    );
  }

  function setupImageZoneDesktopClick() {
    let imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    if (!imgWrap) return;
    imgWrap.addEventListener('click', function(e) {
      if (_isImageZoneInteractiveTarget(e.target)) return;
      if (window.innerWidth < 900) return;
      if (state.carouselCount <= 1) return;
      // Évite de tirer si le click est sur une miniature ou sur le zoom preview
      if (e.target.closest('.k-modal-thumb, .k-modal-zoom-preview, .k-modal-zoom-lens')) return;
      let rect = imgWrap.getBoundingClientRect();
      let clickedLeft = (e.clientX - rect.left) < rect.width / 2;
      if (clickedLeft && state.carouselIndex > 0) {
        goToSlide(state.carouselIndex - 1);
      } else if (!clickedLeft && state.carouselIndex < state.carouselCount - 1) {
        goToSlide(state.carouselIndex + 1);
      }
    });
  }

  // ── Image zone: swipe ↔ carousel + swipe ↓ close (Temu-style) ──
  // Details zone: native ↕ scroll only — no gesture interference
  /**
   * Active le swipe ↔ sur la zone image du modal (carousel).
   * scroll-snap-type: x mandatory sur .k-card-carousel.
   * @param {HTMLElement} carousel - Élément carousel
   */
  function setupImageZoneTouch() {
    let imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    let track = dom.modalCarouselTrack;
    let modal = dom.modal;
    let startX, startY, isDragging, direction; // 'h' | 'v' | null

    imgWrap.addEventListener('touchstart', function(e) {
      if (_isImageZoneInteractiveTarget(e.target)) {
        isDragging = false;
        direction = null;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
      direction = null;
    }, { passive: true });

    imgWrap.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      let dx = e.touches[0].clientX - startX;
      let dy = e.touches[0].clientY - startY;

      // Lock direction on first 8px movement
      if (!direction && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        direction = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }

      // Horizontal → carousel (only if multi-image)
      if (direction === 'h' && state.carouselCount > 1) {
        e.preventDefault();
        track.style.transition = 'none';
        let offset = -state.carouselIndex * 100 + (dx / imgWrap.offsetWidth) * 100;
        track.style.transform = 'translateX(' + offset + '%)';
      }
      // Vertical down → pull-to-close
      else if (direction === 'v' && dy > 0) {
        modal.style.transform = 'translateY(' + (dy * 0.4) + 'px)';
        modal.style.transition = 'none';
        modal.style.opacity = String(Math.max(0.6, 1 - dy / 500));
      }
    }, { passive: false });

    imgWrap.addEventListener('touchend', function(e) {
      if (_isImageZoneInteractiveTarget(e.target)) {
        isDragging = false;
        direction = null;
        return;
      }
      if (!isDragging) return;
      isDragging = false;
      let dx = e.changedTouches[0].clientX - startX;
      let dy = e.changedTouches[0].clientY - startY;

      if (direction === 'h' && state.carouselCount > 1) {
        // Carousel snap
        if (dx < -40 && state.carouselIndex < state.carouselCount - 1) {
          goToSlide(state.carouselIndex + 1);
        } else if (dx > 40 && state.carouselIndex > 0) {
          goToSlide(state.carouselIndex - 1);
        } else {
          goToSlide(state.carouselIndex); // snap back
        }
      } else if (direction === 'v') {
        modal.style.transition = 'transform .25s var(--ease), opacity .25s';
        modal.style.opacity = '';
        if (dy > 100) {
          modal.style.transform = 'translateY(100%)';
          setTimeout(function() { modal.style.transform = ''; closeModal(); }, 260);
        } else {
          modal.style.transform = '';
        }
      } else if (direction === null) {
        // TAP court (pas de mouvement significatif) → fullscreen image avec pinch-zoom natif
        openImageFullscreen(state.carouselIndex);
      }
    });
  }

  /**
   * Ouvre une image en plein écran (mobile).
   * Le navigateur gère nativement le pinch-to-zoom grâce à touch-action.
   * Tap simple ou bouton retour ferme le fullscreen.
   * @param {number} startIndex - Index de l'image à afficher en premier
   */
  function openImageFullscreen(startIndex) {
    if (!state.modalProduct) return;
    let images = state.modalProduct.images || [state.modalProduct.image_url];
    images = images.filter(Boolean);
    if (!images.length) return;

    // Réutilise un overlay existant si présent
    let overlay = document.getElementById('k-modal-fullscreen');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'k-modal-fullscreen';
    overlay.className = 'k-modal-fullscreen';
    overlay.innerHTML =
      '<button class="k-modal-fullscreen-close" aria-label="Fermer">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '<div class="k-modal-fullscreen-counter"></div>' +
      '<div class="k-modal-fullscreen-track">' +
        images.map(function(url) {
          return '<div class="k-modal-fullscreen-slide"><img src="' +
            optimizeImgUrl(url, 1600) + '" alt="" draggable="false"></div>';
        }).join('') +
      '</div>';

    document.body.appendChild(overlay);

    let track = overlay.querySelector('.k-modal-fullscreen-track');
    let counter = overlay.querySelector('.k-modal-fullscreen-counter');
    let idx = Math.max(0, Math.min(startIndex || 0, images.length - 1));

    function updateCounter() {
      counter.textContent = (idx + 1) + ' / ' + images.length;
      counter.style.display = images.length > 1 ? 'block' : 'none';
    }
    function snapTo(i) {
      idx = Math.max(0, Math.min(i, images.length - 1));
      track.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)';
      track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      updateCounter();
    }
    snapTo(idx);
    track.style.transition = 'none'; // pas d'anim sur l'ouverture initiale
    track.style.transform = 'translateX(-' + (idx * 100) + '%)';
    setTimeout(function() { updateCounter(); }, 0);

    // Ouverture animée
    requestAnimationFrame(function() { overlay.classList.add('is-open'); });

    // Fermeture
    function close() {
      overlay.classList.remove('is-open');
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
    }
    overlay.querySelector('.k-modal-fullscreen-close').addEventListener('click', close);

    // Swipe horizontal sur fullscreen pour changer d'image (sans bloquer le pinch-zoom)
    let fsStartX = null, fsMoved = false, fsLocked = null;
    track.addEventListener('touchstart', function(e) {
      // Si plus d'un doigt = pinch-zoom, on n'intercepte rien
      if (e.touches.length !== 1) { fsStartX = null; return; }
      fsStartX = e.touches[0].clientX;
      fsMoved = false;
      fsLocked = null;
    }, { passive: true });
    track.addEventListener('touchmove', function(e) {
      if (fsStartX == null || e.touches.length !== 1) return;
      let dx = e.touches[0].clientX - fsStartX;
      if (Math.abs(dx) > 6) fsMoved = true;
    }, { passive: true });
    track.addEventListener('touchend', function(e) {
      if (fsStartX == null) { fsStartX = null; return; }
      let dx = (e.changedTouches[0] || {}).clientX != null
        ? e.changedTouches[0].clientX - fsStartX : 0;
      if (!fsMoved) {
        // tap simple → ferme
        close();
      } else if (images.length > 1) {
        if (dx < -50) snapTo(idx + 1);
        else if (dx > 50) snapTo(idx - 1);
      }
      fsStartX = null;
    });
  }

  // ── Navigation ← → entre produits dans la modal


  /* ══════════════════════════════════════════════════════════
     CART DRAWER — Full mechanism
     ══════════════════════════════════════════════════════════ */


// setupImageZoneTouch est ré-exporté par la façade b-modal.js (surface publique inchangée).

// modalZone() → b-store.js (S5 — évite les cycles core ↔ enhancers)
export {
  openModal, closeModal, modalGoBack, setupModal,
  setupImageZoneTouch,
};
