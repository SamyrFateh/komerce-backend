/**
 * @komerce-arch
 * @role          canonical-pricing-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_pricing_operator, pricing_workspace_projection
 * @outputs       canonical_pricing_workspace_dom, authorized_pricing_action_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, server_authoritative_market_decision_policy, browser_business_refs_only, server_computes_pricing
 * @impact-areas  admin-dashboard, pricing, economic-engine
 * @version       2026-08
 */

'use strict';

(function initPricingWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalPricingWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingWorkspace() {
  const ENDPOINT = '/api/admin/workspaces/pricing';

  function endpointFor(context) {
    return context && context.requestedMarket
      ? `${ENDPOINT}/market/${encodeURIComponent(context.requestedMarket)}`
      : ENDPOINT;
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function td(doc, value) {
    const cell = doc.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    return cell;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value)} KMF`;
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function button(doc, label, action, secondary = false) {
    const node = text(doc, 'button', secondary ? 'kmc-workspace-action is-secondary' : 'kmc-workspace-action', label);
    node.type = 'button';
    node.dataset.pricingAction = action;
    return node;
  }

  function header(doc, context) {
    const node = doc.createElement('header');
    node.className = 'kmc-workspace-header';
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · PRICING'));
    const marketMode = Boolean(context && context.requestedMarket);
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', marketMode ? `Modèle de coûts · ${context.requestedMarket}` : 'Comprendre, simuler et décider le prix'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', marketMode
      ? 'Décision économique pays · vérité serveur, politique versionnée et coûts locaux explicables'
      : 'Surface centrale · moteur économique global'));
    node.appendChild(copy);
    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const finance = text(doc, 'a', 'kmc-workspace-nav-link', 'Finance →');
    finance.href = '/admin/finance';
    nav.appendChild(finance);
    const catalog = text(doc, 'a', 'kmc-workspace-nav-link', 'Catalogue →');
    catalog.href = '/admin/workspaces/catalog';
    nav.appendChild(catalog);
    node.appendChild(nav);
    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.dataset.workspaceFeedback = '';
    feedback.setAttribute('role', 'status');
    node.appendChild(feedback);
    return node;
  }

  function section(rootNode, ui, title, description) {
    const block = ui.Section.create({ title, description });
    rootNode.appendChild(block.element);
    return block.slot;
  }

  function formatRatio(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)}×`;
  }

  function formatPercentRatio(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(number * 100)} %`;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  const MARKET_DECISION_META = Object.freeze({
    COVERED: {
      tone: 'positive',
      label: 'Marché couvert',
      summary: 'La contribution reconnue couvre le N3 de la fenêtre selon la politique active.',
    },
    UNCOVERED: {
      tone: 'warning',
      label: 'Couverture insuffisante',
      summary: 'La contribution reconnue ne couvre pas encore le N3 au seuil de la politique active.',
    },
    NOT_DECISIONAL: {
      tone: 'critical',
      label: 'Décision impossible',
      summary: 'Le moteur refuse de conclure tant que la vérité économique requise n’est pas suffisante.',
    },
  });

  const MARKET_REASON_LABELS = Object.freeze({
    MARKET_DECISION_POLICY_REQUIRED: 'Aucune politique de décision active pour ce marché.',
    MATURITY_WATERMARK_NOT_READY: 'La maturité des commandes n’autorise pas encore la décision.',
    MATURITY_THRESHOLD_NOT_MET: 'Le seuil de maturité défini par la politique n’est pas atteint.',
    MARKET_N3_NOT_DECISIONAL: 'Le N3 de période n’est pas encore décisionnel.',
    MATURE_ORDER_SET_MISMATCH: 'Le jeu de commandes matures n’est pas cohérent entre les vérités serveur.',
    UNKNOWN_ACTUAL_VARIABLE_COST_TYPE: 'Un coût variable réel non reconnu empêche la décision.',
    RISK_PERIOD_NOT_DECISIONAL: 'La vérité de risque de la période n’est pas encore décisionnelle.',
    NON_POSITIVE_MARKET_N3: 'Le N3 du marché n’est pas positif sur la période.',
    COVERAGE_THRESHOLD_MET: 'Le seuil de couverture de la politique est atteint.',
    COVERAGE_THRESHOLD_NOT_MET: 'Le seuil de couverture de la politique n’est pas atteint.',
  });

  const MARKET_AUTHORIZATION_LABELS = Object.freeze({
    ALLOW_NEW_UNDER_CDR_POSITION: 'Position sous CDR autorisée par le gate serveur',
    DENY_NEW_UNDER_CDR_POSITION: 'Nouvelle position sous CDR bloquée par le gate serveur',
  });

  async function loadMarketDecisionData(context) {
    const result = { decision: null, history: { policies: [] }, errors: [] };
    try {
      result.decision = await jsonRequest(context.fetch, `${endpointFor(context)}/decision`);
    } catch (error) {
      result.errors.push(`Décision : ${error.message}`);
    }
    try {
      result.history = await jsonRequest(context.fetch, `${endpointFor(context)}/decision-policy/history`);
    } catch (error) {
      result.errors.push(`Historique : ${error.message}`);
    }
    return result;
  }

  function appendDecisionMetric(doc, host, label, value, helper) {
    const card = doc.createElement('div');
    card.className = 'kmc-market-decision-metric';
    card.appendChild(text(doc, 'span', 'kmc-market-decision-metric-label', label));
    card.appendChild(text(doc, 'strong', 'kmc-market-decision-metric-value', value));
    if (helper) card.appendChild(text(doc, 'small', 'kmc-market-decision-metric-helper', helper));
    host.appendChild(card);
  }

  function appendPolicySummary(doc, slot, policy) {
    if (!policy) {
      const missing = doc.createElement('div');
      missing.className = 'kmc-market-policy is-missing';
      missing.appendChild(text(doc, 'strong', 'kmc-market-policy-title', 'Politique active · absente'));
      missing.appendChild(text(doc, 'p', 'kmc-market-policy-rationale', 'Aucun seuil n’est fabriqué : le gate reste fermé jusqu’à l’enregistrement d’une politique explicite.'));
      slot.appendChild(missing);
      return;
    }
    const policyCard = doc.createElement('div');
    policyCard.className = 'kmc-market-policy';
    const heading = doc.createElement('div');
    heading.className = 'kmc-market-policy-heading';
    heading.appendChild(text(doc, 'span', 'kmc-market-policy-kicker', 'POLITIQUE ACTIVE'));
    heading.appendChild(text(doc, 'strong', 'kmc-market-policy-title', policy.version || 'Version non libellée'));
    policyCard.appendChild(heading);
    if (policy.rationale) policyCard.appendChild(text(doc, 'p', 'kmc-market-policy-rationale', policy.rationale));
    const facts = doc.createElement('div');
    facts.className = 'kmc-market-policy-facts';
    [
      ['Fenêtre', policy.window_days == null ? '—' : `${formatNumber(policy.window_days)} jours`],
      ['Maturité minimale', formatPercentRatio(policy.maturity_threshold)],
      ['Couverture minimale', formatRatio(policy.coverage_threshold)],
      ['Dispositions max.', formatPercentRatio(policy.max_disposition_ratio)],
      ['Source', policy.source || '—'],
      ['Preuve', policy.evidence_ref || '—'],
      ['Effective depuis', formatDateTime(policy.effective_from)],
      ['Enregistrée', formatDateTime(policy.recorded_at)],
    ].forEach(([label, value]) => {
      const fact = doc.createElement('div');
      fact.appendChild(text(doc, 'span', 'kmc-market-policy-fact-label', label));
      fact.appendChild(text(doc, 'strong', 'kmc-market-policy-fact-value', value));
      facts.appendChild(fact);
    });
    policyCard.appendChild(facts);
    slot.appendChild(policyCard);
  }

  function appendPolicyHistory(doc, slot, policies = []) {
    const details = doc.createElement('details');
    details.className = 'kmc-market-policy-history';
    details.appendChild(text(doc, 'summary', '', `Historique des politiques · ${policies.length}`));
    if (!policies.length) {
      details.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune politique enregistrée.'));
      slot.appendChild(details);
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-market-policy-table';
    table.innerHTML = '<thead><tr><th>Version</th><th>Fenêtre</th><th>Maturité</th><th>Couverture</th><th>Source</th><th>Effective</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    policies.forEach(policy => {
      const row = doc.createElement('tr');
      row.appendChild(td(doc, policy.version));
      row.appendChild(td(doc, policy.window_days == null ? '—' : `${formatNumber(policy.window_days)} j`));
      row.appendChild(td(doc, formatPercentRatio(policy.maturity_threshold)));
      row.appendChild(td(doc, formatRatio(policy.coverage_threshold)));
      row.appendChild(td(doc, policy.source));
      row.appendChild(td(doc, formatDateTime(policy.effective_from)));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    details.appendChild(wrap);
    slot.appendChild(details);
  }

  function appendPolicyForm(doc, slot, currentPolicy) {
    const details = doc.createElement('details');
    details.className = 'kmc-market-policy-editor';
    details.appendChild(text(doc, 'summary', '', '＋ Enregistrer une nouvelle version de politique'));
    details.appendChild(text(doc, 'p', 'kmc-market-policy-editor-help', 'La nouvelle version est append-only : elle ne réécrit jamais l’historique. Aucun seuil n’est proposé automatiquement.'));
    const form = doc.createElement('form');
    form.className = 'kmc-market-policy-form';
    form.dataset.marketDecisionPolicyForm = '';
    const specs = [
      ['version', 'Version', 'text', null],
      ['window_days', 'Fenêtre (jours)', 'number', '1'],
      ['maturity_threshold', 'Seuil de maturité (0–1)', 'number', '0.01'],
      ['coverage_threshold', 'Seuil de couverture (ratio)', 'number', '0.01'],
      ['max_disposition_ratio', 'Dispositions max. (0–1)', 'number', '0.01'],
      ['source', 'Source de la politique', 'text', null],
      ['evidence_ref', 'Référence de preuve', 'text', null],
    ];
    specs.forEach(([name, labelText, type, step]) => {
      const label = doc.createElement('label');
      label.className = 'kmc-market-policy-field';
      label.appendChild(text(doc, 'span', '', labelText));
      const input = doc.createElement('input');
      input.name = name;
      input.type = type;
      input.required = true;
      if (step) input.step = step;
      if (name === 'window_days') input.min = '1';
      if (name === 'maturity_threshold' || name === 'max_disposition_ratio') { input.min = '0'; input.max = '1'; }
      if (name === 'coverage_threshold') input.min = '0.01';
      if (currentPolicy && name !== 'version' && currentPolicy[name] != null) input.value = currentPolicy[name];
      label.appendChild(input);
      form.appendChild(label);
    });
    const rationaleLabel = doc.createElement('label');
    rationaleLabel.className = 'kmc-market-policy-field is-wide';
    rationaleLabel.appendChild(text(doc, 'span', '', 'Justification de cette version'));
    const rationale = doc.createElement('textarea');
    rationale.name = 'rationale';
    rationale.required = true;
    rationale.rows = 3;
    rationaleLabel.appendChild(rationale);
    form.appendChild(rationaleLabel);
    const submit = button(doc, 'Enregistrer la nouvelle politique', 'submit-decision-policy');
    submit.type = 'submit';
    submit.removeAttribute('data-pricing-action');
    form.appendChild(submit);
    details.appendChild(form);
    slot.appendChild(details);
  }

  function renderMarketDecision(rootNode, ui, doc, marketData, payload, context) {
    const slot = section(rootNode, ui, 'Décision marché', 'Le serveur tranche à partir de la politique active et des vérités économiques de la fenêtre. Le navigateur n’invente ni seuil, ni période, ni autorisation.');
    if (!marketData.decision) {
      const unavailable = doc.createElement('div');
      unavailable.className = 'kmc-market-decision-hero is-critical';
      unavailable.appendChild(text(doc, 'span', 'kmc-market-decision-kicker', 'VÉRITÉ SERVEUR INDISPONIBLE'));
      unavailable.appendChild(text(doc, 'strong', 'kmc-market-decision-title', 'Décision indisponible'));
      unavailable.appendChild(text(doc, 'p', 'kmc-market-decision-summary', 'L’atelier reste consultable, mais aucune conclusion économique n’est fabriquée côté navigateur.'));
      (marketData.errors || []).forEach(error => unavailable.appendChild(text(doc, 'small', 'kmc-market-decision-code', error)));
      slot.appendChild(unavailable);
      appendPolicyHistory(doc, slot, marketData.history?.policies || []);
      return;
    }
    const decision = marketData.decision;
    const meta = MARKET_DECISION_META[decision.decision_status] || { tone: 'neutral', label: `État serveur · ${decision.decision_status || 'inconnu'}`, summary: 'État non interprété par le navigateur.' };
    const hero = doc.createElement('div');
    hero.className = `kmc-market-decision-hero is-${meta.tone}`;
    hero.appendChild(text(doc, 'span', 'kmc-market-decision-kicker', `DÉCISION · ${context.requestedMarket}`));
    hero.appendChild(text(doc, 'strong', 'kmc-market-decision-title', meta.label));
    hero.appendChild(text(doc, 'p', 'kmc-market-decision-summary', meta.summary));
    const authorization = MARKET_AUTHORIZATION_LABELS[decision.authorization] || decision.authorization || 'Autorisation non fournie';
    hero.appendChild(text(doc, 'div', 'kmc-market-decision-authorization', authorization));
    const reason = MARKET_REASON_LABELS[decision.reason] || 'Voir le code serveur pour le motif exact.';
    hero.appendChild(text(doc, 'p', 'kmc-market-decision-reason', reason));
    hero.appendChild(text(doc, 'small', 'kmc-market-decision-code', `Motif serveur : ${decision.reason || '—'} · évalué ${formatDateTime(decision.evaluated_at)}`));
    slot.appendChild(hero);
    const coverage = decision.coverage || {};
    const policy = decision.policy || null;
    const metrics = doc.createElement('div');
    metrics.className = 'kmc-market-decision-metrics';
    appendDecisionMetric(doc, metrics, 'Couverture réelle', formatRatio(coverage.coverage_ratio), 'Contribution reconnue ÷ N3 de période');
    appendDecisionMetric(doc, metrics, 'Seuil de couverture', formatRatio(policy?.coverage_threshold), 'Politique active');
    appendDecisionMetric(doc, metrics, 'Contribution reconnue', formatKmf(coverage.numerator_contribution_kmf), 'Numérateur serveur');
    appendDecisionMetric(doc, metrics, 'N3 de période', formatKmf(coverage.denominator_n3_kmf), 'Dénominateur serveur');
    appendDecisionMetric(doc, metrics, 'Maturité constatée', formatPercentRatio(coverage.maturity?.maturity_ratio), `${formatNumber(coverage.contribution?.mature_order_count)} commandes matures`);
    appendDecisionMetric(doc, metrics, 'Seuil de maturité', formatPercentRatio(policy?.maturity_threshold), 'Politique active');
    slot.appendChild(metrics);
    const period = decision.canonical_period;
    if (period) {
      const periodLine = doc.createElement('div');
      periodLine.className = 'kmc-market-decision-period';
      const isCalendar = period.source === 'calendar_month_selection';
      periodLine.appendChild(text(doc, 'strong', '', isCalendar ? `Mois calendaire · ${formatNumber(period.width_days)} jours` : `Fenêtre canonique · ${formatNumber(period.width_days)} jours`));
      periodLine.appendChild(text(doc, 'span', '', `${formatDateTime(period.from)} → ${formatDateTime(period.to)}`));
      periodLine.appendChild(text(doc, 'small', '', isCalendar ? 'Période bornée sur le mois calendaire sélectionné.' : 'Période dérivée côté serveur depuis la politique active.'));
      slot.appendChild(periodLine);
    }
    appendPolicySummary(doc, slot, policy);
    appendPolicyHistory(doc, slot, marketData.history?.policies || []);
    if (payload.capabilities?.manage_decision_policy === true) appendPolicyForm(doc, slot, policy);
  }

  function metrics(summary = {}) {
    return [
      { key: 'products', label: 'Produits suivis', value: formatNumber(summary.products), tone: 'neutral' },
      { key: 'active-products', label: 'Produits actifs', value: formatNumber(summary.active_products), tone: 'neutral' },
      { key: 'costs', label: 'Composants de coût', value: formatNumber(summary.cost_components), tone: 'neutral' },
      { key: 'active-costs', label: 'Coûts actifs', value: formatNumber(summary.active_cost_components), tone: 'neutral' },
      { key: 'competitors', label: 'Obs. concurrence', value: formatNumber(summary.competitor_observations), tone: summary.competitor_observations ? 'warning' : 'neutral' },
    ];
  }

  function recommendationByRef(payload) {
    const map = new Map();
    (payload.recommendations || []).forEach(row => {
      if (row.product_ref) map.set(row.product_ref, row);
    });
    return map;
  }

  function renderProducts(rootNode, ui, doc, payload, context) {
    const slot = section(rootNode, ui, 'Décision produit', 'Le moteur calcule. L’opérateur choisit quand appliquer un prix. Product 360 reste le drill-down.');
    const rows = payload.products || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun produit à tarifer.'));
      return;
    }
    const reco = recommendationByRef(payload);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Produit</th><th>Catégorie</th><th>Prix actuel</th><th>Coût</th><th>Conseillé</th><th>Plancher</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const recommendation = reco.get(row.product_ref) || {};
      const tr = doc.createElement('tr');
      const productCell = doc.createElement('td');
      const link = text(doc, 'a', 'kmc-workspace-nav-link', `${row.product_ref} · ${row.name}`);
      link.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
      productCell.appendChild(link);
      tr.appendChild(productCell);
      tr.appendChild(td(doc, row.category));
      tr.appendChild(td(doc, formatKmf(row.price_kmf)));
      tr.appendChild(td(doc, formatKmf(row.cost_kmf)));
      tr.appendChild(td(doc, formatKmf(recommendation.recommended_price_kmf)));
      tr.appendChild(td(doc, formatKmf(recommendation.minimum_safe_price_kmf)));
      const actions = doc.createElement('td');
      const simulate = button(doc, 'Simuler', 'simulate-product', true);
      simulate.dataset.productRef = row.product_ref;
      actions.appendChild(simulate);
      const strategy = button(doc, 'Stratégie', 'load-strategy', true);
      strategy.dataset.productRef = row.product_ref;
      actions.appendChild(strategy);
      if (recommendation.recommended_price_kmf) {
        const apply = button(doc, 'Appliquer conseillé', 'apply-recommended');
        apply.dataset.productRef = row.product_ref;
        apply.dataset.price = recommendation.recommended_price_kmf;
        apply.dataset.survival = recommendation.minimum_safe_price_kmf || 0;
        actions.appendChild(apply);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    slot.appendChild(wrap);

    const result = doc.createElement('div');
    result.className = 'kmc-workspace-detail';
    result.dataset.pricingSimulation = '';
    slot.appendChild(result);
  }

  function renderSimulationResult(doc, rootNode, result, title) {
    const target = rootNode.querySelector('[data-pricing-simulation]');
    if (!target) return;
    target.replaceChildren();
    target.appendChild(text(doc, 'h3', 'kmc-workspace-detail-title', title || 'Résultat moteur'));
    const grid = doc.createElement('div');
    grid.className = 'kmc-workspace-kpis';
    const items = [
      ['Rendu relais', result.landed_relay_cost_kmf],
      ['Coût variable', result.variable_cost_complete_kmf || result.business_complete_cost_kmf],
      ['CDR complet', result.fully_loaded_cost_reference_kmf || result.cost_complete_estimated_kmf],
      ['Plancher', result.minimum_safe_price_kmf],
      ['Conseillé', result.recommended_price_kmf],
    ];
    items.forEach(([label, value]) => {
      const card = doc.createElement('div');
      card.className = 'kmc-workspace-kpi';
      card.appendChild(text(doc, 'span', 'kmc-workspace-kpi-label', label));
      card.appendChild(text(doc, 'strong', 'kmc-workspace-kpi-value', formatKmf(value)));
      grid.appendChild(card);
    });
    target.appendChild(grid);
    if (result.strategy_risk || result.data_quality?.confidence) {
      target.appendChild(text(doc, 'p', 'kmc-workspace-note', `Risque stratégie : ${result.strategy_risk || '—'} · confiance : ${result.data_quality?.confidence || '—'}`));
    }
  }

  function renderStrategy(rootNode, ui, doc, context) {
    const slot = section(rootNode, ui, 'Stratégie & concurrence', 'Comparaison CDR / concurrence / prix actuel. Les observations concurrentes sont adressées par une référence métier KPC.');
    const host = doc.createElement('div');
    host.dataset.pricingStrategy = '';
    host.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Choisissez “Stratégie” sur un produit pour charger cette facette.'));
    slot.appendChild(host);
  }

  function strategyPrice(option) {
    return option && (option.price ?? option.price_kmf ?? null);
  }

  function renderStrategyDetail(doc, rootNode, payload, productRef, context) {
    const host = rootNode.querySelector('[data-pricing-strategy]');
    if (!host) return;
    host.replaceChildren();
    const strategy = payload.strategy || {};
    const target = strategy.target || {};
    host.appendChild(text(doc, 'h3', 'kmc-workspace-detail-title', `${productRef} · ${target.name || 'Produit'}`));
    const options = strategy.options || {};
    const cards = doc.createElement('div');
    cards.className = 'kmc-workspace-actions-grid';
    Object.entries(options).forEach(([key, option]) => {
      const price = strategyPrice(option);
      if (!price) return;
      const card = doc.createElement('div');
      card.className = 'kmc-workspace-action-card';
      card.appendChild(text(doc, 'strong', '', key));
      card.appendChild(text(doc, 'span', '', formatKmf(price)));
      card.appendChild(text(doc, 'small', '', option.description || ''));
      const apply = button(doc, 'Appliquer', 'apply-strategy');
      apply.dataset.productRef = productRef;
      apply.dataset.strategyType = key;
      apply.dataset.price = price;
      card.appendChild(apply);
      cards.appendChild(card);
    });
    host.appendChild(cards);

    const competitors = payload.competitors || [];
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Concurrent</th><th>Prix</th><th>Source</th><th>Observé</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    competitors.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.competitor_name));
      tr.appendChild(td(doc, formatKmf(row.price_kmf)));
      tr.appendChild(td(doc, row.source));
      tr.appendChild(td(doc, row.observed_at ? new Date(row.observed_at).toLocaleDateString('fr-FR') : '—'));
      const actions = doc.createElement('td');
      const remove = button(doc, 'Désactiver', 'deactivate-competitor', true);
      remove.dataset.competitorRef = row.competitor_ref;
      remove.dataset.productRef = productRef;
      actions.appendChild(remove);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);

    const form = doc.createElement('form');
    form.className = 'kmc-workspace-inline-form';
    form.dataset.pricingCompetitorForm = '';
    form.dataset.productRef = productRef;
    form.innerHTML = '<input name="competitor_name" required placeholder="Concurrent"><input name="price_kmf" type="number" min="1" required placeholder="Prix KMF"><input name="notes" placeholder="Note"><button class="kmc-workspace-action" type="submit">Ajouter observation</button>';
    host.appendChild(form);
  }

  function renderCosts(rootNode, ui, doc, payload, context) {
    const marketMode = Boolean(context && context.requestedMarket);
    const slot = section(
      rootNode,
      ui,
      'Atelier des coûts',
      marketMode
        ? 'Chaque ligne hérite du modèle central tant qu’aucune surcharge locale n’est définie. Reset restaure immédiatement l’héritage global.'
        : 'Autorité centrale cost_components. Les marchés peuvent surcharger valeur et activation sans modifier cette base.'
    );
    const rows = payload.cost_components || [];
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = marketMode
      ? '<thead><tr><th>Clé</th><th>Famille</th><th>Catégorie</th><th>Valeur effective</th><th>Base globale</th><th>Unité</th><th>Origine</th><th>État</th><th></th></tr></thead>'
      : '<thead><tr><th>Clé</th><th>Famille</th><th>Catégorie</th><th>Valeur</th><th>Unité</th><th>Scope</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.key));
      tr.appendChild(td(doc, row.family));
      tr.appendChild(td(doc, row.category));
      const valueCell = doc.createElement('td');
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '0.01';
      input.value = row.default_value == null ? '' : row.default_value;
      input.dataset.costValue = row.key;
      valueCell.appendChild(input);
      tr.appendChild(valueCell);
      if (marketMode) {
        tr.appendChild(td(doc, row.base_default_value));
      }
      tr.appendChild(td(doc, row.unit));
      if (marketMode) {
        tr.appendChild(td(doc, row.inherited ? 'Global hérité' : 'Override pays'));
      } else {
        tr.appendChild(td(doc, row.scope));
      }
      tr.appendChild(td(doc, row.is_active ? 'Actif' : 'Inactif'));
      const actions = doc.createElement('td');
      const save = button(doc, 'Enregistrer', 'save-cost', true);
      save.dataset.key = row.key;
      actions.appendChild(save);
      const toggle = button(doc, row.is_active ? 'Désactiver' : 'Activer', 'toggle-cost', true);
      toggle.dataset.key = row.key;
      actions.appendChild(toggle);
      if (marketMode && row.inherited === false) {
        const reset = button(doc, 'Revenir au global', 'reset-cost', true);
        reset.dataset.key = row.key;
        actions.appendChild(reset);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    slot.appendChild(wrap);

    if (!marketMode) {
      const form = doc.createElement('form');
      form.className = 'kmc-workspace-inline-form';
      form.dataset.pricingCostForm = '';
      form.innerHTML = '<input name="key" required placeholder="clé"><input name="label" required placeholder="Libellé"><select name="family"><option value="landed_relay">landed_relay</option><option value="business">business</option><option value="exceptional">exceptional</option></select><input name="category" required placeholder="catégorie"><input name="default_value" type="number" min="0" step="0.01" required placeholder="valeur"><select name="unit"><option value="kmf">kmf</option><option value="pct">pct</option><option value="kmf_per_kg">kmf_per_kg</option><option value="kmf_per_m3">kmf_per_m3</option></select><button class="kmc-workspace-action" type="submit">Créer composant</button>';
      slot.appendChild(form);
    }
  }

  function formatEconomicValue(value, unit) {
    if (value == null || value === '') return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    if (unit === 'KMF' || unit === 'kmf') return formatKmf(numeric);
    if (unit === '%' || unit === 'pct') {
      return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(numeric)} %`;
    }
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(numeric)}${unit ? ` ${unit}` : ''}`;
  }

  function renderEconomicModel(rootNode, ui, doc, payload) {
    const slot = section(rootNode, ui, 'Santé économique globale', 'Seuil, pression des charges et profit du moteur économique global. Cette surface est réservée à l’autorité Pricing centrale.');
    const executive = payload.economic && payload.economic.executive;
    if (!executive) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Modèle économique indisponible.'));
      return;
    }

    const status = doc.createElement('div');
    status.className = 'kmc-workspace-detail';
    status.appendChild(text(doc, 'strong', 'kmc-workspace-detail-title', `${executive.status_emoji || ''} ${executive.status_label || executive.status || 'État du modèle'}`.trim()));
    status.appendChild(text(doc, 'p', 'kmc-workspace-note', `Source : moteur économique global · génération ${executive.generated_at ? new Date(executive.generated_at).toLocaleString('fr-FR') : '—'}`));
    slot.appendChild(status);

    const modelMetrics = (executive.kpis || []).map(metric => ({
      key: metric.key || 'economic',
      label: metric.label || metric.key || 'Indicateur',
      value: formatEconomicValue(metric.value, metric.unit),
      tone: metric.key === 'net_profit_per_order' && Number(metric.value) < 0
        ? 'critical'
        : (metric.key === 'safety_ratio' && Number(metric.value) < 15 ? 'warning' : 'neutral'),
    }));
    if (modelMetrics.length) slot.appendChild(ui.KpiStrip.create(modelMetrics).element);

    const alerts = executive.alerts || [];
    if (alerts.length) {
      const alertHost = doc.createElement('div');
      alertHost.className = 'kmc-workspace-actions-grid';
      alerts.forEach(alert => {
        const card = doc.createElement('div');
        card.className = 'kmc-workspace-action-card';
        card.appendChild(text(doc, 'strong', '', alert.message || alert.category || 'Alerte'));
        if (alert.detail) card.appendChild(text(doc, 'small', '', alert.detail));
        alertHost.appendChild(card);
      });
      slot.appendChild(alertHost);
    }
    if (executive.recommendation && executive.recommendation.text) {
      slot.appendChild(text(doc, 'p', 'kmc-workspace-note', `Recommandation : ${executive.recommendation.text}`));
    }
  }

  function renderEconomicVariables(rootNode, ui, doc, payload) {
    const slot = section(rootNode, ui, 'Variables économiques', 'Hypothèses et projections globales. economic_variables reste un stockage Legacy en lecture ; finance_config est la vérité des entrées configurables.');
    const categories = payload.economic && payload.economic.variables && payload.economic.variables.categories;
    const rows = [];
    Object.entries(categories || {}).forEach(([categoryKey, category]) => {
      (category.variables || []).forEach(variable => rows.push({
        category: category.label || categoryKey,
        ...variable,
      }));
    });
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune variable économique disponible.'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Variable</th><th>Catégorie</th><th>Valeur</th><th>Source</th><th>Nature</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.label || row.key));
      tr.appendChild(td(doc, row.category));
      tr.appendChild(td(doc, formatEconomicValue(row.value_used, row.unit)));
      tr.appendChild(td(doc, row.source_used || '—'));
      tr.appendChild(td(doc, row.is_computed ? 'Calculée' : 'Configurée'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderEconomicCharges(rootNode, ui, doc, payload) {
    const slot = section(rootNode, ui, 'Charges économiques', 'Charges globales utilisées par le modèle. Elles sont affichées ici comme vérité moteur, sans dupliquer leur logique dans le navigateur.');
    const families = payload.economic && payload.economic.charges && payload.economic.charges.families;
    const rows = [];
    Object.entries(families || {}).forEach(([familyKey, family]) => {
      (family.charges || []).forEach(charge => rows.push({
        family: family.label || familyKey,
        ...charge,
      }));
    });
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune charge économique disponible.'));
      return;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Charge</th><th>Famille</th><th>Montant</th><th>Récurrence</th><th>État</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.family));
      tr.appendChild(td(doc, formatKmf(row.amount_kmf)));
      tr.appendChild(td(doc, row.recurrence_period || (row.is_recurring ? 'récurrente' : 'ponctuelle')));
      tr.appendChild(td(doc, row.is_active === false ? 'Inactive' : 'Active'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  async function action(context, url, body, success, method = 'POST') {
    setFeedback(context.root, 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, url, { method, body });
      setFeedback(context.root, success, 'positive');
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      return null;
    }
  }

  function bind(rootNode, context) {
    rootNode.addEventListener('click', async event => {
      const target = event.target.closest('[data-pricing-action]');
      if (!target) return;
      const act = target.dataset.pricingAction;
      if (act === 'simulate-product') {
        const productRef = target.dataset.productRef;
        const result = await action(context, `${endpointFor(context)}/simulate`, { product_ref: productRef }, 'Simulation calculée.');
        if (result) renderSimulationResult(context.document, rootNode, result.result, `Simulation · ${productRef}`);
      }
      if (act === 'apply-recommended') {
        const productRef = target.dataset.productRef;
        const price = Number(target.dataset.price);
        const survival = Number(target.dataset.survival) || 0;
        const result = await action(context, `${endpointFor(context)}/products/${encodeURIComponent(productRef)}/apply-price`, { price_kmf: price, survival_price_kmf: survival, source: 'canonical_pricing_workspace' }, 'Prix appliqué.');
        if (result) await context.reload();
      }
      if (act === 'load-strategy') {
        const productRef = target.dataset.productRef;
        try {
          const payload = await jsonRequest(context.fetch, `${endpointFor(context)}/strategy?product_ref=${encodeURIComponent(productRef)}`);
          renderStrategyDetail(context.document, rootNode, payload, productRef, context);
          setFeedback(context.root, 'Stratégie chargée.', 'positive');
        } catch (error) { setFeedback(context.root, error.message, 'critical'); }
      }
      if (act === 'apply-strategy') {
        const body = { product_ref: target.dataset.productRef, strategy_type: target.dataset.strategyType, final_price_kmf: Number(target.dataset.price) };
        const result = await action(context, `${endpointFor(context)}/strategy/apply`, body, 'Stratégie appliquée.');
        if (result) await context.reload();
      }
      if (act === 'deactivate-competitor') {
        const ref = target.dataset.competitorRef;
        const productRef = target.dataset.productRef;
        if (!ref) return;
        const result = await action(context, `${endpointFor(context)}/competitors/${encodeURIComponent(ref)}/deactivate`, {}, 'Observation désactivée.');
        if (result) {
          const payload = await jsonRequest(context.fetch, `${endpointFor(context)}/strategy?product_ref=${encodeURIComponent(productRef)}`);
          renderStrategyDetail(context.document, rootNode, payload, productRef, context);
        }
      }
      if (act === 'save-cost') {
        const key = target.dataset.key;
        const input = Array.from(rootNode.querySelectorAll('[data-cost-value]')).find(node => node.dataset.costValue === key);
        const result = await action(context, `${endpointFor(context)}/cost-components/${encodeURIComponent(key)}/update`, { default_value: Number(input?.value || 0), source: 'manual' }, 'Composant mis à jour.');
        if (result) await context.reload();
      }
      if (act === 'toggle-cost') {
        const key = target.dataset.key;
        const result = await action(context, `${endpointFor(context)}/cost-components/${encodeURIComponent(key)}/toggle`, {}, 'État du composant modifié.');
        if (result) await context.reload();
      }
      if (act === 'reset-cost') {
        const key = target.dataset.key;
        const result = await action(context, `${endpointFor(context)}/cost-components/${encodeURIComponent(key)}/reset`, {}, 'Override supprimé · héritage global restauré.');
        if (result) await context.reload();
      }
    });

    rootNode.addEventListener('submit', async event => {
      if (event.target.matches('[data-pricing-competitor-form]')) {
        event.preventDefault();
        const form = event.target;
        const data = new FormData(form);
        const productRef = form.dataset.productRef;
        const result = await action(context, `${endpointFor(context)}/competitors`, { product_ref: productRef, competitor_name: data.get('competitor_name'), price_kmf: Number(data.get('price_kmf')), notes: data.get('notes') || null, source: 'manual' }, 'Observation concurrente ajoutée.');
        if (result) {
          const payload = await jsonRequest(context.fetch, `${endpointFor(context)}/strategy?product_ref=${encodeURIComponent(productRef)}`);
          renderStrategyDetail(context.document, rootNode, payload, productRef, context);
        }
      }
      if (event.target.matches('[data-market-decision-policy-form]')) {
        event.preventDefault();
        const data = new FormData(event.target);
        const body = {
          version: data.get('version'),
          window_days: Number(data.get('window_days')),
          maturity_threshold: Number(data.get('maturity_threshold')),
          coverage_threshold: Number(data.get('coverage_threshold')),
          max_disposition_ratio: Number(data.get('max_disposition_ratio')),
          source: data.get('source'),
          evidence_ref: data.get('evidence_ref'),
          rationale: data.get('rationale'),
        };
        const result = await action(context, `${endpointFor(context)}/decision-policy`, body, 'Nouvelle politique enregistrée.');
        if (result) await context.reload();
      }
      if (event.target.matches('[data-pricing-cost-form]')) {
        event.preventDefault();
        const data = new FormData(event.target);
        const body = Object.fromEntries(data.entries());
        body.default_value = Number(body.default_value);
        const result = await action(context, `${endpointFor(context)}/cost-components`, body, 'Composant créé.');
        if (result) await context.reload();
      }
    });
  }

  async function mount(options) {
    const context = {
      root: options.root,
      user: options.user,
      document: options.document,
      fetch: options.fetch,
      ui: options.ui,
      adminContext: options.adminContext || null,
      requestedMarket: options.requestedMarket || null,
      reload: null,
    };
    async function load() {
      const payload = await jsonRequest(context.fetch, endpointFor(context));
      const rootNode = context.root;
      rootNode.replaceChildren();
      rootNode.appendChild(header(context.document, context));
      rootNode.appendChild(context.ui.KpiStrip.create(metrics(payload.summary)).element);
      if (context.requestedMarket) {
        const marketData = await loadMarketDecisionData(context);
        renderMarketDecision(rootNode, context.ui, context.document, marketData, payload, context);
        renderCosts(rootNode, context.ui, context.document, payload, context);
      } else {
        renderEconomicModel(rootNode, context.ui, context.document, payload);
        renderProducts(rootNode, context.ui, context.document, payload, context);
        renderStrategy(rootNode, context.ui, context.document, context);
        renderCosts(rootNode, context.ui, context.document, payload, context);
        renderEconomicVariables(rootNode, context.ui, context.document, payload);
        renderEconomicCharges(rootNode, context.ui, context.document, payload);
      }
      bind(rootNode, context);
      return payload;
    }
    context.reload = load;
    return load();
  }

  return { ENDPOINT, endpointFor, mount, jsonRequest, metrics, recommendationByRef, formatEconomicValue, formatRatio, formatPercentRatio, MARKET_DECISION_META, MARKET_REASON_LABELS, MARKET_AUTHORIZATION_LABELS };
});
