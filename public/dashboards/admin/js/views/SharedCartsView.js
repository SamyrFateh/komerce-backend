/**
 * KOMERCE Dashboard — SharedCartsView /admin/shared-carts
 * ════════════════════════════════════════════════════════════════════════
 * Migration de CT.views.shared_carts (ct-views-shared-carts.js)
 *
 * Vue support / arbitrage des paniers partagés :
 *   - Liste filtrée par statut
 *   - Détail drawer (items, contributions, audit events)
 *   - Actions admin : +7 jours / forcer expiration / note d'arbitrage
 *
 * API : KmcApi.getSharedCarts(filters) / getSharedCart(id) /
 *       expireSharedCart(id, body) / extendSharedCart(id, body) /
 *       noteSharedCart(id, body)
 */

(function (global) {
  'use strict';

  /* ── Styles ─────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('scv-styles')) return;
    const s = document.createElement('style');
    s.id = 'scv-styles';
    s.textContent = `
      .scv-header{margin-bottom:16px}
      .scv-header h2{font-size:22px;font-weight:800;color:var(--text-primary)}
      .scv-header p{font-size:13px;color:var(--text-secondary);margin-top:2px}
      .scv-toolbar{display:flex;gap:10px;align-items:center;padding:10px 14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;margin-bottom:14px}
      .scv-toolbar label{font-size:12px;color:var(--text-secondary);font-weight:600}
      .scv-select{padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;background:var(--bg-card);color:var(--text-primary)}
      .scv-table-wrap{overflow-x:auto}
      .scv-table{width:100%;border-collapse:collapse;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;overflow:hidden}
      .scv-table th{text-align:left;font-size:11px;color:var(--text-secondary);text-transform:uppercase;font-weight:700;padding:10px 14px;background:var(--bg-secondary);border-bottom:1px solid var(--border)}
      .scv-table td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--border)}
      .scv-table tr:last-child td{border-bottom:none}
      .scv-table tbody tr:hover{background:var(--bg-secondary);cursor:pointer}
      .scv-status{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;color:#fff}
      .scv-progress-bg{height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden;min-width:80px}
      .scv-progress-fill{height:100%;background:#16a34a}
      .scv-mono{font-family:ui-monospace,SFMono-Regular,monospace}
      .scv-empty{padding:60px 20px;text-align:center;color:var(--text-secondary);font-style:italic}

      /* Drawer */
      .scv-drawer-bg{position:fixed;inset:0;background:rgba(15,23,42,.4);opacity:0;pointer-events:none;transition:opacity .2s;z-index:99}
      .scv-drawer-bg.open{opacity:1;pointer-events:auto}
      .scv-drawer{position:fixed;top:0;right:0;width:min(700px,92vw);height:100vh;background:var(--bg-card);box-shadow:-4px 0 24px rgba(0,0,0,.12);transform:translateX(100%);transition:transform .25s;z-index:100;display:flex;flex-direction:column}
      .scv-drawer.open{transform:translateX(0)}
      .scv-drawer-head{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
      .scv-drawer-title{font-size:16px;font-weight:700;flex:1;margin:0;color:var(--text-primary)}
      .scv-drawer-body{flex:1;overflow-y:auto;padding:16px 18px}
      .scv-drawer-foot{padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap}

      /* Sections drawer */
      .scv-section{margin-bottom:18px}
      .scv-section-title{font-size:11px;font-weight:700;color:var(--text-primary);text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)}
      .scv-kv{display:grid;grid-template-columns:130px 1fr;gap:5px 10px;font-size:13px}
      .scv-kv dt{color:var(--text-secondary)}
      .scv-kv dd{margin:0;font-weight:500;word-break:break-all}
      .scv-list-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
      .scv-list-row:last-child{border-bottom:none}
      .scv-event-row{display:grid;grid-template-columns:80px 140px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px;font-family:ui-monospace,monospace}
      .scv-event-row:last-child{border-bottom:none}

      /* Boutons */
      .scv-btn{padding:7px 14px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:var(--bg-card);color:var(--text-primary);font-family:inherit;transition:all .15s}
      .scv-btn:hover{background:var(--bg-secondary)}
      .scv-btn-primary{background:#3b82f6;color:#fff;border-color:#2563eb}
      .scv-btn-primary:hover{background:#2563eb}
      .scv-btn-danger{color:#dc2626;border-color:#fecaca}
      .scv-btn-danger:hover{background:#fef2f2}
    `;
    document.head.appendChild(s);
  }

  /* ── Constantes ─────────────────────────────────────────────────────── */
  const STATUS_META = {
    draft:              { color: '#94a3b8', label: 'Brouillon' },
    active:             { color: '#3b82f6', label: 'Actif' },
    partially_funded:   { color: '#f59e0b', label: 'Partiellement financé' },
    fully_funded:       { color: '#16a34a', label: 'Entièrement financé' },
    converted_to_order: { color: '#64748b', label: 'Converti en commande' },
    expired:            { color: '#dc2626', label: 'Expiré' },
    cancelled:          { color: '#94a3b8', label: 'Annulé' },
    refunded:           { color: '#94a3b8', label: 'Remboursé' },
  };

  /* ── État local ─────────────────────────────────────────────────────── */
  const _state = { carts: [], filterStatus: 'all', detailId: null, detail: null };

  /* ── Utilitaires ────────────────────────────────────────────────────── */
  const NF = new Intl.NumberFormat('fr-FR');
  function _fmt(n)   { return NF.format(Math.round(n || 0)) + ' KMF'; }
  function _esc(s)   { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _dt(iso)  { return iso ? new Date(iso).toLocaleString('fr-FR') : '—'; }
  function _date(iso){ return iso ? new Date(iso).toLocaleDateString('fr-FR') : '—'; }

  /* ── Chargement ─────────────────────────────────────────────────────── */
  async function _loadCarts() {
    const extra = _state.filterStatus !== 'all' ? { status: _state.filterStatus } : {};
    const data  = await global.KmcApi.getSharedCarts(extra);
    _state.carts = data.carts || [];
  }

  /* ── Rendu liste ────────────────────────────────────────────────────── */
  function _renderList(root) {
    const carts = _state.carts;
    let html = `
      <div class="scv-header">
        <h2>🤝 Paniers Partagés</h2>
        <p>Vue support / arbitrage — ${carts.length} panier(s) affiché(s).</p>
      </div>
      <div class="scv-toolbar">
        <label>Statut :</label>
        <select class="scv-select" id="scv-filter">
          <option value="all"${_state.filterStatus==='all'?' selected':''}>Tous</option>
          ${Object.entries(STATUS_META).map(([k,v]) =>
            `<option value="${k}"${_state.filterStatus===k?' selected':''}>${v.label}</option>`).join('')}
        </select>
      </div>`;

    if (!carts.length) {
      html += '<div class="scv-empty">Aucun panier partagé trouvé.</div>';
    } else {
      html += `
        <div class="scv-table-wrap">
          <table class="scv-table">
            <thead><tr>
              <th>Bénéficiaire</th><th>Titre</th><th>Statut</th>
              <th>Total</th><th>Contribué</th><th>Reste</th>
              <th>Progression</th><th>Contrib.</th><th>Expire</th>
            </tr></thead>
            <tbody>
              ${carts.map(c => {
                const sm  = STATUS_META[c.status] || { color:'#94a3b8', label: c.status };
                const pct = c.total_kmf_snapshot > 0 ? Math.round(c.contributed_kmf / c.total_kmf_snapshot * 100) : 0;
                return `
                  <tr data-id="${c.id}">
                    <td><strong>${_esc(c.beneficiary_full_name||'?')}</strong><br><span style="font-size:11px;color:var(--text-secondary)">${_esc(c.beneficiary_email||'')}</span></td>
                    <td>${_esc(c.title||'—')}</td>
                    <td><span class="scv-status" style="background:${sm.color}">${sm.label}</span></td>
                    <td class="scv-mono">${_fmt(c.total_kmf_snapshot)}</td>
                    <td class="scv-mono" style="color:#16a34a">${_fmt(c.contributed_kmf)}</td>
                    <td class="scv-mono" style="color:#d97706">${_fmt(c.remaining_kmf)}</td>
                    <td>
                      <div class="scv-progress-bg"><div class="scv-progress-fill" style="width:${pct}%"></div></div>
                      <div style="font-size:10px;color:var(--text-secondary);margin-top:2px">${pct}%</div>
                    </td>
                    <td>${c.contributors_count||0} / ${c.contributions_total_count||0}</td>
                    <td style="font-size:12px">${_date(c.expires_at)}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // Drawer
    html += _renderDrawer();

    root.innerHTML = html;
    _bindEvents(root);
  }

  /* ── Rendu drawer ───────────────────────────────────────────────────── */
  function _renderDrawer() {
    const open = !!_state.detailId;
    const d    = _state.detail;

    let inner = '';
    if (open && !d) {
      inner = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">⏳ Chargement…</div>';
    } else if (open && d) {
      const c  = d.cart;
      const sm = STATUS_META[c.status] || { color:'#94a3b8', label: c.status };
      inner = `
        <div class="scv-section">
          <div class="scv-section-title">📋 Informations</div>
          <dl class="scv-kv">
            <dt>ID :</dt><dd class="scv-mono">${_esc(c.id)}</dd>
            <dt>Token :</dt><dd class="scv-mono">${_esc(c.token)}</dd>
            <dt>Statut :</dt><dd><span class="scv-status" style="background:${sm.color}">${sm.label}</span></dd>
            <dt>Bénéficiaire :</dt><dd>${_esc(c.beneficiary_name_snapshot||'—')}</dd>
            <dt>Téléphone :</dt><dd>${_esc(c.beneficiary_phone_snapshot||'—')}</dd>
            <dt>Total :</dt><dd class="scv-mono">${_fmt(c.total_kmf_snapshot)}</dd>
            <dt>Contribué :</dt><dd class="scv-mono" style="color:#16a34a">${_fmt(c.contributed_kmf)}</dd>
            <dt>Reste :</dt><dd class="scv-mono" style="color:#d97706">${_fmt(c.remaining_kmf)}</dd>
            <dt>Vues :</dt><dd>${c.view_count||0}</dd>
            <dt>Créé :</dt><dd>${_dt(c.created_at)}</dd>
            <dt>Expire :</dt><dd>${_dt(c.expires_at)}</dd>
            ${c.finalized_order_id?`<dt>Commande :</dt><dd class="scv-mono">${_esc(c.finalized_order_id)}</dd>`:''}
          </dl>
        </div>

        <div class="scv-section">
          <div class="scv-section-title">🛒 Items snapshot (${d.items.length})</div>
          ${d.items.map(it => `
            <div class="scv-list-row">
              <div><strong>${_esc(it.product_name_snapshot)}</strong><br><span style="font-size:11px;color:var(--text-secondary)">${_esc(it.product_category_snapshot||'')}</span></div>
              <div>×${it.quantity} @ ${_fmt(it.unit_price_kmf_snapshot)}</div>
              <div class="scv-mono"><strong>${_fmt(it.line_total_kmf_snapshot)}</strong></div>
            </div>`).join('')}
        </div>

        <div class="scv-section">
          <div class="scv-section-title">💚 Contributions (${d.contributions.length})</div>
          ${!d.contributions.length
            ? '<div style="font-style:italic;color:var(--text-secondary);font-size:13px">Aucune contribution.</div>'
            : d.contributions.map(co => `
              <div class="scv-list-row">
                <div>
                  <strong>${_esc(co.contributor_name)}</strong><br>
                  <span style="font-size:11px;color:var(--text-secondary)">${_esc(co.contributor_email)}</span>
                  ${co.message?`<br><span style="font-size:11px;font-style:italic">« ${_esc(co.message)} »</span>`:''}
                </div>
                <div>
                  <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--bg-secondary)">${_esc(co.status)}</span><br>
                  <span style="font-size:11px;color:var(--text-secondary)">${co.paid_at?_dt(co.paid_at):'—'}</span>
                </div>
                <div class="scv-mono">${_fmt(co.amount_kmf)}<br><span style="font-size:10px;color:var(--text-secondary)">${co.amount_paid} ${co.currency_paid}</span></div>
              </div>`).join('')}
        </div>

        <div class="scv-section">
          <div class="scv-section-title">🕓 Audit (${d.events.length})</div>
          ${d.events.map(ev => `
            <div class="scv-event-row">
              <span style="color:var(--text-secondary)">${new Date(ev.created_at).toLocaleTimeString('fr-FR')}</span>
              <span style="font-weight:600;color:var(--text-primary)">${_esc(ev.event_type)}</span>
              <span style="color:var(--text-secondary)">${_esc(JSON.stringify(ev.payload||{}).slice(0,120))}</span>
            </div>`).join('')}
        </div>`;
    }

    const canAct = d && ['active','partially_funded'].includes(d.cart.status);

    return `
      <div class="scv-drawer-bg${open?' open':''}" data-act="close"></div>
      <div class="scv-drawer${open?' open':''}">
        <div class="scv-drawer-head">
          <button class="scv-btn" data-act="close">←</button>
          <h2 class="scv-drawer-title">${d ? _esc(d.cart.title||'Panier partagé') : '⏳ Chargement…'}</h2>
        </div>
        <div class="scv-drawer-body">${inner}</div>
        ${open && d ? `
          <div class="scv-drawer-foot">
            ${canAct ? `
              <button class="scv-btn scv-btn-primary" data-act="extend" data-id="${d.cart.id}">+7 jours</button>
              <button class="scv-btn scv-btn-danger"  data-act="expire"  data-id="${d.cart.id}">Forcer expiration</button>` : ''}
            <button class="scv-btn" data-act="add-note" data-id="${d.cart.id}">📝 Note</button>
          </div>` : ''}
      </div>`;
  }

  /* ── Bind events ────────────────────────────────────────────────────── */
  function _bindEvents(root) {
    // Filtre statut
    const filterEl = document.getElementById('scv-filter');
    if (filterEl) {
      filterEl.addEventListener('change', async () => {
        _state.filterStatus = filterEl.value;
        await _loadCarts();
        _renderList(root);
      });
    }

    // Click sur ligne → ouvrir drawer
    root.addEventListener('click', async e => {
      // Ignorer si c'est un bouton d'action
      if (e.target.closest('[data-act]')) return;
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      _state.detailId = tr.dataset.id;
      _state.detail   = null;
      _renderList(root);
      try {
        _state.detail = await global.KmcApi.getSharedCart(_state.detailId);
        _renderList(root);
      } catch (err) {
        alert('Erreur : ' + err.message);
        _state.detailId = null;
        _renderList(root);
      }
    });

    // Actions drawer
    root.addEventListener('click', async e => {
      const t   = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      const id  = t.dataset.id;

      if (act === 'close') {
        _state.detailId = null;
        _state.detail   = null;
        _renderList(root);
        return;
      }

      if (act === 'extend') {
        const days = parseInt(prompt('Prolonger de combien de jours ? (1-90)', '7'), 10);
        if (!days || days < 1 || days > 90) return;
        try {
          await global.KmcApi.extendSharedCart(id, { days });
          await _loadCarts();
          _state.detail = await global.KmcApi.getSharedCart(id);
          _renderList(root);
        } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }

      if (act === 'expire') {
        if (!confirm('Forcer l\'expiration de ce panier ?')) return;
        const reason = prompt('Raison (optionnel) :') || '';
        try {
          await global.KmcApi.expireSharedCart(id, { reason });
          await _loadCarts();
          _state.detail = await global.KmcApi.getSharedCart(id);
          _renderList(root);
        } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }

      if (act === 'add-note') {
        const note = prompt('Note d\'arbitrage :');
        if (!note || !note.trim()) return;
        try {
          await global.KmcApi.noteSharedCart(id, { note });
          _state.detail = await global.KmcApi.getSharedCart(id);
          _renderList(root);
        } catch (err) { alert('Erreur : ' + err.message); }
        return;
      }
    });
  }

  /* ── Point d'entrée ─────────────────────────────────────────────────── */
  global.SharedCartsView = async function render(root) {
    _injectStyles();
    root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">🤝 Chargement des paniers partagés…</div>';
    try {
      await _loadCarts();
      _renderList(root);
    } catch (err) {
      root.innerHTML = `<div style="padding:40px;text-align:center;color:#dc2626">❌ ${_esc(err.message)}</div>`;
    }
  };

})(window);

