/**
 * @komerce-arch
 * @role          admin-pricing-strategy-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        pricing strategies, candidates, benchmarks
 * @outputs       pricing_strategy_page_dom (stratégies actives, simulation, validation)
 * @depends       api-client.js, filters-store.js, utils.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  pricing, strategy, sourcing, economic-engine, admin-dashboard
 * @version       2026-06
 */
/**
 * KOMERCE Dashboard — Vue Stratégie de Prix /admin/pricing-strategy
 * ═══════════════════════════════════════════════════════════════════════════
 * Migration de CT.views.pricing_strategy (ct-views-pricing-strategy.js — 571 lignes)
 *
 * CONCEPT MÉTIER :
 *   Permet d'arbitrer le prix de vente final à partir de :
 *     - CDR (coût de revient) calculé par le moteur
 *     - Prix concurrents (saisie manuelle + observations)
 *     - Élasticité estimée (depuis price_history + ventes)
 *     - Stratégie choisie : mécanique / aligné / premium / loss leader / manuel
 *
 * API :
 *   KmcApi.getPricingStrategy(params)        → données stratégie + options
 *   KmcApi.getPricingCompetitors(params)     → liste des concurrents
 *   KmcApi.createPricingCompetitor(body)     → ajouter un concurrent
 *   KmcApi.deletePricingCompetitor(id)       → supprimer un concurrent
 *   KmcApi.applyPricingStrategy(body)        → appliquer la stratégie
 *   KmcApi.getProducts(params)               → liste produits (pour le sélecteur)
 *
 * Note : feature_flag pricing_strategy=false dans ct-platform.js.
 *        Vérifier activation en production avant déploiement.
 */

