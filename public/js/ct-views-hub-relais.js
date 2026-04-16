/* ===================================================================
   Komerce Control Tower — ct-views-hub-relais.js v3 COMPACT
   Hub: 🛒 Sourcing → 📦 Colis → ✈️ Expédition
   Relais: 💰 Cash → 🚢 Réception → 📍 Distribution
   =================================================================== */
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

// ── Compact helpers ──────────────────────────────────────────

function _badge(count, color, label) {
  return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;' +
    'background:' + (count > 0 ? color + '15' : '#f1f5f9') + ';color:' + (count > 0 ? color : '#94a3b8') + '">' +
    label + ' <b>' + count + '</b></span>';
}

function _tab(id, icon, label, count, color, active) {
  return '<button class="ct-tab" data-tab="' + id + '" style="padding:8px 16px;border:none;border-bottom:3px solid ' +
    (active ? color : 'transparent') + ';background:' + (active ? color + '08' : 'transparent') +
    ';color:' + (active ? color : '#64748b') + ';font-size:13px;font-weight:600;cursor:pointer;transition:all .2s">' +
    icon + ' ' + label + (count > 0 ? ' <span style="background:' + color + ';color:#fff;border-radius:8px;padding:1px 6px;font-size:11px">' + count + '</span>' : '') +
    '</button>';
}

function _compactRow(ref, client, info, timing, btnLabel, btnAction, btnColor) {
  return '<tr style="border-bottom:1px solid #f1f5f9">' +
    '<td style="padding:8px 10px;font-weight:700;color:#1e40af;font-size:13px;white-space:nowrap">' + ref + '</td>' +
    '<td style="padding:8px 10px;font-size:13px">' + client + '</td>' +
    '<td style="padding:8px 10px;font-size:12px;color:#64748b">' + info + '</td>' +
    '<td style="padding:8px 10px;font-size:11px;color:#94a3b8;white-space:nowrap">' + timing + '</td>' +
    '<td style="padding:8px 6px;text-align:right">' +
    (btnLabel ? '<button data-action="' + btnAction + '" data-ref="' + ref + '" style="padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;' +
    'background:' + btnColor + '18;color:' + btnColor + '">' + btnLabel + '</button>' : '') +
    '</td></tr>';
}

function _compactTable(headers, rows) {
  if (!rows || rows.length === 0) return '<div style="color:#94a3b8;padding:12px;text-align:center;font-size:13px">✅ Rien à traiter</div>';
  return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
    '<thead><tr style="background:#f8fafc">' +
    headers.map(function(h) { return '<th style="padding:6px 10px;text-align:left;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">' + h + '</th>'; }).join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function _miniTable(items, columns) {
  if (!items || items.length === 0) return '<div style="color:#94a3b8;font-size:12px;padding:6px">—</div>';
  var h = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  items.slice(0, 8).forEach(function(item, i) {
    h += '<tr style="border-bottom:1px solid #f8fafc;' + (i % 2 ? 'background:#fafbfd' : '') + '">';
    columns.forEach(function(c) { h += '<td style="padding:4px 8px">' + c(item) + '</td>'; });
    h += '</tr>';
  });
  if (items.length > 8) h += '<tr><td colspan="99" style="padding:4px 8px;color:#94a3b8;font-size:11px">+ ' + (items.length - 8) + ' autres...</td></tr>';
  h += '</table>';
  return h;
}

function _alertBadge(icon, label, count, color) {
  if (!count) return '';
  return '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:' + color + '08;border:1px solid ' + color + '25;border-radius:8px;margin-bottom:6px;font-size:12px">' +
    '<span>' + icon + '</span><span style="flex:1">' + label + '</span><strong style="color:' + color + '">' + count + '</strong></div>';
}

function _switchTab(containerId, tabId) {
  var c = document.getElementById(containerId);
  if (!c) return;
  c.querySelectorAll('.ct-tab').forEach(function(t) {
    var active = t.dataset.tab === tabId;
    t.style.borderBottomColor = active ? t.dataset.color || '#3b82f6' : 'transparent';
    t.style.background = active ? (t.dataset.color || '#3b82f6') + '08' : 'transparent';
    t.style.color = active ? (t.dataset.color || '#3b82f6') : '#64748b';
  });
  c.querySelectorAll('.ct-tab-panel').forEach(function(p) {
    p.style.display = p.dataset.panel === tabId ? 'block' : 'none';
  });
}

// ── Toast ────────────────────────────────────────────────────
function _toast(msg) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:20px;right:20px;background:#065f46;color:white;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.2)';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; }, 2500);
  setTimeout(function() { el.remove(); }, 3000);
}

