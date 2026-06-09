/* ═══════════════════════════════════════════════════════════════════════════
   AccountingView — /admin/accounting
   Lot 7 — parité ct-views-accounting.js (legacy)

   Sources:
     KmcApi.getFinance(filters)               → /api/dashboard/finance
     KmcApi.getEconomicCharges()              → /api/admin/economic/charges
     KmcApi.getCashReconciliation(params)     → /api/cash/reconciliation
     KmcApi.getCashUncollected(params)        → /api/cash/uncollected
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const AccountingView = (function () {

  /* ── Styles (injectés une seule fois) ─────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('acct-view-styles')) return;
    const style = document.createElement('style');
    style.id = 'acct-view-styles';
    style.textContent = `
      .acct-period-bar { display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap; align-items:center; }
      .acct-period-bar button { padding:6px 14px; border:1px solid #cbd5e1; background:white; border-radius:20px;
        font-size:13px; font-weight:600; cursor:pointer; transition:all 0.15s; }
      .acct-period-bar button:hover { border-color:#3b82f6; }
      .acct-period-bar button.active { background:#3b82f6; color:white; border-color:#3b82f6; }
      .acct-daterange { display:flex; align-items:center; gap:8px; margin-left:auto; font-size:13px; flex-wrap:wrap; }
      .acct-daterange input { padding:5px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; }
      .acct-section-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
      .acct-section-head h3 { margin:0; }
      .acct-export-btn { padding:4px 12px; background:white; border:1px solid #cbd5e1; border-radius:6px;
        font-size:12px; font-weight:600; cursor:pointer; color:#475569; }
      .acct-export-btn:hover { background:#f1f5f9; border-color:#94a3b8; }
      .acct-hint { font-size:11px; color:#64748b; font-style:italic; margin-bottom:10px; }
      .acct-balance-sub { font-size:11px; color:#64748b; margin-top:2px; }
      /* Ledger */
      .acct-ledger-family { background:white; border:1px solid #e2e8f0; border-radius:10px;
        margin-bottom:10px; overflow:hidden; }
      .acct-ledger-family-head { padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0;
        display:flex; justify-content:space-between; align-items:center; cursor:pointer; }
      .acct-ledger-family-head:hover { background:#f1f5f9; }
      .acct-ledger-family-head h4 { margin:0; font-size:14px; }
      .acct-ledger-family-total { font-weight:700; font-size:15px; color:#0f172a; }
      .acct-ledger-family-body { display:none; padding:4px 0; }
      .acct-ledger-family.open .acct-ledger-family-body { display:block; }
      .acct-ledger-family.open .acct-ledger-arrow { transform:rotate(90deg); }
      .acct-ledger-arrow { display:inline-block; transition:transform 0.15s; margin-right:6px;
        font-size:10px; color:#64748b; }
      .acct-ledger-line { padding:6px 18px; display:grid; grid-template-columns:1fr auto 90px 80px;
        gap:12px; align-items:center; font-size:13px; border-bottom:1px solid #f1f5f9; }
      .acct-ledger-line:last-child { border-bottom:none; }
      .acct-ledger-line-name { font-weight:500; color:#334155; }
      .acct-ledger-line-recurrence { font-size:11px; color:#64748b; text-transform:uppercase; }
      .acct-ledger-line-amount { text-align:right; font-weight:700; }
      .acct-ledger-line-status { text-align:center; font-size:10px; }
      .acct-ledger-line.inactive { opacity:0.5; }
      /* Reconciliation */
      .acct-reco-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
      .acct-reco-card { background:white; border:1px solid #e2e8f0; border-radius:10px;
        padding:14px; border-left:4px solid #94a3b8; }
      .acct-reco-card.status-clean   { border-left-color:#10b981; }
      .acct-reco-card.status-warning { border-left-color:#f59e0b; }
      .acct-reco-card.status-alert   { border-left-color:#ef4444; background:#fef2f2; }
      .acct-reco-card h5 { margin:0 0 10px; font-size:14px; color:#0f172a; }
      .acct-reco-row { display:flex; justify-content:space-between; padding:4px 0;
        font-size:13px; border-bottom:1px dashed #f1f5f9; }
      .acct-reco-row:last-child { border-bottom:none; }
      .acct-reco-gap-warn  { color:#d97706; }
      .acct-reco-gap-alert { color:#dc2626; }
      /* Uncollected */
      .acct-uncollected-table { width:100%; border-collapse:collapse; font-size:13px;
        background:white; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0; }
      .acct-uncollected-table th { background:#1e293b; color:white; padding:10px 12px;
        text-align:left; font-size:11px; text-transform:uppercase; }
      .acct-uncollected-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; }
      .acct-uncollected-table tr:last-child td { border-bottom:none; }
      .acct-age-badge { display:inline-block; padding:2px 8px; border-radius:10px;
        font-size:11px; font-weight:700; }
      .acct-age-low  { background:#fef3c7; color:#92400e; }
      .acct-age-mid  { background:#fed7aa; color:#9a3412; }
      .acct-age-high { background:#fee2e2; color:#991b1b; }
    `;
    document.head.appendChild(style);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function fmt(n)    { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtEur(n) { return (Number(n) || 0).toFixed(2) + ' €'; }
  function fmtShort(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'k';
    return String(Math.round(v));
  }
  function today()    { return new Date().toISOString().slice(0, 10); }
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
  function hoursSince(ds) { return ds ? Math.floor((Date.now() - new Date(ds).getTime()) / 3600000) : 0; }
  function escCsv(v) {
    const s = (v == null) ? '' : String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(escCsv).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  /* ── State ───────────────────────────────────────────────────────────── */
  let state = {
    period: 30,
    from: daysAgo(30),
    to: today(),
    uncollectedHours: 48,
    openFamilies: {},
    data: { finance: null, charges: null, reco: null, uncollected: null },
  };

  let _main = null;

  /* ── Public render ───────────────────────────────────────────────────── */
  async function render(main) {
    _main = main;
    injectStyles();
    // Reset state when view is re-mounted
    state = {
      period: 30,
      from: daysAgo(30),
      to: today(),
      uncollectedHours: 48,
      openFamilies: {},
      data: { finance: null, charges: null, reco: null, uncollected: null },
    };
    await load();
  }

  async function load() {
    _main.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement comptabilité…</div>';
    try {
      const [finance, charges, reco, uncollected] = await Promise.all([
        KmcApi.getFinance({ period: state.period }).catch(() => null),
        KmcApi.getEconomicCharges().catch(() => null),
        KmcApi.getCashReconciliation({ from: state.from, to: state.to }).catch(() => null),
        KmcApi.getCashUncollected({ hours: state.uncollectedHours }).catch(() => null),
      ]);
      state.data = { finance, charges, reco, uncollected };
      buildUI();
    } catch (err) {
      _main.innerHTML = `<div class="error-state">❌ Erreur chargement comptabilité : ${err.message || err}</div>`;
    }
  }

  /* ── UI builder ──────────────────────────────────────────────────────── */
  function buildUI() {
    let html = '';

    // Header
    html += `<div class="ct-view-header">
      <h2>📊 Comptabilité</h2>
      <div class="ct-subtitle">Grand livre · Réconciliation cash · Trésorerie multi-devises</div>
    </div>`;

    // Period selector
    html += '<div class="acct-period-bar">';
    for (const p of [7, 30, 90, 365]) {
      const label = p === 365 ? '1 an' : `${p}j`;
      html += `<button data-period="${p}"${state.period === p ? ' class="active"' : ''}>${label}</button>`;
    }
    html += `<div class="acct-daterange">
      <span>Cash période :</span>
      <input type="date" id="acct-from" value="${state.from}">
      <span>→</span>
      <input type="date" id="acct-to" value="${state.to}">
      <button class="ct-btn ct-btn-secondary" id="acct-daterange-apply" style="padding:4px 10px;font-size:12px">Appliquer</button>
    </div>`;
    html += '</div>';

    html += renderKPI();
    html += renderLedger();
    html += renderReconciliation();
    html += renderUncollected();
    html += renderTopProducts();

    _main.innerHTML = html;
    wireEvents();
  }

  /* ── KPI ─────────────────────────────────────────────────────────────── */
  function renderKPI() {
    const fin      = state.data.finance || {};
    const kpi      = fin.kpi || {};
    const marges   = fin.marges || {};
    const paie     = fin.paiements || {};
    const taux     = (fin.taux && fin.taux.eur_kmf) ? fin.taux.eur_kmf : '—';
    const cashKmf  = (paie.cash   && paie.cash.total_kmf)    || 0;
    const stripeEur= (paie.stripe && paie.stripe.total_eur)   || 0;
    const tauxMarge = marges.taux_marge_pct;
    const margeColor = tauxMarge >= 25 ? '#16a34a' : (tauxMarge >= 15 ? '#d97706' : '#dc2626');

    let html = '<div class="ct-kpi-grid">';
    html += `<div class="ct-kpi"><div class="ct-kpi-icon">🇰🇲</div><div>
      <div class="ct-kpi-value">${fmtShort(kpi.ca_kmf || 0)} <span style="font-size:13px;font-weight:500;color:#64748b">KMF</span></div>
      <div class="ct-kpi-label">CA période (${state.period}j)</div>
      <div class="acct-balance-sub">Cash : ${fmtShort(cashKmf)} KMF</div>
    </div></div>`;
    html += `<div class="ct-kpi"><div class="ct-kpi-icon">🇪🇺</div><div>
      <div class="ct-kpi-value">${fmt(Math.round(kpi.ca_eur || 0))} <span style="font-size:13px;font-weight:500;color:#64748b">€</span></div>
      <div class="ct-kpi-label">Contre-valeur EUR</div>
      <div class="acct-balance-sub">Stripe : ${fmtEur(stripeEur)}</div>
    </div></div>`;
    html += `<div class="ct-kpi"><div class="ct-kpi-icon">💱</div><div>
      <div class="ct-kpi-value">${taux}</div>
      <div class="ct-kpi-label">Taux EUR/KMF</div>
    </div></div>`;
    html += `<div class="ct-kpi"><div class="ct-kpi-icon">📈</div><div>
      <div class="ct-kpi-value" style="color:${margeColor}">${fmtShort(marges.marge_reelle_kmf || 0)}
        <span style="font-size:13px;font-weight:500;color:#64748b">KMF</span></div>
      <div class="ct-kpi-label">Marge réelle${tauxMarge != null ? ` · <strong>${tauxMarge}%</strong>` : ''}</div>
      ${marges.nb_sans_cost > 0 ? `<div class="acct-balance-sub">${marges.nb_avec_cost}/${marges.nb_avec_cost + marges.nb_sans_cost} avec coûts</div>` : ''}
    </div></div>`;
    html += '</div>';
    return html;
  }

  /* ── Grand livre ─────────────────────────────────────────────────────── */
  function renderLedger() {
    const data = state.data.charges;
    let html = `<div class="ct-section-block">
      <div class="acct-section-head">
        <h3>📒 Grand livre — charges par section</h3>
        <button class="acct-export-btn" data-export="ledger">⬇ CSV</button>
      </div>
      <div class="acct-hint">Charges récurrentes ou à la commande, regroupées par famille métier.
        Gérées depuis la vue <strong>Moteur économique</strong>.</div>`;

    if (!data || !data.families) {
      return html + '<div class="empty-state">Moteur économique non disponible.</div></div>';
    }
    const families = data.families;
    const totals   = data.totals || {};
    const famKeys  = Object.keys(families);
    if (!famKeys.length) {
      return html + '<div class="empty-state">Aucune charge enregistrée.</div></div>';
    }

    html += `<div style="display:flex;gap:16px;margin-bottom:12px;padding:10px 14px;background:#f1f5f9;border-radius:8px;font-size:13px;flex-wrap:wrap">
      <span><strong>Mensuel récurrent :</strong> ${fmt(Math.round(totals.monthly || 0))} KMF</span>
      <span><strong>Par commande :</strong> ${fmt(Math.round(totals.per_order || 0))} KMF</span>
      ${totals.weekly  ? `<span><strong>Hebdo :</strong> ${fmt(Math.round(totals.weekly))} KMF</span>` : ''}
      ${totals.one_time? `<span><strong>Ponctuel :</strong> ${fmt(Math.round(totals.one_time))} KMF</span>` : ''}
    </div>`;

    famKeys.forEach(fk => {
      const fam    = families[fk];
      const isOpen = state.openFamilies[fk] === true;
      html += `<div class="acct-ledger-family${isOpen ? ' open' : ''}" data-fam="${fk}">
        <div class="acct-ledger-family-head" data-toggle="${fk}">
          <h4><span class="acct-ledger-arrow">▶</span>${fam.emoji || '📦'} ${fam.label || fk}
            <span style="font-size:11px;color:#64748b;font-weight:500">(${fam.charges.length} ligne${fam.charges.length > 1 ? 's' : ''})</span></h4>
          <div class="acct-ledger-family-total">${fmt(Math.round(fam.total_kmf))} KMF</div>
        </div>
        <div class="acct-ledger-family-body">`;
      (fam.charges || []).forEach(c => {
        html += `<div class="acct-ledger-line${c.is_active ? '' : ' inactive'}">
          <div class="acct-ledger-line-name">${c.name || '—'}
            ${c.notes ? `<div style="font-size:11px;color:#94a3b8;font-weight:400">${c.notes}</div>` : ''}</div>
          <div class="acct-ledger-line-recurrence">${c.recurrence_period || '—'}</div>
          <div class="acct-ledger-line-amount">${fmt(Math.round(c.amount_kmf || 0))} KMF</div>
          <div class="acct-ledger-line-status">${c.is_active ? '✅' : '⊘'}</div>
        </div>`;
      });
      html += '</div></div>';
    });

    html += '</div>';
    return html;
  }

  /* ── Réconciliation cash ─────────────────────────────────────────────── */
  function renderReconciliation() {
    const reco = state.data.reco;
    let html = `<div class="ct-section-block">
      <div class="acct-section-head">
        <h3>🔁 Réconciliation cash relais</h3>
        <button class="acct-export-btn" data-export="reco">⬇ CSV</button>
      </div>
      <div class="acct-hint">Pour chaque agent : <strong>Attendu</strong> (livrées cash) vs
        <strong>Collecté</strong> (déclaré) vs <strong>Déposé</strong> (remis au siège).</div>`;

    if (!reco || !reco.agents) {
      return html + '<div class="empty-state">Aucune donnée de réconciliation sur la période.</div></div>';
    }
    const totals = reco.totals || {};
    const gColl  = totals.gap_collection || 0;
    const gDep   = totals.gap_deposit || 0;
    html += `<div style="display:flex;gap:16px;margin-bottom:12px;padding:10px 14px;background:#f1f5f9;border-radius:8px;font-size:13px;flex-wrap:wrap">
      <span><strong>Attendu :</strong> ${fmt(Math.round(totals.expected_kmf || 0))} KMF</span>
      <span><strong>Collecté :</strong> ${fmt(Math.round(totals.declared_kmf || 0))} KMF</span>
      <span><strong>Déposé :</strong> ${fmt(Math.round(totals.deposited_kmf || 0))} KMF</span>
      <span><strong>Gap collecte :</strong> <span style="color:${Math.abs(gColl) > 0 ? '#dc2626' : '#16a34a'}">${fmt(Math.round(gColl))}</span></span>
      <span><strong>En transit :</strong> <span style="color:${Math.abs(gDep) > 0 ? '#d97706' : '#16a34a'}">${fmt(Math.round(gDep))}</span></span>
    </div>`;

    if (!reco.agents.length) {
      return html + '<div class="empty-state">Aucun agent actif sur la période.</div></div>';
    }

    html += '<div class="acct-reco-grid">';
    reco.agents.forEach(a => {
      const status = a.status || 'warning';
      const gColl  = a.gap_collection || 0;
      const gCls   = gColl > (a.expected_kmf || 0) * 0.1 ? 'acct-reco-gap-alert'
                   : (Math.abs(gColl) > 0 ? 'acct-reco-gap-warn' : '');
      html += `<div class="acct-reco-card status-${status}">
        <h5>${a.agent_name || (a.agent_id ? a.agent_id.slice(0, 8) : 'Agent ?')}</h5>
        <div class="acct-reco-row"><span>Attendu</span><strong>${fmt(Math.round(a.expected_kmf))} KMF</strong></div>
        <div class="acct-reco-row"><span>Collecté</span><strong>${fmt(Math.round(a.declared_kmf))} KMF</strong></div>
        <div class="acct-reco-row"><span>Déposé vérifié</span><strong>${fmt(Math.round(a.verified_kmf || 0))} KMF</strong></div>
        ${a.pending_kmf  > 0 ? `<div class="acct-reco-row"><span style="color:#d97706">En attente</span><strong>${fmt(Math.round(a.pending_kmf))}</strong></div>` : ''}
        ${a.disputed_kmf > 0 ? `<div class="acct-reco-row"><span style="color:#dc2626">Litigieux</span><strong>${fmt(Math.round(a.disputed_kmf))}</strong></div>` : ''}
        <div class="acct-reco-row"><span>Écart collecte</span><strong class="${gCls}">${gColl > 0 ? '+' : ''}${fmt(Math.round(gColl))}</strong></div>
      </div>`;
    });
    html += '</div></div>';
    return html;
  }

  /* ── Commandes non encaissées ────────────────────────────────────────── */
  function renderUncollected() {
    const unc = state.data.uncollected;
    let html = `<div class="ct-section-block">
      <div class="acct-section-head">
        <h3>⏰ Commandes non encaissées
          <span style="font-size:12px;font-weight:500;color:#64748b">(livrées il y a +${state.uncollectedHours}h)</span>
        </h3>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="acct-unc-hours" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px">
            ${[24, 48, 72, 168].map(h =>
              `<option value="${h}"${state.uncollectedHours === h ? ' selected' : ''}>${h === 168 ? '7 jours' : h + 'h'}</option>`
            ).join('')}
          </select>
          <button class="acct-export-btn" data-export="uncollected">⬇ CSV</button>
        </div>
      </div>
      <div class="acct-hint">Commandes cash livrées sans confirmation de paiement — signal opérationnel à relancer.</div>`;

    if (!unc || !unc.orders || !unc.orders.length) {
      return html + `<div class="empty-state">✅ Aucune commande non encaissée au-delà de ${state.uncollectedHours}h.</div></div>`;
    }

    html += `<div style="margin-bottom:10px;padding:8px 12px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;font-size:13px">
      <strong>${unc.count} commande${unc.count > 1 ? 's' : ''}</strong> · Total manquant :
      <strong>${fmt(Math.round(unc.total_missing_kmf || 0))} KMF</strong>
    </div>`;

    html += '<div style="overflow-x:auto"><table class="acct-uncollected-table"><thead><tr>';
    html += '<th>Âge</th><th>Référence</th><th>Client</th><th>Montant</th><th>Statut</th><th>Créée le</th>';
    html += '</tr></thead><tbody>';
    unc.orders.forEach(o => {
      const h       = hoursSince(o.created_at);
      const ageCls  = h > 168 ? 'acct-age-high' : (h > 72 ? 'acct-age-mid' : 'acct-age-low');
      const ageLabel= h >= 48 ? `${Math.floor(h / 24)}j` : `${h}h`;
      const dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString('fr-FR') : '—';
      html += `<tr>
        <td><span class="acct-age-badge ${ageCls}">${ageLabel}</span></td>
        <td><strong>${o.reference || '—'}</strong></td>
        <td>${o.client_name || '—'}${o.client_phone ? `<br><span style="font-size:11px;color:#64748b">${o.client_phone}</span>` : ''}</td>
        <td><strong>${fmt(Math.round(o.total_kmf || 0))} KMF</strong></td>
        <td>${o.status || '—'}</td>
        <td>${dateStr}</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  /* ── Top produits ────────────────────────────────────────────────────── */
  function renderTopProducts() {
    const fin     = state.data.finance || {};
    const prods   = fin.top_produits || [];
    let html = `<div class="ct-section-block">
      <div class="acct-section-head">
        <h3>📋 Top produits période (${state.period}j)</h3>
        <button class="acct-export-btn" data-export="topprods">⬇ CSV</button>
      </div>
      <div class="acct-hint">Vue synthétique des produits contributeurs au CA.
        Pour les transactions individuelles, voir la vue <strong>Ventes</strong>.</div>`;

    if (!prods.length) {
      return html + '<div class="empty-state">Aucune donnée sur la période.</div></div>';
    }

    html += '<table class="ct-table"><thead><tr><th>#</th><th>Produit</th><th>Catégorie</th><th>Qté</th><th>CA (KMF)</th></tr></thead><tbody>';
    prods.forEach((p, i) => {
      html += `<tr>
        <td><strong>${i + 1}</strong></td>
        <td>${p.nom || '—'}</td>
        <td style="text-transform:capitalize;color:#64748b">${p.categorie || '—'}</td>
        <td>${p.qty || 0}</td>
        <td><strong>${fmt(p.ca_kmf)}</strong></td>
      </tr>`;
    });
    html += '</tbody></table></div>';
    return html;
  }

  /* ── Events ──────────────────────────────────────────────────────────── */
  function wireEvents() {
    // Period tabs
    _main.querySelectorAll('.acct-period-bar button[data-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.period = parseInt(btn.dataset.period, 10);
        load();
      });
    });

    // Date range apply
    const applyBtn = _main.querySelector('#acct-daterange-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const f = _main.querySelector('#acct-from').value;
        const t = _main.querySelector('#acct-to').value;
        if (f && t && f <= t) { state.from = f; state.to = t; load(); }
        else alert('⚠️ Plage de dates invalide');
      });
    }

    // Uncollected hours
    const uncSel = _main.querySelector('#acct-unc-hours');
    if (uncSel) {
      uncSel.addEventListener('change', () => {
        state.uncollectedHours = parseInt(uncSel.value, 10);
        load();
      });
    }

    // Ledger accordions
    _main.querySelectorAll('.acct-ledger-family-head[data-toggle]').forEach(h => {
      h.addEventListener('click', () => {
        const k = h.dataset.toggle;
        state.openFamilies[k] = !state.openFamilies[k];
        h.parentElement.classList.toggle('open', state.openFamilies[k]);
      });
    });

    // CSV exports
    _main.querySelectorAll('.acct-export-btn[data-export]').forEach(btn => {
      btn.addEventListener('click', () => exportCsv(btn.dataset.export));
    });
  }

  /* ── CSV exports ─────────────────────────────────────────────────────── */
  function exportCsv(kind) {
    const ts = today();
    if (kind === 'ledger') {
      const d = state.data.charges;
      if (!d || !d.families) return alert('Rien à exporter');
      const rows = [['Section', 'Label', 'Nom', 'Montant KMF', 'Récurrence', 'Actif', 'Notes']];
      Object.entries(d.families).forEach(([fk, fam]) => {
        (fam.charges || []).forEach(c => {
          rows.push([fk, fam.label, c.name, c.amount_kmf, c.recurrence_period || '', c.is_active ? 'oui' : 'non', c.notes || '']);
        });
      });
      downloadCsv(`komerce-grand-livre-${ts}.csv`, rows);
    } else if (kind === 'reco') {
      const r = state.data.reco;
      if (!r || !r.agents) return alert('Rien à exporter');
      const rows = [['Agent', 'Attendu KMF', 'Collecté KMF', 'Déposé vérifié', 'En attente', 'Litigieux', 'Gap collecte', 'Statut']];
      r.agents.forEach(a => rows.push([
        a.agent_name || a.agent_id, a.expected_kmf, a.declared_kmf,
        a.verified_kmf || 0, a.pending_kmf || 0, a.disputed_kmf || 0,
        a.gap_collection, a.status,
      ]));
      downloadCsv(`komerce-reconciliation-${state.from}-au-${state.to}.csv`, rows);
    } else if (kind === 'uncollected') {
      const u = state.data.uncollected;
      if (!u || !u.orders) return alert('Rien à exporter');
      const rows = [['Référence', 'Client', 'Téléphone', 'Montant KMF', 'Statut', 'Créée le', 'Âge (h)']];
      u.orders.forEach(o => rows.push([
        o.reference, o.client_name || '', o.client_phone || '',
        o.total_kmf, o.status,
        o.created_at ? new Date(o.created_at).toISOString().slice(0, 10) : '',
        hoursSince(o.created_at),
      ]));
      downloadCsv(`komerce-non-encaissees-${ts}.csv`, rows);
    } else if (kind === 'topprods') {
      const prods = (state.data.finance || {}).top_produits || [];
      const rows  = [['Rang', 'Produit', 'Catégorie', 'Quantité', 'CA KMF']];
      prods.forEach((p, i) => rows.push([i + 1, p.nom, p.categorie, p.qty, p.ca_kmf]));
      downloadCsv(`komerce-top-produits-${state.period}j-${ts}.csv`, rows);
    }
  }

  return { render };
})();
