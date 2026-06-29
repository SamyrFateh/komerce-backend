/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-sourcing
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/**
 * KOMERCE Control Tower — Vue Sourcing Intelligence
 *
 * "Le moteur ne remplace pas le jugement terrain.
 *  Il l'éclaire, le cadre, puis apprend de lui."
 *
 * 2 onglets :
 *   1. Synthèse — KPIs portefeuille + tops + alertes
 *   2. Produits — 1 ligne par produit, code couleur, lecture immédiate
 *
 * Dépend de : CT.api (ct-api.js), CT.views (ct-app-v7.js)
 */

'use strict';

(function () {
  if (!window.CT) window.CT = {};
  if (!CT.views) CT.views = {};

  // ══════════════════════════════════════════════════════════════════════════
  // Styles
  // ══════════════════════════════════════════════════════════════════════════
  const STYLE_ID = 'ct-sourcing-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* ── Sourcing view ────────────────────────────────────── */
      .src-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
      .src-tab {
        padding: 8px 16px; border-radius: 8px; cursor: pointer;
        background: #f1f5f9; color: #475569; font-weight: 600; font-size: 14px;
        border: none; transition: all .2s;
      }
      .src-tab.active { background: #1e293b; color: #fff; }
      .src-tab:hover:not(.active) { background: #e2e8f0; }

      /* ── Synthèse ─────────────────────────────────────────── */
      .src-kpi-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px; margin-bottom: 20px;
      }
      .src-kpi {
        background: #fff; border-radius: 12px; padding: 16px;
        box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center;
      }
      .src-kpi .num { font-size: 28px; font-weight: 700; }
      .src-kpi .label { font-size: 12px; color: #64748b; margin-top: 4px; }
      .src-kpi.green .num { color: #16a34a; }
      .src-kpi.orange .num { color: #ea580c; }
      .src-kpi.red .num { color: #dc2626; }
      .src-kpi.blue .num { color: #2563eb; }

      .src-section { margin-bottom: 20px; }
      .src-section h3 { font-size: 14px; color: #475569; margin-bottom: 8px; font-weight: 600; }
      .src-top-list { display: flex; flex-direction: column; gap: 6px; }
      .src-top-item {
        display: flex; align-items: center; gap: 10px; padding: 8px 12px;
        background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,.06);
        font-size: 13px;
      }
      .src-top-item .rank { font-weight: 700; color: #94a3b8; width: 20px; }
      .src-top-item .name { flex: 1; font-weight: 500; }
      .src-top-item .badge {
        padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;
      }

      .src-alert-list { display: flex; flex-direction: column; gap: 6px; }
      .src-alert {
        display: flex; align-items: center; gap: 8px; padding: 10px 12px;
        border-radius: 8px; font-size: 13px;
      }
      .src-alert.critical { background: #fef2f2; color: #991b1b; }
      .src-alert.warning { background: #fffbeb; color: #92400e; }
      .src-alert.info { background: #f0f9ff; color: #075985; }

      /* ── Data bar ─────────────────────────────────────────── */
      .src-data-bar {
        display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
        padding: 10px 14px; background: #f8fafc; border-radius: 10px;
        font-size: 13px; color: #64748b;
      }
      .src-data-bar .progress-bg {
        flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;
      }
      .src-data-bar .progress-fill {
        height: 100%; border-radius: 4px; background: linear-gradient(90deg, #f59e0b, #16a34a);
        transition: width .5s ease;
      }

      /* ── Produits table ───────────────────────────────────── */
      .src-filters {
        display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;
        align-items: center;
      }
      .src-filters select, .src-filters input {
        padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 8px;
        font-size: 13px; background: #fff;
      }
      .src-filters input { width: 200px; }
      .src-count { font-size: 12px; color: #94a3b8; margin-left: auto; }

      .src-product-list { display: flex; flex-direction: column; gap: 6px; }
      .src-product-card {
        display: grid;
        grid-template-columns: 8px 44px 1fr 80px 60px 90px 120px 100px;
        align-items: center; gap: 10px; padding: 10px 12px;
        background: #fff; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.06);
        cursor: pointer; transition: box-shadow .15s;
      }
      .src-product-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.12); }
      .src-status-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }
      .src-status-dot.green { background: #16a34a; }
      .src-status-dot.orange { background: #ea580c; }
      .src-status-dot.red { background: #dc2626; }
      .src-product-img {
        width: 44px; height: 44px; border-radius: 8px; object-fit: cover;
        background: #f1f5f9;
      }
      .src-product-info { min-width: 0; }
      .src-product-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .src-product-cat { font-size: 11px; color: #94a3b8; }
      .src-product-price { font-size: 13px; font-weight: 600; text-align: right; }
      .src-product-rail {
        font-size: 11px; font-weight: 700; text-align: center;
        padding: 2px 6px; border-radius: 6px;
      }
      .src-product-rail.A { background: #dbeafe; color: #1d4ed8; }
      .src-product-rail.B { background: #fef3c7; color: #92400e; }
      .src-product-rail.C { background: #f3e8ff; color: #7c3aed; }
      .src-product-rail.D { background: #dcfce7; color: #15803d; }
      .src-product-rail.unknown { background: #f1f5f9; color: #94a3b8; }
      .src-product-status { font-size: 11px; font-weight: 500; }
      .src-product-action {
        font-size: 11px; padding: 3px 8px; border-radius: 6px;
        font-weight: 600; text-align: center; white-space: nowrap;
      }
      .src-product-confidence { font-size: 11px; text-align: center; }
      .src-product-confidence.forte { color: #16a34a; }
      .src-product-confidence.moyenne { color: #ea580c; }
      .src-product-confidence.faible { color: #dc2626; }

      /* ── Détail produit (modal inline) ────────────────────── */
      .src-detail-panel {
        margin-top: 12px; padding: 16px; background: #f8fafc;
        border-radius: 12px; border: 1px solid #e2e8f0;
      }
      .src-detail-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
      }
      .src-detail-field { font-size: 13px; }
      .src-detail-field .field-label { color: #64748b; font-size: 11px; }
      .src-detail-field .field-value { font-weight: 600; }
      .src-detail-gaps {
        margin-top: 12px; padding: 10px; background: #fffbeb;
        border-radius: 8px; font-size: 12px;
      }
      .src-detail-gaps .gap-title { font-weight: 600; color: #92400e; margin-bottom: 4px; }
      .src-detail-gaps .gap-item { color: #78716c; padding: 2px 0; }
      .src-detail-gaps .gap-item::before { content: '⚠ '; }

      .src-detail-reason {
        margin-top: 10px; padding: 10px; background: #f0fdf4;
        border-radius: 8px; font-size: 13px; color: #166534;
      }
      .src-detail-reason.orange { background: #fff7ed; color: #9a3412; }
      .src-detail-reason.red { background: #fef2f2; color: #991b1b; }

      .src-detail-suggestions {
        margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;
      }
      .src-detail-chip {
        padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 600;
        background: #f1f5f9; color: #475569;
      }

      /* ── Edit panel ──────────────────────────────────────── */
      .src-edit-grid {
        display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;
        margin-top: 12px;
      }
      .src-edit-field label { display: block; font-size: 11px; color: #64748b; margin-bottom: 2px; }
      .src-edit-field select, .src-edit-field input {
        width: 100%; padding: 6px 8px; border: 1px solid #e2e8f0;
        border-radius: 6px; font-size: 13px;
      }
      .src-edit-actions { margin-top: 12px; display: flex; gap: 8px; }
      .src-btn {
        padding: 8px 16px; border: none; border-radius: 8px;
        font-size: 13px; font-weight: 600; cursor: pointer;
      }
      .src-btn-primary { background: #1e293b; color: #fff; }
      .src-btn-primary:hover { background: #334155; }
      .src-btn-secondary { background: #f1f5f9; color: #475569; }

      /* ── Rail distribution bar ───────────────────────────── */
      .src-rail-bar { display: flex; height: 24px; border-radius: 8px; overflow: hidden; margin-bottom: 16px; }
      .src-rail-bar div { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; transition: width .5s; }
      .src-rail-bar .A { background: #3b82f6; }
      .src-rail-bar .B { background: #f59e0b; }
      .src-rail-bar .C { background: #8b5cf6; }
      .src-rail-bar .D { background: #22c55e; }
    `;
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // State
  // ══════════════════════════════════════════════════════════════════════════
  let _analysisCache = null;
  let _synthesisCache = null;
  let _activeTab = 'synthesis';
  let _expandedProduct = null;
  let _filters = { search: '', rail: '', status: '', category: '' };

  // ══════════════════════════════════════════════════════════════════════════
  // Formatters
  // ══════════════════════════════════════════════════════════════════════════
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('fr-FR');
  const pct = n => n == null ? '—' : n + '%';

  const statusLabels = {
    en_phase: 'En phase', sous_reserve: 'Sous réserve',
    test_requis: 'Test requis', hors_phase: 'Hors phase',
  };
  const actionLabels = {
    pousser: '🚀 Pousser', maintenir: '✅ Maintenir', bundler: '📦 Bundler',
    négocier: '💬 Négocier', tester: '🧪 Tester', geler: '❄️ Geler',
    refuser: '🚫 Refuser', 'compléter les données': '📝 Compléter',
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Entry point — called by CT.views
  // ══════════════════════════════════════════════════════════════════════════
  CT.views.sourcing = {
    render: async function (container) {
      injectStyles();
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">Chargement du moteur sourcing...</div>';

      try {
        const [synthesis, analysis] = await Promise.all([
          CT.api.sourcingSynthesis(),
          CT.api.sourcingAnalysis(),
        ]);
        _synthesisCache = synthesis;
        _analysisCache = analysis;
      } catch (err) {
        container.innerHTML = `<div style="color:#dc2626;padding:20px;">Erreur : ${err.message}</div>`;
        return;
      }

      renderView(container);
    },
  };

  function renderView(container) {
    container.innerHTML = '';

    // Title
    const title = document.createElement('h2');
    title.textContent = '🔍 Intelligence Sourcing';
    title.style.cssText = 'margin:0 0 16px;font-size:20px;';
    container.appendChild(title);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'src-tabs';
    const tabDefs = [
      { id: 'synthesis', label: '📊 Synthèse' },
      { id: 'products', label: '📦 Produits' },
    ];
    for (const t of tabDefs) {
      const btn = document.createElement('button');
      btn.className = 'src-tab' + (_activeTab === t.id ? ' active' : '');
      btn.textContent = t.label;
      btn.onclick = () => { _activeTab = t.id; _expandedProduct = null; renderView(container); };
      tabs.appendChild(btn);
    }
    container.appendChild(tabs);

    // Content
    const content = document.createElement('div');
    if (_activeTab === 'synthesis') renderSynthesis(content);
    else renderProducts(content);
    container.appendChild(content);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 1 — Synthèse
  // ══════════════════════════════════════════════════════════════════════════
  function renderSynthesis(el) {
    const s = _synthesisCache;
    if (!s) { el.textContent = 'Données non chargées'; return; }

    // KPIs
    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'src-kpi-grid';
    const kpis = [
      { num: s.by_status.en_phase, label: 'En phase', cls: 'green' },
      { num: s.by_status.sous_reserve, label: 'Sous réserve', cls: 'orange' },
      { num: s.by_status.test_requis, label: 'Test requis', cls: 'orange' },
      { num: s.by_status.hors_phase, label: 'Hors phase', cls: 'red' },
      { num: s.total_active, label: 'Actifs total', cls: 'blue' },
      { num: s.data_completeness_pct + '%', label: 'Complétude données', cls: s.data_completeness_pct >= 50 ? 'green' : 'orange' },
    ];
    for (const k of kpis) {
      const card = document.createElement('div');
      card.className = 'src-kpi ' + k.cls;
      card.innerHTML = `<div class="num">${k.num}</div><div class="label">${k.label}</div>`;
      kpiGrid.appendChild(card);
    }
    el.appendChild(kpiGrid);

    // Data completeness bar
    const dataBar = document.createElement('div');
    dataBar.className = 'src-data-bar';
    dataBar.innerHTML = `
      <span>📊 Complétude sourcing</span>
      <div class="progress-bg"><div class="progress-fill" style="width:${s.data_completeness_pct}%"></div></div>
      <span>${s.data_completeness_pct}%</span>
    `;
    el.appendChild(dataBar);

    // Rail distribution
    const total = s.total_active || 1;
    const railBar = document.createElement('div');
    railBar.className = 'src-rail-bar';
    for (const r of ['A', 'B', 'C', 'D']) {
      const pctV = Math.round((s.by_rail[r] || 0) / total * 100);
      if (pctV === 0) continue;
      const div = document.createElement('div');
      div.className = r;
      div.style.width = pctV + '%';
      div.textContent = `${r} ${pctV}%`;
      railBar.appendChild(div);
    }
    el.appendChild(railBar);

    // Global alerts
    if (s.global_alerts && s.global_alerts.length > 0) {
      const section = document.createElement('div');
      section.className = 'src-section';
      section.innerHTML = '<h3>⚡ Alertes</h3>';
      const list = document.createElement('div');
      list.className = 'src-alert-list';
      for (const a of s.global_alerts) {
        const item = document.createElement('div');
        item.className = 'src-alert ' + a.level;
        item.textContent = a.message;
        list.appendChild(item);
      }
      section.appendChild(list);
      el.appendChild(section);
    }

    // Top push
    renderTopList(el, '🚀 Top produits à pousser', s.top_push, p => `${p.sales_30d} ventes/30j • marge ${pct(p.margin_pct)}`);
    // Top watch
    renderTopList(el, '👀 Top produits à surveiller', s.top_watch, p => p.reason);
    // Top freeze
    renderTopList(el, '❄️ Top produits à geler', s.top_freeze, p => p.reason);
  }

  function renderTopList(parent, title, items, descFn) {
    if (!items || items.length === 0) return;
    const section = document.createElement('div');
    section.className = 'src-section';
    section.innerHTML = `<h3>${title}</h3>`;
    const list = document.createElement('div');
    list.className = 'src-top-list';
    items.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'src-top-item';
      const railCls = p.rail || 'unknown';
      item.innerHTML = `
        <span class="rank">${i + 1}</span>
        <span class="name">${esc(p.name)}</span>
        <span class="badge src-product-rail ${railCls}">${p.rail || '?'}</span>
        <span style="color:#64748b;font-size:12px;">${esc(descFn(p))}</span>
      `;
      list.appendChild(item);
    });
    section.appendChild(list);
    parent.appendChild(section);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 2 — Produits
  // ══════════════════════════════════════════════════════════════════════════
  function renderProducts(el) {
    const data = _analysisCache;
    if (!data || !data.products) { el.textContent = 'Données non chargées'; return; }

    // Filters
    const filters = document.createElement('div');
    filters.className = 'src-filters';

    // Search
    const search = document.createElement('input');
    search.type = 'text'; search.placeholder = '🔍 Rechercher...';
    search.value = _filters.search;
    search.oninput = () => { _filters.search = search.value; renderProductList(listEl, data.products); };
    filters.appendChild(search);

    // Rail filter
    const railSel = document.createElement('select');
    railSel.innerHTML = '<option value="">Tous rails</option><option value="A">Rail A</option><option value="B">Rail B</option><option value="C">Rail C</option><option value="D">Rail D</option>';
    railSel.value = _filters.rail;
    railSel.onchange = () => { _filters.rail = railSel.value; renderProductList(listEl, data.products); };
    filters.appendChild(railSel);

    // Status filter
    const statusSel = document.createElement('select');
    statusSel.innerHTML = '<option value="">Tous statuts</option><option value="en_phase">🟢 En phase</option><option value="sous_reserve">🟠 Sous réserve</option><option value="test_requis">🟠 Test requis</option><option value="hors_phase">🔴 Hors phase</option>';
    statusSel.value = _filters.status;
    statusSel.onchange = () => { _filters.status = statusSel.value; renderProductList(listEl, data.products); };
    filters.appendChild(statusSel);

    // Category filter
    const cats = [...new Set(data.products.map(p => p.category))].filter(Boolean).sort();
    const catSel = document.createElement('select');
    catSel.innerHTML = '<option value="">Toutes catégories</option>' + cats.map(c => `<option>${c}</option>`).join('');
    catSel.value = _filters.category;
    catSel.onchange = () => { _filters.category = catSel.value; renderProductList(listEl, data.products); };
    filters.appendChild(catSel);

    el.appendChild(filters);

    const listEl = document.createElement('div');
    listEl.className = 'src-product-list';
    renderProductList(listEl, data.products);
    el.appendChild(listEl);
  }

  function renderProductList(container, products) {
    container.innerHTML = '';

    let filtered = products;
    if (_filters.search) {
      const q = _filters.search.toLowerCase();
      filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
    }
    if (_filters.rail) filtered = filtered.filter(p => p.computed.inferred_rail === _filters.rail);
    if (_filters.status) filtered = filtered.filter(p => p.status === _filters.status);
    if (_filters.category) filtered = filtered.filter(p => p.category === _filters.category);

    // Count
    const count = document.createElement('div');
    count.className = 'src-count';
    count.textContent = `${filtered.length} produit(s)`;
    count.style.cssText = 'margin-bottom:8px;font-size:12px;color:#94a3b8;';
    container.appendChild(count);

    for (const p of filtered) {
      const card = document.createElement('div');
      card.className = 'src-product-card';

      const rail = p.computed.inferred_rail || '?';
      const railCls = ['A', 'B', 'C', 'D'].includes(rail) ? rail : 'unknown';
      const actionLabel = actionLabels[p.action] || p.action || '—';

      card.innerHTML = `
        <div class="src-status-dot ${p.status_color}"></div>
        <img class="src-product-img" src="${esc(p.image_url || '')}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 44 44%22><rect fill=%22%23f1f5f9%22 width=%2244%22 height=%2244%22/></svg>'">
        <div class="src-product-info">
          <div class="src-product-name">${esc(p.name)}</div>
          <div class="src-product-cat">${esc(p.category || '—')}${p.subcategory ? ' › ' + esc(p.subcategory) : ''}</div>
        </div>
        <div class="src-product-price">${fmt(p.price_kmf)}</div>
        <div class="src-product-rail ${railCls}">${rail}${p.sourcing.rail_source === 'inferred' ? ' ?' : ''}</div>
        <div class="src-product-status">${statusLabels[p.status] || p.status}</div>
        <div class="src-product-action">${actionLabel}</div>
        <div class="src-product-confidence ${p.confidence}">${p.confidence || '—'}</div>
      `;

      card.onclick = () => {
        if (_expandedProduct === p.id) {
          _expandedProduct = null;
          const detail = card.nextElementSibling;
          if (detail && detail.classList.contains('src-detail-panel')) detail.remove();
        } else {
          // Close previous
          const prev = container.querySelector('.src-detail-panel');
          if (prev) prev.remove();
          _expandedProduct = p.id;
          const panel = buildDetailPanel(p);
          card.after(panel);
        }
      };

      container.appendChild(card);

      // If expanded, show detail
      if (_expandedProduct === p.id) {
        const panel = buildDetailPanel(p);
        container.appendChild(panel);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Detail panel
  // ══════════════════════════════════════════════════════════════════════════
  function buildDetailPanel(p) {
    const panel = document.createElement('div');
    panel.className = 'src-detail-panel';

    // Reason
    const reasonCls = p.status_color === 'green' ? '' : p.status_color === 'red' ? ' red' : ' orange';
    let html = `<div class="src-detail-reason${reasonCls}">💡 ${esc(p.reason)}</div>`;

    // Details grid
    html += '<div class="src-detail-grid" style="margin-top:12px;">';
    html += field('Rail', (p.sourcing.rail || p.computed.inferred_rail || '?') + (p.sourcing.rail_source === 'inferred' ? ' (inféré)' : ''));
    html += field('Prix achat', p.sourcing.cost_price_kmf ? fmt(p.sourcing.cost_price_kmf) + ' KMF' : '—');
    html += field('Marge', p.computed.margin_pct != null ? p.computed.margin_pct + '%' + ' (' + fmt(p.computed.margin_kmf) + ' KMF)' : 'Non calculable');
    html += field('Standalone', p.computed.standalone_viable ? '✅ Oui' : '❌ Non (< seuil)');
    html += field('Poids', p.sourcing.weight_g ? p.sourcing.weight_g + 'g' + (p.sourcing.real_weight_known ? ' ✅' : ' (estimé)') : '—');
    html += field('Fragilité', p.sourcing.fragility || '—');
    html += field('Gabarit', p.sourcing.volume_class || '—');
    html += field('Cycle de vie', p.sourcing.lifecycle_status || 'inconnu');
    html += field('Qualité', p.sourcing.quality_validated ? '✅ Validée' : '❌ Non validée');
    html += field('Délai mesuré', p.sourcing.delivery_delay_days ? p.sourcing.delivery_delay_days + 'j' : '—');
    html += field('Ventes 30j', p.computed.sales_30d || '0');
    html += field('Dernière revue', p.sourcing.last_review_at ? new Date(p.sourcing.last_review_at).toLocaleDateString('fr-FR') : 'Jamais');
    html += '</div>';

    // Gaps
    if (p.gaps && p.gaps.length > 0) {
      html += '<div class="src-detail-gaps">';
      html += '<div class="gap-title">Ce qui manque :</div>';
      for (const g of p.gaps) {
        html += `<div class="gap-item">${esc(g)}</div>`;
      }
      html += '</div>';
    }

    // Suggestions
    html += '<div class="src-detail-suggestions">';
    if (p.action) html += `<div class="src-detail-chip">🎯 ${esc(actionLabels[p.action] || p.action)}</div>`;
    if (p.exposure_suggestion) html += `<div class="src-detail-chip">👁️ ${esc(p.exposure_suggestion)}</div>`;
    if (p.sale_suggestion) html += `<div class="src-detail-chip">🛒 ${esc(p.sale_suggestion)}</div>`;
    html += '</div>';

    // Alerts
    if (p.alerts && p.alerts.length > 0) {
      html += '<div class="src-alert-list" style="margin-top:10px;">';
      for (const a of p.alerts) {
        html += `<div class="src-alert ${a.level}">${esc(a.message)}</div>`;
      }
      html += '</div>';
    }

    // Edit button
    html += `<div class="src-edit-actions"><button class="src-btn src-btn-primary" data-edit-product="${p.id}">✏️ Enrichir les données</button></div>`;

    panel.innerHTML = html;

    // Wire edit button
    const editBtn = panel.querySelector('[data-edit-product]');
    if (editBtn) {
      editBtn.onclick = (e) => {
        e.stopPropagation();
        renderEditForm(panel, p);
      };
    }

    return panel;
  }

  function field(label, value) {
    return `<div class="src-detail-field"><div class="field-label">${label}</div><div class="field-value">${value}</div></div>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Edit form (inline)
  // ══════════════════════════════════════════════════════════════════════════
  function renderEditForm(panel, product) {
    // Check if already showing
    if (panel.querySelector('.src-edit-grid')) return;

    const form = document.createElement('div');
    form.className = 'src-edit-grid';
    form.innerHTML = `
      <div class="src-edit-field">
        <label>Rail</label>
        <select data-field="sourcing_rail">
          <option value="">—</option>
          <option value="A" ${product.sourcing.rail === 'A' ? 'selected' : ''}>A — Essentiel</option>
          <option value="B" ${product.sourcing.rail === 'B' ? 'selected' : ''}>B — Hero</option>
          <option value="C" ${product.sourcing.rail === 'C' ? 'selected' : ''}>C — Sur-mesure</option>
          <option value="D" ${product.sourcing.rail === 'D' ? 'selected' : ''}>D — Impulsif</option>
        </select>
      </div>
      <div class="src-edit-field">
        <label>Prix achat (KMF)</label>
        <input type="number" data-field="cost_price_kmf" value="${product.sourcing.cost_price_kmf || ''}">
      </div>
      <div class="src-edit-field">
        <label>Poids (g)</label>
        <input type="number" data-field="weight_g" value="${product.sourcing.weight_g || ''}">
      </div>
      <div class="src-edit-field">
        <label>Fragilité</label>
        <select data-field="fragility">
          <option value="">—</option>
          <option value="low" ${product.sourcing.fragility === 'low' ? 'selected' : ''}>Basse</option>
          <option value="medium" ${product.sourcing.fragility === 'medium' ? 'selected' : ''}>Moyenne</option>
          <option value="high" ${product.sourcing.fragility === 'high' ? 'selected' : ''}>Haute</option>
          <option value="critical" ${product.sourcing.fragility === 'critical' ? 'selected' : ''}>Critique</option>
        </select>
      </div>
      <div class="src-edit-field">
        <label>Gabarit</label>
        <select data-field="volume_class">
          <option value="">—</option>
          <option value="pocket" ${product.sourcing.volume_class === 'pocket' ? 'selected' : ''}>Poche</option>
          <option value="hand" ${product.sourcing.volume_class === 'hand' ? 'selected' : ''}>Main</option>
          <option value="shoebox" ${product.sourcing.volume_class === 'shoebox' ? 'selected' : ''}>Boîte à chaussures</option>
          <option value="large" ${product.sourcing.volume_class === 'large' ? 'selected' : ''}>Grand</option>
        </select>
      </div>
      <div class="src-edit-field">
        <label>Mode vente</label>
        <select data-field="sale_mode">
          <option value="">—</option>
          <option value="standalone" ${product.sourcing.sale_mode === 'standalone' ? 'selected' : ''}>Standalone</option>
          <option value="bundle_required" ${product.sourcing.sale_mode === 'bundle_required' ? 'selected' : ''}>Bundle obligatoire</option>
          <option value="deposit" ${product.sourcing.sale_mode === 'deposit' ? 'selected' : ''}>Acompte</option>
        </select>
      </div>
      <div class="src-edit-field">
        <label>Cycle de vie</label>
        <select data-field="lifecycle_status">
          <option value="">—</option>
          <option value="candidate" ${product.sourcing.lifecycle_status === 'candidate' ? 'selected' : ''}>Candidat</option>
          <option value="test" ${product.sourcing.lifecycle_status === 'test' ? 'selected' : ''}>Test</option>
          <option value="active" ${product.sourcing.lifecycle_status === 'active' ? 'selected' : ''}>Actif</option>
          <option value="star" ${product.sourcing.lifecycle_status === 'star' ? 'selected' : ''}>Star</option>
          <option value="steady" ${product.sourcing.lifecycle_status === 'steady' ? 'selected' : ''}>Steady</option>
          <option value="dead" ${product.sourcing.lifecycle_status === 'dead' ? 'selected' : ''}>Dead</option>
        </select>
      </div>
      <div class="src-edit-field">
        <label>Délai réel (jours)</label>
        <input type="number" data-field="delivery_delay_days" value="${product.sourcing.delivery_delay_days || ''}">
      </div>
      <div class="src-edit-field">
        <label>Qualité validée</label>
        <select data-field="quality_validated">
          <option value="false" ${!product.sourcing.quality_validated ? 'selected' : ''}>Non</option>
          <option value="true" ${product.sourcing.quality_validated ? 'selected' : ''}>Oui</option>
        </select>
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'src-edit-actions';
    actions.innerHTML = '<button class="src-btn src-btn-primary">💾 Sauvegarder</button><button class="src-btn src-btn-secondary">Annuler</button>';
    form.appendChild(actions);

    panel.appendChild(form);

    // Wire buttons
    const [saveBtn, cancelBtn] = actions.querySelectorAll('button');
    cancelBtn.onclick = (e) => { e.stopPropagation(); form.remove(); };
    saveBtn.onclick = async (e) => {
      e.stopPropagation();
      const body = {};
      form.querySelectorAll('[data-field]').forEach(el => {
        const key = el.dataset.field;
        let val = el.value;
        if (val === '') return;
        if (key === 'quality_validated' || key === 'real_weight_known' || key === 'real_price_validated') {
          val = val === 'true';
        } else if (['cost_price_kmf', 'weight_g', 'delivery_delay_days'].includes(key)) {
          val = Number(val);
          if (isNaN(val)) return;
        }
        body[key] = val;
      });

      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Sauvegarde...';
      try {
        await CT.api.sourcingUpdateProduct(product.id, body);
        // Reload all data
        const [synthesis, analysis] = await Promise.all([
          CT.api.sourcingSynthesis(),
          CT.api.sourcingAnalysis(),
        ]);
        _synthesisCache = synthesis;
        _analysisCache = analysis;
        // Re-render the whole view
        const mainContainer = panel.closest('[data-view]') || panel.closest('.ct-content') || panel.parentElement.parentElement;
        if (mainContainer && CT.views.sourcing.render) {
          CT.views.sourcing.render(mainContainer);
        }
      } catch (err) {
        saveBtn.textContent = '❌ Erreur';
        setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = '💾 Sauvegarder'; }, 2000);
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Util
  // ══════════════════════════════════════════════════════════════════════════
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
