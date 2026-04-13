/* ===================================================================
   Komerce Control Tower — ct-views.js
   Dashboard views: each section is a self-contained view object.
   All field names match the REAL API responses (verified 2026-04-13).
   =================================================================== */
window.CT = window.CT || {};
CT.views = {};
CT.html = {};

/* ---------------------------------------------------------------
   HTML Helpers
   --------------------------------------------------------------- */

CT.html.formatKMF = function(amount) {
  if (amount == null || isNaN(amount)) return '0 KMF';
  return new Intl.NumberFormat('fr-FR').format(Math.round(amount)) + ' KMF';
};

CT.html.formatEUR = function(amount) {
  if (amount == null || isNaN(amount)) return '0,00 €';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
};

CT.html.formatDate = function(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

CT.html.formatDateTime = function(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

CT.html.statusColor = function(status) {
  var map = {
    new: 'var(--ct-blue)', confirmed: 'var(--ct-green)', ordered: 'var(--ct-cyan)',
    preparation: 'var(--ct-purple)', shipped: 'var(--ct-amber)', in_transit: 'var(--ct-orange)',
    available: 'var(--ct-amber)', collected: 'var(--ct-green-dark)', delivered: 'var(--ct-green-dark)',
    cancelled: 'var(--ct-red)', returned: 'var(--ct-slate)',
    hub_received: 'var(--ct-cyan)', hub_dispatched: 'var(--ct-purple)',
    relay_received: 'var(--ct-amber)', relay_ready: 'var(--ct-orange)'
  };
  return map[status] || 'var(--ct-text-muted)';
};

/* Next-status map for order advancement */
CT.html.NEXT_STATUS = {
  confirmed: 'ordered', ordered: 'preparation', preparation: 'shipped',
  shipped: 'in_transit', in_transit: 'available', available: 'collected'
};

CT.html.advanceOrder = async function(id, ref, currentStatus, btn) {
  var next = CT.html.NEXT_STATUS[currentStatus];
  if (!next) return;
  if (!confirm('Avancer ' + ref + ' → ' + CT.html.statusLabel(next) + ' ?')) return;
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    await CT.api.updateOrderStatus(id, next);
    CT.bus.emit('toast', ref + ' → ' + CT.html.statusLabel(next) + ' ✅', 'success');
    // Reload pipeline view
    var el = document.querySelector('.ct-main');
    if (el && CT.views.pipeline) CT.views.pipeline.load(el);
  } catch(e) {
    CT.bus.emit('toast', 'Erreur: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '▶';
  }
};

CT.html.statusLabel = function(status) {
  var map = {
    new: 'Nouveau', confirmed: 'Confirmé', ordered: 'Commandé',
    preparation: 'Préparation', shipped: 'Expédié', in_transit: 'En transit',
    available: 'Disponible', collected: 'Collecté', delivered: 'Livré',
    cancelled: 'Annulé', returned: 'Retourné', refunded: 'Remboursé',
    hub_received: 'Hub reçu', hub_dispatched: 'Hub expédié',
    relay_received: 'Relais reçu', relay_ready: 'Relais prêt'
  };
  return map[status] || status;
};

CT.html.badge = function(status) {
  return '<span class="ct-badge ' + (status || '') + '">' + CT.html.statusLabel(status) + '</span>';
};

CT.html.kpiCard = function(label, value, icon, color) {
  return '<div class="ct-kpi-card ' + (color || '') + '">' +
    '<div class="ct-kpi-icon">' + (icon || '') + '</div>' +
    '<div class="ct-kpi-value">' + value + '</div>' +
    '<div class="ct-kpi-label">' + label + '</div>' +
  '</div>';
};

CT.html.loading = function() {
  return '<div class="ct-loading">Chargement...</div>';
};

CT.html.error = function(msg) {
  return '<div class="ct-error">' + (msg || 'Erreur inconnue') + '</div>';
};

CT.html.empty = function(icon, msg) {
  return '<div class="ct-empty"><div class="ct-empty-icon">' + (icon || '📭') + '</div>' + (msg || 'Aucune donnée') + '</div>';
};

CT.html.table = function(headers, rows, options) {
  options = options || {};
  var html = '<div class="ct-table-wrap"><table class="ct-table"><thead><tr>';
  headers.forEach(function(h) {
    html += '<th>' + h + '</th>';
  });
  html += '</tr></thead><tbody>';
  if (!rows || rows.length === 0) {
    html += '<tr><td colspan="' + headers.length + '" class="ct-text-center ct-muted">Aucune donnée</td></tr>';
  } else {
    rows.forEach(function(row) {
      html += '<tr>';
      row.forEach(function(cell) {
        html += '<td>' + (cell != null ? cell : '—') + '</td>';
      });
      html += '</tr>';
    });
  }
  html += '</tbody></table></div>';
  return html;
};

CT.html.scenarioCard = function(scenario) {
  var html = '<div class="ct-scenario-card" id="card-' + scenario.id + '">';
  html += '<div class="ct-scenario-card-header">';
  html += '<span class="ct-scenario-card-icon">' + scenario.icon + '</span>';
  html += '<span class="ct-scenario-card-name">' + scenario.name + '</span>';
  html += '</div>';
  html += '<div class="ct-scenario-card-desc">' + scenario.description + '</div>';

  if (scenario.fields && scenario.fields.length > 0) {
    html += '<div class="ct-scenario-fields">';
    scenario.fields.forEach(function(f) {
      html += '<div class="ct-scenario-field">';
      html += '<label for="field-' + scenario.id + '-' + f.key + '">' + f.label + '</label>';
      if (f.type === 'select') {
        html += '<select id="field-' + scenario.id + '-' + f.key + '" data-key="' + f.key + '">';
        (f.options || []).forEach(function(opt) {
          var val = typeof opt === 'object' ? opt.value : opt;
          var lbl = typeof opt === 'object' ? opt.label : opt;
          var sel = (f.default && f.default === val) ? ' selected' : '';
          html += '<option value="' + val + '"' + sel + '>' + lbl + '</option>';
        });
        html += '</select>';
      } else if (f.type === 'textarea') {
        html += '<textarea id="field-' + scenario.id + '-' + f.key + '" data-key="' + f.key + '" rows="3">' + (f.default || '') + '</textarea>';
      } else {
        var inputType = f.type === 'number' ? 'number' : 'text';
        html += '<input type="' + inputType + '" id="field-' + scenario.id + '-' + f.key + '" data-key="' + f.key + '" value="' + (f.default || '') + '">';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  html += '<div class="ct-scenario-actions">';
  html += '<button class="ct-btn ct-btn-primary" id="btn-' + scenario.id + '">▶ Exécuter</button>';
  html += '</div>';
  html += '<div class="ct-scenario-result" id="result-' + scenario.id + '"></div>';
  html += '</div>';
  return html;
};

/* ---------------------------------------------------------------
   Helper: Destroy any existing Chart.js instances in a container
   --------------------------------------------------------------- */
CT._charts = {};
CT.html.destroyCharts = function() {
  Object.keys(CT._charts).forEach(function(key) {
    if (CT._charts[key]) { try { CT._charts[key].destroy(); } catch(e) {} }
    delete CT._charts[key];
  });
};

/* ---------------------------------------------------------------
   VIEW: Overview
   API /api/dashboard/ops returns:
   {
     activite: {commandes_aujourd_hui, commandes_en_cours, commandes_bloquees, livrees_aujourd_hui, livrees_30j},
     sla: {on_time, warning, late, blocked, details: {late: [...]}},
     logistique: {
       dubai_reception: {count, items, label},
       dubai_expedition: {count, items, label},
       transitaire: {count, items, label},
       bateau: {count, items, label},
       anjouan: {count, items, label}
     },
     delais: {avg_preparation_jours, avg_livraison_totale_jours},
     alertes: {cash_pending, anomalies, low_stock}   ← OBJECT not array!
   }
   --------------------------------------------------------------- */
CT.views.overview = {
  label: 'Overview',
  icon: '📊',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('ops');
      var act = data.activite || {};
      var sla = data.sla || {};
      var log = data.logistique || {};
      var delais = data.delais || {};
      var alertes = data.alertes || {};  // OBJECT not array

      var html = '';

      // KPI Row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Commandes en cours', act.commandes_en_cours || 0, '📦', 'blue');
      html += CT.html.kpiCard('Bloquées', act.commandes_bloquees || 0, '🚫', 'red');
      html += CT.html.kpiCard("Livrées aujourd'hui", act.livrees_aujourd_hui || 0, '✅', 'green');
      html += CT.html.kpiCard('Livrées 30j', act.livrees_30j || 0, '📊', 'cyan');
      html += CT.html.kpiCard('Cash pending', alertes.cash_pending || 0, '💰', 'amber');
      html += '</div>';

      // SLA + Logistics + Alerts grid
      html += '<div class="ct-grid-3">';

      // SLA Donut
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">⏱️ SLA Performance</div>';
      var total_sla = (sla.on_time || 0) + (sla.warning || 0) + (sla.late || 0);
      if (total_sla > 0) {
        html += '<div class="ct-chart-container"><canvas id="chart-sla"></canvas></div>';
        html += '<div class="ct-mt-md" style="text-align:center;font-size:0.85rem">';
        html += '<span style="color:var(--ct-green)">● À temps: ' + sla.on_time + '</span> &nbsp; ';
        html += '<span style="color:var(--ct-amber)">● Attention: ' + sla.warning + '</span> &nbsp; ';
        html += '<span style="color:var(--ct-red)">● Retard: ' + sla.late + '</span>';
        html += '</div>';
      } else {
        html += CT.html.empty('⏱️', 'Aucune donnée SLA');
      }
      html += '</div>';

      // Logistics
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">🚚 Logistique</div>';
      var logItems = [
        { key: 'dubai_reception', label: '📥 Réceptionner', color: 'cyan' },
        { key: 'dubai_expedition', label: '📦 Expédier', color: 'purple' },
        { key: 'transitaire', label: '🏢 Transitaire', color: 'blue' },
        { key: 'bateau', label: '🚢 En mer', color: 'amber' },
        { key: 'anjouan', label: '📍 Relais', color: 'green' }
      ];
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      logItems.forEach(function(li) {
        var step = log[li.key] || {};
        html += '<div class="ct-kpi-card ' + li.color + '" style="flex:1;min-width:80px;padding:10px">';
        html += '<div class="ct-kpi-value" style="font-size:1.3rem">' + (step.count || 0) + '</div>';
        html += '<div class="ct-kpi-label" style="font-size:0.7rem">' + li.label + '</div>';
        html += '</div>';
      });
      html += '</div>';
      // Délais moyens
      html += '<div class="ct-section ct-mt-md">';
      html += '<div class="ct-section-title">📏 Délais moyens</div>';
      html += '<div style="display:flex;gap:12px">';
      html += '<div style="flex:1;text-align:center;padding:8px;background:var(--ct-bg-tertiary);border-radius:8px">';
      html += '<div style="font-size:1.2rem;font-weight:700">' + (delais.avg_preparation_jours || 0) + 'j</div>';
      html += '<div class="ct-muted" style="font-size:0.75rem">Préparation</div></div>';
      html += '<div style="flex:1;text-align:center;padding:8px;background:var(--ct-bg-tertiary);border-radius:8px">';
      html += '<div style="font-size:1.2rem;font-weight:700">' + (delais.avg_livraison_totale_jours || 0) + 'j</div>';
      html += '<div class="ct-muted" style="font-size:0.75rem">Livraison totale</div></div>';
      html += '</div></div>';
      html += '</div>';

      // Alerts
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">🔔 Alertes</div>';
      var hasAlerts = (alertes.cash_pending || 0) > 0 || (alertes.anomalies || 0) > 0 || (alertes.low_stock || 0) > 0;
      if (!hasAlerts) {
        html += CT.html.empty('✅', 'Aucune alerte');
      } else {
        // Build alert items from the alertes object
        if (alertes.cash_pending > 0) {
          html += '<div class="ct-alert-item warning">';
          html += '<span>💰 Paiements cash en attente</span>';
          html += '<span class="ct-alert-count">' + alertes.cash_pending + '</span>';
          html += '</div>';
        }
        if (alertes.anomalies > 0) {
          html += '<div class="ct-alert-item danger">';
          html += '<span>⚠️ Anomalies détectées</span>';
          html += '<span class="ct-alert-count">' + alertes.anomalies + '</span>';
          html += '</div>';
        }
        if (alertes.low_stock > 0) {
          html += '<div class="ct-alert-item info">';
          html += '<span>📦 Stock bas</span>';
          html += '<span class="ct-alert-count">' + alertes.low_stock + '</span>';
          html += '</div>';
        }
      }
      html += '</div>';

      html += '</div>'; // end grid

      el.innerHTML = html;

      // Render SLA chart
      if (total_sla > 0 && typeof Chart !== 'undefined') {
        var ctx = document.getElementById('chart-sla');
        if (ctx) {
          CT._charts.sla = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
              labels: ['À temps', 'Attention', 'Retard'],
              datasets: [{
                data: [sla.on_time || 0, sla.warning || 0, sla.late || 0],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 6
              }]
            },
            options: {
              responsive: true,
              cutout: '65%',
              plugins: {
                legend: { display: false }
              }
            }
          });
        }
      }
    } catch (e) {
      el.innerHTML = CT.html.error(e.message);
    }
  }
};

/* ---------------------------------------------------------------
   VIEW: Pipeline
   API /api/dashboard/pipeline returns:
   {
     total: 228, active: 39,
     pipeline: {
       confirmed: {count, orders: [{reference, client_name, recipient_name, total_kmf, status, created_at, ...}]},
       ordered: {count, orders: [...]},
       preparation, shipped, in_transit, available, collected, cancelled, refunded
     }
   }
   --------------------------------------------------------------- */
CT.views.pipeline = {
  label: 'Pipeline',
  icon: '🔀',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('pipeline');
      var pipeline = data.pipeline || {};
      var statusOrder = ['confirmed','ordered','preparation','shipped','in_transit','available','collected','cancelled','refunded'];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Total commandes', data.total || 0, '📦', 'blue');
      html += CT.html.kpiCard('Actives', data.active || 0, '⚡', 'green');
      var cancelled = pipeline.cancelled ? pipeline.cancelled.count : 0;
      var available = pipeline.available ? pipeline.available.count : 0;
      html += CT.html.kpiCard('Annulé', cancelled, CT.html.badge('cancelled'), 'red');
      html += CT.html.kpiCard('Disponible', available, CT.html.badge('available'), 'amber');
      html += '</div>';

      // Pipeline Kanban
      html += '<div class="ct-pipeline-grid">';
      statusOrder.forEach(function(status) {
        var col = pipeline[status];
        if (!col) return;
        var orders = col.orders || [];
        html += '<div class="ct-pipeline-col">';
        html += '<div class="ct-pipeline-col-header">';
        html += '<span>' + CT.html.statusLabel(status).toUpperCase() + '</span>';
        html += '<span class="ct-count">' + (col.count || 0) + '</span>';
        html += '</div>';
        html += '<div class="ct-pipeline-col-body">';
        if (orders.length === 0) {
          html += '<div class="ct-empty" style="padding:12px;font-size:0.8rem">Aucune</div>';
        } else {
          orders.slice(0, 20).forEach(function(o) {
            var hasNext = !!CT.html.NEXT_STATUS[status];
            var nextLabel = hasNext ? CT.html.statusLabel(CT.html.NEXT_STATUS[status]) : '';
            html += '<div class="ct-pipeline-order">';
            html += '<div style="display:flex;align-items:center;gap:6px"><div class="ref">' + (o.reference || o.id || '—') + '</div>';
            if (hasNext && o.id) {
              html += '<button onclick="CT.html.advanceOrder(\'' + o.id + '\',\'' + (o.reference||'') + '\',\'' + status + '\', this)" '
                + 'title="→ ' + nextLabel + '" '
                + 'style="margin-left:auto;padding:2px 8px;border:none;background:var(--ct-green,#22c55e);color:#fff;border-radius:6px;font-size:.7rem;font-weight:700;cursor:pointer">▶</button>';
            }
            html += '</div>';
            html += '<div class="client">' + (o.client_name || o.recipient_name || '[Compte supprimé]') + '</div>';
            html += '<div class="amount">' + CT.html.formatKMF(o.total_kmf) + '</div>';
            html += '</div>';
          });
          if (orders.length > 20) {
            html += '<div class="ct-muted ct-text-center" style="padding:8px">+ ' + (orders.length - 20) + ' autres</div>';
          }
        }
        html += '</div></div>';
      });
      html += '</div>';

      // Full orders table
      var allOrders = [];
      statusOrder.forEach(function(s) {
        if (pipeline[s] && pipeline[s].orders) {
          allOrders = allOrders.concat(pipeline[s].orders);
        }
      });
      allOrders.sort(function(a,b) { return new Date(b.created_at) - new Date(a.created_at); });

      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">📋 Toutes les commandes</div>';
      var headers = ['Réf.', 'Statut', 'Client', 'Montant', 'Paiement', 'Créée le', 'Action'];
      var rows = allOrders.slice(0, 50).map(function(o) {
        var hasNext = !!CT.html.NEXT_STATUS[o.status];
        var nextLabel = hasNext ? CT.html.statusLabel(CT.html.NEXT_STATUS[o.status]) : '';
        var actionHtml = hasNext && o.id
          ? '<button onclick="CT.html.advanceOrder(\'' + o.id + '\',\'' + (o.reference||'') + '\',\'' + o.status + '\', this)" '
            + 'style="padding:4px 10px;border:none;background:var(--ct-green,#22c55e);color:#fff;border-radius:6px;font-size:.75rem;font-weight:700;cursor:pointer" '
            + 'title="→ ' + nextLabel + '">▶ ' + nextLabel + '</button>'
          : '<span style="color:var(--ct-text-muted,#94a3b8);font-size:.75rem">—</span>';
        return [
          '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
          CT.html.badge(o.status),
          o.client_name || o.recipient_name || '—',
          CT.html.formatKMF(o.total_kmf),
          o.payment_mode || '—',
          CT.html.formatDate(o.created_at),
          actionHtml
        ];
      });
      html += CT.html.table(headers, rows);
      if (allOrders.length > 50) {
        html += '<div class="ct-muted ct-mt-md">Affichage limité aux 50 premières commandes.</div>';
      }
      html += '</div>';

      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = CT.html.error(e.message);
    }
  }
};

