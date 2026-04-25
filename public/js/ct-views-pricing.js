/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-pricing.js — Komerce Control Tower · Atelier de Construction du Prix
 *  REFONTE COMPLÈTE — avril 2026
 *
 *  STRUCTURE EN 2 ZONES :
 *
 *    ZONE 1 — Simulation d'un produit (kanban 4 colonnes)
 *      Col 1 : Objet (catalogue/simulation + caractéristiques)
 *      Col 2 : Coût rendu relais (9 lignes + imputation détaillée)
 *      Col 3 : Coût complet business (3 lignes en plus)
 *      Col 4 : Décision (5 scénarios cliquables doctrine V3)
 *
 *    ZONE 2 — Composants utilisés dans le calcul (édition inline)
 *      Liste filtrée des cost_components qui ont effectivement contribué
 *      au calcul ci-dessus, avec édition rapide. Bouton "Voir tous" ouvre
 *      les 22 composants.
 *
 *  HORS DE CETTE VUE :
 *    - Catalogue à surveiller (déplacé dans ct-views-pricing-catalog.js)
 *    - Composition Avancée (vue séparée pricing_workshop pour vue exhaustive)
 *
 *  PRINCIPES :
 *    - Recalcul live au changement d'input (debounce 300ms)
 *    - Affichage explicite des erreurs API dans les colonnes
 *    - Une seule source de vérité : _ps (state)
 *    - Toutes les fonctions internes commencent par _
 *    - Pas de framework, juste du JS/HTML/CSS natif
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

/* ─── ÉTAT GLOBAL ─────────────────────────────────────────────────────── */
const _ps = {
  // Données chargées
  config: null,           // finance_config
  categories: [],         // customs_categories[]
  components: [],         // cost_components[] (les 22 composants)
  provisions: [],         // risk_provisions[]
  catalog: [],            // produits + recos depuis recommend-batch (juste pour le dropdown)
  loaded: false,

  // Mode Zone 1
  buildMode: 'catalog',         // 'catalog' | 'simulation'
  selectedProductId: null,
  inputCategory: 'phones',
  inputPrixAchat: 0,
  inputCurrency: 'KMF',         // 'AED' | 'EUR' | 'USD' | 'KMF'
  inputDimL: 0,
  inputDimW: 0,
  inputDimH: 0,
  inputPoidsKg: 0,
  inputChannel: 'cash_relais',  // 'cash_relais' | 'diaspora'

  // Calcul actuel
  currentReco: null,        // résultat /api/pricing/recommend
  selectedScenarioId: null, // scénario sélectionné dans la colonne 4
  isComputing: false,
  lastError: null,          // erreur de calcul si la dernière requête a échoué

  // Zone 2 (composants)
  showAllComponents: true,  // true par défaut : on part des coûts (doctrine)
  editingCompId: null,      // id du composant en cours d'édition inline
};

/* ─── HELPERS ─────────────────────────────────────────────────────────── */
const _nf = new Intl.NumberFormat('fr-FR');
const _fmt = (n) => _nf.format(Math.round(n || 0)) + ' KMF';
const _fmtNum = (n, dec) => {
  const num = Number(n) || 0;
  return _nf.format(Number(num.toFixed(dec || 0)));
};
function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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
const _apiGet  = (p)    => _api('GET',  p);
const _apiPost = (p, b) => _api('POST', p, b);
const _apiPut  = (p, b) => _api('PUT',  p, b);
const _apiDel  = (p)    => _api('DELETE', p);

function _userCanApply() {
  // Le rôle vit dans CT.platform.state.role (pas CT.platform.role)
  const role = (window.CT && CT.platform && CT.platform.state && CT.platform.state.role) || '';
  return role === 'admin' || role === 'founder';
}

/* ─── CHARGEMENT DES DONNÉES ─────────────────────────────────────────── */
async function _loadAll() {
  const [cfg, cats, comps, provs] = await Promise.all([
    _apiGet('/api/admin/finance-config').catch(() => null),
    _apiGet('/api/admin/customs-categories').catch(() => []),
    _apiGet('/api/admin/cost-components').catch(() => _apiGet('/api/admin/pricing-components').catch(() => [])),
    _apiGet('/api/admin/risk-provisions').catch(() => []),
  ]);
  _ps.config = cfg || {};
  _ps.categories = Array.isArray(cats) ? cats : [];
  _ps.components = Array.isArray(comps) ? comps : (comps?.components || []);
  _ps.provisions = Array.isArray(provs) ? provs : [];
  if (_ps.categories.length && !_ps.categories.find(c => c.key === _ps.inputCategory)) {
    _ps.inputCategory = _ps.categories[0].key;
  }
}

async function _loadCatalog() {
  try {
    const r = await _apiPost('/api/pricing/recommend-batch', { limit: 200 });
    _ps.catalog = r.items || [];
  } catch (err) {
    console.warn('[Atelier] _loadCatalog error:', err.message);
    _ps.catalog = [];
  }
}

async function _computeReco() {
  // Calcul du prix pour le produit/contexte courant.
  // Renvoie le résultat ou throw si erreur.
  const fc = _ps.config?.targets || _ps.config || {};
  const tauxAed = Number(fc.taux_aed_kmf || 138);
  const tauxEur = Number(fc.taux_change_eur_kmf || 492);
  const tauxUsdEur = 0.92;

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

  const reco = await _apiPost('/api/pricing/recommend', body);
  _ps.currentReco = reco;
  _ps.lastError = null;
  return reco;
}

/* ─── DEBOUNCE RECALCUL ───────────────────────────────────────────────── */
let _recalcTimer = null;
function _scheduleRecalc(container, delayMs) {
  clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(async () => {
    // Pas de calcul si pas de données minimales
    if (_ps.buildMode === 'catalog' && !_ps.selectedProductId) return;
    if (_ps.buildMode === 'simulation' && (!_ps.inputPrixAchat || _ps.inputPrixAchat <= 0)) return;

    _ps.isComputing = true;
    _renderHTML(container);
    try {
      await _computeReco();
    } catch (err) {
      console.error('[Atelier] erreur calcul:', err);
      _ps.lastError = err.message || 'Erreur inconnue';
      _ps.currentReco = null;
    } finally {
      _ps.isComputing = false;
      _renderHTML(container);
    }
  }, delayMs || 300);
}

/* ─── ENTRY POINT ────────────────────────────────────────────────────── */
async function _render(container) {
  container.innerHTML = '<div class="apv-loading">Chargement de l\'Atelier...</div>';
  try {
    await _loadAll();
    await _loadCatalog();
    _ps.loaded = true;
    _renderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="apv-error">Erreur de chargement : ' + _esc(err.message) + '</div>';
    console.error('[Atelier] _render error:', err);
  }
}

/* ─── RENDU PRINCIPAL ─────────────────────────────────────────────────── */
function _renderHTML(container) {
  _injectStyles();

  let html = '<div class="apv-wrap">';

  // Header
  html += '<header class="apv-header">';
  html += '<h1 class="apv-h1">🧮 Atelier de Construction du Prix</h1>';
  html += '<p class="apv-sub">Simuler un produit, voir les coûts qui le construisent, ajuster les paramètres.</p>';
  html += '<div class="apv-tools">';
  html += '<button class="apv-btn apv-btn-secondary" data-act="refresh">🔄 Rafraîchir</button>';
  html += '</div>';
  html += '</header>';

  // ZONE 1 — Composants de coût (la base doctrinale : on part des coûts)
  html += _renderZone2();

  // ZONE 2 — Simulation produit (le cas d'application)
  html += _renderZone1();

  html += '</div>';
  container.innerHTML = html;
  _bindEvents(container);
}

/* ═══════════════════════════════════════════════════════════════════════
 * ZONE 1 — KANBAN 4 COLONNES (simulation d'un produit)
 * ═══════════════════════════════════════════════════════════════════════ */
