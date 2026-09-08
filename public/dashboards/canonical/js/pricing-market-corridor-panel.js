/**
 * @komerce-arch
 * @role          canonical-pricing-market-corridor-panel
 * @domain        admin-dashboard
 * @layer         ui-presentation
 * @criticality   high
 * @inputs        server_market_corridor_projection, pricing_workspace_projection
 * @outputs       market_price_decision_chain_dom
 * @depends       public/dashboards/canonical/js/pricing-workspace.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_observes_workspace_acts_browser_never_recomputes_market_truth, market_bounds_possible_human_decides
 * @impact-areas  admin-dashboard, pricing, market-autonomy
 * @version       2026-09
 */

'use strict';

(function initMarketCorridorPanel(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingMarketCorridorPanel = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createMarketCorridorPanel() {
  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function fmt(value, suffix = 'KMF') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)}${suffix ? ` ${suffix}` : ''}`;
  }

  function card(doc, label, value, helper, tone = '') {
    const node = el(doc, 'div', `kmc-market-chain-card${tone ? ` is-${tone}` : ''}`);
    node.appendChild(el(doc, 'span', 'kmc-market-chain-label', label));
    node.appendChild(el(doc, 'strong', 'kmc-market-chain-value', value));
    if (helper) node.appendChild(el(doc, 'small', 'kmc-market-chain-helper', helper));
    return node;
  }

  function corridorValue(point) {
    if (!point) return '—';
    return fmt(point.price_kmf);
  }

  function buildPanel(doc, payload, marketCode) {
    const panel = el(doc, 'section', 'kmc-market-chain');
    panel.dataset.marketCorridorPanel = '';

    const head = el(doc, 'div', 'kmc-market-chain-head');
    const copy = el(doc, 'div', '');
    copy.appendChild(el(doc, 'span', 'kmc-market-chain-kicker', 'DÉCISION PRIX · VÉRITÉ SERVEUR'));
    copy.appendChild(el(doc, 'h3', 'kmc-market-chain-title', 'Du marché à la contribution'));
    copy.appendChild(el(doc, 'p', 'kmc-market-chain-intro', 'Le marché borne le possible. Le moteur calcule les conséquences. Le manager décide le prix local.'));
    head.appendChild(copy);

    const controls = el(doc, 'div', 'kmc-market-chain-controls');
    const select = doc.createElement('select');
    select.dataset.marketCorridorProduct = '';
    select.setAttribute('aria-label', 'Produit à analyser');
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choisir un produit…';
    select.appendChild(placeholder);
    (payload.simulation_products || []).forEach(product => {
      const option = doc.createElement('option');
      option.value = product.product_ref;
      option.textContent = `${product.product_ref} · ${product.name || product.category || 'Produit'}`;
      select.appendChild(option);
    });
    controls.appendChild(select);
    const load = el(doc, 'button', 'kmc-workspace-action', 'Analyser');
    load.type = 'button';
    load.dataset.marketCorridorLoad = '';
    controls.appendChild(load);
    head.appendChild(controls);
    panel.appendChild(head);

    const state = el(doc, 'div', 'kmc-market-chain-state', `Marché ${marketCode} · choisissez un produit pour lire son corridor et sa contribution.`);
    state.dataset.marketCorridorState = '';
    panel.appendChild(state);

    const body = el(doc, 'div', 'kmc-market-chain-body');
    body.dataset.marketCorridorBody = '';
    panel.appendChild(body);
    return panel;
  }

  function renderProjection(doc, panel, projection, payload) {
    const body = panel.querySelector('[data-market-corridor-body]');
    const state = panel.querySelector('[data-market-corridor-state]');
    body.replaceChildren();

    const local = projection.corridor?.local || {};
    const globalRef = projection.corridor?.global_reference || {};
    const economics = projection.selected?.economics || {};
    const marketCurrency = projection.market?.currency || '';

    state.textContent = `${projection.product?.name || projection.product?.product_ref || 'Produit'} · ${local.sample_count || 0} observation(s) locale(s) · confiance ${local.confidence || 'none'}.`;

    const corridor = el(doc, 'div', 'kmc-market-chain-block');
    corridor.appendChild(el(doc, 'strong', 'kmc-market-chain-block-title', '1 · Réalité marché'));
    const corridorGrid = el(doc, 'div', 'kmc-market-chain-grid');
    corridorGrid.appendChild(card(doc, 'Basse', corridorValue(local.low), '25e percentile observé'));
    corridorGrid.appendChild(card(doc, 'Cible', corridorValue(local.target), 'médiane observée', 'primary'));
    corridorGrid.appendChild(card(doc, 'Haute', corridorValue(local.high), '75e percentile observé'));
    corridor.appendChild(corridorGrid);
    corridor.appendChild(el(doc, 'p', 'kmc-market-chain-rule', projection.corridor?.rule || 'Le corridor local provient uniquement des observations du marché.'));
    if (!local.sample_count && globalRef.sample_count) {
      corridor.appendChild(el(doc, 'p', 'kmc-market-chain-note', `Référence globale disponible (${globalRef.sample_count} observations), informative seulement : elle n’est pas promue comme vérité ${projection.market?.code || 'pays'}.`));
    }
    body.appendChild(corridor);

    const economicsBlock = el(doc, 'div', 'kmc-market-chain-block');
    economicsBlock.appendChild(el(doc, 'strong', 'kmc-market-chain-block-title', '2 · Conséquence économique du prix effectif'));
    const econGrid = el(doc, 'div', 'kmc-market-chain-grid');
    econGrid.appendChild(card(doc, 'Coût d’achat', fmt(projection.product?.purchase_cost_kmf), 'source produit'));
    econGrid.appendChild(card(doc, 'Coût variable complet', fmt(economics.variable_cost_complete_kmf), 'frontière marginale'));
    econGrid.appendChild(card(doc, 'Prix effectif', fmt(projection.selected?.price_kmf), projection.selected?.source === 'LOCAL_ACTIVE' ? `prix local actif ${marketCurrency}` : 'base globale active', 'primary'));
    econGrid.appendChild(card(doc, 'Contribution / article', fmt(economics.contribution_unit_kmf), 'prix − coût variable', Number(economics.contribution_unit_kmf) >= 0 ? 'positive' : 'critical'));
    economicsBlock.appendChild(econGrid);
    body.appendChild(economicsBlock);

    const chain = el(doc, 'div', 'kmc-market-chain-flow');
    ['Coût d’achat', '→', 'Coûts variables', '→', 'Corridor marché', '→', 'Prix retenu', '→', 'Contribution', '→', 'Couverture du portefeuille'].forEach(label => {
      chain.appendChild(el(doc, 'span', label === '→' ? 'kmc-market-chain-arrow' : 'kmc-market-chain-node', label));
    });
    body.appendChild(chain);

    const canDraft = payload.capabilities?.local_price_drafts === true;
    if (canDraft) {
      const action = el(doc, 'details', 'kmc-market-chain-action');
      action.appendChild(el(doc, 'summary', '', 'Décider un prix local'));
      const form = doc.createElement('form');
      form.dataset.marketLocalPriceForm = '';
      form.dataset.productRef = projection.product?.product_ref || '';
      form.className = 'kmc-market-chain-form';
      const amount = doc.createElement('input');
      amount.name = 'amount';
      amount.type = 'number';
      amount.min = '1';
      amount.required = true;
      amount.placeholder = `Prix en ${marketCurrency || 'devise locale'}`;
      const reason = doc.createElement('input');
      reason.name = 'reason';
      reason.required = true;
      reason.placeholder = 'Justification de la décision';
      const submit = el(doc, 'button', 'kmc-workspace-action', 'Enregistrer le prix local');
      submit.type = 'submit';
      form.append(amount, reason, submit);
      action.appendChild(form);
      body.appendChild(action);
    }
  }

  async function loadProjection(rootObject, workspace, options, panel, payload) {
    const select = panel.querySelector('[data-market-corridor-product]');
    const productRef = select?.value;
    if (!productRef) return;
    const state = panel.querySelector('[data-market-corridor-state]');
    state.textContent = 'Lecture du corridor marché…';
    try {
      const projection = await workspace.jsonRequest(options.fetch, `${workspace.endpointFor({ requestedMarket: options.requestedMarket })}/corridor?product_ref=${encodeURIComponent(productRef)}`);
      renderProjection(options.document, panel, projection, payload);
    } catch (error) {
      state.textContent = error.message || 'Corridor indisponible.';
    }
  }

  async function enhance(rootObject, workspace, options, payload) {
    if (!options?.requestedMarket || !options.root || !options.document) return false;
    if (options.root.querySelector('[data-market-corridor-panel]')) return true;
    const workshop = options.root.querySelector('[data-pricing-workshop-enhanced]');
    if (!workshop) return false;
    const slot = workshop.querySelector('[data-section-slot]') || workshop;
    const panel = buildPanel(options.document, payload, options.requestedMarket);
    slot.appendChild(panel);

    panel.addEventListener('click', async event => {
      if (event.target.closest('[data-market-corridor-load]')) await loadProjection(rootObject, workspace, options, panel, payload);
    });
    panel.addEventListener('submit', async event => {
      if (!event.target.matches('[data-market-local-price-form]')) return;
      event.preventDefault();
      const form = event.target;
      const data = new FormData(form);
      const productRef = form.dataset.productRef;
      try {
        await workspace.jsonRequest(options.fetch, `${workspace.endpointFor({ requestedMarket: options.requestedMarket })}/products/${encodeURIComponent(productRef)}/local-price`, {
          method: 'POST',
          body: {
            amount: Number(data.get('amount')),
            reason: data.get('reason'),
            source: 'canonical_market_corridor_panel',
          },
        });
        await loadProjection(rootObject, workspace, options, panel, payload);
      } catch (error) {
        panel.querySelector('[data-market-corridor-state]').textContent = error.message || 'Décision refusée.';
      }
    });
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__marketCorridorPanelInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function marketCorridorAwareMount(options) {
      const payload = await originalMount(options);
      await enhance(rootObject, workspace, options, payload);
      return payload;
    };
    workspace.__marketCorridorPanelInstalled = true;
    return true;
  }

  return { buildPanel, renderProjection, enhance, install };
});