(function (global) {
  'use strict';

  /* ── Styles ──────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('ps-styles')) return;
    const s = document.createElement('style');
    s.id = 'ps-styles';
    s.textContent = `
      .ps-wrap{padding:20px 24px;max-width:1200px;margin:0 auto}
      .ps-selector{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px}
      .ps-mode-tabs{display:flex;gap:4px;margin-bottom:12px}
      .ps-mode-tab{padding:6px 14px;font-size:12px;font-weight:600;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-secondary);cursor:pointer}
      .ps-mode-tab.active{background:#f59e0b;color:#fff;border-color:#f59e0b}
      .ps-select-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .ps-select{padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-primary);font-size:14px;min-width:280px}
      .ps-inputs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
      .ps-input-card{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px}
      .ps-input-title{font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:6px}
      .ps-input-value{font-size:22px;font-weight:800;font-family:ui-monospace,monospace;color:var(--text-primary)}
      .ps-input-detail{font-size:12px;color:#94a3b8;margin-top:4px}
      .ps-competitors{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px}
      .ps-comp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      .ps-comp-title{font-size:14px;font-weight:700;color:var(--text-primary)}
      .ps-comp-row{display:grid;grid-template-columns:1fr 120px 100px 30px;align-items:center;gap:10px;padding:6px 0;font-size:13px;border-bottom:1px solid var(--border)}
      .ps-comp-row:last-child{border-bottom:none}
      .ps-comp-name{color:var(--text-secondary)}
      .ps-comp-price{font-family:ui-monospace,monospace;font-weight:600;text-align:right;color:var(--text-primary)}
      .ps-comp-date{font-size:11px;color:#94a3b8;text-align:right}
      .ps-strategies{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:16px}
      .ps-strategy{background:var(--bg-card);border:2px solid var(--border);border-radius:10px;padding:14px;cursor:pointer;transition:all .15s;position:relative}
      .ps-strategy:hover{border-color:#94a3b8}
      .ps-strategy.selected{border-color:#f59e0b;background:#fffbeb}
      .ps-strategy.selected::before{content:'✓';position:absolute;top:8px;right:10px;color:#f59e0b;font-weight:800;font-size:18px}
      .ps-strategy-emoji{font-size:22px;margin-bottom:6px}
      .ps-strategy-name{font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:4px}
      .ps-strategy-desc{font-size:12px;color:var(--text-secondary);margin-bottom:8px;min-height:32px}
      .ps-strategy-price{font-size:20px;font-weight:800;font-family:ui-monospace,monospace;color:#d97706}
      .ps-strategy-margin{font-size:12px;color:var(--text-secondary);margin-top:2px}
      .ps-strategy-margin.low{color:#dc2626}
      .ps-strategy-margin.mid{color:#d97706}
      .ps-strategy-margin.good{color:#16a34a}
      .ps-manual-row{display:flex;gap:10px;align-items:center;margin-top:8px}
      .ps-manual-input{flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:ui-monospace,monospace;font-size:14px;background:var(--bg-card);color:var(--text-primary)}
      .ps-verdict{background:linear-gradient(135deg,#fef3c7,#fffbeb);border:2px solid #fcd34d;border-radius:12px;padding:20px;display:flex;justify-content:space-between;align-items:center;margin-top:16px}
      .ps-verdict-info{flex:1}
      .ps-verdict-label{font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
      .ps-verdict-price{font-size:32px;font-weight:900;font-family:ui-monospace,monospace;color:#d97706}
      .ps-verdict-vs{font-size:13px;color:var(--text-secondary);margin-top:4px}
      .ps-current-strategy{background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;font-size:13px;color:#92400e;margin-top:14px}
      /* Modal concurrent */
      .ps-modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:2000;display:none}
      .ps-modal-bg.open{display:block}
      .ps-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--bg-card);border-radius:12px;padding:22px;width:440px;max-width:90vw;z-index:2001;display:none;box-shadow:0 20px 50px rgba(0,0,0,.25)}
      .ps-modal.open{display:block}
      .ps-modal-title{font-size:16px;font-weight:800;margin-bottom:14px;color:var(--text-primary)}
      .ps-modal-row{margin-bottom:12px}
      .ps-modal-label{display:block;font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.3px;font-weight:600;margin-bottom:4px}
      .ps-modal-input{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:14px;box-sizing:border-box;background:var(--bg-card);color:var(--text-primary)}
      .ps-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
    `;
    document.head.appendChild(s);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const _nf = new Intl.NumberFormat('fr-FR');
  function fmt(n)  { return _nf.format(Math.round(n || 0)) + ' KMF'; }

  /* ── State ───────────────────────────────────────────────────────────── */
  const state = {
    mode: 'product', productId: null, category: null,
    products: [], categories: [],
    data: null,
    selectedStrategy: 'mechanical', manualPrice: null,
    competitorModalOpen: false,
  };
  let _container = null;

  /* ── Chargement ──────────────────────────────────────────────────────── */
  async function loadProducts() {
    try {
      const r = await global.KmcApi.getProducts({ is_active: true });
      state.products = r.products || r || [];
      const cats = new Set();
      state.products.forEach(p => { if (p.category) cats.add(p.category); });
      state.categories = Array.from(cats).sort();
    } catch { state.products = []; state.categories = []; }
  }

  async function loadStrategy() {
    if (state.mode === 'product' && !state.productId) { state.data = null; return; }
    if (state.mode === 'category' && !state.category) { state.data = null; return; }
    const param = state.mode === 'product'
      ? { product_id: state.productId }
      : { category: state.category };
    try {
      state.data = await global.KmcApi.getPricingStrategy(param);
    } catch { state.data = null; }
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  async function render(container) {
    _injectStyles();
    _container = container;
    container.innerHTML = '<div class="kmc-loading">⏳ Chargement stratégie de prix…</div>';

    try {
      if (!state.products.length) {
        await loadProducts();
        if (state.products.length && !state.productId && state.mode === 'product') state.productId = state.products[0].id;
        if (state.categories.length && !state.category && state.mode === 'category') state.category = state.categories[0];
      }
      await loadStrategy();
      renderHTML();
    } catch (err) {
      container.innerHTML = `<div class="kmc-error">Erreur : ${err.message}</div>`;
    }
  }

  function renderHTML() {
    const d = state.data;
    let html = '<div class="ps-wrap">';

    html += `
      <div class="kmc-view-header">
        <h2>💰 Stratégie de prix</h2>
        <div class="kmc-subtitle">Le moteur calcule, l'humain décide. Croisez coût de revient, concurrence et marge cible.</div>
      </div>
      <div class="ps-selector">
        <div class="ps-mode-tabs">
          <button class="ps-mode-tab${state.mode === 'product' ? ' active' : ''}" data-act="set-mode" data-mode="product">📦 Par produit</button>
          <button class="ps-mode-tab${state.mode === 'category' ? ' active' : ''}" data-act="set-mode" data-mode="category">📂 Par catégorie</button>
        </div>
        <div class="ps-select-row">`;

    if (state.mode === 'product') {
      html += `<select class="ps-select" data-act="set-product">
        ${state.products.map(p => `<option value="${p.id}"${p.id === state.productId ? ' selected' : ''}>${p.name} · ${fmt(p.price_kmf)}</option>`).join('')}
      </select>`;
    } else {
      html += `<select class="ps-select" data-act="set-category">
        ${state.categories.map(c => `<option value="${c}"${c === state.category ? ' selected' : ''}>${c}</option>`).join('')}
      </select>`;
    }
    html += '</div></div>';

    if (!d) {
      html += '<div class="kmc-empty">Aucune donnée disponible. Sélectionnez un produit ou une catégorie.</div></div>';
      _container.innerHTML = html;
      bindEvents();
      return;
    }

    // 4 cartes inputs
    html += '<div class="ps-inputs-grid">';
    html += inputCard('1️⃣ Coût de revient', fmt(d.cdr?.cout_total_kmf),
      `N1+N2+N3 = ${fmt(d.cdr?.n1)} + ${fmt(d.cdr?.n2)} + ${fmt(d.cdr?.n3)}`);
    html += d.competitors?.count
      ? inputCard('2️⃣ Prix concurrence (médiane)', fmt(d.competitors.median),
          `${d.competitors.count} obs · ${fmt(d.competitors.min)} – ${fmt(d.competitors.max)}`)
      : inputCard('2️⃣ Prix concurrence', '—', 'Aucune donnée — saisissez ci-dessous');
    html += inputCard('3️⃣ Prix actuel', fmt(d.target?.current_price_kmf),
      d.target?.product_id ? d.target.name : `Médiane catégorie ${d.target?.category}`);
    html += d.elasticity?.value != null
      ? inputCard('4️⃣ Élasticité-prix', d.elasticity.value.toFixed(2),
          d.elasticity.is_significant ? `${d.elasticity.interpretation} (${d.elasticity.sample_size} ventes)` : 'données insuffisantes')
      : inputCard('4️⃣ Élasticité-prix', '—', 'Pas assez de changements de prix passés');
    html += '</div>';

    // Concurrents
    html += renderCompetitors(d);

    // Stratégies
    html += '<h3 style="font-size:14px;font-weight:700;margin:20px 0 10px">🎯 Choisissez votre stratégie</h3>';
    html += '<div class="ps-strategies">';
    html += strategyCard('mechanical', '⚙️', 'Mécanique', d.options?.mechanical?.description, d.options?.mechanical);
    if (d.options?.competitor_aligned) html += strategyCard('competitor_aligned', '🎯', 'Aligné concurrence', d.options.competitor_aligned.description, d.options.competitor_aligned);
    if (d.options?.premium_10)         html += strategyCard('premium', '💎', 'Premium +10%', d.options.premium_10.description, d.options.premium_10);
    if (d.options?.loss_leader)        html += strategyCard('loss_leader', '🚀', 'Loss leader -10%', d.options.loss_leader.description, d.options.loss_leader);
    html += manualCard(d);
    html += '</div>';

    // Verdict
    const finalPrice = getFinalPrice(d);
    const currentPrice = d.target?.current_price_kmf || 0;
    const delta = finalPrice - currentPrice;
    const deltaPct = currentPrice > 0 ? (delta / currentPrice * 100).toFixed(1) : 0;

    html += `<div class="ps-verdict">
      <div class="ps-verdict-info">
        <div class="ps-verdict-label">Prix qui sera appliqué</div>
        <div class="ps-verdict-price">${fmt(finalPrice)}</div>
        <div class="ps-verdict-vs">vs prix actuel ${fmt(currentPrice)} (${delta >= 0 ? '+' : ''}${deltaPct}%)</div>
      </div>
      <button class="kmc-btn kmc-btn-primary" data-act="apply-strategy" style="padding:12px 24px;font-size:14px">✓ Appliquer cette stratégie</button>
    </div>`;

    if (d.current_strategy) {
      html += `<div class="ps-current-strategy">
        Stratégie actuelle : <strong>${d.current_strategy.strategy_type}</strong> ·
        appliquée le ${new Date(d.current_strategy.applied_at).toLocaleDateString('fr-FR')}
      </div>`;
    }

    html += '</div>';

    // Modal concurrent
    html += competitorModalHTML();

    _container.innerHTML = html;
    bindEvents();
  }

  function inputCard(title, value, detail) {
    return `<div class="ps-input-card">
      <div class="ps-input-title">${title}</div>
      <div class="ps-input-value">${value}</div>
      <div class="ps-input-detail">${detail || ''}</div>
    </div>`;
  }

  function renderCompetitors(d) {
    let html = `<div class="ps-competitors">
      <div class="ps-comp-head">
        <span class="ps-comp-title">🏪 Prix concurrents observés (${d.competitors?.count || 0})</span>
        <button class="kmc-btn kmc-btn-secondary" data-act="open-competitor-modal" style="padding:5px 12px;font-size:12px">+ Ajouter un prix</button>
      </div>`;

    if (!d.competitors?.count) {
      html += '<div class="kmc-empty">Aucun prix concurrent saisi pour cette cible.</div>';
    } else {
      d.competitors.items.forEach(c => {
        html += `<div class="ps-comp-row">
          <span class="ps-comp-name">${c.competitor_name}${c.notes ? ` · <span style="color:#94a3b8;font-style:italic">${c.notes}</span>` : ''}</span>
          <span class="ps-comp-price">${fmt(c.price_kmf)}</span>
          <span class="ps-comp-date">${new Date(c.observed_at).toLocaleDateString('fr-FR')}</span>
          <button class="kmc-btn-ghost" data-act="del-competitor" data-id="${c.id}" style="background:none;border:none;cursor:pointer;color:var(--text-secondary);font-size:18px">×</button>
        </div>`;
      });
    }
    html += '</div>';
    return html;
  }

  function strategyCard(key, emoji, name, desc, opt) {
    if (!opt) return '';
    const selected = state.selectedStrategy === key;
    const mc = opt.margin_pct < 10 ? 'low' : (opt.margin_pct < 25 ? 'mid' : 'good');
    return `<div class="ps-strategy${selected ? ' selected' : ''}" data-act="select-strategy" data-strategy="${key}">
      <div class="ps-strategy-emoji">${emoji}</div>
      <div class="ps-strategy-name">${name}</div>
      <div class="ps-strategy-desc">${desc || ''}</div>
      <div class="ps-strategy-price">${fmt(opt.price)}</div>
      <div class="ps-strategy-margin ${mc}">Marge ${opt.margin_pct}% · ${fmt(opt.margin_kmf)}</div>
    </div>`;
  }

  function manualCard(d) {
    const selected = state.selectedStrategy === 'manual';
    const value = state.manualPrice !== null ? state.manualPrice : (d.target?.current_price_kmf || 0);
    return `<div class="ps-strategy${selected ? ' selected' : ''}" data-act="select-strategy" data-strategy="manual">
      <div class="ps-strategy-emoji">✏️</div>
      <div class="ps-strategy-name">Manuel</div>
      <div class="ps-strategy-desc">Vous saisissez le prix vous-même</div>
      <div class="ps-manual-row">
        <input type="number" class="ps-manual-input" data-act="set-manual-price" value="${value}" min="0" step="100">
      </div>
    </div>`;
  }

  function getFinalPrice(d) {
    switch (state.selectedStrategy) {
      case 'mechanical':          return d.options?.mechanical?.price || 0;
      case 'competitor_aligned':  return d.options?.competitor_aligned?.price || 0;
      case 'premium':             return d.options?.premium_10?.price || 0;
      case 'loss_leader':         return d.options?.loss_leader?.price || 0;
      case 'manual':              return state.manualPrice || d.target?.current_price_kmf || 0;
      default:                    return 0;
    }
  }

  function competitorModalHTML() {
    const open = state.competitorModalOpen;
    return `<div class="ps-modal-bg${open ? ' open' : ''}" data-act="close-competitor-modal"></div>
      <div class="ps-modal${open ? ' open' : ''}">
        <div class="ps-modal-title">+ Ajouter un prix concurrent</div>
        <div class="ps-modal-row"><label class="ps-modal-label">Nom concurrent</label>
          <input class="ps-modal-input" data-modal-field="name" placeholder="ex: Coliexpress"></div>
        <div class="ps-modal-row"><label class="ps-modal-label">Prix observé (KMF)</label>
          <input class="ps-modal-input" type="number" data-modal-field="price" min="0" step="500"></div>
        <div class="ps-modal-row"><label class="ps-modal-label">Notes (optionnel)</label>
          <input class="ps-modal-input" data-modal-field="notes" placeholder="ex: même produit, livraison 5j"></div>
        <div class="ps-modal-actions">
          <button class="kmc-btn kmc-btn-secondary" data-act="close-competitor-modal">Annuler</button>
          <button class="kmc-btn kmc-btn-primary" data-act="save-competitor">Ajouter</button>
        </div>
      </div>`;
  }

  /* ── Événements ──────────────────────────────────────────────────────── */
  function bindEvents() {
    _container.addEventListener('change', async e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'set-product')      { state.productId = t.value; await loadStrategy(); renderHTML(); }
      else if (act === 'set-category') { state.category = t.value; await loadStrategy(); renderHTML(); }
      else if (act === 'set-manual-price') { state.manualPrice = parseFloat(t.value) || 0; renderHTML(); }
    });

    _container.addEventListener('click', async e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;

      if (act === 'set-mode') {
        state.mode = t.dataset.mode;
        if (state.mode === 'product'  && !state.productId  && state.products.length)   state.productId = state.products[0].id;
        if (state.mode === 'category' && !state.category   && state.categories.length) state.category = state.categories[0];
        await loadStrategy(); renderHTML(); return;
      }
      if (act === 'select-strategy') { state.selectedStrategy = t.dataset.strategy; renderHTML(); return; }
      if (act === 'open-competitor-modal') { state.competitorModalOpen = true; renderHTML(); return; }
      if (act === 'close-competitor-modal') { state.competitorModalOpen = false; renderHTML(); return; }

      if (act === 'save-competitor') {
        const modal = _container.querySelector('.ps-modal');
        const get = f => modal.querySelector(`[data-modal-field="${f}"]`)?.value;
        const name = (get('name') || '').trim();
        const price = parseFloat(get('price'));
        const notes = (get('notes') || '').trim() || null;
        if (!name || !price || price <= 0) { alert('Nom et prix requis.'); return; }
        try {
          const body = { competitor_name: name, price_kmf: price, notes };
          if (state.mode === 'product') body.product_id = state.productId;
          else body.category = state.category;
          await global.KmcApi.createPricingCompetitor(body);
          state.competitorModalOpen = false;
          await loadStrategy(); renderHTML();
        } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }

      if (act === 'del-competitor') {
        if (!confirm('Supprimer ce prix concurrent ?')) return;
        try {
          await global.KmcApi.deletePricingCompetitor(t.dataset.id);
          await loadStrategy(); renderHTML();
        } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }

      if (act === 'apply-strategy') {
        const d = state.data;
        const finalPrice = getFinalPrice(d);
        if (!finalPrice || finalPrice <= 0) { alert('Prix invalide'); return; }
        const targetLabel = state.mode === 'product' ? d.target?.name : `catégorie ${state.category}`;
        if (!confirm(`Appliquer la stratégie "${state.selectedStrategy}" sur ${targetLabel} (prix ${fmt(finalPrice)}) ?`)) return;
        try {
          t.disabled = true; t.textContent = '⏳ Application…';
          const body = { strategy_type: state.selectedStrategy, final_price_kmf: finalPrice, reason: 'Appliqué via UI Stratégie' };
          if (state.mode === 'product') body.product_id = state.productId;
          else body.category = state.category;
          if (state.selectedStrategy === 'manual') body.strategy_value = state.manualPrice;
          const r = await global.KmcApi.applyPricingStrategy(body);
          alert(`✓ Stratégie appliquée. ${r.products_affected || 1} produit(s) impacté(s).`);
          await loadStrategy(); renderHTML();
        } catch (err) {
          alert('Erreur : ' + err.message);
          t.disabled = false; t.textContent = '✓ Appliquer cette stratégie';
        }
        return;
      }
    });
  }

  /* ── Enregistrement ──────────────────────────────────────────────────── */
  function PricingStrategyView() {
    this.render = function (container) { render(container); };
  }

  global.PricingStrategyView = PricingStrategyView;

})(window);
