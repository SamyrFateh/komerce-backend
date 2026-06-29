/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-transitaire
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/* ===================================================================
   Komerce Control Tower — ct-views-transitaire.js
   Transitaire dashboard: ship parcels from Hub → Transit
   =================================================================== */
window.CT = window.CT || {};
CT.views = CT.views || {};

// ── API helpers ──
CT.api.transitaireParcels = function() {
  return fetch('/api/transitaire/parcels', { credentials: 'include' }).then(function(r) { return r.json(); });
};
CT.api.transitaireShip = function(parcelId, notes) {
  return fetch('/api/transitaire/ship', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parcel_id: parcelId, notes: notes || '' })
  }).then(function(r) { return r.json(); });
};
CT.api.transitaireStats = function() {
  return fetch('/api/transitaire/stats', { credentials: 'include' }).then(function(r) { return r.json(); });
};
CT.api.transitaireHistory = function() {
  return fetch('/api/transitaire/history', { credentials: 'include' }).then(function(r) { return r.json(); });
};
CT.api.hubInventoryStats = function() {
  return fetch('/api/hub/inventory/stats', { credentials: 'include' }).then(function(r) { return r.json(); });
};
CT.api.hubBuffer = function() {
  return fetch('/api/hub/inventory/buffer', { credentials: 'include' }).then(function(r) { return r.json(); });
};

// ════════════════════════════════════════════════════════════════
// TRANSITAIRE VIEW
// ════════════════════════════════════════════════════════════════

CT.views.transitaire = async function(main) {
  main.innerHTML = '<div class="ct-loading">Chargement Transitaire...</div>';

  try {
    var data = await Promise.all([
      CT.api.transitaireStats(),
      CT.api.transitaireParcels()
    ]);
    var stats = data[0];
    var parcelsData = data[1];
    var parcels = parcelsData.parcels || [];

    var html = '';

    // ── KPI Badges ──
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">';
    html += kpiBadge('📦', stats.ready_to_ship || 0, 'À expédier', '#3b82f6');
    html += kpiBadge('✈️', stats.in_transit || 0, 'En transit', '#f59e0b');
    html += kpiBadge('⚖️', (stats.total_weight_shipped || 0) + 'kg', 'Poids total', '#8b5cf6');
    html += kpiBadge('⏱️', (stats.avg_wait_hours || 0) + 'h', 'Attente moy.', '#06b6d4');
    if ((stats.overdue_shipments || 0) > 0) {
      html += kpiBadge('🚨', stats.overdue_shipments, 'Retard >48h', '#ef4444');
    }
    html += '</div>';

    // ── Parcels Table ──
    html += '<div class="ct-card">';
    html += '<div class="ct-card-title">📦 Colis prêts à expédier <button id="btn-transitaire-refresh" class="ct-btn ct-btn-sm ct-btn-outline">🔄</button></div>';

    if (parcels.length === 0) {
      html += '<div class="ct-empty"><div class="ct-empty-icon">✈️</div>Aucun colis en attente de transit</div>';
    } else {
      // Select all / ship all
      html += '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">';
      html += '<button id="btn-ship-all" class="ct-btn ct-btn-sm ct-btn-primary">✈️ Expédier tous (' + parcels.length + ')</button>';
      html += '</div>';

      html += '<div class="ct-table-wrap"><table class="ct-table">';
      html += '<thead><tr><th>Colis</th><th>Commande</th><th>Client</th><th>Destination</th><th>Articles</th><th>Poids</th><th>Depuis</th><th>Action</th></tr></thead>';
      html += '<tbody>';

      for (var i = 0; i < parcels.length; i++) {
        var p = parcels[i];
        var age = p.shipped_at ? timeSince(p.shipped_at) : '-';
        html += '<tr id="tr-pcl-' + p.id + '">';
        html += '<td><strong>' + (p.reference || '-') + '</strong></td>';
        html += '<td>' + (p.order_ref || '-') + '</td>';
        html += '<td>' + (p.customer_name || '-') + '</td>';
        html += '<td>' + (p.destination_island || '-') + (p.relais_name ? ' · ' + p.relais_name : '') + '</td>';
        html += '<td>' + (p.nb_items || 0) + '</td>';
        html += '<td>' + (p.weight_kg || '-') + ' kg</td>';
        html += '<td>' + age + '</td>';
        html += '<td><button class="ct-btn ct-btn-sm ct-btn-success" data-act="ship-one" data-id="' + p.id + '" data-ref="' + (p.reference || '') + '">✈️</button></td>';
        html += '</tr>';
      }

      html += '</tbody></table></div>';
    }
    html += '</div>';

    // ── Recent History ──
    html += '<div class="ct-card" style="margin-top:16px">';
    html += '<div class="ct-card-title">📜 Derniers transits</div>';
    html += '<div id="transit-history"><div class="ct-loading">Chargement...</div></div>';
    html += '</div>';

    main.innerHTML = html;

    // ── Wire event handlers ────────────────────────────────────
    var refreshBtn = document.getElementById('btn-transitaire-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function() { CT.views.transitaire(document.getElementById('ct-main')); });
    var shipAllBtn = document.getElementById('btn-ship-all');
    if (shipAllBtn) shipAllBtn.addEventListener('click', function() { CT.views._transitaireShipAll(); });
    main.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-act="ship-one"]');
      if (btn) CT.views._transitaireShipOne(btn.dataset.id, btn.dataset.ref);
    });

    // Load history async
    CT.api.transitaireHistory().then(function(hdata) {
      var hEl = document.getElementById('transit-history');
      if (!hEl) return;
      var events = hdata.events || [];
      if (events.length === 0) {
        hEl.innerHTML = '<div class="ct-empty">Aucun transit récent</div>';
        return;
      }
      var h = '<div class="ct-table-wrap"><table class="ct-table"><thead><tr><th>Colis</th><th>Commande</th><th>Par</th><th>Date</th><th>Notes</th></tr></thead><tbody>';
      for (var j = 0; j < Math.min(events.length, 20); j++) {
        var ev = events[j];
        h += '<tr><td><strong>' + (ev.parcel_ref || '-') + '</strong></td>';
        h += '<td>' + (ev.order_ref || '-') + '</td>';
        h += '<td>' + (ev.actor_name || '-') + '</td>';
        h += '<td>' + new Date(ev.created_at).toLocaleString('fr-FR') + '</td>';
        h += '<td class="ct-muted">' + (ev.notes || '-') + '</td></tr>';
      }
      h += '</tbody></table></div>';
      hEl.innerHTML = h;
    }).catch(function() {
      var hEl = document.getElementById('transit-history');
      if (hEl) hEl.innerHTML = '<div class="ct-muted">Erreur chargement historique</div>';
    });

  } catch (err) {
    main.innerHTML = '<div class="ct-error">❌ Erreur: ' + err.message + '</div>';
  }
};