/* ---------------------------------------------------------------
   VIEW: Finance
   API /api/dashboard/finance returns:
   {
     period: 30, taux: {eur_kmf, aed_kmf},
     kpi: {ca_kmf, ca_eur, nb_commandes, nb_livrees, nb_annulees, panier_moyen_kmf, evolution: {ca_pct, cmd_pct}},
     paiements: {
       cash: {count, total_kmf},
       stripe: {count, total_eur}
     },
     marges: {marge_reelle_kmf, cout_logistique_kmf, taux_marge_pct, nb_avec_cost, nb_sans_cost, alertes_perte},
     par_categorie: [{category, count, revenue_kmf}],
     top_produits: [{name, count, revenue_kmf}]
   }
   --------------------------------------------------------------- */
CT.views.finance = {
  label: 'Finance',
  icon: '💰',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('finance');
      var kpi = data.kpi || {};
      var paiements = data.paiements || {};
      var marges = data.marges || {};
      var topProduits = data.top_produits || [];
      var parCategorie = data.par_categorie || [];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('CA (KMF)', CT.html.formatKMF(kpi.ca_kmf), '💵', 'green');
      html += CT.html.kpiCard('CA (EUR)', CT.html.formatEUR(kpi.ca_eur), '💶', 'blue');
      html += CT.html.kpiCard('Nb commandes', kpi.nb_commandes || 0, '📦', 'purple');
      html += CT.html.kpiCard('Panier moyen', CT.html.formatKMF(kpi.panier_moyen_kmf), '🛒', 'amber');
      html += '</div>';

      html += '<div class="ct-grid-2">';

      // Paiements breakdown
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">💳 Répartition des paiements</div>';
      var cashData = paiements.cash || {};
      var stripeData = paiements.stripe || {};
      html += '<div style="display:flex;gap:16px;flex-wrap:wrap">';
      html += '<div class="ct-kpi-card amber" style="flex:1;min-width:140px;padding:16px">';
      html += '<div class="ct-kpi-value" style="font-size:1.3rem">' + (cashData.count || 0) + '</div>';
      html += '<div class="ct-kpi-label">Cash Relais</div>';
      html += '<div class="ct-muted">' + CT.html.formatKMF(cashData.total_kmf) + '</div>';
      html += '</div>';
      html += '<div class="ct-kpi-card blue" style="flex:1;min-width:140px;padding:16px">';
      html += '<div class="ct-kpi-value" style="font-size:1.3rem">' + (stripeData.count || 0) + '</div>';
      html += '<div class="ct-kpi-label">Stripe EUR</div>';
      html += '<div class="ct-muted">' + CT.html.formatEUR(stripeData.total_eur) + '</div>';
      html += '</div>';
      html += '</div>';

      // Marges — render as proper cards, not raw JSON
      html += '<div class="ct-section ct-mt-md">';
      html += '<div class="ct-section-title">📈 Marges</div>';
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
      html += '<div style="flex:1;min-width:120px;text-align:center;padding:12px;background:var(--ct-bg-tertiary);border-radius:8px">';
      html += '<div style="font-size:1.1rem;font-weight:700">' + CT.html.formatKMF(marges.marge_reelle_kmf || 0) + '</div>';
      html += '<div class="ct-muted" style="font-size:0.75rem">Marge réelle</div></div>';
      html += '<div style="flex:1;min-width:120px;text-align:center;padding:12px;background:var(--ct-bg-tertiary);border-radius:8px">';
      html += '<div style="font-size:1.1rem;font-weight:700">' + CT.html.formatKMF(marges.cout_logistique_kmf || 0) + '</div>';
      html += '<div class="ct-muted" style="font-size:0.75rem">Coût logistique</div></div>';
      html += '<div style="flex:1;min-width:120px;text-align:center;padding:12px;background:var(--ct-bg-tertiary);border-radius:8px">';
      html += '<div style="font-size:1.1rem;font-weight:700">' + (marges.taux_marge_pct != null ? marges.taux_marge_pct + '%' : '—') + '</div>';
      html += '<div class="ct-muted" style="font-size:0.75rem">Taux marge</div></div>';
      html += '</div>';
      if (marges.nb_sans_cost > 0) {
        html += '<div class="ct-muted" style="margin-top:8px;font-size:0.8rem">⚠️ ' + marges.nb_sans_cost + ' commandes sans coût renseigné</div>';
      }
      if (marges.alertes_perte) {
        html += '<div class="ct-alert-item danger" style="margin-top:8px"><span>🚨 ' + marges.alertes_perte + '</span></div>';
      }
      html += '</div>';
      html += '</div>';

      // Par catégorie chart
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">📂 Par catégorie</div>';
      if (parCategorie.length > 0) {
        html += '<div class="ct-chart-container" style="max-width:100%"><canvas id="chart-categories"></canvas></div>';
      } else {
        html += CT.html.empty('📂', 'Aucune catégorie');
      }
      html += '</div>';

      html += '</div>'; // end grid-2

      // Top produits table
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">🏆 Top Produits</div>';
      var tpHeaders = ['Produit', 'Quantité', 'CA (KMF)'];
      var tpRows = topProduits.map(function(p) {
        return [p.name || '—', p.count || 0, CT.html.formatKMF(p.revenue_kmf)];
      });
      html += CT.html.table(tpHeaders, tpRows);
      html += '</div>';

      el.innerHTML = html;

      // Render categories chart
      if (parCategorie.length > 0 && typeof Chart !== 'undefined') {
        var ctx = document.getElementById('chart-categories');
        if (ctx) {
          var colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#64748b'];
          CT._charts.categories = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
              labels: parCategorie.map(function(c){ return c.category || 'Autre'; }),
              datasets: [{
                label: 'CA (KMF)',
                data: parCategorie.map(function(c){ return c.revenue_kmf || 0; }),
                backgroundColor: colors.slice(0, parCategorie.length),
                borderRadius: 6
              }]
            },
            options: {
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                y: { beginAtZero: true, ticks: { callback: function(v){ return new Intl.NumberFormat('fr-FR').format(v); } } }
              }
            }
          });
        }
      }
    } catch (e) {
      el.innerHTML = CT.html.error(e.message);
    }
  }
};

