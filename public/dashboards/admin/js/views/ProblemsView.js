/**
 * KOMERCE Dashboard — Vue Anomalies /admin/problems
 * ════════════════════════════════════════════════════════════════════════
 * Migration de ct-views-problems.js vers l'architecture moderne.
 *
 * Fonctionnement :
 *   Charge /api/orders (limit 500) et applique 10 règles de détection
 *   d'anomalies côté client — identiques aux règles legacy.
 *
 * Sections :
 *   - Header : titre + horodatage scan + toggle auto-refresh 5 min
 *   - Summary bar : total · critique · attention · info
 *   - Cards par anomalie (accordéon expand/collapse)
 *   - Sidebar : score santé 0–100 + compteurs par catégorie
 *
 * Règles d'architecture :
 *   ✓ Appels API via KmcApi.getOrders() — zéro fetch() brut
 *   ✓ Un seul fichier, zéro doublon -v6/-v7/-legacy
 *   ✓ Détections en JS pur (mêmes 10 règles que legacy, mises à plat)
 *
 * Dépendances :
 *   - api-client.js → KmcApi  (endpoint getOrders à ajouter — voir NOTE)
 *
 * NOTE api-client.js : ajouter dans KmcApi :
 *   getOrders(params)  → GET /api/orders?limit=500&...
 *
 * Chantier : KOMERCE_CHANTIER_DASHBOARDS_ADMIN.md · Vague 1
 */

