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
// ═══════════════════════════════════════════════════════════════
// COMMANDES — Vue complète du cycle de vie (avant colis)
// ═══════════════════════════════════════════════════════════════

CT.views.orders = async function(container) {
  container.innerHTML = '<div class="ct-loading">Chargement des commandes...</div>';
  
  try {
    var data = await CT.api.v2Orders();
    var k = data.kpis || {};
    var orders = data.orders || [];
    
    // Status badge helper
    function statusBadge(s) {
      var map = {
        'pending':     { bg: '#fef3c7', fg: '#92400e', label: '⏳ En attente' },
        'confirmed':   { bg: '#dbeafe', fg: '#1e40af', label: '✅ Confirmée' },
        'ordered':     { bg: '#e0e7ff', fg: '#3730a3', label: '📦 Commandée' },
        'preparation': { bg: '#fce7f3', fg: '#9d174d', label: '🔧 Préparation' },
        'shipped':     { bg: '#ccfbf1', fg: '#065f46', label: '🚢 Expédiée' },
        'in_transit':  { bg: '#cffafe', fg: '#155e75', label: '✈️ En transit' },
        'available':   { bg: '#d1fae5', fg: '#065f46', label: '📍 Disponible' },
        'collected':   { bg: '#f0fdf4', fg: '#166534', label: '✔️ Collectée' },
        'cancelled':   { bg: '#fee2e2', fg: '#991b1b', label: '❌ Annulée' },
        'refunded':    { bg: '#fef3c7', fg: '#92400e', label: '↩️ Remboursée' }
      };
      var m = map[s] || { bg: '#f1f5f9', fg: '#475569', label: s };
      return '<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;background:' + m.bg + ';color:' + m.fg + '">' + m.label + '</span>';
    }
    
    function payBadge(ps, pm) {
      if (ps === 'paid') return '<span style="color:#059669;font-weight:600">💚 Payé</span>';
      if (ps === 'failed') return '<span style="color:#dc2626;font-weight:600">🔴 Échoué</span>';
      if (ps === 'refunded') return '<span style="color:#d97706;font-weight:600">↩️ Remboursé</span>';
      if (ps === 'pending' && pm === 'cash_relais') return '<span style="color:#d97706;font-weight:600">💰 Cash en attente</span>';
      if (ps === 'pending') return '<span style="color:#d97706;font-weight:600">⏳ En attente</span>';
      return '<span style="color:#64748b">' + (ps || '—') + '</span>';
    }
    
    function modeIcon(pm) {
      if (pm === 'stripe_eur') return '💳 Stripe';
      if (pm === 'cash_relais') return '💰 Cash';
      return pm || '—';
    }
    
    function timeAgo(d) {
      if (!d) return '—';
      var diff = Date.now() - new Date(d).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 60) return mins + 'min';
      var hours = Math.floor(mins / 60);
      if (hours < 24) return hours + 'h';
      return Math.floor(hours / 24) + 'j';
    }
    
    // ─── KPI Cards ───
    var hasIncidents = (k.payment_failed || 0) > 0;
    var hasPending = (k.payment_pending || 0) > 0;
    
    var html = '';
    
    // Alert banner for payment incidents
    if (hasIncidents) {
      html += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:8px">'
        + '<span style="font-size:20px">🚨</span>'
        + '<div><strong style="color:#991b1b">' + k.payment_failed + ' paiement(s) échoué(s)</strong>'
        + '<div style="color:#7f1d1d;font-size:13px">Action requise — vérifier dans Stripe</div></div></div>';
    }
    
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">';
    
    var kpis = [
      { label: 'Total', val: k.total || 0, icon: '📋', bg: '#f1f5f9' },
      { label: 'En attente', val: (k.pending || 0) + (k.confirmed || 0), icon: '⏳', bg: '#fef3c7' },
      { label: 'En cours', val: (k.ordered || 0) + (k.preparation || 0) + (k.shipped || 0) + (k.in_transit || 0), icon: '🔄', bg: '#dbeafe' },
      { label: 'À retirer', val: k.available || 0, icon: '📍', bg: '#d1fae5' },
      { label: 'Collectées', val: k.collected || 0, icon: '✔️', bg: '#f0fdf4' },
      { label: '💳 Stripe', val: k.stripe_count || 0, icon: '', bg: '#ede9fe' },
      { label: '💰 Cash', val: k.cash_count || 0, icon: '', bg: '#fff7ed' },
      { label: 'CA (KMF)', val: (k.ca_total_kmf || 0).toLocaleString(), icon: '💰', bg: '#ecfdf5' },
    ];
    
    kpis.forEach(function(kpi) {
      html += '<div style="background:' + kpi.bg + ';border-radius:12px;padding:14px 16px;text-align:center">'
        + '<div style="font-size:24px;font-weight:700">' + (kpi.icon ? kpi.icon + ' ' : '') + kpi.val + '</div>'
        + '<div style="font-size:12px;color:#64748b;margin-top:4px">' + kpi.label + '</div></div>';
    });
    html += '</div>';
    
    // ─── Filters ───
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center">'
      + '<select id="ct-orders-status" style="padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px">'
      + '<option value="">Tous les statuts</option>'
      + '<option value="pending">⏳ Pending</option>'
      + '<option value="confirmed">✅ Confirmed</option>'
      + '<option value="ordered">📦 Ordered</option>'
      + '<option value="preparation">🔧 Preparation</option>'
      + '<option value="shipped">🚢 Shipped</option>'
      + '<option value="in_transit">✈️ In Transit</option>'
      + '<option value="available">📍 Available</option>'
      + '<option value="collected">✔️ Collected</option>'
      + '<option value="cancelled">❌ Cancelled</option>'
      + '</select>'
      + '<select id="ct-orders-payment" style="padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px">'
      + '<option value="">Tous modes</option>'
      + '<option value="stripe_eur">💳 Stripe</option>'
      + '<option value="cash_relais">💰 Cash</option>'
      + '</select>'
      + '<input id="ct-orders-search" type="text" placeholder="🔍 Référence, nom..." style="padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px;flex:1;min-width:150px">'
      + '<button id="ct-orders-refresh" style="padding:6px 14px;border-radius:8px;background:#3b82f6;color:white;border:none;cursor:pointer;font-size:13px">🔄</button>'
      + '</div>';
    
    // ─── Orders Table ───
    html += '<div style="overflow-x:auto;border-radius:12px;border:1px solid #e2e8f0">'
      + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="background:#f8fafc">'
      + '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Réf</th>'
      + '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Client</th>'
      + '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Statut</th>'
      + '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Paiement</th>'
      + '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Mode</th>'
      + '<th style="padding:10px 12px;text-align:right;border-bottom:2px solid #e2e8f0">Montant</th>'
      + '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Articles</th>'
      + '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Colis</th>'
      + '<th style="padding:10px 12px;text-align:right;border-bottom:2px solid #e2e8f0">Âge</th>'
      + '</tr></thead><tbody>';
    
    if (orders.length === 0) {
      html += '<tr><td colspan="9" style="padding:40px;text-align:center;color:#94a3b8">Aucune commande</td></tr>';
    } else {
      orders.forEach(function(o) {
        var rowBg = '';
        if (o.payment_status === 'failed') rowBg = 'background:#fef2f2;';
        else if (o.status === 'pending') rowBg = 'background:#fffbeb;';
        
        html += '<tr style="border-bottom:1px solid #f1f5f9;cursor:pointer;' + rowBg + '" '
          + 'onmouseover="this.style.background=\'#f0f9ff\'" '
          + 'onmouseout="this.style.background=\'' + (rowBg ? rowBg.split(';')[0].split(':')[1] : '') + '\'" '
          + 'data-ref="' + o.reference + '">'
          + '<td style="padding:10px 12px;font-weight:600;font-family:monospace;color:#1e40af">' + o.reference + '</td>'
          + '<td style="padding:10px 12px">'
          +   '<div style="font-weight:500">' + (o.customer_name || '—') + '</div>'
          +   '<div style="font-size:11px;color:#94a3b8">' + (o.relais_name || '') + (o.relais_island ? ' · ' + o.relais_island : '') + '</div>'
          + '</td>'
          + '<td style="padding:10px 12px;text-align:center">' + statusBadge(o.status) + '</td>'
          + '<td style="padding:10px 12px;text-align:center">' + payBadge(o.payment_status, o.payment_mode) + '</td>'
          + '<td style="padding:10px 12px;text-align:center;font-size:12px">' + modeIcon(o.payment_mode) + '</td>'
          + '<td style="padding:10px 12px;text-align:right;font-weight:600">'
          +   (o.total_eur ? o.total_eur + '€' : '') + (o.total_eur && o.total_kmf ? '<br>' : '')
          +   (o.total_kmf ? '<span style="font-size:11px;color:#64748b">' + o.total_kmf.toLocaleString() + ' KMF</span>' : '')
          + '</td>'
          + '<td style="padding:10px 12px;text-align:center">' + (o.total_qty || 0) + ' <span style="font-size:11px;color:#94a3b8">(' + (o.nb_items || 0) + ' réf)</span></td>'
          + '<td style="padding:10px 12px;text-align:center">'
          +   (o.has_parcel ? '<span style="color:#059669" title="' + (o.parcel_ref || '') + '">📦 ' + (o.parcel_ref || 'oui') + '</span>' : '<span style="color:#94a3b8">—</span>')
          + '</td>'
          + '<td style="padding:10px 12px;text-align:right;color:#64748b;font-size:12px">' + timeAgo(o.created_at) + '</td>'
          + '</tr>';
      });
    }
    
    html += '</tbody></table></div>';
    
    // ─── Summary ───
    html += '<div style="margin-top:12px;text-align:right;font-size:12px;color:#94a3b8">'
      + orders.length + ' commande(s) affichée(s) sur ' + (k.total || 0) + ' total'
      + '</div>';
    
    container.innerHTML = html;
    
    // ─── Interactivity ───
    // Filter/refresh
    var filterHandler = async function() {
      var params = {};
      var s = document.getElementById('ct-orders-status');
      var p = document.getElementById('ct-orders-payment');
      var q = document.getElementById('ct-orders-search');
      if (s && s.value) params.status = s.value;
      if (p && p.value) params.payment_mode = p.value;
      if (q && q.value) params.search = q.value;
      
      container.innerHTML = '<div class="ct-loading">Chargement...</div>';
      try {
        var d = await CT.api.v2Orders(params);
        // Re-render with filtered data (reuse same function but avoid infinite loop)
        data.orders = d.orders;
        data.kpis = d.kpis;
        CT.views.orders(container);
      } catch(e) {
        container.innerHTML = '<div class="ct-error">Erreur: ' + e.message + '</div>';
      }
    };
    
    var statusEl = document.getElementById('ct-orders-status');
    var paymentEl = document.getElementById('ct-orders-payment');
    var searchEl = document.getElementById('ct-orders-search');
    var refreshEl = document.getElementById('ct-orders-refresh');
    
    if (statusEl) statusEl.addEventListener('change', filterHandler);
    if (paymentEl) paymentEl.addEventListener('change', filterHandler);
    if (refreshEl) refreshEl.addEventListener('click', filterHandler);
    if (searchEl) {
      var debounce;
      searchEl.addEventListener('input', function() {
        clearTimeout(debounce);
        debounce = setTimeout(filterHandler, 400);
      });
    }
    
    // Row click → detail (future: order detail view)
    container.querySelectorAll('tr[data-ref]').forEach(function(row) {
      row.addEventListener('click', function() {
        var ref = row.dataset.ref;
        // For now, if has parcel → go to parcel view, else show alert
        var parcelCell = row.querySelector('td:nth-child(8) span[title]');
        if (parcelCell && parcelCell.getAttribute('title')) {
          CT.views._showParcel(parcelCell.getAttribute('title'), container);
        } else {
          alert('Commande ' + ref + ' — pas encore de colis créé.\nUtilisez "Créer colis" pour la préparer.');
        }
      });
    });
    
  } catch(err) {
    container.innerHTML = '<div class="ct-error">Erreur chargement: ' + err.message + '</div>';
  }
};

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
    html += '<div class="ct-action-bar" style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap">';
    // Print label buttons
    html += '<button class="ct-btn ct-btn-secondary" onclick="window.open(\'/api/v2/parcels/' + p.reference + '/label\', \'_blank\')">' +
      '🏷️ Etiquette A5</button>';
    html += '<button class="ct-btn ct-btn-secondary" onclick="window.open(\'/api/v2/parcels/' + p.reference + '/label?format=thermal\', \'_blank\')">' +
      '🖨️ Etiquette thermique</button>';
    html += '</div>';
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

    // Also fetch order KPIs
    var orderData = {};
    try { orderData = await CT.api.v2Orders(); } catch(_) {}
    var ok = orderData.kpis || {};
    
    var html = '<div class="ct-view-header"><h2>🎯 Dashboard</h2></div>';
    
    // ── Orders Overview ──
    var awaitingParcel = (ok.confirmed || 0) + (ok.ordered || 0);
    if (ok.total > 0) {
      html += '<div class="ct-section-block"><h3>📋 Commandes</h3>';
      html += '<div class="ct-kpi-grid">';
      html += CT.pc.kpiCard('📋', 'Total commandes', ok.total || 0, '#6366f1');
      html += CT.pc.kpiCard('⏳', 'En attente paiement', ok.pending || 0, '#f59e0b');
      html += CT.pc.kpiCard('📦', 'En attente colis', awaitingParcel, awaitingParcel > 0 ? '#ef4444' : '#22c55e');
      html += CT.pc.kpiCard('🔄', 'En cours', (ok.preparation || 0) + (ok.shipped || 0) + (ok.in_transit || 0), '#3b82f6');
      html += CT.pc.kpiCard('📍', 'À retirer', ok.available || 0, '#22c55e');
      html += CT.pc.kpiCard('✔️', 'Collectées', ok.collected || 0, '#16a34a');
      html += CT.pc.kpiCard('💳', 'Stripe', ok.stripe_count || 0, '#6366f1');
      html += CT.pc.kpiCard('💰', 'Cash', ok.cash_count || 0, '#f59e0b');
      html += '</div>';
      // Alert if orders waiting for parcel
      if (awaitingParcel > 0) {
        html += '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:13px">' +
          '⚠️ <strong>' + awaitingParcel + ' commande(s) payée(s) en attente de colis</strong> — ' +
          '<a href="#" onclick="CT.app.navigate(\'createParcel\');return false" style="color:#1d4ed8;text-decoration:underline">Créer les colis →</a></div>';
      }
      // Alert if payment incidents
      if ((ok.payment_failed || 0) > 0) {
        html += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:13px">' +
          '🚨 <strong>' + ok.payment_failed + ' paiement(s) échoué(s)</strong> — vérifier dans Stripe</div>';
      }
      html += '</div>';
    }

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
    
    // Also fetch order-level finance
    var orderData = {};
    try { orderData = await CT.api.v2Orders(); } catch(_) {}
    var ok = orderData.kpis || {};

    var html = '<div class="ct-view-header"><h2>💰 Finances</h2></div>';
    
    // Order-level financial KPIs (the real source of truth)
    html += '<div class="ct-section-block"><h3>📋 Chiffre d\'affaires commandes</h3>';
    html += '<div class="ct-kpi-grid">';
    html += CT.pc.kpiCard('💰', 'CA Total (commandes)', CT.pc.fmt(ok.ca_total_kmf || 0), '#16a34a');
    html += CT.pc.kpiCard('💳', 'CA Stripe', CT.pc.fmt(ok.ca_stripe_kmf || 0), '#6366f1');
    html += CT.pc.kpiCard('💵', 'CA Cash', CT.pc.fmt(ok.ca_cash_kmf || 0), '#f59e0b');
    html += CT.pc.kpiCard('📋', 'Commandes payées', ok.total_paid || ((ok.stripe_count || 0) + (ok.cash_count || 0)), '#3b82f6');
    html += '</div></div>';
    
    // Colis-level financial KPIs
    html += '<div class="ct-section-block"><h3>📦 Suivi financier colis</h3>';
    html += '<div class="ct-kpi-grid">';
    html += CT.pc.kpiCard('💰', 'CA Colis (lié)', CT.pc.fmt(fin.ca_total_kmf), '#16a34a');
    html += CT.pc.kpiCard('📊', 'CA Actif (en cours)', CT.pc.fmt(fin.ca_active_kmf), '#3b82f6');
    html += CT.pc.kpiCard('✅', 'CA Livré', CT.pc.fmt(fin.ca_collected_kmf), '#16a34a');
    html += CT.pc.kpiCard('🧺', 'Panier moyen', CT.pc.fmt(fin.avg_basket_kmf), '#8b5cf6');
    html += CT.pc.kpiCard('👥', 'Clients uniques', fin.nb_clients, '#f59e0b');
    html += CT.pc.kpiCard('📦', 'Colis actifs', pk.active, '#3b82f6');
    html += '</div></div>';

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
