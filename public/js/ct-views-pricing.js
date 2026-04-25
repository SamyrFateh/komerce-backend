/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-pricing.js — Komerce Control Tower · Pricing Simulator
 *  The crown jewel: full cost chain from Dubai purchase to Comoros retail
 *  3 tabs: Simulateur Unitaire | Pricing en Masse | Configuration
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

/* ─────────────────────────────────────────────────────────────────────────
 *  STATE
 * ───────────────────────────────────────────────────────────────────────── */
const _ps = {
  // ─── Source de vérité : finance_config (ADR-009) ─────────────────────
  // Ces fallbacks ne sont utilisés qu'au tout premier rendu avant que
  // _loadConfig() ait chargé les vraies valeurs depuis la BDD.
  TAUX_AED: 138,
  TAUX_EUR: 492,
  FRET_EUR_M3: 180,
  EMBARK_AED: 3,
  get EMBARK() { return this.EMBARK_AED * this.TAUX_AED; },
  get TAUX_FRET_M3() { return this.FRET_EUR_M3 * this.TAUX_EUR; },

  // NEW (ADR-009) : cible marge globale depuis finance_config
  TARGET_MARGE_PCT: 40,            // % cible globale (était hardcodé 12 avant)
  FRAIS_STRIPE_PCT: 2.5,
  COMMISSION_RELAIS_KMF: 500,
  COMMISSION_AGENT_PCT: 5,
  TRANSITAIRE_PCT: 2,
  TRANSITAIRE_FIXED_KMF: 450,
  PORTUAIRES_KMF: 1200,
  HUB_MONTHLY_AED: 7000,

  // NEW (ADR-009) : catégories chargées depuis customs_categories (BDD)
  // Au premier rendu, on a les fallbacks dans CATS_FALLBACK.
  catsFromDb: null,                // null = pas chargé, sinon objet { key: {...} }

  // Simulator state
  source: 's1',
  marche: 'local',
  activeTab: 'simulateur',
  hubMode: 'b',
  douaneScenario: 'real',

  // Mass pricing state
  products: [],
  pmData: [],
  pmFilter: 'all',
  pmSort: { col: 'name', asc: true },
  pmModified: {},
  prixTerrain: {},

  // Config state
  taxesData: [],
  dimsData: [],

  // Loaded flags
  ratesLoaded: false,
  productsLoaded: false,
  configLoaded: false   // NEW : finance_config + customs_categories chargés
};

/* ─────────────────────────────────────────────────────────────────────────
 *  CONSTANTS — Categories, Scenarios, Mappings
 *
 *  ADR-009: CATS_FALLBACK est utilisé UNIQUEMENT si la BDD est inaccessible
 *  ou avant que _loadConfig() ait répondu. La vraie source est la table
 *  customs_categories (chargée via /api/admin/customs-categories).
 *
 *  Pour modifier un taux/dimension/cible marge : passer par la Control Tower
 *  → Modèle économique → Catégories douanières (à venir Étape 3).
 * ───────────────────────────────────────────────────────────────────────── */
const CATS_FALLBACK = {
  phones:      { label:"📱 Téléphones & accessoires", sub:"Samsung, Itel, Realme milieu de gamme", dims:[17,12,11], douane:10, tva:10, taxeAdd:0, hint:"Téléphones 10% — SH 8517.12", sh:"SH 8517.12" },
  vetements:   { label:"👗 Vêtements, Wax & Dentelles", sub:"Tissus Wax, dentelles, abayas africanisées", dims:[25,22,10], douane:20, tva:10, taxeAdd:2.5, hint:"Textiles 20% + parafiscale 2,5% — SH 61xx/62xx", sh:"SH 61xx/62xx" },
  ceremonie:   { label:"💃 Tenues cérémonie (abayas)", sub:"Tissu + confection · tailles S→XXL", dims:[30,25,11], douane:20, tva:10, taxeAdd:2.5, hint:"Textiles 20% + parafiscale 2,5% — SH 61xx", sh:"SH 61xx" },
  electro:     { label:"🏠 Électroménager compact", sub:"Fer, mixeur, mini-frigo, plaque, sèche-cheveux", dims:[35,30,16], douane:15, tva:10, taxeAdd:0, hint:"Électroménager 15% — SH 84xx/85xx", sh:"SH 84xx/85xx" },
  cosmetiques: { label:"💄 Cosmétiques & Parfums", sub:"Soins peau, parfums importés UAE, re-marqués", dims:[20,15,11], douane:20, tva:10, taxeAdd:1, hint:"Cosmétiques 20% + taxe hygiène 1% — SH 33xx", sh:"SH 33xx" },
  mariage:     { label:"💍 Mariage & Cadeaux de fête", sub:"Vaisselle, décor, bijoux fantaisie", dims:[30,25,12], douane:15, tva:10, taxeAdd:0, hint:"Mariage/Déco 15% — SH 63xx/71xx", sh:"SH 63xx/71xx" },
  enfants:     { label:"🧸 Enfants", sub:"Jouets, vêtements enfants, accessoires scolaires", dims:[25,20,9], douane:10, tva:10, taxeAdd:0, hint:"Jouets 10% (SH 9503)", sh:"SH 9503" },
  materiels:   { label:"🔧 Petits Matériels", sub:"Outillage, quincaillerie, serrures, robinetterie", dims:[30,20,15], douane:15, tva:10, taxeAdd:0, hint:"SH 82xx/73xx — taux 15% douane", sh:"SH 82xx/73xx" },
};

/**
 * Retourne les catégories actuelles, BDD prioritaire, fallback hardcodé.
 * Format compatible CATS_FALLBACK : { key: { label, sub, dims, douane, tva, taxeAdd, hint, sh } }
 *
 * Si _ps.catsFromDb a été chargé depuis /api/admin/customs-categories,
 * on utilise ces valeurs (BDD = source de vérité).
 * Sinon fallback sur CATS_FALLBACK.
 */
function _getCats() {
  if (_ps.catsFromDb && Object.keys(_ps.catsFromDb).length > 0) {
    return _ps.catsFromDb;
  }
  return CATS_FALLBACK;
}

/**
 * Retourne la cible marge pour une catégorie donnée.
 * BDD prioritaire (default_margin_pct dans customs_categories) → fallback global.
 */
function _getMarginTargetForCat(catKey) {
  if (_ps.catsFromDb && _ps.catsFromDb[catKey] && _ps.catsFromDb[catKey].defaultMargin) {
    return _ps.catsFromDb[catKey].defaultMargin / 100;  // décimal
  }
  return _ps.TARGET_MARGE_PCT / 100;  // fallback global depuis finance_config
}

const DOUANE_SCENARIOS = {
  opt:  { label:'Optimiste',  pct: 15, color:'#34d399' },
  real: { label:'Réaliste',   pct: 28, color:'#f59e0b' },
  prud: { label:'Prudent',    pct: 40, color:'#f87171' },
};

const CAT_MAP = {
  electronique: 'phones', telephone: 'phones', phone: 'phones', phones: 'phones', accessoire: 'phones',
  maison: 'electro', electromenager: 'electro', electro: 'electro',
  mariage: 'mariage', fete: 'mariage', decoration: 'mariage',
  mode: 'vetements', beaute: 'cosmetiques', mode_beaute: 'vetements', vetement: 'vetements', vetements: 'vetements', textile: 'vetements',
  enfant: 'enfants', enfants: 'enfants', jouet: 'enfants',
  cosmetique: 'cosmetiques', cosmetiques: 'cosmetiques', parfum: 'cosmetiques',
  ceremonie: 'ceremonie', abaya: 'ceremonie', tenue: 'ceremonie',
  materiel: 'materiels', materiels: 'materiels', outil: 'materiels',
};

const PSYCHO_ENDINGS = {
  phones: [990,1490,1990,2490,2990,3490,3990,4490,4990,5990,6990,7990,8990,9990,11990,13990,14990,17990,19990,24990,29990,34990,39990,49990,59990,69990,79990,99990],
  vetements: [990,1490,1990,2490,2990,3490,3990,4490,4990,5990,6990,7990,8990,9990,12990,14990,17990,19990,24990,29990],
  ceremonie: [4990,5990,6990,7990,8990,9990,11990,13990,14990,17990,19990,24990,29990,34990,39990,49990],
  electro: [1990,2490,2990,3490,3990,4990,5990,6990,7990,8990,9990,11990,14990,19990,24990,29990,39990,49990,59990,79990,99990],
  cosmetiques: [490,690,990,1490,1990,2490,2990,3490,3990,4490,4990,5990,6990,7990,8990,9990],
  mariage: [990,1490,1990,2490,2990,3490,3990,4990,5990,6990,7990,8990,9990,14990,19990,24990],
  enfants: [490,690,990,1490,1990,2490,2990,3490,3990,4490,4990,5990,6990,7990,8990,9990],
  materiels: [990,1490,1990,2490,2990,3490,3990,4990,5990,6990,7990,8990,9990,14990,19990,24990],
};

/* ─────────────────────────────────────────────────────────────────────────
 *  FORMATTERS
 * ───────────────────────────────────────────────────────────────────────── */