function _renderZone1() {
  let html = '<section class="apv-zone apv-zone1">';
  html += '<div class="apv-zone-head">';
  html += '<h2 class="apv-zone-title">📊 Appliquer à un produit</h2>';
  html += '<span class="apv-zone-sub">Sélectionnez un produit catalogue ou simulez un nouveau produit pour voir comment les coûts s\'imputent.</span>';
  if (_ps.isComputing) html += '<span class="apv-spinner" title="Calcul en cours">⏳</span>';
  html += '</div>';

  html += '<div class="apv-kanban">';
  html += _kanbanCol(1, 'gray',  '🎯 Objet',                '', _renderColObjet());
  html += _kanbanCol(2, 'blue',  '📦 Coût rendu relais',    '', _renderColRelais());
  html += _kanbanCol(3, 'green', '💼 Coût complet business','', _renderColBusiness());
  html += _kanbanCol(4, 'amber', '🎯 Décision',             '', _renderColDecision());
  html += '</div>';

  // Lecture doctrinale en bas si reco
  if (_ps.currentReco) {
    const r = _ps.currentReco;
    html += '<div class="apv-doctrinal">';
    html += '<span class="apv-doctrinal-icon">💡</span>';
    html += '<div class="apv-doctrinal-text">';
    html += 'Cet objet coûte <strong>' + _fmt(r.landed_relay_cost_kmf) + '</strong> rendu relais. ';
    html += 'Coût complet : <strong>' + _fmt(r.business_complete_cost_kmf || r.cost_complete_estimated_kmf) + '</strong>. ';
    html += 'Ne pas vendre sous <strong>' + _fmt(r.minimum_safe_price_kmf) + '</strong>. ';
    html += 'Conseillé : <strong>' + _fmt(r.recommended_price_kmf) + '</strong>.';
    html += '</div></div>';
  }

  // Erreur de calcul
  if (_ps.lastError) {
    html += '<div class="apv-error-banner">';
    html += '<strong>⚠️ Erreur de calcul :</strong> ' + _esc(_ps.lastError);
    html += '<div class="apv-error-hint">Vérifiez que tous les composants de coût sont calibrés (Zone 2 ci-dessous).</div>';
    html += '</div>';
  }

  html += '</section>';
  return html;
}

function _kanbanCol(num, color, title, sub, body) {
  return '<div class="apv-kcol apv-kcol-' + color + '">' +
    '<header class="apv-kcol-head">' +
      '<span class="apv-kcol-num">' + num + '</span>' +
      '<div><div class="apv-kcol-title">' + title + '</div>' +
      (sub ? '<div class="apv-kcol-sub">' + sub + '</div>' : '') +
      '</div>' +
    '</header>' +
    '<div class="apv-kcol-body">' + body + '</div>' +
  '</div>';
}

/* ─── COLONNE 1 — OBJET ──────────────────────────────────────────────── */
function _renderColObjet() {
  const mode = _ps.buildMode;
  let html = '';

  // Mode toggle
  html += '<div class="apv-mode-toggle">';
  html += '<label class="' + (mode === 'catalog' ? 'active' : '') + '">';
  html += '<input type="radio" name="apv-mode" data-act="set-mode" data-mode="catalog" ' + (mode === 'catalog' ? 'checked' : '') + '>';
  html += '<span>📦 Catalogue</span></label>';
  html += '<label class="' + (mode === 'simulation' ? 'active' : '') + '">';
  html += '<input type="radio" name="apv-mode" data-act="set-mode" data-mode="simulation" ' + (mode === 'simulation' ? 'checked' : '') + '>';
  html += '<span>🧪 Simulation</span></label>';
  html += '</div>';

  // Identification
  html += '<div class="apv-field">';
  if (mode === 'catalog') {
    html += '<label class="apv-label">Produit du catalogue</label>';
    html += '<select class="apv-input" data-input="product-select">';
    html += '<option value="">— Choisir —</option>';
    (_ps.catalog || []).forEach(it => {
      const sel = (_ps.selectedProductId === it.product_id) ? ' selected' : '';
      html += '<option value="' + _esc(it.product_id) + '"' + sel + '>' +
        _esc(it.name).slice(0, 40) + ' — ' + _fmt(it.current_price_kmf) + '</option>';
    });
    html += '</select>';
    if (!_ps.catalog?.length) {
      html += '<div class="apv-hint apv-hint-warn">Aucun produit chargé. Vérifiez que /api/pricing/recommend-batch fonctionne.</div>';
    }
  } else {
    html += '<label class="apv-label">Catégorie</label>';
    html += '<select class="apv-input" data-input="category">';
    (_ps.categories || []).forEach(c => {
      const sel = (_ps.inputCategory === c.key) ? ' selected' : '';
      html += '<option value="' + _esc(c.key) + '"' + sel + '>' + _esc(c.label || c.key) + '</option>';
    });
    html += '</select>';
  }
  html += '</div>';

  // Caractéristiques (mode simulation uniquement)
  if (mode === 'simulation') {
    html += '<div class="apv-field">';
    html += '<label class="apv-label">Prix achat</label>';
    html += '<div class="apv-row">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="prix_achat" value="' + (_ps.inputPrixAchat || 0) + '" min="0" step="0.01">';
    html += '<select class="apv-input apv-input-cur" data-input="currency">';
    ['AED','EUR','USD','KMF'].forEach(c => {
      html += '<option value="' + c + '"' + (_ps.inputCurrency === c ? ' selected' : '') + '>' + c + '</option>';
    });
    html += '</select></div></div>';

    html += '<div class="apv-field"><label class="apv-label">Poids (kg)</label>';
    html += '<input type="number" class="apv-input apv-input-num" data-input="poids_kg" value="' + (_ps.inputPoidsKg || 0) + '" min="0" step="0.01">';
    html += '</div>';

    html += '<div class="apv-field"><label class="apv-label">Dimensions (cm)</label>';
    html += '<div class="apv-row">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="dim_l" value="' + (_ps.inputDimL || 0) + '" min="0" step="0.1" placeholder="L">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="dim_w" value="' + (_ps.inputDimW || 0) + '" min="0" step="0.1" placeholder="l">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="dim_h" value="' + (_ps.inputDimH || 0) + '" min="0" step="0.1" placeholder="h">';
    html += '</div></div>';
  }

  // Contexte (canal toujours visible)
  html += '<div class="apv-field"><label class="apv-label">Canal de vente</label>';
  html += '<select class="apv-input" data-input="channel">';
  html += '<option value="cash_relais"' + (_ps.inputChannel === 'cash_relais' ? ' selected' : '') + '>Cash relais</option>';
  html += '<option value="diaspora"' + (_ps.inputChannel === 'diaspora' ? ' selected' : '') + '>Diaspora (carte)</option>';
  html += '</select></div>';

  return html;
}

