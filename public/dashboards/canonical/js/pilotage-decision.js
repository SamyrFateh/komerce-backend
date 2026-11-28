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

    if (critical && critical.data_quality?.status !== 'SIMULATION_UNAVAILABLE') items.push({
      key: 'critical-open', label: 'Critiques ouvertes', helper: 'Nécessitent une action immédiate',
      value: display(base, critical), tone: critical.value == null ? 'neutral' : Number(critical.value) > 0 ? 'critical' : 'positive', icon: '!',
      href: withReturn(critical.drill_to || '#pilotage-alerts'), actionLabel: 'Voir les critiques →',
    });
    if (attention && Number(attention.value) > 0) items.push({
      key: 'attention-open', label: 'Points d’attention', helper: 'À surveiller de près',
      value: display(base, attention), tone: 'warning', icon: '•',
      href: withReturn(attention.drill_to || '#pilotage-alerts'), actionLabel: 'Voir les signaux →',
    });
    if (incomplete) items.push({
      key: 'costing-incomplete', label: 'Problèmes costing', helper: incomplete.label || 'Coûts incomplets',
      value: display(base, incomplete), tone: incomplete.value == null ? 'neutral' : Number(incomplete.value) > 0 ? 'violet' : 'positive', icon: '◇',
      href: withReturn('/admin/operations'), actionLabel: 'Examiner les commandes →',
    });
    if (activeOrders && !payload.decision_clocks) items.push({
      key: 'active-orders', label: 'Commandes actives', helper: 'En cours dans la chaîne',
      value: display(base, activeOrders), tone: 'info', icon: '▣',
      href: withReturn('/admin/operations'), actionLabel: 'Voir le flux →',
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
      href: withReturn(typeof base.canonicalAdminHref === 'function' ? base.canonicalAdminHref(block.url) : block.url),
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
    return nav && typeof nav.withNavContext === 'function'
      ? nav.withNavContext(href, 'Retour au pilotage')
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
        Number.isSafeInteger(stage.order_count) && stage.order_count >= 0 ? `${stage.order_count} commande(s)` : 'Position non déterminée',
        Number(counts.RED) > 0 ? `${counts.RED} bloquée(s)` : null,
        Number(counts.ORANGE) > 0 ? `${counts.ORANGE} à surveiller` : null,
        Number(counts.UNKNOWN) > 0 ? `${counts.UNKNOWN} non observée(s)` : null,
      ].filter(Boolean).join(' · ');
      return {
        label: humanLabel('stages', stage.key, stage.label || 'Étape'),
        helper,
        tone: stage.health === 'RED' ? 'critical' : (stage.health === 'ORANGE' ? 'warning' : (stage.health === 'GREEN' ? 'positive' : 'neutral')),
        href: withReturn('/admin/operations#operations-control-chain'),
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

  function clockItems(payload, base) {
    const clocks=payload?.decision_clocks;
    if (!clocks) return [];
    const stock=metric(payload,'cmds_actives');
    const flow=metric(payload,'ca_encaisse');
    const eco=metric(payload,'economic_period_result');
    const states={CLOSED:'Clôturé',PROVISIONAL:'Provisoire',REOPENED:'Réouvert — à rapprocher',NOT_RECONCILED:'Non rapproché',MARKET_RESULT_NOT_RECONCILED:'Marché non rapproché',SIMULATION_EXCLUDED:'Hors simulation',UNAVAILABLE:'Indisponible'};
    const dates=clocks.flow||{};
    const bounds=dates.from||dates.to
      ? (dates.period ? dates.period+' jours civils · '+dates.timezone+' · ' : '')+'Création : '+(dates.from||'sans borne de début')+' → '+(dates.to||'sans borne de fin')
      : 'Historique sans filtre de date de création';
    const stamp=clocks.stock?.observed_at;
    const canonicalSales=clocks.flow?.metric_id==='commerce.paid_sales_wallet_included'
      && flow?.data_quality?.metric_id==='commerce.paid_sales_wallet_included';
    return [
      {key:'stock',label:'Stock opérationnel · instantané',value:display(base,stock),tone:'neutral',
        helper:'Commandes actives toutes dates de création'+(stamp?' · lecture '+stamp:'')},
      {key:'flow',label:canonicalSales?'Ventes payées · avoir inclus':'Flux commercial · hors avoir',
        value:display(base,flow),tone:canonicalSales&&flow.value==null?'warning':'neutral',
        helper:bounds+(canonicalSales?' · hors annulées/remboursées · pas un encaissement de caisse'+(flow.data_quality.warning?' · '+flow.data_quality.warning:'')
          :' · commandes payées, hors wallet · ni ventes totales ni encaissements')},
      {key:'economic',label:'Résultat ECO · mois UTC',value:display(base,eco),tone:eco?.data_quality?.status==='CLOSED'?'neutral':'warning',
        helper:(clocks.economic?.period_start?.slice(0,7)||'Mois non déterminé')+' UTC · '+(states[eco?.data_quality?.status]||'Non certifié')},
    ];
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
    const economic=metric(payload,'economic_period_result');
    if(economic && !payload.decision_clocks){
      const quality=economic.data_quality||{};
      const states={CLOSED:'Clôturé',PROVISIONAL:'Provisoire',REOPENED:'Réouvert — à rapprocher',NOT_RECONCILED:'Non rapproché',MARKET_RESULT_NOT_RECONCILED:'Résultat marché non rapproché',SIMULATION_EXCLUDED:'Hors simulation',UNAVAILABLE:'Indisponible'};
      const note=states[quality.status]||'Non certifié';
      header.appendChild(text(doc,'p','kmc-dashboard-description',economic.label+' : '+display(base,economic)+' · '+note+(quality.fx_status==='GOVERNED_FIXED_PARITY_PROJECTION'?' · projection EUR du résultat KMF':quality.fx_status==='GOVERNED_KMF_PROJECTION'?' · projection en devise marché du résultat KMF':'')));
    }

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      host.className = 'kmc-cockpit-decisions kmc-dashboard-attention-band';
      host.setAttribute('data-dashboard-role', 'attention');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const clocks=clockItems(payload,base);
    if (clocks.length) {
      const reading=cardSection(doc,'Trois horloges, trois lectures','Le stock actuel ne dépend pas de la période de création ; le résultat ECO suit son propre mois UTC.','pilotage-clocks');
      reading.section.setAttribute('data-dashboard-role','secondary');
      if (payload.decision_clocks.stock?.simulation_scope) {
        reading.body.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy',
          'Recette '+payload.decision_clocks.stock.simulation_scope+' · faits simulés, hors activité réelle.'));
        if (payload.control_chain == null && payload.system_alerts == null) reading.body.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy',
          'Chaîne opérationnelle et signaux non certifiés pour cette recette.'));
      }
      if (payload.decision_clocks.flow?.period && decisionUi.PeriodControl) {
        reading.body.appendChild(decisionUi.PeriodControl.create(doc,{period:payload.decision_clocks.flow.period,
          label:'Période des ventes payées',ariaLabel:'Période Pilotage',onChange:options.onPeriodChange}));
      }
      const strip=doc.createElement('div');
      strip.className='kmc-pilotage-clock-strip';
      strip.setAttribute('data-pilotage-clocks','');
      ui.MetricStrip.render(strip,{items:clocks});
      reading.body.appendChild(strip);
      dashboard.appendChild(reading.section);
    }

    const stages = controlStages(payload);
    if (stages.length) {
      const flowSection = cardSection(
        doc,
        'Où ça bloque',
        payload.control_chain?.counts_exhaustive ? 'Les étapes à surveiller ou bloquées : compteurs exhaustifs, détail dans Opérations.' : 'Les étapes à surveiller ou bloquées dans la chaîne. Les états portent uniquement sur la projection chargée.',
        'pilotage-flow-health'
      );
      flowSection.section.className += ' is-control-tower-flow';
      flowSection.section.setAttribute('data-dashboard-role', 'primary');
      // FlowStrip owns and clears its render target. Keep the coverage label
      // outside that target so a render cannot erase the qualification.
      const population=payload.control_chain?.population;
      const coverage = population && Number.isSafeInteger(population.shown) && Number.isSafeInteger(population.total)
          && population.shown>=0 && population.total>=population.shown
          && population.complete===(population.total===population.shown)
        ? population.shown+' sur '+population.total+' commandes actives · '+(population.complete?'projection exhaustive':'projection partielle')
        : payload.decision_clocks ? 'Total de la projection non déterminé.' : null;
      if (coverage !== null) {
        flowSection.section.insertBefore(text(doc,'p','kmc-decision-dashboard-section-copy',coverage),flowSection.body);
      }
      decisionUi.FlowStrip.render(flowSection.body, { stages });
      dashboard.appendChild(flowSection.section);
    }

    // Chaîne de valeur : étapes économiques servies par le serveur (economic_flow), sans valeur recalculée.
    const valueStages = flowStages(payload, base);
    if (valueStages.length) {
      const value = cardSection(doc, 'Chaîne de valeur Komerce', 'De l’estimation du prix au recalibrage : où ouvrir le détail.', 'pilotage-value-chain');
      value.section.setAttribute('data-dashboard-role', 'secondary');
      decisionUi.FlowStrip.render(value.body, { stages: valueStages });
      dashboard.appendChild(value.section);
    }

    // Alertes & arbitrages : causes structurelles de la chaîne d'abord, puis signaux résiduels
    // (residualActions exclut déjà les alertes structurelles : aucun doublon).
    const arbitrations = [...structuralCauses(payload), ...residualActions(payload, base)].slice(0, 5);
    if (arbitrations.length) {
      const alerts = cardSection(doc, 'Alertes & arbitrages', 'Ce qui demande une décision, avec l’endroit où agir.', 'pilotage-alerts');
      alerts.section.setAttribute('data-dashboard-role', 'secondary');
      decisionUi.PriorityList.render(alerts.body, { items: arbitrations });
      dashboard.appendChild(alerts.section);
    }

    // Supervision des marchés : lecture serveur (markets_supervision) ; absence = « Non disponible », jamais 0.
    const supervision = Array.isArray(payload && payload.markets_supervision) ? payload.markets_supervision : null;
    const market = cardSection(doc, 'Supervision des marchés', payload.decision_clocks ? 'Marchés actifs · stock instantané sans filtre de date de création ; distinct des signaux du siège.' : 'Marchés actifs · périmètre et période du Pilotage ; 0 = aucune commande ou incident sur la période.', 'pilotage-markets');
    market.section.setAttribute('data-dashboard-role', 'secondary');
    if (supervision && supervision.length) {
      decisionUi.DenseTable.render(market.body, {
        columns: [{ key: 'market', label: 'Marché' }, { key: 'active', label: 'Commandes actives', numeric: true },
          { key: 'cash', label: 'Cash à confirmer', numeric: true }, { key: 'incidents', label: 'Incidents ouverts', numeric: true }],
        rows: supervision.map(r => ({
          market: `${r.market_code} · ${r.market_name || ''}`.trim(),
          active: r.orders_active, cash: r.cash_to_confirm, incidents: r.open_incidents,
        })),
      });
    } else {
      market.body.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy',
        supervision ? 'Aucun marché actif à superviser.' : 'Non disponible'));
    }
    dashboard.appendChild(market.section);

    // Accès contextualisés : view_blocks serveur, liens avec retour au pilotage.
    const access = summaryCards(payload, base);
    if (access.length) {
      const links = cardSection(doc, 'Accès aux dashboards', 'Analyse détaillée par domaine.', 'pilotage-access');
      links.section.setAttribute('data-dashboard-role', 'secondary');
      decisionUi.SummaryCards.render(links.body, { items: access });
      dashboard.appendChild(links.section);
    }

    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'control-tower-v2' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('pilotage_decision_base_missing');
    const baseMount = base.mount;
    const enhanced = {
      ...base,
      mount(options) {
        const search=options.location?.search ?? globalThis.location?.search ?? '';
        const period=options.period ?? new URLSearchParams(search).get('period') ?? '30';
        const onPeriodChange=nextPeriod=>enhanced.mount({...options,period:nextPeriod});
        return baseMount({...options,period,onPayload:payload=>render(options.root,payload,{...options,onPeriodChange},base,decisionUi)})
          .then(result=>result?.stale||!result?.payload ? result : {...result,decisionFirst:true});
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectSummaryCards: payload => summaryCards(payload, base),
      projectFlowStages: payload => flowStages(payload, base),
      projectStructuralCauses: structuralCauses,
      projectControlStages: controlStages,
      projectResidualActions: payload => residualActions(payload, base),
      projectPrinciples: principles,
      projectTrust: trust,
    };
    return Object.freeze(enhanced);
  }

  return Object.freeze({ HUMAN_LABELS, humanLabel, metric, incompleteCost, decisionItems, clockItems, summaryCards, flowStages, structuralCauses, controlStages, residualActions, principles, trust, render, enhance });
});
