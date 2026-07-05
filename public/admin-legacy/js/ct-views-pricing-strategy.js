/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-pricing-strategy
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-pricing-strategy.js — Komerce Control Tower
 *  STRATEGIE DE PRIX (Phase 3 — ADR-013)
 *
 *  Vue plein-ecran ouverte depuis le module Pricing.
 *  Permet d'arbitrer le prix de vente final a partir de :
 *    - CDR (cout de revient) calcule
 *    - Prix concurrents (saisie manuelle)
 *    - Elasticite estimee (depuis price_history + ventes)
 *    - Strategie choisie (mecanique / aligne / premium / loss leader / manuel)
 *
 *  API consommees :
 *    GET    /api/pricing/strategy?product_id=...|category=...
 *    GET    /api/pricing/strategy/competitors
 *    POST   /api/pricing/strategy/competitors
 *    DELETE /api/pricing/strategy/competitors/:id
 *    POST   /api/pricing/strategy/apply
 *    GET    /api/pricing/strategy/history
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

/* ─── STATE ──────────────────────────────────────────────────────────── */
const _ss = {
  // Mode : par produit ou par categorie
  mode: 'product',  // 'product' | 'category'
  productId: null,
  category: null,

  // Liste produits / categories
  products: [],
  categories: [],

  // Donnees chargees pour la cible courante
  data: null,        // reponse /strategy

  // Strategie selectionnee (avant application)
  selectedStrategy: 'mechanical',
  manualPrice: null,

  // Modal nouveau prix concurrent
  competitorModalOpen: false,
};

/* ─── HELPERS ───────────────────────────────────────────────────────── */
const _ssNF = new Intl.NumberFormat('fr-FR');
function _ssFmt(n) { return _ssNF.format(Math.round(n || 0)) + ' KMF'; }

async function _ssApi(method, path, body) {
  const opts = { method, credentials: 'include' };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('API ' + res.status + ' : ' + txt.slice(0, 200));
  }
  return res.json();
}