// ═══════════════════════════════════════════════════════════════
// 🏭 HUB — Centre logistique COMPACT
// ═══════════════════════════════════════════════════════════════
CT.views.hub = async function(container) {
  container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b">🏭 Chargement Hub...</div>';

  try {
    var res = await Promise.all([
      CT.api.v2Orders().catch(function() { return { orders: [] }; }),
      CT.api.v2Parcels().catch(function() { return { parcels: [] }; })
    ]);

    var orders = res[0].orders || [];
    var parcels = res[1].parcels || [];

    var pending    = orders.filter(function(o) { return o.status === 'pending'; });
    var confirmed  = orders.filter(function(o) { return o.status === 'confirmed'; });
    var ordered    = orders.filter(function(o) { return o.status === 'ordered'; });
    var prep       = orders.filter(function(o) { return o.status === 'preparation'; });

    var prepP      = parcels.filter(function(p) { return p.status === 'preparation'; });
    var shippedP   = parcels.filter(function(p) { return p.status === 'shipped'; });
    var transitP   = parcels.filter(function(p) { return p.status === 'in_transit'; });

    var parcelRefs = new Set();
    parcels.forEach(function(p) { if (p.main_order_ref) parcelRefs.add(p.main_order_ref); });
    var readyParcel = ordered.filter(function(o) { return !parcelRefs.has(o.reference); });

    var now = Date.now();
    var stuck48h = confirmed.filter(function(o) { return o.created_at && (now - new Date(o.created_at).getTime()) > 48*3600000; });
    var stuckOrd48h = ordered.filter(function(o) { return o.created_at && (now - new Date(o.created_at).getTime()) > 48*3600000; });
    var expired36h = pending.filter(function(o) { return o.created_at && (now - new Date(o.created_at).getTime()) > 36*3600000; });
    var critical7d = ordered.concat(confirmed).filter(function(o) { return o.created_at && (now - new Date(o.created_at).getTime()) > 7*24*3600000; });
    var alertCount = stuck48h.length + stuckOrd48h.length + expired36h.length + critical7d.length;

    // ═══ BUILD ═══
    var html = '<div id="hub-container" style="padding:12px 0">';

    // ── Header + KPI badges ──
    html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">';
    html += '<div><h2 style="margin:0;font-size:20px">🏭 Hub</h2><span style="color:#64748b;font-size:12px">Commander · Emballer · Expédier</span></div>';
    html += '<button style="padding:5px 12px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fff;font-size:12px" onclick="CT.views.hub(document.getElementById(\'ct-main\'))">🔄</button>';
    html += '</div>';

    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">';
    html += _badge(confirmed.length, '#f59e0b', '🛒 Commander');
    html += _badge(readyParcel.length, '#3b82f6', '📦 Emballer');
    html += _badge(prepP.length, '#8b5cf6', '✈️ Expédier');
    html += _badge(shippedP.length + transitP.length, '#22c55e', '🚀 En route');
    html += _badge(pending.length, '#94a3b8', '⏳ Attente');
    html += _badge(alertCount, '#ef4444', '🚨 Alertes');
    html += '</div>';

    // ── Tab bar ──
    var firstActive = confirmed.length > 0 ? 'h1' : (readyParcel.length > 0 ? 'h2' : 'h3');
    html += '<div style="display:flex;border-bottom:1px solid #e2e8f0;margin-bottom:0">';
    html += '<button class="ct-tab" data-tab="h1" data-color="#f59e0b" onclick="_switchTab(\'hub-container\',\'h1\')" style="padding:8px 16px;border:none;border-bottom:3px solid ' + (firstActive === 'h1' ? '#f59e0b' : 'transparent') + ';background:' + (firstActive === 'h1' ? '#f59e0b08' : 'transparent') + ';color:' + (firstActive === 'h1' ? '#f59e0b' : '#64748b') + ';font-size:13px;font-weight:600;cursor:pointer">🛒 Commander' + (confirmed.length ? ' <span style="background:#f59e0b;color:#fff;border-radius:8px;padding:1px 6px;font-size:11px">' + confirmed.length + '</span>' : '') + '</button>';
    html += '<button class="ct-tab" data-tab="h2" data-color="#3b82f6" onclick="_switchTab(\'hub-container\',\'h2\')" style="padding:8px 16px;border:none;border-bottom:3px solid ' + (firstActive === 'h2' ? '#3b82f6' : 'transparent') + ';background:' + (firstActive === 'h2' ? '#3b82f608' : 'transparent') + ';color:' + (firstActive === 'h2' ? '#3b82f6' : '#64748b') + ';font-size:13px;font-weight:600;cursor:pointer">📦 Répartition' + (readyParcel.length ? ' <span style="background:#3b82f6;color:#fff;border-radius:8px;padding:1px 6px;font-size:11px">' + readyParcel.length + '</span>' : '') + '</button>';
    html += '<button class="ct-tab" data-tab="h3" data-color="#8b5cf6" onclick="_switchTab(\'hub-container\',\'h3\')" style="padding:8px 16px;border:none;border-bottom:3px solid ' + (firstActive === 'h3' ? '#8b5cf6' : 'transparent') + ';background:' + (firstActive === 'h3' ? '#8b5cf608' : 'transparent') + ';color:' + (firstActive === 'h3' ? '#8b5cf6' : '#64748b') + ';font-size:13px;font-weight:600;cursor:pointer">✈️ Expédier' + (prepP.length ? ' <span style="background:#8b5cf6;color:#fff;border-radius:8px;padding:1px 6px;font-size:11px">' + prepP.length + '</span>' : '') + '</button>';
    html += '</div>';

    // ── Tab panels ──
    // Panel 1: Commander au sourcing
    var rows1 = '';
    confirmed.forEach(function(o) {
      var items = []; try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch(e) {}
      var desc = (items.length || o.nb_items || 0) + ' art. · ' + CT.pc.fmt(o.total_kmf) + ' · ' + (o.relais_island || '—');
      rows1 += _compactRow(o.reference, o.customer_name || 'Client', desc, CT.pc.ago(o.created_at), '🛒 Commander', 'hub-mark-ordered', '#b45309');
    });
    html += '<div class="ct-tab-panel" data-panel="h1" style="' + (firstActive !== 'h1' ? 'display:none;' : '') + 'background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:8px">';
    html += _compactTable(['Réf', 'Client', 'Détails', 'Âge', ''], rows1);
    html += '</div>';

    // Panel 2: Répartition auto — le système distribue les articles dans les colis
    html += '<div class="ct-tab-panel" data-panel="h2" style="' + (firstActive !== 'h2' ? 'display:none;' : '') + 'background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:8px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<span style="font-size:12px;color:#64748b">Le système répartit automatiquement les commandes par destination</span>';
    html += '<button id="btn-auto-distribute" style="padding:5px 12px;border:none;border-radius:6px;background:#3b82f6;color:#fff;font-size:12px;font-weight:600;cursor:pointer">🤖 Répartir maintenant</button>';
    html += '</div>';
    html += '<div id="distribution-panel" style="color:#94a3b8;font-size:13px;text-align:center;padding:12px">⏳ Chargement répartition...</div>';
    html += '</div>';

    // Panel 3: Expédier
    var rows3 = '';
    prepP.forEach(function(p) {
      var desc = (p.main_order_ref || '—') + ' · ' + (p.nb_items || 0) + ' art. · ' + (p.destination_island || p.relais_island || '—');
      rows3 += _compactRow(p.reference, p.recipient_name || 'Client', desc, '', '✈️ Expédier', 'hub-ship', '#7c3aed');
    });
    html += '<div class="ct-tab-panel" data-panel="h3" style="' + (firstActive !== 'h3' ? 'display:none;' : '') + 'background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:8px">';
    html += _compactTable(['Colis', 'Client', 'Détails', '', ''], rows3);
    html += '</div>';

    // ── Bottom: Prévisionnel + Alertes côte à côte ──
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">';

    // Prévisionnel
    html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px">';
    html += '<h4 style="margin:0 0 10px;font-size:14px;color:#6366f1">📋 Prévisionnel</h4>';

    html += '<div style="font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:4px">🛍️ Attente paiement (' + pending.length + ')</div>';
    html += _miniTable(pending, [
      function(o) { return '<strong>' + o.reference + '</strong>'; },
      function(o) { return o.customer_name || '—'; },
      function(o) { return o.payment_mode === 'stripe_eur' ? '💳' : '💰'; },
      function(o) { return CT.pc.ago(o.created_at); }
    ]);

    html += '<div style="font-size:12px;font-weight:600;color:#94a3b8;margin:8px 0 4px">📬 En sourcing (' + ordered.length + ')</div>';
    html += _miniTable(ordered, [
      function(o) { return '<strong>' + o.reference + '</strong>'; },
      function(o) { return o.customer_name || '—'; },
      function(o) { return (o.nb_items || '—') + ' art.'; },
      function(o) { return CT.pc.ago(o.created_at); }
    ]);

    var enRoute = shippedP.concat(transitP);
    html += '<div style="font-size:12px;font-weight:600;color:#94a3b8;margin:8px 0 4px">🚀 En route (' + enRoute.length + ')</div>';
    html += _miniTable(enRoute, [
      function(p) { return '<strong>' + p.reference + '</strong>'; },
      function(p) { return CT.pc.badge(p.status); },
      function(p) { return '🏝️ ' + (p.destination_island || '—'); },
      function(p) { return CT.pc.ago(p.shipped_at || p.created_at); }
    ]);
    html += '</div>';

    // Alertes
    html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px">';
    html += '<h4 style="margin:0 0 10px;font-size:14px;color:#ef4444">🚨 Alertes</h4>';
    if (alertCount === 0) {
      html += '<div style="color:#22c55e;text-align:center;padding:20px;font-size:13px">✅ Aucune alerte</div>';
    } else {
      html += _alertBadge('💸', 'Paiements expirés >36h', expired36h.length, '#f59e0b');
      html += _alertBadge('🛒', 'Sourcing retard >48h', stuck48h.length, '#ef4444');
      html += _alertBadge('⏰', 'Ordered bloqué >48h', stuckOrd48h.length, '#ef4444');
      html += _alertBadge('🔴', 'Critique >7 jours', critical7d.length, '#dc2626');
    }
    html += '</div>';
    html += '</div>'; // end grid

    // ── Inventory Dashboard Panel ──
    html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:16px">';
    html += '<h4 style="margin:0 0 10px;font-size:14px;color:#1565c0;display:flex;align-items:center;justify-content:space-between">';
    html += '<span>📦 Inventaire — Propositions & Buffer</span>';
    html += '<button onclick="refreshInventoryDashboard()" style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fff;font-size:11px">🔄</button>';
    html += '</h4>';
    html += '<div id="inventory-panel"></div>';
    html += '</div>';

    html += '</div>'; // end hub-container
    container.innerHTML = html;
    _wireHubActions(container);

    // Render inventory dashboard (non-blocking)
    if (window.renderInventoryDashboard) {
      var invPanel = document.getElementById('inventory-panel');
      if (invPanel) window.renderInventoryDashboard(invPanel);
    }

  } catch(err) {
    container.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">❌ Erreur Hub: ' + err.message + '</div>';
  }
};


