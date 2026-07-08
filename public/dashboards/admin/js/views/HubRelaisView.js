/**
 * @komerce-arch
 * @role          admin-hub-relais-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        pipeline.orders[], parcels[]
 * @outputs       hub_panel_dom, relais_panel_dom
 * @depends       api-client.js, filters-store.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  hub-relais, admin-dashboard
 * @version       2026-06
 *
 * KOMERCE Dashboard — HubRelaisView.js  /admin/hub-relais
 * ════════════════════════════════════════════════════════════════════════
 * Fusion des deux vues legacy : CT.views.hub + CT.views.relais
 *   Hub    : 🛒 Commander → 📦 Répartir → ✈️ Expédier
 *   Relais : 💰 Encaisser → 🚢 Réceptionner → 📍 Distribuer
 *
 * Architecture :
 *   - Une seule vue SPA (pas de -v6/-v7/-legacy).
 *   - Appels API via KmcApi uniquement (zéro fetch() brut, zéro ct-api).
 *   - Rôle lu depuis la plateforme moderne (jamais `founder`).
 *
 * Endpoints consommés (tous dans KmcApi) :
 *   getPipeline()                               → commandes groupées par statut (Hub : pending/confirmed/ordered ; Relais : pending cash)
 *   getParcels(params)                         → liste colis filtrée
 *   getParcelKpis()                            → KPIs colis
 *   getParcelAlerts()                          → alertes colis
 *   hubMarkOrdered(ref)                        → confirmed → ordered
 *   hubShip(ref)                               → preparation → shipped (scan)
 *   autoDistribute()                           → répartition automatique
 *   getDistribution()                          → état répartition en cours
 *   relaisConfirmCash(ref)                     → cash pending → confirmed
 *   relaisReceive(ref)                         → in_transit → available
 *   relaisCollect(ref)                         → available → collected
 */

'use strict';

