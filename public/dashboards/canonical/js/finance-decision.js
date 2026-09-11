/**
 * @komerce-arch
 * @role          canonical-finance-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_finance_payload, decision_primitives
 * @outputs       decision_first_finance_dom
 * @depends       finance, primitives, decision-primitives
 * @used-by       canonical admin Finance runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, finance, economic-engine
 * @version       2026-09
 */
'use strict';

(function initFinanceDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalFinance && root.KomerceDecisionUI) {
    root.KomerceCanonicalFinance = api.enhance(root.KomerceCanonicalFinance, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createFinanceDecision() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function kpi(payload, key) {
    return (Array.isArray(payload && payload.kpis) ? payload.kpis : [])
      .find(item => item && item.key === key) || null;
  }

  function displayMetric(base, item) {
    if (!item || item.value == null) return '—';
    if (item.unit === 'KMF') return base.formatKmf(item.value);
    if (item.unit === '%') return `${base.formatNumber(item.value)} %`;
    return base.formatNumber(item.value, 0);
  }

  function decisionItems(payload, base) {
    const items = [];
    const pendingPayments = kpi(payload, 'paiements_en_attente');
    const incompleteCosts = kpi(payload, 'cmds_cout_incomplet');
    const refunds = kpi(payload, 'remboursements');
    const variances = (Array.isArray(payload && payload.costing_orders) ? payload.costing_orders : [])
      .filter(row => row && Number.isFinite(Number(row.variance_kmf)) && Number(row.variance_kmf) !== 0);

    if (pendingPayments && Number(pendingPayments.value) > 0) {
      items.push({
        key: 'payments-pending',
        label: 'Paiements en attente',
        helper: 'Éléments d’encaissement non finalisés',
        value: displayMetric(base, pendingPayments),
        tone: 'warning',
        icon: '¤',
        href: '#finance-kpis',
        actionLabel: 'Voir les KPI →',
      });
    }
    if (incompleteCosts && Number(incompleteCosts.value) > 0) {
      items.push({
        key: 'incomplete-costs',
        label: 'Coûts incomplets',
        helper: 'Commandes dont le coût n’est pas encore complet',
        value: displayMetric(base, incompleteCosts),
        tone: 'warning',
        icon: '!',
        href: '#finance-costing',
        actionLabel: 'Voir le costing →',
      });
    }
    if (variances.length > 0) {
      items.push({
        key: 'observed-variances',
        label: 'Variances observées',
        helper: 'Écarts non nuls, sans seuil « élevé » inventé côté navigateur',
        value: base.formatNumber(variances.length, 0),
        tone: 'warning',
        icon: '↔',
        href: '#finance-variances',
        actionLabel: 'Voir les écarts →',
      });
    }
    if (refunds && Number(refunds.value) > 0) {
      const refundCount = payload && payload.refunds && Number.isFinite(Number(payload.refunds.count))
        ? Number(payload.refunds.count) : null;
      items.push({
        key: 'refunds-period',
        label: 'Remboursements période',
        helper: refundCount == null ? 'Montant remboursé sur la période' : `${base.formatNumber(refundCount, 0)} remboursement(s) finalisé(s)`,
        value: displayMetric(base, refunds),
        tone: 'warning',
        icon: '↩',
        href: '#finance-refunds',
        actionLabel: 'Voir les remboursements →',
      });
    }
    return items.slice(0, 4);
  }

  function metricItems(payload, base) {
    const labels = {
      'ca-encaisse': 'CA encaissé',
      'cout-reel': 'Coût réel',
      marge: 'Marge consolidée',
      completude: 'Complétude coûts',
      'cout-incomplet': 'Coûts incomplets',
      'paiement-attente': 'Paiements en attente',
      remboursements: 'Remboursements',
    };
    return Object.entries(base.projectMetrics(payload)).map(([key, item]) => ({
      key,
      label: labels[key] || key,
      ...item,
    }));
  }

  function pair(payload, base, key, label) {
    const item = kpi(payload, key);
    return item ? { label, value: displayMetric(base, item) } : null;
  }

  function overviewCards(payload, base) {
    const definitions = [
      {
        key: 'revenue', title: 'Encaissements', tone: 'info',
        metrics: [pair(payload, base, 'ca_encaisse', 'CA encaissé'), pair(payload, base, 'paiements_en_attente', 'Paiements en attente')],
      },
      {
        key: 'costing', title: 'Vérité des coûts', tone: 'warning',
        metrics: [pair(payload, base, 'cout_reel', 'Coût réel'), pair(payload, base, 'taux_completude_couts', 'Complétude'), pair(payload, base, 'cmds_cout_incomplet', 'Coûts incomplets')],
      },
      {
        key: 'margin', title: 'Marge', tone: 'positive',
        metrics: [pair(payload, base, 'marge_consolidee', 'Marge consolidée')],
      },
      {
        key: 'refunds', title: 'Remboursements', tone: 'violet',
        metrics: [pair(payload, base, 'remboursements', 'Montant période')],
      },
    ];
    return definitions
      .map(card => ({ ...card, metrics: card.metrics.filter(Boolean) }))
      .filter(card => card.metrics.length > 0);
  }

  function completenessProgress(payload, base) {
    const item = kpi(payload, 'taux_completude_couts');
    if (!item || item.value == null) return [];
    return [{
      label: 'Complétude des coûts',
      value: displayMetric(base, item),
      percent: Number(item.value),
      tone: Number(item.value) < 100 ? 'warning' : 'positive',
      helper: item.data_quality && item.data_quality.warning ? String(item.data_quality.warning) : undefined,
    }];
  }

  function trendItems(payload, base) {
    return (Array.isArray(payload && payload.trend) ? payload.trend : []).map(row => ({
      title: base.formatDate(row.bucket),
      helper: `CA ${base.formatKmf(row.revenue_kmf)} · coût ${base.formatKmf(row.real_cost_kmf)} · marge ${base.formatKmf(row.consolidated_margin_kmf)}`,
      value: row.cost_coverage_pct == null ? '—' : `${base.formatNumber(row.cost_coverage_pct, 1)} %`,
      tone: row.consolidated_margin_kmf != null && Number(row.consolidated_margin_kmf) < 0 ? 'critical' : 'neutral',
    }));
  }

  function costingItems(payload, base) {
    return (Array.isArray(payload && payload.costing_kpis) ? payload.costing_kpis : []).map(metric => {
      const quality = metric && metric.data_quality ? metric.data_quality : {};
      const coverage = quality.items_total == null || quality.items_with_data == null
        ? 'données non précisées'
        : `${base.formatNumber(quality.items_with_data, 0)}/${base.formatNumber(quality.items_total, 0)} données`;
      const incomplete = quality.warning || (quality.completeness && quality.completeness !== 'complete');
      return {
        title: metric.label || metric.key || 'Indicateur costing',
        helper: [coverage, quality.warning || quality.completeness].filter(Boolean).join(' · '),
        value: displayMetric(base, metric),
        tone: incomplete ? 'warning' : 'neutral',
      };
    });
  }

  function varianceItems(payload, base) {
    return (Array.isArray(payload && payload.costing_orders) ? payload.costing_orders : []).map(row => {
      const realMargin = row.consolidated_margin_kmf;
      const incomplete = row.cost_status && row.cost_status !== 'actual';
      return {
        title: row.reference || 'Commande',
        helper: `${base.COST_STATUS_LABELS[row.cost_status] || row.cost_status || 'Costing inconnu'} · vente ${base.formatKmf(row.sale_total_kmf)} · réel ${base.formatKmf(row.real_cost_kmf)} · marge ${base.formatKmf(realMargin)}`,
        value: base.formatSignedKmf(row.variance_kmf),
        tone: realMargin != null && Number(realMargin) < 0 ? 'critical' : (incomplete ? 'warning' : 'neutral'),
      };
    });
  }

  function paymentItems(payload, base) {
    return (Array.isArray(payload && payload.payment_mix) ? payload.payment_mix : []).map(row => ({
      title: row.payment_mode || 'Mode de paiement',
      helper: `${base.formatNumber(row.orders, 0)} commande(s)`,
      value: base.formatKmf(row.total_kmf),
      tone: 'info',
    }));
  }

  function relayItems(payload, base) {
    return (Array.isArray(payload && payload.relay_profitability) ? payload.relay_profitability : []).map(row => {
      const coverage = row.cost_coverage_pct;
      const realMargin = row.consolidated_margin_kmf;
      const incomplete = realMargin == null || (coverage != null && Number(coverage) < 100);
      return {
        title: row.relais_name || 'Relais',
        helper: `${base.formatNumber(row.orders, 0)} commande(s) · CA ${base.formatKmf(row.revenue_kmf)} · marge réelle ${base.formatKmf(realMargin)} · couverture ${coverage == null ? '—' : `${base.formatNumber(coverage, 1)} %`}`,
        value: base.formatKmf(row.estimated_margin_kmf),
        tone: realMargin != null && Number(realMargin) < 0 ? 'critical' : (incomplete ? 'warning' : 'neutral'),
      };
    });
  }

  function refundItems(payload, base) {
    const rows = payload && payload.refunds && Array.isArray(payload.refunds.recent) ? payload.refunds.recent : [];
    return rows.map(row => ({
      title: row.order_reference || 'Commande remboursée',
      helper: `${row.refund_method || 'Méthode inconnue'} · ${base.formatDate(row.completed_at)}`,
      value: base.formatKmf(row.amount_kmf),
      tone: 'violet',
    }));
  }

  function drillCards(base, user) {
    const schema = base.visibleDrillSchema(base.FINANCE_SCHEMA, user);
    return (Array.isArray(schema.drill) ? schema.drill : []).map(item => ({
      key: item.id,
      title: item.label,
      subtitle: 'Approfondir dans le workspace autorisé',
      href: item.href,
      tone: item.id === 'pricing-workspace' ? 'violet' : 'info',
    }));
  }

  function trust(payload, base) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object' ? payload.data_quality : {};
    const scope = payload && payload.scope;
    let generatedAt;
    if (quality.generated_at) {
      const date = new Date(quality.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    return {
      stateLabel: quality.scope_enforced === false ? 'Scope à vérifier' : 'Source canonique',
      scopeLabel: scope && scope.mode === 'market' && scope.market ? `${scope.market.code} · ${scope.market.name || ''}`.trim() : 'Vue autorisée',
      generatedAt,
      qualityLabel: payload && payload.period != null ? `Période : ${base.formatNumber(payload.period, 0)} jours` : undefined,
      ...(Array.isArray(quality.warnings) && quality.warnings.length ? { warningLabel: `${quality.warnings.length} warning(s)` } : {}),
    };
  }

  function cardSection(doc, title, description, id) {
    const section = doc.createElement('section');
    section.className = 'kmc-decision-surface-card';
    if (id) section.setAttribute('id', id);
    section.appendChild(text(doc, 'h2', 'kmc-decision-dashboard-section-title', title));
    if (description) section.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy', description));
    const body = doc.createElement('div');
    section.appendChild(body);
    return { section, body };
  }

  function periodControl(doc, period, onPeriodChange) {
    const toolbar = doc.createElement('div');
    toolbar.className = 'kmc-decision-toolbar';
    const copy = doc.createElement('div');
    copy.className = 'kmc-decision-toolbar-copy';
    copy.appendChild(text(doc, 'span', 'kmc-decision-toolbar-label', 'Période observée'));
    copy.appendChild(text(doc, 'strong', 'kmc-decision-toolbar-value', `${period} jours`));
    toolbar.appendChild(copy);
    const select = doc.createElement('select');
    select.className = 'kmc-decision-toolbar-select';
    select.setAttribute('aria-label', 'Période Finance');
    ['7', '30', '90'].forEach(value => {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = `${value} jours`;
      if (String(period) === value) option.selected = true;
      select.appendChild(option);
    });
    if (typeof onPeriodChange === 'function') {
      select.addEventListener('change', event => {
        Promise.resolve(onPeriodChange(event.target.value)).catch(() => {});
      });
    }
    toolbar.appendChild(select);
    return toolbar;
  }

  function render(rootNode, payload, options, base, decisionUi) {
    const doc = options.document;
    const ui = options.ui;
    rootNode.replaceChildren();
    rootNode.className = '';

    const dashboard = doc.createElement('article');
    dashboard.className = 'kmc-dashboard kmc-decision-dashboard';
    dashboard.setAttribute('data-dashboard-id', 'finance');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'DASHBOARD · FINANCE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Finance'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Lire l’argent encaissé, la vérité des coûts, la marge et les écarts à traiter sans masquer les données incomplètes.'));
    dashboard.appendChild(header);
    dashboard.appendChild(periodControl(doc, options.period || payload.period || '30', options.onPeriodChange));

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const kpis = cardSection(doc, 'Indicateurs financiers', 'Valeurs canoniques de la période sélectionnée.', 'finance-kpis');
    ui.MetricStrip.render(kpis.body, { items: metricItems(payload, base) });
    dashboard.appendChild(kpis.section);

    const overview = overviewCards(payload, base);
    if (overview.length) {
      const section = cardSection(doc, 'Lecture financière', 'Encaissements, coûts, marge et remboursements sans double comptage côté navigateur.', 'finance-overview');
      decisionUi.SummaryCards.render(section.body, { items: overview });
      dashboard.appendChild(section.section);
    }

    const completeness = completenessProgress(payload, base);
    if (completeness.length) {
      const section = cardSection(doc, 'Complétude du costing', 'La marge réelle n’est fiable qu’à hauteur de la couverture réellement disponible.', 'finance-completeness');
      decisionUi.ProgressCards.render(section.body, { items: completeness });
      dashboard.appendChild(section.section);
    }

    const trend = trendItems(payload, base);
    if (trend.length) {
      const section = cardSection(doc, 'Trajectoire financière', 'Périodes et taux de couverture fournis par le backend.', 'finance-trend');
      decisionUi.RankedList.render(section.body, { items: trend });
      dashboard.appendChild(section.section);
    }

    const costing = costingItems(payload, base);
    const variances = varianceItems(payload, base);
    if (costing.length || variances.length) {
      const grid = doc.createElement('div');
      grid.className = 'kmc-decision-dashboard-grid-2';
      const truth = cardSection(doc, 'Vérité du costing', 'Couverture et qualité telles que fournies par les autorités métier.', 'finance-costing');
      decisionUi.RankedList.render(truth.body, { items: costing });
      grid.appendChild(truth.section);
      const variance = cardSection(doc, 'Variances récentes', 'Écarts affichés sans qualifier un seuil « élevé » qui n’existe pas dans le contrat.', 'finance-variances');
      decisionUi.RankedList.render(variance.body, { items: variances });
      grid.appendChild(variance.section);
      dashboard.appendChild(grid);
    }

    const payments = paymentItems(payload, base);
    const relays = relayItems(payload, base);
    if (payments.length || relays.length) {
      const grid = doc.createElement('div');
      grid.className = 'kmc-decision-dashboard-grid-2';
      const paymentSection = cardSection(doc, 'Encaissements par mode', 'Mix de paiement fourni par le backend.', 'finance-payments');
      decisionUi.RankedList.render(paymentSection.body, { items: payments });
      grid.appendChild(paymentSection.section);
      const relaySection = cardSection(doc, 'Rentabilité relais', 'La marge réelle reste inconnue si le costing n’est pas complet.', 'finance-relays');
      decisionUi.RankedList.render(relaySection.body, { items: relays });
      grid.appendChild(relaySection.section);
      dashboard.appendChild(grid);
    }

    const refunds = refundItems(payload, base);
    if (refunds.length) {
      const section = cardSection(doc, 'Remboursements récents', 'Remboursements finalisés de la période.', 'finance-refunds');
      decisionUi.RankedList.render(section.body, { items: refunds });
      dashboard.appendChild(section.section);
    }

    const drills = drillCards(base, options.user);
    if (drills.length) {
      const section = cardSection(doc, 'Approfondir', 'Workspaces visibles selon le rôle et les droits existants.', 'finance-drill');
      decisionUi.SummaryCards.render(section.body, { items: drills });
      dashboard.appendChild(section.section);
    }

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, trust(payload, base));
    dashboard.appendChild(footer);
    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'decision-first-v1' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('finance_decision_base_missing');
    const baseMount = base.mount;
    const enhanced = {
      ...base,
      mount(options) {
        return baseMount(options).then(result => {
          const rerender = nextPeriod => enhanced.mount({ ...options, period: nextPeriod });
          return {
            ...result,
            result: render(options.root, result.payload, { ...options, period: result.period, onPeriodChange: rerender }, base, decisionUi),
            decisionFirst: true,
          };
        });
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectMetricItems: payload => metricItems(payload, base),
      projectOverviewCards: payload => overviewCards(payload, base),
      projectCompletenessProgress: payload => completenessProgress(payload, base),
      projectTrendItems: payload => trendItems(payload, base),
      projectCostingItems: payload => costingItems(payload, base),
      projectVarianceItems: payload => varianceItems(payload, base),
      projectPaymentItems: payload => paymentItems(payload, base),
      projectRelayItems: payload => relayItems(payload, base),
      projectRefundItems: payload => refundItems(payload, base),
      projectDrillCards: user => drillCards(base, user),
      projectTrust: payload => trust(payload, base),
    };
    return Object.freeze(enhanced);
  }

  return Object.freeze({
    kpi,
    displayMetric,
    decisionItems,
    metricItems,
    overviewCards,
    completenessProgress,
    trendItems,
    costingItems,
    varianceItems,
    paymentItems,
    relayItems,
    refundItems,
    drillCards,
    trust,
    render,
    enhance,
  });
});
