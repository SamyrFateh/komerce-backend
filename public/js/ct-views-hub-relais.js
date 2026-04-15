/* ===================================================================
   Komerce Control Tower — ct-views-hub-relais.js
   Dashboards métier Hub (France/Dubai) & Relais (Comores)
   Chaque vue: ⚙️ Opérationnel / 📋 Prévisionnel / 🚨 Alerting
   =================================================================== */
window.CT = window.CT || {};

// ── Shared Helpers ────────────────────────────────────────────
function _section(icon, title, color, id, content) {
  return '<div class="ct-section-block" style="border-left:4px solid ' + color + '">' +
    '<h3 class="ct-collapsible" data-target="' + id + '" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px" ' +
    'onclick="var c=document.getElementById(\'' + id + '\');c.style.display=c.style.display===\'none\'?\'\':\'none\';this.querySelector(\'.ct-chevron\').textContent=c.style.display===\'none\'?\'▶\':\'▼\'">' +
    icon + ' ' + title + ' <span class="ct-chevron" style="font-size:11px;color:#94a3b8">▼</span></h3>' +
    '<div id="' + id + '" class="ct-section-content" style="margin-top:12px">' + content + '</div></div>';
}

function _actionCard(ref, title, subtitle, details, actionLabel, actionType) {
  return '<div class="ct-order-card">' +
    '<div class="ct-order-header"><strong style="font-family:monospace;color:#1e40af">' + ref + '</strong> ' +
    '<span style="font-size:13px;color:#475569">' + title + '</span></div>' +
    '<div class="ct-order-body">' + subtitle +
    (details ? '<div style="font-size:12px;color:#94a3b8;margin-top:4px">' + details + '</div>' : '') +
    '</div>' +
    '<div class="ct-order-actions" style="margin-top:10px">' +
    '<button class="ct-btn ct-btn-action" data-action="' + actionType + '" data-ref="' + ref + '">' +
    actionLabel + '</button></div></div>';
}

