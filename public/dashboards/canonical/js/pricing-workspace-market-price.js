/**
 * @komerce-arch
 * @role          canonical-market-price-decision-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        market_pricing_workspace_projection, server_resolved_market_currency
 * @outputs       market_price_decision_requests
 * @depends       public/dashboards/canonical/js/pricing-workspace.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_master_catalog_market_price_is_overlay, viewer_reads_manager_decides, browser_never_sends_market_authority, under_cdr_exception_is_bounded
 * @impact-areas  admin-dashboard, pricing, economic-engine, market-authorization
 * @version       2026-09
 */

'use strict';

(function initMarketPriceDecisionUi(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomerceMarketPriceDecisionUI = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createMarketPriceDecisionUi() {
  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function formatNumber(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value, 0)} KMF`;
  }

  function formatMarketPrice(price, fallbackCurrency = '') {
    if (!price || price.amount == null) return 'Hérité du global';
    return `${formatNumber(price.amount, Number(price.minor_unit) || 0)} ${price.currency || fallbackCurrency}`.trim();
  }

  function formatDecisionState(price) {
    if (!price) return 'Aucune décision locale';
    if (price.pricing_zone === 'under_cdr_contributive') {
      const until = price.effective_until ? new Date(price.effective_until).toLocaleDateString('fr-FR') : '—';
      return `Contributif sous CDR · autorisé jusqu’au ${until}`;
    }
    return 'Au-dessus du CDR';
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function findCostWorkshop(rootNode) {
    return Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {
      const title = section.querySelector('.kmc-section-title');
      return title && title.textContent.trim() === 'Atelier des coûts';
    }) || null;
  }

  function createPanel(doc, payload, requestedMarket) {
    const marketCurrency = payload.scope?.market_currency || '';
    const canDecide = payload.access?.can_decide_prices === true;
    const section = el(doc, 'section', 'kmc-section');
    section.dataset.marketPriceDecisionPanel = '';

    const header = el(doc, 'div', 'kmc-section-header');
    const copy = el(doc, 'div', 'kmc-section-copy');
    copy.appendChild(el(doc, 'h2', 'kmc-section-title', `Prix décidé · ${requestedMarket}`));
    copy.appendChild(el(
      doc,
      'p',
      'kmc-section-description',
      `Catalogue maître unique · décision commerciale en ${marketCurrency || 'devise locale'}. Le produit global n’est jamais modifié. Le moteur refuse toujours un prix destructif ; une position sous CDR exige une couverture marché autorisante et une durée explicite.`
    ));
    header.appendChild(copy);
    header.appendChild(el(doc, 'span', 'kmc-workspace-note', canDecide ? 'Manager · décision autorisée' : 'Viewer · lecture seule'));
    section.appendChild(header);

    const slot = el(doc, 'div', 'kmc-section-slot');
    slot.dataset.sectionSlot = '';
    section.appendChild(slot);

    const rows = Array.isArray(payload.market_prices) ? payload.market_prices : [];
    if (!rows.length) {
      slot.appendChild(el(doc, 'div', 'kmc-workspace-empty', 'Aucun produit actif à tarifer sur ce marché.'));
      return section;
    }

    const wrap = el(doc, 'div', 'kmc-workspace-table-wrap');
    const table = el(doc, 'table', 'kmc-workspace-table');
    table.innerHTML = '<thead><tr><th>Produit</th><th>Prix global</th><th>Prix marché</th><th>État</th><th>Durée sous CDR</th><th>Justification</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');

    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.dataset.marketPriceRow = row.product_ref;

      const product = doc.createElement('td');
      const link = el(doc, 'a', 'kmc-workspace-nav-link', `${row.product_ref} · ${row.name || 'Produit'}`);
      link.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
      product.appendChild(link);
      if (row.category) product.appendChild(el(doc, 'small', 'kmc-workspace-note', row.category));
      tr.appendChild(product);

      tr.appendChild(el(doc, 'td', '', formatKmf(row.global_price_kmf)));

      const priceCell = doc.createElement('td');
      priceCell.appendChild(el(doc, 'div', 'kmc-workspace-note', formatMarketPrice(row.market_price, marketCurrency)));
      const priceInput = doc.createElement('input');
      priceInput.type = 'number';
      priceInput.min = '0';
      priceInput.step = Number(row.market_price?.minor_unit ?? payload.scope?.market_minor_unit ?? 0) > 0 ? '0.01' : '1';
      priceInput.placeholder = `Prix ${marketCurrency}`;
      priceInput.value = row.market_price?.amount == null ? '' : row.market_price.amount;
      priceInput.dataset.marketPriceAmount = row.product_ref;
      priceInput.disabled = !canDecide;
      priceCell.appendChild(priceInput);
      tr.appendChild(priceCell);

      const stateCell = doc.createElement('td');
      stateCell.appendChild(el(doc, 'span', 'kmc-workspace-note', formatDecisionState(row.market_price)));
      if (row.market_price) {
        stateCell.appendChild(el(doc, 'small', 'kmc-workspace-note', `CDR snapshot · ${formatKmf(row.market_price.cdr_complete_kmf)}`));
      }
      tr.appendChild(stateCell);

      const durationCell = doc.createElement('td');
      const duration = doc.createElement('input');
      duration.type = 'number';
      duration.min = '1';
      duration.step = '1';
      duration.placeholder = 'jours';
      duration.value = row.market_price?.decision_duration_days || '';
      duration.dataset.marketPriceDuration = row.product_ref;
      duration.disabled = !canDecide;
      duration.title = 'Requis uniquement si le prix décidé est sous le CDR complet.';
      durationCell.appendChild(duration);
      tr.appendChild(durationCell);

      const rationaleCell = doc.createElement('td');
      const rationale = doc.createElement('input');
      rationale.type = 'text';
      rationale.maxLength = 1000;
      rationale.placeholder = 'Pourquoi ce prix ?';
      rationale.value = row.market_price?.rationale || '';
      rationale.dataset.marketPriceRationale = row.product_ref;
      rationale.disabled = !canDecide;
      rationaleCell.appendChild(rationale);
      tr.appendChild(rationaleCell);

      const actions = doc.createElement('td');
      const decide = el(doc, 'button', 'kmc-workspace-action', row.market_price ? 'Redécider' : 'Décider');
      decide.type = 'button';
      decide.dataset.marketPriceAction = 'decide';
      decide.dataset.productRef = row.product_ref;
      decide.disabled = !canDecide;
      actions.appendChild(decide);
      if (row.market_price) {
        const reset = el(doc, 'button', 'kmc-workspace-action is-secondary', 'Revenir au global');
        reset.type = 'button';
        reset.dataset.marketPriceAction = 'reset';
        reset.dataset.productRef = row.product_ref;
        reset.disabled = !canDecide;
        actions.appendChild(reset);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    slot.appendChild(wrap);
    return section;
  }

  function fieldFor(rootNode, attribute, productRef) {
    return Array.from(rootNode.querySelectorAll(`[${attribute}]`)).find(node => {
      if (attribute === 'data-market-price-amount') return node.dataset.marketPriceAmount === productRef;
      if (attribute === 'data-market-price-rationale') return node.dataset.marketPriceRationale === productRef;
      if (attribute === 'data-market-price-duration') return node.dataset.marketPriceDuration === productRef;
      return false;
    }) || null;
  }

  function bindPanel(options, panel, workspace) {
    panel.addEventListener('click', async event => {
      const button = event.target.closest('[data-market-price-action]');
      if (!button || button.disabled) return;
      const productRef = button.dataset.productRef;
      const base = workspace.endpointFor({ requestedMarket: options.requestedMarket });
      button.disabled = true;
      try {
        if (button.dataset.marketPriceAction === 'decide') {
          const amount = fieldFor(panel, 'data-market-price-amount', productRef);
          const rationale = fieldFor(panel, 'data-market-price-rationale', productRef);
          const duration = fieldFor(panel, 'data-market-price-duration', productRef);
          const durationDays = duration?.value ? Number(duration.value) : null;
          await workspace.jsonRequest(
            options.fetch,
            `${base}/products/${encodeURIComponent(productRef)}/price-decision`,
            {
              method: 'POST',
              body: {
                price_amount: Number(amount?.value),
                rationale: rationale?.value || '',
                ...(durationDays ? { duration_days: durationDays } : {}),
              },
            }
          );
          setFeedback(options.root, `Prix ${options.requestedMarket} décidé pour ${productRef}.`, 'positive');
        } else {
          await workspace.jsonRequest(
            options.fetch,
            `${base}/products/${encodeURIComponent(productRef)}/price-decision/reset`,
            { method: 'POST', body: { reason: 'reset_to_global_from_canonical_workspace' } }
          );
          setFeedback(options.root, `${productRef} revient au prix global.`, 'positive');
        }
        await workspace.mount(options);
      } catch (error) {
        setFeedback(options.root, error.message || 'Décision de prix refusée.', 'critical');
        button.disabled = false;
      }
    });
  }

  function installInto(options, payload, workspace) {
    if (!options.requestedMarket) return;
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const rootNode = options.root;
    if (!doc || !rootNode || rootNode.querySelector('[data-market-price-decision-panel]')) return;
    const panel = createPanel(doc, payload, options.requestedMarket);
    const workshop = findCostWorkshop(rootNode);
    if (workshop) rootNode.insertBefore(panel, workshop);
    else rootNode.appendChild(panel);
    bindPanel(options, panel, workspace);
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__marketPriceDecisionInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function marketPriceDecisionMount(options) {
      const payload = await originalMount(options);
      installInto(options, payload, workspace);
      return payload;
    };
    workspace.__marketPriceDecisionInstalled = true;
    return true;
  }

  return {
    formatMarketPrice,
    formatDecisionState,
    createPanel,
    installInto,
    install,
  };
});
