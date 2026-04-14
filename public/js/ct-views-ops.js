/* ===================================================================
   Komerce Control Tower — ct-views-ops.js v1.0
   Vues opérationnelles Parcel-First :
   - Incidents (détection, résolution, impact client)
   - Réconciliation (cohérence commande ↔ colis ↔ scans)
   - Alertes (stuck, poids, SLA, anomalies)
   =================================================================== */
window.CT = window.CT || {};
CT.views = CT.views || {};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function severityBadge(s) {
  var colors = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#65a30d' };
  return '<span style="background:' + (colors[s] || '#6b7280') +
    ';color:#fff;padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600">' +
    s.toUpperCase() + '</span>';
}

function statusBadge(s) {
  var colors = {
    open: '#dc2626', investigating: '#d97706', resolved: '#16a34a', closed: '#6b7280',
    ok: '#16a34a', warning: '#d97706', error: '#dc2626', critical: '#dc2626',
    acknowledged: '#3b82f6'
  };
  return '<span style="background:' + (colors[s] || '#6b7280') +
    ';color:#fff;padding:2px 8px;border-radius:12px;font-size:0.75rem">' +
    (s || 'unknown') + '</span>';
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  var ms = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(ms / 60000);
  if (mins < 60) return mins + 'min';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'j';
}

function kpiCard(icon, label, value, color) {
  return '<div class="ct-kpi-card" style="border-left:4px solid ' + (color || '#6b7280') + '">' +
    '<div class="ct-kpi-value">' + icon + ' ' + value + '</div>' +
    '<div class="ct-kpi-label">' + label + '</div>' +
    '</div>';
}

// ═══════════════════════════════════════════════════════════════
// 1. VUE INCIDENTS — ⚠️
// ═══════════════════════════════════════════════════════════════

