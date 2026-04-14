/* ===================================================================
   Komerce — parcel-components.js v2.0
   Composants réutilisables COLIS-FIRST pour la Control Tower
   =================================================================== */
window.CT = window.CT || {};
CT.pc = {};

// ── Status Config ─────────────────────────────────────────────
CT.pc.STATUS = {
  draft:       { label: 'Brouillon',    icon: '📝', color: '#9ca3af', bg: '#f3f4f6' },
  pending:     { label: 'En attente',   icon: '⏳', color: '#f59e0b', bg: '#fffbeb' },
  confirmed:   { label: 'Confirmée',    icon: '✅', color: '#3b82f6', bg: '#eff6ff' },
  ordered:     { label: 'Commandée',    icon: '📋', color: '#6366f1', bg: '#eef2ff' },
  preparation: { label: 'Préparation',  icon: '🔧', color: '#eab308', bg: '#fefce8' },
  shipped:     { label: 'Expédié',      icon: '✈️', color: '#3b82f6', bg: '#eff6ff' },
  in_transit:  { label: 'En transit',   icon: '🚢', color: '#8b5cf6', bg: '#f5f3ff' },
  available:   { label: 'Disponible',   icon: '📍', color: '#22c55e', bg: '#f0fdf4' },
  collected:   { label: 'Récupéré',     icon: '✅', color: '#16a34a', bg: '#dcfce7' },
  cancelled:   { label: 'Annulé',       icon: '❌', color: '#ef4444', bg: '#fef2f2' },
};

CT.pc.SEVERITY = {
  critical: { label: 'Critique', color: '#ef4444', bg: '#fef2f2' },
  high:     { label: 'Élevé',    color: '#f97316', bg: '#fff7ed' },
  medium:   { label: 'Moyen',    color: '#eab308', bg: '#fefce8' },
  warning:  { label: 'Attention',color: '#f59e0b', bg: '#fffbeb' },
  low:      { label: 'Faible',   color: '#22c55e', bg: '#f0fdf4' },
  info:     { label: 'Info',     color: '#6b7280', bg: '#f9fafb' },
};

// ── Next Status Flow ──────────────────────────────────────────
CT.pc.NEXT_STATUS = {
  preparation: { next: 'shipped',    event: 'shipped',    label: '✈️ Expédier' },
  shipped:     { next: 'in_transit', event: 'in_transit', label: '🚢 En transit' },
  in_transit:  { next: 'available',  event: 'arrived',    label: '📍 Arrivé au relais' },
  available:   { next: 'collected',  event: 'collected',  label: '✅ Remis au client' },
};

// ── Helpers ───────────────────────────────────────────────────
CT.pc.fmt = function(n) { return (n || 0).toLocaleString('fr-FR') + ' KMF'; };
CT.pc.fmtDate = function(d) {
  if (!d) return '—';
  var dt = new Date(d);
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' +
         dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};
CT.pc.ago = function(d) {
  if (!d) return '';
  var h = Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  if (h < 1) return 'À l\'instant';
  if (h < 24) return h + 'h';
  return Math.round(h / 24) + 'j';
};

// ── Badge Status ──────────────────────────────────────────────
CT.pc.badge = function(status) {
  var s = CT.pc.STATUS[status] || CT.pc.STATUS.draft;
  return '<span class="ct-badge" style="background:' + s.bg + ';color:' + s.color + ';border:1px solid ' + s.color + '33">' +
    s.icon + ' ' + s.label + '</span>';
};

CT.pc.severityBadge = function(severity) {
  var s = CT.pc.SEVERITY[severity] || CT.pc.SEVERITY.info;
  return '<span class="ct-badge" style="background:' + s.bg + ';color:' + s.color + ';border:1px solid ' + s.color + '33">' +
    s.label + '</span>';
};