/* ─── COLONNE 2 — COÛT RENDU RELAIS ─────────────────────────────────── */
function _renderColRelais() {
  if (_ps.lastError) {
    return '<div class="apv-kempty apv-kempty-error">⚠️ Calcul échoué — voir bandeau ci-dessous</div>';
  }
  const r = _ps.currentReco;
  if (!r) {
    return '<div class="apv-kempty">' +
      (_ps.buildMode === 'catalog' && !_ps.selectedProductId
        ? 'Sélectionnez un produit'
        : 'En attente du calcul…') +
      '</div>';
  }

  const breakdown = r.cost_breakdown || { landed_relay: {} };
  const landed = breakdown.landed_relay || {};
  const total = r.landed_relay_cost_kmf || 0;
  const allocations = breakdown.allocations || [];
  const allocAvg = breakdown.allocation_averages || {};

  let html = '';

  // Total en haut
  html += '<div class="apv-ktotal apv-ktotal-blue">';
  html += '<div class="apv-ktotal-label">Total imputé à l\'article</div>';
  html += '<div class="apv-ktotal-value">' + _fmt(total) + '</div>';
  html += '</div>';

  // Détail des 9 lignes
  let linesBody = '';
  const lines = [
    ['🛒', 'Achat fournisseur',   landed.product_purchase],
    ['🔍', 'Sourcing',            landed.sourcing],
    ['🏬', 'Hub Dubai',           landed.hub],
    ['📦', 'Emballage',           landed.packaging],
    ['🚢', 'Fret',                landed.freight],
    ['🛃', 'Douane',              landed.customs],
    ['📋', 'Port / transitaire',  landed.port_transitary],
    ['🚚', 'Distribution locale', landed.local_distribution],
    ['🏪', 'Relais',              landed.relay],
  ];
  lines.forEach(([emoji, label, val]) => {
    linesBody += '<div class="apv-kline">';
    linesBody += '<span class="apv-kline-icon">' + emoji + '</span>';
    linesBody += '<span class="apv-kline-label">' + label + '</span>';
    linesBody += '<span class="apv-kline-val">' + (val > 0 ? _fmt(val) : '—') + '</span>';
    linesBody += '</div>';
  });
  html += _kSection('relais-detail', 'Détail (9 lignes)', linesBody, false);

  // Imputation détaillée (si on a des allocations agrégées)
  if (allocations.length > 0) {
    const hasAggregated = allocations.some(a => a.engaged_level !== 'article');
    if (hasAggregated) {
      let allocBody = '';
      allocBody += '<p class="apv-mini-text">Komerce engage des coûts à plusieurs niveaux. Chaque coût agrégé (shipment, colis, commande) est divisé pour être imputé à l\'article.</p>';
      allocBody += '<div class="apv-alloc-table">';
      allocBody += '<div class="apv-alloc-head"><span>Composant</span><span>Engagé</span><span>Niveau ÷</span><span>Imputé</span></div>';
      allocations.forEach(a => {
        const isAgg = a.engaged_level !== 'article';
        const lvl = ({
          shipment: 'shipment ÷ ' + (allocAvg.articles_per_shipment || 200),
          parcel:   'colis ÷ ' + (allocAvg.articles_per_parcel || 4),
          order:    'commande ÷ ' + (allocAvg.articles_per_order || 2.5),
          article:  '—',
        })[a.engaged_level] || a.engaged_level;
        allocBody += '<div class="apv-alloc-row' + (isAgg ? ' apv-alloc-agg' : '') + '">';
        allocBody += '<span>' + _esc(a.component_label || a.component_key || '') + '</span>';
        allocBody += '<span class="apv-num apv-dim">' + _fmt(a.engaged_amount_kmf) + '</span>';
        allocBody += '<span class="apv-lvl">' + lvl + '</span>';
        allocBody += '<span class="apv-num apv-bold">' + _fmt(a.imputed_amount_kmf) + '</span>';
        allocBody += '</div>';
      });
      allocBody += '</div>';
      if (allocAvg.confidence === 'low') {
        allocBody += '<p class="apv-warn-inline">⚠️ Moyennes non calibrées. À recalibrer dès volume réel.</p>';
      }
      html += _kSection('imputation', '🏗️ Imputation détaillée', allocBody, false);
    }
  }

  return html;
}

/* ─── COLONNE 3 — COÛT COMPLET BUSINESS ──────────────────────────────── */
function _renderColBusiness() {
  if (_ps.lastError) {
    return '<div class="apv-kempty apv-kempty-error">⚠️</div>';
  }
  const r = _ps.currentReco;
  if (!r) return '<div class="apv-kempty">En attente du calcul…</div>';

  const breakdown = r.cost_breakdown || { business: {} };
  const business = breakdown.business || {};
  const landed = r.landed_relay_cost_kmf || 0;
  const total = r.business_complete_cost_kmf || r.cost_complete_estimated_kmf || 0;

  let html = '';
  html += '<div class="apv-ktotal apv-ktotal-green">';
  html += '<div class="apv-ktotal-label">Total business</div>';
  html += '<div class="apv-ktotal-value">' + _fmt(total) + '</div>';
  html += '</div>';

  let detBody = '';
  detBody += '<div class="apv-kline apv-kline-report">';
  detBody += '<span class="apv-kline-icon">═</span>';
  detBody += '<span class="apv-kline-label">Coût rendu relais (report)</span>';
  detBody += '<span class="apv-kline-val">' + _fmt(landed) + '</span>';
  detBody += '</div>';

  const adds = [
    ['💳', 'Frais paiement',    business.payment],
    ['🛡️', 'Provision risques', business.risk_provision],
    ['🏢', 'Part charges fixes', business.fixed_overhead],
  ];
  adds.forEach(([emoji, label, val]) => {
    detBody += '<div class="apv-kline">';
    detBody += '<span class="apv-kline-icon">' + emoji + '</span>';
    detBody += '<span class="apv-kline-label">' + label + '</span>';
    detBody += '<span class="apv-kline-val">' + (val > 0 ? '+ ' + _fmt(val) : '—') + '</span>';
    detBody += '</div>';
  });
  html += _kSection('biz-detail', 'Détail (3 lignes business)', detBody, false);

  // Pilotage charges fixes
  if (r.monthly_break_even_orders || r.target_orders_per_month) {
    let pilBody = '';
    if (r.target_orders_per_month) {
      pilBody += '<div class="apv-kline"><span class="apv-kline-label">Cible mensuelle</span><span class="apv-kline-val">' + r.target_orders_per_month + ' commandes</span></div>';
    }
    if (r.monthly_break_even_orders) {
      pilBody += '<div class="apv-kline"><span class="apv-kline-label">Seuil rentabilité</span><span class="apv-kline-val">' + r.monthly_break_even_orders + ' cmd/mois</span></div>';
    }
    if (r.monthly_fixed_costs_kmf) {
      pilBody += '<div class="apv-kline"><span class="apv-kline-label">Charges fixes</span><span class="apv-kline-val">' + _fmt(r.monthly_fixed_costs_kmf) + '/mois</span></div>';
    }
    html += _kSection('biz-pilot', 'Pilotage charges fixes', pilBody, false);
  }

  return html;
}

