/**
 * @komerce-arch-lite
 * @role          boutique-b-desktop-sidebar
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * b-desktop-sidebar.js â€” Sidebar catÃ©gories Temu-style (â‰¥ 900px uniquement)
 *
 * Principe : zÃ©ro logique parallÃ¨le.
 *   - Lecture catÃ©gories â†’ shop-schema.js (source unique de vÃ©ritÃ©)
 *   - SÃ©lection catÃ©gorie â†’ state.activeCat + renderGrid() de b-catalog.js
 *   - Sync chip rail â†’ syncRailActiveState() de home-controller.js
 *   - Sync sidebar active â†’ listener dÃ©lÃ©guÃ© sur .k-chip (chip clicks)
 */

import { state }                             from './b-store.js';
import { bus }                               from './b-bus.js';
import { setActiveCat }                              from './b-catalog.js';
import { isDesktop, scrollPageToTop }                from './b-scroll-owner.js';
import { syncRailActiveState, renderSubcatRail } from './controllers/home-controller.js';
import {
  getRailCategories,
  getCategorySectionEmoji,
}                                            from './shop-schema.js';

'use strict';

// â”€â”€ DOM ref â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _sidebarEl = null;

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Retourne la liste complÃ¨te : "Tout" + catÃ©gories du rail.
 */
function _buildCatList() {
  const allEntry = { key: 'all', label: 'Tout voir', emoji: 'ðŸª' };
  const cats = getRailCategories().map(c => ({
    key: c.key,
    label: c.shortLabel || c.label,
    emoji: getCategorySectionEmoji(c.key) || c.emoji || '',
  }));
  return [allEntry, ...cats];
}

/**
 * Injecte le markup HTML dans la sidebar et branche les listeners.
 */
function _buildSidebar(el) {
  const cats = _buildCatList();

  el.innerHTML = `
    <nav class="k-sidebar-nav" aria-label="Filtrer par catÃ©gorie">
      <div class="k-sidebar-title">CatÃ©gories</div>
      <ul class="k-sidebar-cats">
        ${cats.map(c => `
          <li class="k-sidebar-cat${state.activeCat === c.key ? ' is-active' : ''}"
              data-cat="${c.key}"
              role="button"
              tabindex="0"
              aria-label="${c.label}">
            <span class="k-sidebar-cat-icon" aria-hidden="true">${c.emoji}</span>
            <span class="k-sidebar-cat-label">${c.label}</span>
          </li>
        `).join('')}
      </ul>
    </nav>
  `;

  el.querySelectorAll('.k-sidebar-cat').forEach(item => {
    const activate = () => {
      const cat = item.dataset.cat;
      setActiveCat(cat);

      syncRailActiveState(cat, { center: false });

      renderSubcatRail(cat);
      _syncSidebarActive(el);
      scrollPageToTop('smooth');
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
  // ORPHELIN F supprimÃ© â€” bus.emit('sidebar:built') n'avait aucun listener dans la codebase.
}

/**
 * Met Ã  jour l'Ã©tat actif des items sidebar selon state.activeCat.
 */
function _syncSidebarActive(el) {
  if (!el) return;
  el.querySelectorAll('.k-sidebar-cat').forEach(item => {
    item.classList.toggle('is-active', item.dataset.cat === state.activeCat);
  });
}

// â”€â”€ Point d'entrÃ©e â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Initialise la sidebar desktop. AppelÃ© une seule fois depuis boutique.js init().
 * No-op si < 900px.
 */
export function setupDesktopSidebar() {
  if (!isDesktop()) return;

  _sidebarEl = document.getElementById('k-desktop-sidebar');
  if (!_sidebarEl) return;

  _buildSidebar(_sidebarEl);

  // Sync sidebar quand l'utilisateur clique sur un chip du rail
  document.addEventListener('click', function(e) {
    const chip = e.target.closest('.k-chip');
    if (!chip || !_sidebarEl) return;
    requestAnimationFrame(() => _syncSidebarActive(_sidebarEl));
  }, { passive: true });

  // Sync au resize (si on repasse > 900px aprÃ¨s un redimensionnement)
  window.addEventListener('resize', function() {
    if (isDesktop() && _sidebarEl) {
      _syncSidebarActive(_sidebarEl);
    }
  }, { passive: true });
}

/**
 * Expose pour sync externe (ex: aprÃ¨s renderGrid depuis autre module).
 */
export function syncDesktopSidebar() {
  if (_sidebarEl) _syncSidebarActive(_sidebarEl);
}
