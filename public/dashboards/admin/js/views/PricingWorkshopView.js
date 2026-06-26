/**
 * @komerce-arch
 * @role          admin-pricing-workshop-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        pricing workshop config (charges, transitaire, provisions)
 * @outputs       pricing_workshop_page_dom (config des coûts fixes et variables)
 * @depends       api-client.js, filters-store.js, utils.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  pricing, config, cost-components, admin-dashboard
 * @version       2026-06
 */
/* ═══════════════════════════════════════════════════════════════════════════
 *  PricingWorkshopView.js — Komerce Control Tower
 *  ⚙️ Configuration des coûts (cost_components)
 *  Migration legacy → IIFE global.PricingWorkshopView
 * ═══════════════════════════════════════════════════════════════════════════ */

(function(global) {
'use strict';

/* ─── ÉTAT ──────────────────────────────────────────────────────────────── */
const _cc = {
  loading: false, components: [],
  grouped: { landed_relay: {}, business: {}, exceptional: {} },
  meta: null,
  searchTerm: '',
  filterFamily: 'all', filterChannel: '', filterIsland: '',
  filterScope: '', filterAllocation: '',
  showInactive: false, showExceptional: false,
  collapsedCats: {},
  drawerOpen: false, drawerMode: null, drawerForm: null, drawerEvents: [],
  sortKey: 'family', sortDir: 'asc',
};

/* ─── HELPERS ───────────────────────────────────────────────────────────── */
const _nf = new Intl.NumberFormat('fr-FR');
function _fmt(n) { return _nf.format(Math.round(n || 0)); }
function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function _api(method, path, body) {
  const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
  if (body != null) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('API ' + res.status + ' : ' + t.slice(0, 250));
  }
  return res.json();
}

/* ─── LABELS ────────────────────────────────────────────────────────────── */
const FAMILY_LABELS = {
  landed_relay: { emoji: '📦', label: 'Coût rendu relais', color: '#3b82f6', desc: 'Tout ce qui amène l\'objet disponible au point relais.' },
  business:     { emoji: '💼', label: 'Coûts business',    color: '#16a34a', desc: 'Paiement, risques et part de charges fixes.' },
  exceptional:  { emoji: '⚡', label: 'Exceptionnels',     color: '#f59e0b', desc: 'Incidents et campagnes — exclus du calcul prix par défaut.' },
};

const CATEGORY_LABELS = {
  product_purchase:   { emoji: '🛒', label: 'Achat fournisseur' },
  sourcing:           { emoji: '🔍', label: 'Sourcing' },
  hub:                { emoji: '🏬', label: 'Hub Dubai' },
  packaging:          { emoji: '📦', label: 'Emballage' },
  freight:            { emoji: '🚢', label: 'Fret international' },
  customs:            { emoji: '🛃', label: 'Douane' },
  port_transitary:    { emoji: '📋', label: 'Port / transitaire' },
  local_distribution: { emoji: '🚚', label: 'Distribution locale' },
  relay:              { emoji: '🏪', label: 'Relais' },
  payment:            { emoji: '💳', label: 'Paiement' },
  risk_provision:     { emoji: '🛡️', label: 'Provision risque' },
  fixed_overhead:     { emoji: '🏢', label: 'Charges fixes' },
  incident:           { emoji: '⚠️', label: 'Incident' },
  marketing_campaign: { emoji: '📢', label: 'Campagne marketing' },
};

const UNIT_LABELS = {
  kmf: 'KMF (forfait)', pct: '% (pourcentage)',
  kmf_per_kg: 'KMF / kg', kmf_per_m3: 'KMF / m³',
  kmf_per_order: 'KMF / commande', kmf_per_parcel: 'KMF / colis', kmf_per_shipment: 'KMF / shipment',
  aed: 'AED (forfait)', eur: 'EUR (forfait)', usd: 'USD (forfait)',
};

const SCOPE_LABELS = {
  global: 'Toutes les commandes', category: 'Catégorie produit', product: 'Produit spécifique',
  order: 'Par commande', parcel: 'Par colis', shipment: 'Par shipment',
  supplier: 'Fournisseur', relay: 'Relais',
};

const SOURCE_BADGES = {
  real:     { label: 'Réel',        cls: 'cc-src-real' },
  manual:   { label: 'Manuel',      cls: 'cc-src-manual' },
  supplier: { label: 'Fournisseur', cls: 'cc-src-supplier' },
  category: { label: 'Catégorie',   cls: 'cc-src-category' },
  default:  { label: 'Défaut',      cls: 'cc-src-default' },
  missing:  { label: 'Manquant',    cls: 'cc-src-missing' },
};
const CONFIDENCE_BADGES = {
  high:   { label: '✓ Élevée',  cls: 'cc-conf-high' },
  medium: { label: '~ Moyenne', cls: 'cc-conf-medium' },
  low:    { label: '⚠ Faible',  cls: 'cc-conf-low' },
};

/* ─── STYLES ────────────────────────────────────────────────────────────── */
function _injectStyles() {
  if (document.getElementById('cc-styles')) return;
  const s = document.createElement('style');
  s.id = 'cc-styles';
  s.textContent = `
    .cc-wrap { max-width:1320px; margin:0 auto; padding:20px 24px; color:var(--text-primary); }
    .cc-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:12px; }
    .cc-header-text { flex:1; }
    .cc-header-actions { flex-shrink:0; }
    .cc-h1 { font-size:1.4rem; font-weight:800; margin:0 0 4px; }
    .cc-sub { font-size:0.88rem; color:var(--text-secondary); margin:0 0 18px; line-height:1.5; }
    .cc-expert-warning { display:flex; gap:12px; align-items:flex-start; padding:12px 16px; background:#fef3c7; border:1px solid #fde68a; border-left:4px solid #f59e0b; border-radius:6px; margin-bottom:18px; }
    .cc-expert-warning-icon { font-size:1.2rem; flex-shrink:0; }
    .cc-expert-warning-text { font-size:0.86rem; color:#78350f; line-height:1.5; }
    .cc-btn { padding:7px 14px; font-size:0.85rem; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:var(--bg-card); color:var(--text-primary); font-family:inherit; transition:all .15s; }
    .cc-btn:hover { background:#f1f5f9; border-color:var(--text-tertiary); }
    .cc-btn-primary { background:#16a34a; color:#fff; border-color:#15803d; }
    .cc-btn-primary:hover { background:#15803d; }
    .cc-btn-secondary { background:#f1f5f9; color:#0f172a; border-color:#cbd5e1; }
    .cc-btn-secondary:hover { background:#e2e8f0; }
    .cc-btn-sm { padding:var(--sp-1) var(--sp-3); font-size:var(--fs-xs); }
    .cc-btn-danger { background:var(--bg-card); color:#dc2626; border-color:#fecaca; }
    .cc-btn-danger:hover { background:#fef2f2; }
    .cc-tools { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:12px; background:var(--bg-page); border:1px solid #e2e8f0; border-radius:8px; margin-bottom:14px; }
    .cc-tools label { font-size:var(--fs-sm); color:var(--text-secondary); font-weight:600; }
    .cc-input, .cc-select { padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85rem; font-family:inherit; background:var(--bg-card); color:var(--text-primary); }
    .cc-input:focus, .cc-select:focus { outline:2px solid #16a34a; outline-offset:-1px; border-color:#16a34a; }
    .cc-checkbox { display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--text-secondary); cursor:pointer; }
    .cc-stats { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin:0 0 14px; }
    .cc-stat { background:var(--bg-card); border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; }
    .cc-stat-label { font-size:var(--fs-xs); color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; font-weight:600; margin-bottom:4px; }
    .cc-stat-value { font-size:1.4rem; font-weight:800; color:#0f172a; line-height:1.1; }
    .cc-stat-sub { font-size:var(--fs-xs); color:var(--text-tertiary); margin-top:2px; }
    .cc-stat.landed { border-left:3px solid #3b82f6; }
    .cc-stat.business { border-left:3px solid #16a34a; }
    .cc-stat.exceptional { border-left:3px solid #f59e0b; }
    .cc-table-wrap { background:var(--bg-card); border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
    .cc-table { width:100%; border-collapse:collapse; font-size:0.85rem; }
    .cc-table thead th { background:var(--bg-page); padding:10px 12px; text-align:left; font-weight:600; font-size:var(--fs-sm); color:var(--text-secondary); border-bottom:1px solid var(--border-color); white-space:nowrap; position:sticky; top:0; z-index:1; cursor:pointer; user-select:none; }
    .cc-table thead th.sortable:hover { background:#eef2f7; }
    .cc-table thead th.sorted { color:#0f172a; background:#eef2f7; }
    .cc-table thead th .cc-sort-arrow { font-size:0.7rem; color:var(--text-secondary); margin-left:4px; opacity:0.6; }
    .cc-table thead th.sorted .cc-sort-arrow { opacity:1; color:#16a34a; }
    .cc-table thead th.right { text-align:right; }
    .cc-table thead th.center { text-align:center; }
    .cc-table tbody tr { border-bottom:1px solid #f1f5f9; transition:background .12s; }
    .cc-table tbody tr:last-child { border-bottom:none; }
    .cc-table tbody tr:hover { background:var(--bg-page); }
    .cc-table tbody tr.inactive { opacity:0.55; }
    .cc-table tbody tr.exceptional { background:var(--bg-card)beb; }
    .cc-table tbody tr.exceptional:hover { background:#fef3c7; }
    .cc-table td { padding:9px 12px; vertical-align:middle; }
    .cc-table td.right { text-align:right; font-family:ui-monospace,monospace; font-weight:600; }
    .cc-table td.center { text-align:center; }
    .cc-cell-name { display:flex; align-items:center; gap:6px; min-width:0; }
    .cc-cell-name-text { font-weight:600; color:var(--text-primary); }
    .cc-cell-name-key { font-family:ui-monospace,monospace; font-size:0.7rem; color:var(--text-tertiary); white-space:nowrap; }
    .cc-cell-fam { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:4px; font-size:var(--fs-xs); font-weight:600; white-space:nowrap; }
    .cc-cell-fam.landed { background:#dbeafe; color:#1e40af; }
    .cc-cell-fam.business { background:#dcfce7; color:#14532d; }
    .cc-cell-fam.exceptional { background:#fef3c7; color:#92400e; }
    .cc-cell-cat { display:inline-flex; align-items:center; gap:4px; color:var(--text-secondary); font-size:var(--fs-sm); }
    .cc-cell-scope { font-size:var(--fs-xs); color:var(--text-secondary); white-space:nowrap; }
    .cc-cell-actions { display:flex; gap:3px; justify-content:flex-end; }
    .cc-cell-actions button { padding:var(--sp-1) var(--sp-3); font-size:var(--fs-sm); border-radius:5px; border:1px solid transparent; background:transparent; cursor:pointer; transition:background .12s, border-color .12s; }
    .cc-cell-actions button:hover { background:#f1f5f9; border-color:#cbd5e1; }
    .cc-cell-actions button.danger:hover { background:#fef2f2; border-color:#fecaca; }
    .cc-table-empty { padding:50px 20px; text-align:center; color:var(--text-tertiary); font-style:italic; font-size:0.88rem; }
    .cc-table-footer { padding:10px 14px; background:var(--bg-page); border-top:1px solid #e2e8f0; font-size:var(--fs-sm); color:var(--text-secondary); display:flex; justify-content:space-between; align-items:center; }
    .cc-badge { padding:2px 8px; border-radius:4px; font-size:0.7rem; font-weight:600; white-space:nowrap; }
    .cc-src-real { background:#dcfce7; color:#14532d; }
    .cc-src-manual { background:#dbeafe; color:#1e40af; }
    .cc-src-supplier { background:#d1fae5; color:#065f46; }
    .cc-src-category { background:#fef9c3; color:#854d0e; }
    .cc-src-default { background:#f1f5f9; color:var(--text-secondary); }
    .cc-src-missing { background:#fee2e2; color:#b91c1c; }
    .cc-conf-high { background:#dcfce7; color:#14532d; }
    .cc-conf-medium { background:#fef9c3; color:#854d0e; }
    .cc-conf-low { background:#fef2f2; color:#b91c1c; }
    .cc-toggle { display:inline-block; width:36px; height:20px; background:#cbd5e1; border-radius:10px; position:relative; cursor:pointer; transition:background 0.2s; }
    .cc-toggle.active { background:#16a34a; }
    .cc-toggle::after { content:''; position:absolute; top:2px; left:2px; width:16px; height:16px; background:var(--bg-card); border-radius:50%; transition:left 0.2s; }
    .cc-toggle.active::after { left:18px; }
    .cc-empty { padding:30px 20px; text-align:center; color:var(--text-tertiary); font-style:italic; font-size:0.88rem; }
    .cc-loading { padding:60px 20px; text-align:center; color:var(--text-secondary); }
    .cc-drawer-bg { position:fixed; inset:0; background:rgba(15,23,42,0.4); opacity:0; pointer-events:none; transition:opacity .2s; z-index:99; }
    .cc-drawer-bg.open { opacity:1; pointer-events:auto; }
    .cc-drawer { position:fixed; top:0; right:0; width:min(560px, 90vw); height:100vh; background:var(--bg-card); box-shadow:-4px 0 24px rgba(0,0,0,0.1); transform:translateX(100%); transition:transform .25s; z-index:100; display:flex; flex-direction:column; }
    .cc-drawer.open { transform:translateX(0); }
    .cc-drawer-head { padding:16px 18px; border-bottom:1px solid var(--border-color); display:flex; align-items:center; gap:12px; }
    .cc-drawer-title { font-size:1.05rem; font-weight:700; flex:1; margin:0; }
    .cc-drawer-body { flex:1; overflow-y:auto; padding:16px 18px; }
    .cc-drawer-foot { padding:12px 18px; border-top:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap; }
    .cc-form-row { margin-bottom:12px; }
    .cc-form-row label { display:block; font-size:var(--fs-xs); color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; font-weight:600; margin-bottom:4px; }
    .cc-form-row input, .cc-form-row select, .cc-form-row textarea { width:100%; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.88rem; font-family:inherit; background:var(--bg-card); color:var(--text-primary); box-sizing:border-box; }
    .cc-form-row textarea { resize:vertical; min-height:50px; }
    .cc-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .cc-form-help { font-size:var(--fs-xs); color:var(--text-secondary); margin-top:3px; line-height:1.4; }
    .cc-form-section-title { font-size:0.85rem; font-weight:700; color:var(--text-primary); margin:16px 0 8px; padding-bottom:6px; border-bottom:1px solid var(--border-color); }
    .cc-events { margin-top:18px; padding:12px; background:var(--bg-page); border-radius:6px; }
    .cc-events-title { font-size:0.85rem; font-weight:700; margin-bottom:8px; color:var(--text-secondary); }
    .cc-event { font-size:var(--fs-sm); color:var(--text-secondary); padding:5px 0; border-bottom:1px solid var(--border-color); }
    .cc-event:last-child { border-bottom:none; }
    .cc-event-type { font-weight:600; color:var(--text-primary); }
    @media (max-width: 1100px) { .cc-table th.col-source, .cc-table td.col-source { display:none; } .cc-table th.col-conf, .cc-table td.col-conf { display:none; } }
    @media (max-width: 900px)  { .cc-stats { grid-template-columns:repeat(2, 1fr); } .cc-table th.col-cat, .cc-table td.col-cat { display:none; } .cc-table th.col-scope, .cc-table td.col-scope { display:none; } }
  `;
  document.head.appendChild(s);
}

/* ─── DATA LOADING ──────────────────────────────────────────────────────── */
async function _loadAll() {
  _cc.loading = true;
  try {
    const params = [];
    if (_cc.filterFamily && _cc.filterFamily !== 'all') params.push('family=' + encodeURIComponent(_cc.filterFamily));
    if (_cc.filterChannel)    params.push('channel=' + encodeURIComponent(_cc.filterChannel));
    if (_cc.filterIsland)     params.push('island=' + encodeURIComponent(_cc.filterIsland));
    if (_cc.filterScope)      params.push('scope=' + encodeURIComponent(_cc.filterScope));
    if (_cc.filterAllocation) params.push('allocation_method=' + encodeURIComponent(_cc.filterAllocation));
    if (!_cc.showInactive)    params.push('is_active=true');
    if (!_cc.showExceptional) params.push('is_exceptional=false');
    const qs = params.length ? '?' + params.join('&') : '';

    const ccRes = await _api('GET', '/api/admin/cost-components' + qs);
    _cc.components = ccRes.components || [];
    _cc.grouped = ccRes.grouped || { landed_relay: {}, business: {}, exceptional: {} };

    if (!_cc.meta) {
      const metaRes = await _api('GET', '/api/admin/cost-components/_meta');
      _cc.meta = metaRes;
    }
  } finally {
    _cc.loading = false;
  }
}

/* ─── HELPERS DE RENDU ──────────────────────────────────────────────────── */
function _filterComponents(components) {
  const q = String(_cc.searchTerm || '').trim().toLowerCase();
  if (!q) return components.slice();
  return components.filter(c => {
    const hay = [c.label, c.key, c.description, c.scope, c.scope_value, c.channel, c.island, c.source, c.confidence]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}

function _collectAllVisible() {
  const flat = [];
  ['landed_relay', 'business', 'exceptional'].forEach(family => {
    if (_cc.filterFamily !== 'all' && _cc.filterFamily !== family) return;
    const cats = _cc.grouped[family] || {};
    Object.keys(cats).forEach(catKey => {
      _filterComponents(cats[catKey]).forEach(c => {
        flat.push(Object.assign({}, c, { family, category: c.category || catKey }));
      });
    });
  });
  return flat;
}

function _sortRows(rows) {
  const dir = (_cc.sortDir === 'desc') ? -1 : 1;
  const key = _cc.sortKey;
  const FAMILY_ORDER = { landed_relay: 1, business: 2, exceptional: 3 };
  function getVal(c) {
    switch (key) {
      case 'label':      return String(c.label || '').toLowerCase();
      case 'family':     return FAMILY_ORDER[c.family] || 99;
      case 'category':   return String(CATEGORY_LABELS[c.category]?.label || c.category || '').toLowerCase();
      case 'value':      return Number(c.default_value || 0);
      case 'scope':      return String(c.scope || '');
      case 'source':     return String(c.source || '');
      case 'confidence': return ({ high: 1, medium: 2, low: 3 })[c.confidence] || 99;
      case 'is_active':  return c.is_active ? 0 : 1;
      default:           return 0;
    }
  }
  return rows.slice().sort((a, b) => {
    const va = getVal(a), vb = getVal(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  });
}

/* ─── RENDU ─────────────────────────────────────────────────────────────── */
function _renderStats() {
  const all = _collectAllVisible();
  const byFamily = { landed_relay: 0, business: 0, exceptional: 0 };
  let activeCount = 0;
  all.forEach(c => {
    if (byFamily[c.family] !== undefined) byFamily[c.family]++;
    if (c.is_active) activeCount++;
  });
  const total = all.length;
  let html = '<div class="cc-stats">';
  html += '<div class="cc-stat"><div class="cc-stat-label">Total composants</div><div class="cc-stat-value">' + total + '</div><div class="cc-stat-sub">' + activeCount + ' actifs · ' + (total - activeCount) + ' inactifs</div></div>';
  html += '<div class="cc-stat landed"><div class="cc-stat-label">📦 Landed relais</div><div class="cc-stat-value">' + byFamily.landed_relay + '</div><div class="cc-stat-sub">Coût rendu point relais</div></div>';
  html += '<div class="cc-stat business"><div class="cc-stat-label">💼 Business</div><div class="cc-stat-value">' + byFamily.business + '</div><div class="cc-stat-sub">Charges fixes et risques</div></div>';
  html += '<div class="cc-stat exceptional"><div class="cc-stat-label">⚡ Exceptionnels</div><div class="cc-stat-value">' + byFamily.exceptional + '</div><div class="cc-stat-sub">Hors calcul standard</div></div>';
  html += '</div>';
  return html;
}

function _renderRow(c) {
  const fmeta = FAMILY_LABELS[c.family] || { emoji: '?', label: c.family };
  const cmeta = CATEGORY_LABELS[c.category] || { emoji: '❔', label: c.category };
  const sb = SOURCE_BADGES[c.source] || SOURCE_BADGES.default;
  const cb = CONFIDENCE_BADGES[c.confidence] || CONFIDENCE_BADGES.medium;
  let scopeText = SCOPE_LABELS[c.scope] || c.scope || 'global';
  if (c.scope_value) scopeText += ' : ' + c.scope_value;
  if (c.channel) scopeText += ' · 📡 ' + c.channel;
  if (c.island) scopeText += ' · 🏝 ' + c.island;
  const trCls = [!c.is_active ? 'inactive' : '', c.is_exceptional ? 'exceptional' : ''].filter(Boolean).join(' ');
  const famCls = c.family === 'landed_relay' ? 'landed' : c.family === 'business' ? 'business' : 'exceptional';

  let html = '<tr class="' + trCls + '" data-act="row-edit" data-id="' + c.id + '" style="cursor:pointer;">';
  html += '<td><div class="cc-cell-name">' + (c.emoji ? '<span>' + _esc(c.emoji) + '</span>' : '') + '<span class="cc-cell-name-text">' + _esc(c.label || '') + '</span><span class="cc-cell-name-key">' + _esc(c.key || '') + '</span></div>' + (c.description ? '<div style="font-size:var(--fs-xs);color:var(--text-secondary);margin-top:2px;">' + _esc(c.description) + '</div>' : '') + '</td>';
  html += '<td><span class="cc-cell-fam ' + famCls + '">' + fmeta.emoji + ' ' + _esc(fmeta.label) + '</span></td>';
  html += '<td class="col-cat"><span class="cc-cell-cat">' + cmeta.emoji + ' ' + _esc(cmeta.label) + '</span></td>';
  html += '<td class="right">' + _fmt(c.default_value) + ' <span style="font-size:0.7rem;color:var(--text-tertiary);font-weight:500;">' + _esc(UNIT_LABELS[c.unit] || c.unit || '') + '</span></td>';
  html += '<td class="col-scope"><span class="cc-cell-scope">' + _esc(scopeText) + '</span></td>';
  html += '<td class="col-source center"><span class="cc-badge ' + sb.cls + '">' + sb.label + '</span></td>';
  html += '<td class="col-conf center"><span class="cc-badge ' + cb.cls + '">' + cb.label + '</span></td>';
  html += '<td class="center cc-td-norow"><span class="cc-toggle' + (c.is_active ? ' active' : '') + '" data-act="toggle-comp" data-id="' + c.id + '"></span></td>';
  html += '<td class="right cc-td-norow"><div class="cc-cell-actions"><button data-act="edit-comp" data-id="' + c.id + '" title="Modifier">✏️</button>' + (c.is_deletable ? '<button class="danger" data-act="delete-comp" data-id="' + c.id + '" title="Supprimer">🗑</button>' : '') + '</div></td>';
  html += '</tr>';
  return html;
}

function _renderTable() {
  let rows = _sortRows(_collectAllVisible());
  const COLS = [
    { key: 'label',      label: 'Composant',  cls: '',                   sortable: true },
    { key: 'family',     label: 'Famille',    cls: '',                   sortable: true },
    { key: 'category',   label: 'Catégorie',  cls: 'col-cat',            sortable: true },
    { key: 'value',      label: 'Valeur',     cls: 'right',              sortable: true },
    { key: 'scope',      label: 'Scope',      cls: 'col-scope',          sortable: true },
    { key: 'source',     label: 'Source',     cls: 'col-source center',  sortable: true },
    { key: 'confidence', label: 'Confiance',  cls: 'col-conf center',    sortable: true },
    { key: 'is_active',  label: 'Actif',      cls: 'center',             sortable: true },
    { key: '_actions',   label: '',           cls: 'right',              sortable: false },
  ];
  let html = '<div class="cc-table-wrap"><table class="cc-table"><thead><tr>';
  COLS.forEach(col => {
    const sortedCls = (_cc.sortKey === col.key) ? ' sorted' : '';
    const sortableCls = col.sortable ? ' sortable' : '';
    const arrow = (_cc.sortKey === col.key)
      ? '<span class="cc-sort-arrow">' + (_cc.sortDir === 'asc' ? '▲' : '▼') + '</span>'
      : (col.sortable ? '<span class="cc-sort-arrow">↕</span>' : '');
    const dataAttr = col.sortable ? ' data-act="sort" data-sort="' + col.key + '"' : '';
    html += '<th class="' + col.cls + sortableCls + sortedCls + '"' + dataAttr + '>' + _esc(col.label) + arrow + '</th>';
  });
  html += '</tr></thead><tbody>';
  if (rows.length === 0) {
    html += '<tr><td colspan="' + COLS.length + '" class="cc-table-empty">Aucun composant ne correspond aux filtres actuels.</td></tr>';
  } else {
    rows.forEach(c => { html += _renderRow(c); });
  }
  html += '</tbody></table>';
  html += '<div class="cc-table-footer"><span>' + rows.length + ' composant' + (rows.length > 1 ? 's' : '') + ' affiché' + (rows.length > 1 ? 's' : '') + '</span><span style="color:var(--text-tertiary);">Cliquez une ligne pour modifier · cliquez le toggle pour activer/désactiver</span></div>';
  html += '</div>';
  return html;
}

function _renderDrawer() {
  const open = _cc.drawerOpen;
  const f = _cc.drawerForm || {};
  const isEdit = _cc.drawerMode === 'edit';
  let html = '<div class="cc-drawer-bg ' + (open ? 'open' : '') + '" data-act="close-drawer"></div>';
  html += '<div class="cc-drawer ' + (open ? 'open' : '') + '">';
  if (!open) { html += '</div>'; return html; }

  html += '<div class="cc-drawer-head"><button class="cc-btn cc-btn-sm" data-act="close-drawer">←</button><h2 class="cc-drawer-title">' + (isEdit ? '✏️ Modifier le composant' : '+ Nouveau composant') + '</h2></div>';
  html += '<div class="cc-drawer-body">';

  html += '<div class="cc-form-section-title">📌 Identification</div><div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Clé technique *</label><input type="text" data-form="key" value="' + _esc(f.key) + '" ' + (isEdit ? 'disabled' : '') + ' placeholder="ex: fret_aerien_eur_kg"><div class="cc-form-help">Snake_case, unique. Non modifiable après création.</div></div>';
  html += '<div class="cc-form-row"><label>Libellé *</label><input type="text" data-form="label" value="' + _esc(f.label) + '" placeholder="Ex: Fret aérien"></div></div>';
  html += '<div class="cc-form-grid"><div class="cc-form-row"><label>Emoji</label><input type="text" data-form="emoji" value="' + _esc(f.emoji) + '" maxlength="4" placeholder="🚢"></div><div class="cc-form-row"></div></div>';
  html += '<div class="cc-form-row"><label>Description</label><textarea data-form="description">' + _esc(f.description) + '</textarea></div>';

  html += '<div class="cc-form-section-title">🏷️ Classification</div><div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Famille *</label><select data-form="family">';
  ['landed_relay', 'business', 'exceptional'].forEach(fa => {
    html += '<option value="' + fa + '"' + (f.family === fa ? ' selected' : '') + '>' + (FAMILY_LABELS[fa]?.label || fa) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Catégorie *</label><select data-form="category">';
  const cats = _cc.meta?.categories?.[f.family || 'landed_relay'] || [];
  cats.forEach(c => { html += '<option value="' + c + '"' + (f.category === c ? ' selected' : '') + '>' + (CATEGORY_LABELS[c]?.label || c) + '</option>'; });
  html += '</select></div></div>';

  html += '<div class="cc-form-section-title">💰 Valorisation</div><div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Valeur par défaut *</label><input type="number" step="0.01" data-form="default_value" value="' + _esc(f.default_value) + '"></div>';
  html += '<div class="cc-form-row"><label>Unité *</label><select data-form="unit">';
  Object.keys(UNIT_LABELS).forEach(u => { html += '<option value="' + u + '"' + (f.unit === u ? ' selected' : '') + '>' + UNIT_LABELS[u] + '</option>'; });
  html += '</select></div></div>';

  html += '<div class="cc-form-section-title">🎯 Portée d\'application</div><div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Scope</label><select data-form="scope">';
  Object.keys(SCOPE_LABELS).forEach(s => { html += '<option value="' + s + '"' + (f.scope === s ? ' selected' : '') + '>' + SCOPE_LABELS[s] + '</option>'; });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Valeur scope</label><input type="text" data-form="scope_value" value="' + _esc(f.scope_value) + '" placeholder="Ex: phones"></div></div>';

  html += '<div class="cc-form-section-title">🌐 Contexte</div><div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Canal</label><select data-form="channel"><option value="">Tous</option>';
  ['cash_relais', 'diaspora', 'mobile_money'].forEach(c => { html += '<option value="' + c + '"' + (f.channel === c ? ' selected' : '') + '>' + c + '</option>'; });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Île</label><select data-form="island"><option value="">Toutes</option>';
  ['grande_comore', 'moheli', 'anjouan', 'mayotte'].forEach(i => { html += '<option value="' + i + '"' + (f.island === i ? ' selected' : '') + '>' + i + '</option>'; });
  html += '</select></div></div>';

  html += '<div class="cc-form-section-title">📋 Qualité des données</div><div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Source</label><select data-form="source">';
  Object.keys(SOURCE_BADGES).forEach(s => { html += '<option value="' + s + '"' + (f.source === s ? ' selected' : '') + '>' + SOURCE_BADGES[s].label + '</option>'; });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Confiance</label><select data-form="confidence">';
  Object.keys(CONFIDENCE_BADGES).forEach(c => { html += '<option value="' + c + '"' + (f.confidence === c ? ' selected' : '') + '>' + CONFIDENCE_BADGES[c].label + '</option>'; });
  html += '</select></div></div>';

  html += '<div class="cc-form-section-title">🔘 Activation</div><div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label class="cc-checkbox"><input type="checkbox" data-form="is_active"' + (f.is_active !== false ? ' checked' : '') + '> Actif</label></div>';
  html += '<div class="cc-form-row"><label class="cc-checkbox"><input type="checkbox" data-form="is_exceptional"' + (f.is_exceptional ? ' checked' : '') + '> Exceptionnel</label></div></div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Actif depuis</label><input type="date" data-form="active_from" value="' + _esc(f.active_from || '') + '"></div>';
  html += '<div class="cc-form-row"><label>Actif jusqu\'à</label><input type="date" data-form="active_until" value="' + _esc(f.active_until || '') + '"></div></div>';
  html += '<div class="cc-form-row"><label>Notes</label><textarea data-form="notes">' + _esc(f.notes) + '</textarea></div>';

  if (isEdit && _cc.drawerEvents.length) {
    html += '<div class="cc-events"><div class="cc-events-title">🕓 Historique</div>';
    _cc.drawerEvents.slice(0, 10).forEach(ev => {
      html += '<div class="cc-event"><span class="cc-event-type">' + _esc(ev.event_type) + '</span> · ' + new Date(ev.created_at).toLocaleString('fr-FR') + (ev.notes ? ' · ' + _esc(ev.notes) : '') + '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  html += '<div class="cc-drawer-foot"><button class="cc-btn cc-btn-primary" data-act="' + (isEdit ? 'save-edit' : 'save-create') + '">' + (isEdit ? '💾 Enregistrer' : '+ Créer') + '</button><button class="cc-btn" data-act="close-drawer">Annuler</button></div>';
  html += '</div>';
  return html;
}

function _renderHTML(container) {
  let html = '<div class="cc-wrap">';
  html += '<div class="cc-header"><div class="cc-header-text"><h1 class="cc-h1">⚙️ Configuration des coûts</h1><p class="cc-sub">Écran expert — règles utilisées par le moteur de pricing et d\'imputation.</p></div>';
  html += '<div class="cc-header-actions"><button class="cc-btn cc-btn-secondary" data-act="back-to-pricing">← Retour à Construction du prix</button></div></div>';

  html += '<div class="cc-expert-warning"><span class="cc-expert-warning-icon">⚠️</span><div class="cc-expert-warning-text"><strong>Écran expert</strong> — Toute modification ici affecte les calculs de prix de tous les produits. Si vous voulez seulement décider d\'un prix produit, utilisez <a href="#pricing" data-act="back-to-pricing" style="color:#0c4a6e;text-decoration:underline;">Construction du prix</a>.</div></div>';

  html += '<div class="cc-tools">';
  html += '<label>Recherche :</label><input class="cc-input" type="search" data-filter="search" value="' + _esc(_cc.searchTerm) + '" placeholder="clé, libellé, scope…">';
  html += '<label>Famille :</label><select class="cc-select" data-filter="family"><option value="all"' + (_cc.filterFamily === 'all' ? ' selected' : '') + '>Toutes</option>';
  ['landed_relay', 'business', 'exceptional'].forEach(f => { html += '<option value="' + f + '"' + (_cc.filterFamily === f ? ' selected' : '') + '>' + (FAMILY_LABELS[f]?.label || f) + '</option>'; });
  html += '</select>';
  html += '<label>Scope :</label><select class="cc-select" data-filter="scope"><option value="">Tous</option>';
  ['global', 'category', 'island', 'channel'].forEach(s => { html += '<option value="' + s + '"' + (_cc.filterScope === s ? ' selected' : '') + '>' + s + '</option>'; });
  html += '</select>';
  html += '<label>Allocation :</label><select class="cc-select" data-filter="allocation"><option value="">Toutes</option>';
  ['direct', 'by_value', 'by_weight', 'by_volume', 'by_taxable_weight', 'per_item', 'per_order', 'per_parcel', 'per_shipment', 'monthly_prorata'].forEach(a => { html += '<option value="' + a + '"' + (_cc.filterAllocation === a ? ' selected' : '') + '>' + a + '</option>'; });
  html += '</select>';
  html += '<label>Canal :</label><select class="cc-select" data-filter="channel"><option value="">Tous</option>';
  ['cash_relais', 'diaspora', 'mobile_money'].forEach(c => { html += '<option value="' + c + '"' + (_cc.filterChannel === c ? ' selected' : '') + '>' + c + '</option>'; });
  html += '</select>';
  html += '<label>Île :</label><select class="cc-select" data-filter="island"><option value="">Toutes</option>';
  ['grande_comore', 'moheli', 'anjouan', 'mayotte'].forEach(i => { html += '<option value="' + i + '"' + (_cc.filterIsland === i ? ' selected' : '') + '>' + i + '</option>'; });
  html += '</select>';
  html += '<label class="cc-checkbox"><input type="checkbox" data-filter="show_inactive"' + (_cc.showInactive ? ' checked' : '') + '> Inactifs</label>';
  html += '<label class="cc-checkbox"><input type="checkbox" data-filter="show_exceptional"' + (_cc.showExceptional ? ' checked' : '') + '> Exceptionnels</label>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="cc-btn cc-btn-primary" data-act="open-create">+ Nouveau composant</button>';
  html += '</div>';

  html += _renderStats();
  html += _renderTable();
  html += '</div>';
  html += _renderDrawer();
  container.innerHTML = html;
  _bindEvents(container);
}

/* ─── EVENTS ────────────────────────────────────────────────────────────── */
function _bindEvents(container) {
  container.addEventListener('change', async (e) => {
    const tgt = e.target;
    if (tgt.dataset.filter) {
      const f = tgt.dataset.filter;
      if (f === 'search')           _cc.searchTerm = tgt.value;
      else if (f === 'family')      _cc.filterFamily = tgt.value;
      else if (f === 'channel')     _cc.filterChannel = tgt.value;
      else if (f === 'island')      _cc.filterIsland = tgt.value;
      else if (f === 'scope')       _cc.filterScope = tgt.value;
      else if (f === 'allocation')  _cc.filterAllocation = tgt.value;
      else if (f === 'show_inactive')    _cc.showInactive = tgt.checked;
      else if (f === 'show_exceptional') _cc.showExceptional = tgt.checked;
      try { await _loadAll(); _renderHTML(container); }
      catch (err) { alert('Erreur : ' + err.message); }
    }
    if (tgt.dataset.form && _cc.drawerForm) {
      const k = tgt.dataset.form;
      if (k === 'is_active' || k === 'is_exceptional') _cc.drawerForm[k] = tgt.checked;
      else _cc.drawerForm[k] = tgt.value;
      if (k === 'family') _renderHTML(container);
    }
  });

  container.addEventListener('input', (e) => {
    const tgt = e.target;
    if (tgt.dataset.form && _cc.drawerForm) _cc.drawerForm[tgt.dataset.form] = tgt.value;
  });

  container.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;

    if (act === 'back-to-pricing') {
      e.preventDefault();
      if (window.KmcApp && typeof KmcApp.navigate === 'function') KmcApp.navigate('pricing');
      else window.location.hash = '#pricing';
      return;
    }

    if (act === 'sort') {
      const k = t.dataset.sort;
      if (_cc.sortKey === k) _cc.sortDir = (_cc.sortDir === 'asc') ? 'desc' : 'asc';
      else { _cc.sortKey = k; _cc.sortDir = 'asc'; }
      _renderHTML(container);
      return;
    }

    if (act === 'row-edit' || act === 'edit-comp') {
      if (e.target.closest('.cc-td-norow')) return;
      const id = t.dataset.id;
      try {
        const r = await _api('GET', '/api/admin/cost-components/' + id);
        _cc.drawerMode = 'edit';
        _cc.drawerForm = { ...r.component };
        _cc.drawerEvents = r.events || [];
        _cc.drawerOpen = true;
        _renderHTML(container);
      } catch (err) { alert('Erreur : ' + err.message); }
      return;
    }

    if (act === 'close-drawer') {
      _cc.drawerOpen = false; _cc.drawerForm = null; _cc.drawerEvents = [];
      _renderHTML(container); return;
    }

    if (act === 'open-create') {
      _cc.drawerMode = 'create';
      _cc.drawerForm = { key:'', label:'', emoji:'', description:'', family:'landed_relay', category:'sourcing', default_value:0, unit:'kmf', currency:'', scope:'global', scope_value:'', allocation_method:'none', source:'default', confidence:'medium', channel:'', island:'', is_active:true, is_exceptional:false, active_from:'', active_until:'', notes:'' };
      _cc.drawerEvents = []; _cc.drawerOpen = true;
      _renderHTML(container); return;
    }

    if (act === 'save-create') {
      const f = _cc.drawerForm;
      if (!f.key || !f.label || !f.unit || !f.family || !f.category) { alert('Champs requis : clé, libellé, famille, catégorie, unité'); return; }
      t.disabled = true; t.textContent = '⏳ Création...';
      try {
        const body = { ...f };
        if (!body.channel) delete body.channel;
        if (!body.island) delete body.island;
        if (!body.scope_value) delete body.scope_value;
        if (!body.active_from) delete body.active_from;
        if (!body.active_until) delete body.active_until;
        await _api('POST', '/api/admin/cost-components', body);
        _cc.drawerOpen = false; _cc.drawerForm = null;
        await _loadAll(); _renderHTML(container);
      } catch (err) { alert('Erreur création : ' + err.message); t.disabled = false; t.textContent = '+ Créer'; }
      return;
    }

    if (act === 'save-edit') {
      const f = _cc.drawerForm;
      if (!f.id) return;
      t.disabled = true; t.textContent = '⏳ Enregistrement...';
      try {
        const body = { ...f };
        delete body.id; delete body.key; delete body.created_at; delete body.updated_at; delete body.created_by; delete body.updated_by;
        await _api('PUT', '/api/admin/cost-components/' + f.id, body);
        _cc.drawerOpen = false; _cc.drawerForm = null;
        await _loadAll(); _renderHTML(container);
      } catch (err) { alert('Erreur sauvegarde : ' + err.message); t.disabled = false; t.textContent = '💾 Enregistrer'; }
      return;
    }

    if (act === 'toggle-comp') {
      const id = t.dataset.id;
      try { await _api('POST', '/api/admin/cost-components/' + id + '/toggle'); await _loadAll(); _renderHTML(container); }
      catch (err) { alert('Erreur : ' + err.message); }
      return;
    }

    if (act === 'delete-comp') {
      const id = t.dataset.id;
      if (!confirm('Désactiver ce composant ?')) return;
      try { await _api('DELETE', '/api/admin/cost-components/' + id); await _loadAll(); _renderHTML(container); }
      catch (err) { alert('Erreur : ' + err.message); }
      return;
    }
  });
}

/* ─── ENTRY POINT ────────────────────────────────────────────────────────── */
async function _render(container) {
  _injectStyles();
  container.innerHTML = '<div class="cc-loading">⏳ Chargement des composants de coût...</div>';
  try {
    await _loadAll();
    _renderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="cc-loading" style="color:#dc2626;">Erreur : ' + _esc(err.message) + '</div>';
  }
}

global.PricingWorkshopView = async function(container) {
  await _render(container);
};

})(window);