/* ---------------------------------------------------------------
   VIEW: Relais
   API /api/dashboard/relais returns:
   {
     a_valider: [{reference, client_nom, client_phone, produits, total_kmf, payment_mode, payment_status, date_arrivee, heures_attente, relais_nom, ile, priorite}],
     a_remettre: [same structure]
   }
   --------------------------------------------------------------- */
CT.views.relais = {
  label: 'Relais',
  icon: '📍',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('relais');
      var aValider = data.a_valider || [];
      var aRemettre = data.a_remettre || [];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('À valider', aValider.length, '📝', 'amber');
      html += CT.html.kpiCard('À remettre', aRemettre.length, '📬', 'green');
      html += '</div>';

      // Table: À valider
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">📝 Commandes à valider</div>';
      if (aValider.length === 0) {
        html += CT.html.empty('✅', 'Aucune commande à valider');
      } else {
        var headers = ['Référence', 'Client', 'Montant', 'Relais', 'Île', 'Attente', 'Arrivée'];
        var rows = aValider.map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            o.client_nom || '—',
            CT.html.formatKMF(o.total_kmf),
            o.relais_nom || '—',
            o.ile || '—',
            (o.heures_attente || 0) + 'h',
            CT.html.formatDateTime(o.date_arrivee)
          ];
        });
        html += CT.html.table(headers, rows);
      }
      html += '</div>';

      // Table: À remettre
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">📬 Commandes à remettre</div>';
      if (aRemettre.length === 0) {
        html += CT.html.empty('✅', 'Aucune commande à remettre');
      } else {
        var headers2 = ['Référence', 'Client', 'Tél.', 'Montant', 'Relais', 'Île', 'Attente', 'Arrivée'];
        var rows2 = aRemettre.map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            o.client_nom || '—',
            o.client_phone || '—',
            CT.html.formatKMF(o.total_kmf),
            o.relais_nom || '—',
            o.ile || '—',
            (o.heures_attente || 0) + 'h',
            CT.html.formatDateTime(o.date_arrivee)
          ];
        });
        html += CT.html.table(headers2, rows2);
      }
      html += '</div>';

      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = CT.html.error(e.message);
    }
  }
};

