/**
 * @komerce-arch
 * @role          canonical-finance-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_finance_payload, supplier_payment_review, decision_primitives
 * @outputs       decision_first_finance_dom, global_supplier_payment_review_queue
 * @depends       finance, primitives, decision-primitives
 * @used-by       canonical admin Finance runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, finance, economic-engine, purchasing
 * @version       2026-10
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
    const supplierReview = payload && payload.supplier_payment_review;
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
        href: pendingPayments.drill_to || '#finance-kpis',
        actionLabel: 'Voir les commandes →',
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
        href: '#finance-incomplete-costs',
        actionLabel: 'Voir les commandes →',
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
    if (supplierReview && Number(supplierReview.count) > 0) {
      items.push({
        key: 'supplier-payments-review',
        label: 'Paiements fournisseur à revoir',
        helper: 'État courant : ambigu, rejeté ou rapprochement mismatched — hors filtre période',
        value: base.formatNumber(supplierReview.count, 0),
        tone: 'warning',
        icon: '!',
        href: '#finance-supplier-payments',
        actionLabel: 'Voir la file →',
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
    return items.slice(0, 5);
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

  function headlineMetrics(payload, base) {
    const keep = new Set(['ca-encaisse', 'cout-reel', 'marge', 'completude']);
    return metricItems(payload, base).filter(item => keep.has(item.key));
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
    // Filtré sur variance_kmf !== 0 — exactement la même condition que le
    // compte "Variances observées" du bandeau de décision (decisionItems
    // ci-dessus). Avant : cette section montrait TOUTES les commandes
    // costées, y compris celles à variance nulle — la liste ne
    // correspondait pas au chiffre affiché sur la carte de décision.
    return (Array.isArray(payload && payload.costing_orders) ? payload.costing_orders : [])
      .filter(row => row && Number.isFinite(Number(row.variance_kmf)) && Number(row.variance_kmf) !== 0)
      .map(row => {
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

  // Détail de "Coûts incomplets" (bandeau de décision) — jusqu'ici cette
  // carte pointait vers #finance-costing, qui montre en réalité 5 métriques
  // de qualité coût/marge agrégées (coût estimé, coût réel, marge estimée…)
  // sans aucun rapport avec le NOMBRE de commandes à coût incomplet compté
  // sur la carte. incomplete_cost_orders existe déjà dans le payload
  // (services/dashboard-finance-canonical.js, même clause WHERE que le
  // compte cmds_cout_incomplet) mais n'était affiché nulle part.
  function incompleteCostOrderItems(payload, base) {
    return (Array.isArray(payload && payload.incomplete_cost_orders) ? payload.incomplete_cost_orders : []).map(row => ({
      title: row.reference || 'Commande',
      helper: `${row.status || '—'} · paiement ${row.payment_status || '—'} · ${base.formatDate(row.created_at)}`,
      value: base.formatKmf(row.total_kmf),
      tone: 'warning',
    }));
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

  function supplierPaymentReviewItems(payload, base) {
    const review = payload && payload.supplier_payment_review;
    const rows = review && Array.isArray(review.items) ? review.items : [];
    return rows.map(row => ({
      title: `${row.provider || 'Provider'} · PO ${base.shortId(row.purchase_order_id)}`,
      helper: [
        row.status || 'statut inconnu',
        `rapprochement ${row.reconciliation_status || 'inconnu'}`,
        row.review_reason || null,
        `débit réel prouvé ${row.real_debit_verified === true ? 'oui' : 'non'}`,
        base.formatDate(row.updated_at),
      ].filter(Boolean).join(' · '),
      value: row.observed_amount == null
        ? `attendu ${base.formatExactAmount(row.expected_amount, row.currency)} · observé —`
        : `attendu ${base.formatExactAmount(row.expected_amount, row.currency)} · observé ${base.formatExactAmount(row.observed_amount, row.currency)}`,
      tone: row.reconciliation_status === 'mismatched' ? 'critical' : 'warning',
      href: row.drill_to
        ? base.contextualHref(row.drill_to, '/admin/finance', 'Retour à Finance')
        : undefined,
      actionLabel: row.drill_to ? 'Ouvrir dans Achats →' : undefined,
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
    if (typeof globalThis !== 'undefined' && globalThis.KomerceCanonicalCockpitPattern) {
      globalThis.KomerceCanonicalCockpitPattern.decorateDashboard(dashboard, 'finance');
    }
    dashboard.setAttribute('data-dashboard-id', 'finance');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'FLUX · FINANCE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Finance'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Voir où est l’argent, si la marge est fiable et quelles anomalies exigent une action.'));
    dashboard.appendChild(header);
    dashboard.appendChild(periodControl(doc, options.period || payload.period || '30', options.onPeriodChange));

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      host.className = 'kmc-cockpit-decisions';
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const economics = cardSection(
      doc,
      'Économie',
      'Encaissement, coût réel, marge consolidée et complétude : la lecture financière minimale.',
      'finance-kpis'
    );
    economics.section.className += ' is-cockpit-truth';
    ui.MetricStrip.render(economics.body, { items: headlineMetrics(payload, base) });
    dashboard.appendChild(economics.section);

    const supplierPayments = supplierPaymentReviewItems(payload, base);
    if (supplierPayments.length) {
      const review = payload.supplier_payment_review || {};
      const description = review.truncated
        ? `${supplierPayments.length} sur ${base.formatNumber(review.count, 0)} affiché(s) — état courant, hors filtre période. Aucun total multi-devise.`
        : 'État courant des paiements fournisseur ambigus, rejetés ou mismatched. Aucun total multi-devise.';
      const section = cardSection(doc, 'Trésorerie · paiements fournisseur à revoir', description, 'finance-supplier-payments');
      decisionUi.RankedList.render(section.body, { items: supplierPayments });
      dashboard.appendChild(section.section);
    }

    const incompleteCostOrders = incompleteCostOrderItems(payload, base);
    const variances = varianceItems(payload, base);
    if (incompleteCostOrders.length || variances.length) {
      const grid = doc.createElement('div');
      grid.className = 'kmc-decision-dashboard-grid-2';

      if (incompleteCostOrders.length) {
        const incompleteCount = kpi(payload, 'cmds_cout_incomplet');
        const description = incompleteCount && Number(incompleteCount.value) > incompleteCostOrders.length
          ? `${incompleteCostOrders.length} sur ${base.formatNumber(incompleteCount.value, 0)} affichée(s) — les plus anciennes en priorité.`
          : 'Commandes dont le coût réel n’est pas encore complet.';
        const section = cardSection(doc, 'Coûts incomplets', description, 'finance-incomplete-costs');
        decisionUi.RankedList.render(section.body, { items: incompleteCostOrders });
        grid.appendChild(section.section);
      }

      if (variances.length) {
        const section = cardSection(
          doc,
          'Variances observées',
          'Écarts non nuls, sans seuil inventé côté navigateur.',
          'finance-variances'
        );
        decisionUi.RankedList.render(section.body, { items: variances });
        grid.appendChild(section.section);
      }

      dashboard.appendChild(grid);
    }

    const trend = trendItems(payload, base);
    if (trend.length) {
      const section = cardSection(
        doc,
        'Trajectoire financière',
        'Évolution fournie par le backend avec la couverture réelle des coûts.',
        'finance-trend'
      );
      decisionUi.RankedList.render(section.body, { items: trend });
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
      projectHeadlineMetrics: payload => headlineMetrics(payload, base),
      projectOverviewCards: payload => overviewCards(payload, base),
      projectCompletenessProgress: payload => completenessProgress(payload, base),
      projectTrendItems: payload => trendItems(payload, base),
      projectCostingItems: payload => costingItems(payload, base),
      projectIncompleteCostOrderItems: payload => incompleteCostOrderItems(payload, base),
      projectVarianceItems: payload => varianceItems(payload, base),
      projectPaymentItems: payload => paymentItems(payload, base),
      projectRelayItems: payload => relayItems(payload, base),
      projectRefundItems: payload => refundItems(payload, base),
      projectSupplierPaymentReviewItems: payload => supplierPaymentReviewItems(payload, base),
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
    headlineMetrics,
    overviewCards,
    completenessProgress,
    trendItems,
    costingItems,
    incompleteCostOrderItems,
    varianceItems,
    paymentItems,
    relayItems,
    refundItems,
    supplierPaymentReviewItems,
    drillCards,
    trust,
    render,
    enhance,
  });
});
