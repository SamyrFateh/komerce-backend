/**
 * @komerce-arch
 * @role          canonical-purchasing-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_admin, purchasing_grouped_api_projection, supplier_execution_projection
 * @outputs       canonical_purchasing_workspace_dom, authorized_purchasing_action_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, grouping_key_supplier_hub_market, market_derived_from_order_lines_on_server, browser_never_supplies_market_id_authority, browser_no_business_recompute
 * @impact-areas  admin-dashboard, purchasing, operations
 * @version       2026-10
 */

'use strict';

(function initPurchasingWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalPurchasingWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPurchasingWorkspace() {
  const ENDPOINT = '/api/purchasing';
  const PO_PARAM = 'po';

  const STATUS_LABELS = Object.freeze({
    draft: 'Brouillon',
    notified: 'Soumise au fournisseur',
    confirmed: 'Confirmée',
    cancelled: 'Annulée',
    hub_received: 'Reçue au Hub',
  });

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function td(doc, value, className) {
    const cell = doc.createElement('td');
    if (className) cell.className = className;
    cell.textContent = value == null || value === '' ? '—' : String(value);
    return cell;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(number);
  }

  function formatPrice(price, currency) {
    return price == null ? '—' : `${formatNumber(price)} ${currency || ''}`.trim();
  }

  function shortId(id) {
    return String(id || '').slice(0, 8);
  }

  function marketLabel(entry) {
    return entry.market_code || entry.market_name || shortId(entry.market_id);
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  /** Message opérateur : le serveur reste l'autorité, l'écran ne reformule que l'affichage des verdicts. */
  function describeError(error) {
    const body = error && error.body ? error.body : {};
    if (error && error.code === 'PURCHASE_ORDER_SUBMIT_REFUSED' && Array.isArray(body.verdicts) && body.verdicts.length) {
      const detail = body.verdicts
        .map((v) => `${v.supplier_unit_ref || v.provider || 'ligne'} : ${v.reason || v.verdict || v.status || 'refusé'}`)
        .join(' · ');
      return `${error.message} — ${detail}`;
    }
    if (error && error.code === 'GROUPED_PURCHASING_DISABLED') {
      return 'Les achats groupés ne sont pas activés sur cet environnement.';
    }
    return (error && error.message) || 'Erreur inattendue';
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function makeButton(doc, label, action, secondary = false) {
    const button = text(doc, 'button', secondary ? 'kmc-workspace-action is-secondary' : 'kmc-workspace-action', label);
    button.type = 'button';
    button.setAttribute('data-workspace-action', action);
    return button;
  }

  function wrapTable(doc, table) {
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  function marketBadges(doc, markets, multiMarket) {
    const bar = doc.createElement('div');
    bar.className = 'kmc-purchasing-markets';
    (markets || []).forEach((m) => {
      bar.appendChild(text(doc, 'span', 'kmc-purchasing-market-badge', `${marketLabel(m)} · ${formatNumber(m.quantity)} u.`));
    });
    if (multiMarket) {
      bar.appendChild(text(doc, 'span', 'kmc-purchasing-multi-market', 'Commande multi-marchés'));
    }
    return bar;
  }

  function createHeader(doc) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'ACHATS FOURNISSEURS'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Achats fournisseurs'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Suivez les achats fournisseurs en cours et retrouvez les commandes terminées.'));
    header.appendChild(copy);
    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.setAttribute('data-workspace-feedback', '');
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    return header;
  }

  function createSection(rootNode, ui, title, description) {
    const section = ui.Section.create({ title, description });
    rootNode.appendChild(section.element);
    return section.slot;
  }

  // ─── Lignes ouvertes ──────────────────────────────────────────────────────────────────────────

  function groupKey(group) {
    return `${group.supplier_id}|${group.procurement_hub_ref}|${group.market_id}`;
  }


  // Achat de substitution : le lien article/fournisseur est créé avant le changement de ligne.
  // Toutes les mutations passent par les routes autorisées ; aucune PO engagée n'est réécrite.
  function renderChangeSupplier(doc, parent, line, context) {
    const panel = doc.createElement('form');
    panel.className = 'kmc-purchasing-supplier-change';
    panel.setAttribute('data-change-supplier-form', line.line_id);
    const heading = text(doc, 'strong', '', 'Changer de fournisseur · ' + (line.product_name || 'Article'));
    panel.appendChild(heading);
    const picker = doc.createElement('select');
    picker.setAttribute('aria-label', 'Fournisseur de remplacement');
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choisir un fournisseur existant';
    picker.appendChild(placeholder);
    panel.appendChild(picker);
    const name = doc.createElement('input');
    name.placeholder = 'Ou nom du nouveau fournisseur local';
    name.setAttribute('aria-label', 'Nouveau fournisseur local');
    panel.appendChild(name);
    const phone = doc.createElement('input');
    phone.placeholder = 'Téléphone du nouveau fournisseur (facultatif)';
    phone.setAttribute('aria-label', 'Contact fournisseur');
    panel.appendChild(phone);
    const sku = doc.createElement('input');
    sku.placeholder = 'Référence produit chez ce fournisseur';
    sku.value = line.supplier_sku || line.supplier_unit_ref || '';
    // Requis seulement si un nouveau mapping doit être créé (validation dans submit).
    sku.required = false;
    sku.setAttribute('aria-label', 'Référence produit fournisseur');
    panel.appendChild(sku);
    const price = doc.createElement('input');
    price.type = 'number';
    price.min = '0.01';
    price.step = 'any';
    price.placeholder = 'Prix unitaire réel (AED)';
    price.required = false;
    price.setAttribute('aria-label', 'Prix unitaire en AED');
    panel.appendChild(price);
    const reason = doc.createElement('input');
    reason.placeholder = 'Motif du changement';
    reason.required = true;
    reason.setAttribute('aria-label', 'Motif du changement de fournisseur');
    panel.appendChild(reason);
    const status = text(doc, 'p', 'kmc-workspace-subtitle', 'Le fournisseur initial et sa ligne resteront dans l’historique.');
    panel.appendChild(status);
    const save = makeButton(doc, 'Valider le changement', 'change-supplier');
    save.type = 'submit';
    panel.appendChild(save);
    parent.appendChild(panel);
    let availableSuppliers = [];
    jsonRequest(context.fetchFn, `${ENDPOINT}/suppliers?active=true&product_id=${encodeURIComponent(line.product_id)}`).then((suppliers) => {
      availableSuppliers = Array.isArray(suppliers) ? suppliers : [];
      availableSuppliers.forEach((supplier) => {
        // Un agent Hub peut utiliser un mapping global existant, mais ne peut pas réécrire le catalogue global.
        if (context.user && context.user.role === 'agent_hub' && !supplier.matching_product_supplier_id && supplier.owner_scope !== 'hub') return;
        const option = doc.createElement('option');
        option.value = supplier.id;
        option.textContent = supplier.name;
        picker.appendChild(option);
      });
    }).catch((error) => { status.textContent = describeError(error); });
    panel.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const existing = availableSuppliers.find((supplier) => supplier.id === picker.value);
      const needsMapping = !!name.value.trim() || !existing || !existing.matching_product_supplier_id;
      if (!line.product_id || !reason.value.trim() || (!picker.value && !name.value.trim()) ||
          (needsMapping && (!sku.value.trim() || !(Number(price.value) > 0)))) {
        status.textContent = needsMapping
          ? 'Renseignez le fournisseur, la référence produit, le prix AED et le motif.'
          : 'Renseignez le fournisseur et le motif.';
        return;
      }
      save.disabled = true;
      try {
        let supplierId = picker.value;
        if (name.value.trim()) {
          const supplier = await jsonRequest(context.fetchFn, `${ENDPOINT}/suppliers`, {
            method: 'POST', body: { name: name.value.trim(), platform: 'local', contact_phone: phone.value.trim() || null },
          });
          supplierId = supplier.id;
        }
        let mappingId = !name.value.trim() && existing && existing.matching_product_supplier_id;
        if (!mappingId) {
          const mapping = await jsonRequest(context.fetchFn, `${ENDPOINT}/suppliers/${encodeURIComponent(supplierId)}/map`, {
            method: 'POST',
            body: { product_id: line.product_id, supplier_sku: sku.value.trim(), supplier_price_aed: Number(price.value) },
          });
          mappingId = mapping.id;
        }
        await jsonRequest(context.fetchFn, `${ENDPOINT}/lines/${encodeURIComponent(line.line_id)}/change-supplier`, {
          method: 'POST',
          body: { product_supplier_id: mappingId, reason: reason.value.trim(), execution_mode: 'manual' },
        });
        context.selection.delete(line.line_id);
        await context.reload();
        setFeedback(context.root, 'Fournisseur remplacé ; ancienne ligne conservée et nouvelle ligne ouverte.', 'success');
      } catch (error) {
        status.textContent = describeError(error);
        save.disabled = false;
      }
    });
  }

  function renderGroup(doc, slot, group, context) {
    const key = groupKey(group);
    const card = doc.createElement('article');
    card.className = 'kmc-purchasing-group';
    card.setAttribute('data-purchasing-group', key);

    const head = doc.createElement('header');
    head.className = 'kmc-purchasing-group-head';
    const title = text(doc, 'h3', 'kmc-purchasing-group-title', group.supplier_name);
    const nav = globalThis.KomerceCanonicalNavigation;
    // Fournisseur 360 : réservé admin côté serveur ; lien direct avec retour vers les achats (po / filtres conservés).
    if (group.supplier_id && context.user && context.user.role === 'admin' && nav && typeof nav.withEntityReturnTo === 'function') {
      const link = doc.createElement('a');
      link.className = 'kmc-purchasing-supplier-link';
      link.setAttribute('href', nav.withEntityReturnTo(`/admin/suppliers/${encodeURIComponent(group.supplier_id)}`, nav.currentReturnTarget(null), 'Retour aux achats'));
      link.setAttribute('aria-label', `Fiche fournisseur ${group.supplier_name}`);
      link.textContent = group.supplier_name;
      title.textContent = '';
      title.appendChild(link);
    }
    head.appendChild(title);
    head.appendChild(text(doc, 'span', 'kmc-purchasing-hub', `Hub ${group.procurement_hub_ref}`));
    if ((group.currencies || []).length) {
      head.appendChild(text(doc, 'span', 'kmc-purchasing-currency', group.currencies.join(' / ')));
    }
    card.appendChild(head);
    card.appendChild(marketBadges(doc, group.markets, group.multi_market));

    const selected = () => group.lines.filter((l) => context.selection.has(l.line_id));
    const prepare = makeButton(doc, 'Préparer la commande', 'prepare-po');
    const refreshPrepare = () => {
      const n = selected().length;
      prepare.textContent = n ? `Préparer la commande (${n})` : 'Préparer la commande';
      prepare.disabled = n === 0 || context.busy.has('prepare');
    };

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-purchasing-lines-table';
    table.innerHTML = '<thead><tr><th></th><th>Commande</th><th>Marché</th><th>Produit</th><th>Réf. fournisseur</th><th>Qté</th><th>Prix attendu</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    group.lines.forEach((line) => {
      const tr = doc.createElement('tr');
      tr.setAttribute('data-purchasing-line', line.line_id);
      const pick = doc.createElement('td');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = context.selection.has(line.line_id);
      box.setAttribute('aria-label', `Sélectionner la ligne ${line.order_reference || line.line_id}`);
      box.addEventListener('change', () => {
        if (box.checked) context.selection.add(line.line_id); else context.selection.delete(line.line_id);
        refreshPrepare();
      });
      pick.appendChild(box);
      tr.appendChild(pick);
      tr.appendChild(td(doc, line.order_reference));
      tr.appendChild(td(doc, marketLabel(line)));
      tr.appendChild(td(doc, line.product_name));
      tr.appendChild(td(doc, line.supplier_unit_ref || line.supplier_sku));
      tr.appendChild(td(doc, formatNumber(line.quantity)));
      tr.appendChild(td(doc, formatPrice(line.expected_unit_price, line.supplier_currency)));
      const actions = doc.createElement('td');
      const cancel = makeButton(doc, 'Annuler', 'cancel-line', true);
      cancel.addEventListener('click', () => {
        const reason = context.prompt(`Raison de l’annulation · ${line.order_reference || line.line_id}`);
        if (!reason || !reason.trim()) return;
        context.selection.delete(line.line_id);
        context.act(cancel, 'cancel', {
          url: `${ENDPOINT}/lines/${encodeURIComponent(line.line_id)}/cancel`,
          body: { reason: reason.trim() },
          successMessage: 'Ligne annulée.',
        });
      });
      const change = makeButton(doc, 'Changer fournisseur', 'change-supplier', true);
      change.addEventListener('click', () => {
        const existing = card.querySelector('[data-change-supplier-form="' + line.line_id + '"]');
        if (existing) { existing.remove(); return; }
        renderChangeSupplier(doc, card, line, context);
      });
      actions.appendChild(change);
      actions.appendChild(cancel);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(wrapTable(doc, table));

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    prepare.addEventListener('click', () => {
      // Anti double-clic : le verrou est posé de façon synchrone, avant tout await.
      if (context.busy.has('prepare')) return;
      const lineIds = selected().map((l) => l.line_id);
      if (!lineIds.length) return;
      context.busy.add('prepare');
      prepare.disabled = true;
      context.act(prepare, 'prepare', {
        url: `${ENDPOINT}/po/prepare`,
        body: { supplier_id: group.supplier_id, procurement_hub_ref: group.procurement_hub_ref, line_ids: lineIds },
        successMessage: 'Commande préparée en brouillon.',
        onSuccess: (result) => {
          lineIds.forEach((id) => context.selection.delete(id));
          context.openPo(result.purchase_order.id);
        },
      });
    });
    bar.appendChild(prepare);
    card.appendChild(bar);
    refreshPrepare();
    slot.appendChild(card);
  }

  function renderOpenLines(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Lignes à préparer',
      'Sélectionnez les lignes d’un même fournisseur puis préparez la commande.'
    );
    if (!(payload.groups || []).length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune ligne à acheter.'));
      return;
    }
    payload.groups.forEach((group) => renderGroup(doc, slot, group, context));
  }

  // ─── Détail d'une commande regroupée ──────────────────────────────────────────────────────────

  function renderConfirmForm(doc, slot, po, lines, context) {
    const form = doc.createElement('form');
    form.className = 'kmc-purchasing-confirm';
    form.setAttribute('data-purchasing-confirm', '');
    form.noValidate = true;

    const manual = po.trigger_mode !== 'auto';
    // Server-derived scope on every PO line: a G6 purchase MUST declare simulation.
    // A mixed/unknown scope never acquires simulated=true; the backend also rejects it.
    const activeScopes = new Set(lines.filter(line => !line.cancelled)
      .map(line => line.simulation_scope || null));
    const isG6Simulation = activeScopes.size === 1 && activeScopes.has('G6-BUYER');
    form.setAttribute('data-purchasing-simulation', isG6Simulation ? 'G6-STAGING' : 'NONE');
    const intro = text(doc, 'p', 'kmc-workspace-subtitle', manual
      ? 'Achat manuel : saisissez la quantité réellement achetée et la référence ou preuve d’achat. Aucune confirmation fournisseur n’est exigée pour recevoir ; l’écart devient un reliquat ouvert, jamais perdu.'
      : 'Saisissez la quantité réellement confirmée par le fournisseur pour chaque ligne. L’écart devient un reliquat ouvert, jamais perdu.');
    intro.setAttribute('data-purchasing-execution-hint', manual ? 'manual' : 'api');
    form.appendChild(intro);

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-purchasing-confirm-table';
    table.innerHTML = '<thead><tr><th>Commande</th><th>Marché</th><th>Réf. fournisseur</th><th>Demandée</th><th>Confirmée</th><th>Prix confirmé / devise</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    const inputs = [];
    lines.filter((l) => !l.cancelled).forEach((line) => {
      const tr = doc.createElement('tr');
      tr.setAttribute('data-purchasing-confirm-line', line.line_id);
      tr.appendChild(td(doc, line.order_reference));
      tr.appendChild(td(doc, marketLabel(line)));
      tr.appendChild(td(doc, line.supplier_unit_ref || line.supplier_sku));
      tr.appendChild(td(doc, formatNumber(line.quantity)));
      const qtyCell = doc.createElement('td');
      const qty = doc.createElement('input');
      qty.type = 'number';
      qty.min = '0';
      qty.max = String(line.quantity);
      qty.step = '1';
      qty.value = String(line.quantity);
      qty.setAttribute('aria-label', `Quantité confirmée ${line.order_reference || line.line_id}`);
      qty.setAttribute('data-confirmed-quantity', '');
      qtyCell.appendChild(qty);
      tr.appendChild(qtyCell);
      const priceCell = doc.createElement('td');
      const price = doc.createElement('input');
      price.type = 'number';
      price.min = '0';
      price.step = 'any';
      price.placeholder = line.expected_unit_price == null ? '' : String(line.expected_unit_price);
      price.setAttribute('aria-label', `Prix confirmé ${line.order_reference || line.line_id}`);
      price.setAttribute('data-confirmed-price', '');
      priceCell.appendChild(price);
      // Sans devis initial, un prix d'achat confirmé ne peut pas hériter
      // silencieusement de la devise du catalogue ni du budget du Hub.
      const needsCurrency = line.expected_unit_price == null || !line.supplier_currency;
      let currency = null;
      if (needsCurrency) {
        currency = doc.createElement('input');
        currency.type = 'text';
        currency.maxLength = 3;
        currency.autocomplete = 'off';
        currency.placeholder = 'EUR';
        currency.setAttribute('aria-label', `Devise confirmée ${line.order_reference || line.line_id}`);
        currency.setAttribute('data-confirmed-currency', '');
        priceCell.appendChild(currency);
      }
      tr.appendChild(priceCell);
      tbody.appendChild(tr);
      inputs.push({ line, qty, price, currency });
    });
    table.appendChild(tbody);
    form.appendChild(wrapTable(doc, table));

    const ref = doc.createElement('input');
    ref.type = 'text';
    ref.placeholder = 'Référence de commande fournisseur';
    ref.setAttribute('aria-label', 'Référence de commande fournisseur');
    ref.setAttribute('data-supplier-order-id', '');
    form.appendChild(ref);

    let seller = null;
    let variance = null;
    const executions = [];
    const proof = doc.createElement('input');
    if (manual) {
      proof.type = 'text';
      proof.required = true;
      proof.minLength = 4;
      proof.placeholder = 'Justificatif obligatoire : référence facture, reçu ou lien vers la photo';
      proof.setAttribute('aria-label', 'Justificatif de l’achat manuel (obligatoire)');
      proof.setAttribute('data-purchase-proof-ref', '');
      form.appendChild(proof);
      seller = doc.createElement('input');
      seller.type = 'text';
      seller.required = true;
      seller.minLength = 2;
      seller.placeholder = 'Vendeur réel obligatoire : nom du magasin ou du vendeur (pas le Hub central)';
      seller.setAttribute('aria-label', 'Vendeur réel de l’achat manuel (obligatoire)');
      seller.setAttribute('data-purchase-seller-label', '');
      form.appendChild(seller);
      const allocationPanel = text(doc, 'section', 'kmc-purchase-allocations', 'Achats chez plusieurs vendeurs');
      const allocationField = (label, input) => {
        const wrap = text(doc, 'label', 'kmc-purchase-allocation-field', label);
        wrap.appendChild(input);
        return wrap;
      };
      const allocationRows = doc.createElement('div');
      allocationRows.setAttribute('data-purchase-allocation-rows', '');
      const addAllocation = makeButton(doc, 'Ajouter un vendeur', 'add-purchase-allocation', true);
      addAllocation.setAttribute('data-purchase-add-allocation', '');
      addAllocation.addEventListener('click', () => {
        const row = doc.createElement('fieldset');
        row.className = 'kmc-purchase-allocation';
        const legend = text(doc, 'legend', '', `Allocation ${executions.length + 1}`);
        row.appendChild(legend);
        const lineSelect = doc.createElement('select');
        lineSelect.setAttribute('aria-label', 'Ligne de commande pour cette allocation');
        lineSelect.setAttribute('data-purchase-execution-line', '');
        lines.filter((line) => !line.cancelled).forEach((line) => {
          const option = doc.createElement('option');
          option.value = line.line_id;
          option.textContent = `${line.order_reference || shortId(line.line_id)} · ${line.product_name || line.product || 'Article'}`;
          lineSelect.appendChild(option);
        });
        row.appendChild(allocationField('Ligne', lineSelect));
        const sellerInput = doc.createElement('input');
        sellerInput.type = 'text'; sellerInput.maxLength = 240; sellerInput.required = true;
        sellerInput.placeholder = 'Nom du vendeur (pas le Fournisseur central Hub)';
        sellerInput.setAttribute('aria-label', 'Vendeur de cette allocation');
        sellerInput.setAttribute('data-purchase-execution-seller', '');
        row.appendChild(allocationField('Vendeur', sellerInput));
        const channel = doc.createElement('select');
        channel.setAttribute('aria-label', 'Canal de cet achat');
        channel.setAttribute('data-purchase-execution-channel', '');
        [['in_person', 'En personne'], ['phone', 'Téléphone'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['other', 'Autre']].forEach(([value, label]) => {
          const option = doc.createElement('option'); option.value = value; option.textContent = label; channel.appendChild(option);
        });
        row.appendChild(allocationField('Canal', channel));
        const quantity = Object.assign(doc.createElement('input'), { type: 'number', min: '1', step: '1', value: '1' });
        quantity.setAttribute('aria-label', 'Quantité achetée chez ce vendeur');
        quantity.setAttribute('data-purchase-execution-quantity', '');
        row.appendChild(allocationField('Quantité', quantity));
        const amount = Object.assign(doc.createElement('input'), { type: 'number', min: '0', step: '0.01' });
        amount.setAttribute('aria-label', 'Montant total payé à ce vendeur');
        amount.setAttribute('data-purchase-execution-amount', '');
        row.appendChild(allocationField('Montant total', amount));
        const currency = doc.createElement('input'); currency.type = 'text'; currency.maxLength = 3; currency.placeholder = 'EUR';
        currency.setAttribute('aria-label', 'Devise payée à ce vendeur');
        currency.setAttribute('data-purchase-execution-currency', '');
        row.appendChild(allocationField('Devise', currency));
        const proofRef = doc.createElement('input'); proofRef.type = 'text'; proofRef.maxLength = 240; proofRef.required = true;
        proofRef.placeholder = 'Référence du reçu / justificatif';
        proofRef.setAttribute('aria-label', 'Justificatif de cet achat');
        proofRef.setAttribute('data-purchase-execution-proof', '');
        row.appendChild(allocationField('Justificatif', proofRef));
        const remove = makeButton(doc, 'Supprimer', 'remove-purchase-allocation', true);
        remove.setAttribute('data-purchase-remove-allocation', '');
        const record = { lineSelect, sellerInput, channel, quantity, amount, currency, proofRef, row };
        remove.addEventListener('click', () => {
          const index = executions.indexOf(record); if (index >= 0) executions.splice(index, 1);
          row.remove();
          [...allocationRows.querySelectorAll('legend')].forEach((item, i) => { item.textContent = `Allocation ${i + 1}`; });
        });
        row.appendChild(remove);
        allocationRows.appendChild(row);
        executions.push(record);
      });
      allocationPanel.appendChild(allocationRows);
      allocationPanel.appendChild(addAllocation);
      form.appendChild(allocationPanel);
      variance = doc.createElement('input');
      variance.type = 'text';
      variance.placeholder = 'Motif si le total justifié diffère du total confirmé (sinon laisser vide)';
      variance.setAttribute('aria-label', 'Motif d’écart de justification');
      variance.setAttribute('data-purchase-variance-reason', '');
      form.appendChild(variance);
    }

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const submit = makeButton(doc, 'Enregistrer la confirmation', 'confirm-po');
    submit.type = 'submit';
    bar.appendChild(submit);
    form.appendChild(bar);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (context.busy.has('confirm')) return;
      const payloadLines = [];
      for (const { line, qty, price, currency } of inputs) {
        const confirmed = Number(qty.value);
        if (!Number.isInteger(confirmed) || confirmed < 0 || confirmed > Number(line.quantity)) {
          setFeedback(context.root, `Quantité confirmée invalide pour ${line.order_reference || line.line_id} (0 à ${line.quantity}).`, 'critical');
          return;
        }
        const entry = { purchase_line_id: line.line_id, confirmed_quantity: confirmed };
        if (confirmed > 0 && currency) {
          const entered = Number(price.value);
          const code = currency.value.trim().toUpperCase();
          if (price.value.trim() === '' || !Number.isFinite(entered) || entered <= 0 || !/^[A-Z]{3}$/.test(code)) {
            setFeedback(context.root, `Prix confirmé positif et devise ISO obligatoires pour ${line.order_reference || line.line_id}.`, 'critical');
            return;
          }
          entry.confirmed_unit_price = entered;
          entry.confirmed_currency = code;
        } else if (price.value.trim() !== '') {
          const entered = Number(price.value);
          if (!Number.isFinite(entered) || entered <= 0) {
            setFeedback(context.root, 'Le prix confirmé doit être strictement positif.', 'critical');
            return;
          }
          entry.confirmed_unit_price = entered;
        }
        payloadLines.push(entry);
      }
      if (manual && payloadLines.some((l) => l.confirmed_quantity > 0) && proof.value.trim().length < 4) {
        setFeedback(context.root, 'Ajoutez une référence de facture, de reçu ou de photo avant de confirmer l’achat manuel.', 'critical');
        return;
      }
      let manualExecutions;
      if (manual && executions.length) {
        manualExecutions = [];
        const allocationTotals = new Map();
        for (const entry of executions) {
          const purchaseLineId = entry.lineSelect.value;
          const sellerLabel = entry.sellerInput.value.trim();
          const quantity = Number(entry.quantity.value);
          const amount = Number(entry.amount.value);
          const currency = entry.currency.value.trim().toUpperCase();
          const proofRef = entry.proofRef.value.trim();
          if (!payloadLines.some((line) => line.purchase_line_id === purchaseLineId && line.confirmed_quantity > 0)) {
            setFeedback(context.root, 'Chaque allocation doit concerner une ligne confirmée.', 'critical'); return;
          }
          if (sellerLabel.length < 2 || sellerLabel.toLowerCase() === 'fournisseur central hub' ||
              !Number.isInteger(quantity) || quantity < 1 || !(amount > 0) ||
              !/^[A-Z]{3}$/.test(currency) || proofRef.length < 4) {
            setFeedback(context.root, 'Chaque vendeur doit avoir une quantité, un montant, une devise et un justificatif valides.', 'critical'); return;
          }
          allocationTotals.set(purchaseLineId, (allocationTotals.get(purchaseLineId) || 0) + quantity);
          manualExecutions.push({ purchase_line_id: purchaseLineId, seller_label: sellerLabel,
            channel: entry.channel.value, quantity, amount, currency, proof_ref: proofRef });
        }
        for (const line of payloadLines) {
          if ((allocationTotals.get(line.purchase_line_id) || 0) !== line.confirmed_quantity) {
            setFeedback(context.root, 'Les allocations vendeurs doivent couvrir exactement la quantité confirmée de chaque ligne.', 'critical'); return;
          }
        }
      } else if (manual && payloadLines.some((l) => l.confirmed_quantity > 0) && seller.value.trim().length < 2) {
        setFeedback(context.root, 'Indiquez le vendeur réel (magasin ou fournisseur) avant de confirmer l’achat manuel.', 'critical');
        return;
      }
      context.busy.add('confirm');
      submit.disabled = true;
      context.act(submit, 'confirm', {
        url: `${ENDPOINT}/po/${encodeURIComponent(po.id)}/confirm`,
        body: {
          lines: payloadLines,
          ...(isG6Simulation ? { simulated: true } : {}),
          ...(ref.value.trim() ? { supplier_order_id: ref.value.trim() } : {}),
          ...(manual ? { purchase_proof_ref: proof.value.trim(), ...(manualExecutions ? { executions: manualExecutions } : { seller_label: seller.value.trim() }) } : {}),
          ...(manual && variance.value.trim() ? { variance_reason: variance.value.trim() } : {}),
        },
        successMessage: (result) => {
          const remnants = (result.remnants || []).length;
          return remnants
            ? `Confirmation enregistrée · ${remnants} reliquat(s) rouvert(s) dans « Lignes à acheter ».`
            : 'Confirmation enregistrée.';
        },
      });
    });
    slot.appendChild(form);
  }

  function formatExactAmount(amount, currency) {
    if (amount == null || amount === '') return '—';
    return `${String(amount)}${currency ? ` ${currency}` : ''}`;
  }

  function formatBoolean(value) {
    if (value == null) return '—';
    return value ? 'Oui' : 'Non';
  }

  function renderExecutionTable(doc, parent, title, columns, rows, values, dataName) {
    if (!rows.length) return;
    const block = doc.createElement('div');
    block.className = 'kmc-purchasing-execution-block';
    block.setAttribute('data-purchasing-execution-block', dataName);
    block.appendChild(text(doc, 'h4', 'kmc-purchasing-execution-title', title));
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-purchasing-execution-table';
    table.innerHTML = `<thead><tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr></thead>`;
    const tbody = doc.createElement('tbody');
    rows.forEach((row) => {
      const tr = doc.createElement('tr');
      values(row).forEach((value) => tr.appendChild(td(doc, value)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(wrapTable(doc, table));
    parent.appendChild(block);
  }

  function appendOperatorForm(doc, parent, title, fields, submitAction) {
    const panel = doc.createElement('details');
    panel.appendChild(text(doc, 'summary', '', title));
    const form = doc.createElement('form');
    form.className = 'kmc-purchasing-confirm';
    const inputs = fields.map(({ label, ...properties }) => {
      const wrapper = text(doc, 'label', '', label);
      const input = Object.assign(doc.createElement('input'), properties);
      wrapper.appendChild(input);
      form.appendChild(wrapper);
      return input;
    });
    const submit = makeButton(doc, 'Enregistrer', 'record-operator-action');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!submit.disabled && form.reportValidity()) submitAction(submit, inputs);
    });
    panel.appendChild(form);
    parent.appendChild(panel);
  }

  function renderPaymentSettlement(doc, parent, payment, context) {
    if (!payment.id || payment.status !== 'succeeded' || payment.real_debit_verified !== true) return;
    const key = `payment-settlement:${payment.id}`;
    const url = `${ENDPOINT}/supplier-payments/${encodeURIComponent(payment.id)}/settlements`;
    const history = makeButton(doc, 'Voir les règlements consignés', 'read-payment-settlements', true);
    const historySlot = doc.createElement('div');
    historySlot.setAttribute('aria-live', 'polite');
    history.addEventListener('click', async () => {
      history.disabled = true;
      try {
        const result = await jsonRequest(context.fetchFn, url);
        historySlot.replaceChildren();
        const rows = result.settlements || [];
        if (!rows.length) historySlot.appendChild(text(doc, 'p', '', 'Aucun règlement consigné.'));
        renderExecutionTable(doc, historySlot, 'Règlements consignés',
          ['Nature', 'Montant', 'Débit hors frais', 'Frais', 'Justificatif'], rows,
          (row) => [row.kind, formatExactAmount(row.amount_currency, row.currency),
            formatExactAmount(row.amount_kmf, 'KMF'), formatExactAmount(row.fees_kmf, 'KMF'), row.proof_ref],
          'settlements');
      } catch (error) {
        historySlot.textContent = describeError(error);
      } finally {
        history.disabled = false;
      }
    });
    parent.append(history, historySlot);
    const amount = { type: 'number', required: true, min: '0.01', step: '0.01' };
    appendOperatorForm(doc, parent,
      `Consigner le débit vérifié · ${payment.payment_ref || shortId(payment.id)}`, [
        { ...amount, label: `Montant débité en ${payment.currency}`, min: '0.0001', step: '0.0001' },
        { ...amount, label: 'Montant du débit hors frais (KMF)' },
        { ...amount, label: 'Frais constatés (KMF)', required: false, min: '0' },
        { label: 'Référence unique du débit (relevé ou reçu)', required: true, maxLength: 180 },
      ], (button, [native, kmf, fees, proof]) => {
        if (context.busy.has(key)) return;
        const reference = proof.value.trim();
        if (!reference) {
          setFeedback(context.root, 'La référence du débit est obligatoire.', 'critical');
          return;
        }
        context.act(button, key, {
          url,
          body: {
            kind: 'payment', currency: payment.currency, amount_currency: native.value,
            amount_kmf: kmf.value, fees_kmf: fees.value || '0',
            proof_ref: reference, idempotency_key: `purchasing-ui:${reference}`,
          },
          successMessage: 'Débit déjà effectué consigné dans les règlements fournisseur.',
        });
      });
  }

  function renderLineSettlement(doc, parent, po, line, context) {
    if (line.settled_at || line.cancelled || !['notified', 'confirmed'].includes(po.status)) return;
    if (po.status === 'confirmed' && line.confirmed_quantity == null) return;
    const received = line.received_quantity;
    const effective = line.effective_quantity;
    if (!Number.isInteger(received) || !Number.isInteger(effective) || received >= effective) return;
    const key = `line-settlement:${line.line_id}`;
    appendOperatorForm(doc, parent,
      `Clôturer la ligne ${line.order_reference || shortId(line.line_id)} · ${received}/${effective} reçu(s)`, [
        { label: 'Motif de clôture', required: true },
        { label: 'Rouvrir le reliquat pour un autre achat', type: 'checkbox', checked: true },
      ], (button, [reason, reopen]) => {
        if (context.busy.has(key)) return;
        if (!reason.value.trim()) {
          setFeedback(context.root, 'Le motif de clôture est obligatoire.', 'critical');
          return;
        }
        if (!reopen.checked && !context.confirm('Confirmer la rupture définitive du reliquat ? Un incident sera ouvert.')) return;
        context.act(button, key, {
          url: `${ENDPOINT}/lines/${encodeURIComponent(line.line_id)}/settle`,
          body: { settled_quantity: received, reason: reason.value.trim(), reopen_remainder: reopen.checked },
          successMessage: (result) => result.remnant ? 'Ligne clôturée et reliquat rouvert.' : 'Ligne clôturée.',
        });
      });
  }

  function renderSupplierExecution(doc, slot, execution, context) {
    const source = execution || {};
    const orders = source.orders || [];
    const orderLines = source.order_lines || [];
    const groups = source.groups || [];
    const groupMembers = source.group_members || [];
    const payments = source.payments || [];
    const proofs = source.proofs || [];
    const events = source.events || [];
    const blocking = source.blocking || [];
    const total = orders.length + orderLines.length + groups.length + groupMembers.length + payments.length + proofs.length + events.length + blocking.length;

    const section = doc.createElement('div');
    section.className = 'kmc-purchasing-execution';
    section.setAttribute('data-purchasing-execution', '');
    section.appendChild(text(doc, 'h3', 'kmc-purchasing-execution-heading', 'Exécution fournisseur'));
    section.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      'Faits persistés par Purchasing : ordres, liens, paiements, preuves et événements. Les statuts sont affichés sans interprétation locale.'
    ));

    // État bloquant fourni par le serveur (api_ambiguous_blocked) : affiché tel quel, jamais inféré ici.
    blocking.forEach((row) => {
      const alert = doc.createElement('div');
      alert.className = 'kmc-purchasing-blocking';
      alert.setAttribute('data-purchasing-blocking', row.state || '');
      alert.setAttribute('role', 'alert');
      alert.appendChild(text(doc, 'strong', 'kmc-purchasing-blocking-title', 'Bloqué — création fournisseur ambiguë'));
      alert.appendChild(text(
        doc,
        'p',
        'kmc-purchasing-blocking-detail',
        `Provider ${row.provider || '—'} · propriétaire : ${row.owner_role === 'purchasing' ? 'Achats' : (row.owner_role || '—')} · depuis ${row.since || '—'}. Réconcilier le fournisseur avant toute reprise de l’achat.`
      ));
      section.appendChild(alert);
    });

    if (!total) {
      section.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune exécution fournisseur persistée pour cette commande.'));
      slot.appendChild(section);
      return;
    }

    renderExecutionTable(doc, section, 'Ordres fournisseur',
      ['Provider', 'Commande fournisseur', 'Code', 'Statut provider', 'Créé'],
      orders,
      (row) => [row.provider, row.supplier_order_id, row.supplier_order_code, row.provider_status, row.created_at],
      'orders');

    renderExecutionTable(doc, section, 'Liens ordre ↔ ligne',
      ['Ordre', 'Ligne d’achat', 'Quantité'],
      orderLines,
      (row) => [shortId(row.supplier_execution_order_id), shortId(row.purchase_line_id), row.quantity],
      'order-lines');

    renderExecutionTable(doc, section, 'Groupes fournisseur',
      ['Provider', 'Commande parente', 'Réf. paiement', 'Statut provider', 'Statut paiement'],
      groups,
      (row) => [row.provider, row.supplier_parent_order_id, row.payment_ref, row.provider_status, row.payment_status],
      'groups');

    renderExecutionTable(doc, section, 'Membres des groupes',
      ['Groupe', 'Ordre'],
      groupMembers,
      (row) => [shortId(row.supplier_execution_group_id), shortId(row.supplier_execution_order_id)],
      'group-members');

    renderExecutionTable(doc, section, 'Paiements fournisseur',
      ['Provider', 'Réf. paiement', 'Attendu', 'Observé', 'Statut', 'Rapprochement', 'Débit vérifié'],
      payments,
      (row) => [
        row.provider,
        row.payment_ref || row.payment_execution_key,
        formatExactAmount(row.expected_amount, row.currency),
        formatExactAmount(row.observed_amount, row.currency),
        row.status,
        row.reconciliation_status,
        formatBoolean(row.real_debit_verified),
      ],
      'payments');

    if (context.user.role === 'admin') {
      payments.forEach((payment) => renderPaymentSettlement(doc, section, payment, context));
    }

    renderExecutionTable(doc, section, 'Preuves de paiement',
      ['Provider', 'Source', 'Référence', 'Montant observé', 'Débit confirmé', 'Sandbox', 'Simulée'],
      proofs,
      (row) => [
        row.provider,
        row.proof_source,
        row.proof_ref || row.payment_ref || row.provider_order_id,
        formatExactAmount(row.observed_amount, row.currency),
        formatBoolean(row.debit_confirmed),
        formatBoolean(row.sandbox),
        formatBoolean(row.simulated),
      ],
      'proofs');

    renderExecutionTable(doc, section, 'Événements d’exécution',
      ['Provider', 'Opération', 'Résultat', 'Request ID', 'Code provider', 'Créé'],
      events,
      (row) => [row.provider, row.operation, row.outcome, row.provider_request_id, row.provider_code, row.created_at],
      'events');

    slot.appendChild(section);
  }

  function renderPurchaseOrder(rootNode, ui, doc, detail, context) {
    const po = detail.purchase_order;
    const slot = createSection(
      rootNode,
      ui,
      `${['hub_received', 'cancelled'].includes(po.status) ? 'Historique des achats · ' : 'Achat fournisseur en cours · '}Commande ${shortId(po.id)}`,
      `Hub ${po.procurement_hub_ref || '—'} · ${STATUS_LABELS[po.status] || po.status} · ${po.trigger_mode === 'auto' ? 'Exécution API' : 'Achat manuel'}`
    );
    slot.setAttribute('data-purchasing-po', po.id);
    slot.setAttribute('data-purchasing-exec-mode', po.trigger_mode === 'auto' ? 'api' : 'manual');
    slot.setAttribute('data-purchasing-po-status', po.status);
    slot.appendChild(marketBadges(doc, detail.markets, detail.multi_market));

    const lines = detail.lines || [];
    const isDraft = po.status === 'draft';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-purchasing-po-table';
    table.innerHTML = `<thead><tr>${isDraft ? '<th></th>' : ''}<th>Commande</th><th>Marché</th><th>Produit</th><th>Réf. fournisseur</th><th>Qté</th><th>Confirmée</th><th>Prix attendu</th></tr></thead>`;
    const tbody = doc.createElement('tbody');
    const detachSelection = new Set();
    const detach = makeButton(doc, 'Détacher la sélection', 'detach-lines', true);
    detach.disabled = true;

    lines.forEach((line) => {
      const tr = doc.createElement('tr');
      tr.setAttribute('data-purchasing-po-line', line.line_id);
      if (line.cancelled) tr.className = 'is-cancelled';
      if (isDraft) {
        const pick = doc.createElement('td');
        const box = doc.createElement('input');
        box.type = 'checkbox';
        box.setAttribute('aria-label', `Détacher la ligne ${line.order_reference || line.line_id}`);
        box.addEventListener('change', () => {
          if (box.checked) detachSelection.add(line.line_id); else detachSelection.delete(line.line_id);
          detach.disabled = detachSelection.size === 0;
        });
        pick.appendChild(box);
        tr.appendChild(pick);
      }
      tr.appendChild(td(doc, line.order_reference));
      tr.appendChild(td(doc, marketLabel(line)));
      tr.appendChild(td(doc, line.product_name));
      tr.appendChild(td(doc, line.supplier_unit_ref || line.supplier_sku));
      tr.appendChild(td(doc, formatNumber(line.quantity)));
      tr.appendChild(td(doc, line.confirmed_quantity == null ? '—' : formatNumber(line.confirmed_quantity)));
      tr.appendChild(td(doc, formatPrice(line.expected_unit_price, line.supplier_currency)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
    const executionPanel = doc.createElement('details');
    executionPanel.className = 'kmc-purchasing-detail-fold';
    executionPanel.setAttribute('data-purchasing-execution-fold', '');
    const executionSummary = doc.createElement('summary');
    executionSummary.textContent = 'Exécution fournisseur · ordres, paiements, preuves et événements';
    executionPanel.appendChild(executionSummary);
    renderSupplierExecution(doc, executionPanel, detail.supplier_execution, context);
    lines.forEach((line) => renderLineSettlement(doc, slot, po, line, context));
    slot.appendChild(executionPanel);

    // Une PO ouverte peut accueillir de nouveaux besoins CLIENTS du même fournisseur,
    // Hub et marché. Le navigateur filtre pour la lisibilité ; l'API et la base font autorité.
    if (isDraft && po.market_id) {
      const candidates = ((context.openLines && context.openLines.groups) || [])
        .filter((g) => g.supplier_id === po.supplier_id
          && g.procurement_hub_ref === po.procurement_hub_ref
          && g.market_id === po.market_id)
        .flatMap((g) => g.lines || [])
        .filter((l) => !l.cancelled && l.groupable);
      if (candidates.length) {
        const wrap = doc.createElement('section');
        wrap.className = 'kmc-purchasing-draft-add';
        wrap.appendChild(text(doc, 'h3', 'kmc-purchasing-execution-heading', 'Ajouter des besoins à cette PO ouverte'));
        const pickTable = doc.createElement('table');
        pickTable.className = 'kmc-workspace-table';
        pickTable.innerHTML = '<thead><tr><th></th><th>Commande client</th><th>Produit</th><th>Variante fournisseur</th><th>Qté</th></tr></thead>';
        const pickBody = doc.createElement('tbody');
        const selection = new Set();
        const attach = makeButton(doc, 'Ajouter à la PO', 'attach-lines');
        attach.disabled = true;
        candidates.forEach((l) => {
          const tr = doc.createElement('tr');
          const pick = doc.createElement('td');
          const box = doc.createElement('input');
          box.type = 'checkbox';
          box.setAttribute('aria-label', `Ajouter le besoin ${l.order_reference || l.line_id}`);
          box.addEventListener('change', () => {
            if (box.checked) selection.add(l.line_id); else selection.delete(l.line_id);
            attach.disabled = selection.size === 0;
          });
          pick.appendChild(box);
          tr.appendChild(pick);
          tr.appendChild(td(doc, l.order_reference));
          tr.appendChild(td(doc, l.product_name));
          tr.appendChild(td(doc, l.supplier_unit_ref || l.supplier_sku));
          tr.appendChild(td(doc, formatNumber(l.quantity)));
          pickBody.appendChild(tr);
        });
        pickTable.appendChild(pickBody);
        wrap.appendChild(wrapTable(doc, pickTable));
        attach.addEventListener('click', () => {
          if (!selection.size) return;
          context.act(attach, 'attach', {
            url: `${ENDPOINT}/po/${encodeURIComponent(po.id)}/attach`,
            body: { line_ids: [...selection] },
            successMessage: 'Besoins clients ajoutés à la PO ouverte.',
          });
        });
        wrap.appendChild(attach);
        slot.appendChild(wrap);
      }
    }

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    if (isDraft) {
      detach.addEventListener('click', () => {
        if (!detachSelection.size) return;
        context.act(detach, 'detach', {
          url: `${ENDPOINT}/po/${encodeURIComponent(po.id)}/detach`,
          body: { line_ids: [...detachSelection] },
          successMessage: 'Lignes détachées : elles redeviennent ouvertes.',
        });
      });
      const discard = makeButton(doc, 'Écarter le brouillon', 'discard-po', true);
      discard.addEventListener('click', () => {
        if (!context.confirm('Écarter ce brouillon ? Toutes ses lignes redeviennent ouvertes.')) return;
        context.act(discard, 'discard', {
          url: `${ENDPOINT}/po/${encodeURIComponent(po.id)}/discard`,
          successMessage: 'Brouillon écarté.',
          onSuccess: () => context.closePo(),
        });
      });
      const submit = makeButton(doc, 'Soumettre au fournisseur', 'submit-po');
      submit.addEventListener('click', () => {
        context.act(submit, 'submit', {
          url: `${ENDPOINT}/po/${encodeURIComponent(po.id)}/submit`,
          successMessage: 'Commande soumise au fournisseur.',
        });
      });
      bar.appendChild(detach);
      bar.appendChild(discard);
      bar.appendChild(submit);
    }
    if (context.user?.role==='admin' && ['notified','confirmed'].includes(po.status) &&
        detail.g6_recipe?.eligible===true) {
      const cancelG6=makeButton(doc,'Annuler le PO de recette','cancel-g6-po',true);
      cancelG6.addEventListener('click',()=>{
        const reason=context.prompt('Motif de clôture G6 (obligatoire) :');
        if(!reason||reason.trim().length<8)return;
        if(!context.confirm('Annuler le PO de recette '+po.id+' et détacher ses lignes, sans contact fournisseur ?'))return;
        context.act(cancelG6,'cancel-g6-po',{
          url:`${ENDPOINT}/po/${encodeURIComponent(po.id)}/cancel-g6-recipe`,
          body:{reason:reason.trim()},successMessage:'PO de recette annulé ; lignes détachées.',
          onSuccess:()=>context.closePo(),
        });
      });
      bar.appendChild(cancelG6);
    }
    const close = makeButton(doc, 'Retour à la liste', 'close-po', true);
    close.addEventListener('click', () => context.closePo());
    bar.appendChild(close);
    slot.appendChild(bar);

    if (po.status === 'notified') renderConfirmForm(doc, slot, po, lines, context);
  }

  // Existing GET /api/purchasing is the canonical read-only PO list (latest 100).
  // A confirmed PO remains ongoing until the Hub receives it; supplier SHIPPED alone is not closure.
  function renderPurchaseOrderLists(rootNode, ui, doc, payload, context) {
    const orders = (payload && payload.purchase_orders) || [];
    const groups = [
      { title: 'À préparer · PO brouillon', statuses: ['draft'], empty: 'Aucun brouillon à finaliser.' },
      { title: 'Achats fournisseurs en cours', statuses: ['notified', 'confirmed'], empty: 'Aucune commande fournisseur engagée.' },
      { title: 'Historique des achats', statuses: ['hub_received', 'cancelled'], empty: 'Aucune commande terminée ou annulée dans les 100 dernières.' },
    ];
    const activeStatuses = { prepare: ['draft'], ongoing: ['notified', 'confirmed'], history: ['hub_received', 'cancelled'] };
    const visibleGroups = groups.filter((group) => group.statuses.some((status) => (activeStatuses[context.activeTab] || activeStatuses.prepare).includes(status)));
    visibleGroups.forEach((group) => {
      const slot = createSection(rootNode, ui, group.title, 'Commandes fournisseur récentes · lecture seule · 100 dernières maximum');
      const entries = orders.filter((po) => group.statuses.includes(po.status));
      if (!entries.length) {
        slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', group.empty));
        return;
      }
      const search = doc.createElement('input');
      search.type = 'search';
      search.className = 'kmc-purchasing-list-search';
      search.placeholder = 'Filtrer par PO, fournisseur ou référence commande';
      search.setAttribute('aria-label', 'Filtrer ' + group.title);
      slot.appendChild(search);
      const list = doc.createElement('div');
      list.className = 'kmc-purchasing-po-list';
      slot.appendChild(list);
      const renderEntries = () => {
        list.replaceChildren();
        const needle = String(search.value || '').trim().toLocaleLowerCase('fr');
        const matching = entries.filter((po) => [po.id, po.supplier_name, po.order_ref, po.status].some((v) => String(v || '').toLocaleLowerCase('fr').includes(needle)));
        if (!matching.length) list.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun résultat pour ce filtre.'));
        matching.forEach((po) => {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'kmc-purchasing-po-link';
          button.textContent = `PO ${shortId(po.id)} · ${po.supplier_name || 'Fournisseur'} · ${STATUS_LABELS[po.status] || po.status}${po.order_ref ? ' · ' + po.order_ref : ''}`;
          button.addEventListener('click', () => { context.openPo(po.id); context.reload().catch(() => {}); });
          list.appendChild(button);
        });
      };
      search.addEventListener('input', renderEntries);
      renderEntries();
    });
  }

  function renderPayload(rootNode, ui, doc, state, context) {
    context.openLines = state.openLines;
    rootNode.replaceChildren();
    rootNode.classList.add('kmc-purchasing-workspace');
    rootNode.setAttribute('data-workspace-kind', 'purchasing');
    rootNode.appendChild(createHeader(doc));
    if (context.poId) {
      if (state.detail) renderPurchaseOrder(rootNode, ui, doc, state.detail, context);
      if (state.detailError) {
        const slot = createSection(rootNode, ui, 'Commande indisponible', state.detailError);
        slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', state.detailError));
      }
      return;
    }
    const nav = doc.createElement('nav');
    nav.className = 'kmc-purchasing-tabs';
    nav.setAttribute('aria-label', 'Étapes des achats fournisseurs');
    [['prepare', "Ordre d'Achat à envoyer"], ['ongoing', "Ordre d'Achat en Cours"], ['history', "Ordre d'Achat terminés"]].forEach(([key, label]) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'kmc-purchasing-tab';
      button.textContent = label;
      button.setAttribute('aria-current', context.activeTab === key ? 'page' : 'false');
      button.addEventListener('click', () => { context.activeTab = key; context.reload().catch(() => {}); });
      nav.appendChild(button);
    });
    rootNode.appendChild(nav);
    if (context.activeTab === 'prepare') renderOpenLines(rootNode, ui, doc, state.openLines, context);
    renderPurchaseOrderLists(rootNode, ui, doc, state.purchaseOrders, context);
  }

  // ─── Montage ──────────────────────────────────────────────────────────────────────────────────

  function readPoFromLocation(loc) {
    try {
      return new URLSearchParams((loc && loc.search) || '').get(PO_PARAM) || null;
    } catch (_) {
      return null;
    }
  }

  function writePoToLocation(loc, hist, poId) {
    if (!loc || !hist || typeof hist.replaceState !== 'function') return;
    const params = new URLSearchParams(loc.search || '');
    if (poId) params.set(PO_PARAM, poId); else params.delete(PO_PARAM);
    const query = params.toString();
    hist.replaceState(null, '', `${loc.pathname}${query ? `?${query}` : ''}`);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_purchasing_workspace_dependencies_missing');
    }
    const loc = options.location || (typeof window !== 'undefined' ? window.location : null);
    const hist = options.history || (typeof window !== 'undefined' ? window.history : null);

    const context = {
      root: rootNode,
      fetchFn,
      user: options.user || {},
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      selection: new Set(),
      busy: new Set(),
      poId: readPoFromLocation(loc),
      activeTab: 'prepare',
      reload: null,
      act: null,
      openPo: null,
      closePo: null,
    };

    const workspaceBusy = () => {
      const active = doc.activeElement;
      return context.busy.size > 0 ||
        Boolean(rootNode.querySelector?.('[aria-modal="true"]') ||
        (active && rootNode.contains?.(active) &&
         active.matches?.('input,textarea,select,[contenteditable="true"]')));
    };
    context.reload = async ({ background = false } = {}) => {
      try {
        const [purchaseOrders, openLines, detailResult] = await Promise.all([
          jsonRequest(fetchFn, ENDPOINT),
          jsonRequest(fetchFn, `${ENDPOINT}/open-lines`),
          context.poId
            ? jsonRequest(fetchFn, `${ENDPOINT}/po/${encodeURIComponent(context.poId)}`).then((d) => ({ detail: d }), (e) => ({ error: e }))
            : Promise.resolve({}),
        ]);
        const state = { openLines, purchaseOrders, detail: detailResult.detail || null, detailError: detailResult.error ? describeError(detailResult.error) : null };
        if (background && workspaceBusy()) return state;
        renderPayload(rootNode, ui, doc, state, context);
        rootNode.removeAttribute?.('data-dashboard-stale');
        return state;
      } catch (error) {
        if (background) {
          if (error.status === 401 || error.status === 403) {
            // Refus serveur = droits retirés : effacer immédiatement la vue précédente.
            rootNode.replaceChildren();
            const notice = doc.createElement('p');
            notice.setAttribute('role', 'alert');
            notice.textContent = 'Accès expiré ou non autorisé. Rechargez votre session.';
            rootNode.appendChild(notice);
            rootNode.removeAttribute?.('data-dashboard-stale');
          } else rootNode.setAttribute?.('data-dashboard-stale','true');
          throw error;
        }
        rootNode.replaceChildren();
        const panel = doc.createElement('section');
        panel.className = 'kmc-workspace-header';
        panel.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'ACHATS FOURNISSEURS'));
        panel.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Achats fournisseurs indisponibles'));
        panel.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', describeError(error)));
        rootNode.appendChild(panel);
        throw error;
      }
    };

    context.openPo = (poId) => {
      context.poId = poId;
      writePoToLocation(loc, hist, poId);
    };
    context.closePo = () => {
      context.poId = null;
      writePoToLocation(loc, hist, null);
      return context.reload().catch(() => {});
    };

    /**
     * Exécute une action serveur : un seul appel à la fois par `lockKey`, verrou toujours relâché,
     * puis rechargement complet (l'écran ne recalcule rien, il relit).
     */
    context.act = async (button, lockKey, spec) => {
      context.busy.add(lockKey);
      const previous = button.textContent;
      button.disabled = true;
      setFeedback(rootNode, 'Action en cours…');
      try {
        const result = await jsonRequest(fetchFn, spec.url, { method: 'POST', body: spec.body || {} });
        if (spec.onSuccess) await spec.onSuccess(result);
        context.busy.delete(lockKey);
        await context.reload();
        const message = typeof spec.successMessage === 'function' ? spec.successMessage(result) : spec.successMessage;
        setFeedback(rootNode, message || 'Action appliquée.', 'positive');
        return result;
      } catch (error) {
        context.busy.delete(lockKey);
        button.disabled = false;
        button.textContent = previous;
        setFeedback(rootNode, describeError(error), 'critical');
        return null;
      }
    };

    globalThis.KomerceDashboardFreshness?.watch?.({
      root:rootNode, pollMs:60000, streamEnabled:options.user?.role === 'admin',
      isBusy:workspaceBusy,
      refresh:() => context.reload({ background:true }),
    });
    return context.reload();
  }

  return Object.freeze({ ENDPOINT, STATUS_LABELS, describeError, mount });
});