/* ---------------------------------------------------------------
   VIEW: Clients
   API /api/dashboard/clients returns:
   {
     periode: {debut, fin},
     kpi: {nb_clients, commandes_valides, ca_total_kmf, panier_moyen_kmf, clients_recurrents, taux_recurrence_pct},
     top_clients: [{name, phone, nb_commandes, ca_kmf, derniere_commande}],
     top_produits: [{name, count}],
     par_relais: [{relais, ile, nb_commandes, ca_kmf, livrees}],
     evolution: [{mois, nb_commandes, nb_clients, ca_kmf}]
   }
   --------------------------------------------------------------- */
CT.views.clients = {
  label: 'Clients',
  icon: '👥',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('clients');
      var kpi = data.kpi || {};
      var topClients = data.top_clients || [];
      var topProduits = data.top_produits || [];
      var parRelais = data.par_relais || [];
      var evolution = data.evolution || [];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Clients', kpi.nb_clients || 0, '👥', 'blue');
      html += CT.html.kpiCard('Commandes', kpi.commandes_valides || 0, '📦', 'green');
      html += CT.html.kpiCard('CA total', CT.html.formatKMF(kpi.ca_total_kmf), '💰', 'amber');
      html += CT.html.kpiCard('Panier moyen', CT.html.formatKMF(kpi.panier_moyen_kmf), '🛒', 'purple');
      html += CT.html.kpiCard('Récurrents (' + (kpi.taux_recurrence_pct || 0) + '%)', kpi.clients_recurrents || 0, '🔄', 'cyan');
      html += '</div>';

      html += '<div class="ct-grid-2">';

      // Top clients
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">🏆 Top Clients</div>';
      var tcHeaders = ['#', 'Nom', 'Téléphone', 'Commandes', 'CA (KMF)'];
      var tcRows = topClients.map(function(c, i) {
        return [i + 1, c.name || '—', c.phone || '—', c.nb_commandes || 0, CT.html.formatKMF(c.ca_kmf)];
      });
      html += CT.html.table(tcHeaders, tcRows);
      html += '</div>';

      // Top produits
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">🛍️ Top Produits</div>';
      var tpHeaders = ['Produit', 'Nb commandes'];
      var tpRows = topProduits.map(function(p) {
        return [p.name || '—', p.count || 0];
      });
      html += CT.html.table(tpHeaders, tpRows);
      html += '</div>';

      html += '</div>'; // end grid-2

      // Par relais
      if (parRelais.length > 0) {
        html += '<div class="ct-section">';
        html += '<div class="ct-section-title">📍 Par Relais</div>';
        var prHeaders = ['Relais', 'Île', 'Commandes', 'CA (KMF)', 'Livrées'];
        var prRows = parRelais.map(function(r) {
          return [r.relais || '—', r.ile || '—', r.nb_commandes || 0, CT.html.formatKMF(r.ca_kmf), r.livrees || 0];
        });
        html += CT.html.table(prHeaders, prRows);
        html += '</div>';
      }

      // Evolution chart
      if (evolution.length > 1 && typeof Chart !== 'undefined') {
        html += '<div class="ct-section">';
        html += '<div class="ct-section-title">📈 Évolution mensuelle</div>';
        html += '<div class="ct-chart-container"><canvas id="chart-evolution"></canvas></div>';
        html += '</div>';
      }

      el.innerHTML = html;

      // Render evolution chart
      if (evolution.length > 1 && typeof Chart !== 'undefined') {
        var ctx = document.getElementById('chart-evolution');
        if (ctx) {
          CT._charts.evolution = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
              labels: evolution.map(function(e) { return e.mois; }),
              datasets: [{
                label: 'Commandes',
                data: evolution.map(function(e) { return parseInt(e.nb_commandes) || 0; }),
                borderColor: '#3b82f6',
                tension: 0.3,
                fill: false
              }, {
                label: 'Clients',
                data: evolution.map(function(e) { return parseInt(e.nb_clients) || 0; }),
                borderColor: '#10b981',
                tension: 0.3,
                fill: false
              }]
            },
            options: {
              responsive: true,
              plugins: { legend: { position: 'bottom' } },
              scales: { y: { beginAtZero: true } }
            }
          });
        }
      }
    } catch (e) {
      el.innerHTML = CT.html.error(e.message);
    }
  }
};