// ═══════════════════════════════════════════════════════════════
// 📦 RELAIS — Point de retrait COMPACT
// ═══════════════════════════════════════════════════════════════
CT.views.relais = async function(container) {
  container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b">📦 Chargement Relais...</div>';

  try {
    var res = await Promise.all([
      CT.api.v2Orders().catch(function() { return { orders: [] }; }),
      CT.api.v2Parcels().catch(function() { return { parcels: [] }; })
    ]);

    var orders = res[0].orders || [];
    var parcels = res[1].parcels || [];

    var cashPending = orders.filter(function(o) {
      return o.status === 'pending' && (o.payment_mode === 'cash_relay' || o.payment_mode === 'cash_relais') && o.payment_status !== 'paid';
    });
    var transitP    = parcels.filter(function(p) { return p.status === 'in_transit'; });
    var shippedP    = parcels.filter(function(p) { return p.status === 'shipped'; });
    var availableP  = parcels.filter(function(p) { return p.status === 'available'; });
    var collectedP  = parcels.filter(function(p) { return p.status === 'collected'; });

    var now = Date.now();
    var uncollected72 = availableP.filter(function(p) { return p.updated_at && (now - new Date(p.updated_at).getTime()) > 72*3600000; });
    var lateTransit = transitP.concat(shippedP).filter(function(p) { return p.created_at && (now - new Date(p.created_at).getTime()) > 10*24*3600000; });
    var cashExpired = cashPending.filter(function(o) { return o.created_at && (now - new Date(o.created_at).getTime()) > 36*3600000; });
    var alertCount = uncollected72.length + lateTransit.length + cashExpired.length;

    // ═══ BUILD ═══
    var html = '<div id="relais-container" style="padding:12px 0">';

    // ── Header + KPI badges ──
    html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">';
    html += '<div><h2 style="margin:0;font-size:20px">📦 Relais</h2><span style="color:#64748b;font-size:12px">Encaisser · Réceptionner · Distribuer</span></div>';
    html += '<button style="padding:5px 12px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fff;font-size:12px" onclick="CT.views.relais(document.getElementById(\'ct-main\'))">🔄</button>';
    html += '</div>';

    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">';
    html += _badge(cashPending.length, '#f59e0b', '💰 Cash');
    html += _badge(transitP.length, '#8b5cf6', '🚢 Transit');
    html += _badge(availableP.length, '#22c55e', '📍 Distribuer');
    html += _badge(collectedP.length, '#16a34a', '✅ Collectés');
    html += _badge(alertCount, '#ef4444', '🚨 Alertes');
    html += '</div>';

    // ── Tab bar ──
    var firstActive = cashPending.length > 0 ? 'r1' : (transitP.length > 0 ? 'r2' : 'r3');
    html += '<div style="display:flex;border-bottom:1px solid #e2e8f0;margin-bottom:0">';
    html += '<button class="ct-tab" data-tab="r1" data-color="#f59e0b" onclick="_switchTab(\'relais-container\',\'r1\')" style="padding:8px 16px;border:none;border-bottom:3px solid ' + (firstActive === 'r1' ? '#f59e0b' : 'transparent') + ';background:' + (firstActive === 'r1' ? '#f59e0b08' : 'transparent') + ';color:' + (firstActive === 'r1' ? '#f59e0b' : '#64748b') + ';font-size:13px;font-weight:600;cursor:pointer">💰 Encaisser' + (cashPending.length ? ' <span style="background:#f59e0b;color:#fff;border-radius:8px;padding:1px 6px;font-size:11px">' + cashPending.length + '</span>' : '') + '</button>';
    html += '<button class="ct-tab" data-tab="r2" data-color="#8b5cf6" onclick="_switchTab(\'relais-container\',\'r2\')" style="padding:8px 16px;border:none;border-bottom:3px solid ' + (firstActive === 'r2' ? '#8b5cf6' : 'transparent') + ';background:' + (firstActive === 'r2' ? '#8b5cf608' : 'transparent') + ';color:' + (firstActive === 'r2' ? '#8b5cf6' : '#64748b') + ';font-size:13px;font-weight:600;cursor:pointer">🚢 Réceptionner' + (transitP.length ? ' <span style="background:#8b5cf6;color:#fff;border-radius:8px;padding:1px 6px;font-size:11px">' + transitP.length + '</span>' : '') + '</button>';
    html += '<button class="ct-tab" data-tab="r3" data-color="#22c55e" onclick="_switchTab(\'relais-container\',\'r3\')" style="padding:8px 16px;border:none;border-bottom:3px solid ' + (firstActive === 'r3' ? '#22c55e' : 'transparent') + ';background:' + (firstActive === 'r3' ? '#22c55e08' : 'transparent') + ';color:' + (firstActive === 'r3' ? '#22c55e' : '#64748b') + ';font-size:13px;font-weight:600;cursor:pointer">📍 Distribuer' + (availableP.length ? ' <span style="background:#22c55e;color:#fff;border-radius:8px;padding:1px 6px;font-size:11px">' + availableP.length + '</span>' : '') + '</button>';
    html += '</div>';

    // ── Tab panels ──
    // Panel 1: Encaisser cash
    var rows1 = '';
    cashPending.forEach(function(o) {
      var desc = (o.nb_items || 0) + ' art. · ' + CT.pc.fmt(o.total_kmf) + (o.cash_code ? ' · 🔑 ' + o.cash_code : '');
      rows1 += _compactRow(o.reference, o.customer_name || 'Client', desc, CT.pc.ago(o.created_at), '💰 Encaisser', 'relais-confirm-cash', '#b45309');
    });
    html += '<div class="ct-tab-panel" data-panel="r1" style="' + (firstActive !== 'r1' ? 'display:none;' : '') + 'background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:8px">';
    html += _compactTable(['Réf', 'Client', 'Détails', 'Âge', ''], rows1);
    html += '</div>';

    // Panel 2: Réceptionner
    var rows2 = '';
    transitP.forEach(function(p) {
      var desc = (p.main_order_ref || '—') + ' · ' + (p.nb_items || 0) + ' art. · 🏝️ ' + (p.destination_island || '—');
      rows2 += _compactRow(p.reference, p.recipient_name || 'Client', desc, CT.pc.ago(p.shipped_at || p.created_at), '📍 Réceptionner', 'relais-arrived', '#7c3aed');
    });
    html += '<div class="ct-tab-panel" data-panel="r2" style="' + (firstActive !== 'r2' ? 'display:none;' : '') + 'background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:8px">';
    html += _compactTable(['Colis', 'Client', 'Détails', 'Expédié', ''], rows2);
    html += '</div>';

    // Panel 3: Distribuer
    var rows3 = '';
    availableP.forEach(function(p) {
      var desc = (p.nb_items || 0) + ' art. · ' + CT.pc.fmt(p.total_kmf) + (p.pickup_code ? ' · 🔑 ' + p.pickup_code : '');
      rows3 += _compactRow(p.reference, p.recipient_name || 'Client', desc, CT.pc.ago(p.updated_at || p.created_at), '✅ Remis', 'relais-collected', '#065f46');
    });
    html += '<div class="ct-tab-panel" data-panel="r3" style="' + (firstActive !== 'r3' ? 'display:none;' : '') + 'background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:8px">';
    html += _compactTable(['Colis', 'Client', 'Détails', 'Dispo', ''], rows3);
    html += '</div>';

    // ── Bottom: Prévisionnel + Alertes côte à côte ──
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">';

    // Prévisionnel
    html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px">';
    html += '<h4 style="margin:0 0 10px;font-size:14px;color:#6366f1">📋 Prévisionnel</h4>';

    html += '<div style="font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:4px">✈️ En route (' + shippedP.length + ')</div>';
    html += _miniTable(shippedP, [
      function(p) { return '<strong>' + p.reference + '</strong>'; },
      function(p) { return p.recipient_name || '—'; },
      function(p) { return '🏝️ ' + (p.destination_island || '—'); },
      function(p) { return CT.pc.ago(p.shipped_at || p.created_at); }
    ]);

    html += '<div style="font-size:12px;font-weight:600;color:#94a3b8;margin:8px 0 4px">✅ Récentes (' + collectedP.length + ')</div>';
    html += _miniTable(collectedP, [
      function(p) { return '<strong>' + p.reference + '</strong>'; },
      function(p) { return p.recipient_name || '—'; },
      function(p) { return '🏝️ ' + (p.destination_island || '—'); },
      function(p) { return CT.pc.ago(p.updated_at || p.created_at); }
    ]);
    html += '</div>';

    // Alertes
    html += '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px">';
    html += '<h4 style="margin:0 0 10px;font-size:14px;color:#ef4444">🚨 Alertes</h4>';
    if (alertCount === 0) {
      html += '<div style="color:#22c55e;text-align:center;padding:20px;font-size:13px">✅ Aucune alerte</div>';
    } else {
      html += _alertBadge('💸', 'Cash expiré >36h', cashExpired.length, '#f59e0b');
      html += _alertBadge('⏰', 'Non collectés >72h', uncollected72.length, '#ef4444');
      html += _alertBadge('🚢', 'Transit tardif >10j', lateTransit.length, '#dc2626');
    }
    html += '</div>';
    html += '</div>'; // end grid

    html += '</div>'; // end relais-container
    container.innerHTML = html;
    _wireRelaisActions(container);

  } catch(err) {
    container.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">❌ Erreur Relais: ' + err.message + '</div>';
  }
};


