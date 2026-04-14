/**
 * ═══════════════════════════════════════════════════════════════════════
 * PARCEL COMPONENTS — Composants UI COLIS-FIRST
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Composants réutilisables par :
 *   - Control Tower (ct-views.js)
 *   - Hub Dashboard (Komerce_Hub.html)
 *   - Relais Dashboard (Komerce_Relais.html)
 * 
 * Hiérarchie : COLIS → CLIENTS → COMMANDES → ARTICLES
 * 
 * API : /api/v2/parcels (parcel-api-v2.js)
 * ═══════════════════════════════════════════════════════════════════════
 */

// Namespace global
window.ParcelUI = window.ParcelUI || {};

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.formatKMF = function(amount) {
  if (!amount && amount !== 0) return '—';
  return new Intl.NumberFormat('fr-FR').format(amount) + ' KMF';
};

ParcelUI.timeAgo = function(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'à l\'instant';
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days}j`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};

ParcelUI.formatDate = function(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

ParcelUI.formatDateTime = function(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// ═══════════════════════════════════════════════════════════════════════
// STATUS CONFIG
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.STATUS = {
  draft:       { label: 'Brouillon',    emoji: '📝', color: '#9ca3af', bg: '#f3f4f6' },
  preparation: { label: 'Préparation',  emoji: '📋', color: '#f59e0b', bg: '#fef3c7' },
  shipped:     { label: 'Expédié',      emoji: '🚀', color: '#3b82f6', bg: '#dbeafe' },
  in_transit:  { label: 'En transit',   emoji: '🚢', color: '#8b5cf6', bg: '#ede9fe' },
  available:   { label: 'Disponible',   emoji: '📥', color: '#10b981', bg: '#d1fae5' },
  collected:   { label: 'Collecté',     emoji: '✅', color: '#059669', bg: '#a7f3d0' },
  cancelled:   { label: 'Annulé',       emoji: '❌', color: '#ef4444', bg: '#fee2e2' },
};

ParcelUI.getStatus = function(status) {
  return ParcelUI.STATUS[status] || { label: status || '?', emoji: '❓', color: '#6b7280', bg: '#f3f4f6' };
};

ParcelUI.SEVERITY = {
  critical: { label: 'Critique', emoji: '🔴', color: '#dc2626', bg: '#fef2f2' },
  high:     { label: 'Élevé',   emoji: '🟠', color: '#ea580c', bg: '#fff7ed' },
  warning:  { label: 'Attention', emoji: '🟡', color: '#d97706', bg: '#fffbeb' },
  info:     { label: 'Info',     emoji: '🔵', color: '#2563eb', bg: '#eff6ff' },
};

ParcelUI.PAYMENT = {
  cash_relais:  { label: 'Cash relais', emoji: '💵' },
  stripe_eur:   { label: 'Carte',       emoji: '💳' },
  wallet:       { label: 'Portefeuille', emoji: '👛' },
};

ParcelUI.ISLANDS = {
  'Grande Comore': '🏝️',
  'Anjouan':       '🏝️',
  'Mohéli':        '🏝️',
  'Mayotte':       '🏝️',
};

// ═══════════════════════════════════════════════════════════════════════
// renderStatusBadge
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderStatusBadge = function(status) {
  const s = ParcelUI.getStatus(status);
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${s.bg};color:${s.color}">${s.emoji} ${s.label}</span>`;
};

