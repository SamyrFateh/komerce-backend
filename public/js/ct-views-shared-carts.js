/* ═══════════════════════════════════════════════════════════════════════════
 *  ct-views-shared-carts.js — Komerce Control Tower
 *
 *  ADMIN / SUPPORT — Vue Paniers Partagés
 *
 *  Permet à l'admin de :
 *    1. Voir tous les paniers partagés (avec filtre par statut)
 *    2. Détailler un panier : items, contributions, events
 *    3. Prolonger l'expiration
 *    4. Forcer l'expiration
 *    5. Ajouter une note d'arbitrage
 *
 *  API consommées :
 *    GET  /api/admin/shared-carts
 *    GET  /api/admin/shared-carts/:id
 *    POST /api/admin/shared-carts/:id/expire
 *    POST /api/admin/shared-carts/:id/extend
 *    POST /api/admin/shared-carts/:id/note
 * ═══════════════════════════════════════════════════════════════════════════ */

(function() {
'use strict';

window.CT = window.CT || {};
CT.views = CT.views || {};

const _scv = {
  loading: false, carts: [],
  filterStatus: 'all',
  detailId: null, detail: null,
};

const NF = new Intl.NumberFormat('fr-FR');
function fmt(n) { return NF.format(Math.round(n || 0)) + ' KMF'; }
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function api(method, path, body) {
  const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
  if (body != null) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('API ' + res.status + ' : ' + t.slice(0, 250));
  }
  return res.json();
}

const STATUS_META = {
  draft:               { color: '#94a3b8', label: 'Brouillon' },
  active:              { color: '#3b82f6', label: 'Actif' },
  partially_funded:    { color: '#f59e0b', label: 'Partiellement financé' },
  fully_funded:        { color: '#16a34a', label: 'Entièrement financé' },
  converted_to_order:  { color: '#64748b', label: 'Converti en commande' },
  expired:             { color: '#dc2626', label: 'Expiré' },
  cancelled:           { color: '#94a3b8', label: 'Annulé' },
  refunded:            { color: '#94a3b8', label: 'Remboursé' },
};

function injectStyles() {
  if (document.getElementById('scv-styles')) return;
  const s = document.createElement('style');
  s.id = 'scv-styles';
  s.textContent = `
    .scv-wrap { max-width:1320px; margin:0 auto; padding:20px 24px; color:#1e293b; }
    .scv-h1 { font-size:1.4rem; font-weight:800; margin:0 0 4px; }
    .scv-sub { font-size:0.88rem; color:#64748b; margin:0 0 18px; }
    .scv-tools { display:flex; gap:10px; align-items:center; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:14px; }
    .scv-tools label { font-size:0.78rem; color:#475569; font-weight:600; }
    .scv-select { padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85rem; font-family:inherit; background:#fff; }
    .scv-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
    .scv-table th { text-align:left; font-size:0.75rem; color:#64748b; text-transform:uppercase; font-weight:700; padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
    .scv-table td { padding:11px 14px; font-size:0.85rem; border-bottom:1px solid #f1f5f9; }
    .scv-table tr:last-child td { border-bottom:none; }
    .scv-table tr:hover { background:#f8fafc; cursor:pointer; }
    .scv-status { display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:700; color:#fff; }
    .scv-progress { height:6px; background:#f1f5f9; border-radius:3px; overflow:hidden; min-width:80px; }
    .scv-progress-fill { height:100%; background:#16a34a; }
    .scv-mono { font-family:ui-monospace,monospace; }
    .scv-empty { padding:60px 20px; text-align:center; color:#94a3b8; font-style:italic; }

    .scv-drawer-bg { position:fixed; inset:0; background:rgba(15,23,42,0.4); opacity:0; pointer-events:none; transition:opacity .2s; z-index:99; }
    .scv-drawer-bg.open { opacity:1; pointer-events:auto; }
    .scv-drawer { position:fixed; top:0; right:0; width:min(700px, 92vw); height:100vh; background:#fff; box-shadow:-4px 0 24px rgba(0,0,0,0.1); transform:translateX(100%); transition:transform .25s; z-index:100; display:flex; flex-direction:column; }
    .scv-drawer.open { transform:translateX(0); }
    .scv-drawer-head { padding:14px 18px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; gap:12px; }
    .scv-drawer-title { font-size:1.05rem; font-weight:700; flex:1; margin:0; }
    .scv-drawer-body { flex:1; overflow-y:auto; padding:16px 18px; }
    .scv-drawer-foot { padding:12px 18px; border-top:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap; }

    .scv-section { margin-bottom:18px; }
    .scv-section-title { font-size:0.8rem; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:0.4px; margin:0 0 8px; padding-bottom:6px; border-bottom:1px solid #e2e8f0; }
    .scv-kv { display:grid; grid-template-columns:140px 1fr; gap:6px 10px; font-size:0.85rem; }
    .scv-kv dt { color:#64748b; }
    .scv-kv dd { margin:0; font-weight:500; }
    .scv-kv dd.scv-mono { font-family:ui-monospace,monospace; font-size:0.78rem; word-break:break-all; }

    .scv-list-row { display:grid; grid-template-columns:1fr auto auto; gap:10px; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:0.82rem; }
    .scv-list-row:last-child { border-bottom:none; }

    .scv-event-row { display:grid; grid-template-columns:auto auto 1fr; gap:10px; padding:6px 0; font-size:0.78rem; border-bottom:1px solid #f1f5f9; }
    .scv-event-type { font-weight:600; color:#1e293b; }
    .scv-event-time { color:#94a3b8; font-family:ui-monospace,monospace; font-size:0.72rem; }
    .scv-event-payload { color:#64748b; font-family:ui-monospace,monospace; font-size:0.72rem; word-break:break-all; }

    .scv-btn { padding:7px 14px; font-size:0.85rem; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#fff; color:#1e293b; font-family:inherit; }
    .scv-btn:hover { background:#f1f5f9; }
    .scv-btn-danger { color:#dc2626; border-color:#fecaca; }
    .scv-btn-danger:hover { background:#fef2f2; }
    .scv-btn-primary { background:#3b82f6; color:#fff; border-color:#2563eb; }
    .scv-btn-primary:hover { background:#2563eb; }
    .scv-loading { padding:40px; text-align:center; color:#64748b; }
  `;
  document.head.appendChild(s);
}

async function loadCarts() {
  _scv.loading = true;
  const params = [];
  if (_scv.filterStatus && _scv.filterStatus !== 'all') {
    params.push('status=' + encodeURIComponent(_scv.filterStatus));
  }
  const qs = params.length ? '?' + params.join('&') : '';
  const data = await api('GET', '/api/admin/shared-carts' + qs);
  _scv.carts = data.carts || [];
  _scv.loading = false;
}

async function render(container) {
  injectStyles();
  container.innerHTML = '<div class="scv-loading">⏳ Chargement des paniers partagés...</div>';
  try {
    await loadCarts();
    renderHTML(container);
  } catch (err) {
    container.innerHTML = '<div class="scv-loading" style="color:#dc2626;">Erreur : ' + esc(err.message) + '</div>';
  }
}

function renderHTML(container) {
  let html = '<div class="scv-wrap">';
  html += '<h1 class="scv-h1">🤝 Paniers Partagés</h1>';
  html += '<p class="scv-sub">Vue support / arbitrage des paniers partagés Komerce. ' + _scv.carts.length + ' panier(s) affiché(s).</p>';

  // Filtres
  html += '<div class="scv-tools">';
  html += '<label>Statut :</label>';
  html += '<select class="scv-select" id="scv-filter-status">';
  html += '<option value="all"' + (_scv.filterStatus === 'all' ? ' selected' : '') + '>Tous</option>';
  Object.keys(STATUS_META).forEach(s => {
    const sel = (_scv.filterStatus === s) ? ' selected' : '';
    html += '<option value="' + s + '"' + sel + '>' + STATUS_META[s].label + '</option>';
  });
  html += '</select>';
  html += '</div>';

  if (!_scv.carts.length) {
    html += '<div class="scv-empty">Aucun panier partagé trouvé.</div>';
  } else {
    html += '<table class="scv-table">';
    html += '<thead><tr>';
    html += '<th>Bénéficiaire</th><th>Titre</th><th>Statut</th><th>Total</th><th>Contribué</th><th>Reste</th><th>Progression</th><th>Contrib.</th><th>Expire</th>';
    html += '</tr></thead><tbody>';
    _scv.carts.forEach(c => {
      const sm = STATUS_META[c.status] || { color: '#94a3b8', label: c.status };
      const pct = c.total_kmf_snapshot > 0
        ? Math.round((c.contributed_kmf / c.total_kmf_snapshot) * 100) : 0;
      const expDate = new Date(c.expires_at).toLocaleDateString('fr-FR');
      html += '<tr data-id="' + c.id + '">';
      html += '<td><strong>' + esc(c.beneficiary_full_name || '?') + '</strong><br><span style="font-size:0.72rem;color:#94a3b8;">' + esc(c.beneficiary_email || '') + '</span></td>';
      html += '<td>' + esc(c.title || '—') + '</td>';
      html += '<td><span class="scv-status" style="background:' + sm.color + ';">' + sm.label + '</span></td>';
      html += '<td class="scv-mono">' + fmt(c.total_kmf_snapshot) + '</td>';
      html += '<td class="scv-mono" style="color:#16a34a;">' + fmt(c.contributed_kmf) + '</td>';
      html += '<td class="scv-mono" style="color:#d97706;">' + fmt(c.remaining_kmf) + '</td>';
      html += '<td><div class="scv-progress"><div class="scv-progress-fill" style="width:' + pct + '%;"></div></div><div style="font-size:0.7rem;color:#94a3b8;margin-top:2px;">' + pct + '%</div></td>';
      html += '<td>' + (c.contributors_count || 0) + ' / ' + (c.contributions_total_count || 0) + '</td>';
      html += '<td style="font-size:0.78rem;">' + expDate + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  }

  html += '</div>';

  // Drawer detail
  html += renderDetail();

  container.innerHTML = html;
  bindEvents(container);
}

function renderDetail() {
  const d = _scv.detail;
  const open = !!_scv.detailId;
  let html = '<div class="scv-drawer-bg ' + (open ? 'open' : '') + '" data-act="close-drawer"></div>';
  html += '<div class="scv-drawer ' + (open ? 'open' : '') + '">';

  if (!open) { html += '</div>'; return html; }

  html += '<div class="scv-drawer-head">';
  html += '<button class="scv-btn" data-act="close-drawer">←</button>';
  html += '<h2 class="scv-drawer-title">' + (d ? esc(d.cart.title || 'Panier partagé') : '⏳ Chargement...') + '</h2>';
  html += '</div>';
  html += '<div class="scv-drawer-body">';

  if (!d) {
    html += '<div class="scv-loading">⏳ Chargement détail...</div>';
  } else {
    const c = d.cart;
    const sm = STATUS_META[c.status] || { color: '#94a3b8', label: c.status };

    // Section : infos
    html += '<div class="scv-section">';
    html += '<h3 class="scv-section-title">📋 Informations</h3>';
    html += '<dl class="scv-kv">';
    html += '<dt>ID :</dt><dd class="scv-mono">' + esc(c.id) + '</dd>';
    html += '<dt>Token :</dt><dd class="scv-mono">' + esc(c.token) + '</dd>';
    html += '<dt>Statut :</dt><dd><span class="scv-status" style="background:' + sm.color + ';">' + sm.label + '</span></dd>';
    html += '<dt>Bénéficiaire :</dt><dd>' + esc(c.beneficiary_name_snapshot || '—') + '</dd>';
    html += '<dt>Téléphone :</dt><dd>' + esc(c.beneficiary_phone_snapshot || '—') + '</dd>';
    html += '<dt>Total :</dt><dd class="scv-mono">' + fmt(c.total_kmf_snapshot) + '</dd>';
    html += '<dt>Contribué :</dt><dd class="scv-mono" style="color:#16a34a;">' + fmt(c.contributed_kmf) + '</dd>';
    html += '<dt>Reste :</dt><dd class="scv-mono" style="color:#d97706;">' + fmt(c.remaining_kmf) + '</dd>';
    html += '<dt>Vues :</dt><dd>' + (c.view_count || 0) + '</dd>';
    html += '<dt>Créé :</dt><dd>' + new Date(c.created_at).toLocaleString('fr-FR') + '</dd>';
    html += '<dt>Expire :</dt><dd>' + new Date(c.expires_at).toLocaleString('fr-FR') + '</dd>';
    if (c.finalized_order_id) {
      html += '<dt>Commande :</dt><dd class="scv-mono">' + esc(c.finalized_order_id) + '</dd>';
    }
    html += '</dl>';
    html += '</div>';

    // Section : items
    html += '<div class="scv-section">';
    html += '<h3 class="scv-section-title">🛒 Items snapshot (' + d.items.length + ')</h3>';
    d.items.forEach(it => {
      html += '<div class="scv-list-row">';
      html += '<div><strong>' + esc(it.product_name_snapshot) + '</strong><br><span style="font-size:0.74rem;color:#94a3b8;">' + esc(it.product_category_snapshot || '') + '</span></div>';
      html += '<div>×' + it.quantity + ' @ ' + fmt(it.unit_price_kmf_snapshot) + '</div>';
      html += '<div class="scv-mono"><strong>' + fmt(it.line_total_kmf_snapshot) + '</strong></div>';
      html += '</div>';
    });
    html += '</div>';

    // Section : contributions
    html += '<div class="scv-section">';
    html += '<h3 class="scv-section-title">💚 Contributions (' + d.contributions.length + ')</h3>';
    if (!d.contributions.length) {
      html += '<div style="font-style:italic;color:#94a3b8;font-size:0.85rem;">Aucune contribution enregistrée.</div>';
    } else {
      d.contributions.forEach(co => {
        const dateStr = co.paid_at ? new Date(co.paid_at).toLocaleString('fr-FR') : '—';
        html += '<div class="scv-list-row">';
        html += '<div><strong>' + esc(co.contributor_name) + '</strong><br><span style="font-size:0.72rem;color:#94a3b8;">' + esc(co.contributor_email) + '</span>';
        if (co.message) html += '<br><span style="font-size:0.72rem;font-style:italic;">« ' + esc(co.message) + ' »</span>';
        html += '</div>';
        html += '<div><span style="font-size:0.7rem;padding:2px 6px;border-radius:4px;background:#f1f5f9;">' + esc(co.status) + '</span><br><span style="font-size:0.72rem;color:#94a3b8;">' + dateStr + '</span></div>';
        html += '<div class="scv-mono">' + fmt(co.amount_kmf) + '<br><span style="font-size:0.7rem;color:#94a3b8;">' + co.amount_paid + ' ' + co.currency_paid + '</span></div>';
        html += '</div>';
      });
    }
    html += '</div>';

    // Section : events
    html += '<div class="scv-section">';
    html += '<h3 class="scv-section-title">🕓 Audit (' + d.events.length + ')</h3>';
    d.events.forEach(ev => {
      html += '<div class="scv-event-row">';
      html += '<span class="scv-event-time">' + new Date(ev.created_at).toLocaleTimeString('fr-FR') + '</span>';
      html += '<span class="scv-event-type">' + esc(ev.event_type) + '</span>';
      html += '<span class="scv-event-payload">' + esc(JSON.stringify(ev.payload || {}).slice(0, 120)) + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>';

  // Footer actions admin
  if (d) {
    const c = d.cart;
    const canExpire = ['active', 'partially_funded'].includes(c.status);
    html += '<div class="scv-drawer-foot">';
    if (canExpire) {
      html += '<button class="scv-btn scv-btn-primary" data-act="extend" data-id="' + c.id + '">+7 jours</button>';
      html += '<button class="scv-btn scv-btn-danger" data-act="expire" data-id="' + c.id + '">Forcer expiration</button>';
    }
    html += '<button class="scv-btn" data-act="add-note" data-id="' + c.id + '">📝 Ajouter note</button>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function bindEvents(container) {
  container.addEventListener('change', async (e) => {
    if (e.target.id === 'scv-filter-status') {
      _scv.filterStatus = e.target.value;
      await loadCarts();
      renderHTML(container);
    }
  });

  container.addEventListener('click', async (e) => {
    // Click sur ligne pour ouvrir le détail
    const tr = e.target.closest('tr[data-id]');
    if (tr) {
      const id = tr.dataset.id;
      _scv.detailId = id;
      _scv.detail = null;
      renderHTML(container);
      try {
        const d = await api('GET', '/api/admin/shared-carts/' + id);
        _scv.detail = d;
        renderHTML(container);
      } catch (err) {
        alert('Erreur : ' + err.message);
        _scv.detailId = null;
        renderHTML(container);
      }
      return;
    }

    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    const id = t.dataset.id;

    if (act === 'close-drawer') {
      _scv.detailId = null;
      _scv.detail = null;
      renderHTML(container);
      return;
    }

    if (act === 'extend') {
      const days = parseInt(prompt('Prolonger de combien de jours ? (1-90)', '7'), 10);
      if (!days || days < 1 || days > 90) return;
      try {
        await api('POST', '/api/admin/shared-carts/' + id + '/extend', { days });
        await loadCarts();
        const d = await api('GET', '/api/admin/shared-carts/' + id);
        _scv.detail = d;
        renderHTML(container);
      } catch (err) { alert('Erreur : ' + err.message); }
      return;
    }

    if (act === 'expire') {
      if (!confirm('Forcer l\'expiration de ce panier ?')) return;
      const reason = prompt('Raison (optionnel) :') || '';
      try {
        await api('POST', '/api/admin/shared-carts/' + id + '/expire', { reason });
        await loadCarts();
        const d = await api('GET', '/api/admin/shared-carts/' + id);
        _scv.detail = d;
        renderHTML(container);
      } catch (err) { alert('Erreur : ' + err.message); }
      return;
    }

    if (act === 'add-note') {
      const note = prompt('Note d\'arbitrage :');
      if (!note || !note.trim()) return;
      try {
        await api('POST', '/api/admin/shared-carts/' + id + '/note', { note });
        const d = await api('GET', '/api/admin/shared-carts/' + id);
        _scv.detail = d;
        renderHTML(container);
      } catch (err) { alert('Erreur : ' + err.message); }
      return;
    }
  });
}

CT.views.shared_carts = async function(container) {
  await render(container);
};

})();
