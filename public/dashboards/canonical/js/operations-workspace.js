/**
 * @komerce-arch
 * @role          canonical-operations-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        server_resolved_admin_context, explicit_market_code, operations_work_queue
 * @outputs       canonical_operations_workspace_dom, authorized_action_requests
 * @depends       canonical primitives, admin-context
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, browser_never_supplies_market_id_authority
 * @impact-areas  admin-dashboard, logistics, inventory, orders, payments
 * @version       2026-08
 */

'use strict';

(function initOperationsWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalOperationsWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createOperationsWorkspace() {
  const ENDPOINT_PREFIX = '/api/admin/workspaces/operations/market/';
  const MARKET_CODE = /^[A-Z]{2}$/;

  function endpointFor(marketCode, suffix = '') {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_operations_workspace_market_required');
    const tail = suffix ? '/' + String(suffix).replace(/^\/+/, '') : '';
    return ENDPOINT_PREFIX + encodeURIComponent(code) + tail;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return `${formatNumber(value)} KMF`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function orderLink(doc, reference) {
    const link = text(doc, 'a', 'kmc-workspace-ref', reference || '—');
    if (reference) link.setAttribute('href', '/admin/orders/' + encodeURIComponent(reference));
    return link;
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
      throw error;
    }
    return body;
  }

  function createHeader(doc, payload) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';

    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · OPERATIONS / HUB-RELAIS'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Traiter le flux opérationnel'));
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} · ${payload.scope.name} · actions limitées à ce marché`
    ));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const operations = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Opérations');
    operations.setAttribute('href', '/admin/operations');
    nav.appendChild(operations);
    header.appendChild(nav);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.setAttribute('data-workspace-feedback', '');
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    return header;
  }

  function metricItems(summary = {}) {
    return [
      { key: 'hub-order', label: 'Hub · Commander', value: formatNumber(summary.hub_to_order), tone: summary.hub_to_order ? 'warning' : 'neutral' },
      { key: 'distribution', label: 'À répartir', value: formatNumber(summary.hub_unassigned), tone: summary.hub_unassigned ? 'warning' : 'neutral' },
      { key: 'ship', label: 'Hub · Expédier', value: formatNumber(summary.hub_to_ship), tone: summary.hub_to_ship ? 'warning' : 'neutral' },
      { key: 'cash', label: 'Relais · Encaisser', value: formatNumber(summary.relay_cash_pending), tone: summary.relay_cash_pending ? 'warning' : 'neutral' },
      { key: 'receive', label: 'Relais · Réceptionner', value: formatNumber(summary.relay_to_receive), tone: summary.relay_to_receive ? 'warning' : 'neutral' },
      { key: 'collect', label: 'Relais · Remettre', value: formatNumber(summary.relay_to_collect), tone: summary.relay_to_collect ? 'warning' : 'neutral' },
      { key: 'inventory', label: 'Inventaire · Affecter', value: formatNumber(summary.inventory_to_assign), tone: summary.inventory_to_assign ? 'warning' : 'neutral' },
    ];
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function makeActionButton(doc, label, action) {
    const button = text(doc, 'button', 'kmc-workspace-action', label);
    button.type = 'button';
    button.setAttribute('data-workspace-action', action);
    return button;
  }

  function appendCell(doc, rowNode, content, className = '') {
    const cell = doc.createElement('td');
    if (className) cell.className = className;
    if (content && typeof content === 'object' && typeof content.nodeType === 'number') {
      cell.appendChild(content);
    } else {
      cell.textContent = content == null || content === '' ? '—' : String(content);
    }
    rowNode.appendChild(cell);
  }

  function renderActionTable(container, options) {
    container.replaceChildren();
    const doc = container.ownerDocument;
    const rows = Array.isArray(options.rows) ? options.rows : [];
    if (!rows.length) {
      const empty = text(doc, 'div', 'kmc-workspace-empty', options.emptyText || 'Rien à traiter');
      container.appendChild(empty);
      return empty;
    }

    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    const thead = doc.createElement('thead');
    const head = doc.createElement('tr');
    options.columns.forEach(column => {
      const th = text(doc, 'th', '', column.label);
      th.setAttribute('scope', 'col');
      head.appendChild(th);
    });
    thead.appendChild(head);
    table.appendChild(thead);

    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      options.columns.forEach(column => {
        const value = typeof column.render === 'function' ? column.render(row, doc) : row[column.key];
        appendCell(doc, tr, value, column.className || '');
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    return table;
  }

  function createSection(rootNode, ui, title, description) {
    const section = ui.Section.create({ title, description });
    rootNode.appendChild(section.element);
    return section.slot;
  }

  function actionColumns(config) {
    return [
      { label: 'Référence', render: (row, doc) => config.referenceKind === 'parcel'
        ? text(doc, 'strong', 'kmc-workspace-ref-text', row.reference)
        : orderLink(doc, row.reference) },
      { label: 'Client', render: row => row.client_name || row.recipient_name || '—' },
      { label: 'Relais / destination', render: row => row.relais_name || row.relais_island || row.destination_island || '—' },
      { label: 'Montant', render: row => formatKmf(row.total_kmf) },
      { label: 'Depuis', render: row => formatDate(row.updated_at || row.shipped_at || row.created_at) },
      { label: '', className: 'is-action', render: () => '' },
    ];
  }

  async function runAction(context, button, options) {
    const confirmFn = context.confirm || (() => true);
    if (options.confirmMessage && !confirmFn(options.confirmMessage)) return null;
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, options.runningMessage || 'Action en cours…', 'neutral');
    try {
      const result = await jsonRequest(context.fetch, options.url, {
        method: 'POST',
        body: options.body,
      });
      setFeedback(context.root, options.successMessage || 'Action appliquée.', 'positive');
      await context.reload();
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      throw error;
    }
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));

    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload.summary) });

    renderOrderActionSection(rootNode, ui, doc, context, {
      title: 'Hub · Commander',
      description: 'Commandes confirmées à envoyer au sourcing. La transition reste exécutée par la state machine commande.',
      rows: payload.queues.hub.to_order,
      action: 'mark-ordered',
      actionLabel: 'Commander',
      suffix: row => `orders/${encodeURIComponent(row.reference)}/mark-ordered`,
      confirm: row => `Envoyer ${row.reference} au sourcing ?`,
      empty: 'Aucune commande à envoyer au sourcing.',
    });

    const distribution = createSection(
      rootNode,
      ui,
      'Hub · Répartition',
      'Répartit uniquement les commandes non assignées de ce marché dans les colis autorisés.'
    );
    const distributionBar = doc.createElement('div');
    distributionBar.className = 'kmc-workspace-section-actions';
    const distributeButton = makeActionButton(doc, 'Répartir ce marché', 'run-distribution');
    distributionBar.appendChild(distributeButton);
    distribution.appendChild(distributionBar);
    distributeButton.addEventListener('click', () => runAction(context, distributeButton, {
      url: endpointFor(context.marketCode, 'distribution/run'),
      confirmMessage: `Lancer la répartition automatique pour ${context.marketCode} ?`,
      runningMessage: 'Répartition en cours…',
      successMessage: 'Répartition terminée.',
    }).catch(() => {}));
    const distributionTable = doc.createElement('div');
    distribution.appendChild(distributionTable);
    ui.DataTable.render(distributionTable, {
      columns: [
        { key: 'reference', label: 'Commande' },
        { key: 'client_name', label: 'Client' },
        { key: 'relais_name', label: 'Relais' },
        { key: 'item_count', label: 'Articles', align: 'right' },
        { key: 'total_kmf', label: 'Montant', align: 'right', format: formatKmf },
      ],
      rows: payload.distribution.unassigned,
      emptyText: 'Aucune commande à répartir.',
    });

    renderParcelActionSection(rootNode, ui, doc, context, {
      title: 'Hub · Expédier',
      description: 'Colis en préparation prêts pour le scan d’expédition.',
      rows: payload.queues.hub.to_ship,
      action: 'ship',
      actionLabel: 'Expédier',
      suffix: row => `parcels/${encodeURIComponent(row.reference)}/ship`,
      confirm: row => `Confirmer l’expédition de ${row.reference} ?`,
      empty: 'Aucun colis à expédier.',
    });

    renderOrderActionSection(rootNode, ui, doc, context, {
      title: 'Relais · Encaisser',
      description: 'Paiements cash en attente dans ce marché. La confirmation appelle l’autorité paiement + auto-colis existante.',
      rows: payload.queues.relay.cash_pending,
      action: 'confirm-cash',
      actionLabel: 'Encaisser',
      suffix: row => `orders/${encodeURIComponent(row.reference)}/confirm-cash`,
      confirm: row => `Confirmer l’encaissement cash de ${row.reference} ?`,
      empty: 'Aucun paiement cash à encaisser.',
    });

    renderParcelActionSection(rootNode, ui, doc, context, {
      title: 'Relais · Réceptionner',
      description: 'Scanne l’arrivée du colis ; le moteur logistique journalise et rattrape les étapes manquantes si nécessaire.',
      rows: payload.queues.relay.to_receive,
      action: 'receive',
      actionLabel: 'Réceptionner',
      suffix: row => `parcels/${encodeURIComponent(row.reference)}/receive`,
      confirm: row => `Confirmer la réception de ${row.reference} ?`,
      empty: 'Aucun colis à réceptionner.',
    });

    renderParcelActionSection(rootNode, ui, doc, context, {
      title: 'Relais · Distribuer',
      description: 'Remise client par scan append-only du moteur logistique.',
      rows: payload.queues.relay.to_collect,
      action: 'collect',
      actionLabel: 'Remis au client',
      suffix: row => `parcels/${encodeURIComponent(row.reference)}/collect`,
      confirm: row => `Confirmer la remise de ${row.reference} au client ?`,
      empty: 'Aucun colis à remettre.',
    });

    renderInventorySection(rootNode, ui, doc, payload, context);
  }

  function renderOrderActionSection(rootNode, ui, doc, context, config) {
    const slot = createSection(rootNode, ui, config.title, config.description);
    renderActionRows(slot, doc, context, config, 'order');
  }

  function renderParcelActionSection(rootNode, ui, doc, context, config) {
    const slot = createSection(rootNode, ui, config.title, config.description);
    renderActionRows(slot, doc, context, config, 'parcel');
  }

  function renderActionRows(slot, doc, context, config, kind) {
    renderActionTable(slot, {
      rows: config.rows,
      emptyText: config.empty,
      columns: actionColumns({ referenceKind: kind }),
    });
    slot.querySelectorAll('tbody tr').forEach((rowNode, index) => {
      const row = config.rows[index];
      const actionCell = rowNode.lastChild;
      actionCell.replaceChildren();
      const button = makeActionButton(doc, config.actionLabel, config.action);
      actionCell.appendChild(button);
      button.addEventListener('click', () => runAction(context, button, {
        url: endpointFor(context.marketCode, config.suffix(row)),
        confirmMessage: config.confirm(row),
        runningMessage: `${row.reference} · action en cours…`,
        successMessage: `${row.reference} · action appliquée.`,
      }).catch(() => {}));
    });
  }

  function renderInventorySection(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Inventaire Hub · Affecter',
      'La proposition est un guide. L’agent peut affecter un article à un colis ouvert du même marché ; le serveur revalide les deux ressources.'
    );
    const items = payload.inventory.items || [];
    const parcels = payload.inventory.open_parcels || [];
    if (!items.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun article inventaire à affecter.'));
      return;
    }

    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-inventory-list';
    items.forEach(item => {
      const row = doc.createElement('article');
      row.className = 'kmc-workspace-inventory-row';

      const copy = doc.createElement('div');
      copy.className = 'kmc-workspace-inventory-copy';
      copy.appendChild(orderLink(doc, item.order_ref));
      copy.appendChild(text(doc, 'strong', '', item.product_name || 'Article'));
      copy.appendChild(text(
        doc,
        'span',
        'kmc-workspace-muted',
        `${item.status} · ${item.destination_island || '—'} · reçu ${formatDate(item.received_at)}`
      ));
      if (item.proposed_parcel_ref) {
        copy.appendChild(text(doc, 'span', 'kmc-workspace-proposal', `Proposition : ${item.proposed_parcel_ref}`));
      }
      row.appendChild(copy);

      const controls = doc.createElement('div');
      controls.className = 'kmc-workspace-inventory-controls';
      const select = doc.createElement('select');
      select.className = 'kmc-workspace-select';
      select.setAttribute('aria-label', `Colis cible pour ${item.product_name || item.order_ref}`);
      parcels.forEach(parcel => {
        const option = doc.createElement('option');
        option.value = parcel.reference;
        option.textContent = `${parcel.reference} · ${parcel.destination_island || '—'} · ${parcel.item_count || 0} art.`;
        if (item.proposed_parcel_ref === parcel.reference) option.selected = true;
        select.appendChild(option);
      });
      controls.appendChild(select);

      const button = makeActionButton(doc, 'Affecter', 'assign-inventory');
      button.disabled = parcels.length === 0;
      controls.appendChild(button);
      button.addEventListener('click', () => runAction(context, button, {
        url: endpointFor(context.marketCode, `inventory/items/${encodeURIComponent(item.item_id)}/assign`),
        body: { parcel_ref: select.value },
        confirmMessage: `Affecter cet article à ${select.value} ?`,
        runningMessage: 'Affectation inventaire en cours…',
        successMessage: `Article affecté à ${select.value}.`,
      }).catch(() => {}));

      row.appendChild(controls);
      wrap.appendChild(row);
    });
    slot.appendChild(wrap);
  }

  async function mount(options) {
    const rootNode = options.root;
    const ui = options.ui;
    const doc = options.document;
    const fetchFn = options.fetch;
    const marketCode = String(options.requestedMarket || '').trim().toUpperCase();

    if (!rootNode) throw new Error('canonical_operations_workspace_root_missing');
    if (!ui || !ui.UIState || !ui.Section || !ui.MetricStrip || !ui.DataTable) {
      throw new Error('canonical_operations_workspace_primitives_missing');
    }
    if (!MARKET_CODE.test(marketCode)) throw new Error('canonical_operations_workspace_market_required');

    let currentPayload = null;
    const context = {
      root: rootNode,
      fetch: fetchFn,
      marketCode,
      confirm: typeof options.confirm === 'function'
        ? options.confirm
        : (typeof globalThis.confirm === 'function' ? globalThis.confirm.bind(globalThis) : () => true),
      reload: null,
    };

    async function reload() {
      const payload = await jsonRequest(fetchFn, endpointFor(marketCode));
      currentPayload = payload;
      renderPayload(rootNode, ui, doc, payload, context);
      return payload;
    }
    context.reload = reload;

    ui.UIState.render(rootNode, 'loading', `Chargement du Workspace Opérations · ${marketCode}…`);
    try {
      await reload();
      return Object.freeze({
        marketCode,
        endpoint: endpointFor(marketCode),
        payload: currentPayload,
        reload,
      });
    } catch (error) {
      ui.UIState.render(rootNode, 'error', error.message);
      throw error;
    }
  }

  return Object.freeze({
    ENDPOINT_PREFIX,
    endpointFor,
    formatNumber,
    formatKmf,
    formatDate,
    metricItems,
    jsonRequest,
    renderPayload,
    mount,
  });
});