// ═══════════════════════════════════════════════════════════════════════
// renderParcelCard — Carte colis compacte
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderParcelCard = function(parcel, options = {}) {
  const s = ParcelUI.getStatus(parcel.status);
  const { onClick, showActions, compact } = options;

  const incidentBadge = (parcel.open_incidents > 0 || parcel.critical_incidents > 0)
    ? `<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#fef2f2;color:#dc2626">
        🚨 ${parcel.open_incidents || 0} incident${(parcel.open_incidents || 0) > 1 ? 's' : ''}
       </span>`
    : '';

  const alertBadge = (parcel.alerts && parcel.alerts.length > 0)
    ? `<span style="display:inline-flex;align-items:center;gap:2px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#fffbeb;color:#d97706">
        ⚡ ${parcel.alerts.length} alerte${parcel.alerts.length > 1 ? 's' : ''}
       </span>`
    : '';

  const payment = ParcelUI.PAYMENT[parcel.payment_mode] || { emoji: '💰', label: '' };

  const lastScan = parcel.last_scan
    ? `<div style="font-size:11px;color:#6b7280;margin-top:4px">📍 ${parcel.last_scan.location || ''} ${parcel.last_scan.actor ? '— ' + parcel.last_scan.actor : ''} (${ParcelUI.timeAgo(parcel.last_scan.at)})</div>`
    : '';

  const clickAttr = onClick ? `onclick="${onClick}('${parcel.reference}')" style="cursor:pointer"` : '';

  if (compact) {
    return `
      <div class="parcel-card compact" ${clickAttr} data-ref="${parcel.reference}" data-status="${parcel.status}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="font-size:14px">📦 ${parcel.reference}</strong>
          ${ParcelUI.renderStatusBadge(parcel.status)}
        </div>
        <div style="font-size:12px;color:#374151;margin-top:4px">
          🏝️ ${parcel.destination_island || '—'} · 👤 ${parcel.recipient_name || '—'} · 💰 ${ParcelUI.formatKMF(parcel.total_kmf)}
        </div>
        ${incidentBadge}${alertBadge}
      </div>
    `;
  }

  return `
    <div class="parcel-card" ${clickAttr} data-ref="${parcel.reference}" data-status="${parcel.status}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:16px;font-weight:700;color:#111827">📦 ${parcel.reference}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px">${parcel.relais_name || parcel.destination_island || '—'}</div>
        </div>
        ${ParcelUI.renderStatusBadge(parcel.status)}
      </div>
      
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:13px;color:#374151">
        <span>🏝️ ${parcel.destination_island || '—'}</span>
        <span>👤 ${parcel.nb_clients || 1} client${(parcel.nb_clients || 1) > 1 ? 's' : ''}</span>
        <span>📋 ${parcel.nb_orders || 1} cmd${(parcel.nb_orders || 1) > 1 ? 's' : ''}</span>
        <span>🛍️ ${parcel.nb_items || 0} art.</span>
        <span>💰 ${ParcelUI.formatKMF(parcel.total_kmf)}</span>
        ${parcel.eta ? `<span>⏰ ETA: ${ParcelUI.formatDate(parcel.eta)}</span>` : ''}
      </div>
      
      ${lastScan}
      
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${incidentBadge}${alertBadge}
      </div>

      ${showActions ? `
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn-parcel-detail" onclick="ParcelUI.openDetail('${parcel.reference}')">📂 Ouvrir</button>
        </div>
      ` : ''}
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderParcelList — Liste de colis avec filtres
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderParcelList = function(containerId, parcels, options = {}) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return;

  const { title, filterStatus, showSearch, onClick, showActions, compact, emptyMessage } = options;

  let filtered = parcels;
  if (filterStatus) {
    const statuses = Array.isArray(filterStatus) ? filterStatus : [filterStatus];
    filtered = parcels.filter(p => statuses.includes(p.status));
  }

  const header = title 
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
         <h3 style="margin:0;font-size:18px;font-weight:700">${title} <span style="color:#6b7280;font-weight:400">(${filtered.length})</span></h3>
       </div>`
    : '';

  const searchHtml = showSearch
    ? `<div style="margin-bottom:12px">
         <input type="text" id="parcel-search-${containerId}" placeholder="🔍 Chercher un colis, client, commande..."
           style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px"
           oninput="ParcelUI._filterList('${containerId}', this.value)">
       </div>`
    : '';

  if (filtered.length === 0) {
    container.innerHTML = `${header}${searchHtml}<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px">${emptyMessage || '📦 Aucun colis'}</div>`;
    return;
  }

  const cards = filtered.map(p => ParcelUI.renderParcelCard(p, { onClick, showActions, compact })).join('');

  container.innerHTML = `${header}${searchHtml}<div class="parcel-list">${cards}</div>`;
};

