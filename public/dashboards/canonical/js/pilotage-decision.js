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

  function decisionItems(payload, base) {
    const items = [];
    const critical = metric(payload, 'alertes_critiques');
    const attention = metric(payload, 'points_attention');
    const incomplete = incompleteCost(payload);
    const qualityWarnings = payload && payload.data_quality && Array.isArray(payload.data_quality.warnings)
      ? payload.data_quality.warnings.length : 0;

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
      value: display(base, incomplete), tone: Number(incomplete.value) > 0 ? 'violet' : 'positive', icon: '¤',
    });
    if (qualityWarnings) items.push({
      key: 'data-quality', label: 'Qualité des données', helper: 'Warnings pouvant affecter la décision',
      value: qualityWarnings, tone: 'warning', icon: 'i',
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
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'PILOTER · TOUR DE CONTRÔLE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', payload && payload.scope && payload.scope.mode === 'market' ? 'Tour de contrôle du marché' : 'Tour de contrôle Komerce'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Voir ce qui mérite une attention, comprendre où descendre et ouvrir le bon espace d’action.'));
    dashboard.appendChild(header);

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      host.className = 'kmc-cockpit-decisions';
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const alerts = base.projectAlerts(payload);
    const investigation = cardSection(
      doc,
      'À investiguer maintenant',
      'Les signaux transverses remontés par les autorités métier. Aucun recalcul local.',
      'pilotage-alerts'
    );
    const alertHost = doc.createElement('div');
    ui.AlertPanel.render(alertHost, {
      title: 'Signaux prioritaires',
      items: alerts,
      emptyText: 'Aucun signal prioritaire.',
    });
    investigation.body.appendChild(alertHost);

    const actionLink = text(doc, 'a', 'kmc-decision-dashboard-link', 'Voir tout dans l’Action Center →');
    actionLink.href = '/admin/action-center';
    investigation.body.appendChild(actionLink);
    dashboard.appendChild(investigation.section);

    const cards = summaryCards(payload, base);
    if (cards.length) {
      const views = cardSection(
        doc,
        'Flux métier',
        'Descendre vers le dashboard spécialisé sans dupliquer sa vérité.',
        'pilotage-flows'
      );
      decisionUi.SummaryCards.render(views.body, { items: cards });
      dashboard.appendChild(views.section);
    }

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, trust(payload));
    dashboard.appendChild(footer);
    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'decision-first-v1' };
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
      projectPrinciples: principles,
      projectTrust: trust,
    });
  }

  return Object.freeze({ metric, incompleteCost, decisionItems, summaryCards, flowStages, principles, trust, render, enhance });
});