/* ─── STYLES ────────────────────────────────────────────────────────── */
function _ssInjectStyles() {
  if (document.getElementById('ct-strategy-styles')) return;
  const s = document.createElement('style');
  s.id = 'ct-strategy-styles';
  s.textContent = `
    .ss-wrap { padding: 20px 24px; max-width: 1200px; margin: 0 auto; color: #1e293b; background: #f1f5f9; min-height: 100vh; }
    .ss-h1 { font-size: 1.4rem; font-weight: 800; margin: 0 0 6px; }
    .ss-sub { font-size: 0.85rem; color: #64748b; margin-bottom: 16px; }

    /* Selecteur cible */
    .ss-selector { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
    .ss-mode-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
    .ss-mode-tab { padding: 6px 14px; font-size: 0.82rem; font-weight: 600; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #64748b; cursor: pointer; }
    .ss-mode-tab.active { background: #f59e0b; color: #fff; border-color: #f59e0b; }
    .ss-select-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .ss-select { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #1e293b; font-size: 0.9rem; min-width: 280px; }

    /* Grilles 4 inputs */
    .ss-inputs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .ss-input-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
    .ss-input-title { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 6px; }
    .ss-input-value { font-size: 1.4rem; font-weight: 800; font-family: ui-monospace, monospace; color: #1e293b; }
    .ss-input-detail { font-size: 0.78rem; color: #94a3b8; margin-top: 4px; }

    /* Concurrents */
    .ss-competitors { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; }
    .ss-competitors-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .ss-competitors-title { font-size: 0.92rem; font-weight: 700; }
    .ss-competitor-row { display: grid; grid-template-columns: 1fr 120px 100px 30px; align-items: center; gap: 10px; padding: 6px 0; font-size: 0.85rem; border-bottom: 1px solid #f1f5f9; }
    .ss-competitor-row:last-child { border-bottom: none; }
    .ss-competitor-name { color: #475569; }
    .ss-competitor-price { font-family: ui-monospace, monospace; font-weight: 600; text-align: right; }
    .ss-competitor-date { font-size: 0.75rem; color: #94a3b8; text-align: right; }

    /* Stratégies */
    .ss-strategies { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 16px; }
    .ss-strategy {
      background: #fff; border: 2px solid #e2e8f0; border-radius: 10px;
      padding: 14px; cursor: pointer; transition: all 0.15s; position: relative;
    }
    .ss-strategy:hover { border-color: #94a3b8; }
    .ss-strategy.selected { border-color: #f59e0b; background: #fffbeb; }
    .ss-strategy.selected::before {
      content: '✓'; position: absolute; top: 8px; right: 10px;
      color: #f59e0b; font-weight: 800; font-size: 1.2rem;
    }
    .ss-strategy-emoji { font-size: 1.4rem; margin-bottom: 6px; }
    .ss-strategy-name { font-size: 0.95rem; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
    .ss-strategy-desc { font-size: 0.78rem; color: #64748b; margin-bottom: 8px; min-height: 32px; }
    .ss-strategy-price { font-size: 1.3rem; font-weight: 800; font-family: ui-monospace, monospace; color: #d97706; }
    .ss-strategy-margin { font-size: 0.78rem; color: #475569; margin-top: 2px; }
    .ss-strategy-margin.low { color: #dc2626; }
    .ss-strategy-margin.mid { color: #d97706; }
    .ss-strategy-margin.good { color: #16a34a; }

    /* Manuel */
    .ss-manual-row { display: flex; gap: 10px; align-items: center; margin-top: 8px; }
    .ss-manual-input { flex: 1; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 1rem; box-sizing: border-box; }

    /* Verdict / Apply */
    .ss-verdict {
      background: linear-gradient(135deg, #fef3c7, #fffbeb);
      border: 2px solid #fcd34d;
      border-radius: 12px; padding: 20px;
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 16px;
    }
    .ss-verdict-info { flex: 1; }
    .ss-verdict-label { font-size: 0.78rem; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
    .ss-verdict-price { font-size: 2rem; font-weight: 900; font-family: ui-monospace, monospace; color: #d97706; }
    .ss-verdict-vs { font-size: 0.85rem; color: #475569; margin-top: 4px; }
    .ss-btn { padding: 10px 20px; font-size: 0.9rem; font-weight: 700; border-radius: 8px; cursor: pointer; border: 1px solid transparent; font-family: inherit; }
    .ss-btn-primary { background: #f59e0b; color: #fff; border-color: #f59e0b; }
    .ss-btn-primary:hover { background: #d97706; }
    .ss-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .ss-btn-secondary { background: #fff; color: #1e293b; border: 1px solid #cbd5e1; }
    .ss-btn-secondary:hover { background: #f8fafc; }
    .ss-btn-ghost { background: transparent; color: #64748b; border: none; padding: 4px 8px; font-size: 0.85rem; cursor: pointer; }
    .ss-btn-ghost:hover { color: #1e293b; }

    /* Modal */
    .ss-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 2000; display: none; }
    .ss-modal-bg.open { display: block; }
    .ss-modal {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      background: #fff; border-radius: 12px; padding: 22px;
      width: 440px; max-width: 90vw; z-index: 2001; display: none;
      box-shadow: 0 20px 50px rgba(0,0,0,0.25);
    }
    .ss-modal.open { display: block; }
    .ss-modal-title { font-size: 1.05rem; font-weight: 800; margin-bottom: 14px; }
    .ss-modal-row { margin-bottom: 12px; }
    .ss-modal-label { display: block; font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; margin-bottom: 4px; }
    .ss-modal-input { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.92rem; box-sizing: border-box; }
    .ss-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

    /* Loading / empty */
    .ss-loading { padding: 60px 20px; text-align: center; color: #64748b; }
    .ss-empty { padding: 24px 16px; text-align: center; color: #94a3b8; font-style: italic; font-size: 0.88rem; }
    .ss-warning { background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 12px; font-size: 0.82rem; color: #92400e; margin-bottom: 12px; }
  `;
  document.head.appendChild(s);
}

/* ─── DATA LOADING ──────────────────────────────────────────────────── */
async function _ssLoadProducts() {
  try {
    const r = await _ssApi('GET', '/api/products?is_active=true');
    _ss.products = (r.products || r) || [];
    if (Array.isArray(_ss.products)) {
      // Extraire categories uniques
      const cats = new Set();
      _ss.products.forEach(p => { if (p.category) cats.add(p.category); });
      _ss.categories = Array.from(cats).sort();
    }
  } catch (e) {
    _ss.products = [];
    _ss.categories = [];
  }
}

