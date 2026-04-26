/* ═══════════════════════════════════════════════════════════════════════════
   CT View — Clients (CRM analytique)
   Shell: CT · Section: pilotage

   POURQUOI CETTE VUE EXISTE :
   ─────────────────────────────
   Les clients sont l'actif principal de Komerce. Cette vue permet de :
     1. Voir d'un coup d'œil la santé de la base clients (segments)
     2. Identifier les "perdus en cours" (à risque) AVANT qu'ils partent
     3. Identifier les VIP actifs (ceux à protéger)
     4. Chercher un client précis (recherche par nom/téléphone)
     5. Consulter une fiche client (historique complet)

   IDENTITÉ CLIENT :
   ─────────────────
   Aujourd'hui les commandes n'ont pas toutes un user_id (clients invités).
   On regroupe donc par (téléphone, nom) en COALESCE des sources users + recipients.
   C'est la stratégie à jour. Le jour où vous aurez des comptes systématiques,
   on basculera sur user_id.

   SOURCES API :
     /api/dashboard/clients       → KPI + segments + at_risk + vip
     /api/dashboard/clients/list  → liste paginée + filtres
     /api/dashboard/clients/detail?phone=  → fiche client
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.clients = function(main) {
  // ── Styles injectés une fois ──────────────────────────────────────────────
  (function injectStyles() {
    if (document.getElementById('ct-clients-styles')) return;
    var style = document.createElement('style');
    style.id = 'ct-clients-styles';
    style.textContent = [
      /* Segments cards */
      '.cli-segments { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin-bottom:16px; }',
      '.cli-seg-card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:12px; cursor:pointer; transition:all 0.15s; border-left:4px solid #94a3b8; }',
      '.cli-seg-card:hover { border-color:#3b82f6; box-shadow:0 2px 8px rgba(59,130,246,0.1); }',
      '.cli-seg-card.active { border-color:#3b82f6; background:#eff6ff; border-left-color:#3b82f6; }',
      '.cli-seg-card .label { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.4px; }',
      '.cli-seg-card .value { font-size:24px; font-weight:700; color:#0f172a; margin:4px 0; }',
      '.cli-seg-card .pct { font-size:11px; color:#64748b; }',
      '.cli-seg-card.seg-new      { border-left-color:#3b82f6; }',
      '.cli-seg-card.seg-recurrent { border-left-color:#10b981; }',
      '.cli-seg-card.seg-vip      { border-left-color:#f59e0b; }',
      '.cli-seg-card.seg-at_risk  { border-left-color:#ef4444; background:#fef2f2; }',
      '.cli-seg-card.seg-dormant  { border-left-color:#94a3b8; opacity:0.85; }',
      '.cli-seg-card.seg-all      { border-left-color:#3b82f6; }',

      /* Toolbar */
      '.cli-toolbar { display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }',
      '.cli-search { flex:1; min-width:220px; max-width:400px; padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; }',
      '.cli-filter-select { padding:7px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; }',

      /* Table */
      '.cli-table-wrap { background:white; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }',
      '.cli-table { width:100%; border-collapse:collapse; font-size:13px; }',
      '.cli-table th { background:#1e293b; color:white; padding:10px 12px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; font-weight:700; }',
      '.cli-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; }',
      '.cli-table tr:last-child td { border-bottom:none; }',
      '.cli-table tr.row-clickable { cursor:pointer; }',
      '.cli-table tr.row-clickable:hover td { background:#f8fafc; }',
      '.cli-table .ltv { font-weight:700; }',
      '.cli-table .silence-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; }',
      '.cli-table .silence-low  { background:#dcfce7; color:#166534; }',
      '.cli-table .silence-mid  { background:#fef3c7; color:#92400e; }',
      '.cli-table .silence-high { background:#fee2e2; color:#991b1b; }',

      /* Pagination */
      '.cli-pagination { display:flex; gap:6px; justify-content:center; margin-top:12px; }',
      '.cli-pagination button { padding:6px 12px; border:1px solid #cbd5e1; background:white; border-radius:6px; font-size:13px; cursor:pointer; }',
      '.cli-pagination button:hover { background:#f1f5f9; }',
      '.cli-pagination button:disabled { opacity:0.4; cursor:not-allowed; }',
      '.cli-pagination .info { padding:6px 12px; color:#64748b; font-size:13px; }',

      /* Risk warnings */
      '.cli-risk-banner { background:#fef2f2; border-left:4px solid #ef4444; border-radius:6px; padding:12px 14px; margin-bottom:12px; }',
      '.cli-risk-banner h4 { margin:0 0 4px; font-size:14px; color:#991b1b; }',
      '.cli-risk-banner p { margin:0; font-size:12px; color:#7f1d1d; }',

      /* Modal client detail */
      '.cli-modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; }',
      '.cli-modal { background:white; border-radius:14px; max-width:780px; width:100%; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.3); }',
      '.cli-modal-head { padding:18px 24px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:flex-start; position:sticky; top:0; background:white; z-index:1; }',
      '.cli-modal-head h3 { margin:0; font-size:20px; color:#0f172a; }',
      '.cli-modal-head .sub { font-size:13px; color:#64748b; margin-top:2px; }',
      '.cli-modal-close { background:none; border:none; font-size:28px; cursor:pointer; color:#94a3b8; padding:0; line-height:1; }',
      '.cli-modal-body { padding:20px 24px; }',

      '.cli-profile-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-bottom:18px; }',
      '.cli-profile-stat { background:#f8fafc; border-radius:8px; padding:10px 12px; }',
      '.cli-profile-stat .lbl { font-size:11px; color:#64748b; text-transform:uppercase; font-weight:700; letter-spacing:0.3px; }',
      '.cli-profile-stat .val { font-size:18px; font-weight:700; color:#0f172a; margin-top:3px; }',

      '.cli-section-title { font-size:13px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:0.5px; margin:18px 0 8px; padding-bottom:6px; border-bottom:1px solid #e2e8f0; }',

      '.cli-orders-list { font-size:12px; }',
      '.cli-orders-list table { width:100%; border-collapse:collapse; }',
      '.cli-orders-list th { background:#f1f5f9; padding:6px 8px; text-align:left; font-size:10px; text-transform:uppercase; }',
      '.cli-orders-list td { padding:6px 8px; border-bottom:1px solid #f1f5f9; }',

      '.cli-empty { text-align:center; padding:40px 20px; color:#94a3b8; font-style:italic; background:#f8fafc; border-radius:10px; }',
      '.cli-section-block { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:16px; margin-bottom:16px; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtShort(n) {
    var v = Number(n) || 0;
    if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (Math.abs(v) >= 1000)    return (v / 1000).toFixed(0) + 'k';
    return String(Math.round(v));
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR');
  }
  function silenceClass(days) {
    var d = Number(days) || 0;
    if (d <= 30)  return 'silence-low';
    if (d <= 90)  return 'silence-mid';
    return 'silence-high';
  }
  function silenceLabel(days) {
    var d = Number(days) || 0;
    if (d <= 31) return d + 'j';
    if (d <= 365) return Math.floor(d / 30) + ' mois';
    return Math.floor(d / 365) + ' an' + (d > 730 ? 's' : '');
  }

  var SEGMENT_META = {
    all:       { label: 'Tous',       emoji: '👥', hint: 'Tous les clients ayant commandé au moins une fois' },
    new:       { label: 'Nouveaux',   emoji: '🆕', hint: '1 commande, < 30j depuis la première' },
    recurrent: { label: 'Récurrents', emoji: '🔁', hint: '≥ 2 commandes, dernière < 90j' },
    vip:       { label: 'VIP actifs', emoji: '⭐', hint: 'LTV ≥ seuil VIP ou ≥ 5 commandes (et actifs < 180j)' },
    at_risk:   { label: 'À risque',   emoji: '⚠️', hint: '≥ 2 commandes mais silencieux depuis 60-180j (perdus en cours)' },
    dormant:   { label: 'Dormants',   emoji: '💤', hint: 'Silencieux > 180j (probablement perdus)' },
  };

  // ── State ─────────────────────────────────────────────────────────────────
  var state = {
    summary: null,        // données globales (KPI + segments + at_risk + vip)
    list: null,           // résultats liste paginée
    page: 1,
    pageSize: 25,
    search: '',
    activeSegment: 'all',
    activeIsland: '',
    vipThreshold: 200000,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  loadSummary();

  function loadSummary() {
    main.innerHTML = '<div class="ct-loading">👥 Chargement clients…</div>';
    CT.api.get('/api/dashboard/clients?vip_threshold=' + state.vipThreshold)
      .then(function(data) {
        state.summary = data;
        // Charger aussi la liste initiale
        return loadList();
      })
      .catch(function(err) {
        main.innerHTML = '<div class="ct-error">Erreur : ' + (err.message || err) + '</div>';
      });
  }

  function loadList() {
    var qs = 'page=' + state.page + '&page_size=' + state.pageSize +
             '&segment=' + state.activeSegment +
             '&vip_threshold=' + state.vipThreshold;
    if (state.search)       qs += '&search=' + encodeURIComponent(state.search);
    if (state.activeIsland) qs += '&island=' + encodeURIComponent(state.activeIsland);

    return CT.api.get('/api/dashboard/clients/list?' + qs)
      .then(function(list) {
        state.list = list;
        buildUI();
      });
  }

  function buildUI() {
    if (!state.summary) return;
    var html = '';

    /* ═══ Header ═══ */
    html += '<div class="ct-view-header">';
    html += '<h2>👥 Clients</h2>';
    html += '<div class="ct-subtitle">Segmentation, fidélisation et détection des perdus en cours</div>';
    html += '</div>';

    /* ═══ KPI globaux ═══ */
    html += renderKPI();

    /* ═══ Banner "à risque" — au-dessus pour visibilité ═══ */
    html += renderAtRiskBanner();

    /* ═══ Segments cards (filtre actif) ═══ */
    html += renderSegments();

    /* ═══ VIP actifs ═══ */
    html += renderVip();

    /* ═══ Liste paginée des clients (avec recherche/filtres) ═══ */
    html += renderClientsList();

    /* ═══ Évolution mensuelle ═══ */
    html += renderEvolution();

    /* ═══ Par relais ═══ */
    html += renderByRelais();

    main.innerHTML = html;
    wireEvents();
  }

  // ── KPI ───────────────────────────────────────────────────────────────────
  function renderKPI() {
    var k = state.summary.kpi || {};
    var html = '<div class="ct-kpi-grid">';
    html += '<div class="ct-kpi"><div class="ct-kpi-icon">👥</div><div>';
    html += '<div class="ct-kpi-value">' + fmt(k.nb_clients) + '</div>';
    html += '<div class="ct-kpi-label">Clients période</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">📦</div><div>';
    html += '<div class="ct-kpi-value">' + fmt(k.commandes_valides) + '</div>';
    html += '<div class="ct-kpi-label">Commandes</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">🛒</div><div>';
    html += '<div class="ct-kpi-value">' + fmtShort(k.panier_moyen_kmf) + ' <span style="font-size:13px;color:#64748b">KMF</span></div>';
    html += '<div class="ct-kpi-label">Panier moyen</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">🔁</div><div>';
    html += '<div class="ct-kpi-value">' + (k.taux_recurrence_pct || 0) + '%</div>';
    html += '<div class="ct-kpi-label">Taux récurrence</div>';
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  // ── Banner à risque ───────────────────────────────────────────────────────
  function renderAtRiskBanner() {
    var atRisk = state.summary.at_risk_clients || [];
    if (!atRisk.length) return '';

    var totalLtv = atRisk.reduce(function(s, c) { return s + (c.ltv_kmf || 0); }, 0);
    return '<div class="cli-risk-banner">' +
      '<h4>⚠️ ' + atRisk.length + ' clients à risque détectés</h4>' +
      '<p>Ces clients ont commandé au moins 2 fois mais sont silencieux depuis 60–180 jours. ' +
      'Total LTV en jeu : <strong>' + fmt(totalLtv) + ' KMF</strong>. ' +
      'Voir la liste ci-dessous (segment "À risque") pour relancer.</p>' +
      '</div>';
  }

  // ── Segments ──────────────────────────────────────────────────────────────
  function renderSegments() {
    var seg = state.summary.segments || {};
    var total = seg.nb_total || 0;

    var html = '<h3 style="margin:0 0 8px">Segmentation</h3>';
    html += '<div class="cli-segments">';

    var segments = [
      { k: 'all',       count: total,             color: '#3b82f6' },
      { k: 'new',       count: seg.new || 0,      color: '#3b82f6' },
      { k: 'recurrent', count: seg.recurrent || 0, color: '#10b981' },
      { k: 'vip',       count: seg.vip || 0,      color: '#f59e0b' },
      { k: 'at_risk',   count: seg.at_risk || 0,  color: '#ef4444' },
      { k: 'dormant',   count: seg.dormant || 0,  color: '#94a3b8' },
    ];

    segments.forEach(function(s) {
      var meta = SEGMENT_META[s.k];
      var pct = total > 0 ? Math.round(s.count / total * 100) : 0;
      var activeCls = state.activeSegment === s.k ? ' active' : '';
      html += '<div class="cli-seg-card seg-' + s.k + activeCls + '" data-segment="' + s.k + '" title="' + escHtml(meta.hint) + '">';
      html += '<div class="label">' + meta.emoji + ' ' + meta.label + '</div>';
      html += '<div class="value">' + s.count + '</div>';
      html += '<div class="pct">' + (s.k === 'all' ? '100%' : pct + '%') + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // ── VIP actifs ────────────────────────────────────────────────────────────
  function renderVip() {
    var vips = state.summary.vip_clients || [];
    if (!vips.length) return '';

    var html = '<div class="cli-section-block">';
    html += '<h3 style="margin:0 0 8px">⭐ Top VIP actifs</h3>';
    html += '<div style="font-size:12px;color:#64748b;font-style:italic;margin-bottom:10px">Clients premium toujours actifs (< 180j) — à protéger en priorité</div>';
    html += '<div class="cli-table-wrap"><table class="cli-table"><thead><tr>';
    html += '<th>Client</th><th>Téléphone</th><th>Commandes</th><th>LTV</th><th>Dernière</th><th>Silence</th>';
    html += '</tr></thead><tbody>';
    vips.slice(0, 8).forEach(function(c) {
      html += '<tr class="row-clickable" data-phone="' + escHtml(c.phone) + '">';
      html += '<td><strong>' + escHtml(c.name || '—') + '</strong></td>';
      html += '<td>' + escHtml(c.phone || '—') + '</td>';
      html += '<td>' + c.nb_commandes + '</td>';
      html += '<td class="ltv">' + fmt(c.ltv_kmf) + ' KMF</td>';
      html += '<td>' + fmtDate(c.derniere_commande) + '</td>';
      html += '<td><span class="silence-badge ' + silenceClass(c.jours_silence) + '">' + silenceLabel(c.jours_silence) + '</span></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>';
    return html;
  }

  // ── Liste paginée ─────────────────────────────────────────────────────────
  function renderClientsList() {
    var list = state.list || { clients: [], total: 0 };
    var seg = SEGMENT_META[state.activeSegment] || SEGMENT_META.all;

    var html = '<div class="cli-section-block">';
    html += '<h3 style="margin:0 0 8px">' + seg.emoji + ' ' + seg.label + ' <span style="font-size:13px;color:#64748b;font-weight:500">— ' + list.total + ' client' + (list.total > 1 ? 's' : '') + '</span></h3>';
    html += '<div style="font-size:12px;color:#64748b;font-style:italic;margin-bottom:10px">' + escHtml(seg.hint) + '</div>';

    /* Toolbar */
    html += '<div class="cli-toolbar">';
    html += '<input type="search" class="cli-search" id="cli-search" placeholder="🔎 Rechercher par nom ou téléphone..." value="' + escHtml(state.search) + '">';
    html += '<select class="cli-filter-select" id="cli-island">';
    html += '<option value="">Toutes îles</option>';
    ['Grande Comore', 'Anjouan', 'Mohéli', 'Mayotte'].forEach(function(i) {
      var sel = state.activeIsland === i ? ' selected' : '';
      html += '<option value="' + i + '"' + sel + '>' + i + '</option>';
    });
    html += '</select>';
    html += '</div>';

    /* Table */
    if (!list.clients.length) {
      html += '<div class="cli-empty">Aucun client correspondant aux filtres.</div>';
    } else {
      html += '<div class="cli-table-wrap"><table class="cli-table"><thead><tr>';
      html += '<th>Client</th><th>Téléphone</th><th>Cmd</th><th>LTV</th><th>Panier moy.</th><th>1ère cmd</th><th>Dernière</th><th>Silence</th>';
      html += '</tr></thead><tbody>';
      list.clients.forEach(function(c) {
        html += '<tr class="row-clickable" data-phone="' + escHtml(c.phone) + '">';
        html += '<td><strong>' + escHtml(c.name || '—') + '</strong></td>';
        html += '<td>' + escHtml(c.phone || '—') + '</td>';
        html += '<td>' + c.nb_commandes + '</td>';
        html += '<td class="ltv">' + fmt(c.ltv_kmf) + ' KMF</td>';
        html += '<td>' + fmt(c.panier_moyen_kmf) + ' KMF</td>';
        html += '<td>' + fmtDate(c.premiere_commande) + '</td>';
        html += '<td>' + fmtDate(c.derniere_commande) + '</td>';
        html += '<td><span class="silence-badge ' + silenceClass(c.jours_silence) + '">' + silenceLabel(c.jours_silence) + '</span></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';

      /* Pagination */
      if (list.total_pages > 1) {
        html += '<div class="cli-pagination">';
        html += '<button id="cli-prev"' + (state.page <= 1 ? ' disabled' : '') + '>‹ Précédent</button>';
        html += '<span class="info">Page ' + state.page + ' / ' + list.total_pages + '</span>';
        html += '<button id="cli-next"' + (state.page >= list.total_pages ? ' disabled' : '') + '>Suivant ›</button>';
        html += '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  // ── Évolution ─────────────────────────────────────────────────────────────
  function renderEvolution() {
    var ev = state.summary.evolution || [];
    if (!ev.length) return '';

    var html = '<div class="cli-section-block">';
    html += '<h3 style="margin:0 0 8px">📈 Évolution mensuelle</h3>';
    html += '<div class="cli-table-wrap"><table class="cli-table"><thead><tr>';
    html += '<th>Mois</th><th>Clients</th><th>Commandes</th><th>CA</th>';
    html += '</tr></thead><tbody>';
    ev.forEach(function(e) {
      html += '<tr>';
      html += '<td><strong>' + e.mois + '</strong></td>';
      html += '<td>' + (e.nb_clients || 0) + '</td>';
      html += '<td>' + (e.nb_commandes || 0) + '</td>';
      html += '<td class="ltv">' + fmt(e.ca_kmf) + ' KMF</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>';
    return html;
  }

  // ── Par relais ────────────────────────────────────────────────────────────
  function renderByRelais() {
    var relais = state.summary.par_relais || [];
    if (!relais.length) return '';

    var html = '<div class="cli-section-block">';
    html += '<h3 style="margin:0 0 8px">📍 Activité par relais</h3>';
    html += '<div class="cli-table-wrap"><table class="cli-table"><thead><tr>';
    html += '<th>Relais</th><th>Île</th><th>Cmd</th><th>Livrées</th><th>CA</th>';
    html += '</tr></thead><tbody>';
    relais.forEach(function(r) {
      html += '<tr>';
      html += '<td><strong>' + escHtml(r.relais || '—') + '</strong></td>';
      html += '<td>' + escHtml(r.ile || '—') + '</td>';
      html += '<td>' + r.nb_commandes + '</td>';
      html += '<td>' + r.livrees + '</td>';
      html += '<td class="ltv">' + fmt(r.ca_kmf) + ' KMF</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>';
    return html;
  }

  // ── Modal détail client ───────────────────────────────────────────────────
  function openClientDetail(phone) {
    var modalHtml = '<div class="cli-modal-overlay" id="cli-modal">';
    modalHtml += '<div class="cli-modal">';
    modalHtml += '<div class="cli-modal-head">';
    modalHtml += '<div><h3>Chargement…</h3></div>';
    modalHtml += '<button class="cli-modal-close" data-modal-close>&times;</button>';
    modalHtml += '</div>';
    modalHtml += '<div class="cli-modal-body" id="cli-modal-body">';
    modalHtml += '<div class="ct-loading">Chargement de la fiche client…</div>';
    modalHtml += '</div></div></div>';

    var existing = document.getElementById('cli-modal');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.querySelector('#cli-modal .cli-modal-close').addEventListener('click', closeModal);
    document.getElementById('cli-modal').addEventListener('click', function(e) {
      if (e.target.id === 'cli-modal') closeModal();
    });

    CT.api.get('/api/dashboard/clients/detail?phone=' + encodeURIComponent(phone))
      .then(renderClientDetail)
      .catch(function(err) {
        document.getElementById('cli-modal-body').innerHTML =
          '<div class="ct-error">Erreur : ' + (err.message || err) + '</div>';
      });
  }

  function renderClientDetail(data) {
    var p = data.profile;
    var orders = data.orders || [];
    var prods = data.top_products || [];

    // Header
    var header = '<div><h3>' + escHtml(p.name || '—') + '</h3>';
    header += '<div class="sub">' + escHtml(p.phone || '') + (p.email ? ' · ' + escHtml(p.email) : '') + '</div>';
    header += '</div>';
    document.querySelector('#cli-modal .cli-modal-head > div:first-child').outerHTML = header;
    // Re-attacher le bouton close (perdu par le replace)
    var closeBtn = document.querySelector('#cli-modal .cli-modal-close');
    if (!closeBtn) {
      var head = document.querySelector('#cli-modal .cli-modal-head');
      var btn = document.createElement('button');
      btn.className = 'cli-modal-close';
      btn.innerHTML = '&times;';
      btn.addEventListener('click', closeModal);
      head.appendChild(btn);
    }

    // Body
    var html = '';

    // Stats profile
    html += '<div class="cli-profile-stats">';
    html += '<div class="cli-profile-stat"><div class="lbl">LTV</div><div class="val">' + fmt(p.ltv_kmf) + ' KMF</div></div>';
    html += '<div class="cli-profile-stat"><div class="lbl">Commandes</div><div class="val">' + p.nb_orders_valid + '</div></div>';
    html += '<div class="cli-profile-stat"><div class="lbl">Panier moyen</div><div class="val">' + fmt(p.panier_moyen_kmf) + ' KMF</div></div>';
    html += '<div class="cli-profile-stat"><div class="lbl">Silence</div><div class="val"><span class="silence-badge ' + silenceClass(p.jours_silence) + '">' + silenceLabel(p.jours_silence) + '</span></div></div>';
    if (p.nb_orders_cancelled > 0) {
      html += '<div class="cli-profile-stat"><div class="lbl">Annulées</div><div class="val" style="color:#dc2626">' + p.nb_orders_cancelled + '</div></div>';
    }
    html += '</div>';

    // Dates
    html += '<div style="font-size:13px;color:#64748b;margin-bottom:12px">';
    html += '🟢 1ère commande : <strong>' + fmtDate(p.premiere_commande) + '</strong> · ';
    html += '⏱ Dernière : <strong>' + fmtDate(p.derniere_commande) + '</strong>';
    if (p.country) html += ' · 🌍 ' + p.country;
    html += '</div>';

    // Commandes
    html += '<div class="cli-section-title">📦 Historique des commandes (' + orders.length + ')</div>';
    if (!orders.length) {
      html += '<div class="cli-empty" style="padding:20px">Aucune commande trouvée</div>';
    } else {
      html += '<div class="cli-orders-list"><table>';
      html += '<thead><tr><th>Date</th><th>Réf</th><th>Statut</th><th>Paiement</th><th>Relais</th><th>Total</th></tr></thead>';
      html += '<tbody>';
      orders.forEach(function(o) {
        html += '<tr>';
        html += '<td>' + fmtDate(o.created_at) + '</td>';
        html += '<td><strong>' + escHtml(o.reference || '—') + '</strong></td>';
        html += '<td>' + escHtml(o.status || '') + '</td>';
        html += '<td>' + (o.payment_mode === 'cash_relais' ? '💵' : '💳') + ' ' + escHtml(o.payment_mode || '') + '</td>';
        html += '<td>' + escHtml(o.relais || '—') + (o.ile ? ' (' + escHtml(o.ile) + ')' : '') + '</td>';
        html += '<td><strong>' + fmt(o.total_kmf) + ' KMF</strong></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }

    // Top produits du client
    if (prods.length) {
      html += '<div class="cli-section-title">🏆 Produits préférés</div>';
      html += '<div class="cli-orders-list"><table>';
      html += '<thead><tr><th>Produit</th><th>Catégorie</th><th>Qté</th><th>Cmd</th><th>Total</th></tr></thead>';
      html += '<tbody>';
      prods.forEach(function(pr) {
        html += '<tr>';
        html += '<td><strong>' + escHtml(pr.name || '—') + '</strong></td>';
        html += '<td style="text-transform:capitalize;color:#64748b">' + escHtml(pr.categorie || '—') + '</td>';
        html += '<td>' + pr.qty + '</td>';
        html += '<td>' + pr.nb_orders + '</td>';
        html += '<td><strong>' + fmt(pr.total_kmf) + ' KMF</strong></td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }

    document.getElementById('cli-modal-body').innerHTML = html;
  }

  function closeModal() {
    var el = document.getElementById('cli-modal');
    if (el) el.remove();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function wireEvents() {
    // Segments cards
    main.querySelectorAll('[data-segment]').forEach(function(el) {
      el.addEventListener('click', function() {
        state.activeSegment = el.dataset.segment;
        state.page = 1;
        loadList();
      });
    });

    // Search (debounce)
    var searchInput = document.getElementById('cli-search');
    if (searchInput) {
      var timer;
      searchInput.addEventListener('input', function() {
        clearTimeout(timer);
        timer = setTimeout(function() {
          state.search = searchInput.value;
          state.page = 1;
          loadList();
        }, 250);
      });
    }

    // Island filter
    var islandSel = document.getElementById('cli-island');
    if (islandSel) {
      islandSel.addEventListener('change', function() {
        state.activeIsland = islandSel.value;
        state.page = 1;
        loadList();
      });
    }

    // Pagination
    var prev = document.getElementById('cli-prev');
    if (prev) prev.addEventListener('click', function() {
      if (state.page > 1) { state.page--; loadList(); }
    });
    var next = document.getElementById('cli-next');
    if (next) next.addEventListener('click', function() {
      if (state.list && state.page < state.list.total_pages) { state.page++; loadList(); }
    });

    // Lignes cliquables → fiche client
    main.querySelectorAll('.row-clickable[data-phone]').forEach(function(tr) {
      tr.addEventListener('click', function() {
        openClientDetail(tr.dataset.phone);
      });
    });
  }
};
