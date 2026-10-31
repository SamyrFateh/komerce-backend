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
    if (value == null || value === '') return null;
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

  function marketFlagEmoji(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return '';
    const base = 0x1f1e6;
    return String.fromCodePoint(...[...normalized].map(letter => base + letter.charCodeAt(0) - 65));
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

  function costCardHeader(doc, icon, title, subtitle, actionText, actionKey, disabledHint) {
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

  function variableMarketShare(component) {
    if (allocationPerimeter(component) !== 'mutualized') return '—';
    const explicit = finite(component.market_share_kmf ?? component.market_quote_kmf ?? component.effective_market_share_kmf);
    return explicit == null ? componentValue(component) : formatKmf(explicit);
  }

  // Preview cards intentionally reuse server-sourced figures; no totals from
  // mixed units and no implicit fallback to 0 for missing values.
  function economicPreview(doc, items, footer) {
    const preview = el(doc, 'div', 'kmc-economic-family-preview');
    preview.dataset.costFamilyPreview = '';
    const list = el(doc, 'div', 'kmc-economic-family-preview-list');
    items.slice(0, 4).forEach(item => {
      const row = el(doc, 'div', 'kmc-economic-family-preview-row');
      const label = el(doc, 'span', 'kmc-economic-family-preview-label', item.label);
      const value = el(doc, 'strong', 'kmc-economic-family-preview-value', item.value);
      row.appendChild(label);
      row.appendChild(value);
      if (item.note) row.appendChild(el(doc, 'small', 'kmc-economic-family-preview-note', item.note));
      if (item.editKey) {
        row.dataset.inlineCostRow = item.editKey;
        const edit = el(doc, 'button', 'kmc-inline-cost-action', 'Modifier');
        edit.type = 'button';
        edit.dataset.editInlineCost = item.editKey;
        edit.setAttribute('aria-label', `Modifier ${item.label}, valeur actuelle ${item.value}`);
        row.appendChild(edit);
      } else if (item.chargeId) {
        const edit = el(doc, 'button', 'kmc-inline-cost-action', 'Justifier / corriger');
        edit.type = 'button';
        edit.dataset.editStructureCharge = String(item.chargeId);
        edit.setAttribute('aria-label', `Corriger la charge ${item.label} avec justificatif`);
        row.appendChild(edit);
      }
      list.appendChild(row);
    });
    if (!items.length) list.appendChild(el(doc, 'p', 'kmc-economic-family-preview-empty', 'Données de période indisponibles.'));
    preview.appendChild(list);
    if (items.length > 4) preview.appendChild(el(doc, 'small', 'kmc-economic-family-preview-extra', `+ ${items.length - 4} autre(s) poste(s) dans le détail`));
    if (footer) preview.appendChild(el(doc, 'div', 'kmc-economic-family-preview-footer', footer));
    const detail = el(doc, 'button', 'kmc-economic-family-expand', 'Voir le détail');
    detail.type = 'button';
    detail.dataset.expandCostFamily = '';
    detail.setAttribute('aria-expanded', 'false');
    preview.appendChild(detail);
    return preview;
  }

  function variableCostCard(doc, components, canManage) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-variable');
    card.dataset.costSummary = 'variable';
    card.appendChild(costCardHeader(doc, '🛒', 'Coûts variables', 'Valeur actuelle et modification directe de chaque poste.'));

    const previewItems = [
      { label: 'Achat fournisseur', value: 'Par produit', note: 'Sans montant forfaitaire inventé' },
      ...components.map(component => ({
        label: component.label || component.key,
        value: componentValue(component),
        editKey: canManage && component.key ? component.key : null,
        note: component.inherited === false ? 'Paramètre marché'
          : component.inherited === true ? 'Base globale héritée' : 'Origine à confirmer',
      })),
    ];
    card.appendChild(economicPreview(doc, previewItems, 'Coût variable complet calculé sur chaque produit'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-variable');
    ['Élément', 'Nature', 'Périmètre', 'Clé d’allocation', 'Valeur', 'Provenance', 'Quote-part marché'].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));

    // Le mock rappelle explicitement que l'achat fournisseur est un coût
    // variable direct. Sa valeur reste produit-spécifique : aucune moyenne
    // portefeuille n'est inventée ici.
    table.appendChild(tableCell(doc, 'Achat fournisseur'));
    const purchaseNature = tableCell(doc, '', 'is-badge-cell');
    purchaseNature.appendChild(badge(doc, 'Variable', 'variable'));
    table.appendChild(purchaseNature);
    const purchasePerimeter = tableCell(doc, '', 'is-badge-cell');
    purchasePerimeter.appendChild(badge(doc, 'Direct', 'direct'));
    table.appendChild(purchasePerimeter);
    table.appendChild(tableCell(doc, '—', 'is-derived'));
    table.appendChild(tableCell(doc, 'Par produit', 'is-derived'));
    table.appendChild(tableCell(doc, '—', 'is-derived'));
    table.appendChild(tableCell(doc, '—', 'is-derived'));

    components.forEach(component => {
      const perimeter = allocationPerimeter(component);
      table.appendChild(tableCell(doc, component.label || component.key));
      const natureCell = tableCell(doc, '', 'is-badge-cell');
      natureCell.appendChild(badge(doc, 'Variable', 'variable'));
      table.appendChild(natureCell);
      const perimeterCell = tableCell(doc, '', 'is-badge-cell');
      perimeterCell.appendChild(badge(doc, perimeter === 'mutualized' ? 'Mutualisé' : 'Direct', perimeter === 'mutualized' ? 'mutualized' : 'direct'));
      table.appendChild(perimeterCell);
      table.appendChild(tableCell(doc, allocationLabel(component.allocation_method), 'is-derived'));
      table.appendChild(tableCell(doc, componentValue(component), 'is-derived'));
      const provenance = component.inherited === false ? 'Surcharge pays' : component.inherited === true ? 'Global hérité' : '—';
      // L4/Q6 : un frais de paiement hérité du global n'est pas réputé applicable au marché tant que sa configuration n'est pas vérifiée.
      const paymentNotVerified = component.inherited === true && component.category === 'payment';
      const origin = tableCell(doc, paymentNotVerified ? `${provenance} · Applicabilité non vérifiée pour ce marché` : provenance, 'is-derived');
      if (component.base_default_value != null) origin.appendChild(el(doc, 'small', 'kmc-economic-global-value', `Base globale : ${componentValue(component, true)} · lecture seule`));
      table.appendChild(origin);
      table.appendChild(tableCell(doc, variableMarketShare(component), 'is-derived'));
    });

    const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row');
    totalRow.appendChild(tableCell(doc, 'Coût variable complet (ex. moyen)', 'is-total-label'));
    // Une somme de composantes hétérogènes (% / commande / poids / valeur)
    // serait économiquement fausse. Le total exact reste calculé par SKU dans
    // le portefeuille, comme dans le mock.
    totalRow.appendChild(tableCell(doc, 'Calculé par produit', 'is-total-value is-textual'));
    table.appendChild(totalRow);
    card.appendChild(table);
    return card;
  }

  function fixedDirectCard(doc, structure, canManage) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-direct');
    card.dataset.costSummary = 'fixed-direct';
    card.appendChild(costCardHeader(doc, '🏠', 'Charges fixes directes', 'Ajustements tracés par période et justificatif.'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-direct');
    table.appendChild(tableCell(doc, 'Élément', 'is-head'));
    table.appendChild(tableCell(doc, 'Montant / mois', 'is-head'));
    const rows = Array.isArray(structure?.evidence)
      ? structure.evidence.filter(item => item.scope_kind === 'MARKET_DIRECT')
      : [];
    const directValid = rows.length > 0 && rows.every(item => finite(item.recognized_amount_kmf) != null);
    const directTotal = directValid ? rows.reduce((sum, item) => sum + Number(item.recognized_amount_kmf), 0) : null;
    const directPreview = rows.map(item => ({
      label: item.charge_name || item.charge_family || 'Charge structurelle',
      value: formatKmf(item.recognized_amount_kmf),
      chargeId: canManage ? item.charge_id : null,
    }));
    card.appendChild(economicPreview(doc, directPreview,
      directValid ? `Total direct : ${formatKmf(directTotal)}` : 'Total à confirmer pour la période'));
    rows.forEach(item => {
      table.appendChild(tableCell(doc, item.charge_name || item.charge_family || 'Charge structurelle'));
      table.appendChild(tableCell(doc, formatKmf(item.recognized_amount_kmf), 'is-derived is-number'));
    });
    if (!rows.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Donnée de période indisponible.'));
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

  function fixedMutualizedCard(doc, structure, marketLabel) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-mutualized is-readonly');
    card.dataset.costSummary = 'fixed-mutualized';
    card.dataset.readOnly = 'true';
    card.setAttribute('aria-label', 'Charges fixes mutualisées · lecture seule');
    card.appendChild(costCardHeader(doc, '🔗', 'Charges fixes mutualisées', 'Charges fixes partagées entre marchés.'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-mutualized');
    ['Élément', 'Coût global', 'Clé d’allocation', '%', `Quote-part ${marketLabel}`].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));
    const charges = Array.isArray(structure?.allocation?.charges) ? structure.allocation.charges : [];
    const mutualValid = charges.length > 0 && charges.every(charge => finite(charge.market_share_kmf) != null);
    const mutualTotal = mutualValid ? charges.reduce((sum, charge) => sum + Number(charge.market_share_kmf), 0) : null;
    const mutualPreview = charges.map(charge => ({
      label: charge.charge_name || charge.charge_family || 'Charge mutualisée',
      value: formatKmf(charge.market_share_kmf),
      note: `Quote-part ${charge.market_allocation_ratio == null ? 'non précisée' : `${formatNumber(Number(charge.market_allocation_ratio) * 100)} %`} · ${charge.policy?.basis_kind || 'Politique à confirmer'}`,
    }));
    card.appendChild(economicPreview(doc, mutualPreview,
      mutualValid ? `Quote-part marché : ${formatKmf(mutualTotal)}` : 'Quote-part marché à confirmer'));
    charges.slice(0, 6).forEach(charge => {
      table.appendChild(tableCell(doc, charge.charge_name || charge.charge_family || 'Charge mutualisée'));
      table.appendChild(tableCell(doc, formatKmf(charge.group_pool_kmf), 'is-derived'));
      const policy = charge.policy;
      table.appendChild(tableCell(doc, policy ? (policy.basis_kind || '—') : 'Politique manquante', 'is-derived'));
      const ratioText = charge.market_allocation_ratio != null ? `${formatNumber(Number(charge.market_allocation_ratio) * 100)} %` : '—';
      table.appendChild(tableCell(doc, ratioText, 'is-derived'));
      const shareText = charge.market_share_kmf == null ? '—' : formatKmf(charge.market_share_kmf);
      table.appendChild(tableCell(doc, shareText, `is-derived ${charge.market_share_kmf == null ? '' : 'is-market-share'}`.trim()));
    });
    if (!charges.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Donnée de période indisponible.'));
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
    const card = el(doc, 'details', 'kmc-cockpit-principle kmc-economic-principles-detail');
    const head = el(doc, 'summary', 'kmc-cockpit-principle-head');
    head.appendChild(el(doc, 'span', 'kmc-cockpit-cost-icon', '💡'));
    head.appendChild(el(doc, 'strong', '', 'Voir les règles de répartition (détail)'));
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

  const COST_FAMILIES = [
    ['variable', 'Coûts variables'],
    ['fixed-direct', 'Charges fixes directes'],
    ['fixed-mutualized', 'Charges fixes mutualisées'],
  ];

  // Two genuine layouts over the same three server-backed cards; no data duplication.
  function costLayoutControl(doc, section, cards, initial) {
    const controls = el(doc, 'div', 'kmc-cockpit-cost-layout-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Présentation des familles de coûts');
    const hint = el(doc, 'span', 'kmc-economic-layout-hint', 'Comparer la présentation');
    controls.appendChild(hint);
    const buttons = [
      ['columns', '3 colonnes'],
      ['stacked', 'Superposées'],
    ].map(([key, label]) => {
      const button = el(doc, 'button', 'kmc-economic-layout-button', label);
      button.type = 'button';
      button.dataset.costLayoutButton = key;
      button.addEventListener('click', () => {
        section.dataset.costLayout = key;
        controls.querySelectorAll('[data-cost-layout-button]').forEach(node => {
          const selected = node === button;
          node.classList.toggle('is-active', selected);
          node.setAttribute('aria-pressed', String(selected));
        });
        if (key === 'stacked') {
          cards.forEach(card => {
            card.dataset.expanded = 'false';
            card.querySelector('[data-expand-cost-family]')?.setAttribute('aria-expanded', 'false');
          });
        }
      });
      controls.appendChild(button);
      return button;
    });
    buttons.forEach((button, index) => button.addEventListener('keydown', event => {
      const key = event.key;
      const next = key === 'ArrowRight' ? (index + 1) % buttons.length
        : key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
        : key === 'Home' ? 0 : key === 'End' ? buttons.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      buttons[next].click();
      buttons[next].focus();
    }));
    buttons[initial === 'stacked' ? 1 : 0].click();
    return controls;
  }

  // Une contribution par vente, une couverture collective par période.
  // Aucun pourcentage synthétique n'est construit à partir d'unités hétérogènes.
  function costReading(doc, decision) {
    const mix = decision?.coverage?.cost_mix;
    // No arithmetic from mixed units in the browser: the four shares must
    // arrive as a complete, reconciled, server-authored projection.
    const percentages = ['variable_pct', 'fixed_pct', 'direct_pct', 'mutualized_pct'];
    const ready = mix?.status === 'READY' && mix?.basis === 'RECONCILED_MARKET_PERIOD'
      && Boolean(mix.period?.from && mix.period?.to)
      && percentages.every(key => mix[key] !== null && mix[key] !== undefined
        && Number.isFinite(Number(mix[key])) && Number(mix[key]) >= 0 && Number(mix[key]) <= 100);
    const percent = value => `${formatNumber(value, 1)} %`;
    const section = el(doc, 'section', 'kmc-economic-reading');
    section.dataset.economicCostReading = '';
    section.setAttribute('aria-label', 'Comment lire les coûts et la contribution');
    const introduction = el(doc, 'div', 'kmc-economic-reading-heading');
    introduction.appendChild(el(doc, 'span', 'kmc-economic-reading-eyebrow', 'LOGIQUE ÉCONOMIQUE'));
    introduction.appendChild(el(doc, 'strong', '', 'Le produit contribue. Le portefeuille couvre.'));
    introduction.appendChild(el(doc, 'p', '', 'On mesure ce que chaque vente apporte, puis on compare les contributions réconciliées aux charges fixes de la même période.'));
    section.appendChild(introduction);
    const grid = el(doc, 'div', 'kmc-economic-reading-grid');
    [
      { icon: '↗', tone: 'variable', title: 'Contribution par vente', value: 'Prix − coûts variables (N1 + N2)', detail: 'Estimée avant vente ; réconciliée après achat, expédition, douane et livraison.' },
      { icon: '◈', tone: 'fixed', title: 'Structure à couvrir (N3)', value: 'Fixes directs + fixes mutualisés', detail: 'Charges de période couvertes collectivement, jamais une dette automatique par SKU.' },
      { icon: '%', tone: 'mix', title: 'Part des coûts totaux',
        value: ready ? `Variables ${percent(mix.variable_pct)} · Fixes ${percent(mix.fixed_pct)}` : 'Non encore calculable',
        detail: ready ? `Second axe — Directs ${percent(mix.direct_pct)} · Mutualisés ${percent(mix.mutualized_pct)}. Même période réconciliée.`
          : 'Les proportions exigent une même période, des unités compatibles et des données suffisamment réconciliées.' },
    ].forEach(item => {
      const card = el(doc, 'article', `kmc-economic-reading-item is-${item.tone}`);
      card.appendChild(el(doc, 'span', 'kmc-economic-reading-icon', item.icon));
      const copy = el(doc, 'div', 'kmc-economic-reading-copy');
      copy.appendChild(el(doc, 'span', 'kmc-economic-reading-label', item.title));
      copy.appendChild(el(doc, 'strong', 'kmc-economic-reading-value', item.value));
      copy.appendChild(el(doc, 'small', '', item.detail));
      if (item.tone === 'mix' && ready) {
        const track = el(doc, 'div', 'kmc-economic-reading-mix-track');
        track.setAttribute('role', 'img');
        track.setAttribute('aria-label', `Coûts variables ${percent(mix.variable_pct)}, charges fixes ${percent(mix.fixed_pct)}`);
        const variable = el(doc, 'span', 'kmc-economic-reading-mix-variable');
        variable.style.width = `${Number(mix.variable_pct)}%`;
        const fixed = el(doc, 'span', 'kmc-economic-reading-mix-fixed');
        fixed.style.width = `${Number(mix.fixed_pct)}%`;
        track.appendChild(variable);
        track.appendChild(fixed);
        copy.appendChild(track);
      }
      card.appendChild(copy);
      grid.appendChild(card);
    });
    section.appendChild(grid);
    section.appendChild(el(doc, 'p', 'kmc-economic-reading-foot', 'Variable ou fixe décrit la nature ; direct ou mutualisé décrit la répartition. Un même coût n’est compté qu’une fois.'));
    return section;
  }

  function createCostPilotage(doc, payload, marketCode, decision, user, activeFamily) {
    const groups = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []);
    const structure = decision?.coverage?.structure || null;
    const marketLabel = payload.scope?.market_name || marketCode;
    const section = el(doc, 'section', 'kmc-cockpit-costs');
    section.dataset.atelierViews = 'costs';
    section.appendChild(el(doc, 'p', 'kmc-economic-cost-intro',
      `Coûts et paramètres · ${marketLabel}. Les valeurs héritées et les charges propres au marché sont indiquées séparément. Les montants conservent leur unité de calcul.`));
    const canEditVariables = payload.capabilities?.cost_overrides === true || payload.capabilities?.can_manage_costs === true;
    const canEditStructure = payload.capabilities?.can_manage_structure_events === true
      || payload.capabilities?.structure_events === true || user?.role === 'admin';
    const cards = [variableCostCard(doc, groups.variable, canEditVariables),
      fixedDirectCard(doc, structure, canEditStructure), fixedMutualizedCard(doc, structure, marketLabel)];
    section.dataset.costLayout = 'columns';
    section.appendChild(costReading(doc, decision));
    const families = el(doc, 'div', 'kmc-economic-family-grid');
    cards.forEach(card => families.appendChild(card));
    section.appendChild(families);
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
    // L4 : aucun repli sur price_kmf (un prix KMF n'est pas le prix décidé du marché).
    return 'Non décidé';
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
      // L4 : l'unité est portée par chaque valeur (KMF moteur, devise du marché pour bornes et prix) : aucun en-tête n'en impose une.
      'SKU', 'Coût d\u2019achat', 'Coûts variables\nhors achat', 'Coût variable\ncomplet',
      'Borne marché\nBasse', 'Cible', 'Haute',
      'Prix retenu', 'Contribution\nunitaire', 'Qté vendue', 'Contribution totale', '',
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
    const contribution = finite(economics.contribution_unit_kmf);
    const tone = contribution == null ? '' : contribution < 0 ? ' is-negative' : contribution === 0 ? ' is-zero' : '';
    row.appendChild(tableCell(doc, formatKmf(economics.contribution_unit_kmf), `is-derived is-contribution${tone}`));
    const qtySold = finite(economics.quantity_sold) ?? finite(product.quantity_sold);
    row.appendChild(tableCell(doc, qtySold == null ? '\u2014' : formatNumber(qtySold), 'is-derived'));
    // L4 : la contribution totale du portefeuille est servie par le serveur (E5) ; aucun calcul côté navigateur.
    const contribTotal = finite(economics.contribution_total_kmf) != null ? formatKmf(economics.contribution_total_kmf) : '\u2014';
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
    const localIdentity = el(doc, 'strong', 'kmc-cockpit-market-identity');
    const flag = marketFlagEmoji(corridor?.market?.code);
    localIdentity.textContent = `${flag ? `${flag} ` : ''}${corridor?.market?.name || corridor?.market?.code || 'Marché'} (observé)`;
    localHead.appendChild(localIdentity);
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

  function productDecisionCard(doc, corridor, canManage) {
    const economics = corridor?.selected?.economics || {};
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-product-decision');
    card.appendChild(el(doc, 'h4', '', 'Détail d’un produit'));

    const body = el(doc, 'div', 'kmc-cockpit-product-detail-body');
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
      identity.appendChild(el(doc, 'div', 'kmc-cockpit-product-image-placeholder', '📦'));
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
    body.appendChild(identity);

    const metrics = el(doc, 'div', 'kmc-cockpit-detail-metrics');
    metrics.appendChild(detailMetric(doc, 'Coût d’achat', formatKmf(corridor?.product?.purchase_cost_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coûts variables hors achat', formatKmf(economics.variable_cost_outside_purchase_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coût variable complet', formatKmf(economics.variable_cost_complete_kmf)));
    metrics.appendChild(detailMetric(doc, 'Borne marché basse', corridorAmount(local.low, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché cible', corridorAmount(local.target, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché haute', corridorAmount(local.high, currency)));

    const priceRow = el(doc, 'div', 'kmc-cockpit-detail-metric is-editable is-price-row');
    priceRow.appendChild(el(doc, 'span', '', 'Prix retenu'));
    if (canManage) {
      const form = doc.createElement('form');
      form.dataset.cockpitPriceForm = corridor?.product?.product_ref || '';
      form.className = 'kmc-cockpit-final-price-form is-inline';
      const input = doc.createElement('input');
      input.type = 'number';
      input.name = 'amount';
      input.min = '0.01';
      input.step = '0.01';
      input.required = true;
      input.value = corridor?.selected?.local_amount != null ? corridor.selected.local_amount : '';
      input.placeholder = `Prix ${currency}`;
      input.dataset.finalMarketPrice = '';
      input.dataset.originalValue = input.value;
      form.appendChild(input);
      priceRow.appendChild(form);
    } else {
      priceRow.appendChild(el(doc, 'strong', 'kmc-cockpit-readonly-price', selectedAmount(corridor)));
    }
    metrics.appendChild(priceRow);
    metrics.appendChild(detailMetric(doc, 'Contribution unitaire', formatKmf(economics.contribution_unit_kmf)));
    body.appendChild(metrics);
    card.appendChild(body);
    return card;
  }

  function renderProductDetail(doc, portfolio, corridor, canManage, reveal) {
    const detail = portfolio.querySelector('[data-cockpit-product-detail]');
    if (!detail) return;
    // Panneau secondaire : fermé par défaut, ouvert si l'opérateur l'a ouvert ou agit sur un produit.
    const previous = detail.querySelector('details.kmc-cockpit-secondary');
    const wasOpen = Boolean(reveal) || Boolean(previous && previous.open);
    detail.replaceChildren();
    const panel = el(doc, 'details', 'kmc-cockpit-secondary');
    panel.open = wasOpen;
    panel.appendChild(el(doc, 'summary', '', 'Détail produit, sensibilité et données de marché'));
    const grid = el(doc, 'div', 'kmc-cockpit-detail-grid');
    grid.appendChild(productDecisionCard(doc, corridor, canManage));
    grid.appendChild(sensitivityCard(doc, corridor));
    grid.appendChild(marketDataCard(doc, corridor));
    panel.appendChild(grid);
    detail.appendChild(panel);
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
    const decisional = ['COVERED', 'UNCOVERED'].includes(decision?.decision_status)
      && decision?.coverage?.coverage_ratio != null && Number.isFinite(Number(decision.coverage.coverage_ratio));
    badge.classList.toggle('is-unavailable', !decisional);
    badge.appendChild(el(doc, 'strong', '', decisional ? 'Couverture réconciliée' : 'Couverture non décisionnelle'));
    const ts = decision?.evaluated_at;
    const ago = ts && !Number.isNaN(Date.parse(ts))
      ? `Dernière évaluation ${timeSince(new Date(ts))}` : 'Date d’évaluation indisponible';
    const badgeTime = el(doc, 'small', '', ago);
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

  function buildCockpit(doc, rootNode, payload, marketCode, decision, user) {
    const cockpit = el(doc, 'div', 'kmc-economic-cockpit');
    cockpit.dataset[COCKPIT_ATTR] = '';
    cockpit.appendChild(buildCockpitHeader(doc, payload, decision));
    moveEquilibriumIntoCockpit(rootNode, cockpit);
    cockpit.appendChild(createCostPilotage(doc, payload, marketCode, decision, user));
    cockpit.appendChild(createPortfolioShell(doc, payload));
    cockpit.appendChild(buildCockpitFooter(doc));
    return cockpit;
  }

  function buildCockpitFooter(doc) {
    const footer = el(doc, 'div', 'kmc-cockpit-footer');
    const info = el(doc, 'div', 'kmc-cockpit-footer-info');
    info.appendChild(el(doc, 'span', 'kmc-cockpit-footer-info-icon', 'ⓘ'));
    const note = el(doc, 'span', '', 'Les ajustements sont enregistrés automatiquement. Les valeurs grisées sont calculées par le moteur ; le prix final marché est le levier de décision.');
    note.dataset.cockpitFooterNote = '';
    info.appendChild(note);
    footer.appendChild(info);
    return footer;
  }

  // Ouvre le formulaire séparé pour un ajustement de charge structurelle
  // (N3) — jamais un champ inline dans l'Atelier économique. 'fixed-direct'
  // reste scopé au marché courant (manager du marché ou admin) ; le pool
  // 'fixed-mutualized' (GROUP) est admin only, il affecte tous les marchés.
  async function openStructureEventForm(rootObject, doc, workspace, options, detailKey, chargeId = null) {
    const panelApi = rootObject && rootObject.KomerceCanonicalStructureEventPanel;
    if (!panelApi || typeof panelApi.open !== 'function') return;

    const isMutualized = detailKey === 'fixed-mutualized';
    const isAdmin = (options.user && options.user.role) === 'admin';
    if (isMutualized && !isAdmin) return; // bouton désactivé côté serveur de vérité — défense en profondeur

    const marketEndpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    const globalEndpoint = workspace.endpointFor({});
    const basePath = isMutualized ? globalEndpoint : marketEndpoint;

    await panelApi.open({
      document: doc,
      fetch: options.fetch,
      title: isMutualized ? 'Gérer les mutualisations' : 'Ajuster les charges fixes directes',
      subtitle: isMutualized
        ? 'Pool partagé entre marchés — l’ajustement s’applique à la quote-part de tous les marchés.'
        : `Charges propres au marché ${options.requestedMarket || ''}.`.trim(),
      chargesEndpoint: `${marketEndpoint}/charges`,
      eventsEndpoint: `${basePath}/structure-events`,
      submitEndpoint: `${basePath}/structure-events`,
      initialChargeId: chargeId,
      onSaved: async () => {
        if (typeof rootObject.KomerceCanonicalPricingWorkspace?.mount === 'function') {
          await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
        }
      },
    });
  }


  async function openVariableCostPanel(rootObject, doc, workspace, options, payload) {
    const components = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []).variable
      .filter(component => component && component.key);
    const overlay = el(doc, 'div', 'kmc-structure-panel-overlay');
    overlay.dataset.variableCostPanel = '';
    const panel = el(doc, 'div', 'kmc-structure-panel kmc-variable-cost-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    overlay.appendChild(panel);

    const header = el(doc, 'div', 'kmc-structure-panel-header');
    const titles = el(doc, 'div', '');
    titles.appendChild(el(doc, 'h2', 'kmc-structure-panel-title', 'Ajuster les coûts variables'));
    titles.appendChild(el(doc, 'p', 'kmc-structure-panel-subtitle', `Valeurs effectives du marché ${options.requestedMarket || ''}. Le moteur recalcule ensuite automatiquement la contribution.`.trim()));
    header.appendChild(titles);
    const close = el(doc, 'button', 'kmc-structure-panel-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer');
    header.appendChild(close);
    panel.appendChild(header);

    const body = el(doc, 'div', 'kmc-structure-panel-body');
    const form = doc.createElement('form');
    form.className = 'kmc-variable-cost-panel-form';
    const error = el(doc, 'div', 'kmc-structure-panel-error');
    error.hidden = true;
    form.appendChild(error);

    if (!components.length) form.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Aucun coût variable actif à ajuster.'));

    components.forEach(component => {
      const row = el(doc, 'label', 'kmc-variable-cost-panel-row');
      const identity = el(doc, 'div', 'kmc-variable-cost-panel-identity');
      identity.appendChild(el(doc, 'strong', '', component.label || component.key));
      identity.appendChild(el(doc, 'small', '', `${allocationPerimeter(component) === 'mutualized' ? 'Mutualisé' : 'Direct'} · ${allocationLabel(component.allocation_method)}`));
      row.appendChild(identity);
      const control = el(doc, 'div', 'kmc-variable-cost-panel-control');
      const input = doc.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = component.default_value != null && Number.isFinite(Number(component.default_value)) ? String(component.default_value) : '';
      input.min = '0';
      input.required = true;
      input.dataset.originalValue = input.value;
      input.dataset.variableCostInput = component.key;
      input.setAttribute('aria-label', `Valeur de ${component.label || component.key}`);
      control.appendChild(input);
      control.appendChild(el(doc, 'span', '', unitLabel(component.unit) || component.unit || 'KMF'));
      const autosaveStatus = el(doc, 'small', 'kmc-autosave-status', '');
      autosaveStatus.dataset.autosaveStatus = '';
      autosaveStatus.setAttribute('aria-live', 'polite');
      control.appendChild(autosaveStatus);
      row.appendChild(control);
      form.appendChild(row);
    });
    body.appendChild(form);
    panel.appendChild(body);

    const footer = el(doc, 'div', 'kmc-structure-panel-footer');
    const cancel = el(doc, 'button', 'kmc-cockpit-outline-action', 'Annuler');
    cancel.type = 'button';
    const save = el(doc, 'button', 'kmc-cockpit-footer-save', 'Terminé');
    save.type = 'button';
    footer.appendChild(cancel);
    footer.appendChild(save);
    panel.appendChild(footer);

    function closePanel() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    close.addEventListener('click', closePanel);
    cancel.addEventListener('click', closePanel);
    overlay.addEventListener('click', event => { if (event.target === overlay) closePanel(); });

    // Enregistrement automatique : chaque valeur validée (sortie du champ / Entrée) est écrite immédiatement.
    // Une valeur vide ou négative n'est jamais enregistrée (NULL ≠ 0) et l'erreur reste affichée.
    let autosaving = Promise.resolve();
    form.addEventListener('submit', event => event.preventDefault());
    form.addEventListener('change', event => {
      const input = event.target.closest('[data-variable-cost-input]');
      if (!input || input.value === input.dataset.originalValue) return;
      autosaving = autosaving.then(async () => {
        const value = Number(input.value);
        const status = input.closest('.kmc-variable-cost-panel-row')?.querySelector('[data-autosave-status]');
        if (!input.value.trim() || !Number.isFinite(value) || value < 0) {
          error.textContent = 'Chaque coût doit être un nombre positif ou nul : valeur non enregistrée.';
          error.hidden = false;
          return;
        }
        error.hidden = true;
        if (status) status.textContent = 'Enregistrement…';
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(input.dataset.variableCostInput)}/update`, {
            method: 'POST',
            body: { default_value: value, source: 'economic_cockpit_variable_cost_panel' },
          });
          input.dataset.originalValue = input.value;
          if (status) status.textContent = '✓ Enregistré automatiquement';
          await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
        } catch (err) {
          if (status) status.textContent = '';
          error.textContent = `Non enregistré : ${err.message}`;
          error.hidden = false;
        }
      });
    });

    save.addEventListener('click', async () => {
      await autosaving;
      const inputs = Array.from(form.querySelectorAll('[data-variable-cost-input]'));
      const changed = inputs.filter(input => input.value !== input.dataset.originalValue);
      if (!changed.length) { closePanel(); return; }
      save.disabled = true;
      save.textContent = 'Enregistrement…';
      error.hidden = true;
      const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
      try {
        for (const input of changed) {
          const value = Number(input.value);
          if (!input.value.trim() || !Number.isFinite(value) || value < 0) throw new Error('Chaque coût doit être un nombre positif ou nul.');
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(input.dataset.variableCostInput)}/update`, {
            method: 'POST',
            body: { default_value: value, source: 'economic_cockpit_variable_cost_panel' },
          });
        }
        closePanel();
        await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        save.disabled = false;
        save.textContent = 'Terminé';
      }
    });

    doc.body.appendChild(overlay);
    return overlay;
  }

  function bindCockpit(rootObject, workspace, options, payload, cockpit) {
    const portfolio = cockpit.querySelector('[data-cockpit-portfolio]');
    if (!portfolio) return;
    const doc = options.document;
    const marketCode = options.requestedMarket || payload.scope?.market_code || 'Marché';

    cockpit.addEventListener('click', async event => {
      const editInline = event.target.closest('[data-edit-inline-cost]');
      if (editInline) {
        const row = editInline.closest('[data-inline-cost-row]');
        const key = editInline.dataset.editInlineCost;
        const component = (payload.cost_components || []).find(item => item.key === key);
        if (!row || !component || payload.capabilities?.cost_overrides !== true) return;
        cockpit.querySelectorAll('[data-inline-cost-form]').forEach(form => {
          const other = form.closest('[data-inline-cost-row]');
          form.remove();
          if (other) other.querySelector('[data-edit-inline-cost]').hidden = false;
        });
        const form = el(doc, 'form', 'kmc-inline-cost-form');
        form.dataset.inlineCostForm = key;
        const last = el(doc, 'span', 'kmc-inline-cost-last', `Valeur actuelle : ${componentValue(component)}`);
        form.appendChild(last);
        const input = doc.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.min = '0';
        input.required = true;
        input.name = 'value';
        input.dataset.inlineCostValue = '';
        input.value = finite(component.default_value) == null ? '' : String(component.default_value);
        input.setAttribute('aria-label', `Nouvelle valeur de ${component.label || key}`);
        form.appendChild(input);
        form.appendChild(el(doc, 'span', 'kmc-inline-cost-unit', unitLabel(component.unit)));
        const save = el(doc, 'button', 'kmc-inline-cost-save', 'Enregistrer');
        save.type = 'submit';
        form.appendChild(save);
        const cancel = el(doc, 'button', 'kmc-inline-cost-cancel', 'Annuler');
        cancel.type = 'button';
        cancel.dataset.cancelInlineCost = '';
        form.appendChild(cancel);
        const message = el(doc, 'small', 'kmc-inline-cost-message');
        message.dataset.inlineCostMessage = '';
        message.setAttribute('aria-live', 'polite');
        form.appendChild(message);
        row.appendChild(form);
        editInline.hidden = true;
        input.focus();
        return;
      }
      const cancelInline = event.target.closest('[data-cancel-inline-cost]');
      if (cancelInline) {
        const row = cancelInline.closest('[data-inline-cost-row]');
        row?.querySelector('[data-inline-cost-form]')?.remove();
        const edit = row?.querySelector('[data-edit-inline-cost]');
        if (edit) { edit.hidden = false; edit.focus(); }
        return;
      }
      const structureLine = event.target.closest('[data-edit-structure-charge]');
      if (structureLine) {
        // N3 is event-sourced: one click targets its charge, but proof + period
        // remain mandatory. Never overwrite a reconciled N3 amount directly.
        await openStructureEventForm(rootObject, doc, workspace, options, 'fixed-direct', structureLine.dataset.editStructureCharge);
        return;
      }
      const expand = event.target.closest('[data-expand-cost-family]');
      if (expand) {
        const card = expand.closest('[data-cost-summary]');
        if (card) {
          const expanded = card.dataset.expanded !== 'true';
          cockpit.querySelectorAll('.kmc-economic-family-grid > [data-cost-summary]').forEach(other => {
            other.dataset.expanded = 'false';
            other.querySelector('[data-expand-cost-family]')?.setAttribute('aria-expanded', 'false');
            const label = other.querySelector('[data-expand-cost-family]');
            if (label) label.textContent = 'Voir le détail';
          });
          card.dataset.expanded = String(expanded);
          expand.setAttribute('aria-expanded', String(expanded));
          expand.textContent = expanded ? 'Masquer le détail' : 'Voir le détail';
        }
        return;
      }
      const openCosts = event.target.closest('[data-open-cost-detail]');
      if (openCosts) {
        const detailKey = openCosts.dataset.openCostDetail;
        if (detailKey === 'variable') {
          await openVariableCostPanel(rootObject, doc, workspace, options, payload);
          return;
        }
        if (detailKey === 'fixed-direct') {
          await openStructureEventForm(rootObject, doc, workspace, options, detailKey);
          return;
        }
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
          renderProductDetail(doc, portfolio, corridor, payload.capabilities?.local_strategy_owner === true, true);
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
          renderProductDetail(doc, portfolio, corridor, payload.capabilities?.local_strategy_owner === true, true);
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
      if (footerNote) footerNote.textContent = isDirty ? 'Modification en cours : enregistrée automatiquement à la validation du champ.' : 'Les ajustements sont enregistrés automatiquement. Les valeurs grisées sont calculées par le moteur ; le prix final marché est le levier de décision.';
    });

    // Enregistrement automatique du prix final : à la validation du champ (Entrée / sortie), jamais à la frappe.
    cockpit.addEventListener('change', event => {
      const priceInput = event.target.closest('[data-final-market-price]');
      if (!priceInput) return;
      const form = priceInput.closest('[data-cockpit-price-form]');
      const footerNote = cockpit.querySelector('[data-cockpit-footer-note]');
      if (!form || priceInput.dataset.originalValue === priceInput.value) return;
      const amount = Number(priceInput.value);
      if (!priceInput.value.trim() || !Number.isFinite(amount) || amount <= 0) {
        if (footerNote) footerNote.textContent = 'Montant invalide : prix non enregistré.';
        return;
      }
      if (footerNote) footerNote.textContent = 'Enregistrement automatique…';
      form.requestSubmit();
    });

    cockpit.addEventListener('submit', async event => {
      const inlineForm = event.target.closest('[data-inline-cost-form]');
      if (inlineForm) {
        event.preventDefault();
        const input = inlineForm.querySelector('[data-inline-cost-value]');
        const note = inlineForm.querySelector('[data-inline-cost-message]');
        const key = inlineForm.dataset.inlineCostForm;
        const rawValue = input.value.trim();
        const value = Number(rawValue);
        if (!rawValue || !Number.isFinite(value) || value < 0) {
          note.textContent = 'Valeur invalide : rien n’a été enregistré.';
          return;
        }
        const buttons = [...inlineForm.querySelectorAll('button')];
        buttons.forEach(button => { button.disabled = true; });
        note.textContent = 'Enregistrement…';
        try {
          const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(key)}/update`, {
            method: 'POST', body: { default_value: value, source: 'economic_cockpit_inline_row' },
          });
          note.textContent = 'Enregistré. Actualisation…';
          await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
        } catch (error) {
          note.textContent = `Non enregistré : ${error.message}`;
          buttons.forEach(button => { button.disabled = false; });
        }
        return;
      }
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
          const note = cockpit.querySelector('[data-cockpit-footer-note]');
          if (note) note.textContent = '✓ Prix enregistré automatiquement.';
        } catch (error) {
          const note = cockpit.querySelector('[data-cockpit-footer-note]');
          if (note) note.textContent = `Prix non enregistré : ${error.message}`;
          priceForm.closest('.kmc-cockpit-detail-card')?.prepend(el(doc, 'div', 'kmc-cockpit-error', `Décision refusée : ${error.message}`));
        }
        return;
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
      if (oldCosts) {
        const newCosts = createCostPilotage(doc, payload, marketCode, newDecision, options.user, oldCosts.dataset.costLayout);
        newCosts.hidden = oldCosts.hidden;
        oldCosts.replaceWith(newCosts);
      }

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
    // Contrat exclusif : le cockpit ne dépend plus d'un DOM Legacy préalable.
    // Le payload serveur suffit à construire la surface approuvée ; cela
    // permet un premier rendu atomique sans jamais exposer l'ancien workspace.
    let decision = null;
    try { decision = await fetchDecision(workspace, options); } catch (_) { decision = null; }
    const cockpit = buildCockpit(options.document, options.root, payload, options.requestedMarket || payload.scope?.market_code || 'Marché', decision, options.user);

    // Contrat exclusif : le mock approuvé EST l'Atelier économique.
    // pricing-workspace.js reste un fournisseur de données/actions serveur,
    // jamais une seconde surface visible ni un tiroir avancé.
    options.root.replaceChildren(cockpit);
    options.root.dataset.pricingMockContract = 'exclusive';
    bindCockpit(rootObject, workspace, options, payload, cockpit);
    const portfolio = cockpit.querySelector('[data-cockpit-portfolio]');
    if (portfolio?.__activeCategory) await loadCategory(options.document, workspace, options, payload, portfolio, portfolio.__activeCategory);
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__economicCockpitInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function economicCockpitAwareMount(options) {
      // pricing-workspace et ses anciens wrappers restent utiles comme
      // fournisseurs de payload/actions, mais leur DOM ne doit jamais être
      // peint dans la surface visible. On les exécute dans un root détaché,
      // puis on construit le mock sur le vrai root en un swap atomique.
      const stagingRoot = options.document.createElement('div');
      const payload = await originalMount({ ...options, root: stagingRoot });
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
