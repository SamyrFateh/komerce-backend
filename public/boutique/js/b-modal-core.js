/**
 * @komerce-arch
 * @role          product-modal-orchestrator
 * @domain        boutique
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
 *   - setupModal : câblage complet (listeners, search inline, topbar, clavier,
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

    // HOTFIX #213 — Reset la barre de recherche interne à chaque ouverture
    if (state._modalSearchInput) {
      state._modalSearchInput.value = '';
      let _wrap = state._modalSearchInput.closest('.k-modal-inner-search');
      if (_wrap) _wrap.classList.remove('has-value');
      document.getElementById('k-sug-rail') &&
        document.getElementById('k-sug-rail').querySelectorAll('.k-sug-card.search-hidden').forEach(function(c) { c.classList.remove('search-hidden'); });
      // Fermer le dropdown résultats
      let _dd = document.getElementById('k-modal-search-dropdown');
      if (_dd) _dd.classList.remove('open');
    }

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
    function closeModal() {
    hideModalFAB();
    // FIX: Pop history entry if we pushed one (don't pop if back button already did)
    // BUG-02 — si on est déjà dans le handler popstate (_closingFromPopstate), ne pas
    // rappeler history.back() : c'est le popstate lui-même qui a déjà consommé l'entrée.
    if (_modalHistoryPushed && !_closingFromPopstate) {
      _modalHistoryPushed = false;
      _pendingHistoryBack = true; // BUG-03 : signale au handler popstate que ce back() est programmatique
      history.back();
    } else {
      _modalHistoryPushed = false;
    }
    dom.modalOverlay.classList.remove('open');
    // Unlock body scroll — CSS class drives layout
    const scrollY = state._savedCatalogScrollY || 0;
    document.body.classList.remove('modal-open');
    document.body.classList.remove('modal-has-cart');
    document.body.style.removeProperty('--modal-scroll-y');

    // REFONTE COQUE DESKTOP — restaurer #k-side-cart à sa position d'origine
    // (hors overlay). Sans ça il resterait piégé dans .k-modal-cart-slot,
    // display:none via .k-modal-overlay { display:none } et invisible au
    // prochain rendu catalogue.
    restoreSideCartHome();

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
  function reorderActionsForViewport() {
    if (!dom.modal) return;
    const act = dom.modal.querySelector('.k-modal-actions');
    if (!act) return;
    // Cette fonction ne gère QUE le cas mobile (reparentage flex statique en
    // enfant direct de #k-modal). Le retour desktop est déjà entièrement pris
    // en charge, de façon idempotente, par b-modal-approche-c-hybrid.js ::
    // restoreActionsHome() sur ce même événement modal:composition-synced —
    // ne pas dupliquer cette doctrine ici (cf audit MDM8_AUDIT_PHASE1.md §1.2,
    // point 3 : hors périmètre MDM-8, ne pas toucher).
    if (window.innerWidth < 900 && act.parentNode !== dom.modal) {
      dom.modal.appendChild(act);
    }
    // --k-modal-cta-h dépend de act.parentNode (isStatic) : la resynchroniser
    // à chaque reparentage, pas seulement au ResizeObserver de hauteur.
    _syncScrollPadding();
  }

  bus.on('modal:composition-synced', reorderActionsForViewport);

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

    reorderActionsForViewport();

    dom.modalBack.addEventListener('click', modalGoBack);
    dom.modalClose.addEventListener('click', closeModal);
    dom.modalCartBtn.addEventListener('click', () => {
      closeModal();
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


    // ── Barre de recherche interne — Sprint 1 : dropdown résultats live ──
    // Recherche dans TOUS les produits (450+), dropdown avec images/prix,
    // navigation intra-modal, état vide, bouton clear.
    // + conserve le filtrage des suggestions existant (non-régression).
    (function setupModalInnerSearch() {
      const sugSection = document.getElementById('k-modal-suggestions');
      if (!sugSection || sugSection.previousElementSibling?.classList.contains('k-modal-inner-search')) return;

      // ── Construction du markup ──
      const searchWrap = document.createElement('div');
      searchWrap.className = 'k-modal-inner-search';
      searchWrap.innerHTML =
        '<svg class="k-modal-inner-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>' +
        '</svg>' +
        '<input type="search" class="k-modal-inner-search-input" ' +
               'placeholder="Chercher un produit..." autocomplete="off" autocorrect="off">' +
        '<button class="k-modal-search-clear" aria-label="Effacer" type="button">\u00d7</button>' +
        '<span class="k-modal-inner-search-hint">\u21b5 Catalogue</span>';

      // Insert search bar inside .k-modal-details (desktop: suggestions are now outside)
      let searchParent = dom.modal.querySelector('.k-modal-details') || sugSection.parentElement;
      searchParent.appendChild(searchWrap);

      // ── Dropdown container ──
      let dropdown = document.createElement('div');
      dropdown.className = 'k-modal-search-dropdown';
      dropdown.id = 'k-modal-search-dropdown';
      /* FIX: attacher au modal root (pas à .k-modal-details) pour sortir
         du stacking context + overflow clipping. position:fixed en CSS. */
      dom.modal.appendChild(dropdown);

      const searchInput = searchWrap.querySelector('.k-modal-inner-search-input');
      const clearBtn = searchWrap.querySelector('.k-modal-search-clear');
      state._modalSearchInput = searchInput;

      // ── Filtrage suggestions + dropdown résultats globaux ──
      // Factorisé pour être appelé depuis input ET keyup (fallback mobile)
      function _handleSearchInput() {
        let q = searchInput.value.trim().toLowerCase();
        searchWrap.classList.toggle('has-value', q.length > 0);

        // 1. Filtrage suggestions existantes (non-régression)
        let sugRailEl = document.getElementById('k-sug-rail');
        if (sugRailEl) {
          sugRailEl.querySelectorAll('.k-sug-card').forEach(function(card) {
            if (q.length < 2) { card.classList.remove('search-hidden'); return; }
            let pid = card.dataset.id;
            let p = state.products.find(function(x) { return String(x.id) === String(pid); });
            if (!p) { card.classList.add('search-hidden'); return; }
            let match =
              (p.name || '').toLowerCase().includes(q) ||
              (p.category || '').toLowerCase().includes(q) ||
              (p.description || '').toLowerCase().includes(q);
            card.classList.toggle('search-hidden', !match);
          });
        }

        // 2. Dropdown résultats globaux (450+ produits)
        clearTimeout(state._modalSearchTimeout);
        if (q.length < 2) {
          _closeDropdown();
          return;
        }
        state._modalSearchTimeout = setTimeout(function() {
          let results = state.products.filter(function(p) {
            return (p.name || '').toLowerCase().includes(q) ||
                   (p.category || '').toLowerCase().includes(q) ||
                   (p.description || '').toLowerCase().includes(q);
          });
          _renderDropdown(results, q);
        }, 150);
      }

      searchInput.addEventListener('input', _handleSearchInput);
      // Fallback : certains claviers mobiles (composition/prédiction)
      // ne déclenchent pas 'input' à chaque frappe → keyup rattrape.
      searchInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter') return; // déjà géré par keydown
        _handleSearchInput();
      });

      // ── Clear button ──
      clearBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _resetSearchState();
        searchInput.focus();
      });

      // ── Sprint 3 : Recherches récentes ──────────────────────────
      let RECENTS_KEY = 'k_recent_searches';
      let RECENTS_MAX = 5;

      function _getRecents() {
        try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); }
        catch(e) { return []; }
      }

      function _saveRecent(term) {
        if (!term || term.length < 2) return;
        let recents = _getRecents().filter(function(r) { return r !== term; });
        recents.unshift(term);
        if (recents.length > RECENTS_MAX) recents = recents.slice(0, RECENTS_MAX);
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch(e) {}
      }

      function _removeRecent(term) {
        let recents = _getRecents().filter(function(r) { return r !== term; });
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch(e) {}
      }

      function _renderRecents() {
        let recents = _getRecents();
        if (!recents.length) { _closeDropdown(); return; }
        dropdown.innerHTML =
          '<div class="k-msearch-recents-header">' +
            '<span>R\u00e9centes</span>' +
            '<button class="k-msearch-recents-clear" type="button">Effacer tout</button>' +
          '</div>' +
          recents.map(function(term) {
            return '<div class="k-msearch-recent-item" data-term="' + sanitize(term) + '">' +
              '<svg class="k-msearch-recent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
              '<span class="k-msearch-recent-label">' + sanitize(term) + '</span>' +
              '<button class="k-msearch-recent-remove" data-term="' + sanitize(term) + '" type="button" aria-label="Supprimer">\u00d7</button>' +
            '</div>';
          }).join('');
        _openDropdown();

        // Clic sur un terme récent → injecter et chercher
        dropdown.querySelectorAll('.k-msearch-recent-item').forEach(function(item) {
          item.addEventListener('click', function(e) {
            if (e.target.closest('.k-msearch-recent-remove')) return;
            let t = item.dataset.term;
            searchInput.value = t;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          });
        });

        // Supprimer un terme
        dropdown.querySelectorAll('.k-msearch-recent-remove').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            _removeRecent(btn.dataset.term);
            _renderRecents();
          });
        });

        // Effacer tout
        let clearAll = dropdown.querySelector('.k-msearch-recents-clear');
        if (clearAll) {
          clearAll.addEventListener('click', function(e) {
            e.stopPropagation();
            try { localStorage.removeItem(RECENTS_KEY); } catch(e) {}
            _closeDropdown();
          });
        }
      }

      // Focus sur la barre vide → afficher les récents
      searchInput.addEventListener('focus', function() {
        if (searchInput.value.trim().length < 2) {
          _renderRecents();
        }
      });

      // ── Enter → catalogue (existant + sauvegarde récent Sprint 3) ──
      searchInput.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        let q = searchInput.value.trim();
        if (q.length < 1) { e.preventDefault(); return; }
        e.preventDefault();
        _saveRecent(q);
        _resetSearchState();
        closeModal();
        let mainInput = dom.searchInput || document.getElementById('k-search-input');
        if (mainInput) {
          mainInput.value = q;
          mainInput.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function() {
            let pageScroll = document.querySelector('.k-page-scroll') || document.scrollingElement;
            if (pageScroll) pageScroll.scrollTo({ top: 0, behavior: 'smooth' });
          }, 200);
        }
      });

      // ── Fermer dropdown au clic hors zone ──
      document.addEventListener('click', function(e) {
        if (!e.target.closest('.k-modal-inner-search') && !e.target.closest('.k-modal-search-dropdown')) {
          _closeDropdown();
        }
      });

      // ── Render dropdown — Sprint 2 : résultats catégorisés ──
      /* FIX: dropdown est maintenant position:fixed, attaché au modal root.
         _positionDropdown() calcule la position sous l'input actif (inline ou topbar).
         _liftDetails() garde le bump z-index en sécurité additionnelle. */
      let _detailsEl = dom.modal.querySelector('.k-modal-details');
      function _liftDetails()   { if (_detailsEl) _detailsEl.style.zIndex = '35'; }
      function _unliftDetails() { if (_detailsEl) _detailsEl.style.zIndex = ''; }

      function _positionDropdown() {
        let topbarActive = document.querySelector('.k-topbar-search-expanded.is-active');
        let refEl = topbarActive || searchWrap;
        let rect = refEl.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 4) + 'px';
        // Sur desktop, aligner avec la barre de recherche
        if (window.innerWidth >= 900) {
          let searchRect = searchWrap.getBoundingClientRect();
          dropdown.style.left = searchRect.left + 'px';
          dropdown.style.right = (window.innerWidth - searchRect.right) + 'px';
        }
      }

      function _openDropdown() {
        _liftDetails();
        _positionDropdown();
        dropdown.classList.add('open');
      }

      // Repositionner pendant le scroll
      let _mScrollDropdown = dom.modal.querySelector('.k-modal-scroll');
      if (_mScrollDropdown) {
        _mScrollDropdown.addEventListener('scroll', function() {
          if (dropdown.classList.contains('open')) _positionDropdown();
        }, { passive: true });
      }

      function _renderDropdown(results, query) {
        if (!results.length) {
          dropdown.innerHTML =
            '<div class="k-msearch-empty">' +
              '<div class="k-msearch-empty-icon">\ud83d\udd0d</div>' +
              '<div>Aucun produit trouv\u00e9 pour \u00ab\u00a0' + sanitize(query) + '\u00a0\u00bb</div>' +
            '</div>';
          _openDropdown();
          return;
        }

        let totalCount = results.length;

        // ── Grouper par catégorie ──
        let groups = {};
        let groupOrder = [];
        results.forEach(function(p) {
          let catKey = normalizeCategoryKey(p.category) || p.category || 'Autres';
          if (!groups[catKey]) {
            groups[catKey] = [];
            groupOrder.push(catKey);
          }
          groups[catKey].push(p);
        });

        // ── Construire le HTML ──
        let html = '<div class="k-msearch-count">' + totalCount + ' r\u00e9sultat' + (totalCount > 1 ? 's' : '') + '</div>';

        groupOrder.forEach(function(catKey) {
          let items = groups[catKey];
          let emoji = getCategorySectionEmoji(catKey) || '';
          let shown = items.slice(0, 3);
          let remaining = items.length - shown.length;

          html += '<div class="k-msearch-group" data-cat="' + sanitize(catKey) + '">';
          html += '<div class="k-msearch-group-header">' +
            '<span class="k-msearch-group-emoji">' + emoji + '</span>' +
            '<span class="k-msearch-group-label">' + sanitize(catKey) + '</span>' +
            '<span class="k-msearch-group-count">' + items.length + '</span>' +
          '</div>';

          html += shown.map(function(p) {
            let promo = p.promo_pct ? '<span class="k-msearch-item-promo">-' + p.promo_pct + '%</span>' : '';
            return '<div class="k-msearch-item" data-id="' + p.id + '">' +
              '<img class="k-msearch-item-img" src="' + optimizeImgUrl(p.image_url, 88) + '" alt="" loading="lazy">' +
              '<div class="k-msearch-item-info">' +
                '<div class="k-msearch-item-name">' + sanitize(p.name) + '</div>' +
              '</div>' +
              '<div class="k-msearch-item-right">' +
                '<span class="k-msearch-item-price">' + fmtPrice(p.price_kmf) + '</span>' +
                promo +
              '</div>' +
            '</div>';
          }).join('');

          if (remaining > 0) {
            html += '<div class="k-msearch-group-more" data-cat="' + sanitize(catKey) + '" data-query="' + sanitize(query) + '">' +
              'Voir ' + (remaining === 1 ? '1 autre' : 'les ' + remaining + ' autres') + ' dans ' + sanitize(catKey) + ' \u2192' +
            '</div>';
          }

          html += '</div>';
        });

        html += '<div class="k-msearch-footer" data-query="' + sanitize(query) + '">' +
          '\u21b5 Chercher \u00ab\u00a0' + sanitize(query) + '\u00a0\u00bb dans le catalogue' +
        '</div>';

        dropdown.innerHTML = html;
        _openDropdown();

        // ── Bind résultats : clic → switch produit intra-modal ──
        dropdown.querySelectorAll('.k-msearch-item').forEach(function(item) {
          item.addEventListener('click', function(e) {
            e.stopPropagation();
            let pid = item.dataset.id;
            _saveRecent(query);
            _resetSearchState();
            openModal(pid, false);
          });
        });

        // ── "Voir les X autres dans Catégorie" → catalogue filtré par catégorie ──
        dropdown.querySelectorAll('.k-msearch-group-more').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            let cat = btn.dataset.cat;
            let q = btn.dataset.query || '';
            _saveRecent(q);
            _resetSearchState();
            closeModal();
            // FIX BUG-M4 : remplace l'import direct setActiveCat (dépendance
            // circulaire b-modal↔b-catalog). b-catalog.js écoute 'cat:select'.
            bus.emit('cat:select', cat);
            let mainInput = dom.searchInput || document.getElementById('k-search-input');
            if (mainInput) {
              mainInput.value = q;
              mainInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            setTimeout(function() {
              let pageScroll = document.querySelector('.k-page-scroll') || document.scrollingElement;
              if (pageScroll) pageScroll.scrollTo({ top: 0, behavior: 'smooth' });
            }, 200);
          });
        });

        // ── Footer : lancer la recherche catalogue globale ──
        let footer = dropdown.querySelector('.k-msearch-footer');
        if (footer) {
          footer.addEventListener('click', function() {
            let q = footer.dataset.query || '';
            _saveRecent(q);
            _resetSearchState();
            closeModal();
            let mainInput = dom.searchInput || document.getElementById('k-search-input');
            if (mainInput) {
              mainInput.value = q;
              mainInput.dispatchEvent(new Event('input', { bubbles: true }));
              setTimeout(function() {
                let pageScroll = document.querySelector('.k-page-scroll') || document.scrollingElement;
                if (pageScroll) pageScroll.scrollTo({ top: 0, behavior: 'smooth' });
              }, 200);
            }
          });
        }
      }

      // ── Helper : reset propre de l'état search ──
      function _resetSearchState() {
        searchInput.value = '';
        searchWrap.classList.remove('has-value');
        _closeDropdown();
        let sugRailEl = document.getElementById('k-sug-rail');
        if (sugRailEl) sugRailEl.querySelectorAll('.k-sug-card.search-hidden').forEach(function(c) { c.classList.remove('search-hidden'); });
      }

      function _closeDropdown() {
        dropdown.classList.remove('open');
        _unliftDetails();
      }
    })();

    // ── Sprint 4 : Loupe mobile dans la topbar (collapse/expand) ──────
    // Sur mobile, ajoute un bouton loupe dans la topbar qui, au tap,
    // expand une barre de recherche pleine largeur dans la topbar.
    // Synced avec le même input/dropdown que la barre inline.
    (function setupTopbarSearch() {
      if (window.innerWidth >= 900) return; // desktop only uses inline search

      let topbar = dom.modal ? dom.modal.querySelector('.k-modal-topbar') : null;
      if (!topbar) return;

      // Ne pas injecter 2 fois
      if (topbar.querySelector('.k-topbar-search-trigger')) return;

      // ── Bouton loupe trigger ──
      let trigger = document.createElement('button');
      trigger.className = 'k-topbar-search-trigger';
      trigger.type = 'button';
      trigger.setAttribute('aria-label', 'Rechercher');
      trigger.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>' +
        '</svg>';

      // ── Barre expanded ──
      let expandedBar = document.createElement('div');
      expandedBar.className = 'k-topbar-search-expanded';
      expandedBar.innerHTML =
        '<button class="k-topbar-search-back" type="button" aria-label="Fermer la recherche">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>' +
        '</button>' +
        '<input type="search" class="k-topbar-search-input" placeholder="Chercher un produit\u2026" autocomplete="off" autocorrect="off">' +
        '<button class="k-topbar-search-clear-btn" type="button" aria-label="Effacer">\u00d7</button>';

      // Insert trigger before topbar-right
      let topbarRight = topbar.querySelector('.k-modal-topbar-right');
      if (topbarRight) {
        topbar.insertBefore(trigger, topbarRight);
      } else {
        topbar.appendChild(trigger);
      }
      topbar.appendChild(expandedBar);

      let tbInput = expandedBar.querySelector('.k-topbar-search-input');
      let tbBack = expandedBar.querySelector('.k-topbar-search-back');
      let tbClear = expandedBar.querySelector('.k-topbar-search-clear-btn');

      function _expandSearch() {
        expandedBar.classList.add('is-active');
        topbar.classList.add('search-mode');
        requestAnimationFrame(function() { tbInput.focus(); });
      }

      function _collapseSearch() {
        expandedBar.classList.remove('is-active');
        topbar.classList.remove('search-mode');
        tbInput.value = '';
        tbClear.classList.remove('is-visible');
        // Also reset the main inline search + dropdown
        if (state._modalSearchInput) {
          state._modalSearchInput.value = '';
          let wrap = state._modalSearchInput.closest('.k-modal-inner-search');
          if (wrap) wrap.classList.remove('has-value');
        }
        let dd = document.getElementById('k-modal-search-dropdown');
        if (dd) dd.classList.remove('open');
        // Restore suggestions
        let rail = document.getElementById('k-sug-rail');
        if (rail) rail.querySelectorAll('.k-sug-card.search-hidden').forEach(function(c) { c.classList.remove('search-hidden'); });
      }

      trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        _expandSearch();
      });

      tbBack.addEventListener('click', function(e) {
        e.stopPropagation();
        _collapseSearch();
      });

      tbClear.addEventListener('click', function(e) {
        e.stopPropagation();
        tbInput.value = '';
        tbClear.classList.remove('is-visible');
        tbInput.focus();
        // Sync : clear the inline search too
        if (state._modalSearchInput) {
          state._modalSearchInput.value = '';
          state._modalSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      // Sync typing → inject into the inline search (which does the real work)
      tbInput.addEventListener('input', function() {
        let q = tbInput.value;
        tbClear.classList.toggle('is-visible', q.length > 0);
        // Sync with the inline search input
        if (state._modalSearchInput) {
          state._modalSearchInput.value = q;
          state._modalSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      // Enter in topbar → same as inline Enter
      tbInput.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        // Delegate to inline search Enter handler by syncing then firing
        if (state._modalSearchInput) {
          state._modalSearchInput.value = tbInput.value;
          state._modalSearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        _collapseSearch();
      });

      // Collapse on Escape
      tbInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          _collapseSearch();
        }
      });
    })();

    // ── Sprint 5 : Recherche vocale (Web Speech API) ──────────────
    // Bouton micro dans la barre inline. Feature-detected : masqué si non supporté.
    (function setupVoiceSearch() {
      let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      let searchWrapEl = document.querySelector('.k-modal-inner-search');
      if (!searchWrapEl) return;
      if (searchWrapEl.querySelector('.k-modal-search-mic')) return;

      let mic = document.createElement('button');
      mic.className = 'k-modal-search-mic';
      mic.type = 'button';
      mic.setAttribute('aria-label', '\u00c9couter');
      mic.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<rect x="9" y="1" width="6" height="12" rx="3"/>' +
          '<path d="M5 10a7 7 0 0 0 14 0"/>' +
          '<line x1="12" y1="17" x2="12" y2="21"/>' +
          '<line x1="8" y1="21" x2="16" y2="21"/>' +
        '</svg>';

      let clearEl = searchWrapEl.querySelector('.k-modal-search-clear');
      if (clearEl) {
        searchWrapEl.insertBefore(mic, clearEl);
      } else {
        searchWrapEl.appendChild(mic);
      }

      let recognition = null;
      let isListening = false;

      mic.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (isListening && recognition) {
          recognition.stop();
          return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'fr-FR';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        mic.classList.add('is-listening');
        isListening = true;

        recognition.addEventListener('result', function(event) {
          let transcript = event.results[0][0].transcript.trim();
          if (transcript && state._modalSearchInput) {
            state._modalSearchInput.value = transcript;
            state._modalSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
            state._modalSearchInput.focus();
          }
        });

        recognition.addEventListener('end', function() {
          mic.classList.remove('is-listening');
          isListening = false;
        });

        recognition.addEventListener('error', function() {
          mic.classList.remove('is-listening');
          isListening = false;
        });

        try { recognition.start(); } catch(err) {
          mic.classList.remove('is-listening');
          isListening = false;
        }
      });
    })();

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
        '.k-modal-topbar-overlay, .k-modal-view-full, button, a, input, select, textarea, [role="button"]'
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
