/**
 * ═══════════════════════════════════════════════════════════════
 * CT View: INVENTORY DASHBOARD — Propositions + Buffer + KPI
 * Injected into the Hub tab as an expandable panel
 * ═══════════════════════════════════════════════════════════════
 */

window.renderInventoryDashboard = async function(container) {
  const api = window.ctApi || {};
  const authFetch = api.authFetch || (async (url, opts) => {
    const r = await fetch(url, { ...opts, credentials: 'include' });
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });

  container.innerHTML = `<div class="inv-dash" id="inv-dash">
    <div class="inv-loading">⏳ Chargement inventaire...</div>
  </div>`;

  try {
    const [statsData, proposalsData, bufferData] = await Promise.all([
      authFetch('/api/hub/inventory/stats'),
      authFetch('/api/hub/inventory/proposals'),
      authFetch('/api/hub/inventory/buffer'),
    ]);

    const stats = statsData;
    const proposals = proposalsData.proposals || [];
    const bufferItems = bufferData.items || [];
    const dash = document.getElementById('inv-dash');

    // ── KPI BAR ──
    const kpiHtml = `
      <div class="inv-kpi-bar">
        <span class="inv-kpi"><span class="inv-kpi-n">${stats.items_received || 0}</span> 📥 Reçus</span>
        <span class="inv-kpi inv-kpi-accent"><span class="inv-kpi-n">${stats.items_proposed || 0}</span> 🤖 Proposés</span>
        <span class="inv-kpi"><span class="inv-kpi-n">${stats.items_assigned || 0}</span> ✅ Assignés</span>
        <span class="inv-kpi ${stats.items_buffered > 0 ? 'inv-kpi-warn' : ''}"><span class="inv-kpi-n">${stats.items_buffered || 0}</span> ⏳ Buffer</span>
        <span class="inv-kpi"><span class="inv-kpi-n">${stats.open_parcels || 0}</span> 📦 Colis ouverts</span>
        <span class="inv-kpi"><span class="inv-kpi-n">${stats.partial_orders || 0}</span> 🔀 Partiels</span>
        ${stats.overdue_buffer > 0 ? `<span class="inv-kpi inv-kpi-danger"><span class="inv-kpi-n">${stats.overdue_buffer}</span> 🚨 Dépassés</span>` : ''}
      </div>`;

    // ── PROPOSALS TABLE ──
    let proposalsHtml = '';
    if (proposals.length > 0) {
      const rows = proposals.map(p => {
        const hours = p.hours_since_proposal ? parseFloat(p.hours_since_proposal).toFixed(1) : '–';
        const urgency = parseFloat(p.hours_since_proposal || 0) > 3 ? 'inv-row-warn' : '';
        return `<tr class="${urgency}" data-id="${p.id}">
          <td>${p.product_name || '?'}</td>
          <td><code>${p.order_ref || '?'}</code></td>
          <td>${p.destination_island || '?'}</td>
          <td>📦 <code>${p.proposed_parcel_ref || '?'}</code></td>
          <td>${hours}h</td>
          <td class="inv-actions">
            <button class="inv-btn inv-btn-ok" onclick="invConfirm('${p.id}')" title="Confirmer">✅</button>
            <button class="inv-btn inv-btn-change" onclick="invReassignPrompt('${p.id}')" title="Réassigner">🔄</button>
            <button class="inv-btn inv-btn-buf" onclick="invBufferPrompt('${p.id}')" title="Buffer">⏳</button>
          </td>
        </tr>`;
      }).join('');

      proposalsHtml = `
        <div class="inv-section">
          <div class="inv-section-head">
            <h3>🤖 Propositions du moteur <span class="inv-badge">${proposals.length}</span></h3>
            <div class="inv-bulk-actions">
              <button class="inv-btn inv-btn-ok" onclick="invConfirmAll()">✅ Tout valider</button>
              <button class="inv-btn inv-btn-muted" onclick="invReproposeAll()">🔄 Recalculer</button>
            </div>
          </div>
          <table class="inv-table">
            <thead><tr>
              <th>Produit</th><th>Commande</th><th>Dest.</th><th>→ Colis proposé</th><th>Attente</th><th>Actions</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    } else {
      proposalsHtml = `<div class="inv-section inv-empty">
        <p>🤖 Aucune proposition en attente — tous les articles sont assignés ou en buffer.</p>
      </div>`;
    }

    // ── BUFFER TABLE ──
    let bufferHtml = '';
    if (bufferItems.length > 0) {
      const bRows = bufferItems.map(b => {
        const hours = b.hours_in_buffer ? parseFloat(b.hours_in_buffer).toFixed(1) : '–';
        const cls = b.deadline_passed ? 'inv-row-danger' : '';
        return `<tr class="${cls}">
          <td>${b.product_name || '?'}</td>
          <td><code>${b.order_ref || '?'}</code></td>
          <td>${b.destination_island || '?'}</td>
          <td>${b.buffer_reason || '?'}</td>
          <td>${hours}h ${b.deadline_passed ? '🚨' : ''}</td>
        </tr>`;
      }).join('');

      bufferHtml = `
        <div class="inv-section">
          <div class="inv-section-head">
            <h3>⏳ Buffer <span class="inv-badge inv-badge-warn">${bufferItems.length}</span></h3>
          </div>
          <table class="inv-table">
            <thead><tr><th>Produit</th><th>Commande</th><th>Dest.</th><th>Raison</th><th>Depuis</th></tr></thead>
            <tbody>${bRows}</tbody>
          </table>
        </div>`;
    }

    dash.innerHTML = kpiHtml + proposalsHtml + bufferHtml;

  } catch (err) {
    container.innerHTML = `<div class="inv-dash"><p class="inv-error">❌ Erreur: ${err.message}</p></div>`;
    console.error('[INV-DASH]', err);
  }
};

// ── ACTION HANDLERS ──

window.invConfirm = async function(id) {
  try {
    const r = await fetch(`/api/hub/inventory/${id}/confirm`, { method: 'POST', credentials: 'include' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    showToast('✅ Proposition confirmée');
    refreshInventoryDashboard();
  } catch (e) { showToast('❌ ' + e.message); }
};

window.invConfirmAll = async function() {
  try {
    const r = await fetch('/api/hub/inventory/proposals/confirm-all', { method: 'POST', credentials: 'include' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const data = await r.json();
    showToast(`✅ ${data.confirmed || 0} propositions validées`);
    refreshInventoryDashboard();
  } catch (e) { showToast('❌ ' + e.message); }
};

window.invReproposeAll = async function() {
  try {
    const r = await fetch('/api/hub/inventory/proposals/repropose-all', { method: 'POST', credentials: 'include' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const data = await r.json();
    showToast(`🔄 ${data.proposed || 0} proposés, ${data.buffered || 0} buffered`);
    refreshInventoryDashboard();
  } catch (e) { showToast('❌ ' + e.message); }
};

window.invReassignPrompt = async function(id) {
  try {
    const r = await fetch(`/api/hub/inventory/${id}/compatible-parcels`, { credentials: 'include' });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    const data = await r.json();
    
    if (!data.parcels || data.parcels.length === 0) {
      showToast('⚠️ Aucun colis compatible disponible');
      return;
    }

    const options = data.parcels.map(p => `${p.reference} — ${p.match_type} (${p.item_count} items)`);
    const choice = prompt(
      `🔄 Réassigner vers quel colis ?\n\n` +
      data.parcels.map((p, i) => `${i + 1}. ${p.reference} — ${p.match_type} (${p.item_count} items)`).join('\n') +
      `\n\nEntrez le numéro:`
    );

    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= data.parcels.length) { showToast('❌ Choix invalide'); return; }

    const res = await fetch(`/api/hub/inventory/${id}/reassign`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: data.parcels[idx].id }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    showToast(`✅ Réassigné → ${data.parcels[idx].reference}`);
    refreshInventoryDashboard();
  } catch (e) { showToast('❌ ' + e.message); }
};

window.invBufferPrompt = async function(id) {
  const reason = prompt('Raison du buffer:');
  if (!reason) return;
  try {
    const r = await fetch(`/api/hub/inventory/${id}/buffer`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    showToast('⏳ Article mis en buffer');
    refreshInventoryDashboard();
  } catch (e) { showToast('❌ ' + e.message); }
};

function refreshInventoryDashboard() {
  const c = document.getElementById('inv-dash');
  if (c) window.renderInventoryDashboard(c.parentElement || c);
}

function showToast(msg) {
  if (window.ctToast) { window.ctToast(msg); return; }
  const t = document.createElement('div');
  t.className = 'inv-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}
