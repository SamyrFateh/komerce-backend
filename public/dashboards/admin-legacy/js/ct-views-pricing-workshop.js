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
  // Refresh 28/04/26 : refonte vue tableau triable
  sortKey: 'family', sortDir: 'asc',
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

    /* ── Refresh 28/04/26 — Vue tableau ───────────────────────── */
    .cc-stats { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin:0 0 14px; }
    .cc-stat { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; }
    .cc-stat-label { font-size:0.72rem; color:#64748b; text-transform:uppercase; letter-spacing:0.4px; font-weight:600; margin-bottom:4px; }
    .cc-stat-value { font-size:1.4rem; font-weight:800; color:#0f172a; line-height:1.1; }
    .cc-stat-sub { font-size:0.72rem; color:#94a3b8; margin-top:2px; }
    .cc-stat.landed { border-left:3px solid #3b82f6; }
    .cc-stat.business { border-left:3px solid #16a34a; }
    .cc-stat.exceptional { border-left:3px solid #f59e0b; }

    .cc-table-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
    .cc-table { width:100%; border-collapse:collapse; font-size:0.85rem; }
    .cc-table thead th {
      background:#f8fafc; padding:10px 12px; text-align:left;
      font-weight:600; font-size:0.78rem; color:#475569;
      border-bottom:1px solid #e2e8f0; white-space:nowrap;
      position:sticky; top:0; z-index:1;
      cursor:pointer; user-select:none;
    }
    .cc-table thead th.sortable:hover { background:#eef2f7; }
    .cc-table thead th.sorted { color:#0f172a; background:#eef2f7; }
    .cc-table thead th .cc-sort-arrow { font-size:0.7rem; color:#64748b; margin-left:4px; opacity:0.6; }
    .cc-table thead th.sorted .cc-sort-arrow { opacity:1; color:#16a34a; }
    .cc-table thead th.right { text-align:right; }
    .cc-table thead th.center { text-align:center; }
    .cc-table tbody tr { border-bottom:1px solid #f1f5f9; transition:background .12s; }
    .cc-table tbody tr:last-child { border-bottom:none; }
    .cc-table tbody tr:hover { background:#f8fafc; }
    .cc-table tbody tr.inactive { opacity:0.55; }
    .cc-table tbody tr.exceptional { background:#fffbeb; }
    .cc-table tbody tr.exceptional:hover { background:#fef3c7; }
    .cc-table td { padding:9px 12px; vertical-align:middle; }
    .cc-table td.right { text-align:right; font-family:ui-monospace,monospace; font-weight:600; }
    .cc-table td.center { text-align:center; }
    .cc-table td.unit { color:#64748b; font-size:0.75rem; font-weight:500; }
    .cc-cell-name { display:flex; align-items:center; gap:6px; min-width:0; }
    .cc-cell-name-text { font-weight:600; color:#1e293b; }
    .cc-cell-name-key { font-family:ui-monospace,monospace; font-size:0.7rem; color:#94a3b8; white-space:nowrap; }
    .cc-cell-fam { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:4px; font-size:0.72rem; font-weight:600; white-space:nowrap; }
    .cc-cell-fam.landed { background:#dbeafe; color:#1e40af; }
    .cc-cell-fam.business { background:#dcfce7; color:#14532d; }
    .cc-cell-fam.exceptional { background:#fef3c7; color:#92400e; }
    .cc-cell-cat { display:inline-flex; align-items:center; gap:4px; color:#475569; font-size:0.78rem; }
    .cc-cell-scope { font-size:0.75rem; color:#475569; white-space:nowrap; }
    .cc-cell-actions { display:flex; gap:3px; justify-content:flex-end; }
    .cc-cell-actions button { padding:3px 7px; font-size:0.78rem; border-radius:5px; border:1px solid transparent; background:transparent; cursor:pointer; transition:background .12s, border-color .12s; }
    .cc-cell-actions button:hover { background:#f1f5f9; border-color:#cbd5e1; }
    .cc-cell-actions button.danger:hover { background:#fef2f2; border-color:#fecaca; }
    .cc-table-empty { padding:50px 20px; text-align:center; color:#94a3b8; font-style:italic; font-size:0.88rem; }
    .cc-table-footer { padding:10px 14px; background:#f8fafc; border-top:1px solid #e2e8f0; font-size:0.78rem; color:#64748b; display:flex; justify-content:space-between; align-items:center; }

    /* responsive : sur petits écrans on cache les colonnes secondaires */
    @media (max-width: 1100px) {
      .cc-table th.col-source, .cc-table td.col-source { display:none; }
      .cc-table th.col-conf, .cc-table td.col-conf { display:none; }
    }
    @media (max-width: 900px) {
      .cc-stats { grid-template-columns:repeat(2, 1fr); }
      .cc-table th.col-cat, .cc-table td.col-cat { display:none; }
      .cc-table th.col-scope, .cc-table td.col-scope { display:none; }
    }
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

  // Refresh 28/04/26 : refonte vue tableau (était : grille de blocs/listes)
  html += _ccRenderStats();
  html += _ccRenderTable();

  html += '</div>';
  html += _ccRenderDrawer();
  container.innerHTML = html;
  _ccBindEvents(container);
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

// ════════════════════════════════════════════════════════════════════
// Refresh 28/04/26 — Vue tableau (remplace les blocs/listes empilés)
// ════════════════════════════════════════════════════════════════════

// Stats globales en haut de la vue
function _ccRenderStats() {
  const all = _ccCollectAllVisibleComponents();
  const byFamily = { landed_relay: 0, business: 0, exceptional: 0 };
  let activeCount = 0;
  all.forEach(c => {
    if (byFamily[c.family] !== undefined) byFamily[c.family]++;
    if (c.is_active) activeCount++;
  });
  const total = all.length;

  let html = '<div class="cc-stats">';
  html += '<div class="cc-stat">';
  html += '<div class="cc-stat-label">Total composants</div>';
  html += '<div class="cc-stat-value">' + total + '</div>';
  html += '<div class="cc-stat-sub">' + activeCount + ' actifs · ' + (total - activeCount) + ' inactifs</div>';
  html += '</div>';
  html += '<div class="cc-stat landed">';
  html += '<div class="cc-stat-label">📦 Landed relais</div>';
  html += '<div class="cc-stat-value">' + byFamily.landed_relay + '</div>';
  html += '<div class="cc-stat-sub">Coût rendu point relais</div>';
  html += '</div>';
  html += '<div class="cc-stat business">';
  html += '<div class="cc-stat-label">💼 Business</div>';
  html += '<div class="cc-stat-value">' + byFamily.business + '</div>';
  html += '<div class="cc-stat-sub">Charges fixes et risques</div>';
  html += '</div>';
  html += '<div class="cc-stat exceptional">';
  html += '<div class="cc-stat-label">⚡ Exceptionnels</div>';
  html += '<div class="cc-stat-value">' + byFamily.exceptional + '</div>';
  html += '<div class="cc-stat-sub">Hors calcul standard</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

// Aplatit la structure groupée + applique le filtre famille + recherche
function _ccCollectAllVisibleComponents() {
  const flat = [];
  ['landed_relay', 'business', 'exceptional'].forEach(family => {
    if (_cc.filterFamily !== 'all' && _cc.filterFamily !== family) return;
    const cats = _cc.grouped[family] || {};
    Object.keys(cats).forEach(catKey => {
      const filtered = _ccFilterComponents(cats[catKey]);
      filtered.forEach(c => {
        flat.push(Object.assign({}, c, { family: family, category: c.category || catKey }));
      });
    });
  });
  return flat;
}

// Rendu de la table principale
function _ccRenderTable() {
  let rows = _ccCollectAllVisibleComponents();
  rows = _ccSortRows(rows);

  const COLS = [
    { key: 'label',      label: 'Composant',  cls: '',          sortable: true },
    { key: 'family',     label: 'Famille',    cls: '',          sortable: true },
    { key: 'category',   label: 'Catégorie',  cls: 'col-cat',   sortable: true },
    { key: 'value',      label: 'Valeur',     cls: 'right',     sortable: true },
    { key: 'scope',      label: 'Scope',      cls: 'col-scope', sortable: true },
    { key: 'source',     label: 'Source',     cls: 'col-source center', sortable: true },
    { key: 'confidence', label: 'Confiance',  cls: 'col-conf center',   sortable: true },
    { key: 'is_active',  label: 'Actif',      cls: 'center',    sortable: true },
    { key: '_actions',   label: '',           cls: 'right',     sortable: false },
  ];

  let html = '<div class="cc-table-wrap">';
  html += '<table class="cc-table"><thead><tr>';
  COLS.forEach(col => {
    const sortedCls = (_cc.sortKey === col.key) ? ' sorted' : '';
    const sortableCls = col.sortable ? ' sortable' : '';
    const arrow = (_cc.sortKey === col.key)
      ? '<span class="cc-sort-arrow">' + (_cc.sortDir === 'asc' ? '▲' : '▼') + '</span>'
      : (col.sortable ? '<span class="cc-sort-arrow">↕</span>' : '');
    const dataAttr = col.sortable ? ' data-act="sort" data-sort="' + col.key + '"' : '';
    html += '<th class="' + col.cls + sortableCls + sortedCls + '"' + dataAttr + '>'
         + _ccEsc(col.label) + arrow + '</th>';
  });
  html += '</tr></thead><tbody>';

  if (rows.length === 0) {
    html += '<tr><td colspan="' + COLS.length + '" class="cc-table-empty">'
         + 'Aucun composant ne correspond aux filtres actuels.</td></tr>';
  } else {
    rows.forEach(c => { html += _ccRenderRow(c); });
  }
  html += '</tbody></table>';
  html += '<div class="cc-table-footer">';
  html += '<span>' + rows.length + ' composant' + (rows.length > 1 ? 's' : '') + ' affiché' + (rows.length > 1 ? 's' : '') + '</span>';
  html += '<span style="color:#94a3b8;">Cliquez une ligne pour modifier · cliquez le toggle pour activer/désactiver</span>';
  html += '</div>';
  html += '</div>';
  return html;
}

// Tri d'une liste plate de composants selon _cc.sortKey + _cc.sortDir
function _ccSortRows(rows) {
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
      case 'is_active':  return c.is_active ? 0 : 1;  // actifs en premier en asc
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

// Rendu d'une ligne du tableau
function _ccRenderRow(c) {
  const fmeta = FAMILY_LABELS[c.family] || { emoji: '?', label: c.family };
  const cmeta = CATEGORY_LABELS[c.category] || { emoji: '❔', label: c.category };
  const sb = SOURCE_BADGES[c.source] || SOURCE_BADGES.default;
  const cb = CONFIDENCE_BADGES[c.confidence] || CONFIDENCE_BADGES.medium;

  let scopeText = SCOPE_LABELS[c.scope] || c.scope || 'global';
  if (c.scope_value) scopeText += ' : ' + c.scope_value;
  if (c.channel) scopeText += ' · 📡 ' + c.channel;
  if (c.island) scopeText += ' · 🏝 ' + c.island;

  const trCls = [];
  if (!c.is_active) trCls.push('inactive');
  if (c.is_exceptional) trCls.push('exceptional');

  let html = '<tr class="' + trCls.join(' ') + '" data-comp-id="' + c.id + '" data-act="row-edit" data-id="' + c.id + '" style="cursor:pointer;">';

  // Composant : emoji + label + key
  html += '<td>';
  html += '<div class="cc-cell-name">';
  if (c.emoji) html += '<span>' + _ccEsc(c.emoji) + '</span>';
  html += '<span class="cc-cell-name-text">' + _ccEsc(c.label || '') + '</span>';
  html += '<span class="cc-cell-name-key">' + _ccEsc(c.key || '') + '</span>';
  html += '</div>';
  if (c.description) {
    html += '<div style="font-size:0.75rem;color:#64748b;margin-top:2px;">' + _ccEsc(c.description) + '</div>';
  }
  html += '</td>';

  // Famille
  const famCls = c.family === 'landed_relay' ? 'landed'
              : c.family === 'business' ? 'business' : 'exceptional';
  html += '<td><span class="cc-cell-fam ' + famCls + '">' + fmeta.emoji + ' ' + _ccEsc(fmeta.label) + '</span></td>';

  // Catégorie
  html += '<td class="col-cat"><span class="cc-cell-cat">' + cmeta.emoji + ' ' + _ccEsc(cmeta.label) + '</span></td>';

  // Valeur + unité
  html += '<td class="right">' + _ccFmt(c.default_value);
  html += ' <span style="font-size:0.7rem;color:#94a3b8;font-family:inherit;font-weight:500;">'
       + _ccEsc(UNIT_LABELS[c.unit] || c.unit || '') + '</span></td>';

  // Scope
  html += '<td class="col-scope"><span class="cc-cell-scope">' + _ccEsc(scopeText) + '</span></td>';

  // Source
  html += '<td class="col-source center"><span class="cc-badge ' + sb.cls + '">' + sb.label + '</span></td>';

  // Confiance
  html += '<td class="col-conf center"><span class="cc-badge ' + cb.cls + '">' + cb.label + '</span></td>';

  // Actif (toggle) — cc-td-norow pour ne pas déclencher row-edit
  html += '<td class="center cc-td-norow">';
  html += '<span class="cc-toggle' + (c.is_active ? ' active' : '') + '" data-act="toggle-comp" data-id="' + c.id + '" title="' + (c.is_active ? 'Cliquer pour désactiver' : 'Cliquer pour activer') + '"></span>';
  html += '</td>';

  // Actions — idem stopPropagation
  html += '<td class="right cc-td-norow"><div class="cc-cell-actions">';
  html += '<button data-act="edit-comp" data-id="' + c.id + '" title="Modifier">✏️</button>';
  if (c.is_deletable) {
    html += '<button class="danger" data-act="delete-comp" data-id="' + c.id + '" title="Supprimer">🗑</button>';
  }
  html += '</div></td>';

  html += '</tr>';
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
      // Fix 28/04/26 : voir ct-views-pricing.js → idem, le routeur n'écoute
      // pas hashchange, on passe par navigate() pour monter la vue.
      if (window.CT && CT.app && typeof CT.app.navigate === 'function') {
        CT.app.navigate('pricing');
      } else {
        window.location.hash = '#pricing';
      }
      return;
    }

    // Refresh 28/04/26 — tri sur les en-têtes du tableau
    if (act === 'sort') {
      const k = t.dataset.sort;
      if (_cc.sortKey === k) {
        _cc.sortDir = (_cc.sortDir === 'asc') ? 'desc' : 'asc';
      } else {
        _cc.sortKey = k;
        _cc.sortDir = 'asc';
      }
      _ccRenderHTML(container);
      return;
    }

    // Refresh 28/04/26 — clic sur une ligne du tableau ouvre le drawer en édition
    // (équivalent au bouton ✏️ existant, plus naturel que de viser le mini-bouton)
    if (act === 'row-edit') {
      if (e.target.closest('.cc-td-norow')) return;
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
