/**
 * @komerce-arch-lite
 * @role          boutique-b-modal-nav
 * @domain        shared-cart-modal
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-modal-nav
 * @brief Navigation prev/next entre produits dans la modal â€” extrait de b-modal.js (ARCH-2, PR3).
 *
 * PÃ©rimÃ¨tre :
 *   - navigateModal(direction) : produit suivant/prÃ©cÃ©dent (avec transition animÃ©e).
 *   - updateModalNavArrows(list, idx) : flÃ¨ches â†/â†’ + compteur dans la topbar (desktop).
 *
 * Note de dÃ©coupage (ARCH-2) : la responsabilitÃ© Â« historique / retour catalogue Â»
 *   reste partiellement dans b-modal.js pour cette PR. Les flags _modalHistoryPushed /
 *   _closingFromPopstate et le handler popstate sont MUTÃ‰S par openModal/closeModal
 *   (un binding importÃ© n'est pas rÃ©assignable entre modules), et modalGoBack appelle
 *   closeModal en direct (mÃªme sÃ©mantique que le bouton X â€” passer par bus.emit('modal:close')
 *   dÃ©clencherait des listeners tiers absents du chemin direct). Ces Ã©lÃ©ments migreront
 *   avec le core en PR5, oÃ¹ ils redeviennent intra-module.
 *
 * DÃ©couplage cycle : navigateModal ouvre via bus.emit('modal:open', { id, pushHistory:false })
 *   au lieu d'appeler openModal directement â†’ ce module n'importe RIEN de b-modal.js.
 *   Le pushHistory:false (pas de nouvelle entrÃ©e d'historique sur prev/next) est prÃ©servÃ©
 *   par le handler bus.on('modal:open') de b-modal.js, Ã©tendu pour relayer pushHistory.
 *
 * Consommateurs : b-modal.js (openModal appelle updateModalNavArrows ; setupModal cÃ¢ble
 *   navigateModal au clavier â†/â†’ ; navigateModal est rÃ©-exportÃ© pour la surface publique).
 *
 * DÃ©pendances : b-bus.js, b-store.js
 */

import { bus }        from './b-bus.js';
import { state, dom } from './b-store.js';

'use strict';

  // â”€â”€ Boutons â† â†’ dans la topbar de la modal
  /**
   * Met Ã  jour les flÃ¨ches de navigation produit suivant/prÃ©cÃ©dent.
   * Visible mobile ET desktop (mobile : version compacte, cf. modal-shell.css).
   * @param {number} currentIndex - Index produit dans la liste
   * @param {number} total - Total produits disponibles
   */
  function updateModalNavArrows(list, currentIdx) {
    let navEl = document.getElementById('k-modal-nav');
    if (!navEl) {
      navEl = document.createElement('div');
      navEl.id = 'k-modal-nav';
      // Styles in CSS: #k-modal-nav

      const prevBtn = document.createElement('button');
      prevBtn.id = 'k-modal-prev';
      prevBtn.className = 'k-modal-nav-btn';
      prevBtn.innerHTML = 'â†';
      prevBtn.addEventListener('click', () => navigateModal(-1));

      const counter = document.createElement('span');
      counter.id = 'k-modal-nav-pos';      // renommÃ© â€” Ã©vite conflit avec #k-modal-counter (compteur image)
      counter.className = 'k-modal-nav-counter';

      const nextBtn = document.createElement('button');
      nextBtn.id = 'k-modal-next';
      nextBtn.className = 'k-modal-nav-btn';
      nextBtn.innerHTML = 'â†’';
      nextBtn.addEventListener('click', () => navigateModal(1));

      navEl.appendChild(prevBtn);
      navEl.appendChild(counter);
      navEl.appendChild(nextBtn);

      // InsÃ©rer dans la topbar Ã  droite du bouton back
      const topbar = dom.modal.querySelector('.k-modal-topbar');
      if (topbar) {
        const right = topbar.querySelector('.k-modal-topbar-right');
        topbar.insertBefore(navEl, right);
      }
    }

    const counter = document.getElementById('k-modal-nav-pos'); // renommÃ©
    const prevBtn = document.getElementById('k-modal-prev');
    const nextBtn = document.getElementById('k-modal-next');

    if (counter) counter.textContent = `${currentIdx + 1}/${list.length}`;
    if (prevBtn) prevBtn.classList.toggle('is-disabled', currentIdx <= 0);
    if (nextBtn) nextBtn.classList.toggle('is-disabled', currentIdx >= list.length - 1);
  }

  /**
   * Navigue vers le produit suivant/prÃ©cÃ©dent dans le modal.
   * Maintient une pile d'historique pour le bouton retour.
   * @param {number} direction - +1 (suivant) ou -1 (prÃ©cÃ©dent)
   */
  function navigateModal(direction) {
    if (!state.modalProduct) return;
    const list = state.filtered.length ? state.filtered : state.products;
    const currentIdx = list.findIndex(p => p.id === state.modalProduct.id);
    if (currentIdx === -1) return;
    const nextIdx = currentIdx + direction;
    if (nextIdx < 0 || nextIdx >= list.length) return;

    const scrollEl = dom.modal.querySelector('.k-modal-scroll');
    if (scrollEl) {
      scrollEl.style.transition = 'opacity .12s, transform .12s';
      scrollEl.style.opacity = '0';
      scrollEl.style.transform = `translateX(${direction > 0 ? '-24px' : '24px'})`;
      setTimeout(() => {
        bus.emit('modal:open', { id: list[nextIdx].id, pushHistory: false });
        scrollEl.style.transition = 'none';
        scrollEl.style.opacity = '0';
        scrollEl.style.transform = `translateX(${direction > 0 ? '24px' : '-24px'})`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          scrollEl.style.transition = 'opacity .18s, transform .18s';
          scrollEl.style.opacity = '1';
          scrollEl.style.transform = 'translateX(0)';
        }));
      }, 130);
    } else {
      bus.emit('modal:open', { id: list[nextIdx].id, pushHistory: false });
    }
  }

export { updateModalNavArrows, navigateModal };
