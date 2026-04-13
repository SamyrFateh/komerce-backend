/* ===================================================================
   Komerce Control Tower — ct-views.js
   Dashboard views: each section is a self-contained view object.
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

CT.html.statusLabel = function(status) {
  var map = {
    new: 'Nouveau', confirmed: 'Confirmé', ordered: 'Commandé',
    preparation: 'Préparation', shipped: 'Expédié', in_transit: 'En transit',
    available: 'Disponible', collected: 'Collecté', delivered: 'Livré',
    cancelled: 'Annulé', returned: 'Retourné',
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
   --------------------------------------------------------------- */
CT.views.overview = {
  label: 'Overview',
  icon: '📊',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('ops');
      var kpi = data.kpi || {};
      var sla = data.sla || {};
      var log = data.logistique || {};
      var alertes = data.alertes || [];
      var stockAlerts = data.stock_alerts || [];

      var html = '';

      // KPI Row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Commandes en cours', kpi.en_cours || 0, '📦', 'blue');
      html += CT.html.kpiCard('Bloquées', kpi.bloquees || 0, '🚫', 'red');
      html += CT.html.kpiCard('Livrées aujourd\'hui', kpi.livrees_jour || 0, '✅', 'green');
      html += CT.html.kpiCard('Cash pending', kpi.cash_pending || 0, '💰', 'amber');
      html += CT.html.kpiCard('Cash pending (KMF)', CT.html.formatKMF(kpi.cash_pending_kmf || 0), '💵', 'orange');
      html += '</div>';

      // SLA Chart + Logistics + Alerts grid
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
      var dubai = log.dubai || {};
      var relais = log.relais || {};
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">🏢 Dubai Hub</div>';
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
      html += '<div class="ct-kpi-card cyan" style="flex:1;min-width:100px;padding:12px">';
      html += '<div class="ct-kpi-value" style="font-size:1.4rem">' + (dubai.a_receptionner || 0) + '</div>';
      html += '<div class="ct-kpi-label">À réceptionner</div></div>';
      html += '<div class="ct-kpi-card purple" style="flex:1;min-width:100px;padding:12px">';
      html += '<div class="ct-kpi-value" style="font-size:1.4rem">' + (dubai.a_expedier || 0) + '</div>';
      html += '<div class="ct-kpi-label">À expédier</div></div>';
      html += '</div></div>';
      html += '<div class="ct-section ct-mt-md">';
      html += '<div class="ct-section-title">📍 Relais</div>';
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
      html += '<div class="ct-kpi-card amber" style="flex:1;min-width:100px;padding:12px">';
      html += '<div class="ct-kpi-value" style="font-size:1.4rem">' + (relais.a_valider || 0) + '</div>';
      html += '<div class="ct-kpi-label">À valider</div></div>';
      html += '<div class="ct-kpi-card green" style="flex:1;min-width:100px;padding:12px">';
      html += '<div class="ct-kpi-value" style="font-size:1.4rem">' + (relais.en_attente_retrait || 0) + '</div>';
      html += '<div class="ct-kpi-label">Attente retrait</div></div>';
      html += '</div></div>';
      html += '</div>';

      // Alerts
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">🔔 Alertes</div>';
      if (alertes.length === 0 && stockAlerts.length === 0) {
        html += CT.html.empty('✅', 'Aucune alerte');
      } else {
        alertes.forEach(function(a) {
          var cls = a.type === 'danger' ? 'danger' : a.type === 'warning' ? 'warning' : 'info';
          html += '<div class="ct-alert-item ' + cls + '">';
          html += '<span>' + a.message + '</span>';
          if (a.count != null) html += '<span class="ct-alert-count">' + a.count + '</span>';
          html += '</div>';
        });
        if (stockAlerts.length > 0) {
          html += '<div class="ct-section-title ct-mt-md">📦 Alertes Stock</div>';
          stockAlerts.forEach(function(s) {
            html += '<div class="ct-alert-item warning">';
            html += '<span>' + s.product_name + ' — Restant: ' + s.stock_remaining + ' (seuil: ' + s.min_threshold + ')</span>';
            html += '</div>';
          });
        }
      }
      html += '</div>';

      html += '</div>'; // end grid

      el.innerHTML = html;

      // Render SLA chart
      if (total_sla > 0) {
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
      var statusOrder = ['confirmed','ordered','preparation','shipped','in_transit','available','collected','cancelled'];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Total commandes', data.total || 0, '📦', 'blue');
      html += CT.html.kpiCard('Actives', data.active || 0, '⚡', 'green');
      var statusCounts = {};
      statusOrder.forEach(function(s) {
        if (pipeline[s]) statusCounts[s] = pipeline[s].count || 0;
      });
      var topStatus = Object.entries(statusCounts).sort(function(a,b){ return b[1]-a[1]; }).slice(0,2);
      topStatus.forEach(function(entry) {
        html += CT.html.kpiCard(CT.html.statusLabel(entry[0]), entry[1], CT.html.badge(entry[0]), '');
      });
      html += '</div>';

      // Pipeline Kanban
      html += '<div class="ct-pipeline-grid">';
      statusOrder.forEach(function(status) {
        var col = pipeline[status];
        if (!col) return;
        var orders = col.orders || [];
        html += '<div class="ct-pipeline-col">';
        html += '<div class="ct-pipeline-col-header">';
        html += '<span>' + CT.html.statusLabel(status) + '</span>';
        html += '<span class="ct-count">' + (col.count || 0) + '</span>';
        html += '</div>';
        html += '<div class="ct-pipeline-col-body">';
        if (orders.length === 0) {
          html += '<div class="ct-empty" style="padding:12px;font-size:0.8rem">Aucune</div>';
        } else {
          orders.slice(0, 20).forEach(function(o) {
            html += '<div class="ct-pipeline-order">';
            html += '<div class="ref">' + (o.reference || o.id) + '</div>';
            html += '<div class="client">' + (o.client_name || o.recipient_name || '—') + '</div>';
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

      // Orders table
      var allOrders = [];
      statusOrder.forEach(function(s) {
        if (pipeline[s] && pipeline[s].orders) {
          allOrders = allOrders.concat(pipeline[s].orders);
        }
      });
      allOrders.sort(function(a,b) { return new Date(b.created_at) - new Date(a.created_at); });

      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">📋 Toutes les commandes</div>';
      var headers = ['Réf.', 'Statut', 'Client', 'Montant', 'Paiement', 'Créée le'];
      var rows = allOrders.slice(0, 50).map(function(o) {
        return [
          '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
          CT.html.badge(o.status),
          o.client_name || o.recipient_name || '—',
          CT.html.formatKMF(o.total_kmf),
          o.payment_mode || '—',
          CT.html.formatDate(o.created_at)
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
   --------------------------------------------------------------- */
CT.views.finance = {
  label: 'Finance',
  icon: '💰',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('finance');
      var ca = data.ca || {};
      var paiements = data.paiements || {};
      var panierMoyen = data.panier_moyen || {};
      var topProduits = data.top_produits || [];
      var parCategorie = data.par_categorie || [];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('CA (KMF)', CT.html.formatKMF(ca.kmf), '💵', 'green');
      html += CT.html.kpiCard('CA (EUR)', CT.html.formatEUR(ca.eur), '💶', 'blue');
      html += CT.html.kpiCard('Nb commandes', data.nb_commandes || 0, '📦', 'purple');
      html += CT.html.kpiCard('Panier moyen', CT.html.formatKMF(panierMoyen.kmf), '🛒', 'amber');
      html += '</div>';

      html += '<div class="ct-grid-2">';

      // Paiements breakdown
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">💳 Répartition des paiements</div>';
      var cashRelais = paiements.cash_relais || {};
      var stripeEur = paiements.stripe_eur || {};
      html += '<div style="display:flex;gap:16px;flex-wrap:wrap">';
      html += '<div class="ct-kpi-card amber" style="flex:1;min-width:140px;padding:16px">';
      html += '<div class="ct-kpi-value" style="font-size:1.3rem">' + (cashRelais.count || 0) + '</div>';
      html += '<div class="ct-kpi-label">Cash Relais</div>';
      html += '<div class="ct-muted">' + CT.html.formatKMF(cashRelais.total_kmf) + '</div>';
      html += '</div>';
      html += '<div class="ct-kpi-card blue" style="flex:1;min-width:140px;padding:16px">';
      html += '<div class="ct-kpi-value" style="font-size:1.3rem">' + (stripeEur.count || 0) + '</div>';
      html += '<div class="ct-kpi-label">Stripe EUR</div>';
      html += '<div class="ct-muted">' + CT.html.formatKMF(stripeEur.total_kmf) + '</div>';
      html += '</div>';
      html += '</div>';
      // Marges
      if (data.marges) {
        html += '<div class="ct-section ct-mt-md">';
        html += '<div class="ct-section-title">📈 Marges</div>';
        html += '<pre style="font-size:0.85rem;color:var(--ct-text-secondary)">' + JSON.stringify(data.marges, null, 2) + '</pre>';
        html += '</div>';
      }
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
      var headers = ['Produit', 'Quantité', 'CA (KMF)'];
      var rows = topProduits.map(function(p) {
        return [p.name, p.count, CT.html.formatKMF(p.revenue_kmf)];
      });
      html += CT.html.table(headers, rows);
      html += '</div>';

      el.innerHTML = html;

      // Render categories chart
      if (parCategorie.length > 0) {
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
        var headers = ['Référence', 'Client', 'Relais', 'Date'];
        var rows = aValider.map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            o.client_name || '—',
            o.relais_name || '—',
            CT.html.formatDateTime(o.created_at)
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
        var headers2 = ['Référence', 'Client', 'Relais', 'Disponible depuis'];
        var rows2 = aRemettre.map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            o.client_name || '—',
            o.relais_name || '—',
            CT.html.formatDateTime(o.available_at)
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
   --------------------------------------------------------------- */
CT.views.clients = {
  label: 'Clients',
  icon: '👥',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var data = await CT.api.dashboard('clients');
      var topClients = data.top_clients || [];
      var topProduits = data.top_produits || [];
      var parRelais = data.par_relais || [];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Clients', data.total_clients || 0, '👥', 'blue');
      html += CT.html.kpiCard('Commandes', data.total_commandes || 0, '📦', 'green');
      html += CT.html.kpiCard('CA total', CT.html.formatKMF(data.ca_total_kmf), '💰', 'amber');
      html += CT.html.kpiCard('Panier moyen', CT.html.formatKMF(data.panier_moyen_kmf), '🛒', 'purple');
      html += CT.html.kpiCard('Récurrents', data.recurrents || 0, '🔄', 'cyan');
      html += '</div>';

      html += '<div class="ct-grid-2">';

      // Top clients
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">🏆 Top Clients</div>';
      var headers = ['#', 'Nom', 'Téléphone', 'Commandes', 'CA (KMF)'];
      var rows = topClients.map(function(c, i) {
        return [i + 1, c.full_name || '—', c.phone || '—', c.nb_commandes, CT.html.formatKMF(c.ca_kmf)];
      });
      html += CT.html.table(headers, rows);
      html += '</div>';

      // Top produits
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">🛍️ Top Produits</div>';
      var headers2 = ['Produit', 'Nb commandes'];
      var rows2 = topProduits.map(function(p) {
        return [p.name, p.count];
      });
      html += CT.html.table(headers2, rows2);
      html += '</div>';

      html += '</div>'; // end grid-2

      // Par relais
      html += '<div class="ct-section">';
      html += '<div class="ct-section-title">📍 Par Relais</div>';
      if (parRelais.length > 0) {
        var headers3 = ['Relais', 'Nb commandes'];
        var rows3 = parRelais.map(function(r) {
          return [r.relais_name || '—', r.count];
        });
        html += CT.html.table(headers3, rows3);
      } else {
        html += CT.html.empty('📍', 'Aucune donnée par relais');
      }
      html += '</div>';

      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = CT.html.error(e.message);
    }
  }
};

/* ---------------------------------------------------------------
   VIEW: Retards
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
      var niveaux = data.niveaux || [];
      var clients = data.clients || [];
      var html = '';

      // KPI row
      html += '<div class="ct-kpi-row">';
      html += CT.html.kpiCard('Total retards', data.total || 0, '⏰', 'red');
      html += CT.html.kpiCard('Niveau 1', parNiveau.level1 || 0, '🟡', 'amber');
      html += CT.html.kpiCard('Niveau 2', parNiveau.level2 || 0, '🟠', 'orange');
      html += CT.html.kpiCard('Niveau 3', parNiveau.level3 || 0, '🔴', 'red');
      html += '</div>';

      // Niveaux descriptions
      if (niveaux.length > 0) {
        html += '<div class="ct-section">';
        html += '<div class="ct-section-title">📋 Niveaux de retard</div>';
        html += '<div class="ct-grid-3">';
        niveaux.forEach(function(n) {
          var color = n.level === 'level1' ? 'amber' : n.level === 'level2' ? 'orange' : 'red';
          html += '<div class="ct-card" style="border-left:4px solid var(--ct-' + color + ')">';
          html += '<div class="ct-card-title">' + (n.label || n.level) + '</div>';
          html += '<p style="font-size:0.85rem;color:var(--ct-text-secondary);margin-bottom:8px">' + (n.description || '') + '</p>';
          html += '<div class="ct-muted">Seuil: ' + (n.threshold_days || '—') + ' jours</div>';
          html += '</div>';
        });
        html += '</div></div>';
      }

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