/* ---------------------------------------------------------------
   VIEW: Retards
   API /api/dashboard/retards returns:
   {
     total: 0,
     par_niveau: {
       remboursement_possible: {count, label: "Remboursement possible (8 sem+)"},
       remise_10pct_prochaine_cmd: {count, label: "Remise −10% prochaine commande"},
       avoir_5pct: {count, label: "Avoir 5% offert"},
       contact_preventif: {count, label: "Contact préventif"}
     },
     clients: [{...}]
   }
   --------------------------------------------------------------- */
CT.views.retards = {
  label: 'Retards',
  icon: '⏰',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('retards');
      var parNiveau = data.par_niveau || {};
      var clients = data.clients || [];
      var html = '';

      // KPI row — iterate over par_niveau keys
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Total retards', data.total || 0, '⏰', 'red');
      var niveauIcons = ['🟡', '🟠', '🔴', '⚫'];
      var niveauColors = ['amber', 'orange', 'red', 'slate'];
      var nIdx = 0;
      Object.keys(parNiveau).forEach(function(key) {
        var n = parNiveau[key];
        html += CT.html.kpiCard(n.label || key, n.count || 0, niveauIcons[nIdx] || '⚪', niveauColors[nIdx] || 'slate');
        nIdx++;
      });
      html += '</div>';

      // Clients table
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">👥 Clients en retard</div>';
      if (clients.length === 0) {
        html += CT.html.empty('✅', 'Aucun retard');
      } else {
        var headers = Object.keys(clients[0] || {});
        var rows = clients.map(function(c) {
          return headers.map(function(h) { return c[h] != null ? c[h] : '—'; });
        });
        html += CT.html.table(headers, rows);
      }
      html += '</div>';

      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = CT.html.error(e.message);
    }
  }
};
