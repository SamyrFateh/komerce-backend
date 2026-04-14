/* ===================================================================
   Komerce Control Tower — ct-views-v7.js
   9 vues COLIS-FIRST réparties en 3 sections:
     ⚙️ Opérationnel: Colis, Paiements, Créer Colis
     📊 Informationnel: Dashboard, Finances, Factures
     🚨 Alerting: Alertes, Incidents, Réconciliation
   =================================================================== */
window.CT = window.CT || {};
CT.views = {};

// ═══════════════════════════════════════════════════════════════
// SECTION 1: ⚙️ OPÉRATIONNEL
// ═══════════════════════════════════════════════════════════════

// ── 1a. COLIS (liste + drill-down + actions) ──────────────────
CT.views.parcels = async function(container) {
  container.innerHTML = '<div class="ct-loading">📦 Chargement des colis...</div>';
  try {
    var data = await CT.api.v2Parcels();
    var parcels = data.parcels || [];
    
    var html = '<div class="ct-view-header"><h2>📦 Colis (' + parcels.length + ')</h2>' +
      '<div class="ct-filters">' +
        '<select id="ct-filter-status" class="ct-select"><option value="">Tous statuts</option>' +
        '<option value="preparation">🔧 Préparation</option>' +
        '<option value="shipped">✈️ Expédié</option>' +
        '<option value="in_transit">🚢 En transit</option>' +
        '<option value="available">📍 Disponible</option>' +
        '<option value="collected">✅ Récupéré</option></select>' +
        '<input id="ct-search" class="ct-input" placeholder="🔍 Rechercher...">' +
      '</div></div>';

    html += '<div id="ct-parcel-list" class="ct-card-grid">';
    for (var i = 0; i < parcels.length; i++) {
      html += CT.pc.parcelCard(parcels[i]);
    }
    if (!parcels.length) html += '<div class="ct-empty">Aucun colis</div>';
    html += '</div>';
    html += '<div id="ct-parcel-detail" class="ct-detail-panel" style="display:none"></div>';

    container.innerHTML = html;

    // Click handlers
    container.querySelectorAll('.ct-parcel-card').forEach(function(card) {
      card.addEventListener('click', function() { CT.views._showParcel(card.dataset.ref, container); });
    });

    // Filter
    var filterSt = container.querySelector('#ct-filter-status');
    var searchBox = container.querySelector('#ct-search');
    function applyFilter() {
      var st = filterSt.value;
      var q = (searchBox.value || '').toLowerCase();
      container.querySelectorAll('.ct-parcel-card').forEach(function(card) {
        var ref = card.dataset.ref.toLowerCase();
        var text = card.textContent.toLowerCase();
        var matchSt = !st || text.indexOf(CT.pc.STATUS[st]?.label.toLowerCase() || '') >= 0;
        var matchQ = !q || text.indexOf(q) >= 0;
        card.style.display = (matchSt && matchQ) ? '' : 'none';
      });
    }
    filterSt.addEventListener('change', applyFilter);
    searchBox.addEventListener('input', applyFilter);
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── Parcel Detail (drill-down) ────────────────────────────────
CT.views._showParcel = async function(ref, container) {
  var detail = container.querySelector('#ct-parcel-detail');
  var list = container.querySelector('#ct-parcel-list');
  detail.style.display = 'block';
  list.style.display = 'none';
  detail.innerHTML = '<div class="ct-loading">Chargement ' + ref + '...</div>';

  try {
    var p = await CT.api.v2ParcelDetail(ref);
    
    var html = '<div class="ct-detail-back"><button class="ct-btn ct-btn-ghost" id="ct-back">← Retour</button></div>';
    
    // Action bar (ADVANCE STATUS)
    html += CT.pc.actionBar(p);
    
    // Header
    html += '<div class="ct-detail-header">' +
      '<h2>' + p.reference + ' ' + CT.pc.badge(p.status) + '</h2>' +
      '<div>🏝️ ' + (p.destination_island || '—') +
        (p.relais?.name ? ' · 📍 ' + p.relais.name : '') +
        (p.pickup_code ? ' · 🔑 ' + p.pickup_code : '') + '</div>' +
      '<div>⚖️ ' + (p.weight_kg || '?') + ' kg · 💰 ' + CT.pc.fmt(p.total_kmf) + '</div>' +
      '<div>📅 Créé ' + CT.pc.fmtDate(p.created_at) + '</div>' +
    '</div>';

    // Clients → Commandes → Articles
    html += '<div class="ct-section-block"><h3>👥 Clients & Commandes</h3>' + CT.pc.hierarchy(p.clients) + '</div>';
    
    // Timeline
    html += '<div class="ct-section-block"><h3>📡 Timeline</h3>' + CT.pc.timeline(p.scans) + '</div>';

    // Incidents
    if (p.incidents && p.incidents.length) {
      html += '<div class="ct-section-block"><h3>🚨 Incidents (' + p.incidents.length + ')</h3>';
      for (var i = 0; i < p.incidents.length; i++) {
        var inc = p.incidents[i];
        html += '<div class="ct-incident-item">' +
          CT.pc.severityBadge(inc.severity) + ' ' + CT.pc.badge(inc.status) +
          ' <strong>' + inc.title + '</strong>' +
          '<div>' + (inc.description || '') + '</div>' +
        '</div>';
      }
      html += '</div>';
    }

    // Reconciliation
    if (p.reconciliation) {
      var reco = p.reconciliation;
      var recoColor = { blocked: '#ef4444', warning: '#f59e0b', ok: '#22c55e' }[reco.status] || '#6b7280';
      html += '<div class="ct-section-block" style="border-left:4px solid ' + recoColor + '"><h3>🔄 Réconciliation</h3>';
      var checks = reco.checks || {};
      for (var key in checks) {
        html += '<div>' + (checks[key] ? '✅' : '❌') + ' ' + key.replace(/_/g, ' ') + '</div>';
      }
      if (reco.issues && reco.issues.length) {
        for (var j = 0; j < reco.issues.length; j++) {
          html += '<div class="ct-reco-issue">⚠️ ' + reco.issues[j].message + '</div>';
        }
      }
      html += '</div>';
    }

    // Alerts
    if (p.alerts && p.alerts.length) {
      html += '<div class="ct-section-block"><h3>⚠️ Alertes</h3>';
      for (var k = 0; k < p.alerts.length; k++) {
        html += '<div class="ct-alert-item">' + CT.pc.severityBadge(p.alerts[k].severity) + ' ' + p.alerts[k].message + '</div>';
      }
      html += '</div>';
    }

    detail.innerHTML = html;

    // Back button
    detail.querySelector('#ct-back').addEventListener('click', function() {
      detail.style.display = 'none';
      list.style.display = '';
    });

    // Advance status button
    var advBtn = detail.querySelector('[data-advance]');
    if (advBtn) {
      advBtn.addEventListener('click', async function() {
        var r = advBtn.dataset.advance;
        var evt = advBtn.dataset.event;
        if (!confirm('Avancer ' + r + ' → ' + evt + ' ?')) return;
        advBtn.disabled = true;
        advBtn.textContent = '⏳ En cours...';
        try {
          var result = await CT.api.v2Scan(r, evt, 'Avancé depuis Control Tower');
          alert('✅ ' + r + ': ' + result.parcel.old_status + ' → ' + result.parcel.new_status);
          CT.views._showParcel(r, container); // Refresh
        } catch (err) {
          alert('❌ ' + err.message);
          advBtn.disabled = false;
          advBtn.textContent = CT.pc.NEXT_STATUS[evt]?.label || 'Avancer';
        }
      });
    }
  } catch (err) {
    detail.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── 1b. PAIEMENTS EN ATTENTE ──────────────────────────────────
CT.views.pendingCash = async function(container) {
  container.innerHTML = '<div class="ct-loading">💰 Chargement des paiements en attente...</div>';
  try {
    var data = await CT.api.v2PendingCash();
    var orders = data.orders || [];

    var html = '<div class="ct-view-header"><h2>💰 Paiements cash en attente (' + orders.length + ')</h2>' +
      '<p class="ct-subtitle">Commandes cash_relais non payées — Confirmer le paiement pour débloquer</p></div>';
    
    if (!orders.length) {
      html += '<div class="ct-empty-state">✅ Aucun paiement en attente !</div>';
    } else {
      html += '<div class="ct-card-grid">';
      for (var i = 0; i < orders.length; i++) {
        html += CT.pc.orderCard(orders[i], '💰 Confirmer paiement', 'confirm-cash');
      }
      html += '</div>';
    }

    container.innerHTML = html;

    // Action handlers
    container.querySelectorAll('[data-action="confirm-cash"]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var ref = btn.dataset.ref;
        if (!confirm('Confirmer le paiement cash pour ' + ref + ' ?')) return;
        btn.disabled = true;
        btn.textContent = '⏳ Confirmation...';
        try {
          var result = await CT.api.v2ConfirmCash(ref);
          alert('✅ ' + result.message);
          CT.views.pendingCash(container); // Refresh
        } catch (err) {
          alert('❌ ' + err.message);
          btn.disabled = false;
          btn.textContent = '💰 Confirmer paiement';
        }
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── 1c. CRÉER COLIS ───────────────────────────────────────────
CT.views.createParcel = async function(container) {
  container.innerHTML = '<div class="ct-loading">📋 Chargement des commandes...</div>';
  try {
    var data = await CT.api.v2ReadyForParcel();
    var orders = data.orders || [];

    var html = '<div class="ct-view-header"><h2>📦 Créer un colis (' + orders.length + ')</h2>' +
      '<p class="ct-subtitle">Commandes confirmées & payées, sans colis — Cliquer pour créer le colis</p></div>';

    if (!orders.length) {
      html += '<div class="ct-empty-state">📭 Aucune commande prête pour la création de colis</div>';
    } else {
      html += '<div class="ct-card-grid">';
      for (var i = 0; i < orders.length; i++) {
        html += CT.pc.orderCard(orders[i], '📦 Créer colis', 'create-parcel');
      }
      html += '</div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('[data-action="create-parcel"]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var ref = btn.dataset.ref;
        if (!confirm('Créer un colis pour ' + ref + ' ?')) return;
        btn.disabled = true;
        btn.textContent = '⏳ Création...';
        try {
          var result = await CT.api.v2CreateParcel(ref);
          alert('✅ ' + result.message + '\n📦 ' + result.parcel.reference);
          CT.views.createParcel(container); // Refresh
        } catch (err) {
          alert('❌ ' + err.message);
          btn.disabled = false;
          btn.textContent = '📦 Créer colis';
        }
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ═══════════════════════════════════════════════════════════════
// SECTION 2: 📊 INFORMATIONNEL / PRÉVISIONNEL
// ═══════════════════════════════════════════════════════════════

// ── 2a. DASHBOARD KPIs ────────────────────────────────────────
CT.views.dashboard = async function(container) {
  container.innerHTML = '<div class="ct-loading">🎯 Chargement du dashboard...</div>';
  try {
    var kpis = await CT.api.v2ParcelKpis();
    var pk = kpis.parcels;
    var fin = kpis.finance;
    var inc = kpis.incidents;

    var html = '<div class="ct-view-header"><h2>🎯 Dashboard COLIS-FIRST</h2></div>';

    // KPI row 1: Parcels by status
    html += '<div class="ct-kpi-grid">';
    html += CT.pc.kpiCard('📦', 'Total colis', pk.total, '#3b82f6');
    html += CT.pc.kpiCard('🔧', 'Préparation', pk.by_status.preparation, '#eab308');
    html += CT.pc.kpiCard('✈️', 'Expédiés', pk.by_status.shipped, '#3b82f6');
    html += CT.pc.kpiCard('🚢', 'En transit', pk.by_status.in_transit, '#8b5cf6');
    html += CT.pc.kpiCard('📍', 'Disponibles', pk.by_status.available, '#22c55e');
    html += CT.pc.kpiCard('✅', 'Récupérés', pk.by_status.collected, '#16a34a');
    html += '</div>';

    // KPI row 2: Finance
    html += '<div class="ct-kpi-grid">';
    html += CT.pc.kpiCard('💰', 'CA Total', CT.pc.fmt(fin.ca_total_kmf), '#16a34a');
    html += CT.pc.kpiCard('📊', 'CA Actif', CT.pc.fmt(fin.ca_active_kmf), '#3b82f6');
    html += CT.pc.kpiCard('🧺', 'Panier moyen', CT.pc.fmt(fin.avg_basket_kmf), '#8b5cf6');
    html += CT.pc.kpiCard('👥', 'Clients', fin.nb_clients, '#f59e0b');
    html += CT.pc.kpiCard('🚨', 'Incidents ouverts', inc.open, '#ef4444');
    html += CT.pc.kpiCard('🔴', 'Critiques', inc.critical, '#dc2626');
    html += '</div>';

    // By island
    html += '<div class="ct-section-block"><h3>🏝️ Par île</h3><div class="ct-island-grid">';
    var islands = pk.by_island || {};
    for (var isl in islands) {
      var byStatus = islands[isl];
      var total = 0;
      for (var s in byStatus) total += byStatus[s];
      html += '<div class="ct-island-card"><strong>' + isl + '</strong> <span class="ct-badge">' + total + ' colis</span>';
      for (var st in byStatus) {
        html += '<div>' + CT.pc.badge(st) + ' ' + byStatus[st] + '</div>';
      }
      html += '</div>';
    }
    html += '</div></div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── 2b. FINANCES ──────────────────────────────────────────────
CT.views.finances = async function(container) {
  container.innerHTML = '<div class="ct-loading">💰 Chargement finances...</div>';
  try {
    var kpis = await CT.api.v2ParcelKpis();
    var fin = kpis.finance;
    var pk = kpis.parcels;

    var html = '<div class="ct-view-header"><h2>💰 Finances</h2></div>';
    html += '<div class="ct-kpi-grid">';
    html += CT.pc.kpiCard('💰', 'CA Total', CT.pc.fmt(fin.ca_total_kmf), '#16a34a');
    html += CT.pc.kpiCard('📊', 'CA Actif (en cours)', CT.pc.fmt(fin.ca_active_kmf), '#3b82f6');
    html += CT.pc.kpiCard('✅', 'CA Livré', CT.pc.fmt(fin.ca_collected_kmf), '#16a34a');
    html += CT.pc.kpiCard('🧺', 'Panier moyen', CT.pc.fmt(fin.avg_basket_kmf), '#8b5cf6');
    html += CT.pc.kpiCard('👥', 'Clients uniques', fin.nb_clients, '#f59e0b');
    html += CT.pc.kpiCard('📦', 'Colis actifs', pk.active, '#3b82f6');
    html += '</div>';

    // Breakdown
    html += '<div class="ct-section-block"><h3>📊 Répartition par statut</h3>';
    html += '<table class="ct-table"><thead><tr><th>Statut</th><th>Nombre</th><th>%</th></tr></thead><tbody>';
    var statuses = ['preparation','shipped','in_transit','available','collected','cancelled'];
    for (var i = 0; i < statuses.length; i++) {
      var st = statuses[i];
      var count = pk.by_status[st] || 0;
      var pct = pk.total > 0 ? Math.round(count / pk.total * 100) : 0;
      html += '<tr><td>' + CT.pc.badge(st) + '</td><td>' + count + '</td><td>' + pct + '%</td></tr>';
    }
    html += '</tbody></table></div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── 2c. FACTURES ──────────────────────────────────────────────
CT.views.invoices = async function(container) {
  container.innerHTML = '<div class="ct-loading">🧾 Chargement factures...</div>';
  try {
    var data = await CT.api.invoicesList();
    var invoices = data.invoices || data || [];

    var html = '<div class="ct-view-header"><h2>🧾 Factures (' + invoices.length + ')</h2></div>';
    
    if (!invoices.length) {
      html += '<div class="ct-empty-state">Aucune facture</div>';
    } else {
      html += '<table class="ct-table"><thead><tr>' +
        '<th>N°</th><th>Client</th><th>Montant</th><th>Mode</th><th>Date</th></tr></thead><tbody>';
      for (var i = 0; i < invoices.length; i++) {
        var inv = invoices[i];
        html += '<tr>' +
          '<td><strong>' + (inv.invoice_number || inv.id) + '</strong></td>' +
          '<td>' + (inv.client_name || '—') + '</td>' +
          '<td>' + CT.pc.fmt(inv.total_kmf) + '</td>' +
          '<td>' + (inv.payment_mode || '—') + '</td>' +
          '<td>' + CT.pc.fmtDate(inv.created_at) + '</td>' +
        '</tr>';
      }
      html += '</tbody></table>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ═══════════════════════════════════════════════════════════════
// SECTION 3: 🚨 ALERTING / INCIDENTS
// ═══════════════════════════════════════════════════════════════

// ── 3a. ALERTES ───────────────────────────────────────────────
CT.views.alerts = async function(container) {
  container.innerHTML = '<div class="ct-loading">⚠️ Chargement alertes...</div>';
  try {
    var data = await CT.api.v2ParcelAlerts();
    var alerts = data.alerts || [];
    var operational = data.operational || [];

    var html = '<div class="ct-view-header"><h2>⚠️ Alertes (' + alerts.length + ')</h2></div>';

    // Operational alerts
    if (operational.length) {
      html += '<div class="ct-section-block"><h3>🏝️ Alertes opérationnelles</h3>';
      for (var i = 0; i < operational.length; i++) {
        var op = operational[i];
        html += '<div class="ct-alert-item">' + CT.pc.severityBadge(op.severity) + ' ' + op.message + '</div>';
      }
      html += '</div>';
    }

    // Individual alerts
    if (!alerts.length) {
      html += '<div class="ct-empty-state">✅ Aucune alerte active</div>';
    } else {
      html += '<div class="ct-card-list">';
      for (var j = 0; j < alerts.length; j++) {
        var a = alerts[j];
        html += '<div class="ct-alert-card">' +
          '<div>' + CT.pc.severityBadge(a.severity) +
            ' <strong>' + (a.parcel_ref || '—') + '</strong>' +
            ' · 👤 ' + (a.recipient_name || 'Client') +
            ' · 🏝️ ' + (a.destination_island || '—') +
          '</div>' +
          '<div class="ct-alert-msg">' + a.message + '</div>' +
        '</div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── 3b. INCIDENTS ─────────────────────────────────────────────
CT.views.incidents = async function(container) {
  container.innerHTML = '<div class="ct-loading">🔥 Chargement incidents...</div>';
  try {
    // Use the KPIs endpoint to get incident data (v2 incidents may not be mounted)
    var kpis = await CT.api.v2ParcelKpis();
    
    // Get parcels with incidents
    var data = await CT.api.v2Parcels();
    var parcelsWithInc = (data.parcels || []).filter(function(p) { return p.open_incidents > 0; });

    var html = '<div class="ct-view-header"><h2>🔥 Incidents</h2>' +
      '<div class="ct-kpi-grid ct-kpi-mini">' +
        CT.pc.kpiCard('🔥', 'Total', kpis.incidents.total, '#ef4444') +
        CT.pc.kpiCard('🔴', 'Ouverts', kpis.incidents.open, '#f97316') +
        CT.pc.kpiCard('💀', 'Critiques', kpis.incidents.critical, '#dc2626') +
      '</div></div>';

    if (!parcelsWithInc.length) {
      html += '<div class="ct-empty-state">✅ Aucun incident ouvert</div>';
    } else {
      html += '<div class="ct-card-list">';
      for (var i = 0; i < parcelsWithInc.length; i++) {
        var p = parcelsWithInc[i];
        html += '<div class="ct-parcel-card ct-parcel-incident" data-ref="' + p.reference + '">' +
          '<div class="ct-parcel-header">' +
            '<strong>' + p.reference + '</strong> ' + CT.pc.badge(p.status) +
            ' <span class="ct-badge" style="background:#fef2f2;color:#ef4444">🚨 ' + p.open_incidents +
            (p.critical_incidents > 0 ? ' dont ' + p.critical_incidents + ' critique(s)' : '') + '</span>' +
          '</div>' +
          '<div class="ct-parcel-body">' +
            '<div>👤 <strong>' + (p.recipient_name || 'Client') + '</strong></div>' +
            '<div>🏝️ ' + (p.destination_island || '—') + ' · 💰 ' + CT.pc.fmt(p.total_kmf) + '</div>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;

    // Click to drill-down
    container.querySelectorAll('.ct-parcel-incident').forEach(function(card) {
      card.addEventListener('click', function() {
        CT.app.navigate('parcels');
        setTimeout(function() {
          CT.views._showParcel(card.dataset.ref, document.getElementById('ct-main'));
        }, 300);
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── 3c. RÉCONCILIATION ───────────────────────────────────────
CT.views.reconciliation = async function(container) {
  container.innerHTML = '<div class="ct-loading">🔄 Chargement réconciliation...</div>';
  try {
    var data = await CT.api.v2ParcelReconciliation();
    var parcels = data.parcels || [];
    var summary = data.summary || {};

    var html = '<div class="ct-view-header"><h2>🔄 Réconciliation</h2>' +
      '<div class="ct-kpi-grid ct-kpi-mini">' +
        CT.pc.kpiCard('📦', 'Total', summary.total || 0, '#3b82f6') +
        CT.pc.kpiCard('🔴', 'Bloqués', summary.blocked || 0, '#ef4444') +
        CT.pc.kpiCard('🟡', 'Attention', summary.warning || 0, '#f59e0b') +
        CT.pc.kpiCard('🟢', 'OK', summary.ok || 0, '#22c55e') +
      '</div></div>';

    if (!parcels.length) {
      html += '<div class="ct-empty-state">✅ Aucun colis à réconcilier</div>';
    } else {
      html += '<div class="ct-card-list">';
      for (var i = 0; i < parcels.length; i++) {
        html += CT.pc.recoCard(parcels[i]);
      }
      html += '</div>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};