// ── KPI Card ──────────────────────────────────────────────────
CT.pc.kpiCard = function(icon, label, value, color) {
  return '<div class="ct-kpi" style="border-left:4px solid ' + (color || '#3b82f6') + '">' +
    '<div class="ct-kpi-icon">' + icon + '</div>' +
    '<div class="ct-kpi-body"><div class="ct-kpi-value">' + value + '</div>' +
    '<div class="ct-kpi-label">' + label + '</div></div></div>';
};

// ── Parcel Card (for lists) ───────────────────────────────────
CT.pc.parcelCard = function(p, onClick) {
  var alertCount = (p.alerts || []).length;
  var alertHtml = alertCount > 0
    ? '<span class="ct-badge" style="background:#fef2f2;color:#ef4444">🚨 ' + alertCount + '</span>'
    : '';

  var html = '<div class="ct-parcel-card" data-ref="' + p.reference + '">' +
    '<div class="ct-parcel-header">' +
      '<strong>' + p.reference + '</strong>' +
      CT.pc.badge(p.status) + alertHtml +
    '</div>' +
    '<div class="ct-parcel-body">' +
      '<div>👤 <strong>' + (p.recipient_name || 'Client') + '</strong></div>' +
      '<div>🏝️ ' + (p.destination_island || p.relais_island || '—') +
        (p.relais_name ? ' — ' + p.relais_name : '') + '</div>' +
      '<div>📦 ' + (p.nb_orders || 0) + ' cmd · ' + (p.nb_items || 0) + ' art · ' +
        CT.pc.fmt(p.total_kmf) + '</div>' +
    '</div>' +
    '<div class="ct-parcel-footer">' +
      '<span>📅 ' + CT.pc.fmtDate(p.created_at) + '</span>' +
      (p.last_scan ? '<span>📡 ' + (p.last_scan.type || '') + ' ' + CT.pc.ago(p.last_scan.at) + '</span>' : '') +
    '</div>' +
  '</div>';
  return html;
};

// ── Order Card (for pending cash / ready for parcel) ──────────
CT.pc.orderCard = function(o, actionLabel, actionFn) {
  return '<div class="ct-order-card">' +
    '<div class="ct-order-header">' +
      '<strong>' + o.reference + '</strong>' +
      CT.pc.badge(o.status) +
    '</div>' +
    '<div class="ct-order-body">' +
      '<div>👤 <strong>' + (o.customer_name || 'Client') + '</strong> ' +
        (o.customer_phone ? '📞 ' + o.customer_phone : '') + '</div>' +
      '<div>🏝️ ' + (o.relais_island || o.destination_island || '—') +
        (o.relais_name ? ' — ' + o.relais_name : '') + '</div>' +
      '<div>🛒 ' + (o.nb_items || 0) + ' articles · ' + CT.pc.fmt(o.total_kmf) + '</div>' +
      '<div>💳 ' + (o.payment_mode || '—') + ' · ' + CT.pc.badge(o.payment_status || 'pending') + '</div>' +
    '</div>' +
    '<div class="ct-order-actions">' +
      '<button class="ct-btn ct-btn-primary" data-action="' + actionFn + '" data-ref="' + o.reference + '">' +
        actionLabel + '</button>' +
    '</div>' +
  '</div>';
};

// ── Action Bar (for parcel detail) ────────────────────────────
CT.pc.actionBar = function(parcel) {
  var nextInfo = CT.pc.NEXT_STATUS[parcel.status];
  if (!nextInfo) return '<div class="ct-action-bar ct-action-done">✅ Cycle terminé</div>';

  return '<div class="ct-action-bar">' +
    '<button class="ct-btn ct-btn-action ct-btn-lg" data-advance="' + parcel.reference + '" data-event="' + nextInfo.event + '">' +
      nextInfo.label + ' →' +
    '</button>' +
    '<span class="ct-action-hint">' + CT.pc.STATUS[parcel.status].label + ' → ' + CT.pc.STATUS[nextInfo.next].label + '</span>' +
  '</div>';
};

