/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-sourcing-scanner
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/**
 * KOMERCE Control Tower — Scanner Catalogue Fournisseur (LOT D)
 *
 * "Sur 1 000 articles fournisseur, lesquels méritent d'être testés ?"
 *
 * 3 zones :
 *   1. Imports — liste des batches (CSV ou manuel)
 *   2. Candidats — table filtrable, actions par ligne
 *   3. Détail (drawer) — édition rapide + re-scan
 *
 * Aucun calcul frontend : tout vient du backend (pricing-engine via scanner).
 */

'use strict';

(function() {
  if (!window.CT) window.CT = {};
  if (!CT.views) CT.views = {};

  // ═════════════════════════════════════════════════════════════════════
  // STATE
  // ═════════════════════════════════════════════════════════════════════
  const _scs = {
    activeTab: 'candidates',           // 'imports' | 'candidates' | 'new'
    imports: [],
    candidates: [],
    candidateFilter: { state: '', decision: '', supplier: '' },
    selectedCandidate: null,           // pour drawer
    drawerOpen: false,
    // Form import manuel
    newImport: {
      supplier_name: '',
      source_type: 'csv',
      csv_text: '',
      // Saisie manuelle d'un seul produit
      manual: {
        product_name: '', supplier_category: '', purchase_price: '',
        currency: 'AED', weight_kg: '', dim_l_cm: '', dim_w_cm: '', dim_h_cm: '',
        product_url: '', image_url: '',
      },
    },
    categories: [],
  };

  // ═════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═════════════════════════════════════════════════════════════════════
  const _scsNF = new Intl.NumberFormat('fr-FR');
  function _scsFmt(n) { return _scsNF.format(Math.round(n || 0)) + ' KMF'; }

  function _scsEsc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function _scsApi(method, path, body) {
    const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
    if (body != null) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('API ' + res.status + ' : ' + t.slice(0, 200));
    }
    return res.json();
  }

  // Couleurs décisions sourcing (alignées avec ct-views-pricing.js)
  function _scsDecisionColor(d) {
    const map = {
      PRIORITY: { bg: '#dcfce7', text: '#14532d', border: '#16a34a' },
      TEST:     { bg: '#eff6ff', text: '#1e40af', border: '#3b82f6' },
      WATCH:    { bg: '#fffbeb', text: '#92400e', border: '#f59e0b' },
      AVOID:    { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' },
      LOSS:     { bg: '#fef2f2', text: '#b91c1c', border: '#dc2626' },
    };
    return map[d] || { bg: '#f8fafc', text: '#64748b', border: '#cbd5e1' };
  }
  function _scsHealthColor(h) {
    const map = {
      loss:    { bg: '#fef2f2', text: '#b91c1c' },
      danger:  { bg: '#fffbeb', text: '#92400e' },
      fragile: { bg: '#fefce8', text: '#854d0e' },
      healthy: { bg: '#f0fdf4', text: '#166534' },
      strong:  { bg: '#dcfce7', text: '#14532d' },
      unknown: { bg: '#f8fafc', text: '#64748b' },
    };
    return map[h] || map.unknown;
  }
  function _scsConfidenceBadge(c) {
    const map = {
      high:   { bg: '#dcfce7', text: '#14532d', label: '✓ Fiable' },
      medium: { bg: '#fffbeb', text: '#92400e', label: '~ Moyen' },
      low:    { bg: '#fef2f2', text: '#b91c1c', label: '⚠ Faible' },
    };
    const s = map[c] || map.low;
    return '<span style="background:' + s.bg + ';color:' + s.text + ';padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + s.label + '</span>';
  }
  function _scsStateBadge(state) {
    const map = {
      raw_imported:        { label: 'Brut', bg: '#f1f5f9', text: '#64748b' },
      normalized:          { label: 'Normalisé', bg: '#e0f2fe', text: '#0369a1' },
      scanned:             { label: 'Scanné', bg: '#eff6ff', text: '#1e40af' },
      test_ready:          { label: 'Prêt à tester', bg: '#dbeafe', text: '#1d4ed8' },
      watchlist:           { label: 'Watchlist', bg: '#fef9c3', text: '#854d0e' },
      imported_to_catalog: { label: 'Importé', bg: '#dcfce7', text: '#14532d' },
      rejected:            { label: 'Rejeté', bg: '#fee2e2', text: '#b91c1c' },
      archived:            { label: 'Archivé', bg: '#f1f5f9', text: '#475569' },
    };
    const s = map[state] || { label: state, bg: '#f1f5f9', text: '#475569' };
    return '<span style="background:' + s.bg + ';color:' + s.text + ';padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + s.label + '</span>';
  }

  // ═════════════════════════════════════════════════════════════════════
  // STYLES
  // ═════════════════════════════════════════════════════════════════════
  function _scsStyles() {
    if (document.getElementById('scs-styles')) return;
    const s = document.createElement('style');
    s.id = 'scs-styles';
    s.textContent = `
      .scs-wrap { max-width: 1320px; margin: 0 auto; padding: 20px 24px; color: #1e293b; }
      .scs-h1 { font-size: 1.4rem; font-weight: 800; margin: 0 0 4px; }
      .scs-sub { font-size: 0.88rem; color: #64748b; margin: 0 0 18px; }

      .scs-tabs { display:flex; gap:4px; border-bottom:2px solid #e2e8f0; margin-bottom:18px; padding-bottom:0; flex-wrap:wrap; }
      .scs-tab { padding:10px 18px; border:none; background:none; font-size:0.92rem; font-weight:500; color:#64748b; cursor:pointer; border-bottom:3px solid transparent; margin-bottom:-2px; border-radius:6px 6px 0 0; transition:all .15s; font-family:inherit; }
      .scs-tab:hover { background:#f1f5f9; color:#1e293b; }
      .scs-tab.active { color:#16a34a; border-bottom-color:#16a34a; font-weight:600; }

      .scs-tools { display:flex; gap:8px; align-items:center; margin-bottom:14px; flex-wrap:wrap; }
      .scs-btn { padding:7px 14px; font-size:0.85rem; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#fff; color:#1e293b; font-family:inherit; transition:all .15s; }
      .scs-btn:hover { background:#f8fafc; border-color:#94a3b8; }
      .scs-btn-primary { background:#16a34a; color:#fff; border-color:#15803d; }
      .scs-btn-primary:hover { background:#15803d; }
      .scs-btn-warn { background:#f59e0b; color:#fff; border-color:#d97706; }
      .scs-btn-warn:hover { background:#d97706; }
      .scs-btn-danger { background:#fff; color:#dc2626; border-color:#fecaca; }
      .scs-btn-danger:hover { background:#fef2f2; }
      .scs-btn-sm { padding:4px 10px; font-size:0.75rem; }

      .scs-input, .scs-select, .scs-textarea {
        padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.88rem;
        font-family:inherit; background:#fff; color:#1e293b; box-sizing:border-box;
      }
      .scs-input:focus, .scs-select:focus, .scs-textarea:focus {
        outline:2px solid #16a34a; outline-offset:-1px; border-color:#16a34a;
      }
      .scs-textarea { width:100%; min-height:120px; resize:vertical; font-family:ui-monospace,monospace; font-size:0.82rem; }

      /* KPIs */
      .scs-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px; margin-bottom:16px; }
      .scs-kpi { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; }
      .scs-kpi-label { font-size:0.7rem; color:#64748b; text-transform:uppercase; letter-spacing:0.4px; font-weight:600; margin-bottom:4px; }
      .scs-kpi-value { font-size:1.4rem; font-weight:800; color:#1e293b; font-family:ui-monospace,monospace; line-height:1; }

      /* Table */
      .scs-table-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
      .scs-table { width:100%; border-collapse:collapse; font-size:0.85rem; }
      .scs-table thead { background:#f8fafc; border-bottom:1px solid #e2e8f0; }
      .scs-table th { padding:10px 8px; text-align:left; font-size:0.72rem; color:#64748b; text-transform:uppercase; letter-spacing:0.3px; font-weight:600; }
      .scs-table th.num { text-align:right; }
      .scs-table td { padding:10px 8px; border-bottom:1px solid #f1f5f9; }
      .scs-table td.num { text-align:right; font-family:ui-monospace,monospace; }
      .scs-table tbody tr:hover { background:#f8fafc; cursor:pointer; }
      .scs-table tbody tr:last-child td { border-bottom:none; }

      /* Filtres */
      .scs-filters { display:flex; gap:8px; align-items:center; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:12px; flex-wrap:wrap; }
      .scs-filters label { font-size:0.78rem; color:#475569; font-weight:600; }

      /* Drawer */
      .scs-drawer-bg { position:fixed; inset:0; background:rgba(15,23,42,0.4); opacity:0; pointer-events:none; transition:opacity .2s; z-index:99; }
      .scs-drawer-bg.open { opacity:1; pointer-events:auto; }
      .scs-drawer {
        position:fixed; top:0; right:0; width:min(560px, 90vw); height:100vh;
        background:#fff; box-shadow:-4px 0 24px rgba(0,0,0,0.1);
        transform:translateX(100%); transition:transform .25s; z-index:100; display:flex; flex-direction:column;
      }
      .scs-drawer.open { transform:translateX(0); }
      .scs-drawer-head { padding:16px 18px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; gap:12px; }
      .scs-drawer-title { font-size:1.05rem; font-weight:700; flex:1; margin:0; }
      .scs-drawer-body { flex:1; overflow-y:auto; padding:16px 18px; }
      .scs-drawer-row { margin-bottom:14px; }
      .scs-drawer-row label { display:block; font-size:0.72rem; color:#64748b; text-transform:uppercase; letter-spacing:0.4px; font-weight:600; margin-bottom:4px; }
      .scs-drawer-row input, .scs-drawer-row select { width:100%; }
      .scs-drawer-foot { padding:12px 18px; border-top:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap; }

      /* Cards résumé candidat */
      .scs-prices-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-bottom:12px; }
      .scs-price-card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; }
      .scs-price-card.primary { background:#fef3c7; border-color:#f59e0b; }
      .scs-price-label { font-size:0.7rem; color:#64748b; font-weight:600; margin-bottom:2px; }
      .scs-price-value { font-size:1.1rem; font-weight:800; font-family:ui-monospace,monospace; color:#1e293b; }

      .scs-decision-bloc { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:14px; }
      .scs-reason { background:#eff6ff; border-left:3px solid #3b82f6; padding:10px 12px; border-radius:4px; font-size:0.85rem; color:#1e40af; margin-bottom:10px; line-height:1.5; }

      .scs-empty { padding:40px 20px; text-align:center; color:#94a3b8; font-style:italic; }
      .scs-loading { padding:60px 20px; text-align:center; color:#64748b; }

      /* Form import nouveau */
      .scs-form { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:18px; }
      .scs-form-row { margin-bottom:14px; }
      .scs-form-row label { display:block; font-size:0.78rem; font-weight:600; color:#475569; margin-bottom:4px; }
      .scs-form-row input, .scs-form-row select, .scs-form-row textarea { width:100%; }
      .scs-form-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px; }
      .scs-source-toggle { display:flex; gap:6px; margin-bottom:14px; }
      .scs-source-btn { padding:8px 16px; border:1px solid #cbd5e1; background:#fff; border-radius:6px; cursor:pointer; font-size:0.85rem; font-family:inherit; color:#475569; }
      .scs-source-btn.active { background:#16a34a; color:#fff; border-color:#15803d; }
      .scs-csv-help { font-size:0.78rem; color:#64748b; margin-bottom:6px; line-height:1.4; }
      .scs-csv-help code { background:#f1f5f9; padding:1px 6px; border-radius:3px; font-family:ui-monospace,monospace; font-size:0.78rem; }
    `;
    document.head.appendChild(s);
  }

  // ═════════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ═════════════════════════════════════════════════════════════════════
  async function _scsLoadAll() {
    const [imports, candidates, cats] = await Promise.all([
      _scsApi('GET', '/api/admin/sourcing/catalogs').catch(() => ({ imports: [] })),
      _scsApi('GET', '/api/admin/sourcing/candidates').catch(() => ({ candidates: [] })),
      _scsApi('GET', '/api/admin/customs-categories').catch(() => []),
    ]);
    _scs.imports = imports.imports || [];
    _scs.candidates = candidates.candidates || [];
    _scs.categories = Array.isArray(cats) ? cats : [];
  }

  async function _scsReloadCandidates() {
    const params = [];
    if (_scs.candidateFilter.state) params.push('state=' + encodeURIComponent(_scs.candidateFilter.state));
    if (_scs.candidateFilter.decision) params.push('decision=' + encodeURIComponent(_scs.candidateFilter.decision));
    if (_scs.candidateFilter.supplier) params.push('supplier=' + encodeURIComponent(_scs.candidateFilter.supplier));
    const qs = params.length ? '?' + params.join('&') : '';
    const r = await _scsApi('GET', '/api/admin/sourcing/candidates' + qs);
    _scs.candidates = r.candidates || [];
  }

  // ═════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════
  async function _scsRender(container) {
    _scsStyles();
    container.innerHTML = '<div class="scs-loading">⏳ Chargement du scanner...</div>';
    try {
      await _scsLoadAll();
      _scsRenderHTML(container);
    } catch (err) {
      container.innerHTML = '<div class="scs-loading" style="color:#dc2626;">Erreur : ' + _scsEsc(err.message) + '</div>';
    }
  }

  function _scsRenderHTML(container) {
    let html = '<div class="scs-wrap">';
    html += '<h1 class="scs-h1">🔍 Scanner Catalogue Fournisseur</h1>';
    html += '<p class="scs-sub">Analyser un catalogue brut, prioriser les candidats à tester. ' +
      '<strong>Aucun import automatique vers la boutique.</strong></p>';

    // Onglets
    const tab = _scs.activeTab;
    html += '<div class="scs-tabs">';
    html += '  <button class="scs-tab ' + (tab === 'candidates' ? 'active' : '') + '" data-act="set-tab" data-tab="candidates">📋 Candidats (' + _scs.candidates.length + ')</button>';
    html += '  <button class="scs-tab ' + (tab === 'imports' ? 'active' : '') + '" data-act="set-tab" data-tab="imports">📦 Imports (' + _scs.imports.length + ')</button>';
    html += '  <button class="scs-tab ' + (tab === 'new' ? 'active' : '') + '" data-act="set-tab" data-tab="new">➕ Nouveau import</button>';
    html += '</div>';

    if (tab === 'candidates') html += _scsRenderCandidates();
    else if (tab === 'imports') html += _scsRenderImports();
    else if (tab === 'new') html += _scsRenderNewImport();

    html += '</div>';
    html += _scsRenderDrawer();

    container.innerHTML = html;
    _scsBindEvents(container);
  }

  // ── Vue Candidats ──
  function _scsRenderCandidates() {
    let html = '';

    // KPIs
    const total = _scs.candidates.length;
    const byDecision = { PRIORITY: 0, TEST: 0, WATCH: 0, AVOID: 0, LOSS: 0 };
    let needsAction = 0;
    _scs.candidates.forEach(c => {
      const d = c.scan_result?.sourcing_decision;
      if (d && byDecision[d] != null) byDecision[d]++;
      if (c.state === 'scanned' || c.state === 'test_ready') needsAction++;
    });

    html += '<div class="scs-kpis">';
    html += '<div class="scs-kpi"><div class="scs-kpi-label">Total candidats</div><div class="scs-kpi-value">' + total + '</div></div>';
    html += '<div class="scs-kpi"><div class="scs-kpi-label">À traiter</div><div class="scs-kpi-value" style="color:#f59e0b;">' + needsAction + '</div></div>';
    html += '<div class="scs-kpi"><div class="scs-kpi-label">À tester</div><div class="scs-kpi-value" style="color:#3b82f6;">' + byDecision.TEST + '</div></div>';
    html += '<div class="scs-kpi"><div class="scs-kpi-label">À surveiller</div><div class="scs-kpi-value" style="color:#f59e0b;">' + byDecision.WATCH + '</div></div>';
    html += '<div class="scs-kpi"><div class="scs-kpi-label">À éviter</div><div class="scs-kpi-value" style="color:#dc2626;">' + (byDecision.AVOID + byDecision.LOSS) + '</div></div>';
    html += '</div>';

    // Filtres
    html += '<div class="scs-filters">';
    html += '<label>État :</label>';
    html += '<select class="scs-select" data-filter="state">';
    html += '  <option value="">Tous</option>';
    ['scanned', 'test_ready', 'watchlist', 'imported_to_catalog', 'rejected', 'archived'].forEach(s => {
      html += '  <option value="' + s + '"' + (_scs.candidateFilter.state === s ? ' selected' : '') + '>' + s + '</option>';
    });
    html += '</select>';
    html += '<label>Décision :</label>';
    html += '<select class="scs-select" data-filter="decision">';
    html += '  <option value="">Toutes</option>';
    ['PRIORITY', 'TEST', 'WATCH', 'AVOID', 'LOSS'].forEach(d => {
      html += '  <option value="' + d + '"' + (_scs.candidateFilter.decision === d ? ' selected' : '') + '>' + d + '</option>';
    });
    html += '</select>';
    html += '<input class="scs-input" data-filter="supplier" placeholder="Fournisseur..." value="' + _scsEsc(_scs.candidateFilter.supplier) + '" style="flex:1;min-width:140px;">';
    html += '<button class="scs-btn scs-btn-sm" data-act="apply-filters">Filtrer</button>';
    html += '<button class="scs-btn scs-btn-sm" data-act="clear-filters">×</button>';
    html += '</div>';

    if (!_scs.candidates.length) {
      html += '<div class="scs-empty">Aucun candidat. Importez un catalogue depuis l\'onglet "Nouveau import".</div>';
      return html;
    }

    // Table
    html += '<div class="scs-table-wrap"><table class="scs-table"><thead><tr>';
    html += '<th>Produit</th>';
    html += '<th>Fournisseur</th>';
    html += '<th>Cat. Komerce</th>';
    html += '<th class="num">Achat (KMF)</th>';
    html += '<th class="num">Min sûr</th>';
    html += '<th class="num">Conseillé</th>';
    html += '<th class="num">Marge</th>';
    html += '<th>Santé</th>';
    html += '<th>Décision</th>';
    html += '<th>État</th>';
    html += '<th>Fiabilité</th>';
    html += '</tr></thead><tbody>';

    _scs.candidates.forEach(c => {
      const sr = c.scan_result || {};
      const dColor = _scsDecisionColor(sr.sourcing_decision);
      const hColor = _scsHealthColor(sr.health_status);
      html += '<tr data-act="open-candidate" data-id="' + c.id + '">';
      html += '<td><strong>' + _scsEsc(c.product_name) + '</strong></td>';
      html += '<td>' + _scsEsc(c.supplier_name) + '</td>';
      html += '<td>' + _scsEsc(c.komerce_category || '—') + '</td>';
      html += '<td class="num">' + _scsFmt(c.purchase_price_kmf) + '</td>';
      html += '<td class="num">' + (sr.minimum_safe_price_kmf ? _scsFmt(sr.minimum_safe_price_kmf) : '—') + '</td>';
      html += '<td class="num"><strong>' + (sr.recommended_price_kmf ? _scsFmt(sr.recommended_price_kmf) : '—') + '</strong></td>';
      html += '<td class="num">' + (sr.estimated_margin_pct != null ? sr.estimated_margin_pct + '%' : '—') + '</td>';
      html += '<td><span style="background:' + hColor.bg + ';color:' + hColor.text + ';padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + (sr.health_status || '—') + '</span></td>';
      html += '<td><span style="background:' + dColor.bg + ';color:' + dColor.text + ';padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:700;">' + (sr.sourcing_decision || '—') + '</span></td>';
      html += '<td>' + _scsStateBadge(c.state) + '</td>';
      html += '<td>' + _scsConfidenceBadge(c.confidence) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // ── Vue Imports ──
  function _scsRenderImports() {
    if (!_scs.imports.length) {
      return '<div class="scs-empty">Aucun import. Cliquez sur "Nouveau import" pour commencer.</div>';
    }
    let html = '<div class="scs-table-wrap"><table class="scs-table"><thead><tr>';
    html += '<th>Date</th><th>Fournisseur</th><th>Source</th><th class="num">Items</th><th class="num">Importés boutique</th><th>Notes</th>';
    html += '</tr></thead><tbody>';
    _scs.imports.forEach(i => {
      html += '<tr>';
      html += '<td>' + new Date(i.imported_at).toLocaleString('fr-FR') + '</td>';
      html += '<td><strong>' + _scsEsc(i.supplier_name) + '</strong></td>';
      html += '<td>' + i.source_type + (i.source_filename ? ' (' + _scsEsc(i.source_filename) + ')' : '') + '</td>';
      html += '<td class="num">' + (i.items_count || i.total_items || 0) + '</td>';
      html += '<td class="num">' + (i.imported_count || 0) + '</td>';
      html += '<td>' + _scsEsc(i.notes || '') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // ── Vue Nouveau Import ──
  function _scsRenderNewImport() {
    const ni = _scs.newImport;
    let html = '<div class="scs-form">';

    // Toggle source
    html += '<div class="scs-source-toggle">';
    html += '<button class="scs-source-btn ' + (ni.source_type === 'csv' ? 'active' : '') + '" data-act="set-source" data-source="csv">📄 Import CSV</button>';
    html += '<button class="scs-source-btn ' + (ni.source_type === 'manual' ? 'active' : '') + '" data-act="set-source" data-source="manual">✍️ Saisie manuelle</button>';
    html += '</div>';

    // Champ commun : nom fournisseur
    html += '<div class="scs-form-row">';
    html += '<label>Nom fournisseur *</label>';
    html += '<input class="scs-input" data-newimp="supplier_name" value="' + _scsEsc(ni.supplier_name) + '" placeholder="Ex: Noon, Dragon Mart Shop X, Ali Express">';
    html += '</div>';

    if (ni.source_type === 'csv') {
      html += '<div class="scs-csv-help">';
      html += 'Colle ton CSV ici. Première ligne = en-têtes. Séparateur <code>,</code> ou <code>;</code>.<br>';
      html += 'Colonnes reconnues : <code>name</code>, <code>category</code>, <code>price</code>, <code>currency</code>, <code>weight</code>, <code>image</code>, <code>url</code>, <code>description</code>, <code>moq</code>, <code>l_cm</code>, <code>w_cm</code>, <code>h_cm</code>...';
      html += '</div>';
      html += '<textarea class="scs-textarea" data-newimp="csv_text" placeholder="name,category,price,currency,weight\nRobe rouge M,clothing,45,AED,0.4\n...">' + _scsEsc(ni.csv_text) + '</textarea>';
      html += '<div style="margin-top:14px;text-align:right;">';
      html += '<button class="scs-btn scs-btn-primary" data-act="submit-csv-import">📥 Importer le CSV</button>';
      html += '</div>';
    } else {
      // Saisie manuelle d'un seul produit
      const m = ni.manual;
      html += '<h3 style="font-size:0.95rem;margin:14px 0 10px;">Saisir un produit</h3>';
      html += '<div class="scs-form-row"><label>Nom produit *</label><input class="scs-input" data-manual="product_name" value="' + _scsEsc(m.product_name) + '"></div>';
      html += '<div class="scs-form-grid">';
      html += '<div class="scs-form-row"><label>Catégorie fournisseur</label><input class="scs-input" data-manual="supplier_category" value="' + _scsEsc(m.supplier_category) + '" placeholder="Ex: Women clothing"></div>';
      html += '<div class="scs-form-row"><label>Prix achat *</label><input class="scs-input" type="number" step="0.01" data-manual="purchase_price" value="' + _scsEsc(m.purchase_price) + '"></div>';
      html += '<div class="scs-form-row"><label>Devise</label><select class="scs-select" data-manual="currency"><option value="AED"' + (m.currency === 'AED' ? ' selected' : '') + '>AED</option><option value="EUR"' + (m.currency === 'EUR' ? ' selected' : '') + '>EUR</option><option value="USD"' + (m.currency === 'USD' ? ' selected' : '') + '>USD</option><option value="KMF"' + (m.currency === 'KMF' ? ' selected' : '') + '>KMF</option></select></div>';
      html += '<div class="scs-form-row"><label>Poids (kg)</label><input class="scs-input" type="number" step="0.01" data-manual="weight_kg" value="' + _scsEsc(m.weight_kg) + '"></div>';
      html += '<div class="scs-form-row"><label>L (cm)</label><input class="scs-input" type="number" data-manual="dim_l_cm" value="' + _scsEsc(m.dim_l_cm) + '"></div>';
      html += '<div class="scs-form-row"><label>l (cm)</label><input class="scs-input" type="number" data-manual="dim_w_cm" value="' + _scsEsc(m.dim_w_cm) + '"></div>';
      html += '<div class="scs-form-row"><label>h (cm)</label><input class="scs-input" type="number" data-manual="dim_h_cm" value="' + _scsEsc(m.dim_h_cm) + '"></div>';
      html += '<div class="scs-form-row"><label>URL produit</label><input class="scs-input" data-manual="product_url" value="' + _scsEsc(m.product_url) + '" placeholder="https://..."></div>';
      html += '</div>';
      html += '<div style="margin-top:14px;text-align:right;">';
      html += '<button class="scs-btn scs-btn-primary" data-act="submit-manual-import">📥 Ajouter ce produit</button>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── Drawer détail candidat ──
  function _scsRenderDrawer() {
    const c = _scs.selectedCandidate;
    const open = _scs.drawerOpen;
    let html = '<div class="scs-drawer-bg ' + (open ? 'open' : '') + '" data-act="close-drawer"></div>';
    html += '<div class="scs-drawer ' + (open ? 'open' : '') + '">';
    if (!c) {
      html += '<div class="scs-drawer-head"><span>—</span></div></div>';
      return html;
    }
    const sr = c.scan_result || {};
    const ds = c.data_sources || {};

    html += '<div class="scs-drawer-head">';
    html += '<button class="scs-btn scs-btn-sm" data-act="close-drawer">←</button>';
    html += '<h2 class="scs-drawer-title">' + _scsEsc(c.product_name) + '</h2>';
    html += _scsStateBadge(c.state);
    html += '</div>';

    html += '<div class="scs-drawer-body">';

    // Bandeau action recommandée
    if (sr.recommended_action || sr.reason) {
      const dColor = _scsDecisionColor(sr.sourcing_decision);
      html += '<div class="scs-decision-bloc" style="border-color:' + dColor.border + ';background:' + dColor.bg + ';">';
      html += '<div style="font-size:1.1rem;font-weight:800;color:' + dColor.text + ';margin-bottom:6px;">';
      html += sr.sourcing_decision || '—';
      html += '</div>';
      if (sr.recommended_action) {
        html += '<div style="font-size:0.9rem;color:' + dColor.text + ';margin-bottom:6px;">' + _scsEsc(sr.recommended_action) + '</div>';
      }
      if (sr.reason) {
        html += '<div style="font-size:0.82rem;color:' + dColor.text + ';font-style:italic;">' + _scsEsc(sr.reason) + '</div>';
      }
      html += '</div>';
    }

    // 4 prix
    html += '<h3 style="font-size:0.92rem;margin:12px 0 8px;">Prix calculés</h3>';
    html += '<div class="scs-prices-grid">';
    html += '<div class="scs-price-card"><div class="scs-price-label">Survie</div><div class="scs-price-value">' + (sr.survival_price_kmf ? _scsFmt(sr.survival_price_kmf) : '—') + '</div></div>';
    html += '<div class="scs-price-card"><div class="scs-price-label">Min. sûr</div><div class="scs-price-value">' + (sr.minimum_safe_price_kmf ? _scsFmt(sr.minimum_safe_price_kmf) : '—') + '</div></div>';
    html += '<div class="scs-price-card primary"><div class="scs-price-label">Conseillé</div><div class="scs-price-value">' + (sr.recommended_price_kmf ? _scsFmt(sr.recommended_price_kmf) : '—') + '</div></div>';
    html += '<div class="scs-price-card"><div class="scs-price-label">Test</div><div class="scs-price-value">' + (sr.test_price_kmf ? _scsFmt(sr.test_price_kmf) : '—') + '</div></div>';
    html += '</div>';

    // Marge / contribution
    if (sr.estimated_margin_pct != null || sr.estimated_contribution_kmf != null) {
      html += '<div style="background:#f8fafc;padding:10px;border-radius:6px;font-size:0.85rem;color:#475569;margin-bottom:14px;">';
      if (sr.estimated_margin_pct != null) html += '<div><strong>Marge estimée :</strong> ' + sr.estimated_margin_pct + '%</div>';
      if (sr.estimated_contribution_kmf != null) html += '<div><strong>Contribution :</strong> ' + _scsFmt(sr.estimated_contribution_kmf) + '</div>';
      if (sr.cost_complete_estimated_kmf) html += '<div><strong>Coût complet :</strong> ' + _scsFmt(sr.cost_complete_estimated_kmf) + '</div>';
      html += '</div>';
    }

    // Édition rapide
    html += '<h3 style="font-size:0.92rem;margin:14px 0 8px;">✏️ Corriger les données</h3>';

    html += '<div class="scs-drawer-row">';
    html += '<label>Catégorie Komerce <em style="color:#94a3b8;">(source: ' + (ds.category || '?') + ')</em></label>';
    html += '<select class="scs-select" data-edit="komerce_category">';
    _scs.categories.forEach(cat => {
      const sel = (cat.key === c.komerce_category) ? ' selected' : '';
      html += '<option value="' + cat.key + '"' + sel + '>' + _scsEsc(cat.label || cat.key) + '</option>';
    });
    html += '</select></div>';

    html += '<div class="scs-form-grid">';
    html += '<div class="scs-drawer-row">';
    html += '<label>Prix achat <em>(' + (c.currency || 'AED') + ')</em></label>';
    html += '<input class="scs-input" type="number" step="0.01" data-edit="purchase_price" value="' + _scsEsc(c.purchase_price) + '">';
    html += '</div>';

    html += '<div class="scs-drawer-row">';
    html += '<label>Devise</label>';
    html += '<select class="scs-select" data-edit="currency">';
    ['AED', 'EUR', 'USD', 'KMF'].forEach(cur => {
      html += '<option value="' + cur + '"' + (cur === c.currency ? ' selected' : '') + '>' + cur + '</option>';
    });
    html += '</select></div>';

    html += '<div class="scs-drawer-row">';
    html += '<label>Poids (kg) <em>(' + (ds.weight || '?') + ')</em></label>';
    html += '<input class="scs-input" type="number" step="0.01" data-edit="estimated_weight_kg" value="' + _scsEsc(c.estimated_weight_kg) + '">';
    html += '</div>';

    html += '<div class="scs-drawer-row">';
    html += '<label>Volume (m³) <em>(' + (ds.volume || '?') + ')</em></label>';
    html += '<input class="scs-input" type="number" step="0.0001" data-edit="estimated_volume_m3" value="' + _scsEsc(c.estimated_volume_m3) + '">';
    html += '</div>';

    html += '<div class="scs-drawer-row">';
    html += '<label>Marge cible (%)</label>';
    html += '<input class="scs-input" type="number" step="0.5" data-edit="target_margin_pct" value="' + _scsEsc(c.target_margin_pct) + '">';
    html += '</div>';
    html += '</div>';

    html += '<div class="scs-drawer-row">';
    html += '<label>Notes sourcing</label>';
    html += '<input class="scs-input" data-edit="notes" value="' + _scsEsc(c.notes) + '" placeholder="Notes admin...">';
    html += '</div>';

    html += '</div>'; // body

    // Actions
    html += '<div class="scs-drawer-foot">';
    html += '<button class="scs-btn" data-act="save-edits">💾 Enregistrer + re-scanner</button>';
    if (c.state !== 'imported_to_catalog') {
      html += '<button class="scs-btn scs-btn-primary" data-act="import-product">📥 Importer dans la boutique</button>';
    }
    if (c.state !== 'watchlist') {
      html += '<button class="scs-btn scs-btn-warn" data-act="watchlist">👀 Watchlist</button>';
    }
    if (c.state !== 'rejected') {
      html += '<button class="scs-btn scs-btn-danger" data-act="reject">❌ Rejeter</button>';
    }
    if (c.product_url) {
      html += '<a class="scs-btn" href="' + _scsEsc(c.product_url) + '" target="_blank" style="text-decoration:none;">🔗 Voir produit fournisseur</a>';
    }
    html += '</div>';

    html += '</div>'; // drawer
    return html;
  }

  // ═════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═════════════════════════════════════════════════════════════════════
  function _scsBindEvents(container) {

    // ── Inputs (changements) ──
    container.addEventListener('input', (e) => {
      const tgt = e.target;
      // Form import nouveau
      if (tgt.dataset.newimp) {
        _scs.newImport[tgt.dataset.newimp] = tgt.value;
      }
      if (tgt.dataset.manual) {
        _scs.newImport.manual[tgt.dataset.manual] = tgt.value;
      }
      // Édition drawer
      if (tgt.dataset.edit && _scs.selectedCandidate) {
        _scs.selectedCandidate[tgt.dataset.edit] = tgt.value;
      }
      // Filtres
      if (tgt.dataset.filter) {
        _scs.candidateFilter[tgt.dataset.filter] = tgt.value;
      }
    });

    container.addEventListener('change', (e) => {
      const tgt = e.target;
      if (tgt.dataset.newimp) _scs.newImport[tgt.dataset.newimp] = tgt.value;
      if (tgt.dataset.manual) _scs.newImport.manual[tgt.dataset.manual] = tgt.value;
      if (tgt.dataset.edit && _scs.selectedCandidate) _scs.selectedCandidate[tgt.dataset.edit] = tgt.value;
      if (tgt.dataset.filter) _scs.candidateFilter[tgt.dataset.filter] = tgt.value;
    });

    // ── Clicks ──
    container.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;

      if (act === 'set-tab') {
        _scs.activeTab = t.dataset.tab;
        _scsRenderHTML(container);
        return;
      }

      if (act === 'set-source') {
        _scs.newImport.source_type = t.dataset.source;
        _scsRenderHTML(container);
        return;
      }

      if (act === 'apply-filters') {
        try {
          await _scsReloadCandidates();
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
        }
        return;
      }

      if (act === 'clear-filters') {
        _scs.candidateFilter = { state: '', decision: '', supplier: '' };
        try {
          await _scsReloadCandidates();
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
        }
        return;
      }

      if (act === 'submit-csv-import') {
        const ni = _scs.newImport;
        if (!ni.supplier_name || !ni.csv_text) {
          alert('Nom fournisseur et CSV requis');
          return;
        }
        t.disabled = true;
        t.textContent = '⏳ Import...';
        try {
          const r = await _scsApi('POST', '/api/admin/sourcing/catalogs/import', {
            supplier_name: ni.supplier_name,
            source_type: 'csv',
            csv_text: ni.csv_text,
          });
          alert('Import OK : ' + r.created + ' candidats créés' + (r.errors.length ? ' (' + r.errors.length + ' erreurs)' : ''));
          _scs.newImport = { supplier_name: '', source_type: 'csv', csv_text: '', manual: {
            product_name: '', supplier_category: '', purchase_price: '',
            currency: 'AED', weight_kg: '', dim_l_cm: '', dim_w_cm: '', dim_h_cm: '',
            product_url: '', image_url: '',
          }};
          _scs.activeTab = 'candidates';
          await _scsLoadAll();
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
          t.disabled = false;
          t.textContent = '📥 Importer le CSV';
        }
        return;
      }

      if (act === 'submit-manual-import') {
        const ni = _scs.newImport;
        const m = ni.manual;
        if (!ni.supplier_name || !m.product_name || !m.purchase_price) {
          alert('Nom fournisseur, nom produit et prix achat requis');
          return;
        }
        t.disabled = true;
        t.textContent = '⏳ Ajout...';
        try {
          // Construire l'item brut
          const item = {
            product_name: m.product_name,
            supplier_category: m.supplier_category || null,
            purchase_price: parseFloat(m.purchase_price) || 0,
            currency: m.currency || 'AED',
            weight_kg: m.weight_kg ? parseFloat(m.weight_kg) : null,
            dim_l_cm: m.dim_l_cm ? parseFloat(m.dim_l_cm) : null,
            dim_w_cm: m.dim_w_cm ? parseFloat(m.dim_w_cm) : null,
            dim_h_cm: m.dim_h_cm ? parseFloat(m.dim_h_cm) : null,
            product_url: m.product_url || null,
            image_url: m.image_url || null,
          };
          const r = await _scsApi('POST', '/api/admin/sourcing/catalogs/import', {
            supplier_name: ni.supplier_name,
            source_type: 'manual',
            items: [item],
          });
          alert('Candidat ajouté ! ' + r.created + ' créé' + (r.errors.length ? ' (' + r.errors.length + ' erreurs)' : ''));
          _scs.newImport.manual = {
            product_name: '', supplier_category: '', purchase_price: '',
            currency: 'AED', weight_kg: '', dim_l_cm: '', dim_w_cm: '', dim_h_cm: '',
            product_url: '', image_url: '',
          };
          _scs.activeTab = 'candidates';
          await _scsLoadAll();
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
          t.disabled = false;
          t.textContent = '📥 Ajouter ce produit';
        }
        return;
      }

      if (act === 'open-candidate') {
        const id = t.dataset.id;
        try {
          const r = await _scsApi('GET', '/api/admin/sourcing/candidates/' + id);
          _scs.selectedCandidate = r.candidate;
          _scs.drawerOpen = true;
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
        }
        return;
      }

      if (act === 'close-drawer') {
        _scs.drawerOpen = false;
        _scs.selectedCandidate = null;
        _scsRenderHTML(container);
        return;
      }

      if (act === 'save-edits') {
        const c = _scs.selectedCandidate;
        if (!c) return;
        t.disabled = true;
        t.textContent = '⏳ Enregistrement...';
        try {
          const body = {
            komerce_category: c.komerce_category,
            estimated_weight_kg: parseFloat(c.estimated_weight_kg) || 0,
            estimated_volume_m3: parseFloat(c.estimated_volume_m3) || 0,
            purchase_price: parseFloat(c.purchase_price) || 0,
            currency: c.currency,
            target_margin_pct: parseFloat(c.target_margin_pct) || 0,
            notes: c.notes || null,
          };
          await _scsApi('PUT', '/api/admin/sourcing/candidates/' + c.id, body);
          // Re-scan
          const r = await _scsApi('POST', '/api/admin/sourcing/candidates/' + c.id + '/scan');
          _scs.selectedCandidate = r.candidate;
          await _scsReloadCandidates();
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
          t.disabled = false;
          t.textContent = '💾 Enregistrer + re-scanner';
        }
        return;
      }

      if (act === 'import-product') {
        const c = _scs.selectedCandidate;
        if (!c) return;
        if (!confirm('Importer "' + c.product_name + '" dans la boutique en mode INACTIF ?')) return;
        t.disabled = true;
        t.textContent = '⏳ Import...';
        try {
          await _scsApi('POST', '/api/admin/sourcing/candidates/' + c.id + '/import-product');
          alert('Produit créé en mode inactif. Activez-le manuellement quand prêt.');
          _scs.drawerOpen = false;
          _scs.selectedCandidate = null;
          await _scsLoadAll();
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
          t.disabled = false;
          t.textContent = '📥 Importer dans la boutique';
        }
        return;
      }

      if (act === 'watchlist') {
        const c = _scs.selectedCandidate;
        if (!c) return;
        try {
          await _scsApi('POST', '/api/admin/sourcing/candidates/' + c.id + '/watchlist');
          await _scsLoadAll();
          _scs.drawerOpen = false;
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
        }
        return;
      }

      if (act === 'reject') {
        const c = _scs.selectedCandidate;
        if (!c) return;
        const reason = prompt('Raison du rejet ? (optionnel)');
        if (reason === null) return;
        try {
          await _scsApi('POST', '/api/admin/sourcing/candidates/' + c.id + '/reject', { reason });
          await _scsLoadAll();
          _scs.drawerOpen = false;
          _scsRenderHTML(container);
        } catch (err) {
          alert('Erreur : ' + err.message);
        }
        return;
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // ENTRY POINT
  // ═════════════════════════════════════════════════════════════════════
  CT.views.sourcing_scanner = async function(container) {
    await _scsRender(container);
  };

})();