CT.views['incidents'] = {
  icon: '⚠️', label: 'Incidents',

  load: async function(container) {
    container.innerHTML = '<div class="ct-loading">⏳ Chargement des incidents...</div>';

    try {
      var data = await CT.api.getIncidents({ status: 'open,investigating' });
      var incidents = data.incidents || data.data || data || [];

      // KPIs
      var critical = incidents.filter(function(i) { return i.severity === 'critical'; }).length;
      var high = incidents.filter(function(i) { return i.severity === 'high'; }).length;
      var open = incidents.filter(function(i) { return i.status === 'open'; }).length;
      var investigating = incidents.filter(function(i) { return i.status === 'investigating'; }).length;

      var html = '<div class="ct-section">';
      html += '<h3>📊 Tableau de bord incidents</h3>';
      html += '<div class="ct-kpi-grid">';
      html += kpiCard('🔴', 'Critiques', critical, '#dc2626');
      html += kpiCard('🟠', 'Haute priorité', high, '#ea580c');
      html += kpiCard('🟡', 'Ouverts', open, '#d97706');
      html += kpiCard('🔍', 'En investigation', investigating, '#3b82f6');
      html += '</div></div>';

      // Actions requises
      var actionable = incidents.filter(function(i) {
        return i.severity === 'critical' || i.severity === 'high';
      });

      if (actionable.length > 0) {
        html += '<div class="ct-section ct-alert-banner" style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">';
        html += '<h3>🚨 Actions requises (' + actionable.length + ')</h3>';
        html += '<p style="color:#991b1b;margin-bottom:12px">Ces incidents nécessitent une intervention immédiate.</p>';
        actionable.forEach(function(inc) {
          html += '<div style="background:#fff;border:1px solid #fecaca;border-radius:6px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">';
          html += '<div>';
          html += severityBadge(inc.severity) + ' ';
          html += '<strong>' + (inc.type || '').replace(/_/g, ' ') + '</strong>';
          html += ' — Colis <code>' + (inc.parcel_ref || inc.parcel_id || '?') + '</code>';
          if (inc.description) html += '<br><small style="color:#6b7280">' + inc.description + '</small>';
          html += '</div>';
          html += '<div>';
          html += '<button class="ct-btn ct-btn-sm" onclick="CT.views.incidents.resolve(\'' + inc.id + '\')">✅ Résoudre</button>';
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      // Liste complète
      html += '<div class="ct-section">';
      html += '<h3>📋 Tous les incidents ouverts (' + incidents.length + ')</h3>';

      if (incidents.length === 0) {
        html += '<div style="text-align:center;padding:40px;color:#6b7280">✅ Aucun incident ouvert — tout est nominal !</div>';
      } else {
        html += '<table class="ct-table"><thead><tr>';
        html += '<th>Sévérité</th><th>Type</th><th>Colis</th><th>Commande</th>';
        html += '<th>Description</th><th>Créé</th><th>Statut</th><th>Action</th>';
        html += '</tr></thead><tbody>';

        incidents.forEach(function(inc) {
          html += '<tr>';
          html += '<td>' + severityBadge(inc.severity) + '</td>';
          html += '<td>' + (inc.type || '').replace(/_/g, ' ') + '</td>';
          html += '<td><code class="ct-clickable-parcel" data-ref="' + (inc.parcel_ref || '') + '">' + (inc.parcel_ref || '—') + '</code></td>';
          html += '<td>' + (inc.order_ref || '—') + '</td>';
          html += '<td style="max-width:300px">' + (inc.description || '—') + '</td>';
          html += '<td>' + timeAgo(inc.created_at) + '</td>';
          html += '<td>' + statusBadge(inc.status) + '</td>';
          html += '<td><button class="ct-btn ct-btn-sm" onclick="CT.views.incidents.resolve(\'' + inc.id + '\')">Résoudre</button></td>';
          html += '</tr>';
        });

        html += '</tbody></table>';
      }
      html += '</div>';

      // Types d'incidents
      html += '<div class="ct-section">';
      html += '<h3>📊 Par type</h3>';
      html += '<div class="ct-kpi-grid">';
      var types = {};
      incidents.forEach(function(i) { types[i.type] = (types[i.type] || 0) + 1; });
      Object.keys(types).forEach(function(t) {
        var icons = { content_mismatch: '📦', scan_anomaly: '📡', delay: '⏰', blocked: '🚫', payment_issue: '💳', reconciliation_error: '🔄' };
        html += kpiCard(icons[t] || '❓', t.replace(/_/g, ' '), types[t], '#6b7280');
      });
      html += '</div></div>';

      container.innerHTML = html;

      // Wire clickable parcels
      container.querySelectorAll('.ct-clickable-parcel').forEach(function(el) {
        el.style.cursor = 'pointer';
        el.style.textDecoration = 'underline';
        el.addEventListener('click', function() {
          if (CT.showParcelTrace) CT.showParcelTrace(el.dataset.ref);
        });
      });

    } catch(err) {
      container.innerHTML = '<div class="ct-error">❌ Erreur chargement incidents: ' + err.message + '</div>';
    }
  },

  resolve: async function(id) {
    var reason = prompt('Raison de la résolution :');
    if (!reason) return;
    var action = prompt('Action effectuée (reship / refund / manual_fix / no_action) :', 'manual_fix');
    try {
      await CT.api.resolveIncident(id, {
        resolution_type: action || 'manual_fix',
        resolution_notes: reason,
        resolved_by_name: 'Admin CT'
      });
      CT.bus.emit('toast', '✅ Incident résolu', 'success');
      CT.navigate('incidents');
    } catch(err) {
      CT.bus.emit('toast', '❌ ' + err.message, 'error');
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// 2. VUE RÉCONCILIATION — 🔄
// ═══════════════════════════════════════════════════════════════

CT.views['reconciliation'] = {
  icon: '🔄', label: 'Réconciliation',

  load: async function(container) {
    container.innerHTML = '<div class="ct-loading">⏳ Chargement rapport réconciliation...</div>';

    try {
      var report = await CT.api.getReconciliationReport();

      var html = '<div class="ct-section">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center">';
      html += '<h3>🔄 Réconciliation système</h3>';
      html += '<button class="ct-btn" onclick="CT.views.reconciliation.runNow()">▶️ Lancer réconciliation</button>';
      html += '</div>';

      // Santé globale
      var checks = report.checks || report.results || [];
      var passed = checks.filter(function(c) { return c.status === 'ok'; }).length;
      var failed = checks.filter(function(c) { return c.status !== 'ok'; }).length;
      var health = failed === 0 ? 'healthy' : (failed <= 2 ? 'warning' : 'critical');
      var healthIcons = { healthy: '✅', warning: '⚠️', critical: '🔴' };
      var healthColors = { healthy: '#16a34a', warning: '#d97706', critical: '#dc2626' };

      html += '<div style="text-align:center;padding:24px;margin:16px 0;background:' +
        (health === 'healthy' ? '#f0fdf4' : health === 'warning' ? '#fffbeb' : '#fef2f2') +
        ';border-radius:12px;border:2px solid ' + healthColors[health] + '">';
      html += '<div style="font-size:3rem">' + healthIcons[health] + '</div>';
      html += '<div style="font-size:1.5rem;font-weight:700;color:' + healthColors[health] + '">';
      html += health === 'healthy' ? 'Système cohérent' : failed + ' anomalie(s) détectée(s)';
      html += '</div>';
      html += '<div style="color:#6b7280;margin-top:4px">' + passed + '/' + checks.length + ' vérifications OK</div>';
      html += '</div>';

      // Détail des checks
      html += '<div class="ct-section"><h3>📋 Détail des vérifications</h3>';
      html += '<table class="ct-table"><thead><tr>';
      html += '<th>Check</th><th>Statut</th><th>Détails</th><th>Items</th>';
      html += '</tr></thead><tbody>';

      checks.forEach(function(check) {
        html += '<tr style="' + (check.status !== 'ok' ? 'background:#fef2f2' : '') + '">';
        html += '<td><strong>' + (check.name || check.check || '?') + '</strong></td>';
        html += '<td>' + statusBadge(check.status) + '</td>';
        html += '<td>' + (check.message || check.description || '—') + '</td>';
        html += '<td>' + (check.count || check.items_count || 0) + '</td>';
        html += '</tr>';

        // Show detail items for failed checks
        if (check.status !== 'ok' && check.items && check.items.length > 0) {
          check.items.slice(0, 5).forEach(function(item) {
            html += '<tr style="background:#fff5f5;font-size:0.85rem">';
            html += '<td></td>';
            html += '<td>↳</td>';
            html += '<td colspan="2">';
            if (item.parcel_ref) html += 'Colis: <code>' + item.parcel_ref + '</code> ';
            if (item.order_ref) html += 'Commande: <code>' + item.order_ref + '</code> ';
            if (item.message) html += '— ' + item.message;
            html += '</td></tr>';
          });
        }
      });

      html += '</tbody></table></div>';

      // Dernière exécution
      if (report.last_run || report.executed_at) {
        html += '<div style="text-align:center;color:#6b7280;padding:8px">';
        html += '🕐 Dernière exécution : ' + new Date(report.last_run || report.executed_at).toLocaleString('fr-FR');
        html += '</div>';
      }

      html += '</div>';
      container.innerHTML = html;

    } catch(err) {
      container.innerHTML = '<div class="ct-error">❌ Erreur réconciliation: ' + err.message + '</div>';
    }
  },

  runNow: async function() {
    try {
      CT.bus.emit('toast', '⏳ Réconciliation en cours...', 'info');
      await CT.api.runReconciliation();
      CT.bus.emit('toast', '✅ Réconciliation terminée', 'success');
      CT.navigate('reconciliation');
    } catch(err) {
      CT.bus.emit('toast', '❌ ' + err.message, 'error');
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// 3. VUE ALERTES — 🚨
// ═══════════════════════════════════════════════════════════════

CT.views['alerts'] = {
  icon: '🚨', label: 'Alertes',

  load: async function(container) {
    container.innerHTML = '<div class="ct-loading">⏳ Chargement des alertes...</div>';

    try {
      var data = await CT.api.getAlerts();
      var alerts = data.alerts || data.data || data || [];

      // KPIs
      var active = alerts.filter(function(a) { return a.status !== 'acknowledged'; }).length;
      var stuck = alerts.filter(function(a) { return a.type === 'stuck_parcel'; }).length;
      var weight = alerts.filter(function(a) { return a.type === 'weight_mismatch'; }).length;
      var sla = alerts.filter(function(a) { return a.type === 'sla_breach'; }).length;

      var html = '<div class="ct-section">';
      html += '<h3>🚨 Alertes terrain</h3>';
      html += '<div class="ct-kpi-grid">';
      html += kpiCard('🔔', 'Alertes actives', active, '#dc2626');
      html += kpiCard('🧊', 'Colis bloqués', stuck, '#6366f1');
      html += kpiCard('⚖️', 'Poids incohérent', weight, '#d97706');
      html += kpiCard('⏱️', 'SLA dépassé', sla, '#ea580c');
      html += '</div></div>';

      // Liste
      html += '<div class="ct-section">';

      if (alerts.length === 0) {
        html += '<div style="text-align:center;padding:40px;color:#6b7280">✅ Aucune alerte — le terrain est calme !</div>';
      } else {
        html += '<table class="ct-table"><thead><tr>';
        html += '<th>Type</th><th>Sévérité</th><th>Colis</th><th>Message</th>';
        html += '<th>Détecté</th><th>Statut</th><th>Action</th>';
        html += '</tr></thead><tbody>';

        alerts.forEach(function(alert) {
          var typeIcons = {
            stuck_parcel: '🧊', weight_mismatch: '⚖️', sla_breach: '⏱️',
            scan_anomaly: '📡', unverified: '❓', payment_blocked: '💳'
          };
          html += '<tr>';
          html += '<td>' + (typeIcons[alert.type] || '⚠️') + ' ' + (alert.type || '').replace(/_/g, ' ') + '</td>';
          html += '<td>' + severityBadge(alert.severity || 'medium') + '</td>';
          html += '<td><code class="ct-clickable-parcel" data-ref="' + (alert.parcel_ref || '') + '">' + (alert.parcel_ref || '—') + '</code></td>';
          html += '<td>' + (alert.message || '—') + '</td>';
          html += '<td>' + timeAgo(alert.created_at || alert.detected_at) + '</td>';
          html += '<td>' + statusBadge(alert.status || 'open') + '</td>';
          html += '<td>';
          if (alert.status !== 'acknowledged') {
            html += '<button class="ct-btn ct-btn-sm" onclick="CT.views.alerts.ack(\'' + alert.id + '\')">✓ Vu</button>';
          } else {
            html += '<span style="color:#6b7280">Acquitté</span>';
          }
          html += '</td></tr>';
        });

        html += '</tbody></table>';
      }
      html += '</div>';

      container.innerHTML = html;

      // Wire clickable parcels
      container.querySelectorAll('.ct-clickable-parcel').forEach(function(el) {
        el.style.cursor = 'pointer';
        el.style.textDecoration = 'underline';
        el.addEventListener('click', function() {
          if (CT.showParcelTrace) CT.showParcelTrace(el.dataset.ref);
        });
      });

    } catch(err) {
      container.innerHTML = '<div class="ct-error">❌ Erreur alertes: ' + err.message + '</div>';
    }
  },

  ack: async function(id) {
    try {
      await CT.api.acknowledgeAlert(id);
      CT.bus.emit('toast', '✅ Alerte acquittée', 'success');
      CT.navigate('alerts');
    } catch(err) {
      CT.bus.emit('toast', '❌ ' + err.message, 'error');
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// 4. MODAL TRAÇABILITÉ — accessible depuis toutes les vues
// ═══════════════════════════════════════════════════════════════

CT.showParcelTrace = async function(parcelRef) {
  if (!parcelRef) return;

  // Create modal overlay
  var overlay = document.createElement('div');
  overlay.className = 'ct-modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:12px;max-width:800px;width:90%;max-height:85vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3)';
  modal.innerHTML = '<div style="text-align:center;padding:40px">⏳ Chargement traçabilité...</div>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  try {
    var trace = await CT.api.parcelTrace(parcelRef);
    var p = trace.parcel || trace;
    var timeline = trace.timeline || trace.scan_events || [];
    var items = trace.items || trace.parcel_items || [];
    var incidents = trace.incidents || [];

    var h = '';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    h += '<h2 style="margin:0">📦 Colis ' + (p.reference || parcelRef) + '</h2>';
    h += '<button onclick="this.closest(\'.ct-modal-overlay\').remove()" style="font-size:1.5rem;background:none;border:none;cursor:pointer">✕</button>';
    h += '</div>';

    // Status bar
    var statusColors = {
      draft: '#6b7280', preparation: '#3b82f6', packed: '#8b5cf6',
      shipped: '#d97706', in_transit: '#0891b2', available: '#16a34a',
      collected: '#059669', cancelled: '#dc2626'
    };
    h += '<div style="background:' + (statusColors[p.status] || '#6b7280') +
      ';color:#fff;padding:12px;border-radius:8px;text-align:center;font-weight:700;font-size:1.1rem;margin-bottom:16px">';
    h += (p.status || '?').toUpperCase();
    if (p.verification_status && p.verification_status !== 'pending') {
      h += ' — Vérifié: ' + p.verification_status;
    }
    h += '</div>';

    // Info grid
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
    h += '<div><strong>Commande:</strong> ' + (p.order_ref || p.order_reference || '—') + '</div>';
    h += '<div><strong>Relais:</strong> ' + (p.relais_name || '—') + '</div>';
    h += '<div><strong>Poids attendu:</strong> ' + (p.expected_weight_kg || '—') + ' kg</div>';
    h += '<div><strong>Poids réel:</strong> ' + (p.actual_weight_kg || '—') + ' kg</div>';
    h += '<div><strong>Articles:</strong> ' + (p.items_count || items.length) + '</div>';
    h += '<div><strong>Qty totale:</strong> ' + (p.total_qty || '—') + '</div>';
    h += '</div>';

    // Articles
    if (items.length > 0) {
      h += '<h3 style="margin:16px 0 8px">📋 Articles dans le colis</h3>';
      h += '<table class="ct-table" style="font-size:0.9rem"><thead><tr>';
      h += '<th>Produit</th><th>Qté allouée</th><th>Emballée</th><th>Expédiée</th><th>Reçue</th><th>Collectée</th><th>Vérifié</th>';
      h += '</tr></thead><tbody>';
      items.forEach(function(item) {
        h += '<tr>';
        h += '<td>' + (item.product_name || item.name || '?') + '</td>';
        h += '<td>' + (item.qty_allocated || item.quantity || 0) + '</td>';
        h += '<td>' + (item.qty_packed || 0) + '</td>';
        h += '<td>' + (item.qty_shipped || 0) + '</td>';
        h += '<td>' + (item.qty_received || 0) + '</td>';
        h += '<td>' + (item.qty_collected || 0) + '</td>';
        h += '<td>' + (item.verified ? '✅' : '⬜') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }

    // Timeline
    if (timeline.length > 0) {
      h += '<h3 style="margin:16px 0 8px">📡 Timeline des scans</h3>';
      h += '<div style="border-left:3px solid #3b82f6;padding-left:16px">';
      timeline.forEach(function(evt) {
        var evtColor = evt.status === 'reversed' ? '#dc2626' : evt.status === 'rejected' ? '#d97706' : '#3b82f6';
        h += '<div style="margin-bottom:12px;position:relative">';
        h += '<div style="position:absolute;left:-24px;top:4px;width:12px;height:12px;border-radius:50%;background:' + evtColor + '"></div>';
        h += '<div><strong>' + (evt.event_type || '?') + '</strong>';
        if (evt.status && evt.status !== 'applied') h += ' <small>(' + evt.status + ')</small>';
        h += '</div>';
        h += '<div style="color:#6b7280;font-size:0.85rem">';
        h += new Date(evt.created_at).toLocaleString('fr-FR');
        if (evt.actor_name) h += ' — ' + evt.actor_name;
        if (evt.location) h += ' @ ' + evt.location;
        h += '</div>';
        if (evt.notes) h += '<div style="color:#374151;font-size:0.85rem;font-style:italic">' + evt.notes + '</div>';
        h += '</div>';
      });
      h += '</div>';
    }

    // Incidents liés
    if (incidents.length > 0) {
      h += '<h3 style="margin:16px 0 8px">⚠️ Incidents liés (' + incidents.length + ')</h3>';
      incidents.forEach(function(inc) {
        h += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px;margin-bottom:6px">';
        h += severityBadge(inc.severity) + ' ' + statusBadge(inc.status);
        h += ' <strong>' + (inc.type || '').replace(/_/g, ' ') + '</strong>';
        if (inc.description) h += '<br><small>' + inc.description + '</small>';
        h += '</div>';
      });
    }

    modal.innerHTML = h;

  } catch(err) {
    modal.innerHTML = '<div style="padding:40px;text-align:center">' +
      '<div style="font-size:2rem">❌</div>' +
      '<p>Erreur: ' + err.message + '</p>' +
      '<button onclick="this.closest(\'.ct-modal-overlay\').remove()" class="ct-btn">Fermer</button></div>';
  }
};
