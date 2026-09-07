/**
 * @komerce-arch
 * @role          canonical-pricing-market-product-price-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        canonical_pricing_workspace_projection, server_market_product_price_projection
 * @outputs       market_product_price_decision_dom, authorized_market_price_requests
 * @depends       globalThis.KomerceCanonicalPricingWorkspace, canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      global_product_market_price_overlay, browser_never_computes_authorization, browser_business_refs_only, server_resolves_currency
 * @impact-areas  admin-dashboard, pricing, economic-engine
 * @version       2026-09
 */

'use strict';

(function installMarketProductPrices(root) {
  if (!root || !root.KomerceCanonicalPricingWorkspace) return;
  const workspace = root.KomerceCanonicalPricingWorkspace;
  if (workspace.__marketProductPricesInstalled) return;

  const originalMount = workspace.mount.bind(workspace);

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function formatAmount(value, currency, minorUnit) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    const digits = Number.isInteger(Number(minorUnit)) ? Number(minorUnit) : 0;
    return `${new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(number)} ${currency || ''}`.trim();
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function positionLabel(position) {
    return ({
      COVERED: 'CDR couvert',
      UNDER_CDR: 'Sous CDR · contributif',
      DESTRUCTIVE: 'Sous coût variable · à corriger',
      NOT_PRICED: 'Non tarifé',
    })[position] || position || '—';
  }

  function feedback(options, message, tone = 'neutral') {
    const target = options.root.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  async function request(options, url, requestOptions = {}) {
    return workspace.jsonRequest(options.fetch, url, requestOptions);
  }

  function marketEndpoint(options) {
    return workspace.endpointFor({ requestedMarket: options.requestedMarket });
  }

  function findCostsSection(rootNode) {
    return Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {
      const title = section.querySelector('.kmc-section-title');
      return title && title.textContent.trim() === 'Atelier des coûts';
    }) || null;
  }

  function priceRow(doc, product, canManage) {
    const tr = doc.createElement('tr');
    tr.dataset.marketPriceProduct = product.product_ref;

    const productCell = doc.createElement('td');
    const link = text(doc, 'a', 'kmc-workspace-nav-link', `${product.product_ref} · ${product.name}`);
    link.href = `/admin/products/${encodeURIComponent(product.product_ref)}`;
    productCell.appendChild(link);
    if (product.category) productCell.appendChild(text(doc, 'small', 'kmc-market-price-category', product.category));
    tr.appendChild(productCell);

    tr.appendChild(textCell(doc, formatAmount(product.global_price_local, product.currency, product.minor_unit)));

    const effective = doc.createElement('td');
    effective.appendChild(text(doc, 'strong', '', formatAmount(product.effective_price_local, product.currency, product.minor_unit)));
    effective.appendChild(text(
      doc,
      'small',
      product.effective_source === 'market_decision' ? 'kmc-market-price-source is-local' : 'kmc-market-price-source',
      product.effective_source === 'market_decision' ? 'Décision pays' : 'Global hérité'
    ));
    tr.appendChild(effective);

    tr.appendChild(textCell(doc, formatAmount(product.variable_cost_local, product.currency, product.minor_unit)));
    tr.appendChild(textCell(doc, formatAmount(product.cdr_local, product.currency, product.minor_unit)));

    const position = doc.createElement('td');
    const badge = text(doc, 'span', `kmc-market-price-position is-${String(product.current_position || '').toLowerCase()}`, positionLabel(product.current_position));
    position.appendChild(badge);
    if (product.latest_decision?.valid_until) position.appendChild(text(doc, 'small', 'kmc-market-price-validity', `jusqu’au ${formatDate(product.latest_decision.valid_until)}`));
    tr.appendChild(position);

    const actions = doc.createElement('td');
    const history = text(doc, 'button', 'kmc-workspace-action is-secondary', 'Historique');
    history.type = 'button';
    history.dataset.marketPriceHistory = product.product_ref;
    actions.appendChild(history);
    if (canManage) {
      const decide = text(doc, 'button', 'kmc-workspace-action', product.effective_source === 'market_decision' ? 'Modifier' : 'Décider');
      decide.type = 'button';
      decide.dataset.marketPriceEdit = product.product_ref;
      actions.appendChild(decide);
    }
    tr.appendChild(actions);
    return tr;
  }

  function textCell(doc, value) {
    const td = doc.createElement('td');
    td.textContent = value == null || value === '' ? '—' : String(value);
    return td;
  }

  function editorRow(doc, product) {
    const tr = doc.createElement('tr');
    tr.className = 'kmc-market-price-editor-row';
    tr.dataset.marketPriceEditorRow = product.product_ref;
    const td = doc.createElement('td');
    td.colSpan = 7;
    const form = doc.createElement('form');
    form.className = 'kmc-market-price-form';
    form.dataset.marketPriceForm = product.product_ref;

    const priceLabel = doc.createElement('label');
    priceLabel.appendChild(text(doc, 'span', '', `Prix local (${product.currency})`));
    const price = doc.createElement('input');
    price.name = 'price';
    price.type = 'number';
    price.min = product.minor_unit > 0 ? '0.01' : '1';
    price.step = product.minor_unit > 0 ? `0.${'0'.repeat(Math.max(0, product.minor_unit - 1))}1` : '1';
    price.required = true;
    price.value = product.effective_source === 'market_decision' ? product.effective_price_local : '';
    priceLabel.appendChild(price);
    form.appendChild(priceLabel);

    const validityLabel = doc.createElement('label');
    validityLabel.appendChild(text(doc, 'span', '', 'Valide jusqu’au (requis si sous CDR)'));
    const validity = doc.createElement('input');
    validity.name = 'valid_until';
    validity.type = 'datetime-local';
    validityLabel.appendChild(validity);
    form.appendChild(validityLabel);

    const rationaleLabel = doc.createElement('label');
    rationaleLabel.className = 'is-wide';
    rationaleLabel.appendChild(text(doc, 'span', '', 'Justification'));
    const rationale = doc.createElement('textarea');
    rationale.name = 'rationale';
    rationale.rows = 2;
    rationale.required = true;
    rationale.minLength = 10;
    rationale.placeholder = 'Pourquoi ce prix est-il décidé pour ce marché ?';
    rationaleLabel.appendChild(rationale);
    form.appendChild(rationaleLabel);

    const help = text(doc, 'p', 'kmc-market-price-help', 'Le serveur vérifie le coût variable, le CDR et, si nécessaire, l’autorisation de couverture. Aucun seuil n’est calculé ici.');
    form.appendChild(help);

    const buttons = doc.createElement('div');
    buttons.className = 'kmc-market-price-form-actions';
    const save = text(doc, 'button', 'kmc-workspace-action', 'Enregistrer le prix pays');
    save.type = 'submit';
    buttons.appendChild(save);
    if (product.effective_source === 'market_decision') {
      const reset = text(doc, 'button', 'kmc-workspace-action is-secondary', 'Revenir au prix global');
      reset.type = 'button';
      reset.dataset.marketPriceReset = product.product_ref;
      buttons.appendChild(reset);
    }
    const cancel = text(doc, 'button', 'kmc-workspace-action is-secondary', 'Annuler');
    cancel.type = 'button';
    cancel.dataset.marketPriceCancel = product.product_ref;
    buttons.appendChild(cancel);
    form.appendChild(buttons);

    td.appendChild(form);
    tr.appendChild(td);
    return tr;
  }

  function historyRow(doc, productRef, history) {
    const tr = doc.createElement('tr');
    tr.className = 'kmc-market-price-history-row';
    tr.dataset.marketPriceHistoryRow = productRef;
    const td = doc.createElement('td');
    td.colSpan = 7;
    const decisions = history.decisions || [];
    if (!decisions.length) {
      td.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune décision locale enregistrée pour ce produit.'));
    } else {
      const list = doc.createElement('div');
      list.className = 'kmc-market-price-history-list';
      decisions.forEach(decision => {
        const item = doc.createElement('div');
        item.className = 'kmc-market-price-history-item';
        const label = decision.decision_type === 'RESET'
          ? 'Retour au prix global'
          : `${formatAmount(decision.local_price, decision.local_currency, 0)} · ${positionLabel(decision.strategy_position)}`;
        item.appendChild(text(doc, 'strong', '', label));
        item.appendChild(text(doc, 'span', '', formatDate(decision.recorded_at)));
        item.appendChild(text(doc, 'p', '', decision.rationale || '—'));
        if (decision.valid_until) item.appendChild(text(doc, 'small', '', `Validité : ${formatDate(decision.valid_until)}`));
        list.appendChild(item);
      });
      td.appendChild(list);
    }
    tr.appendChild(td);
    return tr;
  }

  function removeAuxiliaryRows(section, productRef) {
    section.querySelector(`[data-market-price-editor-row="${CSS.escape(productRef)}"]`)?.remove();
    section.querySelector(`[data-market-price-history-row="${CSS.escape(productRef)}"]`)?.remove();
  }

  async function render(options, basePayload) {
    const doc = options.document;
    const rootNode = options.root;
    const endpoint = marketEndpoint(options);
    let projection;
    try {
      projection = await request(options, `${endpoint}/product-prices`);
    } catch (error) {
      const built = options.ui.Section.create({
        title: 'Prix produits · marché',
        description: 'Décisions locales sur le catalogue global.',
      });
      built.element.dataset.marketProductPricesSection = '';
      built.slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', `Prix marché indisponibles : ${error.message}`));
      const costs = findCostsSection(rootNode);
      if (costs) rootNode.insertBefore(built.element, costs); else rootNode.appendChild(built.element);
      return;
    }

    const canManage = basePayload.capabilities?.manage_market_product_prices === true;
    const built = options.ui.Section.create({
      title: `Prix produits · ${options.requestedMarket}`,
      description: `Catalogue global, décision locale en ${projection.currency}. Le prix pays n’altère jamais le produit maître.`,
    });
    const section = built.element;
    section.dataset.marketProductPricesSection = '';
    const slot = built.slot;

    const doctrine = doc.createElement('div');
    doctrine.className = 'kmc-market-price-doctrine';
    doctrine.appendChild(text(doc, 'strong', '', canManage ? 'Manager pays · décision autonome sous garde économique' : 'Lecture seule · viewer pays'));
    doctrine.appendChild(text(doc, 'span', '', 'Sous coût variable : toujours refusé. Sous CDR : uniquement si le gate serveur l’autorise, avec durée explicite.'));
    slot.appendChild(doctrine);

    const products = projection.products || [];
    if (!products.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun produit global actif à tarifer.'));
    } else {
      const wrap = doc.createElement('div');
      wrap.className = 'kmc-workspace-table-wrap';
      const table = doc.createElement('table');
      table.className = 'kmc-workspace-table kmc-market-price-table';
      table.innerHTML = '<thead><tr><th>Produit global</th><th>Prix global</th><th>Prix effectif</th><th>Coût variable</th><th>CDR</th><th>Position</th><th></th></tr></thead>';
      const tbody = doc.createElement('tbody');
      products.forEach(product => tbody.appendChild(priceRow(doc, product, canManage)));
      table.appendChild(tbody);
      wrap.appendChild(table);
      slot.appendChild(wrap);

      section.addEventListener('click', async event => {
        const edit = event.target.closest('[data-market-price-edit]');
        if (edit) {
          const ref = edit.dataset.marketPriceEdit;
          const product = products.find(item => item.product_ref === ref);
          const row = section.querySelector(`[data-market-price-product="${CSS.escape(ref)}"]`);
          if (!product || !row) return;
          removeAuxiliaryRows(section, ref);
          row.insertAdjacentElement('afterend', editorRow(doc, product));
          return;
        }

        const cancel = event.target.closest('[data-market-price-cancel]');
        if (cancel) {
          removeAuxiliaryRows(section, cancel.dataset.marketPriceCancel);
          return;
        }

        const historyButton = event.target.closest('[data-market-price-history]');
        if (historyButton) {
          const ref = historyButton.dataset.marketPriceHistory;
          const row = section.querySelector(`[data-market-price-product="${CSS.escape(ref)}"]`);
          if (!row) return;
          removeAuxiliaryRows(section, ref);
          try {
            const history = await request(options, `${endpoint}/product-prices/${encodeURIComponent(ref)}/history`);
            row.insertAdjacentElement('afterend', historyRow(doc, ref, history));
          } catch (error) { feedback(options, error.message, 'critical'); }
          return;
        }

        const resetButton = event.target.closest('[data-market-price-reset]');
        if (resetButton) {
          const ref = resetButton.dataset.marketPriceReset;
          const form = section.querySelector(`[data-market-price-form="${CSS.escape(ref)}"]`);
          const rationale = String(form?.querySelector('[name="rationale"]')?.value || '').trim();
          if (rationale.length < 10) {
            feedback(options, 'Une justification d’au moins 10 caractères est requise pour revenir au global.', 'critical');
            return;
          }
          feedback(options, 'Décision en cours…');
          try {
            await request(options, `${endpoint}/product-prices/${encodeURIComponent(ref)}/reset`, {
              method: 'POST', body: { rationale },
            });
            feedback(options, 'Prix local retiré · héritage global restauré.', 'positive');
            await mountedWorkspace(options);
          } catch (error) { feedback(options, error.message, 'critical'); }
        }
      });

      section.addEventListener('submit', async event => {
        const form = event.target.closest('[data-market-price-form]');
        if (!form) return;
        event.preventDefault();
        const ref = form.dataset.marketPriceForm;
        const data = new FormData(form);
        const body = {
          price: Number(data.get('price')),
          rationale: data.get('rationale'),
        };
        const validUntil = data.get('valid_until');
        if (validUntil) body.valid_until = new Date(validUntil).toISOString();
        feedback(options, 'Décision en cours…');
        try {
          await request(options, `${endpoint}/product-prices/${encodeURIComponent(ref)}`, { method: 'POST', body });
          feedback(options, 'Prix pays enregistré.', 'positive');
          await mountedWorkspace(options);
        } catch (error) { feedback(options, error.message, 'critical'); }
      });
    }

    const costs = findCostsSection(rootNode);
    if (costs) rootNode.insertBefore(section, costs); else rootNode.appendChild(section);
  }

  async function mountedWorkspace(options) {
    const payload = await originalMount(options);
    if (options.requestedMarket) await render(options, payload);
    return payload;
  }

  workspace.mount = mountedWorkspace;
  workspace.__marketProductPricesInstalled = true;
})(typeof globalThis !== 'undefined' ? globalThis : null);
