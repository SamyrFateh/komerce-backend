/**
 * @komerce-arch
 * @role          canonical-orders-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_orders_payload, decision_primitives
 * @outputs       decision_first_orders_dom
 * @depends       orders, primitives, decision-primitives
 * @used-by       canonical admin Orders runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals, missing_data_never_means_zero
 * @impact-areas  admin-dashboard, orders
 * @version       2026-09
 */
'use strict';

(function initOrdersDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalOrders && root.KomerceDecisionUI) {
    root.KomerceCanonicalOrders = api.enhance(root.KomerceCanonicalOrders, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createOrdersDecision() {
  'use strict';

  const LIFECYCLE_LABELS = Object.freeze({
    pending: 'En attente',
    confirmed: 'Confirmée',
    paid: 'Payée',
    ordered: 'Commandée fournisseur',
    available: 'Disponible relais',
    collected: 'Retirée',
    in_transit: 'En transit',
  });

  const KPI_LABELS = Object.freeze({
    total_orders: 'Commandes',
    active_orders: 'Commandes actives',
    cash_to_confirm: 'Cash à confirmer',
    parcels_to_create: 'Colis à créer',
    cancelled: 'Annulées',
  });

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

  // 1. Bandeau de décision — files bloquantes qui demandent une action aujourd'hui.
  function decisionItems(payload, base) {
    const items = [];
    const cash = kpi(payload, 'cash_to_confirm');
    const parcels = kpi(payload, 'parcels_to_create');

    if (cash && Number(cash.value) > 0) {
      items.push({
        key: 'cash-to-confirm',
        label: 'Cash à confirmer',
        helper: 'Commandes payées cash en attente de confirmation',
        value: base.formatNumber(cash.value, 0),
        tone: 'warning',
        icon: '¤',
        href: '#orders-pending-cash',
        actionLabel: 'Voir la file →',
      });
    }
    if (parcels && Number(parcels.value) > 0) {
      items.push({
        key: 'parcels-to-create',
        label: 'Colis à créer',
        helper: 'Commandes payées, prêtes à passer en logistique',
        value: base.formatNumber(parcels.value, 0),
        tone: 'warning',
        icon: '▣',
        href: '#orders-ready-for-parcel',
        actionLabel: 'Voir la file →',
      });
    }
    return items.slice(0, 4);
  }

  // 2. KPI de tête — tels que fournis, sans recalcul.
  function metricItems(payload, base) {
    return (Array.isArray(payload && payload.kpis) ? payload.kpis : []).map(item => ({
      key: item.key,
      label: KPI_LABELS[item.key] || item.label || item.key,
      value: base.formatNumber(item.value, 0),
      tone: (item.key === 'cash_to_confirm' || item.key === 'parcels_to_create') && Number(item.value) > 0
        ? 'warning'
        : 'neutral',
    }));
  }

  // 3. Funnel du cycle de vie — ordre canonique conservé (order-status-machine.js).
  function lifecycleStages(payload, base) {
    return (Array.isArray(payload && payload.lifecycle) ? payload.lifecycle : []).map(stage => ({
      label: LIFECYCLE_LABELS[stage.status] || stage.status || 'Étape',
      value: base.formatNumber(stage.count, 0),
    }));
  }

  // 4. Mix de paiement — regroupement de lecture, aucun agrégat métier ajouté.
  function paymentMixCards(payload, base) {
    return (Array.isArray(payload && payload.payment_mix) ? payload.payment_mix : []).map(row => ({
      key: row.mode || 'inconnu',
      title: row.mode || 'Mode inconnu',
      subtitle: `${base.formatNumber(row.count, 0)} commande(s)`,
      tone: 'info',
    }));
  }

  // 5 & 6. Files de travail — ordre serveur (created_at ASC) conservé.
  function workQueueItems(rows, base) {
    return (Array.isArray(rows) ? rows : []).map(row => ({
      title: row.reference || row.id || 'Commande',
      helper: [row.status, row.payment_mode, row.total_kmf != null ? `${base.formatNumber(row.total_kmf, 0)} KMF` : null]
        .filter(Boolean).join(' · '),
      tone: 'warning',
      href: row.reference ? `/admin/orders/${encodeURIComponent(row.reference)}` : undefined,
      actionLabel: row.reference ? 'Ouvrir →' : undefined,
    }));
  }

  // 7. Empreinte de confiance — fraîcheur + scope, comme les autres dashboards.
  function trust(payload) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object' ? payload.data_quality : {};
    const scope = payload && payload.scope;
    let generatedAt;
    if (quality.generated_at) {
      const date = new Date(quality.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    return {
      stateLabel: 'Source canonique',
      scopeLabel: scope && scope.mode === 'market' && scope.market
        ? `${scope.market.code} · ${scope.market.name || ''}`.trim()
        : 'Vue globale',
      generatedAt,
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

  function render(rootNode, payload, options, base, decisionUi) {
    const doc = options.document;
    const ui = options.ui;
    rootNode.replaceChildren();
    rootNode.className = '';

    const dashboard = doc.createElement('article');
    dashboard.className = 'kmc-dashboard kmc-decision-dashboard';
    dashboard.setAttribute('data-dashboard-id', 'orders');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'DASHBOARD · SUIVI DES COMMANDES'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Commandes'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Les files de travail commande et le cycle de vie, sans recalcul côté navigateur.'));
    dashboard.appendChild(header);

    // Bloc 1 — bandeau de décision
    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    // Bloc 2 — KPI de tête
    const kpisSection = cardSection(doc, 'État des commandes', 'Les KPI disponibles sont affichés tels que fournis par la source canonique.', 'orders-kpis');
    ui.MetricStrip.render(kpisSection.body, { items: metricItems(payload, base) });
    dashboard.appendChild(kpisSection.section);

    // Bloc 3 — funnel du cycle de vie
    const stages = lifecycleStages(payload, base);
    if (stages.length) {
      const section = cardSection(doc, 'Cycle de vie', 'Comptes serveur par étape, ordre canonique de la state machine commande.', 'orders-lifecycle');
      decisionUi.Funnel.render(section.body, { stages });
      dashboard.appendChild(section.section);
    }

    // Bloc 4 — mix de paiement
    const paymentMix = paymentMixCards(payload, base);
    if (paymentMix.length) {
      const section = cardSection(doc, 'Mix de paiement', 'Répartition par mode de paiement, comptage serveur.', 'orders-payment-mix');
      decisionUi.SummaryCards.render(section.body, { items: paymentMix });
      dashboard.appendChild(section.section);
    }

    // Blocs 5 & 6 — files de travail
    const queuesGrid = doc.createElement('div');
    queuesGrid.className = 'kmc-decision-dashboard-grid-2';

    const pendingCash = workQueueItems((payload && payload.work_queues && payload.work_queues.pending_cash) || [], base);
    const cashSection = cardSection(doc, 'Cash à confirmer', 'Commandes en attente de confirmation de paiement cash, les plus anciennes en premier.', 'orders-pending-cash');
    decisionUi.RankedList.render(cashSection.body, { items: pendingCash });
    queuesGrid.appendChild(cashSection.section);

    const readyForParcel = workQueueItems((payload && payload.work_queues && payload.work_queues.ready_for_parcel) || [], base);
    const parcelSection = cardSection(doc, 'Colis à créer', 'Commandes payées prêtes à passer en logistique, les plus anciennes en premier.', 'orders-ready-for-parcel');
    decisionUi.RankedList.render(parcelSection.body, { items: readyForParcel });
    queuesGrid.appendChild(parcelSection.section);

    dashboard.appendChild(queuesGrid);

    // Bloc 7 — empreinte de confiance
    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, trust(payload));
    dashboard.appendChild(footer);

    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'decision-first-v1' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('orders_decision_base_missing');
    const baseMount = base.mount;
    return Object.freeze({
      ...base,
      mount(options) {
        return baseMount(options).then(result => ({
          ...result,
          result: render(options.root, result.payload, options, base, decisionUi),
          decisionFirst: true,
        }));
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectMetricItems: payload => metricItems(payload, base),
      projectLifecycleStages: payload => lifecycleStages(payload, base),
      projectPaymentMixCards: payload => paymentMixCards(payload, base),
      projectWorkQueueItems: rows => workQueueItems(rows, base),
      projectTrust: trust,
    });
  }

  return Object.freeze({
    kpi,
    decisionItems,
    metricItems,
    lifecycleStages,
    paymentMixCards,
    workQueueItems,
    trust,
    render,
    enhance,
  });
});
