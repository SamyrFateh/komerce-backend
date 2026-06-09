/**
 * KOMERCE Dashboard — Vue Scanner Catalogue Fournisseur /admin/sourcing-scanner
 * ═══════════════════════════════════════════════════════════════════════════
 * Migration de CT.views.sourcing_scanner (ct-views-sourcing-scanner.js — 817 lignes)
 *
 * « Sur 1 000 articles fournisseur, lesquels méritent d'être testés ? »
 *
 * 3 onglets :
 *   1. Candidats  — table filtrable, actions par ligne
 *   2. Imports    — liste des batches (CSV ou manuel)
 *   3. Nouveau    — formulaire d'import CSV ou saisie manuelle
 *
 * Aucun calcul frontend : tout vient du backend (pricing-engine via scanner).
 *
 * API :
 *   KmcApi.getSourcingCatalogs()              → liste imports
 *   KmcApi.getSourcingCandidates(params)      → liste candidats
 *   KmcApi.getSourcingCandidate(id)           → détail candidat
 *   KmcApi.updateSourcingCandidate(id, body)  → éditer candidat
 *   KmcApi.importSourcingCatalog(body)        → import CSV/manuel
 *   KmcApi.scanSourcingCandidate(id)          → re-scanner
 *   KmcApi.importSourcingProduct(id)          → → boutique
 *   KmcApi.watchlistSourcingCandidate(id)     → watchlist
 *   KmcApi.rejectSourcingCandidate(id, body)  → rejeter
 */

