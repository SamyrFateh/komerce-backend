/* ═══════════════════════════════════════════════════════════════
   CT View — Ventes (Sales Analytics)
   Shell: CT · Section: pilotage
   ═══════════════════════════════════════════════════════════════ */
window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.sales = function(main) {
  var period = 30;

  function render() {
    main.innerHTML = '<div class="ct-loading">📊 Chargement ventes…</div>';

    Promise.all([
      CT.api.get('/api/dashboard/sales?period=' + period),
      CT.api.get('/api/dashboard/finance')
    ]).then(function(results) {
      var s = results[0];
      var fin = results[1];
      buildUI(s, fin);
    }).catch(function(err) {
      main.innerHTML = '<div class="ct-error">Erreur chargement ventes : ' + err.message + '</div>';
    });
  }

  function buildUI(s, fin) {
    var html = '';

    /* ── Header ── */
    html += '<div class="ct-view-header">';
    html += '<h2>💰 Ventes</h2>';
    html += '<div class="ct-subtitle">Analyse des ventes — période ' + period + ' jours</div>';
    html += '</div>';

    /* ── Period selector ── */
    html += '<div style="display:flex;gap:8px;margin-bottom:20px">';
    html += '<button class="ct-btn ' + (period === 7 ? 'ct-btn-primary' : 'ct-btn-secondary') + '" data-period="7">7j</button>';
    html += '<button class="ct-btn ' + (period === 30 ? 'ct-btn-primary' : 'ct-btn-secondary') + '" data-period="30">30j</button>';
    html += '<button class="ct-btn ' + (period === 90 ? 'ct-btn-primary' : 'ct-btn-secondary') + '" data-period="90">90j</button>';
    html += '</div>';

    /* ── KPI cards ── */
    var kpi = s.kpi || {};
    var evo = kpi.evolution || {};

    html += '<div class="ct-kpi-grid">';
    html += '<div class="ct-kpi ct-card-obs"><div class="ct-kpi-icon">💰</div><div>';
    html += '<div class="ct-kpi-value">' + CT.pc.fmt(kpi.ca_kmf || 0) + '</div>';
    html += '<div class="ct-kpi-label">CA (KMF)' + (evo.ca_pct ? ' <span style="font-size:11px;color:#16a34a">' + evo.ca_pct + '</span>' : '') + '</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi ct-card-obs"><div class="ct-kpi-icon">📦</div><div>';
    html += '<div class="ct-kpi-value">' + (kpi.nb_commandes || 0) + '</div>';
    html += '<div class="ct-kpi-label">Commandes' + (evo.commandes_pct ? ' <span style="font-size:11px;color:#16a34a">' + evo.commandes_pct + '</span>' : '') + '</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi ct-card-obs"><div class="ct-kpi-icon">🛒</div><div>';
    html += '<div class="ct-kpi-value">' + CT.pc.fmt(kpi.panier_moyen || 0) + '</div>';
    html += '<div class="ct-kpi-label">Panier moyen</div>';
    html += '</div></div>';

    var margeEst = (kpi.ca_kmf || 0) * 0.25;
    html += '<div class="ct-kpi ct-card-obs"><div class="ct-kpi-icon">📈</div><div>';
    html += '<div class="ct-kpi-value">' + CT.pc.fmt(Math.round(margeEst)) + '</div>';
    html += '<div class="ct-kpi-label">Marge brute est. (25%)</div>';
    html += '</div></div>';
    html += '</div>';

    /* ── Top 5 products ── */
    var prods = (s.top_products || []).slice(0, 5);
    html += '<div class="ct-section-block">';
    html += '<h3>🏆 Top 5 produits</h3>';
    if (prods.length > 0) {
      html += '<table class="ct-table"><thead><tr>';
      html += '<th>#</th><th>Produit</th><th>Catégorie</th><th>Vendus</th><th>CA</th>';
      html += '</tr></thead><tbody>';
      for (var i = 0; i < prods.length; i++) {
        var p = prods[i];
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td>' + (p.name || '—') + '</td>';
        html += '<td>' + (p.category || '—') + '</td>';
        html += '<td>' + (p.nb_sold || 0) + '</td>';
        html += '<td>' + CT.pc.fmt(p.revenue || 0) + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    } else {
      html += '<div class="ct-empty">Aucune vente sur la période</div>';
    }
    html += '</div>';

    /* ── Revenue by island ── */
    var islands = s.by_island || [];
    html += '<div class="ct-section-block">';
    html += '<h3>🏝️ CA par île</h3>';
    if (islands.length > 0) {
      html += '<div class="ct-island-grid">';
      for (var j = 0; j < islands.length; j++) {
        var isl = islands[j];
        var name = isl.island || 'Inconnu';
        html += '<div class="ct-island-card">';
        html += '<div style="font-weight:700;margin-bottom:4px">' + name + '</div>';
        html += '<div style="font-size:18px;font-weight:700">' + CT.pc.fmt(isl.ca || 0) + '</div>';
        html += '<div style="font-size:12px;color:#64748b">' + (isl.nb || 0) + ' commandes</div>';
        html += '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="ct-empty">Aucune donnée par île</div>';
    }
    html += '</div>';

    /* ── Revenue by payment mode ── */
    var payments = s.by_payment || [];
    html += '<div class="ct-section-block">';
    html += '<h3>💳 CA par mode de paiement</h3>';
    if (payments.length > 0) {
      html += '<table class="ct-table"><thead><tr>';
      html += '<th>Mode</th><th>Commandes</th><th>CA (KMF)</th>';
      html += '</tr></thead><tbody>';
      for (var k = 0; k < payments.length; k++) {
        var pm = payments[k];
        var modeName = pm.payment_mode === 'cash_relay' ? '💵 Cash relay' : pm.payment_mode === 'stripe_eur' ? '💳 Stripe EUR' : (pm.payment_mode || '—');
        html += '<tr>';
        html += '<td>' + modeName + '</td>';
        html += '<td>' + (pm.nb || 0) + '</td>';
        html += '<td>' + CT.pc.fmt(pm.ca || 0) + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    } else {
      html += '<div class="ct-empty">Aucune donnée par mode de paiement</div>';
    }
    html += '</div>';

    main.innerHTML = html;

    /* ── Wire period buttons ── */
    var btns = main.querySelectorAll('[data-period]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener('click', function() {
        period = parseInt(this.getAttribute('data-period'));
        render();
      });
    }
  }

  render();
};