/* ─── COLONNE 4 — DÉCISION (5 SCÉNARIOS) ─────────────────────────────── */
function _renderColDecision() {
  if (_ps.lastError) return '<div class="apv-kempty apv-kempty-error">⚠️</div>';
  const r = _ps.currentReco;
  if (!r) return '<div class="apv-kempty">Le moteur affichera ici les scénarios de prix.</div>';

  const scenarios = r.scenarios || [];
  const selectedId = _ps.selectedScenarioId || r.recommended_scenario_id || 'honest_baseline';
  const selected = scenarios.find(s => s.id === selectedId) || scenarios[0];

  let html = '';

  // Si pas de scénarios (backend pas encore Doctrine V3), afficher au moins le prix recommandé
  if (!scenarios.length) {
    html += '<div class="apv-ktotal apv-ktotal-decision">';
    html += '<div><div class="apv-ktotal-label">Prix conseillé</div>';
    html += '<div class="apv-ktotal-value">' + _fmt(r.recommended_price_kmf) + '</div></div>';
    html += '</div>';
    html += '<div class="apv-kempty">Doctrine V3 (5 scénarios) en attente du backend.</div>';
    return html;
  }

  // KPI haut : prix du scénario sélectionné
  if (selected) {
    const decisionMap = {
      PRIORITY: { color:'#3b82f6', label:'PRIORITY' },
      TEST:     { color:'#16a34a', label:'TEST' },
      WATCH:    { color:'#f59e0b', label:'WATCH' },
      AVOID:    { color:'#dc2626', label:'AVOID' },
      LOSS:     { color:'#7f1d1d', label:'LOSS' },
    };
    const dec = decisionMap[r.sourcing_decision] || { color:'#94a3b8', label: r.sourcing_decision || '—' };

    html += '<div class="apv-ktotal apv-ktotal-decision">';
    html += '<div><div class="apv-ktotal-label">' + _esc(selected.label) + '</div>';
    html += '<div class="apv-ktotal-value">' + _fmt(selected.price_kmf) + '</div></div>';
    html += '<span class="apv-decision-badge" style="background:' + dec.color + ';">' + dec.label + '</span>';
    html += '</div>';
  }

  // 5 scénarios cliquables
  let body = '';
  scenarios.forEach(s => {
    const isSel = (s.id === selectedId);
    const isRec = s.is_recommended;
    const isProj = s.is_projection;
    const cls = ['apv-scenario',
      isSel ? 'apv-scenario-selected' : '',
      !s.selectable ? 'apv-scenario-disabled' : '',
      isRec ? 'apv-scenario-rec' : '',
      isProj ? 'apv-scenario-proj' : '',
    ].filter(Boolean).join(' ');
    const marginColor = s.margin_pct >= 15 ? '#16a34a' : s.margin_pct >= 5 ? '#f59e0b' : '#dc2626';

    body += '<div class="' + cls + '" data-scenario-id="' + _esc(s.id) + '"' + (s.selectable ? ' role="button" tabindex="0"' : '') + '>';
    body += '<div class="apv-scenario-head">';
    body += '<span class="apv-scenario-radio">' + (isSel ? '●' : '○') + '</span>';
    body += '<span class="apv-scenario-label">' + _esc(s.label) + '</span>';
    if (isRec)  body += '<span class="apv-tag apv-tag-rec">★ recommandé</span>';
    if (isProj) body += '<span class="apv-tag apv-tag-proj">projection</span>';
    if (!s.selectable) body += '<span class="apv-tag apv-tag-block">⚠️ sous survie</span>';
    body += '</div>';
    body += '<div class="apv-scenario-prices">';
    body += '<span class="apv-scenario-price">' + _fmt(s.price_kmf) + '</span>';
    body += '<span style="color:' + marginColor + ';font-size:.74rem;font-weight:600;">marge ' + s.margin_pct + '%</span>';
    body += '</div>';
    if (s.short_description) body += '<div class="apv-scenario-desc">' + _esc(s.short_description) + '</div>';
    body += '</div>';
  });
  html += _kSection('scenarios', 'Scénarios d\'imputation', body, true);

  // Détail du scénario sélectionné
  if (selected) {
    let dBody = '';
    if (selected.explanation) dBody += '<p class="apv-mini-text apv-italic">' + _esc(selected.explanation) + '</p>';
    dBody += '<div class="apv-kline"><span class="apv-kline-label">Prix de vente</span><span class="apv-kline-val apv-bold-big">' + _fmt(selected.price_kmf) + '</span></div>';
    dBody += '<div class="apv-kline"><span class="apv-kline-label">Coût imputé</span><span class="apv-kline-val">' + _fmt(selected.cost_imputed_kmf) + '</span></div>';
    const margeColor = selected.margin_pct >= 15 ? '#16a34a' : '#f59e0b';
    dBody += '<div class="apv-kline"><span class="apv-kline-label">Marge brute</span><span class="apv-kline-val" style="color:' + margeColor + ';font-weight:700;">' + _fmt(selected.margin_kmf) + ' (' + selected.margin_pct + '%)</span></div>';
    if (selected.sous_couverture_kmf) {
      dBody += '<div class="apv-kline apv-kline-warn"><span class="apv-kline-label">⚠️ Sous-couverture</span><span class="apv-kline-val" style="color:#dc2626;">−' + _fmt(selected.sous_couverture_kmf) + ' / article</span></div>';
    }
    if (selected.economy_vs_baseline_kmf) {
      dBody += '<div class="apv-kline"><span class="apv-kline-label">Économie vs baseline</span><span class="apv-kline-val" style="color:#16a34a;">−' + _fmt(selected.economy_vs_baseline_kmf) + '</span></div>';
    }
    html += _kSection('selected-detail', 'Détail du scénario', dBody, false);
  }

  // Garde-fous
  let safeBody = '';
  safeBody += '<div class="apv-kline"><span class="apv-kline-label">💀 Prix de survie</span><span class="apv-kline-val">' + _fmt(r.survival_price_kmf) + '</span></div>';
  safeBody += '<div class="apv-kline"><span class="apv-kline-label">🛡️ Minimum sûr</span><span class="apv-kline-val">' + _fmt(r.minimum_safe_price_kmf) + '</span></div>';
  safeBody += '<p class="apv-mini-text apv-italic">Aucun scénario sous le prix de survie n\'est applicable.</p>';
  html += _kSection('safety', 'Garde-fous', safeBody, false);

  // Bouton Apply
  if (selected && selected.selectable && _userCanApply() && r.product_id) {
    html += '<div class="apv-apply-zone">';
    html += '<button class="apv-apply-btn" data-act="apply-scenario" ' +
      'data-product-id="' + _esc(r.product_id) + '" ' +
      'data-price="' + selected.price_kmf + '" ' +
      'data-scenario-id="' + _esc(selected.id) + '" ' +
      'data-scenario-label="' + _esc(selected.label) + '" ' +
      'data-levier="' + _esc(selected.levier || '') + '" ' +
      'data-survival="' + r.survival_price_kmf + '">' +
      '✓ Appliquer ce scénario (' + _fmt(selected.price_kmf) + ')</button>';
    html += '</div>';
  }

  return html;
}

/* ─── HELPER : SECTION DÉPLIABLE ─────────────────────────────────────── */
function _kSection(id, title, body, openByDefault) {
  return '<details class="apv-ksection" data-section="' + id + '"' + (openByDefault ? ' open' : '') + '>' +
    '<summary class="apv-ksection-head">' + title + '</summary>' +
    '<div class="apv-ksection-body">' + body + '</div>' +
  '</details>';
}
/* ═══════════════════════════════════════════════════════════════════════
 * ZONE 2 — COMPOSANTS UTILISÉS DANS LE CALCUL
 * ═══════════════════════════════════════════════════════════════════════ */
function _renderZone2() {
  let html = '<section class="apv-zone apv-zone2">';
  html += '<div class="apv-zone-head">';
  html += '<h2 class="apv-zone-title">🧱 Les coûts qui construisent le prix</h2>';
  html += '<span class="apv-zone-sub">Komerce ne part pas du produit, il part du coût rendu relais. Calibrez ici les composants qui pèsent sur chaque article vendu.</span>';
  html += '<div class="apv-zone-actions">';
  if (_ps.currentReco) {
    const usedKeys = _getUsedComponentKeys();
    html += '<span class="apv-zone-badge">' + usedKeys.size + ' utilisés sur ' + _ps.components.length + '</span>';
  }
  html += '<button class="apv-btn apv-btn-ghost" data-act="toggle-show-all">' +
    (_ps.showAllComponents ? '▼ Filtrer aux utilisés' : '▶ Afficher tous (' + _ps.components.length + ')') +
    '</button>';
  html += '<button class="apv-btn apv-btn-secondary" data-act="open-workshop">⚙️ Vue exhaustive</button>';
  html += '</div></div>';

  if (!_ps.components.length) {
    html += '<div class="apv-empty">Aucun composant chargé. Vérifiez /api/admin/cost-components.</div>';
    html += '</section>';
    return html;
  }

  const usedKeys = _getUsedComponentKeys();
  const items = _ps.showAllComponents
    ? _ps.components
    : _ps.components.filter(c => usedKeys.has(c.key));

  if (!items.length && !_ps.showAllComponents) {
    html += '<div class="apv-empty apv-empty-info">';
    html += '💡 Aucun composant n\'est utilisé pour ce calcul. Sélectionnez un produit ou cliquez sur "Afficher tous" pour voir la liste complète.';
    html += '</div>';
    html += '</section>';
    return html;
  }

  // Grouper par catégorie
  const grouped = {};
  items.forEach(c => {
    const cat = c.category || 'autres';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });

  const CAT_LABELS = {
    product_purchase:   { emoji: '🛒', label: 'Achat fournisseur',    color: '#94a3b8' },
    sourcing:           { emoji: '🔍', label: 'Sourcing',             color: '#a855f7' },
    hub:                { emoji: '🏬', label: 'Hub Dubai',            color: '#0ea5e9' },
    packaging:          { emoji: '📦', label: 'Emballage',            color: '#06b6d4' },
    freight:            { emoji: '🚢', label: 'Fret international',   color: '#3b82f6' },
    customs:            { emoji: '🛃', label: 'Douane',               color: '#ef4444' },
    port_transitary:    { emoji: '📋', label: 'Port / transitaire',   color: '#f97316' },
    local_distribution: { emoji: '🚚', label: 'Distribution locale',  color: '#16a34a' },
    relay:              { emoji: '🏪', label: 'Relais',               color: '#22c55e' },
    payment:            { emoji: '💳', label: 'Paiement',             color: '#8b5cf6' },
    risk_provision:     { emoji: '🛡️', label: 'Provision risques',    color: '#facc15' },
    fixed_overhead:     { emoji: '🏢', label: 'Charges fixes',        color: '#d97706' },
    incident:           { emoji: '⚠️', label: 'Incident',             color: '#dc2626' },
    autres:             { emoji: '•',  label: 'Autres',               color: '#64748b' },
  };

  // ─── GRILLE DE CARDS (2 colonnes) ──────────────────────────────
  html += '<div class="apv-cat-grid">';
  Object.keys(grouped).sort().forEach(cat => {
    const meta = CAT_LABELS[cat] || { emoji: '•', label: cat, color: '#64748b' };
    const comps = grouped[cat];
    const catTotal = _computeCategoryImputed(cat);

    html += '<div class="apv-cat-card" data-cat="' + _esc(cat) + '">';
    // Header avec emoji + label + total imputé
    html += '<div class="apv-cat-card-head" style="border-left:3px solid ' + meta.color + ';">';
    html += '<span class="apv-cat-card-emoji">' + meta.emoji + '</span>';
    html += '<span class="apv-cat-card-label">' + _esc(meta.label) + '</span>';
    html += '<span class="apv-cat-card-count">' + comps.length + '</span>';
    if (catTotal > 0) {
      html += '<span class="apv-cat-card-total">' + _fmt(catTotal) + '</span>';
    }
    html += '</div>';
    // Composants à l'intérieur
    html += '<div class="apv-cat-card-body">';
    comps.forEach(c => {
      html += _renderComponentRow(c, usedKeys.has(c.key));
    });
    html += '</div>';
    html += '</div>';
  });
  html += '</div>';

  // ─── BARRE COLORÉE EMPILÉE EN BAS (synthèse poids relatif) ─────
  html += _renderStackedBar(grouped, CAT_LABELS);

  html += '</section>';
  return html;
}

