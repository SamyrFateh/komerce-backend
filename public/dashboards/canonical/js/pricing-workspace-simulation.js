/**
 * @komerce-arch
 * @role          canonical-pricing-impact-simulation-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        pricing_workspace_projection, editable_cost_line_values, selected_product_ref
 * @outputs       live_before_after_pricing_impact, observed_cost_truth_projection
 * @depends       public/dashboards/canonical/js/pricing-workspace.js, public/dashboards/canonical/js/pricing-workspace-presentation.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_computes_pricing, simulation_never_persists, same_engine_before_after, observed_real_never_auto_applies
 * @impact-areas  admin-dashboard, pricing, economic-engine
 * @version       2026-09
 */

'use strict';

(function initPricingImpactSimulation(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingImpactSimulation = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingImpactSimulation() {
  const METRICS = Object.freeze([
    ['n1_landed_relay_cost_kmf', 'N1 · rendu relais', 'kmf'],
    ['n2_business_variable_cost_kmf', 'N2 · variable business', 'kmf'],
    ['n3_fixed_overhead_allocation_kmf', 'N3 · structure', 'kmf'],
    ['variable_cost_complete_kmf', 'Coût variable', 'kmf'],
    ['cdr_complete_kmf', 'CDR complet', 'kmf'],
    ['contribution_kmf', 'Contribution', 'kmf'],
    ['minimum_safe_price_kmf', 'Plancher', 'kmf'],
    ['recommended_price_kmf', 'Prix conseillé', 'kmf'],
  ]);

  const UNIT_LABELS = Object.freeze({
    kmf: 'KMF',
    pct: '%',
    kmf_per_kg: 'KMF / kg',
    kmf_per_m3: 'KMF / m³',
    kmf_per_order: 'KMF / commande',
    kmf_per_parcel: 'KMF / colis',
    kmf_per_shipment: 'KMF / expédition',
    aed: 'AED',
    eur: 'EUR',
    usd: 'USD',
  });

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function formatNumber(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
  }

  function formatMetric(value, unit) {
    if (value == null) return '—';
    if (unit === 'kmf') return `${formatNumber(value)} KMF`;
    return formatNumber(value, 2);
  }

  function formatDelta(value, unit) {
    if (value == null) return '—';
    const n = Number(value);
    const sign = n > 0 ? '+' : '';
    return `${sign}${formatMetric(n, unit)}`;
  }

  function formatObservedValue(value, unit) {
    if (value == null) return '—';
    return `${formatNumber(value, 2)} ${UNIT_LABELS[unit] || unit || ''}`.trim();
  }

  function formatSignedPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n > 0 ? '+' : ''}${formatNumber(n, 1)} %`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
  }

  function endpoint(workspace, requestedMarket) {
    return `${workspace.endpointFor({ requestedMarket: requestedMarket || null })}/simulate-impact`;
  }

  function findWorkshop(rootNode) {
    return rootNode.querySelector('[data-pricing-workshop-enhanced]') || Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {
      const title = section.querySelector('.kmc-section-title');
      return title && title.textContent.trim() === 'Atelier des coûts';
    }) || null;
  }

  function activeInputs(rootNode) {
    return Array.from(rootNode.querySelectorAll('[data-cost-value]')).filter(input => {
      const card = input.closest('[data-cost-component]');
      return !card || !card.classList.contains('is-inactive');
    });
  }

  function initializeScenarioInputs(rootNode, readOnlyMarket) {
    activeInputs(rootNode).forEach(input => {
      input.dataset.simulationBaseValue = input.value;
      if (readOnlyMarket) {
        input.disabled = false;
        input.readOnly = false;
        input.removeAttribute('aria-readonly');
        input.dataset.simulationOnly = 'true';
        const label = input.closest('.kmc-cost-value-label')?.querySelector('span');
        if (label) label.textContent = 'Hypothèse de simulation';
      }
    });
  }

  function collectOverrides(rootNode) {
    return activeInputs(rootNode).flatMap(input => {
      const before = Number(input.dataset.simulationBaseValue);
      const after = Number(input.value);
      if (!Number.isFinite(after) || after < 0 || !Number.isFinite(before) || Math.abs(after - before) < 0.000001) return [];
      return [{ key: input.dataset.costValue, default_value: after }];
    });
  }

  function resetInputs(rootNode) {
    activeInputs(rootNode).forEach(input => {
      if (Object.prototype.hasOwnProperty.call(input.dataset, 'simulationBaseValue')) {
        input.value = input.dataset.simulationBaseValue;
        delete input.dataset.observedScenarioCandidate;
      }
    });
  }

  function createMetricRow(doc, key, label) {
    const row = el(doc, 'div', 'kmc-sim-metric');
    row.dataset.simMetric = key;
    row.appendChild(el(doc, 'span', 'kmc-sim-metric-label', label));
    row.appendChild(el(doc, 'strong', 'kmc-sim-before', '—'));
    row.appendChild(el(doc, 'strong', 'kmc-sim-after', '—'));
    row.appendChild(el(doc, 'strong', 'kmc-sim-delta', '—'));
    return row;
  }

  function createPanel(doc, payload, requestedMarket, readOnlyMarket) {
    const panel = el(doc, 'section', 'kmc-sim-panel');
    panel.dataset.pricingImpactSimulator = '';

    const header = el(doc, 'div', 'kmc-sim-header');
    const copy = el(doc, 'div', 'kmc-sim-copy');
    copy.appendChild(el(doc, 'span', 'kmc-sim-kicker', 'SIMULATION · AUCUNE ÉCRITURE'));
    copy.appendChild(el(doc, 'strong', 'kmc-sim-title', 'Voir l’impact avant de décider'));
    copy.appendChild(el(doc, 'p', 'kmc-sim-description', readOnlyMarket
      ? 'Choisissez un produit puis modifiez les valeurs de l’Atelier comme hypothèses. Votre accès reste en lecture seule : rien ne peut être enregistré.'
      : 'Choisissez un produit puis modifiez une ou plusieurs lignes. Le même moteur recalcule Avant / Scénario / Δ sans enregistrer les changements.'));
    header.appendChild(copy);

    const controls = el(doc, 'div', 'kmc-sim-controls');
    const select = doc.createElement('select');
    select.dataset.simulationProduct = '';
    select.setAttribute('aria-label', 'Produit à simuler');
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choisir un produit…';
    select.appendChild(placeholder);
    (payload.simulation_products || payload.products || []).forEach(product => {
      if (product.is_active === false) return;
      const option = doc.createElement('option');
      option.value = product.product_ref;
      option.textContent = `${product.product_ref} · ${product.name || product.category || 'Produit'}`;
      select.appendChild(option);
    });
    controls.appendChild(select);

    const reset = el(doc, 'button', 'kmc-workspace-action is-secondary', 'Réinitialiser scénario');
    reset.type = 'button';
    reset.dataset.simulationReset = '';
    controls.appendChild(reset);
    header.appendChild(controls);
    panel.appendChild(header);

    const state = el(doc, 'div', 'kmc-sim-state', requestedMarket ? `Modèle effectif ${requestedMarket} · en attente d’un produit.` : 'Modèle central · en attente d’un produit.');
    state.dataset.simulationState = '';
    panel.appendChild(state);

    const table = el(doc, 'div', 'kmc-sim-table');
    const labels = el(doc, 'div', 'kmc-sim-metric kmc-sim-head');
    labels.appendChild(el(doc, 'span', '', 'Indicateur'));
    labels.appendChild(el(doc, 'span', '', 'Avant'));
    labels.appendChild(el(doc, 'span', '', 'Scénario'));
    labels.appendChild(el(doc, 'span', '', 'Δ'));
    table.appendChild(labels);
    METRICS.forEach(([key, label]) => table.appendChild(createMetricRow(doc, key, label)));
    panel.appendChild(table);

    const changes = el(doc, 'div', 'kmc-sim-changes');
    changes.dataset.simulationChanges = '';
    panel.appendChild(changes);
    return panel;
  }

  function maturityTone(state) {
    if (state === 'mature') return 'is-mature';
    if (state === 'usable') return 'is-usable';
    if (state === 'period_required' || state === 'observed_not_comparable') return 'is-caution';
    if (state === 'stale') return 'is-stale';
    return 'is-emerging';
  }

  function trendLabel(trend = {}) {
    if (trend.direction === 'up') return `↑ ${formatSignedPct(trend.pct)} vs 30 jours précédents`;
    if (trend.direction === 'down') return `↓ ${formatSignedPct(trend.pct)} vs 30 jours précédents`;
    if (trend.direction === 'stable') return `→ stable · ${formatSignedPct(trend.pct)}`;
    return 'Tendance : historique insuffisant';
  }

  function observationSummary(component = {}) {
    const observation = component.observation || {};
    const observed = observation.observed || {};
    if (!observed.allocations_count) return 'Réel terrain · pas encore observé';
    if (observed.comparable && observed.value != null) {
      const delta = observation.variance?.pct;
      return `Réel terrain · ${formatObservedValue(observed.value, observed.unit)}${delta != null ? ` · Δ ${formatSignedPct(delta)}` : ''}`;
    }
    return `Réel terrain · ${formatNumber(observed.total_kmf_90d)} KMF constatés · Δ non comparable`;
  }

  function createObservationBlock(doc, rootNode, component = {}) {
    const observation = component.observation;
    if (!observation) return null;
    const observed = observation.observed || {};
    const details = doc.createElement('details');
    details.className = 'kmc-observed-cost';
    details.dataset.costObservation = component.key;
    details.appendChild(el(doc, 'summary', '', observationSummary(component)));

    const body = el(doc, 'div', 'kmc-observed-cost-body');
    const header = el(doc, 'div', 'kmc-observed-cost-header');
    const copy = el(doc, 'div', 'kmc-observed-cost-copy');
    copy.appendChild(el(doc, 'span', 'kmc-observed-cost-kicker', `${observation.source_scope === 'market' ? `RÉEL ${observation.market_code || 'MARCHÉ'}` : 'RÉEL GROUPE'} · ${observation.observation_window_days || 90} JOURS`));
    copy.appendChild(el(doc, 'strong', '', observation.maturity?.label || 'Observation terrain'));
    copy.appendChild(el(doc, 'small', '', observation.maturity?.note || observation.caution || ''));
    header.appendChild(copy);
    header.appendChild(el(doc, 'span', `kmc-observed-maturity ${maturityTone(observation.maturity?.state)}`, observation.maturity?.decisional ? 'Décisionnel marché' : 'Informatif / à confirmer'));
    body.appendChild(header);

    if (!observed.allocations_count) {
      body.appendChild(el(doc, 'div', 'kmc-observed-empty', 'Aucune allocation réelle réconciliée sur cette ligne dans la fenêtre observée. Le système ne transforme pas ce manque en zéro.'));
      details.appendChild(body);
      return details;
    }

    const values = el(doc, 'div', 'kmc-observed-values');
    const estimatedCard = el(doc, 'div', 'kmc-observed-value-card');
    estimatedCard.appendChild(el(doc, 'span', '', 'Hypothèse actuelle'));
    estimatedCard.appendChild(el(doc, 'strong', '', formatObservedValue(observation.estimated?.value, observation.estimated?.unit)));
    values.appendChild(estimatedCard);

    const actualCard = el(doc, 'div', 'kmc-observed-value-card is-real');
    actualCard.appendChild(el(doc, 'span', '', observed.comparable ? `Réel observé · ${observed.current_period || 'période disponible'}` : 'Réel constaté'));
    actualCard.appendChild(el(doc, 'strong', '', observed.comparable
      ? formatObservedValue(observed.value, observed.unit)
      : `${formatNumber(observed.total_kmf_90d)} KMF / ${observation.observation_window_days || 90} j`));
    values.appendChild(actualCard);

    const deltaCard = el(doc, 'div', `kmc-observed-value-card is-delta${Number(observation.variance?.value) > 0 ? ' is-up' : Number(observation.variance?.value) < 0 ? ' is-down' : ''}`);
    deltaCard.appendChild(el(doc, 'span', '', 'Écart'));
    deltaCard.appendChild(el(doc, 'strong', '', observation.variance?.comparable
      ? `${formatObservedValue(observation.variance.value, observed.unit)} · ${formatSignedPct(observation.variance.pct)}`
      : 'Non calculé'));
    values.appendChild(deltaCard);
    body.appendChild(values);

    const trend = el(doc, 'div', `kmc-observed-trend is-${observation.trend?.direction || 'unknown'}`, trendLabel(observation.trend));
    body.appendChild(trend);

    const proof = el(doc, 'div', 'kmc-observed-proof');
    proof.appendChild(el(doc, 'span', '', `${observed.allocations_count || 0} allocation${observed.allocations_count > 1 ? 's' : ''}`));
    proof.appendChild(el(doc, 'span', '', `${observed.orders_count || 0} commande${observed.orders_count > 1 ? 's' : ''}`));
    proof.appendChild(el(doc, 'span', '', `Confiance ${observed.confidence || 'inconnue'}`));
    proof.appendChild(el(doc, 'span', '', `Dernière preuve ${formatDate(observed.last_observed_at)}`));
    if ((observed.sources || []).length) proof.appendChild(el(doc, 'span', '', `Source ${observed.sources.join(' · ')}`));
    body.appendChild(proof);

    const caution = el(doc, 'p', 'kmc-observed-caution', observation.caution || '');
    body.appendChild(caution);

    if (observation.simulation_candidate_value != null) {
      const action = el(doc, 'button', 'kmc-workspace-action is-secondary kmc-observed-simulate', 'Tester ce réel dans le scénario');
      action.type = 'button';
      action.dataset.observedScenario = component.key;
      action.addEventListener('click', () => {
        const input = rootNode.querySelector(`[data-cost-value="${component.key}"]`);
        if (!input) return;
        input.value = observation.simulation_candidate_value;
        input.dataset.observedScenarioCandidate = 'true';
        const EventCtor = doc.defaultView && doc.defaultView.Event;
        if (EventCtor) input.dispatchEvent(new EventCtor('input', { bubbles: true }));
      });
      body.appendChild(action);
    }

    details.appendChild(body);
    return details;
  }

  function renderObservedTruth(doc, rootNode, payload = {}) {
    (payload.cost_components || []).forEach(component => {
      const card = rootNode.querySelector(`[data-cost-component="${component.key}"]`);
      const editor = card && card.querySelector('.kmc-cost-card-editor');
      if (!editor || editor.querySelector(`[data-cost-observation="${component.key}"]`)) return;
      const block = createObservationBlock(doc, rootNode, component);
      if (!block) return;
      const actions = editor.querySelector('.kmc-cost-card-actions');
      const technical = editor.querySelector('.kmc-cost-technical');
      editor.insertBefore(block, actions || technical || null);
    });
  }

  function renderResult(doc, panel, result) {
    const baseline = result.baseline?.metrics || {};
    const scenario = result.scenario?.metrics || {};
    const delta = result.delta || {};
    METRICS.forEach(([key, _label, unit]) => {
      const row = panel.querySelector(`[data-sim-metric="${key}"]`);
      if (!row) return;
      row.querySelector('.kmc-sim-before').textContent = formatMetric(baseline[key], unit);
      row.querySelector('.kmc-sim-after').textContent = formatMetric(scenario[key], unit);
      const deltaNode = row.querySelector('.kmc-sim-delta');
      deltaNode.textContent = formatDelta(delta[key], unit);
      const n = Number(delta[key]);
      deltaNode.className = `kmc-sim-delta${Number.isFinite(n) && n > 0 ? ' is-up' : Number.isFinite(n) && n < 0 ? ' is-down' : ''}`;
    });

    const state = panel.querySelector('[data-simulation-state]');
    if (state) {
      const count = result.overrides?.length || 0;
      state.textContent = `${result.subject?.product_ref || 'Produit'} · ${result.source_of_truth || 'pricing-engine'} · ${count} hypothèse${count > 1 ? 's' : ''} modifiée${count > 1 ? 's' : ''} · non enregistré`;
      state.className = 'kmc-sim-state is-ready';
    }

    const changes = panel.querySelector('[data-simulation-changes]');
    if (changes) {
      changes.replaceChildren();
      if (!(result.overrides || []).length) {
        changes.appendChild(el(doc, 'span', 'kmc-sim-no-change', 'Aucune modification : le scénario est identique à la situation actuelle.'));
      } else {
        result.overrides.forEach(change => {
          const line = el(doc, 'div', 'kmc-sim-change');
          line.appendChild(el(doc, 'strong', '', change.label || change.key));
          line.appendChild(el(doc, 'span', '', `${formatNumber(change.before, 2)} → ${formatNumber(change.after, 2)} ${change.unit || ''}`));
          line.appendChild(el(doc, 'small', '', change.explainability?.impact?.price_effect || 'Impact recalculé par le moteur.'));
          changes.appendChild(line);
        });
      }
    }
  }

  function setError(panel, message) {
    const state = panel.querySelector('[data-simulation-state]');
    if (!state) return;
    state.textContent = message;
    state.className = 'kmc-sim-state is-error';
  }

  function installInto(options, payload, workspace) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const rootNode = options.root;
    if (!doc || !rootNode || rootNode.querySelector('[data-pricing-impact-simulator]')) return;
    const workshop = findWorkshop(rootNode);
    const slot = workshop && workshop.querySelector('[data-section-slot]');
    if (!slot) return;

    const readOnlyMarket = Boolean(options.requestedMarket && payload.access?.read_only === true);
    initializeScenarioInputs(rootNode, readOnlyMarket);
    const panel = createPanel(doc, payload, options.requestedMarket || null, readOnlyMarket);
    const formula = slot.querySelector('.kmc-cost-formula');
    if (formula && formula.nextSibling) slot.insertBefore(panel, formula.nextSibling);
    else slot.prepend(panel);
    renderObservedTruth(doc, rootNode, payload);

    const select = panel.querySelector('[data-simulation-product]');
    let timer = null;
    let requestSerial = 0;

    async function run() {
      const productRef = select && select.value;
      if (!productRef) return;
      const serial = ++requestSerial;
      const state = panel.querySelector('[data-simulation-state]');
      if (state) {
        state.textContent = 'Recalcul du scénario…';
        state.className = 'kmc-sim-state is-loading';
      }
      try {
        const response = await workspace.jsonRequest(options.fetch, endpoint(workspace, options.requestedMarket), {
          method: 'POST',
          body: { product_ref: productRef, overrides: collectOverrides(rootNode) },
        });
        if (serial !== requestSerial) return;
        renderResult(doc, panel, response.result || response);
      } catch (error) {
        if (serial !== requestSerial) return;
        setError(panel, error.message || 'Simulation impossible');
      }
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(run, 260);
    }

    select?.addEventListener('change', run);
    panel.querySelector('[data-simulation-reset]')?.addEventListener('click', () => {
      resetInputs(rootNode);
      run();
    });
    activeInputs(rootNode).forEach(input => input.addEventListener('input', () => {
      if (select?.value) schedule();
    }));
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__impactSimulationInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function simulationMount(options) {
      const payload = await originalMount(options);
      installInto(options, payload, workspace);
      return payload;
    };
    workspace.__impactSimulationInstalled = true;
    return true;
  }

  return {
    METRICS,
    UNIT_LABELS,
    endpoint,
    collectOverrides,
    resetInputs,
    observationSummary,
    createObservationBlock,
    renderObservedTruth,
    installInto,
    install,
  };
});