ParcelUI._filterList = function(containerId, query) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const cards = container.querySelectorAll('.parcel-card');
  const q = query.toLowerCase();
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? '' : 'none';
  });
};

// ═══════════════════════════════════════════════════════════════════════
// renderParcelDetail — Vue détaillée complète
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderParcelDetail = function(containerId, parcel) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return;

  const s = ParcelUI.getStatus(parcel.status);

  const headerHtml = `
    <div class="parcel-detail-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0;font-size:22px;font-weight:800">📦 ${parcel.reference}</h2>
          <div style="font-size:14px;color:#6b7280;margin-top:4px">
            ${parcel.relais ? `${parcel.relais.name || ''} — ${parcel.relais.island || parcel.destination_island || ''}` : parcel.destination_island || ''}
          </div>
        </div>
        ${ParcelUI.renderStatusBadge(parcel.status)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;font-size:14px;color:#374151">
        <span>👤 ${parcel.nb_clients || 0} client${(parcel.nb_clients || 0) > 1 ? 's' : ''}</span>
        <span>📋 ${parcel.nb_orders || 0} commande${(parcel.nb_orders || 0) > 1 ? 's' : ''}</span>
        <span>🛍️ ${parcel.nb_items || 0} articles</span>
        <span>💰 ${ParcelUI.formatKMF(parcel.total_kmf)}</span>
        ${parcel.weight_kg ? `<span>⚖️ ${parcel.weight_kg} kg</span>` : ''}
        ${parcel.eta ? `<span>⏰ ETA: ${ParcelUI.formatDate(parcel.eta)}</span>` : ''}
        ${parcel.pickup_code ? `<span>🔑 Code: <strong>${parcel.pickup_code}</strong></span>` : ''}
      </div>
    </div>
  `;

  const timelineHtml = ParcelUI.renderTimeline(parcel.scans || []);
  const clientsHtml = ParcelUI.renderClients(parcel.clients || []);
  const incidentsHtml = ParcelUI.renderIncidents(parcel.incidents || []);
  const reconHtml = ParcelUI.renderReconciliation(parcel.reconciliation);
  const alertsHtml = ParcelUI.renderAlerts(parcel.alerts || []);

  container.innerHTML = `
    <div class="parcel-detail">
      ${headerHtml}
      ${timelineHtml}
      ${clientsHtml}
      ${incidentsHtml.length > 50 ? incidentsHtml : ''}
      ${reconHtml}
      ${alertsHtml.length > 50 ? alertsHtml : ''}
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderTimeline — Timeline des scans
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderTimeline = function(scans) {
  if (!scans || scans.length === 0) {
    return `<div class="parcel-section"><h3>📍 Timeline</h3><p style="color:#9ca3af">Aucun scan enregistré</p></div>`;
  }

  const scanLabels = {
    preparation: '📋 Préparation',
    shipped:     '🚀 Expédié',
    in_transit:  '🚢 En transit',
    arrived:     '📥 Arrivé au relais',
    available:   '✅ Disponible',
    collected:   '🤝 Remis au client',
  };

  const items = scans.map((scan, i) => {
    const isLast = i === scans.length - 1;
    const label = scanLabels[scan.event_type] || `📦 ${scan.event_type}`;
    return `
      <div class="timeline-item ${isLast ? 'active' : ''}">
        <div class="timeline-dot ${isLast ? 'active' : ''}"></div>
        <div class="timeline-content">
          <div style="font-weight:600;font-size:13px">${label}</div>
          <div style="font-size:12px;color:#6b7280">
            ${ParcelUI.formatDateTime(scan.created_at)}
            ${scan.location ? ` — ${scan.location}` : ''}
            ${scan.actor_name ? ` — ${scan.actor_name}` : ''}
          </div>
          ${scan.notes ? `<div style="font-size:12px;color:#374151;margin-top:2px;font-style:italic">${scan.notes}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="parcel-section">
      <h3>📍 Timeline <span style="color:#9ca3af;font-weight:400">(${scans.length} scans)</span></h3>
      <div class="timeline">${items}</div>
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderClients — CLIENTS → COMMANDES → ARTICLES
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderClients = function(clients) {
  if (!clients || clients.length === 0) {
    return `<div class="parcel-section"><h3>👤 Clients</h3><p style="color:#9ca3af">Aucun client lié</p></div>`;
  }

  const clientsHtml = clients.map(client => {
    const ordersHtml = (client.orders || []).map(order => {
      const pay = ParcelUI.PAYMENT[order.payment_mode] || { emoji: '💰', label: order.payment_mode || '?' };
      const payStatus = order.payment_status === 'paid' ? '✅' : order.payment_status === 'pending' ? '⏳' : '❓';

      const itemsHtml = (order.items || []).map(item => `
        <div class="order-item">
          <span>${item.emoji || '🛍️'} ${item.product_name || 'Produit'}</span>
          <span style="white-space:nowrap">× ${item.quantity}</span>
          <span style="white-space:nowrap;font-weight:600">${ParcelUI.formatKMF(item.price_kmf)}</span>
        </div>
      `).join('');

      return `
        <div class="client-order">
          <div class="order-header">
            <span style="font-weight:600">📋 ${order.reference || '—'}</span>
            ${ParcelUI.renderStatusBadge(order.status)}
            <span>${pay.emoji} ${pay.label} ${payStatus}</span>
            <span style="font-weight:700">${ParcelUI.formatKMF(order.total_kmf)}</span>
          </div>
          <div class="order-items">${itemsHtml}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="client-block">
        <div class="client-header">
          <div>
            <strong style="font-size:15px">👤 ${client.name || 'Client'}</strong>
            ${client.phone ? `<span style="color:#6b7280;margin-left:8px">📱 ${client.phone}</span>` : ''}
          </div>
          <span style="font-size:12px;color:#6b7280">${(client.orders || []).length} commande${(client.orders || []).length > 1 ? 's' : ''}</span>
        </div>
        ${ordersHtml}
      </div>
    `;
  }).join('');

  return `
    <div class="parcel-section">
      <h3>👤 Clients <span style="color:#9ca3af;font-weight:400">(${clients.length})</span></h3>
      ${clientsHtml}
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderIncidents
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderIncidents = function(incidents) {
  if (!incidents || incidents.length === 0) return '';

  const items = incidents.map(inc => {
    const sev = ParcelUI.SEVERITY[inc.severity] || { emoji: '❓', color: '#6b7280', bg: '#f3f4f6' };
    return `
      <div class="incident-item" style="border-left:3px solid ${sev.color};padding:8px 12px;margin-bottom:8px;background:${sev.bg};border-radius:0 8px 8px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${sev.emoji} ${inc.title || inc.incident_type || 'Incident'}</strong>
          <span style="font-size:11px;padding:2px 8px;border-radius:8px;background:${inc.status === 'open' ? '#fee2e2' : inc.status === 'resolved' ? '#d1fae5' : '#fef3c7'};color:${inc.status === 'open' ? '#dc2626' : inc.status === 'resolved' ? '#059669' : '#d97706'}">${inc.status}</span>
        </div>
        ${inc.description ? `<div style="font-size:12px;color:#374151;margin-top:4px">${inc.description}</div>` : ''}
        <div style="font-size:11px;color:#6b7280;margin-top:4px">
          Impact: ${inc.client_impact || '—'} · Source: ${inc.detected_source || '—'} · ${ParcelUI.formatDateTime(inc.created_at)}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="parcel-section">
      <h3>🚨 Incidents <span style="color:#9ca3af;font-weight:400">(${incidents.length})</span></h3>
      ${items}
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderReconciliation
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderReconciliation = function(recon) {
  if (!recon) return '';

  const statusLabel = {
    ok: '✅ Réconcilié',
    warning: '⚠️ Écart mineur',
    blocked: '🚫 Blocage opérationnel',
  };

  const checkIcon = (v) => v ? '✅' : '❌';

  const checksHtml = recon.checks ? `
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;font-size:13px">
      <span>${checkIcon(recon.checks.content_match)} Contenu</span>
      <span>${checkIcon(recon.checks.status_sync)} Statuts</span>
      <span>${checkIcon(recon.checks.payment_sync)} Paiement</span>
      <span>${checkIcon(recon.checks.scan_sequence_ok)} Séquence scans</span>
      <span>${checkIcon(recon.checks.delivery_ready)} Prêt remise</span>
    </div>
  ` : '';

  const issuesHtml = (recon.issues && recon.issues.length > 0) ? `
    <div style="margin-top:8px">
      ${recon.issues.map(issue => {
        const msg = typeof issue === 'string' ? issue : issue.message;
        return `<div style="font-size:12px;color:#dc2626;margin-top:4px">⚠️ ${msg}</div>`;
      }).join('')}
    </div>
  ` : '';

  const bgColor = recon.status === 'ok' ? '#d1fae5' : recon.status === 'warning' ? '#fef3c7' : '#fee2e2';

  return `
    <div class="parcel-section">
      <h3>⚖️ Réconciliation</h3>
      <div style="background:${bgColor};padding:12px;border-radius:8px">
        <strong style="font-size:15px">${statusLabel[recon.status] || recon.status}</strong>
        ${checksHtml}
        ${issuesHtml}
      </div>
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderAlerts
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderAlerts = function(alerts) {
  if (!alerts || alerts.length === 0) return '';

  const items = alerts.map(a => {
    const sev = ParcelUI.SEVERITY[a.severity] || { emoji: '❓', bg: '#f3f4f6' };
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:${sev.bg};border-radius:6px;margin-bottom:4px;font-size:13px">
        ${sev.emoji} ${a.message}
      </div>
    `;
  }).join('');

  return `
    <div class="parcel-section">
      <h3>⚡ Alertes <span style="color:#9ca3af;font-weight:400">(${alerts.length})</span></h3>
      ${items}
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderKPIs — Dashboard KPIs
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderKPIs = function(containerId, kpis) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container || !kpis) return;

  const p = kpis.parcels || {};
  const f = kpis.finance || {};
  const inc = kpis.incidents || {};
  const byStatus = p.by_status || {};

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-number">${p.total || 0}</div>
        <div class="kpi-label">📦 Total colis</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid #8b5cf6">
        <div class="kpi-number">${p.active || 0}</div>
        <div class="kpi-label">🔄 Colis actifs</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid #10b981">
        <div class="kpi-number">${ParcelUI.formatKMF(f.ca_total_kmf)}</div>
        <div class="kpi-label">💰 CA total</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid #3b82f6">
        <div class="kpi-number">${f.nb_clients || 0}</div>
        <div class="kpi-label">👤 Clients</div>
      </div>
    </div>

    <div class="status-funnel">
      <h3 style="margin:16px 0 8px;font-size:16px">📊 Funnel colis</h3>
      <div class="funnel-grid">
        ${Object.entries(ParcelUI.STATUS).filter(([k]) => k !== 'cancelled').map(([status, cfg]) => {
          const count = byStatus[status] || 0;
          return `
            <div class="funnel-step" style="background:${cfg.bg};border:1px solid ${cfg.color}20">
              <div style="font-size:24px;font-weight:800">${count}</div>
              <div style="font-size:12px;color:${cfg.color}">${cfg.emoji} ${cfg.label}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    ${inc.open > 0 ? `
      <div style="margin-top:12px;padding:10px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca">
        <strong>🚨 ${inc.open} incident${inc.open > 1 ? 's' : ''} ouvert${inc.open > 1 ? 's' : ''}</strong>
        ${inc.critical > 0 ? `<span style="color:#dc2626;margin-left:8px">(dont ${inc.critical} critique${inc.critical > 1 ? 's' : ''})</span>` : ''}
      </div>
    ` : ''}

    ${p.by_island ? `
      <div style="margin-top:12px">
        <h3 style="margin:0 0 8px;font-size:16px">🏝️ Par île</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
          ${Object.entries(p.by_island).map(([island, statuses]) => {
            const total = Object.values(statuses).reduce((s, n) => s + n, 0);
            return `
              <div style="background:#f9fafb;padding:10px;border-radius:8px;border:1px solid #e5e7eb">
                <div style="font-weight:700">${ParcelUI.ISLANDS[island] || '🏝️'} ${island}</div>
                <div style="font-size:22px;font-weight:800">${total}</div>
                <div style="font-size:11px;color:#6b7280">${Object.entries(statuses).map(([s, n]) => `${n} ${ParcelUI.getStatus(s).emoji}`).join(' ')}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// renderReconciliationQueue — File de réconciliation
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.renderReconciliationQueue = function(containerId, data) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container || !data) return;

  const summary = data.summary || {};
  const parcels = data.parcels || [];

  const statusBg = { blocked: '#fee2e2', warning: '#fef3c7', ok: '#d1fae5' };
  const statusIcon = { blocked: '🚫', warning: '⚠️', ok: '✅' };

  container.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <div style="background:#fee2e2;padding:10px 16px;border-radius:8px;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:800">${summary.blocked || 0}</div>
        <div style="font-size:12px">🚫 Bloqués</div>
      </div>
      <div style="background:#fef3c7;padding:10px 16px;border-radius:8px;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:800">${summary.warning || 0}</div>
        <div style="font-size:12px">⚠️ Écarts</div>
      </div>
      <div style="background:#d1fae5;padding:10px 16px;border-radius:8px;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:800">${summary.ok || 0}</div>
        <div style="font-size:12px">✅ OK</div>
      </div>
    </div>

    <div class="parcel-list">
      ${parcels.map(p => `
        <div class="parcel-card" style="border-left:3px solid ${p.reconciliation.status === 'blocked' ? '#dc2626' : p.reconciliation.status === 'warning' ? '#d97706' : '#10b981'}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>📦 ${p.reference}</strong>
            <span style="padding:2px 8px;border-radius:8px;font-size:12px;background:${statusBg[p.reconciliation.status]}">${statusIcon[p.reconciliation.status]} ${p.reconciliation.status}</span>
          </div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px">
            ${p.destination_island || '—'} · ${p.recipient_name || '—'} · ${ParcelUI.formatKMF(p.total_kmf)} · ${p.scan_count} scans
          </div>
          ${p.reconciliation.issues.length > 0 ? `
            <div style="margin-top:6px">${p.reconciliation.issues.map(i => `<div style="font-size:11px;color:#dc2626">⚠️ ${i}</div>`).join('')}</div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
};

// ═══════════════════════════════════════════════════════════════════════
// openDetail — Fonction globale pour ouvrir le détail d'un colis
// ═══════════════════════════════════════════════════════════════════════

ParcelUI.openDetail = async function(ref, containerId) {
  const targetId = containerId || 'parcel-detail-container';
  let container = document.getElementById(targetId);
  
  // Si pas de container, créer un modal
  if (!container) {
    ParcelUI._showModal(ref);
    return;
  }

  container.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280">⏳ Chargement...</div>';

  try {
    const response = await CT.api.get(`/api/v2/parcels/${ref}`);
    ParcelUI.renderParcelDetail(container, response);
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

ParcelUI._showModal = function(ref) {
  // Remove existing modal
  const existing = document.getElementById('parcel-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'parcel-modal-overlay';
  overlay.innerHTML = `
    <div class="parcel-modal-backdrop" onclick="ParcelUI.closeModal()"></div>
    <div class="parcel-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #e5e7eb">
        <h2 style="margin:0;font-size:18px">📦 Détail Colis</h2>
        <button onclick="ParcelUI.closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button>
      </div>
      <div id="parcel-modal-content" style="padding:20px;overflow-y:auto;max-height:70vh">
        <div style="text-align:center;padding:40px;color:#6b7280">⏳ Chargement...</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Fetch and render
  (async () => {
    try {
      // Try CT.api first, fallback to fetch
      let data;
      if (window.CT && CT.api && CT.api.get) {
        data = await CT.api.get(`/api/v2/parcels/${ref}`);
      } else {
        const res = await fetch(`/api/v2/parcels/${ref}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }
      ParcelUI.renderParcelDetail('parcel-modal-content', data);
    } catch (err) {
      document.getElementById('parcel-modal-content').innerHTML = 
        `<div style="text-align:center;padding:40px;color:#dc2626">❌ ${err.message}</div>`;
    }
  })();
};

ParcelUI.closeModal = function() {
  const overlay = document.getElementById('parcel-modal-overlay');
  if (overlay) overlay.remove();
};

// ═══════════════════════════════════════════════════════════════════════
// CSS — Injected automatically
// ═══════════════════════════════════════════════════════════════════════

(function injectParcelCSS() {
  if (document.getElementById('parcel-components-css')) return;
  const style = document.createElement('style');
  style.id = 'parcel-components-css';
  style.textContent = `
    /* ── Parcel Card ────────────────────────────────── */
    .parcel-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 10px;
      transition: all 0.15s ease;
    }
    .parcel-card:hover {
      border-color: #93c5fd;
      box-shadow: 0 2px 8px rgba(59,130,246,0.1);
    }
    .parcel-card[style*="cursor:pointer"]:hover {
      transform: translateY(-1px);
    }
    .parcel-card.compact {
      padding: 10px 14px;
      margin-bottom: 6px;
    }

    /* ── Parcel List ────────────────────────────────── */
    .parcel-list {
      display: flex;
      flex-direction: column;
    }

    /* ── KPI Grid ──────────────────────────────────── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .kpi-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 16px;
      text-align: center;
    }
    .kpi-number {
      font-size: 28px;
      font-weight: 800;
      color: #111827;
    }
    .kpi-label {
      font-size: 13px;
      color: #6b7280;
      margin-top: 4px;
    }

    /* ── Funnel ─────────────────────────────────────── */
    .funnel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 8px;
    }
    .funnel-step {
      padding: 12px 8px;
      border-radius: 10px;
      text-align: center;
    }

    /* ── Detail Sections ───────────────────────────── */
    .parcel-detail-header {
      background: #f9fafb;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .parcel-section {
      margin-bottom: 20px;
    }
    .parcel-section h3 {
      font-size: 16px;
      font-weight: 700;
      margin: 0 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e5e7eb;
    }

    /* ── Client Blocks ─────────────────────────────── */
    .client-block {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .client-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: #f3f4f6;
    }
    .client-order {
      padding: 10px 14px;
      border-top: 1px solid #f3f4f6;
    }
    .order-header {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      font-size: 13px;
    }
    .order-items {
      margin-top: 6px;
      padding-left: 16px;
    }
    .order-item {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 0;
      font-size: 12px;
      color: #374151;
      border-bottom: 1px dashed #f3f4f6;
    }
    .order-item:last-child {
      border-bottom: none;
    }

    /* ── Timeline ──────────────────────────────────── */
    .timeline {
      position: relative;
      padding-left: 24px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 8px;
      top: 4px;
      bottom: 4px;
      width: 2px;
      background: #d1d5db;
    }
    .timeline-item {
      position: relative;
      margin-bottom: 12px;
    }
    .timeline-dot {
      position: absolute;
      left: -20px;
      top: 4px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #d1d5db;
      border: 2px solid #fff;
    }
    .timeline-dot.active {
      background: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59,130,246,0.2);
    }
    .timeline-content {
      padding-left: 4px;
    }

    /* ── Modal ─────────────────────────────────────── */
    #parcel-modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .parcel-modal-backdrop {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
    }
    .parcel-modal {
      position: relative;
      background: #fff;
      border-radius: 16px;
      width: 90%;
      max-width: 700px;
      max-height: 85vh;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }

    /* ── Buttons ────────────────────────────────────── */
    .btn-parcel-detail {
      padding: 6px 14px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-parcel-detail:hover {
      background: #f3f4f6;
      border-color: #93c5fd;
    }

    /* ── Responsive ─────────────────────────────────── */
    @media (max-width: 640px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .funnel-grid { grid-template-columns: repeat(3, 1fr); }
      .parcel-modal { width: 95%; max-height: 90vh; }
    }
  `;
  document.head.appendChild(style);
})();

console.log('📦 ParcelUI v1.0 loaded — COLIS-FIRST components ready');
