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
  { divider: true },
  { id: 'seed',            emoji: '🧪', label: 'Seed / Reset' },
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

CT.views.seed = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = `
    <div style="max-width:600px;margin:0 auto">
      <h2 style="font-size:22px;font-weight:800;margin:0 0 20px">🧪 Seed / Reset données test</h2>
      
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:20px">
        <strong>⚠️ Attention</strong> — Ces actions modifient la base de données de production.
      </div>
      
      <div style="display:flex;gap:12px;margin-bottom:20px">
        <button id="btn-reset" onclick="CT.views._doReset()"
          style="flex:1;padding:14px;border:2px solid #dc2626;border-radius:12px;background:#fee2e2;color:#dc2626;font-size:15px;font-weight:700;cursor:pointer">
          🗑️ Reset (tout supprimer)
        </button>
        <button id="btn-seed" onclick="CT.views._doSeed()"
          style="flex:1;padding:14px;border:2px solid #10b981;border-radius:12px;background:#d1fae5;color:#059669;font-size:15px;font-weight:700;cursor:pointer">
          🌱 Seed (injecter test)
        </button>
      </div>
      
      <div id="seed-status" style="margin-top:12px;font-size:14px"></div>
    </div>
  `;
};

CT.views._doReset = async function() {
  if (!confirm('⚠️ Supprimer TOUTES les données ?')) return;
  const status = document.getElementById('seed-status');
  status.innerHTML = '⏳ Reset en cours...';
  try {
    const res = await CT.api.post('/api/admin/reset');
    status.innerHTML = `<div style="color:#059669">✅ Reset terminé${res.message ? ': ' + res.message : ''}</div>`;
  } catch (err) {
    status.innerHTML = `<div style="color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

CT.views._doSeed = async function() {
  const status = document.getElementById('seed-status');
  status.innerHTML = '⏳ Injection des données de test...';
  try {
    const res = await CT.api.post('/api/admin/seed-test');
    status.innerHTML = `<div style="color:#059669">✅ Seed terminé${res.message ? ': ' + res.message : ''}</div>`;
  } catch (err) {
    status.innerHTML = `<div style="color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

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
      <div class="ct-sidebar-item" data-view="${item.id}" onclick="CT.navigate('${item.id}')">
        <span class="ct-sidebar-emoji">${item.emoji}</span>
        <span class="ct-sidebar-label">${item.label}</span>
      </div>
    `;
  }).join('');

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
