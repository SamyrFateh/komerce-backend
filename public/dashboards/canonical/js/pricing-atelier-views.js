/**
 * @komerce-arch
 * @role          canonical-pricing-atelier-views-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        pricing_market_workspace_projection, market_corridor_projection, activation_preview_projection
 * @outputs       atelier_three_views_dom, product_decision_dossier_dom, authorized_pricing_action_requests
 * @depends       canonical pricing workspace, canonical economic cockpit
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, server_computes_pricing, browser_business_refs_only, one_decision_one_authority
 * @impact-areas  admin-dashboard, pricing
 * @version       2026-10
 */

'use strict';

(function initPricingAtelierViews(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.KomerceCanonicalPricingAtelierViews = api;
    api.install(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingAtelierViews() {
  const VIEWS = Object.freeze([
    { key: 'economic', label: 'Vue économique' },
    { key: 'products', label: 'Produits à décider' },
    { key: 'costs', label: 'Modèle de coûts' },
  ]);
  const PAGE_SIZE = 25;
  const CONCURRENCY = 6;

  const STATES = Object.freeze({
    cost_missing: { rank: 0, label: 'Coût d’achat absent', tone: 'danger', cause: 'Décision bloquée : le coût source est inconnu.', action: 'Compléter le coût' },
    under_floor: { rank: 1, label: 'Sous le plancher moteur', tone: 'danger', cause: 'Le prix pays est inférieur au plancher calculé par le serveur.', action: 'Examiner & simuler' },
    to_decide: { rank: 2, label: 'Prix pays à décider', tone: 'warning', cause: 'Aucun prix pays enregistré : le prix global reste la base.', action: 'Examiner & simuler' },
    draft: { rank: 3, label: 'Brouillon à activer', tone: 'info', cause: 'Un prix pays est enregistré mais pas encore actif.', action: 'Examiner & activer' },
    active: { rank: 4, label: 'Prix pays actif', tone: 'success', cause: 'Décision appliquée au marché.', action: 'Revoir' },
  });

  const FILTERS = Object.freeze([
    { key: 'all', label: 'Tous' },
    { key: 'todo', label: 'À traiter' },
    { key: 'cost_missing', label: 'Coût absent' },
    { key: 'under_floor', label: 'Sous plancher' },
    { key: 'draft', label: 'Brouillons' },
    { key: 'active', label: 'Actifs' },
  ]);

  // ── Fonctions pures ──────────────────────────────────────────────────────
  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function resolveView(search) {
    const params = new URLSearchParams(search || '');
    const view = params.get('view');
    if (VIEWS.some(item => item.key === view)) return view;
    return params.get('product_ref') ? 'products' : 'economic';
  }

  function withParams(search, updates) {
    const params = new URLSearchParams(search || '');
    Object.entries(updates || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    const text = params.toString();
    return text ? `?${text}` : '';
  }

  // Classement d'affichage uniquement : aucune valeur économique n'est recalculée.
  // Le serveur reste l'autorité du plancher et de l'activation.
  function classifyProduct(corridor) {
    const product = (corridor && corridor.product) || {};
    const selected = (corridor && corridor.selected) || {};
    const economics = selected.economics || {};
    const candidate = (corridor && corridor.candidate) || null;
    const purchase = num(product.purchase_cost_kmf);
    const purchaseSource = economics.data_quality && economics.data_quality.sources
      ? economics.data_quality.sources.purchase_price : null;
    const costMissing = purchase === null || purchase <= 0 || purchaseSource === 'missing';
    const floor = num(economics.minimum_safe_price_kmf);
    const active = selected.buyer_effective === true;
    const localPriceKmf = active ? num(selected.price_kmf) : candidate ? num(candidate.price_kmf) : null;
    let key;
    if (costMissing) key = 'cost_missing';
    else if (localPriceKmf !== null && floor !== null && localPriceKmf < floor) key = 'under_floor';
    else if (active) key = 'active';
    else if (candidate) key = 'draft';
    else key = 'to_decide';
    return { key, ...STATES[key], costMissing, floor, localPriceKmf };
  }

  function summarizeQueue(rows) {
    const counts = { all: rows.length, todo: 0, cost_missing: 0, under_floor: 0, to_decide: 0, draft: 0, active: 0 };
    rows.forEach(row => {
      counts[row.state.key] += 1;
      if (row.state.key !== 'active') counts.todo += 1;
    });
    return counts;
  }

  function filterRows(rows, filter, search) {
    const term = String(search || '').trim().toLowerCase();
    return rows
      .filter(row => {
        if (filter === 'all' || !filter) return true;
        if (filter === 'todo') return row.state.key !== 'active';
        return row.state.key === filter;
      })
      .filter(row => !term || `${row.product.name || ''} ${row.product.product_ref || ''}`.toLowerCase().includes(term))
      .sort((a, b) => a.state.rank - b.state.rank);
  }

  function missingCostComponents(components) {
    return (Array.isArray(components) ? components : []).filter(component =>
      component.is_active !== false && !component.is_exceptional && component.family !== 'exceptional'
      && num(component.default_value) === null);
  }

  function priorityItems({ decision, components, counts, evaluated, total, reasonLabels }) {
    const items = [];
    if (decision && decision.decision_status && decision.decision_status !== 'DECISIONAL') {
      const reason = (reasonLabels && reasonLabels[decision.reason]) || decision.reason || 'Raison serveur non précisée.';
      items.push({ id: 'gate', tone: 'warning', title: 'Couverture non décisionnelle', detail: reason, action: null });
    }
    const gaps = missingCostComponents(components);
    if (gaps.length) {
      items.push({
        id: 'cost-lines', tone: 'danger', title: `${gaps.length} ligne${gaps.length > 1 ? 's' : ''} du modèle de coûts sans valeur`,
        detail: gaps.slice(0, 3).map(component => component.label || component.key).join(' · '),
        action: { label: 'Ouvrir le modèle de coûts', view: 'costs' },
      });
    }
    if (counts) {
      const scope = `Parmi ${evaluated} produit${evaluated > 1 ? 's' : ''} évalué${evaluated > 1 ? 's' : ''} sur ${total}.`;
      [['cost_missing', 'sans coût d’achat', 'danger'], ['under_floor', 'sous le plancher moteur', 'danger'], ['to_decide', 'sans prix pays décidé', 'warning'], ['draft', 'en brouillon à activer', 'info']]
        .forEach(([key, label, tone]) => {
          if (counts[key] > 0) {
            items.push({
              id: `products-${key}`, tone, title: `${counts[key]} produit${counts[key] > 1 ? 's' : ''} ${label}`, detail: scope,
              action: { label: 'Examiner ces produits', view: 'products', filter: key },
            });
          }
        });
    }
    return items;
  }

  function observationPayload(form) {
    const competitor = String(form.competitor_name || '').trim();
    const amount = num(form.amount);
    if (competitor.length < 2) return { error: 'Nom du concurrent requis (2 caractères minimum).' };
    if (amount === null || amount <= 0) return { error: 'Montant observé invalide.' };
    const body = { competitor_name: competitor, amount, source: String(form.source || 'market_manager').trim() || 'market_manager' };
    const notes = String(form.notes || '').trim();
    if (notes) body.notes = notes;
    return { body };
  }

  function formatKmf(value) {
    const n = num(value);
    return n === null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)} KMF`;
  }

  function formatMoney(value, currency) {
    const n = num(value);
    if (n === null) return '—';
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)} ${currency || 'KMF'}`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
  }

  const SOURCE_LABELS = Object.freeze({ real: 'réel', category: 'catégorie', estimated: 'estimé', default: 'par défaut', manual: 'saisi', missing: 'manquant', supplier: 'fournisseur', not_estimated: 'non estimé' });
  function sourceLabel(value) {
    return SOURCE_LABELS[String(value || '').toLowerCase()] || (value ? String(value) : '—');
  }

  const CONFIDENCE_LABELS = Object.freeze({ low: 'faible', medium: 'moyenne', high: 'élevée' });
  const FIELD_LABELS = Object.freeze({ weight: 'poids', volume: 'volume', customs_category: 'catégorie douanière', purchase_price: 'coût d’achat' });
  const STATUS_LABELS = Object.freeze({ LOCAL_DRAFT: 'brouillon', LOCAL_ACTIVE: 'actif', LOCAL_RESET: 'réinitialisé' });
  const label = (map, key) => map[key] || (key ? String(key) : 'non précisé');

  function catalogueHref(marketCode, productRef, returnTo) {
    const params = new URLSearchParams({ market: marketCode, product_ref: productRef });
    if (returnTo) params.set('return_to', returnTo);
    return `/dashboards/canonical/market-catalog.html?${params.toString()}#market-ready-to-sell`;
  }

  // ── Rendu DOM ────────────────────────────────────────────────────────────
  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }

  function button(doc, label, className, attrs = {}) {
    const node = el(doc, 'button', className, label);
    node.type = 'button';
    Object.entries(attrs).forEach(([key, value]) => { node.dataset[key] = value; });
    return node;
  }

  function badge(doc, label, tone) {
    return el(doc, 'span', `kmc-atelier-badge is-${tone || 'neutral'}`, label);
  }

  function buildNav(doc, active, counts) {
    const nav = el(doc, 'div', 'kmc-atelier-nav');
    nav.dataset.atelierNav = '';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Vues de l’Atelier des prix');
    VIEWS.forEach(view => {
      const tab = button(doc, view.label, `kmc-atelier-tab${view.key === active ? ' is-active' : ''}`, { atelierView: view.key });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', view.key === active ? 'true' : 'false');
      if (view.key === 'products' && counts && counts.todo > 0) tab.appendChild(el(doc, 'span', 'kmc-atelier-tab-count', counts.todo));
      nav.appendChild(tab);
    });
    return nav;
  }

  function buildPriorities(doc, items, pending) {
    const section = el(doc, 'section', 'kmc-atelier-priorities');
    section.dataset.atelierPriorities = '';
    section.appendChild(el(doc, 'h3', '', 'Priorités économiques'));
    if (!items.length) {
      section.appendChild(el(doc, 'p', 'kmc-atelier-muted', pending
        ? 'Évaluation des produits en cours…'
        : 'Aucune priorité détectée sur les données disponibles.'));
      return section;
    }
    const list = el(doc, 'ul', 'kmc-atelier-priority-list');
    items.forEach(item => {
      const row = el(doc, 'li', `kmc-atelier-priority is-${item.tone}`);
      const copy = el(doc, 'div', 'kmc-atelier-priority-copy');
      copy.appendChild(el(doc, 'strong', '', item.title));
      if (item.detail) copy.appendChild(el(doc, 'span', '', item.detail));
      row.appendChild(copy);
      if (item.action) {
        const go = button(doc, item.action.label, 'kmc-atelier-link-button', { atelierGo: item.action.view });
        if (item.action.filter) go.dataset.atelierFilter = item.action.filter;
        row.appendChild(go);
      }
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  function queueRow(doc, row, marketCode, returnTo, canDecide) {
    const { product, state, corridor } = row;
    const selected = (corridor && corridor.selected) || {};
    const economics = selected.economics || {};
    const candidate = corridor && corridor.candidate;
    const currency = (corridor && corridor.market && corridor.market.currency) || 'KMF';
    const item = el(doc, 'div', `kmc-atelier-row is-${state.tone}`);
    item.setAttribute('role', 'listitem');
    item.dataset.productRef = product.product_ref;
    item.dataset.state = state.key;

    const identity = el(doc, 'div', 'kmc-atelier-cell is-product');
    identity.appendChild(el(doc, 'strong', '', product.name || product.product_ref));
    identity.appendChild(el(doc, 'small', '', product.product_ref));
    item.appendChild(identity);

    const price = el(doc, 'div', 'kmc-atelier-cell');
    price.appendChild(el(doc, 'span', 'kmc-atelier-label', 'Prix pays'));
    if (selected.buyer_effective && selected.local_amount != null) price.appendChild(el(doc, 'strong', '', formatMoney(selected.local_amount, selected.local_currency || currency)));
    else if (candidate) price.appendChild(el(doc, 'strong', '', `${formatMoney(candidate.amount, candidate.currency || currency)} (brouillon)`));
    else price.appendChild(el(doc, 'strong', '', 'Non décidé'));
    item.appendChild(price);

    const cost = el(doc, 'div', 'kmc-atelier-cell');
    cost.appendChild(el(doc, 'span', 'kmc-atelier-label', 'Coût d’achat'));
    cost.appendChild(el(doc, 'strong', state.costMissing ? 'is-missing' : '', state.costMissing ? 'MANQUANT' : formatKmf(product.purchase_cost_kmf)));
    item.appendChild(cost);

    const floor = el(doc, 'div', 'kmc-atelier-cell');
    floor.appendChild(el(doc, 'span', 'kmc-atelier-label', 'Plancher moteur'));
    floor.appendChild(el(doc, 'strong', '', state.costMissing ? 'Indisponible' : formatKmf(economics.minimum_safe_price_kmf)));
    item.appendChild(floor);

    const status = el(doc, 'div', 'kmc-atelier-cell is-status');
    status.appendChild(badge(doc, state.label, state.tone));
    status.appendChild(el(doc, 'small', '', state.cause));
    item.appendChild(status);

    const actions = el(doc, 'div', 'kmc-atelier-cell is-actions');
    if (state.key === 'cost_missing') {
      const link = el(doc, 'a', 'kmc-atelier-primary', state.action);
      link.href = `/admin/products/${encodeURIComponent(product.product_ref)}?return_to=${encodeURIComponent(returnTo)}`;
      actions.appendChild(link);
    } else if (canDecide || state.key === 'active') {
      actions.appendChild(button(doc, state.action, 'kmc-atelier-primary', { atelierOpen: product.product_ref }));
    } else {
      actions.appendChild(button(doc, 'Consulter le dossier', 'kmc-atelier-primary is-secondary', { atelierOpen: product.product_ref }));
    }
    const menu = el(doc, 'details', 'kmc-atelier-menu');
    menu.appendChild(el(doc, 'summary', '', '⋯'));
    menu.firstChild.setAttribute('aria-label', `Autres actions pour ${product.product_ref}`);
    const sheet = el(doc, 'a', '', 'Fiche produit');
    sheet.href = `/admin/products/${encodeURIComponent(product.product_ref)}?return_to=${encodeURIComponent(returnTo)}`;
    menu.appendChild(sheet);
    const market = el(doc, 'a', '', 'Catalogue pays');
    market.href = catalogueHref(marketCode, product.product_ref, returnTo);
    menu.appendChild(market);
    actions.appendChild(menu);
    item.appendChild(actions);
    return item;
  }

  function buildQueue(doc, model) {
    const section = el(doc, 'section', 'kmc-atelier-queue');
    section.dataset.atelierQueue = '';
    const head = el(doc, 'div', 'kmc-atelier-queue-head');
    head.appendChild(el(doc, 'h3', '', 'Produits à décider'));
    const search = doc.createElement('input');
    search.type = 'search';
    search.placeholder = 'Rechercher un produit ou une référence…';
    search.value = model.search || '';
    search.dataset.atelierSearch = '';
    search.setAttribute('aria-label', 'Rechercher un produit');
    head.appendChild(search);
    section.appendChild(head);

    const filters = el(doc, 'div', 'kmc-atelier-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filtrer la file');
    FILTERS.forEach(filter => {
      const count = model.counts[filter.key];
      const chip = button(doc, `${filter.label}${count !== undefined ? ` (${count})` : ''}`, `kmc-atelier-chip${model.filter === filter.key ? ' is-active' : ''}`, { atelierFilterChip: filter.key });
      chip.setAttribute('aria-pressed', model.filter === filter.key ? 'true' : 'false');
      filters.appendChild(chip);
    });
    section.appendChild(filters);

    if (model.error) {
      const alert = el(doc, 'div', 'kmc-atelier-alert', model.error);
      alert.setAttribute('role', 'alert');
      section.appendChild(alert);
    }
    if (!model.canDecide) {
      section.appendChild(el(doc, 'p', 'kmc-atelier-note', 'Lecture seule : le droit de décision pays (pricing.decide) n’est pas attribué à ce compte. Les dossiers restent consultables.'));
    }
    const list = el(doc, 'div', 'kmc-atelier-list');
    list.setAttribute('role', 'list');
    const columns = el(doc, 'div', 'kmc-atelier-row is-head');
    columns.setAttribute('aria-hidden', 'true');
    ['Produit', 'Prix pays', 'Coût d’achat', 'Plancher moteur', 'État et cause', 'Action'].forEach(name => columns.appendChild(el(doc, 'span', '', name)));
    list.appendChild(columns);
    if (model.loading && !model.rows.length) {
      list.appendChild(el(doc, 'div', 'kmc-atelier-empty', 'Évaluation des produits par le serveur…'));
    } else if (!model.visible.length) {
      list.appendChild(el(doc, 'div', 'kmc-atelier-empty', model.total === 0
        ? 'Aucun produit à décider sur ce marché.'
        : 'Aucun produit ne correspond à ce filtre.'));
    } else {
      model.visible.forEach(row => list.appendChild(queueRow(doc, row, model.marketCode, model.returnTo, model.canDecide)));
    }
    model.failed.forEach(failure => {
      const row = el(doc, 'div', 'kmc-atelier-row is-danger');
      row.setAttribute('role', 'listitem');
      row.appendChild(el(doc, 'strong', '', failure.product.name || failure.product.product_ref));
      row.appendChild(el(doc, 'span', 'kmc-atelier-alert-inline', `Indisponible · ${failure.message}`));
      list.appendChild(row);
    });
    section.appendChild(list);

    const footer = el(doc, 'div', 'kmc-atelier-queue-foot');
    footer.appendChild(el(doc, 'span', 'kmc-atelier-muted', `${model.rows.length} produit${model.rows.length > 1 ? 's' : ''} évalué${model.rows.length > 1 ? 's' : ''} sur ${model.total}`));
    if (model.rows.length + model.failed.length < model.total) {
      footer.appendChild(button(doc, `Évaluer ${Math.min(PAGE_SIZE, model.total - model.rows.length - model.failed.length)} de plus`, 'kmc-atelier-link-button', { atelierMore: '' }));
    }
    section.appendChild(footer);
    return section;
  }

  function metricLine(doc, label, value, tone) {
    const line = el(doc, 'div', 'kmc-atelier-metric');
    line.appendChild(el(doc, 'span', '', label));
    line.appendChild(el(doc, 'strong', tone ? `is-${tone}` : '', value));
    return line;
  }

  function sourcesPanel(doc, corridor, ctx) {
    const panel = el(doc, 'section', 'kmc-atelier-panel');
    panel.dataset.atelierSources = '';
    panel.appendChild(el(doc, 'h4', '', 'Sources et preuves'));
    const economics = (corridor.selected && corridor.selected.economics) || {};
    const quality = economics.data_quality || {};
    const sources = quality.sources || {};
    const state = classifyProduct(corridor);

    panel.appendChild(el(doc, 'h5', '', 'Coûts connus'));
    panel.appendChild(metricLine(doc, 'Coût d’achat', state.costMissing ? 'MANQUANT' : `${formatKmf(corridor.product.purchase_cost_kmf)} · ${sourceLabel(sources.purchase_price)}`, state.costMissing ? 'danger' : ''));
    panel.appendChild(metricLine(doc, 'Coûts variables hors achat', formatKmf(economics.variable_cost_outside_purchase_kmf)));
    panel.appendChild(metricLine(doc, 'Coût variable complet', formatKmf(economics.variable_cost_complete_kmf)));
    panel.appendChild(metricLine(doc, 'CDR de référence', formatKmf(economics.cdr_reference_kmf)));
    const missing = Array.isArray(quality.missing_fields) ? quality.missing_fields : [];
    panel.appendChild(el(doc, 'p', 'kmc-atelier-note', missing.length
      ? `Fiabilité ${label(CONFIDENCE_LABELS, quality.confidence)} : valeurs par défaut pour ${missing.map(field => label(FIELD_LABELS, field)).join(', ')}. Le serveur en tient compte dans le plancher.`
      : `Fiabilité ${label(CONFIDENCE_LABELS, quality.confidence)} : aucun champ manquant signalé.`));

    const local = (corridor.corridor && corridor.corridor.local) || {};
    const currency = (corridor.market && corridor.market.currency) || 'KMF';
    panel.appendChild(el(doc, 'h5', '', 'Concurrence et observations du marché'));
    panel.appendChild(metricLine(doc, 'Observations actives', String(local.sample_count || 0)));
    const point = value => (value && value.observed_amount != null ? formatMoney(value.observed_amount, value.currency || currency) : '—');
    panel.appendChild(metricLine(doc, 'Basse · cible · haute', `${point(local.low)} · ${point(local.target)} · ${point(local.high)}`));
    const observations = Array.isArray(local.observations) ? local.observations.slice(0, 5) : [];
    if (observations.length) {
      const list = el(doc, 'ul', 'kmc-atelier-observations');
      observations.forEach(obs => list.appendChild(el(doc, 'li', '', `${obs.competitor_name || 'Concurrent'} · ${formatMoney(obs.observed_amount, obs.currency || currency)} · ${formatDate(obs.observed_at)} · ${obs.source || 'source non précisée'}`)));
      panel.appendChild(list);
    } else {
      panel.appendChild(el(doc, 'p', 'kmc-atelier-note', 'Aucune observation datée et sourcée sur ce marché. La référence globale reste informative.'));
    }
    if (ctx.canObserve) panel.appendChild(observationForm(doc, corridor.product.product_ref, currency));
    return panel;
  }

  function observationForm(doc, productRef, currency) {
    const form = doc.createElement('form');
    form.className = 'kmc-atelier-form';
    form.dataset.atelierObservationForm = productRef;
    form.appendChild(el(doc, 'h5', '', 'Ajouter une observation'));
    const fields = [['competitor_name', 'Concurrent', 'text'], ['amount', `Prix observé (${currency})`, 'number'], ['source', 'Source (ex. relevé terrain)', 'text']];
    fields.forEach(([name, label, type]) => {
      const wrap = el(doc, 'label', 'kmc-atelier-field');
      wrap.appendChild(el(doc, 'span', '', label));
      const input = doc.createElement('input');
      input.name = name;
      input.type = type;
      if (type === 'number') { input.min = '0.01'; input.step = '0.01'; }
      wrap.appendChild(input);
      form.appendChild(wrap);
    });
    const submit = el(doc, 'button', 'kmc-atelier-secondary', 'Enregistrer l’observation');
    submit.type = 'submit';
    form.appendChild(submit);
    return form;
  }

  function simulationResult(doc, result) {
    const box = el(doc, 'div', 'kmc-atelier-sim-result');
    box.dataset.atelierSimResult = '';
    box.appendChild(el(doc, 'p', 'kmc-atelier-note', 'Simulation calculée par le moteur serveur. Aucune donnée n’est enregistrée.'));
    const fields = [['minimum_safe_price_kmf', 'Plancher moteur'], ['recommended_price_kmf', 'Prix conseillé'], ['variable_cost_complete_kmf', 'Coût variable complet'], ['contribution_kmf', 'Contribution']];
    const table = el(doc, 'div', 'kmc-atelier-sim-table');
    ['Indicateur', 'Avant', 'Scénario', 'Écart'].forEach(label => table.appendChild(el(doc, 'strong', 'is-head', label)));
    fields.forEach(([key, label]) => {
      const before = result.baseline && result.baseline.metrics ? result.baseline.metrics[key] : null;
      const after = result.scenario && result.scenario.metrics ? result.scenario.metrics[key] : null;
      const delta = result.delta ? result.delta[key] : null;
      table.appendChild(el(doc, 'span', '', label));
      table.appendChild(el(doc, 'span', '', formatKmf(before)));
      table.appendChild(el(doc, 'span', '', formatKmf(after)));
      table.appendChild(el(doc, 'span', '', delta === null || delta === undefined ? '—' : `${delta > 0 ? '+' : ''}${formatKmf(delta)}`));
    });
    box.appendChild(table);
    return box;
  }

  function decisionPanel(doc, corridor, ctx) {
    const panel = el(doc, 'section', 'kmc-atelier-panel');
    panel.dataset.atelierDecision = '';
    panel.appendChild(el(doc, 'h4', '', 'Décision'));
    const selected = corridor.selected || {};
    const economics = selected.economics || {};
    const candidate = corridor.candidate || null;
    const currency = (corridor.market && corridor.market.currency) || 'KMF';
    const state = classifyProduct(corridor);

    panel.appendChild(metricLine(doc, 'Plancher moteur', state.costMissing ? 'Indisponible' : formatKmf(economics.minimum_safe_price_kmf)));
    panel.appendChild(metricLine(doc, 'Prix conseillé (couverture)', state.costMissing ? 'Indisponible' : formatKmf(economics.coverage_reference_price_kmf)));
    panel.appendChild(metricLine(doc, 'Prix actif pour l’acheteur', selected.buyer_effective && selected.local_amount != null
      ? formatMoney(selected.local_amount, selected.local_currency || currency)
      : 'Aucun prix pays actif (base globale)'));
    panel.appendChild(metricLine(doc, 'Brouillon pays', candidate ? `${formatMoney(candidate.amount, candidate.currency || currency)} · ${label(STATUS_LABELS, candidate.status)}` : 'Aucun'));
    panel.appendChild(metricLine(doc, 'Gate de marché', ctx.decision && ctx.decision.decision_status
      ? `${ctx.decision.decision_status === 'DECISIONAL' ? 'Décisionnel' : 'Non décisionnel'}${ctx.decision.reason ? ` · ${(ctx.reasonLabels && ctx.reasonLabels[ctx.decision.reason]) || ctx.decision.reason}` : ''}`
      : 'Indisponible'));

    if (ctx.preview) {
      const verdict = ctx.preview.activation || {};
      const box = el(doc, 'div', `kmc-atelier-verdict is-${verdict.allowed ? 'success' : 'danger'}`);
      box.dataset.atelierVerdict = '';
      box.appendChild(el(doc, 'strong', '', verdict.allowed ? 'Activation autorisée par le serveur' : 'Activation refusée par le serveur'));
      box.appendChild(el(doc, 'span', '', verdict.reason || 'Motif non précisé.'));
      panel.appendChild(box);
    } else if (ctx.previewError) {
      const box = el(doc, 'div', 'kmc-atelier-alert', `Évaluation du brouillon indisponible : ${ctx.previewError}`);
      box.setAttribute('role', 'alert');
      panel.appendChild(box);
    }

    if (state.costMissing) {
      panel.appendChild(el(doc, 'p', 'kmc-atelier-note', 'Décision bloquée : renseignez d’abord le coût d’achat dans la fiche produit. Aucun prix n’est déterminable sans coût source.'));
    } else if (ctx.canDraft) {
      const form = doc.createElement('form');
      form.className = 'kmc-atelier-form';
      form.dataset.atelierDraftForm = corridor.product.product_ref;
      const wrap = el(doc, 'label', 'kmc-atelier-field');
      wrap.appendChild(el(doc, 'span', '', `Prix pays proposé (${currency})`));
      const input = doc.createElement('input');
      input.type = 'number';
      input.name = 'amount';
      input.min = '0.01';
      input.step = '0.01';
      input.required = true;
      input.value = candidate ? candidate.amount : '';
      wrap.appendChild(input);
      form.appendChild(wrap);
      const submit = el(doc, 'button', 'kmc-atelier-secondary', 'Enregistrer le brouillon et évaluer');
      submit.type = 'submit';
      form.appendChild(submit);
      form.appendChild(el(doc, 'small', 'kmc-atelier-note', 'Un brouillon n’expose rien à la vente. Le serveur évalue ensuite l’activation.'));
      panel.appendChild(form);
    } else {
      panel.appendChild(el(doc, 'p', 'kmc-atelier-note', 'Droit pricing.decide absent : vous pouvez lire le dossier mais pas enregistrer de prix pays.'));
    }

    if (ctx.canSimulate && !state.costMissing) panel.appendChild(simulationForm(doc, corridor.product.product_ref, ctx.components));

    const next = el(doc, 'div', 'kmc-atelier-next');
    next.appendChild(el(doc, 'h5', '', 'Suite'));
    if (candidate || selected.buyer_effective) {
      const link = el(doc, 'a', 'kmc-atelier-primary', selected.buyer_effective ? 'Voir dans le Catalogue pays' : 'Activer dans le Catalogue pays →');
      link.href = catalogueHref(ctx.marketCode, corridor.product.product_ref, ctx.returnTo);
      link.dataset.atelierCatalogue = '';
      next.appendChild(link);
      next.appendChild(el(doc, 'small', 'kmc-atelier-note', 'L’activation du prix pays et l’exposition à la vente forment un geste unique, réalisé dans le Catalogue pays.'));
    } else {
      next.appendChild(el(doc, 'small', 'kmc-atelier-note', 'Enregistrez d’abord un prix pays en brouillon : l’activation se fait ensuite dans le Catalogue pays.'));
    }
    panel.appendChild(next);
    return panel;
  }

  function simulationForm(doc, productRef, components) {
    const variable = (Array.isArray(components) ? components : []).filter(component =>
      component.is_active !== false && !component.is_exceptional && component.family !== 'exceptional' && num(component.default_value) !== null).slice(0, 40);
    const details = el(doc, 'details', 'kmc-atelier-sim');
    details.appendChild(el(doc, 'summary', '', 'Simuler un scénario de coûts'));
    if (!variable.length) {
      details.appendChild(el(doc, 'p', 'kmc-atelier-note', 'Aucune ligne de coût valorisée à simuler.'));
      return details;
    }
    const form = doc.createElement('form');
    form.className = 'kmc-atelier-form';
    form.dataset.atelierSimForm = productRef;
    const pick = el(doc, 'label', 'kmc-atelier-field');
    pick.appendChild(el(doc, 'span', '', 'Ligne de coût'));
    const select = doc.createElement('select');
    select.name = 'key';
    variable.forEach(component => {
      const option = doc.createElement('option');
      option.value = component.key;
      option.textContent = `${component.label || component.key} (actuel : ${component.default_value})`;
      select.appendChild(option);
    });
    pick.appendChild(select);
    form.appendChild(pick);
    const value = el(doc, 'label', 'kmc-atelier-field');
    value.appendChild(el(doc, 'span', '', 'Valeur du scénario'));
    const input = doc.createElement('input');
    input.type = 'number';
    input.name = 'value';
    input.min = '0';
    input.step = 'any';
    input.required = true;
    value.appendChild(input);
    form.appendChild(value);
    const submit = el(doc, 'button', 'kmc-atelier-secondary', 'Simuler');
    submit.type = 'submit';
    form.appendChild(submit);
    details.appendChild(form);
    return details;
  }

  function buildDossier(doc, corridor, ctx) {
    const section = el(doc, 'section', 'kmc-atelier-dossier');
    section.dataset.atelierDossier = corridor.product.product_ref;
    const head = el(doc, 'div', 'kmc-atelier-dossier-head');
    head.appendChild(button(doc, '← Retour à la file', 'kmc-atelier-link-button', { atelierBack: '' }));
    const title = el(doc, 'div', 'kmc-atelier-dossier-title');
    title.appendChild(el(doc, 'h3', '', corridor.product.name || corridor.product.product_ref));
    const meta = el(doc, 'p', 'kmc-atelier-muted', `${corridor.product.product_ref} · marché ${ctx.marketCode}`);
    title.appendChild(meta);
    head.appendChild(title);
    const state = classifyProduct(corridor);
    head.appendChild(badge(doc, state.label, state.tone));
    const sheet = el(doc, 'a', 'kmc-atelier-link-button', 'Fiche produit ↗');
    sheet.href = `/admin/products/${encodeURIComponent(corridor.product.product_ref)}?return_to=${encodeURIComponent(ctx.returnTo)}`;
    head.appendChild(sheet);
    section.appendChild(head);
    const feedback = el(doc, 'div', 'kmc-atelier-feedback');
    feedback.dataset.atelierFeedback = '';
    feedback.setAttribute('role', 'status');
    if (ctx.message) feedback.textContent = ctx.message;
    section.appendChild(feedback);
    const grid = el(doc, 'div', 'kmc-atelier-dossier-grid');
    grid.appendChild(sourcesPanel(doc, corridor, ctx));
    grid.appendChild(decisionPanel(doc, corridor, ctx));
    section.appendChild(grid);
    return section;
  }

  // ── Orchestration ────────────────────────────────────────────────────────
  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  function enhance(rootObject, workspace, options, payload) {
    const doc = options.document;
    const rootNode = options.root;
    if (!options.requestedMarket || !rootNode || !payload) return false;
    const cockpit = rootNode.querySelector('[data-pricing-economic-cockpit]');
    const overview = rootNode.querySelector('[data-pricing-decision-overview]');
    if (!cockpit || rootNode.querySelector('[data-atelier-nav]')) return Boolean(cockpit);
    const portfolio = cockpit.querySelector('[data-cockpit-portfolio]');
    const costs = cockpit.querySelector('.kmc-cockpit-costs');
    if (!portfolio || !costs) return false;

    const loc = rootObject.location || { search: '', pathname: '' };
    const marketCode = options.requestedMarket;
    const endpoint = workspace.endpointFor({ requestedMarket: marketCode });
    const caps = payload.capabilities || {};
    const reasonLabels = workspace.MARKET_REASON_LABELS || {};
    const corridors = portfolio.__corridors instanceof Map ? portfolio.__corridors : new Map();
    const products = (Array.isArray(payload.simulation_products) ? payload.simulation_products : []).filter(product => product && product.product_ref);
    const state = {
      view: resolveView(loc.search), filter: 'todo', search: '', rows: [], failed: [], cursor: 0,
      loading: false, error: '', decision: null, selected: new URLSearchParams(loc.search).get('product_ref') || null,
    };
    const returnTo = () => `${loc.pathname || ''}${loc.search || ''}`;

    // Blocs existants rattachés à une vue ; les handlers du cockpit restent propriétaires des coûts.
    const economicBlocks = [];
    const costBlocks = [costs];
    if (overview) Array.from(overview.children).forEach(child => { if (child.getAttribute('data-dashboard-role') !== 'hero') economicBlocks.push(child); });
    const header = cockpit.querySelector('.kmc-cockpit-page-header');
    const equilibrium = cockpit.querySelector('[data-pricing-flow-equilibrium]');
    const footer = cockpit.querySelector('.kmc-cockpit-footer');
    if (equilibrium) economicBlocks.push(equilibrium);
    if (header) { header.dataset.atelierViews = 'economic costs'; header.classList.add('kmc-atelier-compact-header'); }
    portfolio.hidden = true;
    portfolio.dataset.atelierSuperseded = '';
    if (footer) footer.hidden = true;

    const prioritiesHost = el(doc, 'div', 'kmc-atelier-priorities-host');
    const productsHost = el(doc, 'section', 'kmc-atelier-products');
    productsHost.dataset.atelierProducts = '';
    if (equilibrium) cockpit.insertBefore(prioritiesHost, equilibrium); else cockpit.insertBefore(prioritiesHost, costs);
    cockpit.insertBefore(productsHost, costs);
    economicBlocks.push(prioritiesHost);
    economicBlocks.forEach(node => { node.dataset.atelierViews = 'economic'; });
    productsHost.dataset.atelierViews = 'products';
    costBlocks.forEach(node => { node.dataset.atelierViews = 'costs'; });
    rootNode.classList.add('kmc-atelier-views');

    const nav = buildNav(doc, state.view, null);
    const anchor = overview ? overview.querySelector('[data-dashboard-role="hero"]') : null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(nav, anchor.nextSibling); else rootNode.insertBefore(nav, rootNode.firstChild);

    function counts() { return summarizeQueue(state.rows); }

    function applyVisibility() {
      rootNode.querySelectorAll('[data-atelier-views]').forEach(node => {
        node.hidden = !node.dataset.atelierViews.split(' ').includes(state.view);
      });
      nav.querySelectorAll('[data-atelier-view]').forEach(tab => {
        const active = tab.dataset.atelierView === state.view;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function syncUrl() {
      if (!rootObject.history || typeof rootObject.history.replaceState !== 'function') return;
      const search = withParams(loc.search, { view: state.view === 'economic' ? null : state.view, product_ref: state.view === 'products' ? state.selected : null });
      rootObject.history.replaceState(null, '', `${loc.pathname}${search}${loc.hash || ''}`);
    }

    function renderPriorities() {
      const items = priorityItems({
        decision: state.decision, components: payload.cost_components, counts: state.rows.length ? counts() : null,
        evaluated: state.rows.length, total: products.length, reasonLabels,
      });
      prioritiesHost.replaceChildren(buildPriorities(doc, items, state.loading));
      const tab = nav.querySelector('[data-atelier-view="products"]');
      if (tab) {
        tab.querySelector('.kmc-atelier-tab-count')?.remove();
        const todo = counts().todo;
        if (todo > 0) tab.appendChild(el(doc, 'span', 'kmc-atelier-tab-count', todo));
      }
    }

    function renderQueue() {
      if (state.selected) return; // le dossier ouvert n'est jamais écrasé par un rafraîchissement de la file
      const summary = counts();
      productsHost.replaceChildren(buildQueue(doc, {
        rows: state.rows, failed: state.failed, counts: summary, filter: state.filter, search: state.search,
        visible: filterRows(state.rows, state.filter, state.search), total: products.length, loading: state.loading,
        error: state.error, canDecide: caps.local_price_drafts === true, marketCode, returnTo: returnTo(),
      }));
      const input = productsHost.querySelector('[data-atelier-search]');
      if (input && state.search) { input.focus(); input.setSelectionRange(state.search.length, state.search.length); }
    }

    async function fetchCorridor(productRef, force) {
      if (!force && corridors.has(productRef)) return corridors.get(productRef);
      const data = await workspace.jsonRequest(options.fetch, `${endpoint}/corridor?product_ref=${encodeURIComponent(productRef)}`);
      corridors.set(productRef, data);
      return data;
    }

    function upsertRow(product, corridor) {
      const row = { product: { ...product, ...(corridor.product || {}) }, corridor, state: classifyProduct(corridor) };
      const index = state.rows.findIndex(item => item.product.product_ref === row.product.product_ref);
      if (index >= 0) state.rows[index] = row; else state.rows.push(row);
    }

    async function evaluateNext() {
      if (state.loading) return;
      const batch = products.slice(state.cursor, state.cursor + PAGE_SIZE);
      if (!batch.length) return;
      state.cursor += batch.length;
      state.loading = true;
      renderQueue();
      renderPriorities();
      await mapLimit(batch, CONCURRENCY, async product => {
        try {
          const corridor = await fetchCorridor(product.product_ref, false);
          upsertRow(product, corridor);
        } catch (error) {
          state.failed.push({ product, message: error && error.message ? error.message : 'erreur serveur' });
        }
      });
      state.loading = false;
      renderQueue();
      renderPriorities();
    }

    async function openDossier(productRef, message) {
      state.selected = productRef;
      state.view = 'products';
      applyVisibility();
      syncUrl();
      productsHost.replaceChildren(el(doc, 'div', 'kmc-atelier-empty', 'Chargement du dossier…'));
      let corridor;
      try {
        corridor = await fetchCorridor(productRef, Boolean(message));
      } catch (error) {
        const failure = el(doc, 'div', 'kmc-atelier-alert', `Dossier indisponible : ${error && error.message ? error.message : 'erreur serveur'}`);
        failure.setAttribute('role', 'alert');
        productsHost.replaceChildren(button(doc, '← Retour à la file', 'kmc-atelier-link-button', { atelierBack: '' }), failure);
        return;
      }
      upsertRow(products.find(item => item.product_ref === productRef) || corridor.product, corridor);
      renderPriorities();
      let preview = null;
      let previewError = '';
      if (corridor.candidate && caps.local_price_activation_preview !== false) {
        try { preview = await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(productRef)}/local-price/activation-preview`); }
        catch (error) { previewError = error && error.message ? error.message : 'erreur serveur'; }
      }
      productsHost.replaceChildren(buildDossier(doc, corridor, {
        marketCode, returnTo: returnTo(), decision: state.decision, reasonLabels, preview, previewError, message,
        canDraft: caps.local_price_drafts === true, canSimulate: caps.simulation === true,
        canObserve: caps.manage_market_price_observations === true, components: payload.cost_components,
      }));
    }

    function closeDossier() {
      state.selected = null;
      syncUrl();
      renderQueue();
    }

    function setView(view, filter) {
      state.view = view;
      if (filter) state.filter = filter;
      if (view === 'products') {
        if (state.selected) openDossier(state.selected);
        else { renderQueue(); if (!state.rows.length && !state.loading) evaluateNext(); }
      }
      applyVisibility();
      syncUrl();
    }

    function feedback(message, tone) {
      const node = productsHost.querySelector('[data-atelier-feedback]');
      if (!node) return;
      node.textContent = message;
      node.className = `kmc-atelier-feedback${tone ? ` is-${tone}` : ''}`;
    }

    rootNode.addEventListener('click', event => {
      const tab = event.target.closest('[data-atelier-view]');
      if (tab && nav.contains(tab)) { state.selected = null; setView(tab.dataset.atelierView); return; }
      const go = event.target.closest('[data-atelier-go]');
      if (go) { state.selected = null; setView(go.dataset.atelierGo, go.dataset.atelierFilter || null); return; }
      const chip = event.target.closest('[data-atelier-filter-chip]');
      if (chip) { state.filter = chip.dataset.atelierFilterChip; renderQueue(); return; }
      const open = event.target.closest('[data-atelier-open]');
      if (open) { openDossier(open.dataset.atelierOpen); return; }
      if (event.target.closest('[data-atelier-back]')) { closeDossier(); return; }
      if (event.target.closest('[data-atelier-more]')) evaluateNext();
    });

    rootNode.addEventListener('input', event => {
      if (event.target.matches && event.target.matches('[data-atelier-search]')) { state.search = event.target.value; renderQueue(); }
    });

    rootNode.addEventListener('submit', async event => {
      const draftForm = event.target.closest('[data-atelier-draft-form]');
      const simForm = event.target.closest('[data-atelier-sim-form]');
      const obsForm = event.target.closest('[data-atelier-observation-form]');
      if (!draftForm && !simForm && !obsForm) return;
      event.preventDefault();
      const submit = event.target.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      const data = new FormData(event.target);
      try {
        if (draftForm) {
          const ref = draftForm.dataset.atelierDraftForm;
          const amount = num(data.get('amount'));
          if (amount === null || amount <= 0) throw new Error('Montant invalide : prix non enregistré.');
          await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(ref)}/local-price`, {
            method: 'POST', body: { amount, reason: 'Brouillon de prix pays depuis le dossier de l’Atelier des prix', source: 'atelier_dossier' },
          });
          await openDossier(ref, 'Brouillon enregistré. Le serveur a évalué l’activation ; rien n’est exposé à la vente.');
        } else if (simForm) {
          const value = num(data.get('value'));
          if (value === null || value < 0) throw new Error('Valeur de scénario invalide.');
          const result = await workspace.jsonRequest(options.fetch, `${endpoint}/simulate-impact`, {
            method: 'POST', body: { product_ref: simForm.dataset.atelierSimForm, overrides: [{ key: String(data.get('key')), default_value: value }] },
          });
          simForm.parentNode.querySelector('[data-atelier-sim-result]')?.remove();
          simForm.parentNode.appendChild(simulationResult(doc, result));
        } else {
          const parsed = observationPayload(Object.fromEntries(data.entries()));
          if (parsed.error) throw new Error(parsed.error);
          const ref = obsForm.dataset.atelierObservationForm;
          await workspace.jsonRequest(options.fetch, `${endpoint}/price-observations`, { method: 'POST', body: { product_ref: ref, ...parsed.body } });
          await openDossier(ref, 'Observation enregistrée.');
        }
      } catch (error) {
        feedback(`Action refusée : ${error && error.message ? error.message : 'erreur serveur'}`, 'error');
        if (submit) submit.disabled = false;
      }
    });

    applyVisibility();
    renderPriorities();
    (async () => {
      try { state.decision = await workspace.jsonRequest(options.fetch, `${endpoint}/decision`); } catch (_) { state.decision = null; }
      renderPriorities();
      if (state.view === 'products' && state.selected) openDossier(state.selected);
      else if (state.view === 'products') renderQueue();
      await evaluateNext();
    })();
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__atelierViewsInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function atelierViewsMount(options) {
      const payload = await originalMount(options);
      enhance(rootObject, workspace, options, payload);
      return payload;
    };
    workspace.__atelierViewsInstalled = true;
    return true;
  }

  return {
    VIEWS, STATES, FILTERS, PAGE_SIZE, resolveView, withParams, classifyProduct, summarizeQueue, filterRows,
    missingCostComponents, priorityItems, observationPayload, catalogueHref, sourceLabel, formatKmf, formatMoney, formatDate,
    mapLimit, buildNav, buildPriorities, buildQueue, buildDossier, enhance, install,
  };
});
