/**
 * b-desktop-sidebar.js — Sidebar catégories Temu-style (≥ 900px uniquement)
 *
 * Principe : zéro logique parallèle.
 *   - Lecture catégories → shop-schema.js (source unique de vérité)
 *   - Sélection catégorie → state.activeCat + renderGrid() de b-catalog.js
 *   - Sync chip rail → syncRailActiveState() de home-controller.js
 *   - Sync sidebar active → listener délégué sur .k-chip (chip clicks)
 */

import { state }                             from './b-store.js';
import { renderGrid }                        from './b-catalog.js';
import { syncRailActiveState, renderSubcatRail } from './controllers/home-controller.js';
import {
  getRailCategories,
  getCategorySectionEmoji,
}                                            from './shop-schema.js';

'use strict';

// ── DOM ref ─────────────────────────────────────────────────────────
let _sidebarEl = null;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Retourne la liste complète : "Tout" + catégories du rail.
 */
function _buildCatList() {
  const allEntry = { key: 'all', label: 'Tout voir', emoji: '🏪' };
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
    <nav class="k-sidebar-nav" aria-label="Filtrer par catégorie">
      <div class="k-sidebar-title">Catégories</div>
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
      state.activeCat    = cat;
      state.activeSubcat = null;
      if (state.flatSubcat) state.flatSubcat = null;

      syncRailActiveState(cat, { center: false });

      renderGrid();
      renderSubcatRail(cat);
      _syncSidebarActive(el);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    item.addEventListener('click', activate);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
}

/**
 * Met à jour l'état actif des items sidebar selon state.activeCat.
 */
function _syncSidebarActive(el) {
  if (!el) return;
  el.querySelectorAll('.k-sidebar-cat').forEach(item => {
    item.classList.toggle('is-active', item.dataset.cat === state.activeCat);
  });
}

// ── Point d'entrée ──────────────────────────────────────────────────

/**
 * Initialise la sidebar desktop. Appelé une seule fois depuis boutique.js init().
 * No-op si < 900px.
 */
export function setupDesktopSidebar() {
  if (window.innerWidth < 900) return;

  _sidebarEl = document.getElementById('k-desktop-sidebar');
  if (!_sidebarEl) return;

  _buildSidebar(_sidebarEl);

  // Sync sidebar quand l'utilisateur clique sur un chip du rail
  document.addEventListener('click', function(e) {
    const chip = e.target.closest('.k-chip');
    if (!chip || !_sidebarEl) return;
    requestAnimationFrame(() => _syncSidebarActive(_sidebarEl));
  }, { passive: true });

  // Sync au resize (si on repasse > 900px après un redimensionnement)
  window.addEventListener('resize', function() {
    if (window.innerWidth >= 900 && _sidebarEl) {
      _syncSidebarActive(_sidebarEl);
    }
  }, { passive: true });
}

/**
 * Expose pour sync externe (ex: après renderGrid depuis autre module).
 */
export function syncDesktopSidebar() {
  if (_sidebarEl) _syncSidebarActive(_sidebarEl);
}