async function _ssLoadStrategy() {
  if (_ss.mode === 'product' && !_ss.productId) { _ss.data = null; return; }
  if (_ss.mode === 'category' && !_ss.category) { _ss.data = null; return; }

  const param = _ss.mode === 'product' ? 'product_id=' + _ss.productId : 'category=' + _ss.category;
  try {
    _ss.data = await _ssApi('GET', '/api/pricing/strategy?' + param);
  } catch (e) {
    _ss.data = null;
    console.error('[Strategy] _ssLoadStrategy error:', e);
  }
}

/* ─── RENDER ───────────────────────────────────────────────────────── */
async function _ssRender(host) {
  _ssInjectStyles();
  host.innerHTML = '<div class="ss-loading">⏳ Chargement de la strategie de prix...</div>';

  try {
    // Premier chargement
    if (!_ss.products.length) {
      await _ssLoadProducts();
      if (_ss.products.length && !_ss.productId && _ss.mode === 'product') {
        _ss.productId = _ss.products[0].id;
      }
      if (_ss.categories.length && !_ss.category && _ss.mode === 'category') {
        _ss.category = _ss.categories[0];
      }
    }
    await _ssLoadStrategy();
    _ssRenderHTML(host);
  } catch (err) {
    host.innerHTML = '<div class="ss-loading" style="color:#dc2626;">Erreur : ' + err.message + '</div>';
  }
}

