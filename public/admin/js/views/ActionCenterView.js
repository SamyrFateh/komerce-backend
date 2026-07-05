/**
 * @komerce-arch
 * @role          admin-action-center-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        signals list, stats
 * @outputs       action_center_page_dom (alertes, incidents, acknowledge / snooze / resolve)
 * @depends       api-client.js, filters-store.js, utils.js, components/UI.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  alerts, signals, incidents, admin-dashboard
 * @version       2026-06
 */

'use strict';
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
    return `<div class="ac-kpi-card" style="background:${bg}">
      <span class="ac-kpi-icon">${emoji}</span>
      <div><div class="ac-kpi-value">${value}</div>
           <div class="ac-kpi-label">${label}</div></div>
    </div>`;
  }

  // ── Render signal card ────────────────────────────────────────────────────

  function renderSignalCard(signal, extraId) {
    const sevColor = SEV_COLORS[signal.severity] || '#94a3b8';
    const sevLabel = SEV_LABELS[signal.severity] || signal.severity;

    let drillBtn = '';
    if (signal.target_view) {
      const drillParams = {
        view: signal.target_view,
        filters: signal.target_filters || {},
        highlightId: signal.entity_id,
      };
      drillBtn = `<button class="btn btn-ghost btn-sm" data-signal-drill='${JSON.stringify(drillParams).replace(/'/g, '&#39;')}'>🔗 Voir</button>`;
    }

    const overflowAttr = extraId ? `data-overflow="${extraId}"` : '';
    const displayStyle = extraId ? ';display:none' : '';

    return `
      <div class="signal-card" style="border-left:3px solid ${sevColor}${displayStyle}" ${overflowAttr}>
        <div class="ac-signal-head">
          <span class="ac-sev-badge" style="background:${sevColor}18;color:${sevColor}">${sevLabel}</span>
          <strong style="font-size:14px">${esc(signal.title)}</strong>
        </div>
        ${signal.summary ? `<div class="ac-signal-summary">${esc(signal.summary)}</div>` : ''}
        ${signal.recommendation ? `<div class="ac-signal-reco">💡 ${esc(signal.recommendation)}</div>` : ''}
        <div class="ac-signal-actions">
          ${drillBtn}
          <button class="btn btn-ghost btn-sm" data-signal-ack="${signal.id}">👁 Vu</button>
          <button class="btn btn-ghost btn-sm" data-signal-snooze="${signal.id}">💤 24h</button>
          <button class="btn btn-primary btn-sm" data-signal-resolve="${signal.id}">✅ Résolu</button>
        </div>
        <div class="ac-signal-footer">
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
      return renderSignalCard(s, i >= MAX_VISIBLE ? extraId : '');
    }).join('');

    const moreBtn = overflow > 0
      ? `<button class="btn btn-ghost btn-sm ac-show-more" data-show-more="${extraId}">+ ${overflow} de plus</button>`
      : '';

    return `
      <div class="ac-fam-block" style="border-left-color:${fam.color}">
        <div class="ac-fam-head">
          <span class="ac-fam-emoji">${fam.emoji}</span>
          <h3 class="ac-fam-title">${fam.label}</h3>
          <span class="ac-fam-count" style="background:${fam.color}18;color:${fam.color}">${items.length}</span>
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
        <div id="ac-kpis" class="ac-kpis-bar">
          <div class="loading-state"><span class="loader"></span> Chargement…</div>
        </div>

        <div class="ac-refresh-bar">
          <button id="ac-refresh" class="btn btn-secondary">🔄 Rafraîchir les signaux</button>
          <span id="ac-refresh-status" class="ac-refresh-status"></span>
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
        byFamily[k].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
      });

      // Families HTML
      const famEl = rootEl.querySelector('#ac-families');
      if (!famEl) return;

      if (totalOpen === 0) {
        famEl.innerHTML = `
          <div class="ac-empty-state">
            <div class="ac-empty-icon">✅</div>
            <h3>Tout est en ordre</h3>
            <p class="ac-empty-sub">Aucun signal actif — bonne nouvelle !</p>
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
