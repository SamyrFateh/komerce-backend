/* ===================================================================
   Komerce Control Tower — ct-views-hub-relais.js
   Dashboards métier Hub (France/Dubai) & Relais (Comores)
   
   Hub pipeline:  🛒 Sourcing → 📦 Colis → ✈️ Expédition
   Relais pipeline: 💰 Cash → 🚢 Réception → 📍 Distribution
   
   Chaque vue: ⚙️ Opérationnel / 📋 Prévisionnel / 🚨 Alerting
   =================================================================== */
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

// ── Helpers ──────────────────────────────────────────────────

function _section(icon, title, color, id, content, collapsed) {
  return '<div class="ct-section" style="margin:16px 0;border-left:4px solid ' + color + ';border-radius:8px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.06)">' +
    '<div class="ct-section-head" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;cursor:pointer" onclick="var b=document.getElementById(\'' + id + '\');b.style.display=b.style.display===\'none\'?\'block\':\'none\'">' +
    '<h3 style="margin:0;font-size:16px;color:' + color + '">' + icon + ' ' + title + '</h3>' +
    '<span style="color:#94a3b8">▼</span></div>' +
    '<div id="' + id + '" style="padding:0 16px 16px;' + (collapsed ? 'display:none' : '') + '">' + content + '</div></div>';
}

function _actionCard(ref, title, details, timing, btnLabel, btnAction) {
  return '<div class="ct-action-card" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;min-width:240px;flex:1;max-width:360px">' +
    '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">' +
    '<strong style="color:#1e40af;font-size:14px">' + ref + '</strong>' +
    (timing ? '<span style="font-size:11px;color:#94a3b8">' + timing + '</span>' : '') +
    '</div>' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:4px">' + title + '</div>' +
    '<div style="font-size:12px;color:#64748b;line-height:1.6;margin-bottom:10px">' + details + '</div>' +
    (btnLabel ? '<button data-action="' + btnAction + '" data-ref="' + ref + '" style="width:100%;padding:8px;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;' +
    (btnAction.includes('alert') ? 'background:#fef2f2;color:#dc2626' :
     btnAction.includes('ship') ? 'background:#dbeafe;color:#1d4ed8' :
     btnAction.includes('parcel') || btnAction.includes('colis') ? 'background:#f0fdf4;color:#16a34a' :
     btnAction.includes('cash') || btnAction.includes('confirm') ? 'background:#fef3c7;color:#b45309' :
     btnAction.includes('arrived') ? 'background:#ede9fe;color:#7c3aed' :
     btnAction.includes('collected') ? 'background:#d1fae5;color:#065f46' :
     'background:#f1f5f9;color:#475569') + '">' + btnLabel + '</button>' : '') +
    '</div>';
}