function _ssRenderHTML(host) {
  const d = _ss.data;
  let html = '<div class="ss-wrap">';

  // Header
  html += '<h1 class="ss-h1">💰 Strategie de prix</h1>';
  html += '<p class="ss-sub">Le moteur calcule, l\'humain decide. Choisissez votre strategie en croisant cout de revient, concurrence et marge cible.</p>';

  // Selecteur cible
  html += '<div class="ss-selector">' +
    '<div class="ss-mode-tabs">' +
      '<button class="ss-mode-tab ' + (_ss.mode === 'product' ? 'active' : '') + '" data-act="set-mode" data-mode="product">📦 Par produit</button>' +
      '<button class="ss-mode-tab ' + (_ss.mode === 'category' ? 'active' : '') + '" data-act="set-mode" data-mode="category">📂 Par categorie</button>' +
    '</div>' +
    '<div class="ss-select-row">';

  if (_ss.mode === 'product') {
    html += '<select class="ss-select" data-act="set-product">';
    _ss.products.forEach(p => {
      html += '<option value="' + p.id + '"' + (p.id === _ss.productId ? ' selected' : '') + '>' +
        p.name + ' · ' + _ssFmt(p.price_kmf) + '</option>';
    });
    html += '</select>';
  } else {
    html += '<select class="ss-select" data-act="set-category">';
    _ss.categories.forEach(c => {
      html += '<option value="' + c + '"' + (c === _ss.category ? ' selected' : '') + '>' + c + '</option>';
    });
    html += '</select>';
  }

  html += '</div></div>';

  if (!d) {
    html += '<div class="ss-empty">Aucune donnee disponible. Selectionnez un produit ou une categorie.</div>';
    html += '</div>';
    host.innerHTML = html;
    _ssBindEvents(host);
    return;
  }

  // 4 inputs en cards
  html += '<div class="ss-inputs-grid">';
  html += _ssInputCard('1️⃣ Cout de revient', _ssFmt(d.cdr.cout_total_kmf),
    'N1+N2+N3 = ' + _ssFmt(d.cdr.n1) + ' + ' + _ssFmt(d.cdr.n2) + ' + ' + _ssFmt(d.cdr.n3));

  if (d.competitors.count) {
    html += _ssInputCard('2️⃣ Prix concurrence (mediane)',
      _ssFmt(d.competitors.median),
      d.competitors.count + ' obs · ' + _ssFmt(d.competitors.min) + ' – ' + _ssFmt(d.competitors.max));
  } else {
    html += _ssInputCard('2️⃣ Prix concurrence', '—', 'Aucune donnee — saisissez ci-dessous');
  }

  html += _ssInputCard('3️⃣ Prix actuel', _ssFmt(d.target.current_price_kmf),
    d.target.product_id ? d.target.name : 'Mediane categorie ' + d.target.category);

  // Elasticite
  if (d.elasticity?.value != null) {
    const e = d.elasticity.value;
    const interp = d.elasticity.interpretation;
    const detail = d.elasticity.is_significant
      ? interp + ' (' + d.elasticity.sample_size + ' ventes)'
      : 'donnees insuffisantes';
    html += _ssInputCard('4️⃣ Elasticite-prix', e.toFixed(2), detail);
  } else {
    html += _ssInputCard('4️⃣ Elasticite-prix', '—', 'Pas assez de changements de prix passes');
  }
  html += '</div>';

  // Concurrents (saisie + liste)
  html += _ssRenderCompetitors(d);

  // Strategies
  html += '<h3 style="font-size:1rem;font-weight:700;margin:20px 0 10px;">🎯 Choisissez votre strategie</h3>';
  html += '<div class="ss-strategies">';
  html += _ssStrategyCard('mechanical', '⚙️', 'Mecanique',
    d.options.mechanical?.description, d.options.mechanical);
  if (d.options.competitor_aligned) {
    html += _ssStrategyCard('competitor_aligned', '🎯', 'Aligne concurrence',
      d.options.competitor_aligned.description, d.options.competitor_aligned);
  }
  if (d.options.premium_10) {
    html += _ssStrategyCard('premium', '💎', 'Premium +10%',
      d.options.premium_10.description, d.options.premium_10);
  }
  if (d.options.loss_leader) {
    html += _ssStrategyCard('loss_leader', '🚀', 'Loss leader -10%',
      d.options.loss_leader.description, d.options.loss_leader);
  }
  html += _ssManualCard(d);
  html += '</div>';

  // Verdict + Apply
  const finalPrice = _ssGetFinalPrice(d);
  const currentPrice = d.target.current_price_kmf || 0;
  const delta = finalPrice - currentPrice;
  const deltaPct = currentPrice > 0 ? (delta / currentPrice * 100).toFixed(1) : 0;

  html += '<div class="ss-verdict">' +
    '<div class="ss-verdict-info">' +
      '<div class="ss-verdict-label">Prix qui sera applique</div>' +
      '<div class="ss-verdict-price">' + _ssFmt(finalPrice) + '</div>' +
      '<div class="ss-verdict-vs">vs prix actuel ' + _ssFmt(currentPrice) +
        ' (' + (delta >= 0 ? '+' : '') + deltaPct + '%)</div>' +
    '</div>' +
    '<button class="ss-btn ss-btn-primary" data-act="apply-strategy">✓ Appliquer cette strategie</button>' +
  '</div>';

  // Strategie active
  if (d.current_strategy) {
    html += '<div class="ss-warning" style="margin-top:14px;">' +
      'Strategie actuelle : <strong>' + d.current_strategy.strategy_type + '</strong>' +
      ' · appliquee le ' + new Date(d.current_strategy.applied_at).toLocaleDateString('fr-FR') +
    '</div>';
  }

  html += '</div>';

  // Modal d'ajout concurrent
  html += _ssRenderCompetitorModal();

  host.innerHTML = html;
  _ssBindEvents(host);
}

function _ssInputCard(title, value, detail) {
  return '<div class="ss-input-card">' +
    '<div class="ss-input-title">' + title + '</div>' +
    '<div class="ss-input-value">' + value + '</div>' +
    '<div class="ss-input-detail">' + (detail || '') + '</div>' +
  '</div>';
}

function _ssRenderCompetitors(d) {
  let html = '<div class="ss-competitors">' +
    '<div class="ss-competitors-head">' +
      '<span class="ss-competitors-title">🏪 Prix concurrents observes (' + d.competitors.count + ')</span>' +
      '<button class="ss-btn ss-btn-secondary" data-act="open-competitor-modal" style="padding:5px 12px;font-size:0.8rem;">+ Ajouter un prix</button>' +
    '</div>';

  if (!d.competitors.count) {
    html += '<div class="ss-empty">Aucun prix concurrent saisi pour cette cible.</div>';
  } else {
    d.competitors.items.forEach(c => {
      html += '<div class="ss-competitor-row">' +
        '<span class="ss-competitor-name">' + c.competitor_name + (c.notes ? ' · <span style="color:#94a3b8;font-style:italic;">' + c.notes + '</span>' : '') + '</span>' +
        '<span class="ss-competitor-price">' + _ssFmt(c.price_kmf) + '</span>' +
        '<span class="ss-competitor-date">' + new Date(c.observed_at).toLocaleDateString('fr-FR') + '</span>' +
        '<button class="ss-btn-ghost" data-act="del-competitor" data-id="' + c.id + '" title="Supprimer">×</button>' +
      '</div>';
    });
  }
  html += '</div>';
  return html;
}

