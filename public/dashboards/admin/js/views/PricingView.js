/**
 * @komerce-arch
 * @role          admin-pricing-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        product list, cost components, pricing data
 * @outputs       pricing_page_dom (construction du prix par produit)
 * @depends       api-client.js, filters-store.js, utils.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  pricing, cost-components, economic-engine, admin-dashboard
 * @version       2026-06
 */

'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 *  PricingView.js — Komerce Control Tower
 *  🧮 Construction du Prix — Atelier de décision produit
 *  Migration legacy → IIFE global.PricingView
 *
 *  Zone 1 : Kanban 4 colonnes (Objet / Coût relais / Coût business / Décision)
 *  Zone 2 : Résumé lecture seule de la composition du coût
 * ═══════════════════════════════════════════════════════════════════════════ */

(function(global) {
'use strict';

/* ─── ÉTAT ──────────────────────────────────────────────────────────────── */
const _ps = {
  config: null,
  categories: [],
  components: [],
  provisions: [],
  catalog: [],
  loaded: false,
  buildMode: 'catalog',
  selectedProductId: null,
  inputCategory: 'phones',
  inputPrixAchat: 0,
  inputCurrency: 'AED',
  inputDimL: 0, inputDimW: 0, inputDimH: 0,
  inputPoidsKg: 0,
  inputChannel: 'cash_relais',
  currentReco: null,
  selectedScenarioId: null,
  isComputing: false,
  lastError: null,
  showAllComponents: false,
  editingCompId: null,
};

/* ─── HELPERS ───────────────────────────────────────────────────────────── */
const _nf = new Intl.NumberFormat('fr-FR');
const _fmt = (n) => _nf.format(Math.round(n || 0)) + ' KMF';
const _fmtNum = (n, dec) => _nf.format(Number((Number(n) || 0).toFixed(dec || 0)));
function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function _api(method, path, body) {
  const opts = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error('API ' + res.status + ' : ' + txt.slice(0, 200)); }
  return res.json();
}
function _userCanApply() {
  const role = (window.CT && CT.platform && CT.platform.state && CT.platform.state.role) || '';
  return role === 'admin';
}

/* ─── DONNÉES ───────────────────────────────────────────────────────────── */
async function _loadAll() {
  const [cfg, cats, comps, provs] = await Promise.all([
    _api('GET', '/api/admin/finance-config').catch(() => null),
    _api('GET', '/api/admin/customs-categories').catch(() => []),
    _api('GET', '/api/admin/cost-components').catch(() => _api('GET', '/api/admin/pricing-components').catch(() => [])),
    _api('GET', '/api/admin/risk-provisions').catch(() => []),
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
    const r = await _api('POST', '/api/pricing/recommend-batch', { limit: 200 });
    _ps.catalog = r.items || [];
  } catch (err) {
    _ps.catalog = [];
  }
}

async function _computeReco() {
  const compatFx = _ps.config?.fx?.pricing_view_current_compat || null;
  // Fallbacks = comportement exact pré-1A-2, uniquement pour compat old-server
  // ou indisponibilité config. La source nominale est désormais l'API finance.
  const tauxAed = Number(compatFx?.aed_kmf) || 138;
  const tauxEur = Number(compatFx?.eur_kmf) || 492;
  const tauxUsd = Number(compatFx?.usd_kmf) || 452.64;
  function toAED(amount, cur) {
    const v = Number(amount) || 0; if (!v) return 0;
    if (cur === 'AED') return v;
    if (cur === 'KMF') return v / tauxAed;
    if (cur === 'EUR') return (v * tauxEur) / tauxAed;
    if (cur === 'USD') return (v * tauxUsd) / tauxAed;
    return v;
  }
  const volM3 = (_ps.inputDimL * _ps.inputDimW * _ps.inputDimH) / 1_000_000;
  const prixAed = toAED(_ps.inputPrixAchat, _ps.inputCurrency || 'AED');
  const body = {
    product_id: (_ps.buildMode === 'catalog' && _ps.selectedProductId) ? _ps.selectedProductId : null,
    category: _ps.inputCategory, prix_aed: prixAed,
    volume_m3: volM3 || 0.005, poids_kg: _ps.inputPoidsKg || 0.5,
    channel: _ps.inputChannel, is_diaspora: _ps.inputChannel === 'diaspora', verbose: true,
  };
  const reco = await _api('POST', '/api/pricing/recommend', body);
  _ps.currentReco = reco; _ps.lastError = null;
  return reco;
}

let _recalcTimer = null;
function _scheduleRecalc(container, delayMs) {
  clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(async () => {
    if (_ps.buildMode === 'catalog' && !_ps.selectedProductId) return;
    if (_ps.buildMode === 'simulation' && (!_ps.inputPrixAchat || _ps.inputPrixAchat <= 0)) return;
    // Guard : navigation entre-temps → container détaché du DOM
    if (!container || !document.contains(container)) return;
    _ps.isComputing = true; _renderHTML(container);
    try { await _computeReco(); }
    catch (err) { _ps.lastError = err.message || 'Erreur inconnue'; _ps.currentReco = null; }
    finally {
      _ps.isComputing = false;
      if (!container || !document.contains(container)) return;
      _renderHTML(container);
    }
  }, delayMs || 300);
}

/* ─── RENDU ZONE 1 : COLONNES ───────────────────────────────────────────── */
function _kanbanCol(num, color, title, body) {
  return '<div class="apv-kcol apv-kcol-' + color + '"><header class="apv-kcol-head"><span class="apv-kcol-num">' + num + '</span><div class="apv-kcol-title">' + title + '</div></header><div class="apv-kcol-body">' + body + '</div></div>';
}

function _renderColObjet() {
  const mode = _ps.buildMode;
  let html = '<div class="apv-mode-toggle">';
  html += '<label class="' + (mode === 'catalog' ? 'active' : '') + '"><input type="radio" name="apv-mode" data-act="set-mode" data-mode="catalog" ' + (mode === 'catalog' ? 'checked' : '') + '><span>📦 Catalogue</span></label>';
  html += '<label class="' + (mode === 'simulation' ? 'active' : '') + '"><input type="radio" name="apv-mode" data-act="set-mode" data-mode="simulation" ' + (mode === 'simulation' ? 'checked' : '') + '><span>🧪 Simulation</span></label>';
  html += '</div>';
  html += '<div class="apv-field">';
  if (mode === 'catalog') {
    html += '<label class="apv-label">Produit du catalogue</label><select class="apv-input" data-input="product-select"><option value="">— Choisir —</option>';
    (_ps.catalog || []).forEach(it => {
      html += '<option value="' + _esc(it.product_id) + '"' + (_ps.selectedProductId === it.product_id ? ' selected' : '') + '>' + _esc(it.name).slice(0, 40) + ' — ' + _fmt(it.current_price_kmf) + '</option>';
    });
    html += '</select>';
    if (!_ps.catalog?.length) html += '<div class="apv-hint apv-hint-warn">Aucun produit chargé.</div>';
  } else {
    html += '<label class="apv-label">Catégorie</label><select class="apv-input" data-input="category">';
    (_ps.categories || []).forEach(c => { html += '<option value="' + _esc(c.key) + '"' + (_ps.inputCategory === c.key ? ' selected' : '') + '>' + _esc(c.label || c.key) + '</option>'; });
    html += '</select>';
  }
  html += '</div>';
  if (mode === 'simulation') {
    html += '<div class="apv-field"><label class="apv-label">Prix achat</label><div class="apv-row">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="prix_achat" value="' + (_ps.inputPrixAchat || 0) + '" min="0" step="0.01">';
    html += '<select class="apv-input apv-input-cur" data-input="currency">';
    ['AED','EUR','USD','KMF'].forEach(c => { html += '<option value="' + c + '"' + (_ps.inputCurrency === c ? ' selected' : '') + '>' + c + '</option>'; });
    html += '</select></div></div>';
    html += '<div class="apv-field"><label class="apv-label">Poids (kg)</label><input type="number" class="apv-input apv-input-num" data-input="poids_kg" value="' + (_ps.inputPoidsKg || 0) + '" min="0" step="0.01"></div>';
    html += '<div class="apv-field"><label class="apv-label">Dimensions (cm)</label><div class="apv-row">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="dim_l" value="' + (_ps.inputDimL || 0) + '" min="0" placeholder="L">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="dim_w" value="' + (_ps.inputDimW || 0) + '" min="0" placeholder="l">';
    html += '<input type="number" class="apv-input apv-input-num" data-input="dim_h" value="' + (_ps.inputDimH || 0) + '" min="0" placeholder="h">';
    html += '</div></div>';
  }
  html += '<div class="apv-field"><label class="apv-label">Canal de vente</label><select class="apv-input" data-input="channel">';
  html += '<option value="cash_relais"' + (_ps.inputChannel === 'cash_relais' ? ' selected' : '') + '>Cash relais</option>';
  html += '<option value="diaspora"' + (_ps.inputChannel === 'diaspora' ? ' selected' : '') + '>Diaspora (carte)</option>';
  html += '</select></div>';
  return html;
}

function _renderColRelais() {
  if (_ps.lastError) return '<div class="apv-kempty apv-kempty-error">⚠️ Calcul échoué</div>';
  const r = _ps.currentReco;
  if (!r) return '<div class="apv-kempty">' + (_ps.buildMode === 'catalog' && !_ps.selectedProductId ? 'Sélectionnez un produit' : 'En attente du calcul…') + '</div>';
  const breakdown = r.cost_breakdown || { landed_relay: {} };
  const landed = breakdown.landed_relay || {};
  const total = r.landed_relay_cost_kmf || 0;
  const allocations = breakdown.allocations || [];
  const allocAvg = breakdown.allocation_averages || {};
  let html = '<div class="apv-ktotal apv-ktotal-blue"><div class="apv-ktotal-label">Total imputé à l\'article</div><div class="apv-ktotal-value">' + _fmt(total) + '</div></div>';
  const lines = [['🛒','Achat fournisseur',landed.product_purchase],['🔍','Sourcing',landed.sourcing],['🏬','Hub Dubai',landed.hub],['📦','Emballage',landed.packaging],['🚢','Fret',landed.freight],['🛃','Douane',landed.customs],['📋','Port / transitaire',landed.port_transitary],['🚚','Distribution locale',landed.local_distribution],['🏪','Relais',landed.relay]];
  let linesBody = '';
  lines.forEach(([emoji, label, val]) => {
    linesBody += '<div class="apv-kline"><span class="apv-kline-icon">' + emoji + '</span><span class="apv-kline-label">' + label + '</span><span class="apv-kline-val">' + (val > 0 ? _fmt(val) : '—') + '</span></div>';
  });
  html += _kSection('relais-detail', 'Détail (9 lignes)', linesBody, false);
  if (allocations.length > 0 && allocations.some(a => a.engaged_level !== 'article')) {
    let allocBody = '<p class="apv-mini-text">Coûts agrégés (shipment/colis/commande) divisés et imputés à l\'article.</p><div class="apv-alloc-table"><div class="apv-alloc-head"><span>Composant</span><span>Engagé</span><span>Niveau ÷</span><span>Imputé</span></div>';
    allocations.forEach(a => {
      const isAgg = a.engaged_level !== 'article';
      const lvl = ({shipment:'shipment ÷ ' + (allocAvg.articles_per_shipment||200),parcel:'colis ÷ '+(allocAvg.articles_per_parcel||4),order:'commande ÷ '+(allocAvg.articles_per_order||2.5),article:'—'})[a.engaged_level] || a.engaged_level;
      allocBody += '<div class="apv-alloc-row' + (isAgg ? ' apv-alloc-agg' : '') + '"><span>' + _esc(a.component_label||a.component_key||'') + '</span><span class="apv-num apv-dim">' + _fmt(a.engaged_amount_kmf) + '</span><span class="apv-lvl">' + lvl + '</span><span class="apv-num apv-bold">' + _fmt(a.imputed_amount_kmf) + '</span></div>';
    });
    allocBody += '</div>' + (allocAvg.confidence === 'low' ? '<p class="apv-warn-inline">⚠️ Moyennes non calibrées.</p>' : '');
    html += _kSection('imputation', '🏗️ Imputation détaillée', allocBody, false);
  }
  return html;
}

function _renderColBusiness() {
  if (_ps.lastError) return '<div class="apv-kempty apv-kempty-error">⚠️</div>';
  const r = _ps.currentReco;
  if (!r) return '<div class="apv-kempty">En attente du calcul…</div>';
  const business = (r.cost_breakdown || {}).business || {};
  const n1  = r.n1_landed_relay_cost_kmf || r.landed_relay_cost_kmf || 0;
  const n2  = r.n2_business_variable_cost_kmf != null ? r.n2_business_variable_cost_kmf : ((business.payment || 0) + (business.risk_provision || 0));
  const cvc = r.variable_cost_complete_kmf != null ? r.variable_cost_complete_kmf : (n1 + n2);
  const n3  = r.n3_fixed_overhead_allocation_kmf != null ? r.n3_fixed_overhead_allocation_kmf : (business.fixed_overhead || 0);
  const cdr = r.cdr_complete_kmf != null ? r.cdr_complete_kmf : (cvc + n3);
  const price = r.current_price_kmf || 0;
  const contribution = r.contribution_kmf != null ? r.contribution_kmf : (price > 0 ? price - cvc : null);
  const margeComplete = price > 0 ? price - cdr : null;

  let html = '<div class="apv-ktotal apv-ktotal-green"><div class="apv-ktotal-label">CDR complet · N1+N2+N3</div><div class="apv-ktotal-value">' + _fmt(cdr) + '</div></div>';

  // N2 business variable
  let n2Body = '<div class="apv-kline apv-kline-report"><span class="apv-kline-icon">═</span><span class="apv-kline-label">N1 · coût rendu relais (report)</span><span class="apv-kline-val">' + _fmt(n1) + '</span></div>';
  [['💳','Frais paiement',business.payment],['🛡️','Provision risque',business.risk_provision]].forEach(([emoji,label,val]) => {
    n2Body += '<div class="apv-kline"><span class="apv-kline-icon">' + emoji + '</span><span class="apv-kline-label">' + label + '</span><span class="apv-kline-val">' + (val > 0 ? '+ ' + _fmt(val) : '—') + '</span></div>';
  });
  n2Body += '<div class="apv-kline" style="border-top:1px solid #e2e8f0;font-weight:700;"><span class="apv-kline-label">N2 · business variable</span><span class="apv-kline-val">' + _fmt(n2) + '</span></div>';
  html += _kSection('n2-detail', '🟢 N2 · business variable', n2Body, false);

  // Frontière rouge
  html += '<div class="apv-kline" style="background:#fef2f2;border-left:3px solid #dc2626;padding:8px 10px;margin:6px 0;border-radius:0 6px 6px 0;"><span class="apv-kline-label" style="color:#b91c1c;font-weight:700;">🔴 Coût variable complet (N1+N2)</span><span class="apv-kline-val" style="color:#b91c1c;font-weight:800;">' + _fmt(cvc) + '</span></div>';
  html += '<p class="apv-mini-text apv-italic" style="margin:0 0 8px 4px;">Sous cette ligne, chaque vente détruit de l\'argent.</p>';

  // N3
  let n3Body = '<div class="apv-kline"><span class="apv-kline-icon">🏢</span><span class="apv-kline-label">Charges fixes imputées / article</span><span class="apv-kline-val">' + _fmt(n3) + '</span></div>';
  if (r.n3_formula) n3Body += '<p class="apv-mini-text" style="margin:4px 0 0 4px;">' + _esc(r.n3_formula) + '</p>';
  html += _kSection('n3-detail', '🟠 N3 · charges fixes imputées', n3Body, false);

  // Contribution vs marge complète
  if (price > 0) {
    const contribColor = contribution >= 0 ? '#166534' : '#b91c1c';
    const margeColor = margeComplete >= 0 ? '#166534' : '#a16207';
    let cBody = '<div class="apv-kline"><span class="apv-kline-label">Prix de vente actuel</span><span class="apv-kline-val">' + _fmt(price) + '</span></div>';
    cBody += '<div class="apv-kline"><span class="apv-kline-label">Contribution <span style="color:#94a3b8;">(prix − coût variable)</span></span><span class="apv-kline-val" style="color:' + contribColor + ';font-weight:700;">' + _fmt(contribution) + '</span></div>';
    cBody += '<div class="apv-kline"><span class="apv-kline-label">Marge complète <span style="color:#94a3b8;">(prix − CDR)</span></span><span class="apv-kline-val" style="color:' + margeColor + ';font-weight:700;">' + _fmt(margeComplete) + '</span></div>';
    cBody += '<p class="apv-mini-text apv-italic" style="margin:4px 0 0 4px;">La contribution couvre les charges fixes ; la marge complète, c\'est ce qui reste une fois la structure payée.</p>';
    html += _kSection('contrib-detail', '🟣 Contribution & marge complète', cBody, true);
  }

  if (r.monthly_break_even_orders || r.target_orders_per_month) {
    let pilBody = '';
    if (r.target_orders_per_month) pilBody += '<div class="apv-kline"><span class="apv-kline-label">Cible mensuelle</span><span class="apv-kline-val">' + r.target_orders_per_month + ' commandes</span></div>';
    if (r.monthly_break_even_orders) pilBody += '<div class="apv-kline"><span class="apv-kline-label">Seuil rentabilité</span><span class="apv-kline-val">' + r.monthly_break_even_orders + ' cmd/mois</span></div>';
    if (r.monthly_fixed_costs_kmf) pilBody += '<div class="apv-kline"><span class="apv-kline-label">Charges fixes</span><span class="apv-kline-val">' + _fmt(r.monthly_fixed_costs_kmf) + '/mois</span></div>';
    html += _kSection('biz-pilot', 'Pilotage charges fixes', pilBody, false);
  }
  return html;
}

function _renderColDecision() {
  if (_ps.lastError) return '<div class="apv-kempty apv-kempty-error">⚠️</div>';
  const r = _ps.currentReco;
  if (!r) return '<div class="apv-kempty">Le moteur affichera ici les scénarios de prix.</div>';
  const scenarios = r.scenarios || [];
  const selectedId = _ps.selectedScenarioId || r.recommended_scenario_id || 'honest_baseline';
  const selected = scenarios.find(s => s.id === selectedId) || scenarios[0];

  if (!scenarios.length) {
    return '<div class="apv-ktotal apv-ktotal-decision"><div><div class="apv-ktotal-label">Prix conseillé</div><div class="apv-ktotal-value">' + _fmt(r.recommended_price_kmf) + '</div></div></div><div class="apv-kempty">Doctrine V3 (5 scénarios) en attente du backend.</div>';
  }

  let html = '';
  if (selected) {
    const decisionMap = { PRIORITY:{color:'#3b82f6'}, TEST:{color:'#16a34a'}, WATCH:{color:'#f59e0b'}, AVOID:{color:'#dc2626'}, LOSS:{color:'#7f1d1d'} };
    const dec = decisionMap[r.sourcing_decision] || { color:'#94a3b8' };
    html += '<div class="apv-ktotal apv-ktotal-decision"><div><div class="apv-ktotal-label">' + _esc(selected.label) + '</div><div class="apv-ktotal-value">' + _fmt(selected.price_kmf) + '</div></div>';
    html += '<span class="apv-decision-badge" style="background:' + dec.color + ';">' + _esc(r.sourcing_decision || '—') + '</span></div>';
  }

  let body = '';
  scenarios.forEach(s => {
    const isSel = (s.id === selectedId);
    const marginColor = s.margin_pct >= 15 ? '#16a34a' : s.margin_pct >= 5 ? '#f59e0b' : '#dc2626';
    const cls = ['apv-scenario', isSel ? 'apv-scenario-selected' : '', !s.selectable ? 'apv-scenario-disabled' : '', s.is_recommended ? 'apv-scenario-rec' : ''].filter(Boolean).join(' ');
    body += '<div class="' + cls + '" data-scenario-id="' + _esc(s.id) + '"' + (s.selectable ? ' role="button" tabindex="0"' : '') + '>';
    body += '<div class="apv-scenario-head"><span class="apv-scenario-radio">' + (isSel ? '●' : '○') + '</span><span class="apv-scenario-label">' + _esc(s.label) + '</span>';
    if (s.is_recommended) body += '<span class="apv-tag apv-tag-rec">★ recommandé</span>';
    if (!s.selectable) body += '<span class="apv-tag apv-tag-block">⚠️ sous survie</span>';
    body += '</div><div class="apv-scenario-prices"><span class="apv-scenario-price">' + _fmt(s.price_kmf) + '</span><span style="color:' + marginColor + ';font-size:.74rem;font-weight:600;">marge ' + s.margin_pct + '%</span></div>';
    if (s.short_description) body += '<div class="apv-scenario-desc">' + _esc(s.short_description) + '</div>';
    body += '</div>';
  });
  html += _kSection('scenarios', 'Scénarios d\'imputation', body, true);

  if (selected) {
    let dBody = '';
    if (selected.explanation) dBody += '<p class="apv-mini-text apv-italic">' + _esc(selected.explanation) + '</p>';
    dBody += '<div class="apv-kline"><span class="apv-kline-label">Prix de vente</span><span class="apv-kline-val apv-bold-big">' + _fmt(selected.price_kmf) + '</span></div>';
    dBody += '<div class="apv-kline"><span class="apv-kline-label">Coût imputé</span><span class="apv-kline-val">' + _fmt(selected.cost_imputed_kmf) + '</span></div>';
    const margeColor = selected.margin_pct >= 15 ? '#16a34a' : '#f59e0b';
    dBody += '<div class="apv-kline"><span class="apv-kline-label">Marge brute</span><span class="apv-kline-val" style="color:' + margeColor + ';font-weight:700;">' + _fmt(selected.margin_kmf) + ' (' + selected.margin_pct + '%)</span></div>';
    if (selected.economy_vs_baseline_kmf) dBody += '<div class="apv-kline"><span class="apv-kline-label">Économie vs baseline</span><span class="apv-kline-val" style="color:#16a34a;">−' + _fmt(selected.economy_vs_baseline_kmf) + '</span></div>';
    html += _kSection('selected-detail', 'Détail du scénario', dBody, false);
  }

  let safeBody = '<div class="apv-kline"><span class="apv-kline-label">🔴 Coût variable complet</span><span class="apv-kline-val">' + _fmt(r.variable_cost_complete_kmf || r.survival_price_kmf) + '</span></div>';
  safeBody += '<div class="apv-kline"><span class="apv-kline-label">🟤 CDR complet</span><span class="apv-kline-val">' + _fmt(r.cdr_complete_kmf || r.cost_complete_estimated_kmf) + '</span></div>';
  safeBody += '<div class="apv-kline"><span class="apv-kline-label">🛡️ Prix plancher (sécurité)</span><span class="apv-kline-val">' + _fmt(r.minimum_safe_price_kmf) + '</span></div>';
  safeBody += '<p class="apv-mini-text apv-italic" style="margin:4px 0 0 4px;">Plancher = coût variable + marge de sécurité. Il n\'est jamais égal au CDR.</p>';
  html += _kSection('safety', '🚧 Frontières & plancher', safeBody, false);

  if (selected && selected.selectable && _userCanApply() && r.product_id) {
    html += '<div class="apv-apply-zone"><button class="apv-apply-btn" data-act="apply-scenario" data-product-id="' + _esc(r.product_id) + '" data-price="' + selected.price_kmf + '" data-scenario-id="' + _esc(selected.id) + '" data-scenario-label="' + _esc(selected.label) + '" data-levier="' + _esc(selected.levier||'') + '" data-survival="' + r.survival_price_kmf + '">✓ Appliquer ce scénario (' + _fmt(selected.price_kmf) + ')</button></div>';
  }
  return html;
}

function _kSection(id, title, body, openByDefault) {
  return '<details class="apv-ksection"' + (openByDefault ? ' open' : '') + '><summary class="apv-ksection-head">' + title + '</summary><div class="apv-ksection-body">' + body + '</div></details>';
}

/* ─── RENDU ZONE 2 : RÉSUMÉ COÛT ────────────────────────────────────────── */
function _renderZone2() {
  let html = '<section class="apv-zone apv-zone2 apv-zone2--summary">';
  html += '<div class="apv-zone-head"><h2 class="apv-zone-title">📦 Lire la composition du coût</h2><span class="apv-zone-sub">Lecture seule. Pour modifier les règles :</span><div class="apv-zone-actions"><button class="apv-btn apv-btn-ghost" data-act="open-workshop">⚙️ Configurer les composants</button></div></div>';

  if (!_ps.currentReco) {
    html += '<div class="apv-empty apv-empty-info">💡 Sélectionnez un produit ou lancez une simulation pour voir la décomposition du coût.</div></section>';
    return html;
  }

  const breakdown = _ps.currentReco.cost_breakdown || {};
  const landed = breakdown.landed_relay || {};
  const business = breakdown.business || {};

  const LANDED_ROWS = [{key:'product_purchase',emoji:'🛒',label:'Achat fournisseur'},{key:'sourcing',emoji:'🔍',label:'Sourcing'},{key:'hub',emoji:'🏬',label:'Hub Dubai'},{key:'packaging',emoji:'📦',label:'Emballage'},{key:'freight',emoji:'🚢',label:'Fret international'},{key:'customs',emoji:'🛃',label:'Douane / TVA'},{key:'port_transitary',emoji:'📋',label:'Port / transitaire'},{key:'local_distribution',emoji:'🚚',label:'Distribution locale'},{key:'relay',emoji:'🏪',label:'Commission relais'}];
  const BUSINESS_ROWS = [{key:'payment',emoji:'💳',label:'Frais paiement'},{key:'risk_provision',emoji:'🛡️',label:'Provision risques'},{key:'fixed_overhead',emoji:'🏢',label:'Charges fixes (imputées)'}];

  const renderRow = (row, src) => {
    const v = src[row.key] != null ? Number(src[row.key]) : 0;
    if (v <= 0) return '';
    return '<div class="apv-summary-row"><span class="apv-summary-row-emoji">' + row.emoji + '</span><span class="apv-summary-row-label">' + _esc(row.label) + '</span><span class="apv-summary-row-value">' + _fmt(v) + '</span></div>';
  };

  html += '<div class="apv-summary-block apv-summary-block--landed">';
  html += '<div class="apv-summary-block-head"><span class="apv-summary-block-title">📦 Coût rendu relais</span><span class="apv-summary-block-total">' + _fmt(_ps.currentReco.landed_relay_cost_kmf) + '</span></div>';
  html += '<div class="apv-summary-block-body">';
  const seenKeys = new Set();
  LANDED_ROWS.forEach(r => { if (!seenKeys.has(r.label)) { const rendered = renderRow(r, landed); if (rendered) { html += rendered; seenKeys.add(r.label); } } });
  html += '</div></div>';

  html += '<div class="apv-summary-block apv-summary-block--business">';
  const businessOnly = (Number(_ps.currentReco.business_complete_cost_kmf)||0) - (Number(_ps.currentReco.landed_relay_cost_kmf)||0);
  html += '<div class="apv-summary-block-head"><span class="apv-summary-block-title">💼 Frais business</span><span class="apv-summary-block-total">' + _fmt(businessOnly) + '</span></div>';
  html += '<div class="apv-summary-block-body">';
  BUSINESS_ROWS.forEach(r => { html += renderRow(r, business); });
  html += '</div></div>';

  html += '<div class="apv-summary-totals">';
  html += '<div class="apv-summary-total-row"><span class="apv-summary-total-label">Coût rendu relais</span><span class="apv-summary-total-value">' + _fmt(_ps.currentReco.landed_relay_cost_kmf) + '</span></div>';
  html += '<div class="apv-summary-total-row apv-summary-total-row--final"><span class="apv-summary-total-label">Coût complet business</span><span class="apv-summary-total-value">' + _fmt(_ps.currentReco.business_complete_cost_kmf) + '</span></div>';
  html += '</div>';

  const dq = _ps.currentReco.data_quality || {};
  if (dq.confidence === 'low' || (dq.warnings && dq.warnings.length > 0)) {
    html += '<div class="apv-summary-alert"><span>⚠️</span><div>';
    if (dq.confidence === 'low') html += '<strong>Confidence faible</strong> : les hypothèses d\'allocation ne sont pas calibrées.';
    else if (dq.warnings && dq.warnings.length) html += '<strong>' + dq.warnings.length + ' avertissement(s)</strong> : ' + _esc(dq.warnings[0]);
    html += '</div></div>';
  }

  html += '</section>';
  return html;
}

/* ─── RENDU PRINCIPAL ───────────────────────────────────────────────────── */
function _renderHTML(container) {
  _injectStyles();
  let html = '<div class="apv-wrap">';
  html += '<header class="apv-header"><h1 class="apv-h1">🧮 Construction du Prix</h1><p class="apv-sub">Comprendre le coût, choisir un prix, puis affiner le modèle si nécessaire.</p><div class="apv-tools"><button class="apv-btn apv-btn-secondary" data-act="refresh">🔄 Rafraîchir</button></div></header>';

  html += '<section class="apv-zone apv-zone1">';
  html += '<div class="apv-zone-head"><h2 class="apv-zone-title">📊 Décider sur un produit</h2><span class="apv-zone-sub">Choisissez un produit ou simulez-en un, puis laissez le moteur calculer le coût et le prix conseillé.</span>' + (_ps.isComputing ? '<span class="apv-spinner">⏳</span>' : '') + '</div>';
  html += '<div class="apv-kanban">';
  html += _kanbanCol(1, 'gray',  '🎯 Objet',                _renderColObjet());
  html += _kanbanCol(2, 'blue',  '📦 Coût rendu relais',    _renderColRelais());
  html += _kanbanCol(3, 'green', '💼 N2, N3 → CDR complet', _renderColBusiness());
  html += _kanbanCol(4, 'amber', '🎯 Décision',             _renderColDecision());
  html += '</div>';

  if (_ps.currentReco) {
    const r = _ps.currentReco;
    html += '<div class="apv-doctrinal"><span class="apv-doctrinal-icon">💡</span><div class="apv-doctrinal-text">Cet objet coûte <strong>' + _fmt(r.landed_relay_cost_kmf) + '</strong> rendu relais. Coût complet : <strong>' + _fmt(r.business_complete_cost_kmf || r.cost_complete_estimated_kmf) + '</strong>. Ne pas vendre sous <strong>' + _fmt(r.minimum_safe_price_kmf) + '</strong>. Conseillé : <strong>' + _fmt(r.recommended_price_kmf) + '</strong>.</div></div>';
  }
  if (_ps.lastError) {
    html += '<div class="apv-error-banner"><strong>⚠️ Erreur de calcul :</strong> ' + _esc(_ps.lastError) + '<div class="apv-error-hint">Vérifiez que tous les composants de coût sont calibrés.</div></div>';
  }
  html += '</section>';
  html += _renderZone2();
  html += '</div>';
  container.innerHTML = html;
  _bindEvents(container);
}

/* ─── EVENTS ────────────────────────────────────────────────────────────── */
function _bindEvents(container) {
  const inputHandler = (e) => {
    const t = e.target.closest('[data-input]');
    if (!t) return;
    const f = t.dataset.input;
    if (f === 'product-select') {
      _ps.selectedProductId = t.value || null;
      const item = (_ps.catalog || []).find(c => c.product_id === _ps.selectedProductId);
      if (item) {
        if (item.category) _ps.inputCategory = item.category;
        if (item.cost_kmf != null) { _ps.inputPrixAchat = Number(item.cost_kmf)||0; _ps.inputCurrency = 'KMF'; }
        if (item.weight_kg != null) _ps.inputPoidsKg = Number(item.weight_kg)||0;
        if (item.volume_m3 > 0 && !_ps.inputDimL) { const side = Math.cbrt(Number(item.volume_m3)*1e6); _ps.inputDimL = _ps.inputDimW = _ps.inputDimH = Math.round(side); }
      }
      _renderHTML(container); _scheduleRecalc(container, 100); return;
    }
    if (f === 'category')   _ps.inputCategory = t.value;
    else if (f === 'prix_achat') _ps.inputPrixAchat = parseFloat(t.value)||0;
    else if (f === 'currency')   _ps.inputCurrency = t.value||'AED';
    else if (f === 'poids_kg')   _ps.inputPoidsKg = parseFloat(t.value)||0;
    else if (f === 'dim_l')      _ps.inputDimL = parseFloat(t.value)||0;
    else if (f === 'dim_w')      _ps.inputDimW = parseFloat(t.value)||0;
    else if (f === 'dim_h')      _ps.inputDimH = parseFloat(t.value)||0;
    else if (f === 'channel')    _ps.inputChannel = t.value;
    _scheduleRecalc(container, 300);
  };
  container.addEventListener('change', inputHandler);
  container.addEventListener('input', inputHandler);

  container.addEventListener('click', async (e) => {
    const scenarioCard = e.target.closest('.apv-scenario');
    if (scenarioCard && !scenarioCard.classList.contains('apv-scenario-disabled')) {
      _ps.selectedScenarioId = scenarioCard.dataset.scenarioId;
      _renderHTML(container); return;
    }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;

    if (act === 'set-mode') { _ps.buildMode = t.dataset.mode||'catalog'; _ps.currentReco = null; _ps.lastError = null; _renderHTML(container); return; }

    if (act === 'refresh') {
      t.disabled = true; t.textContent = '⏳ Actualisation...';
      try { await _loadAll(); await _loadCatalog(); _renderHTML(container); if ((_ps.buildMode === 'catalog' && _ps.selectedProductId) || (_ps.buildMode === 'simulation' && _ps.inputPrixAchat > 0)) _scheduleRecalc(container, 100); }
      catch (err) { alert('Erreur : ' + err.message); t.disabled = false; t.textContent = '🔄 Rafraîchir'; }
      return;
    }

    if (act === 'open-workshop') {
      if (window.KmcApp && typeof KmcApp.navigate === 'function') KmcApp.navigate('pricing_workshop');
      else window.location.hash = '#pricing_workshop';
      return;
    }

    if (act === 'apply-scenario') {
      const productId = t.dataset.productId;
      const price = Number(t.dataset.price);
      const scenarioId = t.dataset.scenarioId;
      const scenarioLabel = t.dataset.scenarioLabel;
      const levier = t.dataset.levier||null;
      const survival = Number(t.dataset.survival);
      if (price < survival) { alert('⚠️ Prix sous le seuil de survie. Application bloquée.'); return; }
      if (!confirm('Appliquer le scénario "' + scenarioLabel + '" ?\n\nPrix : ' + price.toLocaleString('fr-FR') + ' KMF' + (levier ? '\nLevier : ' + levier : '') + '\n\nL\'audit sera enregistré dans price_history.')) return;
      t.disabled = true; t.textContent = '⏳ Application...';
      try {
        await _api('PUT', '/api/pricing/apply-price/' + encodeURIComponent(productId), { price_kmf:price, source:'scenario', scenario_id:scenarioId, scenario_label:scenarioLabel, levier, survival_price_kmf:survival });
        t.textContent = '✅ Appliqué !';
        setTimeout(() => _scheduleRecalc(container, 100), 800);
      } catch (err) { alert('Erreur : ' + err.message); t.disabled = false; }
      return;
    }
  });
}

/* ─── STYLES ────────────────────────────────────────────────────────────── */
function _injectStyles() {
  if (document.getElementById('apv-styles')) return;
  const s = document.createElement('style'); s.id = 'apv-styles';
  s.textContent = `
    .apv-wrap { padding:16px 20px; max-width:1400px; margin:0 auto; color:#1e293b; }
    .apv-h1 { font-size:1.4rem; font-weight:800; margin:0 0 4px; }
    .apv-sub { font-size:.85rem; color:#64748b; margin:0 0 14px; }
    .apv-header { margin-bottom:16px; }
    .apv-tools { display:flex; gap:10px; }
    .apv-btn { padding:7px 14px; font-size:.85rem; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid transparent; transition:all .15s; font-family:inherit; }
    .apv-btn-secondary { background:#fff; color:#1e293b; border-color:#cbd5e1; }
    .apv-btn-secondary:hover { background:#f8fafc; }
    .apv-btn-ghost { background:transparent; color:#64748b; border:none; padding:5px 10px; font-size:.8rem; }
    .apv-btn-ghost:hover { color:#1e293b; background:#f1f5f9; }
    .apv-loading, .apv-error, .apv-empty { padding:40px 20px; text-align:center; color:#64748b; font-size:.9rem; }
    .apv-error { color:#b91c1c; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; }
    .apv-empty-info { background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; border-radius:8px; padding:14px; }
    .apv-zone { background:#fff; border:1px solid #e2e8f0; border-radius:10px; margin-bottom:16px; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,.03); }
    .apv-zone-head { display:flex; align-items:center; padding:14px 18px; background:#f8fafc; border-bottom:1px solid #e2e8f0; gap:12px; flex-wrap:wrap; }
    .apv-zone-title { font-size:1rem; font-weight:700; margin:0; }
    .apv-zone-sub { font-size:.78rem; color:#64748b; flex:1; min-width:200px; font-style:italic; }
    .apv-zone-actions { display:flex; align-items:center; gap:8px; }
    .apv-zone2--summary { padding-bottom:0; }
    .apv-summary-block { padding:14px 18px; border-bottom:1px solid #f1f5f9; }
    .apv-summary-block--landed { background:#fafbfd; }
    .apv-summary-block--business { background:#fdfaf6; }
    .apv-summary-block-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding-bottom:6px; border-bottom:1px dashed #cbd5e1; }
    .apv-summary-block-title { font-size:.88rem; font-weight:700; }
    .apv-summary-block-total { font-size:.92rem; font-weight:800; }
    .apv-summary-block-body { display:flex; flex-direction:column; gap:4px; }
    .apv-summary-row { display:flex; gap:8px; align-items:center; padding:5px 0; font-size:.85rem; }
    .apv-summary-row-emoji { width:18px; flex-shrink:0; text-align:center; }
    .apv-summary-row-label { flex:1; }
    .apv-summary-row-value { font-variant-numeric:tabular-nums; font-weight:600; }
    .apv-summary-totals { padding:12px 18px; background:#f8fafc; border-top:2px solid #e2e8f0; }
    .apv-summary-total-row { display:flex; justify-content:space-between; align-items:center; padding:4px 0; }
    .apv-summary-total-row--final { border-top:1px solid #cbd5e1; padding-top:8px; margin-top:4px; }
    .apv-summary-total-label { font-size:.85rem; font-weight:600; color:#475569; }
    .apv-summary-total-row--final .apv-summary-total-label { font-size:.95rem; font-weight:800; color:#0f172a; }
    .apv-summary-total-value { font-size:.92rem; font-weight:700; }
    .apv-summary-total-row--final .apv-summary-total-value { font-size:1.1rem; font-weight:800; color:#16a34a; }
    .apv-summary-alert { display:flex; gap:10px; align-items:flex-start; padding:10px 18px; background:#fef3c7; border-top:1px solid #fde68a; font-size:.85rem; color:#78350f; }
    .apv-spinner { font-size:1.1rem; animation:apv-spin 1.4s linear infinite; }
    @keyframes apv-spin { 0%,100%{opacity:.4}50%{opacity:1} }
    .apv-kanban { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding:14px; }
    @media(max-width:1100px){.apv-kanban{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:700px){.apv-kanban{grid-template-columns:1fr}}
    .apv-kcol { background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
    .apv-kcol-head { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-bottom:1px solid #e2e8f0; }
    .apv-kcol-num { width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:.78rem; flex-shrink:0; }
    .apv-kcol-title { font-size:.92rem; font-weight:700; line-height:1.2; }
    .apv-kcol-gray .apv-kcol-head { background:#f1f5f9; }
    .apv-kcol-gray .apv-kcol-num { background:#475569; }
    .apv-kcol-blue .apv-kcol-head { background:#eff6ff; }
    .apv-kcol-blue .apv-kcol-num { background:#3b82f6; }
    .apv-kcol-blue .apv-kcol-title { color:#1e3a8a; }
    .apv-kcol-green .apv-kcol-head { background:#ecfdf5; }
    .apv-kcol-green .apv-kcol-num { background:#16a34a; }
    .apv-kcol-green .apv-kcol-title { color:#14532d; }
    .apv-kcol-amber .apv-kcol-head { background:#fffbeb; }
    .apv-kcol-amber .apv-kcol-num { background:#f59e0b; }
    .apv-kcol-amber .apv-kcol-title { color:#78350f; }
    .apv-kcol-body { padding:0; }
    .apv-kempty { padding:30px 12px; text-align:center; color:#94a3b8; font-style:italic; font-size:.82rem; }
    .apv-kempty-error { color:#dc2626; background:#fef2f2; }
    .apv-ktotal { padding:12px; text-align:center; border-bottom:1px solid #e2e8f0; }
    .apv-ktotal-blue { background:#f8fbfe; }
    .apv-ktotal-green { background:#f2fbf7; }
    .apv-ktotal-decision { background:#f0f9ff; display:flex; align-items:center; justify-content:space-between; gap:10px; text-align:left; }
    .apv-ktotal-label { font-size:.68rem; color:#64748b; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
    .apv-ktotal-value { font-size:1.3rem; font-weight:800; font-family:ui-monospace,monospace; color:#1e293b; margin-top:4px; }
    .apv-decision-badge { color:#fff; padding:5px 12px; border-radius:6px; font-size:.72rem; font-weight:700; letter-spacing:.4px; }
    .apv-mode-toggle { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:8px 12px; border-bottom:1px solid #e2e8f0; background:#fafbfc; }
    .apv-mode-toggle label { display:flex; align-items:center; justify-content:center; gap:4px; padding:7px 10px; border-radius:5px; font-size:.78rem; font-weight:600; cursor:pointer; background:#fff; border:1px solid #e2e8f0; color:#64748b; transition:all .15s; }
    .apv-mode-toggle label.active { background:#16a34a; border-color:#15803d; color:#fff; }
    .apv-mode-toggle input { display:none; }
    .apv-field { padding:8px 12px; }
    .apv-label { display:block; font-size:.7rem; color:#64748b; font-weight:600; text-transform:uppercase; letter-spacing:.4px; margin-bottom:4px; }
    .apv-input { width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:5px; font-size:.85rem; font-family:inherit; background:#fff; color:#1e293b; box-sizing:border-box; }
    .apv-input:focus { outline:2px solid #16a34a; outline-offset:-1px; border-color:#16a34a; }
    .apv-input-num { font-family:ui-monospace,monospace; }
    .apv-input-cur { max-width:75px; flex:0 0 75px; }
    .apv-row { display:flex; gap:6px; }
    .apv-row > * { flex:1; min-width:0; }
    .apv-hint { font-size:.72rem; color:#64748b; margin-top:4px; padding:4px 8px; }
    .apv-hint-warn { color:#dc2626; background:#fef2f2; border-radius:4px; }
    .apv-ksection { border-bottom:1px solid #f1f5f9; }
    .apv-ksection:last-child { border-bottom:none; }
    .apv-ksection-head { padding:8px 12px; cursor:pointer; font-size:.82rem; font-weight:600; color:#475569; list-style:none; position:relative; user-select:none; }
    .apv-ksection-head::-webkit-details-marker { display:none; }
    .apv-ksection-head::after { content:'▶'; position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:.65rem; color:#94a3b8; transition:transform .15s; }
    .apv-ksection[open] .apv-ksection-head::after { transform:translateY(-50%) rotate(90deg); }
    .apv-ksection-body { padding:4px 12px 10px; }
    .apv-kline { display:grid; grid-template-columns:22px 1fr auto; align-items:center; gap:8px; padding:5px 0; font-size:.82rem; border-bottom:1px dashed #f1f5f9; }
    .apv-kline:last-child { border-bottom:none; }
    .apv-kline-icon { text-align:center; font-size:.92rem; }
    .apv-kline-label { color:#475569; }
    .apv-kline-val { font-family:ui-monospace,monospace; font-weight:600; color:#1e293b; text-align:right; white-space:nowrap; }
    .apv-kline-report { background:#f8fafc; margin:0 -12px; padding:6px 12px; font-style:italic; color:#64748b; }
    .apv-bold-big { font-size:.95rem; }
    .apv-mini-text { font-size:.74rem; color:#64748b; line-height:1.4; margin:0 0 6px; }
    .apv-italic { font-style:italic; }
    .apv-warn-inline { font-size:.74rem; color:#dc2626; margin:8px 0 0; }
    .apv-alloc-table { font-size:.74rem; }
    .apv-alloc-head { display:grid; grid-template-columns:1.6fr .8fr 1.2fr .8fr; gap:4px; padding:4px 6px; background:#f8fafc; border-radius:4px; font-weight:600; color:#64748b; text-transform:uppercase; font-size:.62rem; letter-spacing:.4px; margin-bottom:4px; }
    .apv-alloc-row { display:grid; grid-template-columns:1.6fr .8fr 1.2fr .8fr; gap:4px; padding:4px 6px; border-bottom:.5px dashed #e2e8f0; align-items:center; }
    .apv-alloc-agg { background:#fefce8; }
    .apv-num { font-family:ui-monospace,monospace; text-align:right; font-size:.72rem; }
    .apv-dim { color:#94a3b8; }
    .apv-bold { font-weight:600; color:#1e293b; }
    .apv-lvl { font-size:.66rem; color:#64748b; font-style:italic; }
    .apv-scenario { border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; margin-bottom:6px; background:#fff; cursor:pointer; transition:all .15s; }
    .apv-scenario-selected { border-color:#16a34a !important; background:#f0fdf4 !important; box-shadow:0 0 0 1px #16a34a; }
    .apv-scenario-disabled { opacity:.5; cursor:not-allowed; background:#f1f5f9; }
    .apv-scenario-head { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
    .apv-scenario-radio { font-size:1rem; color:#16a34a; font-weight:700; }
    .apv-scenario-label { font-size:.82rem; font-weight:600; color:#1e293b; flex:1; line-height:1.2; }
    .apv-scenario-prices { display:flex; justify-content:space-between; align-items:baseline; margin:2px 0; }
    .apv-scenario-price { font-family:ui-monospace,monospace; font-size:1rem; font-weight:700; color:#1e293b; }
    .apv-scenario-desc { font-size:.72rem; color:#64748b; line-height:1.35; margin-top:2px; }
    .apv-tag { font-size:.65rem; padding:1px 6px; border-radius:8px; font-weight:600; text-transform:uppercase; letter-spacing:.4px; }
    .apv-tag-rec { background:#fef3c7; color:#92400e; }
    .apv-tag-block { background:#fee2e2; color:#b91c1c; }
    .apv-apply-zone { padding:10px 12px; border-top:1px solid #e2e8f0; }
    .apv-apply-btn { width:100%; padding:10px 12px; background:#16a34a; color:white; border:none; border-radius:6px; font-size:.85rem; font-weight:700; cursor:pointer; font-family:inherit; }
    .apv-apply-btn:hover { background:#15803d; }
    .apv-apply-btn:disabled { background:#94a3b8; cursor:not-allowed; }
    .apv-doctrinal { display:flex; gap:12px; padding:12px 14px; background:#fef9c3; border-left:4px solid #f59e0b; border-radius:6px; font-size:.85rem; color:#713f12; line-height:1.5; margin:14px; }
    .apv-doctrinal-icon { font-size:1.2rem; flex-shrink:0; }
    .apv-doctrinal-text strong { color:#422006; font-family:ui-monospace,monospace; }
    .apv-error-banner { margin:14px; padding:12px 16px; background:#fef2f2; border-left:4px solid #dc2626; border-radius:6px; color:#7f1d1d; font-size:.88rem; }
    .apv-error-hint { margin-top:6px; font-size:.78rem; color:#991b1b; }
  `;
  document.head.appendChild(s);
}

/* ─── ENTRY POINT ────────────────────────────────────────────────────────── */
global.PricingView = async function(container) {
  _injectStyles();
  container.innerHTML = '<div class="apv-loading">Chargement de l\'Atelier...</div>';
  try {
    await _loadAll();
    await _loadCatalog();
    // Guard : navigation entre-temps → container détaché du DOM
    if (!container || !document.contains(container)) return;
    _ps.loaded = true;
    _renderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="apv-error">Erreur de chargement : ' + _esc(err.message) + '</div>';
  }
};

})(window);
