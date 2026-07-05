/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-dashboard-radar
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/**
 * KOMERCE Control Tower — Dashboard Radar v1.0
 *
 * Wrap le Dashboard existant (CT.views.dashboard de ct-views-v7.js) en
 * injectant EN HAUT un bandeau radar :
 *
 *   ┌────────────────────────────────────────┐
 *   │ 🚨 ALERTES DU JOUR  (si non vide)       │
 *   │ [Critical cards cliquables]             │
 *   │ [Signal cards plus discrets]            │
 *   ├────────────────────────────────────────┤
 *   │ 💰 MONEY — 5 cards comparées            │
 *   │ CA J · CA M · Cash · Wallets · Marge    │
 *   ├────────────────────────────────────────┤
 *   │ 📦 FLUX COLIS (status_detail)           │
 *   │ Distribution cliquable en 7 buckets     │
 *   └────────────────────────────────────────┘
 *   [Dashboard existant inchangé en dessous]
 *
 * Principe : ZÉRO modification de ct-views-v7.js. On intercepte la fonction
 * CT.views.dashboard au chargement, on la wrappe, on préserve tout.
 */

(function() {
  'use strict';

  if (typeof window.CT === 'undefined') window.CT = {};
  if (typeof window.CT.views === 'undefined') window.CT.views = {};

  // ══════════════════════════════════════════════════════════════════════
  // STYLES (injection unique)
  // ══════════════════════════════════════════════════════════════════════

  const RADAR_CSS = `
    /* Radar container */
    .rd-section { background:white; border-radius:12px; padding:16px 20px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
    .rd-section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .rd-section-head h3 { font-size:16px; color:#334155; font-weight:700; }
    .rd-refresh { background:none; border:none; cursor:pointer; color:#94a3b8; font-size:13px; padding:4px 8px; border-radius:6px; transition:all 0.15s; }
    .rd-refresh:hover { background:#f1f5f9; color:#1e293b; }
    .rd-ts { color:#94a3b8; font-size:11px; }

    /* ── ZONE ALERTES ────────────────────────────────────── */
    .rd-alerts-section { border-left:4px solid #ef4444; background:linear-gradient(90deg, #fef2f2 0%, white 50%); }
    .rd-alerts-section.empty { border-left-color:#22c55e; background:linear-gradient(90deg, #f0fdf4 0%, white 50%); }
    .rd-alerts-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:10px; }
    .rd-alert { display:flex; gap:10px; padding:10px 12px; border-radius:8px; background:white; border:1px solid #e2e8f0; cursor:pointer; transition:all 0.15s; align-items:flex-start; }
    .rd-alert:hover { transform:translateY(-1px); box-shadow:0 4px 8px rgba(0,0,0,0.08); }
    .rd-alert-critical { border-left:4px solid #dc2626; }
    .rd-alert-signal { border-left:4px solid #f59e0b; }
    .rd-alert-icon { font-size:24px; flex-shrink:0; }
    .rd-alert-body { flex:1; min-width:0; }
    .rd-alert-title { font-weight:700; color:#1e293b; font-size:13px; line-height:1.4; }
    .rd-alert-action { font-size:11px; color:#64748b; margin-top:2px; }
    .rd-alert-chevron { color:#cbd5e1; align-self:center; font-size:18px; }
    .rd-calm { display:flex; align-items:center; gap:12px; padding:12px; color:#16a34a; font-weight:600; }
    .rd-calm-icon { font-size:28px; }

    /* ── ZONE MONEY ──────────────────────────────────────── */
    .rd-money-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px; }
    .rd-money-card { padding:14px; border-radius:10px; background:white; border:1px solid #e2e8f0; cursor:pointer; transition:all 0.15s; position:relative; }
    .rd-money-card:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.08); }
    .rd-money-card.static { cursor:default; }
    .rd-money-card.static:hover { transform:none; box-shadow:none; }
    .rd-money-icon { position:absolute; top:12px; right:12px; font-size:20px; opacity:0.6; }
    .rd-money-label { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px; font-weight:600; }
    .rd-money-value { font-size:22px; font-weight:800; color:#1e293b; margin-top:4px; line-height:1.1; }
    .rd-money-unit { font-size:12px; color:#94a3b8; font-weight:500; margin-left:4px; }
    .rd-money-sub { font-size:11px; color:#64748b; margin-top:4px; }
    .rd-money-delta { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; margin-top:6px; padding:2px 8px; border-radius:20px; }
    .rd-delta-up { background:#dcfce7; color:#16a34a; }
    .rd-delta-down { background:#fee2e2; color:#dc2626; }
    .rd-delta-flat { background:#f1f5f9; color:#64748b; }
    .rd-money-prev { font-size:11px; color:#94a3b8; margin-top:2px; }

    /* ── ZONE STATUS_DETAIL (flux colis) ─────────────────── */
    .rd-flux-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px; }
    .rd-flux-bucket { padding:12px; border-radius:10px; background:white; border:1px solid #e2e8f0; cursor:pointer; transition:all 0.15s; }
    .rd-flux-bucket:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.08); }
    .rd-flux-bucket.empty { opacity:0.55; }
    .rd-flux-bucket.empty:hover { transform:none; box-shadow:none; cursor:default; }
    .rd-flux-header { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .rd-flux-icon { font-size:20px; }
    .rd-flux-label { font-size:12px; color:#334155; font-weight:600; line-height:1.3; }
    .rd-flux-count { font-size:20px; font-weight:800; color:#1e293b; }
    .rd-flux-value { font-size:11px; color:#64748b; margin-top:2px; }
    .rd-flux-critical { border-left:4px solid #dc2626; }
    .rd-flux-signal { border-left:4px solid #f59e0b; }
    .rd-flux-ok { border-left:4px solid #22c55e; }
    .rd-flux-info { border-left:4px solid #cbd5e1; }
    .rd-flux-sev { display:inline-block; font-size:10px; font-weight:700; padding:1px 6px; border-radius:20px; text-transform:uppercase; letter-spacing:0.5px; margin-left:6px; }
    .rd-flux-sev-critical { background:#fee2e2; color:#dc2626; }
    .rd-flux-sev-signal { background:#fef3c7; color:#b45309; }

    /* ── MODAL drill-down ────────────────────────────────── */
    .rd-modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:500; }
    .rd-modal-overlay.open { display:flex; align-items:center; justify-content:center; }
    .rd-modal { background:white; border-radius:12px; width:min(800px, 95vw); max-height:85vh; display:flex; flex-direction:column; }
    .rd-modal-header { padding:16px 20px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; }
    .rd-modal-close { background:none; border:none; font-size:22px; cursor:pointer; color:#64748b; }
    .rd-modal-body { overflow-y:auto; padding:16px 20px; }
    .rd-modal-row { padding:10px 0; border-bottom:1px solid #f1f5f9; }
    .rd-modal-row:last-child { border:none; }
    .rd-modal-row-ref { font-weight:700; color:#1e293b; font-size:14px; }
    .rd-modal-row-meta { font-size:12px; color:#64748b; margin-top:2px; }

    /* ── DIVIDER entre radar et dashboard existant ───────── */
    .rd-divider { height:1px; background:#e2e8f0; margin:20px 0; }
    .rd-divider-label { text-align:center; color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:2px; margin:16px 0; font-weight:700; }

    /* Loading */
    .rd-loading { text-align:center; padding:30px; color:#94a3b8; font-size:14px; }

    /* Responsive */
    @media (max-width: 768px) {
      .rd-alerts-grid, .rd-money-grid, .rd-flux-grid { grid-template-columns:1fr 1fr; gap:8px; }
      .rd-money-value { font-size:18px; }
    }
  `;

  function injectRadarStyles() {
    if (document.getElementById('rd-styles')) return;
    const s = document.createElement('style');
    s.id = 'rd-styles';
    s.textContent = RADAR_CSS;
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════════════════
  // HELPERS API
  // ══════════════════════════════════════════════════════════════════════

  async function apiGet(path) {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error('Erreur ' + res.status);
    return res.json();
  }

  async function apiPost(path) {
    const res = await fetch(path, { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error('Erreur ' + res.status);
    return res.json();
  }

  function fmtKmf(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('fr-FR');
  }

  function fmtDelta(pct, dir) {
    const arrow = dir === 'up' ? '↑' : (dir === 'down' ? '↓' : '→');
    const sign = pct >= 0 ? '+' : '';
    return `${arrow} ${sign}${pct}%`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // RENDER RADAR
  // ══════════════════════════════════════════════════════════════════════

  async function renderRadar(container) {
    injectRadarStyles();

    // Wrapper pour le radar
    const radarDiv = document.createElement('div');
    radarDiv.id = 'rd-wrapper';
    radarDiv.innerHTML = `
      <div id="rd-alerts" class="rd-section rd-alerts-section">
        <div class="rd-loading">🔍 Analyse des signaux…</div>
      </div>
      <div id="rd-money" class="rd-section">
        <div class="rd-loading">💰 Chargement des indicateurs…</div>
      </div>
      <div id="rd-flux" class="rd-section">
        <div class="rd-loading">📦 Analyse du flux colis…</div>
      </div>
      <div class="rd-divider-label">— Détail opérationnel ci-dessous —</div>
    `;
    container.insertBefore(radarDiv, container.firstChild);

    // Charger les 3 zones en parallèle
    Promise.all([
      loadAlerts(),
      loadMoney(),
      loadFlux(),
    ]).catch(err => {
      console.error('[RADAR] erreur:', err);
    });
  }

  // ── Zone Alertes ──────────────────────────────────────────────────────
  async function loadAlerts() {
    const el = document.getElementById('rd-alerts');
    if (!el) return;

    try {
      const data = await apiGet('/api/admin/radar/alerts');
      if (data.total === 0) {
        el.classList.add('empty');
        el.innerHTML = `
          <div class="rd-section-head">
            <h3>🚨 Alertes du jour</h3>
            <div class="rd-ts">${fmtDate(data.generated_at)}</div>
          </div>
          <div class="rd-calm">
            <span class="rd-calm-icon">✓</span>
            <div>
              <strong>Tout est calme.</strong>
              <div style="font-size:13px;color:#64748b;font-weight:400">Aucune alerte critique. Poursuivez le pilotage.</div>
            </div>
          </div>
        `;
        return;
      }

      el.classList.remove('empty');
      el.innerHTML = `
        <div class="rd-section-head">
          <h3>🚨 Alertes du jour — <span style="color:#dc2626">${data.critical}</span> critique(s) · <span style="color:#f59e0b">${data.signal}</span> signal(aux)</h3>
          <button class="rd-refresh" id="btn-radar-refresh">↻ Rafraîchir</button>
        </div>
        <div class="rd-alerts-grid">
          ${data.alerts.map(renderAlert).join('')}
        </div>
      `;

      var refreshBtn = document.getElementById('btn-radar-refresh');
      if (refreshBtn) refreshBtn.addEventListener('click', function() { CT.radar.refresh(); });

      el.querySelectorAll('.rd-alert').forEach(card => {
        card.addEventListener('click', () => {
          const view = card.dataset.view;
          if (view && CT.app && CT.app.navigate) CT.app.navigate(view);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="ct-error" style="margin:10px">❌ Erreur chargement alertes: ${err.message}</div>`;
    }
  }

  function renderAlert(a) {
    const cls = 'rd-alert-' + a.level;
    return `
      <div class="rd-alert ${cls}" data-view="${a.target_view || ''}" data-code="${a.code}">
        <div class="rd-alert-icon">${a.icon}</div>
        <div class="rd-alert-body">
          <div class="rd-alert-title">${escapeHtml(a.title)}</div>
          <div class="rd-alert-action">→ ${escapeHtml(a.action)}</div>
        </div>
        <div class="rd-alert-chevron">›</div>
      </div>
    `;
  }

  // ── Zone Money ────────────────────────────────────────────────────────
  async function loadMoney() {
    const el = document.getElementById('rd-money');
    if (!el) return;

    try {
      const data = await apiGet('/api/admin/radar/money');
      el.innerHTML = `
        <div class="rd-section-head">
          <h3>💰 Indicateurs financiers</h3>
          <div class="rd-ts">${fmtDate(data.generated_at)}</div>
        </div>
        <div class="rd-money-grid">
          ${data.cards.map(renderMoneyCard).join('')}
        </div>
      `;
      el.querySelectorAll('.rd-money-card[data-view]').forEach(c => {
        c.addEventListener('click', () => {
          const v = c.dataset.view;
          if (v && CT.app && CT.app.navigate) CT.app.navigate(v);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="ct-error" style="margin:10px">❌ Erreur chargement finances: ${err.message}</div>`;
    }
  }

  function renderMoneyCard(card) {
    const cmp = card.comparison;
    const clickable = card.action_view ? `data-view="${card.action_view}"` : '';
    const staticClass = card.action_view ? '' : 'static';

    let deltaHtml = '';
    if (cmp) {
      const cls = cmp.direction === 'up' ? 'rd-delta-up' : (cmp.direction === 'down' ? 'rd-delta-down' : 'rd-delta-flat');
      deltaHtml = `
        <div class="rd-money-delta ${cls}">${fmtDelta(cmp.delta_pct, cmp.direction)}</div>
        <div class="rd-money-prev">${escapeHtml(cmp.label)}: ${fmtKmf(cmp.previous_kmf)} KMF</div>
      `;
    }

    return `
      <div class="rd-money-card ${staticClass}" ${clickable}>
        <div class="rd-money-icon">${card.icon}</div>
        <div class="rd-money-label">${escapeHtml(card.label)}</div>
        <div class="rd-money-value">${fmtKmf(card.value_kmf)}<span class="rd-money-unit">KMF</span></div>
        ${card.sub_label ? `<div class="rd-money-sub">${escapeHtml(card.sub_label)}</div>` : ''}
        ${deltaHtml}
      </div>
    `;
  }

  // ── Zone Flux (status_detail) ─────────────────────────────────────────
  async function loadFlux() {
    const el = document.getElementById('rd-flux');
    if (!el) return;

    try {
      const data = await apiGet('/api/admin/radar/status-details');

      // Ordre d'affichage : critical/signal en 1er, puis ok, puis info
      const ORDER = [
        'partial_collected', 'awaiting_stock',  // critical
        'partial_available', 'remaining_in_transit', // signal
        'full_available',                        // ok
        'fully_collected', 'fully_cancelled', 'no_parcels', // info
      ];

      const buckets = ORDER
        .filter(k => data.details[k])
        .map(k => ({ key: k, ...data.details[k] }));

      el.innerHTML = `
        <div class="rd-section-head">
          <h3>📦 Flux colis (${data.total_orders_analyzed} commandes)</h3>
          <div class="rd-ts">${fmtDate(data.generated_at)}</div>
        </div>
        <div class="rd-flux-grid">
          ${buckets.map(renderFluxBucket).join('')}
        </div>
      `;

      el.querySelectorAll('.rd-flux-bucket:not(.empty)').forEach(b => {
        b.addEventListener('click', () => openDrilldown(b.dataset.detail));
      });
    } catch (err) {
      el.innerHTML = `<div class="ct-error" style="margin:10px">❌ Erreur flux colis: ${err.message}</div>`;
    }
  }

  function renderFluxBucket(b) {
    const sevCls = `rd-flux-${b.severity}`;
    const emptyCls = b.count === 0 ? 'empty' : '';
    const sevBadge = (b.severity === 'critical' && b.count > 0)
      ? '<span class="rd-flux-sev rd-flux-sev-critical">⚠️</span>'
      : (b.severity === 'signal' && b.count > 0)
        ? '<span class="rd-flux-sev rd-flux-sev-signal">●</span>'
        : '';

    return `
      <div class="rd-flux-bucket ${sevCls} ${emptyCls}" data-detail="${b.key}" title="${escapeHtml(b.hint)}">
        <div class="rd-flux-header">
          <span class="rd-flux-icon">${b.icon}</span>
          <span class="rd-flux-label">${escapeHtml(b.label)}${sevBadge}</span>
        </div>
        <div class="rd-flux-count">${b.count}</div>
        ${b.count > 0 ? `<div class="rd-flux-value">${fmtKmf(b.value_kmf)} KMF</div>` : ''}
      </div>
    `;
  }

  // ── Drill-down modal ──────────────────────────────────────────────────
  async function openDrilldown(detail) {
    let overlay = document.getElementById('rd-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'rd-modal-overlay';
      overlay.className = 'rd-modal-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="rd-modal">
        <div class="rd-modal-header">
          <h3>📦 Commandes · <code>${detail}</code></h3>
          <button class="rd-modal-close">&times;</button>
        </div>
        <div class="rd-modal-body">
          <div class="rd-loading">Chargement…</div>
        </div>
      </div>
    `;
    overlay.classList.add('open');
    overlay.querySelector('.rd-modal-close').onclick = () => overlay.classList.remove('open');
    overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('open'); };

    try {
      const data = await apiGet(`/api/admin/radar/orders-by-detail/${detail}`);
      const body = overlay.querySelector('.rd-modal-body');

      if (data.count === 0) {
        body.innerHTML = '<div class="rd-loading">Aucune commande dans cette catégorie.</div>';
        return;
      }

      body.innerHTML = `
        <div style="font-size:13px;color:#64748b;margin-bottom:12px">
          <strong>${data.count} commande(s)</strong> · Total: <strong>${fmtKmf(data.total_value_kmf)} KMF</strong>
        </div>
        ${data.orders.map(o => `
          <div class="rd-modal-row">
            <div class="rd-modal-row-ref">
              ${escapeHtml(o.reference || o.id)} — ${fmtKmf(o.total_kmf)} KMF
            </div>
            <div class="rd-modal-row-meta">
              ${escapeHtml(o.recipient_name || '—')} ·
              ${escapeHtml(o.recipient_phone || '—')} ·
              ${fmtDate(o.created_at)} ·
              <code style="font-size:10px">${escapeHtml(o.payment_mode || '')}</code> ·
              colis: [${(o.parcel_statuses || []).join(', ')}]
            </div>
          </div>
        `).join('')}
      `;
    } catch (err) {
      overlay.querySelector('.rd-modal-body').innerHTML = `<div class="ct-error">❌ ${err.message}</div>`;
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Wrap CT.views.dashboard
  // ══════════════════════════════════════════════════════════════════════
  //
  // On attend que ct-views-v7.js ait chargé CT.views.dashboard,
  // puis on wrap en préfixant avec le radar.

  function setupDashboardWrap() {
    const originalDashboard = CT.views.dashboard;
    if (typeof originalDashboard !== 'function') {
      console.warn('[RADAR] CT.views.dashboard non trouvé, radar non actif');
      return;
    }

    CT.views.dashboard = async function(container) {
      // 1. On appelle le dashboard original (intact)
      await originalDashboard(container);
      // 2. On injecte le radar EN HAUT
      await renderRadar(container);
    };

    // Expose refresh + invalidate
    CT.radar = CT.radar || {};
    CT.radar.refresh = async function() {
      try {
        await apiPost('/api/admin/radar/cache/invalidate');
      } catch (_) { /* ignore */ }
      // Re-render complet
      const main = document.getElementById('ct-main');
      if (main) await CT.views.dashboard(main);
    };

    console.log('[RADAR] Dashboard wrap actif (v1.0)');
  }

  // Init différé : on attend que ct-app-v7.js ait chargé CT.views
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(setupDashboardWrap, 50));
  } else {
    setTimeout(setupDashboardWrap, 50);
  }
})();