function _ssStrategyCard(key, emoji, name, desc, opt) {
  if (!opt) return '';
  const selected = _ss.selectedStrategy === key;
  const marginClass = opt.margin_pct < 10 ? 'low' : (opt.margin_pct < 25 ? 'mid' : 'good');
  return '<div class="ss-strategy ' + (selected ? 'selected' : '') + '" data-act="select-strategy" data-strategy="' + key + '">' +
    '<div class="ss-strategy-emoji">' + emoji + '</div>' +
    '<div class="ss-strategy-name">' + name + '</div>' +
    '<div class="ss-strategy-desc">' + (desc || '') + '</div>' +
    '<div class="ss-strategy-price">' + _ssFmt(opt.price) + '</div>' +
    '<div class="ss-strategy-margin ' + marginClass + '">Marge ' + opt.margin_pct + '% · ' + _ssFmt(opt.margin_kmf) + '</div>' +
  '</div>';
}

function _ssManualCard(d) {
  const selected = _ss.selectedStrategy === 'manual';
  const value = _ss.manualPrice !== null ? _ss.manualPrice : (d.target.current_price_kmf || 0);
  return '<div class="ss-strategy ' + (selected ? 'selected' : '') + '" data-act="select-strategy" data-strategy="manual">' +
    '<div class="ss-strategy-emoji">✏️</div>' +
    '<div class="ss-strategy-name">Manuel</div>' +
    '<div class="ss-strategy-desc">Vous saisissez le prix vous-meme</div>' +
    '<div class="ss-manual-row">' +
      '<input type="number" class="ss-manual-input" data-act="set-manual-price" value="' + value + '" min="0" step="100">' +
    '</div>' +
  '</div>';
}

function _ssGetFinalPrice(d) {
  switch (_ss.selectedStrategy) {
    case 'mechanical': return d.options.mechanical?.price || 0;
    case 'competitor_aligned': return d.options.competitor_aligned?.price || 0;
    case 'premium': return d.options.premium_10?.price || 0;
    case 'loss_leader': return d.options.loss_leader?.price || 0;
    case 'manual': return _ss.manualPrice || d.target.current_price_kmf || 0;
    default: return 0;
  }
}

function _ssRenderCompetitorModal() {
  const open = _ss.competitorModalOpen;
  return '<div class="ss-modal-bg ' + (open ? 'open' : '') + '" data-act="close-competitor-modal"></div>' +
    '<div class="ss-modal ' + (open ? 'open' : '') + '">' +
      '<div class="ss-modal-title">+ Ajouter un prix concurrent</div>' +
      '<div class="ss-modal-row">' +
        '<label class="ss-modal-label">Nom concurrent</label>' +
        '<input class="ss-modal-input" data-modal-field="name" placeholder="ex : Coliexpress">' +
      '</div>' +
      '<div class="ss-modal-row">' +
        '<label class="ss-modal-label">Prix observe (KMF)</label>' +
        '<input class="ss-modal-input" type="number" data-modal-field="price" min="0" step="500">' +
      '</div>' +
      '<div class="ss-modal-row">' +
        '<label class="ss-modal-label">Notes (optionnel)</label>' +
        '<input class="ss-modal-input" data-modal-field="notes" placeholder="ex : meme produit, livraison sous 5j">' +
      '</div>' +
      '<div class="ss-modal-actions">' +
        '<button class="ss-btn ss-btn-secondary" data-act="close-competitor-modal">Annuler</button>' +
        '<button class="ss-btn ss-btn-primary" data-act="save-competitor">Ajouter</button>' +
      '</div>' +
    '</div>';
}