const _nf = new Intl.NumberFormat('fr-FR');
function _fmt(n) { return _nf.format(Math.round(n)) + ' KMF'; }
function _fmtE(n) { return new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR' }).format(n / _ps.TAUX_EUR); }
function _fmtN(n) { return (n >= 0 ? '+' : '') + _nf.format(Math.round(n)) + ' KMF'; }
function _pct(part, total) { return total > 0 ? (part / total * 100).toFixed(1) + '%' : '0%'; }

/* ─────────────────────────────────────────────────────────────────────────
 *  HELPERS
 * ───────────────────────────────────────────────────────────────────────── */
function _el(id) { return document.getElementById(id); }
function _$(id, v) { const el = _el(id); if (el) el.textContent = v; }
function _gv(id) { const el = _el(id); return parseFloat(el?.value) || 0; }
function _gi(id) { const el = _el(id); return parseInt(el?.value, 10) || 0; }

function _mapCat(cat) {
  const c = (cat || '').toLowerCase().replace(/[_-]/g, '');
  for (const [k, v] of Object.entries(CAT_MAP)) {
    if (c === k || c.includes(k)) return v;
  }
  return 'phones';
}

function _arrondirPsycho(prix, catKey, enabled) {
  if (!enabled) return Math.round(prix);
  const paliers = PSYCHO_ENDINGS[catKey] || PSYCHO_ENDINGS.phones;
  for (let i = 0; i < paliers.length; i++) {
    if (paliers[i] >= prix) return paliers[i];
  }
  return Math.ceil(prix / 1000) * 1000 - 10;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  API HELPERS
 * ───────────────────────────────────────────────────────────────────────── */
async function _apiGet(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function _apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function _apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/* ─────────────────────────────────────────────────────────────────────────
 *  LOAD CONFIG FROM API (ADR-009)
 *
 *  Charge en parallèle :
 *    1. /api/admin/finance-config       → taux, marge cible, frais
 *    2. /api/admin/customs-categories   → 8 catégories avec leurs taux
 *
 *  En cas d'échec, on garde les fallbacks hardcodés (CATS_FALLBACK + _ps.*).
 *  Le module continue à fonctionner même si la BDD est inaccessible.
 * ───────────────────────────────────────────────────────────────────────── */
async function _loadConfig() {
  // Lancement en parallèle des 2 endpoints
  const [cfgResult, catsResult] = await Promise.allSettled([
    _apiGet('/api/admin/finance-config').catch(e => null),
    _apiGet('/api/admin/customs-categories?active=true').catch(e => null),
  ]);

  // 1. finance_config
  const cfg = cfgResult.status === 'fulfilled' ? cfgResult.value : null;
  if (cfg) {
    if (cfg.taux_change_eur_kmf)            _ps.TAUX_EUR              = Number(cfg.taux_change_eur_kmf);
    if (cfg.taux_aed_kmf)                   _ps.TAUX_AED              = Number(cfg.taux_aed_kmf);
    if (cfg.fret_eur_per_m3)                _ps.FRET_EUR_M3           = Number(cfg.fret_eur_per_m3);
    if (cfg.target_marge_brute_pct)         _ps.TARGET_MARGE_PCT      = Number(cfg.target_marge_brute_pct);
    if (cfg.frais_stripe_pct)               _ps.FRAIS_STRIPE_PCT      = Number(cfg.frais_stripe_pct);
    if (cfg.commission_relais_standard_kmf) _ps.COMMISSION_RELAIS_KMF = Number(cfg.commission_relais_standard_kmf);
    if (cfg.commission_agent_pct)           _ps.COMMISSION_AGENT_PCT  = Number(cfg.commission_agent_pct);
    if (cfg.transitaire_pct)                _ps.TRANSITAIRE_PCT       = Number(cfg.transitaire_pct);
    if (cfg.transitaire_fixed_kmf)          _ps.TRANSITAIRE_FIXED_KMF = Number(cfg.transitaire_fixed_kmf);
    if (cfg.portuaires_kmf)                 _ps.PORTUAIRES_KMF        = Number(cfg.portuaires_kmf);
    if (cfg.hub_monthly_cost_aed)           _ps.HUB_MONTHLY_AED       = Number(cfg.hub_monthly_cost_aed);
    _ps.ratesLoaded = true;
  } else {
    console.warn('[Pricing] /api/admin/finance-config indisponible — fallbacks utilisés');
  }

  // 2. customs_categories
  const cats = catsResult.status === 'fulfilled' ? catsResult.value : null;
  if (Array.isArray(cats) && cats.length > 0) {
    // Convertir en format compatible CATS_FALLBACK : { key: {...} }
    _ps.catsFromDb = {};
    cats.forEach(c => {
      _ps.catsFromDb[c.key] = {
        label:        (c.emoji ? c.emoji + ' ' : '') + (c.label || c.key),
        sub:          c.sub_label || '',
        dims:         [
          Number(c.default_dim_l_cm) || 25,
          Number(c.default_dim_w_cm) || 20,
          Number(c.default_dim_h_cm) || 10
        ],
        douane:       Number(c.douane_pct) || 0,
        tva:          Number(c.tva_pct) || 10,
        taxeAdd:      Number(c.taxe_add_pct) || 0,
        hint:         c.hint || '',
        sh:           c.sh_code || '',
        defaultMargin: Number(c.default_margin_pct) || null,
      };
    });
    console.log('[Pricing] ' + cats.length + ' catégories chargées depuis customs_categories');
  } else {
    console.warn('[Pricing] /api/admin/customs-categories indisponible — fallback CATS_FALLBACK');
  }

  _ps.configLoaded = true;
}

/* ─── BACKWARD COMPAT : ancien nom _loadRates ──────────────────────────── */
async function _loadRates() {
  return _loadConfig();
}

async function _loadProducts() {
  try {
    const data = await _apiGet('/api/products?limit=1000');
    _ps.products = data.products || [];
    _ps.productsLoaded = true;
  } catch (e) {
    console.warn('[Pricing] Products API unavailable', e.message);
    _ps.products = [];
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 *  CSS STYLES (injected once)
 * ───────────────────────────────────────────────────────────────────────── */
function _injectStyles() {
  if (document.getElementById('ct-pricing-styles')) return;
  const style = document.createElement('style');
  style.id = 'ct-pricing-styles';
  style.textContent = `
    /* ── Tab navigation ── */
    .pricing-tabs { display:flex; gap:0; border-bottom:2px solid var(--border, #1e293b); margin-bottom:0; background: var(--bg2, #0f172a); }
    .pricing-tab { padding:12px 24px; font-size:0.85rem; font-weight:700; color:var(--text-muted, #64748b); cursor:pointer; border-bottom:3px solid transparent; transition: all 0.2s; user-select:none; }
    .pricing-tab:hover { color:var(--text, #e2e8f0); background:rgba(255,255,255,0.03); }
    .pricing-tab.active { color:#f59e0b; border-bottom-color:#f59e0b; }
    .pricing-screen { display:none; }
    .pricing-screen.active { display:block; }

    /* ── Pipeline ── */
    .pricing-pipeline { max-width:780px; margin:0 auto; padding:20px 16px; }
    .pricing-step { background:var(--bg2, #0f172a); border:1px solid var(--border, #1e293b); border-radius:12px; margin-bottom:4px; overflow:hidden; }
    .pricing-step-header { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--border, #1e293b); }
    .pricing-step-badge { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.1rem; background:rgba(245,158,11,0.15); flex-shrink:0; }
    .pricing-step-title { font-size:0.88rem; font-weight:700; color:var(--text, #e2e8f0); flex:1; }
    .pricing-step-tag { font-size:0.68rem; padding:4px 10px; border-radius:20px; background:rgba(245,158,11,0.1); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-weight:600; white-space:nowrap; }
    .pricing-step-body { padding:14px 16px; }
    .pricing-step-subtotal { display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:rgba(245,158,11,0.06); border-top:1px solid var(--border, #1e293b); font-size:0.82rem; font-weight:700; }
    .pricing-step-subtotal .stval { font-family:monospace; color:#f59e0b; }

    .pricing-connector { text-align:center; padding:4px 0; font-size:0.75rem; color:var(--text-muted, #475569); }

    /* ── Form fields ── */
    .pf-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .pf-grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
    .pf-group { margin-bottom:10px; }
    .pf-label { display:block; font-size:0.72rem; font-weight:700; color:var(--text-muted, #94a3b8); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px; }
    .pf-input { width:100%; padding:8px 10px; background:var(--bg3, #1e293b); border:1px solid var(--border, #334155); border-radius:8px; color:var(--text, #e2e8f0); font-size:0.85rem; font-family:monospace; outline:none; box-sizing:border-box; }
    .pf-input:focus { border-color:#f59e0b; }
    .pf-hint { font-size:0.68rem; color:var(--text-muted, #64748b); margin-top:3px; }
    .pf-hint.warn { color:#f59e0b; }

    /* ── Source buttons ── */
    .source-btns { display:flex; gap:6px; flex-wrap:wrap; }
    .source-btn { padding:7px 14px; border-radius:8px; border:1px solid var(--border, #334155); background:transparent; color:var(--text-muted, #94a3b8); font-size:0.78rem; font-weight:700; cursor:pointer; transition:all 0.15s; }
    .source-btn.active { background:rgba(245,158,11,0.15); border-color:#f59e0b; color:#f59e0b; }

    /* ── Hub step special ── */
    .pricing-step.hub-step { border-top:3px solid #0891b2; }
    .pricing-step.hub-step .pricing-step-header { background:rgba(8,145,178,0.08); }
    .pricing-step.hub-step .pricing-step-badge { background:#0891b2; color:#fff; }
    .pricing-step.hub-step .pricing-step-title { color:#0891b2; }
    .pricing-step.hub-step .pricing-step-subtotal { background:rgba(8,145,178,0.08); color:#0891b2; }

    /* ── Source hint ── */
    .source-hint-box { padding:8px 12px; background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.15); border-radius:8px; font-size:0.75rem; color:var(--text-muted, #94a3b8); margin-bottom:10px; }

    /* ── Fret display ── */
    .fret-box { text-align:center; padding:10px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.2); border-radius:10px; margin:8px 0; }
    .fret-val { font-size:1.2rem; font-weight:800; color:#60a5fa; font-family:monospace; }
    .fret-sub { font-size:0.68rem; color:var(--text-muted, #64748b); margin-top:4px; }

    /* ── Result section ── */
    .pricing-result { background:var(--bg2, #0f172a); border:2px solid #f59e0b; border-radius:16px; padding:20px; text-align:center; margin-top:8px; }
    .pricing-result .res-label { font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted, #94a3b8); margin-bottom:8px; }
    .pricing-result .price-main { font-size:2.2rem; font-weight:900; color:#f59e0b; font-variant-numeric:tabular-nums; font-family:monospace; }
    .pricing-result .price-secondary { font-size:0.85rem; color:var(--text-muted, #94a3b8); margin-top:4px; }
    .pricing-result .qty-label { font-size:0.75rem; color:var(--text-muted, #64748b); margin-top:4px; }

    /* ── Option A/B comparison ── */
    .options-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:14px 0 0; }
    .option-card { border-radius:10px; padding:12px 14px; }
    .option-card.opt-a { background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); }
    .option-card.opt-b { background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.35); }
    .option-card .opt-title { font-size:0.65rem; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; opacity:0.7; margin-bottom:4px; }
    .option-card .opt-price { font-size:1.3rem; font-weight:900; font-variant-numeric:tabular-nums; font-family:monospace; }
    .option-card.opt-a .opt-price { color:#34d399; }
    .option-card.opt-b .opt-price { color:#fbbf24; }
    .option-card .opt-marge { font-size:0.72rem; opacity:0.8; margin-top:2px; }

    /* ── Verdict panel ── */
    .verdict-panel { margin-top:16px; border-radius:12px; overflow:hidden; }
    .verdict-main { padding:14px 16px; display:flex; align-items:center; gap:12px; }
    .verdict-icon { font-size:1.8rem; flex-shrink:0; }
    .verdict-titre { font-size:1rem; font-weight:800; letter-spacing:-0.3px; }
    .verdict-sous { font-size:0.78rem; opacity:0.85; margin-top:3px; }
    .verdict-prices { display:grid; grid-template-columns:1fr 1fr 1fr; border-top:1px solid rgba(255,255,255,0.1); }
    .verdict-price-item { padding:10px 14px; border-right:1px solid rgba(255,255,255,0.1); }
    .verdict-price-item:last-child { border-right:none; }
    .verdict-price-label { font-size:0.6rem; font-weight:700; letter-spacing:0.8px; text-transform:uppercase; opacity:0.6; margin-bottom:4px; }
    .verdict-price-val { font-size:0.95rem; font-weight:800; font-variant-numeric:tabular-nums; font-family:monospace; }
    .verdict-price-sub { font-size:0.62rem; opacity:0.6; margin-top:2px; }
    .verdict-alertes { border-top:1px solid rgba(255,255,255,0.1); padding:10px 14px; font-size:0.76rem; line-height:1.6; }

    /* ── Detail table ── */
    .detail-toggle { display:block; width:100%; text-align:center; padding:10px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:8px; color:#f59e0b; font-size:0.78rem; font-weight:700; cursor:pointer; margin-top:12px; }
    .detail-table { display:none; margin-top:12px; background:var(--bg2, #0f172a); border:1px solid var(--border, #1e293b); border-radius:10px; overflow:hidden; }
    .detail-table.open { display:block; }
    .detail-section { padding:8px 14px; font-size:0.72rem; font-weight:700; background:rgba(245,158,11,0.06); color:#f59e0b; text-transform:uppercase; letter-spacing:0.5px; }
    .detail-row { display:flex; justify-content:space-between; align-items:center; padding:7px 14px; font-size:0.8rem; border-top:1px solid rgba(255,255,255,0.04); }
    .detail-row .lbl { color:var(--text-muted, #94a3b8); }
    .detail-row .val { font-family:monospace; color:var(--text, #e2e8f0); font-weight:600; }
    .detail-row.total-row { background:rgba(245,158,11,0.1); font-weight:800; }
    .detail-row.total-row .val { color:#f59e0b; font-size:0.9rem; }

    /* ── Hub section ── */
    .hub-section { background:var(--bg2, #0f172a); border:1px solid var(--border, #1e293b); border-radius:12px; margin-top:20px; overflow:hidden; }
    .hub-header { display:flex; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid var(--border, #1e293b); }
    .hub-header h3 { margin:0; font-size:0.95rem; color:var(--text, #e2e8f0); flex:1; }
    .hub-badge-warn { font-size:0.68rem; padding:4px 10px; border-radius:20px; background:rgba(245,158,11,0.1); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); }
    .hub-body { padding:16px; }
    .hub-metrics { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-top:16px; }
    .hub-metric { text-align:center; padding:12px; background:var(--bg3, #1e293b); border-radius:10px; }
    .hub-metric .mval { font-size:1.1rem; font-weight:800; color:var(--text, #e2e8f0); font-family:monospace; margin:4px 0 2px; }
    .hub-metric .msub { font-size:0.68rem; color:var(--text-muted, #64748b); }
    .hub-pnl { margin-top:16px; padding:14px; background:rgba(245,158,11,0.04); border:1px solid rgba(245,158,11,0.15); border-radius:10px; }
    .hub-pnl-title { font-size:0.78rem; font-weight:700; color:#f59e0b; margin-bottom:12px; }
    .hub-pnl-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
    .hub-pnl-item { text-align:center; }
    .hub-pnl-item .pval { font-size:1rem; font-weight:800; color:var(--text, #e2e8f0); font-family:monospace; margin:4px 0 2px; }
    .hub-pnl-item .psub { font-size:0.65rem; color:var(--text-muted, #64748b); }
    .hub-verdict { margin-top:12px; padding:10px 14px; border-radius:8px; font-size:0.78rem; font-weight:700; }

    /* ── Tenues section ── */
    .tenues-section { display:none; }
    .taille-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .taille-row .taille-lbl { width:30px; font-weight:700; font-size:0.78rem; color:var(--text-muted, #94a3b8); }
    .taille-row input { width:60px; }
    .taille-row span:last-child { font-size:0.72rem; color:var(--text-muted, #64748b); }

    /* ── Mass pricing ── */
    .pm-wrap { padding:16px; }
    .pm-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--border, #1e293b); margin-bottom:16px; }
    .pm-filter-group { display:flex; gap:4px; }
    .pm-filter { padding:6px 14px; border-radius:8px; border:1px solid var(--border, #334155); background:transparent; color:var(--text-muted, #94a3b8); font-size:0.78rem; font-weight:600; cursor:pointer; }
    .pm-filter.active-all { background:rgba(148,163,184,0.15); color:var(--text, #e2e8f0); border-color:var(--text-muted, #64748b); }
    .pm-filter.active-ok { background:rgba(52,211,153,0.15); color:#34d399; border-color:rgba(52,211,153,0.4); }
    .pm-filter.active-warn { background:rgba(251,191,36,0.15); color:#fbbf24; border-color:rgba(251,191,36,0.4); }
    .pm-filter.active-err { background:rgba(248,113,113,0.15); color:#f87171; border-color:rgba(248,113,113,0.4); }

    .pm-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; margin-bottom:16px; }
    .pm-kpi { background:var(--bg2, #0f172a); border:1px solid var(--border, #1e293b); border-radius:10px; padding:12px 14px; text-align:center; }
    .pm-kpi-lbl { font-size:0.68rem; font-weight:700; color:var(--text-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; }
    .pm-kpi-val { font-size:1.4rem; font-weight:900; font-variant-numeric:tabular-nums; font-family:monospace; }

    .pm-table-wrap { overflow-x:auto; border:1px solid var(--border, #1e293b); border-radius:10px; }
    .pm-table { width:100%; border-collapse:collapse; font-size:0.8rem; }
    .pm-table th { padding:10px 12px; text-align:left; font-size:0.7rem; font-weight:700; color:var(--text-muted, #94a3b8); text-transform:uppercase; letter-spacing:0.5px; background:var(--bg2, #0f172a); border-bottom:2px solid var(--border, #1e293b); cursor:pointer; white-space:nowrap; user-select:none; }
    .pm-table th:hover { color:#f59e0b; }
    .pm-table td { padding:8px 12px; border-top:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
    .pm-table tr.modified { background:rgba(139,92,246,0.08); }
    .pm-mono { font-family:monospace; font-variant-numeric:tabular-nums; }

    .pm-price-input { width:90px; padding:5px 8px; background:var(--bg3, #1e293b); border:1px solid var(--border, #334155); border-radius:6px; color:var(--text, #e2e8f0); font-size:0.8rem; font-family:monospace; outline:none; }
    .pm-price-input:focus { border-color:#f59e0b; }
    .pm-price-input.changed { border-color:#8b5cf6; background:rgba(139,92,246,0.1); }

    .pm-badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:0.7rem; font-weight:700; white-space:nowrap; }
    .pm-badge-ok { background:rgba(52,211,153,0.15); color:#34d399; }
    .pm-badge-warn { background:rgba(251,191,36,0.15); color:#fbbf24; }
    .pm-badge-err { background:rgba(248,113,113,0.15); color:#f87171; }

    .pm-push-btn { padding:5px 12px; border-radius:6px; border:none; font-size:0.72rem; font-weight:700; cursor:pointer; }
    .pm-push-btn.pending { background:rgba(99,102,241,0.2); color:#a5b4fc; }
    .pm-push-btn.success { background:rgba(52,211,153,0.2); color:#34d399; cursor:default; }
    .pm-push-btn.error { background:rgba(248,113,113,0.2); color:#f87171; }

    .pm-push-bar { display:none; align-items:center; gap:12px; padding:12px 16px; background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.3); border-radius:10px; margin-bottom:16px; flex-wrap:wrap; }
    .pm-push-bar.visible { display:flex; }

    .pm-btn { padding:7px 14px; border-radius:8px; border:none; font-size:0.78rem; font-weight:700; cursor:pointer; white-space:nowrap; }
    .pm-btn-teal { background:#0d9488; color:#fff; }
    .pm-btn-push { background:#8b5cf6; color:#fff; }
    .pm-btn-ghost { background:transparent; border:1px solid var(--border, #334155); color:var(--text-muted, #94a3b8); }

    /* ── Scenario buttons ── */
    .scenario-group { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .scenario-btn { padding:5px 11px; border-radius:6px; font-size:0.75rem; font-weight:700; cursor:pointer; border:1px solid var(--border, #334155); background:transparent; }

    /* ── Config tab ── */
    .config-section { background:var(--bg2, #0f172a); border:1px solid var(--border, #1e293b); border-radius:12px; margin-bottom:16px; overflow:hidden; }
    .config-header { padding:14px 16px; border-bottom:1px solid var(--border, #1e293b); display:flex; align-items:center; gap:10px; }
    .config-header h3 { margin:0; font-size:0.95rem; color:var(--text, #e2e8f0); flex:1; }
    .config-body { padding:16px; }
    .config-save-btn { padding:8px 18px; border-radius:8px; border:none; background:#0d9488; color:#fff; font-size:0.82rem; font-weight:700; cursor:pointer; }
    .config-save-btn:hover { opacity:0.9; }
    .config-status { font-size:0.75rem; margin-left:10px; }

    /* ── Scanner bar ── */
    .scanner-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px 16px; background:var(--bg2, #0f172a); border-bottom:1px solid var(--border, #1e293b); }
    .scanner-bar .scanner-label { font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted, #94a3b8); white-space:nowrap; }
    .scanner-select { padding:7px 12px; background:var(--bg3, #1e293b); border:1px solid var(--border, #334155); border-radius:8px; color:var(--text, #e2e8f0); font-size:0.78rem; outline:none; max-width:400px; }
    .scan-badge { display:none; padding:5px 12px; border-radius:20px; font-size:0.75rem; font-weight:700; white-space:nowrap; }
  `;
  document.head.appendChild(style);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  COMPUTATION ENGINE — computeAll(params)
 *  Pure function: takes params, returns full result object
 * ═══════════════════════════════════════════════════════════════════════════ */
function _computeAll(p) {
  const qte = p.isTenue ? p.qteTenues : (p.qte || 1);
  if (qte === 0) return null;

  const s4Discount = p.s4 ? 0.70 : 1.0;
  let prixAchatKmf;
  if (p.isTenue) {
    prixAchatKmf = (p.tissuAed * p.metrage + p.confAed) * qte * p.tAED * s4Discount;
  } else {
    prixAchatKmf = p.prixAed * p.tAED * qte * s4Discount;
  }

  const agentKmf      = prixAchatKmf * p.agentPct;
  const embKmf        = p.embAed * p.tAED;
  const tDubaiKmf     = p.tDubai || 0;
  const fretTotKmf    = p.fretKmf * qte;
  const couvertKmf    = prixAchatKmf * (p.couverturePct || 0);

  // CIF = achat + fret
  const valCIF = prixAchatKmf + fretTotKmf;

  const transKmf   = valCIF * p.transPct + 450;
  const fPortKmf   = p.fPort || 0;
  const douaneKmf  = valCIF * p.douanePct;
  const tvaKmf     = valCIF * p.tvaPct;
  const taxeAddKmf = valCIF * (p.taxeAddPct || 0);
  const tRelaisKmf = p.tRelais || 0;
  const cRelaisKmf = p.cRelais || 0;

  // Hub per order costs
  const hubCtrl = p.hubCtrl || 0;
  const hubEtiq = p.hubEtiq || 0;
  const hubSms  = p.hubSms  || 0;
  const hubCmdTotal = hubCtrl + hubEtiq + hubSms;

  // Hub fixed monthly cost
  const hubMensuel = ((p.hubLoyer || 0) + (p.hubSalaire || 0)) * p.tAED;
  const hubVolume  = p.hubVolume || 1;
  const hubFixeParCmd = hubMensuel / hubVolume;

  // Subtotal Option B (hub absorbed in margin)
  const subtotalB = prixAchatKmf + agentKmf + embKmf + tDubaiKmf
                  + fretTotKmf + couvertKmf
                  + transKmf + fPortKmf + douaneKmf + tvaKmf + taxeAddKmf
                  + hubCmdTotal
                  + tRelaisKmf + cRelaisKmf;

  const stripeB = p.isDiaspora ? subtotalB * (p.stripePct || 0) : 0;
  const subtotalBstripe = subtotalB + stripeB;
  const totalB = subtotalBstripe / (1 - p.margePct);
  const margeB = totalB - subtotalBstripe;
  const margeNetteB = margeB - hubFixeParCmd;
  const margePctNetteB = totalB > 0 ? (margeNetteB / totalB * 100) : 0;

  // Subtotal Option A (hub in price)
  const subtotalA = subtotalB + hubFixeParCmd;
  const stripeA = p.isDiaspora ? subtotalA * (p.stripePct || 0) : 0;
  const subtotalAstripe = subtotalA + stripeA;
  const totalA = subtotalAstripe / (1 - p.margePct);
  const margeA = totalA - subtotalAstripe;
  const margePctNetteA = totalA > 0 ? (margeA / totalA * 100) : 0;

  // Hub P&L
  const margeParCmd = margeB;
  const revenuMensuel = margeParCmd * hubVolume;
  const solde = revenuMensuel - hubMensuel;
  const equilibre = margeParCmd > 0 ? Math.ceil(hubMensuel / margeParCmd) : 999;

  // Blocs for KPI breakdown
  const blocAchat  = prixAchatKmf + agentKmf + embKmf + tDubaiKmf;
  const blocFret   = fretTotKmf + couvertKmf;
  const blocDouane = transKmf + fPortKmf + douaneKmf + tvaKmf + taxeAddKmf;
  const blocDistrib = tRelaisKmf + cRelaisKmf;

  return {
    qteCalc: qte, prixAchatKmf, agentKmf, embKmf, tDubaiKmf,
    fretTotKmf, couvertKmf, valCIF,
    transKmf, fPortKmf, douaneKmf, tvaKmf, taxeAddKmf,
    tRelaisKmf, cRelaisKmf,
    hubCmdTotal, hubCtrl, hubEtiq, hubSms,
    hubMensuel, hubFixeParCmd,
    subtotalB, stripeB, totalB, margeB, margeNetteB, margePctNetteB,
    subtotalA, stripeA, totalA, margeA, margePctNetteA,
    solde, equilibre, revenuMensuel,
    blocAchat, blocFret, blocDouane, blocDistrib
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  MASS CDR CALCULATION
 * ═══════════════════════════════════════════════════════════════════════════ */
function _calcCDRProduit(product) {
  const catKey = _mapCat(product.category);
  const catData = _getCats()[catKey] || _getCats().phones;
  const prixAed = product.price_aed || 0;
  const qte = 1;
  const agentPct = _ps.pmAgentPct || 0.05;
  const tDubai = _ps.pmTransportDubai || 0;

  // Dimensions
  const l = catData.dims[0], w = catData.dims[1], h = catData.dims[2];
  const volM3 = l * w * h / 1e6;
  const fretKmf = volM3 * _ps.TAUX_FRET_M3;

  const prixAchatKmf = prixAed * _ps.TAUX_AED;
  const agentKmf = prixAchatKmf * agentPct;
  const embKmf = _ps.EMBARK;
  const tDubaiKmf = tDubai;
  const couvertKmf = 0; // Not included in mass calc
  const valCIF = prixAchatKmf + fretKmf;

  // Get douane from scenario
  const scenarioKey = _ps.pmDouaneScenario || 'real';
  const scenario = DOUANE_SCENARIOS[scenarioKey] || DOUANE_SCENARIOS.real;
  const douaneEffPct = scenario.pct / 100;

  const transKmf  = valCIF * 0.04 + 450;
  const fPortKmf  = 1000;
  const douaneKmf = valCIF * douaneEffPct;
  const tRelaisKmf = 500;
  const cRelaisKmf = 500;

  // CDR = sum of all costs
  const cdr = prixAchatKmf + agentKmf + embKmf + tDubaiKmf
            + fretKmf + couvertKmf
            + transKmf + fPortKmf + douaneKmf
            + tRelaisKmf + cRelaisKmf;

  // ADR-009: cible marge depuis customs_categories (par catégorie) ou
  // fallback sur cible globale finance_config.target_marge_brute_pct.
  const targetMargin = _getMarginTargetForCat(catKey);
  const prixMin = cdr;
  const prixMinViable = cdr / 0.90;
  const prixConseilleBrut = cdr / (1 - targetMargin);
  const prixConseille = _arrondirPsycho(prixConseilleBrut, catKey, true);

  const prixActuel = product.price_kmf || 0;
  const margePct = prixActuel > 0 ? ((prixActuel - cdr) / prixActuel * 100) : 0;

  let verdict = 'ok';
  if (prixActuel <= 0 || prixActuel < cdr) verdict = 'err';
  else if (prixActuel < prixMinViable) verdict = 'warn';

  const emoji = catKey === 'phones' ? '📱' : catKey === 'vetements' ? '👗' : catKey === 'ceremonie' ? '💃' :
                catKey === 'electro' ? '🏠' : catKey === 'cosmetiques' ? '💄' : catKey === 'mariage' ? '💍' :
                catKey === 'enfants' ? '🧸' : catKey === 'materiels' ? '🔧' : '📦';

  return {
    id: product.id || product._id,
    name: product.name || product.title || '—',
    emoji,
    catKey,
    prix_aed: prixAed,
    cdr_kmf: Math.round(cdr),
    prix_min: Math.round(prixMin),
    prix_min_viable: Math.round(prixMinViable),
    prix_conseille: prixConseille,
    prix_actuel: prixActuel,
    marge_pct: margePct,
    verdict,
    volM3, fretKmf, agentKmf, douaneKmf
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  HTML RENDERING — Tab 1: Simulateur Unitaire
 * ═══════════════════════════════════════════════════════════════════════════ */
function _renderSimHTML() {
  // Category options
  const catOpts = Object.entries(_getCats()).map(([k, v]) =>
    `<option value="${k}">${v.label}</option>`
  ).join('');

  return `
<!-- ── Scanner bar ─────────────────────────────────────────── -->
<div class="scanner-bar" data-section="scanner">
  <span class="scanner-label">🔍 Scanner produit</span>
  <select class="scanner-select ct-select" data-el="scanner-select">
    <option value="">— Sélectionnez un produit —</option>
  </select>
  <span class="scan-badge" data-el="scan-badge"></span>
</div>

<!-- ── Top config bar ─────────────────────────────────────── -->
<div class="pricing-step-body" style="border-bottom:1px solid var(--border,#1e293b);padding:14px 16px;">
  <div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;">
    <!-- Category -->
    <div>
      <div class="pf-label">Catégorie</div>
      <select class="pf-input" data-el="categorie" style="min-width:220px;">${catOpts}</select>
    </div>
    <!-- Source -->
    <div>
      <div class="pf-label">Source</div>
      <div class="source-btns">
        <button class="source-btn active" data-source="s1">👤 S1 Agent 5%</button>
        <button class="source-btn" data-source="s2">🏭 S2 Grossiste 0%</button>
        <button class="source-btn" data-source="s4">🇨🇳 S4 Importateur CN</button>
      </div>
    </div>
    <!-- Douane scenario -->
    <div>
      <div class="pf-label">Scénario douane</div>
      <div class="scenario-group" data-el="scenario-group">
        <button class="scenario-btn" data-scenario="opt" style="border-color:#34d399;color:#34d399;">Optimiste 15%</button>
        <button class="scenario-btn active" data-scenario="real" style="border-color:#f59e0b;color:#f59e0b;background:rgba(245,158,11,0.12);">Réaliste 28%</button>
        <button class="scenario-btn" data-scenario="prud" style="border-color:#f87171;color:#f87171;">Prudent 40%</button>
      </div>
      <div class="pf-hint" data-el="scenario-label">Scénario actif : Réaliste (28% CIF)</div>
    </div>
    <!-- Marché -->
    <div>
      <div class="pf-label">Marché</div>
      <div class="source-btns">
        <button class="source-btn active" data-marche="local">🏝️ Local</button>
        <button class="source-btn" data-marche="diaspora">🌍 Diaspora</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Pipeline ─────────────────────────────────────────────── -->
<div class="pricing-pipeline">

<!-- ═══ STEP 1: Achat Dubai ═══ -->
<div class="pricing-step">
  <div class="pricing-step-header">
    <div class="pricing-step-badge">🛒</div>
    <div class="pricing-step-title">Étape 1 — Achat Dubai</div>
    <div class="pricing-step-tag" data-el="hint-source">S1 Agent — commission 5%</div>
  </div>
  <div class="pricing-step-body">
    <div class="source-hint-box" data-el="source-hint">S1 Agent : commission 5% + transport Deira → Hub Dubai</div>
    <!-- Normal product fields -->
    <div data-el="bloc-produit">
      <div class="pf-grid">
        <div class="pf-group">
          <label class="pf-label">Prix unitaire (AED)</label>
          <input class="pf-input" type="number" data-field="prix-aed" value="100" min="0" step="1">
        </div>
        <div class="pf-group">
          <label class="pf-label">Quantité</label>
          <input class="pf-input" type="number" data-field="quantite" value="1" min="1" step="1">
        </div>
      </div>
    </div>
    <!-- Tenues section (hidden by default) -->
    <div class="tenues-section" data-el="bloc-tenues">
      <div class="pf-grid">
        <div class="pf-group">
          <label class="pf-label">Prix tissu (AED/m)</label>
          <input class="pf-input" type="number" data-field="tissu-aed" value="15" min="0" step="0.5">
        </div>
        <div class="pf-group">
          <label class="pf-label">Métrage (m)</label>
          <input class="pf-input" type="number" data-field="metrage" value="3.5" min="0" step="0.5">
        </div>
      </div>
      <div class="pf-group">
        <label class="pf-label">Confection (AED/pièce)</label>
        <input class="pf-input" type="number" data-field="confection-aed" value="25" min="0" step="1">
      </div>
      <div class="pf-label" style="margin-top:10px;">Quantités par taille</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div class="pf-group" style="text-align:center;"><div class="pf-label">S</div><input class="pf-input" type="number" data-field="q-s" value="0" min="0" style="width:55px;text-align:center;"></div>
        <div class="pf-group" style="text-align:center;"><div class="pf-label">M</div><input class="pf-input" type="number" data-field="q-m" value="0" min="0" style="width:55px;text-align:center;"></div>
        <div class="pf-group" style="text-align:center;"><div class="pf-label">L</div><input class="pf-input" type="number" data-field="q-l" value="2" min="0" style="width:55px;text-align:center;"></div>
        <div class="pf-group" style="text-align:center;"><div class="pf-label">XL</div><input class="pf-input" type="number" data-field="q-xl" value="2" min="0" style="width:55px;text-align:center;"></div>
        <div class="pf-group" style="text-align:center;"><div class="pf-label">XXL</div><input class="pf-input" type="number" data-field="q-xxl" value="1" min="0" style="width:55px;text-align:center;"></div>
      </div>
    </div>
    <!-- Agent fields (S1 only) -->
    <div data-el="bloc-agent">
      <div class="pf-grid" style="margin-top:10px;">
        <div class="pf-group">
          <label class="pf-label">Commission agent (%)</label>
          <input class="pf-input" type="number" data-field="frais-agent" value="5" min="0" max="25" step="0.5">
        </div>
        <div class="pf-group">
          <label class="pf-label">Transport Dubai (KMF)</label>
          <input class="pf-input" type="number" data-field="transport-dubai" value="0" min="0" step="100">
        </div>
      </div>
    </div>
    <div class="pf-hint">Emballage export : 3 AED = <span data-el="emb-display">414</span> KMF (forfait)</div>
  </div>
  <div class="pricing-step-subtotal">
    <span>Sous-total Achat</span>
    <span class="stval" data-el="subtotal-achat">—</span>
  </div>
</div>

<div class="pricing-connector">▼</div>

<!-- ═══ STEP 2: Hub Dubai ═══ -->
<div class="pricing-step hub-step">
  <div class="pricing-step-header">
    <div class="pricing-step-badge">🏢</div>
    <div class="pricing-step-title">Étape 2 — Hub Dubai</div>
    <div class="pricing-step-tag">par commande</div>
  </div>
  <div class="pricing-step-body">
    <div class="pf-grid-3">
      <div class="pf-group">
        <label class="pf-label">Contrôle conformité (KMF)</label>
        <input class="pf-input" type="number" data-field="hub-controle" value="100" min="0" step="50">
      </div>
      <div class="pf-group">
        <label class="pf-label">Étiquetage QR (KMF)</label>
        <input class="pf-input" type="number" data-field="hub-etiquette" value="50" min="0" step="10">
      </div>
      <div class="pf-group">
        <label class="pf-label">SMS notification (KMF)</label>
        <input class="pf-input" type="number" data-field="hub-sms" value="25" min="0" step="5">
      </div>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border,#334155);">
      <div class="pf-label">Hub P&L — Coûts fixes mensuels</div>
      <div class="pf-grid-3">
        <div class="pf-group">
          <label class="pf-label">Loyer Hub (AED/mois)</label>
          <input class="pf-input" type="number" data-field="hub-loyer" value="1500" min="0" step="100">
        </div>
        <div class="pf-group">
          <label class="pf-label">Salaire (AED/mois)</label>
          <input class="pf-input" type="number" data-field="hub-salaire" value="2000" min="0" step="100">
        </div>
        <div class="pf-group">
          <label class="pf-label">Volume (cmd/mois)</label>
          <input class="pf-input" type="number" data-field="hub-volume" value="80" min="1" step="5">
        </div>
      </div>
    </div>
  </div>
  <div class="pricing-step-subtotal">
    <span>Sous-total Hub</span>
    <span class="stval" data-el="subtotal-hub">—</span>
  </div>
</div>

<div class="pricing-connector">▼</div>

<!-- ═══ STEP 3: Fret Maritime ═══ -->
<div class="pricing-step">
  <div class="pricing-step-header">
    <div class="pricing-step-badge">🚢</div>
    <div class="pricing-step-title">Étape 3 — Fret Maritime</div>
    <div class="pricing-step-tag" data-el="hint-dims">—</div>
  </div>
  <div class="pricing-step-body">
    <div class="pf-grid-3">
      <div class="pf-group">
        <label class="pf-label">Longueur (cm)</label>
        <input class="pf-input" type="number" data-field="dim-l" value="17" min="1" step="1">
      </div>
      <div class="pf-group">
        <label class="pf-label">Largeur (cm)</label>
        <input class="pf-input" type="number" data-field="dim-w" value="12" min="1" step="1">
      </div>
      <div class="pf-group">
        <label class="pf-label">Hauteur (cm)</label>
        <input class="pf-input" type="number" data-field="dim-h" value="11" min="1" step="1">
      </div>
    </div>
    <div class="fret-box">
      <div class="fret-val" data-el="fret-display">—</div>
      <div class="fret-sub" data-el="fret-sub">—</div>
    </div>
    <input type="hidden" data-field="fret-kmf" value="0">
    <div class="pf-group">
      <label class="pf-label">Couverture maritime (%)</label>
      <input class="pf-input" type="number" data-field="couverture-maritime-pct" value="0" min="0" max="10" step="0.5">
    </div>
  </div>
  <div class="pricing-step-subtotal">
    <span>Sous-total Fret</span>
    <span class="stval" data-el="subtotal-fret">—</span>
  </div>
</div>

<div class="pricing-connector">▼</div>

<!-- ═══ STEP 4: Dédouanement ═══ -->
<div class="pricing-step">
  <div class="pricing-step-header">
    <div class="pricing-step-badge">🏛️</div>
    <div class="pricing-step-title">Étape 4 — Dédouanement</div>
    <div class="pricing-step-tag" data-el="hint-douane">Téléphones 10%</div>
  </div>
  <div class="pricing-step-body">
    <div class="pf-grid">
      <div class="pf-group">
        <label class="pf-label">Transitaire (% CIF)</label>
        <input class="pf-input" type="number" data-field="trans-pct" value="4" min="0" max="15" step="0.5">
        <div class="pf-hint">+ forfait déclaration 450 KMF</div>
      </div>
      <div class="pf-group">
        <label class="pf-label">Droits de douane (% CIF)</label>
        <input class="pf-input" type="number" data-field="douane-pct" value="10" min="0" max="40" step="0.5">
      </div>
    </div>
    <div class="pf-grid">
      <div class="pf-group">
        <label class="pf-label">TVA (% CIF)</label>
        <input class="pf-input" type="number" data-field="tva-pct" value="10" min="0" max="20" step="0.5">
      </div>
      <div class="pf-group">
        <label class="pf-label">Taxe additionnelle (% CIF)</label>
        <input class="pf-input" type="number" data-field="taxe-add-pct" value="0" min="0" max="10" step="0.5">
        <div class="pf-hint" data-el="hint-taxe">0% pour cette catégorie</div>
      </div>
    </div>
    <div class="pf-group">
      <label class="pf-label">Frais portuaires (KMF)</label>
      <input class="pf-input" type="number" data-field="frais-port" value="1000" min="0" step="100">
    </div>
  </div>
  <div class="pricing-step-subtotal">
    <span>Sous-total Douane</span>
    <span class="stval" data-el="subtotal-douane">—</span>
  </div>
</div>

<div class="pricing-connector">▼</div>

<!-- ═══ STEP 5: Distribution ═══ -->
<div class="pricing-step">
  <div class="pricing-step-header">
    <div class="pricing-step-badge">🏝️</div>
    <div class="pricing-step-title">Étape 5 — Distribution</div>
  </div>
  <div class="pricing-step-body">
    <div class="pf-grid">
      <div class="pf-group">
        <label class="pf-label">Transport relais (KMF)</label>
        <input class="pf-input" type="number" data-field="transport-relais" value="500" min="0" step="50">
      </div>
      <div class="pf-group">
        <label class="pf-label">Commission relais (KMF)</label>
        <input class="pf-input" type="number" data-field="commission-relais" value="500" min="0" step="50">
      </div>
    </div>
    <div class="pf-group" data-el="row-stripe" style="display:none;">
      <label class="pf-label">Stripe (% diaspora)</label>
      <input class="pf-input" type="number" data-field="stripe-pct" value="3.5" min="0" max="10" step="0.1">
    </div>
    <div class="pf-group">
      <label class="pf-label">Marge cible (%)</label>
      <input class="pf-input" type="number" data-field="marge-pct" value="12" min="0" max="50" step="1">
    </div>
  </div>
  <div class="pricing-step-subtotal">
    <span>Sous-total Distribution</span>
    <span class="stval" data-el="subtotal-distrib">—</span>
  </div>
</div>

<!-- ═══ RESULT SECTION ═══ -->
<div class="pricing-result" data-section="result">
  <div class="res-label">Prix de vente final — Option B (Hub absorbé)</div>
  <div class="price-main" data-el="price-main">—</div>
  <div class="price-secondary" data-el="price-secondary"></div>
  <div class="qty-label" data-el="qty-label"></div>
</div>

<!-- ═══ OPTIONS A/B ═══ -->
<div class="options-grid">
  <div class="option-card opt-a" data-action="set-hub-a">
    <div class="opt-title">Option A — Hub répercuté dans le prix</div>
    <div class="opt-price" data-el="badge-a-price">—</div>
    <div class="opt-marge" data-el="badge-a-marge">—</div>
  </div>
  <div class="option-card opt-b" data-action="set-hub-b">
    <div class="opt-title">Option B — Hub absorbé dans la marge</div>
    <div class="opt-price" data-el="badge-b-price">—</div>
    <div class="opt-marge" data-el="badge-b-marge">—</div>
  </div>
</div>

<!-- ═══ VERDICT ═══ -->
<div class="verdict-panel" data-el="verdict-panel" style="margin-top:16px;">
</div>

<!-- ═══ DETAIL TOGGLE ═══ -->
<button class="detail-toggle" data-action="toggle-detail">▼ Détail ligne par ligne</button>
<div class="detail-table" data-el="detail-table">
  <!-- Filled dynamically -->
</div>

<!-- ═══ HUB P&L ═══ -->
<div class="hub-section" data-el="hub-section">
  <div class="hub-header">
    <h3>🏢 Hub Dubai — P&L mensuel</h3>
    <span class="hub-badge-warn" data-el="hub-mode-indicator">Option B — Hub absorbé dans la marge</span>
  </div>
  <div class="hub-body">
    <div class="hub-metrics">
      <div class="hub-metric"><div class="msub">Coût mensuel Hub</div><div class="mval" data-el="hub-total-kmf">—</div></div>
      <div class="hub-metric"><div class="msub">Coût par commande</div><div class="mval" data-el="hub-par-cmd">—</div></div>
      <div class="hub-metric"><div class="msub">Solde mensuel</div><div class="mval" data-el="hub-solde">—</div></div>
    </div>
    <div class="hub-verdict" data-el="hub-verdict"></div>
  </div>
</div>

</div><!-- end .pricing-pipeline -->
`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  HTML RENDERING — Tab 2: Pricing en Masse
 * ═══════════════════════════════════════════════════════════════════════════ */
function _renderMasseHTML() {
  return `
<div class="pm-wrap">
  <!-- KPIs -->
  <div class="pm-kpis">
    <div class="pm-kpi"><div class="pm-kpi-lbl">Total produits</div><div class="pm-kpi-val" data-el="pmk-total">0</div></div>
    <div class="pm-kpi"><div class="pm-kpi-lbl">✅ Rentable</div><div class="pm-kpi-val" style="color:#34d399;" data-el="pmk-ok">0</div></div>
    <div class="pm-kpi"><div class="pm-kpi-lbl">⚡ Faible marge</div><div class="pm-kpi-val" style="color:#fbbf24;" data-el="pmk-warn">0</div></div>
    <div class="pm-kpi"><div class="pm-kpi-lbl">❌ Non rentable</div><div class="pm-kpi-val" style="color:#f87171;" data-el="pmk-err">0</div></div>
    <div class="pm-kpi"><div class="pm-kpi-lbl">📝 Modifiés</div><div class="pm-kpi-val" style="color:#a5b4fc;" data-el="pmk-modified">0</div></div>
  </div>

  <!-- Toolbar -->
  <div class="pm-toolbar">
    <div class="pm-filter-group">
      <button class="pm-filter active-all" data-pmfilter="all">Tous</button>
      <button class="pm-filter" data-pmfilter="ok">✅ OK</button>
      <button class="pm-filter" data-pmfilter="warn">⚡ Faible</button>
      <button class="pm-filter" data-pmfilter="err">❌ Non rentable</button>
    </div>
    <div style="flex:1;"></div>
    <div class="scenario-group">
      <span class="pf-label" style="margin:0;line-height:1.6;">Scénario :</span>
      <button class="scenario-btn" data-pmscenario="opt" style="border-color:#34d399;color:#34d399;">Opt 15%</button>
      <button class="scenario-btn active" data-pmscenario="real" style="border-color:#f59e0b;color:#f59e0b;background:rgba(245,158,11,0.12);">Réel 28%</button>
      <button class="scenario-btn" data-pmscenario="prud" style="border-color:#f87171;color:#f87171;">Prud 40%</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <div class="pf-group" style="margin:0;">
        <label class="pf-label" style="font-size:0.62rem;">Agent %</label>
        <input class="pf-input" type="number" data-field="pm-agent-pct" value="5" min="0" max="25" step="0.5" style="width:65px;padding:5px 8px;font-size:0.78rem;">
      </div>
      <div class="pf-group" style="margin:0;">
        <label class="pf-label" style="font-size:0.62rem;">Transp. Dubai</label>
        <input class="pf-input" type="number" data-field="pm-transport-dubai" value="0" min="0" step="100" style="width:75px;padding:5px 8px;font-size:0.78rem;">
      </div>
    </div>
    <button class="pm-btn pm-btn-ghost" data-action="pm-export-csv">📥 CSV</button>
    <button class="pm-btn pm-btn-teal" data-action="pm-reload">⬇️ Recharger</button>
  </div>

  <!-- Push bar -->
  <div class="pm-push-bar" data-el="pm-push-bar">
    <span style="font-size:0.82rem;font-weight:600;color:#a5b4fc;">📝</span>
    <span style="font-size:0.78rem;color:var(--text,#e2e8f0);" data-el="pm-push-count">0 prix modifiés</span>
    <div style="flex:1;"></div>
    <button class="pm-btn pm-btn-push" data-action="pm-push-all">🚀 Envoyer tout</button>
  </div>

  <!-- Table -->
  <div class="pm-table-wrap">
    <table class="pm-table">
      <thead>
        <tr>
          <th data-pmsort="emoji" style="width:30px;"></th>
          <th data-pmsort="name">Produit</th>
          <th data-pmsort="prix_aed" style="text-align:right;">Prix AED</th>
          <th data-pmsort="cdr_kmf" style="text-align:right;">CDR</th>
          <th data-pmsort="prix_min" style="text-align:right;">Prix Min</th>
          <th data-pmsort="prix_min_viable" style="text-align:right;">Min Viable</th>
          <th data-pmsort="prix_conseille" style="text-align:right;">Conseillé</th>
          <th style="text-align:right;">Prix Terrain</th>
          <th data-pmsort="prix_actuel" style="text-align:right;">Actuel</th>
          <th style="text-align:right;">Nouveau</th>
          <th data-pmsort="verdict">Verdict</th>
          <th style="width:70px;text-align:center;">Action</th>
        </tr>
      </thead>
      <tbody data-el="pm-tbody"></tbody>
    </table>
  </div>
</div>
`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  HTML RENDERING — Tab 3: Configuration
 * ═══════════════════════════════════════════════════════════════════════════ */
function _renderConfigHTML() {
  return `
<div style="padding:16px;max-width:900px;margin:0 auto;">

  <!-- Exchange Rates -->
  <div class="config-section">
    <div class="config-header">
      <h3>💱 Taux de change</h3>
    </div>
    <div class="config-body">
      <div class="pf-grid-3">
        <div class="pf-group">
          <label class="pf-label">EUR → KMF</label>
          <input class="pf-input" type="number" data-field="cfg-eur-kmf" value="${_ps.TAUX_EUR}" step="1">
        </div>
        <div class="pf-group">
          <label class="pf-label">AED → KMF</label>
          <input class="pf-input" type="number" data-field="cfg-aed-kmf" value="${_ps.TAUX_AED}" step="1">
        </div>
        <div class="pf-group">
          <label class="pf-label">Fret EUR/m³</label>
          <input class="pf-input" type="number" data-field="cfg-fret-eur" value="${_ps.FRET_EUR_M3}" step="5">
        </div>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:12px;">
        <button class="config-save-btn" data-action="cfg-save-rates">💾 Enregistrer les taux</button>
        <span class="config-status" data-el="cfg-rates-status"></span>
      </div>
    </div>
  </div>

  <!-- Taxes by category -->
  <div class="config-section">
    <div class="config-header">
      <h3>🏛️ Taxes par catégorie</h3>
    </div>
    <div class="config-body">
      <div class="pm-table-wrap">
        <table class="pm-table">
          <thead><tr><th>Catégorie</th><th style="text-align:right;">Douane %</th><th style="text-align:right;">TVA %</th><th style="text-align:right;">Taxe Add %</th><th style="width:80px;text-align:center;">Action</th></tr></thead>
          <tbody data-el="cfg-taxes-tbody"></tbody>
        </table>
      </div>
      <div style="margin-top:14px;">
        <button class="config-save-btn" data-action="cfg-refresh-taxes" style="background:var(--bg3,#1e293b);color:var(--text,#e2e8f0);border:1px solid var(--border,#334155);">🔄 Rafraîchir depuis API</button>
        <span class="config-status" data-el="cfg-taxes-status"></span>
      </div>
    </div>
  </div>

  <!-- Dimensions by category -->
  <div class="config-section">
    <div class="config-header">
      <h3>📐 Dimensions par catégorie</h3>
    </div>
    <div class="config-body">
      <div class="pm-table-wrap">
        <table class="pm-table">
          <thead><tr><th>Catégorie</th><th style="text-align:right;">L (cm)</th><th style="text-align:right;">W (cm)</th><th style="text-align:right;">H (cm)</th><th style="text-align:right;">Volume cm³</th><th style="width:80px;text-align:center;">Action</th></tr></thead>
          <tbody data-el="cfg-dims-tbody"></tbody>
        </table>
      </div>
      <div style="margin-top:14px;">
        <button class="config-save-btn" data-action="cfg-refresh-dims" style="background:var(--bg3,#1e293b);color:var(--text,#e2e8f0);border:1px solid var(--border,#334155);">🔄 Rafraîchir depuis API</button>
        <span class="config-status" data-el="cfg-dims-status"></span>
      </div>
    </div>
  </div>

  <!-- Douane scenarios info -->
  <div class="config-section">
    <div class="config-header">
      <h3>📊 Scénarios douane</h3>
    </div>
    <div class="config-body">
      <div class="pf-grid-3">
        <div style="padding:16px;background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.3);border-radius:10px;text-align:center;">
          <div style="font-size:0.72rem;font-weight:700;color:#34d399;margin-bottom:6px;">Optimiste</div>
          <div style="font-size:1.6rem;font-weight:900;color:#34d399;">15%</div>
          <div style="font-size:0.7rem;color:var(--text-muted,#94a3b8);margin-top:4px;">Agent bien établi, bon transitaire</div>
        </div>
        <div style="padding:16px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:10px;text-align:center;">
          <div style="font-size:0.72rem;font-weight:700;color:#f59e0b;margin-bottom:6px;">Réaliste</div>
          <div style="font-size:1.6rem;font-weight:900;color:#f59e0b;">28%</div>
          <div style="font-size:0.7rem;color:var(--text-muted,#94a3b8);margin-top:4px;">Moyenne observée sur le terrain</div>
        </div>
        <div style="padding:16px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.3);border-radius:10px;text-align:center;">
          <div style="font-size:0.72rem;font-weight:700;color:#f87171;margin-bottom:6px;">Prudent</div>
          <div style="font-size:1.6rem;font-weight:900;color:#f87171;">40%</div>
          <div style="font-size:0.7rem;color:var(--text-muted,#94a3b8);margin-top:4px;">Pire cas, catégories sensibles</div>
        </div>
      </div>
    </div>
  </div>
</div>
`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  SIMULATOR — Calculate and update display
 * ═══════════════════════════════════════════════════════════════════════════ */
function _simCalculate(main) {
  const cat = main.querySelector('[data-el="categorie"]')?.value || 'phones';
  const catData = _getCats()[cat] || _getCats().phones;
  const isTenue = cat === 'ceremonie';
  const isAgent = _ps.source === 's1';
  const isDiaspora = _ps.marche === 'diaspora';

  // Read form values
  const gv = (f) => { const el = main.querySelector(`[data-field="${f}"]`); return parseFloat(el?.value) || 0; };
  const gi = (f) => { const el = main.querySelector(`[data-field="${f}"]`); return parseInt(el?.value, 10) || 0; };
  const $$ = (id, v) => { const el = main.querySelector(`[data-el="${id}"]`); if (el) el.textContent = v; };

  let qte, prixAed;
  if (isTenue) {
    qte = gi('q-s') + gi('q-m') + gi('q-l') + gi('q-xl') + gi('q-xxl');
  } else {
    qte = gi('quantite') || 1;
    prixAed = gv('prix-aed');
  }

  const params = {
    prixAed: isTenue ? 0 : gv('prix-aed'),
    qte: isTenue ? 0 : (gi('quantite') || 1),
    agentPct: isAgent ? gv('frais-agent') / 100 : 0,
    tDubai: isAgent ? gv('transport-dubai') : 0,
    embAed: _ps.EMBARK_AED,
    fretKmf: gv('fret-kmf'),
    couverturePct: gv('couverture-maritime-pct') / 100,
    transPct: gv('trans-pct') / 100,
    douanePct: gv('douane-pct') / 100,
    tvaPct: gv('tva-pct') / 100,
    taxeAddPct: gv('taxe-add-pct') / 100,
    fPort: gv('frais-port'),
    tRelais: gv('transport-relais'),
    cRelais: gv('commission-relais'),
    stripePct: gv('stripe-pct') / 100,
    margePct: gv('marge-pct') / 100,
    hubCtrl: gv('hub-controle'),
    hubEtiq: gv('hub-etiquette'),
    hubSms: gv('hub-sms'),
    hubLoyer: gv('hub-loyer'),
    hubSalaire: gv('hub-salaire'),
    hubVolume: gi('hub-volume') || 1,
    tAED: _ps.TAUX_AED,
    tEUR: _ps.TAUX_EUR,
    s4: _ps.source === 's4',
    isDiaspora,
    isTenue,
    tissuAed: gv('tissu-aed'),
    metrage: gv('metrage'),
    confAed: gv('confection-aed'),
    qteTenues: isTenue ? qte : 0,
  };

  if (isTenue && qte === 0) {
    $$('price-main', '—');
    return;
  }

  const r = _computeAll(params);
  if (!r) { $$('price-main', '—'); return; }

  // Active values based on hub mode
  const totalActif = _ps.hubMode === 'a' ? r.totalA : r.totalB;
  const margeNetteActif = _ps.hubMode === 'a' ? r.margeA : r.margeNetteB;
  const margePctActif = _ps.hubMode === 'a' ? r.margePctNetteA : r.margePctNetteB;

  // Main price
  if (isDiaspora) {
    $$('price-main', _fmtE(totalActif));
    $$('price-secondary', '≈ ' + _fmt(totalActif));
  } else {
    $$('price-main', _fmt(totalActif));
    $$('price-secondary', '');
  }

  const labelQte = isTenue
    ? `${r.qteCalc} tenue${r.qteCalc > 1 ? 's' : ''}`
    : `${r.qteCalc} article${r.qteCalc > 1 ? 's' : ''}`;
  $$('qty-label', labelQte);

  // Emb display
  $$('emb-display', _nf.format(Math.round(_ps.EMBARK)));

  // Step subtotals
  $$('subtotal-achat', _fmt(r.blocAchat));
  $$('subtotal-hub', _fmt(r.hubCmdTotal));
  $$('subtotal-fret', _fmt(r.fretTotKmf + r.couvertKmf));
  $$('subtotal-douane', _fmt(r.transKmf + r.fPortKmf + r.douaneKmf + r.tvaKmf + r.taxeAddKmf));
  $$('subtotal-distrib', _fmt(r.tRelaisKmf + r.cRelaisKmf));

  // Options A/B
  $$('badge-a-price', _fmt(r.totalA));
  $$('badge-a-marge', `Marge nette: ${_nf.format(Math.round(r.margeA))} KMF (${r.margePctNetteA.toFixed(1)}%)`);
  $$('badge-b-price', _fmt(r.totalB));
  $$('badge-b-marge', `Marge nette: ${_nf.format(Math.round(r.margeNetteB))} KMF (${r.margePctNetteB.toFixed(1)}%)`);

  // Highlight active option
  const optA = main.querySelector('.option-card.opt-a');
  const optB = main.querySelector('.option-card.opt-b');
  if (optA) optA.style.opacity = _ps.hubMode === 'a' ? '1' : '0.5';
  if (optB) optB.style.opacity = _ps.hubMode === 'b' ? '1' : '0.5';

  // Verdict
  _renderVerdict(main, r, totalActif, margePctActif, params.margePct, cat);

  // Detail table
  _renderDetailTable(main, r, params, totalActif);

  // Hub P&L
  _renderHubPnL(main, r);
}

/* ─────────────────────────────────────────────────────────────────────────
 *  VERDICT RENDERING
 * ───────────────────────────────────────────────────────────────────────── */
function _renderVerdict(main, r, totalActif, margePctActif, targetMargePct, cat) {
  const panel = main.querySelector('[data-el="verdict-panel"]');
  if (!panel) return;

  const catData = _getCats()[cat] || _getCats().phones;
  const prixMin = r.subtotalB;
  const prixMinViable = r.subtotalB / 0.90;
  const prixConseille = _arrondirPsycho(r.subtotalB / (1 - targetMargePct), cat, true);

  let verdictClass, verdictIcon, verdictTitre, verdictSous, bg, border;
  if (margePctActif >= 10) {
    verdictClass = 'ok'; verdictIcon = '✅'; verdictTitre = 'Rentable';
    verdictSous = `Marge nette de ${margePctActif.toFixed(1)}% — objectif atteint`;
    bg = 'rgba(52,211,153,0.1)'; border = 'rgba(52,211,153,0.4)';
  } else if (margePctActif >= 0) {
    verdictClass = 'warn'; verdictIcon = '⚡'; verdictTitre = 'Faible marge';
    verdictSous = `Marge nette de ${margePctActif.toFixed(1)}% — en dessous de la cible`;
    bg = 'rgba(251,191,36,0.1)'; border = 'rgba(251,191,36,0.4)';
  } else {
    verdictClass = 'err'; verdictIcon = '❌'; verdictTitre = 'Non rentable';
    verdictSous = `Marge négative : ${margePctActif.toFixed(1)}% — vente à perte`;
    bg = 'rgba(248,113,113,0.1)'; border = 'rgba(248,113,113,0.4)';
  }

  const N = v => _nf.format(Math.round(v));

  panel.innerHTML = `
    <div class="verdict-main" style="background:${bg};border:1px solid ${border};border-radius:12px 12px 0 0;">
      <div class="verdict-icon">${verdictIcon}</div>
      <div>
        <div class="verdict-titre">${verdictTitre}</div>
        <div class="verdict-sous">${verdictSous}</div>
      </div>
    </div>
    <div class="verdict-prices" style="background:${bg};border:1px solid ${border};border-top:none;border-radius:0 0 12px 12px;">
      <div class="verdict-price-item">
        <div class="verdict-price-label">Prix minimum (CDR)</div>
        <div class="verdict-price-val">${N(prixMin)} KMF</div>
        <div class="verdict-price-sub">Marge 0% — seuil de rentabilité</div>
      </div>
      <div class="verdict-price-item">
        <div class="verdict-price-label">Min viable (10%)</div>
        <div class="verdict-price-val">${N(prixMinViable)} KMF</div>
        <div class="verdict-price-sub">Marge minimum acceptable</div>
      </div>
      <div class="verdict-price-item">
        <div class="verdict-price-label">Prix conseillé</div>
        <div class="verdict-price-val">${N(prixConseille)} KMF</div>
        <div class="verdict-price-sub">Arrondi psychologique · ${catData.label.split(' ')[0]}</div>
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  DETAIL TABLE RENDERING
 * ───────────────────────────────────────────────────────────────────────── */
function _renderDetailTable(main, r, params, totalActif) {
  const dt = main.querySelector('[data-el="detail-table"]');
  if (!dt) return;

  const f = v => _fmt(v);
  const N = v => _nf.format(Math.round(v));
  const isSrc = _ps.source;

  dt.innerHTML = `
    <div class="detail-section">🛒 Achat Dubai</div>
    <div class="detail-row"><span class="lbl">Achat marchandise</span><span class="val">${f(r.prixAchatKmf)}${_ps.source === 's4' ? ' · S4 −30%' : ''}</span></div>
    <div class="detail-row"><span class="lbl">Commission agent</span><span class="val">${isSrc === 's1' ? f(r.agentKmf) + ' (' + (params.agentPct * 100).toFixed(0) + '%)' : '0 KMF'}</span></div>
    <div class="detail-row"><span class="lbl">Emballage export</span><span class="val">${f(r.embKmf)} (3 AED)</span></div>
    <div class="detail-row"><span class="lbl">Transport Dubai</span><span class="val">${isSrc === 's1' ? f(r.tDubaiKmf) : '0 KMF'}</span></div>

    <div class="detail-section">🏢 Hub Dubai</div>
    <div class="detail-row"><span class="lbl">Contrôle conformité</span><span class="val">${f(r.hubCtrl)}</span></div>
    <div class="detail-row"><span class="lbl">Étiquetage QR</span><span class="val">${f(r.hubEtiq)}</span></div>
    <div class="detail-row"><span class="lbl">SMS notification</span><span class="val">${f(r.hubSms)}</span></div>

    <div class="detail-section">🚢 Fret Maritime</div>
    <div class="detail-row"><span class="lbl">Fret maritime</span><span class="val">${f(r.fretTotKmf)}</span></div>
    <div class="detail-row"><span class="lbl">Couverture maritime</span><span class="val">${params.couverturePct > 0 ? f(r.couvertKmf) + ' (' + (params.couverturePct * 100).toFixed(1) + '%)' : '0 KMF — non activée'}</span></div>

    <div class="detail-section">🏛️ Dédouanement</div>
    <div class="detail-row"><span class="lbl">Transitaire</span><span class="val">${f(r.transKmf)} (${(params.transPct * 100).toFixed(0)}% CIF + 450)</span></div>
    <div class="detail-row"><span class="lbl">Frais portuaires</span><span class="val">${f(r.fPortKmf)}</span></div>
    <div class="detail-row"><span class="lbl">Droits de douane</span><span class="val">${f(r.douaneKmf)} (${(params.douanePct * 100).toFixed(0)}% CIF)</span></div>
    <div class="detail-row"><span class="lbl">TVA</span><span class="val">${f(r.tvaKmf)} (${(params.tvaPct * 100).toFixed(0)}% CIF)</span></div>
    ${r.taxeAddKmf > 0 ? `<div class="detail-row"><span class="lbl">Taxe additionnelle</span><span class="val">${f(r.taxeAddKmf)} (${(params.taxeAddPct * 100).toFixed(1)}%)</span></div>` : ''}

    <div class="detail-section">🏝️ Distribution</div>
    <div class="detail-row"><span class="lbl">Transport relais</span><span class="val">${f(r.tRelaisKmf)}</span></div>
    <div class="detail-row"><span class="lbl">Commission relais</span><span class="val">${f(r.cRelaisKmf)}</span></div>
    ${_ps.marche === 'diaspora' ? `<div class="detail-row"><span class="lbl">Stripe</span><span class="val">${f(r.stripeB)}</span></div>` : ''}

    <div class="detail-section">💰 Résultat</div>
    <div class="detail-row"><span class="lbl">Sous-total (CDR)</span><span class="val">${f(_ps.hubMode === 'a' ? r.subtotalA : r.subtotalB)}</span></div>
    <div class="detail-row"><span class="lbl">Marge (${(params.margePct * 100).toFixed(0)}%)</span><span class="val">${f(_ps.hubMode === 'a' ? r.margeA : r.margeB)}</span></div>
    <div class="detail-row total-row"><span class="lbl">PRIX TOTAL</span><span class="val">${f(_ps.hubMode === 'a' ? r.totalA : r.totalB)}</span></div>

    <div class="detail-section">📊 Comparaison Hub</div>
    <div class="detail-row" style="${_ps.hubMode === 'a' ? 'background:rgba(52,211,153,0.08);' : ''}"><span class="lbl">Option A — Prix</span><span class="val">${f(r.totalA)}</span></div>
    <div class="detail-row" style="${_ps.hubMode === 'a' ? 'background:rgba(52,211,153,0.08);' : ''}"><span class="lbl">Option A — Marge nette</span><span class="val">${_fmtN(r.margeA)} (${r.margePctNetteA.toFixed(1)}%)</span></div>
    <div class="detail-row" style="${_ps.hubMode === 'b' ? 'background:rgba(245,158,11,0.08);' : ''}"><span class="lbl">Option B — Prix</span><span class="val">${f(r.totalB)}</span></div>
    <div class="detail-row" style="${_ps.hubMode === 'b' ? 'background:rgba(245,158,11,0.08);' : ''}"><span class="lbl">Option B — Marge nette</span><span class="val">${_fmtN(r.margeNetteB)} (${r.margePctNetteB.toFixed(1)}%)</span></div>
    <div class="detail-row"><span class="lbl">Hub fixe mensuel / cmd</span><span class="val">${f(r.hubFixeParCmd)} · ${N(r.hubMensuel)} KMF/mois</span></div>
  `;
}

/* ─────────────────────────────────────────────────────────────────────────
 *  HUB P&L RENDERING
 * ───────────────────────────────────────────────────────────────────────── */
function _renderHubPnL(main, r) {
  const $$ = (id, v) => { const el = main.querySelector(`[data-el="${id}"]`); if (el) el.textContent = v; };
  const N = v => _nf.format(Math.round(v));

  $$('hub-total-kmf', N(r.hubMensuel) + ' KMF');
  $$('hub-par-cmd', N(r.hubFixeParCmd) + ' KMF/cmd');

  const soldeEl = main.querySelector('[data-el="hub-solde"]');
  if (soldeEl) {
    soldeEl.textContent = _fmtN(r.solde);
    soldeEl.style.color = r.solde >= 0 ? '#34d399' : '#f87171';
  }

  const verdict = main.querySelector('[data-el="hub-verdict"]');
  if (verdict) {
    if (r.solde >= 0) {
      verdict.style.cssText = 'padding:10px 14px;border-radius:8px;font-size:0.78rem;font-weight:700;background:rgba(52,211,153,0.1);color:#34d399;border:1px solid rgba(52,211,153,0.3);';
      verdict.textContent = `✅ Hub couvert · solde ${_fmtN(r.solde)} · marge nette B : ${r.margePctNetteB.toFixed(1)}%`;
    } else {
      verdict.style.cssText = 'padding:10px 14px;border-radius:8px;font-size:0.78rem;font-weight:700;background:rgba(248,113,113,0.1);color:#f87171;border:1px solid rgba(248,113,113,0.3);';
      verdict.textContent = `⚠️ Hub non couvert · manque ${N(-r.solde)} KMF · équilibre à ${r.equilibre} cmd/mois`;
    }
  }

  // Hub mode indicator
  const ind = main.querySelector('[data-el="hub-mode-indicator"]');
  if (ind) {
    ind.textContent = _ps.hubMode === 'a'
      ? 'Option A — Hub répercuté dans le prix'
      : 'Option B — Hub absorbé dans la marge';
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 *  DIMENSION / FRET RECALCULATION
 * ───────────────────────────────────────────────────────────────────────── */
function _recalcFret(main) {
  const gv = (f) => { const el = main.querySelector(`[data-field="${f}"]`); return parseFloat(el?.value) || 0; };
  const $$ = (id, v) => { const el = main.querySelector(`[data-el="${id}"]`); if (el) el.textContent = v; };

  const l = gv('dim-l'), w = gv('dim-w'), h = gv('dim-h');
  const volCm3 = l * w * h;
  const volM3 = volCm3 / 1e6;
  const fret = volM3 * _ps.TAUX_FRET_M3;

  const fretEl = main.querySelector('[data-field="fret-kmf"]');
  if (fretEl) fretEl.value = fret.toFixed(0);

  $$('fret-display', _nf.format(Math.round(fret)) + ' KMF / article');
  $$('fret-sub', `${_nf.format(Math.round(volCm3))} cm³ = ${volM3.toFixed(5)} m³ × ${_ps.FRET_EUR_M3} EUR/m³ × ${_ps.TAUX_EUR} KMF/EUR`);
  $$('hint-dims', `${l}×${w}×${h} cm · ${volM3.toFixed(4)} m³`);
}

/* ─────────────────────────────────────────────────────────────────────────
 *  CATEGORY CHANGE
 * ───────────────────────────────────────────────────────────────────────── */
function _onCatChange(main) {
  const cat = main.querySelector('[data-el="categorie"]')?.value || 'phones';
  const d = _getCats()[cat];
  if (!d) return;

  // Update dims
  const setF = (f, v) => { const el = main.querySelector(`[data-field="${f}"]`); if (el) el.value = v; };
  setF('dim-l', d.dims[0]);
  setF('dim-w', d.dims[1]);
  setF('dim-h', d.dims[2]);
  setF('douane-pct', d.douane);
  setF('tva-pct', d.tva);
  setF('taxe-add-pct', d.taxeAdd);

  // Hints
  const $$ = (id, v) => { const el = main.querySelector(`[data-el="${id}"]`); if (el) el.textContent = v; };
  $$('hint-douane', d.hint);
  $$('hint-taxe', d.taxeAdd > 0
    ? `Taxe ${cat === 'cosmetiques' ? 'hygiène' : 'parafiscale'} : ${d.taxeAdd}%`
    : '0% pour cette catégorie');

  // Toggle tenues
  const isTenue = cat === 'ceremonie';
  const blocProduit = main.querySelector('[data-el="bloc-produit"]');
  const blocTenues = main.querySelector('[data-el="bloc-tenues"]');
  if (blocProduit) blocProduit.style.display = isTenue ? 'none' : 'block';
  if (blocTenues) blocTenues.style.display = isTenue ? 'block' : 'none';

  _recalcFret(main);
  _simCalculate(main);
}

/* ─────────────────────────────────────────────────────────────────────────
 *  SET DOUANE SCENARIO (unit sim)
 * ───────────────────────────────────────────────────────────────────────── */
function _setDouaneScenario(main, key) {
  _ps.douaneScenario = key;
  const sc = DOUANE_SCENARIOS[key];
  if (!sc) return;

  // Update scenario buttons visual
  main.querySelectorAll('[data-scenario]').forEach(btn => {
    const k = btn.dataset.scenario;
    const s = DOUANE_SCENARIOS[k];
    if (k === key) {
      btn.style.background = `${s.color}22`;
      btn.classList.add('active');
    } else {
      btn.style.background = 'transparent';
      btn.classList.remove('active');
    }
  });

  const $$ = (id, v) => { const el = main.querySelector(`[data-el="${id}"]`); if (el) el.textContent = v; };
  $$('scenario-label', `Scénario actif : ${sc.label} (${sc.pct}% CIF)`);

  // Compute effective taxes as a combined rate
  // Use the scenario pct as a global effective rate applied across douane+tva+taxeAdd
  const cat = main.querySelector('[data-el="categorie"]')?.value || 'phones';
  const catData = _getCats()[cat] || _getCats().phones;

  // When using scenarios: we set douane as the main scenario value, keep TVA and taxeAdd from category
  // The scenario represents the total effective tax burden
  const totalCatTax = catData.douane + catData.tva + catData.taxeAdd;
  const scaleFactor = sc.pct / totalCatTax;

  const setF = (f, v) => { const el = main.querySelector(`[data-field="${f}"]`); if (el) el.value = v; };
  setF('douane-pct', (catData.douane * scaleFactor).toFixed(1));
  setF('tva-pct', (catData.tva * scaleFactor).toFixed(1));
  setF('taxe-add-pct', (catData.taxeAdd * scaleFactor).toFixed(1));

  _simCalculate(main);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  MASS PRICING — Render table + actions
 * ═══════════════════════════════════════════════════════════════════════════ */
function _pmRecalc(main) {
  _ps.pmAgentPct = (_gv('pm-agent-pct') || 5) / 100;
  _ps.pmTransportDubai = _gv('pm-transport-dubai') || 0;
  _ps.pmData = _ps.products.map(p => _calcCDRProduit(p));
  _pmUpdateKPIs(main);
  _pmRenderTable(main);
}

function _pmUpdateKPIs(main) {
  const ok   = _ps.pmData.filter(p => p.verdict === 'ok').length;
  const warn = _ps.pmData.filter(p => p.verdict === 'warn').length;
  const err  = _ps.pmData.filter(p => p.verdict === 'err').length;
  const mod  = Object.keys(_ps.pmModified).length;

  const $$ = (id, v) => { const el = main.querySelector(`[data-el="${id}"]`); if (el) el.textContent = v; };
  $$('pmk-total', _ps.pmData.length);
  $$('pmk-ok', ok);
  $$('pmk-warn', warn);
  $$('pmk-err', err);
  $$('pmk-modified', mod);

  const bar = main.querySelector('[data-el="pm-push-bar"]');
  if (bar) bar.classList.toggle('visible', mod > 0);
  $$('pm-push-count', `${mod} prix modifié${mod > 1 ? 's' : ''} — non encore envoyés`);
}

function _pmRenderTable(main) {
  const tbody = main.querySelector('[data-el="pm-tbody"]');
  if (!tbody) return;

  let data = [..._ps.pmData];

  // Filter
  if (_ps.pmFilter !== 'all') data = data.filter(p => p.verdict === _ps.pmFilter);

  // Sort
  const { col, asc } = _ps.pmSort;
  data.sort((a, b) => {
    const va = a[col] ?? '', vb = b[col] ?? '';
    if (typeof va === 'number') return asc ? va - vb : vb - va;
    return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  const N = v => _nf.format(Math.round(v));
  const vBadge = v => {
    if (v === 'ok')   return '<span class="pm-badge pm-badge-ok">✅ Rentable</span>';
    if (v === 'warn') return '<span class="pm-badge pm-badge-warn">⚡ Faible</span>';
    return '<span class="pm-badge pm-badge-err">❌ Non rentable</span>';
  };

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" style="padding:40px;text-align:center;color:var(--text-muted,#64748b);">Aucun produit à afficher.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(p => {
    const isModified = _ps.pmModified[p.id] !== undefined;
    const newVal = isModified ? _ps.pmModified[p.id] : '';
    const terrainVal = _ps.prixTerrain[p.name] || '';
    const terrainInfo = terrainVal ? (() => {
      const ecart = terrainVal - p.prix_conseille;
      const margeR = terrainVal > 0 ? ((terrainVal - p.cdr_kmf) / terrainVal * 100).toFixed(1) : '—';
      const col = ecart >= 0 ? '#34d399' : '#f87171';
      const icon = ecart >= 0 ? '🟢' : '🔴';
      return `<div style="font-size:0.62rem;color:${col};margin-top:2px;">${icon} marge ${margeR}%</div>`;
    })() : '';

    return `<tr class="${isModified ? 'modified' : ''}" data-pid="${p.id}">
      <td style="font-size:1rem;">${p.emoji}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.name}">${p.name}</td>
      <td class="pm-mono" style="text-align:right;">${N(p.prix_aed)} AED</td>
      <td class="pm-mono" style="text-align:right;">${N(p.cdr_kmf)}</td>
      <td class="pm-mono" style="text-align:right;">${N(p.prix_min)}</td>
      <td class="pm-mono" style="text-align:right;">${N(p.prix_min_viable)}</td>
      <td class="pm-mono" style="text-align:right;color:#f59e0b;font-weight:700;">${N(p.prix_conseille)}</td>
      <td><input type="number" class="pm-price-input" data-terrain-id="${p.id}" data-terrain-name="${p.name}" value="${terrainVal}" placeholder="—" style="width:85px;">${terrainInfo}</td>
      <td class="pm-mono" style="text-align:right;">${N(p.prix_actuel)}</td>
      <td><input type="number" class="pm-price-input ${isModified ? 'changed' : ''}" data-newprice-id="${p.id}" value="${newVal}" placeholder="${N(p.prix_conseille)}"></td>
      <td>${vBadge(p.verdict)}</td>
      <td style="text-align:center;">
        <button class="pm-push-btn pending" data-action="pm-push-one" data-push-id="${p.id}" data-push-price="${newVal || p.prix_conseille}">📤</button>
      </td>
    </tr>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────────────────
 *  MASS PRICING — Push price to API
 * ───────────────────────────────────────────────────────────────────────── */
async function _pmPushOne(main, id, price) {
  const btn = main.querySelector(`[data-push-id="${id}"]`);
  try {
    await _apiPut(`/api/products/${id}`, { price_kmf: parseInt(price) });
    if (btn) { btn.classList.remove('pending'); btn.classList.add('success'); btn.textContent = '✅'; }
    delete _ps.pmModified[id];
    _pmUpdateKPIs(main);
  } catch (e) {
    if (btn) { btn.classList.remove('pending'); btn.classList.add('error'); btn.textContent = '❌'; }
    console.error('[Pricing] Push failed:', e);
  }
}

async function _pmPushAll(main) {
  const ids = Object.keys(_ps.pmModified);
  for (const id of ids) {
    const price = _ps.pmModified[id];
    await _pmPushOne(main, id, price);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 *  MASS PRICING — Export CSV
 * ───────────────────────────────────────────────────────────────────────── */
function _pmExportCSV() {
  if (_ps.pmData.length === 0) return;
  const headers = ['Produit','Catégorie','Prix AED','CDR KMF','Prix Min','Min Viable','Prix Conseillé','Prix Actuel','Verdict'];
  const rows = _ps.pmData.map(p => [
    '"' + p.name.replace(/"/g, '""') + '"', p.catKey, p.prix_aed, p.cdr_kmf, p.prix_min,
    p.prix_min_viable, p.prix_conseille, p.prix_actuel, p.verdict
  ].join(';'));
  const csv = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `komerce_pricing_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  CONFIG TAB — Load & Save
 * ═══════════════════════════════════════════════════════════════════════════ */
async function _cfgSaveRates(main) {
  const statusEl = main.querySelector('[data-el="cfg-rates-status"]');
  try {
    const body = {
      eur_kmf: _gv('cfg-eur-kmf'),
      aed_kmf: _gv('cfg-aed-kmf'),
      fret_eur_m3: _gv('cfg-fret-eur')
    };
    await _apiPut('/api/pricing/rates', body);
    _ps.TAUX_EUR = body.eur_kmf;
    _ps.TAUX_AED = body.aed_kmf;
    _ps.FRET_EUR_M3 = body.fret_eur_m3;
    if (statusEl) { statusEl.textContent = '✅ Enregistré'; statusEl.style.color = '#34d399'; }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '❌ Erreur: ' + e.message; statusEl.style.color = '#f87171'; }
  }
}

async function _cfgLoadTaxes(main) {
  try {
    const data = await _apiGet('/api/admin/pricing-matrices/taxes');
    _ps.taxesData = data.taxes || [];
    _cfgRenderTaxes(main);
  } catch (e) {
    // Use default CATS data
    _ps.taxesData = Object.entries(_getCats()).map(([k, v]) => ({
      category: k, douane_pct: v.douane, tva_pct: v.tva, taxe_add_pct: v.taxeAdd
    }));
    _cfgRenderTaxes(main);
  }
}

function _cfgRenderTaxes(main) {
  const tbody = main.querySelector('[data-el="cfg-taxes-tbody"]');
  if (!tbody) return;

  const data = _ps.taxesData.length > 0 ? _ps.taxesData : Object.entries(_getCats()).map(([k, v]) => ({
    category: k, douane_pct: v.douane, tva_pct: v.tva, taxe_add_pct: v.taxeAdd
  }));

  tbody.innerHTML = data.map(t => `
    <tr data-tax-cat="${t.category}">
      <td style="font-weight:600;">${_getCats()[t.category]?.label || t.category}</td>
      <td style="text-align:right;"><input class="pm-price-input" type="number" data-tax-douane="${t.category}" value="${t.douane_pct}" step="0.5" style="width:65px;text-align:right;"></td>
      <td style="text-align:right;"><input class="pm-price-input" type="number" data-tax-tva="${t.category}" value="${t.tva_pct}" step="0.5" style="width:65px;text-align:right;"></td>
      <td style="text-align:right;"><input class="pm-price-input" type="number" data-tax-add="${t.category}" value="${t.taxe_add_pct}" step="0.5" style="width:65px;text-align:right;"></td>
      <td style="text-align:center;"><button class="pm-push-btn pending" data-action="cfg-save-tax" data-tax-category="${t.category}">💾</button></td>
    </tr>
  `).join('');
}

async function _cfgSaveTax(main, category) {
  const douane = parseFloat(main.querySelector(`[data-tax-douane="${category}"]`)?.value) || 0;
  const tva = parseFloat(main.querySelector(`[data-tax-tva="${category}"]`)?.value) || 0;
  const taxeAdd = parseFloat(main.querySelector(`[data-tax-add="${category}"]`)?.value) || 0;
  const btn = main.querySelector(`[data-action="cfg-save-tax"][data-tax-category="${category}"]`);

  try {
    await _apiPut(`/api/admin/pricing-matrices/taxes/${category}`, {
      douane_pct: douane, tva_pct: tva, taxe_add_pct: taxeAdd
    });
    if (btn) { btn.classList.remove('pending'); btn.classList.add('success'); btn.textContent = '✅'; }
    // Update local CATS
    if (_getCats()[category]) {
      _getCats()[category].douane = douane;
      _getCats()[category].tva = tva;
      _getCats()[category].taxeAdd = taxeAdd;
    }
    setTimeout(() => { if (btn) { btn.classList.remove('success'); btn.classList.add('pending'); btn.textContent = '💾'; } }, 2000);
  } catch (e) {
    if (btn) { btn.classList.remove('pending'); btn.classList.add('error'); btn.textContent = '❌'; }
  }
}

async function _cfgLoadDims(main) {
  try {
    const data = await _apiGet('/api/admin/pricing-matrices/dims');
    _ps.dimsData = data.dims || [];
    _cfgRenderDims(main);
  } catch (e) {
    _ps.dimsData = Object.entries(_getCats()).map(([k, v]) => ({
      category: k, length_cm: v.dims[0], width_cm: v.dims[1], height_cm: v.dims[2]
    }));
    _cfgRenderDims(main);
  }
}

function _cfgRenderDims(main) {
  const tbody = main.querySelector('[data-el="cfg-dims-tbody"]');
  if (!tbody) return;

  const data = _ps.dimsData.length > 0 ? _ps.dimsData : Object.entries(_getCats()).map(([k, v]) => ({
    category: k, length_cm: v.dims[0], width_cm: v.dims[1], height_cm: v.dims[2]
  }));

  tbody.innerHTML = data.map(d => {
    const vol = d.length_cm * d.width_cm * d.height_cm;
    return `
    <tr data-dim-cat="${d.category}">
      <td style="font-weight:600;">${_getCats()[d.category]?.label || d.category}</td>
      <td style="text-align:right;"><input class="pm-price-input" type="number" data-dim-l="${d.category}" value="${d.length_cm}" step="1" style="width:60px;text-align:right;"></td>
      <td style="text-align:right;"><input class="pm-price-input" type="number" data-dim-w="${d.category}" value="${d.width_cm}" step="1" style="width:60px;text-align:right;"></td>
      <td style="text-align:right;"><input class="pm-price-input" type="number" data-dim-h="${d.category}" value="${d.height_cm}" step="1" style="width:60px;text-align:right;"></td>
      <td class="pm-mono" style="text-align:right;color:var(--text-muted,#94a3b8);">${_nf.format(vol)}</td>
      <td style="text-align:center;"><button class="pm-push-btn pending" data-action="cfg-save-dim" data-dim-category="${d.category}">💾</button></td>
    </tr>`;
  }).join('');
}

async function _cfgSaveDim(main, category) {
  const l = parseFloat(main.querySelector(`[data-dim-l="${category}"]`)?.value) || 0;
  const w = parseFloat(main.querySelector(`[data-dim-w="${category}"]`)?.value) || 0;
  const h = parseFloat(main.querySelector(`[data-dim-h="${category}"]`)?.value) || 0;
  const btn = main.querySelector(`[data-action="cfg-save-dim"][data-dim-category="${category}"]`);

  try {
    await _apiPut(`/api/admin/pricing-matrices/dims/${category}`, {
      length_cm: l, width_cm: w, height_cm: h
    });
    if (btn) { btn.classList.remove('pending'); btn.classList.add('success'); btn.textContent = '✅'; }
    if (_getCats()[category]) _getCats()[category].dims = [l, w, h];
    setTimeout(() => { if (btn) { btn.classList.remove('success'); btn.classList.add('pending'); btn.textContent = '💾'; } }, 2000);
  } catch (e) {
    if (btn) { btn.classList.remove('pending'); btn.classList.add('error'); btn.textContent = '❌'; }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  SCANNER — Load products and inject into simulator
 * ═══════════════════════════════════════════════════════════════════════════ */
function _populateScanner(main) {
  const select = main.querySelector('[data-el="scanner-select"]');
  if (!select || _ps.products.length === 0) return;

  const opts = _ps.products.map(p => {
    const catKey = _mapCat(p.category);
    const emoji = _getCats()[catKey]?.label?.split(' ')[0] || '📦';
    const price = p.price_aed ? `${p.price_aed} AED` : '';
    return `<option value="${p.id || p._id}">${emoji} ${p.name || p.title} ${price ? '— ' + price : ''}</option>`;
  }).join('');

  select.innerHTML = '<option value="">— Sélectionnez un produit —</option>' + opts;
}

function _injectProduct(main, productId) {
  const product = _ps.products.find(p => (p.id || p._id) === productId);
  if (!product) return;

  const catKey = _mapCat(product.category);
  const setF = (f, v) => { const el = main.querySelector(`[data-field="${f}"]`); if (el) el.value = v; };
  const catEl = main.querySelector('[data-el="categorie"]');
  if (catEl) catEl.value = catKey;

  setF('prix-aed', product.price_aed || 0);
  setF('quantite', 1);

  _onCatChange(main);

  // Show badge
  const badge = main.querySelector('[data-el="scan-badge"]');
  if (badge) {
    const p = _calcCDRProduit(product);
    if (p.verdict === 'ok') {
      badge.style.cssText = 'display:inline-block;background:rgba(52,211,153,0.15);color:#34d399;';
      badge.textContent = `✅ Rentable — marge ${p.marge_pct.toFixed(1)}%`;
    } else if (p.verdict === 'warn') {
      badge.style.cssText = 'display:inline-block;background:rgba(251,191,36,0.15);color:#fbbf24;';
      badge.textContent = `⚡ Faible marge — ${p.marge_pct.toFixed(1)}%`;
    } else {
      badge.style.cssText = 'display:inline-block;background:rgba(248,113,113,0.15);color:#f87171;';
      badge.textContent = `❌ Non rentable — marge ${p.marge_pct.toFixed(1)}%`;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  MAIN ENTRY POINT — CT.views.pricing
 * ═══════════════════════════════════════════════════════════════════════════ */
CT.views.pricing = function(main) {
  // 1. Inject styles
  _injectStyles();

  // 2. Render full layout
  main.innerHTML = `
    <div class="ct-view-header">
      <h2>💰 Simulateur de Tarification</h2>
      <p>Chaîne de coûts Dubai → Comores — calcul du prix de vente final</p>
    </div>
    <div class="pricing-tabs">
      <div class="pricing-tab active" data-pricing-tab="simulateur">⚙️ Simulateur Unitaire</div>
      <div class="pricing-tab" data-pricing-tab="masse">📋 Pricing en Masse</div>
      <div class="pricing-tab" data-pricing-tab="config">⚙️ Configuration</div>
    </div>
    <div class="pricing-screen active" data-pricing-screen="simulateur">
      ${_renderSimHTML()}
    </div>
    <div class="pricing-screen" data-pricing-screen="masse">
      ${_renderMasseHTML()}
    </div>
    <div class="pricing-screen" data-pricing-screen="config">
      ${_renderConfigHTML()}
    </div>
  `;

  // 3. Event delegation — ONE listener for all clicks
  main.addEventListener('click', function(e) {
    // Tab switching
    const tab = e.target.closest('[data-pricing-tab]');
    if (tab) {
      const tabId = tab.dataset.pricingTab;
      main.querySelectorAll('.pricing-tab').forEach(t => t.classList.remove('active'));
      main.querySelectorAll('.pricing-screen').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      const screen = main.querySelector(`[data-pricing-screen="${tabId}"]`);
      if (screen) screen.classList.add('active');

      // Lazy-load mass pricing and config
      if (tabId === 'masse' && !_ps.productsLoaded) {
        _loadProducts().then(() => {
          _populateScanner(main);
          _pmRecalc(main);
        });
      } else if (tabId === 'masse') {
        _pmRecalc(main);
      }
      if (tabId === 'config') {
        _cfgLoadTaxes(main);
        _cfgLoadDims(main);
        // Sync rates to config fields
        const setF = (f, v) => { const el = main.querySelector(`[data-field="${f}"]`); if (el) el.value = v; };
        setF('cfg-eur-kmf', _ps.TAUX_EUR);
        setF('cfg-aed-kmf', _ps.TAUX_AED);
        setF('cfg-fret-eur', _ps.FRET_EUR_M3);
      }
      return;
    }

    // Source buttons
    const srcBtn = e.target.closest('[data-source]');
    if (srcBtn) {
      _ps.source = srcBtn.dataset.source;
      main.querySelectorAll('[data-source]').forEach(b => b.classList.remove('active'));
      srcBtn.classList.add('active');

      // Update hints
      const isAgent = _ps.source === 's1';
      const blocAgent = main.querySelector('[data-el="bloc-agent"]');
      if (blocAgent) blocAgent.style.display = isAgent ? 'block' : 'none';

      const hintSrc = main.querySelector('[data-el="hint-source"]');
      const sourceHint = main.querySelector('[data-el="source-hint"]');
      if (_ps.source === 's1') {
        if (hintSrc) hintSrc.textContent = 'S1 Agent — commission 5%';
        if (sourceHint) sourceHint.textContent = 'S1 Agent : commission 5% + transport Deira → Hub Dubai';
      } else if (_ps.source === 's2') {
        if (hintSrc) hintSrc.textContent = 'S2 Grossiste — pas de commission';
        if (sourceHint) sourceHint.textContent = 'S2 Grossiste : achat direct au souk, pas de commission';
      } else {
        if (hintSrc) hintSrc.textContent = 'S4 Importateur CN — -30% sur achat';
        if (sourceHint) sourceHint.textContent = 'S4 Importateur CN : prix réduit de 30%, import direct Chine→Comores';
      }
      _simCalculate(main);
      return;
    }

    // Marché buttons
    const marchBtn = e.target.closest('[data-marche]');
    if (marchBtn) {
      _ps.marche = marchBtn.dataset.marche;
      main.querySelectorAll('[data-marche]').forEach(b => b.classList.remove('active'));
      marchBtn.classList.add('active');
      const stripeRow = main.querySelector('[data-el="row-stripe"]');
      if (stripeRow) stripeRow.style.display = _ps.marche === 'diaspora' ? 'block' : 'none';
      _simCalculate(main);
      return;
    }

    // Douane scenario buttons (sim tab)
    const scBtn = e.target.closest('[data-scenario]');
    if (scBtn) {
      _setDouaneScenario(main, scBtn.dataset.scenario);
      return;
    }

    // Hub mode A/B
    const hubA = e.target.closest('[data-action="set-hub-a"]');
    if (hubA) { _ps.hubMode = 'a'; _simCalculate(main); return; }
    const hubB = e.target.closest('[data-action="set-hub-b"]');
    if (hubB) { _ps.hubMode = 'b'; _simCalculate(main); return; }

    // Detail toggle
    const detToggle = e.target.closest('[data-action="toggle-detail"]');
    if (detToggle) {
      const dt = main.querySelector('[data-el="detail-table"]');
      if (dt) {
        dt.classList.toggle('open');
        detToggle.textContent = dt.classList.contains('open') ? '▲ Masquer le détail' : '▼ Détail ligne par ligne';
      }
      return;
    }

    // Mass pricing filter
    const pmFilter = e.target.closest('[data-pmfilter]');
    if (pmFilter) {
      const f = pmFilter.dataset.pmfilter;
      _ps.pmFilter = f;
      main.querySelectorAll('[data-pmfilter]').forEach(b => {
        b.className = 'pm-filter' + (b.dataset.pmfilter === f ? (' active-' + (f === 'all' ? 'all' : f)) : '');
      });
      _pmRenderTable(main);
      return;
    }

    // Mass pricing scenario
    const pmSc = e.target.closest('[data-pmscenario]');
    if (pmSc) {
      _ps.pmDouaneScenario = pmSc.dataset.pmscenario;
      main.querySelectorAll('[data-pmscenario]').forEach(b => {
        const k = b.dataset.pmscenario;
        const s = DOUANE_SCENARIOS[k];
        if (k === _ps.pmDouaneScenario) {
          b.style.background = `${s.color}22`;
          b.classList.add('active');
        } else {
          b.style.background = 'transparent';
          b.classList.remove('active');
        }
      });
      _pmRecalc(main);
      return;
    }

    // Mass pricing sort
    const sortTh = e.target.closest('[data-pmsort]');
    if (sortTh) {
      const col = sortTh.dataset.pmsort;
      if (_ps.pmSort.col === col) _ps.pmSort.asc = !_ps.pmSort.asc;
      else { _ps.pmSort.col = col; _ps.pmSort.asc = true; }
      _pmRenderTable(main);
      return;
    }

    // Mass pricing push one
    const pushOne = e.target.closest('[data-action="pm-push-one"]');
    if (pushOne) {
      const id = pushOne.dataset.pushId;
      const price = pushOne.dataset.pushPrice;
      _pmPushOne(main, id, price);
      return;
    }

    // Mass pricing push all
    const pushAll = e.target.closest('[data-action="pm-push-all"]');
    if (pushAll) { _pmPushAll(main); return; }

    // Mass pricing reload
    const pmReload = e.target.closest('[data-action="pm-reload"]');
    if (pmReload) {
      _loadProducts().then(() => {
        _populateScanner(main);
        _pmRecalc(main);
      });
      return;
    }

    // Export CSV
    const csvBtn = e.target.closest('[data-action="pm-export-csv"]');
    if (csvBtn) { _pmExportCSV(); return; }

    // Config save rates
    const cfgRates = e.target.closest('[data-action="cfg-save-rates"]');
    if (cfgRates) { _cfgSaveRates(main); return; }

    // Config refresh taxes
    const cfgTaxes = e.target.closest('[data-action="cfg-refresh-taxes"]');
    if (cfgTaxes) { _cfgLoadTaxes(main); return; }

    // Config refresh dims
    const cfgDims = e.target.closest('[data-action="cfg-refresh-dims"]');
    if (cfgDims) { _cfgLoadDims(main); return; }

    // Config save individual tax
    const cfgSaveTax = e.target.closest('[data-action="cfg-save-tax"]');
    if (cfgSaveTax) { _cfgSaveTax(main, cfgSaveTax.dataset.taxCategory); return; }

    // Config save individual dim
    const cfgSaveDim = e.target.closest('[data-action="cfg-save-dim"]');
    if (cfgSaveDim) { _cfgSaveDim(main, cfgSaveDim.dataset.dimCategory); return; }
  });

  // 4. Input change delegation — recalculate on any input change
  main.addEventListener('input', function(e) {
    const field = e.target.closest('[data-field]');
    if (field) {
      const f = field.dataset.field;
      // Dimension fields trigger fret recalc
      if (f === 'dim-l' || f === 'dim-w' || f === 'dim-h') {
        _recalcFret(main);
      }
      // Category change
      if (f === 'categorie' || e.target.closest('[data-el="categorie"]')) {
        // Handled in change event
      }
      // Mass pricing fields
      if (f === 'pm-agent-pct' || f === 'pm-transport-dubai') {
        _pmRecalc(main);
        return;
      }
      // Simulator fields — recalculate
      _simCalculate(main);
      return;
    }

    // New price input for mass pricing
    const newPriceInput = e.target.closest('[data-newprice-id]');
    if (newPriceInput) {
      const id = newPriceInput.dataset.newpriceId;
      const val = parseInt(newPriceInput.value);
      if (!isNaN(val) && val > 0) {
        _ps.pmModified[id] = val;
        newPriceInput.classList.add('changed');
        // Update the push button price
        const pushBtn = main.querySelector(`[data-push-id="${id}"]`);
        if (pushBtn) pushBtn.dataset.pushPrice = val;
      } else {
        delete _ps.pmModified[id];
        newPriceInput.classList.remove('changed');
      }
      _pmUpdateKPIs(main);
      return;
    }

    // Terrain price input for mass pricing
    const terrainInput = e.target.closest('[data-terrain-id]');
    if (terrainInput) {
      const name = terrainInput.dataset.terrainName;
      const val = parseInt(terrainInput.value);
      if (!isNaN(val) && val > 0) {
        _ps.prixTerrain[name] = val;
      } else {
        delete _ps.prixTerrain[name];
      }
      return;
    }
  });

  // 5. Category change (select element)
  main.addEventListener('change', function(e) {
    if (e.target.closest('[data-el="categorie"]')) {
      _onCatChange(main);
      return;
    }
    // Scanner select
    if (e.target.closest('[data-el="scanner-select"]')) {
      const val = e.target.value;
      if (val) _injectProduct(main, val);
      return;
    }
  });

  // 6. Load rates from API, then initialize
  _loadRates().then(() => {
    // Update fields with loaded rates
    const setF = (f, v) => { const el = main.querySelector(`[data-field="${f}"]`); if (el) el.value = v; };
    // Emballage display
    const embEl = main.querySelector('[data-el="emb-display"]');
    if (embEl) embEl.textContent = _nf.format(Math.round(_ps.EMBARK));

    // Initial category setup
    _onCatChange(main);

    // Load products for scanner (background)
    _loadProducts().then(() => {
      _populateScanner(main);
    });
  });
};

})(); // end IIFE