(function (global) {
  'use strict';

  // ── Styles ────────────────────────────────────────────────────────────────
  const STYLE_ID = 'kmc-problems-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      /* ── Layout ── */
      .prob-body {
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: 20px;
        align-items: start;
      }
      @media (max-width: 860px) { .prob-body { grid-template-columns: 1fr; } }

      /* ── Summary bar ── */
      .prob-summary {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 0;
        flex-wrap: wrap;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--border-subtle, #e2e8f0);
      }
      .prob-sev-badge {
        padding: 3px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
      }
      .prob-sev-critical { background: #fef2f2; color: #991b1b; }
      .prob-sev-warning  { background: #fffbeb; color: #92400e; }
      .prob-sev-info     { background: #eff6ff; color: #1e40af; }

      /* ── Problem cards ── */
      .prob-card {
        background: var(--surface-primary, white);
        border: 1px solid var(--border-default, #e2e8f0);
        border-left: 4px solid var(--border-default, #e2e8f0);
        border-radius: 8px;
        margin-bottom: 10px;
        overflow: hidden;
      }
      .prob-card[data-severity="critical"] { border-left-color: #ef4444; }
      .prob-card[data-severity="warning"]  { border-left-color: #f59e0b; }
      .prob-card[data-severity="info"]     { border-left-color: #3b82f6; }
      .prob-card[data-count="0"]           { opacity: 0.4; }
      .prob-card[data-count="0"] .prob-card-head { cursor: default; }

      .prob-card-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        cursor: pointer;
        user-select: none;
      }
      .prob-card-title {
        font-weight: 700;
        font-size: var(--fs-sm, 13px);
        color: var(--text-primary, #0f172a);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .prob-card-count { font-weight: 400; color: var(--text-tertiary, #94a3b8); }
      .prob-card-sev-tag {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .prob-tag-critical { background: #fef2f2; color: #991b1b; }
      .prob-tag-warning  { background: #fffbeb; color: #92400e; }
      .prob-tag-info     { background: #eff6ff; color: #1e40af; }

      .prob-card-hint {
        font-size: 11px;
        color: var(--text-tertiary, #94a3b8);
        padding: 0 14px 4px;
      }

      /* Items list (collapsed by default) */
      .prob-items { display: none; padding: 0 14px 12px; }
      .prob-card.expanded .prob-items { display: block; }

      .prob-item {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 5px 0;
        border-bottom: 1px solid var(--border-subtle, #f1f5f9);
        font-size: 12px;
        color: var(--text-secondary, #334155);
      }
      .prob-item:last-child { border-bottom: none; }
      .prob-item-ref  { font-weight: 700; white-space: nowrap; }
      .prob-item-name { color: var(--text-tertiary, #94a3b8); }
      .prob-item-meta { margin-left: auto; font-size: 11px; color: var(--text-tertiary, #94a3b8); }
      .prob-item-more { font-size: 11px; color: var(--text-tertiary, #94a3b8); font-style: italic; padding: 4px 0; }

      .prob-card-desc   { font-size: 12px; color: var(--text-secondary, #475569); line-height: 1.5; padding-bottom: 6px; }
      .prob-card-action {
        display: inline-block;
        font-size: 12px;
        color: var(--color-blue-600, #2563eb);
        font-weight: 600;
        cursor: pointer;
        margin-top: 4px;
      }
      .prob-card-action:hover { text-decoration: underline; }

      /* ── Sidebar ── */
      .prob-score-wrap {
        background: var(--surface-primary, white);
        border: 1px solid var(--border-default, #e2e8f0);
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        margin-bottom: 12px;
      }
      .prob-score-val {
        font-size: 3rem;
        font-weight: 800;
        line-height: 1;
      }
      .prob-score-green  { color: var(--color-green-500, #22c55e); }
      .prob-score-yellow { color: var(--color-amber-400, #fbbf24); }
      .prob-score-red    { color: var(--color-red-400, #f87171); }
      .prob-score-lbl    { font-size: 12px; color: var(--text-tertiary, #94a3b8); margin-top: 6px; }

      .prob-cat-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }
      .prob-cat {
        background: var(--surface-primary, white);
        border: 1px solid var(--border-default, #e2e8f0);
        border-left: 3px solid transparent;
        border-radius: 8px;
        padding: 10px;
        text-align: center;
      }
      .prob-cat[data-cat="finance"]  { border-left-color: #38bdf8; }
      .prob-cat[data-cat="appro"]    { border-left-color: #fbbf24; }
      .prob-cat[data-cat="logistic"] { border-left-color: #a78bfa; }
      .prob-cat[data-cat="client"]   { border-left-color: #4ade80; }
      .prob-cat[data-cat="data"]     { border-left-color: #f87171; }
      .prob-cat-num {
        font-size: 1.4rem;
        font-weight: 800;
        line-height: 1;
      }
      .prob-cat[data-cat="finance"]  .prob-cat-num { color: #38bdf8; }
      .prob-cat[data-cat="appro"]    .prob-cat-num { color: #fbbf24; }
      .prob-cat[data-cat="logistic"] .prob-cat-num { color: #a78bfa; }
      .prob-cat[data-cat="client"]   .prob-cat-num { color: #4ade80; }
      .prob-cat[data-cat="data"]     .prob-cat-num { color: #f87171; }
      .prob-cat-lbl {
        font-size: 11px;
        color: var(--text-tertiary, #94a3b8);
        margin-top: 3px;
      }

      .prob-rules-info {
        background: var(--surface-secondary, #f8fafc);
        border-radius: 8px;
        padding: 12px;
        font-size: 12px;
        color: var(--text-tertiary, #94a3b8);
        line-height: 1.8;
      }

      /* ── Controls ── */
      .prob-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 16px;
      }
      .prob-auto-lbl {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--text-secondary, #475569);
        cursor: pointer;
        user-select: none;
      }
      .prob-scan-time { font-size: 11px; color: var(--text-tertiary, #94a3b8); }
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Anomaly Rules ─────────────────────────────────────────────────────────

  const SEV_ORDER  = { critical: 0, warning: 1, info: 2 };
  const SEV_LABELS = { critical: 'CRITIQUE', warning: 'ATTENTION', info: 'INFO' };
  const SEV_EMOJI  = { critical: '🔴', warning: '🟠', info: '🟡' };

  function daysSince(dateStr) {
    if (!dateStr) return 0;
    return (Date.now() - new Date(dateStr).getTime()) / 86400000;
  }

  const RULES = [
    {
      id: 'no_po', severity: 'critical', cat: 'finance', icon: '💳',
      title: 'Commandes sans PO',
      desc: 'Commandes confirmées sans bon d\'achat associé — l\'argent est encaissé mais la chaîne achat n\'a pas démarré.',
      detect: orders => orders.filter(o => o.status === 'confirmed' && !o.purchase_order && !o.purchase_order_id),
      actionLabel: 'Voir les commandes →',
      actionUrl: '/admin/orders?status=confirmed&no_po=1',
    },
    {
      id: 'double_payment', severity: 'critical', cat: 'finance', icon: '💳',
      title: 'Doubles paiements',
      desc: 'Plusieurs paiements détectés pour la même commande — double clic probable ou bug de paiement.',
      detect: orders => orders.filter(o => o.payment_status === 'paid' && Array.isArray(o.payments) && o.payments.length > 1),
      actionLabel: 'Vérifier les paiements →',
      actionUrl: '/admin/payments?filter=double',
    },
    {
      id: 'cash_unsettled', severity: 'critical', cat: 'finance', icon: '💰',
      title: 'Cash non réconcilié',
      desc: 'Paiement en cash collecté mais non soldé dans le système — argent en attente de réconciliation.',
      detect: orders => orders.filter(o => o.payment_method === 'cash' && o.payment_status !== 'settled' && o.payment_status !== 'paid'),
      actionLabel: 'Solder les paiements →',
      actionUrl: '/admin/payments?filter=unsettled',
    },
    {
      id: 'po_overflow', severity: 'warning', cat: 'appro', icon: '📦',
      title: 'Débordement PO',
      desc: 'Quantité reçue supérieure à la quantité commandée — incohérence de données à vérifier.',
      detect: orders => orders.filter(o => o.purchase_order && o.purchase_order.received_qty > o.purchase_order.quantity),
      actionLabel: 'Corriger les BCs →',
      actionUrl: '/admin/purchase_orders?filter=overflow',
    },
    {
      id: 'po_received_stuck', severity: 'warning', cat: 'appro', icon: '📦',
      title: 'PO reçues mais commande en attente',
      desc: 'Colis arrivé au hub mais la commande est encore en statut purchasing — bug de transition probable.',
      detect: orders => orders.filter(o =>
        o.status === 'purchasing' && o.purchase_order &&
        (o.purchase_order.status === 'received' || o.purchase_order.status === 'hub_received')
      ),
      actionLabel: 'Débloquer les commandes →',
      actionUrl: '/admin/orders?filter=po_stuck',
    },
    {
      id: 'available_long', severity: 'warning', cat: 'client', icon: '👤',
      title: 'Relais > 7 jours sans retrait',
      desc: 'Colis disponible en relais depuis plus de 7 jours — client possiblement injoignable.',
      detect: orders => orders.filter(o => {
        if (o.status !== 'available') return false;
        const d = daysSince(o.updated_at || o.created_at);
        if (d > 7) { o._days = Math.floor(d); return true; }
        return false;
      }),
      actionLabel: 'Notifier les relais →',
      actionUrl: '/admin/orders?status=available&days_gt=7',
    },
    {
      id: 'prep_stuck', severity: 'info', cat: 'logistic', icon: '🚚',
      title: 'Préparation > 4 jours',
      desc: 'Commande en préparation depuis plus de 4 jours — action humaine manquante côté hub.',
      detect: orders => orders.filter(o => {
        if (o.status !== 'preparation') return false;
        const d = daysSince(o.updated_at || o.created_at);
        if (d > 4) { o._days = Math.floor(d); return true; }
        return false;
      }),
      actionLabel: 'Voir les commandes bloquées →',
      actionUrl: '/admin/orders?status=preparation&days_gt=4',
    },
    {
      id: 'transit_long', severity: 'info', cat: 'logistic', icon: '🚚',
      title: 'Transit > 12 jours',
      desc: 'Colis en transit depuis plus de 12 jours — probablement perdu ou bloqué en douane.',
      detect: orders => orders.filter(o => {
        if (o.status !== 'shipped') return false;
        const d = daysSince(o.updated_at || o.created_at);
        if (d > 12) { o._days = Math.floor(d); return true; }
        return false;
      }),
      actionLabel: 'Contacter transporteur →',
      actionUrl: '/admin/orders?status=shipped&days_gt=12',
    },
    {
      id: 'no_sms', severity: 'info', cat: 'client', icon: '📱',
      title: 'SMS non envoyés',
      desc: 'Commande en statut available mais le client n\'a pas reçu de notification SMS avec son code.',
      detect: orders => orders.filter(o => o.status === 'available' && o.sms_sent === false),
      actionLabel: 'Renvoyer les SMS →',
      actionUrl: '/admin/orders?status=available&sms_sent=false',
    },
    {
      id: 'no_hub_scan', severity: 'info', cat: 'data', icon: '⚙️',
      title: 'PO sans scan Hub',
      desc: 'Commandes actives sans scan hub enregistré — les colis ne peuvent pas progresser.',
      detect: orders => orders.filter(o =>
        (o.status === 'purchasing' || o.status === 'preparation') && !o.hub_id && !o.hub_scan
      ),
      actionLabel: 'Assigner les hubs →',
      actionUrl: '/admin/orders?filter=no_hub',
    },
  ];

  function runDetections(orders) {
    const results = RULES.map(rule => {
      let items = [];
      try { items = rule.detect(orders); } catch (_) {}
      return { rule, items };
    });
    results.sort((a, b) => {
      const sa = SEV_ORDER[a.rule.severity] ?? 9;
      const sb = SEV_ORDER[b.rule.severity] ?? 9;
      return sa !== sb ? sa - sb : b.items.length - a.items.length;
    });
    return results;
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  function fmtKMF(val) {
    const n = Number(val);
    if (!n) return '';
    return n.toLocaleString('fr-FR') + ' KMF';
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderSummary(results) {
    const totals = { total: 0, critical: 0, warning: 0, info: 0 };
    results.forEach(r => {
      totals.total += r.items.length;
      totals[r.rule.severity] = (totals[r.rule.severity] || 0) + r.items.length;
    });

    if (totals.total === 0) {
      return `<div class="prob-summary"><span style="color:var(--color-green-600,#16a34a);font-weight:700">✅ Aucun problème détecté — tout est en ordre</span></div>`;
    }

    return `<div class="prob-summary">
      <strong>⚠️ ${totals.total} problème${totals.total > 1 ? 's' : ''} détecté${totals.total > 1 ? 's' : ''}</strong>
      ${totals.critical ? `<span class="prob-sev-badge prob-sev-critical">🔴 Critique : ${totals.critical}</span>` : ''}
      ${totals.warning  ? `<span class="prob-sev-badge prob-sev-warning">🟠 Attention : ${totals.warning}</span>` : ''}
      ${totals.info     ? `<span class="prob-sev-badge prob-sev-info">🟡 Info : ${totals.info}</span>` : ''}
    </div>`;
  }

  function renderCards(results) {
    if (results.every(r => r.items.length === 0)) {
      return `<div class="empty-state" style="color:var(--color-green-600,#16a34a)">
        ✅ Aucun problème détecté<br>
        <span style="font-size:var(--fs-sm,13px);color:var(--text-tertiary,#94a3b8)">Toutes les commandes sont en ordre</span>
      </div>`;
    }

    return results.map(({ rule, items }) => {
      const count     = items.length;
      const sevLabel  = SEV_LABELS[rule.severity] || 'INFO';
      const tagClass  = `prob-tag-${rule.severity}`;

      let itemsHtml = '';
      items.slice(0, 8).forEach(o => {
        const ref    = o.order_ref || o.reference || o.ref || o.id || '—';
        const name   = o.client_name || o.customer_name || o.name || '';
        const amount = fmtKMF(o.total || o.amount);
        const days   = o._days ? `(${o._days}j)` : '';
        itemsHtml += `<div class="prob-item">
          <span>▸</span>
          <span class="prob-item-ref">${ref}</span>
          ${name ? `<span class="prob-item-name">— ${name}</span>` : ''}
          <span class="prob-item-meta">${[amount, days].filter(Boolean).join(' ')}</span>
        </div>`;
      });
      if (items.length > 8) {
        itemsHtml += `<div class="prob-item-more">…et ${items.length - 8} autre${items.length - 8 > 1 ? 's' : ''}</div>`;
      }

      return `<div class="prob-card" data-severity="${rule.severity}" data-count="${count}" data-rule="${rule.id}">
        <div class="prob-card-head" data-action="toggle">
          <div class="prob-card-title">
            ${SEV_EMOJI[rule.severity]} ${rule.title}
            <span class="prob-card-count">(${count})</span>
          </div>
          <span class="prob-card-sev-tag ${tagClass}">${sevLabel}</span>
        </div>
        ${count > 0 ? `<div class="prob-card-hint" data-action="toggle">▸ Cliquez pour voir les détails</div>` : ''}
        <div class="prob-items">
          <p class="prob-card-desc">${rule.desc}</p>
          ${itemsHtml}
          ${count > 0 ? `<span class="prob-card-action" data-url="${rule.actionUrl}">${rule.actionLabel}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function renderSidebar(results) {
    const totals = { total: 0, finance: 0, appro: 0, logistic: 0, client: 0, data: 0 };
    results.forEach(r => {
      totals.total += r.items.length;
      if (totals[r.rule.cat] !== undefined) totals[r.rule.cat] += r.items.length;
    });

    const score    = Math.max(0, 100 - totals.total * 8);
    const scoreCls = score >= 80 ? 'prob-score-green' : score >= 50 ? 'prob-score-yellow' : 'prob-score-red';
    const scoreLbl = score >= 80 ? '✅ Système sain' : score >= 50 ? '⚠️ Attention requise' : '🚨 Action urgente';

    return `
      <div class="prob-score-wrap">
        <div style="font-size:11px;font-weight:700;color:var(--text-tertiary,#94a3b8);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">🏥 Score Santé</div>
        <div class="prob-score-val ${scoreCls}">${score}/100</div>
        <div class="prob-score-lbl">${scoreLbl}</div>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--text-tertiary,#94a3b8);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Par catégorie</div>
      <div class="prob-cat-grid">
        ${['finance','appro','logistic','client','data'].map(cat => {
          const labels = { finance: '💳 Finance', appro: '📦 Appro', logistic: '🚚 Logistique', client: '👤 Client', data: '⚙️ Données' };
          return `<div class="prob-cat" data-cat="${cat}">
            <div class="prob-cat-num">${totals[cat]}</div>
            <div class="prob-cat-lbl">${labels[cat]}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="prob-rules-info">
        <strong style="color:var(--text-secondary,#334155)">Détections actives :</strong><br>
        ✅ Commandes sans PO<br>
        ✅ Doubles paiements<br>
        ✅ Cash non réconcilié<br>
        ✅ Débordement quantité PO<br>
        ✅ PO reçue / commande bloquée<br>
        ✅ Préparation &gt; 4 jours<br>
        ✅ Transit &gt; 12 jours<br>
        ✅ Relais &gt; 7 jours sans retrait<br>
        ✅ SMS non envoyés<br>
        ✅ PO sans scan Hub
      </div>`;
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  let _autoTimer   = null;
  let _isLoading   = false;

  async function loadData(rootEl) {
    if (_isLoading) return;
    _isLoading = true;

    const refreshBtn = rootEl.querySelector('#prob-refresh-btn');
    const scanTimeEl = rootEl.querySelector('#prob-scan-time');
    if (refreshBtn) refreshBtn.disabled = true;

    try {
      const rawData = await KmcApi.getOrders({ limit: 500 });
      const orders  = Array.isArray(rawData) ? rawData : (rawData.items || rawData.orders || rawData.data || []);

      const results = runDetections(orders);

      rootEl.querySelector('#prob-summary').innerHTML  = renderSummary(results);
      rootEl.querySelector('#prob-cards').innerHTML    = renderCards(results);
      rootEl.querySelector('#prob-sidebar').innerHTML  = renderSidebar(results);

      if (scanTimeEl) {
        const t = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        scanTimeEl.textContent = `Dernier scan : ${t}`;
      }

    } catch (err) {
      console.error('[ProblemsView] API error:', err.message);
      const cardsEl = rootEl.querySelector('#prob-cards');
      if (cardsEl) cardsEl.innerHTML = `<div class="error-state">Erreur chargement : ${err.message || 'API indisponible'}</div>`;
    } finally {
      _isLoading = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  // ── Auto-refresh ──────────────────────────────────────────────────────────

  function startAutoRefresh(rootEl) {
    stopAutoRefresh();
    _autoTimer = setInterval(() => loadData(rootEl), 300_000); // 5 min
  }

  function stopAutoRefresh() {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
  }

  // ── Main render ───────────────────────────────────────────────────────────

  async function render(rootEl) {
    injectStyles();
    stopAutoRefresh();

    rootEl.innerHTML = `
      <h1 class="page-title">Détection d'Anomalies</h1>
      <p class="page-subtitle">Scan automatique sur 500 dernières commandes — 10 règles actives</p>

      <div class="prob-controls">
        <div style="display:flex;align-items:center;gap:10px">
          <button id="prob-refresh-btn" class="btn btn-secondary btn-sm">🔄 Actualiser</button>
          <span id="prob-scan-time" class="prob-scan-time"></span>
        </div>
        <label class="prob-auto-lbl">
          <input type="checkbox" id="prob-auto-check" checked>
          Auto-refresh (5 min)
        </label>
      </div>

      <div id="prob-summary"></div>

      <div class="prob-body">
        <div>
          <div id="prob-cards">
            <div class="loading-state" style="padding:32px 0;text-align:center">
              <span class="loader"></span> Analyse des commandes…
            </div>
          </div>
        </div>
        <div id="prob-sidebar">
          <div class="loading-state"><span class="loader"></span></div>
        </div>
      </div>
    `;

    // Refresh button
    rootEl.querySelector('#prob-refresh-btn').addEventListener('click', () => loadData(rootEl));

    // Auto-refresh toggle
    rootEl.querySelector('#prob-auto-check').addEventListener('change', e => {
      if (e.target.checked) startAutoRefresh(rootEl);
      else stopAutoRefresh();
    });

    // Card expand / navigate (delegation)
    rootEl.querySelector('#prob-cards').addEventListener('click', e => {
      const toggleEl = e.target.closest('[data-action="toggle"]');
      if (toggleEl) {
        const card = toggleEl.closest('.prob-card');
        if (card && card.getAttribute('data-count') !== '0') {
          card.classList.toggle('expanded');
          const hint = card.querySelector('.prob-card-hint');
          if (hint) hint.textContent = card.classList.contains('expanded')
            ? '▾ Cliquez pour masquer'
            : '▸ Cliquez pour voir les détails';
        }
        return;
      }
      const navEl = e.target.closest('.prob-card-action[data-url]');
      if (navEl) window.open(navEl.dataset.url, '_blank');
    });

    await loadData(rootEl);
    startAutoRefresh(rootEl);
  }

  // Cleanup hook (appelé par app.js lors du démontage de la vue)
  function destroy() { stopAutoRefresh(); }

  // ── Export ────────────────────────────────────────────────────────────────
  global.ProblemsView = { render, destroy };

})(window);