// ── Hub Action Handlers ──────────────────────────────────────
function _wireHubActions(container) {
  container.querySelectorAll('[data-action="hub-mark-ordered"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Commander au sourcing ' + ref + ' ?\nconfirmed → ordered')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        await CT.api.hubMarkOrdered(ref);
        _toast('✅ ' + ref + ' → sourcing 🛒');
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '🛒 Commander'; }
    });
  });

  // Auto-distribution loader + button
  _loadDistribution();
  var distBtn = container.querySelector('#btn-auto-distribute');
  if (distBtn) {
    distBtn.addEventListener('click', async function() {
      distBtn.disabled = true; distBtn.textContent = '⏳ Répartition...';
      try {
        var r = await CT.api.autoDistribute();
        _toast('✅ ' + (r.distributed || 0) + ' commande(s) répartie(s) 📦');
        _loadDistribution();
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); }
      distBtn.disabled = false; distBtn.textContent = '🤖 Répartir maintenant';
    });
  }

  container.querySelectorAll('[data-action="hub-ship"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Expédier ' + ref + ' ?\npreparation → shipped')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        await CT.api.v2Scan(ref, 'shipped', 'Expédié Hub — CT');
        _toast('✅ ' + ref + ' expédié ✈️');
        CT.views.hub(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '✈️ Expédier'; }
    });
  });
}

