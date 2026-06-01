/**
 * KOMERCE Dashboard — Vue Centre d'actions /admin/action-center
 * ════════════════════════════════════════════════════════════════
 * Cockpit décisionnel : tous les signaux actifs, groupés par famille,
 * triés par sévérité.  Actions inline : vu / snooze 24h / résolu.
 *
 * Migré depuis : ct-views-action-center.js (280 l.)
 * API          : KmcApi.getSignalsStats / getSignalsList / generateSignals
 *                      acknowledgeSignal / snoozeSignal / resolveSignal
 * Drill-down   : émet window CustomEvent 'kmc:navigate' (remplace CT.platform.drillDown)
 */

(function (global) {
  'use strict';

  // ── Familles de signaux ───────────────────────────────────────────────────

  const FAMILIES = [
    { id: 'ops',      emoji: '🚨', label: 'Opérations bloquées', color: '#ef4444' },
    { id: 'eco',      emoji: '📊', label: 'Alertes économiques',  color: '#f59e0b' },
    { id: 'sourcing', emoji: '🔍', label: 'Sourcing à arbitrer',  color: '#8b5cf6' },
    { id: 'disputes', emoji: '⚖️',  label: 'Incidents & litiges', color: '#dc2626' },
  ];

  const FAMILY_MAP = {
    parcel_blocked: 'ops', cash_expiring: 'ops', sla_breach: 'ops',
    hub_tension: 'ops', relay_tension: 'ops', loyalty_pending: 'ops',
    margin_drift: 'eco', pricing_outlier: 'eco', category_drift: 'eco', recon_anomaly: 'eco',
    sourcing_arbitrage: 'sourcing', product_dead: 'sourcing', product_star: 'sourcing', stock_rupture: 'sourcing',
    dispute_sensitive: 'disputes',
  };

  const SEV_COLORS = {
    urgent: '#dc2626', critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6',
  };
  const SEV_ORDER  = { urgent: 0, critical: 1, warning: 2, info: 3 };
  const SEV_LABELS = { urgent: '🔴 Urgent', critical: '🟠 Critique', warning: '🟡 Attention', info: '🔵 Info' };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (diff < 60)    return 'à l\'instant';
    if (diff < 3600)  return Math.floor(diff / 60) + ' min';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'j';
  }

  function kpiCard(emoji, value, label, bg) {
    return `<div class="kpi-card" style="background:${bg};display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;min-width:140px">
      <span style="font-size:1.5rem">${emoji}</span>
      <div><div style="font-size:1.4rem;font-weight:700;line-height:1">${value}</div>
           <div style="font-size:0.78rem;color:var(--text-secondary,#64748b);margin-top:2px">${label}</div></div>
    </div>`;
  }

  // ── Render signal card ────────────────────────────────────────────────────

  function renderSignalCard(signal, hidden) {
    const sevColor = SEV_COLORS[signal.severity] || '#94a3b8';
    const sevLabel = SEV_LABELS[signal.severity] || signal.severity;

    let drillBtn = '';
    if (signal.target_view) {
      const drillParams = {
        view: signal.target_view,
        filters: signal.target_filters || {},
        highlightId: signal.entity_id,
      };
      drillBtn = `<button class="btn-ghost" style="font-size:12px;padding:4px 10px"
        data-signal-drill='${JSON.stringify(drillParams).replace(/'/g, '&#39;')}'>🔗 Voir</button>`;
    }

    return `
      <div class="signal-card" style="border-left:3px solid ${sevColor};margin-bottom:8px;
           background:var(--surface,#fff);border-radius:8px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.06)"
           ${hidden || ''}>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;
                background:${sevColor}18;color:${sevColor}">${sevLabel}</span>
          <strong style="font-size:14px">${esc(signal.title)}</strong>
        </div>
        ${signal.summary ? `<div style="font-size:13px;color:var(--text-secondary,#475569);margin-bottom:6px">${esc(signal.summary)}</div>` : ''}
        ${signal.recommendation ? `<div style="padding:6px 10px;background:#f0fdf4;border-radius:6px;font-size:13px;color:#16a34a;margin-bottom:8px">
          💡 ${esc(signal.recommendation)}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${drillBtn}
          <button class="btn-ghost" style="font-size:12px;padding:4px 10px" data-signal-ack="${signal.id}">👁 Vu</button>
          <button class="btn-ghost" style="font-size:12px;padding:4px 10px" data-signal-snooze="${signal.id}">💤 24h</button>
          <button style="font-size:12px;padding:4px 10px;border:none;border-radius:6px;background:#d1fae5;color:#065f46;cursor:pointer;font-weight:600"
            data-signal-resolve="${signal.id}">✅ Résolu</button>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:var(--text-tertiary,#94a3b8)">
          <span>🏷 ${signal.signal_type}</span>
          <span>${timeAgo(signal.created_at)}</span>
        </div>
      </div>`;
  }

  // ── Render family section ─────────────────────────────────────────────────

  function renderFamilySection(fam, items) {
    if (items.length === 0) return '';
    const MAX_VISIBLE = 3;
    const overflow = items.length - MAX_VISIBLE;
    const extraId  = `ac-extra-${fam.id}`;

    let cards = items.map((s, i) => {
      const hidden = i >= MAX_VISIBLE
        ? `data-overflow="${extraId}" style="display:none"`
        : '';
      return renderSignalCard(s, hidden);
    }).join('');

    const moreBtn = overflow > 0
      ? `<button class="btn-ghost" style="margin-top:6px;font-size:13px" data-show-more="${extraId}">
           + ${overflow} de plus</button>`
      : '';

    return `
      <div style="border-left:4px solid ${fam.color};padding-left:12px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:1rem">${fam.emoji}</span>
          <h3 style="margin:0;font-size:15px;font-weight:700">${fam.label}</h3>
          <span style="padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;
                background:${fam.color}18;color:${fam.color}">${items.length}</span>
        </div>
        ${cards}
        ${moreBtn}
      </div>`;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Centre d'actions</h1>
      <p class="page-subtitle">Tout ce qui mérite une décision, regroupé et priorisé</p>

      <section class="page-section">
        <div id="ac-kpis" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px">
          <div class="loading-state"><span class="loader"></span> Chargement…</div>
        </div>

        <div style="margin-bottom:20px;display:flex;gap:8px;align-items:center">
          <button id="ac-refresh" class="btn-primary">🔄 Rafraîchir les signaux</button>
          <span id="ac-refresh-status" style="font-size:13px;color:var(--text-secondary,#64748b)"></span>
        </div>

        <div id="ac-families">
          <div class="loading-state"><span class="loader"></span> Chargement des signaux…</div>
        </div>
      </section>`;

    await _loadData(rootEl);
    _bindRefresh(rootEl);
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  async function _loadData(rootEl) {
    try {
      const [stats, data] = await Promise.all([
        KmcApi.getSignalsStats(),
        KmcApi.getSignalsList({ limit: 100 }),
      ]);

      const signals    = data.signals || [];
      const totalOpen  = stats.total || 0;
      const countBySev = { urgent: 0, critical: 0, warning: 0, info: 0 };
      signals.forEach(s => { if (countBySev[s.severity] !== undefined) countBySev[s.severity]++; });

      // KPI bar
      const kpisEl = rootEl.querySelector('#ac-kpis');
      if (kpisEl) {
        kpisEl.innerHTML =
          kpiCard('🔴', countBySev.urgent + countBySev.critical, 'Urgent / Critique', '#fef2f2') +
          kpiCard('🟡', countBySev.warning, 'Avertissements', '#fffbeb') +
          kpiCard('🔵', countBySev.info, 'Informations', '#eff6ff') +
          kpiCard('📊', totalOpen, 'Total actifs', '#f8fafc');
      }

      // Group + sort by family
      const byFamily = {};
      FAMILIES.forEach(f => { byFamily[f.id] = []; });
      signals.forEach(s => {
        const fam = FAMILY_MAP[s.signal_type] || 'ops';
        if (byFamily[fam]) byFamily[fam].push(s);
      });
      Object.keys(byFamily).forEach(k => {
        byFamily[k].sort((a, b) => (SEV_ORDER[a.severity] || 9) - (SEV_ORDER[b.severity] || 9));
      });

      // Families HTML
      const famEl = rootEl.querySelector('#ac-families');
      if (!famEl) return;

      if (totalOpen === 0) {
        famEl.innerHTML = `
          <div style="text-align:center;padding:60px 20px">
            <div style="font-size:64px;margin-bottom:16px">✅</div>
            <h3>Tout est en ordre</h3>
            <p style="color:var(--text-secondary,#64748b);margin-top:8px">Aucun signal actif — bonne nouvelle !</p>
          </div>`;
        return;
      }

      famEl.innerHTML = FAMILIES.map(f => renderFamilySection(f, byFamily[f.id])).join('');

      // Delegate actions
      _bindSignalActions(rootEl, () => _loadData(rootEl));

    } catch (err) {
      const famEl = rootEl.querySelector('#ac-families');
      if (famEl) famEl.innerHTML = `<div class="error-state">❌ ${esc(err.message)}</div>`;
    }
  }

  // ── Event delegation ──────────────────────────────────────────────────────

  function _bindSignalActions(rootEl, reload) {
    // Remove previous listener by cloning the container (clean slate per load)
    const famEl = rootEl.querySelector('#ac-families');
    if (!famEl) return;
    const fresh = famEl.cloneNode(true);
    famEl.replaceWith(fresh);

    fresh.addEventListener('click', async e => {
      const ackBtn     = e.target.closest('[data-signal-ack]');
      const snoozeBtn  = e.target.closest('[data-signal-snooze]');
      const resolveBtn = e.target.closest('[data-signal-resolve]');
      const drillBtn   = e.target.closest('[data-signal-drill]');
      const moreBtn    = e.target.closest('[data-show-more]');

      if (ackBtn) {
        ackBtn.disabled = true;
        await KmcApi.acknowledgeSignal(ackBtn.dataset.signalAck).catch(() => {});
        reload();
      }
      if (snoozeBtn) {
        snoozeBtn.disabled = true;
        await KmcApi.snoozeSignal(snoozeBtn.dataset.signalSnooze, 24).catch(() => {});
        reload();
      }
      if (resolveBtn) {
        resolveBtn.disabled = true;
        await KmcApi.resolveSignal(resolveBtn.dataset.signalResolve).catch(() => {});
        reload();
      }
      if (drillBtn) {
        try {
          const params = JSON.parse(drillBtn.dataset.signalDrill);
          window.dispatchEvent(new CustomEvent('kmc:navigate', { detail: params }));
        } catch (_) {}
      }
      if (moreBtn) {
        const key = moreBtn.dataset.showMore;
        fresh.querySelectorAll(`[data-overflow="${key}"]`).forEach(el => {
          el.style.display = '';
        });
        moreBtn.remove();
      }
    });
  }

  function _bindRefresh(rootEl) {
    const btn    = rootEl.querySelector('#ac-refresh');
    const status = rootEl.querySelector('#ac-refresh-status');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      status.textContent = 'Génération en cours…';
      btn.disabled = true;
      try {
        await KmcApi.generateSignals();
        status.textContent = '✅ Signaux régénérés';
        await _loadData(rootEl);
      } catch (err) {
        status.textContent = `❌ ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.ActionCenterView = { render };

})(window);
