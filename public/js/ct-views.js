/* ===================================================================
   Komerce Control Tower — ct-views.js v3.1
   5 Dashboards métier : Global / Hub / Transit / Relais / Finance
   + Vue Commandes : toutes les entrées, statut optimiste inline
   Layout : 🔝 ACTION (haut) + 🔻 INFO/ALERTES (bas)
   =================================================================== */
window.CT = window.CT || {};
CT.views = {};
CT.html = {};

/* ---------------------------------------------------------------
   HTML Helpers (shared across all views)
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
CT.html.statusColor = function(status) {
  var map = {
    new: 'var(--ct-blue)', confirmed: 'var(--ct-green)', ordered: 'var(--ct-cyan)',
    preparation: 'var(--ct-purple)', shipped: 'var(--ct-amber)', in_transit: 'var(--ct-orange)',
    available: 'var(--ct-amber)', collected: 'var(--ct-green-dark)', delivered: 'var(--ct-green-dark)',
    cancelled: 'var(--ct-red)', returned: 'var(--ct-slate)'
  };
  return map[status] || 'var(--ct-text-muted)';
};

/* Next-status map for order advancement */
CT.html.NEXT_STATUS = {
  confirmed: 'ordered', ordered: 'preparation', preparation: 'shipped',
  shipped: 'in_transit', in_transit: 'available', available: 'collected'
};

/* Full next-status map (including cancel) */
CT.html.ALL_NEXT = {
  new:         ['confirmed', 'cancelled'],
  confirmed:   ['ordered', 'cancelled'],
  ordered:     ['preparation', 'cancelled'],
  preparation: ['shipped', 'cancelled'],
  shipped:     ['in_transit', 'cancelled'],
  in_transit:  ['available', 'cancelled'],
  available:   ['collected', 'cancelled'],
  collected:   [],
  cancelled:   ['refunded'],
  refunded:    []
};

/* Hex colors for status chips */
CT.html.STATUS_HEX = {
  new: '#3b82f6', confirmed: '#10b981', ordered: '#06b6d4',
  preparation: '#8b5cf6', shipped: '#f59e0b', in_transit: '#f97316',
  available: '#eab308', collected: '#059669', delivered: '#059669',
  cancelled: '#ef4444', refunded: '#94a3b8'
};

/* Age formatter */
CT.html._age = function(dateStr) {
  if (!dateStr) return '—';
  var diff = Date.now() - new Date(dateStr).getTime();
  var h = Math.floor(diff / 3600000);
  if (h < 1) return '<1h';
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'j';
};

/* ---------------------------------------------------------------
   Optimistic status chip — clickable badge with dropdown
   --------------------------------------------------------------- */
CT.html.statusChip = function(id, ref, status) {
  var nexts = CT.html.ALL_NEXT[status] || [];
  var chipId = 'chip-' + id;
  if (nexts.length === 0) {
    return '<span id="' + chipId + '" class="ct-badge ' + status + '">' + CT.html.statusLabel(status) + '</span>';
  }
  return '<span id="' + chipId + '" class="ct-badge ' + status + '" style="cursor:pointer;user-select:none" ' +
    'onclick="CT.html._openStatusMenu(event,\'' + id + '\',\'' + (ref||'') + '\',\'' + status + '\')">' +
    CT.html.statusLabel(status) + ' ▾</span>';
};

CT.html._openStatusMenu = function(e, id, ref, status) {
  e.stopPropagation();
  document.querySelectorAll('.ct-status-menu').forEach(function(m) { m.remove(); });
  var nexts = CT.html.ALL_NEXT[status] || [];
  if (nexts.length === 0) return;

  var menu = document.createElement('div');
  menu.className = 'ct-status-menu';
  menu.style.cssText = [
    'position:fixed;z-index:9999',
    'background:var(--ct-bg2,#1e293b)',
    'border:1px solid var(--ct-border,rgba(255,255,255,.1))',
    'border-radius:10px;padding:6px',
    'box-shadow:0 8px 24px rgba(0,0,0,.3)',
    'min-width:160px'
  ].join(';');

  nexts.forEach(function(next) {
    var item = document.createElement('div');
    var hex = CT.html.STATUS_HEX[next] || '#94a3b8';
    item.style.cssText = 'padding:8px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;display:flex;align-items:center;gap:8px;color:' + hex;
    item.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + hex + ';flex-shrink:0"></span>→ ' + CT.html.statusLabel(next);
    item.addEventListener('mouseover', function() { item.style.background = 'rgba(255,255,255,.06)'; });
    item.addEventListener('mouseout', function() { item.style.background = ''; });
    item.addEventListener('click', function(ev) {
      ev.stopPropagation();
      menu.remove();
      CT.html._doStatusChange(id, ref, status, next);
    });
    menu.appendChild(item);
  });

  var chip = document.getElementById('chip-' + id);
  if (chip) {
    var rect = chip.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
  }
  document.body.appendChild(menu);

  setTimeout(function() {
    function closer(e2) {
      if (!menu.contains(e2.target)) {
        menu.remove();
        document.removeEventListener('click', closer);
      }
    }
    document.addEventListener('click', closer);
  }, 0);
};