// ── Relais Action Handlers ───────────────────────────────────
function _wireRelaisActions(container) {
  container.querySelectorAll('[data-action="relais-confirm-cash"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Confirmer cash ' + ref + ' ?\npending → confirmed')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        var r = await CT.api.v2ConfirmCash(ref);
        _toast('✅ ' + (r.message || 'Cash confirmé') + ' 💰');
        CT.views.relais(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '💰 Encaisser'; }
    });
  });

  container.querySelectorAll('[data-action="relais-arrived"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Réceptionner ' + ref + ' ?\nin_transit → available')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        await CT.api.v2Scan(ref, 'arrived', 'Réception relais — CT');
        _toast('✅ ' + ref + ' réceptionné 📍');
        CT.views.relais(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '📍 Réceptionner'; }
    });
  });

  container.querySelectorAll('[data-action="relais-collected"]').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var ref = btn.dataset.ref;
      if (!confirm('Remettre ' + ref + ' au client ?\navailable → collected')) return;
      btn.disabled = true; btn.textContent = '⏳...';
      try {
        await CT.api.v2Scan(ref, 'collected', 'Remis client — CT');
        _toast('✅ ' + ref + ' remis ✔️');
        CT.views.relais(document.getElementById('ct-main'));
      } catch(e) { alert('❌ ' + e.message); btn.disabled = false; btn.textContent = '✅ Remis'; }
    });
  });
}

