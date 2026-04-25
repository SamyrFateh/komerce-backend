/* ═══════════════════════════════════════════════════════════════════════════
   BO View — Comptabilité (Accounting) — v2
   Shell: BO · Section: finance_bo

   CONTENU:
     1. KPI : Balance KMF/EUR, taux du jour, marge réelle période
     2. Grand livre par section métier (charges par famille depuis economic-engine)
     3. Réconciliation cash relais (attendu vs collecté vs déposé)
     4. Commandes non encaissées (uncollected après X jours)
     5. Transactions détaillées (orders) + exports CSV ciblés

   SOURCES:
     /api/dashboard/finance?period=N        → KPI + marges + top produits
     /api/admin/economic/charges            → charges par famille (grand livre)
     /api/cash/reconciliation?from=&to=     → rapprochement cash
     /api/cash/uncollected?hours=N          → commandes livrées non payées

   AUTO-DOC: chaque section a un sous-titre qui explique ce qu'elle montre.
   ═══════════════════════════════════════════════════════════════════════════ */

window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.accounting = function(main) {
  // ── Styles injectés une fois ──────────────────────────────────────────────
  (function injectStyles() {
    if (document.getElementById('ct-accounting-styles')) return;
    var style = document.createElement('style');
    style.id = 'ct-accounting-styles';
    style.textContent = [
      /* Period selector */
      '.acct-period-bar { display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap; }',
      '.acct-period-bar button { padding:6px 14px; border:1px solid #cbd5e1; background:white; border-radius:20px; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s; }',
      '.acct-period-bar button:hover { border-color:#3b82f6; }',
      '.acct-period-bar button.active { background:#3b82f6; color:white; border-color:#3b82f6; }',

      /* Date range picker */
      '.acct-daterange { display:flex; align-items:center; gap:8px; margin-left:auto; font-size:13px; }',
      '.acct-daterange input { padding:5px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; }',

      /* Section header with export button */
      '.acct-section-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }',
      '.acct-section-head h3 { margin:0; }',
      '.acct-export-btn { padding:4px 12px; background:white; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; color:#475569; }',
      '.acct-export-btn:hover { background:#f1f5f9; border-color:#94a3b8; }',
      '.acct-hint { font-size:11px; color:#64748b; font-style:italic; margin-bottom:10px; }',

      /* Ledger (grand livre) */
      '.acct-ledger-family { background:white; border:1px solid #e2e8f0; border-radius:10px; margin-bottom:10px; overflow:hidden; }',
      '.acct-ledger-family-head { padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; cursor:pointer; }',
      '.acct-ledger-family-head:hover { background:#f1f5f9; }',
      '.acct-ledger-family-head h4 { margin:0; font-size:14px; }',
      '.acct-ledger-family-total { font-weight:700; font-size:15px; color:#0f172a; }',
      '.acct-ledger-family-body { display:none; padding:4px 0; }',
      '.acct-ledger-family.open .acct-ledger-family-body { display:block; }',
      '.acct-ledger-family.open .acct-ledger-arrow { transform:rotate(90deg); }',
      '.acct-ledger-arrow { display:inline-block; transition:transform 0.15s; margin-right:6px; font-size:10px; color:#64748b; }',
      '.acct-ledger-line { padding:6px 18px; display:grid; grid-template-columns:1fr auto 90px 80px; gap:12px; align-items:center; font-size:13px; border-bottom:1px solid #f1f5f9; }',
      '.acct-ledger-line:last-child { border-bottom:none; }',
      '.acct-ledger-line-name { font-weight:500; color:#334155; }',
      '.acct-ledger-line-recurrence { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.3px; }',
      '.acct-ledger-line-amount { text-align:right; font-weight:700; }',
      '.acct-ledger-line-status { text-align:center; font-size:10px; }',
      '.acct-ledger-line.inactive { opacity:0.5; }',

      /* Reconciliation agent cards */
      '.acct-reco-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }',
      '.acct-reco-card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:14px; border-left:4px solid #94a3b8; }',
      '.acct-reco-card.status-clean   { border-left-color:#10b981; }',
      '.acct-reco-card.status-warning { border-left-color:#f59e0b; }',
      '.acct-reco-card.status-alert   { border-left-color:#ef4444; background:#fef2f2; }',
      '.acct-reco-card h5 { margin:0 0 10px; font-size:14px; color:#0f172a; }',
      '.acct-reco-row { display:flex; justify-content:space-between; padding:4px 0; font-size:13px; border-bottom:1px dashed #f1f5f9; }',
      '.acct-reco-row:last-child { border-bottom:none; }',
      '.acct-reco-row strong { font-weight:700; }',
      '.acct-reco-gap-warn { color:#d97706; }',
      '.acct-reco-gap-alert { color:#dc2626; }',

      /* Uncollected table */
      '.acct-uncollected-table { width:100%; border-collapse:collapse; font-size:13px; background:white; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0; }',
      '.acct-uncollected-table th { background:#1e293b; color:white; padding:10px 12px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }',
      '.acct-uncollected-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; }',
      '.acct-uncollected-table tr:last-child td { border-bottom:none; }',
      '.acct-age-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; }',
      '.acct-age-low  { background:#fef3c7; color:#92400e; }',
      '.acct-age-mid  { background:#fed7aa; color:#9a3412; }',
      '.acct-age-high { background:#fee2e2; color:#991b1b; }',

      /* Balance label */
      '.acct-balance-sub { font-size:11px; color:#64748b; margin-top:2px; }',
    ].join('\n');
    document.head.appendChild(style);
  })();

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) {
    return (Number(n) || 0).toLocaleString('fr-FR');
  }
  function fmtEur(n) {
    return (Number(n) || 0).toFixed(2) + ' €';
  }
  function fmtShort(n) {
    var v = Number(n) || 0;
    if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (Math.abs(v) >= 1000)    return (v / 1000).toFixed(0) + 'k';
    return String(Math.round(v));
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function daysAgo(n) {
    var d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
  function hoursSince(dateStr) {
    if (!dateStr) return 0;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000);
  }
  function escCsv(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
  function downloadCsv(filename, rows) {
    var csv = rows.map(function(r) {
      return r.map(escCsv).join(',');
    }).join('\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var state = {
    period: 30,
    from: daysAgo(30),
    to: today(),
    uncollectedHours: 48,
    data: {
      finance: null,
      charges: null,
      reco: null,
      uncollected: null,
    },
    openFamilies: {},  // suivi des accordions ouverts
  };

  // ── Render ────────────────────────────────────────────────────────────────
  render();

  function render() {
    main.innerHTML = '<div class="ct-loading">📊 Chargement comptabilité…</div>';

    Promise.all([
      CT.api.get('/api/dashboard/finance?period=' + state.period),
      CT.api.get('/api/admin/economic/charges').catch(function() { return null; }),
      CT.api.get('/api/cash/reconciliation?from=' + state.from + '&to=' + state.to).catch(function() { return null; }),
      CT.api.get('/api/cash/uncollected?hours=' + state.uncollectedHours).catch(function() { return null; }),
    ]).then(function(results) {
      state.data.finance = results[0];
      state.data.charges = results[1];
      state.data.reco = results[2];
      state.data.uncollected = results[3];
      buildUI();
    }).catch(function(err) {
      main.innerHTML = '<div class="ct-error">Erreur : ' + (err.message || err) + '</div>';
    });
  }

  function buildUI() {
    var html = '';

    /* ═══ Header ═══ */
    html += '<div class="ct-view-header">';
    html += '<h2>📊 Comptabilité</h2>';
    html += '<div class="ct-subtitle">Grand livre · Réconciliation · Trésorerie multi-devises</div>';
    html += '</div>';

    /* ═══ Period selector ═══ */
    html += '<div class="acct-period-bar">';
    [7, 30, 90, 365].forEach(function(p) {
      var label = p === 365 ? '1 an' : p + 'j';
      html += '<button data-period="' + p + '"' + (state.period === p ? ' class="active"' : '') + '>' + label + '</button>';
    });
    html += '<div class="acct-daterange">';
    html += '<span>Cash période:</span>';
    html += '<input type="date" id="acct-from" value="' + state.from + '">';
    html += '<span>→</span>';
    html += '<input type="date" id="acct-to" value="' + state.to + '">';
    html += '<button class="ct-btn ct-btn-secondary" id="acct-daterange-apply" style="padding:4px 10px;font-size:12px">Appliquer</button>';
    html += '</div>';
    html += '</div>';

    /* ═══ ROW 1 — KPI ═══ */
    html += renderKPI();

    /* ═══ ROW 2 — Grand livre par section ═══ */
    html += renderLedger();

    /* ═══ ROW 3 — Réconciliation cash ═══ */
    html += renderReconciliation();

    /* ═══ ROW 4 — Uncollected ═══ */
    html += renderUncollected();

    /* ═══ ROW 5 — Transactions récentes ═══ */
    html += renderTransactions();

    main.innerHTML = html;
    wireEvents();
  }

  // ── KPI ───────────────────────────────────────────────────────────────────
  function renderKPI() {
    var fin = state.data.finance || {};
    var kpi = fin.kpi || {};
    var marges = fin.marges || {};
    var paiements = fin.paiements || {};
    var taux = (fin.taux && fin.taux.eur_kmf) ? fin.taux.eur_kmf : '—';

    var balKmf = kpi.ca_kmf || 0;
    var balEur = kpi.ca_eur || 0;
    var balCashKmf = (paiements.cash && paiements.cash.total_kmf) || 0;
    var balStripeEur = (paiements.stripe && paiements.stripe.total_eur) || 0;

    var html = '<div class="ct-kpi-grid">';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">🇰🇲</div><div>';
    html += '<div class="ct-kpi-value">' + fmtShort(balKmf) + ' <span style="font-size:13px;font-weight:500;color:#64748b">KMF</span></div>';
    html += '<div class="ct-kpi-label">CA période (' + state.period + 'j)</div>';
    html += '<div class="acct-balance-sub">Cash: ' + fmtShort(balCashKmf) + ' KMF</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">🇪🇺</div><div>';
    html += '<div class="ct-kpi-value">' + fmt(Math.round(balEur)) + ' <span style="font-size:13px;font-weight:500;color:#64748b">€</span></div>';
    html += '<div class="ct-kpi-label">Contre-valeur EUR</div>';
    html += '<div class="acct-balance-sub">Stripe: ' + fmtEur(balStripeEur) + '</div>';
    html += '</div></div>';

    html += '<div class="ct-kpi"><div class="ct-kpi-icon">💱</div><div>';
    html += '<div class="ct-kpi-value">' + taux + '</div>';
    html += '<div class="ct-kpi-label">Taux EUR/KMF</div>';
    html += '</div></div>';

    var tauxMarge = marges.taux_marge_pct;
    var margeColor = tauxMarge >= 25 ? '#16a34a' : (tauxMarge >= 15 ? '#d97706' : '#dc2626');
    html += '<div class="ct-kpi" data-nature="calculated"><div class="ct-kpi-icon">📈</div><div>';
    html += '<div class="ct-kpi-value" style="color:' + margeColor + '">' + fmtShort(marges.marge_reelle_kmf || 0) + ' <span style="font-size:13px;font-weight:500;color:#64748b">KMF</span></div>';
    html += '<div class="ct-kpi-label">Marge réelle';
    if (tauxMarge !== null && tauxMarge !== undefined) {
      html += ' · <strong>' + tauxMarge + '%</strong>';
    }
    html += '</div>';
    if (marges.nb_sans_cost > 0) {
      html += '<div class="acct-balance-sub">' + marges.nb_avec_cost + '/' + (marges.nb_avec_cost + marges.nb_sans_cost) + ' avec coûts</div>';
    }
    html += '</div></div>';

    html += '</div>';
    return html;
  }

  // ── Grand livre par section ──────────────────────────────────────────────
  function renderLedger() {
    var data = state.data.charges;
    var html = '<div class="ct-section-block">';
    html += '<div class="acct-section-head">';
    html += '<h3>📒 Grand livre — charges par section</h3>';
    html += '<button class="acct-export-btn" data-export="ledger">⬇ CSV</button>';
    html += '</div>';
    html += '<div class="acct-hint">Charges récurrentes (mensuelles) ou à la commande, regroupées par famille métier. Gérées depuis la vue <strong>Moteur économique</strong>.</div>';

    if (!data || !data.families) {
      html += '<div class="ct-empty">Moteur économique non disponible ou aucune charge configurée.</div>';
      html += '</div>';
      return html;
    }

    var families = data.families;
    var totals = data.totals || {};
    var famKeys = Object.keys(families);

    if (!famKeys.length) {
      html += '<div class="ct-empty">Aucune charge enregistrée. Va dans Moteur économique pour en créer.</div>';
      html += '</div>';
      return html;
    }

    // Résumé totaux en haut
    html += '<div style="display:flex;gap:16px;margin-bottom:12px;padding:10px 14px;background:#f1f5f9;border-radius:8px;font-size:13px">';
    html += '<span><strong>Mensuel récurrent :</strong> ' + fmt(Math.round(totals.monthly || 0)) + ' KMF</span>';
    html += '<span><strong>Par commande :</strong> ' + fmt(Math.round(totals.per_order || 0)) + ' KMF</span>';
    if (totals.weekly) html += '<span><strong>Hebdo :</strong> ' + fmt(Math.round(totals.weekly)) + ' KMF</span>';
    if (totals.one_time) html += '<span><strong>Ponctuel :</strong> ' + fmt(Math.round(totals.one_time)) + ' KMF</span>';
    html += '</div>';

    famKeys.forEach(function(fk) {
      var fam = families[fk];
      var isOpen = state.openFamilies[fk] === true;
      html += '<div class="acct-ledger-family' + (isOpen ? ' open' : '') + '" data-fam="' + fk + '">';
      html += '<div class="acct-ledger-family-head" data-toggle="' + fk + '">';
      html += '<h4><span class="acct-ledger-arrow">▶</span>' + (fam.emoji || '📦') + ' ' + (fam.label || fk) + ' <span style="font-size:11px;color:#64748b;font-weight:500">(' + fam.charges.length + ' ligne' + (fam.charges.length > 1 ? 's' : '') + ')</span></h4>';
      html += '<div class="acct-ledger-family-total">' + fmt(Math.round(fam.total_kmf)) + ' KMF</div>';
      html += '</div>';
      html += '<div class="acct-ledger-family-body">';
      (fam.charges || []).forEach(function(c) {
        var activeCls = c.is_active ? '' : ' inactive';
        html += '<div class="acct-ledger-line' + activeCls + '">';
        html += '<div class="acct-ledger-line-name">' + (c.name || '—') + (c.notes ? '<div style="font-size:11px;color:#94a3b8;font-weight:400">' + c.notes + '</div>' : '') + '</div>';
        html += '<div class="acct-ledger-line-recurrence">' + (c.recurrence_period || '—') + '</div>';
        html += '<div class="acct-ledger-line-amount">' + fmt(Math.round(c.amount_kmf || 0)) + ' KMF</div>';
        html += '<div class="acct-ledger-line-status">' + (c.is_active ? '✅' : '⊘') + '</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  // ── Réconciliation cash ──────────────────────────────────────────────────
  function renderReconciliation() {
    var reco = state.data.reco;
    var html = '<div class="ct-section-block">';
    html += '<div class="acct-section-head">';
    html += '<h3>🔁 Réconciliation cash relais</h3>';
    html += '<button class="acct-export-btn" data-export="reco">⬇ CSV</button>';
    html += '</div>';
    html += '<div class="acct-hint">Pour chaque agent : <strong>Attendu</strong> (commandes cash livrées) vs <strong>Collecté</strong> (déclaré par l\'agent) vs <strong>Déposé</strong> (remis au siège). Les écarts signalent les fonds en transit ou litiges.</div>';

    if (!reco || !reco.agents) {
      html += '<div class="ct-empty">Aucune donnée de réconciliation sur la période sélectionnée.</div>';
      html += '</div>';
      return html;
    }

    var totals = reco.totals || {};
    html += '<div style="display:flex;gap:16px;margin-bottom:12px;padding:10px 14px;background:#f1f5f9;border-radius:8px;font-size:13px;flex-wrap:wrap">';
    html += '<span><strong>Attendu :</strong> ' + fmt(Math.round(totals.expected_kmf || 0)) + ' KMF</span>';
    html += '<span><strong>Collecté :</strong> ' + fmt(Math.round(totals.declared_kmf || 0)) + ' KMF</span>';
    html += '<span><strong>Déposé :</strong> ' + fmt(Math.round(totals.deposited_kmf || 0)) + ' KMF</span>';
    var gapColl = totals.gap_collection || 0;
    var gapDep = totals.gap_deposit || 0;
    html += '<span><strong>Gap collecte :</strong> <span style="color:' + (Math.abs(gapColl) > 0 ? '#dc2626' : '#16a34a') + '">' + fmt(Math.round(gapColl)) + '</span></span>';
    html += '<span><strong>En transit (collecté-déposé) :</strong> <span style="color:' + (Math.abs(gapDep) > 0 ? '#d97706' : '#16a34a') + '">' + fmt(Math.round(gapDep)) + '</span></span>';
    html += '</div>';

    if (!reco.agents.length) {
      html += '<div class="ct-empty">Aucun agent actif sur la période.</div>';
      html += '</div>';
      return html;
    }

    html += '<div class="acct-reco-grid">';
    reco.agents.forEach(function(a) {
      var status = a.status || 'warning';
      html += '<div class="acct-reco-card status-' + status + '">';
      html += '<h5>' + (a.agent_name || (a.agent_id ? a.agent_id.slice(0, 8) : 'Agent ?')) + '</h5>';
      html += '<div class="acct-reco-row"><span>Attendu</span><strong>' + fmt(Math.round(a.expected_kmf)) + ' KMF</strong></div>';
      html += '<div class="acct-reco-row"><span>Collecté</span><strong>' + fmt(Math.round(a.declared_kmf)) + ' KMF</strong></div>';
      html += '<div class="acct-reco-row"><span>Déposé (vérifié)</span><strong>' + fmt(Math.round(a.verified_kmf || 0)) + ' KMF</strong></div>';
      if (a.pending_kmf > 0) {
        html += '<div class="acct-reco-row"><span style="color:#d97706">En attente validation</span><strong>' + fmt(Math.round(a.pending_kmf)) + '</strong></div>';
      }
      if (a.disputed_kmf > 0) {
        html += '<div class="acct-reco-row"><span style="color:#dc2626">Litigieux</span><strong>' + fmt(Math.round(a.disputed_kmf)) + '</strong></div>';
      }
      var gapColl = a.gap_collection || 0;
      var gapCls = gapColl > a.expected_kmf * 0.1 ? 'acct-reco-gap-alert' : (Math.abs(gapColl) > 0 ? 'acct-reco-gap-warn' : '');
      html += '<div class="acct-reco-row"><span>Écart collecte</span><strong class="' + gapCls + '">' + (gapColl > 0 ? '+' : '') + fmt(Math.round(gapColl)) + '</strong></div>';
      html += '</div>';
    });
    html += '</div>';

    html += '</div>';
    return html;
  }

  // ── Commandes non encaissées ─────────────────────────────────────────────
  function renderUncollected() {
    var unc = state.data.uncollected;
    var html = '<div class="ct-section-block">';
    html += '<div class="acct-section-head">';
    html += '<h3>⏰ Commandes non encaissées';
    html += ' <span style="font-size:12px;font-weight:500;color:#64748b">(livrées il y a +' + state.uncollectedHours + 'h, pas de collecte)</span>';
    html += '</h3>';
    html += '<div style="display:flex;gap:8px;align-items:center">';
    html += '<select id="acct-unc-hours" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px">';
    [24, 48, 72, 168].forEach(function(h) {
      var lbl = h === 168 ? '7 jours' : h + 'h';
      html += '<option value="' + h + '"' + (state.uncollectedHours === h ? ' selected' : '') + '>' + lbl + '</option>';
    });
    html += '</select>';
    html += '<button class="acct-export-btn" data-export="uncollected">⬇ CSV</button>';
    html += '</div>';
    html += '</div>';
    html += '<div class="acct-hint">Commandes cash remises au client ou disponibles au relais mais pour lesquelles le paiement n\'est pas encore confirmé par l\'agent. Signal opérationnel à relancer.</div>';

    if (!unc || !unc.orders || !unc.orders.length) {
      html += '<div class="ct-empty">✅ Aucune commande non encaissée au-delà de ' + state.uncollectedHours + 'h.</div>';
      html += '</div>';
      return html;
    }

    html += '<div style="margin-bottom:10px;padding:8px 12px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;font-size:13px">';
    html += '<strong>' + unc.count + ' commande' + (unc.count > 1 ? 's' : '') + '</strong> · Total manquant : <strong>' + fmt(Math.round(unc.total_missing_kmf || 0)) + ' KMF</strong>';
    html += '</div>';

    html += '<div style="overflow-x:auto">';
    html += '<table class="acct-uncollected-table">';
    html += '<thead><tr>';
    html += '<th>Âge</th><th>Référence</th><th>Client</th><th>Montant</th><th>Statut</th><th>Créée le</th>';
    html += '</tr></thead><tbody>';

    unc.orders.forEach(function(o) {
      var h = hoursSince(o.created_at);
      var ageCls = h > 168 ? 'acct-age-high' : (h > 72 ? 'acct-age-mid' : 'acct-age-low');
      var ageLabel = h >= 48 ? Math.floor(h / 24) + 'j' : h + 'h';
      var dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString('fr-FR') : '—';
      html += '<tr>';
      html += '<td><span class="acct-age-badge ' + ageCls + '">' + ageLabel + '</span></td>';
      html += '<td><strong>' + (o.reference || '—') + '</strong></td>';
      html += '<td>' + (o.client_name || '—') + (o.client_phone ? '<br><span style="font-size:11px;color:#64748b">' + o.client_phone + '</span>' : '') + '</td>';
      html += '<td><strong>' + fmt(Math.round(o.total_kmf || 0)) + ' KMF</strong></td>';
      html += '<td>' + (o.status || '—') + '</td>';
      html += '<td>' + dateStr + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '</div>';
    return html;
  }

  // ── Transactions récentes ────────────────────────────────────────────────
  function renderTransactions() {
    var fin = state.data.finance || {};
    // On affiche les top produits comme proxy car /finance ne renvoie pas les orders détaillées
    // Si tu veux les transactions détaillées, on appellera /sales ou /orders
    var topProds = fin.top_produits || [];

    var html = '<div class="ct-section-block">';
    html += '<div class="acct-section-head">';
    html += '<h3>📋 Top produits période (' + state.period + 'j)</h3>';
    html += '<button class="acct-export-btn" data-export="topprods">⬇ CSV</button>';
    html += '</div>';
    html += '<div class="acct-hint">Vue synthétique des produits contributeurs au CA. Pour les transactions individuelles, voir la vue <strong>Ventes</strong>.</div>';

    if (!topProds.length) {
      html += '<div class="ct-empty">Aucune donnée.</div>';
      html += '</div>';
      return html;
    }

    html += '<table class="ct-table"><thead><tr>';
    html += '<th>#</th><th>Produit</th><th>Catégorie</th><th>Qté</th><th>CA (KMF)</th>';
    html += '</tr></thead><tbody>';
    topProds.forEach(function(p, i) {
      html += '<tr>';
      html += '<td><strong>' + (i + 1) + '</strong></td>';
      html += '<td>' + (p.nom || '—') + '</td>';
      html += '<td style="text-transform:capitalize;color:#64748b">' + (p.categorie || '—') + '</td>';
      html += '<td>' + (p.qty || 0) + '</td>';
      html += '<td><strong>' + fmt(p.ca_kmf) + '</strong></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '</div>';
    return html;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function wireEvents() {
    // Period tabs
    main.querySelectorAll('.acct-period-bar button[data-period]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.period = parseInt(btn.dataset.period, 10);
        render();
      });
    });

    // Date range apply
    var applyBtn = main.querySelector('#acct-daterange-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', function() {
        var f = main.querySelector('#acct-from').value;
        var t = main.querySelector('#acct-to').value;
        if (f && t && f <= t) { state.from = f; state.to = t; render(); }
        else alert('⚠️ Plage invalide');
      });
    }

    // Uncollected hours selector
    var uncSel = main.querySelector('#acct-unc-hours');
    if (uncSel) {
      uncSel.addEventListener('change', function() {
        state.uncollectedHours = parseInt(uncSel.value, 10);
        render();
      });
    }

    // Ledger accordions
    main.querySelectorAll('.acct-ledger-family-head[data-toggle]').forEach(function(h) {
      h.addEventListener('click', function() {
        var k = h.dataset.toggle;
        state.openFamilies[k] = !state.openFamilies[k];
        var fam = h.parentElement;
        fam.classList.toggle('open', state.openFamilies[k]);
      });
    });

    // Export buttons
    main.querySelectorAll('.acct-export-btn[data-export]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        exportCsv(btn.dataset.export);
      });
    });
  }

  // ── Exports CSV ──────────────────────────────────────────────────────────
  function exportCsv(kind) {
    var ts = today();
    if (kind === 'ledger') {
      var data = state.data.charges;
      if (!data || !data.families) return alert('Rien à exporter');
      var rows = [['Section', 'Label', 'Nom', 'Montant KMF', 'Récurrence', 'Actif', 'Notes']];
      Object.keys(data.families).forEach(function(fk) {
        var fam = data.families[fk];
        (fam.charges || []).forEach(function(c) {
          rows.push([fk, fam.label, c.name, c.amount_kmf, c.recurrence_period || '', c.is_active ? 'oui' : 'non', c.notes || '']);
        });
      });
      downloadCsv('komerce-grand-livre-' + ts + '.csv', rows);
    }
    else if (kind === 'reco') {
      var reco = state.data.reco;
      if (!reco || !reco.agents) return alert('Rien à exporter');
      var rows = [['Agent', 'Attendu KMF', 'Collecté KMF', 'Déposé vérifié', 'En attente', 'Litigieux', 'Gap collecte', 'Gap dépôt', 'Statut']];
      reco.agents.forEach(function(a) {
        rows.push([a.agent_name || a.agent_id,
          a.expected_kmf, a.declared_kmf, a.verified_kmf || 0,
          a.pending_kmf || 0, a.disputed_kmf || 0,
          a.gap_collection, a.gap_deposit, a.status]);
      });
      downloadCsv('komerce-reconciliation-' + state.from + '-au-' + state.to + '.csv', rows);
    }
    else if (kind === 'uncollected') {
      var unc = state.data.uncollected;
      if (!unc || !unc.orders) return alert('Rien à exporter');
      var rows = [['Référence', 'Client', 'Téléphone', 'Montant KMF', 'Statut', 'Créée le', 'Âge (h)']];
      unc.orders.forEach(function(o) {
        rows.push([o.reference, o.client_name || '', o.client_phone || '',
          o.total_kmf, o.status,
          o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '',
          hoursSince(o.created_at)]);
      });
      downloadCsv('komerce-non-encaissees-' + ts + '.csv', rows);
    }
    else if (kind === 'topprods') {
      var fin = state.data.finance || {};
      var prods = fin.top_produits || [];
      var rows = [['Rang', 'Produit', 'Catégorie', 'Quantité', 'CA KMF']];
      prods.forEach(function(p, i) {
        rows.push([i + 1, p.nom, p.categorie, p.qty, p.ca_kmf]);
      });
      downloadCsv('komerce-top-produits-' + state.period + 'j-' + ts + '.csv', rows);
    }
  }
};