(function (global) {
  'use strict';

  // ── Constantes ────────────────────────────────────────────────────────────

  const TABS_HUB = [
    { id: 'h-commander',   icon: '🛒', label: 'Commander',  color: '#e91e63' },
    { id: 'h-repartir',    icon: '📦', label: 'Répartir',   color: '#3b82f6' },
    { id: 'h-expedier',    icon: '✈️', label: 'Expédier',   color: '#8b5cf6' },
  ];

  const TABS_RELAIS = [
    { id: 'r-encaisser',     icon: '💰', label: 'Encaisser',    color: '#e91e63' },
    { id: 'r-receptionner',  icon: '🚢', label: 'Réceptionner', color: '#8b5cf6' },
    { id: 'r-distribuer',    icon: '📍', label: 'Distribuer',   color: '#22c55e' },
  ];

  const MS_48H  = 48  * 3_600_000;
  const MS_36H  = 36  * 3_600_000;
  const MS_72H  = 72  * 3_600_000;
  const MS_10D  = 10  * 86_400_000;
  const MS_7D   =  7  * 86_400_000;

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = 'kmc-toast';
    const bg = type === 'error' ? '#991b1b' : '#065f46';
    el.style.cssText =
      `position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;
       border-radius:10px;font-size:14px;font-weight:600;color:#fff;
       background:${bg};box-shadow:0 4px 20px rgba(0,0,0,.2);
       animation:kmc-toast-in .2s ease;pointer-events:none`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2800);
    setTimeout(() => el.remove(), 3200);
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  function fmtKmf(v) {
    if (v == null) return '—';
    return new Intl.NumberFormat('fr-FR').format(Math.round(v)) + ' KMF';
  }

  function fmtAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3_600_000);
    if (h < 1)  return `${Math.floor(diff / 60_000)} min`;
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}j`;
  }

  // ── Escape helper (XSS guard for error messages) ─────────────────────────

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Shared UI primitives ──────────────────────────────────────────────────

  function kpiChip(count, color, label) {
    const active = count > 0;
    return `<span class="hr-kpi-chip" style="background:${active ? color + '18' : 'var(--surface-2,#f1f5f9)'};color:${active ? color : 'var(--text-tertiary,#94a3b8)'}">
      ${label} <b>${count}</b>
    </span>`;
  }

  function emptyState(text = '✅ Rien à traiter') {
    return `<div class="hr-empty-state">${text}</div>`;
  }

  function alertChip(icon, label, count, color) {
    if (!count) return '';
    return `<div class="hr-alert-chip" style="background:${color}0a;border-color:${color}30">
      <span>${icon}</span><span class="hr-alert-chip-label">${label}</span>
      <strong style="color:${color}">${count}</strong>
    </div>`;
  }

  // ── Tab system ────────────────────────────────────────────────────────────

  /**
   * Renders a tab bar + panels inside rootEl.
   * @param {HTMLElement} rootEl
   * @param {Array<{id,icon,label,color}>} tabs
   * @param {Record<string, {count:number, content:string}>} panels
   * @param {string} activeId  — tab id to show first
   */
  function renderTabset(rootEl, tabs, panels, activeId) {
    // Tab bar
    const bar = rootEl.querySelector('.hr-tabbar');

    tabs.forEach(t => {
      const btn = bar.querySelector(`[data-tab="${t.id}"]`);
      if (!btn) return;
      const cnt = panels[t.id]?.count ?? 0;
      const active = t.id === activeId;
      btn.style.borderBottomColor = active ? t.color : 'transparent';
      btn.style.background        = active ? `${t.color}0a` : 'transparent';
      btn.style.color             = active ? t.color : 'var(--text-secondary,#64748b)';
      const badge = cnt > 0
        ? `<span style="background:${t.color};color:#fff;border-radius:8px;padding:1px 7px;font-size:var(--fs-sm);margin-left:5px">${cnt}</span>`
        : '';
      btn.innerHTML = `${t.icon} ${t.label}${badge}`;
    });

    // Panels
    rootEl.querySelectorAll('.hr-panel').forEach(p => {
      const show = p.dataset.panel === activeId;
      p.style.display = show ? 'block' : 'none';
      if (show && panels[p.dataset.panel]) {
        p.innerHTML = panels[p.dataset.panel].content;
      }
    });
  }

  function switchTab(containerEl, tabs, panels, tabId) {
    tabs.forEach(t => {
      const btn = containerEl.querySelector(`[data-tab="${t.id}"]`);
      if (!btn) return;
      const active = t.id === tabId;
      btn.style.borderBottomColor = active ? t.color : 'transparent';
      btn.style.background        = active ? `${t.color}0a` : 'transparent';
      btn.style.color             = active ? t.color : 'var(--text-secondary,#64748b)';
    });
    containerEl.querySelectorAll('.hr-panel').forEach(p => {
      const show = p.dataset.panel === tabId;
      p.style.display = show ? 'block' : 'none';
    });
  }

  // ── Action helpers (delegates to KmcApi mutations) ────────────────────────

  async function doAction(btn, originalLabel, apiFn, successMsg, refreshFn) {
    if (!confirm(`${successMsg} — confirmer ?`)) return;
    btn.disabled = true;
    btn.textContent = '⏳…';
    try {
      await apiFn();
      showToast(`✅ ${successMsg}`);
      refreshFn();
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  // ── Dense table builder ───────────────────────────────────────────────────

  function denseTable(headers, rowsHtml) {
    if (!rowsHtml) return emptyState();
    return `
      <div class="hr-table-wrap">
        <table class="data-table hr-dense-table">
          <thead><tr>
            ${headers.map(h => `<th>${h}</th>`).join('')}
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  function orderRow(o, btnLabel, btnDataAction) {
    let items = [];
    try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch (_) {}
    const desc = `${items.length || o.nb_items || 0} art. · ${fmtKmf(o.total_kmf)} · ${o.relais_island || '—'}`;
    return `<tr>
      <td class="hr-td-ref">${o.reference}</td>
      <td>${o.client_name || 'Client'}</td>
      <td class="hr-td-secondary">${desc}</td>
      <td class="hr-td-muted hr-td-nowrap">${fmtAgo(o.created_at)}</td>
      <td class="hr-td-action">
        <button data-action="${btnDataAction}" data-ref="${o.reference}"
          class="btn btn-sm hr-btn-action">${btnLabel}</button>
      </td>
    </tr>`;
  }

  function parcelRow(p, btnLabel, btnDataAction, btnColor) {
    const desc = `${p.main_order_ref || '—'} · ${p.nb_items || 0} art. · ${p.destination_island || p.relais_island || '—'}`;
    return `<tr>
      <td class="hr-td-ref">${p.reference}</td>
      <td>${p.recipient_name || 'Client'}</td>
      <td class="hr-td-secondary">${desc}</td>
      <td class="hr-td-muted"></td>
      <td class="hr-td-action">
        <button data-action="${btnDataAction}" data-ref="${p.reference}"
          class="btn btn-sm hr-btn-action" style="background:${btnColor}18;color:${btnColor}">${btnLabel}</button>
      </td>
    </tr>`;
  }

  // ── Mini preview table (bottom forecast panels) ───────────────────────────

  function miniTable(items, cols, limit = 8) {
    if (!items || !items.length) return `<div class="hr-muted-sm" style="padding:6px">—</div>`;
    let h = '<table class="hr-mini-table">';
    items.slice(0, limit).forEach((item, i) => {
      h += `<tr class="${i % 2 ? 'hr-row-alt' : ''}">`;
      cols.forEach(col => { h += `<td>${col(item)}</td>`; });
      h += '</tr>';
    });
    if (items.length > limit) {
      h += `<tr><td colspan="99" class="hr-muted-sm hr-td-more">+ ${items.length - limit} autres…</td></tr>`;
    }
    return h + '</table>';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🏭  HUB section
  // ─────────────────────────────────────────────────────────────────────────

  function buildHubSkeleton() {
    const tabsHtml = TABS_HUB.map(t =>
      `<button class="ct-tab hr-tab-btn" data-tab="${t.id}">${t.icon} ${t.label}</button>`
    ).join('');

    const panelsHtml = TABS_HUB.map(t =>
      `<div class="hr-panel" data-panel="${t.id}"><div class="hr-loading-msg">Chargement…</div></div>`
    ).join('');

    return `
      <div class="hr-hub-wrapper">
        <div class="hr-section-topbar">
          <div>
            <h2 class="hr-section-title">🏭 Hub</h2>
            <span class="hr-section-sub">Commander · Emballer · Expédier</span>
          </div>
          <button class="btn btn-secondary btn-sm btn-refresh-hub">🔄</button>
        </div>
        <div class="hub-kpi-chips hr-kpi-row"></div>
        <div class="hr-tabbar">
          ${tabsHtml}
        </div>
        ${panelsHtml}
        <div class="hub-bottom-grid hr-bottom-grid">
          <div class="card hub-forecast" style="padding:12px">
            <h4 class="hr-card-title" style="color:#6366f1">📋 Prévisionnel</h4>
            <div class="forecast-content hr-muted-sm">Chargement…</div>
          </div>
          <div class="card hub-alerts" style="padding:12px">
            <h4 class="hr-card-title" style="color:#ef4444">🚨 Alertes</h4>
            <div class="alerts-content hr-muted-sm">Chargement…</div>
          </div>
        </div>
      </div>`;
  }

  async function populateHub(wrapperEl, refreshView) {
    const [pipelineData, parcelsData] = await Promise.all([
      KmcApi.getPipeline(),
      KmcApi.getParcels({ limit: 500 }),
    ]);

    const pl       = pipelineData.pipeline || {};
    const orders    = [
      ...(pl.pending?.orders     || []),
      ...(pl.confirmed?.orders   || []),
      ...(pl.ordered?.orders     || []),
    ];
    const parcels  = parcelsData.parcels || [];

    // ── Segmentation orders ──
    const confirmed  = orders.filter(o => o.status === 'confirmed');
    const ordered    = orders.filter(o => o.status === 'ordered');
    const pending    = orders.filter(o => o.status === 'pending');

    // Ordered sans colis existant → prêts à emballer
    const parcelRefs = new Set(parcels.map(p => p.main_order_ref).filter(Boolean));
    const readyParcel = ordered.filter(o => !parcelRefs.has(o.reference));

    // ── Segmentation colis ──
    const prepP     = parcels.filter(p => p.status === 'preparation');
    const shippedP  = parcels.filter(p => p.status === 'shipped');
    const transitP  = parcels.filter(p => p.status === 'in_transit');

    // ── Alertes hub ──
    const now = Date.now();
    const stuck48h    = confirmed.filter(o => o.created_at && (now - new Date(o.created_at).getTime()) > MS_48H);
    const stuckOrd48h = ordered.filter(o =>  o.created_at && (now - new Date(o.created_at).getTime()) > MS_48H);
    const expired36h  = pending.filter(o =>  o.created_at && (now - new Date(o.created_at).getTime()) > MS_36H);
    const critical7d  = [...ordered, ...confirmed].filter(o => o.created_at && (now - new Date(o.created_at).getTime()) > MS_7D);
    const alertCount  = stuck48h.length + stuckOrd48h.length + expired36h.length + critical7d.length;

    // ── KPI chips ──
    wrapperEl.querySelector('.hub-kpi-chips').innerHTML = [
      kpiChip(confirmed.length,                '#e91e63', '🛒 Commander'),
      kpiChip(readyParcel.length,              '#3b82f6', '📦 Emballer'),
      kpiChip(prepP.length,                    '#8b5cf6', '✈️ Expédier'),
      kpiChip(shippedP.length + transitP.length, '#22c55e', '🚀 En route'),
      kpiChip(pending.length,                  '#94a3b8', '⏳ Attente'),
      kpiChip(alertCount,                      '#ef4444', '🚨 Alertes'),
    ].join('');

    // ── Tab panels content ──
    const firstActive = confirmed.length > 0 ? 'h-commander' : readyParcel.length > 0 ? 'h-repartir' : 'h-expedier';

    const panelCommander = denseTable(
      ['Réf', 'Client', 'Détails', 'Âge', ''],
      confirmed.length ? confirmed.map(o => orderRow(o, '🛒 Commander', 'hub-mark-ordered')).join('') : null
    );

    const panelRepartir = `
      <div class="hr-repartir-bar">
        <span class="hr-td-secondary">Répartition automatique par destination</span>
        <button class="btn btn-primary btn-auto-distribute">🤖 Répartir maintenant</button>
      </div>
      <div class="distribution-panel hr-dist-loading">
        ⏳ Chargement répartition…
      </div>`;

    const panelExpedier = denseTable(
      ['Colis', 'Client', 'Détails', '', ''],
      prepP.length ? prepP.map(p => parcelRow(p, '✈️ Expédier', 'hub-ship', '#7c3aed')).join('') : null
    );

    const panels = {
      'h-commander': { count: confirmed.length,  content: panelCommander },
      'h-repartir':  { count: readyParcel.length, content: panelRepartir },
      'h-expedier':  { count: prepP.length,       content: panelExpedier },
    };

    renderTabset(wrapperEl, TABS_HUB, panels, firstActive);

    // ── Tab click wiring ──
    wrapperEl.querySelectorAll('.hr-tabbar .ct-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(wrapperEl, TABS_HUB, panels, btn.dataset.tab));
    });

    // ── Forecast ──
    const enRoute = [...shippedP, ...transitP];
    wrapperEl.querySelector('.forecast-content').innerHTML = `
      <div class="hr-forecast-label">🛍️ Attente paiement (${pending.length})</div>
      ${miniTable(pending, [
        o => `<strong>${o.reference}</strong>`,
        o => o.client_name || '—',
        o => o.payment_mode === 'stripe_eur' ? '💳' : '💰',
        o => fmtAgo(o.created_at),
      ])}
      <div class="hr-forecast-label">📋 À répartir (${ordered.length})</div>
      ${miniTable(ordered, [
        o => `<strong>${o.reference}</strong>`,
        o => o.client_name || '—',
        o => `${o.nb_items || '—'} art.`,
        o => fmtAgo(o.created_at),
      ])}
      <div class="hr-forecast-label">🚀 En route (${enRoute.length})</div>
      ${miniTable(enRoute, [
        p => `<strong>${p.reference}</strong>`,
        p => `🏝️ ${p.destination_island || '—'}`,
        p => fmtAgo(p.shipped_at || p.created_at),
      ])}`;

    // ── Alertes ──
    wrapperEl.querySelector('.alerts-content').innerHTML = alertCount === 0
      ? '<div class="hr-no-alert">✅ Aucune alerte</div>'
      : [
          alertChip('💸', 'Paiements expirés >36h', expired36h.length, '#e91e63'),
          alertChip('🛒', 'Confirmés bloqués >48h', stuck48h.length,   '#ef4444'),
          alertChip('⏰', 'Ordered bloqué >48h',    stuckOrd48h.length,'#ef4444'),
          alertChip('🔴', 'Critique >7 jours',       critical7d.length, '#dc2626'),
        ].join('');

    // ── Load distribution panel ──
    await loadDistributionPanel(wrapperEl.querySelector('.distribution-panel'), refreshView);

    // ── Wire refresh ──
    wrapperEl.querySelector('.btn-refresh-hub').addEventListener('click', () => refreshView('hub'));

    // ── Wire commander actions ──
    wrapperEl.querySelectorAll('[data-action="hub-mark-ordered"]').forEach(btn => {
      btn.addEventListener('click', () => doAction(
        btn, '🛒 Commander',
        () => KmcApi.hubMarkOrdered(btn.dataset.ref),
        `${btn.dataset.ref} → commandé 📋`,
        () => refreshView('hub')
      ));
    });

    // ── Wire expédier actions ──
    wrapperEl.querySelectorAll('[data-action="hub-ship"]').forEach(btn => {
      btn.addEventListener('click', () => doAction(
        btn, '✈️ Expédier',
        () => KmcApi.hubShip(btn.dataset.ref),
        `${btn.dataset.ref} expédié ✈️`,
        () => refreshView('hub')
      ));
    });

    // ── Wire auto-distribute ──
    const distBtn = wrapperEl.querySelector('.btn-auto-distribute');
    if (distBtn) {
      distBtn.addEventListener('click', async () => {
        distBtn.disabled = true;
        distBtn.textContent = '⏳ Répartition…';
        try {
          const r = await KmcApi.autoDistribute();
          showToast(`✅ ${r.distributed || 0} commande(s) répartie(s) 📦`);
          await loadDistributionPanel(wrapperEl.querySelector('.distribution-panel'), refreshView);
          refreshView('hub');
        } catch (e) {
          showToast(`❌ ${e.message}`, 'error');
        }
        distBtn.disabled = false;
        distBtn.textContent = '🤖 Répartir maintenant';
      });
    }
  }

  async function loadDistributionPanel(panelEl, refreshView) {
    if (!panelEl) return;
    try {
      const data    = await KmcApi.getDistribution();
      const parcels    = data.parcels    || [];
      const unassigned = data.unassigned || [];
      const saturated  = data.saturated  || [];

      const totalOrders = parcels.reduce((s, p) => s + (p.orders_count || 0), 0);
      const totalItems  = parcels.reduce((s, p) => s + (p.items_count  || 0), 0);

      let html = `<div class="hr-kpi-row">
        ${kpiChip(parcels.length,    '#3b82f6', '📦 Colis')}
        ${kpiChip(totalOrders,       '#8b5cf6', '🛍️ Cmds')}
        ${kpiChip(totalItems,        '#22c55e', '📋 Articles')}
        ${kpiChip(unassigned.length, '#e91e63', '⏳ Non assignés')}
      </div>`;

      if (!parcels.length && !unassigned.length) {
        html += emptyState('✅ Aucune commande à répartir');
      }

      parcels.forEach(p => {
        let orders = [];
        try { orders = typeof p.orders === 'string' ? JSON.parse(p.orders) : (p.orders || []); } catch (_) {}
        const st = p.status || p.parcel_status || 'draft';
        const stColor = st === 'draft' ? '#880e4f' : st === 'preparation' ? '#1e40af' : '#065f46';
        const stBg    = st === 'draft' ? '#fce4ec' : st === 'preparation' ? '#dbeafe'  : '#d1fae5';
        const shipBtn = st === 'preparation'
          ? `<button data-action="dist-ship" data-ref="${p.reference}" class="btn btn-primary btn-sm">✈️ Expédier</button>`
          : '';

        const ordRows = orders.map(o => `
          <tr>
            <td class="hr-td-ref-sm">${o.ref || '—'}</td>
            <td>${o.customer || '—'}</td>
            <td class="hr-td-secondary">${o.items_count || o.items || '?'} art.</td>
            <td class="hr-td-right">${fmtKmf(o.total_kmf || o.total || 0)}</td>
          </tr>`).join('');

        html += `
          <div class="hr-dist-card">
            <div class="hr-dist-card-head">
              <div class="hr-dist-card-info">
                <strong class="hr-dist-ref">📦 ${p.reference}</strong>
                <span class="hr-dist-status-badge" style="background:${stBg};color:${stColor}">
                  ${p.relais_name || p.relais_island || p.destination || '—'}
                </span>
                <span class="hr-td-secondary">
                  ${p.orders_count || 0} cmd · ${p.items_count || 0} art. · ${fmtKmf(p.total_kmf || 0)}
                </span>
              </div>
              <div class="hr-dist-card-actions">
                <span class="hr-dist-status-badge" style="background:${stBg};color:${stColor}">${st}</span>
                ${shipBtn}
              </div>
            </div>
            ${ordRows ? `<table style="width:100%;border-collapse:collapse"><tbody>${ordRows}</tbody></table>` : ''}
          </div>`;
      });

      // Saturation alerts
      saturated.forEach(s => {
        html += `
          <div class="hr-alert-saturation">
            <span class="hr-alert-saturation-icon">🚨</span>
            <div>
              <strong style="color:#880e4f">${s.destination} — Capacité max atteinte</strong>
              <div style="font-size:var(--fs-sm);color:#880e4f">
                ${s.open_parcels} colis ouverts (max ${data.limits?.MAX_OPEN_PARCELS_PER_DEST || 3}),
                ${s.queued_orders} commande(s) en file
              </div>
              <div class="hr-alert-saturation-cta">✈️ Expédiez les colis en cours pour débloquer</div>
            </div>
          </div>`;
      });

      if (unassigned.length) {
        html += `
          <div class="hr-alert-unassigned">
            <div class="hr-alert-unassigned-title">⏳ ${unassigned.length} commande(s) non assignée(s)</div>
            ${unassigned.map(o => `
              <div class="hr-unassigned-row">
                <span><strong>${o.reference}</strong> — ${o.client_name || '?'}</span>
                <span class="hr-td-secondary">${o.items_count || '?'} art. · ${o.relais_name || o.relais_island || '?'}</span>
              </div>`).join('')}
            <div class="hr-alert-unassigned-hint">
              Cliquez « 🤖 Répartir maintenant » pour les assigner automatiquement.
            </div>
          </div>`;
      }

      panelEl.innerHTML = html;

      // Wire dist-ship buttons
      panelEl.querySelectorAll('[data-action="dist-ship"]').forEach(btn => {
        btn.addEventListener('click', () => doAction(
          btn, '✈️ Expédier',
          () => KmcApi.hubShip(btn.dataset.ref),
          `${btn.dataset.ref} expédié ✈️`,
          () => refreshView('hub')
        ));
      });

    } catch (e) {
      panelEl.innerHTML = `<div style="color:#ef4444;font-size:var(--fs-sm)">❌ ${esc(e.message)}</div>`; // FRESH-104
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 📦  RELAIS section
  // ─────────────────────────────────────────────────────────────────────────

  function buildRelaisSkeleton() {
    const tabsHtml = TABS_RELAIS.map(t =>
      `<button class="ct-tab hr-tab-btn" data-tab="${t.id}">${t.icon} ${t.label}</button>`
    ).join('');

    const panelsHtml = TABS_RELAIS.map(t =>
      `<div class="hr-panel" data-panel="${t.id}"><div class="hr-loading-msg">Chargement…</div></div>`
    ).join('');

    return `
      <div class="hr-relais-wrapper">
        <div class="hr-section-topbar">
          <div>
            <h2 class="hr-section-title">📦 Relais</h2>
            <span class="hr-section-sub">Encaisser · Réceptionner · Distribuer</span>
          </div>
          <button class="btn btn-secondary btn-sm btn-refresh-relais">🔄</button>
        </div>
        <div class="relais-kpi-chips hr-kpi-row"></div>
        <div class="hr-tabbar">
          ${tabsHtml}
        </div>
        ${panelsHtml}
        <div class="relais-bottom-grid hr-bottom-grid">
          <div class="card relais-forecast" style="padding:12px">
            <h4 class="hr-card-title" style="color:#6366f1">📋 Prévisionnel</h4>
            <div class="forecast-content hr-muted-sm">Chargement…</div>
          </div>
          <div class="card relais-alerts" style="padding:12px">
            <h4 class="hr-card-title" style="color:#ef4444">🚨 Alertes</h4>
            <div class="alerts-content hr-muted-sm">Chargement…</div>
          </div>
        </div>
      </div>`;
  }

  async function populateRelais(wrapperEl, refreshView) {
    const [pipelineData, parcelsData] = await Promise.all([
      KmcApi.getPipeline(),
      KmcApi.getParcels({ limit: 500 }),
    ]);

    const pl      = pipelineData.pipeline || {};
    const orders  = pl.pending?.orders || [];
    const parcels = parcelsData.parcels || [];

    // ── Segmentation ──
    const cashPending = orders.filter(o =>
      o.status === 'pending' &&
      (o.payment_mode === 'cash_relay' || o.payment_mode === 'cash_relais') &&
      o.payment_status !== 'paid'
    );
    const transitP   = parcels.filter(p => p.status === 'in_transit');
    const shippedP   = parcels.filter(p => p.status === 'shipped');
    const availableP = parcels.filter(p => p.status === 'available');
    const collectedP = parcels.filter(p => p.status === 'collected');

    // ── Alertes relais ──
    const now = Date.now();
    const uncollected72 = availableP.filter(p => p.updated_at && (now - new Date(p.updated_at).getTime()) > MS_72H);
    const lateTransit   = [...transitP, ...shippedP].filter(p => p.created_at && (now - new Date(p.created_at).getTime()) > MS_10D);
    const cashExpired   = cashPending.filter(o => o.created_at && (now - new Date(o.created_at).getTime()) > MS_36H);
    const alertCount    = uncollected72.length + lateTransit.length + cashExpired.length;

    // ── KPI chips ──
    wrapperEl.querySelector('.relais-kpi-chips').innerHTML = [
      kpiChip(cashPending.length, '#e91e63', '💰 Cash'),
      kpiChip(transitP.length,    '#8b5cf6', '🚢 Transit'),
      kpiChip(availableP.length,  '#22c55e', '📍 Distribuer'),
      kpiChip(collectedP.length,  '#16a34a', '✅ Collectés'),
      kpiChip(alertCount,         '#ef4444', '🚨 Alertes'),
    ].join('');

    const firstActive = cashPending.length > 0 ? 'r-encaisser'
                      : transitP.length > 0    ? 'r-receptionner'
                      : 'r-distribuer';

    // ── Panel: Encaisser cash ──
    const panelEncaisser = denseTable(
      ['Réf', 'Client', 'Détails', 'Âge', ''],
      cashPending.length ? cashPending.map(o => {
        const desc = `${o.nb_items || 0} art. · ${fmtKmf(o.total_kmf)}${o.cash_code ? ` · 🔑 ${o.cash_code}` : ''}`;
        return `<tr>
          <td class="hr-td-ref">${o.reference}</td>
          <td>${o.client_name || 'Client'}</td>
          <td class="hr-td-secondary">${desc}</td>
          <td class="hr-td-muted hr-td-nowrap">${fmtAgo(o.created_at)}</td>
          <td class="hr-td-action">
            <button data-action="relais-confirm-cash" data-ref="${o.reference}"
              class="btn btn-sm hr-btn-action">💰 Encaisser</button>
          </td>
        </tr>`;
      }).join('') : null
    );

    // ── Panel: Réceptionner ──
    const panelReceptionner = denseTable(
      ['Colis', 'Client', 'Détails', 'Expédié', ''],
      transitP.length ? transitP.map(p => parcelRow(p, '📍 Réceptionner', 'relais-arrived', '#7c3aed')).join('') : null
    );

    // ── Panel: Distribuer ──
    const panelDistribuer = denseTable(
      ['Colis', 'Client', 'Détails', 'Dispo', ''],
      availableP.length ? availableP.map(p => {
        const desc = `${p.nb_items || 0} art. · ${fmtKmf(p.total_kmf)}${p.pickup_code ? ` · 🔑 ${p.pickup_code}` : ''}`;
        return `<tr>
          <td class="hr-td-ref">${p.reference}</td>
          <td>${p.recipient_name || 'Client'}</td>
          <td class="hr-td-secondary">${desc}</td>
          <td class="hr-td-muted hr-td-nowrap">${fmtAgo(p.updated_at || p.created_at)}</td>
          <td class="hr-td-action">
            <button data-action="relais-collected" data-ref="${p.reference}"
              class="btn btn-sm hr-btn-action" style="background:var(--kmc-green-bg,#06504618);color:var(--kmc-green,#065f46)">✅ Remis</button>
          </td>
        </tr>`;
      }).join('') : null
    );

    const panels = {
      'r-encaisser':    { count: cashPending.length, content: panelEncaisser    },
      'r-receptionner': { count: transitP.length,    content: panelReceptionner },
      'r-distribuer':   { count: availableP.length,  content: panelDistribuer   },
    };

    renderTabset(wrapperEl, TABS_RELAIS, panels, firstActive);

    wrapperEl.querySelectorAll('.hr-tabbar .ct-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(wrapperEl, TABS_RELAIS, panels, btn.dataset.tab));
    });

    // ── Forecast ──
    wrapperEl.querySelector('.forecast-content').innerHTML = `
      <div class="hr-forecast-label">✈️ En route (${shippedP.length})</div>
      ${miniTable(shippedP, [
        p => `<strong>${p.reference}</strong>`,
        p => p.recipient_name || '—',
        p => `🏝️ ${p.destination_island || '—'}`,
        p => fmtAgo(p.shipped_at || p.created_at),
      ])}
      <div class="hr-forecast-label">✅ Récentes (${collectedP.length})</div>
      ${miniTable(collectedP, [
        p => `<strong>${p.reference}</strong>`,
        p => p.recipient_name || '—',
        p => `🏝️ ${p.destination_island || '—'}`,
        p => fmtAgo(p.updated_at || p.created_at),
      ])}`;

    // ── Alertes ──
    wrapperEl.querySelector('.alerts-content').innerHTML = alertCount === 0
      ? '<div class="hr-no-alert">✅ Aucune alerte</div>'
      : [
          alertChip('💸', 'Cash expiré >36h',      cashExpired.length,   '#e91e63'),
          alertChip('⏰', 'Non collectés >72h',     uncollected72.length, '#ef4444'),
          alertChip('🚢', 'Transit tardif >10 jours', lateTransit.length, '#dc2626'),
        ].join('');

    // ── Wire refresh ──
    wrapperEl.querySelector('.btn-refresh-relais').addEventListener('click', () => refreshView('relais'));

    // ── Wire actions ──
    wrapperEl.querySelectorAll('[data-action="relais-confirm-cash"]').forEach(btn => {
      btn.addEventListener('click', () => doAction(
        btn, '💰 Encaisser',
        () => KmcApi.relaisConfirmCash(btn.dataset.ref),
        `Cash confirmé ${btn.dataset.ref} 💰`,
        () => refreshView('relais')
      ));
    });

    wrapperEl.querySelectorAll('[data-action="relais-arrived"]').forEach(btn => {
      btn.addEventListener('click', () => doAction(
        btn, '📍 Réceptionner',
        () => KmcApi.relaisReceive(btn.dataset.ref),
        `${btn.dataset.ref} réceptionné 📍`,
        () => refreshView('relais')
      ));
    });

    wrapperEl.querySelectorAll('[data-action="relais-collected"]').forEach(btn => {
      btn.addEventListener('click', () => doAction(
        btn, '✅ Remis',
        () => KmcApi.relaisCollect(btn.dataset.ref),
        `${btn.dataset.ref} remis au client ✔️`,
        () => refreshView('relais')
      ));
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🎛️  TOP-LEVEL MODE SWITCHER (Hub / Relais)
  // ─────────────────────────────────────────────────────────────────────────

  const MODES = [
    { id: 'hub',    icon: '🏭', label: 'Hub',    subtitle: 'Commander · Emballer · Expédier', color: '#3b82f6' },
    { id: 'relais', icon: '📦', label: 'Relais', subtitle: 'Encaisser · Réceptionner · Distribuer', color: '#22c55e' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // 🚀  PUBLIC render()
  // ─────────────────────────────────────────────────────────────────────────

  async function render(rootEl) {
    // ── Shell ──
    rootEl.innerHTML = `
      <style>
        @keyframes kmc-toast-in { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:none; } }

        /* ── Mode bar ── */
        .hr-mode-bar { display:flex; border-bottom:1px solid var(--border,#e2e8f0); }
        .hr-mode-btn { padding:14px 24px; border:none; border-bottom:3px solid transparent;
          background:transparent; font-size:14px; font-weight:600; cursor:pointer;
          color:var(--text-secondary,#64748b); transition:all .15s; }
        .hr-mode-btn.active {
          border-bottom-color: var(--hr-active-color, #3b82f6);
          color: var(--hr-active-color, #3b82f6);
        }
        .hr-mode-subtitle { font-size:var(--fs-sm); font-weight:400; opacity:.75; }

        /* ── Content area ── */
        .hr-content { padding:12px; }
        .hr-hub-wrapper, .hr-relais-wrapper { padding:12px 0; }
        .hr-section-topbar { display:flex; align-items:center; justify-content:space-between;
          flex-wrap:wrap; gap:8px; margin-bottom:12px; }
        .hr-section-title { margin:0; font-size:20px; }
        .hr-section-sub { color:var(--text-secondary,#64748b); font-size:var(--fs-sm); }

        /* ── KPI chips ── */
        .hr-kpi-row { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
        .hr-kpi-chip { display:inline-flex; align-items:center; gap:4px;
          padding:var(--sp-1) var(--sp-3); border-radius:12px;
          font-size:var(--fs-sm); font-weight:600; }

        /* ── Tab bar ── */
        .hr-tabbar { display:flex; border-bottom:1px solid var(--border,#e2e8f0); }
        .hr-tab-btn { padding:8px 16px; border:none; border-bottom:3px solid transparent;
          background:transparent; color:var(--text-secondary,#64748b);
          font-size:var(--fs-sm); font-weight:600; cursor:pointer; transition:all .15s; }

        /* ── Panels ── */
        .hr-panel { display:none; background:var(--surface,#fff);
          border:1px solid var(--border,#e2e8f0); border-top:none;
          border-radius:0 0 8px 8px; padding:8px; }
        .hr-loading-msg { color:var(--text-tertiary,#94a3b8); padding:20px; text-align:center; }
        .hr-loading-full { text-align:center; padding:48px; color:var(--text-tertiary,#94a3b8); }

        /* ── Tables ── */
        .hr-table-wrap { overflow-x:auto; }
        .hr-dense-table { width:100%; }
        .hr-dense-table th { padding:6px 10px; text-align:left;
          font-size:var(--fs-sm); color:var(--text-tertiary,#94a3b8);
          font-weight:600; text-transform:uppercase;
          border-bottom:1px solid var(--border,#e2e8f0);
          background:var(--surface-2,#f8fafc); }
        .hr-dense-table td { padding:8px 10px; border-bottom:1px solid var(--border,#f1f5f9); }
        .hr-dense-table tr:last-child td { border-bottom:none; }
        .hr-td-ref { font-weight:700; color:var(--kmc-blue,#1e40af); font-size:var(--fs-sm); white-space:nowrap; }
        .hr-td-ref-sm { font-weight:600; color:var(--kmc-blue,#1e40af); font-size:var(--fs-sm); }
        .hr-td-secondary { font-size:var(--fs-sm); color:var(--text-secondary,#64748b); }
        .hr-td-muted { font-size:var(--fs-sm); color:var(--text-tertiary,#94a3b8); }
        .hr-td-nowrap { white-space:nowrap; }
        .hr-td-action { padding:8px 6px !important; text-align:right; } /* guard: data-table td override */
        .hr-td-right { text-align:right; }
        .hr-btn-action { background:var(--kmc-amber-bg,#b4530918); color:var(--kmc-amber,#b45309);
          white-space:nowrap; }

        /* ── Mini table ── */
        .hr-mini-table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
        .hr-mini-table td { padding:var(--sp-1) var(--sp-3); }
        .hr-row-alt { background:#fafbfd; }
        .hr-row-alt td { border-bottom:1px solid var(--surface-2,#f8fafc); }
        .hr-td-more { color:var(--text-tertiary,#94a3b8); }

        /* ── Bottom grid (forecast / alertes) ── */
        .hr-bottom-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:16px; }
        .hr-card-title { margin:0 0 10px; font-size:14px; }
        .hr-muted-sm { color:var(--text-tertiary,#94a3b8); font-size:var(--fs-sm); }
        .hr-forecast-label { font-size:var(--fs-sm); font-weight:600;
          color:var(--text-tertiary,#94a3b8); margin-bottom:4px; display:block; margin-top:8px; }
        .hr-no-alert { color:#22c55e; text-align:center; padding:20px; font-size:var(--fs-sm); }

        /* ── Alert chips ── */
        .hr-alert-chip { display:flex; align-items:center; gap:8px; padding:8px 12px;
          border:1px solid; border-radius:8px; margin-bottom:6px; font-size:var(--fs-sm); }
        .hr-alert-chip-label { flex:1; }
        .hr-empty-state { padding:20px; text-align:center;
          color:var(--text-tertiary,#94a3b8); font-size:var(--fs-sm); }

        /* ── Répartition panel ── */
        .hr-repartir-bar { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
        .hr-dist-loading { color:var(--text-tertiary,#94a3b8); font-size:var(--fs-sm);
          text-align:center; padding:12px; }
        .hr-dist-card { background:var(--surface-2,#f8fafc); border:1px solid var(--border,#e2e8f0);
          border-radius:8px; padding:10px; margin-bottom:8px; }
        .hr-dist-card-head { display:flex; align-items:center; justify-content:space-between;
          margin-bottom:6px; }
        .hr-dist-card-info { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .hr-dist-card-actions { display:flex; align-items:center; gap:6px; }
        .hr-dist-ref { color:var(--kmc-blue,#1e40af); font-size:14px; }
        .hr-dist-status-badge { font-size:var(--fs-sm); padding:2px 8px; border-radius:10px; }

        /* ── Saturation & unassigned alerts ── */
        .hr-alert-saturation { background:#fce4ec; border:2px solid #e91e63;
          border-radius:8px; padding:10px 14px; margin-bottom:10px;
          display:flex; align-items:center; gap:8px; }
        .hr-alert-saturation-icon { font-size:20px; }
        .hr-alert-saturation-cta { font-size:var(--fs-sm); color:#c62828; font-weight:600; margin-top:2px; }
        .hr-alert-unassigned { background:#fce4ec; border:1px solid #f48fb1;
          border-radius:8px; padding:10px; margin-top:8px; }
        .hr-alert-unassigned-title { font-size:var(--fs-sm); font-weight:600;
          color:#880e4f; margin-bottom:6px; }
        .hr-alert-unassigned-hint { margin-top:6px; font-size:var(--fs-sm); color:#880e4f; }
        .hr-unassigned-row { display:flex; justify-content:space-between;
          padding:3px 0; font-size:var(--fs-sm); }
      </style>

      <h1 class="page-title">Hub &amp; Relais</h1>
      <p class="page-subtitle">Opérations logistiques quotidiennes</p>

      <section class="page-section">
        <div class="card" style="padding:0">
          <!-- Mode switcher -->
          <div class="hr-mode-bar">
            ${MODES.map(m => `
              <button class="hr-mode-btn" data-mode="${m.id}" style="--hr-active-color:${m.color}">
                ${m.icon} ${m.label}
                <div class="hr-mode-subtitle">${m.subtitle}</div>
              </button>`).join('')}
          </div>
          <!-- Dynamic content -->
          <div class="hr-content">
            <div class="hr-loading-full">Chargement…</div>
          </div>
        </div>
      </section>`;

    const contentEl = rootEl.querySelector('.hr-content');

    // refreshView: re-render one mode without touching the other
    async function refreshView(mode) {
      const wrapper = contentEl.querySelector(`.hr-${mode}-wrapper`);
      if (!wrapper) {
        await loadMode(mode);
        return;
      }
      try {
        if (mode === 'hub')    await populateHub(wrapper, refreshView);
        if (mode === 'relais') await populateRelais(wrapper, refreshView);
      } catch (err) {
        wrapper.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center">❌ Erreur ${esc(mode)}: ${esc(err.message)}</div>`; // FRESH-104
      }
    }

    async function loadMode(mode) {
      contentEl.innerHTML = mode === 'hub' ? buildHubSkeleton() : buildRelaisSkeleton();
      await refreshView(mode);
    }

    // ── Mode switch wiring ──
    let activeMode = 'hub';
    rootEl.querySelectorAll('.hr-mode-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        activeMode = btn.dataset.mode;
        rootEl.querySelectorAll('.hr-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        await loadMode(activeMode);
      });
    });

    // ── Initial load: Hub ──
    rootEl.querySelector('[data-mode="hub"]').classList.add('active');
    await loadMode('hub');
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.HubRelaisView = { render };

})(window);
