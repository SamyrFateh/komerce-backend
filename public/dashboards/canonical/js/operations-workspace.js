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

  function createHeader(doc, payload, mode) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');

    const copy = doc.createElement('div');
    const relayExec = mode === 'relay-execution';
    const execution = mode === 'execution' || relayExec;
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', relayExec ? 'RELAIS LIVE · EXÉCUTION' : execution ? 'HUB LIVE · EXÉCUTION' : 'HUB & RELAIS'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', relayExec ? 'Exécuter les opérations Relais' : execution ? 'Hub live · Dossiers' : 'Flux à traiter'));
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} · ${payload.scope.name} · ${relayExec ? 'encaisser, réceptionner, remettre au client' : execution ? 'suivre les PO, réceptionner, affecter et préparer les expéditions' : 'voir ce qui attend une action'}`
    ));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const operations = text(doc, 'a', 'kmc-workspace-nav-link', relayExec ? '← Relais live' : '← Dashboard Opérations');
    operations.setAttribute('href', relayExec ? '/admin/relais-live' : '/admin/operations');
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

  /**
   * Couche de pilotage additive — au-dessus des files d'exécution
   * existantes (metricItems + renderOrderActionSection), jamais à leur
   * place. Consomme payload.signals (services/operations-workspace.js#
   * querySignals), jamais de recalcul métier côté navigateur
   * (doctrine dashboard_no_business_recompute).
   *
   * Volontairement absent : aucun signal "stock sous seuil d'alerte" par
   * hub/relais — cette notion n'existe dans aucune table du schéma
   * aujourd'hui (vérifié). L'inventer aurait affiché un chiffre qui a
   * l'air réel sans l'être.
   */
  function signalItems(signals = {}) {
    return [
      { key: 'collectes-retard', label: 'Collectes en retard', value: formatNumber(signals.collectes_en_retard), tone: signals.collectes_en_retard ? 'critical' : 'neutral' },
      { key: 'cash-securiser', label: 'Cash à sécuriser', value: formatKmf(signals.cash_a_securiser && signals.cash_a_securiser.total_kmf), tone: (signals.cash_a_securiser && signals.cash_a_securiser.count) ? 'warning' : 'neutral' },
      { key: 'incidents', label: 'Incidents ouverts', value: formatNumber(signals.incidents_ouverts), tone: signals.incidents_ouverts ? 'critical' : 'neutral' },
      { key: 'relais-actifs', label: 'Relais actifs', value: formatNumber(signals.relais_actifs), tone: 'neutral' },
    ];
  }

  const INCIDENT_TYPE_LABEL = Object.freeze({
    retard: 'Retard',
    blocage: 'Blocage',
    paiement: 'Paiement',
    stock: 'Stock',
    colis_endommage: 'Colis endommagé',
    colis_perdu: 'Colis perdu',
    client_absent: 'Client absent',
    autre: 'Autre',
  });

  const INCIDENT_PRIORITY_LABEL = Object.freeze({
    urgent: 'Urgent',
    high: 'Élevée',
    normal: 'Normale',
    low: 'Faible',
  });

  function renderSignals(rootNode, ui, doc, payload) {
    const signals = payload.signals || {};
    const slot = ui.Section.create({
      id: 'operations-signals',
      title: 'Signaux réseau',
      description: 'Ce que le serveur observe déjà sur ce marché — sans score ni priorité inventés côté navigateur.',
    });
    rootNode.appendChild(slot.element);

    const strip = doc.createElement('div');
    strip.className = 'kmc-metric-strip';
    strip.setAttribute('data-metric-strip', '');
    signalItems(signals).forEach(item => {
      const card = doc.createElement('article');
      card.className = `kmc-metric-card is-${item.tone || 'neutral'}`;
      if (item.key) card.setAttribute('data-metric-key', item.key);
      card.appendChild(text(doc, 'span', 'kmc-metric-label', item.label));
      card.appendChild(text(doc, 'strong', 'kmc-metric-value', item.value != null ? item.value : '—'));
      strip.appendChild(card);
    });
    slot.slot.appendChild(strip);

    const incidentsHost = doc.createElement('div');
    incidentsHost.className = 'kmc-workspace-subsection';
    incidentsHost.appendChild(text(doc, 'h3', 'kmc-workspace-subsection-title', 'Incidents ouverts'));
    slot.slot.appendChild(incidentsHost);
    ui.DataTable.render(incidentsHost, {
      emptyText: 'Aucun incident ouvert sur ce marché.',
      columns: [
        { key: 'type', label: 'Type', format: value => INCIDENT_TYPE_LABEL[value] || value },
        { key: 'relais_name', label: 'Relais' },
        { key: 'priority', label: 'Priorité', format: value => INCIDENT_PRIORITY_LABEL[value] || value },
        { key: 'created_at', label: 'Depuis', format: value => formatDate(value) },
      ],
      rows: signals.incidents || [],
    });

    const relaisHost = doc.createElement('div');
    relaisHost.className = 'kmc-workspace-subsection';
    relaisHost.appendChild(text(doc, 'h3', 'kmc-workspace-subsection-title', 'Relais à suivre'));
    slot.slot.appendChild(relaisHost);
    ui.DataTable.render(relaisHost, {
      emptyText: 'Aucun relais actif sur ce marché.',
      columns: [
        { key: 'name', label: 'Relais' },
        { key: 'island', label: 'Île / zone' },
        { key: 'disponibles', label: 'Colis disponibles', align: 'right' },
        { key: 'en_retard', label: 'Dont en retard (+72h)', align: 'right', format: value => (value ? String(value) : '—') },
        { key: 'cash_pending_kmf', label: 'Cash en attente', align: 'right', format: value => formatKmf(value) },
        { key: 'collectes_7j', label: 'Collectes (7j)', align: 'right' },
      ],
      rows: signals.par_relais || [],
    });
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
    let result;
    try {
      result = await jsonRequest(context.fetch, options.url, {
        method: 'POST',
        body: options.body,
      });
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      throw error;
    }
    if (typeof options.onSuccess === 'function') options.onSuccess(result);
    const message = typeof options.successMessage === 'function'
      ? options.successMessage(result)
      : (options.successMessage || 'Action appliquée.');
    const tone = typeof options.successTone === 'function' ? options.successTone(result) : 'positive';
    try {
      await context.reload();
      // La relecture reconstruit l'en-tête : le message est posé après, pour rester lisible.
      setFeedback(context.root, message, tone);
    } catch (error) {
      setFeedback(context.root, `${message} La relecture a échoué : ${error.message}`, 'critical');
    }
    return result;
  }

  const RECEIVABLE_ENDPOINT = '/api/scans/hub/receivable';
  const RECEIVE_ENDPOINT = '/api/scans/hub/receive';
  const RECEPTION_STATE_LABELS = Object.freeze({ NOT_RECEIVED: 'Non reçu', PARTIAL: 'Partiel', COMPLETE: 'Complet' });

  const WORKSPACE_VIEWS = Object.freeze([
    { id: 'hub', label: 'Hub' },
    { id: 'relay', label: 'Relais' },
    { id: 'inventory', label: 'Stock à affecter' },
  ]);

  // Hub live · Exécution : actions Hub uniquement (jamais Relais) + réception fournisseur.
  const EXECUTION_VIEWS = Object.freeze([
    { id: 'supply', label: 'Dossiers' },
    { id: 'reception', label: 'Réceptions' },
    { id: 'hub', label: 'Actions Hub' },
    { id: 'inventory', label: 'Stock à affecter' },
  ]);

  // Relais live · Exécution : actions Relais uniquement (encaisser, réceptionner, remettre) — jamais Hub.
  const RELAY_LIVE_TABS = Object.freeze([{ id: 'relay', label: 'Relais' }, { id: 'cash', label: 'Cash & dépôts' }]);

  const PO_STAGE_LABELS = Object.freeze({
    draft: 'Brouillon',
    issued_not_sent: 'Bon émis, envoi non prouvé',
    sent: 'Envoyée',
    confirmed: 'Confirmée',
    partially_received: 'Partiellement reçue',
    received: 'Reçue',
    cancelled: 'Annulée',
  });
  const SENT_CHANNEL_LABELS = Object.freeze({ email: 'e-mail', whatsapp: 'WhatsApp', phone: 'téléphone', api: 'API', other: 'autre' });

  function newReceptionReference() {
    const crypto = globalThis.crypto;
    const id = crypto && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `SUPPLIER_PACKAGE-${id}`;
  }

  // Référence stable par saisie : un renvoi (réseau, double clic) rejoue la même réception, jamais une seconde.
  function receptionReferenceFor(context, purchaseOrderId) {
    if (!context.receiveRefs) context.receiveRefs = new Map();
    if (!context.receiveRefs.has(purchaseOrderId)) context.receiveRefs.set(purchaseOrderId, newReceptionReference());
    return context.receiveRefs.get(purchaseOrderId);
  }

  function receptionMessage(result) {
    if (result && result.idempotent_replay) {
      return `Réception déjà traitée${result.unit && result.unit.reference ? ` (${result.unit.reference})` : ''} : aucune nouvelle mutation.`;
    }
    if (result && result.quarantined) {
      return `Colis mis en quarantaine (${result.reason_code || 'écart constaté'}) : un incident de réconciliation est ouvert, le stock n’est pas augmenté.`;
    }
    return 'Réception enregistrée.';
  }

  function createReceptionCard(doc, context, po) {
    const card = doc.createElement('article');
    card.className = 'kmc-workspace-receive-card';
    card.setAttribute('data-receive-po', po.purchase_order_id);

    const head = doc.createElement('header');
    head.className = 'kmc-workspace-receive-head';
    head.appendChild(text(doc, 'strong', '', (po.supplier && po.supplier.name) || 'Fournisseur non renseigné'));
    head.appendChild(text(doc, 'span', 'kmc-workspace-muted',
      `PO ${String(po.purchase_order_id).slice(0, 8)} · ${po.supplier_order_ref || 'sans référence fournisseur'} · statut fournisseur : ${po.po_status} (information, pas une réception)`));
    card.appendChild(head);

    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    ['Article', 'Attendu', 'Reçu', 'Restant', 'État', 'Reçu maintenant'].forEach(label => headRow.appendChild(text(doc, 'th', '', label)));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    const inputs = [];
    po.lines.forEach((line, index) => {
      const row = doc.createElement('tr');
      row.appendChild(text(doc, 'td', '', line.product_name));
      row.appendChild(text(doc, 'td', '', formatNumber(line.expected_quantity)));
      row.appendChild(text(doc, 'td', '', formatNumber(line.received_quantity)));
      row.appendChild(text(doc, 'td', '', formatNumber(line.remaining_quantity)));
      row.appendChild(text(doc, 'td', '', RECEPTION_STATE_LABELS[line.reception_state] || line.reception_state));
      const cell = doc.createElement('td');
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(line.remaining_quantity);
      input.step = '1';
      input.inputMode = 'numeric';
      input.className = 'kmc-workspace-receive-qty';
      input.setAttribute('data-receive-line', String(index));
      input.setAttribute('aria-label', `Quantité reçue maintenant pour ${line.product_name}`);
      cell.appendChild(input);
      row.appendChild(cell);
      tbody.appendChild(row);
      inputs.push({ input, line });
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);

    const footer = doc.createElement('div');
    footer.className = 'kmc-workspace-receive-footer';
    const tracking = doc.createElement('input');
    tracking.type = 'text';
    tracking.className = 'kmc-workspace-receive-tracking';
    tracking.maxLength = 120;
    tracking.placeholder = 'Suivi / référence du colis (facultatif)';
    tracking.setAttribute('aria-label', 'Suivi ou référence du colis reçu');
    footer.appendChild(tracking);
    const hint = text(doc, 'span', 'kmc-workspace-muted kmc-workspace-receive-hint', 'Saisissez la quantité réellement reçue. Aucune quantité n’est préremplie.');
    footer.appendChild(hint);
    const button = makeActionButton(doc, 'Enregistrer la réception', 'receive-supplier');
    button.disabled = true;
    footer.appendChild(button);
    card.appendChild(footer);

    function collect() {
      const contents = [];
      let invalid = false;
      inputs.forEach(({ input, line }) => {
        const raw = String(input.value || '').trim();
        if (raw === '') return;
        const quantity = Number(raw);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > line.remaining_quantity) { invalid = true; return; }
        if (quantity > 0) {
          contents.push({
            purchase_order_id: po.purchase_order_id,
            ...(line.product_sku_id ? { product_sku_id: line.product_sku_id } : {}),
            quantity,
          });
        }
      });
      return { contents, invalid };
    }

    function sync() {
      const { contents, invalid } = collect();
      button.disabled = invalid || contents.length === 0;
      hint.textContent = invalid
        ? 'Quantité invalide : entier entre 0 et le restant attendu.'
        : 'Saisissez la quantité réellement reçue. Aucune quantité n’est préremplie.';
    }
    inputs.forEach(({ input }) => input.addEventListener('input', sync));

    button.addEventListener('click', () => {
      const { contents, invalid } = collect();
      if (invalid || contents.length === 0) return;
      const total = contents.reduce((sum, item) => sum + item.quantity, 0);
      const trackingRef = String(tracking.value || '').trim();
      runAction(context, button, {
        url: RECEIVE_ENDPOINT,
        body: { reference: receptionReferenceFor(context, po.purchase_order_id), ...(trackingRef ? { tracking_ref: trackingRef } : {}), contents },
        confirmMessage: `Confirmer la réception physique de ${total} article(s) du PO ${String(po.purchase_order_id).slice(0, 8)} ?`,
        runningMessage: 'Réception en cours…',
        successMessage: receptionMessage,
        successTone: result => (result && result.quarantined ? 'critical' : 'positive'),
        onSuccess: () => { context.receiveRefs.delete(po.purchase_order_id); },
      }).catch(error => {
        if (error && error.code === 'HUB_RECEPTION_REFERENCE_CONFLICT') {
          context.receiveRefs.delete(po.purchase_order_id);
          setFeedback(context.root, 'Cette saisie existe déjà avec un contenu différent. Vérifiez les quantités restantes, puis recommencez.', 'critical');
        }
      });
    });
    return card;
  }

  function renderReceptionSection(rootNode, ui, doc, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Hub · Réception fournisseur',
      'Enregistrez ce qui est physiquement arrivé au Hub. Le statut fournisseur (par exemple SHIPPED) n’est jamais une réception ; les réceptions partielles sont acceptées.'
    );
    if (context.receivableError) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', `Réception indisponible : ${context.receivableError}`));
      return;
    }
    const orders = (context.receivable && context.receivable.purchase_orders) || [];
    if (!orders.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune Purchase Order en attente de réception.'));
      return;
    }
    orders.forEach(po => slot.appendChild(createReceptionCard(doc, context, po)));
  }

  // Hub live · Approvisionnement : projection serveur du dossier par marché (aucun calcul métier côté navigateur).
  // Les PO s'enregistrent dans Achats fournisseurs ; ici on suit la chaîne physique et on rattache les cartons.
  function simpleTable(doc, columns, rows, empty) {
    if (!rows.length) return text(doc, 'div', 'kmc-workspace-empty', empty);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    const headRow = doc.createElement('tr');
    columns.forEach(label => headRow.appendChild(text(doc, 'th', '', label)));
    const thead = doc.createElement('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    rows.forEach(cells => {
      const row = doc.createElement('tr');
      cells.forEach(cell => appendCell(doc, row, cell));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function createTraceButton(doc, context, label, query) {
    const button = makeActionButton(doc, label, 'show-trace');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        context.trace = await jsonRequest(context.fetch, `${endpointFor(context.marketCode, 'supply/trace')}?${query}`);
        const traceParams = new URLSearchParams(query);
        context.openPOId = traceParams.get('po_id') || null;
        context.traceOrderId = traceParams.get('order_id') || null;
        if (context.traceOrderId) context.openOrderId = context.traceOrderId;
        context.traceError = null;
      } catch (error) {
        context.trace = null;
        context.traceError = error.message;
      }
      context.renderCurrent();
    });
    return button;
  }

  function renderTracePanel(rootNode, ui, doc, context) {
    if (!context.trace && !context.traceError) return;
    const slot = createSection(rootNode, ui, 'Filiation', 'Commande → ligne d’achat → PO → colis reçu → carton → expédition. Lecture seule.');
    slot.setAttribute('data-supply-trace', '');
    if (context.traceError) { slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', context.traceError)); return; }
    const rows = [];
    context.trace.chain.forEach(link => {
      const po = link.purchase_order;
      if (!link.placements.length) {
        rows.push([link.order_ref, link.product, formatNumber(link.ordered), po ? (PO_STAGE_LABELS[po.status] || po.status) : 'Sans PO', '—', '—', '—']);
      }
      link.placements.forEach(placement => rows.push([
        link.order_ref, link.product, formatNumber(link.ordered), po ? (PO_STAGE_LABELS[po.status] || po.status) : 'Sans PO',
        `${placement.unit.reference} (${placement.unit.type === 'MARKET_PARCEL' ? 'carton' : 'colis'}) ×${formatNumber(placement.quantity)}${placement.active ? '' : ' · déplacé'}`,
        placement.unit.state,
        placement.shipment ? placement.shipment.reference : '—',
      ]));
    });
    slot.appendChild(simpleTable(doc, ['Commande', 'Produit', 'Commandé', 'PO', 'Unité physique', 'État', 'Expédition'], rows, 'Aucune filiation trouvée.'));
  }

  // Dossier vivant : la projection serveur reste la seule source de vérité.
  // Les accordéons ne changent aucun état; chaque action existante garde son service propriétaire.
  function renderSupplySection(rootNode, ui, doc, context) {
    const kpiSlot = createSection(rootNode, ui, 'Dossiers · Vue du jour',
      'Dossier par commande : articles, achats fournisseur, réceptions, colis client, cartons et expédition.');
    kpiSlot.setAttribute('data-hub-dossier-home', '');
    if (context.dossierError) {
      kpiSlot.appendChild(text(doc, 'div', 'kmc-workspace-empty', `Dossier indisponible : ${context.dossierError}`));
      return;
    }
    const d = context.dossier;
    if (!d) {
      kpiSlot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Dossier non chargé.'));
      return;
    }
    const k = d.kpis || {};
    const strip = doc.createElement('div');
    strip.className = 'kmc-hub-dossier-metrics';
    kpiSlot.appendChild(strip);
    const metric = (key, label, value, warn) => ({
      key, label, value: formatNumber(value), tone: warn && Number(value) > 0 ? 'warning' : 'neutral',
    });
    ui.MetricStrip.render(strip, { items: [
      metric('hub-needs', 'Commandes à approvisionner', k.orders_waiting, false),
      metric('hub-po-unsent', 'PO à envoyer', k.po_issued_not_sent, false),
      metric('hub-remaining', 'Unités encore attendues', k.qty_missing, false),
      metric('hub-boxes', 'Cartons non expédiés', k.boxes_unshipped, false),
    ] });

    // Pas de seconde frise décorative au-dessus du dossier : le trajet réel
    // est une rangée de cinq colonnes directement dans chaque commande.


    // Work : la COMMANDE est le dossier maître, pas la PO.
    // Les jointures suivantes ne produisent aucun nouveau statut ou mouvement :
    // elles rassemblent uniquement les références de la projection serveur.
    const dossiers = new Map();
    const byOrder = (id, reference) => {
      const key = String(id || reference || '');
      if (!key) return null;
      if (!dossiers.has(key)) dossiers.set(key, {
        id: id || null, reference: reference || key, status: null, items: [],
        needs: [], lines: [], pos: new Map(), clientParcels: [], boxes: [],
      });
      return dossiers.get(key);
    };
    (d.orders || []).forEach(order => {
      const group = byOrder(order.id, order.reference);
      if (!group) return;
      group.status = order.status || null;
      group.items = Array.isArray(order.items) ? order.items : [];
    });
    (d.needs || []).forEach(need => {
      const group = byOrder(need.order_id, need.order_ref);
      if (group) group.needs.push(need);
    });
    (d.purchase_orders || []).forEach(po => {
      (po.lines || []).forEach(line => {
        const group = byOrder(line.order_id, line.order_ref);
        if (!group) return;
        group.lines.push({ ...line, po });
        group.pos.set(String(po.id), po);
      });
    });
    // Un colis local n'ouvre JAMAIS de dossier Hub à lui seul. Les seules
    // racines admises proviennent des lignes IMPORT/achats déjà projetées.
    const existingOrder = (id, reference) => dossiers.get(String(id || ''))
      || [...dossiers.values()].find(g => reference && g.reference === reference) || null;
    (d.client_parcels || []).forEach(parcel => {
      const group = existingOrder(parcel.order_id, null);
      if (group) group.clientParcels.push(parcel);
    });
    (d.boxes || []).forEach(box => {
      const seen = new Set();
      (box.contents || []).forEach(content => {
        const group = existingOrder(content.order_id, content.order_ref);
        if (group && !seen.has(group)) {
          group.boxes.push(box);
          seen.add(group);
        }
      });
    });

    const ordersSlot = createSection(rootNode, ui, 'Dossiers · De la commande au départ',
      'Une ligne de lecture de gauche à droite par commande. Chaque PO et reliquat reste attaché à son article.');
    ordersSlot.setAttribute('data-supply-pos', '');
    ordersSlot.setAttribute('data-hub-work-orders', '');
    const topBar = doc.createElement('div');
    topBar.className = 'kmc-hub-dossier-toolbar';
    topBar.appendChild(text(doc, 'span', 'kmc-workspace-muted', String(dossiers.size) + ' commande(s) avec des opérations import à suivre'));
    const purchasing = text(doc, 'a', 'kmc-hub-dossier-link', 'Préparer les achats fournisseurs');
    purchasing.href = '/admin/workspaces/purchasing?market=' + encodeURIComponent(context.marketCode);
    topBar.appendChild(purchasing);
    ordersSlot.appendChild(topBar);

    const stage = (parent, number, label) => {
      const section = doc.createElement('section');
      section.className = 'kmc-hub-work-stage';
      const head = doc.createElement('h3');
      head.className = 'kmc-hub-work-stage-heading';
      head.appendChild(text(doc, 'span', 'kmc-hub-dossier-number', number));
      head.appendChild(text(doc, 'span', '', label));
      section.appendChild(head);
      parent.appendChild(section);
      return section;
    };
    const orderGroups = [...dossiers.values()];
    if (!orderGroups.length) ordersSlot.appendChild(text(doc, 'div', 'kmc-workspace-empty',
      'Aucune commande d’import à traiter pour ce marché.'));
    orderGroups.forEach((group, index) => {
      const card = doc.createElement('details');
      card.className = 'kmc-hub-work-order';
      card.setAttribute('data-hub-order', String(group.id || group.reference));
      card.open = context.openOrderId
        ? context.openOrderId === (group.id || group.reference)
        : index === 0;
      card.addEventListener('toggle', () => {
        if (card.open) context.openOrderId = group.id || group.reference;
      });
      const summary = doc.createElement('summary');
      summary.className = 'kmc-hub-work-order-summary';
      const heading = doc.createElement('span');
      heading.className = 'kmc-hub-work-order-title';
      heading.appendChild(text(doc, 'strong', '', group.reference));
      heading.appendChild(text(doc, 'span', 'kmc-workspace-muted',
        String(group.items.length || new Set(group.lines.map(l => l.order_item_id || l.product)).size) +
        ' article(s) · ' + String(group.pos.size) + ' PO fournisseur(s)'));
      summary.appendChild(heading);
      summary.appendChild(text(doc, 'span', 'kmc-hub-dossier-stage', group.status || 'Commande à suivre'));
      const waiting = group.lines.reduce((sum, line) => sum + Math.max(0, Number(line.missing) || 0), 0);
      const anomalies = group.lines.reduce((sum, line) => sum + Math.max(0, Number(line.anomaly) || 0), 0);
      summary.appendChild(text(doc, 'span', waiting || anomalies ? 'kmc-hub-work-count is-attention' : 'kmc-hub-work-count',
        waiting ? formatNumber(waiting) + ' attendu(s) fournisseur' :
          anomalies ? formatNumber(anomalies) + ' à contrôler' : 'Voir le parcours'));
      card.appendChild(summary);
      const body = doc.createElement('div');
      body.className = 'kmc-hub-work-order-body';
      body.setAttribute('data-hub-order-flow', '');
      body.setAttribute('aria-label', 'Parcours commande · articles, PO, réception, colis client, cartons, expédition');
      card.appendChild(body);
      ordersSlot.appendChild(card);

      // Une ligne d'achat n'est jamais confondue avec une quantité commandée
      // par le client. En cas de multi-PO, garder toutes les lignes distinctes.
      const itemsSection = stage(body, 1, 'Commande · Articles');
      const items = new Map();
      const itemFor = (id, product) => {
        const key = String(id || product || '');
        if (!items.has(key)) items.set(key, { id, product: product || 'Article', ordered: null, lines: [], needs: [] });
        return items.get(key);
      };
      group.items.forEach(item => {
        const rec = itemFor(item.id, item.product);
        rec.product = item.product || rec.product;
        rec.ordered = item.ordered;
      });
      group.lines.forEach(line => itemFor(line.order_item_id, line.product).lines.push(line));
      group.needs.forEach(need => itemFor(need.order_item_id, need.product_name).needs.push(need));
      if (!items.size) itemsSection.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun article d’import projeté.'));
      items.forEach(item => {
        const unit = doc.createElement('div');
        unit.className = 'kmc-hub-work-item kmc-hub-work-compact-card';
        const itemHeader = doc.createElement('div');
        itemHeader.className = 'kmc-hub-work-item-head';
        itemHeader.appendChild(text(doc, 'strong', '', item.product));
        itemHeader.appendChild(text(doc, 'span', 'kmc-hub-work-qty',
          item.ordered == null ? 'Quantité non projetée' : '×' + formatNumber(item.ordered)));
        unit.appendChild(itemHeader);
        const linkedPos = new Set(item.lines.map(l => String(l.po.id)));
        const pending = item.needs.reduce((total, line) => total + (Number(line.quantity) || 0), 0);
        const infos = [String(linkedPos.size) + ' PO liée(s)'];
        if (pending) infos.push(formatNumber(pending) + ' encore à commander');
        unit.appendChild(text(doc, 'p', 'kmc-workspace-muted', infos.join(' · ')));
        itemsSection.appendChild(unit);
      });

      const posSection = stage(body, 2, 'PO fournisseurs');
      if (!group.pos.size) posSection.appendChild(text(doc, 'div', 'kmc-workspace-empty',
        'Aucune PO liée : constituer les besoins dans Achats fournisseurs.'));
      group.pos.forEach(po => {
        const poCard = doc.createElement('div');
        poCard.className = 'kmc-hub-work-po';
        poCard.setAttribute('data-hub-po', String(po.id));
        const row = doc.createElement('div');
        row.className = 'kmc-hub-work-po-head';
        const identity = doc.createElement('div');
        identity.appendChild(text(doc, 'strong', '', po.supplier_name || 'Fournisseur'));
        identity.appendChild(text(doc, 'span', 'kmc-workspace-muted', 'PO ' + String(po.id).slice(0, 8)));
        row.appendChild(identity);
        const poStage = text(doc, 'span', 'kmc-hub-dossier-stage',
          PO_STAGE_LABELS[po.stage] || po.stage);
        poStage.dataset.stage = String(po.stage || '');
        row.appendChild(poStage);
        const receipt = (po.lines || []).filter(l => l.order_id === group.id || l.order_ref === group.reference);
        row.appendChild(text(doc, 'span', 'kmc-hub-work-count',
          formatNumber(receipt.reduce((n, l) => n + Number(l.received || 0), 0)) + ' / ' +
          formatNumber(receipt.reduce((n, l) => n + Number(l.confirmed || 0), 0)) + ' reçus (cette commande)'));
        poCard.appendChild(row);
        poCard.appendChild(text(doc, 'p', 'kmc-workspace-muted',
          po.sent_at ? 'Envoi prouvé : ' +
            (SENT_CHANNEL_LABELS[po.sent_channel] || po.sent_channel || 'canal non renseigné') +
            ' · ' + formatDate(po.sent_at) : 'Envoi fournisseur non prouvé'));
        posSection.appendChild(poCard);
      });

      const reception = stage(body, 3, 'Réception · Contrôle');
      if (!group.lines.length) reception.appendChild(text(doc, 'div', 'kmc-workspace-empty',
        'Aucune réception fournisseur liée à cette commande.'));
      group.lines.forEach(line => {
        const itemCard = doc.createElement('div');
        itemCard.className = 'kmc-hub-work-receipt kmc-hub-work-compact-card';
        itemCard.appendChild(text(doc, 'strong', '', line.product || 'Article'));
        itemCard.appendChild(text(doc, 'span', 'kmc-workspace-muted',
          'PO ' + String(line.po.id).slice(0, 8) + ' · ' +
          formatNumber(line.received) + ' / ' + formatNumber(line.confirmed) + ' reçus'));
        if (Number(line.missing) > 0) itemCard.appendChild(text(doc, 'span', 'kmc-hub-work-line-warning',
          formatNumber(line.missing) + ' attendu(s)'));
        if (Number(line.anomaly) > 0) itemCard.appendChild(text(doc, 'span', 'kmc-hub-work-line-warning',
          formatNumber(line.anomaly) + ' en anomalie'));
        reception.appendChild(itemCard);
      });
      const physicalActions = doc.createElement('div');
      physicalActions.className = 'kmc-hub-dossier-toolbar';
      if (group.id) physicalActions.appendChild(createTraceButton(doc, context,
        'Voir les colis et mouvements prouvés', 'order_id=' + encodeURIComponent(group.id)));
      physicalActions.appendChild(text(doc, 'span', 'kmc-workspace-muted',
        'Le reçu provient du contrôle Hub ; la confirmation fournisseur ne vaut jamais réception.'));
      reception.appendChild(physicalActions);
      // Filiation détaillée : pleine largeur SOUS la ligne des six colonnes.
      // Ne jamais forcer son tableau à sept champs dans une colonne de 220 px.
      const parcels = stage(body, 4, 'Colis client');
      if (!group.clientParcels.length) parcels.appendChild(text(doc, 'div', 'kmc-workspace-empty',
        Array.isArray(d.client_parcels)
          ? 'Aucun colis client constitué : les articles reçus restent à réconcilier.'
          : 'Projection colis client indisponible.'));
      group.clientParcels.forEach(parcel => {
        const itemNames = new Map(group.items.map(item => [String(item.id), item.product || 'Article']));
        parcels.appendChild(text(doc, 'div', 'kmc-hub-work-parcel',
          parcel.reference + ' · ' + parcel.status + ' · ' +
          (parcel.contents || []).map(c => (itemNames.get(String(c.order_item_id)) || 'Article') +
            ' ×' + formatNumber(c.quantity) +
            (c.allocated == null ? '' : ' (affecté ' + formatNumber(c.allocated) + ' · emballé ' + formatNumber(c.packed) +
              ' · expédié ' + formatNumber(c.shipped) + ')')).join(', ')));
      });

      const transport = stage(body, 5, 'Cartons transport');
      if (!group.boxes.length) transport.appendChild(text(doc, 'div', 'kmc-workspace-empty',
        'Aucun carton KOM-BOX rattaché à cette commande.'));
      group.boxes.forEach(box => {
        const contents = (box.contents || []).filter(c => c.order_id === group.id || c.order_ref === group.reference);
        const boxText = box.reference + ' · ' + box.state + ' · ' +
          contents.map(c => formatNumber(c.qty) + ' unité(s)').join(', ');
        transport.appendChild(text(doc, 'div', 'kmc-hub-work-parcel', boxText));
      });
      // Le carton n'est PAS une expédition. N'afficher un départ que si le
      // rattachement physique carton → expédition est réellement prouvé.
      const shipments = stage(body, 6, 'Expédition');
      const proven = new Map();
      group.boxes.forEach(box => {
        if (box.shipment_ref && !proven.has(box.shipment_ref)) {
          proven.set(box.shipment_ref, box.shipment_stage || null);
        }
      });
      if (!proven.size) shipments.appendChild(text(doc, 'div', 'kmc-workspace-empty',
        'Aucune expédition liée à la commande.'));
      proven.forEach((shipmentStage, reference) => {
        shipments.appendChild(text(doc, 'div', 'kmc-hub-work-parcel',
          reference + (shipmentStage ? ' · ' + shipmentStage : ' · Étape non renseignée')));
      });
      if (context.traceOrderId === group.id && (context.trace || context.traceError)) {
        const details = doc.createElement('div');
        details.className = 'kmc-hub-work-trace-detail';
        details.setAttribute('data-hub-work-evidence', '');
        body.appendChild(details);
        renderTracePanel(details, ui, doc, context);
      }
      if (waiting || anomalies) {
        body.appendChild(text(doc, 'p', 'kmc-hub-dossier-reliquat',
          (waiting ? formatNumber(waiting) + ' unité(s) encore attendue(s) du fournisseur. ' : '') +
          (anomalies ? formatNumber(anomalies) + ' unité(s) à contrôler. ' : '') +
          'Le reliquat reste attaché à cette commande : aucun départ ou remboursement automatique.'));
      }
    });
    // Les anciens liens filiation par PO restent lisibles (sans dupliquer le
    // tableau du parcours si une commande est déjà ouverte).
    if (context.trace && !context.traceOrderId) renderTracePanel(rootNode, ui, doc, context);

    const points = d.to_handle || [];
    if (points.length) {
      const follow = doc.createElement('details');
      follow.className = 'kmc-hub-dossier-secondary';
      follow.setAttribute('data-supply-to-handle', '');
      const summary = doc.createElement('summary');
      summary.textContent = 'Suivi des écarts · ' + String(points.length);
      follow.appendChild(summary);
      follow.appendChild(simpleTable(doc, ['Fait constaté', 'Dossier'],
        points.map(item => [item.reason, item.supplier_name || item.kind]), 'Aucun écart.'));
      rootNode.appendChild(follow);
    }

    const receipts = doc.createElement('details');
    receipts.className = 'kmc-hub-dossier-secondary';
    receipts.setAttribute('data-supply-receipts', '');
    const receiptSummary = doc.createElement('summary');
    receiptSummary.textContent = 'Réceptions fournisseurs brutes · ' + String((d.receipts || []).length);
    receipts.appendChild(receiptSummary);
    receipts.appendChild(simpleTable(doc, ['Colis fournisseur', 'Référence externe', 'État', 'Quantité', 'Date'],
      (d.receipts || []).map(r => [r.reference, r.external_ref || '—', r.state, formatNumber(r.qty), formatDate(r.received_at)]),
      'Aucun colis reçu.'));
    rootNode.appendChild(receipts);

    const boxes = createSection(rootNode, ui, 'Cartons KOM-BOX', 'Ouvrez un dossier, même vide, puis composez-le progressivement. La remise au transitaire est un acte distinct avec preuve et cartons DISPATCHED.');
    boxes.setAttribute('data-supply-boxes', '');
    const open = Array.isArray(d.open_shipments) ? d.open_shipments : [];
    const free = box => !box.shipment_ref && ['PACKED','DISPATCHED'].includes(box.state);
    const checked = new Set();

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-receive-footer';
    bar.setAttribute('data-supply-shipment-bar', '');
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'Expédition ouverte');
    select.appendChild(Object.assign(doc.createElement('option'), { value: '', textContent: open.length ? 'Choisir une expédition ouverte…' : 'Aucune expédition ouverte' }));
    open.forEach(sh => select.appendChild(Object.assign(doc.createElement('option'), {
      value: sh.reference, textContent: `${sh.reference} · ${sh.forwarder_name || 'Transitaire à définir'} · ${sh.box_count} carton(s)`,
    })));
    bar.appendChild(select);
    const field = (placeholder, label) => {
      const input = doc.createElement('input');
      input.type = 'text'; input.maxLength = 120; input.placeholder = placeholder; input.className = 'kmc-workspace-receive-tracking';
      input.setAttribute('aria-label', label);
      return input;
    };
    const refInput = field('Référence du nouveau dossier', 'Référence de la nouvelle expédition');
    const createButton = makeActionButton(doc, 'Ouvrir le dossier', 'create-shipment-from-boxes');
    createButton.disabled = true;
    [refInput, createButton].forEach(node => bar.appendChild(node));
    boxes.appendChild(bar);

    const attachButtons = [];
    const syncBar = () => {
      createButton.disabled = !refInput.value.trim();
      attachButtons.forEach(({ button, box }) => { button.disabled = !select.value || !free(box); });
    };
    refInput.addEventListener('input', syncBar);
    select.addEventListener('change', syncBar);
    createButton.addEventListener('click', () => runAction(context, createButton, {
      url: endpointFor(context.marketCode, 'boxes/shipment'),
      body: {
        reference: refInput.value.trim(), hub_unit_ids: [...checked],
      },
      runningMessage: 'Ouverture du dossier…',
      successMessage: result => `Dossier ${result && result.result ? result.result.reference : ''} ouvert en préparation · ${checked.size} carton(s).`,
    }).catch(() => {}));

    boxes.appendChild(simpleTable(doc, ['', 'Carton', 'État', 'Contenu', 'Expédition', 'Action'],
      (d.boxes || []).map(box => {
        const contents = box.contents.map(c => `${c.order_ref} ×${formatNumber(c.qty)}`).join(', ');
        let pick = '';
        let action = '—';
        if (free(box)) {
          pick = doc.createElement('input');
          pick.type = 'checkbox';
          pick.setAttribute('aria-label', `Inclure ${box.reference}`);
          pick.addEventListener('change', () => { if (pick.checked) checked.add(box.unit_id); else checked.delete(box.unit_id); syncBar(); });
          action = makeActionButton(doc, 'Rattacher à l’expédition choisie', 'attach-box-shipment');
          action.disabled = true;
          attachButtons.push({ button: action, box });
          action.addEventListener('click', () => runAction(context, action, {
            url: endpointFor(context.marketCode, `boxes/${encodeURIComponent(box.unit_id)}/shipment`),
            body: { shipment_reference: select.value },
            runningMessage: 'Rattachement en cours…',
            successMessage: result => (result && result.already_attached ? 'Carton déjà rattaché à cette expédition.' : 'Carton rattaché à l’expédition.'),
          }).catch(() => {}));
        }
        if (box.shipment_ref && box.shipment_stage === 'hub_ready') {
          action = makeActionButton(doc, 'Retirer du dossier', 'detach-box-shipment');
          action.addEventListener('click', () => runAction(context, action, {
            url: endpointFor(context.marketCode, `boxes/${encodeURIComponent(box.unit_id)}/detach`),
            body: {},
            confirmMessage: `Retirer ${box.reference} de l’expédition ${box.shipment_ref} ?`,
            runningMessage: 'Détachement du carton…',
            successMessage: 'Carton retiré du dossier encore en préparation.',
          }).catch(() => {}));
        }
        return [pick, box.reference, box.state, contents || '—', box.shipment_ref || '—', action];
      }), 'Aucun carton.'));

  }

  function createViewTabs(doc, activeView, onSelect, views = WORKSPACE_VIEWS) {
    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('data-workspace-views', '');
    views.forEach(item => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = `kmc-workspace-tab${item.id === activeView ? ' is-active' : ''}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', item.id === activeView ? 'true' : 'false');
      button.setAttribute('data-workspace-view', item.id);
      button.textContent = item.label;
      button.addEventListener('click', () => onSelect(item.id));
      bar.appendChild(button);
    });
    return bar;
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.setAttribute('data-workspace-kind', 'hub-relay');
    rootNode.setAttribute('data-workspace-mode', context.mode);
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload, context.mode));

    // En Hub Live le dossier porte déjà les quatre indicateurs de sa projection
    // serveur. Ne pas répéter les métriques Relais ni repousser la file sous le pli.
    if (context.mode !== 'execution') {
      const metrics = doc.createElement('section');
      metrics.className = 'kmc-workspace-metrics';
      rootNode.appendChild(metrics);
      ui.MetricStrip.render(metrics, { items: metricItems(payload.summary) });
    }

    // UX-07 : une vue = une question. Un seul groupe de sections à la fois.
    // Mode « execution » (Hub live) : uniquement les actions Hub ; les actions Relais restent hors de cette surface.
    const views = context.mode === 'relay-execution' ? RELAY_LIVE_TABS
      : context.mode === 'execution' ? EXECUTION_VIEWS : WORKSPACE_VIEWS;
    const view = views.some(item => item.id === context.view) ? context.view : views[0].id;
    rootNode.appendChild(createViewTabs(doc, view, nextView => {
      context.view = nextView;
      renderPayload(rootNode, ui, doc, payload, context);
    }, views));

    if ((view === 'hub' || view === 'inventory') && isHubReadOnly(context)) renderExecuteLink(rootNode, doc, context);

    if (view === 'hub') {
    renderOrderActionSection(rootNode, ui, doc, context, {
      title: 'Hub · Commander',
      description: 'Commandes confirmées à envoyer au sourcing. La transition reste exécutée par la state machine commande.',
      rows: payload.queues.hub.to_order,
      hub: true,
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
    // L9a : « Répartir ce marché » n'est proposé que si le serveur fournit des commandes à répartir.
    if (!isHubReadOnly(context) && Array.isArray(payload.distribution && payload.distribution.unassigned) && payload.distribution.unassigned.length > 0) {
      distributionBar.appendChild(distributeButton);
      distribution.appendChild(distributionBar);
      distributeButton.addEventListener('click', () => runAction(context, distributeButton, {
        url: endpointFor(context.marketCode, 'distribution/run'),
        confirmMessage: `Lancer la répartition automatique pour ${context.marketCode} ?`,
        runningMessage: 'Répartition en cours…',
        successMessage: 'Répartition terminée.',
      }).catch(() => {}));
    }
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
      hub: true,
      action: 'ship',
      actionLabel: 'Expédier',
      suffix: row => `parcels/${encodeURIComponent(row.reference)}/ship`,
      confirm: row => `Confirmer l’expédition de ${row.reference} ?`,
      empty: 'Aucun colis à expédier.',
    });
    }

    if (view === 'reception') renderReceptionSection(rootNode, ui, doc, context);
    if (view === 'supply') renderSupplySection(rootNode, ui, doc, context);

    if (view === 'relay') {
    renderRelayShipmentsSection(rootNode, ui, doc, context);
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
    }

    if (view === 'inventory') renderInventorySection(rootNode, ui, doc, payload, context);

    // Cash & dépôts : module canonique de comptabilité (mêmes routes, mêmes contrôles) hébergé dans Relais live.
    if (view === 'cash') {
      const host = doc.createElement('div');
      host.setAttribute('data-relay-cash-host', '');
      rootNode.appendChild(host);
      const cashModule = globalThis.KomerceCanonicalFinanceAccountingWorkspace;
      if (!cashModule) {
        host.appendChild(text(doc, 'p', 'kmc-workspace-note', 'Module Cash & dépôts indisponible.'));
      } else {
        cashModule.mount({
          root: host, document: doc, ui, fetch: context.fetch, user: {},
          adminContext: null, requestedMarket: context.marketCode,
          contextContract: { resolveMarketView: () => ({ marketCode: context.marketCode }) },
        }).catch(error => host.appendChild(text(doc, 'p', 'kmc-workspace-note', error.message)));
      }
    }
  }

  // L9c : le workspace Hub & Relais lit les files Hub ; les gestes Hub s'exécutent uniquement dans Hub live.
  function isHubReadOnly(context) {
    return context.mode !== 'execution';
  }

  function renderExecuteLink(rootNode, doc, context) {
    const bar = doc.createElement('p');
    bar.className = 'kmc-workspace-muted kmc-workspace-execute-link';
    const link = doc.createElement('a');
    link.href = `/admin/hub-live?view=execute&market=${encodeURIComponent(context.marketCode)}`;
    link.textContent = 'Exécuter dans Hub live';
    link.setAttribute('data-action', 'open-hub-live');
    bar.appendChild(link);
    rootNode.appendChild(bar);
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
      if (config.hub && isHubReadOnly(context)) return;
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

  // Relais live — contenu réellement expédié, déroulable Expédition → KOM-BOX → commandes → articles.
  // Le reçu n'est jamais prérempli : il n'existe que par attestation du relais, article par article.
  function renderRelayShipmentsSection(rootNode, ui, doc, context) {
    const slot = createSection(rootNode, ui, 'Relais · Expéditions en route',
      'Ce qui a réellement été expédié, carton par carton. La réception est constatée par le relais, jamais déduite d’un statut posé par le Hub.');
    slot.setAttribute('data-relay-shipments', '');
    const data = context.relayShipments;
    if (!data) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', context.relayShipmentsError || 'Expéditions indisponibles.'));
      return;
    }
    if (!data.shipments.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune expédition en route vers ce relais.'));
      return;
    }
    data.shipments.forEach(shipment => {
      const card = doc.createElement('details');
      card.className = 'kmc-relay-shipment';
      card.open = true;
      card.setAttribute('data-relay-shipment', shipment.reference);
      card.appendChild(text(doc, 'summary', 'kmc-relay-shipment-title',
        'Expédition ' + shipment.reference + ' · ' + shipment.stage));
      const inputs = [];
      shipment.boxes.forEach(box => {
        const boxNode = doc.createElement('div');
        boxNode.className = 'kmc-relay-box';
        boxNode.setAttribute('data-relay-box', box.reference);
        boxNode.appendChild(text(doc, 'h4', 'kmc-relay-box-title', 'KOM-BOX ' + box.reference));
        box.orders.forEach(order => {
          boxNode.appendChild(text(doc, 'div', 'kmc-workspace-muted', 'Commande ' + order.reference));
          const table = doc.createElement('table');
          table.className = 'kmc-workspace-table';
          table.innerHTML = '<thead><tr><th>Article</th><th>Attendu</th><th>Expédié</th><th>Manquant</th><th>Reçu</th><th>Remis</th></tr></thead>';
          const tbody = doc.createElement('tbody');
          order.items.forEach(item => {
            const tr = doc.createElement('tr');
            tr.setAttribute('data-relay-item', item.order_item_id);
            [item.product, formatNumber(item.expected), formatNumber(item.shipped), formatNumber(item.missing)]
              .forEach(value => tr.appendChild(text(doc, 'td', '', value)));
            const receivedCell = doc.createElement('td');
            if (item.received !== null) {
              receivedCell.textContent = formatNumber(item.received) + (item.incident_id ? ' · incident ouvert' : '');
            } else if (shipment.receivable) {
              const input = doc.createElement('input');
              input.type = 'number';
              input.min = '0';
              input.step = '1';
              input.placeholder = '0 à ' + item.expected;
              input.setAttribute('aria-label', 'Reçu ' + item.product);
              input.setAttribute('data-relay-received', item.order_item_id);
              receivedCell.appendChild(input);
              inputs.push({ item, input });
            } else {
              receivedCell.textContent = 'Non attesté';
            }
            tr.appendChild(receivedCell);
            tr.appendChild(text(doc, 'td', '', formatNumber(item.handed)));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          const wrap = doc.createElement('div');
          wrap.className = 'kmc-workspace-table-wrap';
          wrap.appendChild(table);
          boxNode.appendChild(wrap);
        });
        card.appendChild(boxNode);
      });
      if (inputs.length) {
        const form = doc.createElement('form');
        form.className = 'kmc-relay-receipt-form';
        form.noValidate = true;
        const proof = doc.createElement('input');
        proof.type = 'text';
        proof.placeholder = 'Référence de preuve (bordereau, photo)';
        proof.setAttribute('aria-label', 'Preuve de réception');
        proof.setAttribute('data-relay-proof', '');
        form.appendChild(proof);
        const submit = makeActionButton(doc, 'Attester la réception', 'relay-shipment-receive');
        submit.type = 'submit';
        form.appendChild(submit);
        form.addEventListener('submit', event => {
          event.preventDefault();
          const lines = [];
          for (const { item, input } of inputs) {
            if (input.value.trim() === '') continue;
            const qty = Number(input.value);
            if (!Number.isInteger(qty) || qty < 0) {
              setFeedback(context.root, 'Quantité reçue invalide pour ' + item.product + '.', 'critical');
              return;
            }
            lines.push({ order_item_id: item.order_item_id, received_qty: qty });
          }
          if (!lines.length || !proof.value.trim()) {
            setFeedback(context.root, 'Saisissez les quantités réellement reçues et la preuve.', 'critical');
            return;
          }
          runAction(context, submit, {
            url: endpointFor(context.marketCode, 'relay-shipments/' + encodeURIComponent(shipment.reference) + '/receive'),
            body: { proof_ref: proof.value.trim(), lines },
            runningMessage: 'Attestation en cours…',
            successMessage: result => (result.result && result.result.receipts || []).some(r => r.incident_id)
              ? 'Réception attestée · écart enregistré en incident.' : 'Réception attestée.',
          }).catch(() => {});
        });
        card.appendChild(form);
      }
      slot.appendChild(card);
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

      if (isHubReadOnly(context)) { select.disabled = true; row.appendChild(controls); wrap.appendChild(row); return; }
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

    // Finance : accès au seul module Cash & dépôts (pas de file opérationnelle), hébergé dans Relais live.
    if (options.mode === 'relay-execution' && options.user && options.user.role === 'finance') {
      rootNode.className = 'kmc-operations-workspace';
      rootNode.replaceChildren();
      rootNode.appendChild(createHeader(doc, { scope: { code: marketCode, name: '' } }, 'relay-execution'));
      const host = doc.createElement('div');
      host.setAttribute('data-relay-cash-host', '');
      rootNode.appendChild(host);
      const cashModule = globalThis.KomerceCanonicalFinanceAccountingWorkspace;
      if (!cashModule) { host.appendChild(text(doc, 'p', 'kmc-workspace-note', 'Module Cash & dépôts indisponible.')); return Object.freeze({ marketCode }); }
      await cashModule.mount({
        root: host, document: doc, ui, fetch: fetchFn, user: options.user,
        adminContext: options.adminContext || null, requestedMarket: marketCode,
        contextContract: { resolveMarketView: () => ({ marketCode }) },
      }).catch(error => host.appendChild(text(doc, 'p', 'kmc-workspace-note', error.message)));
      return Object.freeze({ marketCode });
    }

    let currentPayload = null;
    const context = {
      root: rootNode,
      fetch: fetchFn,
      marketCode,
      mode: ['execution', 'relay-execution'].includes(options.mode) ? options.mode : 'pilot',
      view: options.mode === 'execution' ? 'supply' : undefined,
      confirm: typeof options.confirm === 'function'
        ? options.confirm
        : (typeof globalThis.confirm === 'function' ? globalThis.confirm.bind(globalThis) : () => true),
      reload: null,
    };

    async function reload() {
      const payload = await jsonRequest(fetchFn, endpointFor(marketCode));
      if (context.mode === 'execution') {
        try {
          context.receivable = await jsonRequest(fetchFn, RECEIVABLE_ENDPOINT);
          context.receivableError = null;
        } catch (error) {
          context.receivable = null;
          context.receivableError = error.message;
        }
        try {
          context.dossier = await jsonRequest(fetchFn, endpointFor(marketCode, 'supply'));
          context.dossierError = null;
        } catch (error) {
          context.dossier = null;
          context.dossierError = error.message;
        }
      }
      if (context.mode === 'relay-execution') {
        try {
          context.relayShipments = await jsonRequest(fetchFn, endpointFor(marketCode, 'relay-shipments'));
          context.relayShipmentsError = null;
        } catch (error) {
          context.relayShipments = null;
          context.relayShipmentsError = error.message;
        }
      }
      currentPayload = payload;
      renderPayload(rootNode, ui, doc, payload, context);
      return payload;
    }
    context.reload = reload;
    context.renderCurrent = () => renderPayload(rootNode, ui, doc, currentPayload, context);

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
