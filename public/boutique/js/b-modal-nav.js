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
 * @brief Navigation prev/next entre produits dans la modal — extrait de b-modal.js (ARCH-2, PR3).
 *
 * Périmètre :
 *   - navigateModal(direction) : produit suivant/précédent (avec transition animée).
 *   - updateModalNavArrows(list, idx) : flèches ←/→ + compteur dans la topbar (desktop).
 *
 * Note de découpage (ARCH-2) : la responsabilité « historique / retour catalogue »
 *   reste partiellement dans b-modal.js pour cette PR. Les flags _modalHistoryPushed /
 *   _closingFromPopstate et le handler popstate sont MUTÉS par openModal/closeModal
 *   (un binding importé n'est pas réassignable entre modules), et modalGoBack appelle
 *   closeModal en direct (même sémantique que le bouton X — passer par bus.emit('modal:close')
 *   déclencherait des listeners tiers absents du chemin direct). Ces éléments migreront
 *   avec le core en PR5, où ils redeviennent intra-module.
 *
 * Découplage cycle : navigateModal ouvre via bus.emit('modal:open', { id, pushHistory:false })
 *   au lieu d'appeler openModal directement → ce module n'importe RIEN de b-modal.js.
 *   Le pushHistory:false (pas de nouvelle entrée d'historique sur prev/next) est préservé
 *   par le handler bus.on('modal:open') de b-modal.js, étendu pour relayer pushHistory.
 *
 * Consommateurs : b-modal.js (openModal appelle updateModalNavArrows ; setupModal câble
 *   navigateModal au clavier ←/→ ; navigateModal est ré-exporté pour la surface publique).
 *
 * Dépendances : b-bus.js, b-store.js
 */

import { bus }        from './b-bus.js';
import { state, dom } from './b-store.js';

'use strict';

  // ── Boutons ← → dans la topbar de la modal
  /**
   * Met à jour les flèches de navigation produit suivant/précédent.
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
      prevBtn.innerHTML = '←';
      prevBtn.addEventListener('click', () => navigateModal(-1));

      const counter = document.createElement('span');
      counter.id = 'k-modal-nav-pos';      // renommé — évite conflit avec #k-modal-counter (compteur image)
      counter.className = 'k-modal-nav-counter';

      const nextBtn = document.createElement('button');
      nextBtn.id = 'k-modal-next';
      nextBtn.className = 'k-modal-nav-btn';
      nextBtn.innerHTML = '→';
      nextBtn.addEventListener('click', () => navigateModal(1));

      navEl.appendChild(prevBtn);
      navEl.appendChild(counter);
      navEl.appendChild(nextBtn);

      // Insérer dans la topbar à droite du bouton back
      const topbar = dom.modal.querySelector('.k-modal-topbar');
      if (topbar) {
        const right = topbar.querySelector('.k-modal-topbar-right');
        topbar.insertBefore(navEl, right);
      }
    }

    const counter = document.getElementById('k-modal-nav-pos'); // renommé
    const prevBtn = document.getElementById('k-modal-prev');
    const nextBtn = document.getElementById('k-modal-next');

    if (counter) counter.textContent = `${currentIdx + 1}/${list.length}`;
    if (prevBtn) prevBtn.classList.toggle('is-disabled', currentIdx <= 0);
    if (nextBtn) nextBtn.classList.toggle('is-disabled', currentIdx >= list.length - 1);
  }

  /**
   * Navigue vers le produit suivant/précédent dans le modal.
   * Maintient une pile d'historique pour le bouton retour.
   * @param {number} direction - +1 (suivant) ou -1 (précédent)
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