(function (global) {
  'use strict';

  /* ── Styles ──────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('scs-styles')) return;
    const s = document.createElement('style');
    s.id = 'scs-styles';
    s.textContent = `
      .scs-wrap{max-width:1320px;margin:0 auto;padding:0}
      .scs-tabs{display:flex;gap:4px;border-bottom:2px solid var(--border);margin-bottom:18px;padding-bottom:0;flex-wrap:wrap}
      .scs-tab{padding:10px 18px;border:none;background:none;font-size:14px;font-weight:500;color:var(--text-secondary);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;border-radius:6px 6px 0 0;transition:all .15s;font-family:inherit}
      .scs-tab:hover{background:var(--bg-secondary);color:var(--text-primary)}
      .scs-tab.active{color:#16a34a;border-bottom-color:#16a34a;font-weight:600}
      .scs-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
      .scs-kpi{background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px 14px}
      .scs-kpi-label{font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;font-weight:600;margin-bottom:4px}
      .scs-kpi-value{font-size:22px;font-weight:800;color:var(--text-primary);font-family:ui-monospace,monospace;line-height:1}
      .scs-filters{display:flex;gap:8px;align-items:center;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;flex-wrap:wrap}
      .scs-filters label{font-size:12px;color:var(--text-secondary);font-weight:600}
      .scs-select,.scs-input-f{padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--text-primary)}
      .scs-table-wrap{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
      .scs-table{width:100%;border-collapse:collapse;font-size:13px}
      .scs-table thead{background:var(--bg-secondary);border-bottom:1px solid var(--border)}
      .scs-table th{padding:10px 8px;text-align:left;font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.3px;font-weight:600}
      .scs-table th.num{text-align:right}
      .scs-table td{padding:10px 8px;border-bottom:1px solid var(--border)}
      .scs-table td.num{text-align:right;font-family:ui-monospace,monospace}
      .scs-table tbody tr:hover{background:var(--bg-secondary);cursor:pointer}
      .scs-table tbody tr:last-child td{border-bottom:none}
      /* Drawer */
      .scs-drawer-bg{position:fixed;inset:0;background:rgba(15,23,42,.4);opacity:0;pointer-events:none;transition:opacity .2s;z-index:99}
      .scs-drawer-bg.open{opacity:1;pointer-events:auto}
      .scs-drawer{position:fixed;top:0;right:0;width:min(560px,90vw);height:100vh;background:var(--bg-card);box-shadow:-4px 0 24px rgba(0,0,0,.12);transform:translateX(100%);transition:transform .25s;z-index:100;display:flex;flex-direction:column}
      .scs-drawer.open{transform:translateX(0)}
      .scs-drawer-head{padding:16px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
      .scs-drawer-title{font-size:16px;font-weight:700;flex:1;margin:0;color:var(--text-primary)}
      .scs-drawer-body{flex:1;overflow-y:auto;padding:16px 18px}
      .scs-drawer-row{margin-bottom:14px}
      .scs-drawer-row label{display:block;font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;font-weight:600;margin-bottom:4px}
      .scs-drawer-row input,.scs-drawer-row select{width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--text-primary)}
      .scs-drawer-foot{padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap}
      .scs-prices-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}
      .scs-price-card{background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:10px}
      .scs-price-card.primary{background:#fef3c7;border-color:#f59e0b}
      .scs-price-label{font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:2px}
      .scs-price-value{font-size:16px;font-weight:800;font-family:ui-monospace,monospace;color:var(--text-primary)}
      .scs-decision-bloc{border:2px solid;border-radius:8px;padding:12px;margin-bottom:14px}
      /* Form import */
      .scs-form{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:18px}
      .scs-form-row{margin-bottom:14px}
      .scs-form-row label{display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px}
      .scs-form-row input,.scs-form-row select,.scs-form-row textarea{width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--text-primary)}
      .scs-form-row textarea{min-height:120px;resize:vertical;font-family:ui-monospace,monospace;font-size:12px}
      .scs-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
      .scs-source-toggle{display:flex;gap:6px;margin-bottom:14px}
      .scs-source-btn{padding:8px 16px;border:1px solid var(--border);background:var(--bg-card);border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;color:var(--text-secondary)}
      .scs-source-btn.active{background:#16a34a;color:#fff;border-color:#15803d}
      .scs-csv-help{font-size:12px;color:var(--text-secondary);margin-bottom:6px;line-height:1.4}
      .scs-csv-help code{background:var(--bg-secondary);padding:1px 6px;border-radius:3px;font-family:ui-monospace,monospace;font-size:12px}
    `;
    document.head.appendChild(s);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const _nf = new Intl.NumberFormat('fr-FR');
  function fmt(n)  { return _nf.format(Math.round(n || 0)) + ' KMF'; }
  function esc(s)  { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function decisionColor(d) {
    return ({ PRIORITY:{bg:'#dcfce7',text:'#14532d',border:'#16a34a'}, TEST:{bg:'#eff6ff',text:'#1e40af',border:'#3b82f6'},
      WATCH:{bg:'#fffbeb',text:'#92400e',border:'#f59e0b'}, AVOID:{bg:'#f1f5f9',text:'#475569',border:'#94a3b8'},
      LOSS:{bg:'#fef2f2',text:'#b91c1c',border:'#dc2626'} })[d] || {bg:'#f8fafc',text:'#64748b',border:'#cbd5e1'};
  }
  function healthColor(h) {
    return ({ loss:{bg:'#fef2f2',text:'#b91c1c'}, danger:{bg:'#fffbeb',text:'#92400e'}, fragile:{bg:'#fefce8',text:'#854d0e'},
      healthy:{bg:'#f0fdf4',text:'#166534'}, strong:{bg:'#dcfce7',text:'#14532d'} })[h] || {bg:'#f8fafc',text:'#64748b'};
  }
  function stateBadge(st) {
    const map = { raw_imported:{label:'Brut',bg:'#f1f5f9',text:'#64748b'}, normalized:{label:'Normalisé',bg:'#e0f2fe',text:'#0369a1'},
      scanned:{label:'Scanné',bg:'#eff6ff',text:'#1e40af'}, test_ready:{label:'Prêt à tester',bg:'#dbeafe',text:'#1d4ed8'},
      watchlist:{label:'Watchlist',bg:'#fef9c3',text:'#854d0e'}, imported_to_catalog:{label:'Importé',bg:'#dcfce7',text:'#14532d'},
      rejected:{label:'Rejeté',bg:'#fee2e2',text:'#b91c1c'}, archived:{label:'Archivé',bg:'#f1f5f9',text:'#475569'} };
    const s = map[st] || {label:st,bg:'#f1f5f9',text:'#475569'};
    return `<span style="background:${s.bg};color:${s.text};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${s.label}</span>`;
  }
  function confidenceBadge(c) {
    const map = { high:{bg:'#dcfce7',text:'#14532d',label:'✓ Fiable'}, medium:{bg:'#fffbeb',text:'#92400e',label:'~ Moyen'},
      low:{bg:'#fef2f2',text:'#b91c1c',label:'⚠ Faible'} };
    const s = map[c] || map.low;
    return `<span style="background:${s.bg};color:${s.text};padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600">${s.label}</span>`;
  }

  /* ── State ───────────────────────────────────────────────────────────── */
  const _state = {
    activeTab: 'candidates', imports: [], candidates: [], categories: [],
    filter: { state: '', decision: '', supplier: '' },
    selectedCandidate: null, drawerOpen: false,
    newImport: { supplier_name:'', source_type:'csv', csv_text:'', manual:{ product_name:'', supplier_category:'', purchase_price:'', currency:'AED', weight_kg:'', dim_l_cm:'', dim_w_cm:'', dim_h_cm:'', product_url:'', image_url:'' } },
  };
  let _container = null;

  /* ── Chargement ──────────────────────────────────────────────────────── */
  async function loadAll() {
    const [catResp, candResp, catsResp] = await Promise.all([
      global.KmcApi.getSourcingCatalogs().catch(() => ({})),
      global.KmcApi.getSourcingCandidates().catch(() => ({})),
      fetch('/api/admin/customs-categories', { credentials: 'include' }).then(r => r.json()).catch(() => []),
    ]);
    _state.imports    = catResp.imports || catResp.catalogs || [];
    _state.candidates = candResp.candidates || [];
    _state.categories = Array.isArray(catsResp) ? catsResp : [];
  }

  async function reloadCandidates() {
    const params = {};
    if (_state.filter.state)    params.state    = _state.filter.state;
    if (_state.filter.decision) params.decision = _state.filter.decision;
    if (_state.filter.supplier) params.supplier = _state.filter.supplier;
    const r = await global.KmcApi.getSourcingCandidates(params);
    _state.candidates = r.candidates || [];
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  async function render(container) {
    _injectStyles();
    _container = container;
    container.innerHTML = '<div class="kmc-loading">⏳ Chargement du scanner…</div>';
    try {
      await loadAll();
      renderHTML();
    } catch (err) {
      container.innerHTML = `<div class="kmc-error">Erreur : ${esc(err.message)}</div>`;
    }
  }

  function renderHTML() {
    const tab = _state.activeTab;
    let html = `<div class="scs-wrap">
      <div class="kmc-view-header">
        <h2>🔍 Scanner Catalogue Fournisseur</h2>
        <div class="kmc-subtitle">Analyser un catalogue brut, prioriser les candidats à tester. <strong>Aucun import automatique vers la boutique.</strong></div>
      </div>
      <div class="scs-tabs">
        <button class="scs-tab${tab==='candidates'?' active':''}" data-act="set-tab" data-tab="candidates">📋 Candidats (${_state.candidates.length})</button>
        <button class="scs-tab${tab==='imports'?' active':''}" data-act="set-tab" data-tab="imports">📦 Imports (${_state.imports.length})</button>
        <button class="scs-tab${tab==='new'?' active':''}" data-act="set-tab" data-tab="new">➕ Nouveau import</button>
      </div>`;

    if (tab === 'candidates') html += renderCandidates();
    else if (tab === 'imports') html += renderImports();
    else html += renderNewImport();

    html += '</div>';
    html += renderDrawer();

    _container.innerHTML = html;
    bindEvents();
  }

  function renderCandidates() {
    const cands = _state.candidates;
    const byDec = {PRIORITY:0,TEST:0,WATCH:0,AVOID:0,LOSS:0};
    let needsAction = 0;
    cands.forEach(c => {
      const d = c.scan_result?.sourcing_decision;
      if (d && byDec[d] != null) byDec[d]++;
      if (c.state === 'scanned' || c.state === 'test_ready') needsAction++;
    });

    let html = `<div class="scs-kpis">
      <div class="scs-kpi"><div class="scs-kpi-label">Total</div><div class="scs-kpi-value">${cands.length}</div></div>
      <div class="scs-kpi"><div class="scs-kpi-label">À traiter</div><div class="scs-kpi-value" style="color:#f59e0b">${needsAction}</div></div>
      <div class="scs-kpi"><div class="scs-kpi-label">À tester</div><div class="scs-kpi-value" style="color:#3b82f6">${byDec.TEST}</div></div>
      <div class="scs-kpi"><div class="scs-kpi-label">À surveiller</div><div class="scs-kpi-value" style="color:#f59e0b">${byDec.WATCH}</div></div>
      <div class="scs-kpi"><div class="scs-kpi-label">À éviter</div><div class="scs-kpi-value" style="color:#dc2626">${byDec.AVOID+byDec.LOSS}</div></div>
    </div>`;

    html += `<div class="scs-filters">
      <label>État :</label>
      <select class="scs-select" data-filter="state">
        <option value="">Tous</option>
        ${['scanned','test_ready','watchlist','imported_to_catalog','rejected','archived'].map(s => `<option value="${s}"${_state.filter.state===s?' selected':''}>${s}</option>`).join('')}
      </select>
      <label>Décision :</label>
      <select class="scs-select" data-filter="decision">
        <option value="">Toutes</option>
        ${['PRIORITY','TEST','WATCH','AVOID','LOSS'].map(d => `<option value="${d}"${_state.filter.decision===d?' selected':''}>${d}</option>`).join('')}
      </select>
      <input class="scs-input-f" data-filter="supplier" placeholder="Fournisseur…" value="${esc(_state.filter.supplier)}" style="flex:1;min-width:140px">
      <button class="kmc-btn kmc-btn-secondary" data-act="apply-filters" style="font-size:12px;padding:6px 12px">Filtrer</button>
      <button class="kmc-btn kmc-btn-secondary" data-act="clear-filters" style="font-size:12px;padding:6px 10px">×</button>
    </div>`;

    if (!cands.length) return html + '<div class="kmc-empty">Aucun candidat. Importez un catalogue depuis l\'onglet "Nouveau import".</div>';

    html += '<div class="scs-table-wrap"><table class="scs-table"><thead><tr>';
    html += '<th>Produit</th><th>Fournisseur</th><th>Catégorie</th><th class="num">Achat</th><th class="num">Min sûr</th><th class="num">Conseillé</th><th class="num">Marge</th><th>Santé</th><th>Décision</th><th>État</th><th>Fiabilité</th>';
    html += '</tr></thead><tbody>';

    cands.forEach(c => {
      const sr = c.scan_result || {};
      const dc = decisionColor(sr.sourcing_decision);
      const hc = healthColor(sr.health_status);
      html += `<tr data-act="open-candidate" data-id="${c.id}">
        <td><strong>${esc(c.product_name)}</strong></td>
        <td>${esc(c.supplier_name)}</td>
        <td>${esc(c.komerce_category || '—')}</td>
        <td class="num">${fmt(c.purchase_price_kmf)}</td>
        <td class="num">${sr.minimum_safe_price_kmf ? fmt(sr.minimum_safe_price_kmf) : '—'}</td>
        <td class="num"><strong>${sr.recommended_price_kmf ? fmt(sr.recommended_price_kmf) : '—'}</strong></td>
        <td class="num">${sr.estimated_margin_pct != null ? sr.estimated_margin_pct + '%' : '—'}</td>
        <td><span style="background:${hc.bg};color:${hc.text};padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600">${sr.health_status||'—'}</span></td>
        <td><span style="background:${dc.bg};color:${dc.text};padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${sr.sourcing_decision||'—'}</span></td>
        <td>${stateBadge(c.state)}</td>
        <td>${confidenceBadge(c.confidence)}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderImports() {
    if (!_state.imports.length) return '<div class="kmc-empty">Aucun import. Cliquez sur "Nouveau import" pour commencer.</div>';
    let html = '<div class="scs-table-wrap"><table class="scs-table"><thead><tr>';
    html += '<th>Date</th><th>Fournisseur</th><th>Source</th><th class="num">Items</th><th class="num">Importés boutique</th><th>Notes</th>';
    html += '</tr></thead><tbody>';
    _state.imports.forEach(i => {
      html += `<tr>
        <td>${new Date(i.imported_at).toLocaleString('fr-FR')}</td>
        <td><strong>${esc(i.supplier_name)}</strong></td>
        <td>${i.source_type}${i.source_filename ? ' (' + esc(i.source_filename) + ')' : ''}</td>
        <td class="num">${i.items_count || i.total_items || 0}</td>
        <td class="num">${i.imported_count || 0}</td>
        <td>${esc(i.notes || '')}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderNewImport() {
    const ni = _state.newImport;
    let html = `<div class="scs-form">
      <div class="scs-source-toggle">
        <button class="scs-source-btn${ni.source_type==='csv'?' active':''}" data-act="set-source" data-source="csv">📄 Import CSV</button>
        <button class="scs-source-btn${ni.source_type==='manual'?' active':''}" data-act="set-source" data-source="manual">✍️ Saisie manuelle</button>
      </div>
      <div class="scs-form-row"><label>Nom fournisseur *</label>
        <input class="scs-input-f" data-newimp="supplier_name" value="${esc(ni.supplier_name)}" placeholder="Ex: Noon, Dragon Mart Shop X, Ali Express">
      </div>`;

    if (ni.source_type === 'csv') {
      html += `<div class="scs-csv-help">
        Colle ton CSV ici. Première ligne = en-têtes. Séparateur <code>,</code> ou <code>;</code>.<br>
        Colonnes reconnues : <code>name</code>, <code>category</code>, <code>price</code>, <code>currency</code>, <code>weight</code>, <code>image</code>, <code>url</code>…
      </div>
      <div class="scs-form-row"><textarea data-newimp="csv_text" placeholder="name,category,price,currency,weight\nRobe rouge M,clothing,45,AED,0.4\n…">${esc(ni.csv_text)}</textarea></div>
      <div style="margin-top:14px;text-align:right">
        <button class="kmc-btn kmc-btn-primary" data-act="submit-csv-import">📥 Importer le CSV</button>
      </div>`;
    } else {
      const m = ni.manual;
      html += `<h3 style="font-size:14px;margin:14px 0 10px">Saisir un produit</h3>
        <div class="scs-form-row"><label>Nom produit *</label><input class="scs-input-f" data-manual="product_name" value="${esc(m.product_name)}"></div>
        <div class="scs-form-grid">
          <div class="scs-form-row"><label>Catégorie fournisseur</label><input class="scs-input-f" data-manual="supplier_category" value="${esc(m.supplier_category)}" placeholder="Ex: Women clothing"></div>
          <div class="scs-form-row"><label>Prix achat *</label><input class="scs-input-f" type="number" step="0.01" data-manual="purchase_price" value="${esc(m.purchase_price)}"></div>
          <div class="scs-form-row"><label>Devise</label>
            <select class="scs-select" data-manual="currency">
              ${['AED','EUR','USD','KMF'].map(c => `<option value="${c}"${m.currency===c?' selected':''}>${c}</option>`).join('')}
            </select></div>
          <div class="scs-form-row"><label>Poids (kg)</label><input class="scs-input-f" type="number" step="0.01" data-manual="weight_kg" value="${esc(m.weight_kg)}"></div>
          <div class="scs-form-row"><label>L (cm)</label><input class="scs-input-f" type="number" data-manual="dim_l_cm" value="${esc(m.dim_l_cm)}"></div>
          <div class="scs-form-row"><label>l (cm)</label><input class="scs-input-f" type="number" data-manual="dim_w_cm" value="${esc(m.dim_w_cm)}"></div>
          <div class="scs-form-row"><label>h (cm)</label><input class="scs-input-f" type="number" data-manual="dim_h_cm" value="${esc(m.dim_h_cm)}"></div>
          <div class="scs-form-row"><label>URL produit</label><input class="scs-input-f" data-manual="product_url" value="${esc(m.product_url)}" placeholder="https://…"></div>
        </div>
        <div style="margin-top:14px;text-align:right">
          <button class="kmc-btn kmc-btn-primary" data-act="submit-manual-import">📥 Ajouter ce produit</button>
        </div>`;
    }
    html += '</div>';
    return html;
  }

  function renderDrawer() {
    const c = _state.selectedCandidate;
    const open = _state.drawerOpen;
    let html = `<div class="scs-drawer-bg${open?' open':''}" data-act="close-drawer"></div>`;
    html += `<div class="scs-drawer${open?' open':''}">`;
    if (!c) { html += '<div class="scs-drawer-head"><span>—</span></div></div>'; return html; }

    const sr = c.scan_result || {};
    const dc = decisionColor(sr.sourcing_decision);
    const hc = healthColor(sr.health_status);

    html += `<div class="scs-drawer-head">
      <button class="kmc-btn kmc-btn-secondary" data-act="close-drawer" style="font-size:12px;padding:6px 10px">←</button>
      <h2 class="scs-drawer-title">${esc(c.product_name)}</h2>
      ${stateBadge(c.state)}
    </div>
    <div class="scs-drawer-body">`;

    if (sr.sourcing_decision || sr.reason) {
      html += `<div class="scs-decision-bloc" style="border-color:${dc.border};background:${dc.bg}">
        <div style="font-size:18px;font-weight:800;color:${dc.text};margin-bottom:6px">${sr.sourcing_decision || '—'}</div>
        ${sr.recommended_action ? `<div style="font-size:14px;color:${dc.text};margin-bottom:6px">${esc(sr.recommended_action)}</div>` : ''}
        ${sr.reason ? `<div style="font-size:13px;color:${dc.text};font-style:italic">${esc(sr.reason)}</div>` : ''}
      </div>`;
    }

    html += `<h3 style="font-size:14px;margin:12px 0 8px">Prix calculés</h3>
    <div class="scs-prices-grid">
      <div class="scs-price-card"><div class="scs-price-label">Survie</div><div class="scs-price-value">${sr.survival_price_kmf ? fmt(sr.survival_price_kmf) : '—'}</div></div>
      <div class="scs-price-card"><div class="scs-price-label">Min. sûr</div><div class="scs-price-value">${sr.minimum_safe_price_kmf ? fmt(sr.minimum_safe_price_kmf) : '—'}</div></div>
      <div class="scs-price-card primary"><div class="scs-price-label">Conseillé</div><div class="scs-price-value">${sr.recommended_price_kmf ? fmt(sr.recommended_price_kmf) : '—'}</div></div>
      <div class="scs-price-card"><div class="scs-price-label">Test</div><div class="scs-price-value">${sr.test_price_kmf ? fmt(sr.test_price_kmf) : '—'}</div></div>
    </div>`;

    if (sr.estimated_margin_pct != null) {
      const healthStyle = `background:${hc.bg};color:${hc.text}`;
      html += `<div style="${healthStyle};padding:10px;border-radius:6px;font-size:13px;margin-bottom:14px">
        <strong>Marge estimée :</strong> ${sr.estimated_margin_pct}% ·
        <strong>Contribution :</strong> ${sr.estimated_contribution_kmf ? fmt(sr.estimated_contribution_kmf) : '—'}
        ${sr.health_status ? ` · <strong>Santé :</strong> ${sr.health_status}` : ''}
      </div>`;
    }

    html += `<h3 style="font-size:14px;margin:14px 0 8px">✏️ Corriger les données</h3>
      <div class="scs-drawer-row"><label>Catégorie Komerce</label>
        <select data-edit="komerce_category">
          ${_state.categories.map(cat => `<option value="${cat.key||cat}"${(cat.key||cat)===c.komerce_category?' selected':''}>${esc(cat.label||cat.key||cat)}</option>`).join('')}
        </select></div>
      <div class="scs-form-grid">
        <div class="scs-drawer-row"><label>Prix achat (${c.currency||'AED'})</label><input type="number" step="0.01" data-edit="purchase_price" value="${esc(c.purchase_price)}"></div>
        <div class="scs-drawer-row"><label>Devise</label>
          <select data-edit="currency">${['AED','EUR','USD','KMF'].map(cur => `<option value="${cur}"${cur===c.currency?' selected':''}>${cur}</option>`).join('')}</select></div>
        <div class="scs-drawer-row"><label>Poids (kg)</label><input type="number" step="0.01" data-edit="estimated_weight_kg" value="${esc(c.estimated_weight_kg)}"></div>
        <div class="scs-drawer-row"><label>Volume (m³)</label><input type="number" step="0.0001" data-edit="estimated_volume_m3" value="${esc(c.estimated_volume_m3)}"></div>
        <div class="scs-drawer-row"><label>Marge cible (%)</label><input type="number" step="0.5" data-edit="target_margin_pct" value="${esc(c.target_margin_pct)}"></div>
      </div>
      <div class="scs-drawer-row"><label>Notes</label><input data-edit="notes" value="${esc(c.notes||'')}" placeholder="Notes admin…"></div>
    </div>
    <div class="scs-drawer-foot">
      <button class="kmc-btn kmc-btn-secondary" data-act="save-edits">💾 Enregistrer + re-scanner</button>
      ${c.state !== 'imported_to_catalog' ? `<button class="kmc-btn kmc-btn-primary" data-act="import-product">📥 Importer dans la boutique</button>` : ''}
      ${c.state !== 'watchlist' ? `<button class="kmc-btn" style="background:#f59e0b;color:white;border-color:#d97706" data-act="watchlist">👀 Watchlist</button>` : ''}
      ${c.state !== 'rejected' ? `<button class="kmc-btn" style="color:#dc2626;border-color:#fecaca" data-act="reject">❌ Rejeter</button>` : ''}
      ${c.product_url ? `<a class="kmc-btn kmc-btn-secondary" href="${esc(c.product_url)}" target="_blank" style="text-decoration:none">🔗 Voir fournisseur</a>` : ''}
    </div>`;
    html += '</div>';
    return html;
  }

  /* ── Événements ──────────────────────────────────────────────────────── */
  function bindEvents() {
    _container.addEventListener('input', e => {
      const tgt = e.target;
      if (tgt.dataset.newimp) _state.newImport[tgt.dataset.newimp] = tgt.value;
      if (tgt.dataset.manual) _state.newImport.manual[tgt.dataset.manual] = tgt.value;
      if (tgt.dataset.edit && _state.selectedCandidate) _state.selectedCandidate[tgt.dataset.edit] = tgt.value;
      if (tgt.dataset.filter) _state.filter[tgt.dataset.filter] = tgt.value;
    });
    _container.addEventListener('change', e => {
      const tgt = e.target;
      if (tgt.dataset.newimp) _state.newImport[tgt.dataset.newimp] = tgt.value;
      if (tgt.dataset.manual) _state.newImport.manual[tgt.dataset.manual] = tgt.value;
      if (tgt.dataset.edit && _state.selectedCandidate) _state.selectedCandidate[tgt.dataset.edit] = tgt.value;
      if (tgt.dataset.filter) _state.filter[tgt.dataset.filter] = tgt.value;
    });

    _container.addEventListener('click', async e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;

      if (act === 'set-tab')    { _state.activeTab = t.dataset.tab; renderHTML(); return; }
      if (act === 'set-source') { _state.newImport.source_type = t.dataset.source; renderHTML(); return; }

      if (act === 'apply-filters') {
        try { await reloadCandidates(); renderHTML(); } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }
      if (act === 'clear-filters') {
        _state.filter = { state: '', decision: '', supplier: '' };
        try { await reloadCandidates(); renderHTML(); } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }

      if (act === 'submit-csv-import') {
        const ni = _state.newImport;
        if (!ni.supplier_name || !ni.csv_text) { alert('Nom fournisseur et CSV requis'); return; }
        t.disabled = true; t.textContent = '⏳ Import…';
        try {
          const r = await global.KmcApi.importSourcingCatalog({ supplier_name: ni.supplier_name, source_type: 'csv', csv_text: ni.csv_text });
          alert(`Import OK : ${r.created} candidats créés${r.errors?.length ? ` (${r.errors.length} erreurs)` : ''}`);
          _state.newImport = { supplier_name:'', source_type:'csv', csv_text:'', manual:{ product_name:'', supplier_category:'', purchase_price:'', currency:'AED', weight_kg:'', dim_l_cm:'', dim_w_cm:'', dim_h_cm:'', product_url:'', image_url:'' } };
          _state.activeTab = 'candidates';
          await loadAll(); renderHTML();
        } catch (err) { alert('Erreur : ' + err.message); t.disabled = false; t.textContent = '📥 Importer le CSV'; }
        return;
      }

      if (act === 'submit-manual-import') {
        const ni = _state.newImport; const m = ni.manual;
        if (!ni.supplier_name || !m.product_name || !m.purchase_price) { alert('Nom fournisseur, produit et prix achat requis'); return; }
        t.disabled = true; t.textContent = '⏳ Ajout…';
        try {
          const item = { product_name:m.product_name, supplier_category:m.supplier_category||null, purchase_price:parseFloat(m.purchase_price)||0, currency:m.currency||'AED', weight_kg:m.weight_kg?parseFloat(m.weight_kg):null, dim_l_cm:m.dim_l_cm?parseFloat(m.dim_l_cm):null, dim_w_cm:m.dim_w_cm?parseFloat(m.dim_w_cm):null, dim_h_cm:m.dim_h_cm?parseFloat(m.dim_h_cm):null, product_url:m.product_url||null, image_url:m.image_url||null };
          const r = await global.KmcApi.importSourcingCatalog({ supplier_name:ni.supplier_name, source_type:'manual', items:[item] });
          alert(`Candidat ajouté ! ${r.created} créé${r.errors?.length ? ` (${r.errors.length} erreurs)` : ''}`);
          _state.newImport.manual = { product_name:'', supplier_category:'', purchase_price:'', currency:'AED', weight_kg:'', dim_l_cm:'', dim_w_cm:'', dim_h_cm:'', product_url:'', image_url:'' };
          _state.activeTab = 'candidates';
          await loadAll(); renderHTML();
        } catch (err) { alert('Erreur : ' + err.message); t.disabled = false; t.textContent = '📥 Ajouter ce produit'; }
        return;
      }

      if (act === 'open-candidate') {
        try {
          const r = await global.KmcApi.getSourcingCandidate(t.dataset.id);
          _state.selectedCandidate = r.candidate || r;
          _state.drawerOpen = true; renderHTML();
        } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }
      if (act === 'close-drawer') { _state.drawerOpen = false; _state.selectedCandidate = null; renderHTML(); return; }

      if (act === 'save-edits') {
        const c = _state.selectedCandidate; if (!c) return;
        t.disabled = true; t.textContent = '⏳ Enregistrement…';
        try {
          const body = { komerce_category:c.komerce_category, estimated_weight_kg:parseFloat(c.estimated_weight_kg)||0, estimated_volume_m3:parseFloat(c.estimated_volume_m3)||0, purchase_price:parseFloat(c.purchase_price)||0, currency:c.currency, target_margin_pct:parseFloat(c.target_margin_pct)||0, notes:c.notes||null };
          await global.KmcApi.updateSourcingCandidate(c.id, body);
          const r = await global.KmcApi.scanSourcingCandidate(c.id);
          _state.selectedCandidate = r.candidate || r;
          await reloadCandidates(); renderHTML();
        } catch (err) { alert('Erreur : ' + err.message); t.disabled = false; t.textContent = '💾 Enregistrer + re-scanner'; }
        return;
      }

      if (act === 'import-product') {
        const c = _state.selectedCandidate; if (!c) return;
        if (!confirm(`Importer "${c.product_name}" dans la boutique en mode INACTIF ?`)) return;
        t.disabled = true; t.textContent = '⏳ Import…';
        try {
          await global.KmcApi.importSourcingProduct(c.id);
          alert('Produit créé en mode inactif. Activez-le manuellement quand prêt.');
          _state.drawerOpen = false; _state.selectedCandidate = null;
          await loadAll(); renderHTML();
        } catch (err) { alert('Erreur : ' + err.message); t.disabled = false; t.textContent = '📥 Importer dans la boutique'; }
        return;
      }

      if (act === 'watchlist') {
        const c = _state.selectedCandidate; if (!c) return;
        try { await global.KmcApi.watchlistSourcingCandidate(c.id); await loadAll(); _state.drawerOpen = false; renderHTML(); }
        catch (err) { alert('Erreur : ' + err.message); }
        return;
      }

      if (act === 'reject') {
        const c = _state.selectedCandidate; if (!c) return;
        const reason = prompt('Raison du rejet ? (optionnel)');
        if (reason === null) return;
        try { await global.KmcApi.rejectSourcingCandidate(c.id, { reason }); await loadAll(); _state.drawerOpen = false; renderHTML(); }
        catch (err) { alert('Erreur : ' + err.message); }
        return;
      }
    });
  }

  /* ── Enregistrement ──────────────────────────────────────────────────── */
  function SourcingScannerView() {
    this.render = function (container) { render(container); };
  }

  global.SourcingScannerView = SourcingScannerView;

})(window);
