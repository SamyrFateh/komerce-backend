/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-pricing-workshop.js — Komerce Control Tower
 *
 *  ATELIER DE COMPOSITION DU PRIX (vue plein-ecran)
 *
 *  Objectif : permettre a l'utilisateur de :
 *    1. Visualiser comment le prix se compose (modules contributeurs)
 *    2. Identifier les charges / variables MANQUANTES via benchmarks sectoriels
 *    3. Ajouter en un clic les composantes manquantes
 *    4. Voir l'impact immediat sur le prix
 *
 *  API consommees :
 *    - GET /api/pricing/benchmarks-gap → liste des manques par categorie
 *    - POST /api/pricing/recommend → calcul prix actuel
 *    - POST /api/admin/pricing-components → creer composant
 *    - POST /api/admin/risk-provisions → creer provision
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

/* ─── STATE ──────────────────────────────────────────────────────────── */
const _ws = {
  // Donnees
  gap: null,              // reponse /benchmarks-gap
  reco: null,             // reponse /recommend (pour le produit selectionne)

  // Inputs simulateur (memes que Pricing principal)
  inputCategory: 'phones',
  inputPrixAed: 100,
  inputDimL: 17,
  inputDimW: 12,
  inputDimH: 11,
  inputPoidsKg: 0.5,
  inputChannel: 'cash_relais',

  // Filtres affichage
  showOptional: false,    // par defaut on cache les optionnels
  expandedCategories: { sourcing: true, transit: true, douane: true, hub: false, distribution: true, paiement: false },

  loaded: false,
};

/* ─── HELPERS ───────────────────────────────────────────────────────── */
const _wsNF = new Intl.NumberFormat('fr-FR');
function _wsFmt(n) { return _wsNF.format(Math.round(n || 0)) + ' KMF'; }

