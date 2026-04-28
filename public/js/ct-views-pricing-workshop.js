/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-pricing-workshop.js — Komerce Control Tower
 *
 *  COMPOSITION AVANCEE DES COUTS (Phase 1 cost_components)
 *
 *  Doctrine §3 : structure modulable des coûts.
 *  3 familles : landed_relay (9 cat) / business (3 cat) / exceptional (1+)
 *
 *  Cette vue permet de :
 *    1. Voir tous les composants groupés par famille puis catégorie
 *    2. Activer / désactiver un composant
 *    3. Créer un nouveau composant
 *    4. Modifier les valeurs et la portée
 *    5. Voir l'historique audit
 *
 *  Phase 1 : structure + activation. Pas encore de simulation impact.
 *  Phase 2 : valorisation fine.
 *  Phase 3 : allocation (impact commande / colis / shipment).
 *
 *  API consommées :
 *    GET    /api/admin/cost-components            — lister
 *    GET    /api/admin/cost-components/_meta      — enums autorisés
 *    GET    /api/admin/cost-components/:id        — détail + audit
 *    POST   /api/admin/cost-components            — créer
 *    PUT    /api/admin/cost-components/:id        — modifier
 *    POST   /api/admin/cost-components/:id/toggle — activer/désactiver
 *    DELETE /api/admin/cost-components/:id        — soft delete
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

const _cc = {
  loading: false, components: [],
  grouped: { landed_relay: {}, business: {}, exceptional: {} },
  meta: null,
  searchTerm: '',
  filterFamily: 'all', filterChannel: '', filterIsland: '',
  filterScope: '', filterAllocation: '',  // Sprint UX : nouveaux filtres expert
  showInactive: false, showExceptional: false,
  collapsedCats: {},
  drawerOpen: false, drawerMode: null, drawerForm: null, drawerEvents: [],
};

const _ccNF = new Intl.NumberFormat('fr-FR');
function _ccFmt(n) { return _ccNF.format(Math.round(n || 0)); }
function _ccEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function _ccApi(method, path, body) {
  const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
  if (body != null) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('API ' + res.status + ' : ' + t.slice(0, 250));
  }
  return res.json();
}

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
  real:     { label: 'Réel', cls: 'cc-src-real' },
  manual:   { label: 'Manuel', cls: 'cc-src-manual' },
  supplier: { label: 'Fournisseur', cls: 'cc-src-supplier' },
  category: { label: 'Catégorie', cls: 'cc-src-category' },
  default:  { label: 'Défaut', cls: 'cc-src-default' },
  missing:  { label: 'Manquant', cls: 'cc-src-missing' },
};
const CONFIDENCE_BADGES = {
  high:   { label: '✓ Élevée', cls: 'cc-conf-high' },
  medium: { label: '~ Moyenne', cls: 'cc-conf-medium' },
  low:    { label: '⚠ Faible', cls: 'cc-conf-low' },
};