/**
 * Calcule le coût imputé total d'une catégorie pour le produit/contexte courant.
 * Utilise les allocations si disponibles, sinon les sous-totaux landed_relay/business.
 */
function _computeCategoryImputed(catKey) {
  const r = _ps.currentReco;
  if (!r) return 0;

  // Mapping catégorie composant → clé du breakdown
  // Cumul de toutes les keys qui peuvent contribuer à cette catégorie
  const breakdown = r.cost_breakdown || {};
  const landed = breakdown.landed_relay || {};
  const business = breakdown.business || {};

  // Mapping direct (le breakdown utilise les mêmes noms que les catégories)
  const direct = { ...landed, ...business };
  if (direct[catKey] != null) return Number(direct[catKey]) || 0;

  // Fallback : sommer les allocations dont le composant est dans cette catégorie
  const allocs = breakdown.allocations || [];
  let sum = 0;
  allocs.forEach(a => {
    const comp = _ps.components.find(c => c.key === a.component_key);
    if (comp && comp.category === catKey) {
      sum += Number(a.imputed_amount_kmf) || 0;
    }
  });
  return sum;
}

/**
 * Barre empilée horizontale avec les poids relatifs des catégories.
 * Affichée en bas de la zone, comme synthèse "où va l'argent".
 */
function _renderStackedBar(grouped, CAT_LABELS) {
  // Calculer le total imputé par catégorie
  const catTotals = [];
  let grandTotal = 0;
  Object.keys(grouped).forEach(cat => {
    const total = _computeCategoryImputed(cat);
    if (total > 0) {
      catTotals.push({ cat, total, meta: CAT_LABELS[cat] || { emoji: '•', label: cat, color: '#64748b' } });
      grandTotal += total;
    }
  });

  if (grandTotal === 0) {
    // Pas de calcul → afficher un message neutre
    return '<div class="apv-stackbar-empty">' +
      '💡 Sélectionnez un produit dans la zone ci-dessous pour voir comment ces composants se répartissent.' +
      '</div>';
  }

  // Trier par poids décroissant
  catTotals.sort((a, b) => b.total - a.total);

  let html = '<div class="apv-stackbar">';
  html += '<div class="apv-stackbar-head">';
  html += '<span class="apv-stackbar-label">Coût imputé à l\'article</span>';
  html += '<span class="apv-stackbar-total">' + _fmt(grandTotal) + '</span>';
  html += '</div>';

  // La barre elle-même
  html += '<div class="apv-stackbar-track" role="img" aria-label="Répartition des coûts">';
  catTotals.forEach(({ cat, total, meta }) => {
    const pct = (total / grandTotal) * 100;
    if (pct < 0.5) return;  // sauter les segments minuscules
    const showLabel = pct >= 8;
    html += '<div class="apv-stackbar-seg" data-cat="' + _esc(cat) + '" ' +
      'style="width:' + pct.toFixed(2) + '%;background:' + meta.color + ';" ' +
      'title="' + _esc(meta.label) + ' : ' + _fmt(total) + ' (' + pct.toFixed(1) + '%)">';
    if (showLabel) {
      html += '<span class="apv-stackbar-seg-label">' + pct.toFixed(0) + '%</span>';
    }
    html += '</div>';
  });
  html += '</div>';

  // Légende compacte sous la barre
  html += '<div class="apv-stackbar-legend">';
  catTotals.forEach(({ cat, total, meta }) => {
    const pct = (total / grandTotal) * 100;
    if (pct < 0.5) return;
    html += '<span class="apv-stackbar-legend-item">';
    html += '<span class="apv-stackbar-dot" style="background:' + meta.color + ';"></span>';
    html += _esc(meta.label) + ' <span class="apv-stackbar-legend-pct">' + pct.toFixed(1) + '%</span>';
    html += '</span>';
  });
  html += '</div>';

  html += '</div>';
  return html;
}

function _getUsedComponentKeys() {
  // Retourne les clés des composants qui ont effectivement contribué au calcul.
  const set = new Set();
  if (!_ps.currentReco) return set;
  const allocs = _ps.currentReco.cost_breakdown?.allocations || [];
  allocs.forEach(a => {
    if (a.component_key) set.add(a.component_key);
  });
  // Si le backend ne renvoie pas allocations, déduire des landed_relay non-zéro
  if (set.size === 0) {
    const landed = _ps.currentReco.cost_breakdown?.landed_relay || {};
    const business = _ps.currentReco.cost_breakdown?.business || {};
    Object.entries({ ...landed, ...business }).forEach(([k, v]) => {
      if (v && v > 0) {
        // Mapping approximatif champ → clé probable
        const map = {
          product_purchase: 'product_purchase', sourcing: 'sourcing_pct',
          hub: 'hub_kmf', packaging: 'packaging_kmf',
          freight: 'fret_maritime_eur_m3', customs: 'douane_pct',
          port_transitary: 'transitaire_kmf', local_distribution: 'local_distribution_kmf',
          relay: 'commission_relais_kmf', payment: 'frais_paiement',
          risk_provision: 'risk_provision', fixed_overhead: 'charges_fixes',
        };
        if (map[k]) set.add(map[k]);
      }
    });
  }
  return set;
}

