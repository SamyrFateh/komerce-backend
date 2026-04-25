/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-pricing.js — Komerce Control Tower · Pricing v2 (ADR-011)
 *
 *  REFONTE COMPLÈTE (Étape 2C) :
 *    - Vue unique scrollable : simulateur 3 niveaux + catalogue
 *    - Plus de tabs, plus de constantes en dur
 *    - Toutes les variables lues depuis BDD (finance_config, customs_categories,
 *      pricing_components, risk_provisions, charges)
 *    - Toggle on/off, ajout, modification, suppression sur chaque variable
 *    - Slider latéral pour ajouter un composant
 *    - Bouton "Recalculer" explicite (l'humain décide quand)
 *    - Catalogue auto-recalculé via /api/pricing/recommend-batch
 *    - Bouton "Appliquer" par produit + "Tout appliquer" verrouillé admin
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

/* ─── STATE ──────────────────────────────────────────────────────────── */
const _ps = {
  // Données chargées depuis l'API
  config: null,            // finance_config (singleton)
  categories: [],          // customs_categories[]
  components: [],          // pricing_components[]
  provisions: [],          // risk_provisions[]
  catalog: [],             // produits + recos depuis recommend-batch
  catalogSummary: {},

  // État UI simulateur
  inputCategory: 'phones',
  inputPrixAed: 100,
  inputDimL: 25,
  inputDimW: 20,
  inputDimH: 10,
  inputPoidsKg: 1,
  inputChannel: 'cash_relais',
  inputIsDiaspora: false,

  // Calcul actuel (résultat /recommend)
  currentReco: null,

  // État UI accordéons (N1 + verdict ouverts par défaut)
  openSections: { sim: true, n1: true, n2: false, n3: false, verdict: true, catalog: true },

  // Drawer ajout
  drawerOpen: false,
  drawerType: null,       // 'component' | 'provision'
  drawerCategory: null,   // si component : 'sourcing'|...

  // Filtre catalogue
  catalogFilter: 'all',

  loaded: false,
};

/* ─── HELPERS ───────────────────────────────────────────────────────── */
const _nf = new Intl.NumberFormat('fr-FR');
function _fmt(n) { return _nf.format(Math.round(n || 0)) + ' KMF'; }

async function _api(method, path, body) {
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
const _apiGet  = (p) => _api('GET',  p);
const _apiPost = (p, b) => _api('POST', p, b);
const _apiPut  = (p, b) => _api('PUT',  p, b);
const _apiDel  = (p) => _api('DELETE', p);

function _userCanApplyAll() {
  const role = (window.CT && CT.platform && CT.platform.role) || '';
  return role === 'admin' || role === 'founder';
}

/* ─── STYLES ────────────────────────────────────────────────────────── */
function _injectStyles() {
  if (document.getElementById('ct-pricing-v2-styles')) return;
  const s = document.createElement('style');
  s.id = 'ct-pricing-v2-styles';
  s.textContent = `
    /* ===== Pricing v2 — palette CLAIRE (cohérente avec body #f1f5f9 / #1e293b) ===== */
    .pv-wrap { padding: 16px 20px; max-width: 1400px; margin: 0 auto; color: #1e293b; }
    .pv-h1 { font-size: 1.4rem; font-weight: 700; margin: 0 0 6px; color: #1e293b; }
    .pv-sub { font-size: 0.85rem; color: #64748b; margin-bottom: 16px; }
    .pv-tools { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }

    /* Boutons (alignés ct-btn du design system principal) */
    .pv-btn { padding: 8px 16px; font-size: 0.85rem; font-weight: 600; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; user-select: none; font-family: inherit; }
    .pv-btn-primary { background: #f59e0b; color: #fff; border-color: #f59e0b; }
    .pv-btn-primary:hover { background: #d97706; border-color: #d97706; }
    .pv-btn-secondary { background: #fff; color: #1e293b; border: 1px solid #cbd5e1; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .pv-btn-secondary:hover { background: #f8fafc; border-color: #94a3b8; }
    .pv-btn-ghost { background: transparent; color: #3b82f6; border: 1px solid transparent; }
    .pv-btn-ghost:hover { color: #2563eb; background: #eff6ff; }

    /* Sections cards blanches sur fond gris clair */
    .pv-section { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
    .pv-section-head { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .pv-section-head:hover { background: #f1f5f9; }
    .pv-section-title { font-size: 0.95rem; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 8px; }
    .pv-section-meta { display: flex; gap: 12px; align-items: center; font-size: 0.85rem; }
    .pv-section-amount { color: #d97706; font-weight: 700; font-family: ui-monospace, monospace; }
    .pv-section-arrow { color: #94a3b8; font-size: 0.8rem; transition: transform 0.2s; }
    .pv-section.collapsed .pv-section-arrow { transform: rotate(-90deg); }
    .pv-section.collapsed .pv-section-body { display: none; }
    .pv-section.collapsed .pv-section-head { border-bottom: none; }
    .pv-section-body { padding: 14px 16px; background: #fff; }

    /* Inputs */
    .pv-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .pv-input-group { display: flex; flex-direction: column; gap: 4px; }
    .pv-input-label { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
    .pv-input { padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; font-size: 0.85rem; font-family: ui-monospace, monospace; box-sizing: border-box; }
    .pv-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .pv-select { padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; font-size: 0.85rem; }
    .pv-select:focus { outline: none; border-color: #3b82f6; }

    /* Cartes catégories N1 */
    .pv-cat-block { background: #f8fafc; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; border: 1px solid #e2e8f0; }
    .pv-cat-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .pv-cat-title { font-size: 0.82rem; font-weight: 700; color: #334155; }
    .pv-cat-amount { font-size: 0.82rem; font-weight: 700; color: #d97706; font-family: ui-monospace, monospace; }

    /* Lignes variables */
    .pv-row { display: grid; grid-template-columns: 30px 1fr 110px 120px 60px; align-items: center; gap: 10px; padding: 6px 4px; border-bottom: 1px solid #e2e8f0; font-size: 0.85rem; }
    .pv-row:last-child { border-bottom: none; }
    .pv-row.disabled { opacity: 0.4; }
    .pv-row-emoji { font-size: 1.05rem; text-align: center; }
    .pv-row-label { color: #1e293b; }
    .pv-row-rate { font-family: ui-monospace, monospace; color: #64748b; text-align: right; font-size: 0.82rem; }
    .pv-row-amount { font-family: ui-monospace, monospace; color: #1e293b; text-align: right; font-weight: 600; }
    .pv-row-actions { display: flex; gap: 4px; justify-content: flex-end; align-items: center; }
    .pv-row-actions button { padding: 2px 6px; background: transparent; border: none; color: #94a3b8; cursor: pointer; border-radius: 3px; font-size: 0.85rem; }
    .pv-row-actions button:hover { background: #f1f5f9; color: #475569; }

    /* Toggle on/off */
    .pv-toggle { width: 30px; height: 16px; border-radius: 8px; background: #cbd5e1; position: relative; cursor: pointer; transition: background 0.15s; flex-shrink: 0; display: inline-block; }
    .pv-toggle.on { background: #10b981; }
    .pv-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: left 0.15s; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
    .pv-toggle.on::after { left: 16px; }

    /* Verdict (carte chaude orange) */
    .pv-verdict { background: linear-gradient(135deg, #fef3c7, #fffbeb); border: 1px solid #fcd34d; border-radius: 10px; padding: 16px; }
    .pv-verdict-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 0.88rem; color: #475569; }
    .pv-verdict-row.total { font-weight: 700; color: #1e293b; border-top: 1px solid #fcd34d; padding-top: 10px; margin-top: 8px; font-size: 1.05rem; }
    .pv-verdict-price { font-size: 1.6rem; font-weight: 800; color: #d97706; font-family: ui-monospace, monospace; }
    .pv-num { text-align: right; font-family: ui-monospace, monospace; }

    /* Catalogue */
    .pv-catalog-tools { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .pv-catalog-summary { display: flex; gap: 8px; font-size: 0.78rem; }
    .pv-catalog-summary span { padding: 4px 10px; border-radius: 4px; }
    .pv-summary-aligned { background: #dcfce7; color: #166534; }
    .pv-summary-under { background: #fef3c7; color: #92400e; }
    .pv-summary-over { background: #e0e7ff; color: #4338ca; }

    .pv-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .pv-table th { text-align: left; padding: 8px 10px; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 2px solid #e2e8f0; background: #f8fafc; }
    .pv-table td { padding: 8px 10px; color: #1e293b; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .pv-table tbody tr:hover { background: #f8fafc; }
    .pv-status { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.72rem; font-weight: 600; }
    .pv-status-aligned { background: #dcfce7; color: #166534; }
    .pv-status-underpriced { background: #fef3c7; color: #92400e; }
    .pv-status-overpriced { background: #e0e7ff; color: #4338ca; }
    .pv-status-unset { background: #f1f5f9; color: #64748b; }
    .pv-gap-pos { color: #16a34a; font-weight: 600; }
    .pv-gap-neg { color: #dc2626; font-weight: 600; }

    /* Drawer (slider latéral) */
    .pv-drawer-bg { position: fixed; inset: 0; background: rgba(15,23,42,0.4); z-index: 100; display: none; }
    .pv-drawer-bg.open { display: block; }
    .pv-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 90vw; background: #fff; border-left: 1px solid #e2e8f0; z-index: 101; transform: translateX(100%); transition: transform 0.25s; overflow-y: auto; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(15,23,42,0.1); }
    .pv-drawer.open { transform: translateX(0); }
    .pv-drawer-head { padding: 16px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; background: #f8fafc; }
    .pv-drawer-title { font-size: 1.05rem; font-weight: 700; color: #1e293b; }
    .pv-drawer-body { padding: 16px; flex: 1; overflow-y: auto; }
    .pv-drawer-row { margin-bottom: 12px; }
    .pv-drawer-row label { display: block; margin-bottom: 4px; }
    .pv-drawer-foot { padding: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0; background: #f8fafc; }

    /* Empty / loading */
    .pv-empty { padding: 40px 20px; text-align: center; color: #64748b; font-size: 0.9rem; }
    .pv-loading { padding: 24px; text-align: center; color: #64748b; }

    /* ═══ KPIs (Phase 4 — Tableau de bord pricing) ═══ */
    .pv-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .pv-kpi-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 16px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    .pv-kpi-label { font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; margin-bottom: 6px; }
    .pv-kpi-value { font-size: 1.8rem; font-weight: 800; color: #1e293b; font-family: ui-monospace, monospace; line-height: 1.2; }
    .pv-kpi-detail { font-size: 0.82rem; color: #475569; margin-top: 4px; }

    /* ═══ Alertes ═══ */
    .pv-alerts {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 18px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    .pv-alerts-head {
      font-size: 0.92rem;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 10px;
    }
    .pv-alert {
      border-left: 3px solid #cbd5e1;
      padding: 10px 12px;
      margin-bottom: 8px;
      border-radius: 4px;
      background: #f8fafc;
    }
    .pv-alert:last-child { margin-bottom: 0; }
    .pv-alert-critical { border-left-color: #dc2626; background: #fef2f2; }
    .pv-alert-warning { border-left-color: #f59e0b; background: #fffbeb; }
    .pv-alert-info { border-left-color: #3b82f6; background: #eff6ff; }
    .pv-alert-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .pv-alert-icon { font-size: 1.05rem; flex-shrink: 0; line-height: 1.4; }
    .pv-alert-text { flex: 1; }
    .pv-alert-text strong { color: #1e293b; font-size: 0.92rem; }
    .pv-alert-msg { font-size: 0.82rem; color: #475569; margin-top: 2px; }
    .pv-alert-list {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed rgba(0,0,0,0.08);
    }
    .pv-alert-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
      font-size: 0.82rem;
      color: #475569;
    }
    .pv-alert-more {
      font-size: 0.78rem;
      color: #94a3b8;
      font-style: italic;
      margin-top: 4px;
    }

    /* ═══ Onglets Lot B (3 sections) ═══ */
    .pv-tabs {
      display: flex; gap: 4px;
      border-bottom: 2px solid #e2e8f0;
      margin-bottom: 18px;
      padding-bottom: 0;
      flex-wrap: wrap;
    }
    .pv-tab {
      padding: 10px 18px;
      border: none; background: none;
      font-size: 0.92rem; font-weight: 500;
      color: #64748b;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      margin-bottom: -2px;
      border-radius: 6px 6px 0 0;
      transition: all 0.15s;
      font-family: inherit;
    }
    .pv-tab:hover { background: #f1f5f9; color: #1e293b; }
    .pv-tab.active {
      color: #f59e0b;
      border-bottom-color: #f59e0b;
      font-weight: 600;
    }
    .pv-tab-content { animation: fadeIn 0.2s ease-in; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    /* Bandeau pédagogique */
    .pv-explain {
      background: #eff6ff;
      border-left: 3px solid #3b82f6;
      padding: 12px 14px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.88rem;
      color: #1e40af;
      line-height: 1.5;
    }
    .pv-explain strong { color: #1e3a8a; }
    .pv-explain em { color: #3730a3; font-style: normal; font-weight: 600; }

    /* ═══ Signaux marché (Section 3) ═══ */
    .pv-signals { display: flex; flex-direction: column; gap: 18px; }
    .pv-signal-block {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    .pv-signal-title {
      font-size: 1rem;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 4px;
    }
    .pv-signal-sub {
      font-size: 0.82rem;
      color: #64748b;
      margin: 0 0 14px;
    }
    .pv-signal-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
    }
    .pv-signal-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
      transition: all 0.15s;
    }
    .pv-signal-card:hover {
      border-color: #cbd5e1;
      background: #fff;
      transform: translateY(-1px);
    }
    .pv-signal-emoji { font-size: 1.4rem; margin-bottom: 4px; }
    .pv-signal-count {
      font-size: 1.6rem;
      font-weight: 800;
      color: #1e293b;
      font-family: ui-monospace, monospace;
      line-height: 1;
    }
    .pv-signal-label {
      font-size: 0.78rem;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin: 4px 0 2px;
    }
    .pv-signal-pct {
      font-size: 0.72rem;
      color: #94a3b8;
      font-family: ui-monospace, monospace;
      margin-bottom: 4px;
    }
    .pv-signal-hint {
      font-size: 0.72rem;
      color: #64748b;
      font-style: italic;
      line-height: 1.3;
    }
  `;
  document.head.appendChild(s);
}

/* ─── DATA LOADING ──────────────────────────────────────────────────── */
async function _loadAll() {
  const [cfg, cats, comps, provs] = await Promise.all([
    _apiGet('/api/admin/finance-config').catch(() => null),
    _apiGet('/api/admin/customs-categories').catch(() => []),
    _apiGet('/api/admin/pricing-components').catch(() => []),
    _apiGet('/api/admin/risk-provisions').catch(() => []),
  ]);
  _ps.config = cfg || {};
  // Note (audit connectivité) : /api/admin/finance-config retourne un objet structuré
  // ({targets:{...}, sourcing:{...}}). Si on veut l'utiliser plus tard, c'est par section.
  // La vraie source de vérité au runtime du calcul est _ps.currentReco.
  _ps.categories = Array.isArray(cats) ? cats : [];
  _ps.components = Array.isArray(comps) ? comps : [];
  _ps.provisions = Array.isArray(provs) ? provs : [];

  if (_ps.categories.length && !_ps.categories.find(c => c.key === _ps.inputCategory)) {
    _ps.inputCategory = _ps.categories[0].key;
  }
}

async function _computeReco() {
  const volM3 = (_ps.inputDimL * _ps.inputDimW * _ps.inputDimH) / 1_000_000;
  const body = {
    category: _ps.inputCategory,
    prix_aed: _ps.inputPrixAed,
    volume_m3: volM3,
    poids_kg: _ps.inputPoidsKg,
    channel: _ps.inputChannel,
    is_diaspora: _ps.inputChannel === 'diaspora',
    verbose: true,
  };
  _ps.currentReco = await _apiPost('/api/pricing/recommend', body);
  return _ps.currentReco;
}

async function _loadCatalog() {
  try {
    const r = await _apiPost('/api/pricing/recommend-batch', { limit: 200 });
    _ps.catalog = r.items || [];
    _ps.catalogSummary = r.summary || {};
  } catch (err) {
    console.warn('[Pricing v2] _loadCatalog error:', err.message);
    _ps.catalog = [];
    _ps.catalogSummary = {};
  }
}

async function _loadDashboard() {
  try {
    _ps.dashboard = await _apiGet('/api/pricing/dashboard');
  } catch (err) {
    console.warn('[Pricing v2] _loadDashboard error:', err.message);
    _ps.dashboard = null;
  }
}

/* ─── RENDER ───────────────────────────────────────────────────────── */
async function _render(container) {
  container.innerHTML = '<div class="pv-loading">Chargement du tableau de bord pricing...</div>';
  try {
    // _loadAll garde la config (nécessaire pour le drawer "ajouter variable")
    await _loadAll();
    // Dashboard + catalogue en parallèle
    await Promise.all([_loadDashboard(), _loadCatalog()]);
    _ps.loaded = true;
    _renderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="pv-empty">Erreur de chargement : ' + err.message + '</div>';
    console.error('[Pricing v2] _render error:', err);
  }
}

function _renderHTML(container) {
  _injectStyles();

  let html = '<div class="pv-wrap">';

  // ─── HEADER ─────────────────────────────────────────────────────────
  html += '<h1 class="pv-h1">🧮 Pricing — Pilotage du marché</h1>';
  html += '<p class="pv-sub">Apprendre le marché et guider le sourcing par la contribution.</p>';
  html += '<div class="pv-tools">';
  html += '  <button class="pv-btn pv-btn-secondary" data-act="refresh">🔄 Rafraîchir</button>';
  html += '  <button class="pv-btn pv-btn-secondary" data-act="add" data-target="component">⚙️ Variables</button>';
  html += '  <button class="pv-btn pv-btn-secondary" data-act="add" data-target="provision">🛡️ Provisions</button>';
  html += '  <button class="pv-btn pv-btn-primary" data-act="open-workshop" style="margin-left:auto;">🧱 Atelier de composition</button>';
  // Bouton Stratégie masqué (Lot B : feature flag, modules avancés en pause)
  if (window.FEATURE_PRICING_STRATEGY) {
    html += '  <button class="pv-btn pv-btn-primary" data-act="open-strategy">💰 Stratégie de prix</button>';
  }
  html += '</div>';

  // ─── ONGLETS DES 3 SECTIONS ─────────────────────────────────────────
  const activeTab = _ps.activeTab || 'atelier';
  html += '<div class="pv-tabs">';
  html += '  <button class="pv-tab ' + (activeTab === 'atelier' ? 'active' : '') + '" data-act="set-tab" data-tab="atelier">🛠️ Atelier produit</button>';
  html += '  <button class="pv-tab ' + (activeTab === 'catalogue' ? 'active' : '') + '" data-act="set-tab" data-tab="catalogue">📦 Catalogue pricing</button>';
  html += '  <button class="pv-tab ' + (activeTab === 'signaux' ? 'active' : '') + '" data-act="set-tab" data-tab="signaux">📡 Signaux marché</button>';
  html += '</div>';

  // ─── CONTENU SELON ONGLET ───────────────────────────────────────────
  html += '<div class="pv-tab-content">';
  if (activeTab === 'atelier') {
    html += _renderAtelierProduit();
  } else if (activeTab === 'catalogue') {
    html += _renderCataloguePricing();
  } else if (activeTab === 'signaux') {
    html += _renderSignauxMarche();
  }
  html += '</div>';

  html += '</div>';
  html += _renderDrawer();

  container.innerHTML = html;
  _bindEvents(container);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 1 — Atelier produit
// Répond à : Ce produit peut-il être vendu ? À quel prix ?
// ═══════════════════════════════════════════════════════════════════
function _renderAtelierProduit() {
  let html = '';
  // KPIs synthétiques (existants : marge, statut catalogue, vente à perte, couverture)
  html += _renderKPIs();
  // Alertes (existantes)
  html += _renderAlerts();
  // Bandeau pédagogique
  html += '<div class="pv-explain">' +
    '<strong>💡 Comment ça marche</strong><br>' +
    'Le moteur calcule 4 prix pour chaque produit : <em>survie, minimum sûr, conseillé, test</em>. ' +
    'Cliquez sur l\'Atelier de composition pour comprendre le détail des coûts d\'un produit.' +
    '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2 — Catalogue pricing
// La table actuelle des produits avec écart vs CDR
// ═══════════════════════════════════════════════════════════════════
function _renderCataloguePricing() {
  return _section('catalog', '📦 Catalogue & verdicts', '', _renderCatalogBody());
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3 — Signaux marché
// Distributions doctrine : santé / décision sourcing / confiance marché
// Répond à : Faut-il sourcer, tester, renforcer ou éviter ?
// ═══════════════════════════════════════════════════════════════════
function _renderSignauxMarche() {
  const d = _ps.dashboard;
  if (!d || !d.doctrine) {
    return '<div class="pv-empty">' +
      '<p>Signaux marché en cours de calcul...</p>' +
      '<p style="font-size:0.85rem;color:#94a3b8;">Si ce message persiste, vérifiez que le service pricing-engine est actif.</p>' +
      '</div>';
  }

  const doc = d.doctrine;
  const total = doc.sample_size || 0;

  let html = '<div class="pv-signals">';

  // Bandeau explicatif
  html += '<div class="pv-explain">' +
    '<strong>📡 Doctrine du moteur</strong><br>' +
    'Le moteur classe chaque produit selon sa <em>santé</em> (prix vs coûts), ' +
    'sa <em>confiance marché</em> (signal des ventes) et la <em>décision sourcing</em> recommandée.<br>' +
    '<span style="color:#475569;font-size:0.85rem;">Important : le moteur recommande, l\'admin décide.</span>' +
    '</div>';

  // ── Distribution Santé ──
  html += '<div class="pv-signal-block">';
  html += '<h3 class="pv-signal-title">🩺 Santé prix (' + total + ' produits)</h3>';
  html += '<p class="pv-signal-sub">Le prix actuel couvre-t-il les coûts ?</p>';
  html += '<div class="pv-signal-grid">';
  html += _signalCard('loss', '🔴', 'À perte', doc.by_health.loss, total, 'Prix < CDR — vente à perte');
  html += _signalCard('danger', '🟠', 'Danger', doc.by_health.danger, total, 'Marge < 15%');
  html += _signalCard('fragile', '🟡', 'Fragile', doc.by_health.fragile, total, 'Marge 15-25%');
  html += _signalCard('healthy', '🟢', 'Sain', doc.by_health.healthy, total, 'Marge 25-40%');
  html += _signalCard('strong', '💚', 'Fort', doc.by_health.strong, total, 'Marge > 40%');
  html += _signalCard('unknown', '⚪', 'Inconnu', doc.by_health.unknown, total, 'Données insuffisantes');
  html += '</div></div>';

  // ── Distribution Confiance marché ──
  html += '<div class="pv-signal-block">';
  html += '<h3 class="pv-signal-title">📊 Confiance marché</h3>';
  html += '<p class="pv-signal-sub">Que disent les ventes réelles ?</p>';
  html += '<div class="pv-signal-grid">';
  html += _signalCard('m_unknown', '❔', 'Inconnu', doc.by_market.unknown, total, '0 vente — pas de signal');
  html += _signalCard('m_testing', '🧪', 'En test', doc.by_market.testing, total, '1-5 ventes — observation');
  html += _signalCard('m_validated', '✅', 'Validé', doc.by_market.validated, total, '6-20 ventes — signal positif');
  html += _signalCard('m_scaling', '🚀', 'Scaling', doc.by_market.scaling, total, '> 20 ventes — repeat purchase');
  html += _signalCard('m_rejected', '❌', 'Rejeté', doc.by_market.rejected, total, 'Pas de vente sur 60j');
  html += '</div></div>';

  // ── Distribution Décision sourcing ──
  html += '<div class="pv-signal-block">';
  html += '<h3 class="pv-signal-title">🎯 Décision sourcing recommandée</h3>';
  html += '<p class="pv-signal-sub">Faut-il continuer à sourcer ce produit ?</p>';
  html += '<div class="pv-signal-grid">';
  html += _signalCard('s_priority', '⭐', 'PRIORITY', doc.by_sourcing.PRIORITY, total, 'Forte marge + demande validée');
  html += _signalCard('s_test', '🧪', 'TEST', doc.by_sourcing.TEST, total, 'Bonne marge mais à tester');
  html += _signalCard('s_watch', '👀', 'WATCH', doc.by_sourcing.WATCH, total, 'Marge fragile à surveiller');
  html += _signalCard('s_avoid', '⛔', 'AVOID', doc.by_sourcing.AVOID, total, 'Faible marge + complexité');
  html += _signalCard('s_loss', '🚨', 'LOSS', doc.by_sourcing.LOSS, total, 'Vendu à perte');
  if (doc.by_sourcing.RENEGOTIATE > 0) {
    html += _signalCard('s_reneg', '💬', 'RENEGOTIATE', doc.by_sourcing.RENEGOTIATE, total, 'Renégocier fournisseur');
  }
  if (doc.by_sourcing.INCREASE_PRICE > 0) {
    html += _signalCard('s_inc', '📈', 'INCREASE_PRICE', doc.by_sourcing.INCREASE_PRICE, total, 'Augmenter le prix');
  }
  html += '</div></div>';

  html += '</div>';
  return html;
}

function _signalCard(key, emoji, label, count, total, hint) {
  const pct = total > 0 ? Math.round(count / total * 100) : 0;
  return '<div class="pv-signal-card" data-signal="' + key + '">' +
    '<div class="pv-signal-emoji">' + emoji + '</div>' +
    '<div class="pv-signal-count">' + count + '</div>' +
    '<div class="pv-signal-label">' + label + '</div>' +
    '<div class="pv-signal-pct">' + pct + '%</div>' +
    '<div class="pv-signal-hint">' + hint + '</div>' +
  '</div>';
}

function _renderKPIs() {
  const d = _ps.dashboard;
  if (!d || !d.kpis) {
    return '<div class="pv-empty">Tableau de bord indisponible.</div>';
  }
  const k = d.kpis;
  const ecartColor = k.ecart_cible_pct >= 0 ? '#16a34a' : (k.ecart_cible_pct >= -10 ? '#d97706' : '#dc2626');
  const ecartIcon = k.ecart_cible_pct >= 0 ? '✓' : '⚠';
  const couvColor = k.couverture_cost_pct >= 80 ? '#16a34a' : (k.couverture_cost_pct >= 50 ? '#d97706' : '#dc2626');

  let html = '<div class="pv-kpis">';

  // KPI 1 : Marge globale vs cible
  html += '<div class="pv-kpi-card">' +
    '<div class="pv-kpi-label">📈 Marge effective moyenne</div>' +
    '<div class="pv-kpi-value">' + k.marge_moyenne_pct + '%</div>' +
    '<div class="pv-kpi-detail" style="color:' + ecartColor + ';font-weight:600;">' +
      ecartIcon + ' ' + (k.ecart_cible_pct >= 0 ? '+' : '') + k.ecart_cible_pct + '% vs cible ' + k.marge_cible_pct + '%' +
    '</div>' +
  '</div>';

  // KPI 2 : Statut catalogue
  html += '<div class="pv-kpi-card">' +
    '<div class="pv-kpi-label">📊 Statut catalogue</div>' +
    '<div class="pv-kpi-value">' + k.nb_total + '<span style="font-size:14px;color:#94a3b8;font-weight:400;"> produits</span></div>' +
    '<div class="pv-kpi-detail">' +
      '<span style="color:#16a34a;">' + k.nb_aligned + ' alignés</span> · ' +
      '<span style="color:#d97706;">' + k.nb_underpriced + ' sous</span> · ' +
      '<span style="color:#6366f1;">' + k.nb_overpriced + ' sur</span>' +
      (k.nb_unset ? ' · <span style="color:#94a3b8;">' + k.nb_unset + ' non fixés</span>' : '') +
    '</div>' +
  '</div>';

  // KPI 3 : Vente à perte (alerte critique)
  const lossColor = k.nb_at_loss > 0 ? '#dc2626' : '#16a34a';
  html += '<div class="pv-kpi-card">' +
    '<div class="pv-kpi-label">🚨 Vente à perte</div>' +
    '<div class="pv-kpi-value" style="color:' + lossColor + ';">' + k.nb_at_loss + '</div>' +
    '<div class="pv-kpi-detail">' +
      (k.nb_at_loss > 0
        ? '<span style="color:#dc2626;font-weight:600;">prix actuel &lt; CDR</span>'
        : '<span style="color:#16a34a;">aucun produit en perte</span>') +
    '</div>' +
  '</div>';

  // KPI 4 : Couverture coût
  html += '<div class="pv-kpi-card">' +
    '<div class="pv-kpi-label">📋 Couverture coût d\'achat</div>' +
    '<div class="pv-kpi-value" style="color:' + couvColor + ';">' + k.couverture_cost_pct + '%</div>' +
    '<div class="pv-kpi-detail">' + (k.nb_total - Math.round(k.nb_total * k.couverture_cost_pct / 100)) + ' produits sans cost_kmf renseigné</div>' +
  '</div>';

  html += '</div>';
  return html;
}

function _renderAlerts() {
  const d = _ps.dashboard;
  if (!d || !d.alerts || !d.alerts.length) {
    return '<div class="pv-section" style="padding:14px 16px;background:#f0fdf4;border-color:#86efac;">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:1.4rem;">✓</span>' +
        '<div><strong style="color:#166534;">Aucune anomalie détectée</strong>' +
        '<div style="font-size:0.82rem;color:#475569;margin-top:2px;">' +
        'Les prix sont cohérents avec les coûts. Tout va bien.</div></div>' +
      '</div></div>';
  }

  let html = '<div class="pv-alerts">';
  html += '<div class="pv-alerts-head">⚠️ Anomalies détectées (' + d.alerts.length + ')</div>';

  d.alerts.forEach(a => {
    const sevClass = 'pv-alert-' + a.severity;
    const sevIcon = a.severity === 'critical' ? '🔴' : (a.severity === 'warning' ? '🟠' : '🔵');

    html += '<div class="pv-alert ' + sevClass + '">' +
      '<div class="pv-alert-head">' +
        '<span class="pv-alert-icon">' + sevIcon + '</span>' +
        '<div class="pv-alert-text">' +
          '<strong>' + a.title + '</strong>' +
          '<div class="pv-alert-msg">' + a.message + '</div>' +
        '</div>' +
        (a.code === 'sale_at_loss' || a.code === 'low_margin'
          ? '<button class="pv-btn pv-btn-secondary" data-act="filter-catalog" data-status="underpriced" style="padding:5px 10px;font-size:0.78rem;">Voir produits</button>'
          : '') +
      '</div>';

    // Détails
    if (a.products && a.products.length) {
      html += '<div class="pv-alert-list">';
      a.products.slice(0, 5).forEach(p => {
        if (a.code === 'sale_at_loss') {
          html += '<div class="pv-alert-item">' +
            '<span>' + p.name + '</span>' +
            '<span style="color:#dc2626;font-family:ui-monospace,monospace;">' +
              _fmt(p.price_kmf) + ' < CDR ' + _fmt(p.cdr_kmf) + ' (perte ' + _fmt(p.gap_kmf) + ')' +
            '</span></div>';
        } else if (a.code === 'low_margin') {
          html += '<div class="pv-alert-item">' +
            '<span>' + p.name + '</span>' +
            '<span style="color:#d97706;font-family:ui-monospace,monospace;">marge ' + p.marge_pct + '%</span>' +
          '</div>';
        }
      });
      if (a.products.length > 5) {
        html += '<div class="pv-alert-more">...et ' + (a.products.length - 5) + ' autre(s)</div>';
      }
      html += '</div>';
    }
    if (a.categories && a.categories.length) {
      html += '<div class="pv-alert-list">';
      a.categories.forEach(c => {
        html += '<div class="pv-alert-item">' +
          '<span>' + c.category + ' (' + c.nb_produits + ' produits)</span>' +
          '<span style="color:#d97706;font-family:ui-monospace,monospace;">marge moyenne ' + c.marge_moyenne_pct + '%</span>' +
        '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
  });

  html += '</div>';
  return html;
}

function _section(id, title, amount, body) {
  const open = _ps.openSections[id];
  return `
    <div class="pv-section ${open ? '' : 'collapsed'}" data-section="${id}">
      <div class="pv-section-head" data-act="toggle-section" data-section-id="${id}">
        <div class="pv-section-title">${title}</div>
        <div class="pv-section-meta">
          ${amount ? '<span class="pv-section-amount">' + amount + '</span>' : ''}
          <span class="pv-section-arrow">▼</span>
        </div>
      </div>
      <div class="pv-section-body">${body}</div>
    </div>
  `;
}

function _renderSimBody() {
  let html = '<div class="pv-inputs">';
  html += '<div class="pv-input-group"><label class="pv-input-label">Catégorie</label>' +
    '<select class="pv-select" data-input="category">' +
    _ps.categories.map(c =>
      '<option value="' + c.key + '"' + (c.key === _ps.inputCategory ? ' selected' : '') + '>' +
      (c.emoji ? c.emoji + ' ' : '') + c.label + '</option>'
    ).join('') +
    '</select></div>';
  html += '<div class="pv-input-group"><label class="pv-input-label">Prix achat (AED)</label>' +
    '<input class="pv-input" type="number" data-input="prixAed" value="' + _ps.inputPrixAed + '" min="0" step="0.5"></div>';
  html += '<div class="pv-input-group"><label class="pv-input-label">Dim L × l × h (cm)</label>' +
    '<div style="display:flex; gap:4px;">' +
    '<input class="pv-input" type="number" data-input="dimL" value="' + _ps.inputDimL + '" style="width:50px;">' +
    '<input class="pv-input" type="number" data-input="dimW" value="' + _ps.inputDimW + '" style="width:50px;">' +
    '<input class="pv-input" type="number" data-input="dimH" value="' + _ps.inputDimH + '" style="width:50px;">' +
    '</div></div>';
  html += '<div class="pv-input-group"><label class="pv-input-label">Poids (kg)</label>' +
    '<input class="pv-input" type="number" data-input="poidsKg" value="' + _ps.inputPoidsKg + '" min="0" step="0.1"></div>';
  html += '<div class="pv-input-group"><label class="pv-input-label">Canal</label>' +
    '<select class="pv-select" data-input="channel">' +
    '<option value="cash_relais"' + (_ps.inputChannel === 'cash_relais' ? ' selected' : '') + '>Cash relais</option>' +
    '<option value="diaspora"' + (_ps.inputChannel === 'diaspora' ? ' selected' : '') + '>Diaspora (Stripe)</option>' +
    '</select></div>';
  html += '</div>';

  const reco = _ps.currentReco;
  if (!reco) {
    html += '<div class="pv-empty">Configure les inputs et clique "Recalculer" pour simuler un prix.</div>';
    return html;
  }

  html += _section('n1', '🏭 Niveau 1 — Variables par commande', _fmt(reco.niveau1.total), _renderN1Body());
  html += _section('n2', '💼 Niveau 2 — Charges fixes amorties', _fmt(reco.niveau2.total), _renderN2Body(reco.niveau2));
  html += _section('n3', '🛡️ Niveau 3 — Provisions risques', _fmt(reco.niveau3.total), _renderN3Body());
  html += _section('verdict', '🎯 Prix recommandé', '', _renderVerdictBody(reco));

  return html;
}

function _renderN1Body() {
  const cats = ['sourcing', 'transit', 'douane', 'hub', 'distribution', 'paiement'];
  const labels = {
    sourcing: '🏭 Sourcing',
    transit: '🚢 Transit maritime',
    douane: '📋 Douane & fiscalité',
    hub: '🏢 Hub Dubai (par cmd)',
    distribution: '📦 Distribution',
    paiement: '💳 Paiement',
  };

  const reco = _ps.currentReco;
  const itemsByKey = {};
  if (reco?.niveau1?.items) {
    reco.niveau1.items.forEach(it => { itemsByKey[it.key] = it; });
  }

  let html = '';
  cats.forEach(catKey => {
    const items = _ps.components.filter(c => c.category === catKey);
    if (!items.length) return;

    const catTotal = items.reduce((s, c) => {
      if (!c.is_active) return s;
      const calc = itemsByKey[c.key];
      return s + (calc ? calc.valeur_kmf : 0);
    }, 0);

    html += '<div class="pv-cat-block">' +
      '<div class="pv-cat-head">' +
        '<span class="pv-cat-title">' + (labels[catKey] || catKey) + '</span>' +
        '<div style="display:flex; gap:8px; align-items:center;">' +
          '<span class="pv-cat-amount">' + _fmt(catTotal) + '</span>' +
          '<button class="pv-btn pv-btn-ghost" data-act="add" data-target="component" data-cat="' + catKey + '" style="padding:2px 8px; font-size:0.75rem;">+ Ajouter</button>' +
        '</div>' +
      '</div>';

    items.forEach(comp => {
      const calc = itemsByKey[comp.key];
      const amount = calc ? _fmt(calc.valeur_kmf) : '-';
      const rate = comp.unit === 'pct' ? comp.default_value + ' %'
                 : comp.default_value + ' ' + (comp.unit || '');
      html += '<div class="pv-row ' + (comp.is_active ? '' : 'disabled') + '" data-comp-id="' + comp.id + '">' +
        '<span class="pv-row-emoji">' + (comp.emoji || '•') + '</span>' +
        '<span class="pv-row-label">' + comp.label + '</span>' +
        '<span class="pv-row-rate">' + rate + '</span>' +
        '<span class="pv-row-amount">' + (comp.is_active ? amount : '(off)') + '</span>' +
        '<span class="pv-row-actions">' +
          '<span class="pv-toggle ' + (comp.is_active ? 'on' : '') + '" data-act="toggle-comp" title="Activer/désactiver"></span>' +
          (comp.is_deletable ? '<button data-act="del-comp" title="Supprimer">🗑</button>' : '') +
        '</span>' +
      '</div>';
    });

    html += '</div>';
  });

  // Taxes officielles depuis customs_categories (lecture seule, gérées dans Économique)
  if (reco?.niveau1?.items) {
    const douaneItems = reco.niveau1.items.filter(it =>
      ['douane_pct', 'tva_pct', 'taxe_add_pct'].includes(it.key)
    );
    if (douaneItems.length) {
      html += '<div class="pv-cat-block" style="border-left: 2px solid #6366f1;">' +
        '<div class="pv-cat-head">' +
          '<span class="pv-cat-title">📋 Taxes officielles (depuis customs_categories)</span>' +
        '</div>';
      douaneItems.forEach(it => {
        html += '<div class="pv-row">' +
          '<span class="pv-row-emoji">📋</span>' +
          '<span class="pv-row-label">' + it.label + '</span>' +
          '<span class="pv-row-rate">' + it.rate + '%</span>' +
          '<span class="pv-row-amount">' + _fmt(it.valeur_kmf) + '</span>' +
          '<span class="pv-row-actions" style="color:#64748b; font-size:0.7rem;">via cat.</span>' +
        '</div>';
      });
      html += '</div>';
    }
  }

  return html;
}

function _renderN2Body(n2) {
  return '<div style="font-size:0.85rem;">' +
    '<div class="pv-verdict-row"><span>Volume cible mensuel</span><span class="pv-num">' + n2.volume_cible + ' cmd/mois</span></div>' +
    '<div class="pv-verdict-row"><span>Charges fixes total mensuel</span><span class="pv-num">' + _fmt(n2.charges_mensuelles_kmf) + '</span></div>' +
    '<div class="pv-verdict-row"><span>Charges per_order</span><span class="pv-num">' + _fmt(n2.charges_per_order_kmf) + '</span></div>' +
    '<div class="pv-verdict-row total"><span>Part fixe par commande</span><span class="pv-num">' + _fmt(n2.total) + '</span></div>' +
    '<div style="margin-top:10px;">' +
      '<a href="#economic" data-act="goto" data-view="economic" style="color:#f59e0b; font-size:0.82rem; text-decoration:none;">→ Gérer les charges fixes (Modèle économique)</a>' +
    '</div>' +
    '</div>';
}

function _renderN3Body() {
  const reco = _ps.currentReco;
  const itemsByKey = {};
  if (reco?.niveau3?.items) {
    reco.niveau3.items.forEach(it => { itemsByKey[it.key] = it; });
  }

  if (!_ps.provisions.length) {
    return '<div class="pv-empty">Aucune provision configurée.<br><button class="pv-btn pv-btn-secondary" data-act="add" data-target="provision" style="margin-top:8px;">+ Ajouter une provision</button></div>';
  }

  let html = '<div class="pv-cat-block">';
  _ps.provisions.forEach(prov => {
    const calc = itemsByKey[prov.key];
    const amount = calc ? _fmt(calc.valeur_kmf) : '(off)';
    html += '<div class="pv-row ' + (prov.is_active ? '' : 'disabled') + '" data-prov-id="' + prov.id + '">' +
      '<span class="pv-row-emoji">' + (prov.emoji || '🛡') + '</span>' +
      '<span class="pv-row-label">' + prov.label + '</span>' +
      '<span class="pv-row-rate">' + prov.rate_pct + ' %</span>' +
      '<span class="pv-row-amount">' + (prov.is_active ? amount : '(off)') + '</span>' +
      '<span class="pv-row-actions">' +
        '<span class="pv-toggle ' + (prov.is_active ? 'on' : '') + '" data-act="toggle-prov" title="Activer/désactiver"></span>' +
        (prov.is_deletable ? '<button data-act="del-prov" title="Supprimer">🗑</button>' : '') +
      '</span>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function _renderVerdictBody(reco) {
  const n1 = reco.niveau1.total;
  const n2 = reco.niveau2.total;
  const n3 = reco.niveau3.total;
  const total = reco.cout_total_kmf;
  const marge = reco.prix_recommande_brut_kmf - total;

  return '<div class="pv-verdict">' +
    '<div class="pv-verdict-row"><span>Niveau 1 — Variables</span><span class="pv-num">' + _fmt(n1) + '</span></div>' +
    '<div class="pv-verdict-row"><span>Niveau 2 — Charges fixes amorties</span><span class="pv-num">' + _fmt(n2) + '</span></div>' +
    '<div class="pv-verdict-row"><span>Niveau 3 — Provisions risques</span><span class="pv-num">' + _fmt(n3) + '</span></div>' +
    '<div class="pv-verdict-row total"><span>Coût total complet</span><span class="pv-num">' + _fmt(total) + '</span></div>' +
    '<div class="pv-verdict-row"><span>+ Marge cible (' + reco.marge_cible_pct + '%)</span><span class="pv-num">+ ' + _fmt(marge) + '</span></div>' +
    '<div style="border-top:2px solid rgba(245,158,11,0.5); margin-top:10px; padding-top:14px; display:flex; justify-content:space-between; align-items:flex-end;">' +
      '<div>' +
        '<div style="font-size:0.75rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px;">Prix recommandé</div>' +
        '<div style="font-size:0.78rem; color:#94a3b8;">Marge effective ' + reco.marge_atteinte_pct + '%</div>' +
      '</div>' +
      '<div class="pv-verdict-price">' + _fmt(reco.prix_recommande_kmf) + '</div>' +
    '</div>' +
  '</div>';
}

function _renderCatalogBody() {
  if (!_ps.catalog.length) {
    return '<div class="pv-empty">Aucun produit dans le catalogue.<br>Ajoute des produits via la vue Sourcing puis reviens ici.</div>';
  }

  const summary = _ps.catalogSummary;
  const canApplyAll = _userCanApplyAll();

  let html = '<div class="pv-catalog-tools">' +
    '<div class="pv-catalog-summary">' +
      '<span class="pv-summary-aligned">✓ Alignés : ' + (summary.aligned || 0) + '</span>' +
      '<span class="pv-summary-under">↑ Sous-prix : ' + (summary.underpriced || 0) + '</span>' +
      '<span class="pv-summary-over">↓ Sur-prix : ' + (summary.overpriced || 0) + '</span>' +
    '</div>' +
    '<select class="pv-select" data-input="catFilter">' +
      '<option value="all"' + (_ps.catalogFilter === 'all' ? ' selected' : '') + '>Tous les produits</option>' +
      '<option value="underpriced"' + (_ps.catalogFilter === 'underpriced' ? ' selected' : '') + '>Sous-prix uniquement</option>' +
      '<option value="overpriced"' + (_ps.catalogFilter === 'overpriced' ? ' selected' : '') + '>Sur-prix uniquement</option>' +
      '<option value="aligned"' + (_ps.catalogFilter === 'aligned' ? ' selected' : '') + '>Alignés uniquement</option>' +
    '</select>' +
    (canApplyAll
      ? '<button class="pv-btn pv-btn-primary" data-act="apply-all">✨ Tout appliquer (admin)</button>'
      : '<span style="font-size:0.78rem; color:#64748b;">⚠ "Tout appliquer" réservé admin/founder</span>') +
  '</div>';

  let items = _ps.catalog;
  if (_ps.catalogFilter !== 'all') {
    items = items.filter(it => it.status === _ps.catalogFilter);
  }

  if (!items.length) {
    html += '<div class="pv-empty">Aucun produit ne correspond au filtre.</div>';
    return html;
  }

  html += '<table class="pv-table"><thead><tr>' +
    '<th>Produit</th><th>Catégorie</th>' +
    '<th class="pv-num">Prix actuel</th><th class="pv-num">Reco</th>' +
    '<th class="pv-num">Écart</th><th>Status</th><th>Action</th>' +
  '</tr></thead><tbody>';

  items.forEach(it => {
    const statusClass = 'pv-status pv-status-' + it.status;
    const statusLabel = ({
      aligned: '✓ Aligné',
      underpriced: '↑ Sous-prix',
      overpriced: '↓ Sur-prix',
      unset: '— Non fixé'
    })[it.status] || it.status;

    const gapStr = it.gap_kmf >= 0 ? '+' + _fmt(it.gap_kmf) : _fmt(it.gap_kmf);
    const gapClass = it.gap_kmf >= 0 ? 'pv-gap-pos' : 'pv-gap-neg';

    html += '<tr data-product-id="' + it.product_id + '">' +
      '<td>' + it.name + '</td>' +
      '<td>' + it.category + '</td>' +
      '<td class="pv-num">' + _fmt(it.current_price_kmf) + '</td>' +
      '<td class="pv-num"><strong>' + _fmt(it.recommended_price_kmf) + '</strong></td>' +
      '<td class="pv-num ' + gapClass + '">' + gapStr + ' (' + (it.gap_pct >= 0 ? '+' : '') + it.gap_pct + '%)</td>' +
      '<td><span class="' + statusClass + '">' + statusLabel + '</span></td>' +
      '<td><button class="pv-btn pv-btn-secondary" data-act="apply-one" data-product-id="' + it.product_id + '" data-price="' + it.recommended_price_kmf + '" style="padding:4px 10px; font-size:0.78rem;">Appliquer</button></td>' +
    '</tr>';
  });

  html += '</tbody></table>';
  return html;
}

function _renderDrawer() {
  const open = _ps.drawerOpen;
  const isComp = _ps.drawerType === 'component';
  const cat = _ps.drawerCategory || 'sourcing';

  const title = isComp ? 'Ajouter une variable' : 'Ajouter une provision';

  return '<div class="pv-drawer-bg ' + (open ? 'open' : '') + '" data-act="close-drawer"></div>' +
    '<div class="pv-drawer ' + (open ? 'open' : '') + '">' +
      '<div class="pv-drawer-head">' +
        '<span class="pv-drawer-title">' + title + '</span>' +
        '<button class="pv-btn pv-btn-ghost" data-act="close-drawer">✕</button>' +
      '</div>' +
      '<div class="pv-drawer-body">' +
        '<div class="pv-drawer-row">' +
          '<label class="pv-input-label">Clé technique (a-z, _ uniquement)</label>' +
          '<input class="pv-input" data-drawer-field="key" placeholder="ex: marketing_meta_pct" style="width:100%;">' +
        '</div>' +
        '<div class="pv-drawer-row">' +
          '<label class="pv-input-label">Libellé visible</label>' +
          '<input class="pv-input" data-drawer-field="label" placeholder="ex: Marketing Meta Ads" style="width:100%;">' +
        '</div>' +
        '<div class="pv-drawer-row">' +
          '<label class="pv-input-label">Emoji (optionnel)</label>' +
          '<input class="pv-input" data-drawer-field="emoji" placeholder="📣" style="width:100%;">' +
        '</div>' +
        (isComp
          ? '<div class="pv-drawer-row">' +
              '<label class="pv-input-label">Catégorie</label>' +
              '<select class="pv-select" data-drawer-field="category" style="width:100%;">' +
                ['sourcing','transit','douane','hub','distribution','paiement']
                  .map(c => '<option value="' + c + '"' + (cat === c ? ' selected' : '') + '>' + c + '</option>')
                  .join('') +
              '</select>' +
            '</div>' +
            '<div class="pv-drawer-row">' +
              '<label class="pv-input-label">Unité</label>' +
              '<select class="pv-select" data-drawer-field="unit" style="width:100%;">' +
                '<option value="kmf">KMF (montant fixe)</option>' +
                '<option value="pct">% (pourcentage)</option>' +
                '<option value="kmf_per_kg">KMF/kg</option>' +
                '<option value="kmf_per_m3">KMF/m³</option>' +
                '<option value="aed">AED</option>' +
              '</select>' +
            '</div>'
          : '') +
        '<div class="pv-drawer-row">' +
          '<label class="pv-input-label">Valeur ' + (isComp ? 'par défaut' : 'en %') + '</label>' +
          '<input class="pv-input" type="number" step="0.1" data-drawer-field="value" placeholder="ex: 5" style="width:100%;">' +
        '</div>' +
        '<div class="pv-drawer-row">' +
          '<label class="pv-input-label">S\'applique à (applies_to)</label>' +
          '<select class="pv-select" data-drawer-field="applies_to" style="width:100%;">' +
            '<option value="all">Toutes les commandes</option>' +
            '<option value="channel:cash_relais">Cash relais uniquement</option>' +
            '<option value="channel:diaspora">Diaspora uniquement</option>' +
          '</select>' +
        '</div>' +
        '<div class="pv-drawer-row">' +
          '<label class="pv-input-label">Notes (optionnel)</label>' +
          '<input class="pv-input" data-drawer-field="notes" placeholder="Description, contexte..." style="width:100%;">' +
        '</div>' +
      '</div>' +
      '<div class="pv-drawer-foot">' +
        '<button class="pv-btn pv-btn-ghost" data-act="close-drawer">Annuler</button>' +
        '<button class="pv-btn pv-btn-primary" data-act="save-drawer">Créer</button>' +
      '</div>' +
    '</div>';
}

/* ─── EVENTS ──────────────────────────────────────────────────────── */
function _bindEvents(container) {
  container.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;

    if (act === 'toggle-section') {
      const id = t.dataset.sectionId;
      _ps.openSections[id] = !_ps.openSections[id];
      const sec = container.querySelector('[data-section="' + id + '"]');
      if (sec) sec.classList.toggle('collapsed', !_ps.openSections[id]);
      return;
    }

    if (act === 'open-workshop') {
      window.location.hash = '#pricing_workshop';
      return;
    }

    if (act === 'open-strategy') {
      window.location.hash = '#pricing_strategy';
      return;
    }

    if (act === 'set-tab') {
      _ps.activeTab = t.dataset.tab;
      _renderHTML(container);
      return;
    }

    if (act === 'refresh') {
      t.textContent = '⏳ Actualisation...';
      t.disabled = true;
      try {
        await Promise.all([_loadDashboard(), _loadCatalog()]);
        _renderHTML(container);
      } catch (err) {
        alert('Erreur : ' + err.message);
        t.textContent = '🔄 Rafraîchir';
        t.disabled = false;
      }
      return;
    }

    if (act === 'filter-catalog') {
      _ps.catalogFilter = t.dataset.status || 'all';
      // Scroll vers le catalogue
      _renderHTML(container);
      const catSection = container.querySelector('[data-section="catalog"]');
      if (catSection) catSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (act === 'toggle-comp') {
      const row = t.closest('[data-comp-id]');
      if (!row) return;
      const id = row.dataset.compId;
      try {
        await _apiPut('/api/admin/pricing-components/' + id + '/toggle');
        await _loadAll();
        if (_ps.currentReco) await _computeReco();
        _renderHTML(container);
      } catch (err) {
        alert('Erreur toggle : ' + err.message);
      }
      return;
    }

    if (act === 'toggle-prov') {
      const row = t.closest('[data-prov-id]');
      if (!row) return;
      const id = row.dataset.provId;
      try {
        await _apiPut('/api/admin/risk-provisions/' + id + '/toggle');
        await _loadAll();
        if (_ps.currentReco) await _computeReco();
        _renderHTML(container);
      } catch (err) {
        alert('Erreur toggle : ' + err.message);
      }
      return;
    }

    if (act === 'del-comp') {
      const row = t.closest('[data-comp-id]');
      if (!row) return;
      const id = row.dataset.compId;
      if (!confirm('Désactiver ce composant ?\n\nIl restera en BDD mais ne sera plus utilisé dans le calcul.\n\nPour suppression définitive, contacte la BDD directement.')) return;
      try {
        await _apiDel('/api/admin/pricing-components/' + id);
        await _loadAll();
        if (_ps.currentReco) await _computeReco();
        _renderHTML(container);
      } catch (err) {
        alert('Erreur suppression : ' + err.message);
      }
      return;
    }

    if (act === 'del-prov') {
      const row = t.closest('[data-prov-id]');
      if (!row) return;
      const id = row.dataset.provId;
      if (!confirm('Désactiver cette provision ?')) return;
      try {
        await _apiDel('/api/admin/risk-provisions/' + id);
        await _loadAll();
        if (_ps.currentReco) await _computeReco();
        _renderHTML(container);
      } catch (err) {
        alert('Erreur suppression : ' + err.message);
      }
      return;
    }

    if (act === 'add') {
      _ps.drawerOpen = true;
      _ps.drawerType = t.dataset.target;
      _ps.drawerCategory = t.dataset.cat || null;
      _renderHTML(container);
      return;
    }

    if (act === 'close-drawer') {
      _ps.drawerOpen = false;
      _renderHTML(container);
      return;
    }

    if (act === 'save-drawer') {
      const drawer = container.querySelector('.pv-drawer');
      const get = (f) => drawer.querySelector('[data-drawer-field="' + f + '"]')?.value;

      const body = {
        key: (get('key') || '').trim(),
        label: (get('label') || '').trim(),
        emoji: get('emoji') || null,
        applies_to: get('applies_to') || 'all',
        notes: get('notes') || null,
      };

      if (!body.key || !body.label) {
        alert('La clé et le libellé sont requis.');
        return;
      }

      const isComp = _ps.drawerType === 'component';
      const value = parseFloat(get('value'));
      if (isNaN(value)) {
        alert('La valeur doit être un nombre.');
        return;
      }

      try {
        if (isComp) {
          body.category = get('category');
          body.unit = get('unit');
          body.default_value = value;
          await _apiPost('/api/admin/pricing-components', body);
        } else {
          body.rate_pct = value;
          await _apiPost('/api/admin/risk-provisions', body);
        }
        _ps.drawerOpen = false;
        await _loadAll();
        // Recharger dashboard + catalogue car la nouvelle variable change les CDR
        await Promise.all([_loadDashboard(), _loadCatalog()]);
        _renderHTML(container);
      } catch (err) {
        alert('Erreur création : ' + err.message);
      }
      return;
    }

    if (act === 'apply-one') {
      const productId = t.dataset.productId;
      const price = Number(t.dataset.price);
      if (!productId || !price) return;
      if (!confirm('Appliquer ' + _fmt(price) + ' comme nouveau prix de vente sur ce produit ?')) return;
      try {
        await _apiPut('/api/pricing/apply-price/' + productId, { price_kmf: price, source: 'reco' });
        // Recharger dashboard + catalogue : prix changé, KPIs et alertes peuvent évoluer
        await Promise.all([_loadDashboard(), _loadCatalog()]);
        _renderHTML(container);
      } catch (err) {
        alert('Erreur application : ' + err.message);
      }
      return;
    }

    if (act === 'apply-all') {
      if (!_userCanApplyAll()) {
        alert('Réservé aux rôles admin / founder.');
        return;
      }
      const items = _ps.catalog
        .filter(it => it.status !== 'aligned' && it.recommended_price_kmf > 0)
        .map(it => ({ product_id: it.product_id, price_kmf: it.recommended_price_kmf }));
      if (!items.length) {
        alert('Tous les produits sont déjà alignés.');
        return;
      }
      if (!confirm('Appliquer les prix recommandés sur ' + items.length + ' produits ?\n\nCette action est journalisée dans price_history.')) return;
      try {
        const r = await _apiPut('/api/pricing/apply-all', { items, source: 'batch' });
        alert('✓ ' + r.count + ' prix mis à jour.');
        await Promise.all([_loadDashboard(), _loadCatalog()]);
        _renderHTML(container);
      } catch (err) {
        alert('Erreur application en masse : ' + err.message);
      }
      return;
    }
  });

  // Inputs (changement immédiat du state, recalcul manuel)
  container.addEventListener('change', (e) => {
    const t = e.target.closest('[data-input]');
    if (!t) return;
    const f = t.dataset.input;
    const v = t.value;
    if (f === 'category')        _ps.inputCategory = v;
    else if (f === 'prixAed')    _ps.inputPrixAed = parseFloat(v) || 0;
    else if (f === 'dimL')       _ps.inputDimL = parseFloat(v) || 0;
    else if (f === 'dimW')       _ps.inputDimW = parseFloat(v) || 0;
    else if (f === 'dimH')       _ps.inputDimH = parseFloat(v) || 0;
    else if (f === 'poidsKg')    _ps.inputPoidsKg = parseFloat(v) || 0;
    else if (f === 'channel')    _ps.inputChannel = v;
    else if (f === 'catFilter')  { _ps.catalogFilter = v; _renderHTML(container); }
  });
}

/* ─── ENTRY POINT ───────────────────────────────────────────────────── */
CT.views.pricing = async function(container) {
  await _render(container);
};

})();
