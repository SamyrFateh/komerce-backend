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
 * @impact-areas  admin-dashboard, logistics, inventory, orders, payments, purchasing
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
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', relayExec ? 'Poste de travail Relais' : execution ? 'Hub live · Dossiers' : 'Flux à traiter'));
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} · ${payload.scope.name} · ${relayExec ? 'Réceptionner · Encaisser · Remettre — uniquement sur preuve' : execution ? 'suivre les PO, réceptionner, affecter et préparer les expéditions' : 'voir ce qui attend une action'}`
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
  const PHYSICAL_CODE_CONFIRM_ENDPOINT = '/api/hub/physical-codes/confirm';
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
  const RELAY_LIVE_TABS = Object.freeze([{ id: 'relay', label: 'Opérations' }, { id: 'cash', label: 'Cash & dépôts' }, { id: 'returns', label: 'Retours & SAV' }]);

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
    // Douchette USB (mode clavier) : un scan reconnaît une référence, jamais un client.
    const scannerPanel = doc.createElement('div');
    scannerPanel.className = 'kmc-workspace-receive-scanner';
    const scannerLabel = text(doc, 'label', 'kmc-workspace-receive-scan-label', 'Identifier la référence reçue');
    const scannerInput = doc.createElement('input');
    scannerInput.type = 'text';
    scannerInput.autocomplete = 'off';
    scannerInput.className = 'kmc-workspace-receive-scan-input';
    scannerInput.placeholder = 'Scanner EAN / code fournisseur puis Entrée';
    scannerInput.setAttribute('aria-label', 'Scanner le code physique de la référence fournisseur');
    scannerLabel.appendChild(scannerInput);
    scannerPanel.appendChild(scannerLabel);
    const scannerResult = text(doc, 'span', 'kmc-workspace-receive-scan-result', 'Scanner la référence avant de déclarer sa quantité reçue.');
    scannerResult.setAttribute('role', 'status');
    scannerPanel.appendChild(scannerResult);
    // Mode dégradé : sans code lisible, l'agent justifie une constatation manuelle ; la provenance
    // enregistrée est MANUAL (jamais SCAN), avec la même vérification de quantité et de variante.
    const manualProof = doc.createElement('input');
    manualProof.type = 'text';
    manualProof.maxLength = 500;
    manualProof.className = 'kmc-workspace-receive-manual-proof';
    manualProof.placeholder = 'Mode dégradé : justification de la saisie manuelle (6 caractères min.)';
    manualProof.setAttribute('aria-label', 'Justification de la réception en saisie manuelle');
    manualProof.setAttribute('data-receive-manual-proof', '');
    manualProof.hidden = true;
    // Interrupteur explicite : un scanner émule un clavier, la frappe seule ne prouve pas la provenance.
    const manualToggleLabel = text(doc, 'label', 'kmc-workspace-receive-manual-toggle', 'Saisie manuelle (sans scanner) ');
    const manualToggle = doc.createElement('input');
    manualToggle.type = 'checkbox';
    manualToggle.setAttribute('data-receive-manual-toggle', '');
    manualToggle.setAttribute('aria-label', 'Saisie manuelle : provenance MANUAL avec justification obligatoire');
    manualToggleLabel.appendChild(manualToggle);
    scannerPanel.appendChild(manualToggleLabel);
    scannerPanel.appendChild(manualProof);
    card.appendChild(scannerPanel);

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
    const scannedCodeBySku = new Map();
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
            ...(manualToggle.checked
              ? (line.product_sku_id && String(manualProof.value || '').trim().length >= 6
                ? { evidence_method: 'MANUAL', evidence_ref: String(manualProof.value).trim() } : {})
              : (scannedCodeBySku.has(String(line.product_sku_id))
                ? { evidence_code: scannedCodeBySku.get(String(line.product_sku_id)) } : {})),
            quantity,
          });
        }
      });
      return { contents, invalid };
    }

    function sync() {
      const { contents, invalid } = collect();
      const unverified = contents.some(item => !item.evidence_code && item.evidence_method !== 'MANUAL');
      button.disabled = invalid || contents.length === 0 || unverified;
      hint.textContent = invalid
        ? 'Quantité invalide : entier entre 0 et le restant attendu.'
        : unverified ? (manualToggle.checked
          ? 'Saisie manuelle : justification de 6 caractères minimum obligatoire.'
          : 'Scanner toutes les références reçues, ou activer « Saisie manuelle » et la justifier.')
        : 'Quantité réellement comptée et références scannées : prêt à enregistrer.';
    }
    inputs.forEach(({ input }) => input.addEventListener('input', sync));
    manualProof.addEventListener('input', sync);
    manualToggle.addEventListener('change', () => {
      manualProof.hidden = !manualToggle.checked;
      scannerResult.textContent = manualToggle.checked
        ? 'Saisie manuelle active : provenance MANUAL, justification obligatoire.'
        : 'Scanner la référence avant de déclarer sa quantité reçue.';
      sync();
    });
    let scanning = false;
    const PHYSICAL_CODE_TYPES = Object.freeze([
      ['EAN_GTIN', 'EAN / GTIN imprimé (universel)'],
      ['SUPPLIER_BARCODE', 'Code-barres du fournisseur'],
      ['KOM_LOT_LABEL', 'Étiquette de lot Komerce'],
    ]);
    const confirmBox = doc.createElement('form');
    confirmBox.className = 'kmc-workspace-receive-confirm';
    confirmBox.setAttribute('data-physical-confirm', '');
    confirmBox.hidden = true;
    scannerPanel.appendChild(confirmBox);

    function closeConfirm() {
      confirmBox.hidden = true;
      confirmBox.replaceChildren();
    }

    // Code inconnu : l'agent, colis en main, rattache l'EAN à la variante attendue sur CETTE PO.
    // Le code identifie la référence, jamais la commande ni un exemplaire.
    function openConfirm(code) {
      confirmBox.replaceChildren();
      confirmBox.hidden = false;
      confirmBox.appendChild(text(doc, 'span', 'kmc-workspace-muted',
        `Code ${code} inconnu pour ce fournisseur. Colis en main, choisissez la variante attendue sur cette PO.`));
      const variant = doc.createElement('select');
      variant.setAttribute('aria-label', 'Variante attendue sur la PO');
      variant.setAttribute('data-confirm-variant', '');
      variant.appendChild(Object.assign(doc.createElement('option'), { value: '', textContent: 'Variante attendue…' }));
      po.lines.filter(line => line.product_sku_id).forEach(line => {
        variant.appendChild(Object.assign(doc.createElement('option'), {
          value: String(line.product_sku_id),
          textContent: `${line.product_name} (attendu ${formatNumber(line.expected_quantity)})`,
        }));
      });
      const type = doc.createElement('select');
      type.setAttribute('aria-label', 'Type de code');
      type.setAttribute('data-confirm-type', '');
      PHYSICAL_CODE_TYPES.forEach(([value, label]) => type.appendChild(Object.assign(doc.createElement('option'), { value, textContent: label })));
      const proof = doc.createElement('input');
      proof.type = 'text';
      proof.maxLength = 500;
      proof.placeholder = 'Preuve : référence de la photo ou de la note';
      proof.setAttribute('aria-label', 'Référence de la photo ou de la note');
      proof.setAttribute('data-confirm-proof', '');
      const submit = makeActionButton(doc, 'Valider la confirmation', 'confirm-physical-code');
      submit.type = 'submit';
      submit.disabled = true;
      const cancel = makeActionButton(doc, 'Annuler', 'cancel-physical-code');
      cancel.addEventListener('click', closeConfirm);
      const syncConfirm = () => { submit.disabled = !variant.value || !String(proof.value || '').trim(); };
      variant.addEventListener('change', syncConfirm);
      proof.addEventListener('input', syncConfirm);
      [variant, type, proof].forEach(node => confirmBox.appendChild(node));
      const actions = doc.createElement('div');
      actions.className = 'kmc-workspace-receive-confirm-actions';
      actions.appendChild(submit);
      actions.appendChild(cancel);
      confirmBox.appendChild(actions);
      confirmBox.onsubmit = async event => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        scannerResult.textContent = 'Confirmation en cours…';
        scannerResult.dataset.scanTone = 'pending';
        try {
          await jsonRequest(context.fetch, PHYSICAL_CODE_CONFIRM_ENDPOINT, {
            method: 'POST',
            body: {
              purchase_order_id: po.purchase_order_id,
              product_sku_id: variant.value,
              code,
              code_type: type.value,
              proof_ref: String(proof.value).trim(),
            },
          });
          closeConfirm();
          await identify(code);
        } catch (error) {
          scannerResult.textContent = `Confirmation refusée : ${error.message}`;
          scannerResult.dataset.scanTone = 'error';
          submit.disabled = false;
        }
      };
      variant.focus();
    }

    async function identify(code) {
      scanning = true;
      scannerInput.disabled = true;
      scannerResult.textContent = 'Identification en cours…';
      scannerResult.dataset.scanTone = 'pending';
      try {
        const query = new URLSearchParams({ purchase_order_id: String(po.purchase_order_id), code });
        const matched = await jsonRequest(context.fetch, `${endpointFor(context.marketCode, 'supply/physical-code')}?${query}`);
        const candidate = inputs.find(({ line }) => String(line.product_sku_id || '') === String(matched.product_sku_id) && Number(line.remaining_quantity) > 0);
        if (!candidate) {
          scannerResult.textContent = 'Référence reconnue, mais aucune quantité attendue dans cette PO : traiter l’écart.';
          scannerResult.dataset.scanTone = 'warning';
          return;
        }
        scannerResult.textContent = matched.confirmed
          ? `Référence confirmée : ${candidate.line.product_name}. Comptez puis saisissez la quantité réellement reçue.`
          : `Référence fournisseur déclarée : ${candidate.line.product_name}. Vérification physique du code à confirmer.`;
        scannerResult.dataset.scanTone = matched.confirmed ? 'success' : 'warning';
        if (matched.confirmed && !manualToggle.checked) {
          scannedCodeBySku.set(String(candidate.line.product_sku_id), String(matched.code));
        }
        sync();
        candidate.input.focus();
      } catch (error) {
        scannerResult.textContent = `Code non reconnu ou incompatible avec cette PO (${error.code || 'contrôle requis'}).`;
        scannerResult.dataset.scanTone = 'error';
        if (error.code === 'HUB_PHYSICAL_CODE_UNKNOWN') {
          const propose = makeActionButton(doc, 'Confirmer cette référence', 'open-physical-confirm');
          propose.addEventListener('click', () => { propose.remove(); openConfirm(code); });
          scannerResult.appendChild(doc.createTextNode(' '));
          scannerResult.appendChild(propose);
        }
        scannerInput.focus();
      } finally {
        scanning = false;
        scannerInput.disabled = false;
      }
    }

    scannerInput.addEventListener('keydown', async event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const code = String(scannerInput.value || '').trim();
      if (!code || scanning) return;
      closeConfirm();
      await identify(code);
    });

    button.addEventListener('click', () => {
      const { contents, invalid } = collect();
      if (invalid || !contents.length || contents.some(item => !item.evidence_code && item.evidence_method !== 'MANUAL')) return;
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

  // T8/HB-08 : le colis arrive physiquement sans manifeste. Aucun contenu, aucune PO
  // ni quantité ne sont supposés. Le writer est le même /api/scans/hub/receive.
  function createUnmanifestedArrivalCard(doc, context) {
    const card = doc.createElement('article');
    card.className = 'kmc-workspace-receive-card';
    card.setAttribute('data-hub-unmanifested-arrival', '');
    card.appendChild(text(doc, 'h3', '', 'Arrivée fournisseur sans manifeste'));
    card.appendChild(text(doc, 'p', 'kmc-workspace-muted',
      'Constater uniquement le colis physiquement présent. Aucun article n’est attribué à une commande avant déballage et rapprochement.'));
    const form = doc.createElement('form');
    form.setAttribute('data-hub-unmanifested-form', '');
    card.appendChild(form);
    const physical = doc.createElement('input');
    physical.type = 'text';
    physical.maxLength = 200;
    physical.value = context.unmanifestedArrivalReference || newReceptionReference();
    context.unmanifestedArrivalReference = physical.value;
    physical.setAttribute('aria-label', 'Référence physique unique du colis sans manifeste');
    physical.setAttribute('data-hub-unmanifested-reference', '');
    physical.addEventListener('input', () => {
      context.unmanifestedArrivalReference = String(physical.value || '').trim();
      sync();
    });
    const location = doc.createElement('input');
    location.type = 'text';
    location.maxLength = 120;
    location.placeholder = 'Zone de réception réelle (obligatoire)';
    location.setAttribute('aria-label', 'Zone physique où le colis est reçu');
    location.setAttribute('data-hub-unmanifested-location', '');
    const tracking = doc.createElement('input');
    tracking.type = 'text';
    tracking.maxLength = 120;
    tracking.placeholder = 'Tracking fournisseur (facultatif)';
    tracking.setAttribute('aria-label', 'Tracking réel du colis sans manifeste');
    tracking.setAttribute('data-hub-unmanifested-tracking', '');
    [physical, location, tracking].forEach(node => form.appendChild(node));
    const button = makeActionButton(doc, 'Attester l’arrivée sans manifeste', 'hub-unmanifested-arrival');
    button.type = 'submit';
    button.disabled = true;
    const hint = text(doc, 'p', 'kmc-workspace-muted',
      'Sans manifeste : aucun SKU, quantité ou PO créé. La tâche « Colis à rapprocher » reste à traiter.');
    form.appendChild(hint);
    form.appendChild(button);
    function sync() {
      button.disabled = String(physical.value || '').trim().length < 6 ||
        String(location.value || '').trim().length < 4;
    }
    location.addEventListener('input', sync);
    form.addEventListener('submit', event => {
      event.preventDefault();
      sync();
      if (button.disabled) return;
      const reference = String(physical.value).trim();
      const locationRef = String(location.value).trim();
      const trackingRef = String(tracking.value).trim();
      runAction(context, button, {
        url: RECEIVE_ENDPOINT,
        body: {
          reference, location_ref: locationRef, ...(trackingRef ? { tracking_ref: trackingRef } : {}),
          contents: [],
        },
        confirmMessage: 'Le colis ' + reference + ' est-il physiquement présent à ' + locationRef +
          ' ? Il sera enregistré sans articles ni PO jusqu’au rapprochement.',
        runningMessage: 'Constat d’arrivée physique en cours…',
        successMessage: result => 'Arrivée enregistrée : ' + (result?.unit?.reference || reference) +
          '. Colis à rapprocher, aucune quantité attribuée.',
        onSuccess: () => { context.unmanifestedArrivalReference = null; },
      }).catch(error => {
        setFeedback(context.root, 'Arrivée non confirmée : ' + error.message +
          '. Vérifiez le dossier par référence avant de recommencer (réponse réseau possiblement perdue).', 'critical');
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
    // Accessible même sans PO en attente : c’est précisément le cas d’un colis à rapprocher.
    slot.appendChild(createUnmanifestedArrivalCard(doc, context));
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

  // Dossier vivant : la projection serveur reste la seule source de vérité.
  // Les accordéons ne changent aucun état; chaque action existante garde son service propriétaire.
  // Réutilisé par le cockpit global : même formulaire, mêmes endpoints,
  // mêmes garde-fous et mêmes protections contre les POST rejoués.
  function renderManualSourcing(ordersSlot, doc, context, group) {
      const unresolved = (group.items || []).filter(item =>
        item.sourcing_required === true && Number(item.purchasing_missing) > 0 &&
        item.id && item.product_id
      );
      if (!unresolved.length) return;
      const host = ordersSlot.querySelector('[data-hub-sourcing-recovery]');
      if (!host) return;
      host.hidden = false;
      host.replaceChildren();

      const heading = doc.createElement('div');
      heading.className = 'kmc-hub-sourcing-heading';
      const headingCopy = doc.createElement('div');
      headingCopy.className = 'kmc-hub-sourcing-heading-copy';
      headingCopy.appendChild(text(doc, 'h3', '', 'Résoudre le sourcing · ' + group.reference));
      headingCopy.appendChild(text(doc, 'p', '',
        'Ouvrir une ligne d’achat pour les articles non couverts. Aucun envoi de PO ni paiement fournisseur.'));
      heading.appendChild(headingCopy);
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'kmc-hub-sourcing-close';
      close.textContent = 'Fermer';
      close.setAttribute('data-sourcing-close', '');
      close.addEventListener('click', () => {
        if (writing) return; // une mutation en cours ne doit pas être dissimulée
        host.hidden = true;
        host.replaceChildren();
        context.close?.();
      });
      heading.appendChild(close);
      host.appendChild(heading);

      const form = doc.createElement('form');
      form.setAttribute('data-hub-sourcing-form', group.reference);
      form.className = 'kmc-hub-sourcing-form';
      host.appendChild(form);

      const layout = doc.createElement('div');
      layout.className = 'kmc-hub-sourcing-layout';
      form.appendChild(layout);
      const articlePanel = doc.createElement('section');
      articlePanel.className = 'kmc-hub-sourcing-group';
      articlePanel.appendChild(text(doc, 'h4', '', 'Article concerné'));
      layout.appendChild(articlePanel);
      const supplierPanel = doc.createElement('section');
      supplierPanel.className = 'kmc-hub-sourcing-group';
      supplierPanel.appendChild(text(doc, 'h4', '', 'Fournisseur et conditions'));
      layout.appendChild(supplierPanel);

      const field = (label, element, parent) => {
        const wrapper = doc.createElement('label');
        wrapper.className = 'kmc-hub-sourcing-field';
        wrapper.appendChild(text(doc, 'span', '', label));
        wrapper.appendChild(element);
        parent.appendChild(wrapper);
        return element;
      };
      const itemSelect = field('Article à sourcer', doc.createElement('select'), articlePanel);
      itemSelect.setAttribute('data-sourcing-item', '');
      unresolved.forEach(item => {
        const option = doc.createElement('option');
        option.value = item.id;
        option.textContent = item.product;
        itemSelect.appendChild(option);
      });
      const itemSummary = text(doc, 'p', 'kmc-hub-sourcing-quantity', '');
      itemSummary.setAttribute('data-sourcing-quantity', '');
      articlePanel.appendChild(itemSummary);
      articlePanel.appendChild(text(doc, 'p', 'kmc-hub-sourcing-help',
        'La quantité à acheter est calculée depuis les lignes déjà engagées, sans doublon.'));

      const supplierSelect = field('Fournisseur', doc.createElement('select'), supplierPanel);
      supplierSelect.setAttribute('data-sourcing-supplier', '');
      const supplierName = field('Nom du nouveau fournisseur local', doc.createElement('input'), supplierPanel);
      supplierName.placeholder = 'Nom réel du fournisseur';
      supplierName.setAttribute('data-sourcing-name', '');
      const supplierDetails = doc.createElement('div');
      supplierDetails.className = 'kmc-hub-sourcing-details';
      supplierPanel.appendChild(supplierDetails);
      const supplierRef = field('Référence fournisseur', doc.createElement('input'), supplierDetails);
      supplierRef.placeholder = 'Référence réelle';
      supplierRef.setAttribute('data-sourcing-ref', '');
      const supplierPrice = field('Prix unitaire (AED)', doc.createElement('input'), supplierDetails);
      supplierPrice.type = 'number';
      supplierPrice.step = '0.01';
      supplierPrice.min = '0.01';
      supplierPrice.placeholder = '0,00';
      supplierPrice.setAttribute('data-sourcing-price', '');
      const mappingNote = text(doc, 'p', 'kmc-hub-sourcing-help', 
        'Association existante : référence et prix enregistrés réutilisés.');
      mappingNote.hidden = true;
      mappingNote.setAttribute('data-sourcing-mapping-note', '');
      supplierPanel.appendChild(mappingNote);

      const footer = doc.createElement('div');
      footer.className = 'kmc-hub-sourcing-footer';
      form.appendChild(footer);
      const footerCopy = doc.createElement('div');
      footerCopy.className = 'kmc-hub-sourcing-footer-copy';
      footerCopy.appendChild(text(doc, 'p', 'kmc-hub-sourcing-help',
        'Étape suivante : préparer la PO, puis faire valider séparément l’engagement et le paiement.'));
      const status = text(doc, 'p', 'kmc-hub-sourcing-status', '');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('data-sourcing-status', '');
      footerCopy.appendChild(status);
      footer.appendChild(footerCopy);
      const submit = makeActionButton(doc, 'Créer la ligne d’achat', 'create-manual-purchase-line');
      submit.type = 'submit';
      footer.appendChild(submit);
      let suppliers = [];
      let requestSerial = 0;
      let writing = false;
      function chosenItem() {
        return unresolved.find(item => item.id === itemSelect.value);
      }
      function updateForm() {
        const supplier = suppliers.find(row => row.id === supplierSelect.value);
        const mapped = !!supplier?.matching_product_supplier_id;
        supplierName.disabled = !!supplier;
        supplierName.parentNode.hidden = !!supplier;
        supplierRef.disabled = mapped;
        supplierPrice.disabled = mapped;
        supplierDetails.hidden = mapped;
        mappingNote.hidden = !mapped;
      }
      function updateItemSummary() {
        const quantity = Number(chosenItem()?.purchasing_missing || 0);
        itemSummary.textContent = formatNumber(quantity) + (quantity > 1 ? ' unités restantes à acheter' : ' unité restante à acheter');
      }
      async function loadSuppliers() {
        const serial = ++requestSerial;
        const item = chosenItem();
        supplierSelect.disabled = true;
        submit.disabled = true;
        status.textContent = 'Recherche des fournisseurs du produit…';
        try {
          const result = await jsonRequest(context.fetch,
            '/api/purchasing/suppliers?active=true&product_id=' + encodeURIComponent(item.product_id));
          if (serial !== requestSerial || writing) return;
          suppliers = Array.isArray(result) ? result.filter(row =>
            row.matching_product_supplier_id || row.owner_scope === 'hub' ||
            (context.user && context.user.role === 'admin')) : [];
          supplierSelect.replaceChildren();
          const first = doc.createElement('option');
          first.value = '';
          first.textContent = 'Créer un fournisseur local';
          supplierSelect.appendChild(first);
          suppliers.forEach(supplier => {
            const option = doc.createElement('option');
            option.value = supplier.id;
            option.textContent = supplier.name +
              (supplier.matching_product_supplier_id ? ' · déjà associé' : ' · à associer');
            supplierSelect.appendChild(option);
          });
          supplierSelect.disabled = false;
          submit.disabled = false;
          status.textContent = 'La quantité à acheter est déterminée par la couverture serveur ; aucun achat fournisseur ne sera envoyé automatiquement.';
          updateForm();
        } catch (error) {
          if (serial !== requestSerial) return;
          status.textContent = 'Fournisseurs indisponibles : ' + error.message;
        }
      }
      itemSelect.addEventListener('change', () => {
        updateItemSummary();
        loadSuppliers().catch(() => {});
      });
      supplierSelect.addEventListener('change', updateForm);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (writing || submit.disabled) return;
        const item = chosenItem();
        const supplier = suppliers.find(row => row.id === supplierSelect.value);
        const needsMapping = !supplier || !supplier.matching_product_supplier_id;
        const quantity = Number(item?.purchasing_missing || 0);
        const name = supplierName.value.trim();
        const reference = supplierRef.value.trim();
        const price = Number(supplierPrice.value);
        if (!item || !Number.isSafeInteger(quantity) || quantity < 1 ||
            (!supplier && !name) || (needsMapping && (!reference || !Number.isFinite(price) || price <= 0))) {
          status.textContent = 'Préciser le fournisseur, sa référence et son prix AED positif.';
          return;
        }
        if (!context.confirm('Ouvrir ' + quantity + ' unité(s) en achat manuel pour ' + group.reference + ' ?')) return;
        writing = true;
        submit.disabled = true;
        status.textContent = 'Enregistrement du fournisseur et de la ligne d’achat…';
        let wrote = false;
        try {
          let supplierId = supplier?.id || null;
          if (!supplierId) {
            wrote = true; // ne jamais rejouer une création après une erreur réseau
            const created = await jsonRequest(context.fetch, '/api/purchasing/suppliers', {
              method: 'POST', body: { name, platform: 'local', auto_order: false },
            });
            supplierId = created.id;
            wrote = true;
          }
          let mappingId = supplier?.matching_product_supplier_id || null;
          if (!mappingId) {
            wrote = true;
            const mapping = await jsonRequest(context.fetch,
              '/api/purchasing/suppliers/' + encodeURIComponent(supplierId) + '/map', {
                method: 'POST',
                body: { product_id: item.product_id, supplier_sku: reference, supplier_price_aed: price },
              });
            mappingId = mapping.id;
            wrote = true;
          }
          if (!mappingId) throw new Error('Association fournisseur absente après enregistrement');
          wrote = true; // le POST de ligne peut être appliqué sans réponse
          const createdLine = await jsonRequest(context.fetch, '/api/purchasing/lines', {
            method: 'POST',
            body: {
              order_item_id: item.id, product_supplier_id: mappingId,
              quantity, execution_mode: 'manual',
            },
          });
          wrote = true;
          if (!createdLine?.line?.line_id) throw new Error('Ligne créée mais réponse incomplète ; vérifier le dossier avant toute reprise');
          await context.reload();
          setFeedback(context.root,
            'Ligne d’achat ouverte pour ' + group.reference + ' ; préparer ensuite la PO et obtenir les validations distinctes.',
            'positive');
        } catch (error) {
          status.textContent = error.message + (wrote
            ? ' · Des données peuvent déjà être enregistrées. Recharger et vérifier avant toute nouvelle tentative.'
            : '');
          setFeedback(context.root, status.textContent, 'critical');
          if (!wrote) submit.disabled = false;
        } finally {
          writing = false;
        }
      });
      updateItemSummary();
      loadSuppliers().catch(() => {});
      host.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }

  function openManualSourcing(target, options = {}) {
    const doc = options.document;
    if (!target || !doc || typeof options.fetch !== 'function')
      throw new Error('hub_inline_sourcing_context_missing');
    const order = options.order;
    if (!order || !order.id || !Array.isArray(order.items))
      throw new Error('hub_inline_sourcing_order_missing');
    const permitted = ['admin','agent_hub'].includes(options.user && options.user.role);
    if (!permitted) throw new Error('hub_inline_sourcing_not_permitted');
    target.replaceChildren();
    const feedback = doc.createElement('p');
    feedback.setAttribute('data-workspace-feedback','');
    feedback.setAttribute('role','status');
    target.appendChild(feedback);
    const host = doc.createElement('section');
    host.hidden = true;
    host.className = 'kmc-hub-sourcing-panel';
    host.setAttribute('data-hub-sourcing-recovery','');
    target.appendChild(host);
    const active = renderManualSourcing(target, doc, {
      root:target,
      user:options.user,
      fetch:options.fetch,
      confirm:typeof options.confirm === 'function' ? options.confirm : () => false,
      close:typeof options.onClose === 'function' ? options.onClose : null,
      reload:typeof options.refresh === 'function' ? options.refresh : async () => {},
    }, order);
    if (host.hidden) {
      feedback.textContent = 'Aucun article éligible au sourcing manuel : vérifier le dossier fournisseur.';
      return false;
    }
    return true;
  }

  function renderSupplySection(rootNode, ui, doc, context) {
    // Concept C : aucun bloc KPI ni titre de section redondant au-dessus du cockpit (hero existant conservé).
    const flowHost = doc.createElement('div');
    flowHost.className = 'kmc-hub-flow';
    rootNode.appendChild(flowHost);
    flowHost.setAttribute('data-hub-dossier-home', '');
    if (context.dossierError) {
      flowHost.appendChild(text(doc, 'div', 'kmc-workspace-empty', `Dossier indisponible : ${context.dossierError}`));
      return;
    }
    const d = context.dossier;
    if (!d) {
      flowHost.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Dossier non chargé.'));
      return;
    }

    // Hub Live concept C : le cockpit « flux du besoin » remplace l'ancien tableau de production.
    // Toutes les quantités et étapes viennent de la projection serveur (d.cockpit / d.orders / d.purchase_orders).
    const ordersSlot = doc.createElement('div');
    ordersSlot.className = 'kmc-hub-flow-body';
    rootNode.appendChild(ordersSlot);
    ordersSlot.setAttribute('data-supply-pos', '');
    ordersSlot.setAttribute('data-hub-work-orders', '');
    const cockpitHost = doc.createElement('div');
    cockpitHost.setAttribute('data-hub-cockpit-host', '');
    ordersSlot.appendChild(cockpitHost);
    const sourcingHost = doc.createElement('section');
    sourcingHost.hidden = true;
    sourcingHost.setAttribute('data-hub-sourcing-recovery', '');
    sourcingHost.className = 'kmc-hub-sourcing-panel';
    ordersSlot.appendChild(sourcingHost);

    // Sourcing manuel via les API propriétaires : aucune création en SQL,
    // aucune fausse identité fournisseur, aucun envoi ou paiement implicite.
    const showSourcingResolution = group => renderManualSourcing(ordersSlot, doc, context, group);

    const cockpitModule = globalThis.KomerceHubLiveCockpit;
    if (!cockpitModule) {
      cockpitHost.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Cockpit Hub indisponible : module non chargé.'));
    } else {
      if (!context.cockpitState) context.cockpitState = { sel: null, form: null, todoAll: false, picked: new Set() };
      const physicalDetails = () => rootNode.querySelector('[data-hub-physical-details]');
      try {
      cockpitModule.render(cockpitHost, {
        document: doc, dossier: d, marketCode: context.marketCode, state: context.cockpitState,
        isReadOnly: isHubReadOnly(context),
        endpoint: suffix => endpointFor(context.marketCode, suffix),
        act: (button, options) => runAction(context, button, options),
        reload: () => context.reload(),
        feedback: (message, tone) => setFeedback(context.root, message, tone),
        renderReception: purchaseOrderId => {
          const po = ((context.receivable && context.receivable.purchase_orders) || [])
            .find(row => String(row.purchase_order_id) === String(purchaseOrderId));
          return po ? createReceptionCard(doc, context, po) : null;
        },
        openSourcing: orderId => {
          const order = (d.orders || []).find(row => String(row.id) === String(orderId));
          if (order) showSourcingResolution({ id: order.id, reference: order.reference, items: order.items || [] });
        },
        openPhysical: () => {
          const details = physicalDetails();
          if (details) { details.open = true; details.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }
        },
      });
      } catch (error) {
        cockpitHost.replaceChildren(text(doc, 'div', 'kmc-workspace-empty', 'Cockpit Hub illisible : rechargez la page (' + String((error && error.message) || error).slice(0, 120) + ').'));
      }
    }
    // Tout ce qui suit (écarts, réceptions brutes, sacs, KOM-BOX, expéditions) est le panneau secondaire exhaustif.
    const secondaryStart = rootNode.children.length;
    // La filiation détaillée est chargée à la demande, hors du tableau.
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

    // Composition des KOM-BOX via les routes Workspace (qui délèguent aux commandes Hub canoniques) : une seule autorité.
    const BOX_NEXT_STATE = Object.freeze({
      RECEIVED: 'IDENTIFIED', IDENTIFIED: 'QUALITY_CHECKED', QUALITY_CHECKED: 'LOCATED',
      LOCATED: 'ALLOCATED', ALLOCATED: 'PICKED', PICKED: 'PACKED', PACKED: 'DISPATCHED',
    });
    const BOX_MUTABLE = new Set(['RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']);
    const fillable = Array.isArray(d.fillable) ? d.fillable : [];
    const createBar = doc.createElement('div');
    createBar.className = 'kmc-workspace-receive-footer';
    createBar.setAttribute('data-supply-box-create', '');
    const newRef = field('Référence du carton (facultative)', 'Référence de la nouvelle KOM-BOX');
    const newBox = makeActionButton(doc, 'Créer une KOM-BOX', 'create-box');
    newBox.addEventListener('click', () => runAction(context, newBox, {
      url: endpointFor(context.marketCode, 'boxes'),
      body: newRef.value.trim() ? { reference: newRef.value.trim() } : {},
      runningMessage: 'Création de la KOM-BOX…',
      successMessage: result => `KOM-BOX ${result && result.physical_unit ? result.physical_unit.reference : ''} créée.`,
    }).catch(() => {}));
    [newRef, newBox].forEach(node => createBar.appendChild(node));
    boxes.appendChild(createBar);

    // Préparation : un sac appartient à UNE commande et son contenu est figé
    // à l'ouverture. Un seul scan physique par référence déposée.
    const availableByOrder = new Map();
    fillable.forEach(line => {
      const key = String(line.order_id);
      if (!availableByOrder.has(key)) availableByOrder.set(key, {
        order_id: line.order_id, order_ref: line.order_ref, lines: [],
      });
      availableByOrder.get(key).lines.push(line);
    });
    const openBags = Array.isArray(d.bags_open) ? d.bags_open : [];
    const readyBags = Array.isArray(d.bags_ready) ? d.bags_ready : [];
    const activeOrders = new Set(openBags.map(bag => String(bag.order_id)));
    const prep = doc.createElement('section');
    prep.className = 'kmc-hub-bag-prep';
    prep.setAttribute('data-hub-bag-preparation', '');
    prep.appendChild(text(doc, 'h4', '', 'Préparer les sacs clients'));
    prep.appendChild(text(doc, 'p', 'kmc-workspace-muted',
      'Une commande par sac. Scanner la référence au dépôt, confirmer la quantité, puis fermer. Aucun second scan à la fermeture.'));
    const orderChoices = [...availableByOrder.values()].filter(order => !activeOrders.has(String(order.order_id)));
    if (orderChoices.length) {
      const createRow = doc.createElement('div');
      createRow.className = 'kmc-hub-bag-controls';
      const orderSelect = doc.createElement('select');
      orderSelect.setAttribute('aria-label', 'Commande dont préparer le sac');
      orderChoices.forEach((order,i) => orderSelect.appendChild(Object.assign(doc.createElement('option'), {
        value: String(i), textContent: order.order_ref + ' · ' +
          order.lines.reduce((sum,line) => sum + Number(line.quantity), 0) + ' unité(s) disponible(s)',
      })));
      const createBag = makeActionButton(doc, 'Créer le sac client', 'create-customer-bag');
      createBag.addEventListener('click', () => {
        const order = orderChoices[Number(orderSelect.value)];
        if (!order) return;
        const plans = new Map();
        order.lines.forEach(line => {
          const key = String(line.order_item_id);
          plans.set(key,(plans.get(key) || 0) + Number(line.quantity));
        });
        const bagPlan = [...plans].map(([order_item_id, quantity]) => ({order_item_id,quantity}));
        runAction(context, createBag, {
          url: endpointFor(context.marketCode, 'bags'),
          body: {order_id:order.order_id,bag_plan:bagPlan},
          runningMessage: 'Ouverture du sac client…',
          successMessage: result => 'Sac ' + (result.physical_unit?.reference || '') + ' créé pour ' + order.order_ref,
        }).catch(() => {});
      });
      createRow.appendChild(orderSelect); createRow.appendChild(createBag); prep.appendChild(createRow);
    } else if (!openBags.length) {
      prep.appendChild(text(doc, 'p', 'kmc-workspace-muted','Aucune quantité réceptionnée à préparer.'));
    }
    openBags.forEach(bag => {
      const holder = doc.createElement('div');
      holder.className = 'kmc-hub-bag-open';
      holder.appendChild(text(doc, 'strong', '', bag.reference + ' · ' + bag.order_ref));
      const actual = new Map((bag.actual_contents || []).map(item => [String(item.order_item_id), Number(item.quantity)]));
      const planned = new Map((bag.bag_plan || []).map(item => [String(item.order_item_id), Number(item.quantity)]));
      const totalPlanned = [...planned.values()].reduce((a,b) => a+b,0);
      const totalActual = [...actual.values()].reduce((a,b) => a+b,0);
      holder.appendChild(text(doc, 'span', 'kmc-workspace-muted',
        totalActual + ' / ' + totalPlanned + ' unité(s) physiquement déposée(s)'));
      const options = fillable.filter(line => String(line.order_id)===String(bag.order_id)
        && (planned.get(String(line.order_item_id)) || 0) > (actual.get(String(line.order_item_id)) || 0));
      if (options.length) {
        const row = doc.createElement('div'); row.className='kmc-hub-bag-controls';
        const source=doc.createElement('select');
        source.setAttribute('aria-label','Référence disponible pour ' + bag.reference);
        options.forEach((line,i)=>source.appendChild(Object.assign(doc.createElement('option'),{
          value:String(i),
          textContent:(line.product||'Article')+' · '+line.quantity+' disponible(s) ('+line.from_unit_ref+')',
        })));
        const method=doc.createElement('select');
        method.setAttribute('aria-label','Mode de preuve du dépôt dans '+bag.reference);
        method.setAttribute('data-hub-bag-evidence-method','');
        [['SCAN','Code physique vérifié'],['MANUAL','Mode dégradé · constat manuel']]
          .forEach(([value,label])=>method.appendChild(Object.assign(doc.createElement('option'),
            {value,textContent:label})));
        const barcode=field('Scanner ou saisir EAN / référence physique',
          'Code physique observé lors du dépôt dans '+bag.reference);
        barcode.setAttribute('data-hub-bag-code','');
        const proof=field('Preuve du constat manuel (référence, au moins 6 caractères)',
          'Référence de preuve du dépôt manuel dans '+bag.reference);
        proof.setAttribute('data-hub-bag-manual-proof','');
        proof.hidden=true;
        const qty=doc.createElement('input');qty.type='number';qty.min='1';qty.step='1';qty.value='1';
        qty.setAttribute('aria-label','Quantité déposée dans '+bag.reference);
        const put=makeActionButton(doc,'Déposer dans le sac','scan-bag-deposit');
        const syncMethod=()=>{
          const manual=method.value==='MANUAL';
          barcode.hidden=manual;
          proof.hidden=!manual;
          if(manual)barcode.value='';
          else proof.value='';
        };
        method.addEventListener('change',syncMethod);
        const deposit=()=>{
          const line=options[Number(source.value)];
          if (!line) return;
          const manual=method.value==='MANUAL';
          const proofRef=String(proof.value||'').trim();
          if(manual ? proofRef.length<6 : !barcode.value.trim()) {
            setFeedback(context.root,manual
              ? 'Mode manuel : référence de preuve obligatoire (6 caractères minimum).'
              : 'Code physique à vérifier avant le dépôt.', 'critical');
            return;
          }
          const left=(planned.get(String(line.order_item_id))||0)-(actual.get(String(line.order_item_id))||0);
          const quantity=Number(qty.value);
          if (!Number.isInteger(quantity)||quantity<1||quantity>Math.min(left,Number(line.quantity))) return;
          runAction(context,put,{
            url:endpointFor(context.marketCode, 'bags/'+encodeURIComponent(bag.unit_id)+'/deposit'),
            body:{from_unit_id:line.from_unit_id,allocation_id:line.allocation_id,
              quantity,
              ...(manual ? {evidence_method:'MANUAL',evidence_ref:proofRef}
                : {evidence_method:'SCAN',evidence_code:barcode.value.trim()})},
            runningMessage:manual?'Contrôle du constat et dépôt…':'Contrôle du code et dépôt…',
            successMessage:'Dépôt confirmé dans '+bag.reference+(manual?' · preuve manuelle':''),
          }).catch(()=>{});
        };
        barcode.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();deposit();}});
        proof.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();deposit();}});
        put.addEventListener('click',deposit);
        [source,method,barcode,proof,qty,put].forEach(node=>row.appendChild(node));
        holder.appendChild(row);
      }
      if (totalPlanned>0 && totalActual===totalPlanned && [...planned].every(([id,q])=>actual.get(id)===q)) {
        const close=makeActionButton(doc,'Fermer le sac','close-customer-bag');
        close.addEventListener('click',()=>runAction(context,close,{
          url:endpointFor(context.marketCode,'bags/'+encodeURIComponent(bag.unit_id)+'/close'),
          body:{},runningMessage:'Contrôle du contenu avant fermeture…',
          successMessage:bag.reference+' fermé et prêt pour KOM-BOX.',
        }).catch(()=>{}));
        holder.appendChild(close);
      }
      prep.appendChild(holder);
    });
    boxes.appendChild(prep);

    const composeCell = box => {
      const cell = doc.createElement('div');
      cell.className = 'kmc-workspace-box-compose';
      if (BOX_MUTABLE.has(box.state)) {
        // V1 : on scanne le sac FERMÉ, pas les allocations en vrac.
        // Le REPACK direct reste une API historique, mais n'est plus une action Hub Live.
        if (readyBags.length) {
          const boxScan=field('Scanner cette KOM-BOX une fois','Scanner référence de la KOM-BOX '+box.reference);
          boxScan.setAttribute('data-hub-box-scan','');
          context.hubVerifiedBoxes=context.hubVerifiedBoxes||{};
          boxScan.value=context.hubVerifiedBoxes[String(box.unit_id)]||'';
          const bagScan=field('Scanner le sac client','Scanner référence du sac client');
          bagScan.setAttribute('data-hub-bag-scan','');
          // Le serveur déduit le colis import unique de la commande du sac.
          // Sélection explicite uniquement pour l'exception : plusieurs colis possibles.
          const parcel=doc.createElement('select');
          parcel.setAttribute('aria-label','Colis client si plusieurs colis pour ce sac');
          parcel.hidden=true;
          const add=makeActionButton(doc,'Placer le sac','put-bag-in-box');
          const boxMethod=doc.createElement('select');
          boxMethod.setAttribute('aria-label','Mode de preuve du rattachement dans '+box.reference);
          boxMethod.setAttribute('data-hub-box-evidence-method','');
          [['SCAN','Références scannées'],['MANUAL','Mode dégradé · saisie manuelle']]
            .forEach(([value,label])=>boxMethod.appendChild(Object.assign(doc.createElement('option'),
              {value,textContent:label})));
          const boxProof=field('Justification de la saisie manuelle (au moins 6 caractères)',
            'Justification de la saisie manuelle dans '+box.reference);
          boxProof.setAttribute('data-hub-box-manual-proof','');
          boxProof.hidden=true;
          boxMethod.addEventListener('change',()=>{
            boxProof.hidden=boxMethod.value!=='MANUAL';
            if(boxProof.hidden)boxProof.value='';
          });
          const identify=()=>{
            const bag=readyBags.find(b=>b.reference===bagScan.value.trim());
            const matching=bag?(d.client_parcels||[]).filter(p=>String(p.order_id)===String(bag.order_id)):[];
            const selected=parcel.value;
            const ambiguous=matching.length>1;
            parcel.replaceChildren();
            if(ambiguous){
              parcel.appendChild(Object.assign(doc.createElement('option'),{value:'',textContent:'Choisir le colis client (cas exceptionnel)…'}));
              matching.forEach(p=>parcel.appendChild(Object.assign(doc.createElement('option'),{
                value:p.id,textContent:p.reference+' · '+bag.order_ref,
              })));
              if(matching.some(p=>p.id===selected))parcel.value=selected;
            }
            parcel.hidden=!ambiguous;
            add.disabled=!(bag&&boxScan.value.trim()===box.reference&&(!ambiguous||parcel.value));
            return bag;
          };
          boxScan.addEventListener('input',()=>{
            if(boxScan.value.trim()===box.reference){
              context.hubVerifiedBoxes[String(box.unit_id)]=box.reference;
            }else{
              delete context.hubVerifiedBoxes[String(box.unit_id)];
            }
            identify();
          });
          boxScan.addEventListener('keydown',event=>{
            if(event.key==='Enter'){event.preventDefault();bagScan.focus();}
          });
          bagScan.addEventListener('input',identify);
          bagScan.addEventListener('keydown',event=>{
            if(event.key==='Enter'){event.preventDefault();identify();(parcel.hidden?boxMethod:parcel).focus();}
          });
          parcel.addEventListener('change',identify);
          add.addEventListener('click',()=>{
            const bag=readyBags.find(b=>b.reference===bagScan.value.trim());
            if(!bag||boxScan.value.trim()!==box.reference||(!parcel.hidden&&!parcel.value))return;
            const manualBox=boxMethod.value==='MANUAL';
            const boxProofRef=String(boxProof.value||'').trim();
            if(manualBox&&boxProofRef.length<6){
              setFeedback(context.root,'Mode manuel : justification obligatoire (6 caractères minimum).','critical');
              return;
            }
            runAction(context,add,{
              url:endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/bags'),
              body:{
                bag_unit_id:bag.unit_id,...(!parcel.hidden?{parcel_id:parcel.value}:{}),
                bag_reference_scan:bagScan.value.trim(),box_reference_scan:boxScan.value.trim(),
                ...(manualBox?{evidence_method:'MANUAL',evidence_ref:boxProofRef}:{evidence_method:'SCAN'}),
              },
              runningMessage:'Contrôle du sac et de la KOM-BOX…',
              successMessage:bag.reference+' placé dans '+box.reference+' sans déplacement des articles.',
            }).catch(()=>{});
          });
          [boxScan,bagScan,parcel,boxMethod,boxProof,add].forEach(node=>cell.appendChild(node));
          identify();
        }else{
          cell.appendChild(text(doc,'span','kmc-workspace-muted','Préparer puis fermer un sac client avant mise en KOM-BOX.'));
        }
      }
      const next = BOX_NEXT_STATE[box.state];
      if (next && (box.contents || []).length) {
        const label = next === 'DISPATCHED' ? 'Prêt à remettre au transitaire' : `Étape suivante · ${next}`;
        const step = makeActionButton(doc, label, 'advance-box');
        step.addEventListener('click', () => runAction(context, step, {
          url: endpointFor(context.marketCode, `boxes/${box.unit_id}/advance`),
          body: { to_state: next },
          confirmMessage: next === 'DISPATCHED' ? `Confirmer que ${box.reference} est prêt pour la remise au transitaire ?` : undefined,
          runningMessage: 'Changement d’étape…',
          successMessage: `${box.reference} : ${next}.`,
        }).catch(() => {}));
        cell.appendChild(step);
      }
      return cell.children.length ? cell : '—';
    };

    boxes.appendChild(simpleTable(doc, ['', 'Carton', 'État', 'Contenu', 'Expédition', 'Composer', 'Action'],
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
        return [pick, box.reference, box.state, contents || '—', box.shipment_ref || '—', composeCell(box), action];
      }), 'Aucun carton.'));

    const secondary = doc.createElement('details');
    secondary.className = 'kmc-hub-physical-secondary';
    secondary.setAttribute('data-hub-physical-details', '');
    secondary.appendChild(text(doc, 'summary', '', 'Détails physiques exhaustifs · réceptions, sacs, KOM-BOX, expéditions'));
    [...rootNode.children].slice(secondaryStart).forEach(node => secondary.appendChild(node));
    rootNode.appendChild(secondary);
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

  // Côté Relais, une opération à la fois : les autres files restent dans le DOM,
  // mais sont masquées (et inaccessibles au clavier) jusqu'à sélection explicite.
  // Aucune requête ou mutation métier n'est déclenchée par cet aiguillage.
  const RELAY_OPERATION_KEYS=Object.freeze(['shipments','cash','receive','collect']);
  const isShipmentReceivable=shipment=>Boolean(shipment?.receivable && (shipment.boxes||[]).some(
    box=>(box.orders||[]).some(order=>(order.items||[]).some(item=>item.received===null))
  ));
  function showRelayOperation(rootNode, key) {
    if(!RELAY_OPERATION_KEYS.includes(key))return;
    for(const candidate of RELAY_OPERATION_KEYS) {
      const section=rootNode.querySelector('#relay-execution-'+candidate);
      if(section) {
        section.hidden=candidate!==key;
        section.setAttribute('data-relay-operation-visible',String(candidate===key));
      }
      const link=rootNode.querySelector('[data-relay-execution-jump="'+candidate+'"]');
      if(link) {
        if(candidate===key)link.setAttribute('aria-current','true');
        else link.removeAttribute('aria-current');
      }
    }
    rootNode.setAttribute('data-relay-active-operation',key);
  }

  // V1 SAV — une demande rattachée au VRAI article remis, sans réception
  // physique implicite ni opération financière. Les décisions restent dans
  // les litiges / autorités Komerce ; ce formulaire sert uniquement à signaler.
  function renderRelayReturnRequests(rootNode, ui, doc, context) {
    const slot = createSection(rootNode, ui, 'Retours & SAV',
      'Ouvrir un dossier, signaler une anomalie ou attester séparément la reprise physique. Aucun paiement automatique.');
    slot.setAttribute('data-relay-return-requests', '');

    const notice = text(doc, 'p', 'kmc-workspace-note',
      'La reprise est une preuve de dépôt, pas une décision de remboursement. Les articles repris restent isolés de la vente.');
    slot.appendChild(notice);

    const searchForm = doc.createElement('form');
    searchForm.setAttribute('data-relay-return-lookup', '');
    searchForm.className = 'kmc-workspace-section-actions';
    const reference = doc.createElement('input');
    reference.type = 'text';
    reference.required = true;
    reference.maxLength = 80;
    reference.placeholder = 'Référence commande';
    reference.setAttribute('aria-label', 'Référence de commande');
    reference.setAttribute('data-relay-return-reference', '');
    searchForm.appendChild(reference);
    const lookup = text(doc, 'button', 'kmc-workspace-action', 'Rechercher');
    lookup.type = 'submit';
    searchForm.appendChild(lookup);
    slot.appendChild(searchForm);

    const selection = doc.createElement('form');
    selection.setAttribute('data-relay-return-create', '');
    selection.className = 'kmc-workspace-inventory-list';
    selection.hidden = true;
    const product = doc.createElement('select');
    product.required = true;
    product.setAttribute('aria-label', 'Article réellement remis au client');
    product.setAttribute('data-relay-return-product', '');
    const qty = doc.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.value = '1';
    qty.required = true;
    qty.setAttribute('aria-label', 'Quantité concernée');
    const reason = doc.createElement('select');
    reason.required = true;
    reason.setAttribute('aria-label', 'Motif de retour');
    for (const [value, label] of [
      ['defective', 'Produit défectueux'],
      ['damaged', 'Produit cassé'],
      ['wrong_item', 'Mauvais article'],
      ['not_as_described', 'Non conforme'],
      ['other', 'Autre motif'],
    ]) {
      const option = text(doc, 'option', '', label);
      option.value = value;
      reason.appendChild(option);
    }
    const note = doc.createElement('textarea');
    note.maxLength = 500;
    note.rows = 2;
    note.placeholder = 'Commentaire complémentaire (obligatoire pour Autre)';
    note.setAttribute('aria-label', 'Commentaire SAV');
    const create = text(doc, 'button', 'kmc-workspace-action', 'Ouvrir le dossier SAV');
    create.type = 'submit';
    create.setAttribute('data-relay-return-submit', '');
    for (const [caption, control] of [
      ['Article', product], ['Quantité', qty], ['Motif', reason], ['Commentaire', note],
    ]) {
      const label = text(doc, 'label', 'kmc-workspace-note', caption);
      label.appendChild(control);
      selection.appendChild(label);
    }
    selection.appendChild(create);
    const remark = text(doc, 'button', 'kmc-workspace-action is-secondary',
      'Signaler une remarque sans retour');
    remark.type = 'button';
    remark.setAttribute('data-relay-quality-remark', '');
    selection.appendChild(remark);
    slot.appendChild(selection);
    const result = text(doc, 'p', 'kmc-workspace-note', '');
    result.setAttribute('role', 'status');
    result.setAttribute('data-relay-return-feedback', '');
    slot.appendChild(result);

    const list = doc.createElement('div');
    list.setAttribute('data-relay-return-list', '');
    slot.appendChild(list);

    // Physical attestation is a separate gesture from opening the SAV dossier.
    // A letter groups many parcels; the immutable receipt id identifies the unit.
    const intake = doc.createElement('form');
    intake.className = 'kmc-workspace-inventory-list';
    intake.setAttribute('data-relay-return-intake', '');
    intake.hidden = true;
    const intakeTitle = text(doc, 'h3', '', 'Attester une reprise physique');
    intake.appendChild(intakeTitle);
    const intakeRequest = doc.createElement('select');
    intakeRequest.required = true;
    intakeRequest.setAttribute('aria-label', 'Dossier SAV à reprendre');
    intakeRequest.setAttribute('data-relay-intake-request', '');
    const intakeCondition = doc.createElement('select');
    intakeCondition.required = true;
    intakeCondition.setAttribute('aria-label', 'État physique constaté');
    for (const [value, label] of [
      ['unknown', 'État à examiner'],
      ['sealed', 'Emballage fermé'],
      ['opened', 'Emballage ouvert'],
      ['damaged', 'Produit ou emballage endommagé'],
    ]) {
      const option = text(doc, 'option', '', label);
      option.value = value;
      intakeCondition.appendChild(option);
    }
    const intakeZone = doc.createElement('input');
    intakeZone.type = 'text';
    intakeZone.maxLength = 1;
    intakeZone.placeholder = 'A (facultatif)';
    intakeZone.setAttribute('aria-label', 'Lettre de zone facultative');
    const intakeNote = doc.createElement('textarea');
    intakeNote.required = true;
    intakeNote.minLength = 10;
    intakeNote.maxLength = 1000;
    intakeNote.rows = 2;
    intakeNote.placeholder = 'Constat physique au dépôt (10 caractères minimum)';
    intakeNote.setAttribute('aria-label', 'Constat physique de reprise');
    for (const [caption, control] of [
      ['Dossier', intakeRequest], ['État constaté', intakeCondition],
      ['Zone (facultative)', intakeZone], ['Constat', intakeNote],
    ]) {
      const label = text(doc, 'label', 'kmc-workspace-note', caption);
      label.appendChild(control);
      intake.appendChild(label);
    }
    const intakeSubmit = text(doc, 'button', 'kmc-workspace-action', 'Confirmer la réception');
    intakeSubmit.type = 'submit';
    intakeSubmit.setAttribute('data-relay-intake-submit', '');
    intake.appendChild(intakeSubmit);
    slot.appendChild(intake);
    let order = null;
    let items = [];

    const updateQuantity = () => {
      const chosen = items.find(item => item.id === product.value);
      qty.max = String(chosen?.remaining_returnable || 1);
      qty.value = '1';
    };
    product.addEventListener('change', updateQuantity);

    async function loadRequests() {
      try {
        const data = await jsonRequest(context.fetch, '/api/relay/returns');
        list.replaceChildren();
        const rows = Array.isArray(data.requests) ? data.requests : [];
        if (!rows.length) {
          list.appendChild(text(doc, 'p', 'kmc-workspace-empty', 'Aucun dossier SAV ouvert.'));
          return;
        }
        const wrap = doc.createElement('div');
        list.appendChild(wrap);
        ui.DataTable.render(wrap, {
          columns: [
            { key:'order_reference', label:'Commande' },
            { key:'product_name', label:'Article' },
            { key:'return_quantity', label:'Quantité' },
            { key:'return_reason', label:'Motif', format: (_raw, row) =>
              ({defective:'Défectueux',damaged:'Cassé',wrong_item:'Mauvais article',not_as_described:'Non conforme',other:'Autre'})[row.return_reason] || 'Autre' },
            { key:'status', label:'Dossier', format: (_raw, row) =>
              ({open:'À examiner',processing:'En traitement',resolved:'Résolu',closed:'Clôturé'})[row.status] || row.status },
            { key:'received_at', label:'Reprise physique', format: (_raw, row) =>
              row.receipt_id ? ('Reçu · ' + row.received_quantity + ' unité(s)' +
                (row.storage_zone ? ' · zone ' + row.storage_zone : '')) : 'Non repris' },
          ],
          rows,
          emptyText: 'Aucun dossier SAV.',
        });
        // Only open/processing requests without physical evidence may be received.
        const pendingIntakes = rows.filter(row => !row.receipt_id &&
          (row.status === 'open' || row.status === 'processing'));
        intakeRequest.replaceChildren();
        for (const pending of pendingIntakes) {
          const option = text(doc, 'option', '',
            pending.order_reference + ' · ' + pending.product_name +
            ' · ' + pending.return_quantity + ' unité(s)');
          option.value = pending.id;
          intakeRequest.appendChild(option);
        }
        intake.hidden = pendingIntakes.length === 0;
      } catch (error) { result.textContent = 'Liste SAV indisponible : ' + error.message; }
    }

    intake.addEventListener('submit', async event => {
      event.preventDefault();
      if (!intakeRequest.value) return;
      const evidence = intakeNote.value.trim();
      if (evidence.length < 10) {
        result.textContent = 'Décrivez le constat physique de la reprise.';
        return;
      }
      intakeSubmit.disabled = true;
      result.textContent = 'Enregistrement de la reprise physique…';
      try {
        await jsonRequest(context.fetch, '/api/relay/returns/intake', {
          method: 'POST', body: {
            request_id: intakeRequest.value,
            condition_code: intakeCondition.value,
            storage_zone: intakeZone.value.trim().toUpperCase() || null,
            observation: evidence,
          },
        });
        intakeNote.value = '';
        intakeZone.value = '';
        result.textContent = 'Reprise attestée. Produit isolé : aucun crédit wallet, remboursement ni stock vendable.';
        // Après un POST réussi, ne jamais laisser confirmer une seconde fois si la relecture échoue.
        intake.hidden = true;
        await loadRequests();
      } catch (error) {
        result.textContent = error.message;
      } finally {
        intakeSubmit.disabled = false;
      }
    });

    searchForm.addEventListener('submit', async event => {
      event.preventDefault();
      selection.hidden = true;
      order = null;
      items = [];
      lookup.disabled = true;
      result.textContent = 'Recherche de la commande…';
      try {
        const data = await jsonRequest(context.fetch,
          '/api/relay/returns/eligible?reference=' + encodeURIComponent(reference.value.trim()));
        order = data.order;
        items = (data.items || []).filter(item => item.remaining_returnable > 0);
        product.replaceChildren();
        for (const item of items) {
          const option = text(doc, 'option', '',
            item.product_name + ' · ' + item.remaining_returnable + ' unité(s) remises disponibles');
          option.value = item.id;
          product.appendChild(option);
        }
        if (!items.length) {
          result.textContent = 'Aucun article remis éligible ou une demande est déjà en cours.';
        } else {
          updateQuantity();
          selection.hidden = false;
          result.textContent = 'Sélectionnez l’article et le motif ; aucun crédit n’est créé.';
        }
      } catch (error) { result.textContent = error.message; }
      finally { lookup.disabled = false; }
    });

    remark.addEventListener('click', async () => {
      const chosen = items.find(item => item.id === product.value);
      if (!order || !chosen) return;
      if (note.value.trim().length < 5) {
        result.textContent = 'Décrivez votre remarque en quelques mots.';
        return;
      }
      remark.disabled = true;
      result.textContent = 'Envoi de la remarque au Catalogue…';
      try {
        await jsonRequest(context.fetch, '/api/relay/returns/remarks', {
          method: 'POST', body: {
            order_reference: order.reference, order_item_id: chosen.id,
            note: note.value.trim(),
          },
        });
        note.value = '';
        result.textContent = 'Remarque enregistrée sur la référence Catalogue. Aucun retour, gel ou paiement déclenché.';
      } catch (error) {
        result.textContent = error.message;
      } finally { remark.disabled = false; }
    });

    selection.addEventListener('submit', async event => {
      event.preventDefault();
      const chosen = items.find(item => item.id === product.value);
      if (!order || !chosen) return;
      const count = Number(qty.value);
      if (!Number.isSafeInteger(count) || count < 1 || count > chosen.remaining_returnable) {
        result.textContent = 'Quantité supérieure aux articles remis disponibles.';
        return;
      }
      if (reason.value === 'other' && note.value.trim().length < 3) {
        result.textContent = 'Précisez le motif du retour.';
        return;
      }
      create.disabled = true;
      result.textContent = 'Enregistrement de la demande…';
      try {
        await jsonRequest(context.fetch, '/api/relay/returns', {
          method: 'POST', body: {
            order_reference: order.reference, order_item_id: chosen.id,
            quantity: count, reason: reason.value, note: note.value.trim(),
          },
        });
        selection.hidden = true;
        order = null;
        items = [];
        result.textContent = 'Dossier SAV enregistré. À examiner par Komerce ; aucun retour physique ou wallet confirmé.';
        await loadRequests();
      } catch (error) { result.textContent = error.message; }
      finally { create.disabled = false; }
    });

    loadRequests().catch(() => {});
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.setAttribute('data-workspace-kind', 'hub-relay');
    rootNode.setAttribute('data-workspace-mode', context.mode);
    rootNode.setAttribute('data-relay-counter',context.focusOnly?'true':'false');
    rootNode.replaceChildren();
    const header=createHeader(doc,payload,context.mode);
    if(context.mode==='relay-execution') {
      // Le rail métier fournit déjà l'accès Flux Relais : pas de deuxième lien identique.
      header.querySelector('.kmc-workspace-nav')?.remove();
    }
    if(context.focusOnly) {
      header.querySelector('.kmc-workspace-kicker').textContent='RELAIS · COMPTOIR';
      header.querySelector('.kmc-workspace-title').textContent='Remises client';
      header.querySelector('.kmc-workspace-subtitle').textContent=
        context.marketCode+' · Identifier le bon colis, vérifier les conditions de retrait, attester la remise.';
    }
    rootNode.appendChild(header);
    if(context.mode==='relay-execution') {
      const nav=doc.createElement('nav');
      nav.className='kmc-relay-main-nav';
      nav.setAttribute('aria-label','Espaces de travail du relais');
      const activeRelayTab=context.focusOnly?'Remises':context.view==='returns'?'Incidents & SAV':'Flux Relais';
      const links=[
        ['Flux Relais','/admin/relais-live'+(context.marketCode?'?market='+encodeURIComponent(context.marketCode):''),activeRelayTab==='Flux Relais'],
        ['Remises','/admin/relais-live?view=remises&market='+encodeURIComponent(context.marketCode),activeRelayTab==='Remises'],
        ['Incidents & SAV','/admin/relais-live?view=incidents&market='+encodeURIComponent(context.marketCode),activeRelayTab==='Incidents & SAV'],
        ['Historique','/admin/relais-live?view=orders&list=collected&market='+encodeURIComponent(context.marketCode),false],
      ];
      for(const [title,href,active] of links) {
        const link=text(doc,'a','kmc-relay-main-tab',title);
        link.href=href;
        if(active)link.setAttribute('aria-current','page');
        nav.appendChild(link);
      }
      rootNode.appendChild(nav);
    }

    // En Hub Live le dossier porte déjà les quatre indicateurs de sa projection
    // serveur. Ne pas répéter les métriques Relais ni repousser la file sous le pli.
    if (context.mode !== 'execution' && context.mode !== 'relay-execution') {
      const metrics = doc.createElement('section');
      metrics.className = 'kmc-workspace-metrics';
      rootNode.appendChild(metrics);
      ui.MetricStrip.render(metrics, { items: context.mode==='relay-execution' ? metricItems(payload.summary).filter(x=>['cash','receive','collect'].includes(x.key)) : metricItems(payload.summary) });
    }

    // UX-07 : une vue = une question. Un seul groupe de sections à la fois.
    // Mode « execution » (Hub live) : uniquement les actions Hub ; les actions Relais restent hors de cette surface.
    const views = context.mode === 'relay-execution' ? RELAY_LIVE_TABS
      : context.mode === 'execution' ? EXECUTION_VIEWS : WORKSPACE_VIEWS;
    const view = views.some(item => item.id === context.view) ? context.view : views[0].id;
    if(!context.focusOnly)rootNode.appendChild(createViewTabs(doc, view, nextView => {
      context.view = nextView;
      renderPayload(rootNode, ui, doc, payload, context);
    }, views));

    if (context.mode==='relay-execution' && view==='relay' && !context.focusOnly) {
      const relay=payload.queues?.relay||{};
      const allShipments=context.relayShipments?.shipments;
      const pending=Array.isArray(allShipments)?allShipments.filter(isShipmentReceivable).length:null;
      const choices=[
        {key:'shipments',label:'Arrivages',count:pending},
        {key:'cash',label:'Encaisser',count:(relay.cash_pending||[]).length},
        {key:'receive',label:'Réception locale',count:(relay.local_receipt_pending||[]).length+(relay.to_receive||[]).filter(x=>x.local_receivable===true).length},
        {key:'collect',label:'Remise client',count:(relay.to_collect||[]).length},
      ];
      if(!RELAY_OPERATION_KEYS.includes(context.activeRelayQueue)) {
        context.activeRelayQueue=RELAY_OPERATION_KEYS.includes(context.initialFocus)?context.initialFocus:
          (pending>0?'shipments':relay.to_collect?.length?'collect':
          relay.cash_pending?.length?'cash':
          relay.local_receipt_pending?.length || relay.to_receive?.some(x=>x.local_receivable===true)?'receive':'shipments');
      }
      const dock=doc.createElement('nav');
      dock.className='kmc-relay-execution-jumpbar';
      dock.setAttribute('aria-label','Choisir une opération du relais');
      for(const choice of choices) {
        const link=doc.createElement('a');
        link.className='kmc-relay-execution-jump';
        link.href='#relay-execution-'+choice.key;
        link.setAttribute('data-relay-execution-jump',choice.key);
        link.appendChild(text(doc,'strong','',choice.label));
        if(choice.count!==null)link.appendChild(text(doc,'b','',String(choice.count)));
        link.addEventListener('click',()=>{
          context.activeRelayQueue=choice.key;
          showRelayOperation(rootNode,choice.key);
        });
        dock.appendChild(link);
      }
      rootNode.appendChild(dock);
    }

    if ((view === 'hub' || view === 'inventory') && isHubReadOnly(context)) renderExecuteLink(rootNode, doc, context);

    if (view === 'hub') {
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
        { key: 'action', label: 'Action', align: 'right' },
      ],
      rows: payload.distribution.unassigned,
      emptyText: 'Aucune commande à répartir.',
    });
    // Répartition d'UNE commande (même writer et mêmes droits que « Répartir ce marché »).
    if (!isHubReadOnly(context)) {
      distributionTable.querySelectorAll('tbody tr').forEach((rowNode, index) => {
        const row = payload.distribution.unassigned[index];
        const actionCell = rowNode.lastChild;
        if (!row || !actionCell) return;
        actionCell.replaceChildren();
        const button = makeActionButton(doc, 'Répartir', 'distribute-order');
        actionCell.appendChild(button);
        button.addEventListener('click', () => runAction(context, button, {
          url: endpointFor(context.marketCode, `orders/${encodeURIComponent(row.reference)}/distribute`),
          confirmMessage: `Répartir la commande ${row.reference} ?`,
          runningMessage: `${row.reference} · répartition en cours…`,
          successMessage: `${row.reference} · répartition terminée.`,
        }).catch(() => {}));
      });
    }

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
    context.relayCollectCount=payload.queues?.relay?.to_collect?.length||0;
    if(!context.focusOnly) {
    renderRelayShipmentsSection(rootNode, ui, doc, context);
    renderOrderActionSection(rootNode, ui, doc, context, {
      title: 'Encaisser les paiements',
      description: 'Confirmer uniquement les paiements cash réellement reçus.',
      rows: payload.queues.relay.cash_pending,
      action: 'confirm-cash',
      jumpId:'relay-execution-cash',
      actionLabel: 'Encaisser',
      suffix: row => `orders/${encodeURIComponent(row.reference)}/confirm-cash`,
      confirm: row => `Confirmer l’encaissement cash de ${row.reference} ?`,
      empty: 'Aucun paiement cash à encaisser.',
    });

    // Deux circuits de réception sous UN seul aiguillage. Une commande
    // LOCAL_STOCK directe n'est jamais assimilée à un colis expédié.
    const localReceiveLane = doc.createElement('div');
    localReceiveLane.id = 'relay-execution-receive';
    localReceiveLane.setAttribute('data-relay-local-receive-lane', '');
    rootNode.appendChild(localReceiveLane);
    renderDirectLocalReceiptSection(localReceiveLane, ui, doc, context,
      payload.queues.relay.local_receipt_pending || []);

    // Geste réservé au colis local déjà expédié par le Hub (ancien circuit).
    // Le tableau reste dans la même file de réception, sans doublon de navigation.
    renderParcelActionSection(localReceiveLane, ui, doc, context, {
      title: 'Réception locale',
      description: 'Réceptionner les colis locaux autorisés, avec preuve.',
      rows: payload.queues.relay.to_receive.filter(row => row.local_receivable === true),
      action: 'receive',
      actionLabel: 'Reçu au relais',
      suffix: row => `parcels/${encodeURIComponent(row.reference)}/receive`,
      confirm: row => `Confirmer la réception de ${row.reference} au relais ?`,
      empty: 'Aucun colis local à réceptionner.',
    });
    }

    renderPickupCodeSection(rootNode, ui, doc, context, {
      title: 'Remettre au client',
      description: 'Sans scanner : demandez le code complet au client et saisissez-le au clavier. Le serveur vérifie le code, le relais et le prochain lot avant toute remise.',
      rows: payload.queues.relay.to_collect,
      jumpId:'relay-execution-collect',
      empty: 'Aucun colis à remettre.',
    });
      if(context.mode==='relay-execution' && !context.focusOnly) {
        showRelayOperation(rootNode,context.activeRelayQueue);
      }
    }

    if (view === 'returns' && context.mode === 'relay-execution') renderRelayReturnRequests(rootNode, ui, doc, context);

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
    if (config.jumpId && slot.parentElement) slot.parentElement.id=config.jumpId;
    renderActionRows(slot, doc, context, config, 'order');
  }

  // Attestation réelle au relais : le statut d'une commande n'est jamais une
  // preuve physique. L'agent coche explicitement la possession et ajoute une
  // référence/observation ; le serveur conserve la preuve canonique dans scans.
  function renderDirectLocalReceiptSection(rootNode, ui, doc, context, rows) {
    const slot = createSection(rootNode, ui, 'Relais · Réception locale directe',
      'Commande payée avec articles en stock local : réception physique au relais, sans Hub ni expédition fictive.');
    slot.setAttribute('data-relay-direct-local-receipts', '');
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune commande locale en attente de réception physique.'));
      return;
    }
    rows.forEach(row => {
      // Seul l'identifiant serveur est utilisé ; le marché client n'est jamais
      // une source d'autorité pour cette mutation.
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(String(row.id || ''))) return;
      const card = doc.createElement('div');
      card.className = 'kmc-workspace-manual-reason';
      card.setAttribute('data-relay-local-order', row.reference);
      const heading = text(doc, 'strong', 'kmc-workspace-ref-text', row.reference);
      const meta = text(doc, 'span', 'kmc-workspace-muted',
        [row.client_name, row.relais_name, 'Articles ' + (row.item_count || '—')].filter(Boolean).join(' · '));
      const label = doc.createElement('label');
      const received = doc.createElement('input');
      received.type = 'checkbox';
      received.setAttribute('data-local-physical-proof', '');
      label.append(received, doc.createTextNode(' Articles physiquement reçus et contrôlés'));
      const note = doc.createElement('input');
      note.type = 'text';
      note.maxLength = 500;
      note.placeholder = 'Référence ou observation de réception (obligatoire)';
      note.setAttribute('aria-label', 'Référence ou observation de réception pour ' + row.reference);
      note.setAttribute('data-local-receipt-note', '');
      const button = makeActionButton(doc, 'Attester la réception', 'local-relay-receipt');
      button.addEventListener('click', () => {
        if (button.disabled) return;
        if (!received.checked || !note.value.trim()) {
          setFeedback(context.root, 'Confirmez la réception physique et renseignez une référence ou observation.', 'critical');
          return;
        }
        runAction(context, button, {
          url: '/api/orders/' + encodeURIComponent(row.id) + '/local-relay-receipt',
          body: { physical_received: true, note: note.value.trim() },
          confirmMessage: 'Attester la réception physique de ' + row.reference + ' dans ce relais ?',
          runningMessage: row.reference + ' · réception en cours…',
          successMessage: row.reference + ' · réception physique attestée. Colis disponible au relais.',
        }).catch(() => {});
      });
      card.append(heading, meta, label, note, button);
      slot.appendChild(card);
    });
  }

  // Mode dégradé : la confirmation depuis l'interface remplace le scan matériel ; le motif est obligatoire et tracé.
  const MANUAL_REASONS = Object.freeze([
    ['manual_entry', 'Saisie manuelle volontaire'],
    ['scanner_unavailable', 'Scanner indisponible'], ['label_unreadable', 'Étiquette illisible'],
    ['offline', 'Hors ligne'], ['other', 'Autre (précisez)'],
  ]);

  function manualReasonControls(doc) {
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-manual-reason';
    wrap.setAttribute('data-manual-confirmation', '');
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'Motif de la confirmation sans scan');
    select.setAttribute('data-manual-reason', '');
    MANUAL_REASONS.forEach(([value, label]) => select.appendChild(Object.assign(doc.createElement('option'), { value, textContent: label })));
    const note = doc.createElement('input');
    note.type = 'text'; note.maxLength = 500; note.placeholder = 'Précision (obligatoire si « Autre »)';
    note.setAttribute('aria-label', 'Précision du motif'); note.setAttribute('data-manual-note', '');
    wrap.appendChild(text(doc, 'span', 'kmc-workspace-muted', 'Confirmation sans scan · motif : '));
    wrap.appendChild(select); wrap.appendChild(note);
    return { wrap, body: () => ({ reason: select.value, ...(note.value.trim() ? { note: note.value.trim() } : {}) }) };
  }

  function renderParcelActionSection(rootNode, ui, doc, context, config) {
    const slot = createSection(rootNode, ui, config.title, config.description);
    if (config.jumpId && slot.parentElement) slot.parentElement.id=config.jumpId;
    const manual = manualReasonControls(doc);
    if ((config.rows||[]).length) slot.appendChild(manual.wrap);
    renderActionRows(slot, doc, context, Object.assign({}, config, { manualBody: manual.body }), 'parcel');
  }

  /**
   * Retrait sans scanner : le code fourni par le destinataire est saisi au
   * clavier dans le même guichet que la file d'attente. Le writer de retrait
   * canonique vérifie le secret complet, les droits inter-relais et le statut
   * dans une seule transaction ; aucun scan logistique customer_collected.
   * Ne pas prétendre que le bouton d'une ligne choisit un colis : un code
   * retire le prochain lot AVAILABLE de la commande correspondante.
   */
  function renderPickupCodeSection(rootNode, ui, doc, context, config) {
    const slot = createSection(rootNode, ui, config.title, config.description);
    if (config.jumpId && slot.parentElement) slot.parentElement.id = config.jumpId;
    renderActionTable(slot, {
      rows: config.rows,
      emptyText: config.empty,
      columns: actionColumns({ referenceKind: 'parcel' }).slice(0, -1),
    });
    if (!(config.rows || []).length) return;

    const zone = doc.createElement('div');
    zone.className = 'kmc-workspace-manual-pickup';
    zone.setAttribute('data-manual-pickup-code', '');
    const label = doc.createElement('label');
    label.textContent = 'Code de retrait communiqué par le client';
    const input = doc.createElement('input');
    input.type = 'password'; // Secret client masqué à l'écran, même en saisie clavier.
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 16;
    input.placeholder = 'Code complet (8 caractères)';
    input.setAttribute('aria-label', 'Code de retrait client complet');
    input.setAttribute('data-pickup-code-input', '');
    label.appendChild(input);
    const button = makeActionButton(doc, 'Vérifier et remettre', 'confirm-pickup-code');
    button.type = 'button';
    button.setAttribute('data-pickup-code-confirm', '');
    const note = text(doc, 'p', 'kmc-workspace-muted',
      'Sans code : ne confirmez pas la remise. Utilisez uniquement la procédure nominative exceptionnelle autorisée. La saisie manuelle ne remplace pas la vérification du destinataire.');
    zone.appendChild(label);
    zone.appendChild(button);
    zone.appendChild(note);
    slot.appendChild(zone);

    const submit = async () => {
      // Le guichet sans sélection de commande exige impérativement le code
      // complet ; ni les 4 derniers caractères ni une référence colis
      // visible dans la file ne prouvent l'autorisation de retrait.
      const code = String(input.value || '').toUpperCase().replace(/[\s-]/g, '');
      if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) {
        setFeedback(context.root, 'Code complet de 8 caractères requis pour la remise.', 'critical');
        return;
      }
      await runAction(context, button, {
        url: '/api/scans/collect',
        body: { pickup_code: code },
        confirmMessage: 'Le client est présent, le code de retrait est complet et vous allez remettre le prochain lot disponible de sa commande. Confirmer ?',
        runningMessage: 'Vérification du code et enregistrement du retrait…',
        onSuccess: () => { input.value = ''; },
        successMessage: result => 'Remise vérifiée par code · ' +
          String(result.parcel_reference || result.reference || result.order_ref || 'lot confirmé') +
          (result.partial ? ' · autres lots à retirer' : ' · commande terminée'),
      });
    };
    button.addEventListener('click', () => { submit().catch(() => {}); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); button.click(); }
    });
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
        ...(config.manualBody ? { body: config.manualBody() } : {}),
        confirmMessage: config.confirm(row),
        runningMessage: `${row.reference} · action en cours…`,
        successMessage: `${row.reference} · action appliquée.`,
      }).catch(() => {}));
    });
  }

  // Relais live — contenu réellement expédié, déroulable Expédition → KOM-BOX → commandes → articles.
  // Le reçu n'est jamais prérempli : il n'existe que par attestation du relais, article par article.
  function renderRelayShipmentsSection(rootNode, ui, doc, context) {
    const slot = createSection(rootNode, ui, 'Arrivages importés',
      'Choisissez une expédition à réceptionner. Les expéditions sans intervention sont dans les archives ci-dessous.');
    if(slot.parentElement)slot.parentElement.id='relay-execution-shipments';
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
    const pending=data.shipments.filter(isShipmentReceivable);
    const other=data.shipments.filter(shipment=>!isShipmentReceivable(shipment));
    slot.setAttribute('data-relay-arrivals-pending',String(pending.length));
    if(!pending.length) {
      const done=doc.createElement('div');
      done.className='kmc-relay-work-done kmc-relay-arrival-empty';
      done.appendChild(text(doc,'strong','', 'Aucun arrivage à réceptionner'));
      done.appendChild(text(doc,'span','',other.length+' expédition(s) sans réception à effectuer, consultables dans l’historique.'));
      const collectCount=Number(context.relayCollectCount||0);
      if(collectCount>0) {
        const next=text(doc,'a','kmc-relay-arrival-next',collectCount+' remise(s) client en attente · Ouvrir');
        next.href='#relay-execution-collect';
        next.setAttribute('data-relay-next-operation','collect');
        next.addEventListener('click',()=>{
          context.activeRelayQueue='collect';
          showRelayOperation(rootNode,'collect');
        });
        done.appendChild(next);
      }
      slot.appendChild(done);
    } else {
      slot.appendChild(text(doc,'p','kmc-relay-work-count',
        pending.length+' expédition(s) nécessitant une réception. Ouvrez uniquement l’arrivage à contrôler.'));
    }
    const archive=doc.createElement('details');
    archive.className='kmc-relay-shipment-archive';
    archive.setAttribute('data-relay-shipment-archive','');
    archive.appendChild(text(doc,'summary','', 'Historique · '+other.length+' expédition(s)'));
    [...pending,...other].forEach(shipment => {
      const actionable=isShipmentReceivable(shipment);
      const card=doc.createElement('details');
      card.className='kmc-relay-shipment';
      card.open=actionable && pending[0]===shipment;
      card.setAttribute('data-relay-shipment',shipment.reference);
      card.setAttribute('data-relay-receivable',String(actionable));
      const summary=doc.createElement('summary');
      summary.className='kmc-relay-shipment-title';
      summary.appendChild(text(doc,'strong','kmc-relay-shipment-reference',shipment.reference));
      summary.appendChild(text(doc,'span','kmc-relay-shipment-subtitle',
        (shipment.boxes||[]).length+' carton(s) · '+
        (shipment.boxes||[]).reduce((count,box)=>count+(box.orders||[]).length,0)+' commande(s)'));
      summary.appendChild(text(doc,'span','kmc-relay-shipment-status',
        actionable?'À réceptionner':shipment.stage==='relay_received'?'Réception attestée':'Aucune réception en attente'));
      card.appendChild(summary);
      // Un premier clic historique ne déplie PAS les tableaux d’articles.
      // La traçabilité complète reste accessible par un second niveau, sur demande.
      let detailHost=card;
      if(!actionable) {
        const detailed=doc.createElement('details');
        detailed.className='kmc-relay-archive-detail';
        detailed.setAttribute('data-relay-archive-detail','');
        detailed.appendChild(text(doc,'summary','','Voir colis, articles et retrouver un sac'));
        card.appendChild(detailed);
        detailHost=detailed;
      }
      // Même sac physique que celui fermé au Hub : son scan ouvre la commande
      // et le colis canonique, sans attester automatiquement la réception.
      const scanBar=doc.createElement('div');
      scanBar.className='kmc-hub-bag-controls';
      scanBar.setAttribute('data-relay-bag-scanner','');
      const bagCode=doc.createElement('input');
      bagCode.type='text';bagCode.autocomplete='off';
      bagCode.placeholder='Scanner un sac de cette expédition';
      bagCode.setAttribute('aria-label','Scanner le sac client reçu au relais');
      const scan=makeActionButton(doc,'Identifier le sac','relay-lookup-bag');
      const result=text(doc,'span','kmc-workspace-muted','Scanner un sac pour retrouver la commande et le colis client.');
      result.setAttribute('role','status');
      const identify=async()=>{
        const code=bagCode.value.trim();if(!code)return;
        scan.disabled=true;result.textContent='Recherche du sac dans cette expédition…';
        try{
          const info=await jsonRequest(context.fetch,endpointFor(context.marketCode,
            'relay-shipments/'+encodeURIComponent(shipment.reference)+'/bags/'+encodeURIComponent(code)));
          result.textContent=info.bag_reference+' → commande '+info.order_reference+
            ' · colis '+info.parcel_reference+' · '+
            (info.contents||[]).map(item=>(item.product_name||'Article')+' ×'+item.quantity).join(', ');
        }catch(err){
          result.textContent='Sac non reconnu dans cette expédition ou non autorisé pour ce relais.';
        }finally{scan.disabled=false;}
      };
      bagCode.addEventListener('keydown',event=>{
        if(event.key==='Enter'){event.preventDefault();identify();}
      });
      scan.addEventListener('click',identify);
      [bagCode,scan,result].forEach(node=>scanBar.appendChild(node));
      detailHost.appendChild(scanBar);
      const inputs = [];
      shipment.boxes.forEach(box => {
        const boxNode = doc.createElement('div');
        boxNode.className = 'kmc-relay-box';
        boxNode.setAttribute('data-relay-box', box.reference);
        boxNode.appendChild(text(doc, 'h4', 'kmc-relay-box-title', 'KOM-BOX ' + box.reference));
        (box.bags || []).forEach(bag => boxNode.appendChild(text(doc, 'div', 'kmc-workspace-muted',
          'Sac '+bag.reference+' · commande '+bag.order_reference+' · colis '+bag.parcel_reference)));
        box.orders.forEach(order => {
          boxNode.appendChild(text(doc, 'div', 'kmc-workspace-muted', 'Commande ' + order.reference));
          const table = doc.createElement('table');
          table.className = 'kmc-workspace-table';
          table.innerHTML = actionable
            ? '<thead><tr><th>Article</th><th>Expédié</th><th>Manquant</th><th>Reçu</th></tr></thead>'
            : '<thead><tr><th>Article</th><th>Expédié</th><th>Reçu</th><th>Remis</th></tr></thead>';
          const tbody = doc.createElement('tbody');
          order.items.forEach(item => {
            const tr = doc.createElement('tr');
            tr.setAttribute('data-relay-item', item.order_item_id);
            const productLabel=item.product+(!actionable && Number(item.missing)>0
              ? ' · reste '+formatNumber(item.missing)+' à livrer' : '');
            const columns=actionable
              ? [productLabel,formatNumber(item.shipped),formatNumber(item.missing)]
              : [productLabel,formatNumber(item.shipped)];
            columns.forEach(value=>tr.appendChild(text(doc,'td','',value)));
            const receivedCell = doc.createElement('td');
            if (item.received !== null) {
              receivedCell.textContent = formatNumber(item.received) + (item.incident_id ? ' · incident ouvert' : '');
            } else if (shipment.receivable) {
              const input = doc.createElement('input');
              input.type = 'number';
              input.min = '0';
              input.max = String(item.expected);
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
            if(!actionable)tr.appendChild(text(doc,'td','',formatNumber(item.handed)));
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          const wrap = doc.createElement('div');
          wrap.className = 'kmc-workspace-table-wrap';
          wrap.appendChild(table);
          boxNode.appendChild(wrap);
        });
        detailHost.appendChild(boxNode);
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
            if (qty > Number(item.expected)) {
              setFeedback(context.root, 'Reçu supérieur à l’expédié pour ' + item.product + ' (' + formatNumber(item.expected) + ' max).', 'critical');
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
        detailHost.appendChild(form);
      }
      (actionable?slot:archive).appendChild(card);
    });
    if(other.length)slot.appendChild(archive);
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

    if(options.mode==='relay-execution' && options.focusOnly && options.user?.role==='finance') {
      rootNode.replaceChildren();
      const notice=doc.createElement('p');
      notice.className='kmc-workspace-empty';
      notice.textContent='Le comptoir des remises est réservé aux agents autorisés du Relais.';
      rootNode.appendChild(notice);
      return Object.freeze({marketCode,denied:true});
    }

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
      user: options.user || null,
      initialFocus: options.forcedRelayFocus || (options.mode==='relay-execution' ? String(new URLSearchParams(String(globalThis.location?.search||'')).get('focus')||'') : ''),
      focusOnly:Boolean(options.focusOnly),
      activeRelayQueue:null,
      view: options.focusOnly?'relay':options.mode === 'execution' ? 'supply' : options.mode === 'relay-execution' && new URLSearchParams(String(globalThis.location?.search || '')).get('focus') === 'returns' ? 'returns' : undefined,
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
      // Orientation de l'agent vers la file demandée depuis le cockpit.
      // Seules les files existantes sont navigables ; aucune action métier n'est exécutée ici.
      if (context.mode==='relay-execution' && !context.focusOnly && ['shipments','cash','receive','collect'].includes(context.initialFocus)) {
        const anchor=rootNode.querySelector?.('#relay-execution-'+context.initialFocus);
        anchor?.scrollIntoView?.({block:'start',behavior:'auto'});
      }
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
    openManualSourcing,
    mount,
  });
});
