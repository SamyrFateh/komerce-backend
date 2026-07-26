/**
 * @komerce-arch-lite
 * @role          dashboard-relais-app
 * @domain        dashboard
 * @layer         ui-bootstrap
 * @owner         dashboards
 * @purpose       Logique applicative complète de /relais/ (file d'attente retraits,
 *                détail, validation QR, incidents) — servie en <script src> same-origin.
 * @impact-areas  dashboard, relais, csp
 * @version       2026-07
 */

/**
 * relais.js — application de public/relais/index.html, externalisée depuis un <script> inline.
 *
 * ── Pourquoi ce fichier existe (et pourquoi il ne doit PAS redevenir inline) ──
 * bootstrap/security.js pose `script-src 'self'` SANS 'unsafe-inline'. Le bloc
 * <script> inline de /relais/ était donc silencieusement bloqué en production
 * (mesuré en navigateur réel — cf. AUDIT_COUTURES_COUCHES.md) : le squelette
 * HTML se peignait, l'application ne démarrait jamais.
 *
 * ── Contraintes de chargement ──
 *   1. Chargé en <script src> SYNCHRONE (jamais defer/async) juste avant </body>,
 *      à l'emplacement exact du bloc inline d'origine.
 *
 * Gate associé : scripts/check-inline-scripts.js (étendu à tout public/, pas
 * seulement public/boutique/).
 */
'use strict';


const api = {
  get: u => fetch(u, {credentials:'include'}).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e))),
  post: (u, b) => fetch(u, {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r => r.json().then(d => r.ok ? d : Promise.reject(d))),
  patch: (u, b) => fetch(u, {method:'PATCH', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)}).then(r => r.json().then(d => r.ok ? d : Promise.reject(d))),
};