function _infoTable(items, columns) {
  if (!items || items.length === 0) return '<div style="color:#94a3b8;padding:8px;font-size:13px">Aucune donnée</div>';
  var h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
  h += '<thead><tr style="background:#f8fafc">';
  columns.forEach(function(c) { h += '<th style="padding:8px 10px;text-align:left;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">' + c.label + '</th>'; });
  h += '</tr></thead><tbody>';
  items.forEach(function(item, i) {
    h += '<tr style="border-bottom:1px solid #f1f5f9;' + (i % 2 ? 'background:#fafbfd' : '') + '">';
    columns.forEach(function(c) { h += '<td style="padding:7px 10px">' + c.render(item) + '</td>'; });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function _pipelineIndicator(steps) {
  var h = '<div style="display:flex;align-items:center;gap:0;margin:16px 0 20px;flex-wrap:wrap">';
  steps.forEach(function(s, i) {
    h += '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:20px;font-size:13px;font-weight:600;' +
      'background:' + (s.active ? s.color + '15' : '#f1f5f9') + ';color:' + (s.active ? s.color : '#94a3b8') + ';' +
      'border:1.5px solid ' + (s.active ? s.color + '40' : '#e2e8f0') + '">' +
      s.icon + ' ' + s.label + (typeof s.count !== 'undefined' ? ' <span style="background:' + (s.active ? s.color : '#cbd5e1') + ';color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">' + s.count + '</span>' : '') +
      '</div>';
    if (i < steps.length - 1) h += '<div style="color:#cbd5e1;font-size:18px;margin:0 4px">→</div>';
  });
  h += '</div>';
  return h;
}

function _emptyState(msg) {
  return '<div style="color:#22c55e;padding:20px;text-align:center;font-size:14px">✅ ' + msg + '</div>';
}

function _alertCard(icon, title, items, color) {
  if (!items || items.length === 0) return '';
  var h = '<div style="background:' + color + '08;border:1px solid ' + color + '30;border-radius:10px;padding:14px;margin-bottom:12px">';
  h += '<h4 style="margin:0 0 8px;color:' + color + ';font-size:14px">' + icon + ' ' + title + ' (' + items.length + ')</h4>';
  h += '<div style="display:flex;flex-direction:column;gap:6px">';
  items.forEach(function(item) {
    h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:white;border-radius:6px;font-size:12px">' +
      '<span><strong>' + (item.reference || item.ref || '—') + '</strong> · ' + (item.label || '') + '</span>' +
      '<span style="color:' + color + ';font-weight:600">' + (item.badge || '') + '</span></div>';
  });
  h += '</div></div>';
  return h;
}


// ═══════════════════════════════════════════════════════════════
// 🏭 HUB — Centre logistique (France / Dubai)
// Pipeline: 🛒 Sourcing → 📦 Colis → ✈️ Expédition
// ═══════════════════════════════════════════════════════════════
CT.views.hub = async function(container) {
  container.innerHTML = '<div class="ct-loading" style="text-align:center;padding:40px;color:#64748b">🏭 Chargement Hub...</div>';

  try {
    var results = await Promise.all([
      CT.api.v2Orders().catch(function() { return { orders: [], kpis: {} }; }),
      CT.api.v2Parcels().catch(function() { return { parcels: [] }; })
    ]);

    var allOrders = results[0].orders || [];
    var allParcels = results[1].parcels || [];

    // ── Classify orders ──
    var pendingOrders   = allOrders.filter(function(o) { return o.status === 'pending'; });
    var confirmedOrders = allOrders.filter(function(o) { return o.status === 'confirmed'; });
    var orderedOrders   = allOrders.filter(function(o) { return o.status === 'ordered'; });
    var prepOrders      = allOrders.filter(function(o) { return o.status === 'preparation'; });

    // ── Classify parcels ──
    var prepParcels     = allParcels.filter(function(p) { return p.status === 'preparation'; });
    var shippedParcels  = allParcels.filter(function(p) { return p.status === 'shipped'; });
    var transitParcels  = allParcels.filter(function(p) { return p.status === 'in_transit'; });

    // ── Orders needing sourcing (ordered, no parcel yet) ──
    var parcelOrderRefs = new Set();
    allParcels.forEach(function(p) { if (p.main_order_ref) parcelOrderRefs.add(p.main_order_ref); });
    var toSource = orderedOrders.filter(function(o) { return !parcelOrderRefs.has(o.reference); });
    var readyForParcel = orderedOrders.filter(function(o) { return !parcelOrderRefs.has(o.reference); });

    // ── Aggregate products to source ──
    var productMap = {};
    toSource.forEach(function(o) {
      var items = [];
      try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch(e) {}
      items.forEach(function(item) {
        var key = item.product_name || item.name || 'Produit inconnu';
        if (!productMap[key]) productMap[key] = { name: key, qty: 0, orders: [], img: item.image_url || '' };
        productMap[key].qty += (item.quantity || 1);
        productMap[key].orders.push(o.reference);
      });
    });
    var productsToSource = Object.values(productMap).sort(function(a, b) { return b.qty - a.qty; });

    // ── Alerting data ──
    var now = Date.now();
    var stuckOrders48h = orderedOrders.filter(function(o) {
      return o.created_at && (now - new Date(o.created_at).getTime()) > 48 * 3600000;
    });
    var stuckOrders7d = orderedOrders.filter(function(o) {
      return o.created_at && (now - new Date(o.created_at).getTime()) > 7 * 24 * 3600000;
    });
    var pendingExpired = pendingOrders.filter(function(o) {
      return o.created_at && (now - new Date(o.created_at).getTime()) > 36 * 3600000;
    });

    // ═══ BUILD HTML ═══
    var html = '<div class="ct-view-header" style="padding:16px 0">' +
      '<h2 style="margin:0 0 4px">🏭 Hub — Centre logistique</h2>' +
      '<p style="margin:0;color:#64748b;font-size:14px">Sourcing · Mise en colis · Expéditions</p>' +
      '<button class="ct-btn ct-btn-ghost" style="margin-top:8px;padding:6px 14px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;background:white;font-size:13px" onclick="CT.views.hub(document.getElementById(\'ct-main\'))">🔄 Rafraîchir</button>' +
      '</div>';

    // ── Pipeline indicator ──
    html += _pipelineIndicator([
      { icon: '🛒', label: 'Sourcing', count: toSource.length, color: '#f59e0b', active: toSource.length > 0 },
      { icon: '📦', label: 'Colis', count: prepParcels.length, color: '#3b82f6', active: prepParcels.length > 0 },
      { icon: '✈️', label: 'Expédition', count: prepParcels.length, color: '#8b5cf6', active: prepParcels.length > 0 },
      { icon: '✅', label: 'Expédiés', count: shippedParcels.length + transitParcels.length, color: '#22c55e', active: shippedParcels.length + transitParcels.length > 0 }
    ]);

    // ── KPIs ──
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">';
    html += CT.pc.kpiCard('🛒', 'À sourcer', toSource.length, toSource.length > 0 ? '#f59e0b' : '#22c55e');
    html += CT.pc.kpiCard('📦', 'Colis à créer', readyForParcel.length, readyForParcel.length > 0 ? '#3b82f6' : '#22c55e');
    html += CT.pc.kpiCard('✈️', 'À expédier', prepParcels.length, prepParcels.length > 0 ? '#8b5cf6' : '#22c55e');
    html += CT.pc.kpiCard('🚀', 'En route', shippedParcels.length + transitParcels.length, '#3b82f6');
    html += CT.pc.kpiCard('⏳', 'Attente paiement', pendingOrders.length, '#94a3b8');
    html += CT.pc.kpiCard('🚨', 'Alertes', stuckOrders48h.length + pendingExpired.length, (stuckOrders48h.length + pendingExpired.length) > 0 ? '#ef4444' : '#22c55e');
    html += '</div>';

    // ══════════════════════════════════════════
    // ⚙️ OPÉRATIONNEL — Pipeline Sourcing → Colis → Expédition
    // ══════════════════════════════════════════
    var opContent = '';

    // ── ÉTAPE ① 🛒 COMMANDER AU SOURCING ──
    opContent += '<div style="margin-bottom:20px">';
    opContent += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #f59e0b20">';
    opContent += '<span style="background:#fef3c7;color:#b45309;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ÉTAPE 1</span>';
    opContent += '<h4 style="margin:0;color:#b45309">🛒 Commander au sourcing (' + toSource.length + ' commandes · ' + productsToSource.length + ' produits)</h4>';
    opContent += '</div>';

    if (productsToSource.length > 0) {
      // Aggregate product view
      opContent += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
      opContent += '<thead><tr style="background:#fffbeb"><th style="padding:8px 10px;text-align:left;color:#92400e">Produit</th>' +
        '<th style="padding:8px 10px;text-align:center;color:#92400e">Qté totale</th>' +
        '<th style="padding:8px 10px;text-align:left;color:#92400e">Commandes</th></tr></thead><tbody>';
      productsToSource.forEach(function(p, i) {
        opContent += '<tr style="border-bottom:1px solid #fef3c7;' + (i % 2 ? 'background:#fffef5' : '') + '">' +
          '<td style="padding:8px 10px;font-weight:600">' +
          (p.img ? '<img src="' + p.img + '" style="width:28px;height:28px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:6px">' : '') +
          p.name + '</td>' +
          '<td style="padding:8px 10px;text-align:center"><span style="background:#fbbf24;color:white;border-radius:10px;padding:2px 10px;font-weight:700">' + p.qty + '</span></td>' +
          '<td style="padding:8px 10px;color:#64748b;font-size:11px">' + p.orders.join(', ') + '</td></tr>';
      });
      opContent += '</tbody></table></div>';
      opContent += '<p style="margin:10px 0 0;font-size:12px;color:#94a3b8;font-style:italic">💡 Intégration sourcing (AliExpress, 1688, fournisseurs locaux) — à venir</p>';
    } else {
      opContent += '<div style="color:#22c55e;padding:12px;text-align:center;font-size:13px">✅ Aucun article à sourcer</div>';
    }
    opContent += '</div>';

    // ── ÉTAPE ② 📦 MISE EN COLIS ──
    opContent += '<div style="margin-bottom:20px">';
    opContent += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #3b82f620">';
    opContent += '<span style="background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ÉTAPE 2</span>';
    opContent += '<h4 style="margin:0;color:#1d4ed8">📦 Mise en colis (' + readyForParcel.length + ')</h4>';
    opContent += '</div>';

    if (readyForParcel.length > 0) {
      opContent += '<div class="ct-card-grid" style="display:flex;flex-wrap:wrap;gap:12px">';
      readyForParcel.forEach(function(o) {
        var items = [];
        try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch(e) {}
        var itemsText = items.map(function(it) { return (it.quantity || 1) + '× ' + (it.product_name || it.name || '?'); }).join(', ');

        opContent += _actionCard(
          o.reference,
          '👤 ' + (o.customer_name || 'Client'),
          '<div>🏝️ ' + (o.relais_island || '—') + (o.relais_name ? ' — ' + o.relais_name : '') + '</div>' +
          '<div>🛒 ' + (items.length || 0) + ' articles · ' + CT.pc.fmt(o.total_kmf) + '</div>' +
          (itemsText ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + itemsText + '</div>' : '') +
          '<div>' + CT.pc.badge(o.status) + ' · ' + (o.payment_mode === 'stripe_eur' ? '💳 Stripe' : '💰 Cash') + '</div>',
          '⏱️ ' + CT.pc.ago(o.created_at),
          '📦 Créer colis',
          'hub-create-parcel'
        );
      });
      opContent += '</div>';
    } else {
      opContent += '<div style="color:#22c55e;padding:12px;text-align:center;font-size:13px">✅ Toutes les commandes ont un colis</div>';
    }
    opContent += '</div>';

    // ── ÉTAPE ③ ✈️ EXPÉDIER ──
    opContent += '<div>';
    opContent += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #8b5cf620">';
    opContent += '<span style="background:#ede9fe;color:#7c3aed;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ÉTAPE 3</span>';
    opContent += '<h4 style="margin:0;color:#7c3aed">✈️ Expédier aux transitaires (' + prepParcels.length + ')</h4>';
    opContent += '</div>';

    if (prepParcels.length > 0) {
      opContent += '<div class="ct-card-grid" style="display:flex;flex-wrap:wrap;gap:12px">';
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
    } else {
      opContent += '<div style="color:#22c55e;padding:12px;text-align:center;font-size:13px">✅ Aucun colis à expédier</div>';
    }
    opContent += '</div>';

    html += _section('⚙️', 'Opérationnel — Pipeline logistique', '#3b82f6', 'hub-op', opContent);

    // ══════════════════════════════════════════
    // 📋 PRÉVISIONNEL — Pipeline d'approvisionnement
    // ══════════════════════════════════════════
    var prevContent = '';

    // 1. Nouvelles commandes (boutique → attente paiement)
    prevContent += '<h4 style="margin:0 0 10px;color:#6366f1">🛍️ Nouvelles commandes en attente de paiement (' + pendingOrders.length + ')</h4>';
    if (pendingOrders.length > 0) {
      prevContent += _infoTable(pendingOrders, [
        { label: 'Réf', render: function(o) { return '<strong>' + o.reference + '</strong>'; } },
        { label: 'Client', render: function(o) { return o.customer_name || '—'; } },
        { label: 'Mode', render: function(o) { return o.payment_mode === 'stripe_eur' ? '💳 Stripe' : '💰 Cash'; } },
        { label: 'Total', render: function(o) { return CT.pc.fmt(o.total_kmf); } },
        { label: 'Depuis', render: function(o) { return CT.pc.ago(o.created_at); } }
      ]);
    } else {
      prevContent += '<div style="color:#94a3b8;font-size:13px;padding:8px">Aucune commande en attente</div>';
    }

    // 2. Articles en cours de livraison du sourcing
    prevContent += '<h4 style="margin:16px 0 10px;color:#6366f1">📬 Articles en attente du sourcing (' + orderedOrders.length + ' commandes)</h4>';
    if (orderedOrders.length > 0) {
      prevContent += _infoTable(orderedOrders, [
        { label: 'Réf', render: function(o) { return '<strong>' + o.reference + '</strong>'; } },
        { label: 'Client', render: function(o) { return o.customer_name || '—'; } },
        { label: 'Destination', render: function(o) { return '🏝️ ' + (o.relais_island || '—'); } },
        { label: 'Articles', render: function(o) { return (o.nb_items || '—'); } },
        { label: 'Total', render: function(o) { return CT.pc.fmt(o.total_kmf); } },
        { label: 'Commandé', render: function(o) { return CT.pc.ago(o.created_at); } }
      ]);
    } else {
      prevContent += '<div style="color:#94a3b8;font-size:13px;padding:8px">Aucun article en attente</div>';
    }

    // 3. Colis expédiés en route
    var enRoute = shippedParcels.concat(transitParcels);
    prevContent += '<h4 style="margin:16px 0 10px;color:#6366f1">🚀 Colis en route (' + enRoute.length + ')</h4>';
    if (enRoute.length > 0) {
      prevContent += _infoTable(enRoute, [
        { label: 'Colis', render: function(p) { return '<strong>' + p.reference + '</strong>'; } },
        { label: 'Statut', render: function(p) { return CT.pc.badge(p.status); } },
        { label: 'Destination', render: function(p) { return '🏝️ ' + (p.destination_island || '—'); } },
        { label: 'Articles', render: function(p) { return p.nb_items || '—'; } },
        { label: 'Expédié', render: function(p) { return CT.pc.ago(p.shipped_at || p.created_at); } }
      ]);
    } else {
      prevContent += '<div style="color:#94a3b8;font-size:13px;padding:8px">Aucun colis en transit</div>';
    }

    html += _section('📋', 'Prévisionnel — Approvisionnement', '#8b5cf6', 'hub-prev', prevContent);

    // ══════════════════════════════════════════
    // 🚨 ALERTING — Problèmes à traiter
    // ══════════════════════════════════════════
    var alertContent = '';

    // Pending expiré (>36h sans paiement)
    alertContent += _alertCard('💸', 'Paiements expirés (>36h)', pendingExpired.map(function(o) {
      return { reference: o.reference, label: (o.customer_name || 'Client') + ' · ' + (o.payment_mode === 'stripe_eur' ? '💳' : '💰') + ' ' + CT.pc.fmt(o.total_kmf), badge: CT.pc.ago(o.created_at) };
    }), '#f59e0b');

    // Commandes bloquées >48h en ordered
    alertContent += _alertCard('⏰', 'Sourcing en retard (>48h)', stuckOrders48h.map(function(o) {
      return { reference: o.reference, label: (o.customer_name || 'Client') + ' · ' + (o.nb_items || '?') + ' articles', badge: CT.pc.ago(o.created_at) };
    }), '#ef4444');

    // Commandes bloquées >7j (critique)
    alertContent += _alertCard('🔴', 'Commandes critiques (>7 jours)', stuckOrders7d.map(function(o) {
      return { reference: o.reference, label: (o.customer_name || 'Client') + ' · URGENT', badge: CT.pc.ago(o.created_at) };
    }), '#dc2626');

    // Placeholder: future sourcing alerts
    if (!alertContent) {
      alertContent = _emptyState('Aucune alerte — tout va bien !');
    } else {
      alertContent += '<div style="margin-top:12px;padding:10px;background:#fefce8;border-radius:8px;font-size:12px;color:#92400e">' +
        '💡 <strong>À venir :</strong> Alertes sourcing (échecs fournisseurs, produits défectueux, retours) — intégration API sourcing en roadmap</div>';
    }

    html += _section('🚨', 'Alerting', '#ef4444', 'hub-alert', alertContent, true);

    container.innerHTML = html;
    _wireHubActions(container);

  } catch(err) {
    container.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">❌ Erreur Hub: ' + err.message + '</div>';
  }
};

// ── Hub Action Handlers ──────────────────────────────────────
function _wireHubActions(container) {
  // Create parcel
  container.querySelectorAll('[data-action="hub-create-parcel"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Créer un colis pour la commande ' + ref + ' ?')) return;
      btn.disabled = true; btn.textContent = '⏳ Création...';
      try {
        var r = await CT.api.v2CreateParcel(ref);
        _toast('✅ Colis créé ' + (r.parcel ? r.parcel.reference : '') + ' 📦');
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '📦 Créer colis'; }
    });
  });

  // Ship parcel
  container.querySelectorAll('[data-action="hub-ship"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Expédier le colis ' + ref + ' via transitaire ?')) return;
      btn.disabled = true; btn.textContent = '⏳ Expédition...';
      try {
        await CT.api.v2Scan(ref, 'shipped', 'Expédié depuis Hub — Control Tower');
        _toast('✅ ' + ref + ' expédié ✈️');
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '✈️ Expédier'; }
    });
  });
}


