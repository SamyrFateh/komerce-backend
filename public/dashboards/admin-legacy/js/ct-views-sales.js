/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-sales
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/* ═══════════════════════════════════════════════════════════════════════════
   CT View — Ventes (Sales Analytics) — v2
   Shell: CT · Section: pilotage

   CONTENU:
     1. KPI : CA, commandes, panier moyen, MARGE RÉELLE (depuis orders.margin_real_pct)
     2. Évolution journalière/hebdo du CA et des commandes
     3. Funnel commandes : créées → confirmées → expédiées → livrées → payées
     4. Top 5 produits
     5. Par catégorie (CA + marge)
     6. Par île
     7. Par mode de paiement
     8. Cohortes : rétention par mois d'acquisition

   SOURCE: /api/dashboard/sales?period=N (endpoint enrichi v2)
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.sales = function(main) {
  // ── Styles injectés une fois ──────────────────────────────────────────────
  (function injectStyles() {
    if (document.getElementById('ct-sales-styles')) return;
    var style = document.createElement('style');
    style.id = 'ct-sales-styles';
    style.textContent = [
      /* Period tabs */
      '.sales-period-bar { display:flex; gap:6px; margin-bottom:16px; }',
      '.sales-period-bar button { padding:6px 14px; border:1px solid #cbd5e1; background:white; border-radius:20px; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s; }',
      '.sales-period-bar button:hover { border-color:#3b82f6; }',
      '.sales-period-bar button.active { background:#3b82f6; color:white; border-color:#3b82f6; }',

      /* Evolution sparkline */
      '.sales-evolution { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:16px; }',
      '.sales-evolution-bars { display:flex; align-items:flex-end; gap:2px; height:120px; margin-top:12px; padding-bottom:4px; border-bottom:1px solid #e2e8f0; }',
      '.sales-evolution-bar { flex:1; background:#3b82f6; border-radius:2px 2px 0 0; min-height:2px; position:relative; transition:opacity 0.15s; }',
      '.sales-evolution-bar:hover { opacity:0.8; }',
      '.sales-evolution-bar:hover::after { content:attr(data-tip); position:absolute; bottom:100%; left:50%; transform:translateX(-50%); background:#1e293b; color:white; padding:4px 8px; border-radius:4px; font-size:11px; white-space:nowrap; z-index:10; margin-bottom:4px; }',
      '.sales-evolution-axis { display:flex; justify-content:space-between; font-size:10px; color:#64748b; margin-top:4px; }',

      /* Funnel */
      '.sales-funnel { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:16px; }',
      '.sales-funnel-step { display:flex; align-items:center; gap:10px; padding:6px 0; }',
      '.sales-funnel-label { flex:0 0 160px; font-size:13px; font-weight:600; color:#334155; }',
      '.sales-funnel-bar-wrap { flex:1; height:28px; background:#f1f5f9; border-radius:6px; overflow:hidden; position:relative; }',
      '.sales-funnel-bar { height:100%; border-radius:6px; display:flex; align-items:center; padding:0 10px; color:white; font-size:12px; font-weight:700; transition:width 0.3s; white-space:nowrap; }',
      '.sales-funnel-count { flex:0 0 60px; text-align:right; font-size:13px; font-weight:700; color:#0f172a; }',
      '.sales-funnel-pct { flex:0 0 55px; text-align:right; font-size:12px; color:#64748b; }',
      '.sales-funnel-drop { margin-top:8px; padding:8px 12px; background:#fef2f2; border-left:3px solid #ef4444; border-radius:4px; font-size:12px; color:#991b1b; }',

      /* Category bar chart */
      '.sales-cat-row { display:grid; grid-template-columns:120px 1fr 90px 80px 60px; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:13px; }',
      '.sales-cat-row:last-child { border-bottom:none; }',
      '.sales-cat-bar-wrap { height:16px; background:#f1f5f9; border-radius:4px; overflow:hidden; }',
      '.sales-cat-bar { height:100%; background:linear-gradient(90deg,#3b82f6,#60a5fa); border-radius:4px; }',
      '.sales-cat-marge { font-weight:700; text-align:right; }',
      '.sales-cat-marge.low  { color:#dc2626; }',
      '.sales-cat-marge.mid  { color:#d97706; }',
      '.sales-cat-marge.high { color:#16a34a; }',

      /* Islands grid */
      '.sales-island-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; }',
      '.sales-island-card { background:white; border:1px solid #e2e8f0; border-radius:8px; padding:12px; }',

      /* Cohort table */
      '.sales-cohort { overflow-x:auto; }',
      '.sales-cohort table { width:100%; border-collapse:collapse; font-size:12px; }',
      '.sales-cohort th { background:#1e293b; color:white; padding:8px; text-align:center; font-size:11px; }',
      '.sales-cohort th:first-child { text-align:left; }',
      '.sales-cohort td { padding:8px; text-align:center; border-bottom:1px solid #e2e8f0; font-weight:600; }',
      '.sales-cohort td:first-child { text-align:left; font-weight:700; color:#334155; }',
      '.sales-cohort .coh-0 { background:#f8fafc; color:#64748b; }',
      '.sales-cohort .coh-low  { background:#fef2f2; color:#991b1b; }',
      '.sales-cohort .coh-mid  { background:#fef3c7; color:#92400e; }',
      '.sales-cohort .coh-high { background:#dcfce7; color:#166534; }',

      /* Info hint */
      '.sales-hint { font-size:11px; color:#64748b; font-style:italic; margin-top:4px; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) {
    var v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000)    return (v / 1000).toFixed(0) + 'k';
    return String(Math.round(v));
  }
  function fmtFull(n) {
    return (Number(n) || 0).toLocaleString('fr-FR');
  }
  function fmtDate(dateStr, bucket) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    if (bucket === 'week') {
      return 'S' + Math.ceil((d.getDate() + (new Date(d.getFullYear(), d.getMonth(), 1).getDay())) / 7) +
             ' ' + (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2);
    }
    return d.getDate() + '/' + (d.getMonth() + 1);
  }
  function fmtMonth(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    var months = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    return months[d.getMonth()] + ' ' + String(d.getFullYear()).slice(-2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    var sign = Number(n) > 0 ? '+' : '';
    return sign + Number(n).toFixed(1) + '%';
  }
  function margeClass(pct) {
    var v = Number(pct) || 0;
    if (v >= 25) return 'high';
    if (v >= 15) return 'mid';
    return 'low';
  }
  function evoColor(pct) {
    return Number(pct) >= 0 ? '#16a34a' : '#dc2626';
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var period = 30;

  // ── Render ────────────────────────────────────────────────────────────────
  render();

  function render() {
    main.innerHTML = '<div class="ct-loading">📊 Chargement ventes…</div>';
    CT.api.get('/api/dashboard/sales?period=' + period)
      .then(buildUI)
      .catch(function(err) {
        main.innerHTML = '<div class="ct-error">Erreur : ' + (err.message || err) + '</div>';
      });
  }

  function buildUI(s) {
    var html = '';

    /* ═══ Header ═══ */
    html += '<div class="ct-view-header">';
    html += '<h2>💰 Ventes</h2>';
    html += '<div class="ct-subtitle">Analyse des ventes — période ' + period + ' jours</div>';
    html += '</div>';

    /* ═══ Period selector ═══ */
    html += '<div class="sales-period-bar">';
    [7, 30, 90, 365].forEach(function(p) {
      var label = p === 365 ? '1 an' : p + 'j';
      html += '<button data-period="' + p + '"' + (period === p ? ' class="active"' : '') + '>' + label + '</button>';
    });
    html += '</div>';

    /* ═══ ROW 1 — KPI ═══ */
    html += renderKPI(s);

    /* ═══ ROW 2 — Évolution ═══ */
    html += renderEvolution(s);

    /* ═══ ROW 3 — Funnel ═══ */
    html += renderFunnel(s);

    /* ═══ ROW 4 — Par catégorie ═══ */
    html += renderCategories(s);

    /* ═══ ROW 5 — Top produits ═══ */
    html += renderTopProducts(s);

    /* ═══ ROW 6 — Par île + Par paiement (2 colonnes) ═══ */
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">';
    html += renderByIsland(s);
    html += renderByPayment(s);
    html += '</div>';

    /* ═══ ROW 7 — Cohortes ═══ */
    html += renderCohorts(s);

    main.innerHTML = html;
    wireEvents();
  }

  // ── KPI ───────────────────────────────────────────────────────────────────
  function renderKPI(s) {
    var kpi = s.kpi || {};
    var evo = kpi.evolution || {};
    var marges = s.marges || {};

    var html = '<div class="ct-kpi-grid">';

    // CA
    html += '<div class="ct-kpi"><div class="ct-kpi-icon">💰</div><div>';
    html += '<div class="ct-kpi-value">' + fmt(kpi.ca_kmf) + ' <span style="font-size:14px;font-weight:500;color:#64748b">KMF</span></div>';
    html += '<div class="ct-kpi-label">CA période';
    if (evo.ca_pct !== null && evo.ca_pct !== undefined) {
      html += ' · <span style="color:' + evoColor(evo.ca_pct) + '">' + fmtPct(evo.ca_pct) + '</span>';
    }
    html += '</div></div></div>';

    // Commandes
    html += '<div class="ct-kpi"><div class="ct-kpi-icon">📦</div><div>';
    html += '<div class="ct-kpi-value">' + fmtFull(kpi.nb_commandes) + '</div>';
    html += '<div class="ct-kpi-label">Commandes';
    if (evo.commandes_pct !== null && evo.commandes_pct !== undefined) {
      html += ' · <span style="color:' + evoColor(evo.commandes_pct) + '">' + fmtPct(evo.commandes_pct) + '</span>';
    }
    html += '</div></div></div>';

    // Panier moyen
    html += '<div class="ct-kpi"><div class="ct-kpi-icon">🛒</div><div>';
    html += '<div class="ct-kpi-value">' + fmt(kpi.panier_moyen) + ' <span style="font-size:14px;font-weight:500;color:#64748b">KMF</span></div>';
    html += '<div class="ct-kpi-label">Panier moyen</div>';
    html += '</div></div>';

    // Marge réelle + cible business depuis finance_config (ADR-009)
    var tauxMarge = marges.taux_marge_pct || 0;
    var cibleMarge = marges.cible_marge_pct || 40;     // depuis finance_config
    var ecartCible = marges.ecart_cible_pct || 0;
    var couvPct = marges.couverture_pct || 0;
    // Couleur de l'écart : vert si on est au-dessus, rouge si sous
    var ecartColor = ecartCible >= 0 ? '#16a34a' : (ecartCible >= -10 ? '#d97706' : '#dc2626');
    var ecartIcon  = ecartCible >= 0 ? '✓' : '⚠';

    html += '<div class="ct-kpi" data-nature="calculated"><div class="ct-kpi-icon">📈</div><div>';
    html += '<div class="ct-kpi-value">' + fmt(marges.marge_reelle_kmf) + ' <span style="font-size:14px;font-weight:500;color:#64748b">KMF</span></div>';
    html += '<div class="ct-kpi-label">Marge réelle · <strong>' + tauxMarge.toFixed(1) + '%</strong>';
    html += ' <span style="color:' + ecartColor + ';font-weight:600;margin-left:6px;">' + ecartIcon + ' '
         + (ecartCible >= 0 ? '+' : '') + ecartCible.toFixed(1) + '% vs cible ' + cibleMarge + '%</span>';
    if (couvPct < 100) {
      html += ' <span title="Couverture" style="color:#d97706;font-size:11px;">(' + couvPct + '% des cmd avec coût réel)</span>';
    }
    html += '</div></div></div>';

    html += '</div>';
    return html;
  }

  // ── Évolution (bar chart sparkline) ───────────────────────────────────────
  function renderEvolution(s) {
    var evo = s.evolution || { points: [], bucket: 'day' };
    var points = evo.points || [];

    var html = '<div class="ct-section-block">';
    html += '<h3>📈 Évolution du CA' + (evo.bucket === 'week' ? ' (par semaine)' : ' (par jour)') + '</h3>';

    if (!points.length) {
      html += '<div class="ct-empty">Aucune donnée pour cette période</div>';
      html += '</div>';
      return html;
    }

    var maxCA = Math.max.apply(null, points.map(function(p) { return Number(p.ca_kmf) || 0; }));
    if (maxCA === 0) maxCA = 1;

    html += '<div class="sales-evolution">';
    html += '<div class="sales-evolution-bars">';
    points.forEach(function(p) {
      var h = Math.max(2, Math.round((Number(p.ca_kmf) / maxCA) * 100));
      var tip = fmtDate(p.date, evo.bucket) + ' · ' + fmtFull(p.ca_kmf) + ' KMF · ' + p.nb_commandes + ' cmd';
      html += '<div class="sales-evolution-bar" style="height:' + h + '%" data-tip="' + tip + '"></div>';
    });
    html += '</div>';
    html += '<div class="sales-evolution-axis">';
    html += '<span>' + fmtDate(points[0].date, evo.bucket) + '</span>';
    if (points.length > 2) {
      html += '<span>' + fmtDate(points[Math.floor(points.length/2)].date, evo.bucket) + '</span>';
    }
    html += '<span>' + fmtDate(points[points.length - 1].date, evo.bucket) + '</span>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── Funnel ────────────────────────────────────────────────────────────────
  function renderFunnel(s) {
    var funnel = s.funnel || { etapes: [], perdues: 0 };
    var etapes = funnel.etapes || [];

    var html = '<div class="ct-section-block">';
    html += '<h3>🎯 Funnel commandes</h3>';
    html += '<div class="sales-hint">Parcours du panier validé jusqu\'au paiement. Les écarts entre étapes révèlent les goulots d\'étranglement.</div>';

    if (!etapes.length) {
      html += '<div class="ct-empty">Aucune commande sur la période</div>';
      html += '</div>';
      return html;
    }

    var colors = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#10b981'];
    var nbMax = Math.max.apply(null, etapes.map(function(e) { return e.count; }));

    html += '<div class="sales-funnel">';
    etapes.forEach(function(e, i) {
      var widthPct = nbMax > 0 ? (e.count / nbMax) * 100 : 0;
      var dropPct = (i > 0 && etapes[i-1].count > 0) ? +(((etapes[i-1].count - e.count) / etapes[i-1].count) * 100).toFixed(1) : null;

      html += '<div class="sales-funnel-step">';
      html += '<div class="sales-funnel-label">' + e.label + '</div>';
      html += '<div class="sales-funnel-bar-wrap">';
      html += '<div class="sales-funnel-bar" style="width:' + widthPct + '%;background:' + colors[i % colors.length] + '">';
      if (widthPct > 15) html += fmtPct(e.pct).replace('+', '');
      html += '</div>';
      html += '</div>';
      html += '<div class="sales-funnel-count">' + fmtFull(e.count) + '</div>';
      html += '<div class="sales-funnel-pct">' + (dropPct !== null ? '−' + dropPct + '%' : '—') + '</div>';
      html += '</div>';
    });
    html += '</div>';

    if (funnel.perdues > 0) {
      html += '<div class="sales-funnel-drop">⚠️ ' + funnel.perdues + ' commandes annulées/expirées sur la période</div>';
    }

    html += '</div>';
    return html;
  }

  // ── Par catégorie ─────────────────────────────────────────────────────────
  function renderCategories(s) {
    var cats = s.by_category || [];

    var html = '<div class="ct-section-block">';
    html += '<h3>🗂️ CA & marge par catégorie</h3>';

    if (!cats.length) {
      html += '<div class="ct-empty">Aucune donnée</div>';
      html += '</div>';
      return html;
    }

    var maxCa = Math.max.apply(null, cats.map(function(c) { return c.ca_kmf; }));
    if (maxCa === 0) maxCa = 1;

    html += '<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px">';
    html += '<div class="sales-cat-row" style="font-weight:700;border-bottom:2px solid #334155;color:#64748b;font-size:11px;text-transform:uppercase">';
    html += '<div>Catégorie</div><div>CA</div><div>CA (KMF)</div><div>Marge</div><div>Taux</div>';
    html += '</div>';
    cats.forEach(function(c) {
      var barPct = (c.ca_kmf / maxCa) * 100;
      html += '<div class="sales-cat-row">';
      html += '<div style="font-weight:600;text-transform:capitalize">' + (c.categorie || '—') + '</div>';
      html += '<div class="sales-cat-bar-wrap"><div class="sales-cat-bar" style="width:' + barPct + '%"></div></div>';
      html += '<div style="text-align:right">' + fmtFull(c.ca_kmf) + '</div>';
      html += '<div class="sales-cat-marge ' + margeClass(c.taux_marge_pct) + '">' + fmtFull(c.marge_kmf) + '</div>';
      html += '<div class="sales-cat-marge ' + margeClass(c.taux_marge_pct) + '" style="text-align:right">' + c.taux_marge_pct.toFixed(1) + '%</div>';
      html += '</div>';
    });
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── Top produits ──────────────────────────────────────────────────────────
  function renderTopProducts(s) {
    var prods = (s.top_products || []).slice(0, 5);

    var html = '<div class="ct-section-block">';
    html += '<h3>🏆 Top 5 produits</h3>';

    if (!prods.length) {
      html += '<div class="ct-empty">Aucune vente sur la période</div>';
      html += '</div>';
      return html;
    }

    html += '<table class="ct-table"><thead><tr>';
    html += '<th>#</th><th>Produit</th><th>Catégorie</th><th>Vendus</th><th>CA (KMF)</th>';
    html += '</tr></thead><tbody>';
    prods.forEach(function(p, i) {
      html += '<tr>';
      html += '<td><strong>' + (i + 1) + '</strong></td>';
      html += '<td>' + (p.name || '—') + '</td>';
      html += '<td style="text-transform:capitalize;color:#64748b">' + (p.category || '—') + '</td>';
      html += '<td>' + (p.nb_sold || 0) + '</td>';
      html += '<td><strong>' + fmtFull(p.revenue) + '</strong></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
    return html;
  }

  // ── Par île ───────────────────────────────────────────────────────────────
  function renderByIsland(s) {
    var islands = s.by_island || [];

    var html = '<div class="ct-section-block">';
    html += '<h3>🏝️ CA par île</h3>';

    if (!islands.length) {
      html += '<div class="ct-empty">Aucune donnée</div>';
      html += '</div>';
      return html;
    }

    html += '<div class="sales-island-grid">';
    islands.forEach(function(isl) {
      var name = isl.island || 'Inconnu';
      html += '<div class="sales-island-card">';
      html += '<div style="font-weight:700;margin-bottom:4px;color:#0f172a">' + name + '</div>';
      html += '<div style="font-size:20px;font-weight:700;color:#3b82f6">' + fmtFull(isl.ca) + '</div>';
      html += '<div style="font-size:12px;color:#64748b">' + (isl.nb || 0) + ' commandes</div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ── Par paiement ──────────────────────────────────────────────────────────
  function renderByPayment(s) {
    var pays = s.by_payment || [];

    var html = '<div class="ct-section-block">';
    html += '<h3>💳 CA par mode de paiement</h3>';

    if (!pays.length) {
      html += '<div class="ct-empty">Aucune donnée</div>';
      html += '</div>';
      return html;
    }

    html += '<table class="ct-table"><thead><tr>';
    html += '<th>Mode</th><th>Commandes</th><th>CA (KMF)</th>';
    html += '</tr></thead><tbody>';
    pays.forEach(function(p) {
      var modeName = p.payment_mode === 'cash_relais' ? '💵 Cash relais' :
                     p.payment_mode === 'stripe_eur'  ? '💳 Stripe EUR'   :
                     (p.payment_mode || '—');
      html += '<tr>';
      html += '<td>' + modeName + '</td>';
      html += '<td>' + (p.nb || 0) + '</td>';
      html += '<td><strong>' + fmtFull(p.ca) + '</strong></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
    return html;
  }

  // ── Cohortes ──────────────────────────────────────────────────────────────
  function renderCohorts(s) {
    var coh = s.cohorts || { rows: [], limit_months: 6 };
    var rows = coh.rows || [];

    var html = '<div class="ct-section-block">';
    html += '<h3>👥 Cohortes — rétention des clients</h3>';
    html += '<div class="sales-hint">Chaque ligne = clients acquis le mois donné. Les colonnes montrent combien sont revenus les mois suivants (rétention).</div>';

    if (!rows.length) {
      html += '<div class="ct-empty">Pas assez de données pour calculer les cohortes</div>';
      html += '</div>';
      return html;
    }

    // Transformer en matrice : cohort_month × offset_months
    var matrix = {};  // { cohort_month: { offset_months: nb_clients } }
    var allCohorts = [];
    rows.forEach(function(r) {
      var key = r.cohort_month;
      if (!matrix[key]) { matrix[key] = {}; allCohorts.push(key); }
      matrix[key][r.offset_months] = r.nb_clients;
    });
    allCohorts.sort();
    var maxOffset = coh.limit_months;

    html += '<div class="sales-cohort">';
    html += '<table><thead><tr>';
    html += '<th>Cohorte (1ère cmd)</th>';
    html += '<th>Taille</th>';
    for (var i = 1; i <= maxOffset; i++) html += '<th>+' + i + ' mois</th>';
    html += '</tr></thead><tbody>';

    allCohorts.forEach(function(ch) {
      var taille = matrix[ch][0] || 0;
      html += '<tr>';
      html += '<td>' + fmtMonth(ch) + '</td>';
      html += '<td class="coh-0"><strong>' + taille + '</strong></td>';
      for (var i = 1; i <= maxOffset; i++) {
        var n = matrix[ch][i] || 0;
        var pct = taille > 0 ? Math.round((n / taille) * 100) : 0;
        var cls = n === 0 ? 'coh-0' : (pct < 15 ? 'coh-low' : (pct < 35 ? 'coh-mid' : 'coh-high'));
        html += '<td class="' + cls + '">' + (n > 0 ? n + '<br><span style="font-size:10px;font-weight:400">' + pct + '%</span>' : '—') + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function wireEvents() {
    main.querySelectorAll('.sales-period-bar button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        period = parseInt(btn.dataset.period, 10);
        render();
      });
    });
  }
};
