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
  inputPrixAchat: 100,        // unifié : valeur dans la devise sélectionnée
  inputCurrency: 'AED',       // 'AED' | 'EUR' | 'USD' | 'KMF'
  inputDimL: 25,
  inputDimW: 20,
  inputDimH: 10,
  inputPoidsKg: 1,
  inputChannel: 'cash_relais',
  inputIsDiaspora: false,

  // Mode du Bloc A (P1) : 'catalog' (sélection produit) ou 'simulation' (saisie libre)
  buildMode: 'catalog',
  selectedProductId: null,

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

    /* ═══ BLOCS A / B / C (Atelier de Construction du Prix) ═══ */
    .pv-bloc {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      margin-bottom: 16px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
      overflow: hidden;
    }
    .pv-bloc-head {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 18px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    .pv-bloc-num {
      display: inline-flex;
      align-items: center; justify-content: center;
      width: 32px; height: 32px;
      border-radius: 8px;
      background: #f59e0b;
      color: #fff;
      font-weight: 800;
      font-size: 1.05rem;
      flex-shrink: 0;
    }
    .pv-bloc-a .pv-bloc-num { background: #3b82f6; }
    .pv-bloc-b .pv-bloc-num { background: #16a34a; }
    .pv-bloc-c .pv-bloc-num { background: #f59e0b; }
    .pv-bloc-title { font-size: 1.1rem; font-weight: 800; margin: 0; color: #1e293b; }
    .pv-bloc-sub { font-size: 0.82rem; color: #64748b; margin-top: 1px; }
    .pv-bloc-body { padding: 16px 18px; }

    /* Bloc A — formulaire build */
    .pv-build-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .pv-build-label {
      display: block;
      font-size: 0.72rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .pv-build-input {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: inherit;
      box-sizing: border-box;
      background: #fff;
      color: #1e293b;
    }
    .pv-build-input:focus { outline: 2px solid #f59e0b; outline-offset: -1px; border-color: #f59e0b; }
    .pv-build-empty {
      padding: 24px 16px;
      text-align: center;
      color: #94a3b8;
      font-style: italic;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px dashed #cbd5e1;
    }

    /* Cards des 4 prix */
    .pv-prices-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-top: 16px;
    }
    .pv-price-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px;
      transition: all 0.15s;
    }
    .pv-price-card.pv-price-primary {
      background: linear-gradient(135deg, #fef3c7, #fffbeb);
      border-color: #f59e0b;
      border-width: 2px;
    }
    .pv-price-label {
      font-size: 0.78rem;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .pv-price-card.pv-price-primary .pv-price-label { color: #92400e; }
    .pv-price-value {
      font-size: 1.5rem;
      font-weight: 800;
      color: #1e293b;
      font-family: ui-monospace, monospace;
      line-height: 1.1;
    }
    .pv-price-card.pv-price-primary .pv-price-value { color: #b45309; font-size: 1.7rem; }
    .pv-price-hint {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 6px;
      font-style: italic;
      line-height: 1.4;
    }

    /* Bloc A — meta sous les prix */
    .pv-build-meta {
      margin-top: 14px;
      padding: 10px 12px;
      background: #f8fafc;
      border-radius: 8px;
      font-size: 0.85rem;
      color: #475569;
      line-height: 1.7;
    }
    .pv-build-meta strong { color: #1e293b; }

    /* Bloc B — décision sourcing */
    .pv-decision-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .pv-decision-card {
      border: 2px solid;
      border-radius: 10px;
      padding: 14px;
      text-align: center;
    }
    .pv-decision-title {
      font-size: 0.72rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .pv-decision-key {
      font-size: 1.3rem;
      font-weight: 800;
      font-family: ui-monospace, monospace;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .pv-decision-label {
      font-size: 0.82rem;
      color: #475569;
      font-style: italic;
    }
    .pv-reason {
      background: #eff6ff;
      border-left: 3px solid #3b82f6;
      padding: 12px 14px;
      border-radius: 6px;
      font-size: 0.92rem;
      color: #1e40af;
      line-height: 1.5;
    }
    .pv-reason strong { color: #1e3a8a; }
    .pv-warnings {
      margin-top: 12px;
      padding: 10px 14px;
      background: #fefce8;
      border-left: 3px solid #facc15;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #854d0e;
    }
    .pv-warnings ul { margin: 4px 0 0; padding-left: 20px; }
    .pv-warnings li { margin-bottom: 2px; }

    /* ═══ Toggle mode Bloc A (catalogue / simulation) ═══ */
    .pv-mode-toggle {
      display: flex; gap: 6px; margin-bottom: 14px;
    }
    .pv-mode-btn {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #cbd5e1;
      background: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.88rem;
      font-weight: 500;
      color: #475569;
      font-family: inherit;
      transition: all 0.15s;
    }
    .pv-mode-btn:hover { background: #f8fafc; border-color: #94a3b8; }
    .pv-mode-btn.active {
      background: #f59e0b;
      color: #fff;
      border-color: #d97706;
      font-weight: 600;
    }

    /* ═══ Phrase de vérité métier ═══ */
    .pv-truth-phrase {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-top: 16px;
      padding: 14px 16px;
      background: linear-gradient(135deg, #fef3c7, #fef9c3);
      border-left: 4px solid #f59e0b;
      border-radius: 6px;
    }
    .pv-truth-icon { font-size: 1.4rem; flex-shrink: 0; }
    .pv-truth-text {
      font-size: 0.94rem;
      line-height: 1.6;
      color: #78350f;
    }
    .pv-truth-text strong {
      color: #b45309;
      font-family: ui-monospace, monospace;
    }

    /* ═══ Qualité des données (P6) ═══ */
    .pv-data-quality {
      margin-top: 14px;
      padding: 12px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }
    .pv-data-quality-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 0.88rem;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pv-data-sources {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 6px;
    }
    .pv-data-sources li {
      font-size: 0.82rem;
      color: #475569;
      padding: 4px 0;
    }
    .pv-data-key {
      font-weight: 600;
      color: #1e293b;
      margin-right: 4px;
    }
    .pv-data-src {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 3px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.2px;
    }
    .pv-data-src.real     { background: #dcfce7; color: #14532d; }
    .pv-data-src.supplier { background: #d1fae5; color: #065f46; }
    .pv-data-src.manual   { background: #dbeafe; color: #1e40af; }
    .pv-data-src.category { background: #fef9c3; color: #854d0e; }
    .pv-data-src.default  { background: #f1f5f9; color: #64748b; }
    .pv-data-src.missing  { background: #fee2e2; color: #b91c1c; }
    .pv-data-warnings {
      margin-top: 10px;
      padding: 8px 12px;
      background: #fefce8;
      border-left: 3px solid #facc15;
      border-radius: 4px;
      font-size: 0.82rem;
      color: #854d0e;
    }
    .pv-data-warnings ul {
      margin: 4px 0 0;
      padding-left: 18px;
    }
    .pv-data-warnings li { margin-bottom: 2px; }

    /* ═══ Compteurs P4 (5 statuts) ═══ */
    .pv-summary-loss     { background: #fee2e2; color: #b91c1c; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
    .pv-summary-fragile  { background: #fef9c3; color: #854d0e; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
    .pv-summary-below    { background: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
    .pv-summary-above    { background: #e0e7ff; color: #4338ca; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
    .pv-summary-unset    { background: #f1f5f9; color: #64748b; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }

    /* ═══ Zone admin (apply-all) ═══ */
    .pv-danger-zone {
      margin: 12px 0;
      border: 2px solid #fca5a5;
      border-radius: 8px;
      background: #fef2f2;
      overflow: hidden;
    }
    .pv-danger-head {
      padding: 10px 14px;
      background: #fee2e2;
      color: #991b1b;
      font-weight: 700;
      font-size: 0.9rem;
      border-bottom: 1px solid #fca5a5;
    }
    .pv-danger-body {
      padding: 12px 14px;
      font-size: 0.85rem;
      color: #7f1d1d;
      line-height: 1.5;
    }
    .pv-danger-body p { margin: 0 0 10px; }
    .pv-btn-danger {
      background: #dc2626;
      color: #fff;
      border-color: #b91c1c;
    }
    .pv-btn-danger:hover { background: #b91c1c; }
    .pv-btn-ghost {
      background: transparent;
      border: none;
      color: #64748b;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 0.8rem;
      font-family: inherit;
    }
    .pv-btn-ghost:hover { color: #1e293b; text-decoration: underline; }
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
  // Conversion devise → AED (le backend /recommend attend prix_aed)
  // Taux de référence depuis la config chargée au démarrage
  const fc = _ps.config?.targets || _ps.config || {};
  const tauxAed = Number(fc.taux_aed_kmf || 138);
  const tauxEur = Number(fc.taux_change_eur_kmf || 492);
  const tauxUsdEur = 0.92;  // approx, à raffiner si besoin

  function toAED(amount, cur) {
    const v = Number(amount) || 0;
    if (!v) return 0;
    if (cur === 'AED') return v;
    if (cur === 'KMF') return v / tauxAed;
    if (cur === 'EUR') return (v * tauxEur) / tauxAed;
    if (cur === 'USD') return (v * tauxUsdEur * tauxEur) / tauxAed;
    return v;
  }

  const volM3 = (_ps.inputDimL * _ps.inputDimW * _ps.inputDimH) / 1_000_000;
  const prixAed = toAED(_ps.inputPrixAchat, _ps.inputCurrency || 'AED');

  const body = {
    product_id: (_ps.buildMode === 'catalog' && _ps.selectedProductId) ? _ps.selectedProductId : null,
    category: _ps.inputCategory,
    prix_aed: prixAed,
    volume_m3: volM3 || 0.005,
    poids_kg: _ps.inputPoidsKg || 0.5,
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
  html += '<h1 class="pv-h1">🧮 Atelier de Construction du Prix</h1>';
  html += '<p class="pv-sub">Construire le prix de chaque produit. Décider quoi sourcer, tester, renforcer ou éviter.</p>';
  html += '<div class="pv-tools">';
  html += '  <button class="pv-btn pv-btn-secondary" data-act="refresh">🔄 Rafraîchir</button>';
  html += '  <button class="pv-btn pv-btn-secondary" data-act="add" data-target="component">⚙️ Variables</button>';
  html += '  <button class="pv-btn pv-btn-secondary" data-act="add" data-target="provision">🛡️ Provisions</button>';
  html += '  <button class="pv-btn pv-btn-primary" data-act="open-workshop" style="margin-left:auto;">🧱 Composition avancée</button>';
  if (window.FEATURE_PRICING_STRATEGY) {
    html += '  <button class="pv-btn pv-btn-primary" data-act="open-strategy">💰 Stratégie de prix</button>';
  }
  html += '</div>';

  // ─── BLOC A : Construire le prix ────────────────────────────────────
  html += _renderBlocA();

  // ─── BLOC B : Décider sourcing ──────────────────────────────────────
  html += _renderBlocB();

  // ─── BLOC C : Catalogue à surveiller ────────────────────────────────
  html += _renderBlocC();

  html += '</div>';
  html += _renderDrawer();

  container.innerHTML = html;
  _bindEvents(container);
}

// ═══════════════════════════════════════════════════════════════════
// BLOC A — Construire le prix
// 2 modes : produit catalogue OU simulation manuelle (test fournisseur)
// ═══════════════════════════════════════════════════════════════════
function _renderBlocA() {
  const reco = _ps.currentReco;
  const mode = _ps.buildMode || 'catalog';  // 'catalog' | 'simulation'

  let html = '<div class="pv-bloc pv-bloc-a">';
  html += '<div class="pv-bloc-head">';
  html += '<span class="pv-bloc-num">A</span>';
  html += '<div><h2 class="pv-bloc-title">Construire le prix</h2>';
  html += '<div class="pv-bloc-sub">Choisir un produit du catalogue ou simuler un produit fournisseur.</div></div>';
  html += '</div>';

  html += '<div class="pv-bloc-body">';

  // ── Toggle mode ──
  html += '<div class="pv-mode-toggle">';
  html += '<button class="pv-mode-btn ' + (mode === 'catalog' ? 'active' : '') + '" data-act="set-build-mode" data-mode="catalog">📦 Produit du catalogue</button>';
  html += '<button class="pv-mode-btn ' + (mode === 'simulation' ? 'active' : '') + '" data-act="set-build-mode" data-mode="simulation">🧪 Simulation / candidat fournisseur</button>';
  html += '</div>';

  // ── Formulaire ──
  html += '<div class="pv-build-grid">';

  if (mode === 'catalog') {
    // Mode catalogue : sélecteur produit + canal seulement (les autres champs sont dérivés du produit)
    html += '<div style="grid-column: span 2;">';
    html += '<label class="pv-build-label">Produit du catalogue *</label>';
    html += '<select class="pv-build-input" data-input="product-select">';
    html += '<option value="">-- Choisir un produit --</option>';
    (_ps.catalog || []).forEach(it => {
      const sel = (_ps.selectedProductId === it.product_id) ? ' selected' : '';
      html += '<option value="' + it.product_id + '"' + sel + '>' +
        _escape(it.name) + ' — ' + _fmt(it.current_price_kmf) +
        '</option>';
    });
    html += '</select>';
    if (!_ps.catalog?.length) {
      html += '<div style="font-size:0.78rem;color:#94a3b8;margin-top:4px;font-style:italic;">Aucun produit dans le catalogue. Utilisez le mode Simulation pour tester.</div>';
    }
    html += '</div>';

    html += '<div>';
    html += '<label class="pv-build-label">Canal</label>';
    html += '<select class="pv-build-input" data-input="channel">';
    html += '<option value="cash_relais"' + (_ps.inputChannel === 'cash_relais' ? ' selected' : '') + '>Cash relais</option>';
    html += '<option value="diaspora"' + (_ps.inputChannel === 'diaspora' ? ' selected' : '') + '>Diaspora</option>';
    html += '</select>';
    html += '</div>';

  } else {
    // Mode simulation : tous les champs requis
    html += '<div>';
    html += '<label class="pv-build-label">Catégorie *</label>';
    html += '<select class="pv-build-input" data-input="category">';
    _ps.categories.forEach(c => {
      const sel = (c.key === _ps.inputCategory) ? ' selected' : '';
      html += '<option value="' + c.key + '"' + sel + '>' + _escape(c.label || c.key) + '</option>';
    });
    html += '</select></div>';

    html += '<div>';
    html += '<label class="pv-build-label">Prix achat *</label>';
    html += '<input type="number" class="pv-build-input" data-input="prix_achat" value="' + _ps.inputPrixAchat + '" min="0" step="0.01">';
    html += '</div>';

    html += '<div>';
    html += '<label class="pv-build-label">Devise</label>';
    html += '<select class="pv-build-input" data-input="currency">';
    ['AED', 'EUR', 'USD', 'KMF'].forEach(cur => {
      html += '<option value="' + cur + '"' + (_ps.inputCurrency === cur ? ' selected' : '') + '>' + cur + '</option>';
    });
    html += '</select></div>';

    html += '<div>';
    html += '<label class="pv-build-label">Poids (kg) *</label>';
    html += '<input type="number" class="pv-build-input" data-input="poids_kg" value="' + _ps.inputPoidsKg + '" min="0" step="0.01">';
    html += '</div>';

    html += '<div>';
    html += '<label class="pv-build-label">Volume L×l×h (cm)</label>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<input type="number" class="pv-build-input" data-input="dim_l" value="' + _ps.inputDimL + '" min="0" placeholder="L" style="width:33%">';
    html += '<input type="number" class="pv-build-input" data-input="dim_w" value="' + _ps.inputDimW + '" min="0" placeholder="l" style="width:33%">';
    html += '<input type="number" class="pv-build-input" data-input="dim_h" value="' + _ps.inputDimH + '" min="0" placeholder="h" style="width:33%">';
    html += '</div></div>';

    html += '<div>';
    html += '<label class="pv-build-label">Canal</label>';
    html += '<select class="pv-build-input" data-input="channel">';
    html += '<option value="cash_relais"' + (_ps.inputChannel === 'cash_relais' ? ' selected' : '') + '>Cash relais</option>';
    html += '<option value="diaspora"' + (_ps.inputChannel === 'diaspora' ? ' selected' : '') + '>Diaspora</option>';
    html += '</select></div>';
  }

  html += '</div>';  // .pv-build-grid

  // ── Bouton + état ──
  const canCompute = (mode === 'catalog' && _ps.selectedProductId) ||
                     (mode === 'simulation' && _ps.inputPrixAchat > 0 && _ps.inputCategory);
  html += '<div style="display:flex;align-items:center;gap:12px;margin-top:12px;">';
  if (!canCompute) {
    html += '<div style="font-size:0.82rem;color:#94a3b8;font-style:italic;flex:1;">';
    html += mode === 'catalog'
      ? '↑ Sélectionnez un produit pour activer le calcul'
      : '↑ Renseignez au moins catégorie + prix achat';
    html += '</div>';
  } else {
    html += '<div style="flex:1;"></div>';
  }
  html += '<button class="pv-btn pv-btn-primary" data-act="compute-reco"' + (canCompute ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"') + '>🧮 Calculer les prix</button>';
  html += '</div>';

  // ── Résultats si reco disponible ──
  if (reco) {
    // Phrase métier (P2)
    html += '<div class="pv-truth-phrase">';
    html += '<div class="pv-truth-icon">💡</div>';
    html += '<div class="pv-truth-text">';
    html += 'Ce produit coûte <strong>' + _fmt(reco.cost_complete_estimated_kmf) + '</strong> tout compris. ';
    html += 'Ne pas vendre sous <strong>' + _fmt(reco.minimum_safe_price_kmf) + '</strong>. ';
    html += 'Prix conseillé : <strong>' + _fmt(reco.recommended_price_kmf) + '</strong>. ';
    html += 'Prix test marché : <strong>' + _fmt(reco.test_price_kmf) + '</strong>.';
    html += '</div></div>';

    // Cards des 4 prix
    html += '<div class="pv-prices-grid">';
    html += _priceCard('💀 Prix de survie', reco.survival_price_kmf, 'Coûts variables uniquement. Sous ce prix, vente à perte immédiate.');
    html += _priceCard('🛡️ Minimum sûr', reco.minimum_safe_price_kmf, 'Couvre coûts variables + risques + part charges fixes.');
    html += _priceCard('🎯 Prix conseillé', reco.recommended_price_kmf, 'Coût complet ÷ (1 - marge cible). Recommandation moteur.', true);
    html += _priceCard('🧪 Prix test marché', reco.test_price_kmf, 'Prix conseillé arrondi pour tester le marché (jamais sous le minimum sûr).');
    html += '</div>';

    // Détail coût + marge + contribution
    html += '<div class="pv-build-meta">';
    html += '<div><strong>Coût de revient complet :</strong> ' + _fmt(reco.cost_complete_estimated_kmf) + '</div>';
    html += '<div><strong>Coût variable :</strong> ' + _fmt(reco.variable_cost_estimated_kmf) +
      ' · <strong>Part charges fixes :</strong> ' + _fmt(reco.fixed_cost_allocation_kmf) + '</div>';
    if (reco.estimated_margin_pct != null) {
      html += '<div><strong>Marge estimée (au prix actuel) :</strong> ' + reco.estimated_margin_pct + '% · ' +
        '<strong>Contribution :</strong> ' + _fmt(reco.estimated_contribution_kmf) + '</div>';
    }
    if (reco.monthly_break_even_orders) {
      html += '<div><strong>Seuil rentabilité :</strong> ' + reco.monthly_break_even_orders + ' commandes/mois</div>';
    }
    html += '</div>';

    // Qualité des données (P6) — sources + warnings
    html += _renderDataQuality(reco);
  } else {
    html += '<div class="pv-build-empty">';
    html += mode === 'catalog'
      ? 'Sélectionnez un produit du catalogue puis cliquez sur "Calculer les prix".'
      : 'Renseignez les paramètres du produit fournisseur puis cliquez sur "Calculer les prix".';
    html += '</div>';
  }

  html += '</div>'; // .pv-bloc-body
  html += '</div>'; // .pv-bloc
  return html;
}

function _priceCard(label, value, hint, primary) {
  const cls = primary ? 'pv-price-card pv-price-primary' : 'pv-price-card';
  return '<div class="' + cls + '">' +
    '<div class="pv-price-label">' + label + '</div>' +
    '<div class="pv-price-value">' + _fmt(value) + '</div>' +
    '<div class="pv-price-hint">' + hint + '</div>' +
  '</div>';
}

// ── Affichage qualité des données (P6) ──
// Indique source + confidence + warnings, conformément à la doctrine §6.
function _renderDataQuality(reco) {
  const warnings = reco.warnings || [];
  const details = reco.details || {};
  // En mode catalogue : on a un produit_id donc cost_kmf vient de la BDD = real
  // En mode simulation : on dépend de prix_aed saisi par l'admin = manual
  const inSimulation = _ps.buildMode === 'simulation';

  // Estimer une confidence globale d'après les warnings
  let confidence = 'high';
  if (warnings.length >= 3) confidence = 'low';
  else if (warnings.length >= 1) confidence = 'medium';

  const confColor = ({
    high:   { bg: '#dcfce7', text: '#14532d', label: '✓ Fiabilité élevée' },
    medium: { bg: '#fef9c3', text: '#854d0e', label: '~ Fiabilité moyenne' },
    low:    { bg: '#fef2f2', text: '#b91c1c', label: '⚠ Fiabilité faible' },
  })[confidence];

  let html = '<div class="pv-data-quality">';
  html += '<div class="pv-data-quality-head">';
  html += '<strong>📋 Qualité des données utilisées</strong>';
  html += '<span style="background:' + confColor.bg + ';color:' + confColor.text + ';padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:700;">' + confColor.label + '</span>';
  html += '</div>';

  html += '<ul class="pv-data-sources">';
  // Prix achat
  html += '<li><span class="pv-data-key">Prix d\'achat :</span> ';
  html += inSimulation ? '<span class="pv-data-src manual">manuel</span>' : '<span class="pv-data-src real">réel (catalogue)</span>';
  html += '</li>';
  // Poids
  html += '<li><span class="pv-data-key">Poids :</span> ';
  html += inSimulation ? '<span class="pv-data-src manual">saisi manuellement</span>' : '<span class="pv-data-src real">issu du catalogue</span>';
  html += '</li>';
  // Volume
  const hasVolume = (_ps.inputDimL > 0 && _ps.inputDimW > 0 && _ps.inputDimH > 0);
  html += '<li><span class="pv-data-key">Volume :</span> ';
  html += hasVolume ? '<span class="pv-data-src manual">dimensions saisies</span>' : '<span class="pv-data-src default">défaut catégorie</span>';
  html += '</li>';
  // Fret / Douane
  html += '<li><span class="pv-data-key">Fret :</span> <span class="pv-data-src category">estimé sur taux moyen</span></li>';
  html += '<li><span class="pv-data-key">Douane :</span> <span class="pv-data-src category">estimée par catégorie douane</span></li>';
  // Charges fixes
  html += '<li><span class="pv-data-key">Charges fixes :</span> <span class="pv-data-src real">issues de finance_config</span></li>';
  html += '</ul>';

  // Warnings explicites
  if (warnings.length) {
    html += '<div class="pv-data-warnings">';
    html += '<strong>⚠️ Notes / hypothèses :</strong>';
    html += '<ul>';
    warnings.forEach(w => { html += '<li>' + _escape(w) + '</li>'; });
    html += '</ul></div>';
  }

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════════════════════════════
// BLOC B — Décider sourcing
// "health_status + market_confidence + sourcing_decision + reason"
// ═══════════════════════════════════════════════════════════════════
function _renderBlocB() {
  const reco = _ps.currentReco;
  let html = '<div class="pv-bloc pv-bloc-b">';
  html += '<div class="pv-bloc-head">';
  html += '<span class="pv-bloc-num">B</span>';
  html += '<div><h2 class="pv-bloc-title">Décider sourcing</h2>';
  html += '<div class="pv-bloc-sub">Le moteur recommande, l\'humain décide.</div></div>';
  html += '</div>';

  html += '<div class="pv-bloc-body">';

  if (!reco) {
    html += '<div class="pv-build-empty">Calculez d\'abord les prix dans le bloc A pour obtenir la décision sourcing.</div>';
    html += '</div></div>';
    return html;
  }

  // ── Triplet de badges (santé / marché / décision) ──
  html += '<div class="pv-decision-grid">';
  html += _decisionCard('🩺 Santé prix', reco.health_status, _healthLabel(reco.health_status), _healthColor(reco.health_status));
  html += _decisionCard('📊 Confiance marché', reco.market_confidence, _marketLabel(reco.market_confidence), _marketColor(reco.market_confidence));
  html += _decisionCard('🎯 Décision sourcing', reco.sourcing_decision, _sourcingLabel(reco.sourcing_decision), _sourcingColor(reco.sourcing_decision));
  html += '</div>';

  // ── Raison + action recommandée en langage humain ──
  if (reco.reason || reco.recommended_action) {
    html += '<div class="pv-reason">';
    if (reco.reason) {
      html += '<div><strong>💡 Raison :</strong> ' + _escape(reco.reason) + '</div>';
    }
    if (reco.recommended_action) {
      html += '<div style="margin-top:6px;"><strong>🎯 Action :</strong> ' + _escape(reco.recommended_action) + '</div>';
    }
    html += '</div>';
  }

  // ── Alertes ──
  if (reco.alerts && reco.alerts.length) {
    html += '<div class="pv-alerts" style="margin-top:12px;background:transparent;border:none;padding:0;">';
    html += '<div class="pv-alerts-head">⚠️ Alertes (' + reco.alerts.length + ')</div>';
    reco.alerts.forEach(a => {
      const sev = a.severity || 'info';
      html += '<div class="pv-alert pv-alert-' + sev + '">';
      html += '<div class="pv-alert-head"><span class="pv-alert-icon">' + (sev === 'critical' ? '🔴' : (sev === 'warning' ? '🟠' : '🔵')) + '</span>';
      html += '<div class="pv-alert-text"><strong>' + _escape(a.title || a.code) + '</strong>';
      if (a.message) html += '<div class="pv-alert-msg">' + _escape(a.message) + '</div>';
      html += '</div></div></div>';
    });
    html += '</div>';
  }

  // ── Warnings ──
  if (reco.warnings && reco.warnings.length) {
    html += '<div class="pv-warnings"><strong>ℹ️ Notes :</strong><ul>';
    reco.warnings.forEach(w => { html += '<li>' + _escape(w) + '</li>'; });
    html += '</ul></div>';
  }

  html += '</div></div>';
  return html;
}

function _decisionCard(title, key, label, color) {
  return '<div class="pv-decision-card" style="border-color:' + color.border + ';background:' + color.bg + ';">' +
    '<div class="pv-decision-title">' + title + '</div>' +
    '<div class="pv-decision-key" style="color:' + color.text + ';">' + (key || '—') + '</div>' +
    '<div class="pv-decision-label">' + label + '</div>' +
  '</div>';
}

function _healthLabel(s) {
  const map = {
    loss: 'Vendu à perte',
    danger: 'Marge dangereusement faible',
    fragile: 'Marge fragile',
    healthy: 'Marge saine',
    strong: 'Marge forte',
    unknown: 'Données insuffisantes',
  };
  return map[s] || s || '—';
}
function _healthColor(s) {
  const map = {
    loss:    { border: '#dc2626', bg: '#fef2f2', text: '#b91c1c' },
    danger:  { border: '#f59e0b', bg: '#fffbeb', text: '#92400e' },
    fragile: { border: '#facc15', bg: '#fefce8', text: '#854d0e' },
    healthy: { border: '#22c55e', bg: '#f0fdf4', text: '#166534' },
    strong:  { border: '#16a34a', bg: '#dcfce7', text: '#14532d' },
    unknown: { border: '#cbd5e1', bg: '#f8fafc', text: '#64748b' },
  };
  return map[s] || map.unknown;
}
function _marketLabel(s) {
  const map = {
    unknown:   'Non testé',
    testing:   'En observation',
    validated: 'Premiers signaux positifs',
    scaling:   'À renforcer',
    rejected:  'À arrêter ou repositionner',
  };
  return map[s] || s || '—';
}
function _marketColor(s) {
  const map = {
    unknown:   { border: '#cbd5e1', bg: '#f8fafc', text: '#64748b' },
    testing:   { border: '#3b82f6', bg: '#eff6ff', text: '#1e40af' },
    validated: { border: '#22c55e', bg: '#f0fdf4', text: '#166534' },
    scaling:   { border: '#16a34a', bg: '#dcfce7', text: '#14532d' },
    rejected:  { border: '#dc2626', bg: '#fef2f2', text: '#b91c1c' },
  };
  return map[s] || map.unknown;
}
function _sourcingLabel(s) {
  const map = {
    PRIORITY:        'Sourcing prioritaire',
    TEST:            'Tester en faible quantité',
    WATCH:           'Surveiller',
    AVOID:           'Éviter',
    LOSS:            'Vendu sous coût',
    RENEGOTIATE:     'Renégocier fournisseur',
    INCREASE_PRICE:  'Augmenter le prix',
  };
  return map[s] || s || '—';
}
function _sourcingColor(s) {
  const map = {
    PRIORITY:       { border: '#16a34a', bg: '#dcfce7', text: '#14532d' },
    TEST:           { border: '#3b82f6', bg: '#eff6ff', text: '#1e40af' },
    WATCH:          { border: '#f59e0b', bg: '#fffbeb', text: '#92400e' },
    AVOID:          { border: '#94a3b8', bg: '#f1f5f9', text: '#475569' },
    LOSS:           { border: '#dc2626', bg: '#fef2f2', text: '#b91c1c' },
    RENEGOTIATE:    { border: '#a855f7', bg: '#faf5ff', text: '#6b21a8' },
    INCREASE_PRICE: { border: '#06b6d4', bg: '#ecfeff', text: '#155e75' },
  };
  return map[s] || { border: '#cbd5e1', bg: '#f8fafc', text: '#64748b' };
}

// ═══════════════════════════════════════════════════════════════════
// BLOC C — Catalogue à surveiller
// Liste enrichie avec health_status + sourcing_decision
// ═══════════════════════════════════════════════════════════════════
function _renderBlocC() {
  let html = '<div class="pv-bloc pv-bloc-c">';
  html += '<div class="pv-bloc-head">';
  html += '<span class="pv-bloc-num">C</span>';
  html += '<div><h2 class="pv-bloc-title">Catalogue à surveiller</h2>';
  html += '<div class="pv-bloc-sub">Tous les produits — santé, décision, action.</div></div>';
  html += '</div>';
  html += '<div class="pv-bloc-body">';
  html += _renderCatalogBody();
  html += '</div></div>';
  return html;
}

// Helper escape pour éviter XSS quand on injecte des données BDD
function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════
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

  const canApplyAll = _userCanApplyAll();

  // ── Calculer un statut précis par item (P4) ──
  // Utilise les champs doctrine du backend, pas une recalcul.
  // Le backend nous donne : current_price_kmf, recommended_price_kmf, health_status
  // On dérive juste un label conforme à la doctrine.
  function _computeBucket(it) {
    const cur = Number(it.current_price_kmf) || 0;
    const reco = Number(it.recommended_price_kmf) || 0;
    if (cur <= 0) return 'unset';
    // Priorité absolue : santé du prix
    if (it.health_status === 'loss') return 'loss';
    if (it.health_status === 'danger' || it.health_status === 'fragile') return 'fragile';
    if (!reco) return 'unknown';
    const gapPct = (cur - reco) / reco * 100;
    if (Math.abs(gapPct) <= 5) return 'aligned';
    if (gapPct < -5) return 'below_reco';   // sous le prix conseillé mais marge OK
    return 'above_reco';                     // au-dessus du conseillé
  }

  // Compter par bucket
  const buckets = { loss: 0, fragile: 0, below_reco: 0, aligned: 0, above_reco: 0, unset: 0, unknown: 0 };
  _ps.catalog.forEach(it => { buckets[_computeBucket(it)]++; });

  let html = '<div class="pv-catalog-tools">';

  // Compteurs P4 (5 statuts précis)
  html += '<div class="pv-catalog-summary">';
  html += '<span class="pv-summary-loss" title="Vendu sous coût complet">🔴 À perte : ' + buckets.loss + '</span>';
  html += '<span class="pv-summary-fragile" title="Marge sous 25%">🟡 Marge fragile : ' + buckets.fragile + '</span>';
  html += '<span class="pv-summary-below" title="Marge OK mais prix < conseillé">↑ Sous conseillé : ' + buckets.below_reco + '</span>';
  html += '<span class="pv-summary-aligned" title="Prix à ±5% du conseillé">✓ Aligné : ' + buckets.aligned + '</span>';
  html += '<span class="pv-summary-above" title="Prix > conseillé +5%">↓ Au-dessus : ' + buckets.above_reco + '</span>';
  if (buckets.unset) html += '<span class="pv-summary-unset" title="Prix non fixé">— Non fixé : ' + buckets.unset + '</span>';
  html += '</div>';

  // Filtre
  html += '<select class="pv-select" data-input="catFilter">';
  html += '<option value="all"' + (_ps.catalogFilter === 'all' ? ' selected' : '') + '>Tous les produits</option>';
  html += '<option value="loss"' + (_ps.catalogFilter === 'loss' ? ' selected' : '') + '>🔴 À perte uniquement</option>';
  html += '<option value="fragile"' + (_ps.catalogFilter === 'fragile' ? ' selected' : '') + '>🟡 Marge fragile uniquement</option>';
  html += '<option value="below_reco"' + (_ps.catalogFilter === 'below_reco' ? ' selected' : '') + '>↑ Sous conseillé uniquement</option>';
  html += '<option value="aligned"' + (_ps.catalogFilter === 'aligned' ? ' selected' : '') + '>✓ Alignés uniquement</option>';
  html += '<option value="above_reco"' + (_ps.catalogFilter === 'above_reco' ? ' selected' : '') + '>↓ Au-dessus uniquement</option>';
  html += '</select>';

  // Apply-all caché par défaut (P5) — sera dans une zone "danger zone" expandable
  if (canApplyAll) {
    html += '<button class="pv-btn pv-btn-ghost" data-act="toggle-apply-all" style="margin-left:auto;font-size:0.78rem;color:#64748b;">⚙️ Outils admin</button>';
  } else {
    html += '<span style="margin-left:auto;font-size:0.78rem; color:#64748b;">⚠ Outils admin réservés admin/founder</span>';
  }
  html += '</div>';

  // Zone "Outils admin" (apply-all) — affichée sur demande seulement, P5
  if (canApplyAll && _ps.showApplyAll) {
    html += '<div class="pv-danger-zone">';
    html += '<div class="pv-danger-head">⚠️ Zone admin — Outils massifs</div>';
    html += '<div class="pv-danger-body">';
    html += '<p>Le bouton ci-dessous applique le prix conseillé à <strong>tous les produits</strong> du catalogue. ';
    html += 'Le pricing recommande, l\'humain décide : utiliser uniquement après revue manuelle des écarts.</p>';
    html += '<button class="pv-btn pv-btn-danger" data-act="apply-all">✨ Tout appliquer (confirmation requise)</button>';
    html += '</div></div>';
  }

  // Filtrage des items
  let items = _ps.catalog.map(it => ({ ...it, _bucket: _computeBucket(it) }));
  if (_ps.catalogFilter && _ps.catalogFilter !== 'all') {
    items = items.filter(it => it._bucket === _ps.catalogFilter);
  }

  if (!items.length) {
    html += '<div class="pv-empty">Aucun produit ne correspond au filtre.</div>';
    return html;
  }

  html += '<table class="pv-table"><thead><tr>' +
    '<th>Produit</th><th>Cat.</th>' +
    '<th>Statut</th>' +
    '<th class="pv-num">Prix actuel</th>' +
    '<th class="pv-num">Min. sûr</th>' +
    '<th class="pv-num">Conseillé</th>' +
    '<th class="pv-num">Test</th>' +
    '<th class="pv-num">Marge</th>' +
    '<th class="pv-num">Contrib.</th>' +
    '<th>Santé</th>' +
    '<th>Décision</th>' +
    '<th>Action</th>' +
  '</tr></thead><tbody>';

  // Mapping bucket → badge
  const bucketBadges = {
    loss:       { label: '🔴 À perte',       bg: '#fee2e2', text: '#b91c1c' },
    fragile:    { label: '🟡 Fragile',       bg: '#fef9c3', text: '#854d0e' },
    below_reco: { label: '↑ Sous conseillé', bg: '#fef3c7', text: '#92400e' },
    aligned:    { label: '✓ Aligné',         bg: '#dcfce7', text: '#166534' },
    above_reco: { label: '↓ Au-dessus',      bg: '#e0e7ff', text: '#4338ca' },
    unset:      { label: '— Non fixé',       bg: '#f1f5f9', text: '#64748b' },
    unknown:    { label: '? Inconnu',        bg: '#f8fafc', text: '#94a3b8' },
  };

  items.forEach(it => {
    const minSafe = it.minimum_safe_price_kmf;
    const reco = it.recommended_price_kmf;
    const testP = it.test_price_kmf;
    const margePct = it.estimated_margin_pct;
    const contrib = it.estimated_contribution_kmf;
    const health = it.health_status;
    const decision = it.sourcing_decision;

    // Badge statut bucket (P4)
    const bucket = bucketBadges[it._bucket] || bucketBadges.unknown;
    const bucketBadge = '<span style="background:' + bucket.bg + ';color:' + bucket.text +
      ';padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;white-space:nowrap;">' +
      bucket.label + '</span>';

    // Badges health/decision
    let healthBadge = '<span style="color:#94a3b8;font-style:italic;">—</span>';
    if (health) {
      const c = _healthColor(health);
      healthBadge = '<span style="background:' + c.bg + ';color:' + c.text +
        ';padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:600;">' +
        _escape(health) + '</span>';
    }
    let decisionBadge = '<span style="color:#94a3b8;font-style:italic;">—</span>';
    if (decision) {
      const c = _sourcingColor(decision);
      decisionBadge = '<span style="background:' + c.bg + ';color:' + c.text +
        ';padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:700;">' +
        _escape(decision) + '</span>';
    }

    html += '<tr data-product-id="' + it.product_id + '">' +
      '<td>' + _escape(it.name) + '</td>' +
      '<td>' + _escape(it.category) + '</td>' +
      '<td>' + bucketBadge + '</td>' +
      '<td class="pv-num">' + _fmt(it.current_price_kmf) + '</td>' +
      '<td class="pv-num">' + (minSafe != null ? _fmt(minSafe) : '—') + '</td>' +
      '<td class="pv-num"><strong>' + _fmt(reco) + '</strong></td>' +
      '<td class="pv-num">' + (testP != null ? _fmt(testP) : '—') + '</td>' +
      '<td class="pv-num">' + (margePct != null ? margePct + '%' : '—') + '</td>' +
      '<td class="pv-num">' + (contrib != null ? _fmt(contrib) : '—') + '</td>' +
      '<td>' + healthBadge + '</td>' +
      '<td>' + decisionBadge + '</td>' +
      '<td><button class="pv-btn pv-btn-secondary" data-act="apply-one" data-product-id="' + it.product_id + '" data-price="' + reco + '" style="padding:4px 10px; font-size:0.78rem;">Appliquer</button></td>' +
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
  // ── Handler change pour les inputs du Bloc A (formulaire build) ──
  container.addEventListener('change', (e) => {
    const t = e.target.closest('[data-input]');
    if (!t) return;
    const f = t.dataset.input;
    if (f === 'product-select') {
      _ps.selectedProductId = t.value || null;
      // Si on choisit un produit, on présélectionne sa catégorie
      const item = (_ps.catalog || []).find(c => c.product_id === _ps.selectedProductId);
      if (item) {
        if (item.category) _ps.inputCategory = item.category;
      }
      _renderHTML(container);
    } else if (f === 'category')  _ps.inputCategory = t.value;
    else if (f === 'prix_achat') _ps.inputPrixAchat = parseFloat(t.value) || 0;
    else if (f === 'currency')   _ps.inputCurrency = t.value || 'AED';
    else if (f === 'poids_kg')   _ps.inputPoidsKg = parseFloat(t.value) || 0;
    else if (f === 'dim_l')      _ps.inputDimL = parseFloat(t.value) || 0;
    else if (f === 'dim_w')      _ps.inputDimW = parseFloat(t.value) || 0;
    else if (f === 'dim_h')      _ps.inputDimH = parseFloat(t.value) || 0;
    else if (f === 'channel') {
      _ps.inputChannel = t.value;
      _ps.inputIsDiaspora = (t.value === 'diaspora');
    }
    else if (f === 'catFilter') {
      _ps.catalogFilter = t.value;
      _renderHTML(container);
    }
  });

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

    // Bloc A : calculer les prix via /api/pricing/recommend
    // Toggle mode du Bloc A (catalog vs simulation)
    if (act === 'set-build-mode') {
      _ps.buildMode = t.dataset.mode || 'catalog';
      // Reset reco quand on change de mode pour ne pas mélanger
      _ps.currentReco = null;
      _renderHTML(container);
      return;
    }

    if (act === 'compute-reco') {
      t.disabled = true;
      const oldText = t.textContent;
      t.textContent = '⏳ Calcul...';
      try {
        await _computeReco();
        _renderHTML(container);
      } catch (err) {
        alert('Erreur de calcul : ' + err.message);
        t.disabled = false;
        t.textContent = oldText;
      }
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

    if (act === 'toggle-apply-all') {
      _ps.showApplyAll = !_ps.showApplyAll;
      _renderHTML(container);
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
      // Confirmation forte (P5) : double étape + saisie texte
      const step1 = confirm(
        '⚠️ ATTENTION — Action massive\n\n' +
        'Vous êtes sur le point d\'appliquer le prix conseillé sur ' + items.length + ' produits.\n' +
        'Cette action sera journalisée dans price_history et visible par tous les admins.\n\n' +
        'Le pricing recommande, l\'humain décide. Êtes-vous sûr d\'avoir revu chaque écart ?'
      );
      if (!step1) return;
      const confirmText = prompt(
        'Pour confirmer, tapez exactement : APPLIQUER ' + items.length
      );
      if (confirmText !== ('APPLIQUER ' + items.length)) {
        alert('Confirmation incorrecte. Action annulée.');
        return;
      }
      try {
        const r = await _apiPut('/api/pricing/apply-all', { items, source: 'batch' });
        alert('✓ ' + r.count + ' prix mis à jour.');
        _ps.showApplyAll = false;
        await Promise.all([_loadDashboard(), _loadCatalog()]);
        _renderHTML(container);
      } catch (err) {
        alert('Erreur application en masse : ' + err.message);
      }
      return;
    }
  });
}

/* ─── ENTRY POINT ───────────────────────────────────────────────────── */
CT.views.pricing = async function(container) {
  await _render(container);
};

})();
