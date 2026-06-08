/**
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
 *   getOps(filters)                            → pipeline commandes + colis
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
 *
 * NOTE pour api-client.js (Vague 0 — à ajouter avant merge) :
 *   Les 7 mutations ci-dessus ne sont pas encore dans KmcApi. Voir bloc
 *   «  ── Mutations à ajouter dans api-client.js ──  » en bas de ce fichier.
 */

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

  // ── Shared UI primitives ──────────────────────────────────────────────────

  function kpiChip(count, color, label) {
    const active = count > 0;
    return `<span style="
      display:inline-flex;align-items:center;gap:4px;padding:3px 10px;
      border-radius:12px;font-size:12px;font-weight:600;
      background:${active ? color + '18' : 'var(--surface-2,#f1f5f9)'};
      color:${active ? color : 'var(--text-tertiary,#94a3b8)'}">
      ${label} <b>${count}</b>
    </span>`;
  }

  function emptyState(text = '✅ Rien à traiter') {
    return `<div style="padding:20px;text-align:center;color:var(--text-tertiary,#94a3b8);font-size:13px">${text}</div>`;
  }

  function alertChip(icon, label, count, color) {
    if (!count) return '';
    return `<div style="
      display:flex;align-items:center;gap:8px;padding:8px 12px;
      background:${color}0a;border:1px solid ${color}30;border-radius:8px;
      margin-bottom:6px;font-size:13px">
      <span>${icon}</span><span style="flex:1">${label}</span>
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
        ? `<span style="background:${t.color};color:#fff;border-radius:8px;padding:1px 7px;font-size:11px;margin-left:5px">${cnt}</span>`
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
      <div style="overflow-x:auto">
        <table class="kmc-table" style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--surface-2,#f8fafc)">
            ${headers.map(h => `<th style="padding:6px 10px;text-align:left;font-size:11px;
              color:var(--text-tertiary,#94a3b8);font-weight:600;text-transform:uppercase;
              border-bottom:1px solid var(--border,#e2e8f0)">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  function orderRow(o, btnLabel, btnDataAction) {
    let items = [];
    try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch (_) {}
    const desc = `${items.length || o.nb_items || 0} art. · ${fmtKmf(o.total_kmf)} · ${o.relais_island || '—'}`;
    return `<tr style="border-bottom:1px solid var(--border,#f1f5f9)">
      <td style="padding:8px 10px;font-weight:700;color:#1e40af;font-size:13px;white-space:nowrap">${o.reference}</td>
      <td style="padding:8px 10px;font-size:13px">${o.customer_name || 'Client'}</td>
      <td style="padding:8px 10px;font-size:12px;color:var(--text-secondary,#64748b)">${desc}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-tertiary,#94a3b8);white-space:nowrap">${fmtAgo(o.created_at)}</td>
      <td style="padding:8px 6px;text-align:right">
        <button data-action="${btnDataAction}" data-ref="${o.reference}"
          class="btn-action" style="padding:5px 12px;border:none;border-radius:6px;
          font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
          background:#b4530918;color:#b45309">${btnLabel}</button>
      </td>
    </tr>`;
  }

  function parcelRow(p, btnLabel, btnDataAction, btnColor) {
    const desc = `${p.main_order_ref || '—'} · ${p.nb_items || 0} art. · ${p.destination_island || p.relais_island || '—'}`;
    return `<tr style="border-bottom:1px solid var(--border,#f1f5f9)">
      <td style="padding:8px 10px;font-weight:700;color:#1e40af;font-size:13px;white-space:nowrap">${p.reference}</td>
      <td style="padding:8px 10px;font-size:13px">${p.recipient_name || 'Client'}</td>
      <td style="padding:8px 10px;font-size:12px;color:var(--text-secondary,#64748b)">${desc}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-tertiary,#94a3b8)"></td>
      <td style="padding:8px 6px;text-align:right">
        <button data-action="${btnDataAction}" data-ref="${p.reference}"
          class="btn-action" style="padding:5px 12px;border:none;border-radius:6px;
          font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
          background:${btnColor}18;color:${btnColor}">${btnLabel}</button>
      </td>
    </tr>`;
  }

  // ── Mini preview table (bottom forecast panels) ───────────────────────────

  function miniTable(items, cols, limit = 8) {
    if (!items || !items.length) return `<div style="color:var(--text-tertiary,#94a3b8);font-size:12px;padding:6px">—</div>`;
    let h = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    items.slice(0, limit).forEach((item, i) => {
      h += `<tr style="border-bottom:1px solid var(--surface-2,#f8fafc);${i % 2 ? 'background:#fafbfd' : ''}">`;
      cols.forEach(col => { h += `<td style="padding:4px 8px">${col(item)}</td>`; });
      h += '</tr>';
    });
    if (items.length > limit) {
      h += `<tr><td colspan="99" style="padding:4px 8px;color:var(--text-tertiary,#94a3b8);font-size:11px">+ ${items.length - limit} autres…</td></tr>`;
    }
    return h + '</table>';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🏭  HUB section
  // ─────────────────────────────────────────────────────────────────────────

  function buildHubSkeleton() {
    const tabsHtml = TABS_HUB.map(t =>
      `<button class="ct-tab" data-tab="${t.id}" style="
        padding:8px 16px;border:none;border-bottom:3px solid transparent;
        background:transparent;color:var(--text-secondary,#64748b);
        font-size:13px;font-weight:600;cursor:pointer;transition:all .15s">
        ${t.icon} ${t.label}
      </button>`
    ).join('');

    const panelsHtml = TABS_HUB.map(t =>
      `<div class="hr-panel" data-panel="${t.id}" style="display:none;
        background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);
        border-top:none;border-radius:0 0 8px 8px;padding:8px">
        <div style="color:var(--text-tertiary,#94a3b8);padding:20px;text-align:center">Chargement…</div>
      </div>`
    ).join('');

    return `
      <div class="hr-hub-wrapper" style="padding:12px 0">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div>
            <h2 style="margin:0;font-size:20px">🏭 Hub</h2>
            <span style="color:var(--text-secondary,#64748b);font-size:12px">Commander · Emballer · Expédier</span>
          </div>
          <button class="btn-refresh-hub" style="padding:5px 12px;border:1px solid var(--border,#e2e8f0);
            border-radius:6px;cursor:pointer;background:var(--surface,#fff);font-size:12px">🔄</button>
        </div>
        <div class="hub-kpi-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px"></div>
        <div class="hr-tabbar" style="display:flex;border-bottom:1px solid var(--border,#e2e8f0)">
          ${tabsHtml}
        </div>
        ${panelsHtml}
        <div class="hub-bottom-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">
          <div class="card hub-forecast" style="padding:12px">
            <h4 style="margin:0 0 10px;font-size:14px;color:#6366f1">📋 Prévisionnel</h4>
            <div class="forecast-content" style="color:var(--text-tertiary);font-size:12px">Chargement…</div>
          </div>
          <div class="card hub-alerts" style="padding:12px">
            <h4 style="margin:0 0 10px;font-size:14px;color:#ef4444">🚨 Alertes</h4>
            <div class="alerts-content" style="color:var(--text-tertiary);font-size:12px">Chargement…</div>
          </div>
        </div>
      </div>`;
  }

  async function populateHub(wrapperEl, refreshView) {
    const [opsData, parcelsData] = await Promise.all([
      KmcApi.getOps(KmcFilters.get()),
      KmcApi.getParcels({ limit: 500 }),
    ]);

    const orders  = opsData.orders  || [];
    const parcels = parcelsData.parcels || [];

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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:12px;color:var(--text-secondary,#64748b)">
          Répartition automatique par destination
        </span>
        <button class="btn-auto-distribute" style="padding:5px 12px;border:none;border-radius:6px;
          background:#3b82f6;color:#fff;font-size:12px;font-weight:600;cursor:pointer">
          🤖 Répartir maintenant
        </button>
      </div>
      <div class="distribution-panel" style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:12px">
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
      <div style="font-size:12px;font-weight:600;color:var(--text-tertiary,#94a3b8);margin-bottom:4px">🛍️ Attente paiement (${pending.length})</div>
      ${miniTable(pending, [
        o => `<strong>${o.reference}</strong>`,
        o => o.customer_name || '—',
        o => o.payment_mode === 'stripe_eur' ? '💳' : '💰',
        o => fmtAgo(o.created_at),
      ])}
      <div style="font-size:12px;font-weight:600;color:var(--text-tertiary,#94a3b8);margin:8px 0 4px">📋 À répartir (${ordered.length})</div>
      ${miniTable(ordered, [
        o => `<strong>${o.reference}</strong>`,
        o => o.customer_name || '—',
        o => `${o.nb_items || '—'} art.`,
        o => fmtAgo(o.created_at),
      ])}
      <div style="font-size:12px;font-weight:600;color:var(--text-tertiary,#94a3b8);margin:8px 0 4px">🚀 En route (${enRoute.length})</div>
      ${miniTable(enRoute, [
        p => `<strong>${p.reference}</strong>`,
        p => `🏝️ ${p.destination_island || '—'}`,
        p => fmtAgo(p.shipped_at || p.created_at),
      ])}`;

    // ── Alertes ──
    wrapperEl.querySelector('.alerts-content').innerHTML = alertCount === 0
      ? '<div style="color:#22c55e;text-align:center;padding:20px;font-size:13px">✅ Aucune alerte</div>'
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

      let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
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
          ? `<button data-action="dist-ship" data-ref="${p.reference}" style="padding:3px 10px;
              border:none;border-radius:6px;background:#7c3aed;color:#fff;
              font-size:11px;font-weight:600;cursor:pointer">✈️ Expédier</button>`
          : '';

        const ordRows = orders.map(o => `
          <tr style="border-bottom:1px solid var(--surface-2,#f1f5f9)">
            <td style="padding:4px 8px;font-weight:600;color:#1e40af;font-size:12px">${o.ref || '—'}</td>
            <td style="padding:4px 8px;font-size:12px">${o.customer || '—'}</td>
            <td style="padding:4px 8px;font-size:12px;color:var(--text-secondary)">${o.items_count || o.items || '?'} art.</td>
            <td style="padding:4px 8px;font-size:12px;text-align:right">${fmtKmf(o.total_kmf || o.total || 0)}</td>
          </tr>`).join('');

        html += `
          <div style="background:var(--surface-2,#f8fafc);border:1px solid var(--border,#e2e8f0);
            border-radius:8px;padding:10px;margin-bottom:8px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <strong style="color:#1e40af;font-size:14px">📦 ${p.reference}</strong>
                <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">
                  ${p.relais_name || p.relais_island || p.destination || '—'}
                </span>
                <span style="color:var(--text-secondary);font-size:11px">
                  ${p.orders_count || 0} cmd · ${p.items_count || 0} art. · ${fmtKmf(p.total_kmf || 0)}
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:11px;padding:2px 8px;border-radius:10px;
                  background:${stBg};color:${stColor}">${st}</span>
                ${shipBtn}
              </div>
            </div>
            ${ordRows ? `<table style="width:100%;border-collapse:collapse"><tbody>${ordRows}</tbody></table>` : ''}
          </div>`;
      });

      // Saturation alerts
      saturated.forEach(s => {
        html += `
          <div style="background:#fce4ec;border:2px solid #e91e63;border-radius:8px;
            padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:8px">
            <span style="font-size:20px">🚨</span>
            <div>
              <strong style="color:#880e4f">${s.destination} — Capacité max atteinte</strong>
              <div style="font-size:12px;color:#880e4f">
                ${s.open_parcels} colis ouverts (max ${data.limits?.MAX_OPEN_PARCELS_PER_DEST || 3}),
                ${s.queued_orders} commande(s) en file
              </div>
              <div style="font-size:12px;color:#c62828;font-weight:600;margin-top:2px">
                ✈️ Expédiez les colis en cours pour débloquer
              </div>
            </div>
          </div>`;
      });

      if (unassigned.length) {
        html += `
          <div style="background:#fce4ec;border:1px solid #f48fb1;border-radius:8px;padding:10px;margin-top:8px">
            <div style="font-size:12px;font-weight:600;color:#880e4f;margin-bottom:6px">
              ⏳ ${unassigned.length} commande(s) non assignée(s)
            </div>
            ${unassigned.map(o => `
              <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
                <span><strong>${o.reference}</strong> — ${o.customer_name || '?'}</span>
                <span style="color:var(--text-secondary)">${o.items_count || '?'} art. · ${o.relais_name || o.relais_island || '?'}</span>
              </div>`).join('')}
            <div style="margin-top:6px;font-size:11px;color:#880e4f">
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
      panelEl.innerHTML = `<div style="color:#ef4444;font-size:12px">❌ ${esc(e.message)}</div>`; // FRESH-104
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 📦  RELAIS section
  // ─────────────────────────────────────────────────────────────────────────

  function buildRelaisSkeleton() {
    const tabsHtml = TABS_RELAIS.map(t =>
      `<button class="ct-tab" data-tab="${t.id}" style="
        padding:8px 16px;border:none;border-bottom:3px solid transparent;
        background:transparent;color:var(--text-secondary,#64748b);
        font-size:13px;font-weight:600;cursor:pointer;transition:all .15s">
        ${t.icon} ${t.label}
      </button>`
    ).join('');

    const panelsHtml = TABS_RELAIS.map(t =>
      `<div class="hr-panel" data-panel="${t.id}" style="display:none;
        background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);
        border-top:none;border-radius:0 0 8px 8px;padding:8px">
        <div style="color:var(--text-tertiary,#94a3b8);padding:20px;text-align:center">Chargement…</div>
      </div>`
    ).join('');

    return `
      <div class="hr-relais-wrapper" style="padding:12px 0">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div>
            <h2 style="margin:0;font-size:20px">📦 Relais</h2>
            <span style="color:var(--text-secondary,#64748b);font-size:12px">Encaisser · Réceptionner · Distribuer</span>
          </div>
          <button class="btn-refresh-relais" style="padding:5px 12px;border:1px solid var(--border,#e2e8f0);
            border-radius:6px;cursor:pointer;background:var(--surface,#fff);font-size:12px">🔄</button>
        </div>
        <div class="relais-kpi-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px"></div>
        <div class="hr-tabbar" style="display:flex;border-bottom:1px solid var(--border,#e2e8f0)">
          ${tabsHtml}
        </div>
        ${panelsHtml}
        <div class="relais-bottom-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">
          <div class="card relais-forecast" style="padding:12px">
            <h4 style="margin:0 0 10px;font-size:14px;color:#6366f1">📋 Prévisionnel</h4>
            <div class="forecast-content" style="color:var(--text-tertiary);font-size:12px">Chargement…</div>
          </div>
          <div class="card relais-alerts" style="padding:12px">
            <h4 style="margin:0 0 10px;font-size:14px;color:#ef4444">🚨 Alertes</h4>
            <div class="alerts-content" style="color:var(--text-tertiary);font-size:12px">Chargement…</div>
          </div>
        </div>
      </div>`;
  }

  async function populateRelais(wrapperEl, refreshView) {
    const [opsData, parcelsData] = await Promise.all([
      KmcApi.getOps(KmcFilters.get()),
      KmcApi.getParcels({ limit: 500 }),
    ]);

    const orders  = opsData.orders  || [];
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
        return `<tr style="border-bottom:1px solid var(--border,#f1f5f9)">
          <td style="padding:8px 10px;font-weight:700;color:#1e40af;font-size:13px;white-space:nowrap">${o.reference}</td>
          <td style="padding:8px 10px;font-size:13px">${o.customer_name || 'Client'}</td>
          <td style="padding:8px 10px;font-size:12px;color:var(--text-secondary)">${desc}</td>
          <td style="padding:8px 10px;font-size:11px;color:var(--text-tertiary);white-space:nowrap">${fmtAgo(o.created_at)}</td>
          <td style="padding:8px 6px;text-align:right">
            <button data-action="relais-confirm-cash" data-ref="${o.reference}"
              class="btn-action" style="padding:5px 12px;border:none;border-radius:6px;
              font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
              background:#b4530918;color:#b45309">💰 Encaisser</button>
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
        return `<tr style="border-bottom:1px solid var(--border,#f1f5f9)">
          <td style="padding:8px 10px;font-weight:700;color:#1e40af;font-size:13px;white-space:nowrap">${p.reference}</td>
          <td style="padding:8px 10px;font-size:13px">${p.recipient_name || 'Client'}</td>
          <td style="padding:8px 10px;font-size:12px;color:var(--text-secondary)">${desc}</td>
          <td style="padding:8px 10px;font-size:11px;color:var(--text-tertiary);white-space:nowrap">${fmtAgo(p.updated_at || p.created_at)}</td>
          <td style="padding:8px 6px;text-align:right">
            <button data-action="relais-collected" data-ref="${p.reference}"
              class="btn-action" style="padding:5px 12px;border:none;border-radius:6px;
              font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
              background:#06504618;color:#065f46">✅ Remis</button>
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
      <div style="font-size:12px;font-weight:600;color:var(--text-tertiary,#94a3b8);margin-bottom:4px">✈️ En route (${shippedP.length})</div>
      ${miniTable(shippedP, [
        p => `<strong>${p.reference}</strong>`,
        p => p.recipient_name || '—',
        p => `🏝️ ${p.destination_island || '—'}`,
        p => fmtAgo(p.shipped_at || p.created_at),
      ])}
      <div style="font-size:12px;font-weight:600;color:var(--text-tertiary,#94a3b8);margin:8px 0 4px">✅ Récentes (${collectedP.length})</div>
      ${miniTable(collectedP, [
        p => `<strong>${p.reference}</strong>`,
        p => p.recipient_name || '—',
        p => `🏝️ ${p.destination_island || '—'}`,
        p => fmtAgo(p.updated_at || p.created_at),
      ])}`;

    // ── Alertes ──
    wrapperEl.querySelector('.alerts-content').innerHTML = alertCount === 0
      ? '<div style="color:#22c55e;text-align:center;padding:20px;font-size:13px">✅ Aucune alerte</div>'
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
        .hr-mode-btn { transition: all .15s; }
        .hr-mode-btn.active {
          border-bottom: 3px solid var(--hr-active-color, #3b82f6) !important;
          color: var(--hr-active-color, #3b82f6) !important;
        }
      </style>

      <h1 class="page-title">Hub &amp; Relais</h1>
      <p class="page-subtitle">Opérations logistiques quotidiennes</p>

      <section class="page-section">
        <div class="card" style="padding:0">
          <!-- Mode switcher -->
          <div class="hr-mode-bar" style="display:flex;border-bottom:1px solid var(--border,#e2e8f0)">
            ${MODES.map(m => `
              <button class="hr-mode-btn" data-mode="${m.id}"
                style="--hr-active-color:${m.color};
                  padding:14px 24px;border:none;border-bottom:3px solid transparent;
                  background:transparent;font-size:14px;font-weight:600;cursor:pointer;
                  color:var(--text-secondary,#64748b)">
                ${m.icon} ${m.label}
                <div style="font-size:11px;font-weight:400;opacity:.75">${m.subtitle}</div>
              </button>`).join('')}
          </div>
          <!-- Dynamic content -->
          <div class="hr-content" style="padding:12px">
            <div style="text-align:center;padding:48px;color:var(--text-tertiary,#94a3b8)">Chargement…</div>
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


/* ════════════════════════════════════════════════════════════════════════════
   ── Mutations à ajouter dans api-client.js (Vague 0 / avant merge) ──

   Dans la zone « Vague 1 — Domaines opérationnels » de api-client.js,
   ajouter les 7 fonctions suivantes puis les exposer dans KmcApi :

   // Hub mutations
   function hubMarkOrdered(ref) {
     return fetchMutation(apiUrl(`/v2/orders/${ref}/mark-ordered`), 'POST');
   }
   function hubShip(ref) {
     return fetchMutation(apiUrl('/v2/scan'), 'POST', { reference: ref, action: 'shipped', note: 'Expédié Hub — CT' });
   }
   function autoDistribute() {
     return fetchMutation(apiUrl('/v2/orders/auto-distribute'), 'POST');
   }
   function getDistribution() {
     return fetchJSON(apiUrl('/v2/orders/distribution'));
   }

   // Relais mutations
   function relaisConfirmCash(ref) {
     return fetchMutation(apiUrl(`/v2/orders/${ref}/confirm-cash`), 'POST');
   }
   function relaisReceive(ref) {
     return fetchMutation(apiUrl('/v2/scan'), 'POST', { reference: ref, action: 'arrived', note: 'Réception relais — CT' });
   }
   function relaisCollect(ref) {
     return fetchMutation(apiUrl('/v2/scan'), 'POST', { reference: ref, action: 'collected', note: 'Remis client — CT' });
   }

   Puis dans global.KmcApi = { … } :
     hubMarkOrdered, hubShip, autoDistribute, getDistribution,
     relaisConfirmCash, relaisReceive, relaisCollect,

   Vérifier les URL réelles dans ct-api.js (CT.api.hubMarkOrdered,
   CT.api.v2Scan, CT.api.autoDistribute, CT.api.getDistribution,
   CT.api.v2ConfirmCash, CT.api.markInTransit) avant de confirmer les paths.
   ════════════════════════════════════════════════════════════════════════════ */
