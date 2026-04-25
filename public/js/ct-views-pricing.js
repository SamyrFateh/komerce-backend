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
  // FIX BUG : le rôle vit dans CT.platform.state.role (pas CT.platform.role)
  // cf. ct-app-v7.js ligne 109 : CT.platform.state.role = ...
  const role = (window.CT && CT.platform && CT.platform.state && CT.platform.state.role) || '';
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

    /* ═══ LOT H — Bandeau subject_type ═══ */
    .pv-subject-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      margin-top: 14px;
      background: #f8fafc;
      border-left: 4px solid #94a3b8;
      border-radius: 6px;
    }
    .pv-subject-emoji { font-size: 1.4rem; flex-shrink: 0; }
    .pv-subject-label {
      font-size: 0.92rem;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.2;
    }
    .pv-subject-desc {
      font-size: 0.78rem;
      color: #64748b;
      margin-top: 2px;
    }

    /* ═══ LOT H — Blocs coût (rendu relais / business) ═══ */
    .pv-cost-block {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-top: 14px;
      overflow: hidden;
    }
    .pv-cost-block-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    .pv-cost-step {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px; height: 28px;
      border-radius: 8px;
      background: #3b82f6;
      color: #fff;
      font-weight: 800;
      font-size: 0.92rem;
      flex-shrink: 0;
    }
    .pv-cost-block:nth-of-type(2) .pv-cost-step { background: #16a34a; }
    .pv-cost-block-title {
      font-size: 0.98rem;
      font-weight: 700;
      margin: 0;
      color: #1e293b;
    }
    .pv-cost-block-sub {
      font-size: 0.78rem;
      color: #64748b;
      margin-top: 2px;
    }
    .pv-cost-total {
      margin-left: auto;
      font-size: 1.3rem;
      font-weight: 800;
      font-family: ui-monospace, monospace;
      color: #1e293b;
    }
    .pv-cost-lines {
      padding: 6px 14px;
    }
    .pv-cost-line {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 7px 0;
      border-bottom: 1px dashed #f1f5f9;
      font-size: 0.88rem;
    }
    .pv-cost-line:last-child { border-bottom: none; }
    .pv-cost-line-report {
      background: #f8fafc;
      margin: 0 -14px;
      padding: 8px 14px;
      font-weight: 600;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      font-style: italic;
    }
    .pv-cost-icon {
      text-align: center;
      font-size: 1rem;
    }
    .pv-cost-label {
      color: #475569;
    }
    .pv-cost-value {
      font-family: ui-monospace, monospace;
      font-weight: 600;
      color: #1e293b;
      text-align: right;
    }

    /* ═══ LOT H — Données manquantes ═══ */
    .pv-data-missing {
      margin-top: 8px;
      padding: 8px 12px;
      background: #fef2f2;
      border-left: 3px solid #dc2626;
      border-radius: 4px;
      font-size: 0.82rem;
      color: #991b1b;
    }
    .pv-data-missing strong { color: #7f1d1d; }

    /* ═══ LOT L1 — Kanban 4 colonnes doctrinal ═══ */
    .pv-kanban-wrap { padding-top: 6px; }
    .pv-spinner {
      margin-left: auto;
      font-size: 1.1rem;
      animation: pv-spin 1.4s linear infinite;
    }
    @keyframes pv-spin {
      from { opacity: 0.4; }
      50% { opacity: 1; }
      to { opacity: 0.4; }
    }

    .pv-kanban {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      align-items: start;
      margin-bottom: 14px;
    }
    @media (max-width: 1100px) {
      .pv-kanban { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 700px) {
      .pv-kanban { grid-template-columns: 1fr; }
    }

    .pv-kcol {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    .pv-kcol-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    .pv-kcol-num {
      width: 24px; height: 24px;
      border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 800; font-size: 0.78rem;
      flex-shrink: 0;
    }
    .pv-kcol-title {
      font-size: 0.92rem;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.2;
    }
    .pv-kcol-sub {
      font-size: 0.72rem;
      color: #64748b;
      margin-top: 2px;
    }
    /* Couleurs par colonne */
    .pv-kcol-gray  .pv-kcol-head { background: #f1f5f9; }
    .pv-kcol-gray  .pv-kcol-num { background: #475569; }
    .pv-kcol-blue  .pv-kcol-head { background: #eff6ff; }
    .pv-kcol-blue  .pv-kcol-num { background: #3b82f6; }
    .pv-kcol-blue  .pv-kcol-title { color: #1e3a8a; }
    .pv-kcol-blue  .pv-kcol-sub { color: #2563eb; }
    .pv-kcol-green .pv-kcol-head { background: #ecfdf5; }
    .pv-kcol-green .pv-kcol-num { background: #16a34a; }
    .pv-kcol-green .pv-kcol-title { color: #14532d; }
    .pv-kcol-green .pv-kcol-sub { color: #15803d; }
    .pv-kcol-amber .pv-kcol-head { background: #fffbeb; }
    .pv-kcol-amber .pv-kcol-num { background: #f59e0b; }
    .pv-kcol-amber .pv-kcol-title { color: #78350f; }
    .pv-kcol-amber .pv-kcol-sub { color: #b45309; }

    .pv-kcol-body { padding: 0; }

    /* KPI total en haut de colonne */
    .pv-ktotal {
      padding: 12px;
      text-align: center;
      border-bottom: 1px solid #e2e8f0;
    }
    .pv-ktotal-blue { background: #f8fbfe; }
    .pv-ktotal-green { background: #f2fbf7; }
    .pv-ktotal-decision {
      background: #f0f9ff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      text-align: left;
      padding: 12px;
    }
    .pv-ktotal-label {
      font-size: 0.68rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      font-weight: 600;
    }
    .pv-ktotal-value {
      font-size: 1.3rem;
      font-weight: 800;
      font-family: ui-monospace, monospace;
      color: #1e293b;
      margin-top: 4px;
    }
    .pv-decision-badge {
      color: #fff;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.4px;
      flex-shrink: 0;
    }

    /* Sections accordéons (details/summary) */
    .pv-ksection {
      border-bottom: 1px solid #f1f5f9;
    }
    .pv-ksection:last-child { border-bottom: none; }
    .pv-ksection-head {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 0.82rem;
      font-weight: 600;
      color: #475569;
      list-style: none;
      position: relative;
      user-select: none;
    }
    .pv-ksection-head::-webkit-details-marker { display: none; }
    .pv-ksection-head::after {
      content: '▶';
      position: absolute;
      right: 12px; top: 50%;
      transform: translateY(-50%);
      font-size: 0.65rem;
      color: #94a3b8;
      transition: transform 0.15s;
    }
    .pv-ksection[open] .pv-ksection-head::after { transform: translateY(-50%) rotate(90deg); }
    .pv-ksection-head:hover { background: #f8fafc; color: #1e293b; }
    .pv-ksection-body { padding: 4px 12px 10px; }

    /* Lignes du calcul */
    .pv-kline {
      display: grid;
      grid-template-columns: 22px 1fr auto;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      font-size: 0.82rem;
      border-bottom: 1px dashed #f1f5f9;
    }
    .pv-kline:last-child { border-bottom: none; }
    .pv-kline-icon { text-align: center; font-size: 0.92rem; }
    .pv-kline-label { color: #475569; }
    .pv-kline-val {
      font-family: ui-monospace, monospace;
      font-weight: 600;
      color: #1e293b;
      text-align: right;
      white-space: nowrap;
    }
    .pv-kline-report {
      background: #f8fafc;
      margin: 0 -12px;
      padding: 6px 12px;
      font-style: italic;
      color: #64748b;
    }
    .pv-kline-primary .pv-kline-label { font-weight: 700; color: #1e293b; }
    .pv-kline-primary .pv-kline-val { color: #16a34a; }

    /* Inputs colonne 1 */
    .pv-mode-radio {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid #e2e8f0;
      background: #fafbfc;
    }
    .pv-mode-radio label {
      display: flex; align-items: center; justify-content: center;
      gap: 4px;
      padding: 7px 10px;
      border-radius: 5px;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      background: #fff;
      border: 1px solid #e2e8f0;
      color: #64748b;
      transition: all 0.15s;
    }
    .pv-mode-radio label:hover { border-color: #94a3b8; }
    .pv-mode-radio label.active { background: #16a34a; border-color: #15803d; color: #fff; }
    .pv-mode-radio input { display: none; }

    .pv-klabel {
      display: block;
      font-size: 0.7rem;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin: 8px 0 4px;
    }
    .pv-klabel:first-child { margin-top: 0; }
    .pv-kinput {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      font-size: 0.85rem;
      font-family: inherit;
      background: #fff;
      color: #1e293b;
      box-sizing: border-box;
    }
    .pv-kinput:focus {
      outline: 2px solid #16a34a;
      outline-offset: -1px;
      border-color: #16a34a;
    }
    .pv-kinput-num { font-family: ui-monospace, monospace; }
    .pv-krow { display: flex; gap: 6px; }
    .pv-krow > * { flex: 1; }
    .pv-krow-3 > * { flex: 1; min-width: 0; }
    .pv-kinput-cur { max-width: 65px; flex: 0 0 65px; }
    .pv-khint { font-size: 0.72rem; color: #64748b; margin-top: 4px; }

    .pv-kempty {
      padding: 30px 12px;
      text-align: center;
      color: #94a3b8;
      font-style: italic;
      font-size: 0.82rem;
    }

    .pv-mini-badge {
      background: #f1f5f9;
      color: #475569;
      padding: 1px 7px;
      border-radius: 3px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    /* Lecture doctrinale */
    .pv-doctrinal-read {
      display: flex;
      gap: 12px;
      padding: 12px 14px;
      background: #fef9c3;
      border-left: 4px solid #f59e0b;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #713f12;
      line-height: 1.5;
      margin-top: 12px;
    }
    .pv-doctrinal-icon { font-size: 1.2rem; flex-shrink: 0; }
    .pv-doctrinal-read strong { color: #422006; }
    .pv-mono { font-family: ui-monospace, monospace; }

    /* Action recommandée */
    .pv-action-text {
      margin: 0 0 6px;
      font-size: 0.82rem;
      color: #1e293b;
      font-weight: 500;
      line-height: 1.5;
    }
    .pv-action-reason {
      margin: 0;
      font-size: 0.74rem;
      color: #64748b;
      line-height: 1.4;
    }

    /* ═══ DOCTRINE V3 : SIMULATEUR DE SCÉNARIOS (colonne 4) ═══ */
    .pv-scenario-card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 6px;
      background: #fff;
      cursor: pointer;
      transition: all 0.15s;
    }
    .pv-scenario-card:hover:not(.pv-scenario-disabled) {
      border-color: #cbd5e1;
      background: #f8fafc;
    }
    .pv-scenario-selected {
      border-color: #16a34a !important;
      background: #f0fdf4 !important;
      box-shadow: 0 0 0 1px #16a34a;
    }
    .pv-scenario-disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background: #f1f5f9;
    }
    .pv-scenario-recommended .pv-scenario-label::before {
      content: '★ ';
      color: #f59e0b;
    }
    .pv-scenario-projection {
      border-style: dashed;
    }
    .pv-scenario-head {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .pv-scenario-radio {
      font-size: 1rem;
      color: #16a34a;
      font-weight: 700;
    }
    .pv-scenario-label {
      font-size: 0.82rem;
      font-weight: 600;
      color: #1e293b;
      flex: 1;
      line-height: 1.2;
    }
    .pv-scenario-tag {
      font-size: 0.65rem;
      padding: 1px 6px;
      border-radius: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .pv-tag-rec { background: #fef3c7; color: #92400e; }
    .pv-tag-proj { background: #ddd6fe; color: #5b21b6; }
    .pv-tag-blocked { background: #fee2e2; color: #b91c1c; }
    .pv-scenario-prices {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 2px 0;
    }
    .pv-scenario-price {
      font-family: ui-monospace, monospace;
      font-size: 1rem;
      font-weight: 700;
      color: #1e293b;
    }
    .pv-scenario-margin {
      font-size: 0.74rem;
      font-weight: 600;
    }
    .pv-scenario-desc {
      font-size: 0.72rem;
      color: #64748b;
      line-height: 1.35;
      margin-top: 2px;
    }
    .pv-scenario-explanation {
      margin: 0 0 8px;
      font-size: 0.78rem;
      color: #475569;
      line-height: 1.5;
      font-style: italic;
    }
    .pv-scenario-detail .pv-kline-strong {
      font-weight: 700;
      font-size: 0.95rem;
      color: #1e293b;
    }
    .pv-kline-warning {
      background: #fef2f2;
      border-radius: 4px;
      padding: 4px 6px !important;
      margin: 4px 0;
    }
    .pv-apply-zone {
      margin-top: 10px;
      padding: 8px 0 0;
      border-top: 1px solid #e2e8f0;
    }
    .pv-apply-btn {
      width: 100%;
      padding: 10px 12px;
      background: #16a34a;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s;
    }
    .pv-apply-btn:hover { background: #15803d; }
    .pv-apply-btn:disabled { background: #94a3b8; cursor: not-allowed; }
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
  const mode = _ps.buildMode || 'catalog';
  const isComputing = !!_ps.isComputing;

  let html = '<div class="pv-bloc pv-bloc-a">';
  html += '<div class="pv-bloc-head">';
  html += '<span class="pv-bloc-num">A</span>';
  html += '<div><h2 class="pv-bloc-title">Construire le prix</h2>';
  html += '<div class="pv-bloc-sub">Calcul live · doctrine §2 : objet → coût rendu relais → coût complet → décision</div></div>';
  if (isComputing) {
    html += '<span class="pv-spinner" title="Recalcul en cours">⏳</span>';
  }
  html += '</div>';

  html += '<div class="pv-bloc-body pv-kanban-wrap">';

  // ═══════════════════════════════════════════════════════════════════
  // KANBAN 4 COLONNES DOCTRINAL
  // ═══════════════════════════════════════════════════════════════════
  html += '<div class="pv-kanban">';

  // ─── COLONNE 1 — OBJET ──────────────────────────────────────────────
  html += _kanbanCol(1, 'gray', '🎯 Objet', 'Caractéristiques produit', _renderColObjet(mode));

  // ─── COLONNE 2 — COÛT RENDU RELAIS ─────────────────────────────────
  html += _kanbanCol(2, 'blue', '📦 Coût rendu relais', '9 lignes · landed', _renderColLanded(reco));

  // ─── COLONNE 3 — COÛT COMPLET BUSINESS ──────────────────────────────
  html += _kanbanCol(3, 'green', '💼 Coût complet business', '+ paiement, risques, charges fixes', _renderColBusiness(reco));

  // ─── COLONNE 4 — DÉCISION ───────────────────────────────────────────
  html += _kanbanCol(4, 'amber', '🎯 Décision', 'Prix · marge · sourcing', _renderColDecision(reco));

  html += '</div>'; // .pv-kanban

  // ─── Lecture doctrinale (synthèse en bas) ────────────────────────────
  if (reco) {
    html += '<div class="pv-doctrinal-read">';
    html += '<div class="pv-doctrinal-icon">💡</div>';
    html += '<div>';
    html += '<strong>Lecture doctrinale</strong> ';
    html += '<span>Cet objet coûte <strong class="pv-mono">' + _fmt(reco.landed_relay_cost_kmf) + '</strong> rendu relais. ';
    html += 'Coût complet business : <strong class="pv-mono">' + _fmt(reco.business_complete_cost_kmf || reco.cost_complete_estimated_kmf) + '</strong>. ';
    html += 'Ne pas vendre sous <strong class="pv-mono">' + _fmt(reco.minimum_safe_price_kmf) + '</strong>. ';
    html += 'Conseillé : <strong class="pv-mono">' + _fmt(reco.recommended_price_kmf) + '</strong>.</span>';
    html += '</div></div>';
  }

  html += '</div>'; // .pv-bloc-body
  html += '</div>'; // .pv-bloc
  return html;
}

/* ─── Helper colonne kanban ────────────────────────────────────────── */
function _kanbanCol(num, color, title, sub, body) {
  return '<div class="pv-kcol pv-kcol-' + color + '">' +
    '<div class="pv-kcol-head">' +
      '<span class="pv-kcol-num">' + num + '</span>' +
      '<div><div class="pv-kcol-title">' + title + '</div>' +
      '<div class="pv-kcol-sub">' + sub + '</div></div>' +
    '</div>' +
    '<div class="pv-kcol-body">' + body + '</div>' +
  '</div>';
}

/* ─── Section accordéon (details/summary natifs) ───────────────────── */
function _kSection(id, title, body, openByDefault) {
  const open = openByDefault ? ' open' : '';
  return '<details class="pv-ksection" data-section="' + id + '"' + open + '>' +
    '<summary class="pv-ksection-head">' + title + '</summary>' +
    '<div class="pv-ksection-body">' + body + '</div>' +
  '</details>';
}

/* ═══════════════════════════════════════════════════════════════════════
 * COLONNE 1 — Objet
 * ═══════════════════════════════════════════════════════════════════════ */
function _renderColObjet(mode) {
  let html = '';

  // Sélecteur radio mode (en haut, pas dans une section)
  html += '<div class="pv-mode-radio">';
  html += '<label class="' + (mode === 'catalog' ? 'active' : '') + '">' +
    '<input type="radio" name="pv-mode" value="catalog" ' + (mode === 'catalog' ? 'checked' : '') + ' data-act="set-build-mode" data-mode="catalog">' +
    '📦 Catalogue</label>';
  html += '<label class="' + (mode === 'simulation' ? 'active' : '') + '">' +
    '<input type="radio" name="pv-mode" value="simulation" ' + (mode === 'simulation' ? 'checked' : '') + ' data-act="set-build-mode" data-mode="simulation">' +
    '🧪 Simulation</label>';
  html += '</div>';

  // Section : Identification
  let idBody = '';
  if (mode === 'catalog') {
    idBody += '<label class="pv-klabel">Produit du catalogue</label>';
    idBody += '<select class="pv-kinput" data-input="product-select">';
    idBody += '<option value="">— Choisir —</option>';
    (_ps.catalog || []).forEach(it => {
      const sel = (_ps.selectedProductId === it.product_id) ? ' selected' : '';
      idBody += '<option value="' + it.product_id + '"' + sel + '>' +
        _escape(it.name).slice(0, 40) + ' — ' + _fmt(it.current_price_kmf) + '</option>';
    });
    idBody += '</select>';
    if (!_ps.catalog?.length) {
      idBody += '<div class="pv-khint">Aucun produit chargé.</div>';
    }
  } else {
    // Simulation : catégorie
    idBody += '<label class="pv-klabel">Catégorie</label>';
    idBody += '<select class="pv-kinput" data-input="category">';
    (_ps.categories || []).forEach(c => {
      const sel = (_ps.inputCategory === c.key) ? ' selected' : '';
      idBody += '<option value="' + _escape(c.key) + '"' + sel + '>' + _escape(c.label || c.key) + '</option>';
    });
    idBody += '</select>';
  }
  html += _kSection('id', 'Identification', idBody, true);

  // Section : Caractéristiques (mode simulation seulement)
  if (mode === 'simulation') {
    let charBody = '';
    charBody += '<label class="pv-klabel">Prix achat</label>';
    charBody += '<div class="pv-krow">';
    charBody += '<input type="number" class="pv-kinput pv-kinput-num" data-input="prix_achat" value="' + (_ps.inputPrixAchat || 0) + '" min="0" step="0.01">';
    charBody += '<select class="pv-kinput pv-kinput-cur" data-input="currency">';
    ['AED', 'EUR', 'USD', 'KMF'].forEach(c => {
      charBody += '<option value="' + c + '"' + (_ps.inputCurrency === c ? ' selected' : '') + '>' + c + '</option>';
    });
    charBody += '</select>';
    charBody += '</div>';

    charBody += '<label class="pv-klabel">Poids (kg)</label>';
    charBody += '<input type="number" class="pv-kinput pv-kinput-num" data-input="poids_kg" value="' + (_ps.inputPoidsKg || 0) + '" min="0" step="0.01">';

    charBody += '<label class="pv-klabel">Dimensions (cm) L × l × h</label>';
    charBody += '<div class="pv-krow pv-krow-3">';
    charBody += '<input type="number" class="pv-kinput pv-kinput-num" data-input="dim_l" value="' + (_ps.inputDimL || 0) + '" min="0" step="0.1" placeholder="L">';
    charBody += '<input type="number" class="pv-kinput pv-kinput-num" data-input="dim_w" value="' + (_ps.inputDimW || 0) + '" min="0" step="0.1" placeholder="l">';
    charBody += '<input type="number" class="pv-kinput pv-kinput-num" data-input="dim_h" value="' + (_ps.inputDimH || 0) + '" min="0" step="0.1" placeholder="h">';
    charBody += '</div>';
    const volM3 = ((_ps.inputDimL || 0) * (_ps.inputDimW || 0) * (_ps.inputDimH || 0)) / 1_000_000;
    charBody += '<div class="pv-khint">Volume calculé : <strong>' + volM3.toFixed(4) + ' m³</strong></div>';

    html += _kSection('char', 'Caractéristiques', charBody, true);
  }

  // Section : Contexte (canal + île)
  let ctxBody = '';
  ctxBody += '<label class="pv-klabel">Canal de vente</label>';
  ctxBody += '<select class="pv-kinput" data-input="channel">';
  ctxBody += '<option value="cash_relais"' + (_ps.inputChannel === 'cash_relais' ? ' selected' : '') + '>Cash relais</option>';
  ctxBody += '<option value="diaspora"' + (_ps.inputChannel === 'diaspora' ? ' selected' : '') + '>Diaspora (carte)</option>';
  ctxBody += '</select>';
  html += _kSection('ctx', 'Contexte', ctxBody, false);

  return html;
}

/* ═══════════════════════════════════════════════════════════════════════
 * COLONNE 2 — Coût rendu relais (9 lignes)
 * ═══════════════════════════════════════════════════════════════════════ */
function _renderColLanded(reco) {
  if (!reco) {
    return '<div class="pv-kempty">Renseignez le produit pour voir le calcul.</div>';
  }

  const breakdown = reco.cost_breakdown || { landed_relay: {} };
  const landed = breakdown.landed_relay || {};
  const total = reco.landed_relay_cost_kmf || 0;

  let html = '';

  // KPI total en haut
  html += '<div class="pv-ktotal pv-ktotal-blue">';
  html += '<div class="pv-ktotal-label">Total landed</div>';
  html += '<div class="pv-ktotal-value">' + _fmt(total) + '</div>';
  html += '</div>';

  // Section : 9 lignes
  let linesBody = '';
  const lines = [
    ['🛒', 'Achat fournisseur',     landed.product_purchase],
    ['🔍', 'Sourcing',              landed.sourcing],
    ['🏬', 'Hub Dubai',             landed.hub],
    ['📦', 'Emballage',             landed.packaging],
    ['🚢', 'Fret',                  landed.freight],
    ['🛃', 'Douane',                landed.customs],
    ['📋', 'Port / transitaire',    landed.port_transitary],
    ['🚚', 'Distribution locale',   landed.local_distribution],
    ['🏪', 'Relais',                landed.relay],
  ];
  lines.forEach(([emoji, label, val]) => {
    linesBody += '<div class="pv-kline">';
    linesBody += '<span class="pv-kline-icon">' + emoji + '</span>';
    linesBody += '<span class="pv-kline-label">' + label + '</span>';
    linesBody += '<span class="pv-kline-val">' + (val > 0 ? _fmt(val) : '—') + '</span>';
    linesBody += '</div>';
  });
  html += _kSection('landed-lines', 'Détail (9 lignes)', linesBody, false);

  // Section : Qualité données (intégré ici)
  if (reco.data_quality) {
    html += _kSection('data-quality', 'Qualité données', _renderDataQualityCompact(reco), false);
  }

  return html;
}

/* ═══════════════════════════════════════════════════════════════════════
 * COLONNE 3 — Coût complet business (3 lignes en plus)
 * ═══════════════════════════════════════════════════════════════════════ */
function _renderColBusiness(reco) {
  if (!reco) {
    return '<div class="pv-kempty">En attente du calcul…</div>';
  }
  const breakdown = reco.cost_breakdown || { business: {} };
  const business = breakdown.business || {};
  const landed = reco.landed_relay_cost_kmf || 0;
  const total = reco.business_complete_cost_kmf || reco.cost_complete_estimated_kmf || 0;

  let html = '';

  // KPI total en haut
  html += '<div class="pv-ktotal pv-ktotal-green">';
  html += '<div class="pv-ktotal-label">Total business</div>';
  html += '<div class="pv-ktotal-value">' + _fmt(total) + '</div>';
  html += '</div>';

  // Section : détail
  let detBody = '';
  detBody += '<div class="pv-kline pv-kline-report">';
  detBody += '<span class="pv-kline-icon">═</span>';
  detBody += '<span class="pv-kline-label">Coût rendu relais (report)</span>';
  detBody += '<span class="pv-kline-val">' + _fmt(landed) + '</span>';
  detBody += '</div>';

  const adds = [
    ['💳', 'Frais paiement',     business.payment],
    ['🛡️', 'Provision risques',  business.risk_provision],
    ['🏢', 'Part charges fixes', business.fixed_overhead],
  ];
  adds.forEach(([emoji, label, val]) => {
    detBody += '<div class="pv-kline">';
    detBody += '<span class="pv-kline-icon">' + emoji + '</span>';
    detBody += '<span class="pv-kline-label">' + label + '</span>';
    detBody += '<span class="pv-kline-val">' + (val > 0 ? '+ ' + _fmt(val) : '—') + '</span>';
    detBody += '</div>';
  });
  html += _kSection('business-detail', 'Détail (3 lignes business)', detBody, false);

  // Section : pilotage seuils (charges fixes)
  if (reco.monthly_break_even_orders || reco.target_orders_per_month) {
    let pilotBody = '';
    if (reco.target_orders_per_month) {
      pilotBody += '<div class="pv-kline"><span class="pv-kline-label">Cible mensuelle</span><span class="pv-kline-val">' +
        reco.target_orders_per_month + ' commandes</span></div>';
    }
    if (reco.monthly_break_even_orders) {
      pilotBody += '<div class="pv-kline"><span class="pv-kline-label">Seuil rentabilité</span><span class="pv-kline-val">' +
        reco.monthly_break_even_orders + ' commandes/mois</span></div>';
    }
    if (reco.monthly_fixed_costs_kmf) {
      pilotBody += '<div class="pv-kline"><span class="pv-kline-label">Charges fixes</span><span class="pv-kline-val">' +
        _fmt(reco.monthly_fixed_costs_kmf) + '/mois</span></div>';
    }
    html += _kSection('business-pilot', 'Pilotage charges fixes', pilotBody, false);
  }

  return html;
}

/* ═══════════════════════════════════════════════════════════════════════
 * COLONNE 4 — Décision (4 prix, marge, sourcing)
 * ═══════════════════════════════════════════════════════════════════════ */
function _renderColDecision(reco) {
  if (!reco) {
    return '<div class="pv-kempty">Le moteur affichera ici les scénarios de prix.</div>';
  }

  let html = '';

  // ── SIMULATEUR DE SCÉNARIOS (Doctrine V3 — Levier 1 prioritaire) ──
  const scenarios = reco.scenarios || [];
  const selectedId = _ps.selectedScenarioId || reco.recommended_scenario_id || 'honest_baseline';
  const selected = scenarios.find(s => s.id === selectedId) || scenarios[0];

  // KPI haut : prix du scénario sélectionné
  if (selected) {
    const decisionMap = {
      PRIORITY:        { color: '#3b82f6', label: 'PRIORITY' },
      TEST:            { color: '#16a34a', label: 'TEST' },
      WATCH:           { color: '#f59e0b', label: 'WATCH' },
      AVOID:           { color: '#dc2626', label: 'AVOID' },
      LOSS:            { color: '#7f1d1d', label: 'LOSS' },
      RENEGOTIATE:     { color: '#ea580c', label: 'RENEGOTIATE' },
      INCREASE_PRICE:  { color: '#ea580c', label: 'INCREASE PRICE' },
    };
    const dec = decisionMap[reco.sourcing_decision] || { color: '#94a3b8', label: reco.sourcing_decision || '—' };

    html += '<div class="pv-ktotal pv-ktotal-decision">';
    html += '<div>';
    html += '<div class="pv-ktotal-label">' + _escape(selected.label) + '</div>';
    html += '<div class="pv-ktotal-value">' + _fmt(selected.price_kmf) + '</div>';
    html += '</div>';
    html += '<span class="pv-decision-badge" style="background:' + dec.color + ';">' + dec.label + '</span>';
    html += '</div>';
  }

  // ── Section : Les 5 scénarios cliquables ──
  let scenariosBody = '';
  scenarios.forEach(s => {
    const isSelected = (s.id === selectedId);
    const isRec = s.is_recommended;
    const isProj = s.is_projection;
    const cls = [
      'pv-scenario-card',
      isSelected ? 'pv-scenario-selected' : '',
      !s.selectable ? 'pv-scenario-disabled' : '',
      isRec ? 'pv-scenario-recommended' : '',
      isProj ? 'pv-scenario-projection' : '',
    ].filter(Boolean).join(' ');

    const marginColor = s.margin_pct >= 15 ? '#16a34a'
                     : s.margin_pct >= 5  ? '#f59e0b'
                     : '#dc2626';

    scenariosBody += '<div class="' + cls + '" data-scenario-id="' + _escape(s.id) + '"' +
      (s.selectable ? ' role="button" tabindex="0"' : '') + '>';
    scenariosBody += '<div class="pv-scenario-head">';
    scenariosBody += '<span class="pv-scenario-radio">' + (isSelected ? '●' : '○') + '</span>';
    scenariosBody += '<span class="pv-scenario-label">' + _escape(s.label) + '</span>';
    if (isRec) scenariosBody += '<span class="pv-scenario-tag pv-tag-rec">recommandé</span>';
    if (isProj) scenariosBody += '<span class="pv-scenario-tag pv-tag-proj">projection</span>';
    if (!s.selectable) scenariosBody += '<span class="pv-scenario-tag pv-tag-blocked">⚠️ sous survie</span>';
    scenariosBody += '</div>';
    scenariosBody += '<div class="pv-scenario-prices">';
    scenariosBody += '<span class="pv-scenario-price">' + _fmt(s.price_kmf) + '</span>';
    scenariosBody += '<span class="pv-scenario-margin" style="color:' + marginColor + ';">marge ' + s.margin_pct + '%</span>';
    scenariosBody += '</div>';
    if (s.short_description) {
      scenariosBody += '<div class="pv-scenario-desc">' + _escape(s.short_description) + '</div>';
    }
    scenariosBody += '</div>';
  });
  html += _kSection('scenarios', 'Scénarios d\'imputation', scenariosBody, true);

  // ── Section : Détail du scénario sélectionné ──
  if (selected) {
    let detailBody = '';
    if (selected.explanation) {
      detailBody += '<p class="pv-scenario-explanation">' + _escape(selected.explanation) + '</p>';
    }
    detailBody += '<div class="pv-scenario-detail">';
    detailBody += '<div class="pv-kline"><span class="pv-kline-label">Prix de vente</span>' +
      '<span class="pv-kline-val pv-kline-strong">' + _fmt(selected.price_kmf) + '</span></div>';
    detailBody += '<div class="pv-kline"><span class="pv-kline-label">Coût imputé à l\'article</span>' +
      '<span class="pv-kline-val">' + _fmt(selected.cost_imputed_kmf) + '</span></div>';
    detailBody += '<div class="pv-kline"><span class="pv-kline-label">Marge brute</span>' +
      '<span class="pv-kline-val" style="color:' + (selected.margin_pct >= 15 ? '#16a34a' : '#f59e0b') + ';font-weight:700;">' +
      _fmt(selected.margin_kmf) + ' (' + selected.margin_pct + '%)</span></div>';
    if (selected.sous_couverture_kmf) {
      detailBody += '<div class="pv-kline pv-kline-warning"><span class="pv-kline-label">⚠️ Sous-couverture</span>' +
        '<span class="pv-kline-val" style="color:#dc2626;">−' + _fmt(selected.sous_couverture_kmf) + ' / article</span></div>';
    }
    if (selected.economy_vs_baseline_kmf) {
      detailBody += '<div class="pv-kline"><span class="pv-kline-label">Économie vs baseline</span>' +
        '<span class="pv-kline-val" style="color:#16a34a;">−' + _fmt(selected.economy_vs_baseline_kmf) + '</span></div>';
    }
    detailBody += '</div>';
    html += _kSection('selected_detail', 'Détail du scénario sélectionné', detailBody, false);
  }

  // ── Section : Garde-fous ──
  let safeBody = '';
  safeBody += '<div class="pv-kline"><span class="pv-kline-label">💀 Prix de survie</span>' +
    '<span class="pv-kline-val">' + _fmt(reco.survival_price_kmf) + '</span></div>';
  safeBody += '<div class="pv-kline"><span class="pv-kline-label">🛡️ Minimum sûr</span>' +
    '<span class="pv-kline-val">' + _fmt(reco.minimum_safe_price_kmf) + '</span></div>';
  safeBody += '<p class="pv-action-reason"><em>Aucun scénario ne peut être appliqué sous le prix de survie.</em></p>';
  html += _kSection('safety', 'Garde-fous', safeBody, false);

  // ── Action : Appliquer ──
  if (selected && selected.selectable && _userCanApplyAll() && reco.product_id) {
    html += '<div class="pv-apply-zone">';
    html += '<button class="pv-apply-btn" data-action="apply-scenario" ' +
      'data-product-id="' + _escape(reco.product_id) + '" ' +
      'data-price="' + selected.price_kmf + '" ' +
      'data-scenario-id="' + _escape(selected.id) + '" ' +
      'data-scenario-label="' + _escape(selected.label) + '" ' +
      'data-levier="' + _escape(selected.levier || '') + '" ' +
      'data-survival="' + reco.survival_price_kmf + '"' +
      '>✓ Appliquer ce scénario (' + _fmt(selected.price_kmf) + ')</button>';
    html += '</div>';
  }

  return html;
}

/* ─── Data quality compact (pour la colonne 2) ──────────────────────── */
function _renderDataQualityCompact(reco) {
  const dq = reco.data_quality || {};
  const conf = dq.confidence || 'medium';
  const confMap = {
    high:   { bg: '#dcfce7', color: '#14532d', label: '✓ Élevée' },
    medium: { bg: '#fef9c3', color: '#854d0e', label: '~ Moyenne' },
    low:    { bg: '#fef2f2', color: '#b91c1c', label: '⚠ Faible' },
  };
  const c = confMap[conf];

  let html = '<div style="margin-bottom:8px;">';
  html += '<span style="background:' + c.bg + ';color:' + c.color + ';padding:3px 10px;border-radius:4px;font-size:0.7rem;font-weight:700;">' + c.label + '</span>';
  html += '</div>';

  if (dq.sources) {
    const fieldLabels = {
      purchase_price: 'Prix d\'achat',
      weight: 'Poids',
      volume: 'Volume',
      customs_category: 'Cat. douane',
      fixed_overhead: 'Charges fixes',
      freight: 'Fret',
      customs: 'Douane',
    };
    html += '<div style="font-size:0.78rem;">';
    Object.keys(fieldLabels).forEach(k => {
      const src = dq.sources[k];
      if (!src) return;
      html += '<div class="pv-kline" style="padding:3px 0;"><span class="pv-kline-label">' + fieldLabels[k] + '</span>' +
        '<span class="pv-kline-val" style="font-size:0.72rem;color:#64748b;font-family:inherit;">' + src + '</span></div>';
    });
    html += '</div>';
  }
  if (dq.missing_fields && dq.missing_fields.length) {
    html += '<div style="margin-top:6px;font-size:0.74rem;color:#b91c1c;">';
    html += '⚠ Manquant : ' + dq.missing_fields.join(', ');
    html += '</div>';
  }
  return html;
}


// ── Bandeau du type de sujet d'analyse (catalog / candidate / simulation) ──
function _renderSubjectBanner(subjectType) {
  const map = {
    catalog_product:    { emoji: '📦', label: 'Produit du catalogue', desc: 'Données issues de products.', color: '#16a34a' },
    supplier_candidate: { emoji: '🧪', label: 'Candidat fournisseur', desc: 'En attente de validation admin.', color: '#3b82f6' },
    manual_simulation:  { emoji: '✍️', label: 'Simulation manuelle', desc: 'Test rapide d\'une offre fournisseur.', color: '#f59e0b' },
  };
  const m = map[subjectType] || { emoji: '❔', label: subjectType, desc: '', color: '#94a3b8' };
  return '<div class="pv-subject-banner" style="border-left-color:' + m.color + ';">' +
    '<span class="pv-subject-emoji">' + m.emoji + '</span>' +
    '<div><div class="pv-subject-label">' + m.label + '</div>' +
    '<div class="pv-subject-desc">' + m.desc + '</div></div>' +
  '</div>';
}

// ── Une ligne de coût dans la décomposition ──
function _costLine(emoji, label, value, isReport) {
  const v = Number(value) || 0;
  const cls = isReport ? 'pv-cost-line pv-cost-line-report' : 'pv-cost-line';
  return '<div class="' + cls + '">' +
    '<span class="pv-cost-icon">' + emoji + '</span>' +
    '<span class="pv-cost-label">' + _escape(label) + '</span>' +
    '<span class="pv-cost-value">' + (v > 0 ? _fmt(v) : '—') + '</span>' +
  '</div>';
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
  // LOT G : data_quality vient maintenant du backend (services/pricing-engine.js)
  const dq = reco.data_quality || null;

  // Confidence : préférer celle du backend, fallback sur warnings
  let confidence = dq?.confidence;
  if (!confidence) {
    if (warnings.length >= 3) confidence = 'low';
    else if (warnings.length >= 1) confidence = 'medium';
    else confidence = 'high';
  }

  const confColor = ({
    high:   { bg: '#dcfce7', text: '#14532d', label: '✓ Fiabilité élevée' },
    medium: { bg: '#fef9c3', text: '#854d0e', label: '~ Fiabilité moyenne' },
    low:    { bg: '#fef2f2', text: '#b91c1c', label: '⚠ Fiabilité faible' },
  })[confidence] || { bg: '#f1f5f9', text: '#64748b', label: '? Inconnu' };

  // Mapping des labels de source vers libellés français lisibles
  const sourceLabels = {
    real:     { label: 'réel', class: 'real' },
    manual:   { label: 'manuel', class: 'manual' },
    supplier: { label: 'fournisseur', class: 'supplier' },
    category: { label: 'estimé catégorie', class: 'category' },
    default:  { label: 'défaut système', class: 'default' },
    missing:  { label: 'manquant', class: 'missing' },
  };

  // Mapping des clés data_quality.sources → libellés affichés
  const fieldLabels = {
    purchase_price:   'Prix d\'achat',
    weight:           'Poids',
    volume:           'Volume',
    customs_category: 'Catégorie douane',
    fixed_overhead:   'Charges fixes',
    freight:          'Fret',
    customs:          'Douane',
  };

  let html = '<div class="pv-data-quality">';
  html += '<div class="pv-data-quality-head">';
  html += '<strong>📋 Qualité des données utilisées</strong>';
  html += '<span style="background:' + confColor.bg + ';color:' + confColor.text + ';padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:700;">' + confColor.label + '</span>';
  html += '</div>';

  // Si on a un data_quality structuré du backend, on l'affiche
  if (dq && dq.sources) {
    html += '<ul class="pv-data-sources">';
    Object.keys(fieldLabels).forEach(field => {
      const sourceKey = dq.sources[field];
      if (!sourceKey) return;
      const sourceMeta = sourceLabels[sourceKey] || { label: sourceKey, class: 'default' };
      html += '<li>';
      html += '<span class="pv-data-key">' + fieldLabels[field] + ' :</span> ';
      html += '<span class="pv-data-src ' + sourceMeta.class + '">' + sourceMeta.label + '</span>';
      html += '</li>';
    });
    html += '</ul>';

    // Champs manquants
    if (dq.missing_fields && dq.missing_fields.length) {
      html += '<div class="pv-data-missing">';
      html += '<strong>❌ Données manquantes :</strong> ';
      html += dq.missing_fields.map(f => fieldLabels[f] || f).join(', ');
      html += '</div>';
    }
  } else {
    // Fallback (rare) : data_quality absent du backend
    html += '<div style="font-size:0.82rem;color:#64748b;font-style:italic;">';
    html += 'Données détaillées non disponibles. ';
    html += 'Le backend doit retourner data_quality (LOT G).';
    html += '</div>';
  }

  // Warnings explicites du moteur
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
// LOT L1 : helper debounce pour recalcul live
let _recalcTimer = null;
function _scheduleLiveRecalc(container, delayMs) {
  clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(async () => {
    // En mode catalog sans produit sélectionné, ne rien faire
    if (_ps.buildMode === 'catalog' && !_ps.selectedProductId) return;
    // En simulation, vérifier au moins prix > 0
    if (_ps.buildMode === 'simulation' && (!_ps.inputPrixAchat || _ps.inputPrixAchat <= 0)) return;

    _ps.isComputing = true;
    _renderHTML(container);
    try {
      await _computePrices();
    } catch (err) {
      console.error('[pricing] live recalc error', err);
    } finally {
      _ps.isComputing = false;
      _renderHTML(container);
    }
  }, delayMs || 250);
}

function _bindEvents(container) {
  // ── Handler change/input pour les inputs du Bloc A (formulaire build) ──
  // LOT L1 : recalcul live à chaque changement
  const inputHandler = (e) => {
    const t = e.target.closest('[data-input]');
    if (!t) return;
    const f = t.dataset.input;
    if (f === 'product-select') {
      _ps.selectedProductId = t.value || null;
      const item = (_ps.catalog || []).find(c => c.product_id === _ps.selectedProductId);
      if (item) {
        // ── FIX BUG SÉLECTION : alimenter TOUS les champs de la colonne Objet ──
        // Quand l'utilisateur change de produit, les "cases d'à côté" doivent suivre.
        if (item.category) _ps.inputCategory = item.category;
        if (item.cost_kmf != null) {
          // Le produit en BDD est en KMF. On affiche en KMF (ne pas reconvertir en AED par défaut).
          _ps.inputPrixAchat = Number(item.cost_kmf) || 0;
          _ps.inputCurrency  = 'KMF';
        }
        if (item.weight_kg != null) {
          _ps.inputPoidsKg = Number(item.weight_kg) || 0;
        }
        if (item.volume_m3 != null) {
          // Convertir m³ → cm³ pour les inputs L/W/H si on n'a pas le détail
          // Pour un volume isotrope : côté = (vol_m3 * 1e6)^(1/3) en cm
          // Mais on ne va pas inventer les dimensions ; on laisse à 0 si pas connues
          const vol_cm3 = Number(item.volume_m3) * 1e6;
          if (vol_cm3 > 0 && (!_ps.inputDimL || !_ps.inputDimW || !_ps.inputDimH)) {
            // Approche conservatrice : cube équivalent
            const side = Math.cbrt(vol_cm3);
            _ps.inputDimL = Math.round(side);
            _ps.inputDimW = Math.round(side);
            _ps.inputDimH = Math.round(side);
          }
        }
      }
      _renderHTML(container);
      _scheduleLiveRecalc(container, 100);
      return;
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
      return;
    }
    // Déclencher le recalcul live (sauf si déjà géré ci-dessus)
    _scheduleLiveRecalc(container, 250);
  };
  container.addEventListener('change', inputHandler);
  container.addEventListener('input', inputHandler);

  container.addEventListener('click', async (e) => {
    // ── DOCTRINE V3 : Sélection d'un scénario ──
    const scenarioCard = e.target.closest('.pv-scenario-card');
    if (scenarioCard && !scenarioCard.classList.contains('pv-scenario-disabled')) {
      _ps.selectedScenarioId = scenarioCard.dataset.scenarioId;
      _renderHTML(container);
      return;
    }

    // ── DOCTRINE V3 : Appliquer le scénario sélectionné ──
    const applyBtn = e.target.closest('[data-action="apply-scenario"]');
    if (applyBtn) {
      const productId = applyBtn.dataset.productId;
      const price = Number(applyBtn.dataset.price);
      const scenarioId = applyBtn.dataset.scenarioId;
      const scenarioLabel = applyBtn.dataset.scenarioLabel;
      const levier = applyBtn.dataset.levier || null;
      const survival = Number(applyBtn.dataset.survival);

      if (price < survival) {
        alert('⚠️ Prix sous le seuil de survie. Application bloquée.');
        return;
      }

      const confirmMsg =
        'Appliquer le scénario "' + scenarioLabel + '" au produit ?\n\n' +
        'Prix : ' + price.toLocaleString('fr-FR') + ' KMF' +
        (levier ? '\nLevier : ' + levier : '') +
        '\n\nL\'audit sera enregistré dans price_history.';

      if (!confirm(confirmMsg)) return;

      applyBtn.disabled = true;
      applyBtn.textContent = '⏳ Application en cours...';

      try {
        const res = await fetch('/api/pricing/apply-price/' + encodeURIComponent(productId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            price_kmf: price,
            source: 'scenario',
            scenario_id: scenarioId,
            scenario_label: scenarioLabel,
            levier: levier,
            survival_price_kmf: survival,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'HTTP ' + res.status);
        }
        applyBtn.textContent = '✅ Appliqué !';
        setTimeout(() => {
          // Refresh la vue pour voir le nouveau prix
          _scheduleLiveRecalc(container, 100);
        }, 800);
      } catch (err) {
        alert('Erreur : ' + err.message);
        applyBtn.disabled = false;
        applyBtn.textContent = '✓ Appliquer ce scénario';
      }
      return;
    }

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
      // Feedback visuel + protection double-clic
      const originalText = t.textContent;
      t.disabled = true;
      t.textContent = '⏳ ...';
      try {
        await _apiPut('/api/pricing/apply-price/' + productId, { price_kmf: price, source: 'reco' });
        await Promise.all([_loadDashboard(), _loadCatalog()]);
        _renderHTML(container);
      } catch (err) {
        alert('Erreur application : ' + err.message);
        t.disabled = false;
        t.textContent = originalText;
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