const R = (() => {
  let _tab = 'accueil';
  let _scanType = null;
  let _order = null;
  let _incType = null;
  let _cashOrderId = null;
  let _cashAmount = 0;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function toast(msg, type='', dur=3200) {
    const e = document.getElementById('toast');
    e.textContent = msg; e.className = 'show ' + (type || '');
    clearTimeout(e._t); e._t = setTimeout(() => { e.className = ''; }, dur);
  }
  function kmf(n) { return Number(n||0).toLocaleString('fr-FR') + ' KMF'; }
  function ago(dt) { const h=(Date.now()-new Date(dt))/3600000; if(h<1)return Math.round(h*60)+'min'; if(h<24)return Math.round(h)+'h'; return Math.round(h/24)+'j'; }
  function slbl(s) { return {confirmed:'confirmé',ordered:'commandé',preparation:'prépa',shipped:'expédié',in_transit:'transit',available:'disponible',collected:'retiré',cancelled:'annulé'}[s]||s; }
  function urgClass(o) { return o.urgence==='critique'?'urgent':o.cash_pending?'cash-pending':''; }
  function scol(s) { return {available:'green',in_transit:'blue',shipped:'blue',collected:'gray',cancelled:'red'}[s]||'gray'; }

  // ── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const me = await api.get('/api/auth/me');
      document.getElementById('header-user').textContent = me.full_name || me.email || 'Relais';
      await loadDashboard();
      loadOrders('available', 'list-disponibles', 'bdispo');
      loadOrders('in_transit,shipped', 'list-approche', 'bapproche');
    } catch(e) {
      if (e && (e.status===401 || String(e.error||'').includes('onnect'))) location.href = '/';
    }
  }

  async function loadDashboard() {
    try {
      const d = await api.get('/api/relay/dashboard');
      const k = d.kpi || {};
      document.getElementById('kpi-transit').textContent = k.en_transit ?? '—';
      document.getElementById('kpi-dispo').textContent = k.disponibles ?? '—';
      document.getElementById('kpi-cash').textContent = k.cash_a_encaisser ?? '—';

      // Badge tab
      if (k.disponibles > 0) setBadge('bdispo', k.disponibles);
      if (k.en_transit > 0) setBadge('bapproche', k.en_transit);

      // Alert chip header
      const ac = document.getElementById('alert-chip');
      if (k.incidents_ouverts > 0) {
        ac.textContent = '⚠ '+k.incidents_ouverts+' incident'+(k.incidents_ouverts>1?'s':'');
        ac.className = 'on';
      } else if (k.cash_a_encaisser > 0) {
        ac.textContent = '💰 '+kmf(k.montant_cash_pending);
        ac.className = 'cash';
      } else {
        ac.className = '';
      }

      // Alertes strip
      const aw = document.getElementById('alertes-wrap');
      aw.innerHTML = (d.alertes||[]).map(a =>
        `<div class="alert-strip ${a.type}">${a.type==='warning'?'⚠️':a.type==='danger'?'🚨':'ℹ️'} ${a.message}</div>`
      ).join('');
    } catch(e) { console.warn('Dashboard KPI error', e); }
  }

  function setBadge(id, n) {
    const b = document.getElementById(id);
    if (!b) return;
    b.textContent = n > 0 ? n : '';
    b.className = n > 0 ? 'tab-badge on' : 'tab-badge off';
  }

  async function loadOrders(statuses, listId, badgeId) {
    const el = document.getElementById(listId);
    el.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
    try {
      const d = await api.get('/api/relay/orders?status=' + statuses + '&limit=50');
      const rows = d.orders || [];
      if (badgeId) setBadge(badgeId, rows.length);
      if (!rows.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Aucune commande</div>'; return; }
      el.innerHTML = rows.map(o => orderCard(o)).join('');
      el.querySelectorAll('.order-card').forEach(c => c.addEventListener('click', () => openDetail(c.dataset.id)));
    } catch(e) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>' + (e.error||'Erreur réseau') + '</div>';
    }
  }

  function orderCard(o) {
    const uc = urgClass(o);
    const cashBadge = o.cash_pending ? '<span class="badge amber">💰 Cash</span>' : '';
    const incBadge = o.incidents_ouverts > 0 ? '<span class="badge red">⚠ incident</span>' : '';
    const urgBadge = o.urgence === 'critique' ? '<span class="badge red">+120h</span>' : o.urgence === 'haute' ? '<span class="badge amber">+72h</span>' : '';
    return `<div class="order-card ${uc}" data-id="${o.id}">
      <div class="card-top"><div class="card-ref">${o.reference}</div><div class="card-age">${ago(o.created_at)}</div></div>
      <div class="card-client">${o.client_nom||'—'}</div>
      <div class="card-meta">
        <span class="badge ${scol(o.status)}">${slbl(o.status)}</span>
        <span class="badge gray">${o.nb_items||0} art.</span>
        ${cashBadge}${incBadge}${urgBadge}
      </div>
    </div>`;
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  function switchTab(tab) {
    _tab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-'+tab));
    if (tab === 'disponibles') loadOrders('available', 'list-disponibles', 'bdispo');
    if (tab === 'approche') loadOrders('in_transit,shipped', 'list-approche', 'bapproche');
    if (tab === 'collectes') loadOrders('collected', 'list-collectes', null);
    if (tab === 'accueil') loadDashboard();
  }

  // ── Scan ────────────────────────────────────────────────────────────────────
  function openScan(type) {
    _scanType = type;
    const isCollect = type === 'collected';
    document.getElementById('scan-title').textContent = isCollect ? '🤝 Remise client' : '📥 Réception colis';
    document.getElementById('scan-desc').textContent = isCollect
      ? 'Entrez le code PIN à 6 chiffres du client. La commande sera retrouvée automatiquement par ce code.'
      : 'Scannez ou saisissez la référence de la commande à réceptionner.';
    document.getElementById('scan-ref-label').textContent = isCollect ? 'Référence (optionnel)' : 'Référence commande';
    document.getElementById('pin-group').style.display = isCollect ? '' : 'none';
    document.getElementById('scan-ref').value = '';
    document.getElementById('scan-pin').value = '';
    const res = document.getElementById('scan-result');
    res.className = 'scan-result'; res.textContent = '';
    const sp = document.getElementById('scan-panel');
    sp.style.display = 'flex';
    requestAnimationFrame(() => sp.style.transform = 'translateY(0)');
    setTimeout(() => { (isCollect ? document.getElementById('scan-pin') : document.getElementById('scan-ref')).focus(); }, 320);
  }

  function closeScan() {
    const sp = document.getElementById('scan-panel');
    sp.style.transform = 'translateY(100%)';
    setTimeout(() => { sp.style.display = 'none'; }, 300);
  }

  async function doScan() {
    const btn = document.getElementById('btn-scan-confirm');
    const res = document.getElementById('scan-result');
    res.className = 'scan-result'; res.textContent = '';
    btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> En cours…';
    try {
      if (_scanType === 'collected') {
        // POST /api/scans/collect — pickup_code only
        const pin = document.getElementById('scan-pin').value.trim();
        if (!pin || pin.length < 4) { toast('Code PIN requis', 'error'); btn.disabled=false; btn.innerHTML='✅ Confirmer'; return; }
        const r = await api.post('/api/scans/collect', { pickup_code: pin });
        res.className = 'scan-result ok';
        res.innerHTML = `🤝 <strong>${r.order?.reference||''}</strong> remis au client · statut : ${slbl(r.order?.status||'collected')}`;
        toast('✅ Remise confirmée', 'success');
        refreshAll();
      } else {
        // POST /api/scans — step: relais_received
        const ref = document.getElementById('scan-ref').value.trim().toUpperCase();
        if (!ref) { toast('Référence requise', 'error'); btn.disabled=false; btn.innerHTML='✅ Confirmer'; return; }
        const r = await api.post('/api/scans', { scan_code: ref, step: 'relais_received', location: 'Point Relais' });
        res.className = 'scan-result ok';
        res.innerHTML = `📥 <strong>${ref}</strong> réceptionné · statut → ${slbl(r.order?.status||r.new_status||'available')}`;
        toast('📥 Réception enregistrée', 'success');
        refreshAll();
      }
    } catch(e) {
      res.className = 'scan-result err';
      res.textContent = '❌ ' + (e.error || e.message || 'Erreur');
      toast(e.error || 'Erreur scan', 'error');
    } finally {
      btn.disabled = false; btn.innerHTML = '✅ Confirmer';
    }
  }

  function refreshAll() {
    loadDashboard();
    loadOrders('available', 'list-disponibles', 'bdispo');
    loadOrders('in_transit,shipped', 'list-approche', 'bapproche');
  }

  // Enter key support
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const scanPanel = document.getElementById('scan-panel');
      if (scanPanel.style.display !== 'none' && scanPanel.style.transform === 'translateY(0px)') doScan();
      else if (document.getElementById('detail-panel').classList.contains('open')) {/* handled inline */}
    }
  });

  // ── Detail ──────────────────────────────────────────────────────────────────
  async function openDetail(id) {
    _order = null;
    const dp = document.getElementById('detail-panel');
    document.getElementById('detail-body').innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
    document.getElementById('detail-actions').innerHTML = '';
    document.getElementById('detail-title').textContent = 'Chargement…';
    dp.classList.add('open');
    try {
      const d = await api.get('/api/relay/orders/' + id);
      _order = d;
      renderDetail(d);
    } catch(e) {
      document.getElementById('detail-body').innerHTML = '<div class="empty">' + (e.error||'Erreur') + '</div>';
    }
  }

  function renderDetail(d) {
    const o = d.order, c = d.client||{}, p = d.paiement||{}, items = d.items||[], tl = d.timeline||[];
    document.getElementById('detail-title').textContent = o.reference;
    document.getElementById('detail-status-badge').innerHTML = `<span class="badge ${scol(o.status)}">${slbl(o.status)}</span>`;

    const cashSection = p.cash_pending ? `
      <div class="section" style="border-color:rgba(255,171,64,.35)">
        <div class="section-head" style="color:var(--amber)">💰 Cash à encaisser</div>
        <div class="section-body">
          <div class="info-row"><span class="info-label">Montant</span><span class="info-val" style="color:var(--amber);font-size:18px">${kmf(p.total_kmf)}</span></div>
          <div class="info-row"><span class="info-label">Code PIN</span><span class="info-val"><div class="pin-display">${o.pickup_code||'—'}</div></span></div>
        </div>
      </div>` : '';

    const tlHtml = tl.length ? `
      <div class="section">
        <div class="section-head">Timeline</div>
        <div class="section-body" style="gap:0">
          ${tl.map((t,i) => `<div class="timeline-row"><div class="timeline-dot ${i===tl.length-1?'active':''}"></div><div class="timeline-content"><div class="timeline-status">${slbl(t.status)}</div><div class="timeline-date">${new Date(t.created_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div></div></div>`).join('')}
        </div>
      </div>` : '';

    const pickupSection = o.status === 'available' ? `
      <div class="section" style="border-color:rgba(0,230,118,.2)">
        <div class="section-head" style="color:var(--green)">Code PIN remise</div>
        <div class="section-body"><div class="pin-display">${o.pickup_code||'—'}</div></div>
      </div>` : '';

    document.getElementById('detail-body').innerHTML = `
      <div class="section">
        <div class="section-head">Client</div>
        <div class="section-body">
          <div class="info-row"><span class="info-label">Nom</span><span class="info-val">${c.nom||'—'}</span></div>
          <div class="info-row"><span class="info-label">Téléphone</span><span class="info-val">${c.phone||'—'}</span></div>
          ${c.history?.is_recurring ? `<div class="info-row"><span class="info-label">Historique</span><span class="info-val">${c.history.total_orders} commandes</span></div>` : ''}
        </div>
      </div>
      ${cashSection}
      ${pickupSection}
      <div class="section">
        <div class="section-head">Articles (${items.length})</div>
        <div class="section-body" style="gap:0">
          ${items.map(it => `<div class="item-row"><div class="item-qty">×${it.quantity}</div><div class="item-name">${it.produit||'—'}</div></div>`).join('')}
        </div>
      </div>
      <div class="section">
        <div class="section-head">Paiement</div>
        <div class="section-body">
          <div class="info-row"><span class="info-label">Mode</span><span class="info-val">${p.mode||'—'}</span></div>
          <div class="info-row"><span class="info-label">Statut</span><span class="info-val">${p.is_paid?'<span class="badge green">payé</span>':'<span class="badge amber">en attente</span>'}</span></div>
          <div class="info-row"><span class="info-label">Total</span><span class="info-val">${kmf(p.total_kmf)}</span></div>
        </div>
      </div>
      ${tlHtml}
    `;
    renderActions(o, p);
  }

  function renderActions(o, p) {
    const el = document.getElementById('detail-actions');
    let html = '';
    if (o.status === 'available') {
      if (p.cash_pending) {
        html += `<button class="btn btn-amber" data-act="open-cash">💰 Encaisser ${kmf(p.total_kmf)}</button>`;
      }
      html += `<button class="btn btn-secondary" data-act="open-inc">🚨 Signaler incident</button>`;
      html += `<button class="btn btn-secondary" data-act="client-absent">👤 Client absent</button>`;
    } else if (o.status === 'in_transit' || o.status === 'shipped') {
      html += `<button class="btn btn-secondary" data-act="open-inc">🚨 Signaler incident</button>`;
    } else {
      html += `<button class="btn btn-secondary" data-act="open-inc">🚨 Signaler incident</button>`;
    }
    el.innerHTML = html;
  }

  function closeDetail() {
    document.getElementById('detail-panel').classList.remove('open');
    _order = null;
    refreshAll();
  }

  // ── Cash ────────────────────────────────────────────────────────────────────
  function openCash() {
    if (!_order) return;
    _cashOrderId = _order.order.id;
    _cashAmount = _order.paiement?.total_kmf || 0;
    document.getElementById('cash-detail').innerHTML = `
      Commande <strong>${_order.order.reference}</strong><br>
      Montant à encaisser : <strong style="color:var(--amber)">${kmf(_cashAmount)}</strong><br>
      Client : ${_order.client?.nom||'—'}
    `;
    document.getElementById('cash-modal').classList.add('open');
  }
  function closeCash() { document.getElementById('cash-modal').classList.remove('open'); }

  async function confirmCash() {
    const b = document.getElementById('btn-cash-confirm');
    b.disabled = true; b.innerHTML = '<div class="spinner"></div>';
    try {
      await api.post('/api/cash/collect/' + _cashOrderId, {});
      closeCash();
      toast('💰 Encaissement confirmé', 'success');
      const d = await api.get('/api/relay/orders/' + _cashOrderId);
      _order = d; renderDetail(d);
      loadDashboard();
    } catch(e) { toast(e.error||'Erreur', 'error'); }
    finally { b.disabled=false; b.innerHTML='✅ Confirmer encaissement'; }
  }

  // ── Incident ─────────────────────────────────────────────────────────────────
  function openInc() {
    _incType = null;
    document.querySelectorAll('.inc-type-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('inc-desc').value = '';
    document.getElementById('inc-modal').classList.add('open');
  }
  function closeInc() { document.getElementById('inc-modal').classList.remove('open'); }
  function selInc(el) {
    document.querySelectorAll('.inc-type-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected'); _incType = el.dataset.type;
  }

  async function confirmInc() {
    if (!_incType) { toast('Sélectionnez un type', 'error'); return; }
    const desc = document.getElementById('inc-desc').value.trim();
    if (!desc) { toast('Description requise', 'error'); return; }
    const b = document.getElementById('btn-inc-confirm');
    b.disabled = true; b.innerHTML = '<div class="spinner"></div>';
    try {
      await api.post('/api/relay/orders/' + _order.order.id + '/incident', { type: _incType, description: desc });
      closeInc();
      toast('🚨 Incident signalé', 'success');
      const d = await api.get('/api/relay/orders/' + _order.order.id);
      _order = d; renderDetail(d);
    } catch(e) { toast(e.error||'Erreur', 'error'); }
    finally { b.disabled=false; b.innerHTML='🚨 Envoyer'; }
  }

  // ── Client absent ────────────────────────────────────────────────────────────
  async function clientAbsent() {
    try {
      await api.patch('/api/relay/orders/' + _order.order.id + '/client-absent', {});
      toast('👤 Client absent enregistré', 'success');
      const d = await api.get('/api/relay/orders/' + _order.order.id);
      _order = d; renderDetail(d);
    } catch(e) { toast(e.error||'Erreur', 'error'); }
  }

  return { init, switchTab, openScan, closeScan, doScan, openDetail, closeDetail, openCash, closeCash, confirmCash, openInc, closeInc, selInc, confirmInc, clientAbsent };
})();

// ── Static wiring ──────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(function(btn) {
  btn.addEventListener('click', function() { R.switchTab(btn.dataset.tab); });
});
document.getElementById('btn-receive').addEventListener('click', function() { R.openScan('arrived'); });
document.getElementById('btn-remise').addEventListener('click', function() { R.openScan('collected'); });
document.getElementById('btn-scan-back').addEventListener('click', function() { R.closeScan(); });
document.getElementById('btn-scan-confirm').addEventListener('click', function() { R.doScan(); });
document.getElementById('btn-back').addEventListener('click', function() { R.closeDetail(); });
document.getElementById('inc-modal').addEventListener('click', function(e) { if (e.target === this) R.closeInc(); });
document.getElementById('btn-inc-confirm').addEventListener('click', function() { R.confirmInc(); });
document.getElementById('btn-inc-cancel').addEventListener('click', function() { R.closeInc(); });
document.querySelectorAll('.inc-type-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { R.selInc(btn); });
});
document.getElementById('cash-modal').addEventListener('click', function(e) { if (e.target === this) R.closeCash(); });
document.getElementById('btn-cash-confirm').addEventListener('click', function() { R.confirmCash(); });
document.getElementById('btn-cash-cancel').addEventListener('click', function() { R.closeCash(); });
// ── Dynamic action delegation ───────────────────────────────────
document.getElementById('detail-actions').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-act]');
  if (!btn) return;
  var act = btn.dataset.act;
  if (act === 'open-cash') R.openCash();
  else if (act === 'open-inc') R.openInc();
  else if (act === 'client-absent') R.clientAbsent();
});

fetch('/api/auth/me', {credentials:'include'}).then(r => {
  if (!r.ok) location.href = '/';
  else R.init();
}).catch(() => location.href = '/');
