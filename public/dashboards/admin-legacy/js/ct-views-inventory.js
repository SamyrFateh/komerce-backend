/**
 * ═══════════════════════════════════════════════════════════════
 * CT Inventory Dashboard v3 — Proposals as GUIDANCE
 * 
 * No confirm/reject buttons. Agent scans → system adapts.
 * Dashboard shows: what arrived, where the motor suggests it goes,
 * and the agent can change it anytime.
 * ═══════════════════════════════════════════════════════════════
 */

window.CTInventory = {
  async render(container) {
    container.innerHTML = `
      <div id="inv-panel" style="margin-top:18px; border-top:2px solid #e0e7d0; padding-top:14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <h3 style="margin:0; font-size:15px;">📦 Inventaire Hub — Réception & Assignation</h3>
          <div style="display:flex; gap:6px;">
            <button onclick="CTInventory.recalculate()" class="ct-btn-sm" title="Recalculer les propositions">🤖 Recalculer</button>
            <button onclick="CTInventory.refresh()" class="ct-btn-sm">🔄</button>
          </div>
        </div>
        <div id="inv-kpis" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;"></div>
        <div id="inv-items"></div>
      </div>`;
    this.refresh();
  },

  async refresh() {
    try {
      const [statsRes, itemsRes, parcelsRes] = await Promise.all([
        fetch('/api/hub/inventory/stats', { credentials: 'include' }),
        fetch('/api/hub/inventory/proposals', { credentials: 'include' }),
        fetch('/api/hub/inventory/open-parcels', { credentials: 'include' })
      ]);
      const stats = await statsRes.json();
      const data = await itemsRes.json();
      const pData = await parcelsRes.json();
      
      this.openParcels = pData.parcels || [];
      this.renderKPIs(stats);
      this.renderItems(data.items || []);
    } catch (e) {
      document.getElementById('inv-items').innerHTML = `<div style="color:#b44;">❌ ${e.message}</div>`;
    }
  },

  renderKPIs(s) {
    const el = document.getElementById('inv-kpis');
    if (!el) return;
    const badges = [
      { icon: '📥', label: 'Reçus', val: s.received || 0, color: '#4a7c59' },
      { icon: '🤖', label: 'Proposés', val: s.proposed || 0, color: '#5b8a3c' },
      { icon: '✅', label: 'Assignés', val: s.assigned || 0, color: '#2d6a2e' },
      { icon: '⏳', label: 'Buffer', val: s.buffered || 0, color: s.buffered > 0 ? '#c47f17' : '#888' },
      { icon: '📦', label: 'Colis ouverts', val: s.open_parcels || 0, color: '#3a6d8c' },
      { icon: '🚨', label: 'Dépassés', val: s.overdue || 0, color: s.overdue > 0 ? '#c0392b' : '#888' },
    ];
    el.innerHTML = badges.map(b => `
      <span style="background:${b.color}11; color:${b.color}; border:1px solid ${b.color}33;
        padding:3px 8px; border-radius:10px; font-size:12px; font-weight:600;">
        ${b.icon} ${b.val} ${b.label}
      </span>
    `).join('');
  },

  renderItems(items) {
    const el = document.getElementById('inv-items');
    if (!el) return;

    if (items.length === 0) {
      el.innerHTML = `<div style="text-align:center; padding:20px; color:#888; font-size:13px;">
        Aucun article en attente d'assignation.<br>
        Les articles reçus au Hub apparaîtront ici avec la proposition du moteur.
      </div>`;
      return;
    }

    // Group by status
    const proposed = items.filter(i => i.status === 'proposed');
    const received = items.filter(i => i.status === 'received');
    const buffered = items.filter(i => i.status === 'buffered');

    let html = '';

    if (proposed.length > 0) {
      html += this.renderSection('🤖 Propositions moteur', proposed, 'proposed');
    }
    if (received.length > 0) {
      html += this.renderSection('📥 Reçus (en attente)', received, 'received');
    }
    if (buffered.length > 0) {
      html += this.renderSection('⏳ Buffer', buffered, 'buffered');
    }

    el.innerHTML = html;
  },

  renderSection(title, items, type) {
    const statusColor = { proposed: '#5b8a3c', received: '#4a7c59', buffered: '#c47f17' };
    const parcelsOpts = this.openParcels.map(p => 
      `<option value="${p.id}">${p.reference} (${p.destination_island || '?'}) — ${p.item_count} art.</option>`
    ).join('');

    return `
      <div style="margin-bottom:12px;">
        <div style="font-size:13px; font-weight:600; color:${statusColor[type]}; margin-bottom:4px;">${title} (${items.length})</div>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead>
            <tr style="background:#f5f7f0; border-bottom:1px solid #ddd;">
              <th style="text-align:left; padding:4px 6px;">Produit</th>
              <th style="text-align:left; padding:4px 6px;">Commande</th>
              <th style="text-align:left; padding:4px 6px;">Dest.</th>
              <th style="text-align:left; padding:4px 6px;">${type === 'proposed' ? '→ Colis suggéré' : type === 'buffered' ? 'Raison' : 'Attente'}</th>
              <th style="text-align:center; padding:4px 6px;">Scan</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
              const waitMin = Math.round(item.wait_minutes || 0);
              const waitStr = waitMin > 60 ? `${Math.round(waitMin/60)}h${waitMin%60}m` : `${waitMin}m`;
              const infoCol = type === 'proposed' 
                ? `<span style="font-weight:600; color:#2d6a2e;">📦 ${item.proposed_parcel_ref || '?'}</span>`
                : type === 'buffered'
                ? `<span style="color:#c47f17;">${item.buffer_reason || 'En attente'}</span>`
                : `<span style="color:#888;">⏱ ${waitStr}</span>`;

              return `<tr style="border-bottom:1px solid #eee;" data-inv-id="${item.id}">
                <td style="padding:4px 6px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${item.product_name}">${item.product_name}</td>
                <td style="padding:4px 6px; font-family:monospace; font-size:11px;">${item.order_ref}</td>
                <td style="padding:4px 6px;">${item.destination_island || '—'}</td>
                <td style="padding:4px 6px;">${infoCol}</td>
                <td style="padding:4px 6px; text-align:center;">
                  <select onchange="CTInventory.scanAssign('${item.id}', this.value)" 
                    style="font-size:11px; padding:2px 4px; border-radius:4px; border:1px solid #ccc; max-width:130px;"
                    title="Scanner dans un colis">
                    <option value="">📦 Assigner →</option>
                    ${type === 'proposed' && item.proposed_parcel_id 
                      ? `<option value="${item.proposed_parcel_id}" style="font-weight:bold;">✅ ${item.proposed_parcel_ref} (suggéré)</option>` 
                      : ''}
                    ${parcelsOpts}
                  </select>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  },

  async scanAssign(itemId, parcelId) {
    if (!parcelId) return;
    try {
      const res = await fetch('/api/hub/inventory/scan-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ inventory_item_id: itemId, parcel_id: parcelId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      // Flash feedback on the row
      const row = document.querySelector(`tr[data-inv-id="${itemId}"]`);
      if (row) {
        row.style.background = data.matched_proposal ? '#d4edda' : '#fff3cd';
        row.querySelector('td:last-child').innerHTML = `<span style="font-size:11px; color:#2d6a2e;">✅ ${data.parcel_ref}</span>`;
        setTimeout(() => row.style.opacity = '0.3', 1500);
        setTimeout(() => this.refresh(), 2500);
      }
    } catch (e) {
      alert('❌ ' + e.message);
    }
  },

  async recalculate() {
    try {
      const res = await fetch('/api/hub/inventory/propose-all', {
        method: 'POST', credentials: 'include'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this.refresh();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  }
};
window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.inventory = async function(container) {
  return window.CTInventory.render(container);
};

console.log('[CT] ct-views-inventory.js chargé (v1.0)');