// ── Ship one parcel ──
CT.views._transitaireShipOne = async function(parcelId, parcelRef) {
  if (!confirm('Confirmer transit pour ' + (parcelRef || parcelId) + ' ?')) return;
  var row = document.getElementById('tr-pcl-' + parcelId);
  try {
    var result = await CT.api.transitaireShip(parcelId);
    if (result.success) {
      if (row) row.style.background = '#d1fae5';
      setTimeout(function() { if (row) row.remove(); }, 1500);
      if (typeof CT.toast === 'function') CT.toast('✈️ ' + (parcelRef || 'Colis') + ' en transit !', 'success');
    } else {
      alert('❌ ' + (result.error || 'Erreur'));
    }
  } catch (err) {
    alert('❌ ' + err.message);
  }
};

// ── Ship all parcels ──
CT.views._transitaireShipAll = async function() {
  var rows = document.querySelectorAll('[id^="tr-pcl-"]');
  if (rows.length === 0) return;
  if (!confirm('Expédier ' + rows.length + ' colis en transit ?')) return;

  var success = 0;
  var errors = 0;
  for (var i = 0; i < rows.length; i++) {
    var id = rows[i].id.replace('tr-pcl-', '');
    try {
      var result = await CT.api.transitaireShip(id);
      if (result.success) {
        rows[i].style.background = '#d1fae5';
        success++;
      } else { errors++; }
    } catch (_) { errors++; }
  }

  alert('✈️ ' + success + ' colis expédiés' + (errors > 0 ? ' · ' + errors + ' erreurs' : ''));
  CT.views.transitaire(document.getElementById('ct-main'));
};

// ── Helpers ──
function kpiBadge(emoji, value, label, color) {
  return '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:' + color + '15;border:1px solid ' + color + '30;border-radius:8px;font-size:0.85rem">' +
    '<span>' + emoji + '</span>' +
    '<strong style="color:' + color + '">' + value + '</strong>' +
    '<span style="color:#64748b">' + label + '</span></div>';
}

function timeSince(dateStr) {
  var diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 3600) return Math.floor(diff / 60) + 'min';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'j';
}
