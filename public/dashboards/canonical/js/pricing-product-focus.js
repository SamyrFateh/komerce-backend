/**
 * @komerce-arch
 * @role          canonical-pricing-focused-product-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        product_ref, pricing_workspace_projection, pricing_engine_simulation
 * @outputs       focused_product_pricing_decision_ui, canonical_price_apply_request
 * @depends       public/dashboards/canonical/js/pricing-workspace.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      pricing_engine_is_authority, browser_never_recomputes_economic_truth, focused_product_action_wraps_existing_pricing_authorities
 * @impact-areas  admin-dashboard, pricing, catalog
 * @version       2026-10
 */

'use strict';

(function initPricingProductFocus(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingProductFocus = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingProductFocus(rootObject) {
  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function formatKmf(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number)} KMF`;
  }

  function requestedProductRef(options = {}) {
    if (options.requestedProductRef) return String(options.requestedProductRef).trim() || null;
    const search = rootObject?.location?.search || '';
    return new URLSearchParams(search).get('product_ref') || null;
  }

  function requestedReturnTo(productRef) {
    const search = rootObject?.location?.search || '';
    const raw = new URLSearchParams(search).get('return_to');
    if (raw && raw.startsWith('/admin/')) return raw;
    return `/admin/workspaces/catalog?product_ref=${encodeURIComponent(productRef)}`;
  }

  function canApplyRecommendation(result = {}) {
    const recommended = Number(result.recommended_price_kmf);
    const sources = result.data_quality?.sources || {};
    const purchaseCostKnown = Boolean(sources.purchase_price && sources.purchase_price !== 'missing');
    return result.source_of_truth === 'pricing-engine'
      && purchaseCostKnown
      && Number.isFinite(recommended)
      && recommended > 0;
  }

  function applyBody(result = {}) {
    return {
      price_kmf: Number(result.recommended_price_kmf),
      survival_price_kmf: Number(result.minimum_safe_price_kmf) || 0,
      source: 'canonical_pricing_workspace',
    };
  }

  function removeExisting(root) {
    root.querySelector?.('[data-pricing-product-focus]')?.remove?.();
  }

  function reserveAnchor(root) {
    const existing = root.querySelector?.('#pricing-products');
    if (existing && !existing.hasAttribute?.('data-pricing-product-focus')) {
      existing.id = 'pricing-products-overview';
      existing.setAttribute?.('data-pricing-products-overview', '');
    }
  }

  function renderResult(doc, host, result, productRef, onApply) {
    host.replaceChildren();

    const grid = doc.createElement('div');
    grid.className = 'kmc-workspace-kpis';
    [
      ['Coût variable', result.variable_cost_complete_kmf || result.business_complete_cost_kmf],
      ['CDR complet', result.fully_loaded_cost_reference_kmf || result.cost_complete_estimated_kmf],
      ['Plancher', result.minimum_safe_price_kmf],
      ['Conseillé', result.recommended_price_kmf],
    ].forEach(([label, value]) => {
      const card = doc.createElement('div');
      card.className = 'kmc-workspace-kpi';
      card.appendChild(text(doc, 'span', 'kmc-workspace-kpi-label', label));
      card.appendChild(text(doc, 'strong', 'kmc-workspace-kpi-value', formatKmf(value)));
      grid.appendChild(card);
    });
    host.appendChild(grid);

    const sources = result.data_quality?.sources || {};
    const sourceBits = [
      ['achat', sources.purchase_price],
      ['poids', sources.weight],
      ['volume', sources.volume],
      ['douane', sources.customs_category],
    ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
    if (sourceBits.length) {
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', `Sources : ${sourceBits.join(' · ')}`));
    }

    const missing = Array.isArray(result.data_quality?.missing_fields)
      ? result.data_quality.missing_fields.filter(Boolean)
      : [];
    if (missing.length) {
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', `Données manquantes : ${missing.join(', ')}`));
    }

    if (!canApplyRecommendation(result)) {
      host.appendChild(text(
        doc,
        'div',
        'kmc-workspace-feedback is-warning',
        `Le moteur ne fournit pas encore de prix applicable pour ${productRef}. Corrigez les données manquantes puis relancez la simulation.`
      ));
      return;
    }

    const actions = doc.createElement('div');
    actions.className = 'kmc-workspace-actions';
    const apply = text(doc, 'button', 'kmc-workspace-action', 'Choisir ce prix');
    apply.type = 'button';
    apply.setAttribute('data-pricing-focus-apply', '');
    apply.addEventListener('click', () => onApply(apply, result));
    actions.appendChild(apply);
    host.appendChild(actions);
  }

  async function navigateBack(returnTo) {
    const router = rootObject?.KomerceCanonicalClientRouter;
    if (router && typeof router.navigate === 'function') {
      const navigated = await router.navigate(returnTo);
      if (navigated) return true;
    }
    if (rootObject?.location) rootObject.location.href = returnTo;
    return true;
  }

  async function mountFocusedProduct(workspace, options, payload) {
    const productRef = requestedProductRef(options);
    if (!productRef || options.requestedMarket) return false;

    const root = options.root;
    const doc = options.document;
    removeExisting(root);
    reserveAnchor(root);

    const product = (payload.products || []).find(row => row.product_ref === productRef) || {};
    const section = doc.createElement('section');
    section.id = 'pricing-products';
    section.className = 'kmc-section kmc-pricing-product-focus';
    section.setAttribute('data-pricing-product-focus', '');

    const header = doc.createElement('header');
    header.className = 'kmc-section-header';
    header.appendChild(text(doc, 'h2', 'kmc-section-title', `Tarification produit · ${productRef}`));
    header.appendChild(text(
      doc,
      'p',
      'kmc-section-description',
      'Le moteur calcule les frontières. Vous choisissez ensuite le prix à appliquer avant publication Catalogue.'
    ));
    section.appendChild(header);

    const body = doc.createElement('div');
    body.className = 'kmc-section-body';

    const identity = doc.createElement('div');
    identity.className = 'kmc-workspace-detail';
    identity.appendChild(text(doc, 'strong', 'kmc-workspace-detail-title', product.name || productRef));
    identity.appendChild(text(
      doc,
      'p',
      'kmc-workspace-note',
      `Catégorie : ${product.category || '—'} · prix actuel : ${formatKmf(product.price_kmf)}`
    ));
    body.appendChild(identity);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', 'Calcul du prix en cours…');
    feedback.setAttribute('role', 'status');
    body.appendChild(feedback);

    const resultHost = doc.createElement('div');
    resultHost.setAttribute('data-pricing-focus-result', '');
    body.appendChild(resultHost);

    const footer = doc.createElement('div');
    footer.className = 'kmc-workspace-actions';
    const recalc = text(doc, 'button', 'kmc-workspace-action is-secondary', 'Recalculer');
    recalc.type = 'button';
    recalc.setAttribute('data-pricing-focus-simulate', '');
    footer.appendChild(recalc);

    const returnTo = requestedReturnTo(productRef);
    const back = text(doc, 'a', 'kmc-workspace-nav-link', 'Retour à la curation');
    back.href = returnTo;
    footer.appendChild(back);
    body.appendChild(footer);
    section.appendChild(body);

    const overview = root.querySelector?.('[data-pricing-decision-overview]');
    if (overview?.parentNode) overview.parentNode.insertBefore(section, overview);
    else root.prepend(section);

    const endpoint = workspace.endpointFor({ requestedMarket: null });

    async function simulate(button = null) {
      if (button) button.disabled = true;
      feedback.className = 'kmc-workspace-feedback';
      feedback.textContent = 'Calcul du prix en cours…';
      resultHost.replaceChildren();
      try {
        const response = await workspace.jsonRequest(options.fetch, `${endpoint}/simulate`, {
          method: 'POST',
          body: { product_ref: productRef },
        });
        const result = response.result || response;
        feedback.textContent = 'Simulation calculée par le moteur Pricing.';
        feedback.className = 'kmc-workspace-feedback is-positive';
        renderResult(doc, resultHost, result, productRef, async (applyButton, simulation) => {
          applyButton.disabled = true;
          feedback.textContent = 'Application du prix en cours…';
          feedback.className = 'kmc-workspace-feedback';
          try {
            await workspace.jsonRequest(
              options.fetch,
              `${endpoint}/products/${encodeURIComponent(productRef)}/apply-price`,
              { method: 'POST', body: applyBody(simulation) }
            );
            feedback.textContent = `Prix appliqué à ${productRef}. Retour à la curation…`;
            feedback.className = 'kmc-workspace-feedback is-positive';
            await navigateBack(returnTo);
          } catch (error) {
            applyButton.disabled = false;
            feedback.textContent = error.message || 'Application du prix refusée.';
            feedback.className = 'kmc-workspace-feedback is-critical';
          }
        });
      } catch (error) {
        feedback.textContent = error.message || 'Simulation impossible.';
        feedback.className = 'kmc-workspace-feedback is-critical';
      } finally {
        if (button) button.disabled = false;
      }
    }

    recalc.addEventListener('click', () => simulate(recalc));
    await simulate();
    return true;
  }

  function install(root) {
    const workspace = root && root.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__focusedProductInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function focusedProductMount(options) {
      const payload = await originalMount(options);
      await mountFocusedProduct(workspace, options, payload);
      return payload;
    };
    workspace.__focusedProductInstalled = true;
    return true;
  }

  return Object.freeze({
    requestedProductRef,
    requestedReturnTo,
    canApplyRecommendation,
    applyBody,
    mountFocusedProduct,
    install,
  });
});