function _renderComponentRow(c, isUsed) {
  const isEditing = _ps.editingCompId === c.id;
  const conf = c.confidence || 'medium';
  const confLabel = ({ high: '✓', medium: '~', low: '⚠' })[conf] || '?';
  const confColor = ({ high: '#16a34a', medium: '#f59e0b', low: '#dc2626' })[conf] || '#94a3b8';

  let html = '<div class="apv-comp-row' + (isUsed ? ' apv-comp-used' : ' apv-comp-unused') + '" data-comp-id="' + _esc(c.id) + '">';

  // Toggle on/off
  html += '<span class="apv-toggle ' + (c.is_active ? 'on' : '') + '" data-act="toggle-comp" title="Activer/désactiver"></span>';

  // Nom + clé
  html += '<div class="apv-comp-info">';
  html += '<div class="apv-comp-label">' + _esc(c.label || c.key) + '</div>';
  html += '<div class="apv-comp-key">' + _esc(c.key) + '</div>';
  html += '</div>';

  // Valeur (éditable inline)
  if (isEditing) {
    html += '<div class="apv-comp-edit">';
    html += '<input type="number" class="apv-input apv-input-num apv-input-sm" data-edit-field="value" value="' + (c.default_value || 0) + '" step="any">';
    html += '<span class="apv-comp-unit">' + _esc(c.unit || '') + '</span>';
    html += '<button class="apv-btn apv-btn-save" data-act="save-comp">✓</button>';
    html += '<button class="apv-btn apv-btn-cancel" data-act="cancel-edit">✕</button>';
    html += '</div>';
  } else {
    html += '<div class="apv-comp-value">';
    html += '<span class="apv-comp-num">' + _fmtNum(c.default_value, 2) + '</span>';
    html += '<span class="apv-comp-unit">' + _esc(c.unit || '') + '</span>';
    html += '</div>';
  }

  // Confidence
  html += '<span class="apv-comp-conf" style="color:' + confColor + '" title="Fiabilité : ' + conf + '">' + confLabel + '</span>';

  // Actions
  if (!isEditing) {
    html += '<div class="apv-comp-actions">';
    html += '<button class="apv-btn-icon" data-act="edit-comp" title="Modifier">✎</button>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/* ─── STYLES ─────────────────────────────────────────────────────────── */
function _injectStyles() {
  if (document.getElementById('apv-styles')) return;
  const s = document.createElement('style');
  s.id = 'apv-styles';
  s.textContent = `
    .apv-wrap { padding:16px 20px; max-width:1400px; margin:0 auto; color:#1e293b; }
    .apv-h1 { font-size:1.4rem; font-weight:800; margin:0 0 4px; color:#1e293b; }
    .apv-sub { font-size:.85rem; color:#64748b; margin:0 0 14px; }
    .apv-header { margin-bottom:16px; }
    .apv-tools { display:flex; gap:10px; }

    .apv-btn { padding:7px 14px; font-size:.85rem; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid transparent; transition:all .15s; font-family:inherit; }
    .apv-btn-primary { background:#f59e0b; color:#fff; }
    .apv-btn-primary:hover { background:#d97706; }
    .apv-btn-secondary { background:#fff; color:#1e293b; border-color:#cbd5e1; }
    .apv-btn-secondary:hover { background:#f8fafc; }
    .apv-btn-ghost { background:transparent; color:#64748b; border:none; padding:5px 10px; font-size:.8rem; }
    .apv-btn-ghost:hover { color:#1e293b; background:#f1f5f9; }
    .apv-btn-save { background:#16a34a; color:#fff; padding:4px 10px; }
    .apv-btn-cancel { background:#fff; border-color:#cbd5e1; padding:4px 10px; }
    .apv-btn-icon { background:transparent; border:none; color:#94a3b8; cursor:pointer; padding:4px 8px; font-size:.95rem; border-radius:4px; }
    .apv-btn-icon:hover { background:#f1f5f9; color:#475569; }

    .apv-loading, .apv-error, .apv-empty { padding:40px 20px; text-align:center; color:#64748b; font-size:.9rem; }
    .apv-error { color:#b91c1c; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; }
    .apv-empty-info { background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; border-radius:8px; padding:14px; }

    /* ZONES */
    .apv-zone { background:#fff; border:1px solid #e2e8f0; border-radius:10px; margin-bottom:16px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,.03); }
    .apv-zone-head { display:flex; align-items:center; padding:14px 18px; background:#f8fafc; border-bottom:1px solid #e2e8f0; gap:12px; flex-wrap:wrap; }
    .apv-zone-title { font-size:1rem; font-weight:700; margin:0; }
    .apv-zone-sub { font-size:.78rem; color:#64748b; flex:1; min-width:200px; font-style:italic; }
    .apv-zone-actions { display:flex; align-items:center; gap:8px; }
    .apv-zone-badge { background:#dbeafe; color:#1e40af; padding:3px 10px; border-radius:12px; font-size:.78rem; font-weight:600; }

    .apv-spinner { font-size:1.1rem; animation: apv-spin 1.4s linear infinite; }
    @keyframes apv-spin { 0%,100% { opacity:.4; } 50% { opacity:1; } }

    /* KANBAN */
    .apv-kanban { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; padding:14px; }
    @media (max-width: 1100px) { .apv-kanban { grid-template-columns:repeat(2, 1fr); } }
    @media (max-width: 700px)  { .apv-kanban { grid-template-columns:1fr; } }

    .apv-kcol { background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
    .apv-kcol-head { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-bottom:1px solid #e2e8f0; }
    .apv-kcol-num { width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:.78rem; flex-shrink:0; }
    .apv-kcol-title { font-size:.92rem; font-weight:700; line-height:1.2; }
    .apv-kcol-sub { font-size:.72rem; color:#64748b; margin-top:2px; }

    .apv-kcol-gray  .apv-kcol-head { background:#f1f5f9; }
    .apv-kcol-gray  .apv-kcol-num { background:#475569; }
    .apv-kcol-blue  .apv-kcol-head { background:#eff6ff; }
    .apv-kcol-blue  .apv-kcol-num { background:#3b82f6; }
    .apv-kcol-blue  .apv-kcol-title { color:#1e3a8a; }
    .apv-kcol-green .apv-kcol-head { background:#ecfdf5; }
    .apv-kcol-green .apv-kcol-num { background:#16a34a; }
    .apv-kcol-green .apv-kcol-title { color:#14532d; }
    .apv-kcol-amber .apv-kcol-head { background:#fffbeb; }
    .apv-kcol-amber .apv-kcol-num { background:#f59e0b; }
    .apv-kcol-amber .apv-kcol-title { color:#78350f; }

    .apv-kcol-body { padding:0; }
    .apv-kempty { padding:30px 12px; text-align:center; color:#94a3b8; font-style:italic; font-size:.82rem; }
    .apv-kempty-error { color:#dc2626; background:#fef2f2; }

    /* KPI total en haut de colonne */
    .apv-ktotal { padding:12px; text-align:center; border-bottom:1px solid #e2e8f0; }
    .apv-ktotal-blue { background:#f8fbfe; }
    .apv-ktotal-green { background:#f2fbf7; }
    .apv-ktotal-decision { background:#f0f9ff; display:flex; align-items:center; justify-content:space-between; gap:10px; text-align:left; }
    .apv-ktotal-label { font-size:.68rem; color:#64748b; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
    .apv-ktotal-value { font-size:1.3rem; font-weight:800; font-family:ui-monospace,monospace; color:#1e293b; margin-top:4px; }
    .apv-decision-badge { color:#fff; padding:5px 12px; border-radius:6px; font-size:.72rem; font-weight:700; letter-spacing:.4px; }

    /* MODE TOGGLE */
    .apv-mode-toggle { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:8px 12px; border-bottom:1px solid #e2e8f0; background:#fafbfc; }
    .apv-mode-toggle label { display:flex; align-items:center; justify-content:center; gap:4px; padding:7px 10px; border-radius:5px; font-size:.78rem; font-weight:600; cursor:pointer; background:#fff; border:1px solid #e2e8f0; color:#64748b; transition:all .15s; }
    .apv-mode-toggle label:hover { border-color:#94a3b8; }
    .apv-mode-toggle label.active { background:#16a34a; border-color:#15803d; color:#fff; }
    .apv-mode-toggle input { display:none; }

    /* INPUTS */
    .apv-field { padding:8px 12px; }
    .apv-label { display:block; font-size:.7rem; color:#64748b; font-weight:600; text-transform:uppercase; letter-spacing:.4px; margin-bottom:4px; }
    .apv-input { width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:5px; font-size:.85rem; font-family:inherit; background:#fff; color:#1e293b; box-sizing:border-box; }
    .apv-input:focus { outline:2px solid #16a34a; outline-offset:-1px; border-color:#16a34a; }
    .apv-input-num { font-family:ui-monospace,monospace; }
    .apv-input-sm { padding:3px 6px; font-size:.78rem; }
    .apv-input-cur { max-width:75px; flex:0 0 75px; }
    .apv-row { display:flex; gap:6px; }
    .apv-row > * { flex:1; min-width:0; }
    .apv-hint { font-size:.72rem; color:#64748b; margin-top:4px; padding:4px 8px; }
    .apv-hint-warn { color:#dc2626; background:#fef2f2; border-radius:4px; }

    /* SECTIONS DÉPLIABLES */
    .apv-ksection { border-bottom:1px solid #f1f5f9; }
    .apv-ksection:last-child { border-bottom:none; }
    .apv-ksection-head { padding:8px 12px; cursor:pointer; font-size:.82rem; font-weight:600; color:#475569; list-style:none; position:relative; user-select:none; }
    .apv-ksection-head::-webkit-details-marker { display:none; }
    .apv-ksection-head::after { content:'▶'; position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:.65rem; color:#94a3b8; transition:transform .15s; }
    .apv-ksection[open] .apv-ksection-head::after { transform:translateY(-50%) rotate(90deg); }
    .apv-ksection-head:hover { background:#f8fafc; color:#1e293b; }
    .apv-ksection-body { padding:4px 12px 10px; }

    /* LIGNES DE CALCUL */
    .apv-kline { display:grid; grid-template-columns:22px 1fr auto; align-items:center; gap:8px; padding:5px 0; font-size:.82rem; border-bottom:1px dashed #f1f5f9; }
    .apv-kline:last-child { border-bottom:none; }
    .apv-kline-icon { text-align:center; font-size:.92rem; }
    .apv-kline-label { color:#475569; }
    .apv-kline-val { font-family:ui-monospace,monospace; font-weight:600; color:#1e293b; text-align:right; white-space:nowrap; }
    .apv-kline-report { background:#f8fafc; margin:0 -12px; padding:6px 12px; font-style:italic; color:#64748b; }
    .apv-kline-warn { background:#fef2f2; border-radius:4px; padding:4px 6px; margin:4px 0; }
    .apv-bold-big { font-size:.95rem; }

    /* IMPUTATION TABLE */
    .apv-mini-text { font-size:.74rem; color:#64748b; line-height:1.4; margin:0 0 6px; }
    .apv-italic { font-style:italic; }
    .apv-warn-inline { font-size:.74rem; color:#dc2626; margin:8px 0 0; line-height:1.4; }
    .apv-alloc-table { font-size:.74rem; }
    .apv-alloc-head { display:grid; grid-template-columns:1.6fr .8fr 1.2fr .8fr; gap:4px; padding:4px 6px; background:#f8fafc; border-radius:4px; font-weight:600; color:#64748b; text-transform:uppercase; font-size:.62rem; letter-spacing:.4px; margin-bottom:4px; }
    .apv-alloc-row { display:grid; grid-template-columns:1.6fr .8fr 1.2fr .8fr; gap:4px; padding:4px 6px; border-bottom:.5px dashed #e2e8f0; align-items:center; }
    .apv-alloc-agg { background:#fefce8; }
    .apv-num { font-family:ui-monospace,monospace; text-align:right; font-size:.72rem; }
    .apv-dim { color:#94a3b8; }
    .apv-bold { font-weight:600; color:#1e293b; }
    .apv-lvl { font-size:.66rem; color:#64748b; font-style:italic; }

    /* SCÉNARIOS */
    .apv-scenario { border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; margin-bottom:6px; background:#fff; cursor:pointer; transition:all .15s; }
    .apv-scenario:hover:not(.apv-scenario-disabled) { border-color:#cbd5e1; background:#f8fafc; }
    .apv-scenario-selected { border-color:#16a34a !important; background:#f0fdf4 !important; box-shadow:0 0 0 1px #16a34a; }
    .apv-scenario-disabled { opacity:.5; cursor:not-allowed; background:#f1f5f9; }
    .apv-scenario-rec .apv-scenario-label::before { content:''; }
    .apv-scenario-proj { border-style:dashed; }
    .apv-scenario-head { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
    .apv-scenario-radio { font-size:1rem; color:#16a34a; font-weight:700; }
    .apv-scenario-label { font-size:.82rem; font-weight:600; color:#1e293b; flex:1; line-height:1.2; }
    .apv-scenario-prices { display:flex; justify-content:space-between; align-items:baseline; margin:2px 0; }
    .apv-scenario-price { font-family:ui-monospace,monospace; font-size:1rem; font-weight:700; color:#1e293b; }
    .apv-scenario-desc { font-size:.72rem; color:#64748b; line-height:1.35; margin-top:2px; }
    .apv-tag { font-size:.65rem; padding:1px 6px; border-radius:8px; font-weight:600; text-transform:uppercase; letter-spacing:.4px; }
    .apv-tag-rec { background:#fef3c7; color:#92400e; }
    .apv-tag-proj { background:#ddd6fe; color:#5b21b6; }
    .apv-tag-block { background:#fee2e2; color:#b91c1c; }

    .apv-apply-zone { padding:10px 12px; border-top:1px solid #e2e8f0; }
    .apv-apply-btn { width:100%; padding:10px 12px; background:#16a34a; color:white; border:none; border-radius:6px; font-size:.85rem; font-weight:700; cursor:pointer; font-family:inherit; transition:background .15s; }
    .apv-apply-btn:hover { background:#15803d; }
    .apv-apply-btn:disabled { background:#94a3b8; cursor:not-allowed; }

    /* DOCTRINE BANNER */
    .apv-doctrinal { display:flex; gap:12px; padding:12px 14px; background:#fef9c3; border-left:4px solid #f59e0b; border-radius:6px; font-size:.85rem; color:#713f12; line-height:1.5; margin:14px; }
    .apv-doctrinal-icon { font-size:1.2rem; flex-shrink:0; }
    .apv-doctrinal-text strong { color:#422006; font-family:ui-monospace,monospace; }

    /* ERROR BANNER */
    .apv-error-banner { margin:14px; padding:12px 16px; background:#fef2f2; border-left:4px solid #dc2626; border-radius:6px; color:#7f1d1d; font-size:.88rem; }
    .apv-error-banner strong { color:#991b1b; }
    .apv-error-hint { margin-top:6px; font-size:.78rem; color:#991b1b; }

    /* ZONE 2 — CARDS PAR CATÉGORIE EN GRILLE */
    .apv-cat-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:12px; padding:14px; }
    @media (max-width: 700px) { .apv-cat-grid { grid-template-columns:1fr; } }

    .apv-cat-card { background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; transition:all .15s; }
    .apv-cat-card.apv-cat-highlight { border-color:#f59e0b; box-shadow:0 0 0 2px rgba(245,158,11,.2); }
    .apv-cat-card-head { display:flex; align-items:center; gap:8px; padding:8px 10px; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
    .apv-cat-card-emoji { font-size:1.05rem; flex-shrink:0; }
    .apv-cat-card-label { font-size:.82rem; font-weight:700; color:#1e293b; flex:1; }
    .apv-cat-card-count { background:#f1f5f9; color:#64748b; padding:1px 7px; border-radius:10px; font-size:.7rem; font-weight:600; }
    .apv-cat-card-total { font-family:ui-monospace,monospace; font-size:.78rem; font-weight:700; color:#d97706; margin-left:6px; }
    .apv-cat-card-body { padding:4px 0; }

    /* COMPOSANT ROW (compact dans card) */
    .apv-comp-row { display:grid; grid-template-columns:30px 1fr auto auto auto; gap:8px; align-items:center; padding:5px 10px; border-radius:4px; transition:background .12s; font-size:.82rem; }
    .apv-comp-row:hover { background:#f8fafc; }
    .apv-comp-used { background:linear-gradient(to right, transparent 0%, #fefce8 8px, transparent 16px); }
    .apv-comp-unused { opacity:.65; }
    .apv-comp-info { min-width:0; }
    .apv-comp-label { font-size:.82rem; font-weight:500; color:#1e293b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .apv-comp-key { display:none; }  /* clé technique masquée par défaut, trop bruyant */
    .apv-comp-value { display:flex; gap:3px; align-items:baseline; white-space:nowrap; }
    .apv-comp-num { font-family:ui-monospace,monospace; font-weight:600; color:#1e293b; font-size:.85rem; }
    .apv-comp-unit { font-size:.68rem; color:#94a3b8; }
    .apv-comp-conf { font-weight:700; font-size:.95rem; min-width:14px; text-align:center; }
    .apv-comp-actions { display:flex; gap:2px; }
    .apv-comp-edit { display:flex; gap:4px; align-items:center; }
    .apv-comp-edit .apv-input { width:80px; }

    /* TOGGLE ON/OFF */
    .apv-toggle { width:28px; height:14px; border-radius:7px; background:#cbd5e1; position:relative; cursor:pointer; transition:background .15s; flex-shrink:0; display:inline-block; }
    .apv-toggle.on { background:#10b981; }
    .apv-toggle::after { content:''; position:absolute; top:2px; left:2px; width:10px; height:10px; border-radius:50%; background:#fff; transition:left .15s; box-shadow:0 1px 2px rgba(0,0,0,.15); }
    .apv-toggle.on::after { left:16px; }

    /* ─── BARRE EMPILÉE (synthèse poids relatif) ─────────────────── */
    .apv-stackbar { padding:14px 18px; background:#fafbfc; border-top:1px solid #e2e8f0; }
    .apv-stackbar-empty { padding:14px 18px; text-align:center; font-size:.82rem; color:#64748b; font-style:italic; background:#f8fafc; border-top:1px solid #e2e8f0; }
    .apv-stackbar-head { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:8px; }
    .apv-stackbar-label { font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
    .apv-stackbar-total { font-family:ui-monospace,monospace; font-size:1.1rem; font-weight:800; color:#1e293b; }
    .apv-stackbar-track { display:flex; height:24px; border-radius:6px; overflow:hidden; background:#e2e8f0; }
    .apv-stackbar-seg { display:flex; align-items:center; justify-content:center; transition:opacity .15s; cursor:pointer; min-width:1px; }
    .apv-stackbar-seg:hover { opacity:.8; }
    .apv-stackbar-seg-label { font-size:.7rem; font-weight:700; color:rgba(255,255,255,.95); font-family:ui-monospace,monospace; }
    .apv-stackbar-legend { display:flex; flex-wrap:wrap; gap:10px 16px; margin-top:10px; font-size:.75rem; color:#475569; }
    .apv-stackbar-legend-item { display:inline-flex; align-items:center; gap:5px; }
    .apv-stackbar-dot { display:inline-block; width:10px; height:10px; border-radius:2px; flex-shrink:0; }
    .apv-stackbar-legend-pct { font-family:ui-monospace,monospace; color:#64748b; font-size:.72rem; margin-left:2px; }
  `;
  document.head.appendChild(s);
}

/* ─── EVENTS ─────────────────────────────────────────────────────────── */
function _bindEvents(container) {
  // INPUT (changement de valeur dans Zone 1)
  const inputHandler = (e) => {
    const t = e.target.closest('[data-input]');
    if (!t) return;
    const f = t.dataset.input;

    if (f === 'product-select') {
      _ps.selectedProductId = t.value || null;
      const item = (_ps.catalog || []).find(c => c.product_id === _ps.selectedProductId);
      if (item) {
        if (item.category) _ps.inputCategory = item.category;
        if (item.cost_kmf != null) {
          _ps.inputPrixAchat = Number(item.cost_kmf) || 0;
          _ps.inputCurrency = 'KMF';
        }
        if (item.weight_kg != null) _ps.inputPoidsKg = Number(item.weight_kg) || 0;
        if (item.volume_m3 != null && item.volume_m3 > 0 && (!_ps.inputDimL || !_ps.inputDimW || !_ps.inputDimH)) {
          const side = Math.cbrt(Number(item.volume_m3) * 1e6);
          _ps.inputDimL = Math.round(side);
          _ps.inputDimW = Math.round(side);
          _ps.inputDimH = Math.round(side);
        }
      }
      _renderHTML(container);
      _scheduleRecalc(container, 100);
      return;
    }

    if (f === 'category')   _ps.inputCategory = t.value;
    else if (f === 'prix_achat') _ps.inputPrixAchat = parseFloat(t.value) || 0;
    else if (f === 'currency')   _ps.inputCurrency = t.value || 'AED';
    else if (f === 'poids_kg')   _ps.inputPoidsKg = parseFloat(t.value) || 0;
    else if (f === 'dim_l')      _ps.inputDimL = parseFloat(t.value) || 0;
    else if (f === 'dim_w')      _ps.inputDimW = parseFloat(t.value) || 0;
    else if (f === 'dim_h')      _ps.inputDimH = parseFloat(t.value) || 0;
    else if (f === 'channel')    _ps.inputChannel = t.value;

    _scheduleRecalc(container, 300);
  };
  container.addEventListener('change', inputHandler);
  container.addEventListener('input',  inputHandler);

  // CLICKS
  container.addEventListener('click', async (e) => {
    // Sélection scénario
    const scenarioCard = e.target.closest('.apv-scenario');
    if (scenarioCard && !scenarioCard.classList.contains('apv-scenario-disabled')) {
      _ps.selectedScenarioId = scenarioCard.dataset.scenarioId;
      _renderHTML(container);
      return;
    }

    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;

    if (act === 'set-mode') {
      _ps.buildMode = t.dataset.mode || 'catalog';
      _ps.currentReco = null;
      _ps.lastError = null;
      _renderHTML(container);
      return;
    }

    if (act === 'refresh') {
      t.disabled = true;
      t.textContent = '⏳ Actualisation...';
      try {
        await _loadAll();
        await _loadCatalog();
        _renderHTML(container);
        if ((_ps.buildMode === 'catalog' && _ps.selectedProductId) ||
            (_ps.buildMode === 'simulation' && _ps.inputPrixAchat > 0)) {
          _scheduleRecalc(container, 100);
        }
      } catch (err) {
        alert('Erreur : ' + err.message);
        t.disabled = false;
        t.textContent = '🔄 Rafraîchir';
      }
      return;
    }

    if (act === 'open-workshop') {
      window.location.hash = '#pricing_workshop';
      return;
    }

    if (act === 'toggle-show-all') {
      _ps.showAllComponents = !_ps.showAllComponents;
      _renderHTML(container);
      return;
    }

    // Édition composant inline
    if (act === 'edit-comp') {
      const row = t.closest('[data-comp-id]');
      if (!row) return;
      _ps.editingCompId = row.dataset.compId;
      _renderHTML(container);
      return;
    }

    if (act === 'cancel-edit') {
      _ps.editingCompId = null;
      _renderHTML(container);
      return;
    }

    if (act === 'save-comp') {
      const row = t.closest('[data-comp-id]');
      if (!row) return;
      const id = row.dataset.compId;
      const valInput = row.querySelector('[data-edit-field="value"]');
      const newVal = parseFloat(valInput.value);
      if (isNaN(newVal)) { alert('Valeur invalide'); return; }
      try {
        // PUT générique sur le composant
        await _apiPut('/api/admin/cost-components/' + id, { default_value: newVal })
          .catch(() => _apiPut('/api/admin/pricing-components/' + id, { default_value: newVal }));
        _ps.editingCompId = null;
        await _loadAll();
        // Recalculer si on a un produit/simulation
        if ((_ps.buildMode === 'catalog' && _ps.selectedProductId) ||
            (_ps.buildMode === 'simulation' && _ps.inputPrixAchat > 0)) {
          _scheduleRecalc(container, 50);
        } else {
          _renderHTML(container);
        }
      } catch (err) {
        alert('Erreur de sauvegarde : ' + err.message);
      }
      return;
    }

    if (act === 'toggle-comp') {
      const row = t.closest('[data-comp-id]');
      if (!row) return;
      const id = row.dataset.compId;
      try {
        await _apiPost('/api/admin/cost-components/' + id + '/toggle')
          .catch(() => _apiPut('/api/admin/pricing-components/' + id + '/toggle'));
        await _loadAll();
        if ((_ps.buildMode === 'catalog' && _ps.selectedProductId) ||
            (_ps.buildMode === 'simulation' && _ps.inputPrixAchat > 0)) {
          _scheduleRecalc(container, 50);
        } else {
          _renderHTML(container);
        }
      } catch (err) {
        alert('Erreur toggle : ' + err.message);
      }
      return;
    }

    // Apply scenario
    if (act === 'apply-scenario') {
      const productId = t.dataset.productId;
      const price = Number(t.dataset.price);
      const scenarioId = t.dataset.scenarioId;
      const scenarioLabel = t.dataset.scenarioLabel;
      const levier = t.dataset.levier || null;
      const survival = Number(t.dataset.survival);

      if (price < survival) {
        alert('⚠️ Prix sous le seuil de survie. Application bloquée.');
        return;
      }
      const msg = 'Appliquer le scénario "' + scenarioLabel + '" ?\n\n' +
        'Prix : ' + price.toLocaleString('fr-FR') + ' KMF' +
        (levier ? '\nLevier : ' + levier : '') +
        '\n\nL\'audit sera enregistré dans price_history.';
      if (!confirm(msg)) return;

      t.disabled = true;
      t.textContent = '⏳ Application...';
      try {
        const res = await fetch('/api/pricing/apply-price/' + encodeURIComponent(productId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            price_kmf: price, source: 'scenario',
            scenario_id: scenarioId, scenario_label: scenarioLabel,
            levier: levier, survival_price_kmf: survival,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'HTTP ' + res.status);
        }
        t.textContent = '✅ Appliqué !';
        setTimeout(() => _scheduleRecalc(container, 100), 800);
      } catch (err) {
        alert('Erreur : ' + err.message);
        t.disabled = false;
      }
      return;
    }
  });
}

/* ─── ENTRY POINT ────────────────────────────────────────────────────── */
CT.views.pricing = async function(container) {
  await _render(container);
};

})();