// ═══════════════════════════════════════════════════════════════
// 📦 RELAIS — Point de retrait (Comores)
// Pipeline: 💰 Paiement cash → 🚢 Réception → 📍 Distribution
// ═══════════════════════════════════════════════════════════════
CT.views.relais = async function(container) {
  container.innerHTML = '<div class="ct-loading" style="text-align:center;padding:40px;color:#64748b">📦 Chargement Relais...</div>';

  try {
    var results = await Promise.all([
      CT.api.v2Orders().catch(function() { return { orders: [], kpis: {} }; }),
      CT.api.v2Parcels().catch(function() { return { parcels: [] }; })
    ]);

    var allOrders = results[0].orders || [];
    var allParcels = results[1].parcels || [];

    // ── Classify ──
    var cashPending = allOrders.filter(function(o) {
      return o.status === 'pending' && o.payment_mode === 'cash_relay' && o.payment_status !== 'paid';
    });
    var transitParcels    = allParcels.filter(function(p) { return p.status === 'in_transit'; });
    var shippedParcels    = allParcels.filter(function(p) { return p.status === 'shipped'; });
    var availableParcels  = allParcels.filter(function(p) { return p.status === 'available'; });
    var collectedParcels  = allParcels.filter(function(p) { return p.status === 'collected'; });

    // ── Alerting data ──
    var now = Date.now();
    var uncollected72h = availableParcels.filter(function(p) {
      return p.updated_at && (now - new Date(p.updated_at).getTime()) > 72 * 3600000;
    });
    var lateTransit = transitParcels.concat(shippedParcels).filter(function(p) {
      return p.created_at && (now - new Date(p.created_at).getTime()) > 10 * 24 * 3600000;
    });
    var cashExpired = cashPending.filter(function(o) {
      return o.created_at && (now - new Date(o.created_at).getTime()) > 36 * 3600000;
    });

    // ═══ BUILD HTML ═══
    var html = '<div class="ct-view-header" style="padding:16px 0">' +
      '<h2 style="margin:0 0 4px">📦 Relais — Point de retrait</h2>' +
      '<p style="margin:0;color:#64748b;font-size:14px">Paiements cash · Réception colis · Distribution clients</p>' +
      '<button class="ct-btn ct-btn-ghost" style="margin-top:8px;padding:6px 14px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;background:white;font-size:13px" onclick="CT.views.relais(document.getElementById(\'ct-main\'))">🔄 Rafraîchir</button>' +
      '</div>';

    // ── Pipeline indicator ──
    html += _pipelineIndicator([
      { icon: '💰', label: 'Cash', count: cashPending.length, color: '#f59e0b', active: cashPending.length > 0 },
      { icon: '🚢', label: 'Réception', count: transitParcels.length, color: '#8b5cf6', active: transitParcels.length > 0 },
      { icon: '📍', label: 'Distribution', count: availableParcels.length, color: '#22c55e', active: availableParcels.length > 0 },
      { icon: '✅', label: 'Collectés', count: collectedParcels.length, color: '#16a34a', active: collectedParcels.length > 0 }
    ]);

    // ── KPIs ──
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">';
    html += CT.pc.kpiCard('💰', 'Cash à encaisser', cashPending.length, cashPending.length > 0 ? '#f59e0b' : '#22c55e');
    html += CT.pc.kpiCard('🚢', 'En transit', transitParcels.length + shippedParcels.length, transitParcels.length + shippedParcels.length > 0 ? '#8b5cf6' : '#94a3b8');
    html += CT.pc.kpiCard('📍', 'À distribuer', availableParcels.length, availableParcels.length > 0 ? '#22c55e' : '#94a3b8');
    html += CT.pc.kpiCard('✅', 'Collectés', collectedParcels.length, '#16a34a');
    html += CT.pc.kpiCard('⏰', 'Non collectés >72h', uncollected72h.length, uncollected72h.length > 0 ? '#ef4444' : '#22c55e');
    html += CT.pc.kpiCard('🚨', 'Alertes', (uncollected72h.length + lateTransit.length + cashExpired.length), (uncollected72h.length + lateTransit.length + cashExpired.length) > 0 ? '#ef4444' : '#22c55e');
    html += '</div>';

    // ══════════════════════════════════════════
    // ⚙️ OPÉRATIONNEL — Pipeline Cash → Réception → Distribution
    // ══════════════════════════════════════════
    var opContent = '';

    // ── ÉTAPE ① 💰 PAIEMENTS CASH À ENCAISSER ──
    opContent += '<div style="margin-bottom:20px">';
    opContent += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #f59e0b20">';
    opContent += '<span style="background:#fef3c7;color:#b45309;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ÉTAPE 1</span>';
    opContent += '<h4 style="margin:0;color:#b45309">💰 Paiements cash à encaisser (' + cashPending.length + ')</h4>';
    opContent += '</div>';

    if (cashPending.length > 0) {
      opContent += '<div class="ct-card-grid" style="display:flex;flex-wrap:wrap;gap:12px">';
      cashPending.forEach(function(o) {
        opContent += _actionCard(
          o.reference,
          '👤 ' + (o.customer_name || 'Client'),
          '<div>🏝️ ' + (o.relais_island || '—') + (o.relais_name ? ' — ' + o.relais_name : '') + '</div>' +
          '<div>🛒 ' + (o.nb_items || 0) + ' articles · ' + CT.pc.fmt(o.total_kmf) + '</div>' +
          '<div>📞 ' + (o.customer_phone || '—') + '</div>' +
          (o.cash_code ? '<div>🔑 Code : <strong style="color:#b45309;font-size:15px">' + o.cash_code + '</strong></div>' : ''),
          '⏱️ ' + CT.pc.ago(o.created_at),
          '💰 Encaisser & Confirmer',
          'relais-confirm-cash'
        );
      });
      opContent += '</div>';
    } else {
      opContent += '<div style="color:#22c55e;padding:12px;text-align:center;font-size:13px">✅ Aucun paiement en attente</div>';
    }
    opContent += '</div>';

    // ── ÉTAPE ② 🚢 COLIS À RÉCEPTIONNER ──
    opContent += '<div style="margin-bottom:20px">';
    opContent += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #8b5cf620">';
    opContent += '<span style="background:#ede9fe;color:#7c3aed;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ÉTAPE 2</span>';
    opContent += '<h4 style="margin:0;color:#7c3aed">🚢 Colis arrivés à réceptionner (' + transitParcels.length + ')</h4>';
    opContent += '</div>';

    if (transitParcels.length > 0) {
      opContent += '<div class="ct-card-grid" style="display:flex;flex-wrap:wrap;gap:12px">';
      transitParcels.forEach(function(p) {
        opContent += _actionCard(
          p.reference,
          '👤 ' + (p.recipient_name || 'Client'),
          '<div>🏝️ ' + (p.destination_island || '—') + (p.relais_name ? ' — ' + p.relais_name : '') + '</div>' +
          '<div>📋 ' + (p.main_order_ref || '—') + ' · ' + (p.nb_items || 0) + ' articles</div>' +
          '<div>💰 ' + CT.pc.fmt(p.total_kmf) + '</div>',
          '✈️ Expédié ' + CT.pc.ago(p.shipped_at || p.created_at),
          '📍 Confirmer réception',
          'relais-arrived'
        );
      });
      opContent += '</div>';
    } else {
      opContent += '<div style="color:#94a3b8;padding:12px;text-align:center;font-size:13px">Aucun colis en attente de réception</div>';
    }
    opContent += '</div>';

    // ── ÉTAPE ③ 📍 COLIS À DISTRIBUER ──
    opContent += '<div>';
    opContent += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #22c55e20">';
    opContent += '<span style="background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ÉTAPE 3</span>';
    opContent += '<h4 style="margin:0;color:#065f46">📍 Colis à distribuer (' + availableParcels.length + ')</h4>';
    opContent += '</div>';

    if (availableParcels.length > 0) {
      opContent += '<div class="ct-card-grid" style="display:flex;flex-wrap:wrap;gap:12px">';
      availableParcels.forEach(function(p) {
        opContent += _actionCard(
          p.reference,
          '👤 ' + (p.recipient_name || 'Client'),
          '<div>🏝️ ' + (p.destination_island || '—') + (p.relais_name ? ' — ' + p.relais_name : '') + '</div>' +
          (p.pickup_code ? '<div>🔑 Code retrait : <strong style="font-size:16px;color:#16a34a">' + p.pickup_code + '</strong></div>' : '') +
          '<div>💰 ' + CT.pc.fmt(p.total_kmf) + ' · ' + (p.nb_items || 0) + ' articles</div>',
          '📍 Dispo depuis ' + CT.pc.ago(p.updated_at || p.created_at),
          '✅ Remis au client',
          'relais-collected'
        );
      });
      opContent += '</div>';
    } else {
      opContent += '<div style="color:#94a3b8;padding:12px;text-align:center;font-size:13px">Aucun colis à distribuer</div>';
    }
    opContent += '</div>';

    html += _section('⚙️', 'Opérationnel — Pipeline relais', '#22c55e', 'relais-op', opContent);

    // ══════════════════════════════════════════
    // 📋 PRÉVISIONNEL — Ce qui arrive
    // ══════════════════════════════════════════
    var prevContent = '';

    // Colis expédiés en route
    var enRoute = shippedParcels;
    prevContent += '<h4 style="margin:0 0 10px;color:#6366f1">✈️ Colis expédiés en route (' + enRoute.length + ')</h4>';
    if (enRoute.length > 0) {
      prevContent += _infoTable(enRoute, [
        { label: 'Colis', render: function(p) { return '<strong>' + p.reference + '</strong>'; } },
        { label: 'Client', render: function(p) { return p.recipient_name || '—'; } },
        { label: 'Destination', render: function(p) { return '🏝️ ' + (p.destination_island || '—'); } },
        { label: 'Articles', render: function(p) { return p.nb_items || '—'; } },
        { label: 'Expédié', render: function(p) { return CT.pc.ago(p.shipped_at || p.created_at); } }
      ]);
    } else {
      prevContent += '<div style="color:#94a3b8;font-size:13px;padding:8px">Aucun colis en route</div>';
    }

    // Recently collected (last 7 days)
    prevContent += '<h4 style="margin:16px 0 10px;color:#6366f1">✅ Dernières distributions (' + collectedParcels.length + ')</h4>';
    if (collectedParcels.length > 0) {
      prevContent += _infoTable(collectedParcels.slice(0, 10), [
        { label: 'Colis', render: function(p) { return '<strong>' + p.reference + '</strong>'; } },
        { label: 'Client', render: function(p) { return p.recipient_name || '—'; } },
        { label: 'Destination', render: function(p) { return '🏝️ ' + (p.destination_island || '—'); } },
        { label: 'Collecté', render: function(p) { return CT.pc.ago(p.updated_at || p.created_at); } }
      ]);
    } else {
      prevContent += '<div style="color:#94a3b8;font-size:13px;padding:8px">Aucune distribution récente</div>';
    }

    html += _section('📋', 'Prévisionnel — Arrivages', '#8b5cf6', 'relais-prev', prevContent);

    // ══════════════════════════════════════════
    // 🚨 ALERTING
    // ══════════════════════════════════════════
    var alertContent = '';

    alertContent += _alertCard('💸', 'Cash expiré (>36h sans paiement)', cashExpired.map(function(o) {
      return { reference: o.reference, label: (o.customer_name || 'Client') + ' · ' + CT.pc.fmt(o.total_kmf), badge: CT.pc.ago(o.created_at) };
    }), '#f59e0b');

    alertContent += _alertCard('⏰', 'Non collectés depuis >72h', uncollected72h.map(function(p) {
      return { reference: p.reference, label: (p.recipient_name || 'Client') + ' · ' + (p.destination_island || '—'), badge: CT.pc.ago(p.updated_at || p.created_at) };
    }), '#ef4444');

    alertContent += _alertCard('🚢', 'Transit tardif (>10 jours)', lateTransit.map(function(p) {
      return { reference: p.reference, label: (p.recipient_name || 'Client') + ' · ' + (p.destination_island || '—'), badge: CT.pc.ago(p.created_at) };
    }), '#dc2626');

    if (!alertContent) {
      alertContent = _emptyState('Aucune alerte — tout roule !');
    }

    html += _section('🚨', 'Alerting', '#ef4444', 'relais-alert', alertContent, true);

    container.innerHTML = html;
    _wireRelaisActions(container);

  } catch(err) {
    container.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">❌ Erreur Relais: ' + err.message + '</div>';
  }
};

