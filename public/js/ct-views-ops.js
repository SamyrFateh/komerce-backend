// ============================================================
// ct-views-ops.js — Control Tower v5.2 — Fix: CT.api + drill-down /detail
// Vues opérationnelles : Incidents, Réconciliation, Alertes, Factures
// + Modal drill-down Colis → Commandes → Articles
// ============================================================

// ---- PARCEL DRILL-DOWN MODAL ----
window.renderParcelDrillDown = async function(parcelId) {
  const modal = document.getElementById('parcel-modal');
  if (!modal) return;
  modal.innerHTML = '<div class="modal-overlay"><div class="modal-content"><p>⏳ Chargement...</p></div></div>';
  modal.style.display = 'flex';

  try {
    // Fetch all parcel data in one call (detail endpoint)
    const detail = await CT.api.get(`/api/v2/parcels/${parcelId}/detail`);
    const parcel = detail;
    const scans = detail.scans || [];
    const linkedOrders = detail.orders || [];

    const p = parcel.parcel || parcel;
    const statusBadge = getStatusBadge(p.status);
    
    // Build scan timeline
    const timelineHtml = (Array.isArray(scans) ? scans : []).map(s => {
      const d = new Date(s.scanned_at || s.created_at);
      const time = d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
      const icon = {
        'packed': '📦', 'shipped': '🚀', 'in_transit': '✈️',
        'received_relay': '🏪', 'delivered': '✅', 'collected': '💰'
      }[s.event_type] || '📌';
      return `<div class="timeline-item">
        <span class="timeline-icon">${icon}</span>
        <span class="timeline-time">${time}</span>
        <span class="timeline-label">${s.event_type} — ${s.actor_role || ''}</span>
        ${s.notes ? `<span class="timeline-note">${s.notes}</span>` : ''}
      </div>`;
    }).join('') || '<p style="color:#888">Aucun scan enregistré</p>';

    // Build orders accordion
    const ordersHtml = (Array.isArray(linkedOrders) ? linkedOrders : []).map(ord => {
      const o = ord.order || ord;
      const totalParcels = o.total_parcels || 1;
      const deliveredParcels = o.delivered_parcels || 0;
      const isComplete = deliveredParcels >= totalParcels;
      const isSplit = totalParcels > 1;
      
      let badge = '✅ Complète';
      let badgeClass = 'badge-ok';
      if (!isComplete && isSplit) {
        badge = `⚠️ Partielle (${deliveredParcels}/${totalParcels} colis)`;
        badgeClass = 'badge-warn';
      } else if (isSplit && isComplete) {
        badge = `📦 Split ${totalParcels} colis — Complète`;
        badgeClass = 'badge-ok';
      }

      // Items inside order
      const items = (o.items || []).map(it => {
        const name = it.product_name || it.name || 'Article';
        const qty = it.quantity || it.qty_ordered || 1;
        const price = it.unit_price || it.price || 0;
        return `<tr>
          <td>${name}</td>
          <td style="text-align:center">${qty}</td>
          <td style="text-align:right">${Number(price).toLocaleString('fr-FR')} KMF</td>
          <td style="text-align:right">${(qty * price).toLocaleString('fr-FR')} KMF</td>
        </tr>`;
      }).join('');

      const orderId = o.id || o.order_id;
      return `<div class="accordion-order">
        <div class="accordion-header" onclick="toggleAccordion('ord-${orderId}')">
          <span class="accordion-arrow" id="arrow-ord-${orderId}">▶</span>
          <span>📋 Commande #${orderId}</span>
          <span class="${badgeClass}">${badge}</span>
          <span style="margin-left:auto; font-weight:600">${Number(o.total_kmf || o.total || 0).toLocaleString('fr-FR')} KMF</span>
        </div>
        <div class="accordion-body" id="ord-${orderId}" style="display:none">
          <table class="items-table">
            <thead><tr><th>Article</th><th>Qté</th><th>P.U.</th><th>Total</th></tr></thead>
            <tbody>${items || '<tr><td colspan="4" style="color:#888">Aucun article</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
    }).join('') || '<p style="color:#888">Aucune commande liée</p>';

    modal.innerHTML = `
    <div class="modal-overlay" onclick="closeParcelModal(event)">
      <div class="modal-content modal-large" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>📦 Colis #${p.id} ${statusBadge}</h2>
          <button onclick="closeParcelModal()" class="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-grid">
            <div class="modal-section">
              <h3>📋 Informations</h3>
              <table class="info-table">
                <tr><td>Tracking</td><td><strong>${p.tracking_number || '—'}</strong></td></tr>
                <tr><td>Poids</td><td>${p.weight_kg ? p.weight_kg + ' kg' : '—'}</td></tr>
                <tr><td>Relais</td><td>${p.relay_name || p.relay_point || '—'}</td></tr>
                <tr><td>Créé le</td><td>${p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR') : '—'}</td></tr>
                <tr><td>Expédié le</td><td>${p.shipped_at ? new Date(p.shipped_at).toLocaleDateString('fr-FR') : '—'}</td></tr>
              </table>
            </div>
            <div class="modal-section">
              <h3>📍 Timeline des scans</h3>
              <div class="timeline">${timelineHtml}</div>
            </div>
          </div>
          <div class="modal-section" style="margin-top:1rem">
            <h3>📋 Commandes rattachées</h3>
            ${ordersHtml}
          </div>
        </div>
      </div>
    </div>`;
  } catch(err) {
    modal.innerHTML = `<div class="modal-overlay" onclick="closeParcelModal(event)">
      <div class="modal-content"><p>❌ Erreur: ${err.message}</p>
      <button onclick="closeParcelModal()">Fermer</button></div></div>`;
  }
};

window.toggleAccordion = function(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById('arrow-' + id);
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (arrow) arrow.textContent = '▼';
  } else {
    el.style.display = 'none';
    if (arrow) arrow.textContent = '▶';
  }
};

window.closeParcelModal = function(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('parcel-modal');
  if (modal) modal.style.display = 'none';
};

function getStatusBadge(status) {
  const map = {
    'created': '<span class="badge badge-gray">Créé</span>',
    'packed': '<span class="badge badge-blue">Emballé</span>',
    'shipped': '<span class="badge badge-blue">Expédié</span>',
    'in_transit': '<span class="badge badge-orange">En transit</span>',
    'received_relay': '<span class="badge badge-purple">Reçu relais</span>',
    'available': '<span class="badge badge-green">Disponible</span>',
    'collected': '<span class="badge badge-green">Collecté</span>',
    'returned': '<span class="badge badge-red">Retourné</span>',
    'lost': '<span class="badge badge-red">Perdu</span>'
  };
  return map[status] || `<span class="badge badge-gray">${status || '?'}</span>`;
}

function getIncidentBadge(type) {
  const map = {
    'missing_item': '📦 Article manquant',
    'surplus': '📦 Surplus',
    'weight_mismatch': '⚖️ Poids incohérent',
    'damaged': '💥 Endommagé',
    'wrong_item': '🔄 Mauvais article',
    'delayed': '⏰ Retard',
    'stuck_parcel': '🚫 Colis bloqué',
    'sla_breach': '🚨 SLA dépassé',
    'cash_pending': '💰 Cash en attente',
    'margin_alert': '📊 Alerte marge'
  };
  return map[type] || type;
}

function getSeverityClass(severity) {
  return {
    'critical': 'severity-critical',
    'high': 'severity-high', 
    'medium': 'severity-medium',
    'low': 'severity-low'
  }[severity] || 'severity-low';
}

// ---- VUE INCIDENTS ----
window.renderIncidentsView = async function(container) {
  container.innerHTML = '<h2>⚠️ Incidents</h2><p>⏳ Chargement...</p>';
  try {
    let incidents = [];
    try {
      const resp = await CT.api.get('/api/v2/incidents');
      incidents = resp.incidents || resp || [];
    } catch(e) {
      // Fallback: direct DB via dashboard ops
      try {
        const ops = await CT.api.get('/api/dashboard/ops');
        incidents = ops.incidents || [];
      } catch(e2) {}
    }

    if (!incidents.length) {
      container.innerHTML = `<h2>⚠️ Incidents</h2>
        <div class="empty-state">
          <p>🎉 Aucun incident en cours</p>
          <p style="color:#888">Les incidents apparaîtront ici quand le système en détectera</p>
        </div>`;
      return;
    }

    // Stats
    const open = incidents.filter(i => i.status === 'open').length;
    const investigating = incidents.filter(i => i.status === 'investigating').length;
    const resolved = incidents.filter(i => i.status === 'resolved').length;

    const rows = incidents.map(inc => {
      const date = inc.created_at ? new Date(inc.created_at).toLocaleDateString('fr-FR') : '—';
      const sevClass = getSeverityClass(inc.severity);
      const statusIcon = {open:'🔴', investigating:'🟡', resolved:'✅', dismissed:'⚪'}[inc.status] || '❓';
      return `<tr class="${sevClass}" style="cursor:pointer" onclick="renderParcelDrillDown('${inc.parcel_reference || ""}')">
        <td><strong>${inc.client_name || '—'}</strong><br><small>📋 ${inc.order_reference || '—'} ${inc.client_phone ? '📞 ' + inc.client_phone : ''}</small></td>
        <td>${getIncidentBadge(inc.incident_type)}</td>
        <td><span class="${sevClass}">${(inc.severity||'').toUpperCase()}</span></td>
        <td>${statusIcon} ${inc.status}</td>
        <td>📦 ${inc.parcel_reference || '—'}</td>
        <td>${inc.description || '—'}</td>
        <td>${date}</td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <h2>⚠️ Incidents</h2>
      <div class="stats-row">
        <div class="stat-card stat-red"><span class="stat-num">${open}</span><span class="stat-label">🔴 Ouverts</span></div>
        <div class="stat-card stat-orange"><span class="stat-num">${investigating}</span><span class="stat-label">🟡 Investigation</span></div>
        <div class="stat-card stat-green"><span class="stat-num">${resolved}</span><span class="stat-label">✅ Résolus</span></div>
        <div class="stat-card"><span class="stat-num">${incidents.length}</span><span class="stat-label">📊 Total</span></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Client</th><th>Type</th><th>Sévérité</th><th>Statut</th><th>Colis</th><th>Description</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">💡 Cliquez sur un incident pour voir le détail du colis</p>`;
  } catch(err) {
    container.innerHTML = `<h2>⚠️ Incidents</h2><p class="error">❌ ${err.message}</p>`;
  }
};

// ---- VUE RÉCONCILIATION ----
window.renderReconciliationView = async function(container) {
  container.innerHTML = '<h2>🔄 Réconciliation</h2><p>⏳ Chargement...</p>';
  try {
    let recoData = {};
    try {
      recoData = await CT.api.get('/api/v2/reconciliation/summary');
    } catch(e) {
      try {
        const ops = await CT.api.get('/api/dashboard/ops');
        recoData = ops.reconciliation || ops;
      } catch(e2) {}
    }

    const summary = recoData.summary || recoData;
    const mismatches = recoData.mismatches || [];
    
    const totalParcels = summary.total_parcels || summary.colis_total || 0;
    const reconciled = summary.reconciled || summary.colis_reconcilied || 0;
    const pending = summary.pending || (totalParcels - reconciled);
    const withIssues = summary.with_issues || mismatches.length;
    const rate = totalParcels > 0 ? Math.round((reconciled / totalParcels) * 100) : 0;

    // Progress bar color
    const barColor = rate >= 90 ? '#22c55e' : rate >= 70 ? '#f59e0b' : '#ef4444';

    // Mismatches table
    const mismatchRows = mismatches.map(m => {
      return `<tr onclick="renderParcelDrillDown('${m.id}')" style="cursor:pointer">
        <td>📦 #${m.parcel_id}</td>
        <td>${m.type || m.mismatch_type || '—'}</td>
        <td>${m.expected || '—'}</td>
        <td>${m.actual || '—'}</td>
        <td>${m.description || '—'}</td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <h2>🔄 Réconciliation</h2>
      <div class="stats-row">
        <div class="stat-card"><span class="stat-num">${totalParcels}</span><span class="stat-label">📦 Total colis</span></div>
        <div class="stat-card stat-green"><span class="stat-num">${reconciled}</span><span class="stat-label">✅ Réconciliés</span></div>
        <div class="stat-card stat-orange"><span class="stat-num">${pending}</span><span class="stat-label">⏳ En attente</span></div>
        <div class="stat-card stat-red"><span class="stat-num">${withIssues}</span><span class="stat-label">⚠️ Anomalies</span></div>
      </div>
      <div class="progress-section">
        <h3>Taux de réconciliation : ${rate}%</h3>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${rate}%;background:${barColor}"></div>
        </div>
      </div>
      ${mismatches.length ? `
        <h3 style="margin-top:1.5rem">⚠️ Anomalies détectées</h3>
        <table class="data-table">
          <thead><tr><th>Colis</th><th>Type</th><th>Attendu</th><th>Réel</th><th>Détail</th></tr></thead>
          <tbody>${mismatchRows}</tbody>
        </table>
        <p class="hint">💡 Cliquez sur un colis pour voir le détail</p>
      ` : '<p style="margin-top:1rem;color:#22c55e">✅ Aucune anomalie détectée</p>'}`;
  } catch(err) {
    container.innerHTML = `<h2>🔄 Réconciliation</h2><p class="error">❌ ${err.message}</p>`;
  }
};

// ---- VUE ALERTES ----
window.renderAlertsView = async function(container) {
  container.innerHTML = '<h2>🚨 Alertes</h2><p>⏳ Chargement...</p>';
  try {
    let alerts = [];
    try {
      const resp = await CT.api.get('/api/v2/alerts');
      alerts = resp.alerts || resp || [];
    } catch(e) {
      try {
        const ops = await CT.api.get('/api/dashboard/ops');
        alerts = ops.alerts || [];
      } catch(e2) {}
    }

    if (!alerts.length) {
      container.innerHTML = `<h2>🚨 Alertes</h2>
        <div class="empty-state">
          <p>✅ Aucune alerte active</p>
          <p style="color:#888">Les alertes se déclenchent automatiquement (SLA, cash pending, colis bloqué...)</p>
        </div>`;
      return;
    }

    const active = alerts.filter(a => a.status === 'active' || !a.acknowledged_at);
    const acked = alerts.filter(a => a.status === 'acknowledged' || a.acknowledged_at);

    const rows = alerts.map(a => {
      const date = a.created_at ? new Date(a.created_at).toLocaleDateString('fr-FR') : '—';
      const isActive = !a.acknowledged_at && a.status !== 'acknowledged';
      const typeIcon = {
        'cash_pending_72h': '💰', 'stuck_parcel_7d': '🚫', 'sla_breach_21d': '🚨',
        'weight_mismatch': '⚖️', 'margin_alert': '📊', 'missing_item': '📦'
      }[a.alert_type] || '⚠️';
      
      return `<tr class="${isActive ? 'row-alert' : ''}" style="cursor:pointer" onclick="renderParcelDrillDown('${a.parcel_reference || a.order_reference || ""}')">
        <td>${isActive ? '🔴' : '✅'}</td>
        <td>${typeIcon} ${(a.alert_type || '').replace(/_/g, ' ')}</td>
        <td>${a.severity || '—'}</td>
        <td><strong>${a.customer || '—'}</strong><br><small>📋 ${a.order_reference || '—'} ${a.customer_phone ? '📞 ' + a.customer_phone : ''}</small></td>
        <td>${a.message || a.description || '—'}</td>
        <td>${date}</td>
        <td>${isActive ? '<button class="btn-sm" onclick="event.stopPropagation();ackAlert('+a.id+')">✓ Acquitter</button>' : '✅ OK'}</td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <h2>🚨 Alertes</h2>
      <div class="stats-row">
        <div class="stat-card stat-red"><span class="stat-num">${active.length}</span><span class="stat-label">🔴 Actives</span></div>
        <div class="stat-card stat-green"><span class="stat-num">${acked.length}</span><span class="stat-label">✅ Acquittées</span></div>
        <div class="stat-card"><span class="stat-num">${alerts.length}</span><span class="stat-label">📊 Total</span></div>
      </div>
      <table class="data-table">
        <thead><tr><th>État</th><th>Type</th><th>Sévérité</th><th>Client</th><th>Message</th><th>Date</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">💡 Cliquez sur une alerte pour voir le détail du colis</p>`;
  } catch(err) {
    container.innerHTML = `<h2>🚨 Alertes</h2><p class="error">❌ ${err.message}</p>`;
  }
};

// Acknowledge alert
window.ackAlert = async function(alertId) {
  try {
    await CT.api.post(`/api/v2/alerts/${alertId}/acknowledge`);
    // Refresh view
    const container = document.getElementById('main-content');
    if (container) renderAlertsView(container);
  } catch(err) {
    alert('Erreur: ' + err.message);
  }
};

// ---- VUE FACTURES ----
window.renderInvoicesView = async function(container) {
  container.innerHTML = '<h2>🧾 Factures</h2><p>⏳ Chargement...</p>';
  try {
    let invoices = [];
    try {
      const resp = await CT.api.get('/api/v2/invoices');
      invoices = resp.invoices || resp || [];
    } catch(e) {}

    // Also fetch collected orders that might need invoices
    let collectedOrders = [];
    try {
      const ops = await CT.api.get('/api/dashboard/ops');
      // Get orders with collected status
      collectedOrders = (ops.recent_orders || []).filter(o => 
        o.status === 'collected' || o.status === 'delivered'
      );
    } catch(e) {}

    const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.total_kmf || 0), 0);
    const delivered = invoices.filter(i => i.delivered_at).length;
    const pending = invoices.filter(i => !i.delivered_at).length;

    // Invoice rows
    const rows = invoices.map(inv => {
      const date = inv.created_at ? new Date(inv.created_at).toLocaleDateString('fr-FR') : '—';
      const isDelivered = !!inv.delivered_at;
      return `<tr>
        <td><strong>${inv.invoice_number || inv.id}</strong></td>
        <td>#${inv.order_id}</td>
        <td>${inv.client_name || '—'}</td>
        <td style="text-align:right">${Number(inv.total_kmf || 0).toLocaleString('fr-FR')} KMF</td>
        <td>${inv.payment_mode === 'cash_relais' ? '💵 Cash' : '💳 Stripe'}</td>
        <td>${isDelivered ? '✅ Délivrée' : '⏳ En attente'}</td>
        <td>${date}</td>
        <td>
          <a href="/api/v2/invoices/${inv.id}" target="_blank" class="btn-sm">👁️ Voir</a>
          <a href="/api/v2/invoices/${inv.id}?mode=thermal" target="_blank" class="btn-sm">🖨️</a>
        </td>
      </tr>`;
    }).join('');

    // Uninvoiced collected orders
    const invoicedOrderIds = new Set(invoices.map(i => i.order_id));
    const uninvoiced = collectedOrders.filter(o => !invoicedOrderIds.has(o.id));
    const uninvoicedRows = uninvoiced.map(o => {
      return `<tr class="row-warn">
        <td>—</td>
        <td>#${o.id}</td>
        <td>${o.client_name || '—'}</td>
        <td style="text-align:right">${Number(o.total_kmf || 0).toLocaleString('fr-FR')} KMF</td>
        <td>${o.payment_mode === 'cash_relais' ? '💵 Cash' : '💳 Stripe'}</td>
        <td>⚠️ Non facturée</td>
        <td>—</td>
        <td><button class="btn-sm btn-primary" onclick="generateInvoice('${o.id}')">🧾 Générer</button></td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <h2>🧾 Factures</h2>
      <div class="stats-row">
        <div class="stat-card"><span class="stat-num">${invoices.length}</span><span class="stat-label">📄 Factures</span></div>
        <div class="stat-card stat-green"><span class="stat-num">${delivered}</span><span class="stat-label">✅ Délivrées</span></div>
        <div class="stat-card stat-orange"><span class="stat-num">${pending}</span><span class="stat-label">⏳ En attente</span></div>
        <div class="stat-card"><span class="stat-num">${totalInvoiced.toLocaleString('fr-FR')}</span><span class="stat-label">💰 Total KMF</span></div>
      </div>
      ${uninvoiced.length ? `
        <h3 style="margin-top:1.5rem;color:#f59e0b">⚠️ Commandes collectées sans facture (${uninvoiced.length})</h3>
        <table class="data-table">
          <thead><tr><th>N°</th><th>Cmd</th><th>Client</th><th>Montant</th><th>Paiement</th><th>Statut</th><th>Date</th><th>Action</th></tr></thead>
          <tbody>${uninvoicedRows}</tbody>
        </table>
      ` : ''}
      <h3 style="margin-top:1.5rem">📄 Toutes les factures</h3>
      ${invoices.length ? `
        <table class="data-table">
          <thead><tr><th>N°</th><th>Cmd</th><th>Client</th><th>Montant</th><th>Paiement</th><th>Statut</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      ` : '<p style="color:#888">Aucune facture générée pour le moment</p>'}`;
  } catch(err) {
    container.innerHTML = `<h2>🧾 Factures</h2><p class="error">❌ ${err.message}</p>`;
  }
};

// Generate invoice for an order
window.generateInvoice = async function(orderId) {
  try {
    // Opening invoice in new tab triggers generation
    window.open(`/api/invoices/${orderId}`, '_blank');
    // Refresh after a short delay
    setTimeout(() => {
      const container = document.getElementById('main-content');
      if (container) renderInvoicesView(container);
    }, 2000);
  } catch(err) {
    alert('Erreur: ' + err.message);
  }
};

console.log('[CT] ct-views-ops.js v5.2 loaded — Incidents, Réconciliation, Alertes, Factures + Parcel DrillDown');


// ---- REGISTER VIEWS IN CT.views ----
// Critical: ct-app.js only shows sidebar items if CT.views[id] exists
(function() {
  if (!window.CT) window.CT = {};
  if (!CT.views) CT.views = {};

  CT.views.incidents = {
    icon: '⚠️', label: 'Incidents',
    load: function(container) { renderIncidentsView(container); }
  };
  CT.views.reconciliation = {
    icon: '🔄', label: 'Réconciliation',
    load: function(container) { renderReconciliationView(container); }
  };
  CT.views.alertes = {
    icon: '🚨', label: 'Alertes',
    load: function(container) { renderAlertsView(container); }
  };
  CT.views.factures = {
    icon: '🧾', label: 'Factures',
    load: function(container) { renderInvoicesView(container); }
  };

  console.log('[CT] Ops views registered:', Object.keys(CT.views).filter(function(k) { return ['incidents','reconciliation','alertes','factures'].indexOf(k) >= 0; }));
})();