// ── Timeline ──────────────────────────────────────────────────
CT.pc.timeline = function(scans) {
  if (!scans || !scans.length) return '<div class="ct-empty">Aucun scan</div>';
  var html = '<div class="ct-timeline">';
  for (var i = 0; i < scans.length; i++) {
    var s = scans[i];
    var st = CT.pc.STATUS[s.event_type] || { icon: '📡', label: s.event_type };
    html += '<div class="ct-timeline-item">' +
      '<div class="ct-timeline-dot" style="background:' + (st.color || '#6b7280') + '"></div>' +
      '<div class="ct-timeline-content">' +
        '<strong>' + st.icon + ' ' + st.label + '</strong>' +
        '<div class="ct-timeline-meta">' +
          CT.pc.fmtDate(s.created_at) + ' · ' + (s.actor_name || 'Système') +
          (s.location ? ' · 📍' + s.location : '') +
        '</div>' +
        (s.notes ? '<div class="ct-timeline-notes">' + s.notes + '</div>' : '') +
      '</div>' +
    '</div>';
  }
  html += '</div>';
  return html;
};

// ── Client/Order/Items Hierarchy ──────────────────────────────
CT.pc.hierarchy = function(clients) {
  if (!clients || !clients.length) return '<div class="ct-empty">Aucun client rattaché</div>';
  var html = '';
  for (var i = 0; i < clients.length; i++) {
    var cl = clients[i];
    html += '<div class="ct-client-block">' +
      '<div class="ct-client-header">👤 <strong>' + (cl.name || 'Client') + '</strong>' +
        (cl.phone ? ' · 📞 ' + cl.phone : '') + '</div>';
    
    for (var j = 0; j < (cl.orders || []).length; j++) {
      var ord = cl.orders[j];
      html += '<div class="ct-order-block">' +
        '<div class="ct-order-line">📋 ' + ord.reference + ' · ' + CT.pc.badge(ord.status) +
          ' · ' + CT.pc.fmt(ord.total_kmf) +
          ' · 💳 ' + (ord.payment_mode || '—') + ' ' + CT.pc.badge(ord.payment_status || 'pending') +
        '</div>';
      
      for (var k = 0; k < (ord.items || []).length; k++) {
        var it = ord.items[k];
        html += '<div class="ct-item-line">' +
          (it.emoji || '🛒') + ' ' + (it.product_name || 'Produit') +
          ' × ' + it.quantity + ' · ' + CT.pc.fmt(it.price_kmf) +
        '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  return html;
};

// ── Reconciliation Card ───────────────────────────────────────
CT.pc.recoCard = function(p) {
  var reco = p.reconciliation || {};
  var statusColor = { blocked: '#ef4444', warning: '#f59e0b', ok: '#22c55e' }[reco.status] || '#6b7280';
  var statusLabel = { blocked: '🔴 Bloqué', warning: '🟡 Attention', ok: '🟢 OK' }[reco.status] || 'Inconnu';
  
  var html = '<div class="ct-reco-card" style="border-left:4px solid ' + statusColor + '">' +
    '<div class="ct-reco-header">' +
      '<strong>' + p.reference + '</strong> ' + statusLabel +
    '</div>' +
    '<div class="ct-reco-body">' +
      '<div>📦 ' + CT.pc.badge(p.status) + ' · 💰 ' + CT.pc.fmt(p.total_kmf) + '</div>' +
      '<div>👤 ' + (p.recipient_name || 'Client') + ' · 💳 ' + (p.payment_mode || '—') + '</div>';
  
  if (reco.issues && reco.issues.length > 0) {
    html += '<div class="ct-reco-issues">';
    for (var i = 0; i < reco.issues.length; i++) {
      html += '<div class="ct-reco-issue">⚠️ ' + reco.issues[i] + '</div>';
    }
    html += '</div>';
  }
  
  html += '</div></div>';
  return html;
};
