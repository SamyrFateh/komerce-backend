/**
 * @komerce-arch
 * @role          canonical-pilotage-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_pilotage_payload, decision_primitives
 * @outputs       decision_first_pilotage_dom
 * @depends       pilotage, primitives, decision-primitives
 * @used-by       canonical admin Pilotage runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, pilotage
 * @version       2026-09
 */
'use strict';

(function initPilotageDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalPilotage && root.KomerceDecisionUI) {
    root.KomerceCanonicalPilotage = api.enhance(root.KomerceCanonicalPilotage, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPilotageDecision() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function metric(payload, key) {
    return (Array.isArray(payload && payload.kpis_global) ? payload.kpis_global : [])
      .find(item => item && item.key === key) || null;
  }

  function incompleteCost(payload) {
    const blocks = Array.isArray(payload && payload.view_blocks) ? payload.view_blocks : [];
    for (const block of blocks) {
      const found = (Array.isArray(block && block.kpis_summary) ? block.kpis_summary : []).find(item => {
        const key = String(item && item.key || '').toLowerCase();
        const label = String(item && item.label || '').toLowerCase();
        return key.includes('incomplet') || label.includes('incomplet');
      });
      if (found) return found;
    }
    return null;
  }

  function display(base, item) {
    if (!item) return '—';
    return typeof base.formatMetricValue === 'function' ? base.formatMetricValue(item) : String(item.value ?? '—');
  }

  const HUMAN_LABELS = Object.freeze({
    stages: Object.freeze({
      ORDER: 'Commande',
      PURCHASING: 'Achats fournisseurs',
      SUPPLIER: 'Fournisseur',
      HUB_RECEIVING: 'Réception HUB',
      HUB_CONTROL: 'Contrôle HUB',
      FORWARDER: 'Transitaire',
      TRANSPORT: 'Transport',
      CUSTOMS: 'Douane',
      RELAY: 'Relais',
    }),
    owners: Object.freeze({
      purchasing: 'Achats fournisseurs',
      sourcing: 'Sourcing',
      finance: 'Finance',
      hub: 'Hub',
      transitaire: 'Transitaire',
      logistics: 'Logistique',
      customs: 'Douane',
      relais: 'Relais',
      operations: 'Opérations',
      quality: 'Qualité',
    }),
    sources: Object.freeze({
      'signal-service': 'Signal métier',
      purchasing: 'Achats fournisseurs',
      finance: 'Finance',
      hub: 'Hub',
      logistics: 'Logistique',
      customs: 'Douane',
      relais: 'Relais',
      operations: 'Opérations',
    }),
  });

  function humanLabel(group, value, fallback) {
    const key = String(value || '').trim();
    return HUMAN_LABELS[group] && HUMAN_LABELS[group][key] ? HUMAN_LABELS[group][key] : (fallback || key || '—');
  }

  function decisionItems(payload, base) {
    const items = [];
    const critical = metric(payload, 'alertes_critiques');
    const attention = metric(payload, 'points_attention');
    const activeOrders = metric(payload, 'cmds_actives');
    const incomplete = incompleteCost(payload);

    if (critical) items.push({
      key: 'critical-open', label: 'Critiques ouvertes', helper: 'Nécessitent une action immédiate',
      value: display(base, critical), tone: Number(critical.value) > 0 ? 'critical' : 'positive', icon: '!',
      href: critical.drill_to || '#pilotage-alerts', actionLabel: 'Voir les critiques →',
    });
    if (attention && Number(attention.value) > 0) items.push({
      key: 'attention-open', label: 'Points d’attention', helper: 'À surveiller de près',
      value: display(base, attention), tone: 'warning', icon: '•',
      href: attention.drill_to || '#pilotage-alerts', actionLabel: 'Voir les signaux →',
    });
    if (incomplete) items.push({
      key: 'costing-incomplete', label: 'Problèmes costing', helper: incomplete.label || 'Coûts incomplets',
      value: display(base, incomplete), tone: Number(incomplete.value) > 0 ? 'violet' : 'positive', icon: '◇',
      href: '/admin/finance#finance-incomplete-costs', actionLabel: 'Voir les coûts →',
    });
    if (activeOrders) items.push({
      key: 'active-orders', label: 'Commandes actives', helper: 'En cours dans la chaîne',
      value: display(base, activeOrders), tone: 'info', icon: '▣',
      href: '/admin/operations', actionLabel: 'Voir le flux →',
    });
    return items.slice(0, 4);
  }

  function summaryCards(payload, base) {
    return (Array.isArray(payload && payload.view_blocks) ? payload.view_blocks : [])
      .filter(block => block && block.view !== 'control_tower')
      .map((block, index) => ({
      key: block.view || `view-${index + 1}`,
      title: block.title || 'Vue de décision',
      subtitle: block.subtitle || undefined,
      tone: ['info', 'positive', 'violet'][index % 3],
      href: typeof base.canonicalAdminHref === 'function' ? base.canonicalAdminHref(block.url) : block.url,
      metrics: (Array.isArray(block.kpis_summary) ? block.kpis_summary : []).slice(0, 4).map(item => ({
        label: item.label || 'Indicateur', value: display(base, item),
      })),
      }));
  }

  function flowStages(payload, base) {
    const stages = payload && payload.economic_flow && Array.isArray(payload.economic_flow.stages)
      ? payload.economic_flow.stages : [];
    return stages.map(stage => ({
      label: stage.label || 'Étape',
      helper: stage.key && base.FLOW_DESTINATIONS ? base.FLOW_DESTINATIONS[stage.key] : undefined,
    }));
  }

  function withReturn(href) {
    const nav = globalThis.KomerceCanonicalNavigation;
    return nav && typeof nav.withEntityReturnTo === 'function'
      ? nav.withEntityReturnTo(href, '/admin/pilotage', 'Retour au pilotage')
      : href;
  }

  function structuralCauses(payload) {
    const chain = payload && payload.control_chain && typeof payload.control_chain === 'object' ? payload.control_chain : {};
    return (Array.isArray(chain.structural_alerts) ? chain.structural_alerts : []).slice(0, 5).map(row => ({
      title: row.summary || row.reason_code || 'Cause structurelle',
      helper: [
        humanLabel('stages', row.stage, 'Étape inconnue'),
        row.owner_role ? `Responsable : ${humanLabel('owners', row.owner_role)}` : null,
      ].filter(Boolean).join(' · '),
      priority: `${Number(row.order_count) || 0} cmd`,
      tone: row.health === 'RED' ? 'critical' : (row.health === 'ORANGE' ? 'warning' : 'info'),
      href: withReturn(row.href || '/admin/operations#operations-control-chain'),
      actionLabel: 'Voir la chaîne →',
    }));
  }

  function controlStages(payload) {
    const chain = payload && payload.control_chain && typeof payload.control_chain === 'object' ? payload.control_chain : {};
    return (Array.isArray(chain.stages) ? chain.stages : []).map(stage => {
      const counts = stage && stage.health_counts && typeof stage.health_counts === 'object' ? stage.health_counts : {};
      const helper = [
        `${Number(stage.order_count) || 0} commande(s)`,
        Number(counts.RED) > 0 ? `${counts.RED} bloquée(s)` : null,
        Number(counts.ORANGE) > 0 ? `${counts.ORANGE} à surveiller` : null,
        Number(counts.UNKNOWN) > 0 ? `${counts.UNKNOWN} non observée(s)` : null,
      ].filter(Boolean).join(' · ');
      return {
        label: humanLabel('stages', stage.key, stage.label || 'Étape'),
        helper,
        tone: stage.health === 'RED' ? 'critical' : (stage.health === 'ORANGE' ? 'warning' : (stage.health === 'GREEN' ? 'positive' : 'neutral')),
        href: '/admin/operations#operations-control-chain',
      };
    });
  }

  function residualActions(payload, base) {
    const alerts = Array.isArray(payload && payload.system_alerts) ? payload.system_alerts : [];
    return alerts.filter(row => !row.structural).slice(0, 5).map(row => {
      const projected = typeof base.projectAlerts === 'function'
        ? (base.projectAlerts({ system_alerts: [row] })[0] || {})
        : {};
      return {
        title: row.title || row.message || projected.title || 'Signal à traiter',
        helper: [humanLabel('sources', row.source, 'Signal métier'), projected.message && projected.message !== row.message ? projected.message : null].filter(Boolean).join(' · '),
        priority: projected.level === 'critical' ? 'Critique' : (projected.level === 'warning' ? 'Attention' : 'Info'),
        tone: projected.level === 'critical' ? 'critical' : (projected.level === 'warning' ? 'warning' : 'info'),
        href: withReturn(projected.href || '/admin/action-center'),
        actionLabel: projected.href ? (projected.actionLabel || 'Ouvrir →') : 'Action Center →',
      };
    });
  }

  function principles(payload) {
    return (Array.isArray(payload && payload.principles) ? payload.principles : []).map((value, index) => ({
      index: index + 1, title: String(value),
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
      stateLabel: quality.scope_enforced === false ? 'Scope à vérifier' : 'Données à jour',
      scopeLabel: scope && scope.mode === 'market' && scope.market ? `${scope.market.code} · ${scope.market.name || ''}`.trim() : 'Vue globale',
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
      globalThis.KomerceCanonicalCockpitPattern.decorateDashboard(dashboard, 'pilotage');
    }
    dashboard.setAttribute('data-dashboard-id', 'pilotage');
    dashboard.setAttribute('data-dashboard-visual', 'control-tower-v2');
    dashboard.setAttribute('data-dashboard-hierarchy', 'hero-attention-primary-secondary');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.setAttribute('data-dashboard-role', 'hero');
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'PILOTAGE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', payload && payload.scope && payload.scope.mode === 'market' ? 'Situation du marché' : 'Situation Komerce'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Voir ce qui demande une décision maintenant, puis agir au bon endroit.'));
    dashboard.appendChild(header);

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      host.className = 'kmc-cockpit-decisions kmc-dashboard-attention-band';
      host.setAttribute('data-dashboard-role', 'attention');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const stages = controlStages(payload);
    if (stages.length) {
      const flowSection = cardSection(
        doc,
        'Où ça bloque',
        'Les étapes à surveiller ou bloquées dans la chaîne.',
        'pilotage-flow-health'
      );
      flowSection.section.className += ' is-control-tower-flow';
      flowSection.section.setAttribute('data-dashboard-role', 'primary');
      decisionUi.FlowStrip.render(flowSection.body, { stages });
      dashboard.appendChild(flowSection.section);
    }

    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'control-tower-v2' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('pilotage_decision_base_missing');
    const baseMount = base.mount;
    return Object.freeze({
      ...base,
      mount(options) {
        return baseMount(options).then(result => ({ ...result, result: render(options.root, result.payload, options, base, decisionUi), decisionFirst: true }));
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectSummaryCards: payload => summaryCards(payload, base),
      projectFlowStages: payload => flowStages(payload, base),
      projectStructuralCauses: structuralCauses,
      projectControlStages: controlStages,
      projectResidualActions: payload => residualActions(payload, base),
      projectPrinciples: principles,
      projectTrust: trust,
    });
  }

  return Object.freeze({ HUMAN_LABELS, humanLabel, metric, incompleteCost, decisionItems, summaryCards, flowStages, structuralCauses, controlStages, residualActions, principles, trust, render, enhance });
});
