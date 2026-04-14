/**
 * ═══════════════════════════════════════════════════════════════════════
 * CONTROL TOWER v6 — VIEWS COLIS-FIRST
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Toutes les vues de la Control Tower, pilotées par COLIS.
 * Utilise ParcelUI (parcel-components.js) pour le rendu.
 * API: /api/v2/parcels (parcel-api-v2.js)
 * 
 * Vues:
 *   1. Global — KPIs + funnel colis
 *   2. Colis — Liste complète avec filtres
 *   3. Critiques — File colis critiques
 *   4. Réconciliation — Vérification cohérence
 *   5. Alertes — Alertes calculées
 *   6. Incidents — Incidents par colis
 *   7. Commandes — Vue secondaire (toujours liée au colis)
 *   8. Finances — CA, paiements
 *   9. Factures — Liste factures
 *  10. Notifications — Notifications
 *  11. Tests — Scénarios
 * ═══════════════════════════════════════════════════════════════════════
 */

// Ensure CT namespace
window.CT = window.CT || {};
CT.views = CT.views || {};

// ═══════════════════════════════════════════════════════════════════════
// 1. VUE GLOBAL — KPIs + Funnel
// ═══════════════════════════════════════════════════════════════════════

CT.views.global = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280;font-size:16px">⏳ Chargement du tableau de bord...</div>';

  try {
    const kpis = await CT.api.get('/api/v2/parcels/kpis');
    
    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 20px">📊 Tableau de bord — Vue colis</h2>
        <div id="kpis-container"></div>
        
        <div style="margin-top:24px">
          <h3 style="font-size:18px;font-weight:700;margin:0 0 12px">📦 Derniers colis actifs</h3>
          <div id="recent-parcels"></div>
        </div>
      </div>
    `;
    
    ParcelUI.renderKPIs('kpis-container', kpis);
    
    // Load recent active parcels
    const { parcels } = await CT.api.get('/api/v2/parcels?sort=created_at&order=desc');
    const active = parcels.filter(p => !['collected', 'cancelled'].includes(p.status)).slice(0, 8);
    ParcelUI.renderParcelList('recent-parcels', active, {
      onClick: 'ParcelUI.openDetail',
      compact: true,
      emptyMessage: 'Aucun colis actif',
    });
    
  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 2. VUE COLIS — Liste complète
// ═══════════════════════════════════════════════════════════════════════

CT.views.parcels = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Chargement des colis...</div>';

  try {
    const { parcels } = await CT.api.get('/api/v2/parcels');
    
    // Status tabs
    const statuses = ['all', 'preparation', 'shipped', 'in_transit', 'available', 'collected'];
    const statusCounts = {};
    statuses.forEach(s => {
      statusCounts[s] = s === 'all' ? parcels.length : parcels.filter(p => p.status === s).length;
    });

    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 16px">📦 Tous les colis</h2>
        
        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap" id="status-tabs">
          ${statuses.map(s => {
            const cfg = s === 'all' ? { emoji: '📦', label: 'Tous' } : ParcelUI.getStatus(s);
            return `<button class="status-tab ${s === 'all' ? 'active' : ''}" data-status="${s}" onclick="CT.views._filterParcels('${s}')">${cfg.emoji} ${cfg.label} (${statusCounts[s]})</button>`;
          }).join('')}
        </div>
        
        <div style="margin-bottom:12px">
          <input type="text" id="parcel-search-input" placeholder="🔍 Chercher par référence, client, île..."
            style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:10px;font-size:14px"
            oninput="CT.views._searchParcels(this.value)">
        </div>
        
        <div id="parcels-list-container"></div>
      </div>
    `;

    // Store parcels for filtering
    CT.views._allParcels = parcels;
    CT.views._filterParcels('all');

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

CT.views._allParcels = [];
CT.views._currentStatusFilter = 'all';

CT.views._filterParcels = function(status) {
  CT.views._currentStatusFilter = status;
  
  // Update tab active state
  document.querySelectorAll('.status-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.status === status);
  });

  const filtered = status === 'all' 
    ? CT.views._allParcels 
    : CT.views._allParcels.filter(p => p.status === status);

  ParcelUI.renderParcelList('parcels-list-container', filtered, {
    onClick: 'ParcelUI.openDetail',
    showActions: true,
    emptyMessage: `Aucun colis ${ParcelUI.getStatus(status).label || ''}`,
  });
};