CT.html._doStatusChange = async function(id, ref, currentStatus, nextStatus) {
  var chip = document.getElementById('chip-' + id);
  var nextsNew = CT.html.ALL_NEXT[nextStatus] || [];

  // Optimistic update
  if (chip) {
    chip.className = 'ct-badge ' + nextStatus;
    chip.style.opacity = '0.6';
    chip.innerHTML = CT.html.statusLabel(nextStatus) + (nextsNew.length > 0 ? ' ▾' : '');
    if (nextsNew.length > 0) {
      chip.setAttribute('onclick', 'CT.html._openStatusMenu(event,\'' + id + '\',\'' + ref + '\',\'' + nextStatus + '\')');
    } else {
      chip.removeAttribute('onclick');
      chip.style.cursor = 'default';
    }
  }

  try {
    await CT.api.updateOrderStatus(id, nextStatus);
    if (chip) {
      chip.style.opacity = '1';
      chip.style.outline = '2px solid #10b981';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }
    // Update row age highlight
    var row = chip ? chip.closest('tr') : null;
    if (row) {
      row.style.background = 'rgba(16,185,129,.07)';
      setTimeout(function() { if (row) row.style.background = ''; }, 1500);
    }
    CT.bus.emit('toast', ref + ' → ' + CT.html.statusLabel(nextStatus) + ' ✅', 'success');

    // Sync in-memory orders for commandes view
    if (CT.views.commandes && CT.views.commandes._orders) {
      var o = CT.views.commandes._orders.find(function(x) { return String(x.id) === String(id); });
      if (o) o.status = nextStatus;
    }
  } catch(e) {
    // Revert on error
    if (chip) {
      chip.className = 'ct-badge ' + currentStatus;
      chip.style.opacity = '1';
      chip.innerHTML = CT.html.statusLabel(currentStatus) + (CT.html.ALL_NEXT[currentStatus] || []).length > 0 ? ' ▾' : '';
      chip.setAttribute('onclick', 'CT.html._openStatusMenu(event,\'' + id + '\',\'' + ref + '\',\'' + currentStatus + '\')');
      chip.style.outline = '2px solid #ef4444';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }
    CT.bus.emit('toast', '❌ Erreur: ' + e.message, 'error');
  }
};

/* ---------------------------------------------------------------
   advanceOrder — fixed: no more full view reload
   --------------------------------------------------------------- */
CT.html.advanceOrder = async function(id, ref, currentStatus, btn) {
  var next = CT.html.NEXT_STATUS[currentStatus];
  if (!next) return;
  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    await CT.api.updateOrderStatus(id, next);
    CT.bus.emit('toast', ref + ' → ' + CT.html.statusLabel(next) + ' ✅', 'success');

    // Update chip if commandes view is loaded
    var chip = document.getElementById('chip-' + id);
    if (chip) {
      var nextsNew = CT.html.ALL_NEXT[next] || [];
      chip.className = 'ct-badge ' + next;
      chip.innerHTML = CT.html.statusLabel(next) + (nextsNew.length > 0 ? ' ▾' : '');
      if (nextsNew.length > 0) {
        chip.setAttribute('onclick', 'CT.html._openStatusMenu(event,\'' + id + '\',\'' + ref + '\',\'' + next + '\')');
      }
      chip.style.outline = '2px solid #10b981';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }

    // Update button to next possible action (no reload)
    var newNext = CT.html.NEXT_STATUS[next];
    if (newNext) {
      btn.disabled = false;
      btn.textContent = '▶ ' + CT.html.statusLabel(newNext);
      btn.setAttribute('onclick', 'CT.html.advanceOrder(\'' + id + '\',\'' + ref + '\',\'' + next + '\', this)');
    } else {
      btn.remove();
    }

    // Sync commandes view memory
    if (CT.views.commandes && CT.views.commandes._orders) {
      var o = CT.views.commandes._orders.find(function(x) { return String(x.id) === String(id); });
      if (o) o.status = next;
    }
  } catch(e) {
    CT.bus.emit('toast', '❌ Erreur: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '▶';
  }
};

/* Layout helpers */
CT.html.loading = function() { return '<div class="ct-loading">Chargement...</div>'; };
CT.html.error = function(msg) { return '<div class="ct-error">' + (msg || 'Erreur inconnue') + '</div>'; };
CT.html.empty = function(icon, msg) { return '<div class="ct-empty"><div class="ct-empty-icon">' + (icon || '📭') + '</div>' + (msg || 'Aucune donnée') + '</div>'; };

CT.html.kpiCard = function(label, value, icon, color) {
  return '<div class="ct-kpi-card ' + (color || '') + '">' +
    '<div class="ct-kpi-icon">' + (icon || '') + '</div>' +
    '<div class="ct-kpi-value">' + value + '</div>' +
    '<div class="ct-kpi-label">' + label + '</div>' +
  '</div>';
};

CT.html.actionCard = function(label, value, icon, color, onClick) {
  var cls = 'ct-action-card ' + (color || '');
  var click = onClick ? ' onclick="' + onClick + '"' : '';
  var cursor = onClick ? ' style="cursor:pointer"' : '';
  return '<div class="' + cls + '"' + click + cursor + '>' +
    '<div class="ct-action-icon">' + (icon || '') + '</div>' +
    '<div class="ct-action-value">' + value + '</div>' +
    '<div class="ct-action-label">' + label + '</div>' +
  '</div>';
};

CT.html.zoneAction = function(title, content) {
  return '<div class="ct-zone ct-zone-action">' +
    '<div class="ct-zone-header"><span class="ct-zone-tag action">🔝 ACTION</span> ' + title + '</div>' +
    '<div class="ct-zone-body">' + content + '</div></div>';
};