// ── Relais Action Handlers ───────────────────────────────────
function _wireRelaisActions(container) {
  // Confirm cash
  container.querySelectorAll('[data-action="relais-confirm-cash"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Confirmer l\'encaissement cash pour ' + ref + ' ?')) return;
      btn.disabled = true; btn.textContent = '⏳ Confirmation...';
      try {
        var r = await CT.api.v2ConfirmCash(ref);
        _toast('✅ ' + (r.message || 'Paiement confirmé') + ' 💰');
        CT.views.relais(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '💰 Encaisser & Confirmer'; }
    });
  });

  // Mark arrived (in_transit → available)
  container.querySelectorAll('[data-action="relais-arrived"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Confirmer la réception du colis ' + ref + ' au relais ?')) return;
      btn.disabled = true; btn.textContent = '⏳ Réception...';
      try {
        await CT.api.v2Scan(ref, 'arrived', 'Arrivé au relais — Control Tower');
        _toast('✅ ' + ref + ' réceptionné au relais 📍');
        CT.views.relais(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '📍 Confirmer réception'; }
    });
  });

  // Mark collected (available → collected)
  container.querySelectorAll('[data-action="relais-collected"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Confirmer la remise du colis ' + ref + ' au client ?')) return;
      btn.disabled = true; btn.textContent = '⏳ Distribution...';
      try {
        await CT.api.v2Scan(ref, 'collected', 'Remis au client — Control Tower');
        _toast('✅ ' + ref + ' remis au client ✔️');
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
