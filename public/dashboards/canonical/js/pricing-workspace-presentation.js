/**
 * @komerce-arch
 * @role          canonical-pricing-workshop-presentation
 * @domain        admin-dashboard
 * @layer         ui-presentation
 * @criticality   medium
 * @inputs        pricing_workspace_projection, canonical_pricing_workspace_dom
 * @outputs       readable_cost_workshop_dom
 * @depends       public/dashboards/canonical/js/pricing-workspace.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      presentation_only_server_remains_authority, workspace_acts_dashboard_observes, viewer_reads_manager_writes, every_cost_line_is_explainable, charge_nature_is_distinct_from_allocation_perimeter
 * @impact-areas  admin-dashboard, pricing
 * @version       2026-09
 */

'use strict';

(function initPricingWorkshopPresentation(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingWorkshopPresentation = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingWorkshopPresentation() {
  const GROUPS = Object.freeze([
    {
      key: 'variable',
      eyebrow: 'COÛTS VARIABLES · DIRECTS ET MUTUALISÉS',
      title: 'Coûts variables',
      description: 'Les coûts qui évoluent avec l’activité. Direct ou mutualisé décrit leur périmètre ; leur nature reste variable.',
      formula: 'Achat + transport + douane + paiement + exécution variable + quote-parts variables mutualisées',
    },
    {
      key: 'fixed_direct',
      eyebrow: 'CHARGES STRUCTURELLES · PROPRES AU MARCHÉ',
      title: 'Charges fixes directes',
      description: 'Les charges de période propres au marché. Elles sont absorbées collectivement par la contribution du portefeuille.',
      formula: 'Salaires + loyer + outils locaux + autres charges fixes propres',
    },
    {
      key: 'fixed_mutualized',
      eyebrow: 'CHARGES STRUCTURELLES · PARTAGÉES',
      title: 'Charges fixes mutualisées',
      description: 'Hub, infrastructure, équipe centrale ou outils communs : une quote-part Market ID est déterminée par une clé d’allocation explicite.',
      formula: 'Coût commun × clé d’allocation gouvernée → quote-part du Market ID',
    },
    {
      key: 'exceptional',
      eyebrow: 'HORS FONCTIONNEMENT NORMAL',
      title: 'Exceptionnel',
      description: 'Les coûts ponctuels ou de crise restent séparés du fonctionnement courant.',
      formula: 'Incidents + campagnes exceptionnelles + corrections gouvernées',
    },
  ]);

  const CATEGORY_LABELS = Object.freeze({
    product_purchase: 'Achat fournisseur',
    sourcing: 'Sourcing',
    hub: 'Hub & contrôle',
    packaging: 'Emballage',
    freight: 'Transport international',
    customs: 'Douane',
    port_transitary: 'Port & transitaire',
    local_distribution: 'Distribution locale',
    relay: 'Relais',
    payment: 'Paiement',
    risk_provision: 'Provision de risque',
    fixed_overhead: 'Charges fixes',
    incident: 'Incident',
    marketing_campaign: 'Campagne marketing',
  });

  const UNIT_LABELS = Object.freeze({
    kmf: 'KMF', pct: '% du montant', kmf_per_kg: 'KMF / kg', kmf_per_m3: 'KMF / m³',
    kmf_per_order: 'KMF / commande', kmf_per_parcel: 'KMF / colis', kmf_per_shipment: 'KMF / expédition',
    aed: 'AED', eur: 'EUR', usd: 'USD',
  });

  const SCOPE_LABELS = Object.freeze({
    global: 'Global', category: 'Catégorie', product: 'Produit', order: 'Commande', parcel: 'Colis',
    shipment: 'Expédition', supplier: 'Fournisseur', relay: 'Relais',
  });

  const ALLOCATION_LABELS = Object.freeze({
    none: 'Sans allocation', per_order: 'Par commande', per_item: 'Par article', by_value: 'Selon valeur',
    by_weight: 'Selon poids', by_volume: 'Selon volume', by_taxable_weight: 'Selon poids taxable',
    by_quantity: 'Selon quantité', by_category_risk: 'Selon risque catégorie', manual: 'Clé manuelle',
  });

  const ICONS = Object.freeze({
    BANK: '🏦', CLOCK: '⏱️', CHECK: '✓', TAG: '🏷️', BOX: '📦', SHIP: '🚢', SHIELD: '🛡️',
    GLASS: '🔎', CLIPBOARD: '📋', PORT: '⚓', TRUCK: '🚚', BOAT: '⛴️', COIN: '🪙', CARD: '💳',
    MONEY: '💵', WARNING: '⚠️', BREAK: '📦', BUILDING: '🏢', STORM: '🌪️',
  });

  const TRUTH_LABELS = Object.freeze({
    observed_real: ['Réel constaté', 'active'], external_reference: ['Référence externe', 'inherited'],
    configured_override: ['Hypothèse pays', 'override'], declared: ['Déclaré', 'override'],
    configured: ['Hypothèse configurée', 'inherited'], missing: ['Donnée manquante', 'inactive'],
  });

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

  function groupKey(component = {}) {
    if (component.family === 'exceptional' || component.is_exceptional) return 'exceptional';
    const nature = economicNature(component);
    const perimeter = allocationPerimeter(component);
    if (nature === 'fixed' && perimeter === 'mutualized') return 'fixed_mutualized';
    if (nature === 'fixed') return 'fixed_direct';
    return 'variable';
  }

  function groupComponents(components = []) {
    const grouped = new Map(GROUPS.map(group => [group.key, []]));
    components.forEach(component => grouped.get(groupKey(component)).push(component));
    return GROUPS.map(group => ({ ...group, components: grouped.get(group.key) })).filter(group => group.components.length);
  }

  function unitLabel(unit) { return UNIT_LABELS[unit] || unit || 'unité'; }
  function categoryLabel(category) { return CATEGORY_LABELS[category] || String(category || 'Autre').replaceAll('_', ' '); }
  function scopeLabel(scope) { return SCOPE_LABELS[scope] || scope || 'Global'; }
  function allocationLabel(method) { return ALLOCATION_LABELS[method] || String(method || 'none').replaceAll('_', ' '); }
  function natureLabel(nature) { return nature === 'fixed' ? 'Fixe' : nature === 'variable' ? 'Variable' : 'À qualifier'; }
  function perimeterLabel(perimeter) { return perimeter === 'mutualized' ? 'Mutualisée' : 'Directe'; }
  function humanizeKey(key) { return String(key || '').replace(/_(kmf|pct|eur|usd|aed)$/i, '').replaceAll('_', ' ').replace(/^./, value => value.toUpperCase()); }
  function iconFor(component = {}) { const raw = String(component.emoji || '').trim(); return raw ? (ICONS[raw] || raw) : '•'; }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(number) : '—';
  }

  function formatComponentValue(value, unit) { return value == null || value === '' ? '—' : `${numberValue(value)} ${unitLabel(unit)}`; }

  function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function canManageCosts(payload = {}, marketMode = false) {
    if (!marketMode) return true;
    return payload.capabilities?.cost_overrides !== false && payload.access?.read_only !== true;
  }

  function el(doc, tag, className, textValue) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = String(textValue);
    return node;
  }

  function pill(doc, label, tone) { return el(doc, 'span', `kmc-cost-pill${tone ? ` is-${tone}` : ''}`, label); }

  function actionButton(doc, label, action, key, secondary = false) {
    const node = el(doc, 'button', `kmc-workspace-action${secondary ? ' is-secondary' : ''}`, label);
    node.type = 'button';
    node.dataset.pricingAction = action;
    node.dataset.key = key;
    return node;
  }

  function createFormula(doc, marketMode, marketCode, canManage = true) {
    const block = el(doc, 'div', 'kmc-cost-formula');
    const copy = el(doc, 'div', 'kmc-cost-formula-copy');
    copy.appendChild(el(doc, 'span', 'kmc-cost-formula-kicker', 'COMMENT LIRE L’ATELIER'));
    copy.appendChild(el(doc, 'strong', 'kmc-cost-formula-title', 'Le marché borne le prix. Le portefeuille couvre la structure.'));
    copy.appendChild(el(doc, 'p', 'kmc-cost-formula-text', marketMode
      ? (canManage
        ? `Vous ajustez les leviers autorisés de ${marketCode}. Le moteur recalcule ensuite contribution, couverture et équilibre.`
        : `Vous consultez le modèle effectif de ${marketCode}. Les leviers restent visibles mais la modification est réservée au manager.`)
      : 'Le modèle central qualifie chaque charge par nature, périmètre et allocation. Les valeurs calculées restent l’autorité du moteur.'));
    block.appendChild(copy);

    const rail = el(doc, 'div', 'kmc-cost-formula-rail');
    [
      ['Marché', 'Borne de prix', 'Ce que le client accepte'],
      ['→', '', ''],
      ['Contribution', 'Prix − coûts variables', 'Ce que la vente apporte'],
      ['→', '', ''],
      ['Couverture', 'Portefeuille − structure', 'Fixes directes + mutualisées'],
    ].forEach(([step, title, subtitle]) => {
      if (step === '→') { rail.appendChild(el(doc, 'span', 'kmc-cost-formula-plus', '→')); return; }
      const card = el(doc, 'div', `kmc-cost-formula-step is-${step.toLowerCase()}`);
      card.appendChild(el(doc, 'span', 'kmc-cost-formula-step-key', step));
      card.appendChild(el(doc, 'strong', '', title));
      card.appendChild(el(doc, 'small', '', subtitle));
      rail.appendChild(card);
    });
    block.appendChild(rail);
    return block;
  }

  function explanationItem(doc, label, value, helper) {
    const item = el(doc, 'div', 'kmc-cost-explain-item');
    item.appendChild(el(doc, 'span', 'kmc-cost-explain-label', label));
    item.appendChild(el(doc, 'strong', 'kmc-cost-explain-value', value || '—'));
    if (helper) item.appendChild(el(doc, 'small', 'kmc-cost-explain-helper', helper));
    return item;
  }

  function createExplainability(doc, component) {
    const explain = component.explainability;
    if (!explain) return null;
    const details = doc.createElement('details');
    details.className = 'kmc-cost-explain';
    details.appendChild(el(doc, 'summary', '', 'Comprendre cette ligne'));
    const body = el(doc, 'div', 'kmc-cost-explain-body');
    body.appendChild(explanationItem(doc, 'Ce que vous manipulez', explain.manipulation, explain.meaning));
    const originHelper = [
      explain.origin?.base_source ? `Base : ${explain.origin.base_source}` : null,
      explain.origin?.last_updated_at ? `Dernière évolution : ${formatDate(explain.origin.last_updated_at)}` : null,
    ].filter(Boolean).join(' · ');
    body.appendChild(explanationItem(doc, 'D’où vient la valeur', explain.origin?.source_label, originHelper));
    body.appendChild(explanationItem(doc, 'Hypothèse portée', explain.hypothesis?.text, explain.hypothesis?.is_explicit_human_note ? 'Note explicite saisie sur cette ligne.' : 'Hypothèse canonique tant qu’une meilleure preuve n’est pas disponible.'));
    body.appendChild(explanationItem(doc, 'Ce qui la fait bouger', explain.movement?.driver, explain.movement?.changes_when));
    body.appendChild(explanationItem(doc, 'Impact économique', explain.impact?.price_effect, explain.impact?.path));
    body.appendChild(explanationItem(doc, 'Qualité de vérité', explain.evidence?.confidence_label, explain.evidence?.caution));
    details.appendChild(body);
    return details;
  }

  function selectField(doc, labelText, datasetName, key, value, options) {
    const label = el(doc, 'label', 'kmc-cost-value-label');
    label.appendChild(el(doc, 'span', '', labelText));
    const select = doc.createElement('select');
    select.className = 'kmc-cost-select';
    select.dataset[datasetName] = key;
    options.forEach(([optionValue, optionLabel]) => {
      const option = doc.createElement('option');
      option.value = optionValue;
      option.textContent = optionLabel;
      if (optionValue === value) option.selected = true;
      select.appendChild(option);
    });
    label.appendChild(select);
    return label;
  }

  function createComponentCard(doc, component, marketMode, marketCode, canManage = true) {
    const inherited = marketMode && component.inherited !== false;
    const nature = economicNature(component);
    const perimeter = allocationPerimeter(component);
    const card = el(doc, 'article', `kmc-cost-card is-${groupKey(component)}${component.is_active === false ? ' is-inactive' : ''}`);
    card.dataset.costComponent = component.key;

    const identity = el(doc, 'div', 'kmc-cost-card-identity');
    const icon = el(doc, 'div', 'kmc-cost-card-icon', iconFor(component));
    icon.setAttribute('aria-hidden', 'true');
    identity.appendChild(icon);
    const copy = el(doc, 'div', 'kmc-cost-card-copy');
    copy.appendChild(el(doc, 'strong', 'kmc-cost-card-title', component.label || humanizeKey(component.key)));
    if (component.description) copy.appendChild(el(doc, 'p', 'kmc-cost-card-description', component.description));
    const meta = el(doc, 'div', 'kmc-cost-card-meta');
    meta.appendChild(pill(doc, natureLabel(nature), nature === 'fixed' ? 'fixed' : 'variable'));
    meta.appendChild(pill(doc, perimeterLabel(perimeter), perimeter === 'mutualized' ? 'mutualized' : 'scope'));
    meta.appendChild(pill(doc, categoryLabel(component.category), 'category'));
    if (component.allocation_method && component.allocation_method !== 'none') meta.appendChild(pill(doc, allocationLabel(component.allocation_method), 'allocation'));
    if (marketMode) meta.appendChild(pill(doc, inherited ? 'Hérité du global' : `Override ${marketCode}`, inherited ? 'inherited' : 'override'));
    meta.appendChild(pill(doc, component.is_active === false ? 'Inactif' : 'Actif', component.is_active === false ? 'inactive' : 'active'));
    const truth = TRUTH_LABELS[component.explainability?.evidence?.truth_state];
    if (truth) meta.appendChild(pill(doc, truth[0], truth[1]));
    if (marketMode && !canManage) meta.appendChild(pill(doc, 'Lecture seule', 'scope'));
    copy.appendChild(meta);
    identity.appendChild(copy);
    card.appendChild(identity);

    const editor = el(doc, 'div', 'kmc-cost-card-editor');
    const valueLabel = el(doc, 'label', 'kmc-cost-value-label');
    valueLabel.appendChild(el(doc, 'span', '', marketMode ? (canManage ? `Valeur pour ${marketCode}` : `Valeur effective pour ${marketCode}`) : 'Valeur centrale'));
    const inputWrap = el(doc, 'div', 'kmc-cost-value-input-wrap');
    const input = doc.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = '0.01';
    input.value = component.default_value == null ? '' : component.default_value;
    input.dataset.costValue = component.key;
    input.setAttribute('aria-label', `${component.label || component.key} — valeur`);
    if (marketMode && !canManage) { input.disabled = true; input.readOnly = true; input.setAttribute('aria-readonly', 'true'); }
    inputWrap.appendChild(input);
    inputWrap.appendChild(el(doc, 'span', 'kmc-cost-value-unit', unitLabel(component.unit)));
    valueLabel.appendChild(inputWrap);
    editor.appendChild(valueLabel);

    if (!marketMode && canManage && component.family !== 'exceptional') {
      const classification = el(doc, 'div', 'kmc-cost-classification-editor');
      classification.appendChild(selectField(doc, 'Nature', 'costNature', component.key, nature || '', [['variable', 'Variable'], ['fixed', 'Fixe']]));
      classification.appendChild(selectField(doc, 'Périmètre', 'costPerimeter', component.key, perimeter, [['direct', 'Direct'], ['mutualized', 'Mutualisé']]));
      classification.appendChild(selectField(doc, 'Allocation', 'costAllocation', component.key, component.allocation_method || 'none', Object.entries(ALLOCATION_LABELS)));
      editor.appendChild(classification);
    }

    if (marketMode) {
      const comparison = el(doc, 'div', 'kmc-cost-comparison');
      comparison.appendChild(el(doc, 'span', '', 'Base globale'));
      comparison.appendChild(el(doc, 'strong', '', formatComponentValue(component.base_default_value, component.unit)));
      comparison.appendChild(el(doc, 'small', '', inherited ? 'La valeur locale suit actuellement cette base.' : 'Cette valeur remplace la base globale pour ce marché.'));
      editor.appendChild(comparison);
    }

    if (component.is_active === false) editor.appendChild(el(doc, 'div', 'kmc-cost-inactive-note', 'Ce coût est désactivé et n’entre pas dans le calcul actif.'));
    const explanation = createExplainability(doc, component);
    if (explanation) editor.appendChild(explanation);

    const actions = el(doc, 'div', 'kmc-cost-card-actions');
    if (canManage) {
      actions.appendChild(actionButton(doc, 'Enregistrer', 'save-cost', component.key));
      actions.appendChild(actionButton(doc, component.is_active === false ? 'Activer' : 'Désactiver', 'toggle-cost', component.key, true));
      if (marketMode && component.inherited === false) actions.appendChild(actionButton(doc, 'Revenir au global', 'reset-cost', component.key, true));
    } else {
      actions.appendChild(el(doc, 'div', 'kmc-cost-inactive-note', 'Lecture seule · un manager pays est requis pour modifier cet élément.'));
    }
    editor.appendChild(actions);

    const technical = doc.createElement('details');
    technical.className = 'kmc-cost-technical';
    technical.appendChild(el(doc, 'summary', '', 'Détails techniques'));
    const technicalBody = el(doc, 'div', 'kmc-cost-technical-body');
    technicalBody.appendChild(el(doc, 'code', '', component.key));
    technicalBody.appendChild(el(doc, 'span', '', `Portée : ${scopeLabel(component.scope)}`));
    if (component.family) technicalBody.appendChild(el(doc, 'span', '', `Famille compatibilité : ${component.family}`));
    if (component.source) technicalBody.appendChild(el(doc, 'span', '', `Source : ${component.source}`));
    if (component.confidence) technicalBody.appendChild(el(doc, 'span', '', `Confiance : ${component.confidence}`));
    technical.appendChild(technicalBody);
    editor.appendChild(technical);
    card.appendChild(editor);
    return card;
  }

  function createGroup(doc, group, marketMode, marketCode, canManage = true) {
    const section = el(doc, 'section', `kmc-cost-group is-${group.key}`);
    const header = el(doc, 'header', 'kmc-cost-group-header');
    const copy = el(doc, 'div', 'kmc-cost-group-copy');
    copy.appendChild(el(doc, 'span', 'kmc-cost-group-eyebrow', group.eyebrow));
    copy.appendChild(el(doc, 'h3', 'kmc-cost-group-title', group.title));
    copy.appendChild(el(doc, 'p', 'kmc-cost-group-description', group.description));
    copy.appendChild(el(doc, 'small', 'kmc-cost-group-formula', group.formula));
    header.appendChild(copy);
    header.appendChild(pill(doc, `${group.components.length} ligne${group.components.length > 1 ? 's' : ''}`, 'count'));
    section.appendChild(header);

    const refine = doc.createElement('details');
    refine.className = 'kmc-cost-refine';
    refine.appendChild(el(doc, 'summary', '', canManage ? 'Ajuster / affiner les charges' : 'Voir le détail des charges'));
    const cards = el(doc, 'div', 'kmc-cost-card-list');
    group.components.forEach(component => cards.appendChild(createComponentCard(doc, component, marketMode, marketCode, canManage)));
    refine.appendChild(cards);
    section.appendChild(refine);
    return section;
  }

  function createGlobalComponentForm(doc) {
    const details = doc.createElement('details');
    details.className = 'kmc-cost-create';
    details.appendChild(el(doc, 'summary', '', '＋ Ajouter / compléter une catégorie de charge'));
    details.appendChild(el(doc, 'p', 'kmc-cost-create-help', 'Autorité Pricing centrale : qualifier la nature, le périmètre et la clé d’allocation. Les familles historiques restent uniquement pour compatibilité moteur.'));
    const form = doc.createElement('form');
    form.className = 'kmc-workspace-inline-form kmc-cost-create-form';
    form.dataset.pricingCostForm = '';
    form.innerHTML = '<input name="key" required placeholder="clé technique"><input name="label" required placeholder="Nom affiché"><select name="economic_nature" required><option value="variable">Variable</option><option value="fixed">Fixe</option></select><select name="allocation_perimeter" required><option value="direct">Direct</option><option value="mutualized">Mutualisé</option></select><select name="family" title="Famille technique de compatibilité"><option value="landed_relay">Flux opérationnel</option><option value="business">Business / transaction</option><option value="exceptional">Exceptionnel</option></select><input name="category" required placeholder="catégorie"><input name="default_value" type="number" min="0" step="0.01" required placeholder="valeur"><select name="unit"><option value="kmf">KMF</option><option value="pct">%</option><option value="kmf_per_kg">KMF / kg</option><option value="kmf_per_m3">KMF / m³</option><option value="kmf_per_order">KMF / commande</option><option value="kmf_per_parcel">KMF / colis</option><option value="kmf_per_shipment">KMF / expédition</option><option value="eur">EUR</option><option value="usd">USD</option><option value="aed">AED</option></select><select name="allocation_method"><option value="none">Sans allocation</option><option value="per_order">Par commande</option><option value="per_item">Par article</option><option value="by_value">Selon valeur</option><option value="by_weight">Selon poids</option><option value="by_volume">Selon volume</option><option value="by_quantity">Selon quantité</option><option value="manual">Clé manuelle</option></select><button class="kmc-workspace-action" type="submit">Créer la charge</button>';
    details.appendChild(form);
    return details;
  }

  function findWorkshopSection(rootNode) {
    return Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => section.querySelector('.kmc-section-title')?.textContent.trim() === 'Atelier des coûts') || null;
  }

  function enhance(rootNode, doc, payload, context = {}) {
    if (!rootNode || !doc || !payload) return false;
    const workshop = findWorkshopSection(rootNode);
    if (!workshop) return false;
    const marketMode = Boolean(context.requestedMarket);
    const marketCode = context.requestedMarket || payload.scope?.market_code || 'Marché';
    const canManage = canManageCosts(payload, marketMode);
    workshop.dataset.pricingWorkshopEnhanced = '';
    workshop.dataset.pricingWorkshopAccess = marketMode ? (canManage ? 'manager' : 'viewer') : 'global';

    const description = workshop.querySelector('.kmc-section-description');
    if (description) description.textContent = marketMode
      ? (canManage ? `Pilotez les charges de ${marketCode}. Toute modification est recalculée par le moteur avant rafraîchissement des résultats.` : `Consultez les charges effectives de ${marketCode}, leurs sources et leurs impacts.`)
      : 'Le modèle central des charges : nature, périmètre, allocation, provenance et impact économique.';

    const slot = workshop.querySelector('[data-section-slot]');
    if (!slot) return false;
    slot.replaceChildren();
    slot.appendChild(createFormula(doc, marketMode, marketCode, canManage));
    if (marketMode && !canManage) slot.appendChild(el(doc, 'div', 'kmc-cost-inactive-note', 'Mode viewer · les calculs et leviers restent visibles, les mutations sont réservées au manager du marché.'));

    const components = Array.isArray(payload.cost_components) ? payload.cost_components : [];
    if (!components.length) slot.appendChild(el(doc, 'div', 'kmc-workspace-empty', 'Aucune charge disponible.'));
    else groupComponents(components).forEach(group => slot.appendChild(createGroup(doc, group, marketMode, marketCode, canManage)));
    if (!marketMode) slot.appendChild(createGlobalComponentForm(doc));

    const firstOtherSection = Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => section !== workshop);
    if (!marketMode && firstOtherSection && workshop !== firstOtherSection) rootNode.insertBefore(workshop, firstOtherSection);
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__presentationInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function enhancedMount(options) {
      const payload = await originalMount(options);
      enhance(options.root, options.document || rootObject.document, payload, { requestedMarket: options.requestedMarket || null });
      return payload;
    };
    workspace.__presentationInstalled = true;
    return true;
  }

  return {
    GROUPS, CATEGORY_LABELS, UNIT_LABELS, TRUTH_LABELS, ALLOCATION_LABELS,
    economicNature, allocationPerimeter, groupKey, groupComponents, unitLabel, categoryLabel,
    scopeLabel, allocationLabel, formatComponentValue, canManageCosts, createExplainability, enhance, install,
  };
});