CT.html.zoneInfo = function(title, content) {
  return '<div class="ct-zone ct-zone-info">' +
    '<div class="ct-zone-header"><span class="ct-zone-tag info">🔻 SURVEILLANCE</span> ' + title + '</div>' +
    '<div class="ct-zone-body">' + content + '</div></div>';
};

CT.html.alertItem = function(icon, text, count, level) {
  level = level || 'info';
  return '<div class="ct-alert-item ' + level + '">' +
    '<span>' + icon + ' ' + text + '</span>' +
    '<span class="ct-alert-count">' + count + '</span>' +
  '</div>';
};

CT.html.table = function(headers, rows) {
  var html = '<div class="ct-table-wrap"><table class="ct-table"><thead><tr>';
  headers.forEach(function(h) { html += '<th>' + h + '</th>'; });
  html += '</tr></thead><tbody>';
  if (!rows || rows.length === 0) {
    html += '<tr><td colspan="' + headers.length + '" class="ct-text-center ct-muted">Aucune donnée</td></tr>';
  } else {
    rows.forEach(function(row) {
      html += '<tr>';
      row.forEach(function(cell) { html += '<td>' + (cell != null ? cell : '—') + '</td>'; });
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

/* Chart management */
CT._charts = {};
CT.html.destroyCharts = function() {
  Object.keys(CT._charts).forEach(function(key) {
    if (CT._charts[key]) { try { CT._charts[key].destroy(); } catch(e) {} }
    delete CT._charts[key];
  });
};

/* Helper: build advance button */
CT.html.advanceBtn = function(id, ref, status) {
  var next = CT.html.NEXT_STATUS[status];
  if (!next || !id) return '<span class="ct-muted" style="font-size:.75rem">—</span>';
  var label = CT.html.statusLabel(next);
  return '<button onclick="CT.html.advanceOrder(\'' + id + '\',\'' + (ref||'') + '\',\'' + status + '\', this)" ' +
    'style="padding:4px 10px;border:none;background:var(--ct-green);color:#fff;border-radius:6px;font-size:.75rem;font-weight:700;cursor:pointer" ' +
    'title="→ ' + label + '">▶ ' + label + '</button>';
};

/* WhatsApp link helpers */
CT.html.whatsappLink = function(phone, ref, status) {
  var baseUrl = window.location.origin;
  var suiviUrl = baseUrl + '/suivi.html?ref=' + ref;
  var messages = {
    confirmed: '✅ Commande Komerce ' + ref + ' confirmée !\nSuivez-la ici : ' + suiviUrl,
    ordered: '📋 Commande ' + ref + ' en approvisionnement\n' + suiviUrl,
    preparation: '🛍️ Commande ' + ref + ' en préparation à Dubai\n' + suiviUrl,
    shipped: '📦 Colis ' + ref + ' expédié !\n' + suiviUrl,
    in_transit: '🚢 Colis ' + ref + ' en route vers les Comores\n' + suiviUrl,
    available: '🎉 Colis ' + ref + ' disponible au relais !\nRetrait : ' + suiviUrl,
    collected: '✅ Colis ' + ref + ' récupéré ! Merci 🙏'
  };
  var msg = messages[status] || 'Commande Komerce ' + ref + '\n' + suiviUrl;
  var cleanPhone = (phone || '').replace(/[^0-9+]/g, '');
  if (cleanPhone) return 'https://wa.me/' + cleanPhone.replace('+', '') + '?text=' + encodeURIComponent(msg);
  return 'https://wa.me/?text=' + encodeURIComponent(msg);
};
CT.html.whatsappBtn = function(phone, ref, status, compact) {
  var link = CT.html.whatsappLink(phone, ref, status);
  if (compact) return '<a href="' + link + '" target="_blank" rel="noopener" ' +
    'style="display:inline-flex;align-items:center;gap:3px;padding:4px 8px;background:#25d366;color:#fff;border-radius:6px;font-size:.7rem;font-weight:700;text-decoration:none" ' +
    'title="WhatsApp">📱</a>';
  return '<a href="' + link + '" target="_blank" rel="noopener" ' +
    'style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#25d366;color:#fff;border-radius:6px;font-size:.75rem;font-weight:700;text-decoration:none" ' +
    'title="Envoyer WhatsApp">📱 WA</a>';
};


/* ===============================================================
   🧠 VIEW: GLOBAL (CEO / PILOTAGE)
   =============================================================== */
CT.views.global = {
  label: 'Global',
  icon: '🧠',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [ops, pipeline, retards, finance] = await Promise.all([
        CT.api.dashboard('ops'),
        CT.api.dashboard('pipeline'),
        CT.api.dashboard('retards'),
        CT.api.dashboard('finance')
      ]);
      var act = ops.activite || {};
      var sla = ops.sla || {};
      var alertes = ops.alertes || {};
      var pipe = pipeline.pipeline || {};
      var kpiFin = finance.kpi || {};
      var html = '';

      // ─── 🔝 ACTION ───
      var actionContent = '<div class="ct-action-grid">';
      actionContent += CT.html.actionCard('Commandes à risque', (sla.late || 0) + (sla.blocked || 0), '🚨', 'red');
      actionContent += CT.html.actionCard('Bloquées', act.commandes_bloquees || 0, '⛔', 'red');
      actionContent += CT.html.actionCard('Cash en attente', alertes.cash_pending || 0, '💰', 'amber');
      actionContent += CT.html.actionCard('Anomalies', alertes.anomalies || 0, '⚠️', 'orange');
      actionContent += '</div>';

      // Retards summary
      var retTotal = retards.total || 0;
      if (retTotal > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">⏰ Retards actifs : ' + retTotal + '</div>';
        var parNiveau = retards.par_niveau || {};
        Object.keys(parNiveau).forEach(function(key) {
          var n = parNiveau[key];
          if (n.count > 0) {
            actionContent += CT.html.alertItem('⏰', n.label || key, n.count, 'warning');
          }
        });
        actionContent += '</div>';
      }
      html += CT.html.zoneAction('Ce qui nécessite ton attention', actionContent);

      // ─── 🔻 INFO ───
      var infoContent = '';

      // Funnel logistique
      infoContent += '<div class="ct-card"><div class="ct-card-title">📦 Funnel logistique</div>';
      infoContent += '<div class="ct-funnel">';
      var funnelSteps = ['confirmed','ordered','preparation','shipped','in_transit','available','collected'];
      var maxCount = 0;
      funnelSteps.forEach(function(s) { var c = pipe[s] ? pipe[s].count : 0; if (c > maxCount) maxCount = c; });
      funnelSteps.forEach(function(s) {
        var count = pipe[s] ? pipe[s].count : 0;
        var pct = maxCount > 0 ? Math.max(10, (count / maxCount) * 100) : 10;
        infoContent += '<div class="ct-funnel-step">';
        infoContent += '<span class="ct-funnel-label">' + CT.html.statusLabel(s) + '</span>';
        infoContent += '<div class="ct-funnel-bar"><div class="ct-funnel-fill" style="width:' + pct + '%;background:' + CT.html.statusColor(s) + '"></div></div>';
        infoContent += '<span class="ct-funnel-count">' + count + '</span>';
        infoContent += '</div>';
      });
      infoContent += '</div></div>';

      // KPI clés
      infoContent += '<div class="ct-kpi-row">';
      infoContent += CT.html.kpiCard('Commandes actives', act.commandes_en_cours || 0, '📦', 'blue');
      infoContent += CT.html.kpiCard("Livrées aujourd'hui", act.livrees_aujourd_hui || 0, '✅', 'green');
      infoContent += CT.html.kpiCard('Livrées 30j', act.livrees_30j || 0, '📊', 'cyan');
      infoContent += CT.html.kpiCard('CA 30j', CT.html.formatKMF(kpiFin.ca_kmf), '💰', 'amber');
      infoContent += '</div>';

      // SLA donut
      var totalSla = (sla.on_time || 0) + (sla.warning || 0) + (sla.late || 0);
      if (totalSla > 0) {
        infoContent += '<div class="ct-grid-2">';
        infoContent += '<div class="ct-card"><div class="ct-card-title">⏱️ SLA Performance</div>';
        infoContent += '<div class="ct-chart-container"><canvas id="chart-sla"></canvas></div>';
        infoContent += '<div class="ct-mt-md" style="text-align:center;font-size:0.85rem">';
        infoContent += '<span style="color:var(--ct-green)">● À temps: ' + sla.on_time + '</span> &nbsp; ';
        infoContent += '<span style="color:var(--ct-amber)">● Attention: ' + sla.warning + '</span> &nbsp; ';
        infoContent += '<span style="color:var(--ct-red)">● Retard: ' + sla.late + '</span>';
        infoContent += '</div></div>';

        // Délais moyens
        var delais = ops.delais || {};
        infoContent += '<div class="ct-card"><div class="ct-card-title">📏 Délais moyens</div>';
        infoContent += '<div class="ct-stat-grid">';
        infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_preparation_jours || 0) + 'j</div><div class="ct-stat-label">Préparation</div></div>';
        infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_livraison_totale_jours || 0) + 'j</div><div class="ct-stat-label">Livraison totale</div></div>';
        infoContent += '</div></div>';
        infoContent += '</div>';
      }

      html += CT.html.zoneInfo('Indicateurs et suivi', infoContent);
      el.innerHTML = html;

      // Render SLA chart
      if (totalSla > 0 && typeof Chart !== 'undefined') {
        var ctx = document.getElementById('chart-sla');
        if (ctx) {
          CT._charts.sla = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['À temps','Attention','Retard'], datasets: [{ data: [sla.on_time||0, sla.warning||0, sla.late||0], backgroundColor: ['#10b981','#f59e0b','#ef4444'], borderWidth: 0 }] },
            options: { responsive: true, cutout: '65%', plugins: { legend: { display: false } } }
          });
        }
      }
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   🏭 VIEW: HUB (DUBAI / LOGISTIQUE)
   =============================================================== */