/* ─── EVENTS ───────────────────────────────────────────────────────── */
function _ssBindEvents(host) {
  // Inputs (selects, number)
  host.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'set-product') {
      _ss.productId = t.value;
      await _ssLoadStrategy();
      _ssRenderHTML(host);
    } else if (act === 'set-category') {
      _ss.category = t.value;
      await _ssLoadStrategy();
      _ssRenderHTML(host);
    } else if (act === 'set-manual-price') {
      _ss.manualPrice = parseFloat(t.value) || 0;
      // re-render seulement le verdict (simple : full render)
      _ssRenderHTML(host);
    }
  });

  host.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;

    if (act === 'set-mode') {
      _ss.mode = t.dataset.mode;
      if (_ss.mode === 'product' && !_ss.productId && _ss.products.length) _ss.productId = _ss.products[0].id;
      if (_ss.mode === 'category' && !_ss.category && _ss.categories.length) _ss.category = _ss.categories[0];
      await _ssLoadStrategy();
      _ssRenderHTML(host);
      return;
    }

    if (act === 'select-strategy') {
      _ss.selectedStrategy = t.dataset.strategy;
      _ssRenderHTML(host);
      return;
    }

    if (act === 'open-competitor-modal') {
      _ss.competitorModalOpen = true;
      _ssRenderHTML(host);
      return;
    }
    if (act === 'close-competitor-modal') {
      _ss.competitorModalOpen = false;
      _ssRenderHTML(host);
      return;
    }
    if (act === 'save-competitor') {
      const modal = host.querySelector('.ss-modal');
      const get = (f) => modal.querySelector('[data-modal-field="' + f + '"]')?.value;
      const name = (get('name') || '').trim();
      const price = parseFloat(get('price'));
      const notes = (get('notes') || '').trim() || null;
      if (!name || !price || price <= 0) {
        alert('Nom et prix requis.');
        return;
      }
      try {
        const body = { competitor_name: name, price_kmf: price, notes };
        if (_ss.mode === 'product') body.product_id = _ss.productId;
        else body.category = _ss.category;
        await _ssApi('POST', '/api/pricing/strategy/competitors', body);
        _ss.competitorModalOpen = false;
        await _ssLoadStrategy();
        _ssRenderHTML(host);
      } catch (err) {
        alert('Erreur : ' + err.message);
      }
      return;
    }
    if (act === 'del-competitor') {
      if (!confirm('Supprimer ce prix concurrent ?')) return;
      try {
        await _ssApi('DELETE', '/api/pricing/strategy/competitors/' + t.dataset.id);
        await _ssLoadStrategy();
        _ssRenderHTML(host);
      } catch (err) {
        alert('Erreur : ' + err.message);
      }
      return;
    }

    if (act === 'apply-strategy') {
      const d = _ss.data;
      const finalPrice = _ssGetFinalPrice(d);
      if (!finalPrice || finalPrice <= 0) {
        alert('Prix invalide');
        return;
      }
      const targetLabel = _ss.mode === 'product' ? d.target.name : 'categorie ' + _ss.category;
      if (!confirm('Appliquer la strategie "' + _ss.selectedStrategy + '" sur ' + targetLabel +
                   ' (prix ' + _ssFmt(finalPrice) + ') ?')) return;
      try {
        t.disabled = true;
        t.textContent = '⏳ Application...';
        const body = {
          strategy_type: _ss.selectedStrategy,
          final_price_kmf: finalPrice,
          reason: 'Applique via UI Strategie',
        };
        if (_ss.mode === 'product') body.product_id = _ss.productId;
        else body.category = _ss.category;
        if (_ss.selectedStrategy === 'manual') body.strategy_value = _ss.manualPrice;

        const r = await _ssApi('POST', '/api/pricing/strategy/apply', body);
        alert('✓ Strategie appliquee. ' + (r.products_affected || 1) + ' produit(s) impacte(s).');
        await _ssLoadStrategy();
        _ssRenderHTML(host);
      } catch (err) {
        alert('Erreur : ' + err.message);
        t.disabled = false;
        t.textContent = '✓ Appliquer cette strategie';
      }
      return;
    }
  });
}

/* ─── ENTRY POINT ───────────────────────────────────────────────────── */
CT.views.pricing_strategy = async function(container) {
  await _ssRender(container);
};

})();