function _infoRow(data, cols) {
  if (!data || !data.length) return '<div class="ct-empty">📭 Aucune donnée</div>';
  var html = '<div style="overflow-x:auto"><table class="ct-table"><thead><tr>';
  cols.forEach(function(c) { html += '<th>' + c.label + '</th>'; });
  html += '</tr></thead><tbody>';
  data.forEach(function(row) {
    html += '<tr>';
    cols.forEach(function(c) { html += '<td>' + c.render(row) + '</td>'; });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function _alertBanner(icon, text, color) {
  return '<div style="background:' + color + '11;border:1px solid ' + color + '44;border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px">' +
    '<span style="font-size:18px">' + icon + '</span>' +
    '<span style="color:' + color + ';font-weight:600;font-size:13px">' + text + '</span></div>';
}

// ═══════════════════════════════════════════════════════════════
// 🏭 HUB — Centre opérationnel (France / Dubai)
// ═══════════════════════════════════════════════════════════════
CT.views.hub = async function(container) {
  container.innerHTML = '<div class="ct-loading">🏭 Chargement Hub...</div>';

  try {
    // Fetch all needed data in parallel
    var results = await Promise.all([
      CT.api.v2PendingCash().catch(function() { return { orders: [] }; }),
      CT.api.v2ReadyForParcel().catch(function() { return { orders: [] }; }),
      CT.api.v2Parcels().catch(function() { return { parcels: [] }; }),
      CT.api.v2Orders().catch(function() { return { orders: [], kpis: {} }; })
    ]);

    var cashOrders   = results[0].orders || [];
    var readyOrders  = results[1].orders || [];
    var allParcels   = results[2].parcels || [];
    var allOrders    = results[3].orders || [];
    var kpis         = results[3].kpis || {};

    // Classify parcels
    var prepParcels    = allParcels.filter(function(p) { return p.status === 'preparation'; });
    var shippedParcels = allParcels.filter(function(p) { return p.status === 'shipped'; });
    var transitParcels = allParcels.filter(function(p) { return p.status === 'in_transit'; });
    var pendingOrders  = allOrders.filter(function(o) { return o.status === 'pending'; });
    var urgentOrders   = allOrders.filter(function(o) {
      return ['confirmed','ordered'].includes(o.status) &&
        o.created_at && (Date.now() - new Date(o.created_at).getTime()) > 48 * 3600000;
    });

    var html = '<div class="ct-view-header">' +
      '<h2>🏭 Hub — Centre opérationnel</h2>' +
      '<p class="ct-subtitle">Paiements · Mise en colis · Expéditions</p>' +
      '<button class="ct-btn ct-btn-ghost" style="margin-top:8px" onclick="CT.views.hub(document.getElementById(\'ct-main\'))">🔄 Rafraîchir</button>' +
      '</div>';

    // ── KPIs ──
    html += '<div class="ct-kpi-grid">';
    html += CT.pc.kpiCard('💰', 'Cash à confirmer', cashOrders.length, cashOrders.length > 0 ? '#f59e0b' : '#22c55e');
    html += CT.pc.kpiCard('📦', 'Prêtes pour colis', readyOrders.length, readyOrders.length > 0 ? '#3b82f6' : '#22c55e');
    html += CT.pc.kpiCard('🔧', 'En préparation', prepParcels.length, '#8b5cf6');
    html += CT.pc.kpiCard('✈️', 'Expédiés', shippedParcels.length + transitParcels.length, '#3b82f6');
    html += CT.pc.kpiCard('⏳', 'Attente paiement', pendingOrders.length, '#94a3b8');
    html += CT.pc.kpiCard('🚨', 'Urgents >48h', urgentOrders.length, urgentOrders.length > 0 ? '#ef4444' : '#22c55e');
    html += '</div>';

    // ══════════════════════════════════════════
    // ⚙️ OPÉRATIONNEL
    // ══════════════════════════════════════════
    var opContent = '';

    // 1. Cash à confirmer
    if (cashOrders.length > 0) {
      opContent += '<h4 style="margin-bottom:8px">💰 Paiements cash à confirmer (' + cashOrders.length + ')</h4>';
      opContent += '<div class="ct-card-grid">';
      cashOrders.forEach(function(o) {
        opContent += _actionCard(
          o.reference,
          '👤 ' + (o.customer_name || 'Client'),
          '<div>🏝️ ' + (o.relais_island || '—') + (o.relais_name ? ' — ' + o.relais_name : '') + '</div>' +
          '<div>🛒 ' + (o.nb_items || 0) + ' articles · ' + CT.pc.fmt(o.total_kmf) + '</div>' +
          '<div>📞 ' + (o.customer_phone || '—') + '</div>',
          '⏱️ ' + CT.pc.ago(o.created_at),
          '💰 Confirmer paiement',
          'hub-confirm-cash'
        );
      });
      opContent += '</div>';
    }

    // 2. Prêtes pour colis
    if (readyOrders.length > 0) {
      opContent += '<h4 style="margin:16px 0 8px">📦 Commandes prêtes pour colis (' + readyOrders.length + ')</h4>';
      opContent += '<div class="ct-card-grid">';
      readyOrders.forEach(function(o) {
        opContent += _actionCard(
          o.reference,
          '👤 ' + (o.customer_name || 'Client'),
          '<div>🏝️ ' + (o.relais_island || '—') + (o.relais_name ? ' — ' + o.relais_name : '') + '</div>' +
          '<div>🛒 ' + (o.nb_items || 0) + ' articles · ' + CT.pc.fmt(o.total_kmf) + '</div>' +
          '<div>' + CT.pc.badge(o.status) + ' · ' + (o.payment_mode === 'stripe_eur' ? '💳 Stripe' : '💰 Cash') + '</div>',
          null,
          '📦 Créer colis',
          'hub-create-parcel'
        );
      });
      opContent += '</div>';
    }

    // 3. Colis à expédier
    if (prepParcels.length > 0) {
      opContent += '<h4 style="margin:16px 0 8px">✈️ Colis à expédier (' + prepParcels.length + ')</h4>';
      opContent += '<div class="ct-card-grid">';
      prepParcels.forEach(function(p) {
        opContent += _actionCard(
          p.reference,
          '👤 ' + (p.recipient_name || 'Client'),
          '<div>🏝️ ' + (p.destination_island || p.relais_island || '—') +
            (p.relais_name ? ' — ' + p.relais_name : '') + '</div>' +
          '<div>📋 ' + (p.main_order_ref || '—') + ' · ' + (p.nb_items || 0) + ' articles</div>' +
          '<div>💰 ' + CT.pc.fmt(p.total_kmf) + '</div>',
          null,
          '✈️ Expédier',
          'hub-ship'
        );
      });
      opContent += '</div>';
    }

    if (cashOrders.length === 0 && readyOrders.length === 0 && prepParcels.length === 0) {
      opContent += '<div class="ct-empty" style="color:#22c55e;padding:20px">✅ Rien à traiter — tout est en ordre !</div>';
    }

    html += _section('⚙️', 'Opérationnel', '#3b82f6', 'hub-op', opContent);

    // ══════════════════════════════════════════
    // 📋 PRÉVISIONNEL
    // ══════════════════════════════════════════
    var prevContent = '';

    // Pending orders (waiting for payment)
    if (pendingOrders.length > 0) {
      prevContent += '<h4 style="margin-bottom:8px">⏳ En attente de paiement (' + pendingOrders.length + ')</h4>';
      prevContent += _infoRow(pendingOrders, [
        { label: 'Réf', render: function(o) { return '<strong style="font-family:monospace">' + o.reference + '</strong>'; } },
        { label: 'Client', render: function(o) { return o.customer_name || '—'; } },
        { label: 'Mode', render: function(o) { return o.payment_mode === 'stripe_eur' ? '💳 Stripe' : '💰 Cash'; } },
        { label: 'Montant', render: function(o) { return CT.pc.fmt(o.total_kmf); } },
        { label: 'Âge', render: function(o) { return CT.pc.ago(o.created_at); } }
      ]);
    }

    // Shipped / in transit parcels
    var recentShipped = shippedParcels.concat(transitParcels);
    if (recentShipped.length > 0) {
      prevContent += '<h4 style="margin:16px 0 8px">🚢 Colis expédiés / en transit (' + recentShipped.length + ')</h4>';
      prevContent += _infoRow(recentShipped, [
        { label: 'Colis', render: function(p) { return '<strong>' + p.reference + '</strong>'; } },
        { label: 'Client', render: function(p) { return p.recipient_name || '—'; } },
        { label: 'Destination', render: function(p) { return (p.destination_island || '—'); } },
        { label: 'Statut', render: function(p) { return CT.pc.badge(p.status); } },
        { label: 'Depuis', render: function(p) { return CT.pc.ago(p.created_at); } }
      ]);
    }

    if (pendingOrders.length === 0 && recentShipped.length === 0) {
      prevContent += '<div class="ct-empty">📭 Aucune donnée prévisionnelle</div>';
    }

    html += _section('📋', 'Prévisionnel', '#8b5cf6', 'hub-prev', prevContent);

    // ══════════════════════════════════════════
    // 🚨 ALERTING
    // ══════════════════════════════════════════
    var alertContent = '';
    var hasAlerts = false;

    if (urgentOrders.length > 0) {
      hasAlerts = true;
      alertContent += '<h4 style="margin-bottom:8px;color:#ef4444">⏰ Commandes bloquées >48h (' + urgentOrders.length + ')</h4>';
      alertContent += _infoRow(urgentOrders, [
        { label: 'Réf', render: function(o) { return '<strong style="color:#ef4444">' + o.reference + '</strong>'; } },
        { label: 'Client', render: function(o) { return o.customer_name || '—'; } },
        { label: 'Statut', render: function(o) { return CT.pc.badge(o.status); } },
        { label: 'Montant', render: function(o) { return CT.pc.fmt(o.total_kmf); } },
        { label: 'Âge', render: function(o) { return '<span style="color:#ef4444;font-weight:700">' + CT.pc.ago(o.created_at) + '</span>'; } }
      ]);
    }

    if ((kpis.payment_failed || 0) > 0) {
      hasAlerts = true;
      alertContent += _alertBanner('🔴', kpis.payment_failed + ' paiement(s) échoué(s) — vérifier Stripe', '#ef4444');
    }

    if (!hasAlerts) {
      alertContent += '<div class="ct-empty" style="color:#22c55e">✅ Aucune alerte active</div>';
    }

    html += _section('🚨', 'Alerting', '#ef4444', 'hub-alert', alertContent);

    container.innerHTML = html;

    // ── Wire action buttons ──
    _wireHubActions(container);

  } catch(err) {
    container.innerHTML = '<div class="ct-error">❌ Erreur Hub: ' + err.message + '</div>';
  }
};

// ── Hub Action Handlers ──────────────────────────────────────
function _wireHubActions(container) {
  // Confirm cash
  container.querySelectorAll('[data-action="hub-confirm-cash"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Confirmer le paiement cash pour ' + ref + ' ?')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        var r = await CT.api.v2ConfirmCash(ref);
        _toast('✅ ' + (r.message || 'Paiement confirmé'));
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '💰 Confirmer paiement'; }
    });
  });

  // Create parcel
  container.querySelectorAll('[data-action="hub-create-parcel"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Créer un colis pour ' + ref + ' ?')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        var r = await CT.api.v2CreateParcel(ref);
        _toast('✅ ' + (r.message || 'Colis créé') + (r.parcel ? ' — ' + r.parcel.reference : ''));
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '📦 Créer colis'; }
    });
  });

  // Ship parcel
  container.querySelectorAll('[data-action="hub-ship"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Expédier le colis ' + ref + ' ?')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        var r = await CT.api.v2Scan(ref, 'shipped', 'Expédié depuis Hub — Control Tower');
        _toast('✅ ' + ref + ' expédié ✈️');
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '✈️ Expédier'; }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 📦 RELAIS — Point de retrait (Comores)
// ═══════════════════════════════════════════════════════════════
CT.views.relais = async function(container) {
  container.innerHTML = '<div class="ct-loading">📦 Chargement Relais...</div>';

  try {
    var results = await Promise.all([
      CT.api.v2Parcels().catch(function() { return { parcels: [] }; }),
      CT.api.v2Orders().catch(function() { return { orders: [], kpis: {} }; })
    ]);

    var allParcels = results[0].parcels || [];
    var kpis = results[1].kpis || {};

    // Classify parcels for relais
    var transitParcels    = allParcels.filter(function(p) { return p.status === 'in_transit'; });
    var availableParcels  = allParcels.filter(function(p) { return p.status === 'available'; });
    var shippedParcels    = allParcels.filter(function(p) { return p.status === 'shipped'; });
    var collectedParcels  = allParcels.filter(function(p) { return p.status === 'collected'; });

    // Aging alerts
    var uncollected72h = availableParcels.filter(function(p) {
      return p.created_at && (Date.now() - new Date(p.created_at).getTime()) > 72 * 3600000;
    });
    var lateTransit = transitParcels.filter(function(p) {
      return p.created_at && (Date.now() - new Date(p.created_at).getTime()) > 7 * 24 * 3600000;
    });

    var html = '<div class="ct-view-header">' +
      '<h2>📦 Relais — Point de retrait</h2>' +
      '<p class="ct-subtitle">Réception colis · Distribution clients</p>' +
      '<button class="ct-btn ct-btn-ghost" style="margin-top:8px" onclick="CT.views.relais(document.getElementById(\'ct-main\'))">🔄 Rafraîchir</button>' +
      '</div>';

    // ── KPIs ──
    html += '<div class="ct-kpi-grid">';
    html += CT.pc.kpiCard('🚢', 'En transit', transitParcels.length, transitParcels.length > 0 ? '#8b5cf6' : '#94a3b8');
    html += CT.pc.kpiCard('✈️', 'Expédiés (en route)', shippedParcels.length, '#3b82f6');
    html += CT.pc.kpiCard('📍', 'Disponibles', availableParcels.length, availableParcels.length > 0 ? '#22c55e' : '#94a3b8');
    html += CT.pc.kpiCard('✅', 'Collectés', collectedParcels.length, '#16a34a');
    html += CT.pc.kpiCard('⏰', 'Non collectés >72h', uncollected72h.length, uncollected72h.length > 0 ? '#ef4444' : '#22c55e');
    html += CT.pc.kpiCard('🚨', 'Transit tardif >7j', lateTransit.length, lateTransit.length > 0 ? '#ef4444' : '#22c55e');
    html += '</div>';

    // ══════════════════════════════════════════
    // ⚙️ OPÉRATIONNEL
    // ══════════════════════════════════════════
    var opContent = '';

    // 1. Colis arrivés (in_transit → available)
    if (transitParcels.length > 0) {
      opContent += '<h4 style="margin-bottom:8px">🚢 Colis arrivés à réceptionner (' + transitParcels.length + ')</h4>';
      opContent += '<div class="ct-card-grid">';
      transitParcels.forEach(function(p) {
        var orderList = (p.main_order_ref ? '📋 ' + p.main_order_ref : '') +
          (p.nb_orders > 1 ? ' +' + (p.nb_orders - 1) + ' cmd' : '');
        opContent += _actionCard(
          p.reference,
          '👤 ' + (p.recipient_name || 'Client'),
          '<div>🏝️ ' + (p.destination_island || '—') + (p.relais_name ? ' — ' + p.relais_name : '') + '</div>' +
          '<div>' + orderList + ' · ' + (p.nb_items || 0) + ' articles</div>' +
          '<div>💰 ' + CT.pc.fmt(p.total_kmf) + '</div>',
          '✈️ Expédié ' + CT.pc.ago(p.created_at),
          '📍 Marquer arrivé',
          'relais-arrived'
        );
      });
      opContent += '</div>';
    }

    // 2. Colis disponibles → Distribuer
    if (availableParcels.length > 0) {
      opContent += '<h4 style="margin:16px 0 8px">📍 Colis à distribuer (' + availableParcels.length + ')</h4>';
      opContent += '<div class="ct-card-grid">';
      availableParcels.forEach(function(p) {
        opContent += _actionCard(
          p.reference,
          '👤 ' + (p.recipient_name || 'Client'),
          '<div>🏝️ ' + (p.destination_island || '—') + (p.relais_name ? ' — ' + p.relais_name : '') + '</div>' +
          (p.pickup_code ? '<div>🔑 Code retrait: <strong style="font-size:16px;color:#16a34a">' + p.pickup_code + '</strong></div>' : '') +
          '<div>💰 ' + CT.pc.fmt(p.total_kmf) + ' · ' + (p.nb_items || 0) + ' articles</div>',
          '📍 Disponible depuis ' + CT.pc.ago(p.updated_at || p.created_at),
          '✅ Remis au client',
          'relais-collected'
        );
      });
      opContent += '</div>';
    }

    if (transitParcels.length === 0 && availableParcels.length === 0) {
      opContent += '<div class="ct-empty" style="color:#22c55e;padding:20px">✅ Aucune action requise</div>';
    }

    html += _section('⚙️', 'Opérationnel', '#22c55e', 'relais-op', opContent);

    // ══════════════════════════════════════════
    // 📋 PRÉVISIONNEL
    // ══════════════════════════════════════════
    var prevContent = '';

    // Shipped parcels (on their way from hub)
    if (shippedParcels.length > 0) {
      prevContent += '<h4 style="margin-bottom:8px">✈️ En route depuis le Hub (' + shippedParcels.length + ')</h4>';
      prevContent += _infoRow(shippedParcels, [
        { label: 'Colis', render: function(p) { return '<strong>' + p.reference + '</strong>'; } },
        { label: 'Client', render: function(p) { return p.recipient_name || '—'; } },
        { label: 'Destination', render: function(p) { return p.destination_island || '—'; } },
        { label: 'Articles', render: function(p) { return (p.nb_items || 0) + ' art.'; } },
        { label: 'Expédié', render: function(p) { return CT.pc.ago(p.created_at); } }
      ]);
    }

    // Recently collected
    var recentCollected = collectedParcels.slice(0, 10);
    if (recentCollected.length > 0) {
      prevContent += '<h4 style="margin:16px 0 8px">✅ Collectés récemment (' + collectedParcels.length + ')</h4>';
      prevContent += _infoRow(recentCollected, [
        { label: 'Colis', render: function(p) { return '<strong>' + p.reference + '</strong>'; } },
        { label: 'Client', render: function(p) { return p.recipient_name || '—'; } },
        { label: 'Montant', render: function(p) { return CT.pc.fmt(p.total_kmf); } },
        { label: 'Collecté', render: function(p) { return CT.pc.ago(p.updated_at || p.created_at); } }
      ]);
    }

    if (shippedParcels.length === 0 && recentCollected.length === 0) {
      prevContent += '<div class="ct-empty">📭 Aucun colis en prévision</div>';
    }

    html += _section('📋', 'Prévisionnel', '#8b5cf6', 'relais-prev', prevContent);

    // ══════════════════════════════════════════
    // 🚨 ALERTING
    // ══════════════════════════════════════════
    var alertContent = '';
    var hasAlerts = false;

    if (uncollected72h.length > 0) {
      hasAlerts = true;
      alertContent += '<h4 style="margin-bottom:8px;color:#ef4444">⏰ Non collectés depuis >72h (' + uncollected72h.length + ')</h4>';
      alertContent += _infoRow(uncollected72h, [
        { label: 'Colis', render: function(p) { return '<strong style="color:#ef4444">' + p.reference + '</strong>'; } },
        { label: 'Client', render: function(p) { return p.recipient_name || '—'; } },
        { label: 'Relais', render: function(p) { return p.relais_name || '—'; } },
        { label: 'Code retrait', render: function(p) { return p.pickup_code || '—'; } },
        { label: 'Âge', render: function(p) { return '<span style="color:#ef4444;font-weight:700">' + CT.pc.ago(p.created_at) + '</span>'; } }
      ]);
    }

    if (lateTransit.length > 0) {
      hasAlerts = true;
      alertContent += _alertBanner('🚢', lateTransit.length + ' colis en transit depuis >7 jours', '#f59e0b');
    }

    if (!hasAlerts) {
      alertContent += '<div class="ct-empty" style="color:#22c55e">✅ Aucune alerte active</div>';
    }

    html += _section('🚨', 'Alerting', '#ef4444', 'relais-alert', alertContent);

    container.innerHTML = html;

    // ── Wire action buttons ──
    _wireRelaisActions(container);

  } catch(err) {
    container.innerHTML = '<div class="ct-error">❌ Erreur Relais: ' + err.message + '</div>';
  }
};

// ── Relais Action Handlers ───────────────────────────────────
function _wireRelaisActions(container) {
  // Mark arrived (in_transit → available)
  container.querySelectorAll('[data-action="relais-arrived"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Confirmer l\'arrivée du colis ' + ref + ' au relais ?')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        var r = await CT.api.v2Scan(ref, 'arrived', 'Arrivé au relais — Control Tower');
        _toast('✅ ' + ref + ' disponible au relais 📍');
        CT.views.relais(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '📍 Marquer arrivé'; }
    });
  });

  // Mark collected (available → collected)
  container.querySelectorAll('[data-action="relais-collected"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Confirmer la remise du colis ' + ref + ' au client ?')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        var r = await CT.api.v2Scan(ref, 'collected', 'Remis au client — Control Tower');
        _toast('✅ ' + ref + ' collecté par le client ✔️');
        CT.views.relais(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '✅ Remis au client'; }
    });
  });
}

// ── Toast notification ───────────────────────────────────────
function _toast(msg) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:20px;right:20px;background:#065f46;color:white;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2);animation:slideIn 0.3s ease';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2500);
  setTimeout(function() { el.remove(); }, 3000);
}