CT.views.hub = {
  label: 'Hub Dubaï',
  icon: '🏭',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [ops, pipeline] = await Promise.all([
        CT.api.dashboard('ops'),
        CT.api.dashboard('pipeline')
      ]);
      var log = ops.logistique || {};
      var act = ops.activite || {};
      var alertes = ops.alertes || {};
      var delais = ops.delais || {};
      var pipe = pipeline.pipeline || {};
      var html = '';

      // ─── 🔝 ACTION HUB ───
      var actionContent = '<div class="ct-action-grid">';
      var toPrepare = (pipe.confirmed ? pipe.confirmed.count : 0) + (pipe.ordered ? pipe.ordered.count : 0);
      actionContent += CT.html.actionCard('Commandes à préparer', toPrepare, '🛒', 'blue');
      actionContent += CT.html.actionCard('En préparation', pipe.preparation ? pipe.preparation.count : 0, '📦', 'purple');
      actionContent += CT.html.actionCard('À expédier', log.dubai_expedition ? log.dubai_expedition.count : 0, '🚚', 'amber');
      actionContent += CT.html.actionCard('À réceptionner', log.dubai_reception ? log.dubai_reception.count : 0, '📥', 'cyan');
      actionContent += '</div>';

      // Orders table for hub operator
      var hubOrders = [];
      ['confirmed','ordered','preparation'].forEach(function(s) {
        if (pipe[s] && pipe[s].orders) {
          pipe[s].orders.forEach(function(o) { o._status = s; hubOrders.push(o); });
        }
      });
      if (hubOrders.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">📋 File de travail (' + hubOrders.length + ')</div>';
        var headers = ['Réf.', 'Statut', 'Client', 'Montant', 'Action', '📱'];
        var rows = hubOrders.slice(0, 30).map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            CT.html.statusChip(o.id, o.reference, o._status),
            o.client_name || o.recipient_name || '—',
            CT.html.formatKMF(o.total_kmf),
            CT.html.advanceBtn(o.id, o.reference, o._status),
            CT.html.whatsappBtn(o.client_phone, o.reference, o._status, true)
          ];
        });
        actionContent += CT.html.table(headers, rows);
        actionContent += '</div>';
      }
      html += CT.html.zoneAction('File de travail opérateur', actionContent);

      // ─── 🔻 INFO HUB ───
      var infoContent = '';

      var hasAlerts = (act.commandes_bloquees || 0) > 0 || (alertes.anomalies || 0) > 0 || (alertes.low_stock || 0) > 0;
      if (hasAlerts) {
        infoContent += '<div class="ct-card">';
        infoContent += '<div class="ct-card-title">⚠️ Alertes prioritaires</div>';
        if (act.commandes_bloquees > 0) infoContent += CT.html.alertItem('⛔', 'Commandes bloquées', act.commandes_bloquees, 'danger');
        if (alertes.anomalies > 0) infoContent += CT.html.alertItem('⚠️', 'Anomalies détectées', alertes.anomalies, 'danger');
        if (alertes.low_stock > 0) infoContent += CT.html.alertItem('📦', 'Stock bas', alertes.low_stock, 'warning');
        infoContent += '</div>';
      }

      infoContent += '<div class="ct-grid-2">';
      infoContent += '<div class="ct-card"><div class="ct-card-title">📊 Suivi opérationnel</div>';
      infoContent += '<div class="ct-stat-grid">';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_preparation_jours || 0) + 'j</div><div class="ct-stat-label">Temps moyen préparation</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (act.livrees_aujourd_hui || 0) + '</div><div class="ct-stat-label">Expédiées aujourd\'hui</div></div>';
      infoContent += '</div></div>';

      infoContent += '<div class="ct-card"><div class="ct-card-title">🚚 Pipeline logistique</div>';
      var logItems = [
        { key: 'dubai_reception', color: 'cyan' },
        { key: 'dubai_expedition', color: 'purple' },
        { key: 'transitaire', color: 'blue' },
        { key: 'bateau', color: 'amber' },
        { key: 'anjouan', color: 'green' }
      ];
      infoContent += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      logItems.forEach(function(li) {
        var step = log[li.key] || {};
        infoContent += '<div class="ct-kpi-card ' + li.color + '" style="flex:1;min-width:80px;padding:10px">';
        infoContent += '<div class="ct-kpi-value" style="font-size:1.3rem">' + (step.count || 0) + '</div>';
        infoContent += '<div class="ct-kpi-label" style="font-size:0.7rem">' + (step.label || li.key) + '</div>';
        infoContent += '</div>';
      });
      infoContent += '</div></div>';
      infoContent += '</div>';

      html += CT.html.zoneInfo('Alertes et suivi', infoContent);
      el.innerHTML = html;
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   🚢 VIEW: TRANSIT (VISION GLOBALE)
   =============================================================== */
