/**
 * @komerce-arch-lite
 * @role          legacy-ct-app-v6
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/**
 * ═══════════════════════════════════════════════════════════════════════
 * CONTROL TOWER v6 — APP (Router + Sidebar) — COLIS-FIRST
 * ═══════════════════════════════════════════════════════════════════════
 */

window.CT = window.CT || {};
CT.views = CT.views || {};

// ═══════════════════════════════════════════════════════════════════════
// SIDEBAR CONFIG
// ═══════════════════════════════════════════════════════════════════════

CT.sidebar = [
  { id: 'global',          emoji: '📊', label: 'Tableau de bord' },
  { id: 'parcels',         emoji: '📦', label: 'Tous les colis' },
  { id: 'critical',        emoji: '🚨', label: 'Colis critiques' },
  { id: 'reconciliation',  emoji: '⚖️', label: 'Réconciliation' },
  { id: 'alerts',          emoji: '⚡', label: 'Alertes' },
  { id: 'incidents',       emoji: '🔴', label: 'Incidents' },
  { divider: true },
  { id: 'orders',          emoji: '📋', label: 'Commandes' },
  { id: 'finances',        emoji: '💰', label: 'Finances' },
  { id: 'invoices',        emoji: '🧾', label: 'Factures' },
];

// ═══════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════

CT.currentView = null;

CT.navigate = function(viewId) {
  if (CT.views[viewId]) {
    CT.currentView = viewId;
    CT.views[viewId]();
    CT._updateSidebar(viewId);
    history.replaceState(null, '', `#${viewId}`);
  } else {
    console.warn(`Vue inconnue: ${viewId}`);
    CT.navigate('global');
  }
};

CT._updateSidebar = function(activeId) {
  document.querySelectorAll('.ct-sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === activeId);
  });
};

// ═══════════════════════════════════════════════════════════════════════
// SEED / RESET VIEW
// ═══════════════════════════════════════════════════════════════════════

// Historical deep link redirects to the isolated recipe console, never mutates data.
CT.views.seed = function() { window.location.assign('/admin/golden-e2e#stagingAdminTools'); };

// ═══════════════════════════════════════════════════════════════════════
// INIT — Build sidebar + initial navigation
// ═══════════════════════════════════════════════════════════════════════

CT.init = function() {
  const sidebar = document.getElementById('ct-sidebar');
  if (!sidebar) { console.error('Missing #ct-sidebar'); return; }

  sidebar.innerHTML = CT.sidebar.map(item => {
    if (item.divider) {
      return '<div class="ct-sidebar-divider"></div>';
    }
    return `
      <div class="ct-sidebar-item" data-view="${item.id}">
        <span class="ct-sidebar-emoji">${item.emoji}</span>
        <span class="ct-sidebar-label">${item.label}</span>
      </div>
    `;
  }).join('');

  // Sidebar delegation
  sidebar.addEventListener('click', function(e) {
    var item = e.target.closest('.ct-sidebar-item[data-view]');
    if (item) CT.navigate(item.dataset.view);
  });

  // Navigate to hash or default
  const hash = location.hash.replace('#', '') || 'global';
  CT.navigate(hash);
};

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', CT.init);
} else {
  CT.init();
}

console.log('🗼 CT.app v6 loaded — COLIS-FIRST router ready');
