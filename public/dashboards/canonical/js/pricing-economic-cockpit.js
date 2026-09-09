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
    if (actionText) {
      const action = el(doc, 'button', 'kmc-cockpit-outline-action', actionText);
      action.type = 'button';
      action.dataset.openCostDetail = actionKey;
      head.appendChild(action);
    }
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
    else {
      const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row');
      totalRow.appendChild(tableCell(doc, 'Coût variable complet (ex. moyen)', 'is-total-label'));
      const totalValue = components.reduce((sum, c) => sum + (Number(c.default_value) || 0), 0);
      totalRow.appendChild(tableCell(doc, formatKmf(totalValue), 'is-total-value'));
      table.appendChild(totalRow);
    }
    card.appendChild(table);
    return card;
  }

  function fixedDirectCard(doc, structure) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-direct');
    card.dataset.costSummary = 'fixed-direct';
    card.appendChild(costCardHeader(doc, '🏠', 'Charges fixes directes', 'Charges structurelles propres au marché.'));
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
    else {
      const totalDirect = rows.reduce((sum, item) => sum + (Number(item.recognized_amount_kmf) || 0), 0);
      const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row');
      totalRow.appendChild(tableCell(doc, 'Total fixes directes', 'is-total-label'));
      totalRow.appendChild(tableCell(doc, formatKmf(totalDirect), 'is-total-value'));
      table.appendChild(totalRow);
    }
    card.appendChild(table);
    return card;
  }

  function fixedMutualizedCard(doc, structure, marketCode) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-mutualized');
    card.dataset.costSummary = 'fixed-mutualized';
    card.appendChild(costCardHeader(doc, '🔗', 'Charges fixes mutualisées', 'Pools structurels partagés, alloués par Market ID.', 'Gérer les mutualisations', 'fixed-mutualized'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-mutualized');
    ['Élément', 'Coût global (FCFA)', 'Clé d\u2019allocation', '%', `Quote-part ${marketCode}`].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));
    const charges = Array.isArray(structure?.allocation?.charges) ? structure.allocation.charges : [];
    charges.slice(0, 6).forEach(charge => {
      table.appendChild(tableCell(doc, charge.charge_name || charge.charge_family || 'Charge mutualisée'));
      table.appendChild(tableCell(doc, formatKmf(charge.group_pool_kmf), 'is-derived'));
      const policy = charge.policy;
      table.appendChild(tableCell(doc, policy ? (policy.basis_kind || '\u2014') : 'Politique manquante', 'is-derived'));
      const ratioText = charge.market_allocation_ratio != null ? `${formatNumber(Number(charge.market_allocation_ratio) * 100)} %` : '\u2014';
      table.appendChild(tableCell(doc, ratioText, 'is-derived'));
      const shareText = charge.market_share_kmf == null ? '\u00c0 gouverner' : formatKmf(charge.market_share_kmf);
      table.appendChild(tableCell(doc, shareText, `is-derived ${charge.market_share_kmf == null ? '' : 'is-market-share'}`.trim()));
    });
    const groupPool = finite(structure?.group_pool_kmf);
    if (!charges.length && groupPool != null && groupPool !== 0) {
      table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Pool mutualisé réel présent, mais politique d\u2019allocation non décisionnelle : aucune quote-part n\u2019est inventée.'));
    } else if (!charges.length) {
      table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', structure ? 'Aucune charge fixe mutualisée reconnue sur la période.' : 'Vérité de période indisponible.'));
    }
    if (charges.length) {
      const totalMut = charges.reduce((sum, c) => sum + (Number(c.market_share_kmf) || 0), 0);
      const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row is-mutualized');
      totalRow.appendChild(tableCell(doc, 'Total fixes mutualisées (imputé au marché)', 'is-total-label'));
      totalRow.appendChild(tableCell(doc, formatKmf(totalMut), 'is-total-value'));
      table.appendChild(totalRow);
    }
    card.appendChild(table);
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
      `Toute quote-part mutualisée est calculée par Market ID.`,
      'Les charges mutualisées peuvent aussi être variables (ex. fret, SAV).',
    ].forEach(text => {
      const item = doc.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    });
    card.appendChild(list);
    const docLink = el(doc, 'a', 'kmc-cockpit-principle-link', 'Voir la documentation \u2197');
    docLink.href = '/admin/docs/pricing-doctrine';
    docLink.target = '_blank';
    card.appendChild(docLink);
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
    const headActions = el(doc, 'div', 'kmc-cockpit-portfolio-head-actions');
    const search = doc.createElement('input');
    search.type = 'search';
    search.placeholder = 'Rechercher un produit…';
    search.dataset.cockpitSearch = '';
    headActions.appendChild(search);
    const addBtn = el(doc, 'button', 'kmc-cockpit-outline-action is-add', '+ Ajouter un produit');
    addBtn.type = 'button';
    addBtn.dataset.cockpitAddProduct = '';
    headActions.appendChild(addBtn);
    head.appendChild(headActions);
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
      'SKU', 'Coût d\u2019achat\n(FCFA)', 'Coûts variables\nhors achat (FCFA)', 'Coût variable\ncomplet (FCFA)',
      'Borne marché (FCFA)\nBasse', 'Cible', 'Haute',
      'Prix retenu\n(FCFA)', 'Contribution\nunitaire (FCFA)', 'Qté vendue', 'Contribution totale\n(FCFA)', '',
    ];
    const row = el(doc, 'div', 'kmc-cockpit-product-row is-head');
    headers.forEach(label => row.appendChild(tableCell(doc, label)));
    return row;
  }

  function portfolioLoadingRow(doc, product) {
    const row = el(doc, 'div', 'kmc-cockpit-product-row is-loading');
    row.dataset.productRef = product.product_ref;
    row.appendChild(tableCell(doc, product.name || product.product_ref));
    for (let i = 0; i < 10; i += 1) row.appendChild(tableCell(doc, '…', 'is-derived'));
    row.appendChild(tableCell(doc, ''));
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
    const priceButton = el(doc, 'button', 'kmc-cockpit-price-button', `${selectedAmount(corridor)}  \u25be`);
    priceButton.type = 'button';
    priceButton.dataset.cockpitSelectProduct = product.product_ref;
    priceCell.appendChild(priceButton);
    row.appendChild(priceCell);
    row.appendChild(tableCell(doc, formatKmf(economics.contribution_unit_kmf), 'is-derived is-contribution'));
    const qtySold = finite(economics.quantity_sold) ?? finite(product.quantity_sold) ?? 0;
    row.appendChild(tableCell(doc, formatNumber(qtySold), 'is-derived'));
    const contribTotal = finite(economics.contribution_unit_kmf) != null && qtySold ? formatKmf(economics.contribution_unit_kmf * qtySold) : '\u2014';
    row.appendChild(tableCell(doc, contribTotal, 'is-derived is-contribution'));
    const menu = el(doc, 'button', 'kmc-cockpit-row-menu', '\u22ef');
    menu.type = 'button';
    menu.dataset.cockpitRowMenu = product.product_ref;
    row.appendChild(tableCell(doc, ''));
    row.lastChild.appendChild(menu);
    return row;
  }

  async function fetchCorridor(workspace, options, productRef) {
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    return workspace.jsonRequest(options.fetch, `${endpoint}/corridor?product_ref=${encodeURIComponent(productRef)}`);
  }

  async function fetchDecision(workspace, options, period) {
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    return workspace.jsonRequest(options.fetch, `${endpoint}/decision${qs}`);
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
    const selectedContrib = finite(corridor?.selected?.economics?.contribution_unit_kmf);
    const points = [
      ['Basse', local.low], ['Cible', local.target], ['Haute', local.high],
    ];

    const table = el(doc, 'div', 'kmc-cockpit-sensitivity-table');
    const headerRow = el(doc, 'div', 'is-head');
    headerRow.appendChild(el(doc, 'span', '', 'Prix de vente'));
    headerRow.appendChild(el(doc, 'span', '', 'Contribution unitaire'));
    headerRow.appendChild(el(doc, 'span', '', 'Écart vs. actuel'));
    table.appendChild(headerRow);

    points.forEach(([label, point]) => {
      const price = finite(point?.observed_amount);
      const contrib = finite(point?.economics?.contribution_unit_kmf);
      const row = el(doc, 'div', '');
      row.appendChild(el(doc, 'strong', '', price != null ? formatKmf(price) : '—'));
      row.appendChild(el(doc, 'strong', 'is-positive', contrib != null ? formatKmf(contrib) : '—'));
      let ecartText = '—';
      let ecartCls = '';
      if (contrib != null && selectedContrib != null) {
        const diff = contrib - selectedContrib;
        ecartText = (diff >= 0 ? '+' : '') + formatKmf(diff);
        ecartCls = diff >= 0 ? 'is-positive' : 'is-negative';
      }
      row.appendChild(el(doc, 'span', ecartCls, ecartText));
      table.appendChild(row);
    });
    card.appendChild(table);
    card.appendChild(el(doc, 'p', 'kmc-cockpit-detail-note', 'Le prix marché retenu est le levier de décision sur cette page. La contribution varie en fonction du prix.'));
    return card;
  }

  function marketDataCard(doc, corridor) {
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-market');
    const cardTitle = el(doc, 'h4', 'kmc-cockpit-detail-card-title');
    cardTitle.appendChild(el(doc, 'span', 'kmc-cockpit-detail-card-icon is-blue', '📊'));
    cardTitle.appendChild(el(doc, 'span', '', 'Données marché'));
    card.appendChild(cardTitle);
    const local = corridor?.corridor?.local || {};
    const global = corridor?.corridor?.global_reference || {};
    const currency = corridor?.market?.currency || 'KMF';
    const localHead = el(doc, 'div', 'kmc-cockpit-market-head');
    localHead.appendChild(el(doc, 'strong', '', `${corridor?.market?.name || corridor?.market?.code || 'Marché'} (observé)`));
    localHead.appendChild(badge(doc, local.sample_count ? 'Observé' : 'À alimenter', local.sample_count ? 'observed' : 'warning'));
    card.appendChild(localHead);
    card.appendChild(detailMetric(doc, 'Prix moyen observé', corridorAmount(local.target, currency)));
    card.appendChild(detailMetric(doc, 'Nb. observations', formatNumber(local.sample_count)));
    card.appendChild(detailMetric(doc, 'Dernière mise à jour', formatDate(local.observations?.[0]?.observed_at)));
    const globalBlock = el(doc, 'div', 'kmc-cockpit-global-reference');
    const globalTitle = el(doc, 'strong', 'kmc-cockpit-global-reference-title');
    globalTitle.appendChild(el(doc, 'span', 'kmc-cockpit-detail-card-icon is-blue', '🌐'));
    globalTitle.appendChild(el(doc, 'span', '', 'Référence globale (informative)'));
    globalBlock.appendChild(globalTitle);
    globalBlock.appendChild(detailMetric(doc, 'Prix moyen global', corridorAmount(global.target, 'KMF')));
    globalBlock.appendChild(el(doc, 'small', '', 'Non utilisée comme vérité locale.'));
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
    card.appendChild(el(doc, 'h4', '', 'Détail d\'un produit'));
    const identity = el(doc, 'div', 'kmc-cockpit-product-identity');
    const imageUrl = corridor?.product?.image_url || corridor?.product?.thumbnail_url;
    if (imageUrl) {
      const img = doc.createElement('img');
      img.className = 'kmc-cockpit-product-image';
      img.src = imageUrl;
      img.alt = corridor?.product?.name || '';
      img.loading = 'lazy';
      identity.appendChild(img);
    } else {
      const placeholder = el(doc, 'div', 'kmc-cockpit-product-image-placeholder', '📦');
      identity.appendChild(placeholder);
    }
    const identityCopy = el(doc, 'div', 'kmc-cockpit-product-identity-copy');
    identityCopy.appendChild(el(doc, 'strong', '', corridor?.product?.name || corridor?.product?.product_ref || 'Produit'));
    identityCopy.appendChild(el(doc, 'small', '', `SKU : ${corridor?.product?.product_ref || ''}`));
    identityCopy.appendChild(el(doc, 'small', '', `Catégorie : ${categoryLabel(corridor?.product?.category)}`));
    const viewLink = el(doc, 'a', 'kmc-cockpit-product-link', 'Voir la fiche complète ↗');
    viewLink.href = `/admin/products/${encodeURIComponent(corridor?.product?.product_ref || '')}`;
    viewLink.target = '_blank';
    identityCopy.appendChild(viewLink);
    identity.appendChild(identityCopy);
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
      input.dataset.originalValue = input.value;
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
    portfolio.__selectedProductRef = corridor?.product?.product_ref || null;
  }

  async function loadCategory(doc, workspace, options, payload, portfolio, category) {
    const table = portfolio.querySelector('[data-cockpit-portfolio-table]');
    if (!table) return;
    portfolio.__activeCategory = category;
    const searchValue = String(portfolio.querySelector('[data-cockpit-search]')?.value || '').trim().toLowerCase();
    const effectiveLimit = portfolio.__categoryLimitOverride || MAX_CATEGORY_ROWS;
    const products = (portfolio.__products || [])
      .filter(product => (product.category || 'Autres') === category)
      .filter(product => !searchValue || `${product.name || ''} ${product.product_ref || ''}`.toLowerCase().includes(searchValue))
      .slice(0, effectiveLimit);
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

    // Totals row
    let totalQty = 0, totalContrib = 0;
    results.forEach(r => {
      if (!r.corridor) return;
      const eco = r.corridor?.selected?.economics || {};
      const qty = Number(eco.quantity_sold ?? r.product.quantity_sold ?? 0);
      const unit = Number(eco.contribution_unit_kmf ?? 0);
      totalQty += qty;
      totalContrib += unit * qty;
    });
    const totalsRow = el(doc, 'div', 'kmc-cockpit-product-row is-totals');
    for (let i = 0; i < 9; i++) totalsRow.appendChild(tableCell(doc, ''));
    totalsRow.appendChild(tableCell(doc, formatNumber(totalQty), 'is-total-value'));
    totalsRow.appendChild(tableCell(doc, formatKmf(totalContrib), 'is-total-value'));
    totalsRow.appendChild(tableCell(doc, ''));
    table.appendChild(totalsRow);

    // "Voir tous les produits" link
    const allProducts = (portfolio.__products || []).filter(p => (p.category || 'Autres') === category);
    if (allProducts.length > effectiveLimit) {
      const overflow = el(doc, 'div', 'kmc-cockpit-portfolio-overflow');
      overflow.appendChild(el(doc, 'span', '', `… ${allProducts.length - effectiveLimit} autres produits`));
      const viewAll = el(doc, 'a', 'kmc-cockpit-view-all', 'Voir tous les produits →');
      viewAll.href = '#';
      viewAll.dataset.cockpitViewAll = category;
      overflow.appendChild(viewAll);
      table.appendChild(overflow);
    }

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

  function styleEquilibriumForCockpit(equilibrium) {
    if (!equilibrium) return equilibrium;
    equilibrium.classList.add('kmc-flow-equilibrium-panel--cockpit');
    const label = Array.from(equilibrium.querySelectorAll('.kmc-flow-equilibrium-label')).find(node => node.textContent.trim() === 'Charges à couvrir');
    if (label) label.textContent = 'Charges structurelles à couvrir';
    return equilibrium;
  }

  function buildCockpitHeader(doc, payload, decision) {
    const header = el(doc, 'div', 'kmc-cockpit-page-header');
    const left = el(doc, 'div', 'kmc-cockpit-page-header-left');
    left.appendChild(el(doc, 'h2', 'kmc-cockpit-page-title', 'Atelier économique'));
    left.appendChild(el(doc, 'p', 'kmc-cockpit-page-subtitle', 'Pilotez votre rentabilité en temps réel. Toute modification est automatiquement recalculée.'));
    header.appendChild(left);

    const right = el(doc, 'div', 'kmc-cockpit-page-header-right');
    const periodWrap = el(doc, 'div', 'kmc-cockpit-period-wrap');
    periodWrap.appendChild(el(doc, 'span', 'kmc-cockpit-period-label', 'Période'));
    const periodSelect = doc.createElement('select');
    periodSelect.className = 'kmc-cockpit-period-select';
    periodSelect.dataset.cockpitPeriod = '';
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);
      const opt = doc.createElement('option');
      opt.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
      if (i === 0) opt.selected = true;
      periodSelect.appendChild(opt);
    }
    periodWrap.appendChild(periodSelect);
    right.appendChild(periodWrap);

    const badge = el(doc, 'div', 'kmc-cockpit-live-badge');
    badge.dataset.cockpitLiveBadge = '';
    badge.appendChild(el(doc, 'strong', '', 'Données réelles'));
    const ts = decision?.evaluated_at;
    const ago = ts ? timeSince(new Date(ts)) : 'temps réel';
    const badgeTime = el(doc, 'small', '', `Mises à jour ${ago}`);
    badgeTime.dataset.cockpitLiveBadgeTime = '';
    badge.appendChild(badgeTime);
    right.appendChild(badge);
    header.appendChild(right);
    return header;
  }

  function timeSince(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'à l\'instant';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `il y a ${hours}h`;
  }

  function buildCockpit(doc, rootNode, payload, marketCode, decision) {
    const cockpit = el(doc, 'div', 'kmc-economic-cockpit');
    cockpit.dataset[COCKPIT_ATTR] = '';
    cockpit.appendChild(buildCockpitHeader(doc, payload, decision));
    moveEquilibriumIntoCockpit(rootNode, cockpit);
    cockpit.appendChild(createCostPilotage(doc, payload, marketCode, decision));
    cockpit.appendChild(createPortfolioShell(doc, payload));
    cockpit.appendChild(buildCockpitFooter(doc));
    return cockpit;
  }

  function buildCockpitFooter(doc) {
    const footer = el(doc, 'div', 'kmc-cockpit-footer');
    const info = el(doc, 'div', 'kmc-cockpit-footer-info');
    info.appendChild(el(doc, 'span', 'kmc-cockpit-footer-info-icon', 'ⓘ'));
    const note = el(doc, 'span', '', 'Les valeurs grisées sont calculées automatiquement par le moteur. Le prix final marché retenu est le levier de décision sur cette page.');
    note.dataset.cockpitFooterNote = '';
    info.appendChild(note);
    footer.appendChild(info);
    const save = el(doc, 'button', 'kmc-cockpit-footer-save', '✓ Enregistrer les ajustements');
    save.type = 'button';
    save.dataset.cockpitSaveAll = '';
    footer.appendChild(save);
    return footer;
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
        portfolio.__categoryLimitOverride = null;
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
        return;
      }

      const addProduct = event.target.closest('[data-cockpit-add-product]');
      if (addProduct) {
        rootObject.location.href = '/admin/workspaces/catalog?intent=create-product';
        return;
      }

      const viewAll = event.target.closest('[data-cockpit-view-all]');
      if (viewAll) {
        event.preventDefault();
        portfolio.__categoryLimitOverride = Infinity;
        await loadCategory(doc, workspace, options, payload, portfolio, viewAll.dataset.cockpitViewAll);
        return;
      }

      const rowMenu = event.target.closest('[data-cockpit-row-menu]');
      if (rowMenu) {
        const corridor = portfolio.__corridors.get(rowMenu.dataset.cockpitRowMenu);
        if (corridor) {
          renderProductDetail(doc, portfolio, corridor, payload.capabilities?.local_strategy_owner === true);
          portfolio.querySelector('[data-cockpit-product-detail]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      const saveAll = event.target.closest('[data-cockpit-save-all]');
      if (saveAll) {
        const dirtyForms = Array.from(cockpit.querySelectorAll('[data-cockpit-price-form].is-dirty'));
        const footerNote = cockpit.querySelector('[data-cockpit-footer-note]');
        if (!dirtyForms.length) {
          if (footerNote) footerNote.textContent = 'Aucun ajustement en attente.';
          return;
        }
        saveAll.disabled = true;
        const originalLabel = saveAll.textContent;
        saveAll.textContent = '⏳ Enregistrement…';
        let savedCount = 0;
        let firstError = null;
        for (const form of dirtyForms) {
          const data = new FormData(form);
          const amount = Number(data.get('amount'));
          const reason = String(data.get('reason') || '').trim() || 'Ajustement du prix final marché depuis Atelier économique';
          const productRef = form.dataset.cockpitPriceForm;
          const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
          try {
            await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(productRef)}/local-price`, {
              method: 'POST', body: { amount, reason, source: 'economic_cockpit_final_market_price' },
            });
            portfolio.__corridors.delete(productRef);
            savedCount += 1;
          } catch (error) {
            firstError = error;
            break;
          }
        }
        saveAll.disabled = false;
        saveAll.textContent = originalLabel;
        await loadCategory(doc, workspace, options, payload, portfolio, portfolio.__activeCategory);
        if (footerNote) {
          footerNote.textContent = firstError
            ? `Échec après ${savedCount} ligne${savedCount > 1 ? 's' : ''} enregistrée${savedCount > 1 ? 's' : ''} · ${firstError.message}`
            : `${savedCount} ajustement${savedCount > 1 ? 's' : ''} enregistré${savedCount > 1 ? 's' : ''}.`;
        }
        return;
      }
    });

    cockpit.addEventListener('input', event => {
      const priceInput = event.target.closest('[data-final-market-price]');
      if (!priceInput) return;
      const form = priceInput.closest('[data-cockpit-price-form]');
      if (!form) return;
      const isDirty = priceInput.dataset.originalValue !== priceInput.value;
      form.classList.toggle('is-dirty', isDirty);
      const footerNote = cockpit.querySelector('[data-cockpit-footer-note]');
      if (footerNote) footerNote.textContent = isDirty ? 'Modifications non enregistrées.' : 'Les valeurs grisées sont calculées automatiquement par le moteur. Le prix final marché retenu est le levier de décision sur cette page.';
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

    const periodSelect = cockpit.querySelector('[data-cockpit-period]');
    periodSelect?.addEventListener('change', async () => {
      const period = periodSelect.value;
      periodSelect.disabled = true;
      let newDecision;
      try {
        newDecision = await fetchDecision(workspace, options, period);
      } catch (error) {
        periodSelect.disabled = false;
        const badgeTime = cockpit.querySelector('[data-cockpit-live-badge-time]');
        if (badgeTime) badgeTime.textContent = `Erreur de chargement · ${error.message}`;
        return;
      }
      periodSelect.disabled = false;

      const badgeTime = cockpit.querySelector('[data-cockpit-live-badge-time]');
      if (badgeTime) {
        const ts = newDecision?.evaluated_at;
        badgeTime.textContent = `Mises à jour ${ts ? timeSince(new Date(ts)) : 'temps réel'}`;
      }

      const oldCosts = cockpit.querySelector('.kmc-cockpit-costs');
      if (oldCosts) oldCosts.replaceWith(createCostPilotage(doc, payload, marketCode, newDecision));

      const oldEquilibrium = cockpit.querySelector('.kmc-flow-equilibrium-panel--cockpit');
      if (oldEquilibrium && rootObject.KomercePricingEquilibriumPanel?.buildPanel) {
        const newEquilibrium = styleEquilibriumForCockpit(rootObject.KomercePricingEquilibriumPanel.buildPanel(doc, workspace, newDecision));
        oldEquilibrium.replaceWith(newEquilibrium);
      }
    });
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
    // Le cockpit affiche son propre header (titre + sous-titre + période + badge),
    // fidèle au mock. Le header générique de la section ('.kmc-section-header')
    // ferait doublon à l'écran : on le masque plutôt que le supprimer, pour
    // préserver le texte pour tout consommateur non visuel et ne rien casser
    // dans findWorkshop (qui lit ce titre au premier passage).
    const outerHeader = workshop.querySelector('.kmc-section-header');
    if (outerHeader) outerHeader.classList.add('kmc-cockpit-outer-header-hidden');
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
