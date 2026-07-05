/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-v7
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
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

// ═══════════════════════════════════════════════════════════════
// COMMANDES & COLIS — Vue unifiée avec tabs
// ═══════════════════════════════════════════════════════════════

CT.views._ordersTab = 'all';

CT.views.orders = async function(container) {
  container.innerHTML = '<div class="ct-loading">📋 Chargement commandes & colis...</div>';

  try {
    var ordersData, parcelsData;
    var results = await Promise.all([
      CT.api.v2Orders(),
      CT.api.v2Parcels().catch(function() { return { parcels: [] }; })
    ]);
    ordersData = results[0];
    parcelsData = results[1];

    var orders = ordersData.orders || [];
    var k = ordersData.kpis || {};
    var parcels = parcelsData.parcels || [];

    // ── Classify orders ──
    var freeOrders = orders.filter(function(o) { return !o.has_parcel; });
    var parceledOrders = orders.filter(function(o) { return o.has_parcel; });

    var activeTab = CT.views._ordersTab || 'all';

    // ── Helpers ──
    function statusBadge(s) {
      var map = {
        'pending':     { bg: '#fef3c7', fg: '#92400e', label: '⏳ En attente' },
        'confirmed':   { bg: '#dbeafe', fg: '#1e40af', label: '✅ Confirmée' },
        'ordered':     { bg: '#e0e7ff', fg: '#3730a3', label: '🛒 Commandée' },
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
      if (ps === 'pending' && pm === 'cash_relais') return '<span style="color:#d97706;font-weight:600">💰 Cash attente</span>';
      if (ps === 'pending') return '<span style="color:#d97706;font-weight:600">⏳ Attente</span>';
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

    function colisageBadge(o) {
      if (!o.has_parcel) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:#fef3c7;color:#92400e">' +
          '🔓 Libre</span>';
      }
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:#d1fae5;color:#065f46;cursor:pointer" ' +
        'data-parcel-ref="' + (o.parcel_ref || '') + '" title="Voir le colis">' +
        '📦 ' + (o.parcel_ref || 'Oui') + '</span>';
    }

    // ── Build HTML ──
    var html = '';

    // Title
    html += '<div class="ct-view-header"><h2>📋 Commandes & Colis</h2>';
    html += '<p class="ct-subtitle">Vue unifiée du cycle de vie — de la commande à la livraison</p></div>';

    // KPIs
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">';
    var kpis = [
      { icon: '📋', label: 'Total', val: orders.length, color: '#6366f1' },
      { icon: '🔓', label: 'Libres', val: freeOrders.length, color: freeOrders.length > 0 ? '#f59e0b' : '#22c55e' },
      { icon: '✅', label: 'Colisées', val: parceledOrders.length, color: '#22c55e' },
      { icon: '📦', label: 'Colis', val: parcels.length, color: '#3b82f6' },
      { icon: '⏳', label: 'En attente', val: (k.pending || 0), color: '#f59e0b' },
      { icon: '🔄', label: 'En cours', val: (k.ordered || 0) + (k.preparation || 0) + (k.shipped || 0) + (k.in_transit || 0), color: '#3b82f6' },
      { icon: '📍', label: 'À retirer', val: k.available || 0, color: '#059669' },
      { icon: '💰', label: 'CA (KMF)', val: (k.ca_total_kmf || 0).toLocaleString(), color: '#16a34a' },
    ];
    kpis.forEach(function(kpi) {
      html += '<div style="background:white;border-radius:12px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-left:4px solid ' + kpi.color + '">' +
        '<div style="font-size:22px;font-weight:700">' + kpi.icon + ' ' + kpi.val + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px">' + kpi.label + '</div></div>';
    });
    html += '</div>';

    // Alert banners
    if ((k.payment_failed || 0) > 0) {
      html += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:20px">🚨</span>' +
        '<div><strong style="color:#991b1b">' + k.payment_failed + ' paiement(s) échoué(s)</strong>' +
        '<div style="color:#7f1d1d;font-size:13px">Vérifier dans Stripe</div></div></div>';
    }
    if (freeOrders.length > 0 && activeTab !== 'free') {
      html += '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:18px">⚠️</span>' +
        '<span><strong>' + freeOrders.length + ' commande(s) sans colis</strong> — à traiter dans le Hub</span></div>';
    }

    // ── Tabs ──
    html += '<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;border-bottom:2px solid #e2e8f0;padding-bottom:12px">';
    var tabs = [
      { id: 'all', label: 'Toutes', count: orders.length, icon: '📋' },
      { id: 'free', label: 'Libres', count: freeOrders.length, icon: '🔓' },
      { id: 'parceled', label: 'Colisées', count: parceledOrders.length, icon: '✅' },
      { id: 'parcels', label: 'Par colis', count: parcels.length, icon: '📦' },
    ];
    tabs.forEach(function(tab) {
      var isActive = activeTab === tab.id;
      var btnStyle = isActive
        ? 'background:#1e40af;color:white;border-color:#1e40af;font-weight:700'
        : 'background:white;color:#475569;border-color:#e2e8f0';
      html += '<button class="ct-tab-btn" data-tab="' + tab.id + '" style="padding:8px 16px;border-radius:8px;border:2px solid;cursor:pointer;font-size:13px;transition:all 0.15s;' + btnStyle + '">' +
        tab.icon + ' ' + tab.label + ' <span style="opacity:0.7">(' + tab.count + ')</span></button>';
    });
    html += '</div>';

    // ── Filters (for order tabs) ──
    if (activeTab !== 'parcels') {
      html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center">' +
        '<select id="ct-orders-status" style="padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px">' +
        '<option value="">Tous statuts</option>' +
        '<option value="pending">⏳ Pending</option><option value="confirmed">✅ Confirmed</option>' +
        '<option value="ordered">🛒 Ordered</option><option value="preparation">🔧 Preparation</option>' +
        '<option value="shipped">🚢 Shipped</option><option value="in_transit">✈️ In Transit</option>' +
        '<option value="available">📍 Available</option><option value="collected">✔️ Collected</option>' +
        '<option value="cancelled">❌ Cancelled</option></select>' +
        '<select id="ct-orders-payment" style="padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px">' +
        '<option value="">Tous modes</option><option value="stripe_eur">💳 Stripe</option><option value="cash_relais">💰 Cash</option></select>' +
        '<input id="ct-orders-search" type="text" placeholder="🔍 Référence, nom..." style="padding:6px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px;flex:1;min-width:150px">' +
        '<button id="ct-orders-refresh" style="padding:6px 14px;border-radius:8px;background:#3b82f6;color:white;border:none;cursor:pointer;font-size:13px">🔄</button>' +
        '</div>';
    }

    // ── Content based on tab ──
    if (activeTab === 'parcels') {
      // ─── Parcels view ───
      html += '<div id="ct-parcel-list">';
      if (!parcels.length) {
        html += '<div class="ct-empty-state">📭 Aucun colis créé</div>';
      } else {
        html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">';
        parcels.forEach(function(p) {
          var sBg = { preparation:'#fef3c7', shipped:'#dbeafe', in_transit:'#e0e7ff', available:'#d1fae5', collected:'#f0fdf4' }[p.status] || '#f1f5f9';
          var sLabel = { preparation:'🔧 Préparation', shipped:'🚢 Expédié', in_transit:'✈️ Transit', available:'📍 Disponible', collected:'✔️ Collecté' }[p.status] || p.status;

          html += '<div class="ct-parcel-card" data-ref="' + p.reference + '" style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.08);cursor:pointer;transition:transform 0.1s;border-left:4px solid ' + (p.status === 'available' ? '#22c55e' : p.status === 'collected' ? '#16a34a' : '#3b82f6') + '">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
          html += '<strong style="font-family:monospace;font-size:15px;color:#1e40af">' + p.reference + '</strong>';
          html += '<span style="padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:' + sBg + '">' + sLabel + '</span>';
          html += '</div>';

          html += '<div style="font-size:13px;color:#475569;line-height:1.6">';
          html += '<div>🏝️ ' + (p.destination_island || '—') + (p.relais_name ? ' · 📍 ' + p.relais_name : '') + '</div>';
          html += '<div>⚖️ ' + (p.weight_kg || '?') + 'kg · 💰 ' + (p.total_kmf || 0).toLocaleString() + ' KMF</div>';
          html += '<div>📋 ' + (p.nb_orders || '?') + ' commande(s) · ' + (p.nb_items || '?') + ' article(s)</div>';
          if (p.pickup_code) html += '<div>🔑 Code: <strong>' + p.pickup_code + '</strong></div>';
          html += '</div>';

          html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9">';
          html += '<span>Créé ' + timeAgo(p.created_at) + '</span>';
          if (p.open_incidents > 0) html += '<span style="color:#ef4444;font-weight:600">🚨 ' + p.open_incidents + ' incident(s)</span>';
          html += '</div>';

          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      html += '<div id="ct-parcel-detail" style="display:none"></div>';

    } else {
      // ─── Orders table ───
      var filteredOrders = activeTab === 'free' ? freeOrders : (activeTab === 'parceled' ? parceledOrders : orders);

      html += '<div style="overflow-x:auto;border-radius:12px;border:1px solid #e2e8f0">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
      html += '<thead><tr style="background:#f8fafc">';
      html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Réf</th>';
      html += '<th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e2e8f0">Client</th>';
      html += '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Statut</th>';
      html += '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Paiement</th>';
      html += '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Mode</th>';
      html += '<th style="padding:10px 12px;text-align:right;border-bottom:2px solid #e2e8f0">Montant</th>';
      html += '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Articles</th>';
      html += '<th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e2e8f0">Colisage</th>';
      html += '<th style="padding:10px 12px;text-align:right;border-bottom:2px solid #e2e8f0">Âge</th>';
      html += '</tr></thead><tbody>';

      if (filteredOrders.length === 0) {
        html += '<tr><td colspan="9" style="padding:40px;text-align:center;color:#94a3b8">';
        html += activeTab === 'free' ? '✅ Toutes les commandes sont colisées !' : 'Aucune commande';
        html += '</td></tr>';
      } else {
        filteredOrders.forEach(function(o) {
          var rowBg = '';
          if (o.payment_status === 'failed') rowBg = '#fef2f2';
          else if (!o.has_parcel && o.status !== 'pending' && o.status !== 'cancelled') rowBg = '#fffbeb';
          else if (o.has_parcel) rowBg = '#f0fdf4';

          html += '<tr class="ct-order-row" style="border-bottom:1px solid #f1f5f9;cursor:pointer;background:' + rowBg + '" ' +
            'data-ref="' + o.reference + '" data-has-parcel="' + (o.has_parcel ? '1' : '0') + '" data-parcel-ref="' + (o.parcel_ref || '') + '">';

          html += '<td style="padding:10px 12px;font-weight:600;font-family:monospace;color:#1e40af">' + o.reference + '</td>';
          html += '<td style="padding:10px 12px">' +
            '<div style="font-weight:500">' + (o.customer_name || '—') + '</div>' +
            '<div style="font-size:11px;color:#94a3b8">' + (o.relais_name || '') + (o.relais_island ? ' · ' + o.relais_island : '') + '</div></td>';
          html += '<td style="padding:10px 12px;text-align:center">' + statusBadge(o.status) + '</td>';
          html += '<td style="padding:10px 12px;text-align:center">' + payBadge(o.payment_status, o.payment_mode) + '</td>';
          html += '<td style="padding:10px 12px;text-align:center;font-size:12px">' + modeIcon(o.payment_mode) + '</td>';
          html += '<td style="padding:10px 12px;text-align:right;font-weight:600">';
          if (o.total_eur) html += o.total_eur + '€';
          if (o.total_eur && o.total_kmf) html += '<br>';
          if (o.total_kmf) html += '<span style="font-size:11px;color:#64748b">' + o.total_kmf.toLocaleString() + ' KMF</span>';
          html += '</td>';
          html += '<td style="padding:10px 12px;text-align:center">' + (o.total_qty || 0) + ' <span style="font-size:11px;color:#94a3b8">(' + (o.nb_items || 0) + ' réf)</span></td>';
          html += '<td style="padding:10px 12px;text-align:center">' + colisageBadge(o) + '</td>';
          html += '<td style="padding:10px 12px;text-align:right;color:#64748b;font-size:12px">' + timeAgo(o.created_at) + '</td>';
          html += '</tr>';

          // Expandable detail row (hidden by default)
          html += '<tr class="ct-order-detail-row" data-detail-for="' + o.reference + '" style="display:none">';
          html += '<td colspan="9" style="padding:0;background:#f8fafc">';
          html += '<div class="ct-order-expand" id="detail-' + o.reference + '" style="padding:16px 20px">';
          html += '<div style="text-align:center;color:#94a3b8;font-size:13px">Cliquez pour charger les détails...</div>';
          html += '</div></td></tr>';
        });
      }

      html += '</tbody></table></div>';

      // Summary
      html += '<div style="margin-top:10px;text-align:right;font-size:12px;color:#94a3b8">';
      html += filteredOrders.length + ' commande(s) affichée(s) sur ' + (k.total || 0) + ' total</div>';
    }

    container.innerHTML = html;

    // ── Interactivity ──

    // Tab switching
    container.querySelectorAll('.ct-tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        CT.views._ordersTab = btn.dataset.tab;
        CT.views.orders(container);
      });
    });

    // Parcel card click (in parcels tab)
    if (activeTab === 'parcels') {
      container.querySelectorAll('.ct-parcel-card').forEach(function(card) {
        card.addEventListener('click', function() {
          CT.views._showParcel(card.dataset.ref, container);
        });
      });
    }

    // Order row click → expand detail
    container.querySelectorAll('.ct-order-row').forEach(function(row) {
      row.addEventListener('click', async function() {
        var ref = row.dataset.ref;
        var detailRow = container.querySelector('[data-detail-for="' + ref + '"]');
        if (!detailRow) return;

        // Toggle visibility
        var isOpen = detailRow.style.display !== 'none';
        // Close all other open details
        container.querySelectorAll('.ct-order-detail-row').forEach(function(r) {
          r.style.display = 'none';
        });

        if (isOpen) return; // Was open, now closed

        detailRow.style.display = '';
        var expandDiv = document.getElementById('detail-' + ref);
        expandDiv.innerHTML = '<div style="text-align:center;padding:12px;color:#64748b">⏳ Chargement...</div>';

        try {
          var detail = await CT.api.v2OrderDetail(ref);
          var o = detail.order || detail;
          var dhtml = '';

          // Two-column layout
          dhtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';

          // Left: Client + Order info
          dhtml += '<div>';
          dhtml += '<div style="background:white;border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,0.05)">';
          dhtml += '<h4 style="margin:0 0 8px;font-size:14px;color:#334155">👤 Client</h4>';
          dhtml += '<div style="font-size:13px;line-height:1.8;color:#475569">';
          dhtml += '<div><strong>' + (o.customer_name || '—') + '</strong></div>';
          if (o.local_phone) dhtml += '<div>📱 Local: ' + o.local_phone + '</div>';
          if (o.diaspora_phone) dhtml += '<div>📱 Diaspora: ' + o.diaspora_phone + '</div>';
          dhtml += '<div>🏝️ ' + (o.relais_island || '—') + (o.relais_name ? ' · 📍 ' + o.relais_name : '') + '</div>';
          dhtml += '</div></div>';

          // Payment info
          dhtml += '<div style="background:white;border-radius:10px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,0.05)">';
          dhtml += '<h4 style="margin:0 0 8px;font-size:14px;color:#334155">💳 Paiement</h4>';
          dhtml += '<div style="font-size:13px;line-height:1.8;color:#475569">';
          dhtml += '<div>Mode: <strong>' + modeIcon(o.payment_mode) + '</strong></div>';
          dhtml += '<div>Statut: ' + payBadge(o.payment_status, o.payment_mode) + '</div>';
          if (o.total_eur) dhtml += '<div>EUR: <strong>' + o.total_eur + '€</strong></div>';
          if (o.total_kmf) dhtml += '<div>KMF: <strong>' + o.total_kmf.toLocaleString() + ' KMF</strong></div>';
          dhtml += '</div></div>';
          dhtml += '</div>';

          // Right: Items + Parcel info
          dhtml += '<div>';

          // Items
          dhtml += '<div style="background:white;border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,0.05)">';
          dhtml += '<h4 style="margin:0 0 8px;font-size:14px;color:#334155">🛒 Articles</h4>';
          var items = o.items || [];
          if (items.length) {
            items.forEach(function(item) {
              var inParcel = o.has_parcel || (item.parcel_ref);
              dhtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">';
              dhtml += '<div><span style="font-weight:600">' + (item.quantity || 1) + 'x</span> ' + (item.product_name || item.name || 'Article') + '</div>';
              dhtml += '<div style="display:flex;align-items:center;gap:6px">';
              if (item.unit_price_kmf) dhtml += '<span style="color:#64748b;font-size:12px">' + (item.unit_price_kmf * (item.quantity || 1)).toLocaleString() + ' KMF</span>';
              dhtml += inParcel ? '<span style="color:#059669;font-size:14px" title="Dans un colis">✅</span>' : '<span style="color:#f59e0b;font-size:14px" title="Pas encore colisé">🔓</span>';
              dhtml += '</div></div>';
            });
          } else {
            dhtml += '<div style="color:#94a3b8;font-size:13px">Détail articles non disponible</div>';
          }
          dhtml += '</div>';

          // Parcel info
          if (o.has_parcel || o.parcel_ref) {
            dhtml += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,0.05)">';
            dhtml += '<h4 style="margin:0 0 8px;font-size:14px;color:#166534">📦 Colis</h4>';
            dhtml += '<div style="font-size:13px;line-height:1.8">';
            dhtml += '<div>Référence: <strong style="font-family:monospace;color:#1e40af;cursor:pointer" data-act="nav-parcel" data-parcel-ref="' + (o.parcel_ref || '') + '">' + (o.parcel_ref || '—') + ' →</strong></div>';
            dhtml += '<div>Statut colis: ' + statusBadge(o.parcel_status || o.status) + '</div>';
            if (o.pickup_code) dhtml += '<div>🔑 Code retrait: <strong>' + o.pickup_code + '</strong></div>';
            dhtml += '</div></div>';
          } else {
            dhtml += '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:14px">';
            dhtml += '<div style="font-size:13px;color:#92400e">';
            dhtml += '🔓 <strong>Pas de colis</strong> — cette commande est à traiter dans le Hub';
            dhtml += '</div></div>';
          }

          dhtml += '</div>';
          dhtml += '</div>'; // close grid

          // Timestamps
          dhtml += '<div style="margin-top:10px;font-size:11px;color:#94a3b8;display:flex;gap:16px;flex-wrap:wrap">';
          if (o.created_at) dhtml += '<span>📅 Créée ' + timeAgo(o.created_at) + '</span>';
          if (o.confirmed_at) dhtml += '<span>✅ Confirmée ' + timeAgo(o.confirmed_at) + '</span>';
          if (o.shipped_at) dhtml += '<span>🚢 Expédiée ' + timeAgo(o.shipped_at) + '</span>';
          dhtml += '</div>';

          expandDiv.innerHTML = dhtml;
          // Wire parcel ref navigation
          expandDiv.addEventListener('click', function(e) {
            var el = e.target.closest('[data-act="nav-parcel"]');
            if (!el) return;
            var ref = el.dataset.parcelRef;
            CT.views._ordersTab = 'parcels';
            CT.views.orders(document.getElementById('ct-main'));
            setTimeout(function() { var c = document.querySelector('[data-ref="' + ref + '"]'); if (c) c.click(); }, 300);
          });
        } catch(err) {
          expandDiv.innerHTML = '<div style="color:#dc2626;padding:12px">❌ Erreur: ' + err.message + '</div>';
        }
      });
    });

    // Filter/search handlers (for order tabs)
    if (activeTab !== 'parcels') {
      var filterHandler = function() {
        var rows = container.querySelectorAll('.ct-order-row');
        var statusVal = (document.getElementById('ct-orders-status') || {}).value || '';
        var paymentVal = (document.getElementById('ct-orders-payment') || {}).value || '';
        var searchVal = ((document.getElementById('ct-orders-search') || {}).value || '').toLowerCase();

        rows.forEach(function(row) {
          var text = row.textContent.toLowerCase();
          var show = true;
          if (statusVal && text.indexOf(statusVal) < 0) {
            // Check via data attributes would be better, use text for now
            var cells = row.querySelectorAll('td');
            var statusText = cells[2] ? cells[2].textContent.toLowerCase() : '';
            if (statusText.indexOf(statusVal) < 0) show = false;
          }
          if (searchVal && text.indexOf(searchVal) < 0) show = false;
          row.style.display = show ? '' : 'none';
          // Also hide corresponding detail row
          var detailRow = container.querySelector('[data-detail-for="' + row.dataset.ref + '"]');
          if (detailRow && !show) detailRow.style.display = 'none';
        });
      };

      var statusEl = document.getElementById('ct-orders-status');
      var paymentEl = document.getElementById('ct-orders-payment');
      var searchEl = document.getElementById('ct-orders-search');
      var refreshBtn = document.getElementById('ct-orders-refresh');

      if (statusEl) statusEl.addEventListener('change', filterHandler);
      if (paymentEl) paymentEl.addEventListener('change', filterHandler);
      if (searchEl) { var debounce; searchEl.addEventListener('input', function() { clearTimeout(debounce); debounce = setTimeout(filterHandler, 300); }); }
      if (refreshBtn) refreshBtn.addEventListener('click', function() { CT.views.orders(container); });
    }

  } catch(err) {
    container.innerHTML = '<div class="ct-error">❌ Erreur: ' + err.message + '</div>';
  }
};

