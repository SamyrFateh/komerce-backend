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
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, grouping_key_supplier_and_hub_never_market, market_is_a_line_property, browser_never_supplies_market_id_authority, browser_no_business_recompute
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
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · ACHATS FOURNISSEURS'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Acheter auprès des fournisseurs'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Lignes à acheter regroupées par fournisseur et Hub d’approvisionnement · le marché reste une propriété de chaque ligne'));
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
    return `${group.supplier_id}|${group.procurement_hub_ref}`;
  }

  function renderGroup(doc, slot, group, context) {
    const key = groupKey(group);
    const card = doc.createElement('article');
    card.className = 'kmc-purchasing-group';
    card.setAttribute('data-purchasing-group', key);

    const head = doc.createElement('header');
    head.className = 'kmc-purchasing-group-head';
    head.appendChild(text(doc, 'h3', 'kmc-purchasing-group-title', group.supplier_name));
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
      'Lignes à acheter',
      'Regroupement par fournisseur et Hub. Cochez les lignes d’un même groupe puis préparez une commande ; un brouillon reste modifiable avant soumission.'
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

    const intro = text(doc, 'p', 'kmc-workspace-subtitle', 'Saisissez la quantité réellement confirmée par le fournisseur pour chaque ligne. L’écart devient un reliquat ouvert, jamais perdu.');
    form.appendChild(intro);

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-purchasing-confirm-table';
    table.innerHTML = '<thead><tr><th>Commande</th><th>Marché</th><th>Réf. fournisseur</th><th>Demandée</th><th>Confirmée</th><th>Prix confirmé</th></tr></thead>';
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
      tr.appendChild(priceCell);
      tbody.appendChild(tr);
      inputs.push({ line, qty, price });
    });
    table.appendChild(tbody);
    form.appendChild(wrapTable(doc, table));

    const ref = doc.createElement('input');
    ref.type = 'text';
    ref.placeholder = 'Référence de commande fournisseur';
    ref.setAttribute('aria-label', 'Référence de commande fournisseur');
    ref.setAttribute('data-supplier-order-id', '');
    form.appendChild(ref);

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
      for (const { line, qty, price } of inputs) {
        const confirmed = Number(qty.value);
        if (!Number.isInteger(confirmed) || confirmed < 0 || confirmed > Number(line.quantity)) {
          setFeedback(context.root, `Quantité confirmée invalide pour ${line.order_reference || line.line_id} (0 à ${line.quantity}).`, 'critical');
          return;
        }
        const entry = { purchase_line_id: line.line_id, confirmed_quantity: confirmed };
        if (price.value.trim() !== '') entry.confirmed_unit_price = Number(price.value);
        payloadLines.push(entry);
      }
      context.busy.add('confirm');
      submit.disabled = true;
      context.act(submit, 'confirm', {
        url: `${ENDPOINT}/po/${encodeURIComponent(po.id)}/confirm`,
        body: {
          lines: payloadLines,
          ...(ref.value.trim() ? { supplier_order_id: ref.value.trim() } : {}),
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

  function renderSupplierExecution(doc, slot, execution) {
    const source = execution || {};
    const orders = source.orders || [];
    const orderLines = source.order_lines || [];
    const groups = source.groups || [];
    const groupMembers = source.group_members || [];
    const payments = source.payments || [];
    const proofs = source.proofs || [];
    const events = source.events || [];
    const total = orders.length + orderLines.length + groups.length + groupMembers.length + payments.length + proofs.length + events.length;

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
      `Commande ${shortId(po.id)}`,
      `Hub ${po.procurement_hub_ref || '—'} · ${STATUS_LABELS[po.status] || po.status}`
    );
    slot.setAttribute('data-purchasing-po', po.id);
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
    renderSupplierExecution(doc, slot, detail.supplier_execution);

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
    const close = makeButton(doc, 'Fermer le détail', 'close-po', true);
    close.addEventListener('click', () => context.closePo());
    bar.appendChild(close);
    slot.appendChild(bar);

    if (po.status === 'notified') renderConfirmForm(doc, slot, po, lines, context);
  }

  function renderPayload(rootNode, ui, doc, state, context) {
    rootNode.replaceChildren();
    rootNode.classList.add('kmc-purchasing-workspace');
    rootNode.appendChild(createHeader(doc));
    if (state.detail) renderPurchaseOrder(rootNode, ui, doc, state.detail, context);
    if (state.detailError) {
      const slot = createSection(rootNode, ui, 'Commande indisponible', state.detailError);
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', state.detailError));
    }
    renderOpenLines(rootNode, ui, doc, state.openLines, context);
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
      user: options.user || {},
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      selection: new Set(),
      busy: new Set(),
      poId: readPoFromLocation(loc),
      reload: null,
      act: null,
      openPo: null,
      closePo: null,
    };

    context.reload = async () => {
      try {
        const [openLines, detailResult] = await Promise.all([
          jsonRequest(fetchFn, `${ENDPOINT}/open-lines`),
          context.poId
            ? jsonRequest(fetchFn, `${ENDPOINT}/po/${encodeURIComponent(context.poId)}`).then((d) => ({ detail: d }), (e) => ({ error: e }))
            : Promise.resolve({}),
        ]);
        const state = { openLines, detail: detailResult.detail || null, detailError: detailResult.error ? describeError(detailResult.error) : null };
        renderPayload(rootNode, ui, doc, state, context);
        return state;
      } catch (error) {
        rootNode.replaceChildren();
        const panel = doc.createElement('section');
        panel.className = 'kmc-workspace-header';
        panel.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · ACHATS FOURNISSEURS'));
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
        if (spec.onSuccess) spec.onSuccess(result);
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

    return context.reload();
  }

  return Object.freeze({ ENDPOINT, STATUS_LABELS, describeError, mount });
});