// ── Auto-Distribution Panel Loader ──────────────────────────
async function _loadDistribution() {
  var panel = document.getElementById('distribution-panel');
  if (!panel) return;
  
  try {
    var data = await CT.api.getDistribution();
    var parcels = data.parcels || [];
    var unassigned = data.unassigned || [];
    
    var html = '';
    
    // KPI line
    var totalOrders = parcels.reduce(function(s,p) { return s + (p.orders_count || 0); }, 0);
    var totalItems = parcels.reduce(function(s,p) { return s + (p.items_count || 0); }, 0);
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
    html += _badge(parcels.length, '#3b82f6', '📦 Colis');
    html += _badge(totalOrders, '#8b5cf6', '🛍️ Commandes');
    html += _badge(totalItems, '#22c55e', '📋 Articles');
    html += _badge(unassigned.length, '#f59e0b', '⏳ Non assignés');
    html += '</div>';
    
    // Parcels cards
    if (parcels.length === 0 && unassigned.length === 0) {
      html += '<div style="text-align:center;padding:16px;color:#94a3b8">✅ Aucune commande à répartir</div>';
    }
    
    parcels.forEach(function(p) {
      var orders = [];
      try { orders = typeof p.orders === 'string' ? JSON.parse(p.orders) : (p.orders || []); } catch(e) {}
      
      html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      html += '<strong style="color:#1e40af;font-size:14px">📦 ' + p.reference + '</strong>';
      html += '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">' + (p.destination || '—') + '</span>';
      html += '<span style="color:#64748b;font-size:11px">' + (p.orders_count || 0) + ' cmd · ' + (p.items_count || 0) + ' art. · ' + CT.pc.fmt(p.total_kmf || 0) + '</span>';
      html += '</div>';
      html += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;' + (p.parcel_status === 'draft' ? 'background:#fef3c7;color:#92400e' : 'background:#dbeafe;color:#1e40af') + '">' + (p.parcel_status || 'draft') + '</span>';
      html += '</div>';
      
      // Orders inside this parcel
      var ordHtml = '';
      orders.forEach(function(o) {
        ordHtml += '<tr style="border-bottom:1px solid #f1f5f9">';
        ordHtml += '<td style="padding:4px 8px;font-weight:600;color:#1e40af;font-size:12px">' + (o.ref || '—') + '</td>';
        ordHtml += '<td style="padding:4px 8px;font-size:12px">' + (o.customer || '—') + '</td>';
        ordHtml += '<td style="padding:4px 8px;font-size:12px;color:#64748b">' + (o.items_count || o.items || '?') + ' art.</td>';
        ordHtml += '<td style="padding:4px 8px;font-size:12px;text-align:right">' + CT.pc.fmt(o.total_kmf || o.total || 0) + '</td>';
        ordHtml += '</tr>';
      });
      if (ordHtml) {
        html += '<table style="width:100%;border-collapse:collapse"><tbody>' + ordHtml + '</tbody></table>';
      }
      html += '</div>';
    });
    
    // Unassigned orders
    if (unassigned.length > 0) {
      html += '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:10px;margin-top:8px">';
      html += '<div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:6px">⏳ ' + unassigned.length + ' commande(s) non assignée(s)</div>';
      unassigned.forEach(function(o) {
        html += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">';
        html += '<span><strong>' + o.reference + '</strong> — ' + (o.customer_name || '?') + '</span>';
        html += '<span style="color:#64748b">' + (o.items_count || '?') + ' art. · ' + (o.destination_island || '?') + '</span>';
        html += '</div>';
      });
      html += '<div style="margin-top:6px;font-size:11px;color:#92400e">Cliquez "🤖 Répartir maintenant" pour les assigner automatiquement</div>';
      html += '</div>';
    }
    
    panel.innerHTML = html;
  } catch(e) {
    panel.innerHTML = '<div style="color:#ef4444;font-size:12px">❌ ' + e.message + '</div>';
  }
}