CT.views._searchParcels = function(query) {
  const q = query.toLowerCase();
  const base = CT.views._currentStatusFilter === 'all' 
    ? CT.views._allParcels 
    : CT.views._allParcels.filter(p => p.status === CT.views._currentStatusFilter);

  const filtered = q 
    ? base.filter(p => 
        (p.reference || '').toLowerCase().includes(q) ||
        (p.recipient_name || '').toLowerCase().includes(q) ||
        (p.destination_island || '').toLowerCase().includes(q) ||
        (p.main_order_ref || '').toLowerCase().includes(q) ||
        (p.relais_name || '').toLowerCase().includes(q)
      )
    : base;

  ParcelUI.renderParcelList('parcels-list-container', filtered, {
    onClick: 'ParcelUI.openDetail',
    showActions: true,
  });
};

// ═══════════════════════════════════════════════════════════════════════
// 3. VUE CRITIQUES — Colis critiques
// ═══════════════════════════════════════════════════════════════════════

CT.views.critical = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Chargement des colis critiques...</div>';

  try {
    const { parcels, count } = await CT.api.get('/api/v2/parcels/critical');

    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 16px">🚨 Colis critiques <span style="color:#dc2626">(${count})</span></h2>
        <div id="critical-list"></div>
      </div>
    `;

    if (count === 0) {
      document.getElementById('critical-list').innerHTML = 
        '<div style="text-align:center;padding:40px;color:#10b981;font-size:16px">✅ Aucun colis critique — tout est nominal !</div>';
      return;
    }

    ParcelUI.renderParcelList('critical-list', parcels, {
      onClick: 'ParcelUI.openDetail',
      showActions: true,
      emptyMessage: '✅ Aucun colis critique',
    });

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 4. VUE RÉCONCILIATION
// ═══════════════════════════════════════════════════════════════════════

CT.views.reconciliation = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Chargement de la réconciliation...</div>';

  try {
    const data = await CT.api.get('/api/v2/parcels/reconciliation');

    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 16px">⚖️ Réconciliation</h2>
        <div id="recon-container"></div>
      </div>
    `;

    ParcelUI.renderReconciliationQueue('recon-container', data);

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 5. VUE ALERTES
// ═══════════════════════════════════════════════════════════════════════

CT.views.alerts = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Calcul des alertes...</div>';

  try {
    const { alerts, operational, count } = await CT.api.get('/api/v2/parcels/alerts');

    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 16px">⚡ Alertes <span style="color:#d97706">(${count})</span></h2>
        
        ${operational && operational.length > 0 ? `
          <div style="margin-bottom:20px">
            <h3 style="font-size:16px;font-weight:700;margin:0 0 8px">🏢 Alertes opérationnelles</h3>
            ${operational.map(a => {
              const sev = ParcelUI.SEVERITY[a.severity] || { emoji: '❓', bg: '#f3f4f6' };
              return `<div style="padding:10px 14px;background:${sev.bg};border-radius:8px;margin-bottom:6px;font-size:14px">${sev.emoji} ${a.message}</div>`;
            }).join('')}
          </div>
        ` : ''}
        
        <div>
          <h3 style="font-size:16px;font-weight:700;margin:0 0 8px">📦 Alertes par colis</h3>
          <div id="alerts-list"></div>
        </div>
      </div>
    `;

    if (count === 0) {
      document.getElementById('alerts-list').innerHTML = 
        '<div style="text-align:center;padding:40px;color:#10b981;font-size:16px">✅ Aucune alerte — tout est nominal !</div>';
      return;
    }

    // Group alerts by parcel
    const byParcel = {};
    for (const a of alerts) {
      const key = a.parcel_ref || 'unknown';
      if (!byParcel[key]) byParcel[key] = { ...a, alerts: [] };
      byParcel[key].alerts.push(a);
    }

    const alertsHtml = Object.values(byParcel).map(group => {
      const worstSeverity = group.alerts.reduce((worst, a) => {
        const order = { critical: 0, high: 1, warning: 2, info: 3 };
        return (order[a.severity] ?? 9) < (order[worst] ?? 9) ? a.severity : worst;
      }, 'info');
      const sev = ParcelUI.SEVERITY[worstSeverity] || {};

      return `
        <div class="parcel-card" onclick="ParcelUI.openDetail('${group.parcel_ref}')" style="cursor:pointer;border-left:3px solid ${sev.color || '#6b7280'}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>📦 ${group.parcel_ref}</strong>
            <span style="font-size:12px;color:#6b7280">${group.destination_island || ''} · ${group.recipient_name || ''}</span>
          </div>
          <div style="margin-top:6px">
            ${group.alerts.map(a => {
              const sv = ParcelUI.SEVERITY[a.severity] || { emoji: '❓', bg: '#f3f4f6' };
              return `<div style="font-size:12px;padding:3px 8px;background:${sv.bg};border-radius:6px;margin-top:3px">${sv.emoji} ${a.message}</div>`;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('alerts-list').innerHTML = alertsHtml;

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 6. VUE INCIDENTS
// ═══════════════════════════════════════════════════════════════════════

CT.views.incidents = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Chargement des incidents...</div>';

  try {
    const { parcels } = await CT.api.get('/api/v2/parcels');
    // Filter parcels with incidents
    const withIncidents = parcels.filter(p => p.open_incidents > 0);

    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 16px">🚨 Incidents <span style="color:#dc2626">(${withIncidents.length} colis)</span></h2>
        <div id="incidents-list"></div>
      </div>
    `;

    if (withIncidents.length === 0) {
      document.getElementById('incidents-list').innerHTML = 
        '<div style="text-align:center;padding:40px;color:#10b981;font-size:16px">✅ Aucun incident ouvert</div>';
      return;
    }

    ParcelUI.renderParcelList('incidents-list', withIncidents, {
      onClick: 'ParcelUI.openDetail',
      showActions: true,
      emptyMessage: '✅ Aucun incident',
    });

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 7. VUE COMMANDES (secondaire — toujours liée au colis)
// ═══════════════════════════════════════════════════════════════════════

CT.views.orders = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Chargement des commandes...</div>';

  try {
    const { parcels } = await CT.api.get('/api/v2/parcels');
    
    // Build orders list from parcels
    const orders = [];
    for (const p of parcels) {
      orders.push({
        parcel_ref: p.reference,
        parcel_status: p.status,
        order_ref: p.main_order_ref || '—',
        customer: p.recipient_name || 'Client',
        island: p.destination_island || '—',
        relais: p.relais_name || '—',
        total_kmf: p.total_kmf || 0,
        nb_items: p.nb_items || 0,
      });
    }

    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 4px">📋 Commandes</h2>
        <p style="color:#6b7280;margin:0 0 16px;font-size:13px">Toujours rattachées à leur colis — cliquer pour voir le détail colis</p>
        
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:#f9fafb;text-align:left">
                <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">📦 Colis</th>
                <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">📋 Commande</th>
                <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">👤 Client</th>
                <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">🏝️ Île</th>
                <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">💰 Montant</th>
                <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">Statut</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map(o => `
                <tr style="cursor:pointer;border-bottom:1px solid #f3f4f6" onclick="ParcelUI.openDetail('${o.parcel_ref}')" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
                  <td style="padding:10px 12px;font-weight:600">${o.parcel_ref}</td>
                  <td style="padding:10px 12px">${o.order_ref}</td>
                  <td style="padding:10px 12px">${o.customer}</td>
                  <td style="padding:10px 12px">${o.island}</td>
                  <td style="padding:10px 12px;font-weight:600">${ParcelUI.formatKMF(o.total_kmf)}</td>
                  <td style="padding:10px 12px">${ParcelUI.renderStatusBadge(o.parcel_status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 8. VUE FINANCES
// ═══════════════════════════════════════════════════════════════════════

CT.views.finances = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Chargement des finances...</div>';

  try {
    const kpis = await CT.api.get('/api/v2/parcels/kpis');
    const f = kpis.finance || {};
    const { parcels } = await CT.api.get('/api/v2/parcels');

    // Payment breakdown
    const cashRelais = parcels.filter(p => p.payment_mode === 'cash_relais' || (p.main_order_ref && true));
    
    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 20px">💰 Finances</h2>
        
        <div class="kpi-grid">
          <div class="kpi-card" style="border-left:3px solid #10b981">
            <div class="kpi-number">${ParcelUI.formatKMF(f.ca_total_kmf)}</div>
            <div class="kpi-label">💰 CA Total</div>
          </div>
          <div class="kpi-card" style="border-left:3px solid #3b82f6">
            <div class="kpi-number">${ParcelUI.formatKMF(f.ca_active_kmf)}</div>
            <div class="kpi-label">🔄 CA Actif (en cours)</div>
          </div>
          <div class="kpi-card" style="border-left:3px solid #059669">
            <div class="kpi-number">${ParcelUI.formatKMF(f.ca_collected_kmf)}</div>
            <div class="kpi-label">✅ CA Collecté</div>
          </div>
          <div class="kpi-card" style="border-left:3px solid #f59e0b">
            <div class="kpi-number">${ParcelUI.formatKMF(f.avg_basket_kmf)}</div>
            <div class="kpi-label">🛒 Panier moyen</div>
          </div>
        </div>
        
        <div style="margin-top:20px">
          <h3 style="font-size:16px;font-weight:700">💰 Colis par montant</h3>
          <div id="finance-parcels"></div>
        </div>
      </div>
    `;

    // Sort by total_kmf DESC
    const sorted = [...parcels].sort((a, b) => (b.total_kmf || 0) - (a.total_kmf || 0));
    ParcelUI.renderParcelList('finance-parcels', sorted, {
      onClick: 'ParcelUI.openDetail',
      compact: true,
    });

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 9. VUE FACTURES
// ═══════════════════════════════════════════════════════════════════════

CT.views.invoices = async function() {
  const main = document.getElementById('ct-main');
  main.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280">⏳ Chargement des factures...</div>';

  try {
    const invoices = await CT.api.get('/api/invoices');
    const list = Array.isArray(invoices) ? invoices : (invoices.invoices || []);

    main.innerHTML = `
      <div style="max-width:1000px;margin:0 auto">
        <h2 style="font-size:22px;font-weight:800;margin:0 0 16px">🧾 Factures <span style="color:#6b7280;font-weight:400">(${list.length})</span></h2>
        
        ${list.length === 0 ? '<div style="text-align:center;padding:40px;color:#9ca3af">Aucune facture</div>' : `
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:#f9fafb;text-align:left">
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">N° Facture</th>
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">👤 Client</th>
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">📱 Téléphone</th>
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">🏪 Relais</th>
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">💰 Montant</th>
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">Paiement</th>
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">Statut</th>
                  <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb">Date</th>
                </tr>
              </thead>
              <tbody>
                ${list.map(inv => `
                  <tr style="border-bottom:1px solid #f3f4f6">
                    <td style="padding:10px 12px;font-weight:600">${inv.invoice_number || '—'}</td>
                    <td style="padding:10px 12px;font-weight:600">${inv.client_name || '—'}</td>
                    <td style="padding:10px 12px">${inv.client_phone || '—'}</td>
                    <td style="padding:10px 12px">${inv.relay_name || '—'}</td>
                    <td style="padding:10px 12px;font-weight:700">${ParcelUI.formatKMF(inv.total_kmf)}</td>
                    <td style="padding:10px 12px">${(ParcelUI.PAYMENT[inv.payment_mode] || {}).emoji || '💰'} ${inv.payment_mode || '—'}</td>
                    <td style="padding:10px 12px">
                      <span style="padding:2px 8px;border-radius:8px;font-size:11px;background:${inv.payment_status === 'paid' ? '#d1fae5' : '#fef3c7'};color:${inv.payment_status === 'paid' ? '#059669' : '#d97706'}">${inv.payment_status === 'paid' ? '✅ Payé' : '⏳ En attente'}</span>
                    </td>
                    <td style="padding:10px 12px;font-size:12px;color:#6b7280">${ParcelUI.formatDateTime(inv.created_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

  } catch (err) {
    main.innerHTML = `<div style="text-align:center;padding:60px;color:#dc2626">❌ Erreur: ${err.message}</div>`;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// INJECT TAB STYLES
// ═══════════════════════════════════════════════════════════════════════

(function injectViewStyles() {
  if (document.getElementById('ct-views-v6-css')) return;
  const style = document.createElement('style');
  style.id = 'ct-views-v6-css';
  style.textContent = `
    .status-tab {
      padding: 6px 14px;
      border: 1px solid #d1d5db;
      border-radius: 20px;
      background: #fff;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .status-tab:hover {
      background: #f3f4f6;
    }
    .status-tab.active {
      background: #111827;
      color: #fff;
      border-color: #111827;
    }
  `;
  document.head.appendChild(style);
})();

console.log('🗼 CT.views v6 loaded — COLIS-FIRST Control Tower ready');
