/**
 * KOMERCE Dashboard — Vue Santé Économique /admin/economic
 * ════════════════════════════════════════════════════════════════════════
 * Questions : Rentabilité du mois ? Seuil ? Santé catalogue ?
 *
 * Sources API :
 *   KmcApi.getEconomicExecutive()  → /api/admin/economic/executive
 *   KmcApi.getEconomicCharges()    → /api/admin/economic/charges
 *   KmcApi.getFinanceConfig()      → /api/admin/finance-config
 *   KmcApi.getEconomicCoherence()  → /api/admin/economic/coherence
 */

(function (global) {
  'use strict';

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Santé économique</h1>
      <p class="page-subtitle">Rentabilité par la contribution moyenne — mois en cours</p>

      <section class="page-section">
        <div id="eco-verdict" class="card" style="padding: 20px;">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section">
        <div id="eco-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span></div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">🩺 Santé du catalogue</h3></div>
          <div id="eco-health" style="padding: 8px;"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">⚠️ Alertes globales</h3></div>
          <div id="eco-alerts"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header"><h3 class="card-title">📋 Charges fixes du mois</h3></div>
          <div id="eco-charges"></div>
        </div>
      </section>

      <p id="eco-meta" style="margin-top:16px;font-size:var(--fs-xs);color:var(--text-tertiary);"></p>
    `;

    try {
      const [exec, charges, config, coherence] = await Promise.all([
        KmcApi.getEconomicExecutive().catch(() => null),
        KmcApi.getEconomicCharges().catch(() => null),
        KmcApi.getFinanceConfig().catch(() => null),
        KmcApi.getEconomicCoherence().catch(() => null),
      ]);

      _renderVerdict(document.getElementById('eco-verdict'), exec, config);
      _renderKpis(document.getElementById('eco-kpis'), exec);
      _renderHealth(document.getElementById('eco-health'), exec);
      _renderAlerts(document.getElementById('eco-alerts'), exec, coherence);
      _renderCharges(document.getElementById('eco-charges'), charges);

      const meta = document.getElementById('eco-meta');
      meta.textContent = `Données économiques — ${new Date().toLocaleTimeString('fr-FR')}`;

    } catch (err) {
      console.error('[EconomicView] error:', err);
      document.getElementById('eco-verdict').innerHTML =
        `<div class="error-state">❌ Erreur : ${err.message || 'inconnue'}</div>`;
    }
  }

  function _renderVerdict(el, exec, config) {
    if (!exec) {
      el.innerHTML = '<div class="empty-state">Données économiques indisponibles</div>';
      return;
    }
    const k = exec.kpis || exec;
    const ordered = Number(k.orders_this_month || k.commandes_collectees || 0);
    const seuil   = Number(k.breakeven_orders  || k.seuil_rentabilite   || 0);

    let klass, emoji, title, detail;
    if (!seuil || !ordered) {
      klass = ''; emoji = '❔';
      title = 'Rentabilité indéterminée';
      detail = 'Pas assez de données pour conclure.';
    } else if (ordered >= seuil * 1.1) {
      klass = 'is-green'; emoji = '✅';
      title = 'Mois rentable';
      detail = `${ordered} commandes collectées — seuil de ${seuil} dépassé.`;
    } else if (ordered >= seuil * 0.9) {
      klass = 'is-amber'; emoji = '⚖️';
      title = 'Proche du seuil';
      detail = `${ordered} / ${seuil} commandes nécessaires. Marge de manœuvre faible.`;
    } else {
      klass = 'is-red'; emoji = '⚠️';
      title = 'Mois non rentable';
      detail = `Il manque ${seuil - ordered} commande(s) pour couvrir les charges fixes (${ordered} / ${seuil}).`;
    }

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="font-size:2.4rem;">${emoji}</div>
        <div>
          <div style="font-size:1.1rem;font-weight:800;">${title}</div>
          <div style="font-size:0.92rem;color:var(--text-secondary);margin-top:2px;">${detail}</div>
        </div>
      </div>
    `;
  }

  function _renderKpis(el, exec) {
    if (!exec) { el.innerHTML = ''; return; }
    const k = exec.kpis || exec;
    const fmt  = (n) => Number(n || 0).toLocaleString('fr-FR') + ' KMF';
    const fmti = (n) => Number(n || 0).toLocaleString('fr-FR');
    const fmtp = (n) => Number(n || 0).toFixed(1) + '%';

    const kpis = [
      { key: 'ca_mensuel',          label: 'CA mensuel',           value: fmt(k.ca_mensuel_kmf || k.revenue_kmf) },
      { key: 'commandes',           label: 'Commandes collectées', value: fmti(k.orders_this_month || k.commandes_collectees) },
      { key: 'panier_moyen',        label: 'Panier moyen',         value: fmt(k.avg_order_kmf || k.panier_moyen_kmf) },
      { key: 'cout_variable',       label: 'Coût variable moyen',  value: fmt(k.avg_variable_cost_kmf || k.cout_variable_moyen_kmf) },
      { key: 'contribution',        label: 'Contribution moyenne', value: fmt(k.avg_contribution_kmf || k.contribution_moyenne_kmf) },
      { key: 'charges_fixes',       label: 'Charges fixes/mois',   value: fmt(k.fixed_charges_kmf || k.charges_fixes_mensuelles_kmf) },
      { key: 'seuil',               label: 'Seuil de rentabilité', value: fmti(k.breakeven_orders || k.seuil_rentabilite) + ' cmds' },
      { key: 'marge_reelle',        label: 'Marge réelle moyenne', value: fmtp(k.avg_margin_pct || k.marge_reelle_moyenne_pct) },
    ];
    KpiCard.renderBar(el, kpis);
  }

  function _renderHealth(el, exec) {
    const health = exec?.doctrine?.by_health || exec?.health_distribution;
    if (!health) {
      el.innerHTML = '<div class="empty-state" style="padding:14px;">Données santé catalogue indisponibles</div>';
      return;
    }
    const total = exec?.doctrine?.sample_size || exec?.health_total || 0;
    const cells = [
      { key: 'loss',    label: 'À perte',  bg: '#fee2e2', color: '#b91c1c' },
      { key: 'danger',  label: 'Danger',   bg: '#ffedd5', color: '#c2410c' },
      { key: 'fragile', label: 'Fragile',  bg: '#fef9c3', color: '#a16207' },
      { key: 'healthy', label: 'Sain',     bg: '#dcfce7', color: '#166534' },
      { key: 'strong',  label: 'Fort',     bg: '#d1fae5', color: '#065f46' },
      { key: 'unknown', label: 'Inconnu',  bg: '#f1f5f9', color: '#64748b' },
    ];
    const grid = cells.map(c => `
      <div style="padding:10px 8px;text-align:center;border-radius:6px;background:${c.bg};color:${c.color};">
        <div style="font-size:1.2rem;font-weight:800;font-family:ui-monospace,monospace;">${health[c.key] ?? '—'}</div>
        <div style="font-size:0.7rem;text-transform:uppercase;font-weight:600;margin-top:4px;">${c.label}</div>
      </div>
    `).join('');
    el.innerHTML = `
      <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px;">${total} produits analysés</p>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;">${grid}</div>
      <p style="font-size:0.78rem;color:var(--text-tertiary);text-align:center;margin-top:8px;">
        Pour le détail produit : voir le module <strong>Pricing</strong>.
      </p>
    `;
  }

  function _renderAlerts(el, exec, coherence) {
    const alerts = exec?.alerts || coherence?.alerts || [];
    AlertList.renderList(el, alerts, {
      limit: 10,
      emptyText: '✓ Aucune anomalie détectée',
    });
  }

  function _renderCharges(el, charges) {
    if (!charges) {
      el.innerHTML = '<div class="empty-state" style="padding:14px;">Données charges indisponibles</div>';
      return;
    }
    const rows = charges.items || charges.charges || charges || [];
    DataTable.render(el, {
      emptyText: 'Aucune charge enregistrée',
      columns: [
        { key: 'family',      label: 'Famille',   render: (r) => r.family || r.category || '—' },
        { key: 'label',       label: 'Libellé',   render: (r) => r.label || r.name || '—' },
        { key: 'amount_kmf',  label: 'Montant',   align: 'right',
          render: (r) => Number(r.amount_kmf || r.amount || 0).toLocaleString('fr-FR') + ' KMF' },
        { key: 'period',      label: 'Période',   render: (r) => r.period || r.month || '—' },
      ],
      rows: Array.isArray(rows) ? rows : [],
    });
  }

  global.EconomicView = { render };
})(window);
