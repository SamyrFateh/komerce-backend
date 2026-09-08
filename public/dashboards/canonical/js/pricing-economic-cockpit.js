/**
 * @komerce-arch
 * @role          canonical-pricing-economic-cockpit-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        pricing_workspace_projection, server_market_corridor_projection, server_market_decision_projection
 * @outputs       economic_cockpit_dom, explicit_market_price_decision_requests
 * @depends       public/dashboards/canonical/js/pricing-workspace.js, public/dashboards/canonical/js/pricing-equilibrium-panel.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      mock_is_ui_contract, variable_or_fixed_is_nature_direct_or_mutualized_is_perimeter, mutualized_quote_part_is_market_scoped, calculated_values_are_read_only, final_market_price_is_primary_product_lever, browser_never_recomputes_economic_truth
 * @impact-areas  admin-dashboard, pricing, economic-engine, market-autonomy
 * @version       2026-09
 */

'use strict';

(function initPricingEconomicCockpit(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingEconomicCockpit = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingEconomicCockpit() {
  const COCKPIT_ATTR = 'pricingEconomicCockpit';
  const MAX_CATEGORY_ROWS = 8;

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value, digits = 0) {
    const number = finite(value);
    if (number == null) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(number);
  }

  function formatKmf(value) {
    return finite(value) == null ? '—' : `${formatNumber(value)} KMF`;
  }

  function formatMoney(value, currency) {
    return finite(value) == null ? '—' : `${formatNumber(value, 2)} ${currency || ''}`.trim();
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
  }

  function economicNature(component = {}) {
    if (component.economic_nature) return component.economic_nature;
    if (component.family === 'landed_relay') return 'variable';
    if (component.family === 'business' && component.category === 'fixed_overhead') return 'fixed';
    if (component.family === 'business') return 'variable';
    return null;
  }

  function allocationPerimeter(component = {}) {
    return component.allocation_perimeter || 'direct';
  }

  function allocationLabel(method) {
    return ({
      none: '—', per_order: 'Commande', per_item: 'Article', by_value: 'Valeur',
      by_weight: 'Poids', by_volume: 'Volume', by_taxable_weight: 'Poids taxable',
      by_quantity: 'Quantité', by_category_risk: 'Risque catégorie', manual: 'Manuelle',
    })[method] || String(method || '—').replaceAll('_', ' ');
  }

  function unitLabel(unit) {
    return ({
      kmf: 'KMF', pct: '%', kmf_per_kg: 'KMF/kg', kmf_per_m3: 'KMF/m³',
      kmf_per_order: 'KMF/commande', kmf_per_parcel: 'KMF/colis', kmf_per_shipment: 'KMF/expédition',
      eur: 'EUR', usd: 'USD', aed: 'AED',
    })[unit] || unit || '';
  }

  function componentValue(component, useGlobal = false) {
    const value = useGlobal ? component.base_default_value : component.default_value;
    return finite(value) == null ? '—' : `${formatNumber(value, 2)} ${unitLabel(component.unit)}`.trim();
  }

  function categoryLabel(category) {
    return String(category || 'Autres').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
  }

  function findWorkshop(rootNode) {
    return rootNode.querySelector('[data-pricing-workshop-enhanced]') || Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {
      const title = section.querySelector('.kmc-section-title');
      return title && ['Atelier des coûts', 'Atelier économique'].includes(title.textContent.trim());
    }) || null;
  }

  function classifyComponents(components = []) {
    const active = components.filter(component => component.is_active !== false && !component.is_exceptional && component.family !== 'exceptional');
    return {
      variable: active.filter(component => economicNature(component) === 'variable'),
      fixedDirect: active.filter(component => economicNature(component) === 'fixed' && allocationPerimeter(component) === 'direct'),
      fixedMutualized: active.filter(component => economicNature(component) === 'fixed' && allocationPerimeter(component) === 'mutualized'),
      exceptional: components.filter(component => component.is_exceptional || component.family === 'exceptional'),
    };
  }

  function badge(doc, text, tone = '') {
    return el(doc, 'span', `kmc-cockpit-badge${tone ? ` is-${tone}` : ''}`, text);
  }

  function tableCell(doc, value, className = '') {
    return el(doc, 'div', `kmc-cockpit-cell${className ? ` ${className}` : ''}`, value);
  }

  function costCardHeader(doc, icon, title, subtitle, actionText, actionKey) {
    const head = el(doc, 'div', 'kmc-cockpit-cost-head');
    const identity = el(doc, 'div', 'kmc-cockpit-cost-identity');
    identity.appendChild(el(doc, 'span', 'kmc-cockpit-cost-icon', icon));
    const copy = el(doc, 'div', '');
    copy.appendChild(el(doc, 'strong', '', title));
    copy.appendChild(el(doc, 'small', '', subtitle));
    identity.appendChild(copy);
    head.appendChild(identity);
    const action = el(doc, 'button', 'kmc-cockpit-outline-action', actionText);
    action.type = 'button';
    action.dataset.openCostDetail = actionKey;
    head.appendChild(action);
    return head;
  }

  function variableCostCard(doc, components, marketCode) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-variable');
    card.dataset.costSummary = 'variable';
    card.appendChild(costCardHeader(doc, '🛒', 'Coûts variables', 'Ces coûts affectent directement la contribution.', 'Ajuster les coûts', 'variable'));

    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-variable');
    ['Élément', 'Nature', 'Périmètre', 'Clé d’allocation', `Valeur effective ${marketCode}`].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));
    components.slice(0, 6).forEach(component => {
      const perimeter = allocationPerimeter(component);
      table.appendChild(tableCell(doc, component.label || component.key));
      table.appendChild(tableCell(doc, 'Variable', 'is-badge-cell'));
      table.lastChild.appendChild(badge(doc, perimeter === 'mutualized' ? 'Mutualisé' : 'Direct', perimeter === 'mutualized' ? 'mutualized' : 'direct'));
      table.appendChild(tableCell(doc, allocationLabel(component.allocation_method), 'is-derived'));
      const value = tableCell(doc, componentValue(component), 'is-derived');
      if (perimeter === 'mutualized') value.title = `Configuration effective du coût variable mutualisé pour ${marketCode}; la contribution SKU reste calculée par le moteur.`;
      table.appendChild(value);
    });
    if (!components.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Aucune charge variable active.'));
    card.appendChild(table);
    card.appendChild(el(doc, 'p', 'kmc-cockpit-card-foot', `${components.length} ligne${components.length > 1 ? 's' : ''} · les valeurs calculées restent non éditables ici.`));
    return card;
  }

  function fixedDirectCard(doc, structure) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-direct');
    card.dataset.costSummary = 'fixed-direct';
    card.appendChild(costCardHeader(doc, '🏠', 'Charges fixes directes', 'Vérité structurelle de période propre au marché.', 'Ajuster les charges', 'fixed-direct'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-direct');
    table.appendChild(tableCell(doc, 'Élément', 'is-head'));
    table.appendChild(tableCell(doc, 'Montant reconnu', 'is-head'));
    const rows = Array.isArray(structure?.evidence)
      ? structure.evidence.filter(item => item.scope_kind === 'MARKET_DIRECT')
      : [];
    rows.slice(0, 6).forEach(item => {
      table.appendChild(tableCell(doc, item.charge_name || item.charge_family || 'Charge structurelle'));
      table.appendChild(tableCell(doc, formatKmf(item.recognized_amount_kmf), 'is-derived is-number'));
    });
    if (!rows.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', structure ? 'Aucune charge fixe directe reconnue sur la période.' : 'Vérité de période indisponible.'));
    card.appendChild(table);
    card.appendChild(el(doc, 'p', 'kmc-cockpit-card-foot', `${rows.length} fait${rows.length > 1 ? 's' : ''} de période · source moteur.`));
    return card;
  }

  function fixedMutualizedCard(doc, structure, marketCode) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-mutualized');
    card.dataset.costSummary = 'fixed-mutualized';
    card.appendChild(costCardHeader(doc, '🔗', 'Charges fixes mutualisées', 'Pools structurels partagés, alloués par Market ID.', 'Gérer les mutualisations', 'fixed-mutualized'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-mutualized');
    ['Élément', 'Coût global', 'Clé d’allocation', `Quote-part ${marketCode}`].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));
    const charges = Array.isArray(structure?.allocation?.charges) ? structure.allocation.charges : [];
    charges.slice(0, 6).forEach(charge => {
      table.appendChild(tableCell(doc, charge.charge_name || charge.charge_family || 'Charge mutualisée'));
      table.appendChild(tableCell(doc, formatKmf(charge.group_pool_kmf), 'is-derived'));
      const policy = charge.policy;
      table.appendChild(tableCell(doc, policy ? `${policy.basis_kind || '—'} · ${policy.policy_kind || '—'}` : 'Politique manquante', 'is-derived'));
      const shareText = charge.market_share_kmf == null ? 'À gouverner' : formatKmf(charge.market_share_kmf);
      const share = tableCell(doc, shareText, `is-derived ${charge.market_share_kmf == null ? '' : 'is-market-share'}`.trim());
      if (charge.market_allocation_ratio != null) share.title = `Quote-part Market ID ${marketCode} : ${formatNumber(Number(charge.market_allocation_ratio) * 100, 2)} %`;
      table.appendChild(share);
    });
    const groupPool = finite(structure?.group_pool_kmf);
    if (!charges.length && groupPool != null && groupPool !== 0) {
      table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Pool mutualisé réel présent, mais politique d’allocation non décisionnelle : aucune quote-part n’est inventée.'));
    } else if (!charges.length) {
      table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', structure ? 'Aucune charge fixe mutualisée reconnue sur la période.' : 'Vérité de période indisponible.'));
    }
    card.appendChild(table);
    const status = structure?.shared_allocation_applied ? `Quote-part ${marketCode} calculée par le moteur.` : 'Allocation fail-closed tant que la politique Market ID n’est pas gouvernée.';
    card.appendChild(el(doc, 'p', 'kmc-cockpit-card-foot', status));
    return card;
  }

  function principleCard(doc, marketCode) {
    const card = el(doc, 'aside', 'kmc-cockpit-principle');
    const head = el(doc, 'div', 'kmc-cockpit-principle-head');
    head.appendChild(el(doc, 'span', 'kmc-cockpit-cost-icon', '💡'));
    head.appendChild(el(doc, 'strong', '', 'Rappel du principe'));
    card.appendChild(head);
    const list = doc.createElement('ul');
    [
      'Le prix est borné par le marché.',
      'Les coûts variables déterminent l’espace de contribution.',
      'Les charges fixes sont couvertes collectivement par le portefeuille.',
      `Direct / mutualisé décrit le périmètre, jamais la nature de la charge.`,
      `Toute quote-part mutualisée est rattachée au Market ID ${marketCode}.`,
    ].forEach(text => {
      const item = doc.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    });
    card.appendChild(list);
    return card;
  }

  function createCostPilotage(doc, payload, marketCode, decision) {
    const groups = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []);
    const structure = decision?.coverage?.structure || null;
    const section = el(doc, 'section', 'kmc-cockpit-costs');
    section.appendChild(variableCostCard(doc, groups.variable, marketCode));
    section.appendChild(fixedDirectCard(doc, structure));
    section.appendChild(fixedMutualizedCard(doc, structure, marketCode));
    section.appendChild(principleCard(doc, marketCode));
    return section;
  }

  function corridorAmount(point, currency) {
    if (!point) return '—';
    return formatMoney(point.observed_amount, point.currency || currency);
  }

  function selectedAmount(corridor) {
    const selected = corridor?.selected || {};
    if (selected.local_amount != null) return formatMoney(selected.local_amount, selected.local_currency || corridor?.market?.currency);
    return formatKmf(selected.price_kmf);
  }

  function createPortfolioShell(doc, payload) {
    const section = el(doc, 'section', 'kmc-cockpit-portfolio');
    section.dataset.cockpitPortfolio = '';
    const head = el(doc, 'div', 'kmc-cockpit-portfolio-head');
    head.appendChild(el(doc, 'h3', '', 'Portefeuille produits'));
    const search = doc.createElement('input');
    search.type = 'search';
    search.placeholder = 'Rechercher un produit…';
    search.dataset.cockpitSearch = '';
    head.appendChild(search);
    section.appendChild(head);

    const tabs = el(doc, 'div', 'kmc-cockpit-tabs');
    tabs.dataset.cockpitTabs = '';
    const products = Array.isArray(payload.simulation_products) ? payload.simulation_products : [];
    const counts = new Map();
    products.forEach(product => counts.set(product.category || 'Autres', (counts.get(product.category || 'Autres') || 0) + 1));
    [...counts.entries()].forEach(([category, count], index) => {
      const button = el(doc, 'button', `kmc-cockpit-tab${index === 0 ? ' is-active' : ''}`, `${categoryLabel(category)} (${count})`);
      button.type = 'button';
      button.dataset.cockpitCategory = category;
      tabs.appendChild(button);
    });
    section.appendChild(tabs);

    const table = el(doc, 'div', 'kmc-cockpit-portfolio-table');
    table.dataset.cockpitPortfolioTable = '';
    section.appendChild(table);
    const detail = el(doc, 'div', 'kmc-cockpit-product-detail');
    detail.dataset.cockpitProductDetail = '';
    detail.appendChild(el(doc, 'div', 'kmc-cockpit-loading', 'Sélectionnez un produit pour lire sa décision économique.'));
    section.appendChild(detail);
    section.__products = products;
    section.__corridors = new Map();
    section.__activeCategory = counts.size ? [...counts.keys()][0] : null;
    return section;
  }

  function portfolioHeader(doc) {
    const headers = [
      'Produit', 'Coût d’achat', 'Coûts variables hors achat', 'Coût variable complet',
      'Borne basse', 'Cible', 'Borne haute', 'Prix final marché retenu', 'Contribution unitaire',
    ];
    const row = el(doc, 'div', 'kmc-cockpit-product-row is-head');
    headers.forEach(label => row.appendChild(tableCell(doc, label)));
    return row;
  }

  function portfolioLoadingRow(doc, product) {
    const row = el(doc, 'div', 'kmc-cockpit-product-row is-loading');
    row.dataset.productRef = product.product_ref;
    row.appendChild(tableCell(doc, product.name || product.product_ref));
    for (let i = 0; i < 8; i += 1) row.appendChild(tableCell(doc, '…', 'is-derived'));
    return row;
  }

  function portfolioProductRow(doc, product, corridor) {
    const row = el(doc, 'div', 'kmc-cockpit-product-row');
    row.dataset.productRef = product.product_ref;
    const economics = corridor?.selected?.economics || {};
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    row.appendChild(tableCell(doc, product.name || corridor?.product?.name || product.product_ref, 'is-product'));
    row.appendChild(tableCell(doc, formatKmf(corridor?.product?.purchase_cost_kmf), 'is-derived'));
    row.appendChild(tableCell(doc, formatKmf(economics.variable_cost_outside_purchase_kmf), 'is-derived'));
    row.appendChild(tableCell(doc, formatKmf(economics.variable_cost_complete_kmf), 'is-derived'));
    row.appendChild(tableCell(doc, corridorAmount(local.low, currency), 'is-derived'));
    row.appendChild(tableCell(doc, corridorAmount(local.target, currency), 'is-derived'));
    row.appendChild(tableCell(doc, corridorAmount(local.high, currency), 'is-derived'));
    const priceCell = tableCell(doc, '', 'is-price-decision');
    const priceButton = el(doc, 'button', 'kmc-cockpit-price-button', `${selectedAmount(corridor)}  ▾`);
    priceButton.type = 'button';
    priceButton.dataset.cockpitSelectProduct = product.product_ref;
    priceCell.appendChild(priceButton);
    row.appendChild(priceCell);
    row.appendChild(tableCell(doc, formatKmf(economics.contribution_unit_kmf), 'is-derived is-contribution'));
    return row;
  }

  async function fetchCorridor(workspace, options, productRef) {
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    return workspace.jsonRequest(options.fetch, `${endpoint}/corridor?product_ref=${encodeURIComponent(productRef)}`);
  }

  async function fetchDecision(workspace, options) {
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    return workspace.jsonRequest(options.fetch, `${endpoint}/decision`);
  }

  function detailMetric(doc, label, value, editable = false) {
    const row = el(doc, 'div', `kmc-cockpit-detail-metric${editable ? ' is-editable' : ' is-derived'}`);
    row.appendChild(el(doc, 'span', '', label));
    row.appendChild(el(doc, 'strong', '', value));
    return row;
  }

  function sensitivityCard(doc, corridor) {
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-sensitivity');
    card.appendChild(el(doc, 'h4', '', 'Sensibilité prix'));
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    const rows = [
      ['Basse', local.low], ['Cible', local.target], ['Haute', local.high],
    ];
    const table = el(doc, 'div', 'kmc-cockpit-sensitivity-table');
    rows.forEach(([label, point]) => {
      const row = el(doc, 'div', '');
      row.appendChild(el(doc, 'span', '', label));
      row.appendChild(el(doc, 'strong', '', corridorAmount(point, currency)));
      row.appendChild(el(doc, 'span', 'kmc-cockpit-arrow', '→'));
      row.appendChild(el(doc, 'strong', 'is-positive', formatKmf(point?.economics?.contribution_unit_kmf)));
      table.appendChild(row);
    });
    card.appendChild(table);
    card.appendChild(el(doc, 'p', 'kmc-cockpit-detail-note', 'Le moteur projette la contribution à chaque borne. Le navigateur n’effectue aucun recalcul économique.'));
    return card;
  }

  function marketDataCard(doc, corridor) {
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-market');
    card.appendChild(el(doc, 'h4', '', 'Données marché'));
    const local = corridor?.corridor?.local || {};
    const global = corridor?.corridor?.global_reference || {};
    const currency = corridor?.market?.currency || 'KMF';
    const localHead = el(doc, 'div', 'kmc-cockpit-market-head');
    localHead.appendChild(el(doc, 'strong', '', `${corridor?.market?.name || corridor?.market?.code || 'Marché'} · observé`));
    localHead.appendChild(badge(doc, local.sample_count ? 'Observé' : 'À alimenter', local.sample_count ? 'observed' : 'warning'));
    card.appendChild(localHead);
    card.appendChild(detailMetric(doc, 'Prix médian observé', corridorAmount(local.target, currency)));
    card.appendChild(detailMetric(doc, 'Nb. observations', formatNumber(local.sample_count)));
    card.appendChild(detailMetric(doc, 'Dernière observation', formatDate(local.observations?.[0]?.observed_at)));
    const globalBlock = el(doc, 'div', 'kmc-cockpit-global-reference');
    globalBlock.appendChild(el(doc, 'strong', '', '🌐 Référence globale · informative'));
    globalBlock.appendChild(el(doc, 'span', '', `Cible : ${corridorAmount(global.target, 'KMF')}`));
    globalBlock.appendChild(el(doc, 'small', '', 'Jamais utilisée silencieusement comme vérité locale.'));
    card.appendChild(globalBlock);
    return card;
  }

  function observationsEditor(doc, corridor, canManage) {
    const details = doc.createElement('details');
    details.className = 'kmc-cockpit-observations';
    details.appendChild(el(doc, 'summary', '', `Affiner les observations marché · ${formatNumber(corridor?.corridor?.local?.sample_count)}`));
    const observations = corridor?.corridor?.local?.observations || [];
    const list = el(doc, 'div', 'kmc-cockpit-observation-list');
    observations.forEach(item => {
      const row = el(doc, 'div', 'kmc-cockpit-observation-row');
      const copy = el(doc, 'div', '');
      copy.appendChild(el(doc, 'strong', '', `${item.competitor_name || 'Concurrent'} · ${formatMoney(item.observed_amount, item.currency)}`));
      copy.appendChild(el(doc, 'small', '', `${formatDate(item.observed_at)} · ${item.source || 'source non renseignée'}`));
      row.appendChild(copy);
      if (canManage && item.observation_ref) {
        const remove = el(doc, 'button', 'kmc-cockpit-outline-action', 'Retirer');
        remove.type = 'button';
        remove.dataset.cockpitDeactivateObservation = item.observation_ref;
        row.appendChild(remove);
      }
      list.appendChild(row);
    });
    if (!observations.length) list.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Aucune observation locale enregistrée.'));
    details.appendChild(list);
    if (canManage) {
      const form = doc.createElement('form');
      form.className = 'kmc-cockpit-observation-form';
      form.dataset.cockpitObservationForm = corridor?.product?.product_ref || '';
      form.innerHTML = '<input name="competitor_name" required placeholder="Concurrent / enseigne"><input name="amount" type="number" min="0.01" step="0.01" required placeholder="Prix observé"><input name="notes" placeholder="Source / contexte"><button type="submit" class="kmc-cockpit-outline-action">Ajouter</button>';
      details.appendChild(form);
    }
    return details;
  }

  function productDecisionCard(doc, corridor, canManage) {
    const economics = corridor?.selected?.economics || {};
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-product-decision');
    card.appendChild(el(doc, 'h4', '', 'Détail du produit'));
    const identity = el(doc, 'div', 'kmc-cockpit-product-identity');
    identity.appendChild(el(doc, 'strong', '', corridor?.product?.name || corridor?.product?.product_ref || 'Produit'));
    identity.appendChild(el(doc, 'small', '', `${corridor?.product?.product_ref || ''} · ${categoryLabel(corridor?.product?.category)}`));
    card.appendChild(identity);

    const metrics = el(doc, 'div', 'kmc-cockpit-detail-metrics');
    metrics.appendChild(detailMetric(doc, 'Coût d’achat', formatKmf(corridor?.product?.purchase_cost_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coûts variables hors achat', formatKmf(economics.variable_cost_outside_purchase_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coût variable complet', formatKmf(economics.variable_cost_complete_kmf)));
    metrics.appendChild(detailMetric(doc, 'Borne marché basse', corridorAmount(local.low, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché cible', corridorAmount(local.target, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché haute', corridorAmount(local.high, currency)));
    card.appendChild(metrics);

    const decision = el(doc, 'div', 'kmc-cockpit-final-price');
    decision.appendChild(el(doc, 'span', 'kmc-cockpit-final-price-label', 'Prix final marché retenu'));
    if (canManage) {
      const form = doc.createElement('form');
      form.dataset.cockpitPriceForm = corridor?.product?.product_ref || '';
      form.className = 'kmc-cockpit-final-price-form';
      const input = doc.createElement('input');
      input.type = 'number';
      input.name = 'amount';
      input.min = '0.01';
      input.step = '0.01';
      input.required = true;
      input.value = corridor?.selected?.local_amount != null ? corridor.selected.local_amount : '';
      input.placeholder = `Prix final ${currency}`;
      input.dataset.finalMarketPrice = '';
      const save = el(doc, 'button', 'kmc-cockpit-primary-action', 'Enregistrer');
      save.type = 'submit';
      form.appendChild(input);
      form.appendChild(save);
      const justification = doc.createElement('details');
      justification.className = 'kmc-cockpit-price-reason';
      justification.appendChild(el(doc, 'summary', '', 'Justification / trace'));
      const reason = doc.createElement('input');
      reason.name = 'reason';
      reason.minLength = 3;
      reason.value = 'Ajustement du prix final marché depuis Atelier économique';
      justification.appendChild(reason);
      form.appendChild(justification);
      decision.appendChild(form);
    } else {
      decision.appendChild(el(doc, 'strong', 'kmc-cockpit-readonly-price', selectedAmount(corridor)));
    }
    decision.appendChild(el(doc, 'small', '', 'C’est le levier de décision produit sur cette page. Les autres valeurs sont des vérités calculées ou des paramètres gérés dans leurs panneaux dédiés.'));
    card.appendChild(decision);
    card.appendChild(detailMetric(doc, 'Contribution unitaire', formatKmf(economics.contribution_unit_kmf)));

    const candidate = corridor?.candidate;
    if (canManage && candidate && !candidate.buyer_effective) {
      const gate = el(doc, 'button', 'kmc-cockpit-outline-action is-gate', 'Vérifier le gate et activer le prix retenu');
      gate.type = 'button';
      gate.dataset.cockpitActivatePrice = corridor?.product?.product_ref || '';
      card.appendChild(gate);
    }
    return card;
  }

  function renderProductDetail(doc, portfolio, corridor, canManage) {
    const detail = portfolio.querySelector('[data-cockpit-product-detail]');
    if (!detail) return;
    detail.replaceChildren();
    const grid = el(doc, 'div', 'kmc-cockpit-detail-grid');
    grid.appendChild(productDecisionCard(doc, corridor, canManage));
    grid.appendChild(sensitivityCard(doc, corridor));
    grid.appendChild(marketDataCard(doc, corridor));
    detail.appendChild(grid);
    detail.appendChild(observationsEditor(doc, corridor, canManage));
    detail.appendChild(el(doc, 'p', 'kmc-cockpit-calculated-note', 'ⓘ Les valeurs grisées sont calculées automatiquement par le moteur. Le prix final marché retenu est le levier de décision produit sur cette page.'));
    portfolio.__selectedProductRef = corridor?.product?.product_ref || null;
  }

  async function loadCategory(doc, workspace, options, payload, portfolio, category) {
    const table = portfolio.querySelector('[data-cockpit-portfolio-table]');
    if (!table) return;
    portfolio.__activeCategory = category;
    const searchValue = String(portfolio.querySelector('[data-cockpit-search]')?.value || '').trim().toLowerCase();
    const products = (portfolio.__products || [])
      .filter(product => (product.category || 'Autres') === category)
      .filter(product => !searchValue || `${product.name || ''} ${product.product_ref || ''}`.toLowerCase().includes(searchValue))
      .slice(0, MAX_CATEGORY_ROWS);
    table.replaceChildren(portfolioHeader(doc));
    products.forEach(product => table.appendChild(portfolioLoadingRow(doc, product)));
    if (!products.length) {
      table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Aucun produit dans cette catégorie.'));
      return;
    }

    const results = await Promise.all(products.map(async product => {
      try {
        const corridor = portfolio.__corridors.get(product.product_ref) || await fetchCorridor(workspace, options, product.product_ref);
        portfolio.__corridors.set(product.product_ref, corridor);
        return { product, corridor };
      } catch (error) {
        return { product, error };
      }
    }));

    results.forEach(result => {
      const current = table.querySelector(`[data-product-ref="${result.product.product_ref}"]`);
      if (!current) return;
      if (result.corridor) current.replaceWith(portfolioProductRow(doc, result.product, result.corridor));
      else current.replaceChildren(tableCell(doc, result.product.name || result.product.product_ref), tableCell(doc, `Indisponible · ${result.error?.message || 'erreur'}`, 'is-error'));
    });

    const first = results.find(result => result.corridor);
    if (first && (!portfolio.__selectedProductRef || !portfolio.__corridors.has(portfolio.__selectedProductRef))) {
      renderProductDetail(doc, portfolio, first.corridor, payload.capabilities?.local_strategy_owner === true);
    }
  }

  function createAdvancedDetails(doc, nodes) {
    const details = doc.createElement('details');
    details.className = 'kmc-cockpit-advanced';
    details.dataset.cockpitAdvanced = '';
    details.appendChild(el(doc, 'summary', '', 'Affiner les catégories de charges, hypothèses et preuves'));
    const body = el(doc, 'div', 'kmc-cockpit-advanced-body');
    nodes.forEach(node => body.appendChild(node));
    details.appendChild(body);
    return details;
  }

  function moveEquilibriumIntoCockpit(rootNode, cockpit) {
    const equilibrium = rootNode.querySelector('[data-pricing-flow-equilibrium]');
    if (!equilibrium) return;
    equilibrium.classList.add('kmc-flow-equilibrium-panel--cockpit');
    const label = Array.from(equilibrium.querySelectorAll('.kmc-flow-equilibrium-label')).find(node => node.textContent.trim() === 'Charges à couvrir');
    if (label) label.textContent = 'Charges structurelles à couvrir';
    cockpit.appendChild(equilibrium);
  }

  function buildCockpit(doc, rootNode, payload, marketCode, decision) {
    const cockpit = el(doc, 'div', 'kmc-economic-cockpit');
    cockpit.dataset[COCKPIT_ATTR] = '';
    moveEquilibriumIntoCockpit(rootNode, cockpit);
    cockpit.appendChild(createCostPilotage(doc, payload, marketCode, decision));
    cockpit.appendChild(createPortfolioShell(doc, payload));
    return cockpit;
  }

  function bindCockpit(rootObject, workspace, options, payload, cockpit, advanced) {
    const portfolio = cockpit.querySelector('[data-cockpit-portfolio]');
    if (!portfolio) return;
    const doc = options.document;
    const marketCode = options.requestedMarket || payload.scope?.market_code || 'Marché';

    cockpit.addEventListener('click', async event => {
      const openCosts = event.target.closest('[data-open-cost-detail]');
      if (openCosts) {
        advanced.open = true;
        advanced.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return;
      }

      const tab = event.target.closest('[data-cockpit-category]');
      if (tab) {
        cockpit.querySelectorAll('[data-cockpit-category]').forEach(node => node.classList.toggle('is-active', node === tab));
        await loadCategory(doc, workspace, options, payload, portfolio, tab.dataset.cockpitCategory);
        return;
      }

      const select = event.target.closest('[data-cockpit-select-product]');
      if (select) {
        const corridor = portfolio.__corridors.get(select.dataset.cockpitSelectProduct);
        if (corridor) {
          renderProductDetail(doc, portfolio, corridor, payload.capabilities?.local_strategy_owner === true);
          portfolio.querySelector('[data-cockpit-product-detail]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      const activate = event.target.closest('[data-cockpit-activate-price]');
      if (activate) {
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(activate.dataset.cockpitActivatePrice)}/local-price/activate`, {
            method: 'POST',
            body: { reason: 'Activation depuis Atelier économique après contrôle du gate serveur.', source: 'economic_cockpit' },
          });
          portfolio.__corridors.delete(activate.dataset.cockpitActivatePrice);
          await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
        } catch (error) {
          portfolio.querySelector('[data-cockpit-product-detail]')?.prepend(el(doc, 'div', 'kmc-cockpit-error', `Activation refusée : ${error.message}`));
        }
        return;
      }

      const remove = event.target.closest('[data-cockpit-deactivate-observation]');
      if (remove && portfolio.__selectedProductRef) {
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/price-observations/${encodeURIComponent(remove.dataset.cockpitDeactivateObservation)}/deactivate`, {
            method: 'POST', body: { reason: `Observation retirée du corridor ${marketCode} depuis Atelier économique.` },
          });
          portfolio.__corridors.delete(portfolio.__selectedProductRef);
          await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
        } catch (error) {
          portfolio.querySelector('[data-cockpit-product-detail]')?.prepend(el(doc, 'div', 'kmc-cockpit-error', `Retrait refusé : ${error.message}`));
        }
      }
    });

    cockpit.addEventListener('submit', async event => {
      const priceForm = event.target.closest('[data-cockpit-price-form]');
      if (priceForm) {
        event.preventDefault();
        const data = new FormData(priceForm);
        const amount = Number(data.get('amount'));
        const reason = String(data.get('reason') || '').trim() || 'Ajustement du prix final marché depuis Atelier économique';
        const productRef = priceForm.dataset.cockpitPriceForm;
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(productRef)}/local-price`, {
            method: 'POST', body: { amount, reason, source: 'economic_cockpit_final_market_price' },
          });
          portfolio.__corridors.delete(productRef);
          await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
        } catch (error) {
          priceForm.closest('.kmc-cockpit-detail-card')?.prepend(el(doc, 'div', 'kmc-cockpit-error', `Décision refusée : ${error.message}`));
        }
        return;
      }

      const observationForm = event.target.closest('[data-cockpit-observation-form]');
      if (observationForm) {
        event.preventDefault();
        const data = new FormData(observationForm);
        const productRef = observationForm.dataset.cockpitObservationForm;
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/price-observations`, {
            method: 'POST',
            body: {
              product_ref: productRef,
              competitor_name: data.get('competitor_name'),
              amount: Number(data.get('amount')),
              notes: data.get('notes') || null,
              source: 'economic_cockpit_market_observation',
            },
          });
          portfolio.__corridors.delete(productRef);
          await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
        } catch (error) {
          observationForm.closest('.kmc-cockpit-observations')?.prepend(el(doc, 'div', 'kmc-cockpit-error', `Observation refusée : ${error.message}`));
        }
      }
    });

    const search = cockpit.querySelector('[data-cockpit-search]');
    search?.addEventListener('input', () => loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory));
  }

  async function enhance(rootObject, workspace, options, payload) {
    if (!options?.requestedMarket || !options.root || !options.document || !payload) return false;
    if (options.root.querySelector('[data-pricing-economic-cockpit]')) return true;
    const workshop = findWorkshop(options.root);
    if (!workshop) return false;
    const title = workshop.querySelector('.kmc-section-title');
    if (title) title.textContent = 'Atelier économique';
    const description = workshop.querySelector('.kmc-section-description');
    if (description) description.textContent = 'Pilotez votre rentabilité en temps réel. Toute modification est automatiquement recalculée par le moteur.';
    const slot = workshop.querySelector('[data-section-slot]') || workshop.querySelector('.kmc-section-body') || workshop;
    const existing = Array.from(slot.children).filter(node => !node.matches?.('[data-pricing-flow-equilibrium]'));
    const advancedNodes = existing.filter(node => !node.classList?.contains('kmc-cost-formula') && !node.matches?.('[data-pricing-decision-chain]'));
    let decision = null;
    try { decision = await fetchDecision(workspace, options); } catch (_) { decision = null; }
    const cockpit = buildCockpit(options.document, options.root, payload, options.requestedMarket || payload.scope?.market_code || 'Marché', decision);
    const advanced = createAdvancedDetails(options.document, advancedNodes);
    slot.replaceChildren(cockpit, advanced);
    bindCockpit(rootObject, workspace, options, payload, cockpit, advanced);
    const portfolio = cockpit.querySelector('[data-cockpit-portfolio]');
    if (portfolio?.__activeCategory) await loadCategory(options.document, workspace, options, payload, portfolio, portfolio.__activeCategory);
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__economicCockpitInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function economicCockpitAwareMount(options) {
      const payload = await originalMount(options);
      await enhance(rootObject, workspace, options, payload);
      return payload;
    };
    workspace.__economicCockpitInstalled = true;
    return true;
  }

  return {
    classifyComponents,
    economicNature,
    allocationPerimeter,
    createCostPilotage,
    createPortfolioShell,
    portfolioProductRow,
    renderProductDetail,
    enhance,
    install,
  };
});
