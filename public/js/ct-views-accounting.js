/* ═══════════════════════════════════════════════════════════════
   BO View — Comptabilité (Multi-currency Accounting)
   Shell: BO · Section: finance_bo
   ═══════════════════════════════════════════════════════════════ */
window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.accounting = function(main) {
  main.innerHTML = '<div class="ct-loading">📊 Chargement comptabilité…</div>';

  CT.api.get('/api/dashboard/finance').then(function(fin) {
    buildUI(fin);
  }).catch(function(err) {
    main.innerHTML = '<div class="ct-error">Erreur chargement comptabilité : ' + err.message + '</div>';
  });

  function buildUI(fin) {
    var html = '';
    var taux = fin.taux_eur_kmf || 492;

    /* ── Header ── */
    html += '<div class="ct-view-header">';
    html += '<h2>📊 Comptabilité</h2>';
    html += '<div class="ct-subtitle">Vue multi-devises — KMF & EUR</div>';
    html += '</div>';

    /* ── Summary cards ── */
    var balKmf = fin.total_ca_kmf || 0;
    var balEur = fin.total_ca_eur || 0;

    html += '<div class="ct-kpi-grid">';
    html += '<div class="ct-kpi"><div class="ct-kpi-icon">🇰🇲</div><div>';
    html += '<div class="ct-kpi-value">' + CT.pc.fmt(balKmf) + '</div>';
    html += '<div class="ct-kpi-label">Balance KMF</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">🇪🇺</div><div>';
    html += '<div class="ct-kpi-value">' + (typeof balEur === 'number' ? balEur.toFixed(2) : balEur) + ' €</div>';
    html += '<div class="ct-kpi-label">Balance EUR</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">💱</div><div>';
    html += '<div class="ct-kpi-value">' + taux + '</div>';
    html += '<div class="ct-kpi-label">Taux EUR/KMF</div>';
    html += '</div></div>';
    html += '</div>';

    /* ── Transactions table ── */
    var orders = fin.recent_orders || fin.orders || [];
    html += '<div class="ct-section-block">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">';
    html += '<h3>📋 Transactions récentes</h3>';
    html += '<button class="ct-btn ct-btn-secondary" id="acct-export-csv">⬇ Export CSV</button>';
    html += '</div>';

    if (orders.length > 0) {
      html += '<div style="overflow-x:auto">';
      html += '<table class="ct-table" id="acct-table"><thead><tr>';
      html += '<th>Date</th><th>Réf</th><th>Client</th><th>Montant KMF</th><th>Montant EUR</th><th>Mode paiement</th><th>Statut</th>';
      html += '</tr></thead><tbody>';

      var totalKmf = 0;
      var totalEur = 0;

      for (var i = 0; i < orders.length; i++) {
        var o = orders[i];
        var kmf = o.total_kmf || 0;
        var eur = o.total_eur || 0;
        totalKmf += Number(kmf);
        totalEur += Number(eur);

        var dateStr = o.created_at ? CT.pc.ago(o.created_at) : '—';
        var ref = o.ref || o.id || '—';
        var client = o.client_name || o.client_email || '—';
        var mode = o.payment_mode || '—';
        var statut = o.status ? CT.pc.badge(o.status) : '—';

        html += '<tr>';
        html += '<td>' + dateStr + '</td>';
        html += '<td><strong>' + ref + '</strong></td>';
        html += '<td>' + client + '</td>';
        html += '<td>' + CT.pc.fmt(kmf) + '</td>';
        html += '<td>' + (Number(eur) > 0 ? Number(eur).toFixed(2) + ' €' : '—') + '</td>';
        html += '<td>' + mode + '</td>';
        html += '<td>' + statut + '</td>';
        html += '</tr>';
      }

      /* Totals row */
      html += '<tr style="font-weight:700;background:#f0fdf4">';
      html += '<td colspan="3">TOTAL</td>';
      html += '<td>' + CT.pc.fmt(totalKmf) + '</td>';
      html += '<td>' + totalEur.toFixed(2) + ' €</td>';
      html += '<td colspan="2"></td>';
      html += '</tr>';

      html += '</tbody></table>';
      html += '</div>';
    } else {
      html += '<div class="ct-empty">Aucune transaction récente</div>';
    }
    html += '</div>';

    main.innerHTML = html;

    /* ── Wire CSV export ── */
    var exportBtn = document.getElementById('acct-export-csv');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        var csvRows = ['Date,Ref,Client,Montant KMF,Montant EUR,Mode paiement,Statut'];
        for (var j = 0; j < orders.length; j++) {
          var row = orders[j];
          var d = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '';
          var r = (row.ref || row.id || '').toString().replace(/,/g, ' ');
          var c = (row.client_name || row.client_email || '').replace(/,/g, ' ');
          var mk = row.total_kmf || 0;
          var me = row.total_eur || 0;
          var pm = (row.payment_mode || '').replace(/,/g, ' ');
          var st = (row.status || '').replace(/,/g, ' ');
          csvRows.push(d + ',' + r + ',' + c + ',' + mk + ',' + me + ',' + pm + ',' + st);
        }
        var blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'komerce-comptabilite-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }
};