CT.views.transit = {
  label: 'Transit',
  icon: '🚢',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [ops, pipeline] = await Promise.all([
        CT.api.dashboard('ops'),
        CT.api.dashboard('pipeline')
      ]);
      var log = ops.logistique || {};
      var delais = ops.delais || {};
      var pipe = pipeline.pipeline || {};
      var html = '';

      var actionContent = '<div class="ct-action-grid">';
      var shippedCount = pipe.shipped ? pipe.shipped.count : 0;
      var transitCount = pipe.in_transit ? pipe.in_transit.count : 0;
      var transitaireCount = log.transitaire ? log.transitaire.count : 0;
      var bateauCount = log.bateau ? log.bateau.count : 0;
      actionContent += CT.html.actionCard('En expédition', shippedCount, '📦', 'amber');
      actionContent += CT.html.actionCard('En transit', transitCount, '🚢', 'orange');
      actionContent += CT.html.actionCard('Chez transitaire', transitaireCount, '🏢', 'blue');
      actionContent += CT.html.actionCard('En mer', bateauCount, '⛵', 'cyan');
      actionContent += '</div>';

      var transitOrders = [];
      ['shipped','in_transit'].forEach(function(s) {
        if (pipe[s] && pipe[s].orders) {
          pipe[s].orders.forEach(function(o) { o._status = s; transitOrders.push(o); });
        }
      });
      if (transitOrders.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">📋 Colis en mouvement (' + transitOrders.length + ')</div>';
        var headers = ['Réf.', 'Statut', 'Client', 'Montant', 'Créée le', 'Action', '📱'];
        var rows = transitOrders.slice(0, 30).map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            CT.html.statusChip(o.id, o.reference, o._status),
            o.client_name || o.recipient_name || '—',
            CT.html.formatKMF(o.total_kmf),
            CT.html.formatDate(o.created_at),
            CT.html.advanceBtn(o.id, o.reference, o._status),
            CT.html.whatsappBtn(o.client_phone, o.reference, o._status, true)
          ];
        });
        actionContent += CT.html.table(headers, rows);
        actionContent += '</div>';
      }
      html += CT.html.zoneAction('Colis en mouvement', actionContent);

      var infoContent = '';
      infoContent += '<div class="ct-grid-2">';
      infoContent += '<div class="ct-card"><div class="ct-card-title">📍 Par destination</div>';
      var destinations = [
        { label: '📥 Réception Dubaï', count: log.dubai_reception ? log.dubai_reception.count : 0 },
        { label: '📦 Expédition Dubaï', count: log.dubai_expedition ? log.dubai_expedition.count : 0 },
        { label: '🏢 Transitaire', count: transitaireCount },
        { label: '🚢 En mer', count: bateauCount },
        { label: '📍 Relais Anjouan', count: log.anjouan ? log.anjouan.count : 0 }
      ];
      destinations.forEach(function(d) {
        infoContent += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--ct-border)">';
        infoContent += '<span>' + d.label + '</span>';
        infoContent += '<span style="font-weight:700">' + d.count + '</span>';
        infoContent += '</div>';
      });
      infoContent += '</div>';

      infoContent += '<div class="ct-card"><div class="ct-card-title">⏱️ Temps moyen</div>';
      infoContent += '<div class="ct-stat-grid">';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_preparation_jours || 0) + 'j</div><div class="ct-stat-label">Préparation</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_livraison_totale_jours || 0) + 'j</div><div class="ct-stat-label">Livraison totale</div></div>';
      infoContent += '</div></div>';
      infoContent += '</div>';

      html += CT.html.zoneInfo('Volumes et performance', infoContent);
      el.innerHTML = html;
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   🏝️ VIEW: RELAIS (PAR POINT RELAIS)
   =============================================================== */