function _ccInjectStyles() {
  if (document.getElementById('cc-styles')) return;
  const s = document.createElement('style');
  s.id = 'cc-styles';
  s.textContent = `
    .cc-wrap { max-width:1320px; margin:0 auto; padding:20px 24px; color:#1e293b; }
    .cc-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:12px; }
    .cc-header-text { flex:1; }
    .cc-header-actions { flex-shrink:0; }
    .cc-h1 { font-size:1.4rem; font-weight:800; margin:0 0 4px; }
    .cc-sub { font-size:0.88rem; color:#64748b; margin:0 0 18px; line-height:1.5; }
    .cc-expert-warning { display:flex; gap:12px; align-items:flex-start; padding:12px 16px; background:#fef3c7; border:1px solid #fde68a; border-left:4px solid #f59e0b; border-radius:6px; margin-bottom:18px; }
    .cc-expert-warning-icon { font-size:1.2rem; flex-shrink:0; }
    .cc-expert-warning-text { font-size:0.86rem; color:#78350f; line-height:1.5; }
    .cc-btn-secondary { background:#f1f5f9; color:#0f172a; border-color:#cbd5e1; }
    .cc-btn-secondary:hover { background:#e2e8f0; }
    .cc-tools { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:14px; }
    .cc-tools label { font-size:0.78rem; color:#475569; font-weight:600; }
    .cc-input, .cc-select { padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85rem; font-family:inherit; background:#fff; color:#1e293b; }
    .cc-input:focus, .cc-select:focus { outline:2px solid #16a34a; outline-offset:-1px; border-color:#16a34a; }
    .cc-checkbox { display:flex; align-items:center; gap:6px; font-size:0.8rem; color:#475569; cursor:pointer; }
    .cc-btn { padding:7px 14px; font-size:0.85rem; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#fff; color:#1e293b; font-family:inherit; transition:all .15s; }
    .cc-btn:hover { background:#f1f5f9; border-color:#94a3b8; }
    .cc-btn-primary { background:#16a34a; color:#fff; border-color:#15803d; }
    .cc-btn-primary:hover { background:#15803d; }
    .cc-btn-sm { padding:4px 10px; font-size:0.75rem; }
    .cc-btn-danger { background:#fff; color:#dc2626; border-color:#fecaca; }
    .cc-btn-danger:hover { background:#fef2f2; }
    .cc-families-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; }
    .cc-family { margin-bottom:8px; }
    .cc-family-head { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:8px; color:#fff; font-weight:700; }
    .cc-family-emoji { font-size:1.4rem; }
    .cc-family-title { font-size:1.05rem; font-weight:800; }
    .cc-family-desc { font-size:0.78rem; opacity:0.9; margin-top:2px; }
    .cc-family-count { margin-left:auto; background:rgba(255,255,255,0.25); padding:3px 10px; border-radius:14px; font-size:0.78rem; font-weight:600; }
    .cc-family-body { padding:8px 0 0; }
    .cc-category { background:#fff; border:1px solid #e2e8f0; border-radius:8px; margin-top:10px; overflow:hidden; }
    .cc-category-head { display:flex; align-items:center; gap:10px; padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
    .cc-category-emoji { font-size:1.1rem; }
    .cc-category-title { font-size:0.92rem; font-weight:700; flex:1; }
    .cc-category-stat { font-size:0.78rem; color:#64748b; }
    .cc-category-caret { font-size:0.78rem; color:#64748b; }
    .cc-category-body { display:block; }
    .cc-category.collapsed .cc-category-body { display:none; }
    .cc-comp { display:grid; grid-template-columns:1fr auto auto auto auto; gap:12px; align-items:center; padding:10px 14px; border-bottom:1px solid #f1f5f9; }
    .cc-comp:last-child { border-bottom:none; }
    .cc-comp:hover { background:#f8fafc; }
    .cc-comp.inactive { opacity:0.5; }
    .cc-comp-info { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .cc-comp-name { display:flex; align-items:center; gap:6px; font-size:0.88rem; font-weight:600; color:#1e293b; }
    .cc-comp-key { font-family:ui-monospace,monospace; font-size:0.7rem; color:#94a3b8; }
    .cc-comp-desc { font-size:0.78rem; color:#64748b; line-height:1.4; }
    .cc-comp-badges { display:flex; gap:6px; flex-wrap:wrap; }
    .cc-badge { padding:2px 8px; border-radius:4px; font-size:0.7rem; font-weight:600; white-space:nowrap; }
    .cc-comp-value { text-align:right; font-family:ui-monospace,monospace; font-weight:700; font-size:0.95rem; color:#1e293b; }
    .cc-comp-unit { display:block; font-family:inherit; font-size:0.7rem; color:#94a3b8; font-weight:500; margin-top:2px; }
    .cc-comp-actions { display:flex; gap:4px; }
    .cc-src-real { background:#dcfce7; color:#14532d; }
    .cc-src-manual { background:#dbeafe; color:#1e40af; }
    .cc-src-supplier { background:#d1fae5; color:#065f46; }
    .cc-src-category { background:#fef9c3; color:#854d0e; }
    .cc-src-default { background:#f1f5f9; color:#64748b; }
    .cc-src-missing { background:#fee2e2; color:#b91c1c; }
    .cc-conf-high { background:#dcfce7; color:#14532d; }
    .cc-conf-medium { background:#fef9c3; color:#854d0e; }
    .cc-conf-low { background:#fef2f2; color:#b91c1c; }
    .cc-channel { background:#e0f2fe; color:#075985; }
    .cc-island { background:#fae8ff; color:#86198f; }
    .cc-toggle { display:inline-block; width:36px; height:20px; background:#cbd5e1; border-radius:10px; position:relative; cursor:pointer; transition:background 0.2s; }
    .cc-toggle.active { background:#16a34a; }
    .cc-toggle::after { content:''; position:absolute; top:2px; left:2px; width:16px; height:16px; background:#fff; border-radius:50%; transition:left 0.2s; }
    .cc-toggle.active::after { left:18px; }
    .cc-empty { padding:30px 20px; text-align:center; color:#94a3b8; font-style:italic; font-size:0.88rem; }
    .cc-loading { padding:60px 20px; text-align:center; color:#64748b; }
    .cc-drawer-bg { position:fixed; inset:0; background:rgba(15,23,42,0.4); opacity:0; pointer-events:none; transition:opacity .2s; z-index:99; }
    .cc-drawer-bg.open { opacity:1; pointer-events:auto; }
    .cc-drawer { position:fixed; top:0; right:0; width:min(560px, 90vw); height:100vh; background:#fff; box-shadow:-4px 0 24px rgba(0,0,0,0.1); transform:translateX(100%); transition:transform .25s; z-index:100; display:flex; flex-direction:column; }
    .cc-drawer.open { transform:translateX(0); }
    .cc-drawer-head { padding:16px 18px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; gap:12px; }
    .cc-drawer-title { font-size:1.05rem; font-weight:700; flex:1; margin:0; }
    .cc-drawer-body { flex:1; overflow-y:auto; padding:16px 18px; }
    .cc-drawer-foot { padding:12px 18px; border-top:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap; }
    .cc-form-row { margin-bottom:12px; }
    .cc-form-row label { display:block; font-size:0.72rem; color:#64748b; text-transform:uppercase; letter-spacing:0.4px; font-weight:600; margin-bottom:4px; }
    .cc-form-row input, .cc-form-row select, .cc-form-row textarea { width:100%; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.88rem; font-family:inherit; background:#fff; color:#1e293b; box-sizing:border-box; }
    .cc-form-row textarea { resize:vertical; min-height:50px; }
    .cc-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .cc-form-help { font-size:0.72rem; color:#64748b; margin-top:3px; line-height:1.4; }
    .cc-form-section-title { font-size:0.85rem; font-weight:700; color:#1e293b; margin:16px 0 8px; padding-bottom:6px; border-bottom:1px solid #e2e8f0; }
    .cc-events { margin-top:18px; padding:12px; background:#f8fafc; border-radius:6px; }
    .cc-events-title { font-size:0.85rem; font-weight:700; margin-bottom:8px; color:#475569; }
    .cc-event { font-size:0.78rem; color:#64748b; padding:5px 0; border-bottom:1px solid #e2e8f0; }
    .cc-event:last-child { border-bottom:none; }
    .cc-event-type { font-weight:600; color:#1e293b; }
    @media (max-width: 980px) { .cc-families-grid { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(s);
}

async function _ccLoadAll() {
  _cc.loading = true;
  try {
    const params = [];
    if (_cc.filterFamily && _cc.filterFamily !== 'all') params.push('family=' + encodeURIComponent(_cc.filterFamily));
    if (_cc.filterChannel) params.push('channel=' + encodeURIComponent(_cc.filterChannel));
    if (_cc.filterIsland) params.push('island=' + encodeURIComponent(_cc.filterIsland));
    if (_cc.filterScope) params.push('scope=' + encodeURIComponent(_cc.filterScope));
    if (_cc.filterAllocation) params.push('allocation_method=' + encodeURIComponent(_cc.filterAllocation));
    if (!_cc.showInactive) params.push('is_active=true');
    if (!_cc.showExceptional) params.push('is_exceptional=false');
    const qs = params.length ? '?' + params.join('&') : '';

    const ccRes = await _ccApi('GET', '/api/admin/cost-components' + qs);
    _cc.components = ccRes.components || [];
    _cc.grouped = ccRes.grouped || { landed_relay: {}, business: {}, exceptional: {} };

    if (!_cc.meta) {
      const metaRes = await _ccApi('GET', '/api/admin/cost-components/_meta');
      _cc.meta = metaRes;
    }
  } finally {
    _cc.loading = false;
  }
}

async function _ccRender(container) {
  _ccInjectStyles();
  container.innerHTML = '<div class="cc-loading">⏳ Chargement des composants de coût...</div>';
  try {
    await _ccLoadAll();
    _ccRenderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="cc-loading" style="color:#dc2626;">Erreur : ' + _ccEsc(err.message) + '</div>';
  }
}

function _ccRenderHTML(container) {
  let html = '<div class="cc-wrap">';
  // Sprint UX : renommage doctrinal — "Configuration des coûts"
  html += '<div class="cc-header">';
  html += '<div class="cc-header-text">';
  html += '<h1 class="cc-h1">⚙️ Configuration des coûts</h1>';
  html += '<p class="cc-sub">Écran expert — règles utilisées par le moteur de pricing et d\'imputation.</p>';
  html += '</div>';
  html += '<div class="cc-header-actions">';
  html += '<button class="cc-btn cc-btn-secondary" data-act="back-to-pricing">← Retour à Construction du prix</button>';
  html += '</div>';
  html += '</div>';

  // Warning expert
  html += '<div class="cc-expert-warning">';
  html += '<span class="cc-expert-warning-icon">⚠️</span>';
  html += '<div class="cc-expert-warning-text">';
  html += '<strong>Écran expert</strong> — Toute modification ici affecte les calculs de prix de tous les produits. ';
  html += 'Si vous voulez seulement décider d\'un prix produit, utilisez ';
  html += '<a href="#pricing" data-act="back-to-pricing" style="color:#0c4a6e;text-decoration:underline;">Construction du prix</a>.';
  html += '</div></div>';

  html += '<div class="cc-tools">';
  html += '<label>Recherche :</label><input class="cc-input" type="search" data-filter="search" value="' + _ccEsc(_cc.searchTerm) + '" placeholder="clé, libellé, scope…">';
  html += '<label>Famille :</label><select class="cc-select" data-filter="family">';
  html += '<option value="all"' + (_cc.filterFamily === 'all' ? ' selected' : '') + '>Toutes</option>';
  ['landed_relay', 'business', 'exceptional'].forEach(f => {
    const sel = (_cc.filterFamily === f) ? ' selected' : '';
    html += '<option value="' + f + '"' + sel + '>' + (FAMILY_LABELS[f]?.label || f) + '</option>';
  });
  html += '</select>';

  // Sprint UX : ajouter filtre Scope
  html += '<label>Scope :</label><select class="cc-select" data-filter="scope">';
  html += '<option value="">Tous</option>';
  ['global', 'category', 'island', 'channel'].forEach(s => {
    html += '<option value="' + s + '"' + (_cc.filterScope === s ? ' selected' : '') + '>' + s + '</option>';
  });
  html += '</select>';

  // Sprint UX : ajouter filtre Allocation
  html += '<label>Allocation :</label><select class="cc-select" data-filter="allocation">';
  html += '<option value="">Toutes</option>';
  ['direct', 'by_value', 'by_weight', 'by_volume', 'by_taxable_weight',
   'per_item', 'per_order', 'per_parcel', 'per_shipment', 'monthly_prorata'].forEach(a => {
    html += '<option value="' + a + '"' + (_cc.filterAllocation === a ? ' selected' : '') + '>' + a + '</option>';
  });
  html += '</select>';

  html += '<label>Canal :</label><select class="cc-select" data-filter="channel"><option value="">Tous</option>';
  ['cash_relais', 'diaspora', 'mobile_money'].forEach(c => {
    html += '<option value="' + c + '"' + (_cc.filterChannel === c ? ' selected' : '') + '>' + c + '</option>';
  });
  html += '</select>';
  html += '<label>Île :</label><select class="cc-select" data-filter="island"><option value="">Toutes</option>';
  ['grande_comore', 'moheli', 'anjouan', 'mayotte'].forEach(i => {
    html += '<option value="' + i + '"' + (_cc.filterIsland === i ? ' selected' : '') + '>' + i + '</option>';
  });
  html += '</select>';
  html += '<label class="cc-checkbox"><input type="checkbox" data-filter="show_inactive"' + (_cc.showInactive ? ' checked' : '') + '> Inactifs</label>';
  html += '<label class="cc-checkbox"><input type="checkbox" data-filter="show_exceptional"' + (_cc.showExceptional ? ' checked' : '') + '> Exceptionnels</label>';
  html += '<div style="flex:1;"></div>';
  html += '<button class="cc-btn cc-btn-primary" data-act="open-create">+ Nouveau composant</button>';
  html += '</div>';

  html += '<div class="cc-families-grid">';
  ['landed_relay', 'business', 'exceptional'].forEach(family => {
    if (_cc.filterFamily !== 'all' && _cc.filterFamily !== family) return;
    html += _ccRenderFamily(family);
  });
  html += '</div>';

  html += '</div>';
  html += _ccRenderDrawer();
  container.innerHTML = html;
  _ccBindEvents(container);
}

function _ccRenderFamily(family) {
  const fmeta = FAMILY_LABELS[family];
  const cats = _cc.grouped[family] || {};
  const filteredCats = {};
  Object.keys(cats).forEach(catKey => {
    const filtered = _ccFilterComponents(cats[catKey]);
    if (filtered.length) filteredCats[catKey] = filtered;
  });
  const totalComps = Object.values(filteredCats).reduce((s, arr) => s + arr.length, 0);

  let html = '<div class="cc-family">';
  html += '<div class="cc-family-head" style="background:' + fmeta.color + ';">';
  html += '<span class="cc-family-emoji">' + fmeta.emoji + '</span>';
  html += '<div><div class="cc-family-title">' + _ccEsc(fmeta.label) + '</div>';
  html += '<div class="cc-family-desc">' + _ccEsc(fmeta.desc) + '</div></div>';
  html += '<span class="cc-family-count">' + totalComps + ' composants</span>';
  html += '</div>';

  html += '<div class="cc-family-body">';
  if (!totalComps) {
    html += '<div class="cc-empty">Aucun composant dans cette famille pour les filtres actuels.</div>';
  } else {
    const orderedCats = (_cc.meta?.categories?.[family]) || Object.keys(filteredCats);
    orderedCats.forEach(catKey => {
      const comps = filteredCats[catKey];
      if (!comps || !comps.length) return;
      html += _ccRenderCategory(catKey, comps);
    });
  }
  html += '</div></div>';
  return html;
}

function _ccRenderCategory(catKey, components) {
  const cmeta = CATEGORY_LABELS[catKey] || { emoji: '❔', label: catKey };
  const activeCount = components.filter(c => c.is_active).length;
  const catStateKey = catKey;
  const isCollapsed = _cc.collapsedCats[catStateKey] === true;
  const sorted = components.slice().sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return String(a.label || '').localeCompare(String(b.label || ''), 'fr');
  });

  let html = '<div class="cc-category' + (isCollapsed ? ' collapsed' : '') + '">';
  html += '<div class="cc-category-head" data-act="toggle-cat" data-cat="' + _ccEsc(catStateKey) + '" role="button">';
  html += '<span class="cc-category-emoji">' + cmeta.emoji + '</span>';
  html += '<span class="cc-category-title">' + _ccEsc(cmeta.label) + '</span>';
  html += '<span class="cc-category-stat">' + activeCount + '/' + components.length + ' actifs</span>';
  html += '<span class="cc-category-caret">' + (isCollapsed ? '▶' : '▼') + '</span>';
  html += '</div>';
  html += '<div class="cc-category-body">';
  sorted.forEach(c => { html += _ccRenderComponent(c); });
  html += '</div>';
  html += '</div>';
  return html;
}

function _ccFilterComponents(components) {
  const q = String(_cc.searchTerm || '').trim().toLowerCase();
  if (!q) return components.slice();
  return components.filter(c => {
    const hay = [
      c.label, c.key, c.description, c.scope, c.scope_value,
      c.channel, c.island, c.source, c.confidence
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}

function _ccRenderComponent(c) {
  const inactiveCls = c.is_active ? '' : ' inactive';
  let html = '<div class="cc-comp' + inactiveCls + '" data-comp-id="' + c.id + '">';
  html += '<div class="cc-comp-info">';
  html += '<div class="cc-comp-name">';
  if (c.emoji) html += '<span>' + _ccEsc(c.emoji) + '</span>';
  html += '<span>' + _ccEsc(c.label) + '</span>';
  html += '<span class="cc-comp-key">' + _ccEsc(c.key) + '</span>';
  if (c.is_exceptional) html += '<span class="cc-badge" style="background:#fef3c7;color:#92400e;">⚡ Exceptionnel</span>';
  html += '</div>';
  if (c.description) html += '<div class="cc-comp-desc">' + _ccEsc(c.description) + '</div>';
  html += '<div class="cc-comp-badges">';
  const sb = SOURCE_BADGES[c.source] || SOURCE_BADGES.default;
  html += '<span class="cc-badge ' + sb.cls + '">' + sb.label + '</span>';
  const cb = CONFIDENCE_BADGES[c.confidence] || CONFIDENCE_BADGES.medium;
  html += '<span class="cc-badge ' + cb.cls + '">' + cb.label + '</span>';
  if (c.scope && c.scope !== 'global') {
    html += '<span class="cc-badge" style="background:#f1f5f9;color:#475569;">' + _ccEsc(SCOPE_LABELS[c.scope] || c.scope);
    if (c.scope_value) html += ' : ' + _ccEsc(c.scope_value);
    html += '</span>';
  }
  if (c.channel) html += '<span class="cc-badge cc-channel">📡 ' + _ccEsc(c.channel) + '</span>';
  if (c.island) html += '<span class="cc-badge cc-island">🏝 ' + _ccEsc(c.island) + '</span>';
  html += '</div></div>';

  html += '<div class="cc-comp-value">';
  html += _ccFmt(c.default_value);
  html += '<span class="cc-comp-unit">' + _ccEsc(UNIT_LABELS[c.unit] || c.unit) + '</span>';
  html += '</div>';

  html += '<div title="' + (c.is_active ? 'Cliquer pour désactiver' : 'Cliquer pour activer') + '">';
  html += '<span class="cc-toggle' + (c.is_active ? ' active' : '') + '" data-act="toggle-comp" data-id="' + c.id + '"></span>';
  html += '</div>';

  html += '<div class="cc-comp-actions">';
  html += '<button class="cc-btn cc-btn-sm" data-act="edit-comp" data-id="' + c.id + '">✏️</button>';
  if (c.is_deletable) {
    html += '<button class="cc-btn cc-btn-sm cc-btn-danger" data-act="delete-comp" data-id="' + c.id + '">🗑</button>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

function _ccRenderDrawer() {
  const open = _cc.drawerOpen;
  const f = _cc.drawerForm || {};
  const isEdit = _cc.drawerMode === 'edit';

  let html = '<div class="cc-drawer-bg ' + (open ? 'open' : '') + '" data-act="close-drawer"></div>';
  html += '<div class="cc-drawer ' + (open ? 'open' : '') + '">';
  if (!open) { html += '</div>'; return html; }

  html += '<div class="cc-drawer-head">';
  html += '<button class="cc-btn cc-btn-sm" data-act="close-drawer">←</button>';
  html += '<h2 class="cc-drawer-title">' + (isEdit ? '✏️ Modifier le composant' : '+ Nouveau composant') + '</h2>';
  html += '</div>';

  html += '<div class="cc-drawer-body">';

  html += '<div class="cc-form-section-title">📌 Identification</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Clé technique *</label><input type="text" data-form="key" value="' + _ccEsc(f.key) + '" ' + (isEdit ? 'disabled' : '') + ' placeholder="ex: fret_aerien_eur_kg"><div class="cc-form-help">Snake_case, unique. Non modifiable après création.</div></div>';
  html += '<div class="cc-form-row"><label>Libellé *</label><input type="text" data-form="label" value="' + _ccEsc(f.label) + '" placeholder="Ex: Fret aérien"></div>';
  html += '</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Emoji</label><input type="text" data-form="emoji" value="' + _ccEsc(f.emoji) + '" maxlength="4" placeholder="🚢"></div>';
  html += '<div class="cc-form-row"></div>';
  html += '</div>';
  html += '<div class="cc-form-row"><label>Description (clair, métier)</label><textarea data-form="description">' + _ccEsc(f.description) + '</textarea></div>';

  html += '<div class="cc-form-section-title">🏷️ Classification</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Famille *</label><select data-form="family">';
  ['landed_relay', 'business', 'exceptional'].forEach(fa => {
    const sel = (f.family === fa) ? ' selected' : '';
    html += '<option value="' + fa + '"' + sel + '>' + (FAMILY_LABELS[fa]?.label || fa) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Catégorie *</label><select data-form="category">';
  const cats = _cc.meta?.categories?.[f.family || 'landed_relay'] || [];
  cats.forEach(c => {
    const sel = (f.category === c) ? ' selected' : '';
    html += '<option value="' + c + '"' + sel + '>' + (CATEGORY_LABELS[c]?.label || c) + '</option>';
  });
  html += '</select></div>';
  html += '</div>';

  html += '<div class="cc-form-section-title">💰 Valorisation (Phase 2)</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Valeur par défaut *</label><input type="number" step="0.01" data-form="default_value" value="' + _ccEsc(f.default_value) + '"></div>';
  html += '<div class="cc-form-row"><label>Unité *</label><select data-form="unit">';
  Object.keys(UNIT_LABELS).forEach(u => {
    const sel = (f.unit === u) ? ' selected' : '';
    html += '<option value="' + u + '"' + sel + '>' + UNIT_LABELS[u] + '</option>';
  });
  html += '</select></div>';
  html += '</div>';

  html += '<div class="cc-form-section-title">🎯 Portée d\'application (Phase 3)</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Scope</label><select data-form="scope">';
  Object.keys(SCOPE_LABELS).forEach(s => {
    const sel = (f.scope === s) ? ' selected' : '';
    html += '<option value="' + s + '"' + sel + '>' + SCOPE_LABELS[s] + '</option>';
  });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Valeur scope</label><input type="text" data-form="scope_value" value="' + _ccEsc(f.scope_value) + '" placeholder="Ex: phones"></div>';
  html += '</div>';

  html += '<div class="cc-form-section-title">🌐 Contexte</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Canal (optionnel)</label><select data-form="channel"><option value="">Tous</option>';
  ['cash_relais', 'diaspora', 'mobile_money'].forEach(c => {
    const sel = (f.channel === c) ? ' selected' : '';
    html += '<option value="' + c + '"' + sel + '>' + c + '</option>';
  });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Île (optionnel)</label><select data-form="island"><option value="">Toutes</option>';
  ['grande_comore', 'moheli', 'anjouan', 'mayotte'].forEach(i => {
    const sel = (f.island === i) ? ' selected' : '';
    html += '<option value="' + i + '"' + sel + '>' + i + '</option>';
  });
  html += '</select></div>';
  html += '</div>';

  html += '<div class="cc-form-section-title">📋 Qualité des données</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Source</label><select data-form="source">';
  Object.keys(SOURCE_BADGES).forEach(s => {
    const sel = (f.source === s) ? ' selected' : '';
    html += '<option value="' + s + '"' + sel + '>' + SOURCE_BADGES[s].label + '</option>';
  });
  html += '</select></div>';
  html += '<div class="cc-form-row"><label>Confiance</label><select data-form="confidence">';
  Object.keys(CONFIDENCE_BADGES).forEach(c => {
    const sel = (f.confidence === c) ? ' selected' : '';
    html += '<option value="' + c + '"' + sel + '>' + CONFIDENCE_BADGES[c].label + '</option>';
  });
  html += '</select></div>';
  html += '</div>';

  html += '<div class="cc-form-section-title">🔘 Activation</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label class="cc-checkbox"><input type="checkbox" data-form="is_active"' + (f.is_active !== false ? ' checked' : '') + '> Actif</label></div>';
  html += '<div class="cc-form-row"><label class="cc-checkbox"><input type="checkbox" data-form="is_exceptional"' + (f.is_exceptional ? ' checked' : '') + '> Exceptionnel</label></div>';
  html += '</div>';
  html += '<div class="cc-form-grid">';
  html += '<div class="cc-form-row"><label>Actif depuis</label><input type="date" data-form="active_from" value="' + _ccEsc(f.active_from || '') + '"></div>';
  html += '<div class="cc-form-row"><label>Actif jusqu\'à</label><input type="date" data-form="active_until" value="' + _ccEsc(f.active_until || '') + '"></div>';
  html += '</div>';
  html += '<div class="cc-form-row"><label>Notes</label><textarea data-form="notes">' + _ccEsc(f.notes) + '</textarea></div>';

  if (isEdit && _cc.drawerEvents.length) {
    html += '<div class="cc-events">';
    html += '<div class="cc-events-title">🕓 Historique</div>';
    _cc.drawerEvents.slice(0, 10).forEach(ev => {
      html += '<div class="cc-event"><span class="cc-event-type">' + _ccEsc(ev.event_type) + '</span> · ' + new Date(ev.created_at).toLocaleString('fr-FR') + (ev.notes ? ' · ' + _ccEsc(ev.notes) : '') + '</div>';
    });
    html += '</div>';
  }

  html += '</div>';

  html += '<div class="cc-drawer-foot">';
  html += '<button class="cc-btn cc-btn-primary" data-act="' + (isEdit ? 'save-edit' : 'save-create') + '">' + (isEdit ? '💾 Enregistrer' : '+ Créer') + '</button>';
  html += '<button class="cc-btn" data-act="close-drawer">Annuler</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function _ccBindEvents(container) {
  container.addEventListener('change', async (e) => {
    const tgt = e.target;
    if (tgt.dataset.filter) {
      const f = tgt.dataset.filter;
      if (f === 'search') _cc.searchTerm = tgt.value;
      if (f === 'family') _cc.filterFamily = tgt.value;
      else if (f === 'channel') _cc.filterChannel = tgt.value;
      else if (f === 'island') _cc.filterIsland = tgt.value;
      else if (f === 'scope') _cc.filterScope = tgt.value;
      else if (f === 'allocation') _cc.filterAllocation = tgt.value;
      else if (f === 'show_inactive') _cc.showInactive = tgt.checked;
      else if (f === 'show_exceptional') _cc.showExceptional = tgt.checked;
      try { await _ccLoadAll(); _ccRenderHTML(container); }
      catch (err) { alert('Erreur : ' + err.message); }
    }
    if (tgt.dataset.form && _cc.drawerForm) {
      const k = tgt.dataset.form;
      if (k === 'is_active' || k === 'is_exceptional') _cc.drawerForm[k] = tgt.checked;
      else _cc.drawerForm[k] = tgt.value;
      if (k === 'family') _ccRenderHTML(container);
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

    // Sprint UX : retour vers Construction du prix
    if (act === 'back-to-pricing') {
      e.preventDefault();
      window.location.hash = '#pricing';
      return;
    }

    if (act === 'toggle-cat') {
      const cat = t.dataset.cat;
      _cc.collapsedCats[cat] = !_cc.collapsedCats[cat];
      _ccRenderHTML(container);
      return;
    }

    if (act === 'open-create') {
      _cc.drawerMode = 'create';
      _cc.drawerForm = {
        key: '', label: '', emoji: '', description: '',
        family: 'landed_relay', category: 'sourcing',
        default_value: 0, unit: 'kmf', currency: '',
        scope: 'global', scope_value: '', allocation_method: 'none',
        source: 'default', confidence: 'medium',
        channel: '', island: '',
        is_active: true, is_exceptional: false,
        active_from: '', active_until: '', notes: '',
      };
      _cc.drawerEvents = [];
      _cc.drawerOpen = true;
      _ccRenderHTML(container);
      return;
    }

    if (act === 'edit-comp') {
      const id = t.dataset.id;
      try {
        const r = await _ccApi('GET', '/api/admin/cost-components/' + id);
        _cc.drawerMode = 'edit';
        _cc.drawerForm = { ...r.component };
        _cc.drawerEvents = r.events || [];
        _cc.drawerOpen = true;
        _ccRenderHTML(container);
      } catch (err) { alert('Erreur : ' + err.message); }
      return;
    }

    if (act === 'close-drawer') {
      _cc.drawerOpen = false;
      _cc.drawerForm = null;
      _cc.drawerEvents = [];
      _ccRenderHTML(container);
      return;
    }

    if (act === 'save-create') {
      const f = _cc.drawerForm;
      if (!f.key || !f.label || !f.unit || !f.family || !f.category) {
        alert('Champs requis : clé, libellé, famille, catégorie, unité');
        return;
      }
      t.disabled = true;
      t.textContent = '⏳ Création...';
      try {
        const body = { ...f };
        if (!body.channel) delete body.channel;
        if (!body.island) delete body.island;
        if (!body.scope_value) delete body.scope_value;
        if (!body.active_from) delete body.active_from;
        if (!body.active_until) delete body.active_until;
        await _ccApi('POST', '/api/admin/cost-components', body);
        _cc.drawerOpen = false;
        _cc.drawerForm = null;
        await _ccLoadAll();
        _ccRenderHTML(container);
      } catch (err) {
        alert('Erreur création : ' + err.message);
        t.disabled = false;
        t.textContent = '+ Créer';
      }
      return;
    }

    if (act === 'save-edit') {
      const f = _cc.drawerForm;
      if (!f.id) return;
      t.disabled = true;
      t.textContent = '⏳ Enregistrement...';
      try {
        const body = { ...f };
        delete body.id; delete body.key;
        delete body.created_at; delete body.updated_at;
        delete body.created_by; delete body.updated_by;
        await _ccApi('PUT', '/api/admin/cost-components/' + f.id, body);
        _cc.drawerOpen = false;
        _cc.drawerForm = null;
        await _ccLoadAll();
        _ccRenderHTML(container);
      } catch (err) {
        alert('Erreur sauvegarde : ' + err.message);
        t.disabled = false;
        t.textContent = '💾 Enregistrer';
      }
      return;
    }

    if (act === 'toggle-comp') {
      const id = t.dataset.id;
      try {
        await _ccApi('POST', '/api/admin/cost-components/' + id + '/toggle');
        await _ccLoadAll();
        _ccRenderHTML(container);
      } catch (err) { alert('Erreur : ' + err.message); }
      return;
    }

    if (act === 'delete-comp') {
      const id = t.dataset.id;
      if (!confirm('Désactiver ce composant ? (Il pourra être réactivé)')) return;
      try {
        await _ccApi('DELETE', '/api/admin/cost-components/' + id);
        await _ccLoadAll();
        _ccRenderHTML(container);
      } catch (err) { alert('Erreur : ' + err.message); }
      return;
    }
  });
}

CT.views.pricing_workshop = async function(container) {
  await _ccRender(container);
};

})();
