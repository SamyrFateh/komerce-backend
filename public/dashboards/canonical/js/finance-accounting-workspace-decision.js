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
    const add = (key, label, helper, tone, href, actionLabel, icon = '•') => {
      const item = index[key];
      if (!item || item.tone !== tone) return;
      decisions.push({
        key, label, helper, tone, href, actionLabel, icon,
        value: item.value == null ? '—' : item.value,
      });
    };

    // L'ordre suit l'urgence des faits métier : garde hors limites, cash absent,
    // puis actions de remise et dépôts. Ne pas alerter pour une simple garde normale.
    add('over-ceiling', 'Plafond de garde dépassé',
      'Détenteurs au-delà du plafond autorisé par le serveur', 'critical',
      '#accounting-custody', 'Voir les détenteurs →', '!');
    add('overdue', 'Garde hors délai',
      'Détenteurs dépassant le délai de garde du Market', 'critical',
      '#accounting-custody', 'Voir les détenteurs →', '!');
    add('missing', 'Cash non encaissé',
      'Montant dépassant le seuil de rapprochement du marché', 'critical',
      '#accounting-uncollected', 'Voir les commandes →', '!');
    add('toact', 'Remises à traiter',
      'Parmi les remises récentes : réception, preuve finale ou contrôle attendu', 'warning',
      '#accounting-custody', 'Traiter les remises →', '↗');
    add('pending', 'Dépôts à vérifier',
      'Dépôts historiques en attente de contrôle', 'warning',
      '#accounting-deposits', 'Voir les dépôts →', '✓');
    add('legacy', 'Historique à régulariser',
      'Montant des anciennes remises qui ne déchargent pas encore le détenteur', 'warning',
      '#accounting-custody', 'Voir la régularisation →', '↗');

    return decisions.slice(0, 4);
  }

  function summaryCards(items) {
    const index = indexMetrics(items);
    const value = key => index[key] ? index[key].value : '—';
    return [
      {
        key: 'cash-flow',
        title: 'Cash du marché',
        subtitle: 'Attendu · encaissé · détenu · clôturé avec contrôle',
        icon: '¤',
        tone: index.missing && index.missing.tone === 'critical' ? 'critical' : 'neutral',
        metrics: [
          { label: 'Attendu', value: value('expected') },
          { label: 'Collecté', value: value('collected') },
          { label: 'Détenu', value: value('held') },
          { label: 'Clôturé', value: value('closed') },
        ],
      },
      {
        key: 'control',
        title: 'Actions de garde',
        subtitle: 'Remises à suivre et contrôles ouverts',
        icon: 'C',
        tone: ['over-ceiling', 'overdue'].some(key => index[key] && index[key].tone === 'critical')
          ? 'critical' : (index.toact && index.toact.tone === 'warning' ? 'warning' : 'neutral'),
        metrics: [
          { label: 'Remises à traiter', value: value('toact') },
          { label: 'Hors plafond', value: value('over-ceiling') },
          { label: 'Hors délai', value: value('overdue') },
        ],
      },
    ];
  }

  function reconciliationCard(reconciliation = {}) {
    const gapCollection = numeric(reconciliation.gap_collection_kmf);
    const gapClosure = numeric(reconciliation.gap_closure_kmf);
    // Le cash détenu n'est PAS en soi un incident : seul un écart de collecte est signalé ici.
    const hasCollectionGap = gapCollection != null && gapCollection !== 0;
    return {
      key: 'reconciliation',
      title: 'Rapprochement',
      subtitle: 'Seule la réception finale contrôlée clôture les fonds ; le reliquat demeure détenu',
      icon: 'R',
      tone: hasCollectionGap ? 'warning' : 'neutral',
      metrics: [
        { label: 'Écart collecte', value: formatKmf(reconciliation.gap_collection_kmf) },
        { label: 'Collecté − clôturé − pertes', value: formatKmf(gapClosure) },
        { label: 'Détenu maintenant', value: formatKmf(reconciliation.held_kmf) },
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
    copy.textContent = 'Priorités fondées sur les faits du marché ; les fonds détenus restent visibles tant qu’ils ne sont pas clôturés.';
    heading.appendChild(copy);
    container.appendChild(heading);

    const decisions = decisionItems(items);
    if (decisions.length) {
      const decisionHost = documentRef.createElement('div');
      decisionUi.DecisionStrip.render(decisionHost, { items: decisions });
      container.appendChild(decisionHost);
    }

    // Toujours afficher la vérité des fonds, même en l'absence d'alerte.
    const totals = documentRef.createElement('div');
    decisionUi.SummaryCards.render(totals, { items: summaryCards(items) });
    container.appendChild(totals);

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
        })).then(payload => Object.freeze({ ...payload, decisionFirst: true }));
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
