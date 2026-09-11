/**
 * @komerce-arch
 * @role          canonical-accounting-workspace-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_accounting_workspace_summary, reconciliation_projection, decision_primitives
 * @outputs       decision_first_accounting_workspace_overview
 * @depends       finance-accounting-workspace, decision-primitives, primitives
 * @used-by       canonical admin Finance / Comptabilité workspace runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, payment, accounting
 * @version       2026-09
 */
'use strict';

(function initAccountingWorkspaceDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalFinanceAccountingWorkspace && root.KomerceDecisionUI) {
    root.KomerceCanonicalFinanceAccountingWorkspace = api.enhance(
      root.KomerceCanonicalFinanceAccountingWorkspace,
      root.KomerceDecisionUI
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createAccountingWorkspaceDecision() {
  'use strict';

  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value) {
    const number = numeric(value);
    if (number == null) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    const number = numeric(value);
    return number == null ? '—' : `${formatNumber(number)} KMF`;
  }

  function indexMetrics(items) {
    const index = Object.create(null);
    (Array.isArray(items) ? items : []).forEach(item => {
      if (item && item.key) index[item.key] = item;
    });
    return index;
  }

  function decisionItems(items) {
    const index = indexMetrics(items);
    const decisions = [];

    if (index.missing && index.missing.tone === 'critical') {
      decisions.push({
        key: 'missing',
        label: 'Cash non encaissé',
        helper: 'Montant dépassant le seuil de rapprochement du marché',
        value: index.missing.value == null ? '—' : index.missing.value,
        tone: 'critical',
        icon: '!',
        href: '#accounting-uncollected',
        actionLabel: 'Voir les commandes →',
      });
    }

    if (index.pending && index.pending.tone === 'warning') {
      decisions.push({
        key: 'pending',
        label: 'Dépôts à vérifier',
        helper: 'Dépôts relais en attente de contrôle',
        value: index.pending.value == null ? '—' : index.pending.value,
        tone: 'warning',
        icon: '✓',
        href: '#accounting-deposits',
        actionLabel: 'Voir les dépôts →',
      });
    }

    return decisions;
  }

  function summaryCards(items) {
    const index = indexMetrics(items);
    return [
      {
        key: 'cash-flow',
        title: 'Cash du marché',
        subtitle: 'Attendu · collecté · vérifié',
        icon: '¤',
        tone: index.missing && index.missing.tone === 'critical' ? 'critical' : 'neutral',
        metrics: [
          { label: 'Attendu', value: index.expected ? index.expected.value : '—' },
          { label: 'Collecté', value: index.collected ? index.collected.value : '—' },
          { label: 'Vérifié', value: index.verified ? index.verified.value : '—' },
        ],
      },
      {
        key: 'control',
        title: 'Contrôle dépôts',
        subtitle: 'Files réellement ouvertes',
        icon: 'C',
        tone: index.pending && index.pending.tone === 'warning' ? 'warning' : 'positive',
        metrics: [
          { label: 'À vérifier', value: index.pending ? index.pending.value : '—' },
          { label: 'Non encaissé', value: index.missing ? index.missing.value : '—' },
        ],
      },
    ];
  }

  function reconciliationCard(reconciliation = {}) {
    const gapCollection = numeric(reconciliation.gap_collection_kmf);
    const gapDeposit = numeric(reconciliation.gap_deposit_kmf);
    const hasGap = (gapCollection != null && gapCollection !== 0) || (gapDeposit != null && gapDeposit !== 0);
    return {
      key: 'reconciliation',
      title: 'Rapprochement',
      subtitle: 'Écarts calculés par le serveur pour la période',
      icon: 'R',
      tone: hasGap ? 'warning' : 'positive',
      metrics: [
        { label: 'Écart collecte', value: formatKmf(reconciliation.gap_collection_kmf) },
        { label: 'Écart dépôt', value: formatKmf(reconciliation.gap_deposit_kmf) },
      ],
    };
  }

  function renderMetricOverview(container, items, decisionUi, doc) {
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new TypeError('accounting_workspace_decision_container_invalid');
    }
    if (!decisionUi || !decisionUi.DecisionStrip || !decisionUi.SummaryCards) {
      throw new Error('accounting_workspace_decision_primitives_missing');
    }
    const documentRef = doc || container.ownerDocument;
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new Error('accounting_workspace_decision_document_missing');
    }

    container.replaceChildren();
    container.className = 'kmc-workspace-metrics kmc-workspace-decision-overview';
    container.setAttribute('data-workspace-visual', 'decision-first-v1');

    const heading = documentRef.createElement('div');
    heading.className = 'kmc-workspace-decision-heading';
    const title = documentRef.createElement('h2');
    title.className = 'kmc-decision-dashboard-section-title';
    title.textContent = 'À contrôler maintenant';
    heading.appendChild(title);
    const copy = documentRef.createElement('p');
    copy.className = 'kmc-decision-dashboard-section-copy';
    copy.textContent = 'Lecture des files cash et dépôts fournies par le serveur, sans seuil ni score inventé côté navigateur.';
    heading.appendChild(copy);
    container.appendChild(heading);

    const decisions = decisionItems(items);
    if (decisions.length) {
      const decisionHost = documentRef.createElement('div');
      decisionUi.DecisionStrip.render(decisionHost, { items: decisions });
      container.appendChild(decisionHost);
    }

    const summaryHost = documentRef.createElement('div');
    decisionUi.SummaryCards.render(summaryHost, { items: summaryCards(items) });
    container.appendChild(summaryHost);
    return container;
  }

  function decorateUi(ui, decisionUi, doc) {
    if (!ui || !ui.MetricStrip || typeof ui.MetricStrip.render !== 'function') return ui;
    if (!decisionUi || !decisionUi.DecisionStrip || !decisionUi.SummaryCards) return ui;

    return Object.freeze({
      ...ui,
      MetricStrip: Object.freeze({
        ...ui.MetricStrip,
        render(container, config = {}) {
          return renderMetricOverview(container, config.items, decisionUi, doc);
        },
      }),
    });
  }

  function appendReconciliationOverview(rootNode, payload, decisionUi, doc) {
    if (!rootNode || !payload || !decisionUi || !decisionUi.SummaryCards) return null;
    const documentRef = doc || rootNode.ownerDocument;
    if (!documentRef || typeof documentRef.createElement !== 'function') return null;
    const metrics = rootNode.querySelector && rootNode.querySelector('.kmc-workspace-decision-overview');
    if (!metrics || !metrics.parentNode) return null;

    const existing = rootNode.querySelector && rootNode.querySelector('[data-accounting-reconciliation-overview]');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const host = documentRef.createElement('section');
    host.className = 'kmc-decision-surface-card';
    host.setAttribute('data-accounting-reconciliation-overview', 'true');
    const heading = documentRef.createElement('h2');
    heading.className = 'kmc-decision-dashboard-section-title';
    heading.textContent = 'Vérité du rapprochement';
    host.appendChild(heading);
    const copy = documentRef.createElement('p');
    copy.className = 'kmc-decision-dashboard-section-copy';
    copy.textContent = 'Les écarts ci-dessous sont ceux calculés par le backend pour le marché et la période sélectionnés.';
    host.appendChild(copy);
    const cards = documentRef.createElement('div');
    decisionUi.SummaryCards.render(cards, { items: [reconciliationCard(payload.reconciliation || {})] });
    host.appendChild(cards);

    if (metrics.nextSibling && typeof metrics.parentNode.insertBefore === 'function') {
      metrics.parentNode.insertBefore(host, metrics.nextSibling);
    } else {
      metrics.parentNode.appendChild(host);
    }
    return host;
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') {
      throw new Error('accounting_workspace_decision_base_missing');
    }
    const baseMount = base.mount;
    return Object.freeze({
      ...base,
      mount(options) {
        return Promise.resolve(baseMount({
          ...options,
          ui: decorateUi(options && options.ui, decisionUi, options && options.document),
        })).then(payload => {
          appendReconciliationOverview(options && options.root, payload, decisionUi, options && options.document);
          return Object.freeze({ ...payload, decisionFirst: true });
        });
      },
      projectDecisionItems(summary) {
        return decisionItems(base.metricItems(summary));
      },
      projectSummaryCards(summary) {
        return summaryCards(base.metricItems(summary));
      },
      projectReconciliationCard: reconciliationCard,
    });
  }

  return Object.freeze({
    numeric,
    indexMetrics,
    decisionItems,
    summaryCards,
    reconciliationCard,
    renderMetricOverview,
    decorateUi,
    appendReconciliationOverview,
    enhance,
  });
});