CT.views.relais = {
  label: 'Relais',
  icon: '🏝️',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [relaisData, ops, pipeline] = await Promise.all([
        CT.api.dashboard('relais'),
        CT.api.dashboard('ops'),
        CT.api.dashboard('pipeline')
      ]);
      var aValider = relaisData.a_valider || [];
      var aRemettre = relaisData.a_remettre || [];
      var alertes = ops.alertes || {};
      var pipe = pipeline.pipeline || {};
      var availableCount = pipe.available ? pipe.available.count : 0;
      var html = '';

      var actionContent = '<div class="ct-action-grid">';
      actionContent += CT.html.actionCard('Colis à remettre', aRemettre.length, '📦', 'green');
      actionContent += CT.html.actionCard('Cash à encaisser', alertes.cash_pending || 0, '💰', 'amber');
      actionContent += CT.html.actionCard('Disponible retrait', availableCount, '📬', 'blue');
      actionContent += CT.html.actionCard('À valider', aValider.length, '📝', 'purple');
      actionContent += '</div>';

      if (aRemettre.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">📦 Colis à remettre aux clients</div>';
        var h1 = ['Réf.', 'Client', 'Tél.', 'Montant', 'Relais', 'Attente', '📱'];
        var r1 = aRemettre.map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            o.client_nom || '—', o.client_phone || '—',
            CT.html.formatKMF(o.total_kmf), o.relais_nom || '—',
            '<span style="color:' + ((o.heures_attente||0) > 48 ? 'var(--ct-red)' : 'var(--ct-text)') + ';font-weight:600">' + (o.heures_attente || 0) + 'h</span>',
            CT.html.whatsappBtn(o.client_phone, o.reference, 'available', false)
          ];
        });
        actionContent += CT.html.table(h1, r1);
        actionContent += '</div>';
      }

      if (aValider.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">📝 Commandes à valider</div>';
        var h2 = ['Réf.', 'Client', 'Montant', 'Relais', 'Île', 'Attente'];
        var r2 = aValider.map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            o.client_nom || '—', CT.html.formatKMF(o.total_kmf),
            o.relais_nom || '—', o.ile || '—', (o.heures_attente || 0) + 'h'
          ];
        });
        actionContent += CT.html.table(h2, r2);
        actionContent += '</div>';
      }
      html += CT.html.zoneAction('Actions terrain', actionContent);

      var infoContent = '';
      var critiques = aRemettre.filter(function(o) { return (o.heures_attente || 0) > 72; });
      var importants = aRemettre.filter(function(o) { var h = o.heures_attente || 0; return h > 24 && h <= 72; });
      if (critiques.length > 0 || importants.length > 0) {
        infoContent += '<div class="ct-card">';
        infoContent += '<div class="ct-card-title">⚠️ Alertes</div>';
        if (critiques.length > 0) infoContent += CT.html.alertItem('🔴', 'Non collectés > 72h (deadline dépassée)', critiques.length, 'danger');
        if (importants.length > 0) infoContent += CT.html.alertItem('🟠', 'En attente > 24h', importants.length, 'warning');
        infoContent += '</div>';
      }

      infoContent += '<div class="ct-card"><div class="ct-card-title">📊 Suivi</div>';
      infoContent += '<div class="ct-stat-grid">';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + aRemettre.length + '</div><div class="ct-stat-label">Colis en attente</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + aValider.length + '</div><div class="ct-stat-label">À valider</div></div>';
      var avgAttente = 0;
      if (aRemettre.length > 0) {
        var total = 0;
        aRemettre.forEach(function(o) { total += o.heures_attente || 0; });
        avgAttente = Math.round(total / aRemettre.length);
      }
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + avgAttente + 'h</div><div class="ct-stat-label">Délai moyen retrait</div></div>';
      infoContent += '</div></div>';

      html += CT.html.zoneInfo('Alertes et suivi', infoContent);
      el.innerHTML = html;
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   💰 VIEW: FINANCE
   =============================================================== */
