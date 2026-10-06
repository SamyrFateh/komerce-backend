/**
 * @komerce-arch
 * @role          canonical-operations-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_operations_payload, decision_primitives
 * @outputs       decision_first_operations_dom
 * @depends       operations, primitives, decision-primitives
 * @used-by       canonical admin Operations runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, operations, logistics
 * @version       2026-09
 */
'use strict';

(function initOperationsDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalOperations && root.KomerceDecisionUI) {
    root.KomerceCanonicalOperations = api.enhance(root.KomerceCanonicalOperations, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createOperationsDecision() {
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
    if (item.unit === '%') return `${base.formatNumber(item.value)} %`;
    if (item.unit === 'KMF') return `${base.formatNumber(item.value, 0)} KMF`;
    return base.formatNumber(item.value, 0);
  }

  function severity(row) {
    const raw = row && row.severity;
    if (raw === 'urgent' || raw === 'critical') return 'critical';
    if (raw === 'warning') return 'warning';
    return 'info';
  }


  function controlHealthClass(health) {
    if (health === 'RED') return 'is-critical';
    if (health === 'ORANGE') return 'is-warning';
    return 'is-positive';
  }

  function controlChainColumns(payload) {
    const chain = payload && payload.control_chain && typeof payload.control_chain === 'object'
      ? payload.control_chain
      : {};
    const stages = Array.isArray(chain.stages) ? chain.stages : [];
    const byStage = chain.by_stage && typeof chain.by_stage === 'object' ? chain.by_stage : {};
    const structuralAlerts = Array.isArray(chain.structural_alerts) ? chain.structural_alerts : [];

    return stages.map(stage => ({
      key: stage.key,
      label: stage.label,
      alerts: structuralAlerts
        .filter(alert => alert && alert.stage === stage.key)
        .map(alert => ({
          health: alert.health || 'ORANGE',
          count: Number(alert.order_count) || 0,
          code: alert.reason_code || 'exception',
          summary: alert.summary || alert.reason_code || 'Cause commune',
        })),
      orders: (Array.isArray(byStage[stage.key]) ? byStage[stage.key] : []).map(order => ({
        reference: order.order_reference || 'Commande',
        health: order.health || 'GREEN',
        split: order.split === true,
        href: order.order_reference ? `/admin/orders/${encodeURIComponent(order.order_reference)}` : null,
      })),
    }));
  }

  function renderControlChain(doc, host, payload) {
    const columns = controlChainColumns(payload);
    host.className = 'kmc-control-chain';

    columns.forEach(column => {
      const stage = doc.createElement('section');
      stage.className = 'kmc-control-stage';
      stage.setAttribute('data-control-stage', column.key);

      const heading = doc.createElement('div');
      heading.className = 'kmc-control-stage-heading';
      heading.appendChild(text(doc, 'span', 'kmc-control-stage-title', column.label));
      heading.appendChild(text(doc, 'span', 'kmc-control-stage-count', column.orders.length));
      stage.appendChild(heading);

      if (Array.isArray(column.alerts) && column.alerts.length) {
        const alerts = doc.createElement('div');
        alerts.className = 'kmc-control-structural-alerts';
        column.alerts.forEach(alert => {
          const item = doc.createElement('div');
          item.className = `kmc-control-structural-alert ${controlHealthClass(alert.health)}`;
          item.setAttribute('data-control-root-cause', alert.code);
          item.appendChild(text(doc, 'strong', 'kmc-control-structural-count', `${alert.count} commandes`));
          item.appendChild(text(doc, 'span', 'kmc-control-structural-summary', alert.summary));
          alerts.appendChild(item);
        });
        stage.appendChild(alerts);
      }

      const list = doc.createElement('div');
      list.className = 'kmc-control-order-list';

      if (!column.orders.length) {
        list.appendChild(text(doc, 'div', 'kmc-control-order-empty', '—'));
      } else {
        column.orders.forEach(order => {
          const item = doc.createElement(order.href ? 'a' : 'div');
          item.className = `kmc-control-order ${controlHealthClass(order.health)}`;
          if (order.href) item.setAttribute('href', order.href);
          item.setAttribute('aria-label', `${order.reference} · ${order.health}`);

          const dot = doc.createElement('span');
          dot.className = 'kmc-control-order-dot';
          dot.setAttribute('aria-hidden', 'true');
          item.appendChild(dot);

          item.appendChild(text(doc, 'span', 'kmc-control-order-ref', order.reference));
          list.appendChild(item);
        });
      }

      stage.appendChild(list);
      host.appendChild(stage);
    });
  }

  function decisionItems(payload, base) {
    const items = [];
    const signals = Array.isArray(payload && payload.signals) ? payload.signals : [];
    const criticalSignals = signals.filter(row => severity(row) === 'critical').length;
    const warningSignals = signals.filter(row => severity(row) === 'warning').length;
    const delays = kpi(payload, 'retards_critiques');
    const payments = kpi(payload, 'paiements_en_attente');

    if (criticalSignals > 0) {
      items.push({
        key: 'critical-incidents',
        label: 'Incidents critiques',
        helper: 'Signaux opérationnels critiques ouverts',
        value: base.formatNumber(criticalSignals, 0),
        tone: 'critical',
        icon: '!',
        href: '#operations-signals',
        actionLabel: 'Voir les incidents →',
      });
    }
    if (warningSignals > 0) {
      items.push({
        key: 'attention-signals',
        label: 'Points d’attention',
        helper: 'Signaux warning fournis par le backend',
        value: base.formatNumber(warningSignals, 0),
        tone: 'warning',
        icon: '•',
        href: '#operations-signals',
        actionLabel: 'Voir les signaux →',
      });
    }
    if (delays && Number(delays.value) > 0) {
      items.push({
        key: 'critical-delays',
        label: 'Retards critiques',
        helper: 'Colis au-delà du seuil opérationnel',
        value: displayMetric(base, delays),
        tone: 'critical',
        icon: '⌛',
        href: '#operations-delays',
        actionLabel: 'Voir les retards →',
      });
    }
    if (payments && Number(payments.value) > 0) {
      items.push({
        key: 'payments-pending',
        label: 'Paiements en attente',
        helper: 'État opérationnel, sans extrapoler un montant de cash',
        value: displayMetric(base, payments),
        tone: 'warning',
        icon: '¤',
        href: '#operations-kpis',
        actionLabel: 'Voir les KPI →',
      });
    }
    return items.slice(0, 4);
  }

  function metricItems(payload, base) {
    const labels = {
      'commandes-aujourdhui': 'Commandes aujourd’hui',
      'paiements-attente': 'Paiements en attente',
      'colis-preparation': 'Colis préparation',
      'colis-transit': 'Colis en transit',
      'disponibles-relais': 'Disponibles relais',
      'retards-critiques': 'Retards critiques',
      'completude-scans': 'Complétude scans',
      'collecte-relais': 'Taux collecte relais',
    };
    return Object.entries(base.projectMetrics(payload)).map(([key, item]) => ({
      key,
      label: labels[key] || key,
      ...item,
    }));
  }

  function metricPair(payload, base, key, label) {
    const item = kpi(payload, key);
    return item ? { label, value: displayMetric(base, item) } : null;
  }

  function workspaceSummary(payload, base) {
    const definitions = [
      {
        key: 'execution', title: 'Exécution commandes', tone: 'info',
        metrics: [
          metricPair(payload, base, 'cmds_aujourdhui', 'Commandes aujourd’hui'),
          metricPair(payload, base, 'paiements_en_attente', 'Paiements en attente'),
        ],
      },
      {
        key: 'logistics', title: 'Flux logistique', tone: 'warning',
        metrics: [
          metricPair(payload, base, 'colis_preparation', 'En préparation'),
          metricPair(payload, base, 'colis_transit', 'En transit'),
          metricPair(payload, base, 'retards_critiques', 'Retards critiques'),
        ],
      },
      {
        key: 'relay', title: 'Relais', tone: 'positive',
        metrics: [
          metricPair(payload, base, 'disponibles_relais', 'Disponibles relais'),
          metricPair(payload, base, 'taux_collecte_relais', 'Taux collecte'),
        ],
      },
      {
        key: 'traceability', title: 'Traçabilité', tone: 'violet',
        metrics: [metricPair(payload, base, 'taux_completude_scans', 'Complétude scans')],
      },
    ];
    return definitions
      .map(card => ({ ...card, metrics: card.metrics.filter(Boolean) }))
      .filter(card => card.metrics.length > 0);
  }

  function networkProgress(payload, base) {
    return [
      { key: 'taux_completude_scans', label: 'Complétude scans', tone: 'info' },
      { key: 'taux_collecte_relais', label: 'Collecte relais', tone: 'positive' },
    ].map(definition => {
      const item = kpi(payload, definition.key);
      if (!item || item.value == null) return null;
      return {
        label: definition.label,
        value: displayMetric(base, item),
        percent: Number(item.value),
        tone: item.data_quality && item.data_quality.warning ? 'warning' : definition.tone,
        helper: item.data_quality && item.data_quality.warning ? String(item.data_quality.warning) : undefined,
      };
    }).filter(Boolean);
  }

  function priorityOrders(payload, base) {
    return (Array.isArray(payload && payload.active_orders) ? payload.active_orders : []).slice(0, 5).map(row => ({
      title: row.reference || 'Commande',
      helper: [row.status, row.payment_status, row.relais_name, row.destination_island].filter(Boolean).join(' · ') || 'Commande active',
      priority: row.hours_since_last_event == null ? undefined : `${base.formatNumber(row.hours_since_last_event, 0)} h`,
      tone: 'warning',
    }));
  }

  function delayItems(payload, base) {
    return (Array.isArray(payload && payload.critical_delays) ? payload.critical_delays : []).map(row => ({
      title: row.tracking_number || row.order_reference || 'Colis',
      helper: [row.order_reference, row.status, row.relais_name].filter(Boolean).join(' · '),
      value: row.days_in_transit == null ? '—' : `${base.formatNumber(row.days_in_transit, 0)} j`,
      tone: 'critical',
    }));
  }

  function drillCards(base, user) {
    const schema = base.visibleDrillSchema(base.OPERATIONS_SCHEMA, user);
    return (Array.isArray(schema.drill) ? schema.drill : []).map(item => ({
      key: item.id,
      title: item.label,
      subtitle: 'Approfondir dans le workspace autorisé',
      href: item.href,
      tone: item.id === 'shipping-customs-workspace' ? 'violet' : 'info',
    }));
  }

  function trust(payload) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object' ? payload.data_quality : {};
    const scope = payload && payload.scope;
    let generatedAt;
    if (quality.generated_at) {
      const date = new Date(quality.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    return {
      stateLabel: quality.scope_enforced === false ? 'Scope à vérifier' : 'Source canonique',
      scopeLabel: scope && scope.mode === 'market' && scope.market
        ? `${scope.market.code} · ${scope.market.name || ''}`.trim()
        : 'Vue autorisée',
      generatedAt,
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

  function render(rootNode, payload, options, base, decisionUi) {
    const doc = options.document;
    const ui = options.ui;
    rootNode.replaceChildren();
    rootNode.className = '';

    const dashboard = doc.createElement('article');
    dashboard.className = 'kmc-dashboard kmc-decision-dashboard';
    if (typeof globalThis !== 'undefined' && globalThis.KomerceCanonicalCockpitPattern) {
      globalThis.KomerceCanonicalCockpitPattern.decorateDashboard(dashboard, 'operations');
    }
    dashboard.setAttribute('data-dashboard-id', 'operations');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'DASHBOARD · OPÉRATIONS'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Opérations'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Voir ce qui doit avancer maintenant, où se trouvent les frictions et quels flux demandent une attention terrain.'));
    dashboard.appendChild(header);

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      host.className = 'kmc-cockpit-decisions';
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const controlColumns = controlChainColumns(payload);
    if (controlColumns.length) {
      const chain = cardSection(
        doc,
        'Chaîne de contrôle',
        'Une commande reste une seule ligne de pilotage et avance d’étape en étape. La couleur signale uniquement son état opérationnel courant.',
        'operations-control-chain'
      );
      chain.section.className += ' kmc-control-chain-card';
      renderControlChain(doc, chain.body, payload);
      dashboard.appendChild(chain.section);
    }

    const executionGrid = doc.createElement('div');
    executionGrid.className = 'kmc-decision-dashboard-grid-2';
    const signals = cardSection(doc, 'Incidents & signaux', 'Signaux opérationnels ouverts et recommandations déjà fournies.', 'operations-signals');
    ui.AlertPanel.render(signals.body, { title: 'Signaux opérationnels', items: base.projectSignals(payload), emptyText: 'Aucun incident opérationnel ouvert.' });
    executionGrid.appendChild(signals.section);

    const orders = cardSection(doc, 'File d’exécution', 'Ordre du backend conservé ; le badge indique le temps sans avancement.', 'operations-orders');
    decisionUi.PriorityList.render(orders.body, { items: priorityOrders(payload, base) });
    executionGrid.appendChild(orders.section);
    dashboard.appendChild(executionGrid);

    const delays = delayItems(payload, base);
    if (delays.length) {
      const section = cardSection(doc, 'Colis en retard critique', 'Transit critique tel que fourni par la source opérationnelle.', 'operations-delays');
      decisionUi.RankedList.render(section.body, { items: delays });
      dashboard.appendChild(section.section);
    }

    const drills = drillCards(base, options.user);
    if (drills.length) {
      const section = cardSection(doc, 'Approfondir', 'Workspaces visibles selon le rôle et les droits existants.', 'operations-drill');
      decisionUi.SummaryCards.render(section.body, { items: drills });
      dashboard.appendChild(section.section);
    }

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, trust(payload));
    dashboard.appendChild(footer);
    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'decision-first-v1' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('operations_decision_base_missing');
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
      projectControlChainColumns: controlChainColumns,
      projectMetricItems: payload => metricItems(payload, base),
      projectWorkspaceSummary: payload => workspaceSummary(payload, base),
      projectNetworkProgress: payload => networkProgress(payload, base),
      projectPriorityOrders: payload => priorityOrders(payload, base),
      projectDelayItems: payload => delayItems(payload, base),
      projectDrillCards: user => drillCards(base, user),
      projectTrust: trust,
    });
  }

  return Object.freeze({
    kpi,
    displayMetric,
    severity,
    decisionItems,
    controlHealthClass,
    controlChainColumns,
    renderControlChain,
    metricItems,
    workspaceSummary,
    networkProgress,
    priorityOrders,
    delayItems,
    drillCards,
    trust,
    render,
    enhance,
  });
});
