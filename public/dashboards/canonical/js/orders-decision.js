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
    const signals = (payload && payload.signals) || {};

    if (signals.paiements_en_attente > 0) {
      items.push({
        key: 'paiements-en-attente',
        label: 'Paiements en attente',
        helper: 'À relancer pour éviter l’annulation (cash non confirmé depuis +72h)',
        value: base.formatNumber(signals.paiements_en_attente, 0),
        tone: 'warning',
        icon: '¤',
        href: '#orders-pending-cash',
        actionLabel: 'Voir les paiements →',
      });
    }
    if (signals.commandes_bloquees > 0) {
      items.push({
        key: 'commandes-bloquees',
        label: 'Commandes bloquées',
        helper: 'Nécessitent une action immédiate (incident ouvert)',
        value: base.formatNumber(signals.commandes_bloquees, 0),
        tone: 'critical',
        icon: '!',
      });
    }
    if (signals.retraits_en_retard > 0) {
      items.push({
        key: 'retraits-en-retard',
        label: 'Retraits en retard',
        helper: 'Disponibles en relais depuis plus de 72h',
        value: base.formatNumber(signals.retraits_en_retard, 0),
        tone: 'critical',
        icon: '⏱',
      });
    }
    if (signals.litiges_ouverts > 0) {
      items.push({
        key: 'litiges-ouverts',
        label: 'Litiges ouverts',
        helper: 'À traiter avec le client',
        value: base.formatNumber(signals.litiges_ouverts, 0),
        tone: 'warning',
        icon: '⚖',
      });
    }
    return items.slice(0, 4);
  }

  // SLA & promesse client — cf. services/dashboard-orders.js#getDecisionSignals.
  // "Commandes dans les temps (%)" du mock volontairement absent : suppose un
  // délai de livraison CIBLE configuré par marché, qui n'existe dans aucune
  // table du schéma aujourd'hui.
  function slaItems(payload, base) {
    const sla = (payload && payload.signals && payload.signals.sla) || {};
    return [
      {
        key: 'delai-moyen',
        title: 'Délai moyen de livraison',
        subtitle: sla.delai_moyen_jours != null ? `${base.formatNumber(sla.delai_moyen_jours, 1)} jours` : '—',
        tone: 'info',
      },
      {
        key: 'sans-mouvement',
        title: 'Commandes > 72h sans mouvement',
        subtitle: base.formatNumber(sla.sans_mouvement_72h, 0),
        tone: sla.sans_mouvement_72h > 0 ? 'warning' : 'info',
      },
      {
        key: 'prets-aujourdhui',
        title: 'Commandes prêtes aujourd’hui',
        subtitle: base.formatNumber(sla.prets_aujourdhui, 0),
        tone: 'info',
      },
    ];
  }

  // Funnel métier du mock (Créées -> Payées -> Expédiées -> Disponibles
  // relais -> Retirées), additif au funnel technique déjà affiché
  // ("Cycle de vie") — les deux servent des lecteurs différents, aucun ne
  // remplace l'autre.
  function businessFunnelStages(payload, base) {
    const funnel = (payload && payload.funnel) || {};
    return [
      { label: 'Commandes créées', value: base.formatNumber(funnel.creees, 0) },
      { label: 'Payées', value: base.formatNumber(funnel.payees, 0) },
      { label: 'Expédiées', value: base.formatNumber(funnel.expediees, 0) },
      { label: 'Disponibles relais', value: base.formatNumber(funnel.disponibles_relais, 0) },
      { label: 'Retirées', value: base.formatNumber(funnel.retirees, 0) },
    ];
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

  // Commandes prioritaires — cf. services/dashboard-orders.js#getPriorityOrders.
  // Le "problème" vient du vocabulaire d'incident déjà validé côté relais/hub
  // (order_incidents.type) ou du type de litige réel (disputes.type), jamais
  // une catégorie recalculée côté navigateur.
  function priorityOrderItems(payload, base) {
    return (Array.isArray(payload && payload.priority_orders) ? payload.priority_orders : []).map(row => ({
      title: row.reference || 'Commande',
      helper: [
        row.client_name,
        row.relais_name,
        `depuis ${base.formatNumber(row.since_days, 0)} j`,
        row.problem,
      ].filter(Boolean).join(' · '),
      tone: 'critical',
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

    // Bloc 2b — funnel métier + SLA (additif, cf. buildSignals côté serveur)
    const businessGrid = doc.createElement('div');
    businessGrid.className = 'kmc-decision-dashboard-grid-2';

    const businessFunnel = businessFunnelStages(payload, base);
    if (businessFunnel.some(stage => stage.value !== '—')) {
      const funnelSection = cardSection(doc, 'Funnel de conversion', 'Du clic à la livraison : suivez chaque étape et identifiez les pertes.', 'orders-business-funnel');
      decisionUi.Funnel.render(funnelSection.body, { stages: businessFunnel });
      businessGrid.appendChild(funnelSection.section);
    }

    const slaSection = cardSection(doc, 'SLA & promesse client', 'Tenez vos engagements et offrez une expérience fiable.', 'orders-sla');
    decisionUi.SummaryCards.render(slaSection.body, { items: slaItems(payload, base) });
    businessGrid.appendChild(slaSection.section);

    dashboard.appendChild(businessGrid);

    // Bloc 2c — commandes prioritaires
    const priorityItems = priorityOrderItems(payload, base);
    if (priorityItems.length) {
      const prioritySection = cardSection(doc, 'Commandes prioritaires', 'Les commandes qui nécessitent votre attention en priorité.', 'orders-priority');
      decisionUi.RankedList.render(prioritySection.body, { items: priorityItems });
      dashboard.appendChild(prioritySection.section);
    }

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

    function queueDescription(base_text, shown, total) {
      if (total != null && shown != null && total > shown) {
        return `${base_text} ${shown} sur ${total} affichée(s) — les plus anciennes en priorité.`;
      }
      return base_text;
    }

    const pendingCash = workQueueItems((payload && payload.work_queues && payload.work_queues.pending_cash) || [], base);
    const cashSection = cardSection(doc, 'Cash à confirmer', queueDescription(
      'Commandes en attente de confirmation de paiement cash, les plus anciennes en premier.',
      payload && payload.work_queues && payload.work_queues.pending_cash_shown,
      payload && payload.work_queues && payload.work_queues.pending_cash_total,
    ), 'orders-pending-cash');
    decisionUi.RankedList.render(cashSection.body, { items: pendingCash });
    queuesGrid.appendChild(cashSection.section);

    const readyForParcel = workQueueItems((payload && payload.work_queues && payload.work_queues.ready_for_parcel) || [], base);
    const parcelSection = cardSection(doc, 'Colis à créer', queueDescription(
      'Commandes payées prêtes à passer en logistique, les plus anciennes en premier.',
      payload && payload.work_queues && payload.work_queues.ready_for_parcel_shown,
      payload && payload.work_queues && payload.work_queues.ready_for_parcel_total,
    ), 'orders-ready-for-parcel');
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