CT.views.finance = {
  label: 'Finance',
  icon: '💰',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [finance, ops] = await Promise.all([
        CT.api.dashboard('finance'),
        CT.api.dashboard('ops')
      ]);
      var kpi = finance.kpi || {};
      var paiements = finance.paiements || {};
      var marges = finance.marges || {};
      var alertes = ops.alertes || {};
      var cashData = paiements.cash || {};
      var stripeData = paiements.stripe || {};
      var topProduits = finance.top_produits || [];
      var parCategorie = finance.par_categorie || [];
      var html = '';

      var actionContent = '<div class="ct-action-grid">';
      actionContent += CT.html.actionCard('Cash en attente', alertes.cash_pending || 0, '💰', 'amber');
      actionContent += CT.html.actionCard('Paiements cash', cashData.count || 0, '💵', 'green');
      actionContent += CT.html.actionCard('Paiements Stripe', stripeData.count || 0, '💳', 'blue');
      actionContent += CT.html.actionCard('Annulées', kpi.nb_annulees || 0, '❌', 'red');
      actionContent += '</div>';

      actionContent += '<div class="ct-grid-2 ct-mt-md">';
      actionContent += '<div class="ct-card"><div class="ct-card-title">💵 Cash Relais</div>';
      actionContent += '<div class="ct-stat-grid">';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (cashData.count || 0) + '</div><div class="ct-stat-label">Transactions</div></div>';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatKMF(cashData.total_kmf) + '</div><div class="ct-stat-label">Total KMF</div></div>';
      actionContent += '</div></div>';

      actionContent += '<div class="ct-card"><div class="ct-card-title">💳 Stripe EUR</div>';
      actionContent += '<div class="ct-stat-grid">';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (stripeData.count || 0) + '</div><div class="ct-stat-label">Transactions</div></div>';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatEUR(stripeData.total_eur) + '</div><div class="ct-stat-label">Total EUR</div></div>';
      actionContent += '</div></div>';
      actionContent += '</div>';

      html += CT.html.zoneAction('Paiements et encaissements', actionContent);

      var infoContent = '';
      infoContent += '<div class="ct-kpi-row">';
      infoContent += CT.html.kpiCard('CA (KMF)', CT.html.formatKMF(kpi.ca_kmf), '💵', 'green');
      infoContent += CT.html.kpiCard('CA (EUR)', CT.html.formatEUR(kpi.ca_eur), '💶', 'blue');
      infoContent += CT.html.kpiCard('Commandes', kpi.nb_commandes || 0, '📦', 'purple');
      infoContent += CT.html.kpiCard('Panier moyen', CT.html.formatKMF(kpi.panier_moyen_kmf), '🛒', 'amber');
      infoContent += '</div>';

      infoContent += '<div class="ct-card"><div class="ct-card-title">📈 Marges</div>';
      infoContent += '<div class="ct-stat-grid">';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatKMF(marges.marge_reelle_kmf || 0) + '</div><div class="ct-stat-label">Marge réelle</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatKMF(marges.cout_logistique_kmf || 0) + '</div><div class="ct-stat-label">Coût logistique</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (marges.taux_marge_pct != null ? marges.taux_marge_pct + '%' : '—') + '</div><div class="ct-stat-label">Taux marge</div></div>';
      infoContent += '</div>';
      if (marges.nb_sans_cost > 0) {
        infoContent += '<div class="ct-muted" style="margin-top:8px;font-size:0.8rem">⚠️ ' + marges.nb_sans_cost + ' commandes sans coût renseigné</div>';
      }
      infoContent += '</div>';

      infoContent += '<div class="ct-grid-2">';
      if (parCategorie.length > 0) {
        infoContent += '<div class="ct-card"><div class="ct-card-title">📂 CA par catégorie</div>';
        infoContent += '<div class="ct-chart-container" style="max-width:100%"><canvas id="chart-categories"></canvas></div></div>';
      }
      if (topProduits.length > 0) {
        infoContent += '<div class="ct-card"><div class="ct-card-title">🏆 Top Produits</div>';
        var tpH = ['Produit', 'Qté', 'CA (KMF)'];
        var tpR = topProduits.map(function(p) { return [p.name || '—', p.count || 0, CT.html.formatKMF(p.revenue_kmf)]; });
        infoContent += CT.html.table(tpH, tpR);
        infoContent += '</div>';
      }
      infoContent += '</div>';

      html += CT.html.zoneInfo('Indicateurs financiers', infoContent);
      el.innerHTML = html;

      if (parCategorie.length > 0 && typeof Chart !== 'undefined') {
        var ctx = document.getElementById('chart-categories');
        if (ctx) {
          var colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#64748b'];
          CT._charts.categories = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
              labels: parCategorie.map(function(c){ return c.category || 'Autre'; }),
              datasets: [{ label: 'CA (KMF)', data: parCategorie.map(function(c){ return c.revenue_kmf || 0; }), backgroundColor: colors.slice(0, parCategorie.length), borderRadius: 6 }]
            },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
          });
        }
      }
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   📋 VIEW: COMMANDES (TOUTES LES COMMANDES — STATUT OPTIMISTE)
   =============================================================== */
