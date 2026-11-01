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


  // UNKNOWN (ou toute valeur absente/inconnue) n'est JAMAIS rendu comme GREEN.
  function controlHealthClass(health) {
    if (health === 'RED') return 'is-critical';
    if (health === 'ORANGE') return 'is-warning';
    if (health === 'GREEN') return 'is-positive';
    return 'is-unknown';
  }


  const CONTROL_STAGE_META = Object.freeze({
    ORDER: Object.freeze({ icon: '▤', accent: 'blue' }),
    PURCHASING: Object.freeze({ icon: '🛒', accent: 'violet' }),
    SUPPLIER: Object.freeze({ icon: '◆', accent: 'orange' }),
    HUB_RECEIVING: Object.freeze({ icon: '⌂', accent: 'teal' }),
    HUB_CONTROL: Object.freeze({ icon: '✓', accent: 'violet' }),
    FORWARDER: Object.freeze({ icon: '⚓', accent: 'blue' }),
    TRANSPORT: Object.freeze({ icon: '▣', accent: 'teal' }),
    CUSTOMS: Object.freeze({ icon: '⌂', accent: 'red' }),
    RELAY: Object.freeze({ icon: '●', accent: 'green' }),
  });

  function controlStageMeta(key) {
    return CONTROL_STAGE_META[key] || Object.freeze({ icon: '•', accent: 'blue' });
  }

  const CONTROL_HEALTH_ICON = Object.freeze({ GREEN: '✓', ORANGE: '▲', RED: '✖', UNKNOWN: '?' });

  function controlHealthIcon(health) {
    return CONTROL_HEALTH_ICON[health] || CONTROL_HEALTH_ICON.UNKNOWN;
  }

  // Jusqu'à 3 causes fournies par le serveur (exceptions[]) ; l'UI n'en calcule aucune.
  function controlCauses(order) {
    const list = Array.isArray(order && order.exceptions) ? order.exceptions : [];
    return list.slice(0, 3).map(cause => ({
      code: cause.code || 'exception',
      summary: cause.summary || cause.code || 'Cause non précisée',
      owner: cause.owner_role || null,
    }));
  }

  const CONTROL_ENVELOPE_LABEL = Object.freeze({
    ORDER: 'Commande',
    PURCHASE_ORDER: 'PO fournisseur',
    HUB_UNIT: 'Unité HUB',
    PARCEL: 'Colis',
  });

  function controlEnvelope(order) {
    const raw = order && order.envelope && typeof order.envelope === 'object' ? order.envelope : {};
    const type = CONTROL_ENVELOPE_LABEL[raw.type] ? raw.type : 'ORDER';
    const refs = Array.isArray(raw.refs) ? raw.refs.filter(Boolean).map(String) : [];
    return Object.freeze({
      type,
      label: CONTROL_ENVELOPE_LABEL[type],
      refs: Object.freeze(refs),
    });
  }

  function controlLineage(order) {
    const raw = order && order.lineage && typeof order.lineage === 'object' ? order.lineage : {};
    const normalize = value => Object.freeze((Array.isArray(value) ? value : []).filter(Boolean).map(String));
    return Object.freeze({
      purchase_orders: normalize(raw.purchase_orders),
      hub_units: normalize(raw.hub_units),
      parcels: normalize(raw.parcels),
    });
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
      meta: controlStageMeta(stage.key),
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
        health: ['GREEN', 'ORANGE', 'RED', 'UNKNOWN'].includes(order.health) ? order.health : 'UNKNOWN',
        causes: controlCauses(order),
        envelope: controlEnvelope(order),
        lineage: controlLineage(order),
        split: order.split === true,
        href: order.order_reference ? contextualHref(`/admin/orders/${encodeURIComponent(order.order_reference)}`, '/admin/operations', 'Retour aux opérations') : null,
      })),
    }));
  }

  // Lecture courte du processus validé. Les valeurs ci-dessous sont uniquement
  // les positions ACTUELLES de commandes déjà projetées par la Control Tower.
  // Elles ne constituent ni des étapes terminées, ni un workflow concurrent.
  const PROCESS_PHASES = Object.freeze([
    Object.freeze({ key: 'ORDER', label: 'Commande', stages: Object.freeze(['ORDER']), anchor: 'ORDER' }),
    Object.freeze({ key: 'PURCHASING', label: 'Achat fournisseur', stages: Object.freeze(['PURCHASING', 'SUPPLIER']), anchor: 'PURCHASING', workspace: 'purchasing' }),
    Object.freeze({ key: 'HUB', label: 'Réception Hub', stages: Object.freeze(['HUB_RECEIVING', 'HUB_CONTROL']), anchor: 'HUB_RECEIVING', workspace: 'operations-workspace' }),
    Object.freeze({ key: 'CUSTOMS', label: 'Transport / Douane', stages: Object.freeze(['FORWARDER', 'TRANSPORT', 'CUSTOMS']), anchor: 'FORWARDER', workspace: 'shipping-customs-workspace' }),
    Object.freeze({ key: 'RELAY', label: 'Relais', stages: Object.freeze(['RELAY']), anchor: 'RELAY', workspace: 'operations-workspace' }),
    // La remise client n'est PAS une étape des neuf positions de ce contrat.
    // Ne jamais lui attribuer artificiellement 0, GREEN ou "terminée".
    Object.freeze({ key: 'HANDOFF', label: 'Remise client', stages: Object.freeze([]) }),
  ]);

  function projectProcessPhases(payload, user, base) {
    const columns = controlChainColumns(payload);
    if (!columns.length) return [];
    const byKey = new Map(columns.map(column => [column.key, column]));
    const visibleDrill = base && typeof base.visibleDrillSchema === 'function'
      ? base.visibleDrillSchema(base.OPERATIONS_SCHEMA, user).drill : [];
    const allowedWorkspaces = new Map((visibleDrill || []).map(item => [item.id, item.href]));
    const role = user && user.role;

    return PROCESS_PHASES.map(phase => {
      if (!phase.stages.length) {
        return { key: phase.key, label: phase.label, helper: 'Non projetée ici · voir Order 360',
          tone: 'neutral', href: undefined, observed: false };
      }
      const available = phase.stages.every(stage => byKey.has(stage));
      const count = available ? phase.stages.reduce((sum, stage) => sum + byKey.get(stage).orders.length, 0) : null;
      const fallback = stageHref(phase.key);
      const ownerHref = phase.workspace === 'purchasing' && role === 'admin'
        ? '/admin/workspaces/purchasing'
        : allowedWorkspaces.get(phase.workspace);
      return {
        key: phase.key, label: phase.label,
        helper: count == null ? 'Position indisponible'
          : `${count} commande${count > 1 ? 's' : ''} positionnée${count > 1 ? 's' : ''}`,
        tone: 'neutral', observed: available,
        href: available ? (ownerHref
          ? contextualHref(ownerHref, '/admin/operations', 'Retour aux opérations')
          : fallback) : undefined,
      };
    });
  }

  function renderProcessPhases(doc, payload, user, base, decisionUi) {
    if (!decisionUi || !decisionUi.FlowStrip) return null;
    const phases = projectProcessPhases(payload, user, base);
    if (!phases.length) return null;
    const wrapper = doc.createElement('div');
    wrapper.className = 'kmc-operations-process-overview';
    wrapper.setAttribute('data-process-source', 'control_chain');
    wrapper.appendChild(text(doc, 'h3', 'kmc-operations-process-title', 'Parcours des commandes'));
    wrapper.appendChild(text(doc, 'p', 'kmc-operations-process-caption',
      'Positions actuelles dans la chaîne canonique · une commande comptée une seule fois · aucune étape présumée terminée.'));
    const host = doc.createElement('div');
    host.className = 'kmc-operations-process-steps';
    decisionUi.FlowStrip.render(host, { stages: phases });
    wrapper.appendChild(host);
    return wrapper;
  }

  function renderControlChain(doc, host, payload) {
    const activeKey = stageFilterKey();
    const activePhase = activeKey ? PROCESS_PHASES.find(phase => phase.key === activeKey) : null;
    const columns = controlChainColumns(payload).filter(column => !activePhase || activePhase.stages.includes(column.key));
    const hasOrders = columns.some(column => column.orders.length > 0);
    const hasAlerts = columns.some(column => column.alerts.length > 0);
    const isEmpty = !hasOrders && !hasAlerts;
    host.className = isEmpty ? 'kmc-control-chain is-empty' : 'kmc-control-chain is-active';
    host.setAttribute('data-chain-state', isEmpty ? 'empty' : 'active');

    columns.forEach(column => {
      const stage = doc.createElement('section');
      stage.className = 'kmc-control-stage';
      stage.setAttribute('data-control-stage', column.key);
      stage.id = `operations-stage-${String(column.key).toLowerCase().replace(/_/g, '-')}`;

      const heading = doc.createElement('div');
      heading.className = 'kmc-control-stage-heading';

      const identity = doc.createElement('div');
      identity.className = 'kmc-control-stage-identity';
      const icon = text(doc, 'span', `kmc-control-stage-icon is-${column.meta.accent}`, column.meta.icon);
      icon.setAttribute('aria-hidden', 'true');
      identity.appendChild(icon);
      identity.appendChild(text(doc, 'span', 'kmc-control-stage-title', column.label));
      heading.appendChild(identity);
      heading.appendChild(text(doc, 'span', 'kmc-control-stage-count', column.orders.length));
      stage.appendChild(heading);

      const list = doc.createElement('div');
      list.className = 'kmc-control-order-list';

      if (!column.orders.length && !isEmpty) {
        list.appendChild(text(doc, 'div', 'kmc-control-order-empty', '—'));
      } else {
        column.orders.forEach(order => {
          const row = doc.createElement('div');
          row.className = 'kmc-control-order-row';

          const item = doc.createElement('button');
          item.type = 'button';
          item.className = `kmc-control-order ${controlHealthClass(order.health)}`;
          item.setAttribute('aria-label', `${order.reference} · ${order.health}`);
          item.setAttribute('aria-expanded', 'false');

          const detailId = `control-detail-${String(column.key).toLowerCase()}-${String(order.reference).replace(/[^a-z0-9_-]+/gi, '-')}`;
          item.setAttribute('aria-controls', detailId);

          const dot = doc.createElement('span');
          dot.className = 'kmc-control-order-dot';
          dot.setAttribute('aria-hidden', 'true');
          item.appendChild(dot);
          item.appendChild(text(doc, 'span', 'kmc-control-order-state', controlHealthIcon(order.health)));
          item.appendChild(text(doc, 'span', 'kmc-control-order-ref', order.reference));

          const disclosure = text(doc, 'span', 'kmc-control-order-disclosure', '›');
          disclosure.setAttribute('aria-hidden', 'true');
          item.appendChild(disclosure);

          const detail = doc.createElement('div');
          detail.id = detailId;
          detail.className = 'kmc-control-order-detail';
          detail.hidden = true;

          const panelHead = doc.createElement('div');
          panelHead.className = 'kmc-control-panel-head';
          panelHead.appendChild(text(doc, 'strong', 'kmc-control-panel-title', order.reference));
          panelHead.appendChild(text(doc, 'span', 'kmc-control-panel-stage', `Étape : ${column.label}`));
          const closeBtn = text(doc, 'button', 'kmc-control-panel-close', '×');
          closeBtn.type = 'button';
          closeBtn.setAttribute('aria-label', 'Fermer le panneau');
          panelHead.appendChild(closeBtn);
          detail.appendChild(panelHead);

          const focus = doc.createElement('div');
          focus.className = 'kmc-control-order-focus';
          focus.appendChild(text(doc, 'span', 'kmc-control-order-detail-label', 'Objet en cause'));
          focus.appendChild(text(
            doc,
            'strong',
            'kmc-control-order-focus-value',
            order.envelope.refs.length
              ? `${order.envelope.label} · ${order.envelope.refs.join(', ')}`
              : order.envelope.label
          ));
          detail.appendChild(focus);

          if (order.causes.length) {
            const causes = doc.createElement('div');
            causes.className = 'kmc-control-order-causes';
            order.causes.forEach(cause => {
              const line = doc.createElement('div');
              line.className = 'kmc-control-order-cause-line';
              line.appendChild(text(doc, 'span', 'kmc-control-order-cause-summary', cause.summary));
              if (cause.owner) line.appendChild(text(doc, 'span', 'kmc-control-order-owner', `Responsable : ${cause.owner}`));
              causes.appendChild(line);
            });
            detail.appendChild(causes);
          }

          const lineageGroups = [
            ['PO', order.lineage.purchase_orders],
            ['HUB', order.lineage.hub_units],
            ['Colis', order.lineage.parcels],
          ].filter(([, refs]) => refs.length);

          if (lineageGroups.length) {
            const lineage = doc.createElement('div');
            lineage.className = 'kmc-control-order-lineage';
            lineageGroups.forEach(([label, refs]) => {
              const group = doc.createElement('div');
              group.className = 'kmc-control-order-lineage-group';
              group.appendChild(text(doc, 'span', 'kmc-control-order-detail-label', label));
              group.appendChild(text(doc, 'span', 'kmc-control-order-lineage-value', refs.join(', ')));
              lineage.appendChild(group);
            });
            detail.appendChild(lineage);
          }

          if (order.href) {
            const link = text(doc, 'a', 'kmc-control-order-open', 'Ouvrir Order 360 →');
            link.setAttribute('href', order.href);
            detail.appendChild(link);
          }

          const setOpen = open => {
            if (open) {
              host.querySelectorAll('.kmc-control-order-row.is-expanded').forEach(other => {
                if (other === row) return;
                other.classList.remove('is-expanded');
                const d = other.querySelector('.kmc-control-order-detail');
                const b = other.querySelector('.kmc-control-order');
                if (d) d.hidden = true;
                if (b) b.setAttribute('aria-expanded', 'false');
              });
            }
            item.setAttribute('aria-expanded', open ? 'true' : 'false');
            detail.hidden = !open;
            row.classList.toggle('is-expanded', open);
          };
          item.addEventListener('click', () => setOpen(item.getAttribute('aria-expanded') !== 'true'));
          closeBtn.addEventListener('click', () => { setOpen(false); item.focus(); });

          row.appendChild(item);
          row.appendChild(detail);
          list.appendChild(row);
        });
      }

      stage.appendChild(list);
      host.appendChild(stage);
    });
  }


  function controlHealthSummary(payload) {
    const summary = { GREEN: 0, ORANGE: 0, RED: 0, UNKNOWN: 0 };
    controlChainColumns(payload).forEach(column => {
      column.orders.forEach(order => {
        const health = Object.prototype.hasOwnProperty.call(summary, order.health) ? order.health : 'UNKNOWN';
        summary[health] += 1;
      });
    });
    return Object.freeze(summary);
  }

  function renderControlHealthSummary(doc, payload) {
    const summary = controlHealthSummary(payload);
    const host = doc.createElement('div');
    host.className = 'kmc-control-health-summary kmc-dashboard-attention-band';
    host.setAttribute('data-dashboard-role', 'attention');

    [
      ['GREEN', 'positive', 'Normal'],
      ['ORANGE', 'warning', 'À risque'],
      ['RED', 'critical', 'Bloqué'],
      ['UNKNOWN', 'unknown', 'Non observé'],
    ].forEach(([health, tone, label]) => {
      const item = doc.createElement('div');
      item.className = `kmc-control-health-summary-item is-${tone}`;
      const dot = doc.createElement('span');
      dot.className = 'kmc-control-health-summary-dot';
      dot.setAttribute('aria-hidden', 'true');
      item.appendChild(dot);
      item.appendChild(text(doc, 'strong', 'kmc-control-health-summary-value', summary[health]));
      item.appendChild(text(doc, 'span', 'kmc-control-health-summary-label', label));
      host.appendChild(item);
    });

    return host;
  }

  function renderControlLegend(doc) {
    const legend = doc.createElement('div');
    legend.className = 'kmc-control-chain-legend';
    [
      ['positive', 'Normal'],
      ['warning', 'À risque'],
      ['critical', 'Bloqué'],
      ['unknown', 'Non observé'],
    ].forEach(([tone, label]) => {
      const item = doc.createElement('span');
      item.className = `kmc-control-chain-legend-item is-${tone}`;
      const dot = doc.createElement('span');
      dot.className = 'kmc-control-chain-legend-dot';
      dot.setAttribute('aria-hidden', 'true');
      item.appendChild(dot);
      item.appendChild(text(doc, 'span', '', label));
      legend.appendChild(item);
    });
    return legend;
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
        href: '/admin/action-center?severity=critical',
        actionLabel: 'Traiter →',
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
        href: '/admin/action-center?severity=warning',
        actionLabel: 'Traiter →',
      });
    }
    if (delays && Number(delays.value) > 0) {
      items.push({
        key: 'critical-delays',
        label: 'Retards critiques',
        helper: `Colis expédiés depuis plus de ${(payload && payload.thresholds && payload.thresholds.shipped_late_days) || 14} jours, pas encore au relais`,
        value: displayMetric(base, delays),
        tone: 'critical',
        icon: '⌛',
        href: '#operations-control-chain',
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
        href: '#operations-control-chain',
        actionLabel: 'Voir les paiements →',
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

  // Filtre de phase (?stage=ORDER|PURCHASING|HUB|CUSTOMS|RELAY) : lit/écrit l'URL, ne recalcule rien.
  function stageFilterKey() {
    try {
      const key = new URLSearchParams(globalThis.location.search).get('stage');
      return PROCESS_PHASES.some(phase => phase.key === key && phase.stages.length) ? key : null;
    } catch (_error) { return null; }
  }

  function stageHref(key) {
    try {
      const loc = globalThis.location;
      const params = new URLSearchParams(loc.search);
      if (key) params.set('stage', key); else params.delete('stage');
      const query = params.toString();
      return `${loc.pathname}${query ? `?${query}` : ''}`;
    } catch (_error) { return key ? `?stage=${encodeURIComponent(key)}` : '?'; }
  }

  function contextualHref(path, returnTo, label) {
    const nav = globalThis.KomerceCanonicalNavigation;
    if (!nav || typeof nav.withReturnTo !== 'function') return path;
    // Retour = page courante avec sa query (marché, période, filtres) ; chemin fourni en repli seulement.
    const target = typeof nav.currentReturnTarget === 'function' ? nav.currentReturnTarget(returnTo) : returnTo;
    return nav.withReturnTo(path, target, label);
  }

  // Files d'action commandes (ex-écran « Suivi des commandes ») — ordre serveur conservé.
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
    dashboard.setAttribute('data-dashboard-hierarchy', 'hero-attention-primary-secondary');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.setAttribute('data-dashboard-role', 'hero');
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'OPÉRATIONS'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Où en sont les commandes ?'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Une commande, une position opérationnelle, une cause actionnable.'));
    dashboard.appendChild(header);

    const controlColumns = controlChainColumns(payload);
    if (controlColumns.length) {
      dashboard.appendChild(renderControlHealthSummary(doc, payload));
    }

    if (controlColumns.length) {
      const chain = cardSection(
        doc,
        'Chaîne logistique client → relais',
        'Une commande reste une seule ligne de pilotage sous son étape gouvernante. Vert : normal · orange : à risque · rouge : action requise.',
        'operations-control-chain'
      );
      chain.section.className += ' kmc-control-chain-card';
      chain.section.setAttribute('data-dashboard-role', 'primary');
      const process = renderProcessPhases(doc, payload, options.user, base, decisionUi);
      if (process) chain.section.insertBefore(process, chain.body);
      chain.section.insertBefore(renderControlLegend(doc), chain.body);
      const activeKey = stageFilterKey();
      if (activeKey) {
        const phase = PROCESS_PHASES.find(item => item.key === activeKey);
        const chip = doc.createElement('p');
        chip.className = 'kmc-operations-stage-filter';
        chip.setAttribute('data-stage-filter', activeKey);
        chip.appendChild(doc.createTextNode(`Filtre : ${phase.label} · `));
        const clear = doc.createElement('a');
        clear.href = stageHref(null);
        clear.textContent = 'Voir toutes les étapes';
        chip.appendChild(clear);
        chain.section.insertBefore(chip, chain.body);
      }
      renderControlChain(doc, chain.body, payload);
      if (chain.body.getAttribute('data-chain-state') === 'empty') {
        chain.section.setAttribute('data-chain-state', 'empty');
        chain.section.appendChild(text(doc, 'p', 'kmc-control-chain-empty-notice', 'Aucune commande dans la chaîne pour le périmètre sélectionné.'));
      }
      dashboard.appendChild(chain.section);
    }

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
      CONTROL_STAGE_META,
      controlStageMeta,
      projectDecisionItems: payload => decisionItems(payload, base),
      projectControlChainColumns: controlChainColumns,
      projectProcessPhases: payload => projectProcessPhases(payload, null, base),
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
    stageFilterKey,
    stageHref,
    CONTROL_STAGE_META,
    CONTROL_ENVELOPE_LABEL,
    controlStageMeta,
    controlEnvelope,
    controlLineage,
    kpi,
    displayMetric,
    severity,
    decisionItems,
    controlHealthClass,
    controlChainColumns,
    PROCESS_PHASES,
    projectProcessPhases,
    renderProcessPhases,
    controlHealthSummary,
    renderControlHealthSummary,
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