// Parcels view = alias → unified view with parcels tab
CT.views.parcels = function(container) {
  CT.views._ordersTab = 'parcels';
  CT.views.orders(container);
};


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
    html += '<button class="ct-btn ct-btn-secondary" data-act="open-label" data-url="/api/v2/parcels/' + p.reference + '/label">🏷️ Etiquette A5</button>';
    html += '<button class="ct-btn ct-btn-secondary" data-act="open-label" data-url="/api/v2/parcels/' + p.reference + '/label?format=thermal">🖨️ Etiquette thermique</button>';
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

    // Wire label open buttons
    detail.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-act="open-label"]');
      if (btn) window.open(btn.dataset.url, '_blank');
    });

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
    /* Fetch parcel KPIs (for island breakdown) + order KPIs (for commandes synthèse) */
    var results = await Promise.all([
      CT.api.v2ParcelKpis(),
      CT.api.v2Orders().catch(function() { return {}; })
    ]);
    var kpis = results[0];
    var pk = kpis.parcels;
    var orderData = results[1];
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
          '<a href="#" data-act="navigate" data-view="createParcel" style="color:#1d4ed8;text-decoration:underline">Créer les colis → (BO)</a></div>';
      }
      // Alert if payment incidents
      if ((ok.payment_failed || 0) > 0) {
        html += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-top:8px;font-size:13px">' +
          '🚨 <strong>' + ok.payment_failed + ' paiement(s) échoué(s)</strong> — vérifier dans Stripe</div>';
      }
      html += '</div>';
    }

    /* ── Colis par statut et Finance retirés du dashboard ──
       Le radar (ct-views-dashboard-radar.js) couvre déjà :
       - 💰 Money → CA, cash, wallets, marge avec comparaisons
       - 📦 Flux colis → distribution status_detail cliquable
       Pas de doublon. */

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
    // Wire createParcel navigation link
    container.addEventListener('click', function(e) {
      var el = e.target.closest('[data-act="navigate"]');
      if (el) { e.preventDefault(); CT.app.navigate(el.dataset.view); }
    });
  } catch (err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

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

// ── 3c. RÉCONCILIATION COLIS ─────────────────────────────────
// Note (ADR-007) : cette vue concerne les COLIS bloqués/warning/OK.
// La VRAIE réconciliation cash (Attendu/Collecté/Déposé) est dans
// la vue Comptabilité (ADR-003).
CT.views.reconciliation = async function(container) {
  container.innerHTML = '<div class="ct-loading">⚖️ Chargement colis à réconcilier...</div>';
  try {
    var data = await CT.api.v2ParcelReconciliation();
    var parcels = data.parcels || [];
    var summary = data.summary || {};

    var html = '<div class="ct-view-header"><h2>⚖️ Colis à réconcilier</h2>' +
      '<p class="ct-view-desc" style="font-size:0.78rem;color:var(--ct-text-muted,#64748b);margin-top:2px;">' +
      'Suivi des colis dont le statut est bloqué ou en attention — pour la réconciliation cash, voir Comptabilité' +
      '</p>' +
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

// Alias explicite pour le nouveau nom dans le registry (ADR-007)
CT.views.parcel_reconciliation = CT.views.reconciliation;
