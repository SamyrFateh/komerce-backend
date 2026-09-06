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
 * @doctrine      presentation_only_server_remains_authority, workspace_acts_dashboard_observes, viewer_reads_manager_writes, every_cost_line_is_explainable
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
      key: 'n1',
      eyebrow: 'N1 · COÛT RENDU RELAIS',
      title: 'Acheter & livrer',
      description: 'Tout ce qu’il faut payer pour amener le produit du fournisseur jusqu’au relais client.',
      formula: 'Produit + sourcing + hub variable + emballage + transport + douane + relais',
    },
    {
      key: 'n2',
      eyebrow: 'N2 · COÛTS VARIABLES BUSINESS',
      title: 'Vendre & sécuriser',
      description: 'Les frais variables provoqués par la vente : paiement et risque économique.',
      formula: 'Paiement + provisions de risque',
    },
    {
      key: 'n3',
      eyebrow: 'N3 · STRUCTURE DE PÉRIODE',
      title: 'Porter la structure',
      description: 'Les charges fixes de période servent à mesurer la viabilité et la couverture. Elles ne deviennent pas une dette du SKU.',
      formula: 'Loyers + salaires + logiciels + structure → couverture de période',
    },
    {
      key: 'exceptional',
      eyebrow: 'HORS FONCTIONNEMENT NORMAL',
      title: 'Exceptionnel',
      description: 'Les coûts ponctuels ou de crise. Ils ne doivent pas être confondus avec le fonctionnement courant.',
      formula: 'Incidents + campagnes exceptionnelles',
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
    kmf: 'KMF',
    pct: '% du montant',
    kmf_per_kg: 'KMF / kg',
    kmf_per_m3: 'KMF / m³',
    kmf_per_order: 'KMF / commande',
    kmf_per_parcel: 'KMF / colis',
    kmf_per_shipment: 'KMF / expédition',
    aed: 'AED',
    eur: 'EUR',
    usd: 'USD',
  });

  const SCOPE_LABELS = Object.freeze({
    global: 'Global',
    category: 'Catégorie',
    product: 'Produit',
    order: 'Commande',
    parcel: 'Colis',
    shipment: 'Expédition',
    supplier: 'Fournisseur',
    relay: 'Relais',
  });

  const ICONS = Object.freeze({
    BANK: '🏦', CLOCK: '⏱️', CHECK: '✓', TAG: '🏷️', BOX: '📦', SHIP: '🚢',
    SHIELD: '🛡️', GLASS: '🔎', CLIPBOARD: '📋', PORT: '⚓', TRUCK: '🚚', BOAT: '⛴️',
    COIN: '🪙', CARD: '💳', MONEY: '💵', WARNING: '⚠️', BREAK: '📦', BUILDING: '🏢', STORM: '🌪️',
  });

  const TRUTH_LABELS = Object.freeze({
    observed_real: ['Réel constaté', 'active'],
    external_reference: ['Référence externe', 'inherited'],
    configured_override: ['Hypothèse pays', 'override'],
    declared: ['Déclaré', 'override'],
    configured: ['Hypothèse configurée', 'inherited'],
    missing: ['Donnée manquante', 'inactive'],
  });

  function groupKey(component = {}) {
    if (component.family === 'exceptional') return 'exceptional';
    if (component.family === 'landed_relay') return 'n1';
    if (component.family === 'business' && component.category === 'fixed_overhead') return 'n3';
    if (component.family === 'business') return 'n2';
    return 'exceptional';
  }

  function groupComponents(components = []) {
    const grouped = new Map(GROUPS.map(group => [group.key, []]));
    components.forEach(component => grouped.get(groupKey(component)).push(component));
    return GROUPS.map(group => ({ ...group, components: grouped.get(group.key) })).filter(group => group.components.length);
  }

  function unitLabel(unit) {
    return UNIT_LABELS[unit] || unit || 'unité';
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || String(category || 'Autre').replaceAll('_', ' ');
  }

  function scopeLabel(scope) {
    return SCOPE_LABELS[scope] || scope || 'Global';
  }

  function humanizeKey(key) {
    return String(key || '').replace(/_(kmf|pct|eur|usd|aed)$/i, '').replaceAll('_', ' ').replace(/^./, value => value.toUpperCase());
  }

  function iconFor(component = {}) {
    const raw = String(component.emoji || '').trim();
    if (!raw) return '•';
    return ICONS[raw] || raw;
  }

  function numberValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(number);
  }

  function formatComponentValue(value, unit) {
    if (value == null || value === '') return '—';
    return `${numberValue(value)} ${unitLabel(unit)}`;
  }

  function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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

  function pill(doc, label, tone) {
    return el(doc, 'span', `kmc-cost-pill${tone ? ` is-${tone}` : ''}`, label);
  }

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
    copy.appendChild(el(doc, 'strong', 'kmc-cost-formula-title', 'Le prix se construit par étages, pas par une addition opaque.'));
    copy.appendChild(el(doc, 'p', 'kmc-cost-formula-text', marketMode
      ? (canManage
        ? `Vous ajustez uniquement ${marketCode}. Chaque ligne indique maintenant sa provenance, son hypothèse, son mouvement et son impact.`
        : `Vous consultez le modèle effectif de ${marketCode}. Les valeurs, leurs sources, leurs hypothèses et leurs impacts restent visibles en lecture seule.`)
      : 'Vous modifiez ici le modèle central. Chaque ligne explique ce qui est manipulé, sa provenance, son niveau de vérité et son impact économique.'));
    block.appendChild(copy);

    const rail = el(doc, 'div', 'kmc-cost-formula-rail');
    [
      ['N1', 'Acheter & livrer', 'Variable rendu relais'],
      ['+', '', ''],
      ['N2', 'Vendre & sécuriser', 'Variable business'],
      ['+', '', ''],
      ['N3', 'Porter la structure', 'Couverture de période'],
      ['+', '', ''],
      ['Marge', 'Décision commerciale', 'Prix final'],
    ].forEach(([step, title, subtitle]) => {
      if (step === '+') {
        rail.appendChild(el(doc, 'span', 'kmc-cost-formula-plus', '+'));
        return;
      }
      const card = el(doc, 'div', `kmc-cost-formula-step is-${String(step).toLowerCase()}`);
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

    body.appendChild(explanationItem(
      doc,
      'Hypothèse portée',
      explain.hypothesis?.text,
      explain.hypothesis?.is_explicit_human_note ? 'Note explicite saisie sur cette ligne.' : 'Hypothèse canonique tant qu’une meilleure preuve n’est pas disponible.'
    ));

    body.appendChild(explanationItem(
      doc,
      'Ce qui la fait bouger',
      explain.movement?.driver,
      explain.movement?.changes_when
    ));

    body.appendChild(explanationItem(
      doc,
      `Impact ${explain.impact?.layer || ''}`.trim(),
      explain.impact?.price_effect,
      explain.impact?.path
    ));

    body.appendChild(explanationItem(
      doc,
      'Qualité de vérité',
      explain.evidence?.confidence_label,
      explain.evidence?.caution
    ));

    details.appendChild(body);
    return details;
  }

  function createComponentCard(doc, component, marketMode, marketCode, canManage = true) {
    const inherited = marketMode && component.inherited !== false;
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
    meta.appendChild(pill(doc, categoryLabel(component.category), 'category'));
    meta.appendChild(pill(doc, unitLabel(component.unit), 'unit'));
    if (marketMode) meta.appendChild(pill(doc, inherited ? 'Hérité du global' : `Override ${marketCode}`, inherited ? 'inherited' : 'override'));
    else meta.appendChild(pill(doc, scopeLabel(component.scope), 'scope'));
    meta.appendChild(pill(doc, component.is_active === false ? 'Inactif' : 'Actif', component.is_active === false ? 'inactive' : 'active'));
    const truth = TRUTH_LABELS[component.explainability?.evidence?.truth_state];
    if (truth) meta.appendChild(pill(doc, truth[0], truth[1]));
    if (marketMode && !canManage) meta.appendChild(pill(doc, 'Lecture seule', 'scope'));
    copy.appendChild(meta);
    identity.appendChild(copy);
    card.appendChild(identity);

    const editor = el(doc, 'div', 'kmc-cost-card-editor');
    const label = el(doc, 'label', 'kmc-cost-value-label');
    label.appendChild(el(doc, 'span', '', marketMode
      ? (canManage ? `Valeur pour ${marketCode}` : `Valeur effective pour ${marketCode}`)
      : 'Valeur centrale'));
    const inputWrap = el(doc, 'div', 'kmc-cost-value-input-wrap');
    const input = doc.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.value = component.default_value == null ? '' : component.default_value;
    input.dataset.costValue = component.key;
    input.setAttribute('aria-label', `${component.label || component.key} — valeur`);
    if (marketMode && !canManage) {
      input.disabled = true;
      input.readOnly = true;
      input.setAttribute('aria-readonly', 'true');
    }
    inputWrap.appendChild(input);
    inputWrap.appendChild(el(doc, 'span', 'kmc-cost-value-unit', unitLabel(component.unit)));
    label.appendChild(inputWrap);
    editor.appendChild(label);

    if (marketMode) {
      const comparison = el(doc, 'div', 'kmc-cost-comparison');
      comparison.appendChild(el(doc, 'span', '', 'Base globale'));
      comparison.appendChild(el(doc, 'strong', '', formatComponentValue(component.base_default_value, component.unit)));
      if (inherited) comparison.appendChild(el(doc, 'small', '', 'La valeur locale suit actuellement cette base.'));
      else comparison.appendChild(el(doc, 'small', '', 'Cette valeur remplace la base globale pour ce marché.'));
      editor.appendChild(comparison);
    }

    if (component.is_active === false) {
      editor.appendChild(el(doc, 'div', 'kmc-cost-inactive-note', 'Ce coût est désactivé et n’entre pas dans le calcul actif.'));
    }

    const explanation = createExplainability(doc, component);
    if (explanation) editor.appendChild(explanation);

    const actions = el(doc, 'div', 'kmc-cost-card-actions');
    if (canManage) {
      actions.appendChild(actionButton(doc, 'Enregistrer', 'save-cost', component.key));
      actions.appendChild(actionButton(doc, component.is_active === false ? 'Activer' : 'Désactiver', 'toggle-cost', component.key, true));
      if (marketMode && component.inherited === false) {
        actions.appendChild(actionButton(doc, 'Revenir au global', 'reset-cost', component.key, true));
      }
    } else {
      actions.appendChild(el(doc, 'div', 'kmc-cost-inactive-note', 'Lecture seule · un manager pays est requis pour modifier cet élément.'));
    }
    editor.appendChild(actions);

    const technical = doc.createElement('details');
    technical.className = 'kmc-cost-technical';
    const summary = el(doc, 'summary', '', 'Détails techniques');
    technical.appendChild(summary);
    const technicalBody = el(doc, 'div', 'kmc-cost-technical-body');
    technicalBody.appendChild(el(doc, 'code', '', component.key));
    if (component.allocation_method) technicalBody.appendChild(el(doc, 'span', '', `Allocation : ${String(component.allocation_method).replaceAll('_', ' ')}`));
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
    header.appendChild(pill(doc, `${group.components.length} coût${group.components.length > 1 ? 's' : ''}`, 'count'));
    section.appendChild(header);

    const cards = el(doc, 'div', 'kmc-cost-card-list');
    group.components.forEach(component => cards.appendChild(createComponentCard(doc, component, marketMode, marketCode, canManage)));
    section.appendChild(cards);
    return section;
  }

  function createGlobalComponentForm(doc) {
    const details = doc.createElement('details');
    details.className = 'kmc-cost-create';
    details.appendChild(el(doc, 'summary', '', '＋ Ajouter un composant au modèle central'));
    details.appendChild(el(doc, 'p', 'kmc-cost-create-help', 'Réservé à l’autorité Pricing centrale. Les managers pays ne créent pas de nouvelles catégories de coûts.'));
    const form = doc.createElement('form');
    form.className = 'kmc-workspace-inline-form kmc-cost-create-form';
    form.dataset.pricingCostForm = '';
    form.innerHTML = '<input name="key" required placeholder="clé technique"><input name="label" required placeholder="Nom affiché"><select name="family"><option value="landed_relay">N1 · rendu relais</option><option value="business">N2/N3 · business</option><option value="exceptional">Exceptionnel</option></select><input name="category" required placeholder="catégorie"><input name="default_value" type="number" min="0" step="0.01" required placeholder="valeur"><select name="unit"><option value="kmf">KMF</option><option value="pct">%</option><option value="kmf_per_kg">KMF / kg</option><option value="kmf_per_m3">KMF / m³</option><option value="kmf_per_order">KMF / commande</option><option value="kmf_per_parcel">KMF / colis</option><option value="kmf_per_shipment">KMF / expédition</option><option value="eur">EUR</option><option value="usd">USD</option><option value="aed">AED</option></select><button class="kmc-workspace-action" type="submit">Créer le composant</button>';
    details.appendChild(form);
    return details;
  }

  function findWorkshopSection(rootNode) {
    return Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {
      const title = section.querySelector('.kmc-section-title');
      return title && title.textContent.trim() === 'Atelier des coûts';
    }) || null;
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
    if (description) {
      description.textContent = marketMode
        ? (canManage
          ? `Construisez le coût économique de ${marketCode} en voyant ce qui est réel, configuré ou hypothétique.`
          : `Consultez le coût économique de ${marketCode}, ses sources, hypothèses et impacts. Votre accès est en lecture seule.`)
        : 'Le modèle de coûts central expliqué ligne par ligne : valeur, provenance, hypothèse, mouvement et impact.';
    }

    const slot = workshop.querySelector('[data-section-slot]');
    if (!slot) return false;
    slot.replaceChildren();
    slot.appendChild(createFormula(doc, marketMode, marketCode, canManage));
    if (marketMode && !canManage) {
      slot.appendChild(el(doc, 'div', 'kmc-cost-inactive-note', 'Mode viewer · vous pouvez analyser les valeurs effectives, les overrides pays, la base globale, les hypothèses et les impacts. Les mutations sont réservées au manager du marché.'));
    }

    const components = Array.isArray(payload.cost_components) ? payload.cost_components : [];
    if (!components.length) {
      slot.appendChild(el(doc, 'div', 'kmc-workspace-empty', 'Aucun composant de coût disponible.'));
    } else {
      groupComponents(components).forEach(group => slot.appendChild(createGroup(doc, group, marketMode, marketCode, canManage)));
    }
    if (!marketMode) slot.appendChild(createGlobalComponentForm(doc));

    const firstOtherSection = Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => section !== workshop);
    if (firstOtherSection && workshop !== firstOtherSection) rootNode.insertBefore(workshop, firstOtherSection);
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__presentationInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function enhancedMount(options) {
      const payload = await originalMount(options);
      enhance(options.root, options.document || rootObject.document, payload, {
        requestedMarket: options.requestedMarket || null,
      });
      return payload;
    };
    workspace.__presentationInstalled = true;
    return true;
  }

  return {
    GROUPS,
    CATEGORY_LABELS,
    UNIT_LABELS,
    TRUTH_LABELS,
    groupKey,
    groupComponents,
    unitLabel,
    categoryLabel,
    scopeLabel,
    formatComponentValue,
    canManageCosts,
    createExplainability,
    enhance,
    install,
  };
});
