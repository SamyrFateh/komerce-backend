/**
 * KOMERCE Dashboard — Vue Sourcing Intelligence /admin/sourcing
 * ════════════════════════════════════════════════════════════════════════
 * Migration de CT.views.sourcing (ct-views-sourcing.js — 717 lignes)
 *
 * 2 onglets :
 *   1. Synthèse — KPIs portefeuille, rails, tops, alertes globales
 *   2. Produits — table filtrée + panel d'enrichissement inline
 *
 * API : KmcApi.getSourcingSynthesis / getSourcingAnalysis /
 *       updateSourcingProduct / sourcingBulkRail
 */

(function (global) {
  'use strict';

  /* ── Styles ──────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('sr-styles')) return;
    const s = document.createElement('style');
    s.id = 'sr-styles';
    s.textContent = `
      .sr-tabs{display:flex;gap:4px;margin-bottom:16px}
      .sr-tab{padding:8px 16px;border-radius:8px;cursor:pointer;background:var(--bg-secondary);color:var(--text-secondary);font-weight:600;font-size:14px;border:none;transition:all .2s}
      .sr-tab.active{background:#1e293b;color:#fff}
      .sr-tab:hover:not(.active){background:var(--border)}
      /* KPI grid */
      .sr-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
      .sr-kpi{background:var(--bg-card);border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
      .sr-kpi .num{font-size:28px;font-weight:700}
      .sr-kpi .lbl{font-size:var(--fs-sm);color:var(--text-secondary);margin-top:4px}
      .sr-kpi.green .num{color:#16a34a}
      .sr-kpi.orange .num{color:#ea580c}
      .sr-kpi.red .num{color:#dc2626}
      .sr-kpi.blue .num{color:#2563eb}
      /* Progress bar */
      .sr-data-bar{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:13px;color:var(--text-secondary)}
      .sr-progress-bg{flex:1;height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden}
      .sr-progress-fill{height:100%;background:#3b82f6;border-radius:4px;transition:width .3s}
      /* Rail bar */
      .sr-rail-bar{display:flex;height:20px;border-radius:6px;overflow:hidden;margin-bottom:20px}
      .sr-rail-bar div{display:flex;align-items:center;justify-content:center;font-size:var(--fs-xs);font-weight:700;color:white}
      .sr-rail-bar .A{background:#16a34a}
      .sr-rail-bar .B{background:#2563eb}
      .sr-rail-bar .C{background:#ea580c}
      .sr-rail-bar .D{background:#7c3aed}
      /* Section */
      .sr-section{margin-bottom:20px}
      .sr-section h3{font-size:14px;color:var(--text-secondary);margin-bottom:8px;font-weight:600}
      /* Top list */
      .sr-top-list{display:flex;flex-direction:column;gap:6px}
      .sr-top-item{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg-card);border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.06);font-size:13px}
      .sr-top-item .rank{font-weight:700;color:#94a3b8;width:20px}
      .sr-top-item .name{flex:1;font-weight:500}
      .sr-rail-badge{padding:2px 8px;border-radius:10px;font-size:var(--fs-xs);font-weight:700;color:white}
      .sr-rail-badge.A{background:#16a34a}
      .sr-rail-badge.B{background:#2563eb}
      .sr-rail-badge.C{background:#ea580c}
      .sr-rail-badge.D{background:#7c3aed}
      .sr-rail-badge.unknown{background:#94a3b8}
      /* Alert list */
      .sr-alert-list{display:flex;flex-direction:column;gap:6px}
      .sr-alert{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;font-size:13px}
      .sr-alert.critical{background:#fef2f2;color:#991b1b}
      .sr-alert.warning{background:#fffbeb;color:#92400e}
      .sr-alert.info{background:#f0f9ff;color:#075985}
      /* Filter bar */
      .sr-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .sr-filters input,.sr-filters select{padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-card)}
      .sr-filters input{flex:1;min-width:200px}
      .sr-count{font-size:var(--fs-sm);color:#94a3b8;margin-bottom:8px}
      /* Product row */
      .sr-product-list{display:flex;flex-direction:column;gap:0}
      .sr-product-card{display:grid;grid-template-columns:12px 44px 1fr 90px 40px 100px 90px 60px;align-items:center;gap:8px;padding:10px 12px;background:var(--bg-card);border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s;font-size:13px}
      .sr-product-card:hover{background:var(--bg-secondary)}
      .sr-product-card:first-child{border-radius:8px 8px 0 0}
      .sr-product-card:last-child{border-radius:0 0 8px 8px;border-bottom:none}
      .sr-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
      .sr-dot.green{background:#16a34a}
      .sr-dot.orange{background:#ea580c}
      .sr-dot.red{background:#dc2626}
      .sr-dot.grey{background:#94a3b8}
      .sr-product-img{width:36px;height:36px;object-fit:cover;border-radius:6px;background:var(--bg-secondary)}
      .sr-product-name{font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sr-product-cat{font-size:var(--fs-xs);color:var(--text-secondary)}
      .sr-price{font-weight:700;font-size:var(--fs-sm);text-align:right;color:var(--text-primary)}
      .sr-status{font-size:var(--fs-xs);color:var(--text-secondary)}
      /* Detail panel */
      .sr-detail-panel{background:#f8fafc;border-left:3px solid #3b82f6;padding:16px;font-size:13px;margin-bottom:1px}
      .sr-detail-reason{padding:10px 12px;border-radius:6px;background:#eff6ff;color:#1e40af;margin-bottom:12px}
      .sr-detail-reason.orange{background:#fff7ed;color:#c2410c}
      .sr-detail-reason.red{background:#fef2f2;color:#991b1b}
      .sr-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:12px}
      .sr-field{display:flex;flex-direction:column;gap:2px}
      .sr-field .fl{font-size:var(--fs-xs);color:#94a3b8;text-transform:uppercase;letter-spacing:.3px}
      .sr-field .fv{font-size:13px;color:var(--text-primary);font-weight:500}
      .sr-gaps,.sr-suggestions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .sr-gap-item{background:#fef3c7;color:#92400e;font-size:var(--fs-xs);padding:var(--sp-1) var(--sp-3);border-radius:6px}
      .sr-chip{background:var(--bg-secondary);font-size:var(--fs-xs);padding:var(--sp-1) var(--sp-3);border-radius:6px;color:var(--text-secondary)}
      /* Edit form */
      .sr-edit-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px;padding:12px;background:white;border-radius:8px;border:1px solid var(--border)}
      .sr-edit-field{display:flex;flex-direction:column;gap:4px}
      .sr-edit-field label{font-size:var(--fs-xs);font-weight:700;color:var(--text-secondary);text-transform:uppercase}
      .sr-edit-field input,.sr-edit-field select{padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:13px}
      .sr-edit-actions{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
    `;
    document.head.appendChild(s);
  }

  /* ── Constantes ──────────────────────────────────────────────────────── */
  const STATUS_LABELS = {
    en_phase: '🟢 En phase', sous_reserve: '🟠 Sous réserve',
    test_requis: '🟠 Test requis', hors_phase: '🔴 Hors phase',
  };
  const ACTION_LABELS = {
    push: 'Pousser', watch: 'Surveiller', freeze: 'Geler',
    test: 'Tester', enrich: 'Enrichir', deprioritize: 'Dépriori.',
  };

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const _nf  = new Intl.NumberFormat('fr-FR');
  const _fmt = n => _nf.format(Number(n) || 0);
  const _esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  /* ── État ────────────────────────────────────────────────────────────── */
  let _synthesis = null, _analysis = null;
  let _activeTab = 'synthesis', _expandedProduct = null;
  let _filters = { search: '', rail: '', status: '', category: '' };

  /* ── Render principal ────────────────────────────────────────────────── */
  async function render(rootEl) {
    _injectStyles();
    rootEl.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement moteur sourcing…</div>';

    try {
      const [synthesis, analysis] = await Promise.all([
        KmcApi.getSourcingSynthesis().catch(() => null),
        KmcApi.getSourcingAnalysis().catch(() => ({ products: [] })),
      ]);
      _synthesis = synthesis;
      _analysis  = analysis;
      _buildUI(rootEl);
    } catch (err) {
      rootEl.innerHTML = `<div class="error-state">Erreur : ${_esc(err.message)}</div>`;
    }
  }

  function _buildUI(rootEl) {
    let html = `
      <h1 class="page-title">🔍 Intelligence Sourcing</h1>
      <p class="page-subtitle">Portefeuille produits · Rails · Alertes · Enrichissement</p>
      <div class="sr-tabs">
        <button class="sr-tab${_activeTab === 'synthesis' ? ' active' : ''}" data-sr-tab="synthesis">📊 Synthèse</button>
        <button class="sr-tab${_activeTab === 'products' ? ' active' : ''}" data-sr-tab="products">📦 Produits</button>
      </div>
      <div id="sr-content"></div>
    `;
    rootEl.innerHTML = html;

    // Guard : navigation entre-temps → rootEl détaché du DOM
    if (!rootEl || !document.contains(rootEl)) return;

    const content = document.getElementById('sr-content');
    if (_activeTab === 'synthesis') _renderSynthesis(content);
    else _renderProducts(content, rootEl);

    rootEl.querySelectorAll('[data-sr-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.srTab;
        _expandedProduct = null;
        _buildUI(rootEl);
      });
    });
  }

  /* ── Onglet Synthèse ────────────────────────────────────────────────── */
  function _renderSynthesis(el) {
    const s = _synthesis;
    if (!s) { el.innerHTML = '<p class="empty-state">Données synthèse non disponibles.</p>'; return; }

    const byStatus = s.by_status || {};
    const byRail   = s.by_rail   || {};
    const total    = s.total_active || 1;
    const cPct     = s.data_completeness_pct || 0;

    const kpis = [
      { num: byStatus.en_phase || 0,     lbl: 'En phase',       cls: 'green'  },
      { num: byStatus.sous_reserve || 0, lbl: 'Sous réserve',   cls: 'orange' },
      { num: byStatus.test_requis || 0,  lbl: 'Test requis',    cls: 'orange' },
      { num: byStatus.hors_phase || 0,   lbl: 'Hors phase',     cls: 'red'    },
      { num: s.total_active || 0,        lbl: 'Actifs total',   cls: 'blue'   },
      { num: cPct + '%',                 lbl: 'Complétude',     cls: cPct >= 50 ? 'green' : 'orange' },
    ];

    let html = `<section class="page-section"><div class="sr-kpi-grid">
      ${kpis.map(k => `<div class="sr-kpi ${k.cls}"><div class="num">${k.num}</div><div class="lbl">${k.lbl}</div></div>`).join('')}
    </div>`;

    html += `<div class="sr-data-bar">
      <span>📊 Complétude sourcing</span>
      <div class="sr-progress-bg"><div class="sr-progress-fill" style="width:${cPct}%"></div></div>
      <span>${cPct}%</span>
    </div>`;

    /* Rail distribution */
    const railSegments = ['A','B','C','D'].map(r => {
      const pct = Math.round((byRail[r] || 0) / total * 100);
      return pct > 0 ? `<div class="${r}" style="width:${pct}%">${r} ${pct}%</div>` : '';
    }).join('');
    if (railSegments) html += `<div class="sr-rail-bar" title="Distribution rails">${railSegments}</div>`;
    html += '</section>';

    /* Global alerts */
    if (s.global_alerts?.length) {
      html += `<section class="page-section"><div class="card"><div class="card-header"><h3 class="card-title">⚡ Alertes portefeuille</h3></div><div class="card-body"><div class="sr-alert-list">
        ${s.global_alerts.map(a => `<div class="sr-alert ${a.level}">${_esc(a.message)}</div>`).join('')}
      </div></div></div></section>`;
    }

    /* Top lists */
    html += '<section class="page-section"><div class="grid grid-3">';
    html += _renderTopList('🚀 À pousser', s.top_push, p => `${p.sales_30d} ventes/30j · marge ${p.margin_pct}%`);
    html += _renderTopList('👀 À surveiller', s.top_watch, p => p.reason);
    html += _renderTopList('❄️ À geler', s.top_freeze, p => p.reason);
    html += '</div></section>';

    el.innerHTML = html;
  }

  function _renderTopList(title, items, descFn) {
    if (!items?.length) return '';
    const rows = items.map((p, i) => {
      const rail = p.rail || 'unknown';
      return `<div class="sr-top-item">
        <span class="rank">${i+1}</span>
        <span class="name">${_esc(p.name)}</span>
        <span class="sr-rail-badge ${rail}">${rail}</span>
        <span style="color:var(--text-secondary);font-size:var(--fs-sm)">${_esc(descFn(p))}</span>
      </div>`;
    }).join('');
    return `<div class="card"><div class="card-header"><h3 class="card-title">${title}</h3></div>
      <div class="card-body"><div class="sr-top-list">${rows}</div></div></div>`;
  }

  /* ── Onglet Produits ────────────────────────────────────────────────── */
  function _renderProducts(el, rootEl) {
    const products = _analysis?.products || [];
    const cats = [...new Set(products.map(p => p.category))].filter(Boolean).sort();

    el.innerHTML = `
      <section class="page-section">
        <div class="card">
          <div class="card-body">
            <div class="sr-filters">
              <input id="sr-search" type="text" placeholder="🔍 Rechercher produit…" value="${_esc(_filters.search)}">
              <select id="sr-rail">
                <option value="">Tous rails</option>
                ${['A','B','C','D'].map(r => `<option value="${r}"${_filters.rail === r ? ' selected' : ''}>${r}</option>`).join('')}
              </select>
              <select id="sr-status">
                <option value="">Tous statuts</option>
                ${Object.entries(STATUS_LABELS).map(([k,v]) => `<option value="${k}"${_filters.status === k ? ' selected' : ''}>${v}</option>`).join('')}
              </select>
              <select id="sr-cat">
                <option value="">Toutes catégories</option>
                ${cats.map(c => `<option value="${c}"${_filters.category === c ? ' selected' : ''}>${_esc(c)}</option>`).join('')}
              </select>
            </div>
            <div id="sr-product-list"></div>
          </div>
        </div>
      </section>`;

    const listEl = document.getElementById('sr-product-list');
    _renderProductList(listEl, products, rootEl);

    document.getElementById('sr-search')?.addEventListener('input', e => {
      _filters.search = e.target.value;
      _renderProductList(listEl, products, rootEl);
    });
    document.getElementById('sr-rail')?.addEventListener('change', e => {
      _filters.rail = e.target.value;
      _renderProductList(listEl, products, rootEl);
    });
    document.getElementById('sr-status')?.addEventListener('change', e => {
      _filters.status = e.target.value;
      _renderProductList(listEl, products, rootEl);
    });
    document.getElementById('sr-cat')?.addEventListener('change', e => {
      _filters.category = e.target.value;
      _renderProductList(listEl, products, rootEl);
    });
  }

  function _renderProductList(container, products, rootEl) {
    let filtered = [...products];
    const q = _filters.search.toLowerCase();
    if (q) filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || (p.category||'').toLowerCase().includes(q));
    if (_filters.rail)     filtered = filtered.filter(p => (p.computed?.inferred_rail || p.sourcing?.rail) === _filters.rail);
    if (_filters.status)   filtered = filtered.filter(p => p.status === _filters.status);
    if (_filters.category) filtered = filtered.filter(p => p.category === _filters.category);

    if (!filtered.length) {
      container.innerHTML = '<p class="empty-state">Aucun produit correspondant aux filtres.</p>';
      return;
    }

    container.innerHTML = `<div class="sr-count">${filtered.length} produit(s)</div><div class="sr-product-list">
      ${filtered.map(p => _renderProductCard(p)).join('')}
    </div>`;

    container.querySelectorAll('.sr-product-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.sr-detail-panel') || e.target.closest('.sr-edit-actions')) return;
        const id = card.dataset.srPid;
        const existingDetail = card.nextElementSibling;
        if (existingDetail?.classList.contains('sr-detail-panel')) {
          _expandedProduct = null;
          existingDetail.remove();
        } else {
          container.querySelector('.sr-detail-panel')?.remove();
          _expandedProduct = id;
          const p = filtered.find(x => x.id === id);
          if (p) card.after(_buildDetailPanel(p, rootEl));
        }
      });
    });
  }

  function _renderProductCard(p) {
    const rail    = p.computed?.inferred_rail || p.sourcing?.rail || '?';
    const railCls = ['A','B','C','D'].includes(rail) ? rail : 'unknown';
    const dotCls  = p.status_color || 'grey';
    const action  = ACTION_LABELS[p.action] || p.action || '—';
    const status  = STATUS_LABELS[p.status] || p.status || '—';
    return `<div class="sr-product-card" data-sr-pid="${p.id}">
      <div class="sr-dot ${dotCls}"></div>
      <img class="sr-product-img" src="${_esc(p.image_url||'')}" alt="" loading="lazy"
           onerror="this.style.visibility='hidden'">
      <div><div class="sr-product-name">${_esc(p.name)}</div><div class="sr-product-cat">${_esc(p.category||'—')}${p.subcategory?' › '+_esc(p.subcategory):''}</div></div>
      <div class="sr-price">${_fmt(p.price_kmf)} KMF</div>
      <span class="sr-rail-badge ${railCls}">${rail}${p.sourcing?.rail_source==='inferred'?' ?':''}</span>
      <div class="sr-status">${status}</div>
      <div style="font-size:var(--fs-xs);color:var(--text-secondary)">${action}</div>
      <div style="font-size:var(--fs-xs);color:#94a3b8">${p.confidence||'—'}</div>
    </div>`;
  }

  function _buildDetailPanel(p, rootEl) {
    const el = document.createElement('div');
    el.className = 'sr-detail-panel';

    const reasonCls = p.status_color === 'green' ? '' : p.status_color === 'red' ? ' red' : ' orange';
    const co = p.computed || {};
    const so = p.sourcing || {};

    const fields = [
      ['Rail',           (so.rail || co.inferred_rail || '?') + (so.rail_source==='inferred'?' (inféré)':'')],
      ['Prix achat',     so.cost_price_kmf ? _fmt(so.cost_price_kmf)+' KMF' : '—'],
      ['Marge',          co.margin_pct != null ? co.margin_pct+'% ('+_fmt(co.margin_kmf)+' KMF)' : 'Non calculable'],
      ['Standalone',     co.standalone_viable ? '✅ Oui' : '❌ Non'],
      ['Poids',          so.weight_g ? so.weight_g+'g'+(so.real_weight_known?' ✅':' (estimé)') : '—'],
      ['Fragilité',      so.fragility || '—'],
      ['Gabarit',        so.volume_class || '—'],
      ['Cycle de vie',   so.lifecycle_status || 'inconnu'],
      ['Qualité',        so.quality_validated ? '✅ Validée' : '❌ Non'],
      ['Délai mesuré',   so.delivery_delay_days ? so.delivery_delay_days+'j' : '—'],
      ['Ventes 30j',     co.sales_30d || '0'],
      ['Dernière revue', so.last_review_at ? new Date(so.last_review_at).toLocaleDateString('fr-FR') : 'Jamais'],
    ];

    let html = `<div class="sr-detail-reason${reasonCls}">💡 ${_esc(p.reason)}</div>
      <div class="sr-detail-grid">
        ${fields.map(([l,v]) => `<div class="sr-field"><div class="fl">${l}</div><div class="fv">${_esc(v)}</div></div>`).join('')}
      </div>`;

    if (p.gaps?.length) {
      html += `<div class="sr-gaps">${p.gaps.map(g => `<span class="sr-gap-item">${_esc(g)}</span>`).join('')}</div>`;
    }

    html += '<div class="sr-suggestions">';
    if (p.action)              html += `<span class="sr-chip">🎯 ${_esc(ACTION_LABELS[p.action]||p.action)}</span>`;
    if (p.exposure_suggestion) html += `<span class="sr-chip">👁 ${_esc(p.exposure_suggestion)}</span>`;
    if (p.sale_suggestion)     html += `<span class="sr-chip">🛒 ${_esc(p.sale_suggestion)}</span>`;
    html += '</div>';

    if (p.alerts?.length) {
      html += `<div class="sr-alert-list" style="margin-top:10px">
        ${p.alerts.map(a => `<div class="sr-alert ${a.level}">${_esc(a.message)}</div>`).join('')}
      </div>`;
    }

    html += `<div class="sr-edit-actions"><button class="btn btn-primary" data-sr-edit="${p.id}">✏️ Enrichir les données</button></div>`;
    el.innerHTML = html;

    el.querySelector('[data-sr-edit]')?.addEventListener('click', ev => {
      ev.stopPropagation();
      _renderEditForm(el, p, rootEl);
    });
    return el;
  }

  function _renderEditForm(panel, product, rootEl) {
    if (panel.querySelector('.sr-edit-grid')) return;
    const so = product.sourcing || {};

    const form = document.createElement('div');
    form.className = 'sr-edit-grid';
    form.innerHTML = `
      <div class="sr-edit-field"><label>Rail</label>
        <select data-ef="sourcing_rail">
          <option value="">—</option>
          ${['A','B','C','D'].map(r => `<option value="${r}"${so.rail===r?' selected':''}>${r} — ${r==='A'?'Essentiel':r==='B'?'Hero':r==='C'?'Sur-mesure':'Impulsif'}</option>`).join('')}
        </select></div>
      <div class="sr-edit-field"><label>Prix achat (KMF)</label>
        <input type="number" data-ef="cost_price_kmf" value="${so.cost_price_kmf||''}"></div>
      <div class="sr-edit-field"><label>Poids (g)</label>
        <input type="number" data-ef="weight_g" value="${so.weight_g||''}"></div>
      <div class="sr-edit-field"><label>Fragilité</label>
        <select data-ef="fragility">
          <option value="">—</option>
          ${['low','medium','high','critical'].map(v => `<option value="${v}"${so.fragility===v?' selected':''}>{{${v}}}</option>`).join('')
            .replace('{{low}}','Basse').replace('{{medium}}','Moyenne').replace('{{high}}','Haute').replace('{{critical}}','Critique')}
        </select></div>
      <div class="sr-edit-field"><label>Gabarit</label>
        <select data-ef="volume_class">
          <option value="">—</option>
          ${['pocket','hand','shoebox','large'].map(v => `<option value="${v}"${so.volume_class===v?' selected':''}>{{${v}}}</option>`).join('')
            .replace('{{pocket}}','Poche').replace('{{hand}}','Main').replace('{{shoebox}}','Boîte à chaussures').replace('{{large}}','Grand')}
        </select></div>
      <div class="sr-edit-field"><label>Cycle de vie</label>
        <select data-ef="lifecycle_status">
          <option value="">—</option>
          ${['candidate','test','active','star','steady','dead'].map(v => `<option value="${v}"${so.lifecycle_status===v?' selected':''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('')}
        </select></div>
      <div class="sr-edit-field"><label>Délai réel (j)</label>
        <input type="number" data-ef="delivery_delay_days" value="${so.delivery_delay_days||''}"></div>
      <div class="sr-edit-field"><label>Qualité validée</label>
        <select data-ef="quality_validated">
          <option value="false"${!so.quality_validated?' selected':''}>Non</option>
          <option value="true"${so.quality_validated?' selected':''}>Oui</option>
        </select></div>
      <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button class="btn btn-secondary" data-sr-cancel>Annuler</button>
        <button class="btn btn-primary" data-sr-save>💾 Sauvegarder</button>
      </div>`;

    panel.appendChild(form);

    form.querySelector('[data-sr-cancel]').addEventListener('click', e => { e.stopPropagation(); form.remove(); });
    const saveBtn = form.querySelector('[data-sr-save]');
    saveBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const body = {};
      form.querySelectorAll('[data-ef]').forEach(input => {
        const key = input.dataset.ef;
        let val = input.value;
        if (!val) return;
        if (key === 'quality_validated') val = val === 'true';
        else if (['cost_price_kmf','weight_g','delivery_delay_days'].includes(key)) { val = Number(val); if (isNaN(val)) return; }
        body[key] = val;
      });
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Sauvegarde…';
      try {
        await KmcApi.updateSourcingProduct(product.id, body);
        render(rootEl);
      } catch (err) {
        saveBtn.textContent = '❌ Erreur';
        setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = '💾 Sauvegarder'; }, 2000);
      }
    });
  }

  global.SourcingView = { render };
})(window);