async function _wsApi(method, path, body) {
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
function _wsInjectStyles() {
  if (document.getElementById('ct-pricing-workshop-styles')) return;
  const s = document.createElement('style');
  s.id = 'ct-pricing-workshop-styles';
  s.textContent = `
    .ws-wrap { padding: 16px 20px; max-width: 1400px; margin: 0 auto; color: #1e293b; }
    .ws-h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 6px; color: #1e293b; display: flex; align-items: center; gap: 10px; }
    .ws-sub { font-size: 0.9rem; color: #64748b; margin-bottom: 16px; }

    /* Bandeau formule en haut */
    .ws-formula { background: linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%); border: 1px solid #fcd34d; border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; }
    .ws-formula-title { font-size: 0.78rem; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 12px; }
    .ws-formula-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-family: ui-monospace, monospace; font-size: 1rem; }
    .ws-formula-cell { background: #fff; border: 1px solid #fcd34d; border-radius: 8px; padding: 8px 14px; min-width: 110px; text-align: center; }
    .ws-formula-cell.final { background: #d97706; color: #fff; border-color: #d97706; font-weight: 800; font-size: 1.15rem; min-width: 140px; }
    .ws-formula-op { font-weight: 700; color: #92400e; font-size: 1.2rem; }
    .ws-formula-label { display: block; font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; margin-bottom: 2px; }
    .ws-formula-cell.final .ws-formula-label { color: #fef3c7; }
    .ws-formula-value { font-weight: 700; color: #1e293b; }
    .ws-formula-cell.final .ws-formula-value { color: #fff; }

    /* Tools */
    .ws-tools { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; flex-wrap: wrap; padding: 12px 14px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
    .ws-tool-label { font-size: 0.8rem; color: #64748b; font-weight: 600; }
    .ws-input { padding: 6px 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; font-size: 0.85rem; font-family: ui-monospace, monospace; }
    .ws-input:focus { outline: none; border-color: #3b82f6; }
    .ws-select { padding: 6px 10px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; color: #1e293b; font-size: 0.85rem; }
    .ws-btn { padding: 8px 16px; font-size: 0.85rem; font-weight: 600; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; }
    .ws-btn-primary { background: #f59e0b; color: #fff; border-color: #f59e0b; }
    .ws-btn-primary:hover { background: #d97706; }
    .ws-btn-secondary { background: #fff; color: #1e293b; border-color: #cbd5e1; }
    .ws-btn-secondary:hover { background: #f8fafc; }
    .ws-btn-add { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; padding: 4px 10px; font-size: 0.75rem; font-weight: 600; border-radius: 6px; cursor: pointer; }
    .ws-btn-add:hover { background: #d1fae5; border-color: #6ee7b7; }
    .ws-btn-back { background: transparent; color: #3b82f6; border: 1px solid transparent; padding: 6px 12px; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
    .ws-btn-back:hover { background: #eff6ff; }

    /* Summary cards */
    .ws-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .ws-summary-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center; }
    .ws-summary-card.critical { border-color: #fca5a5; background: linear-gradient(135deg, #fef2f2, #fff); }
    .ws-summary-card.recommended { border-color: #fcd34d; background: linear-gradient(135deg, #fffbeb, #fff); }
    .ws-summary-card.present { border-color: #a7f3d0; background: linear-gradient(135deg, #ecfdf5, #fff); }
    .ws-summary-value { font-size: 1.6rem; font-weight: 800; line-height: 1; margin-bottom: 4px; }
    .ws-summary-card.critical .ws-summary-value { color: #b91c1c; }
    .ws-summary-card.recommended .ws-summary-value { color: #92400e; }
    .ws-summary-card.present .ws-summary-value { color: #047857; }
    .ws-summary-label { font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }

    /* Section categorie */
    .ws-cat { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 14px; overflow: hidden; }
    .ws-cat-head { padding: 12px 16px; cursor: pointer; user-select: none; display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .ws-cat-head:hover { background: #f1f5f9; }
    .ws-cat-title { font-size: 1rem; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 8px; }
    .ws-cat-meta { display: flex; gap: 14px; align-items: center; font-size: 0.82rem; }
    .ws-cat-badge { padding: 3px 9px; border-radius: 12px; font-size: 0.72rem; font-weight: 600; }
    .ws-cat-badge.crit { background: #fee2e2; color: #b91c1c; }
    .ws-cat-badge.recom { background: #fef3c7; color: #92400e; }
    .ws-cat-badge.ok { background: #d1fae5; color: #047857; }
    .ws-cat-arrow { color: #94a3b8; transition: transform 0.2s; }
    .ws-cat.collapsed .ws-cat-arrow { transform: rotate(-90deg); }
    .ws-cat.collapsed .ws-cat-body { display: none; }
    .ws-cat-body { padding: 12px 16px; }

    /* ═══ GRILLE DES 6 MODULES (Atelier Phase 2 — disposition cadres) ═══ */
    /* 2 colonnes × 3 lignes, hauteur égale, scroll interne par cadre */
    .ws-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      grid-auto-rows: 380px;             /* hauteur égale fixe */
      gap: 14px;
      margin-bottom: 18px;
    }
    @media (max-width: 768px) {
      .ws-grid { grid-template-columns: 1fr; grid-auto-rows: auto; }
    }
    .ws-grid .ws-cat {
      margin-bottom: 0;                  /* annule le margin global, géré par grid gap */
      display: flex;
      flex-direction: column;
      min-height: 0;                     /* permet à flex-children de scroller */
    }
    .ws-grid .ws-cat-head {
      flex-shrink: 0;
      cursor: default;                   /* pas de toggle en mode grille */
    }
    .ws-grid .ws-cat-head:hover { background: #f8fafc; }  /* pas d'effet hover */
    .ws-grid .ws-cat-arrow { display: none; }              /* cache le chevron */
    .ws-grid .ws-cat.collapsed .ws-cat-body { display: flex; }  /* toujours visible en grid */
    .ws-grid .ws-cat-body {
      flex: 1 1 auto;
      overflow-y: auto;                  /* scroll interne si déborde */
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    /* Total contribution module en sticky en haut du body */
    .ws-cat-total {
      position: sticky;
      top: -10px;                        /* compense le padding-top */
      background: #fff;
      padding: 4px 0 6px;
      margin: -10px -2px 4px;
      font-size: 0.78rem;
      color: #64748b;
      border-bottom: 1px solid #f1f5f9;
      z-index: 1;
    }
    .ws-cat-total strong { color: #d97706; font-family: ui-monospace, monospace; font-size: 0.95rem; float: right; }
    /* Compactage en mode grille */
    .ws-grid .ws-row-present {
      grid-template-columns: 20px 1fr 90px 60px;  /* compact : retire bench + deviation séparés */
      gap: 8px;
      padding: 5px 2px;
      font-size: 0.82rem;
    }
    .ws-grid .ws-row-present .ws-row-bench { display: none; }  /* on cache la colonne benchmark */
    .ws-grid .ws-row-missing {
      grid-template-columns: 22px 1fr 70px 90px;
      gap: 6px;
      padding: 6px 8px;
      font-size: 0.8rem;
    }
    .ws-grid .ws-row-missing-importance { display: none; }  /* badge déjà signalé par bordure */
    .ws-grid .ws-row-missing-source { display: none; }       /* économie de hauteur */
    .ws-grid .ws-section-title {
      font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px;
      font-weight: 700; margin: 6px 0 4px; padding-top: 6px; border-top: 1px dashed #f1f5f9;
    }
    .ws-grid .ws-section-title:first-child { padding-top: 0; border-top: none; margin-top: 0; }

    /* Lignes presentes */
    .ws-row-present { display: grid; grid-template-columns: 24px 1fr 100px 100px 80px; align-items: center; gap: 10px; padding: 6px 4px; border-bottom: 1px dashed #e2e8f0; font-size: 0.85rem; }
    .ws-row-present:last-child { border-bottom: none; }
    .ws-row-icon { color: #16a34a; text-align: center; font-weight: 700; }
    .ws-row-label { color: #1e293b; }
    .ws-row-value { font-family: ui-monospace, monospace; color: #1e293b; text-align: right; font-weight: 600; }
    .ws-row-bench { font-family: ui-monospace, monospace; color: #94a3b8; text-align: right; font-size: 0.78rem; }
    .ws-row-deviation { text-align: center; font-size: 0.75rem; font-weight: 600; }
    .ws-row-deviation.high { color: #dc2626; }
    .ws-row-deviation.low { color: #16a34a; }
    .ws-row-deviation.ok { color: #94a3b8; }

    /* Lignes manquantes */
    .ws-row-missing { display: grid; grid-template-columns: 24px 1fr 130px 110px 100px; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 6px; margin-bottom: 4px; font-size: 0.85rem; transition: background 0.15s; }
    .ws-row-missing:hover { background: #fffbeb; }
    .ws-row-missing.critical { background: #fef2f2; border-left: 3px solid #ef4444; }
    .ws-row-missing.recommended { background: #fffbeb; border-left: 3px solid #f59e0b; }
    .ws-row-missing.optional { background: #f8fafc; border-left: 3px solid #cbd5e1; }
    .ws-row-missing-icon { font-size: 1.05rem; text-align: center; cursor: help; }
    .ws-row-missing-label { display: flex; flex-direction: column; gap: 2px; }
    .ws-row-missing-name { font-weight: 600; color: #1e293b; }
    .ws-row-missing-source { font-size: 0.7rem; color: #94a3b8; font-style: italic; }
    .ws-row-missing-bench { font-family: ui-monospace, monospace; color: #475569; text-align: right; font-size: 0.82rem; }
    .ws-row-missing-bench small { display: block; color: #94a3b8; font-size: 0.7rem; }
    .ws-row-missing-importance { text-align: center; font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
    .ws-row-missing-importance.critical { background: #fee2e2; color: #b91c1c; }
    .ws-row-missing-importance.recommended { background: #fef3c7; color: #92400e; }
    .ws-row-missing-importance.optional { background: #f1f5f9; color: #64748b; }

    /* Tooltip */
    .ws-tooltip { position: relative; display: inline-block; cursor: help; }
    .ws-tooltip-content { visibility: hidden; opacity: 0; background: #1e293b; color: #fff; text-align: left; border-radius: 8px; padding: 10px 12px; position: absolute; z-index: 10; left: 0; top: 100%; margin-top: 6px; width: 320px; font-size: 0.8rem; line-height: 1.4; transition: opacity 0.15s; box-shadow: 0 8px 24px rgba(0,0,0,0.15); pointer-events: none; }
    .ws-tooltip:hover .ws-tooltip-content { visibility: visible; opacity: 1; }
    .ws-tooltip-content::before { content: ''; position: absolute; top: -6px; left: 12px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid #1e293b; }

    /* Empty / loading */
    .ws-empty { padding: 30px 20px; text-align: center; color: #64748b; font-size: 0.9rem; background: #f8fafc; border-radius: 8px; }
    .ws-loading { padding: 40px 20px; text-align: center; color: #64748b; }
  `;
  document.head.appendChild(s);
}

/* ─── DATA LOADING ──────────────────────────────────────────────────── */
async function _wsLoadData() {
  const params = _ws.showOptional ? '?include_optional=true' : '';
  const [gap, reco] = await Promise.all([
    _wsApi('GET', '/api/pricing/benchmarks-gap' + params),
    _wsApi('POST', '/api/pricing/recommend', {
      category: _ws.inputCategory,
      prix_aed: _ws.inputPrixAed,
      volume_m3: (_ws.inputDimL * _ws.inputDimW * _ws.inputDimH) / 1_000_000,
      poids_kg: _ws.inputPoidsKg,
      channel: _ws.inputChannel,
      is_diaspora: _ws.inputChannel === 'diaspora',
    }).catch(() => null),
  ]);
  _ws.gap = gap;
  _ws.reco = reco;
}

/* ─── RENDER ───────────────────────────────────────────────────────── */
async function _wsRender(container) {
  container.innerHTML = '<div class="ws-loading">🧱 Analyse en cours...</div>';
  try {
    await _wsLoadData();
    _ws.loaded = true;
    _wsRenderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="ws-empty">Erreur de chargement : ' + err.message + '</div>';
    console.error('[Workshop] _wsRender error:', err);
  }
}

function _wsRenderHTML(container) {
  _wsInjectStyles();
  const r = _ws.reco;
  const g = _ws.gap;

  let html = '<div class="ws-wrap">';

  // Header avec retour
  html += '<button class="ws-btn-back" data-act="back-to-pricing">← Retour au Pricing</button>';
  html += '<h1 class="ws-h1">🧱 Composition avancée des coûts</h1>';
  html += '<p class="ws-sub">Bibliothèque des composantes de coût. Gérez pricing_components, risk_provisions et identifiez les charges manquantes.</p>';

  // Bandeau formule (si reco disponible)
  if (r) {
    html += _wsRenderFormula(r);
  }

  // Tools (sélection produit)
  html += _wsRenderTools();

  // Summary cards
  if (g) {
    html += _wsRenderSummary(g.summary);
  }

  // Sections par catégorie (grille 2x3 cadres avec hauteur égale)
  if (g && g.by_category) {
    html += '<div class="ws-grid">';
    Object.keys(g.by_category).forEach(catKey => {
      html += _wsRenderCategory(catKey, g.by_category[catKey]);
    });
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
  _wsBindEvents(container);
}

function _wsRenderFormula(r) {
  const n1 = r.niveau1.total;
  const n2 = r.niveau2.total;
  const n3 = r.niveau3.total;
  const total = r.cout_total_kmf;
  const finalPrice = r.prix_recommande_kmf;
  const margePct = r.marge_cible_pct;

  return `
    <div class="ws-formula">
      <div class="ws-formula-title">📐 Formule appliquee a ce produit</div>
      <div class="ws-formula-row">
        <div class="ws-formula-cell">
          <span class="ws-formula-label">Variables (N1)</span>
          <span class="ws-formula-value">${_wsFmt(n1)}</span>
        </div>
        <span class="ws-formula-op">+</span>
        <div class="ws-formula-cell">
          <span class="ws-formula-label">Fixes amorties (N2)</span>
          <span class="ws-formula-value">${_wsFmt(n2)}</span>
        </div>
        <span class="ws-formula-op">+</span>
        <div class="ws-formula-cell">
          <span class="ws-formula-label">Provisions (N3)</span>
          <span class="ws-formula-value">${_wsFmt(n3)}</span>
        </div>
        <span class="ws-formula-op">→ ÷ (1 - ${margePct}%)</span>
        <div class="ws-formula-cell final">
          <span class="ws-formula-label">Prix recommande</span>
          <span class="ws-formula-value">${_wsFmt(finalPrice)}</span>
        </div>
      </div>
    </div>
  `;
}

function _wsRenderTools() {
  return `
    <div class="ws-tools">
      <span class="ws-tool-label">Produit temoin :</span>
      <select class="ws-select" data-input="category">
        <option value="phones" ${_ws.inputCategory === 'phones' ? 'selected' : ''}>📱 Phones</option>
        <option value="electro" ${_ws.inputCategory === 'electro' ? 'selected' : ''}>📺 Electro</option>
        <option value="vetements" ${_ws.inputCategory === 'vetements' ? 'selected' : ''}>👕 Vetements</option>
        <option value="cosmetiques" ${_ws.inputCategory === 'cosmetiques' ? 'selected' : ''}>💄 Cosmetiques</option>
      </select>
      <input class="ws-input" type="number" data-input="prixAed" value="${_ws.inputPrixAed}" style="width:80px;" placeholder="AED">
      <span class="ws-tool-label">AED</span>
      <select class="ws-select" data-input="channel">
        <option value="cash_relais" ${_ws.inputChannel === 'cash_relais' ? 'selected' : ''}>Cash relais</option>
        <option value="diaspora" ${_ws.inputChannel === 'diaspora' ? 'selected' : ''}>Diaspora</option>
      </select>
      <button class="ws-btn ws-btn-primary" data-act="recompute">🔄 Recalculer</button>
      <span style="flex:1;"></span>
      <label style="display:flex; align-items:center; gap:6px; font-size:0.82rem; color:#475569;">
        <input type="checkbox" data-input="showOptional" ${_ws.showOptional ? 'checked' : ''}>
        Afficher les optionnels
      </label>
    </div>
  `;
}

function _wsRenderSummary(s) {
  return `
    <div class="ws-summary">
      <div class="ws-summary-card critical">
        <div class="ws-summary-value">${s.critical_missing}</div>
        <div class="ws-summary-label">⚠ Manques critiques</div>
      </div>
      <div class="ws-summary-card recommended">
        <div class="ws-summary-value">${s.recommended_missing}</div>
        <div class="ws-summary-label">Manques recommandes</div>
      </div>
      <div class="ws-summary-card present">
        <div class="ws-summary-value">${s.present_count}</div>
        <div class="ws-summary-label">✓ Charges presentes</div>
      </div>
      <div class="ws-summary-card">
        <div class="ws-summary-value">${s.total_benchmarks}</div>
        <div class="ws-summary-label">Total benchmarks</div>
      </div>
    </div>
  `;
}

function _wsRenderCategory(catKey, cat) {
  const isOpen = _ws.expandedCategories[catKey];
  const totalMissing = cat.missing.length;
  const totalPresent = cat.present.length;
  const critMissing = cat.missing.filter(m => m.importance === 'critical').length;
  const recomMissing = cat.missing.filter(m => m.importance === 'recommended').length;

  // Contribution totale du module (somme des composants présents dans le reco)
  let moduleTotal = 0;
  if (_ws.reco?.niveau1?.items) {
    _ws.reco.niveau1.items.forEach(it => {
      const matchingPresent = cat.present.find(p => p.key === it.key);
      if (matchingPresent) moduleTotal += Number(it.valeur_kmf || 0);
    });
  }

  let html = `
    <div class="ws-cat ${isOpen ? '' : 'collapsed'}" data-cat="${catKey}">
      <div class="ws-cat-head" data-act="toggle-cat" data-cat="${catKey}">
        <div class="ws-cat-title">${cat.emoji} ${cat.label}</div>
        <div class="ws-cat-meta">
          ${critMissing > 0 ? '<span class="ws-cat-badge crit">' + critMissing + ' critique' + (critMissing > 1 ? 's' : '') + '</span>' : ''}
          ${recomMissing > 0 ? '<span class="ws-cat-badge recom">' + recomMissing + ' recommande' + (recomMissing > 1 ? 's' : '') + '</span>' : ''}
          ${critMissing === 0 && recomMissing === 0 ? '<span class="ws-cat-badge ok">✓ Complet</span>' : ''}
          <span class="ws-cat-arrow">▼</span>
        </div>
      </div>
      <div class="ws-cat-body">
        <div class="ws-cat-total">Contribution module <strong>${_wsFmt(moduleTotal)}</strong></div>
  `;

  // Lignes présentes
  if (cat.present.length) {
    html += '<div>';
    html += '<div class="ws-section-title">✓ Présentes (' + cat.present.length + ')</div>';
    cat.present.forEach(p => {
      const dev = p.deviation_pct || 0;
      let devClass = 'ok';
      let devStr = '';
      if (Math.abs(dev) >= 30) { devClass = dev > 0 ? 'high' : 'low'; devStr = (dev > 0 ? '+' : '') + dev + '%'; }
      const inactiveLabel = p.is_active ? '' : ' <span style="color:#94a3b8; font-size:0.7rem;">(off)</span>';
      html += `
        <div class="ws-row-present">
          <span class="ws-row-icon">✓</span>
          <span class="ws-row-label">${p.label}${inactiveLabel}</span>
          <span class="ws-row-value">${p.current_value} ${p.unit === 'pct' ? '%' : 'KMF'}</span>
          <span class="ws-row-bench">bench ${p.benchmark_median} ${p.unit === 'pct' ? '%' : ''}</span>
          <span class="ws-row-deviation ${devClass}">${devStr}</span>
        </div>
      `;
    });
    html += '</div>';
  }

  // Lignes manquantes
  if (cat.missing.length) {
    html += '<div>';
    html += '<div class="ws-section-title">⚠ Manques sectoriels (' + cat.missing.length + ')</div>';
    // Trier : critical d'abord, puis recommended, puis optional
    const sorted = cat.missing.slice().sort((a, b) => {
      const order = { critical: 0, recommended: 1, optional: 2 };
      return order[a.importance] - order[b.importance];
    });
    sorted.forEach(m => {
      const benchStr = m.benchmark_min !== null && m.benchmark_max !== null
        ? `${m.benchmark_median} ${m.unit === 'pct' ? '%' : 'KMF'}`
        : `${m.benchmark_median} ${m.unit === 'pct' ? '%' : 'KMF'}`;
      const benchRangeStr = m.benchmark_min !== null && m.benchmark_max !== null
        ? `(${m.benchmark_min} - ${m.benchmark_max})`
        : '';

      const importLabels = { critical: 'CRITIQUE', recommended: 'RECOMMANDE', optional: 'OPTIONNEL' };

      html += `
        <div class="ws-row-missing ${m.importance}" data-bench-key="${m.key}">
          <span class="ws-row-missing-icon ws-tooltip" title="${m.why || ''}">${m.emoji || '•'}
            ${m.why ? '<span class="ws-tooltip-content"><strong>Pourquoi :</strong> ' + m.why + (m.source ? '<br><br><em>Source : ' + m.source + '</em>' : '') + '</span>' : ''}
          </span>
          <div class="ws-row-missing-label">
            <span class="ws-row-missing-name">${m.label}</span>
            ${m.source ? '<span class="ws-row-missing-source">' + m.source + '</span>' : ''}
          </div>
          <span class="ws-row-missing-bench">
            ${benchStr}
            ${benchRangeStr ? '<small>' + benchRangeStr + '</small>' : ''}
          </span>
          <span class="ws-row-missing-importance ${m.importance}">${importLabels[m.importance]}</span>
          <button class="ws-btn-add" data-act="add-from-bench" data-bench-key="${m.key}"
                  data-cat="${catKey}" data-unit="${m.unit}" data-value="${m.benchmark_median}"
                  data-label="${m.label}" data-emoji="${m.emoji || ''}"
                  data-applies-to="${m.suggested_applies_to || 'all'}">+ Ajouter</button>
        </div>
      `;
    });
    html += '</div>';
  }

  if (!cat.present.length && !cat.missing.length) {
    html += '<div class="ws-empty">Aucun benchmark configure pour cette categorie.</div>';
  }

  html += '</div></div>';
  return html;
}

/* ─── EVENTS ───────────────────────────────────────────────────────── */
function _wsBindEvents(container) {
  container.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;

    if (act === 'back-to-pricing') {
      window.location.hash = '#pricing';
      return;
    }

    if (act === 'toggle-cat') {
      const cat = t.dataset.cat;
      _ws.expandedCategories[cat] = !_ws.expandedCategories[cat];
      const sec = container.querySelector('[data-cat="' + cat + '"]');
      if (sec) sec.classList.toggle('collapsed', !_ws.expandedCategories[cat]);
      return;
    }

    if (act === 'recompute') {
      t.textContent = '⏳ Calcul...';
      t.disabled = true;
      try {
        await _wsLoadData();
        _wsRenderHTML(container);
      } catch (err) {
        alert('Erreur recalcul : ' + err.message);
        t.disabled = false;
        t.textContent = '🔄 Recalculer';
      }
      return;
    }

    if (act === 'add-from-bench') {
      const benchKey = t.dataset.benchKey;
      const cat = t.dataset.cat;
      const unit = t.dataset.unit;
      const value = parseFloat(t.dataset.value);
      const label = t.dataset.label;
      const emoji = t.dataset.emoji || '';
      const appliesTo = t.dataset.appliesTo || 'all';

      const isProvision = ['demarque_inconnue_comores', 'defaut_paiement_cash_relais', 'mauvaise_dette_diaspora'].includes(benchKey);

      let confirmMsg = `Ajouter "${label}" avec la valeur sectorielle ${value} ${unit === 'pct' ? '%' : unit} ?\n\n`;
      confirmMsg += isProvision
        ? 'Sera ajoute en tant que PROVISION RISQUE (Niveau 3).'
        : `Sera ajoute en tant que VARIABLE (Niveau 1, categorie ${cat}).`;
      confirmMsg += '\n\nVous pourrez modifier la valeur dans le module Pricing.';

      if (!confirm(confirmMsg)) return;

      try {
        if (isProvision) {
          await _wsApi('POST', '/api/admin/risk-provisions', {
            key: benchKey,
            label,
            emoji,
            rate_pct: value,
            applies_to: appliesTo,
            notes: 'Ajoute via Atelier de composition (benchmark sectoriel)',
          });
        } else {
          await _wsApi('POST', '/api/admin/pricing-components', {
            key: benchKey,
            label,
            emoji,
            category: cat,
            unit,
            default_value: value,
            applies_to: appliesTo,
            notes: 'Ajoute via Atelier de composition (benchmark sectoriel)',
          });
        }
        // Recharger les donnees
        t.textContent = '✓ Ajoute';
        t.style.background = '#d1fae5';
        t.disabled = true;
        // Petit delai puis recharger
        setTimeout(async () => {
          await _wsLoadData();
          _wsRenderHTML(container);
        }, 600);
      } catch (err) {
        alert('Erreur ajout : ' + err.message);
      }
      return;
    }
  });

  // Inputs (changement immediat)
  container.addEventListener('change', (e) => {
    const t = e.target.closest('[data-input]');
    if (!t) return;
    const f = t.dataset.input;
    const v = t.type === 'checkbox' ? t.checked : t.value;
    if (f === 'category')           _ws.inputCategory = v;
    else if (f === 'prixAed')       _ws.inputPrixAed = parseFloat(v) || 0;
    else if (f === 'channel')       _ws.inputChannel = v;
    else if (f === 'showOptional')  {
      _ws.showOptional = v;
      _wsLoadData().then(() => _wsRenderHTML(container));
    }
  });
}

/* ─── ENTRY POINT ───────────────────────────────────────────────────── */
CT.views.pricing_workshop = async function(container) {
  await _wsRender(container);
};

})();