// ═══════════════════════════════════════════════
// 🚢 TRANSITAIRE
// ═══════════════════════════════════════════════
CT.views.transitaire = async function(container) {
  container.innerHTML = '<div style="padding:40px;text-align:center">🚢 Chargement transitaire...</div>';

  try {
    const res = await CT.api.transitParcels();
    const parcels = res.parcels || [];

    let html = '<h2 style="margin-bottom:12px">🚢 Transitaire</h2>';

    if (!parcels.length) {
      html += '<div style="color:#64748b">✅ Aucun colis à envoyer</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse">';
      html += `
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:8px">Réf</th>
            <th>Destination</th>
            <th>Poids</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
      `;

      parcels.forEach(p => {
        html += `
          <tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:8px;font-weight:700">${p.reference}</td>
            <td>${p.destination_island || '-'}</td>
            <td>${p.weight_kg || '-'} kg</td>
            <td style="text-align:right">
              <button onclick="CT.views._goTransit('${p.reference}')"
                style="background:#3b82f6;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer">
                🚢 Envoyer
              </button>
            </td>
          </tr>
        `;
      });

      html += '</tbody></table>';
    }

    container.innerHTML = html;

  } catch (err) {
    container.innerHTML = `<div style="color:red">❌ ${err.message}</div>`;
  }
};

// action
CT.views._goTransit = async function(ref) {
  try {
    await CT.api.markInTransit(ref);
    alert('✅ Colis en transit');
    CT.views.transitaire(document.getElementById('ct-main'));
  } catch (err) {
    alert('❌ ' + err.message);
  }
};