CT.views.commandes = {
  label: 'Commandes',
  icon: '📋',
  _orders: [],
  _filter: 'all',
  _search: '',

  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var result = await CT.api.adminOrders({ limit: 500 });
      // API may return array directly or { orders: [...] } or { data: [...] }
      this._orders = Array.isArray(result) ? result : (result.orders || result.data || []);
      this._filter = 'all';
      this._search = '';
      this._render(el);
    } catch(e) {
      el.innerHTML = CT.html.error(e.message);
    }
  },

  _filtered: function() {
    var self = this;
    var orders = this._filter === 'all'
      ? this._orders
      : this._orders.filter(function(o) { return o.status === self._filter; });
    if (this._search) {
      var q = this._search.toLowerCase();
      orders = orders.filter(function(o) {
        return (o.reference || '').toLowerCase().includes(q) ||
               (o.recipient_name || o.client_name || '').toLowerCase().includes(q);
      });
    }
    return orders;
  },

  _render: function(el) {
    var self = this;
    var allStatuses = ['all','new','confirmed','ordered','preparation','shipped','in_transit','available','collected','cancelled','refunded'];
    var statusLabels = {
      all:'Tous', new:'Nouveau', confirmed:'Confirmé', ordered:'Commandé',
      preparation:'Préparation', shipped:'Expédié', in_transit:'En transit',
      available:'Disponible', collected:'Collecté', cancelled:'Annulé', refunded:'Remboursé'
    };

    var orders = this._filtered();
    var total = this._orders.length;

    var html = '<div class="ct-zone ct-zone-action" style="margin-bottom:0">';
    html += '<div class="ct-zone-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">';
    html += '<span><span class="ct-zone-tag action">📋 COMMANDES</span> ' + total + ' commandes — <span style="color:var(--ct-text-muted);font-size:.85rem">' + orders.length + ' affichées</span></span>';
    html += '<button onclick="CT.views.commandes.load(document.getElementById(\'content-area\'))" style="padding:4px 12px;border:1px solid var(--ct-border);border-radius:6px;background:var(--ct-bg3);color:var(--ct-text);font-size:.8rem;cursor:pointer">🔄 Rafraîchir</button>';
    html += '</div>';
    html += '<div class="ct-zone-body">';

    // Search bar
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">';
    html += '<input id="cmd-search" type="text" placeholder="🔍 Rechercher ref, client..." value="' + (this._search || '') + '" ' +
      'oninput="CT.views.commandes._search=this.value;CT.views.commandes._render(document.getElementById(\'content-area\'))" ' +
      'style="flex:1;min-width:200px;padding:6px 12px;border:1px solid var(--ct-border);border-radius:8px;background:var(--ct-bg3);color:var(--ct-text);font-size:.85rem">';
    html += '</div>';

    // Filter chips
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">';
    allStatuses.forEach(function(s) {
      var count = s === 'all' ? total : self._orders.filter(function(o) { return o.status === s; }).length;
      if (s !== 'all' && count === 0) return;
      var active = s === self._filter;
      var hex = CT.html.STATUS_HEX[s] || '#64748b';
      var bg = active ? hex : 'var(--ct-bg3)';
      var color = active ? '#fff' : 'var(--ct-text)';
      html += '<button onclick="CT.views.commandes._setFilter(\'' + s + '\')" ' +
        'style="padding:4px 12px;border:none;border-radius:20px;font-size:.75rem;font-weight:600;cursor:pointer;' +
        'background:' + bg + ';color:' + color + ';transition:all .15s">' +
        statusLabels[s] + ' <span style="opacity:.7">(' + count + ')</span></button>';
    });
    html += '</div>';

    // Table
    if (orders.length === 0) {
      html += CT.html.empty('🔍', 'Aucune commande trouvée');
    } else {
      var headers = ['Réf.', 'Destinataire', 'Montant', 'Statut', 'Île', 'Paiement', 'Âge', '📱'];
      var rows = orders.map(function(o) {
        var payBadge = o.payment_status === 'paid'
          ? '<span style="color:#10b981;font-size:.7rem;font-weight:700">✓ Payé</span>'
          : '<span style="color:var(--ct-text-muted);font-size:.7rem">' + (o.payment_method || '—') + '</span>';
        return [
          '<span class="ct-font-mono" style="font-weight:700;font-size:.8rem;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
          '<span style="font-size:.85rem">' + (o.recipient_name || o.client_name || '—') + '</span>',
          '<span style="font-weight:600;font-size:.85rem">' + CT.html.formatKMF(o.total_amount || o.total_kmf) + '</span>',
          CT.html.statusChip(o.id, o.reference, o.status),
          '<span style="font-size:.8rem">' + (o.destination_island || '—') + '</span>',
          payBadge,
          '<span style="font-size:.75rem;color:var(--ct-text-muted)">' + CT.html._age(o.updated_at || o.created_at) + '</span>',
          CT.html.whatsappBtn(o.client_phone || o.recipient_phone, o.reference, o.status, true)
        ];
      });
      html += CT.html.table(headers, rows);
    }

    html += '</div></div>';
    el.innerHTML = html;
  },

  _setFilter: function(f) {
    this._filter = f;
    var el = document.getElementById('content-area');
    if (el) this._render(el);
  }
};
