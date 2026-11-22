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
  const activeHubMounts = new WeakMap();

  function endpointFor(marketCode, suffix = '') {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_operations_workspace_market_required');
    const tail = suffix ? '/' + String(suffix).replace(/^\/+/, '') : '';
    return ENDPOINT_PREFIX + encodeURIComponent(code) + tail;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'â€”';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return `${formatNumber(value)} KMF`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'â€”';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function orderLink(doc, reference) {
    const link = text(doc, 'a', 'kmc-workspace-ref', reference || 'â€”');
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
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      error.retryAfter = response.headers?.get?.('Retry-After') || null;
      throw error;
    }
    return body;
  }

  const HUB_POLL_INTERVAL_MS = 30 * 1000;
  const HUB_POLL_MAX_BACKOFF_MS = 5 * 60 * 1000;

  function hubPollDelayMs(failures, retryAfter = null, now = Date.now()) {
    const attempts = Math.max(0, Number(failures) || 0);
    const exponential = attempts
      ? Math.min(HUB_POLL_MAX_BACKOFF_MS, HUB_POLL_INTERVAL_MS * (2 ** Math.min(attempts, 4)))
      : HUB_POLL_INTERVAL_MS;
    let serverDelay = 0;
    if (typeof retryAfter === 'string' && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) {
      serverDelay = Number(retryAfter.trim()) * 1000;
    } else if (retryAfter) {
      const until = Date.parse(String(retryAfter));
      if (Number.isFinite(until)) serverDelay = Math.max(0, until - now);
    }
    return Math.max(exponential, Number.isFinite(serverDelay) ? serverDelay : 0);
  }

  function createHeader(doc, payload, mode) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');

    const copy = doc.createElement('div');
    const relayExec = mode === 'relay-execution';
    const execution = mode === 'execution' || relayExec;
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', relayExec ? 'RELAIS LIVE Â· EXÃ‰CUTION' : execution ? 'HUB LIVE Â· EXÃ‰CUTION' : 'HUB & RELAIS'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', relayExec ? 'Poste de travail Relais' : execution ? 'Hub live Â· Dossiers' : 'Flux Ã  traiter'));
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} Â· ${payload.scope.name} Â· ${relayExec ? 'RÃ©ceptionner Â· Encaisser Â· Remettre â€” uniquement sur preuve' : execution ? 'suivre les PO, rÃ©ceptionner, affecter et prÃ©parer les expÃ©ditions' : 'voir ce qui attend une action'}`
    ));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const operations = text(doc, 'a', 'kmc-workspace-nav-link', relayExec ? 'â† Relais live' : 'â† Dashboard OpÃ©rations');
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
      { key: 'distribution', label: 'Ã€ rÃ©partir', value: formatNumber(summary.hub_unassigned), tone: summary.hub_unassigned ? 'warning' : 'neutral' },
      { key: 'ship', label: 'Hub Â· ExpÃ©dier', value: formatNumber(summary.hub_to_ship), tone: summary.hub_to_ship ? 'warning' : 'neutral' },
      { key: 'cash', label: 'Relais Â· Encaisser', value: formatNumber(summary.relay_cash_pending), tone: summary.relay_cash_pending ? 'warning' : 'neutral' },
      { key: 'receive', label: 'Relais Â· RÃ©ceptionner', value: formatNumber(summary.relay_to_receive), tone: summary.relay_to_receive ? 'warning' : 'neutral' },
      { key: 'collect', label: 'Relais Â· Remettre', value: formatNumber(summary.relay_to_collect), tone: summary.relay_to_collect ? 'warning' : 'neutral' },
      { key: 'inventory', label: 'Inventaire Â· Affecter', value: formatNumber(summary.inventory_to_assign), tone: summary.inventory_to_assign ? 'warning' : 'neutral' },
    ];
  }

  /**
   * Couche de pilotage additive â€” au-dessus des files d'exÃ©cution
   * existantes (metricItems + renderOrderActionSection), jamais Ã  leur
   * place. Consomme payload.signals (services/operations-workspace.js#
   * querySignals), jamais de recalcul mÃ©tier cÃ´tÃ© navigateur
   * (doctrine dashboard_no_business_recompute).
   *
   * Volontairement absent : aucun signal "stock sous seuil d'alerte" par
   * hub/relais â€” cette notion n'existe dans aucune table du schÃ©ma
   * aujourd'hui (vÃ©rifiÃ©). L'inventer aurait affichÃ© un chiffre qui a
   * l'air rÃ©el sans l'Ãªtre.
   */
  function signalItems(signals = {}) {
    return [
      { key: 'collectes-retard', label: 'Collectes en retard', value: formatNumber(signals.collectes_en_retard), tone: signals.collectes_en_retard ? 'critical' : 'neutral' },
      { key: 'cash-securiser', label: 'Cash Ã  sÃ©curiser', value: formatKmf(signals.cash_a_securiser && signals.cash_a_securiser.total_kmf), tone: (signals.cash_a_securiser && signals.cash_a_securiser.count) ? 'warning' : 'neutral' },
      { key: 'incidents', label: 'Incidents ouverts', value: formatNumber(signals.incidents_ouverts), tone: signals.incidents_ouverts ? 'critical' : 'neutral' },
      { key: 'relais-actifs', label: 'Relais actifs', value: formatNumber(signals.relais_actifs), tone: 'neutral' },
    ];
  }

  const INCIDENT_TYPE_LABEL = Object.freeze({
    retard: 'Retard',
    blocage: 'Blocage',
    paiement: 'Paiement',
    stock: 'Stock',
    colis_endommage: 'Colis endommagÃ©',
    colis_perdu: 'Colis perdu',
    client_absent: 'Client absent',
    autre: 'Autre',
  });

  const INCIDENT_PRIORITY_LABEL = Object.freeze({
    urgent: 'Urgent',
    high: 'Ã‰levÃ©e',
    normal: 'Normale',
    low: 'Faible',
  });

  function renderSignals(rootNode, ui, doc, payload) {
    const signals = payload.signals || {};
    const slot = ui.Section.create({
      id: 'operations-signals',
      title: 'Signaux rÃ©seau',
      description: 'Ce que le serveur observe dÃ©jÃ  sur ce marchÃ© â€” sans score ni prioritÃ© inventÃ©s cÃ´tÃ© navigateur.',
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
      card.appendChild(text(doc, 'strong', 'kmc-metric-value', item.value != null ? item.value : 'â€”'));
      strip.appendChild(card);
    });
    slot.slot.appendChild(strip);

    const incidentsHost = doc.createElement('div');
    incidentsHost.className = 'kmc-workspace-subsection';
    incidentsHost.appendChild(text(doc, 'h3', 'kmc-workspace-subsection-title', 'Incidents ouverts'));
    slot.slot.appendChild(incidentsHost);
    ui.DataTable.render(incidentsHost, {
      emptyText: 'Aucun incident ouvert sur ce marchÃ©.',
      columns: [
        { key: 'type', label: 'Type', format: value => INCIDENT_TYPE_LABEL[value] || value },
        { key: 'relais_name', label: 'Relais' },
        { key: 'priority', label: 'PrioritÃ©', format: value => INCIDENT_PRIORITY_LABEL[value] || value },
        { key: 'created_at', label: 'Depuis', format: value => formatDate(value) },
      ],
      rows: signals.incidents || [],
    });

    const relaisHost = doc.createElement('div');
    relaisHost.className = 'kmc-workspace-subsection';
    relaisHost.appendChild(text(doc, 'h3', 'kmc-workspace-subsection-title', 'Relais Ã  suivre'));
    slot.slot.appendChild(relaisHost);
    ui.DataTable.render(relaisHost, {
      emptyText: 'Aucun relais actif sur ce marchÃ©.',
      columns: [
        { key: 'name', label: 'Relais' },
        { key: 'island', label: 'Ãle / zone' },
        { key: 'disponibles', label: 'Colis disponibles', align: 'right' },
        { key: 'en_retard', label: 'Dont en retard (+72h)', align: 'right', format: value => (value ? String(value) : 'â€”') },
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
      cell.textContent = content == null || content === '' ? 'â€”' : String(content);
    }
    rowNode.appendChild(cell);
  }

  function renderActionTable(container, options) {
    container.replaceChildren();
    const doc = container.ownerDocument;
    const rows = Array.isArray(options.rows) ? options.rows : [];
    if (!rows.length) {
      const empty = text(doc, 'div', 'kmc-workspace-empty', options.emptyText || 'Rien Ã  traiter');
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
      { label: 'RÃ©fÃ©rence', render: (row, doc) => config.referenceKind === 'parcel'
        ? text(doc, 'strong', 'kmc-workspace-ref-text', row.reference)
        : orderLink(doc, row.reference) },
      { label: 'Client', render: row => row.client_name || row.recipient_name || 'â€”' },
      { label: 'Relais / destination', render: row => row.relais_name || row.relais_island || row.destination_island || 'â€”' },
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
    button.textContent = 'En coursâ€¦';
    setFeedback(context.root, options.runningMessage || 'Action en coursâ€¦', 'neutral');
    let result;
    try {
      result = await jsonRequest(context.fetch, options.url, {
        method: 'POST',
        body: options.body,
        idemm«ëŒ+Š×®º+º$zzb¥ç÷FVæ7”¶W“¢÷F–öç2æ–FV×÷FVæ7”¶W’À¢Ò“°¢Ò6F6‚†W'&÷"’°¢6WDfVVF&6²†6öçFW‡Bç&ö÷BÂW'&÷"æÖW76vRÂv7&—F–6Âr“°¢'WGFöâæF—6&ÆVBÒfÇ6S°¢'WGFöâçFW‡D6öçFVçBÒ&Wf–÷W3°¢F‡&÷rW'&÷#°¢Ğ¢–b‡G—Vöb÷F–öç2æöå7V66W72ÓÓÒvgVæ7F–öâr’÷F–öç2æöå7V66W72‡&W7VÇB“°¢6öç7BÖW76vRÒG—Vöb÷F–öç2ç7V66W74ÖW76vRÓÓÒvgVæ7F–öâp¢ò÷F–öç2ç7V66W74ÖW76vR‡&W7VÇB¢¢†÷F–öç2ç7V66W74ÖW76vRÇÂt7F–öâÆ—\:–Râr“°¢6öç7BFöæRÒG—Vöb÷F–öç2ç7V66W75FöæRÓÓÒvgVæ7F–öârò÷F–öç2ç7V66W75FöæR‡&W7VÇB’¢w÷6—F—fRs°¢G'’°¢v—B6öçFW‡Bç&VÆöB‚“°¢òòÆ&VÆV7GW&R&V6öç7G'V—BÂvVâ×L:§FR¢ÆRÖW76vRW7B÷<:’,:‡2Â÷W"&W7FW"Æ—6–&ÆRà¢6WDfVVF&6²†6öçFW‡Bç&ö÷BÂÖW76vRÂFöæR“°¢Ò6F6‚†W'&÷"’°¢6WDfVVF&6²†6öçFW‡Bç&ö÷BÂG¶ÖW76vWÒÆ&VÆV7GW&R:–6†÷\:’¢G¶W'&÷"æÖW76vWÖÂv7&—F–6Âr“°¢Ğ¢&WGW&â&W7VÇC°¢Ğ ¢6öç7B$T4T•d$ÄUôTäEô”åBÒrö’÷66ç2ö‡V"÷&V6V—f&ÆRs°¢6öç7B$T4T•dUôTäEô”åBÒrö’÷66ç2ö‡V"÷&V6V—fRs°¢6öç7B…•4”4Åô4ôDUô4ôäd•$ÕôTäEô”åBÒrö’ö‡V"÷‡—6–6ÂÖ6öFW2ö6öæf—&Òs°¢6öç7B$T4UD”ôåõ5DDUôÄ$TÅ2Òö&¦V7Bæg&VW¦R‡²äõEõ$T4T•dTC¢tæöâ&\:wRrÂ%D”Ã¢u'F–VÂrÂ4ôÕÄUDS¢t6ö×ÆWBrÒ“° ¢6öç7Btõ$µ54Uõd”Uu2Òö&¦V7Bæg&VW¦R…°¢²–C¢v‡V"rÂÆ&VÃ¢t‡V"rÒÀ¢²–C¢w&VÆ’rÂÆ&VÃ¢u&VÆ—2rÒÀ¢²–C¢v–çfVçF÷'’rÂÆ&VÃ¢u7Fö6²:ffV7FW"rÒÀ¢Ò“° ¢òò‡V"Æ—fR+rWŒ:–7WF–öâ¢7F–öç2‡V"Væ—VVÖVçB†¦Ö—2&VÆ—2’²,:–6WF–öâf÷W&æ—76WW"à¢6öç7BU„T5UD”ôåõd”Uu2Òö&¦V7Bæg&VW¦R…°¢²–C¢w7WÇ’rÂÆ&VÃ¢tF÷76–W'2rÒÀ¢²–C¢w&V6WF–öârÂÆ&VÃ¢u,:–6WF–öç2rÒÀ¢²–C¢v‡V"rÂÆ&VÃ¢t7F–öç2‡V"rÒÀ¢²–C¢v–çfVçF÷'’rÂÆ&VÃ¢u7Fö6²:ffV7FW"rÒÀ¢Ò“° ¢òò&VÆ—2Æ—fR+rWŒ:–7WF–öâ¢7F–öç2&VÆ—2Væ—VVÖVçB†Væ6—76W"Â,:–6WF–öææW"Â&VÖWGG&R’(	B¦Ö—2‡V"à¢6öç7B$TÄ•ôÄ•dUõD%2Òö&¦V7Bæg&VW¦R…·²–C¢w&VÆ’rÂÆ&VÃ¢t÷:—&F–öç2rÒÂ²–C¢v66‚rÂÆ&VÃ¢t66‚bL:—;GG2rÒÂ²–C¢w&WGW&ç2rÂÆ&VÃ¢u&WF÷W'2b4brÕÒ“° ¢gVæ7F–öâæWu&V6WF–öå&VfW&Væ6R‚’°¢6öç7B7'—FòÒvÆö&ÅF†—2æ7'—Fó°¢6öç7B–BÒ7'—FòbbG—Vöb7'—Fòç&æFöÕUT”BÓÓÒvgVæ7F–öâp¢ò7'—Fòç&æFöÕUT”B‚¢¢G´FFRææ÷r‚’çFõ7G&–ærƒ3b—ÒÒG´ÖF‚ç&æFöÒ‚’çFõ7G&–ærƒ3b’ç6Æ–6Rƒ"Â—Ö°¢&WGW&â5UÄ”U%õ4´tRÒG¶–GÖ°¢Ğ ¢òò,:–l:—&Væ6R7F&ÆR"6—6–R¢Vâ&Vçfö’‡,:—6VRÂF÷V&ÆR6Æ–2’&V¦÷VRÆÜ:¦ÖR,:–6WF–öâÂ¦Ö—2VæR6V6öæFRà¢gVæ7F–öâ&V6WF–öå&VfW&Væ6Tf÷"†6öçFW‡BÂW&6†6T÷&FW$–B’°¢–b‚6öçFW‡Bç&V6V—fU&Vg2’6öçFW‡Bç&V6V—fU&Vg2ÒæWrÖ‚“°¢–b‚6öçFW‡Bç&V6V—fU&Vg2æ†2‡W&6†6T÷&FW$–B’’6öçFW‡Bç&V6V—fU&Vg2ç6WB‡W&6†6T÷&FW$–BÂæWu&V6WF–öå&VfW&Væ6R‚’“°¢&WGW&â6öçFW‡Bç&V6V—fU&Vg2ævWB‡W&6†6T÷&FW$–B“°¢Ğ ¢gVæ7F–öâ&V6WF–öäÖW76vR‡&W7VÇB’°¢–b‡&W7VÇBbb&W7VÇBæ–FV×÷FVçE÷&WÆ’’°¢&WGW&â,:–6WF–öâL:–¬:G&—L:–RG·&W7VÇBçVæ—Bbb&W7VÇBçVæ—Bç&VfW&Væ6Rò‚G·&W7VÇBçVæ—Bç&VfW&Væ6WÒ–¢rwÒ¢V7VæRæ÷WfVÆÆR×WFF–öâæ°¢Ğ¢–b‡&W7VÇBbb&W7VÇBçV&çF–æVB’°¢&WGW&â6öÆ—2Ö—2VâV&çF–æR‚G·&W7VÇBç&V6öåö6öFRÇÂ|:–6'B6öç7FL:’wÒ’¢Vâ–æ6–FVçBFR,:–6öæ6–Æ–F–öâW7B÷WfW'BÂÆR7Fö6²î(	–W7B2VvÖVçL:’æ°¢Ğ¢&WGW&âu,:–6WF–öâVç&Vv—7G,:–Râs°¢Ğ ¢gVæ7F–öâ7&VFU&V6WF–öä6&B†Fö2Â6öçFW‡BÂò’°¢6öç7B6&BÒFö2æ7&VFTVÆVÖVçB‚v'F–6ÆRr“°¢6&Bæ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fRÖ6&Bs°¢6&Bç6WDGG&–'WFR‚vFF×&V6V—fR×òrÂòçW&6†6Uö÷&FW%ö–B“° ¢6öç7B†VBÒFö2æ7&VFTVÆVÖVçB‚v†VFW"r“°¢†VBæ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fRÖ†VBs°¢†VBæVæD6†–ÆB‡FW‡B†Fö2Âw7G&öærrÂrrÂ‡òç7WÆ–W"bbòç7WÆ–W"ææÖR’ÇÂtf÷W&æ—76WW"æöâ&Vç6V–vì:’r’“°¢†VBæVæD6†–ÆB‡FW‡B†Fö2Âw7ârÂv¶Ö2×v÷&·76RÖ×WFVBrÀ¢òGµ7G&–ær‡òçW&6†6Uö÷&FW%ö–B’ç6Æ–6RƒÂ‚—Ò+rG·òç7WÆ–W%ö÷&FW%÷&VbÇÂw6ç2,:–l:—&Væ6Rf÷W&æ—76WW"wÒ+r7FGWBf÷W&æ—76WW"¢G·òçõ÷7FGW7Ò†–æf÷&ÖF–öâÂ2VæR,:–6WF–öâ–’“°¢6&BæVæD6†–ÆB††VB“°¢òòF÷V6†WGFRU4"†ÖöFR6Æf–W"’¢Vâ66â&V6öææ:çBVæR,:–l:—&Væ6RÂ¦Ö—2Vâ6Æ–VçBà¢6öç7B66ææW%æVÂÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢66ææW%æVÂæ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fR×66ææW"s°¢6öç7B66ææW$Æ&VÂÒFW‡B†Fö2ÂvÆ&VÂrÂv¶Ö2×v÷&·76R×&V6V—fR×66âÖÆ&VÂrÂt–FVçF–f–W"Æ,:–l:—&Væ6R&\:wVRr“°¢6öç7B66ææW$–çWBÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢66ææW$–çWBçG—RÒwFW‡Bs°¢66ææW$–çWBæWFö6ö×ÆWFRÒvöfbs°¢66ææW$–çWBæ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fR×66âÖ–çWBs°¢66ææW$–çWBçÆ6V†öÆFW"ÒtTâÂuD”â÷R6öFRf÷W&æ—76WW"(	BVçG,:–Rs°¢66ææW$–çWBç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂu66ææW"ÆR6öFR‡—6—VRFRÆ,:–l:—&Væ6Rf÷W&æ—76WW"r“°¢66ææW$Æ&VÂæVæD6†–ÆB‡66ææW$–çWB“°¢66ææW%æVÂæVæD6†–ÆB‡66ææW$Æ&VÂ“°¢6öç7B66ææW%&W7VÇBÒFW‡B†Fö2Âw7ârÂv¶Ö2×v÷&·76R×&V6V—fR×66â×&W7VÇBrÂu66ææW"Æ,:–l:—&Væ6RfçBFRL:–6Æ&W"6VçF—L:’&\:wVRâr“°¢66ææW%&W7VÇBç6WDGG&–'WFR‚w&öÆRrÂw7FGW2r“°¢66ææW%æVÂæVæD6†–ÆB‡66ææW%&W7VÇB“°¢òòÖöFRL:–w&L:’¢6ç26öFRÆ—6–&ÆRÂÂvvVçB§W7F–f–RVæR6öç7FFF–öâÖçVVÆÆR²Æ&÷fVææ6P¢òòVç&Vv—7G,:–RW7BÔåTÂ†¦Ö—244â’ÂfV2ÆÜ:¦ÖRl:—&–f–6F–öâFRVçF—L:’WBFRf&–çFRà¢6öç7BÖçVÅ&ööbÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢ÖçVÅ&ööbçG—RÒwFW‡Bs°¢ÖçVÅ&ööbæÖ„ÆVæwF‚ÒS°¢ÖçVÅ&ööbæ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fRÖÖçVÂ×&ööbs°¢ÖçVÅ&ööbçÆ6V†öÆFW"ÒtW‚â66ææW"–æF—7öæ–&ÆRÂ6öçG,;FÆRf—7VVÂs°¢ÖçVÅ&ööbç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂt§W7F–f–6F–öâFRÆ,:–6WF–öâVâ6—6–RÖçVVÆÆRr“°¢ÖçVÅ&ööbç6WDGG&–'WFR‚vFF×&V6V—fRÖÖçVÂ×&ööbrÂrr“°¢ÖçVÅ&ööbæ†–FFVâÒG'VS°¢òò–çFW''WFWW"W‡Æ–6—FR¢Vâ66ææW":–×VÆRVâ6Æf–W"ÂÆg&R6WVÆRæR&÷WfR2Æ&÷fVææ6Rà¢6öç7BÖçVÅFövvÆTÆ&VÂÒFW‡B†Fö2ÂvÆ&VÂrÂv¶Ö2×v÷&·76R×&V6V—fRÖÖçVÂ×FövvÆRrÂu6—6–RÖçVVÆÆR‡6ç266ææW"’r“°¢6öç7BÖçVÅFövvÆRÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢ÖçVÅFövvÆRçG—RÒv6†V6¶&÷‚s°¢ÖçVÅFövvÆRç6WDGG&–'WFR‚vFF×&V6V—fRÖÖçVÂ×FövvÆRrÂrr“°¢ÖçVÅFövvÆRç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂu6—6–RÖçVVÆÆR¢&÷fVææ6RÔåTÂfV2§W7F–f–6F–öâö&Æ–vFö—&Rr“°¢ÖçVÅFövvÆTÆ&VÂæVæD6†–ÆB†ÖçVÅFövvÆR“°¢66ææW%æVÂæVæD6†–ÆB†ÖçVÅFövvÆTÆ&VÂ“°¢6öç7BÖçVÅ&öödÆ&VÂÒFW‡B†Fö2ÂvÆ&VÂrÂv¶Ö2×v÷&·76R×&V6V—fRÖf–VÆBÖÆ&VÂrÀ¢t§W7F–f–6F–öâÖçVVÆÆR+rö&Æ–vFö—&Rƒb6&7L:‡&W2Ö–æ–×VÒ’r“°¢ÖçVÅ&öödÆ&VÂæ†–FFVâÒG'VS°¢ÖçVÅ&öödÆ&VÂæVæD6†–ÆB†ÖçVÅ&ööb“°¢66ææW%æVÂæVæD6†–ÆB†ÖçVÅ&öödÆ&VÂ“°¢6&BæVæD6†–ÆB‡66ææW%æVÂ“° ¢6öç7Bw&ÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢w&æ6Æ74æÖRÒv¶Ö2×v÷&·76R×F&ÆR×w&s°¢6öç7BF&ÆRÒFö2æ7&VFTVÆVÖVçB‚wF&ÆRr“°¢F&ÆRæ6Æ74æÖRÒv¶Ö2×v÷&·76R×F&ÆRs°¢6öç7BF†VBÒFö2æ7&VFTVÆVÖVçB‚wF†VBr“°¢6öç7B†VE&÷rÒFö2æ7&VFTVÆVÖVçB‚wG"r“°¢²t'F–6ÆRrÂtGFVæGRrÂu&\:wRrÂu&W7FçBrÂ|8—FBrÂu&\:wRÖ–çFVæçBuÒæf÷$V6‚†Æ&VÂÓâ†VE&÷ræVæD6†–ÆB‡FW‡B†Fö2ÂwF‚rÂrrÂÆ&VÂ’’“°¢F†VBæVæD6†–ÆB††VE&÷r“°¢F&ÆRæVæD6†–ÆB‡F†VB“°¢6öç7BF&öG’ÒFö2æ7&VFTVÆVÖVçB‚wF&öG’r“°¢6öç7B–çWG2ÒµÓ°¢6öç7B66ææVD6öFT'•6·RÒæWrÖ‚“°¢òæÆ–æW2æf÷$V6‚‚†Æ–æRÂ–æFW‚’Óâ°¢6öç7B&÷rÒFö2æ7&VFTVÆVÖVçB‚wG"r“°¢&÷ræVæD6†–ÆB‡FW‡B†Fö2ÂwFBrÂrrÂÆ–æRç&öGV7EöæÖR’“°¢&÷ræVæD6†–ÆB‡FW‡B†Fö2ÂwFBrÂrrÂf÷&ÖDçVÖ&W"†Æ–æRæW‡V7FVE÷VçF—G’’’“°¢&÷ræVæD6†–ÆB‡FW‡B†Fö2ÂwFBrÂrrÂf÷&ÖDçVÖ&W"†Æ–æRç&V6V—fVE÷VçF—G’’’“°¢&÷ræVæD6†–ÆB‡FW‡B†Fö2ÂwFBrÂrrÂf÷&ÖDçVÖ&W"†Æ–æRç&VÖ–æ–æu÷VçF—G’’’“°¢&÷ræVæD6†–ÆB‡FW‡B†Fö2ÂwFBrÂrrÂ$T4UD”ôåõ5DDUôÄ$TÅ5¶Æ–æRç&V6WF–öå÷7FFUÒÇÂÆ–æRç&V6WF–öå÷7FFR’“°¢6öç7B6VÆÂÒFö2æ7&VFTVÆVÖVçB‚wFBr“°¢6öç7B–çWBÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢–çWBçG—RÒvçVÖ&W"s°¢–çWBæÖ–âÒss°¢–çWBæÖ‚Ò7G&–ær†Æ–æRç&VÖ–æ–æu÷VçF—G’“°¢–çWBç7FWÒss°¢–çWBæ–çWDÖöFRÒvçVÖW&–2s°¢–çWBæ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fR×G’s°¢–çWBç6WDGG&–'WFR‚vFF×&V6V—fRÖÆ–æRrÂ7G&–ær†–æFW‚’“°¢–çWBç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂVçF—L:’&\:wVRÖ–çFVæçB÷W"G¶Æ–æRç&öGV7EöæÖWÖ“°¢6VÆÂæVæD6†–ÆB†–çWB“°¢&÷ræVæD6†–ÆB†6VÆÂ“°¢F&öG’æVæD6†–ÆB‡&÷r“°¢–çWG2çW6‚‡²–çWBÂÆ–æRÒ“°¢Ò“°¢F&ÆRæVæD6†–ÆB‡F&öG’“°¢w&æVæD6†–ÆB‡F&ÆR“°¢6&BæVæD6†–ÆB‡w&“° ¢6öç7Bfö÷FW"ÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢fö÷FW"æ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fRÖfö÷FW"s°¢6öç7BG&6¶–ærÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢G&6¶–ærçG—RÒwFW‡Bs°¢G&6¶–æræ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fR×G&6¶–ærs°¢G&6¶–æræÖ„ÆVæwF‚Ò#°¢G&6¶–ærçÆ6V†öÆFW"Òu7V—f’ò,:–l:—&Væ6RGR6öÆ—2†f7VÇFF–b’s°¢G&6¶–ærç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂu7V—f’÷R,:–l:—&Væ6RGR6öÆ—2&\:wRr“°¢6öç7BG&6¶–ætÆ&VÂÒFW‡B†Fö2ÂvÆ&VÂrÂv¶Ö2×v÷&·76R×&V6V—fRÖf–VÆBÖÆ&VÂrÀ¢u7V—f’÷R,:–l:—&Væ6RGR6öÆ—2+rf7VÇFF–br“°¢G&6¶–ætÆ&VÂæVæD6†–ÆB‡G&6¶–ær“°¢fö÷FW"æVæD6†–ÆB‡G&6¶–ætÆ&VÂ“°¢6öç7B†–çBÒFW‡B†Fö2Âw7ârÂv¶Ö2×v÷&·76RÖ×WFVB¶Ö2×v÷&·76R×&V6V—fRÖ†–çBrÂu6—6—76W¢ÆVçF—L:’,:–VÆÆVÖVçB&\:wVRâV7VæRVçF—L:’î(	–W7B,:—&V×Æ–Râr“°¢fö÷FW"æVæD6†–ÆB††–çB“°¢6öç7B'WGFöâÒÖ¶T7F–öä'WGFöâ†Fö2ÂtVç&Vv—7G&W"Æ,:–6WF–öârÂw&V6V—fR×7WÆ–W"r“°¢'WGFöâæF—6&ÆVBÒG'VS°¢fö÷FW"æVæD6†–ÆB†'WGFöâ“°¢6&BæVæD6†–ÆB†fö÷FW"“° ¢gVæ7F–öâ6öÆÆV7B‚’°¢6öç7B6öçFVçG2ÒµÓ°¢ÆWB–çfÆ–BÒfÇ6S°¢–çWG2æf÷$V6‚‚‡²–çWBÂÆ–æRÒ’Óâ°¢6öç7B&rÒ7G&–ær†–çWBçfÇVRÇÂrr’çG&–Ò‚“°¢–b‡&rÓÓÒrr’&WGW&ã°¢6öç7BVçF—G’ÒçVÖ&W"‡&r“°¢–b‚çVÖ&W"æ—4–çFVvW"‡VçF—G’’ÇÂVçF—G’ÂÇÂVçF—G’âÆ–æRç&VÖ–æ–æu÷VçF—G’’²–çfÆ–BÒG'VS²&WGW&ã²Ğ¢–b‡VçF—G’â’°¢6öçFVçG2çW6‚‡°¢W&6†6Uö÷&FW%ö–C¢òçW&6†6Uö÷&FW%ö–BÀ¢âââ†Æ–æRç&öGV7E÷6·Uö–Bò²&öGV7E÷6·Uö–C¢Æ–æRç&öGV7E÷6·Uö–BÒ¢·Ò’À¢âââ†ÖçVÅFövvÆRæ6†V6¶V@¢ò†Æ–æRç&öGV7E÷6·Uö–Bbb7G&–ær†ÖçVÅ&ööbçfÇVRÇÂrr’çG&–Ò‚’æÆVæwF‚ãÒ`¢ò²Wf–FVæ6UöÖWF†öC¢tÔåTÂrÂWf–FVæ6U÷&Vc¢7G&–ær†ÖçVÅ&ööbçfÇVR’çG&–Ò‚’Ò¢·Ò¢¢‡66ææVD6öFT'•6·Ræ†2…7G&–ær†Æ–æRç&öGV7E÷6·Uö–B’¢ò²Wf–FVæ6Uö6öFS¢66ææVD6öFT'•6·RævWB…7G&–ær†Æ–æRç&öGV7E÷6·Uö–B’’Ò¢·Ò’’À¢VçF—G’À¢Ò“°¢Ğ¢Ò“°¢&WGW&â²6öçFVçG2Â–çfÆ–BÓ°¢Ğ ¢gVæ7F–öâ7–æ2‚’°¢6öç7B²6öçFVçG2Â–çfÆ–BÒÒ6öÆÆV7B‚“°¢6öç7BVçfW&–f–VBÒ6öçFVçG2ç6öÖR†—FVÒÓâ—FVÒæWf–FVæ6Uö6öFRbb—FVÒæWf–FVæ6UöÖWF†öBÓÒtÔåTÂr“°¢'WGFöâæF—6&ÆVBÒ–çfÆ–BÇÂ6öçFVçG2æÆVæwF‚ÓÓÒÇÂVçfW&–f–VC°¢†–çBçFW‡D6öçFVçBÒ–çfÆ–@¢òuVçF—L:’–çfÆ–FR¢VçF–W"VçG&RWBÆR&W7FçBGFVæGRâp¢¢VçfW&–f–VBò†ÖçVÅFövvÆRæ6†V6¶V@¢òu6—6–RÖçVVÆÆR¢§W7F–f–6F–öâFRb6&7L:‡&W2Ö–æ–×VÒö&Æ–vFö—&Râp¢¢u66ææW"F÷WFW2ÆW2,:–l:—&Væ6W2&\:wVW2Â÷R7F—fW"*²6—6–RÖçVVÆÆR+²WBÆ§W7F–f–W"âr¢¢uVçF—L:’,:–VÆÆVÖVçB6ö×L:–RWB,:–l:—&Væ6W266æì:–W2¢,:§B:Vç&Vv—7G&W"âs°¢Ğ¢–çWG2æf÷$V6‚‚‡²–çWBÒ’Óâ–çWBæFDWfVçDÆ—7FVæW"‚v–çWBrÂ7–æ2’“°¢ÖçVÅ&ööbæFDWfVçDÆ—7FVæW"‚v–çWBrÂ7–æ2“°¢ÖçVÅFövvÆRæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ‚’Óâ°¢ÖçVÅ&ööbæ†–FFVâÒÖçVÅFövvÆRæ6†V6¶VC°¢ÖçVÅ&öödÆ&VÂæ†–FFVâÒÖçVÅFövvÆRæ6†V6¶VC°¢66ææW%&W7VÇBçFW‡D6öçFVçBÒÖçVÅFövvÆRæ6†V6¶V@¢òu6—6–RÖçVVÆÆR7F—fR¢&÷fVææ6RÔåTÂÂ§W7F–f–6F–öâö&Æ–vFö—&Râp¢¢u66ææW"Æ,:–l:—&Væ6RfçBFRL:–6Æ&W"6VçF—L:’&\:wVRâs°¢7–æ2‚“°¢Ò“°¢ÆWB66ææ–ærÒfÇ6S°¢6öç7B…•4”4Åô4ôDUõE•U2Òö&¦V7Bæg&VW¦R…°¢²tTåôuD”ârÂtTâòuD”â–×&–Ü:’‡Væ—fW'6VÂ’uÒÀ¢²u5UÄ”U%ô$$4ôDRrÂt6öFRÖ&'&W2GRf÷W&æ—76WW"uÒÀ¢²t´ôÕôÄõEôÄ$TÂrÂ|8—F—VWGFRFRÆ÷B¶öÖW&6RuÒÀ¢Ò“°¢6öç7B6öæf—&Ô&÷‚ÒFö2æ7&VFTVÆVÖVçB‚vf÷&Òr“°¢6öæf—&Ô&÷‚æ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fRÖ6öæf—&Òs°¢6öæf—&Ô&÷‚ç6WDGG&–'WFR‚vFF×‡—6–6ÂÖ6öæf—&ÒrÂrr“°¢6öæf—&Ô&÷‚æ†–FFVâÒG'VS°¢66ææW%æVÂæVæD6†–ÆB†6öæf—&Ô&÷‚“° ¢gVæ7F–öâ6Æ÷6T6öæf—&Ò‚’°¢6öæf—&Ô&÷‚æ†–FFVâÒG'VS°¢6öæf—&Ô&÷‚ç&WÆ6T6†–ÆG&Vâ‚“°¢Ğ ¢òò6öFR–æ6öæçR¢ÂvvVçBÂ6öÆ—2VâÖ–âÂ&GF6†RÂtTâ:Æf&–çFRGFVæGVR7W"4UEDRòà¢òòÆR6öFR–FVçF–f–RÆ,:–l:—&Væ6RÂ¦Ö—2Æ6öÖÖæFRæ’VâW†V×Æ—&Rà¢gVæ7F–öâ÷Vä6öæf—&Ò†6öFR’°¢6öæf—&Ô&÷‚ç&WÆ6T6†–ÆG&Vâ‚“°¢6öæf—&Ô&÷‚æ†–FFVâÒfÇ6S°¢6öæf—&Ô&÷‚æVæD6†–ÆB‡FW‡B†Fö2Âw7ârÂv¶Ö2×v÷&·76RÖ×WFVBrÀ¢6öFRG¶6öFWÒ–æ6öæçR÷W"6Rf÷W&æ—76WW"â6öÆ—2VâÖ–âÂ6†ö—6—76W¢Æf&–çFRGFVæGVR7W"6WGFRòæ’“°¢6öç7Bf&–çBÒFö2æ7&VFTVÆVÖVçB‚w6VÆV7Br“°¢f&–çBç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂuf&–çFRGFVæGVR7W"Æòr“°¢f&–çBç6WDGG&–'WFR‚vFFÖ6öæf—&Ò×f&–çBrÂrr“°¢f&–çBæVæD6†–ÆB„ö&¦V7Bæ76–vâ†Fö2æ7&VFTVÆVÖVçB‚v÷F–öâr’Â²fÇVS¢rrÂFW‡D6öçFVçC¢uf&–çFRGFVæGV^(
brÒ’“°¢òæÆ–æW2æf–ÇFW"†Æ–æRÓâÆ–æRç&öGV7E÷6·Uö–B’æf÷$V6‚†Æ–æRÓâ°¢f&–çBæVæD6†–ÆB„ö&¦V7Bæ76–vâ†Fö2æ7&VFTVÆVÖVçB‚v÷F–öâr’Â°¢fÇVS¢7G&–ær†Æ–æRç&öGV7E÷6·Uö–B’À¢FW‡D6öçFVçC¢G¶Æ–æRç&öGV7EöæÖWÒ†GFVæGRG¶f÷&ÖDçVÖ&W"†Æ–æRæW‡V7FVE÷VçF—G’—Ò–À¢Ò’“°¢Ò“°¢6öç7BG—RÒFö2æ7&VFTVÆVÖVçB‚w6VÆV7Br“°¢G—Rç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂuG—RFR6öFRr“°¢G—Rç6WDGG&–'WFR‚vFFÖ6öæf—&Ò×G—RrÂrr“°¢…•4”4Åô4ôDUõE•U2æf÷$V6‚‚…·fÇVRÂÆ&VÅÒ’ÓâG—RæVæD6†–ÆB„ö&¦V7Bæ76–vâ†Fö2æ7&VFTVÆVÖVçB‚v÷F–öâr’Â²fÇVRÂFW‡D6öçFVçC¢Æ&VÂÒ’’“°¢6öç7B&ööbÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢&ööbçG—RÒwFW‡Bs°¢&ööbæÖ„ÆVæwF‚ÒS°¢&ööbçÆ6V†öÆFW"Òu&WWfR¢,:–l:—&Væ6RFRÆ†÷Fò÷RFRÆæ÷FRs°¢&ööbç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂu,:–l:—&Væ6RFRÆ†÷Fò÷RFRÆæ÷FRr“°¢&ööbç6WDGG&–'WFR‚vFFÖ6öæf—&Ò×&ööbrÂrr“°¢6öç7B7V&Ö—BÒÖ¶T7F–öä'WGFöâ†Fö2ÂufÆ–FW"Æ6öæf—&ÖF–öârÂv6öæf—&Ò×‡—6–6ÂÖ6öFRr“°¢7V&Ö—BçG—RÒw7V&Ö—Bs°¢7V&Ö—BæF—6&ÆVBÒG'VS°¢6öç7B6æ6VÂÒÖ¶T7F–öä'WGFöâ†Fö2ÂtæçVÆW"rÂv6æ6VÂ×‡—6–6ÂÖ6öFRr“°¢6æ6VÂæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ6Æ÷6T6öæf—&Ò“°¢6öç7B7–æ46öæf—&ÒÒ‚’Óâ²7V&Ö—BæF—6&ÆVBÒf&–çBçfÇVRÇÂ7G&–ær‡&ööbçfÇVRÇÂrr’çG&–Ò‚“²Ó°¢f&–çBæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ7–æ46öæf—&Ò“°¢&ööbæFDWfVçDÆ—7FVæW"‚v–çWBrÂ7–æ46öæf—&Ò“°¢·f&–çBÂG—RÂ&ööeÒæf÷$V6‚†æöFRÓâ6öæf—&Ô&÷‚æVæD6†–ÆB†æöFR’“°¢6öç7B7F–öç2ÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢7F–öç2æ6Æ74æÖRÒv¶Ö2×v÷&·76R×&V6V—fRÖ6öæf—&ÒÖ7F–öç2s°¢7F–öç2æVæD6†–ÆB‡7V&Ö—B“°¢7F–öç2æVæD6†–ÆB†6æ6VÂ“°¢6öæf—&Ô&÷‚æVæD6†–ÆB†7F–öç2“°¢6öæf—&Ô&÷‚æöç7V&Ö—BÒ7–æ2WfVçBÓâ°¢WfVçBç&WfVçDFVfVÇB‚“°¢–b‡7V&Ö—BæF—6&ÆVB’&WGW&ã°¢7V&Ö—BæF—6&ÆVBÒG'VS°¢66ææW%&W7VÇBçFW‡D6öçFVçBÒt6öæf—&ÖF–öâVâ6÷W'>(
bs°¢66ææW%&W7VÇBæFF6WBç66åFöæRÒwVæF–ærs°¢G'’°¢v—B§6öå&WVW7B†6öçFW‡BæfWF6‚Â…•4”4Åô4ôDUô4ôäd•$ÕôTäEô”åBÂ°¢Ú±î¸Â¸­yêë¢°k¢G§¦*^m«ëŒ+Š×®º+º$zzb¥âÖWF†öC¢uõ5BrÀ¢&öG“¢°¢W&6†6Uö÷&FW%ö–C¢òçW&6†6Uö÷&FW%ö–BÀ¢&öGV7E÷6·Uö–C¢f&–çBçfÇVRÀ¢6öFRÀ¢6öFU÷G—S¢G—RçfÇVRÀ¢&ööe÷&Vc¢7G&–ær‡&ööbçfÇVR’çG&–Ò‚’À¢ÒÀ¢Ò“°¢6Æ÷6T6öæf—&Ò‚“°¢v—B–FVçF–g’†6öFR“°¢Ò6F6‚†W'&÷"’°¢66ææW%&W7VÇBçFW‡D6öçFVçBÒ6öæf—&ÖF–öâ&VgW<:–R¢G¶W'&÷"æÖW76vWÖ°¢66ææW%&W7VÇBæFF6WBç66åFöæRÒvW'&÷"s°¢7V&Ö—BæF—6&ÆVBÒfÇ6S°¢Ğ¢Ó°¢f&–çBæfö7W2‚“°¢Ğ ¢7–æ2gVæ7F–öâ–FVçF–g’†6öFR’°¢66ææ–ærÒG'VS°¢66ææW$–çWBæF—6&ÆVBÒG'VS°¢66ææW%&W7VÇBçFW‡D6öçFVçBÒt–FVçF–f–6–6RçG—RÒvçVÖ&W"s°¢7WÆ–W%&–6Rç7FWÒsãs°¢7WÆ–W%&–6RæÖ–âÒsãs°¢7WÆ–W%&–6RçÆ6V†öÆFW"ÒsÃs°¢7WÆ–W%&–6Rç6WDGG&–'WFR‚vFF×6÷W&6–ær×&–6RrÂrr“°¢6öç7B7GVÅ&–6RÒf–VÆB‚u&—‚Væ—F—&R,:–VÂrÂFö2æ7&VFTVÆVÖVçB‚v–çWBr’Â7WÆ–W%æVÂ“°¢7GVÅ&–6RçG—RÒvçVÖ&W"s°¢7GVÅ&–6Rç7FWÒsãs°¢7GVÅ&–6RæÖ–âÒsãs°¢6öç7B7GVÄ7W'&Væ7’Òf–VÆB‚tFWf—6RGR&—‚,:–VÂ†6öFR:2ÆWGG&W2’rÂFö2æ7&VFTVÆVÖVçB‚v–çWBr’Â7WÆ–W%æVÂ“°¢7GVÄ7W'&Væ7’æÖ„ÆVæwF‚Ò3°¢7GVÄ7W'&Væ7’çÆ6V†öÆFW"ÒtTBs°¢6öç7BÖ–ætæ÷FRÒFW‡B†Fö2ÂwrÂv¶Ö2Ö‡V"×6÷W&6–ærÖ†VÇrÂ ¢t76ö6–F–öâW†—7FçFR¢,:–l:—&Væ6RWB&—‚Vç&Vv—7G,:—2,:—WF–Æ—<:—2âr“°¢Ö–ætæ÷FRæ†–FFVâÒG'VS°¢Ö–ætæ÷FRç6WDGG&–'WFR‚vFF×6÷W&6–ærÖÖ–ærÖæ÷FRrÂrr“°¢7WÆ–W%æVÂæVæD6†–ÆB†Ö–ætæ÷FR“° ¢6öç7Bfö÷FW"ÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢fö÷FW"æ6Æ74æÖRÒv¶Ö2Ö‡V"×6÷W&6–ærÖfö÷FW"s°¢f÷&ÒæVæD6†–ÆB†fö÷FW"“°¢6öç7Bfö÷FW$6÷’ÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢fö÷FW$6÷’æ6Æ74æÖRÒv¶Ö2Ö‡V"×6÷W&6–ærÖfö÷FW"Ö6÷’s°¢fö÷FW$6÷’æVæD6†–ÆB‡FW‡B†Fö2ÂwrÂv¶Ö2Ö‡V"×6÷W&6–ærÖ†VÇrÀ¢|8—FR7V—fçFR¢,:—&W"ÆòÂV—2f—&RfÆ–FW"<:—,:–ÖVçBÎ(	–VævvVÖVçBWBÆR–VÖVçBâr’“°¢6öç7B7FGW2ÒFW‡B†Fö2ÂwrÂv¶Ö2Ö‡V"×6÷W&6–ær×7FGW2rÂrr“°¢7FGW2ç6WDGG&–'WFR‚w&öÆRrÂw7FGW2r“°¢7FGW2ç6WDGG&–'WFR‚v&–ÖÆ—fRrÂwöÆ—FRr“°¢7FGW2ç6WDGG&–'WFR‚vFF×6÷W&6–ær×7FGW2rÂrr“°¢fö÷FW$6÷’æVæD6†–ÆB‡7FGW2“°¢fö÷FW"æVæD6†–ÆB†fö÷FW$6÷’“°¢6öç7B7V&Ö—BÒÖ¶T7F–öä'WGFöâ†Fö2Ât7,:–W"ÆÆ–væRN(	–6†BrÂv7&VFRÖÖçVÂ×W&6†6RÖÆ–æRr“°¢7V&Ö—BçG—RÒw7V&Ö—Bs°¢fö÷FW"æVæD6†–ÆB‡7V&Ö—B“°¢ÆWB7WÆ–W'2ÒµÓ°¢ÆWB&WVW7E6W&–ÂÒ°¢ÆWBw&—F–ærÒfÇ6S°¢gVæ7F–öâ6†÷6Vä—FVÒ‚’°¢&WGW&âVç&W6öÇfVBæf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ—FVÕ6VÆV7BçfÇVR“°¢Ğ¢gVæ7F–öâWFFTf÷&Ò‚’°¢6öç7B7WÆ–W"Ò7WÆ–W'2æf–æB‡&÷rÓâ&÷ræ–BÓÓÒ7WÆ–W%6VÆV7BçfÇVR“°¢6öç7BÖVBÒ7WÆ–W#òæÖF6†–æu÷&öGV7E÷7WÆ–W%ö–C°¢7WÆ–W$æÖRæF—6&ÆVBÒ7WÆ–W#°¢7WÆ–W$æÖRç&VçDæöFRæ†–FFVâÒ7WÆ–W#°¢7WÆ–W%&VbæF—6&ÆVBÒÖVC°¢7WÆ–W%&–6RæF—6&ÆVBÒÖVC°¢7WÆ–W$FWF–Ç2æ†–FFVâÒÖVC°¢6öç7BV÷FTæVVFVBÒÖVBbb7WÆ–W"æÖF6†–æu÷&–6UöVBÓÓÒçVÆÃ°¢f÷"†6öç7B–çWBöb¶7GVÅ&–6RÂ7GVÄ7W'&Væ7•Ò’°¢–çWBç&VçDæöFRæ†–FFVâÒV÷FTæVVFVC°¢–çWBæF—6&ÆVBÒV÷FTæVVFVC°¢–çWBç&WV—&VBÒV÷FTæVVFVC°¢–çWBçfÇVRÒrs°¢Ğ¢Ö–ætæ÷FRæ†–FFVâÒÖVBÇÂV÷FTæVVFVC°¢Ğ¢gVæ7F–öâWFFT—FVÕ7VÖÖ'’‚’°¢6öç7BVçF—G’ÒçVÖ&W"†6†÷6Vä—FVÒ‚“òçW&6†6–æuöÖ—76–ærÇÂ“°¢—FVÕ7VÖÖ'’çFW‡D6öçFVçBÒf÷&ÖDçVÖ&W"‡VçF—G’’²‡VçF—G’âòrVæ—L:—2&W7FçFW2:6†WFW"r¢rVæ—L:’&W7FçFR:6†WFW"r“°¢Ğ¢7–æ2gVæ7F–öâÆöE7WÆ–W'2‚’°¢6öç7B6W&–ÂÒ²·&WVW7E6W&–Ã°¢6öç7B—FVÒÒ6†÷6Vä—FVÒ‚“°¢7WÆ–W%6VÆV7BæF—6&ÆVBÒG'VS°¢7V&Ö—BæF—6&ÆVBÒG'VS°¢7FGW2çFW‡D6öçFVçBÒu&V6†W&6†RFW2f÷W&æ—76WW'2GR&öGV—N(
bs°¢G'’°¢6öç7B&W7VÇBÒv—B§6öå&WVW7B†6öçFW‡BæfWF6‚À¢rö’÷W&6†6–ær÷7WÆ–W'3ö7F—fS×G'VRg&öGV7Eö–CÒr²Væ6öFUU$”6ö×öæVçB†—FVÒç&öGV7Eö–B’“°¢–b‡6W&–ÂÓÒ&WVW7E6W&–ÂÇÂw&—F–ær’&WGW&ã°¢7WÆ–W'2Ò'&’æ—4'&’‡&W7VÇB’ò&W7VÇBæf–ÇFW"‡&÷rÓà¢&÷ræÖF6†–æu÷&öGV7E÷7WÆ–W%ö–BÇÂ&÷ræ÷væW%÷66÷RÓÓÒv‡V"rÇÀ¢†6öçFW‡BçW6W"bb6öçFW‡BçW6W"ç&öÆRÓÓÒvFÖ–âr’’¢µÓ°¢7WÆ–W%6VÆV7Bç&WÆ6T6†–ÆG&Vâ‚“°¢6öç7Bf—'7BÒFö2æ7&VFTVÆVÖVçB‚v÷F–öâr“°¢f—'7BçfÇVRÒrs°¢f—'7BçFW‡D6öçFVçBÒt7,:–W"Vâf÷W&æ—76WW"Æö6Âs°¢7WÆ–W%6VÆV7BæVæD6†–ÆB†f—'7B“°¢7WÆ–W'2æf÷$V6‚‡7WÆ–W"Óâ°¢6öç7B÷F–öâÒFö2æ7&VFTVÆVÖVçB‚v÷F–öâr“°¢÷F–öâçfÇVRÒ7WÆ–W"æ–C°¢÷F–öâçFW‡D6öçFVçBÒ7WÆ–W"ææÖR°¢‡7WÆ–W"æÖF6†–æu÷&öGV7E÷6Ú±î¸Â¸­yêë¢°k¢G§¦*^upplier_id ? ' Â· dÃ©jÃ  associÃ©' : ' Â· Ã  associer');
            supplierSelect.appendChild(option);
          });
          supplierSelect.disabled = false;
          submit.disabled = false;
          status.textContent = 'La quantitÃ© Ã  acheter est dÃ©terminÃ©e par la couverture serveur ; aucun achat fournisseur ne sera envoyÃ© automatiquement.';
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
          status.textContent = 'PrÃ©ciser le fournisseur, sa rÃ©fÃ©rence et son prix AED positif.';
          return;
        }
        if (!context.confirm('Ouvrir ' + quantity + ' unitÃ©(s) en achat manuel pour ' + group.reference + ' ?')) return;
        writing = true;
        submit.disabled = true;
        status.textContent = 'Enregistrement du fournisseur et de la ligne dâ€™achatâ€¦';
        let wrote = false;
        try {
          let supplierId = supplier?.id || null;
          if (!supplierId) {
            wrote = true; // ne jamais rejouer une crÃ©ation aprÃ¨s une erreur rÃ©seau
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
          if (!mappingId) throw new Error('Association fournisseur absente aprÃ¨s enregistrement');
          wrote = true; // le POST de ligne peut Ãªtre appliquÃ© sans rÃ©ponse
          const createdLine = await jsonRequest(context.fetch, '/api/purchasing/lines', {
            method: 'POST',
            body: {
              order_item_id: item.id, product_supplier_id: mappingId,
              quantity, execution_mode: 'manual',
              ...(supplier?.matching_product_supplier_id && supplier.matching_price_aed === null
                ? {actual_unit_price: actualPrice.value, actual_currency: actualCurrency.value.trim().toUpperCase()} : {}),
            },
          });
          wrote = true;
          if (!createdLine?.line?.line_id) throw new Error('Ligne crÃ©Ã©e mais rÃ©ponse incomplÃ¨te ; vÃ©rifier le dossier avant toute reprise');
          await context.reload();
          setFeedback(context.root,
            'Ligne dâ€™achat ouverte pour ' + group.reference + ' ; prÃ©parer ensuite la PO et obtenir les validations distinctes.',
            'positive');
        } catch (error) {
          status.textContent = error.message + (wrote
            ? ' Â· Des donnÃ©es peuvent dÃ©jÃ  Ãªtre enregistrÃ©es. Recharger et vÃ©rifier avant toute nouvelle tentative.'
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
      feedback.textContent = 'Aucun article Ã©ligible au sourcing manuel : vÃ©rifier le dossier fournisseur.';
      return false;
    }
    return true;
  }

  function renderSupplySection(rootNode, ui, doc, context) {
    // Concept C : aucun bloc KPI ni titre de section redondant au-dessus du cockpit (hero existant conservÃ©).
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
      flowHost.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Dossier non chargÃ©.'));
      return;
    }

    // Hub Live concept C : le cockpit Â« flux du besoin Â» remplace l'ancien tableau de production.
    // Toutes les quantitÃ©s et Ã©tapes viennent de la projection serveur (d.cockpit / d.orders / d.purchase_orders).
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

    // Sourcing manuel via les API propriÃ©taires : aucune crÃ©ation en SQL,
    // aucune fausse identitÃ© fournisseur, aucun envoi ou paiement implicite.
    const showSourcingResolution = group => renderManualSourcing(ordersSlot, doc, context, group);

    const cockpitModule = globalThis.KomerceHubLiveCockpit;
    if (!cockpitModule) {
      cockpitHost.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Cockpit Hub indisponible : module non chargÃ©.'));
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
        openReception: () => {
          context.view = 'reception';
          context.renderCurrent();
        },
        openPhysical: (target = 'all') => {
          const details = physicalDetails();
          if (!details) return;
          details.open = true;
          const targets = {
            boxes: '[data-supply-box-create]',
            shipments: '[data-supply-shipment-bar]',
          };
          const selector = targets[target];
          const anchor = (selector && details.querySelector(selector)) || details;
          // Navigation opÃ©rateur dÃ©terministe entre rÃ©ception, COMBOX et expÃ©ditions.
          anchor.scrollIntoView?.({ block: 'start', behavior: 'auto' });
        },
      });
      } catch (error) {
        cockpitHost.replaceChildren(text(doc, 'div', 'kmc-workspace-empty', 'Cockpit Hub illisible : rechargez la page (' + String((error && error.message) || error).slice(0, 120) + ').'));
      }
    }
    // Tout ce qui suit (Ã©carts, rÃ©ceptions brutes, COMBOX, expÃ©ditions) est le panneau secondaire exhaustif.
    const secondaryStart = rootNode.children.length;
    // La filiation dÃ©taillÃ©e est chargÃ©e Ã  la demande, hors du tableau.
    const points = d.to_handle || [];
    if (points.length) {
      const follow = doc.createElement('details');
      follow.className = 'kmc-hub-dossier-secondary';
      follow.setAttribute('data-supply-to-handle', '');
      const summary = doc.createElement('summary');
      summary.textContent = 'Suivi des Ã©carts Â· ' + String(points.length);
      follow.appendChild(summary);
      follow.appendChild(simpleTable(doc, ['Fait constatÃ©', 'Dossier'],
        points.map(item => [item.reason, item.supplier_name || item.kind]), 'Aucun Ã©cart.'));
      rootNode.appendChild(follow);
    }

    const receipts = doc.createElement('details');
    receipts.className = 'kmc-hub-dossier-secondary';
    receipts.setAttribute('data-supply-receipts', '');
    const receiptSummary = doc.createElement('summary');
    receiptSummary.textContent = 'RÃ©ceptions fournisseurs brutes Â· ' + String((d.receipts || []).length);
    receipts.appendChild(receiptSummary);
    receipts.appendChild(simpleTable(doc, ['Colis fournisseur', 'RÃ©fÃ©rence externe', 'Ã‰tat', 'QuantitÃ©', 'Date'],
      (d.receipts || []).map(r => [r.reference, r.external_ref || 'â€”', r.state, formatNumber(r.qty), formatDate(r.received_at)]),
      'Aucun colis reÃ§u.'));
    rootNode.appendChild(receipts);

    const boxes = createSection(rootNode, ui, 'COMBOX', 'Initialisez une COMBOX, scannez chaque article ajoutÃ©, puis fermez-la avant la remise au transitaire.');
    boxes.setAttribute('data-supply-boxes', '');
    const open = Array.isArray(d.open_shipments) ? d.open_shipments : [];
    const free = box => !box.shipment_ref && ['PACKED','DISPATCHED'].includes(box.state);
    const checked = new Set();

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-receive-footer';
    bar.setAttribute('data-supply-shipment-bar', '');
    const select = doc.createElement('select');
    select.setAttribute('aria-label', 'ExpÃ©dition ouverte');
    select.appendChild(Object.assign(doc.createElement('option'), { value: '', textContent: open.length ? 'Choisir une expÃ©dition ouverteâ€¦' : 'Aucune expÃ©dition ouverte' }));
    open.forEach(sh => select.appendChild(Object.assign(doc.createElement('option'), {
      value: sh.reference, textContent: `${sh.reference} Â· ${sh.forwarder_name || 'Transitaire Ã  dÃ©finir'} Â· ${sh.box_count} COMBOX`,
    })));
    bar.appendChild(select);
    const field = (placeholder, label) => {
      const input = doc.createElement('input');
      input.type = 'text'; input.maxLength = 120; input.placeholder = placeholder; input.className = 'kmc-workspace-receive-tracking';
      input.setAttribute('aria-label', label);
      return input;
    };
    const refInput = field('RÃ©fÃ©rence du nouveau dossier', 'RÃ©fÃ©rence de la nouvelle expÃ©dition');
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
      runningMessage: 'Ouverture du dossierâ€¦',
      successMessage: result => `Dossier ${result && result.result ? result.result.reference : ''} ouvert en prÃ©paration Â· ${checked.size} COMBOX.`,
    }).catch(() => {}));

    // Composition directe des COMBOX via les routes Workspace et les commandes Hub canoniques.
    const BOX_NEXT_STATE = Object.freeze({
      RECEIVED: 'IDENTIFIED', IDENTIFIED: 'QUALITY_CHECKED', QUALITY_CHECKED: 'LOCATED',
      LOCATED: 'ALLOCATED', ALLOCATED: 'PICKED', PICKED: 'PACKED', PACKED: 'DISPATCHED',
    });
    const BOX_MUTABLE = new Set(['RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']);
    const fillable = Array.isArray(d.fillable) ? d.fillable : [];
    const createBar = doc.createElement('div');
    createBar.className = 'kmc-workspace-receive-footer';
    createBar.setAttribute('data-supply-box-create', '');
    const newRef = field('RÃ©fÃ©rence COMBOX (facultative)', 'RÃ©fÃ©rence de la nouvelle m«ëŒ+Š×®º+º$zzb¥æÚ±î¸Â¸­yêë¢°k¢G§¦*^ doc.createElement('select');
    select.setAttribute('aria-label', 'ExpÃ©dition ouverte');
    select.appendChild(Object.assign(doc.createElement('option'), { value: '', textContent: open.length ? 'Choisir une expÃ©dition ouverteâ€¦' : 'Aucune expÃ©dition ouverte' }));
    open.forEach(sh => select.appendChild(Object.assign(doc.createElement('option'), {
      value: sh.reference, textContent: `${sh.reference} Â· ${sh.forwarder_name || 'Transitaire Ã  dÃ©finir'} Â· ${sh.box_count} COMBOX`,
    })));
    bar.appendChild(select);
    const field = (placeholder, label) => {
      const input = doc.createElement('input');
      input.type = 'text'; input.maxLength = 120; input.placeholder = placeholder; input.className = 'kmc-workspace-receive-tracking';
      input.setAttribute('aria-label', label);
      return input;
    };
    const refInput = field('RÃ©fÃ©rence du nouveau dossier', 'RÃ©fÃ©rence de la nouvelle expÃ©dition');
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
      runningMessage: 'Ouverture du dossierâ€¦',
      successMessage: result => `Dossier ${result && result.result ? result.result.reference : ''} ouvert en prÃ©paration Â· ${checked.size} COMBOX.`,
    }).catch(() => {}));

    // Composition directe des COMBOX via les routes Workspace et les commandes Hub canoniques.
    const BOX_NEXT_STATE = Object.freeze({
      RECEIVED: 'IDENTIFIED', IDENTIFIED: 'QUALITY_CHECKED', QUALITY_CHECKED: 'LOCATED',
      LOCATED: 'ALLOCATED', ALLOCATED: 'PICKED', PICKED: 'PACKED', PACKED: 'DISPATCHED',
    });
    const BOX_MUTABLE = new Set(['RECEIVED', 'IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']);
    const fillable = Array.isArray(d.fillable) ? d.fillable : [];
    const createBar = doc.createElement('div');
    createBar.className = 'kmc-workspace-receive-footer';
    createBar.setAttribute('data-supply-box-create', '');
    const newRef = field('RÃ©fÃ©rence COMBOX (facultative)', 'RÃ©fÃ©rence de la nouvelle COMBOX');
    const newBox = makeActionButton(doc, 'Initialiser une COMBOX', 'create-box');
    // A2 : la clÃ© d'opÃ©ration survit Ã  un Ã©chec (coupure rÃ©seau) pour qu'un nouvel essai du mÃªme geste
    // renvoie la mÃªme COMBOX ; elle change si la rÃ©fÃ©rence saisie change, et aprÃ¨s un succÃ¨s.
    let boxKey = null; let boxKeyRef = null;
    const makeKey = () => (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : `box-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
    newBox.addEventListener('click', () => {
      const wanted = newRef.value.trim();
      if (!boxKey || boxKeyRef !== wanted) { boxKey = makeKey(); boxKeyRef = wanted; }
      return runAction(context, newBox, {
      url: endpointFor(context.marketCode, 'boxes'),
      idempotencyKey: boxKey,
      onSuccess: () => { boxKey = null; boxKeyRef = null; },
      body: wanted ? { reference: wanted } : {},
      runningMessage: 'Initialisation de la COMBOXâ€¦',
      successMessage: result => `COMBOX ${result && result.physical_unit ? result.physical_unit.reference : ''} ${result && result.replayed ? 'dÃ©jÃ  initialisÃ©e (rejeu reconnu)' : 'initialisÃ©e'}.`,
      }).catch(() => {});
    });
    [newRef, newBox].forEach(node => createBar.appendChild(node));
    boxes.appendChild(createBar);

    const composeCell = box => {
      const cell = doc.createElement('div');
      cell.className = 'kmc-workspace-box-compose';
      if (BOX_MUTABLE.has(box.state)) {
        const boxScan=field('Scanner la COMBOX','Scanner la rÃ©fÃ©rence de la COMBOX '+box.reference);
        boxScan.setAttribute('data-hub-box-scan','');
        context.hubVerifiedBoxes=context.hubVerifiedBoxes||{};
        boxScan.value=context.hubVerifiedBoxes[String(box.unit_id)]||'';
        boxScan.addEventListener('input',()=>{
          if(boxScan.value.trim()===box.reference)context.hubVerifiedBoxes[String(box.unit_id)]=box.reference;
          else delete context.hubVerifiedBoxes[String(box.unit_id)];
        });
        const options=fillable.filter(line=>Number(line.quantity)>0);
        const item=doc.createElement('select');
        item.setAttribute('aria-label','Article rÃ©ceptionnÃ© Ã  placer dans '+box.reference);
        options.forEach((line,i)=>item.appendChild(Object.assign(doc.createElement('option'),{
          value:String(i),textContent:(line.product||'Article')+' Â· '+line.order_ref+' Â· '+
            line.quantity+' disponible(s) Â· '+line.from_unit_ref,
        })));
        const method=doc.createElement('select');
        method.setAttribute('aria-label','Mode de preuve du scan article dans '+box.reference);
        [['SCAN','Scanner le code article'],['MANUAL','Mode dÃ©gradÃ© Â· constat manuel']]
          .forEach(([value,label])=>method.appendChild(Object.assign(doc.createElement('option'),{value,textContent:label})));
        const code=field('Scanner le code article','Code physique de lâ€™article Ã  placer dans '+box.reference);
        const proof=field('RÃ©fÃ©rence de preuve manuelle (6 caractÃ¨res minimum)','Preuve du constat manuel pour '+box.reference);
        proof.hidden=true;
        const qty=doc.createElement('input');qty.type='number';qty.min='1';qty.step='1';qty.value='1';
        qty.setAttribute('aria-label','QuantitÃ© de cet article Ã  placer dans '+box.reference);
        const add=makeActionButton(doc,'Placer lâ€™article dans la COMBOX','fill-box');
        const syncMethod=()=>{
          const manual=method.value==='MANUAL'; code.hidden=manual; proof.hidden=!manual;
          if(manual)code.value=''; else proof.value='';
        };
        method.addEventListener('change',syncMethod);
        const fill=()=>{
          if(boxScan.value.trim()!==box.reference){
            setFeedback(context.root,'Scannez dâ€™abord la rÃ©fÃ©rence de cette COMBOX.','critical'); return;
          }
          const line=options[Number(item.value)]; if(!line)return;
          const manual=method.value==='MANUAL';
          const proofRef=String(proof.value||'').trim();
          if(manual?proofRef.length<6:!code.value.trim()){
            setFeedback(context.root,manual?'RÃ©fÃ©rence de preuve obligatoire (6 caractÃ¨res minimum).':'Code article obligatoire.','critical'); return;
          }
          const quantity=Number(qty.value);
          if(!Number.isInteger(quantity)||quantity<1||quantity>Number(line.quantity))return;
          if(!manual&&quantity!==1){setFeedback(context.root,'Un scan confirmÃ© correspond Ã  un article. Scannez chaque unitÃ© sÃ©parÃ©ment.','critical');return;}
          runAction(context,add,{
            url:endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/fill'),
            body:{from_unit_id:line.from_unit_id,allocation_id:line.allocation_id,quantity,
              box_reference_scan:boxScan.value.trim(),
              ...(manual?{evidence_method:'MANUAL',evidence_ref:proofRef}
                :{evidence_method:'SCAN',evidence_code:code.value.trim()})},
            runningMessage:'VÃ©rification de lâ€™article et placement dans la COMBOXâ€¦',
            successMessage:quantity+' article(s) placÃ©(s) dans '+box.reference+'.',
          }).catch(()=>{});
        };
        add.disabled=!options.length;
        [boxScan,item,method,code,proof,qty,add].forEach(node=>cell.appendChild(node));
        code.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();fill();}});
        proof.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();fill();}});
        add.addEventListener('click',fill);
        if((box.contents||[]).length){
          const close=makeActionButton(doc,'Fermer la COMBOX','close-box');
          close.addEventListener('click',()=>{
            if(boxScan.value.trim()!==box.reference){setFeedback(context.root,'Scannez la COMBOX avant fermeture.','critical');return;}
            runAction(context,close,{
              url:endpointFor(context.marketCode,'boxes/'+encodeURIComponent(box.unit_id)+'/close'),
              body:{box_reference_scan:boxScan.value.trim()},
              runningMessage:'ContrÃ´le du contenu et fermetureâ€¦',
              successMessage:box.reference+' fermÃ©e et prÃªte pour la suite.',
            }).catch(()=>{});
          });
          cell.appendChild(close);
        }
      }
      const next = BOX_NEXT_STATE[box.state];
      if (next && (box.contents || []).length) {
        const label = next === 'DISPATCHED' ? 'PrÃªt Ã  remettre au transitaire' : `Ã‰tape suivante Â· ${next}`;
        const step = makeActionButton(doc, label, 'advance-box');
        step.addEventListener('click', () => runAction(context, step, {
          url: endpointFor(context.marketCode, `boxes/${box.unit_id}/advance`),
          body: { to_state: next },
          confirmMessage: next === 'DISPATCHED' ? `Confirmer que ${box.reference} est prÃªt pour la remise au transitaire ?` : undefined,
          runningMessage: 'Changement dâ€™Ã©tapeâ€¦',
          successMessage: `${box.reference} : ${next}.`,
        }).catch(() => {}));
        cell.appendChild(step);
      }
      return cell.children.length ? cell : 'â€”';
    };

    boxes.appendChild(simpleTable(doc, ['', 'COMBOX', 'Ã‰tat', 'Contenu', 'ExpÃ©dition', 'Composer', 'Action'],
      (d.boxes || []).map(box => {
        const contents = box.contents.map(c => `${c.order_ref} Ã—${formatNumber(c.qty)}`).join(', ');
        let pick = '';
        let action = 'â€”';
        if (free(box)) {
          pick = doc.createElement('input');
          pick.type = 'checkbox';
          pick.setAttribute('aria-label', `Inclure ${box.reference}`);
          pick.addEventListener('change', () => { if (pick.checked) checked.add(box.unit_id); else checked.delete(box.unit_id); syncBar(); });
          action = makeActionButton(doc, 'Rattacher Ã  lâ€™expÃ©dition choisie', 'attach-box-shipment');
          action.disabled = true;
          attachButtons.push({ button: action, box });
          action.addEventListener('click', () => runAction(context, action, {
            url: endpointFor(context.marketCode, `boxes/${encodeURIComponent(box.unit_id)}/shipment`),
            body: { shipment_reference: select.value },
            runningMessage: 'Rattachement en coursâ€¦',
            successMessage: result => (result && result.already_attached ? 'COMBOX dÃ©jÃ  rattachÃ©e Ã  cette expÃ©dition.' : 'COMBOX rattachÃ©e Ã  lâ€™expÃ©dition.'),
          }).catch(() => {}));
        }
        if (box.shipment_ref && box.shipment_stage === 'hub_ready') {
          action = makeActionButton(doc, 'Retirer du dossier', 'detach-box-shipment');
          action.addEventListener('click', () => runAction(context, action, {
            url: endpointFor(context.marketCode, `boxes/${encodeURIComponent(box.unit_id)}/detach`),
            body: {},
            confirmMessage: `Retirer ${box.reference} de lâ€™expÃ©dition ${box.shipment_ref} ?`,
            runningMessage: 'DÃ©tachement de la COMBOXâ€¦',
            successMessage: 'COMBOX retirÃ©e du dossier encore en prÃ©paration.',
          }).catch(() => {}));
        }
        return [pick, box.reference, box.state, contents || 'â€”', box.shipment_ref || 'â€”', composeCell(box), action];
      }), 'Aucune COMBOX.'));

    const secondary = doc.createElement('details');
    secondary.className = 'kmc-hub-physical-secondary';
    secondary.setAttribute('data-hub-physical-details', '');
    // Atelier opÃ©rationnel visible par dÃ©faut : le repli est rÃ©servÃ© aux dÃ©tails
    // et ne doit jamais dissimuler les gestes attendus au Golden M01.
    secondary.open = true;
    secondary.appendChild(text(doc, 'summary', '', 'Ateliers physiques Â· COMBOX et expÃ©ditions'));
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

  // CÃ´tÃ© Relais, une opÃ©ration Ã  la fois : les autres files restent dans le DOM,
  // mais sont masquÃ©es (et inaccessibles au clavier) jusqu'Ã  sÃ©lection explicite.
  // Aucune requÃªte ou mutation mÃ©tier n'est dÃ©clenchÃ©e par cet aiguillage.
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
    // Guidage compact dÃ©rivÃ© de la file dÃ©jÃ  active, sans seconde logique mÃ©tier.
    const activeLink=rootNode.querySelector('[data-relay-execution-jump="'+key+'"]');
    const title=rootNode.querySelector('[data-relay-next-title]');
    const detail=rootNode.querySelector('[data-relay-next-detail]');
    if(activeLink&&title&&detam«ëŒ+Š×®º+º$zzb¥æ–Â’°¢6öç7BÆ&VÃÖ7F—fTÆ–æ²çVW'•6VÆV7F÷"‚w7G&öærr“òçFW‡D6öçFVçGÇÂtf–ÆR<:–ÆV7F–öæì:–Rs°¢6öç7BVæF–æsÖ7F—fTÆ–æ²ævWDGG&–'WFR‚vFF×&VÆ’Ö—FVÒÖ6÷VçBr“°¢F—FÆRçFW‡D6öçFVçCÒ|8f—&RÖ–çFVæçB+rr¶Æ&VÃ°¢FWF–ÂçFW‡D6öçFVçC×VæF–æsÓÖçVÆÃòt6öç7VÇFW"ÆW2'&—fvW2FR6RÖ&6Œ:’âs ¢çVÖ&W"‡VæF–ær“ã÷VæF–ær²rF÷76–W"‡2’Fç26WGFRf–ÆR:W†Ö–æW"âs ¢tV7VâF÷76–W"VâGFVçFRFç26WGFRf–ÆRâs°¢Ğ¢Ğ ¢òòc4b(	BVæRFVÖæFR&GF6Œ:–RRe$’'F–6ÆR&VÖ—2Â6ç2,:–6WF–öà¢òò‡—6—VR–×Æ–6—FRæ’÷:—&F–öâf–ææ6œ:‡&RâÆW2L:–6—6–öç2&W7FVçBFç0¢òòÆW2Æ—F–vW2òWF÷&—L:—2¶öÖW&6R²6Rf÷&×VÆ—&R6W'BVæ—VVÖVçB:6–væÆW"à¢gVæ7F–öâ&VæFW%&VÆ•&WGW&å&WVW7G2‡&ö÷DæöFRÂV’ÂFö2Â6öçFW‡B’°¢6öç7B6Æ÷BÒ7&VFU6V7F–öâ‡&ö÷DæöFRÂV’Âu&WF÷W'2b4brÀ¢t÷Wg&—"VâF÷76–W"Â6–væÆW"VæRæöÖÆ–R÷RGFW7FW"<:—,:–ÖVçBÆ&W&—6R‡—6—VRâV7Vâ–VÖVçBWFöÖF—VRâr“°¢6Æ÷Bç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&â×&WVW7G2rÂrr“° ¢6öç7Bæ÷F–6RÒFW‡B†Fö2ÂwrÂv¶Ö2×v÷&·76RÖæ÷FRrÀ¢tÆ&W&—6RW7BVæR&WWfRFRL:—;GBÂ2VæRL:–6—6–öâFR&VÖ&÷W'6VÖVçBâÆW2'F–6ÆW2&W&—2&W7FVçB—6öÌ:—2FRÆfVçFRâr“°¢6Æ÷BæVæD6†–ÆB†æ÷F–6R“° ¢6öç7B6V&6„f÷&ÒÒFö2æ7&VFTVÆVÖVçB‚vf÷&Òr“°¢6V&6„f÷&Òç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&âÖÆöö·WrÂrr“°¢6V&6„f÷&Òæ6Æ74æÖRÒv¶Ö2×v÷&·76R×6V7F–öâÖ7F–öç2s°¢6öç7B&VfW&Væ6RÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢&VfW&Væ6RçG—RÒwFW‡Bs°¢&VfW&Væ6Rç&WV—&VBÒG'VS°¢&VfW&Væ6RæÖ„ÆVæwF‚Òƒ°¢&VfW&Væ6RçÆ6V†öÆFW"Òu,:–l:—&Væ6R6öÖÖæFRs°¢&VfW&Væ6Rç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂu,:–l:—&Væ6RFR6öÖÖæFRr“°¢&VfW&Væ6Rç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&â×&VfW&Væ6RrÂrr“°¢6V&6„f÷&ÒæVæD6†–ÆB‡&VfW&Væ6R“°¢6öç7BÆöö·WÒFW‡B†Fö2Âv'WGFöârÂv¶Ö2×v÷&·76RÖ7F–öârÂu&V6†W&6†W"r“°¢Æöö·WçG—RÒw7V&Ö—Bs°¢6V&6„f÷&ÒæVæD6†–ÆB†Æöö·W“°¢6Æ÷BæVæD6†–ÆB‡6V&6„f÷&Ò“° ¢6öç7B6VÆV7F–öâÒFö2æ7&VFTVÆVÖVçB‚vf÷&Òr“°¢6VÆV7F–öâç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&âÖ7&VFRrÂrr“°¢6VÆV7F–öâæ6Æ74æÖRÒv¶Ö2×v÷&·76RÖ–çfVçF÷'’ÖÆ—7Bs°¢6VÆV7F–öâæ†–FFVâÒG'VS°¢6öç7B&öGV7BÒFö2æ7&VFTVÆVÖVçB‚w6VÆV7Br“°¢&öGV7Bç&WV—&VBÒG'VS°¢&öGV7Bç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂt'F–6ÆR,:–VÆÆVÖVçB&VÖ—2R6Æ–VçBr“°¢&öGV7Bç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&â×&öGV7BrÂrr“°¢6öç7BG’ÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢G’çG—RÒvçVÖ&W"s°¢G’æÖ–âÒss°¢G’çfÇVRÒss°¢G’ç&WV—&VBÒG'VS°¢G’ç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂuVçF—L:’6öæ6W&ì:–Rr“°¢6öç7B&V6öâÒFö2æ7&VFTVÆVÖVçB‚w6VÆV7Br“°¢&V6öâç&WV—&VBÒG'VS°¢&V6öâç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂtÖ÷F–bFR&WF÷W"r“°¢f÷"†6öç7B·fÇVRÂÆ&VÅÒöb°¢²vFVfV7F—fRrÂu&öGV—BL:–fV7GVWW‚uÒÀ¢²vFÖvVBrÂu&öGV—B67<:’uÒÀ¢²ww&öæuö—FVÒrÂtÖWf—2'F–6ÆRuÒÀ¢²væ÷Eö5öFW67&–&VBrÂtæöâ6öæf÷&ÖRuÒÀ¢²v÷F†W"rÂtWG&RÖ÷F–buÒÀ¢Ò’°¢6öç7B÷F–öâÒFW‡B†Fö2Âv÷F–öârÂrrÂÆ&VÂ“°¢÷F–öâçfÇVRÒfÇVS°¢&V6öâæVæD6†–ÆB†÷F–öâ“°¢Ğ¢6öç7Bæ÷FRÒFö2æ7&VFTVÆVÖVçB‚wFW‡F&Vr“°¢æ÷FRæÖ„ÆVæwF‚ÒS°¢æ÷FRç&÷w2Ò#°¢æ÷FRçÆ6V†öÆFW"Òt6öÖÖVçF—&R6ö×Ì:–ÖVçF—&R†ö&Æ–vFö—&R÷W"WG&R’s°¢æ÷FRç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂt6öÖÖVçF—&R4br“°¢6öç7B7&VFRÒFW‡B†Fö2Âv'WGFöârÂv¶Ö2×v÷&·76RÖ7F–öârÂt÷Wg&—"ÆRF÷76–W"4br“°¢7&VFRçG—RÒw7V&Ö—Bs°¢7&VFRç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&â×7V&Ö—BrÂrr“°¢f÷"†6öç7B¶6F–öâÂ6öçG&öÅÒöb°¢²t'F–6ÆRrÂ&öGV7EÒÂ²uVçF—L:’rÂG•ÒÂ²tÖ÷F–brÂ&V6öåÒÂ²t6öÖÖVçF—&RrÂæ÷FUÒÀ¢Ò’°¢6öç7BÆ&VÂÒFW‡B†Fö2ÂvÆ&VÂrÂv¶Ö2×v÷&·76RÖæ÷FRrÂ6F–öâ“°¢Æ&VÂæVæD6†–ÆB†6öçG&öÂ“°¢6VÆV7F–öâæVæD6†–ÆB†Æ&VÂ“°¢Ğ¢6VÆV7F–öâæVæD6†–ÆB†7&VFR“°¢6öç7B&VÖ&²ÒFW‡B†Fö2Âv'WGFöârÂv¶Ö2×v÷&·76RÖ7F–öâ—2×6V6öæF'’rÀ¢u6–væÆW"VæR&VÖ'VR6ç2&WF÷W"r“°¢&VÖ&²çG—RÒv'WGFöâs°¢&VÖ&²ç6WDGG&–'WFR‚vFF×&VÆ’×VÆ—G’×&VÖ&²rÂrr“°¢6VÆV7F–öâæVæD6†–ÆB‡&VÖ&²“°¢6Æ÷BæVæD6†–ÆB‡6VÆV7F–öâ“°¢6öç7B&W7VÇBÒFW‡B†Fö2ÂwrÂv¶Ö2×v÷&·76RÖæ÷FRrÂrr“°¢&W7VÇBç6WDGG&–'WFR‚w&öÆRrÂw7FGW2r“°¢&W7VÇBç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&âÖfVVF&6²rÂrr“°¢6Æ÷BæVæD6†–ÆB‡&W7VÇB“° ¢6öç7BÆ—7BÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢Æ—7Bç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&âÖÆ—7BrÂrr“°¢6Æ÷BæVæD6†–ÆB†Æ—7B“° ¢òò‡—6–6ÂGFW7FF–öâ—26W&FRvW7GW&Rg&öÒ÷Væ–ærF†R4bF÷76–W"à¢òòÆWGFW"w&÷W2Öç’&6VÇ3²F†R–Ö×WF&ÆR&V6V—B–B–FVçF–f–W2F†RVæ—Bà¢6öç7B–çF¶RÒFö2æ7&VFTVÆVÖVçB‚vf÷&Òr“°¢–çF¶Ræ6Æ74æÖRÒv¶Ö2×v÷&·76RÖ–çfVçF÷'’ÖÆ—7Bs°¢–çF¶Rç6WDGG&–'WFR‚vFF×&VÆ’×&WGW&âÖ–çF¶RrÂrr“°¢–çF¶Ræ†–FFVâÒG'VS°¢6öç7B–çF¶UF—FÆRÒFW‡B†Fö2Âvƒ2rÂrrÂtGFW7FW"VæR&W&—6R‡—6—VRr“°¢–çF¶RæVæD6†–ÆB†–çF¶UF—FÆR“°¢6öç7B–çF¶U&WVW7BÒFö2æ7&VFTVÆVÖVçB‚w6VÆV7Br“°¢–çF¶U&WVW7Bç&WV—&VBÒG'VS°¢–çF¶U&WVW7Bç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂtF÷76–W"4b:&W&VæG&Rr“°¢–çF¶U&WVW7Bç6WDGG&–'WFR‚vFF×&VÆ’Ö–çF¶R×&WVW7BrÂrr“°¢6öç7B–çF¶T6öæF—F–öâÒFö2æ7&VFTVÆVÖVçB‚w6VÆV7Br“°¢–çF¶T6öæF—F–öâç&WV—&VBÒG'VS°¢–çF¶T6öæF—F–öâç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂ|8—FB‡—6—VR6öç7FL:’r“°¢f÷"†6öç7B·fÇVRÂÆ&VÅÒöb°¢²wVæ¶æ÷vârÂ|8—FB:W†Ö–æW"uÒÀ¢²w6VÆVBrÂtVÖ&ÆÆvRfW&Ü:’uÒÀ¢²v÷VæVBrÂtVÖ&ÆÆvR÷WfW'BuÒÀ¢²vFÖvVBrÂu&öGV—B÷RVÖ&ÆÆvRVæFöÖÖ|:’uÒÀ¢Ò’°¢6öç7B÷F–öâÒFW‡B†Fö2Âv÷F–öârÂrrÂÆ&VÂ“°¢÷F–öâçfÇVRÒfÇVS°¢–çF¶T6öæF—F–öâæVæD6†–ÆB†÷F–öâ“°¢Ğ¢6öç7B–çF¶U¦öæRÒFö2æ7&VFTVÆVÖVçB‚v–çWBr“°¢–çF¶U¦öæRçG—RÒwFW‡Bs°¢–çF¶U¦öæRæÖ„ÆVæwF‚Ò°¢–çF¶U¦öæRçÆ6V†öÆFW"Òt†f7VÇFF–b’s°¢–çF¶U¦öæRç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂtÆWGG&RFR¦öæRf7VÇFF—fRr“°¢6öç7B–çF¶Tæ÷FRÒFö2æ7&VFTVÆVÖVçB‚wFW‡F&Vr“°¢–çF¶Tæ÷FRç&WV—&VBÒG'VS°¢–çF¶Tæ÷FRæÖ–äÆVæwF‚Ò°¢–çF¶Tæ÷FRæÖ„ÆVæwF‚Ò°¢–çF¶Tæ÷FRç&÷w2Ò#°¢–çF¶Tæ÷FRçÆ6V†öÆFW"Òt6öç7FB‡—6—VRRL:—;GBƒ6&7L:‡&W2Ö–æ–×VÒ’s°¢–çF¶Tæ÷FRç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂt6öç7FB‡—6—VRFR&W&—6Rr“°¢f÷"†6öç7B¶6F–öâÂ6öçG&öÅÒöb°¢²tF÷76–W"rÂ–çF¶U&WVW7EÒÂ²|8—FB6öç7FL:’rÂ–çF¶T6öæF—F–öåÒÀ¢²u¦öæR†f7VÇFF—fR’rÂ–çF¶U¦öæUÒÂ²t6öç7FBrÂ–çF¶Tæ÷FUÒÀ¢Ò’°¢6öç7BÆ&VÂÒFW‡B†Fö2ÂvÆ&VÂrÂv¶Ö2×v÷&·76RÖæ÷FRrÂ6F–öâ“°¢Æ&VÂæVæD6†–ÆB†6öçG&öÂ“°¢–çF¶RæVæD6†–ÆB†Æ&VÂ“°¢Ğ¢6öç7B–çF¶U7V&Ö—BÒFW‡B†Fö2Âv'WGFöârÂv¶Ö2×v÷&·76RÖ7F–öârÂt6öæf—&ÖW"Æ,:–6WF–öâr“°¢–çF¶U7V&Ö—BçG—RÒw7V&Ö—Bs°¢–çF¶U7V&Ö—Bç6WDGG&–'WFR‚vFF×&VÆ’Ö–çF¶R×7V&Ö—BrÂrr“°¢–çF¶RæVæD6†–ÆB†–çF¶U7V&Ö—B“°¢6Æ÷BæVæD6†–ÆB†–çF¶R“°¢ÆWB÷&FW"ÒçVÆÃ°¢ÆWB—FV×2ÒµÓ° ¢6öç7BWFFUVçF—G’Ò‚’Óâ°¢6öç7B6†÷6VâÒ—FV×2æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ&öGV7BçfÇVR“°¢G’æÖ‚Ò7G&–ær†6†÷6Vãòç&VÖ–æ–æu÷&WGW&æ&ÆRÇÂ“°¢G’çfÇVRÒss°¢Ó°¢&öGV7BæFDWfVçDÆ—7FVæW"‚v6†ævRrÂWFFUVçF—G’“° ¢7–æ2gVæ7F–öâÆöE&WVW7G2‚’°¢G'’°¢6öç7BFFÒv—B§6öå&WVW7B†6öçFW‡BæfWF6‚Ârö’÷&VÆ’÷&WGW&ç2r“°¢Æ—7Bç&WÆ6T6†–ÆG&Vâ‚“°¢6öç7B&÷w2Ò'&’æ—4'&’†FFç&WVW7G2’òFFç&WVW7G2¢µÓ°¢–b‚&÷w2æÆVæwF‚’°¢Æ—7BæVæD6†–ÆB‡FW‡B†Fö2ÂwrÂv¶Ö2×v÷&·76RÖV×G’rÂtV7VâF÷76–W"4b÷WfW'Bâr’“°¢&WGW&ã°¢Ğ¢6öç7Bw&ÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢Æ—7BæVæD6†–ÆB‡w&“°¢V’äFFF&ÆRç&VæFW"‡w&Â°¢6öÇVÖç3¢°¢²¶W“¢v÷&FW%÷&VfW&Væ6RrÂÆ&VÃ¢t6öÖÖæFRrÒÀ¢²¶W“¢w&öGV7EöæÖRrÂÆ&VÃ¢t'F–6ÆRrÒÀ¢²¶W“¢w&WGW&å÷VçF—G’rÂÆ&VÃ¢uVçF—L:’rÒÀ¢²¶W“¢w&WGW&å÷&V6öârÂÆ&VÃ¢tÖ÷F–brÂf÷&ÖC¢…÷&rÂ&÷r’Óà¢‡¶FVfV7F—fS¢tL:–fV7GVWW‚rÆFÖvVC¢t67<:’rÇw&öæuö—FVÓ¢tÖWf—2'F–6ÆRrÆæ÷Eö5öFW67&–&VC¢tæöâ6öæf÷&ÖRrÆ÷F†W#¢tWG&RwÒ•·&÷rç&WGW&å÷&V6öåÒÇÂtWG&RrÒÀ¢²¶W“¢w7FGW2rÂÆ&VÃ¢tF÷76–W"rÂf÷&ÖC¢…÷&rÂ&÷r’Óà¢‡¶÷Vã¢|8W†Ö–æW"rÇ&ö6W76–æs¢tVâG&—FVÖVçBrÇ&W6öÇfVC¢u,:—6öÇRrÆ6Æ÷6VC¢t6Ì;GGW,:’wÒ•·&÷rç7FGW5ÒÇÂ&÷rç7FGW2ÒÀ¢²¶W“¢w&V6V—fVEöBrÂÆ&VÃ¢u&W&—6R‡—6—VRrÂf÷&ÖC¢…÷&rÂ&÷r’Óà¢&÷rç&V6V—Eö–Bò‚u&\:wR+rr²&÷rç&V6V—fVE÷VçF—G’²rVæ—L:’‡2’r°¢‡&÷rç7F÷&vU÷¦öæRòr+r¦öæRr²&÷rç7F÷&vU÷¦öæR¢rr’’¢tæöâ&W&—2rÒÀ¢ÒÀ¢&÷w2À¢V×G•FW‡C¢tV7VâF÷76–W"4bârÀ¢Ò“°¢òòöæÇ’÷Vâ÷&ö6W76–ær&WVW7G2v—F†÷WB‡—6–6ÂWf–FVæ6RÖ’&R&V6V—fVBà¢6öç7BVæF–æt–çF¶W2Ò&÷w2æf–ÇFW"‡&÷rÓâ&÷rç&V6V—Eö–Bb`¢‡&÷rç7FGW2ÓÓÒv÷VârÇÂ&÷rç7FGW2ÓÓÒw&ö6W76–ærr’“°¢–çF¶U&WVW7Bç&WÆ6T6†–ÆG&Vâ‚“°¢f÷"†6öç7BVæF–æröbVæF–æt–çF¶W2’°¢6öç7B÷F–öâÒFW‡B†Fö2Âv÷F–öârÂrrÀ¢VæF–æræ÷&FW%÷&VfW&Væ6R²r+rr²VæF–ærç&öGV7EöæÖR°¢r+rr²VæF–ærç&WGW&å÷VçF—G’²rVæ—L:’‡2’r“°¢÷F–öâçfÇVRÒVæF–æræ–C°¢–çF¶U&WVW7BæVæD6†–ÆB†÷F–öâ“°¢Ğ¢–çF¶Ræ†–FFVâÒVæF–æt–çF¶W2æÆVæwF‚ÓÓÒ°¢Ò6F6‚†W'&÷"’²&W7VÇBçFW‡D6öçFVçBÒtÆ—7FR4b–æF—7öæ–&ÆR¢r²W'&÷"æÖW76vS²Ğ¢Ğ ¢–çF¶RæFDWfVçDÆ—7FVæW"‚w7V&Ö—BrÂ7–æ2WfVçBÓâ°¢WfVçBç&WfVçDFVfVÇB‚“°¢–b‚–çF¶U&WVW7BçfÇVR’&WGW&ã°¢6öç7BWf–FVæ6RÒ–çF¶Tæ÷FRçfÇVRçG&–Ò‚“°¢–b†Wf–FVæ6RæÆVæwF‚Â’°¢&W7VÇBçFW‡D6öçFVçBÒtL:–7&—fW¢ÆR6öç7FB‡—6—VRFRÆ&W&—6Râs°¢&WGW&ã°¢Ğ¢–çF¶U7V&Ö—BæF—6&ÆVBÒG'VS°¢&W7VÇBçFW‡D6öçFVçBÒtVç&Vv—7G&VÖVçBFRÆ&W&—6R‡—6—V^(
bs°¢G'’°¢v—B§6öå&WVW7B†6öçFW‡BæfWF6‚Ârö’÷&VÆ’÷&WGW&ç2ö–çF¶RrÂ°¢ÖWF†öC¢uõ5BrÂ&öG“¢°¢&WVW7Eö–C¢–çF¶U&WVW7BçfÇVRÀ¢6öæF—F–öåö6öFS¢–çF¶T6öæF—F–öâçfÇVRÀ¢7F÷&vU÷¦öæS¢–çF¶U¦öæRçfÇVRçG&–Ò‚’çFõWW$66R‚’ÇÂçVÆÂÀ¢ö'6W'fF–öã¢Wf–FVæ6RÀ¢ÒÀ¢Ò“°¢–çF¶Tæ÷FRçfÇVRÒrs°¢–çF¶U¦öæRçfÇVRÒrs°¢&W7VÇBçFW‡D6öçFVçBÒu&W&—6RGFW7L:–Râ&öGV—B—6öÌ:’¢V7Vâ7,:–F—BvÆÆWBÂ&VÖ&÷W'6VÖVçBæ’7Fö6²fVæF&ÆRâs°¢òò,:‡2Vâõ5B,:—W76’ÂæR¦Ö—2Æ—76W"6öæf—&ÖW"VæR6V6öæFRfö—26’Æ&VÆV7GW&R:–6†÷VRà¢–çF¶Ræ†–FFVâÒG'VS°¢v—BÆöE&WVW7G2‚“°¢Ò6F6‚†W'&÷"’°¢&W7VÇBçFW‡D6öçFVçBÒW'&÷"æÖW76vS°¢Òf–æÆÇ’°¢–çF¶U7V&Ö—BæF—6&ÆVBÒfÇ6S°¢Ğ¢Ò“° ¢6V&6„f÷&ÒæFDWfVçDÆ—7FVæW"‚w7V&Ö—BrÂ7–æ2WfVçBÓâ°¢WfVçBç&WfVçDFVfVÇB‚“°¢6VÆV7F–öâæ†–FFVâÒG'VS°¢÷&FW"ÒçVÆÃ°¢—FV×2ÒµÓ°¢Æöö·WæF—6&ÆVBÒG'VS°¢&W7VÇBçFW‡D6öçFVçBÒu&V6†W&6†RFRÆ6öÖÖæF^(
bs°¢G'’°¢6öç7BFFÒv—B§6öå&WVW7B†6öçFW‡BæfWF6‚À¢rö’÷&VÆ’÷&WGW&ç2öVÆ–v–&ÆS÷&VfW&Væ6SÒr²Væ6öFUU$”6ö×öæVçB‡&VfW&Væ6RçfÇVRçG&–Ò‚’’“°¢÷&FW"ÒFFæ÷&FW#°¢—FV×2Ò†FFæ—FV×2ÇÂµÒ’æf–ÇFW"†—FVÒÓâ—FVÒç&VÖ–æ–æu÷&WGW&æ&ÆRâ“°¢&öGV7Bç&WÆ6T6†–ÆG&Vâ‚“°¢f÷"†6öç7B—FVÒöb—FV×2’°¢6öç7B÷F–öâÒFW‡B†Fö2Âv÷F–öârÂrrÀ¢—FVÒç&öGV7EöæÖR²r+rr²—FVÒç&VÖ–æ–æu÷&WGW&æ&ÆR²rVæ—L:’‡2’&VÖ—6W2F—7öæ–&ÆW2r“°¢÷F–öâçfÇVRÒ—FVÒæ–C°¢&öGV7BæVæD6†–ÆB†÷F–öâ“°¢Ğ¢–b‚—FV×2æÆVæwF‚’°¢&W7VÇBçFW‡D6öçFVçBÒtV7Vâ'F–6ÆR&VÖ—2:–Æ–v–&ÆR÷RVæRFVÖæFRW7BL:–¬:Vâ6÷W'2âs°¢ÒVÇ6R°¢WFFUVçF—G’‚“°¢6VÆV7F–öâæ†–FFVâÒfÇ6S°¢&W7VÇBçFW‡D6öçFVçBÒu<:–ÆV7F–öææW¢Î(	–'F–6ÆRWBÆRÖ÷F–b²V7Vâ7,:–F—Bî(	–W7B7,:œ:’âs°¢Ğ¢Ò6F6‚†W'&÷"’²&W7VÇBçFW‡D6öçFVçBÒW'&÷"æÖW76vS²Ğ¢f–æÆÇ’²Æöö·WæF—6&ÆVBÒfÇ6S²Ğ¢Ò“° ¢&VÖ&²æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ7–æ2‚’Óâ°¢6öç7B6†÷6VâÒ—FV×2æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ&öGV7BçfÇVR“°¢–b‚÷&FW"ÇÂ6†÷6Vâ’&WGW&ã°¢–b†æ÷FRçfÇVRçG&–Ò‚’æÆVæwF‚ÂR’°¢&W7VÇBçFW‡D6öçFVçBÒtL:–7&—fW¢f÷G&R&VÖ'VRVâVVÇVW2Ö÷G2âs°¢&WGW&ã°¢Ğ¢&VÖ&²æF—6&ÆVBÒG'VS°¢&W7VÇBçFW‡D6öçFVçBÒtVçfö’FRÆ&VÖ'VRR6FÆöwV^(
bs°¢G'’°¢v—B§6öå&WVW7B†6öçFW‡BæfWF6‚Ârö’÷&VÆ’÷&WGW&ç2÷&VÖ&·2rÂ°¢ÖWF†öC¢uõ5BrÂ&öG“¢°¢÷&FW%÷&VfW&Væ6S¢÷&FW"ç&VfW&Væ6RÂ÷&FW%ö—FVÕö–C¢6†÷6Vâæ–BÀ¢æ÷FS¢æ÷FRçfÇVRçG&–Ò‚’À¢ÒÀ¢Ò“°¢æ÷FRçfÇVRÒrs°¢&W7VÇBçFW‡D6öçFVçBÒu&VÖ'VRVç&Vv—7G,:–R7W"Æ,:–l:—&Væ6R6FÆöwVRâV7Vâ&WF÷W"ÂvVÂ÷R–VÖVçBL:–6ÆVæ6Œ:’âs°¢Ò6F6‚†W'&÷"’°¢&W7VÇBçFW‡D6öçFVçBÒW'&÷"æÖW76vS°¢Òf–æÆÇ’²&VÖ&²æF—6&ÆVBÒfÇ6S²Ğ¢Ò“° ¢6VÆV7F–öâæFDWfVçDÆ—7FVæW"‚w7V&Ö—BrÂ7–æ2WfVçBÓâ°¢WfVçBç&WfVçDFVfVÇB‚“°¢6öç7B6†÷6VâÒ—FV×2æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ&öGV7BçfÇVR“°¢–b‚÷&FW"ÇÂ6†÷6Vâ’&WGW&ã°¢6öç7B6÷VçBÒçVÖ&W"‡G’çfÇVR“°¢–b‚çVÖ&W"æ—56fT–çFVvW"†6÷VçB’ÇÂ6÷VçBÂÇÂ6÷VçBâ6†÷6Vâç&VÖ–æ–æu÷&WGW&æ&ÆR’°¢&W7VÇBçFW‡D6öçFVçBÒuVçF—L:’7W:—&–WW&RW‚'F–6ÆW2&VÖ—2F—7öæ–&ÆW2âs°¢&WGW&ã°¢Ğ¢–b‡&V6öâçfÇVRÓÓÒv÷F†W"rbbæ÷FRçfÇVRçG&–Ò‚’æÆVæwF‚Â2’°¢&W7VÇBçFW‡D6öçFVçBÒu,:–6—6W¢ÆRÖ÷F–bGR&WF÷W"âs°¢&WGW&ã°¢Ğ¢7&VFRæF—6&ÆVBÒG'VS°¢&W7VÇBçFW‡D6öçFVçBÒtVç&Vv—7G&VÖVçBFRÆFVÖæF^(
bs°¢G'’°¢v—B§6öå&WVW7B†6öçFW‡BæfWF6‚Ârö’÷&VÆ’÷&WGW&ç2rÂ°¢ÖWF†öC¢uõ5BrÂ&öG“¢°¢÷&FW%÷&VfW&Væ6S¢÷&FW"ç&VfW&Væ6RÂ÷&FW%ö—FVÕö–C¢6†÷6Vâæ–BÀ¢VçF—G“¢6÷VçBÂ&V6öã¢&V6öâçfÇVRÂæ÷FS¢æ÷FRçfÇVRçG&–Ò‚’À¢ÒÀ¢Ò“°¢6VÆV7F–öâæ†–FFVâÒG'VS°¢÷&FW"ÒçVÆÃ°¢—FV×2ÒµÓ°¢&W7VÇBçFW‡D6öçFVçBÒtF÷76–W"4bVç&Vv—7G,:’â8W†Ö–æW""¶öÖW&6R²V7Vâ&WF÷W"‡—6—VR÷RvÆÆWB6öæf—&Ü:’âs°¢v—BÆöE&WVW7G2‚“°¢Ò6F6‚†W'&÷"’²&W7VÇBçFW‡D6öçFVçBÒW'&÷"æÖW76vS²Ğ¢f–æÆÇ’²7&VFRæF—6&ÆVBÒfÇ6S²Ğ¢Ò“° ¢ÆöE&WVW7G2‚’æ6F6‚‚‚’Óâ·Ò“°¢Ğ ¢gVæ7F–öâ&VæFW%–ÆöB‡&ö÷DæöFRÂV’ÂFö2Â–ÆöBÂ6öçFW‡B’°¢&ö÷DæöFRæ6Æ74æÖRÒv¶Ö2Ö÷W&F–öç2×v÷&·76Rs°¢&ö÷DæöFRç6WDGG&–'WFR‚vFF×v÷&·76RÖ¶–æBrÂv‡V"×&VÆ’r“°¢&ö÷DæöFRç6WDGG&–'WFR‚vFF×v÷&·76RÖÖöFRrÂ6öçFW‡BæÖöFR“°¢&ö÷DæöFRç6WDGG&–'WFR‚vFF×&VÆ’Ö6÷VçFW"rÆ6öçFW‡Bæfö7W4öæÇ“òwG'VRs¢vfÇ6Rr“°¢&ö÷DæöFRç&WÆ6T6†–ÆG&Vâ‚“°¢6öç7B†VFW#Ö7&VFT†VFW"†Fö2Ç–ÆöBÆ6öçFW‡BæÖöFR“°¢–b†6öçFW‡BæÖöFSÓÓÒw&VÆ’ÖW†V7WF–öâr’°¢òòÆR&–ÂÜ:—F–W"f÷W&æ—BL:–¬:Âv6<:‡2fÇW‚&VÆ—2¢2FRFWW†œ:†ÖRÆ–Vâ–FVçF—VRà¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76RÖæbr“òç&VÖ÷fR‚“°¢Ğ¢–b†6öçFW‡Bæfö7W4öæÇ’’°¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76RÖ¶–6¶W"r’çFW‡D6öçFVçCÒu$TÄ•2+r4ôÕDô•"s°¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76R×F—FÆRr’çFW‡D6öçFVçCÒu&VÖ—6W26Æ–VçBs°¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76R×7V'F—FÆRr’çFW‡D6öçFVçCĞ¢6öçFW‡BæÖ&¶WD6öFR²r+r–FVçF–f–W"ÆR&öâ6öÆ—2Âl:—&–f–W"ÆW26öæF—F–öç2FR&WG&—BÂGFW7FW"Æ&VÖ—6Râs°¢Ö6÷VçFW"rÆ6öçFW‡Bæfö7W4öæÇ“òwG'VRs¢vfÇ6Rr“°¢&ö÷DæöFRç&WÆ6T6†–ÆG&Vâ‚“°¢6öç7B†VFW#Ö7&VFT†VFW"†Fö2Ç–ÆöBÆ6öçFW‡BæÖöFR“°¢–b†6öçFW‡BæÖöFSÓÓÒw&VÆ’ÖW†V7WF–öâr’°¢òòÆR&–ÂÜ:—F–W"f÷W&æ—BL:–¬:Âv6<:‡2fÇW‚&VÆ—2¢2FRFWW†œ:†ÖRÆ–Vâ–FVçF—VRà¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76RÖæbr“òç&VÖ÷fR‚“°¢Ğ¢–b†6öçFW‡Bæfö7W4öæÇ’’°¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76RÖ¶–6¶W"r’çFW‡D6öçFVçCÒu$TÄ•2+r4ôÕDô•"s°¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76R×F—FÆRr’çFW‡D6öçFVçCÒu&VÖ—6W26Æ–VçBs°¢†VFW"çVW'•6VÆV7F÷"‚ræ¶Ö2×v÷&·76R×7V'F—FÆRr’çFW‡D6öçFVçCĞ¢6öçFW‡BæÖ&¶WD6öFR²r+r–FVçF–f–W"ÆR&öâ6öÆ—2Âl:—&–f–W"ÆW26öæF—F–öç2FR&WG&—BÂGFW7FW"Æ&VÖ—6Râs°¢Ğ¢&ö÷DæöFRæVæD6†–ÆB††VFW"“°¢–b†6öçFW‡BæÖöFSÓÓÒw&VÆ’ÖW†V7WF–öâr’°¢6öç7BæcÖFö2æ7&VFTVÆVÖVçB‚væbr“°¢æbæ6Æ74æÖSÒv¶Ö2×&VÆ’ÖÖ–âÖæbs°¢æbç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂtW76W2FRG&f–ÂGR&VÆ—2r“°¢6öç7B7F—fU&VÆ•F#Ö6öçFW‡Bæfö7W4öæÇ“òu&VÖ—6W2s¦6öçFW‡Bçf–WsÓÓÒw&WGW&ç2sòt–æ6–FVçG2b4bs¢tfÇW‚&VÆ—2s°¢6öç7BÆ–æ·3Õ°¢²tfÇW‚&VÆ—2rÂröFÖ–â÷&VÆ—2ÖÆ—fRr²†6öçFW‡BæÖ&¶WD6öFSòsöÖ&¶WCÒr¶Væ6öFUU$”6ö×öæVçB†6öçFW‡BæÖ&¶WD6öFR“¢rr’Æ7F—fU&VÆ•F#ÓÓÒtfÇW‚&VÆ—2uÒÀ¢²u&VÖ—6W2rÂröFÖ–â÷&VÆ—2ÖÆ—fS÷f–Ws×&VÖ—6W2fÖ&¶WCÒr¶Væ6öFUU$”6ö×öæVçB†6öçFW‡BæÖ&¶WD6öFR’Æ7F—fU&VÆ•F#ÓÓÒu&VÖ—6W2uÒÀ¢²t–æ6–FVçG2b4brÂröFÖ–â÷&VÆ—2ÖÆ—fS÷f–WsÖ–æ6–FVçG2fÖ&¶WCÒr¶Væ6Ú±î¸Â¸­yêë¢°k¢G§¦*^odeURIComponent(context.marketCode),activeRelayTab==='Incidents & SAV'],
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

    // En Hub Live le dossier porte dÃ©jÃ  les quatre indicateurs de sa projection
    // serveur. Ne pas rÃ©pÃ©ter les mÃ©triques Relais ni repousser la file sous le pli.
    if (context.mode !== 'execution' && context.mode !== 'relay-execution') {
      const metrics = doc.createElement('section');
      metrics.className = 'kmc-workspace-metrics';
      rootNode.appendChild(metrics);
      ui.MetricStrip.render(metrics, { items: context.mode==='relay-execution' ? metricItems(payload.summary).filter(x=>['cash','receive','collect'].includes(x.key)) : metricItems(payload.summary) });
    }

    // UX-07 : une vue = une question. Un seul groupe de sections Ã  la fois.
    // Mode Â« execution Â» (Hub live) : uniquement les actions Hub ; les actions Relais restent hors de cette surface.
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
        {key:'receive',label:'RÃ©ception locale',count:(relay.local_receipt_pending||[]).length+(relay.to_receive||[]).filter(x=>x.local_receivable===true).length},
        {key:'collect',label:'Remise client',count:(relay.to_collect||[]).length},
      ];
      if(!RELAY_OPERATION_KEYS.includes(context.activeRelayQueue)) {
        context.activeRelayQueue=RELAY_OPERATION_KEYS.includes(context.initialFocus)?context.initialFocus:
          (pending>0?'shipments':relay.to_collect?.length?'collect':
          relay.cash_pending?.length?'cash':
          relay.local_receipt_pending?.length || relay.to_receive?.some(x=>x.local_receivable===true)?'receive':'shipments');
      }
      const guide=doc.createElement('section');
      guide.className='kmc-relay-next';
      guide.setAttribute('data-relay-next', '');
      guide.setAttribute('aria-label','Prochain geste au relais');
      const nextTitle=text(doc,m«ëŒ+Š×®º+º$zzb¥æöFUU$”6ö×öæVçB†6öçFW‡BæÖ&¶WD6öFR’Æ7F—fU&VÆ•F#ÓÓÒt–æ6–FVçG2b4buÒÀ¢²t†—7F÷&—VRrÂröFÖ–â÷&VÆ—2ÖÆ—fS÷f–WsÖ÷&FW'2fÆ—7CÖ6öÆÆV7FVBfÖ&¶WCÒr¶Væ6öFUU$”6ö×öæVçB†6öçFW‡BæÖ&¶WD6öFR’ÆfÇ6UÒÀ¢Ó°¢f÷"†6öç7B·F—FÆRÆ‡&VbÆ7F—fUÒöbÆ–æ·2’°¢6öç7BÆ–æ³×FW‡B†Fö2ÂvrÂv¶Ö2×&VÆ’ÖÖ–â×F"rÇF—FÆR“°¢Æ–æ²æ‡&VcÖ‡&Vc°¢–b†7F—fR–Æ–æ²ç6WDGG&–'WFR‚v&–Ö7W'&VçBrÂwvRr“°¢æbæVæD6†–ÆB†Æ–æ²“°¢Ğ¢&ö÷DæöFRæVæD6†–ÆB†æb“°¢Ğ ¢òòVâ‡V"Æ—fRÆRF÷76–W"÷'FRL:–¬:ÆW2VG&R–æF–6FWW'2FR6&ö¦V7F–öà¢òò6W'fWW"âæR2,:—:—FW"ÆW2Ü:—G&—VW2&VÆ—2æ’&W÷W76W"Æf–ÆR6÷W2ÆRÆ’à¢–b†6öçFW‡BæÖöFRÓÒvW†V7WF–öârbb6öçFW‡BæÖöFRÓÒw&VÆ’ÖW†V7WF–öâr’°¢6öç7BÖWG&–72ÒFö2æ7&VFTVÆVÖVçB‚w6V7F–öâr“°¢ÖWG&–72æ6Æ74æÖRÒv¶Ö2×v÷&·76RÖÖWG&–72s°¢&ö÷DæöFRæVæD6†–ÆB†ÖWG&–72“°¢V’äÖWG&–57G&—ç&VæFW"†ÖWG&–72Â²—FV×3¢6öçFW‡BæÖöFSÓÓÒw&VÆ’ÖW†V7WF–öâròÖWG&–4—FV×2‡–ÆöBç7VÖÖ'’’æf–ÇFW"‡ƒÓå²v66‚rÂw&V6V—fRrÂv6öÆÆV7BuÒæ–æ6ÇVFW2‡‚æ¶W’’’¢ÖWG&–4—FV×2‡–ÆöBç7VÖÖ'’’Ò“°¢Ğ ¢òòU‚Ór¢VæRgVRÒVæRVW7F–öââVâ6WVÂw&÷WRFR6V7F–öç2:Æfö—2à¢òòÖöFR*²W†V7WF–öâ+²„‡V"Æ—fR’¢Væ—VVÖVçBÆW27F–öç2‡V"²ÆW27F–öç2&VÆ—2&W7FVçB†÷'2FR6WGFR7W&f6Rà¢6öç7Bf–Ww2Ò6öçFW‡BæÖöFRÓÓÒw&VÆ’ÖW†V7WF–öârò$TÄ•ôÄ•dUõD%0¢¢6öçFW‡BæÖöFRÓÓÒvW†V7WF–öâròU„T5UD”ôåõd”Uu2¢tõ$µ54Uõd”Uu3°¢6öç7Bf–WrÒf–Ww2ç6öÖR†—FVÒÓâ—FVÒæ–BÓÓÒ6öçFW‡Bçf–Wr’ò6öçFW‡Bçf–Wr¢f–Ww5³Òæ–C°¢–b‚6öçFW‡Bæfö7W4öæÇ’—&ö÷DæöFRæVæD6†–ÆB†7&VFUf–WuF'2†Fö2Âf–WrÂæW‡Ef–WrÓâ°¢6öçFW‡Bçf–WrÒæW‡Ef–Ws°¢&VæFW%–ÆöB‡&ö÷DæöFRÂV’ÂFö2Â–ÆöBÂ6öçFW‡B“°¢ÒÂf–Ww2’“° ¢–b†6öçFW‡BæÖöFSÓÓÒw&VÆ’ÖW†V7WF–öârbbf–WsÓÓÒw&VÆ’rbb6öçFW‡Bæfö7W4öæÇ’’°¢6öç7B&VÆ“×–ÆöBçVWVW3òç&VÆ—ÇÇ·Ó°¢6öç7BÆÅ6†—ÖVçG3Ö6öçFW‡Bç&VÆ•6†—ÖVçG3òç6†—ÖVçG3°¢6öç7BVæF–æsÔ'&’æ—4'&’†ÆÅ6†—ÖVçG2“öÆÅ6†—ÖVçG2æf–ÇFW"†—56†—ÖVçE&V6V—f&ÆR’æÆVæwFƒ¦çVÆÃ°¢6öç7B6†ö–6W3Õ°¢¶¶W“¢w6†—ÖVçG2rÆÆ&VÃ¢t'&—fvW2rÆ6÷VçC§VæF–æwÒÀ¢¶¶W“¢v66‚rÆÆ&VÃ¢tVæ6—76W"rÆ6÷VçC¢‡&VÆ’æ66…÷VæF–æwÇÅµÒ’æÆVæwF‡ÒÀ¢¶¶W“¢w&V6V—fRrÆÆ&VÃ¢u,:–6WF–öâÆö6ÆRrÆ6÷VçC¢‡&VÆ’æÆö6Å÷&V6V—E÷VæF–æwÇÅµÒ’æÆVæwF‚²‡&VÆ’çFõ÷&V6V—fWÇÅµÒ’æf–ÇFW"‡ƒÓç‚æÆö6Å÷&V6V—f&ÆSÓÓ×G'VR’æÆVæwF‡ÒÀ¢¶¶W“¢v6öÆÆV7BrÆÆ&VÃ¢u&VÖ—6R6Æ–VçBrÆ6÷VçC¢‡&VÆ’çFõö6öÆÆV7GÇÅµÒ’æÆVæwF‡ÒÀ¢Ó°¢–b‚$TÄ•ôõU$D”ôåô´U•2æ–æ6ÇVFW2†6öçFW‡Bæ7F—fU&VÆ•VWVR’’°¢6öçFW‡Bæ7F—fU&VÆ•VWVSÕ$TÄ•ôõU$D”ôåô´U•2æ–æ6ÇVFW2†6öçFW‡Bæ–æ—F–Äfö7W2“ö6öçFW‡Bæ–æ—F–Äfö7W3 ¢‡VæF–æsãòw6†—ÖVçG2s§&VÆ’çFõö6öÆÆV7CòæÆVæwFƒòv6öÆÆV7Bs ¢&VÆ’æ66…÷VæF–æsòæÆVæwFƒòv66‚s ¢&VÆ’æÆö6Å÷&V6V—E÷VæF–æsòæÆVæwF‚ÇÂ&VÆ’çFõ÷&V6V—fSòç6öÖR‡ƒÓç‚æÆö6Å÷&V6V—f&ÆSÓÓ×G'VR“òw&V6V—fRs¢w6†—ÖVçG2r“°¢Ğ¢6öç7BwV–FSÖFö2æ7&VFTVÆVÖVçB‚w6V7F–öâr“°¢wV–FRæ6Æ74æÖSÒv¶Ö2×&VÆ’ÖæW‡Bs°¢wV–FRç6WDGG&–'WFR‚vFF×&VÆ’ÖæW‡BrÂrr“°¢wV–FRç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂu&ö6†–âvW7FRR&VÆ—2r“°¢6öç7BæW‡EF—FÆS×FW‡B†Fö2Âw7G&öærrÂv¶Ö2×&VÆ’ÖæW‡B×F—FÆRrÂ|8f—&RÖ–çFVæçBr“°¢æW‡EF—FÆRç6WDGG&–'WFR‚vFF×&VÆ’ÖæW‡B×F—FÆRrÂrr“°¢wV–FRæVæD6†–ÆB†æW‡EF—FÆR“°¢6öç7BæW‡DFWF–Ã×FW‡B†Fö2Âw7ârÂv¶Ö2×&VÆ’ÖæW‡BÖFWF–ÂrÂt6†ö—6—76W¢VæRf–ÆR6’ÖFW76÷W2âr“°¢æW‡DFWF–Âç6WDGG&–'WFR‚vFF×&VÆ’ÖæW‡BÖFWF–ÂrÂrr“°¢wV–FRæVæD6†–ÆB†æW‡DFWF–Â“°¢&ö÷DæöFRæVæD6†–ÆB†wV–FR“°¢6öç7BFö6³ÖFö2æ7&VFTVÆVÖVçB‚væbr“°¢Fö6²æ6Æ74æÖSÒv¶Ö2×&VÆ’ÖW†V7WF–öâÖ§V×&"s°¢Fö6²ç6WDGG&–'WFR‚v&–ÖÆ&VÂrÂt6†ö—6—"VæR÷:—&F–öâGR&VÆ—2r“°¢f÷"†6öç7B6†ö–6Röb6†ö–6W2’°¢6öç7BÆ–æ³ÖFö2æ7&VFTVÆVÖVçB‚vr“°¢Æ–æ²æ6Æ74æÖSÒv¶Ö2×&VÆ’ÖW†V7WF–öâÖ§V×s°¢Æ–æ²æ‡&VcÒr7&VÆ’ÖW†V7WF–öâÒr¶6†ö–6Ræ¶W“°¢Æ–æ²ç6WDGG&–'WFR‚vFF×&VÆ’ÖW†V7WF–öâÖ§V×rÆ6†ö–6Ræ¶W’“°¢–b†6†ö–6Ræ6÷VçBÓÖçVÆÂ–Æ–æ²ç6WDGG&–'WFR‚vFF×&VÆ’Ö—FVÒÖ6÷VçBrÅ7G&–ær†6†ö–6Ræ6÷VçB’“°¢Æ–æ²æVæD6†–ÆB‡FW‡B†Fö2Âw7G&öærrÂrrÆ6†ö–6RæÆ&VÂ’“°¢–b†6†ö–6Ræ6÷VçBÓÖçVÆÂ–Æ–æ²æVæD6†–ÆB‡FW‡B†Fö2Âv"rÂrrÅ7G&–ær†6†ö–6Ræ6÷VçB’’“°¢Æ–æ²æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚“Óç°¢6öçFW‡Bæ7F—fU&VÆ•VWVSÖ6†ö–6Ræ¶W“°¢6†÷u&VÆ”÷W&F–öâ‡&ö÷DæöFRÆ6†ö–6Ræ¶W’“°¢Ò“°¢Fö6²æVæD6†–ÆB†Æ–æ²“°¢Ğ¢&ö÷DæöFRæVæD6†–ÆB†Fö6²“°¢Ğ ¢–b‚‡f–WrÓÓÒv‡V"rÇÂf–WrÓÓÒv–çfVçF÷'’r’bb—4‡V%&VDöæÇ’†6öçFW‡B’’&VæFW$W†V7WFTÆ–æ²‡&ö÷DæöFRÂFö2Â6öçFW‡B“° ¢–b‡f–WrÓÓÒv‡V"r’°¢6öç7BF—7G&–'WF–öâÒ7&VFU6V7F–öâ€¢&ö÷DæöFRÀ¢V’À¢t‡V"+r,:—'F—F–öârÀ¢u,:—'F—BVæ—VVÖVçBÆW26öÖÖæFW2æöâ76–vì:–W2FR6RÖ&6Œ:’Fç2ÆW26öÆ—2WF÷&—<:—2âp¢“°¢6öç7BF—7G&–'WF–öä&"ÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢F—7G&–'WF–öä&"æ6Æ74æÖRÒv¶Ö2×v÷&·76R×6V7F–öâÖ7F–öç2s°¢6öç7BF—7G&–'WFT'WGFöâÒÖ¶T7F–öä'WGFöâ†Fö2Âu,:—'F—"6RÖ&6Œ:’rÂw'VâÖF—7G&–'WF–öâr“°¢òòÃ–¢*²,:—'F—"6RÖ&6Œ:’+²âvW7B&÷÷<:’VR6’ÆR6W'fWW"f÷W&æ—BFW26öÖÖæFW2:,:—'F—"à¢–b‚—4‡V%&VDöæÇ’†6öçFW‡B’bb'&’æ—4'&’‡–ÆöBæF—7G&–'WF–öâbb–ÆöBæF—7G&–'WF–öâçVæ76–væVB’bb–ÆöBæF—7G&–'WF–öâçVæ76–væVBæÆVæwF‚â’°¢F—7G&–'WF–öä&"æVæD6†–ÆB†F—7G&–'WFT'WGFöâ“°¢F—7G&–'WF–öâæVæD6†–ÆB†F—7G&–'WF–öä&"“°¢F—7G&–'WFT'WGFöâæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’Óâ'Vä7F–öâ†6öçFW‡BÂF—7G&–'WFT'WGFöâÂ°¢W&Ã¢VæGö–çDf÷"†6öçFW‡BæÖ&¶WD6öFRÂvF—7G&–'WF–öâ÷'Vâr’À¢6öæf—&ÔÖW76vS¢Ææ6W"Æ,:—'F—F–öâWFöÖF—VR÷W"G¶6öçFW‡BæÖ&¶WD6öFWÒöÀ¢'Vææ–ætÖW76vS¢u,:—'F—F–öâVâ6÷W'>(
brÀ¢7V66W74ÖW76vS¢u,:—'F—F–öâFW&Ö–ì:–RârÀ¢Ò’æ6F6‚‚‚’Óâ·Ò’“°¢Ğ¢6öç7BF—7G&–'WF–öåF&ÆRÒFö2æ7&VFTVÆVÖVçB‚vF—br“°¢F—7G&–'WF–öâæVæD6†–ÆB†F—7G&–'WF–öåF&ÆR“°¢V’äFFF&ÆRç&VæFW"†F—7G&–'WF–öåF&ÆRÂ°¢6öÇVÖç3¢°¢²¶W“¢w&VfW&Væ6RrÂÆ&VÃ¢t6öÖÖæFRrÒÀ¢²¶W“¢v6Æ–VçEöæÖRrÂÆ&VÃ¢t6Æ–VçBrÒÀ¢²¶W“¢w&VÆ—5öæÖRrÂÆ&VÃ¢u&VÆ—2rÒÀ¢²¶W“¢v—FVÕö6÷VçBrÂÆ&VÃ¢t'F–6ÆW2rÂÆ–vã¢w&–v‡BrÒÀ¢²¶W“¢wF÷FÅö¶ÖbrÂÆ&VÃ¢tÖöçFçBrÂÆ–vã¢w&–v‡BrÂf÷&ÖC¢f÷&ÖD¶ÖbÒÀ¢²¶W“¢Ú±î¸Â¸­yêë¢°k¢G§¦*^'action', label: 'Action', align: 'right' },
      ],
      rows: payload.distribution.unassigned,
      emptyText: 'Aucune commande Ã  rÃ©partir.',
    });
    // RÃ©partition d'UNE commande (mÃªme writer et mÃªmes droits que Â« RÃ©partir ce marchÃ© Â»).
    if (!isHubReadOnly(context)) {
      distributionTable.querySelectorAll('tbody tr').forEach((rowNode, index) => {
        const row = payload.distribution.unassigned[index];
        const actionCell = rowNode.lastChild;
        if (!row || !actionCell) return;
        actionCell.replaceChildren();
        const button = makeActionButton(doc, 'RÃ©partir', 'distribute-order');
        actionCell.appendChild(button);
        button.addEventListener('click', () => runAction(context, button, {
          url: endpointFor(context.marketCode, `orders/${encodeURIComponent(row.reference)}/distribute`),
          confirmMessage: `RÃ©partir la commande ${row.reference} ?`,
          runningMessage: `${row.reference} Â· rÃ©partition en coursâ€¦`,
          successMessage: `${row.reference} Â· rÃ©partition terminÃ©e.`,
        }).catch(() => {}));
      });
    }

    renderParcelActionSection(rootNode, ui, doc, context, {
      title: 'Hub Â· ExpÃ©dier',
      description: 'Colis en prÃ©paration prÃªts pour le scan dâ€™expÃ©dition.',
      rows: payload.queues.hub.to_ship,
      hub: true,
      action: 'ship',
      actionLabel: 'ExpÃ©dier',
      suffix: row => `parcels/${encodeURIComponent(row.reference)}/ship`,
      confirm: row => `Confirmer lâ€™expÃ©dition de ${row.reference} ?`,
      empty: 'Aucun colis Ã  expÃ©dier.',
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
      description: 'Confirmer uniquement les paiements cash rÃ©ellement reÃ§us.',
      rows: payload.queues.relay.cash_pending,
      action: 'confirm-cash',
      jumpId:'relay-execution-cash',
      actionLabel: 'Encaisser',
      suffix: row => `orders/${encodeURIComponent(row.reference)}/confirm-cash`,
      confirm: row => `Confirmer lâ€™encaissement cash de ${row.reference} ?`,
      empty: 'Aucun paiement cash Ã  encaisser.',
    });

    // Deux circuits de rÃ©ception sous UN seul aiguillage. Une commande
    // LOCAL_STOCK directe n'est jamais assimilÃ©e Ã  un colis expÃ©diÃ©.
    const localReceiveLane = doc.createElement('div');
    localReceiveLane.id = 'relay-execution-receive';
    localReceiveLane.setAttribute('data-relay-local-receive-lane', '');
    rootNode.appendChild(localReceiveLane);
    renderDirectLocalReceiptSection(localReceiveLane, ui, doc, context,
      payload.queues.relay.local_receipt_pending || []);

    // Geste rÃ©servÃ© au colis local dÃ©jÃ  expÃ©diÃ© par le Hub (ancien circuit).
    // Le tableau reste dans la mÃªme file de rÃ©ception, sans doublon de navigation.
    renderParcelActionSection(localReceiveLane, ui, doc, context, {
      title: 'RÃ©ception locale',
      description: 'RÃ©ceptionner les colis locaux autorisÃ©s, avec preuve.',
      rows: payload.queues.relay.to_receive.filter(row => row.local_receivable === true),
      action: 'receive',
      actionLabel: 'ReÃ§u au relais',
      suffix: row => `parcels/${encodeURIComponent(row.reference)}/receive`,
      confirm: row => `Confirmer la rÃ©ception de ${row.reference} au relais ?`,
      empty: 'Aucun colis local Ã  rÃ©ceptionner.',
    });
    }

    renderPickupCodeSection(rootNode, ui, doc, context, {
      title: 'Remettre au client',
      description: 'Sans scanner : demandez le code complet au client et saisissez-le au clavier. Le serveur vÃ©rifie le code, le relais et le prochain lot avant toute remise.',
      rows: payload.queues.relay.to_collect,
      jumpId:'relay-execution-collect',
      empty: 'Aucun colis Ã  remettre.',
    });
      if(context.mode==='relay-execution' && !context.focusOnly) {
        showRelayOperation(rootNode,context.activeRelayQueue);
      }
    }

    if (view === 'returns' && context.mode === 'relay-execution') renderRelayReturnRequests(rootNode, ui, doc, context);

    if (view === 'inventory') renderInventorySection(rootNode, ui, doc, payload, context);

    // Cash & dÃ©pÃ´ts : module canonique de comptabilitÃ© (mÃªmes routes, mÃªmes contrÃ´les) hÃ©bergÃ© dans Relais live.
    if (view === 'cash') {
      const host = doc.createElement('div');
      host.setAttribute('data-relay-cash-host', '');
      rootNode.appendChild(host);
      const cashModule = globalThis.KomerceCanonicalFinanceAccountingWorkspace;
      if (!cashModule) {
        host.appendChild(text(doc, 'p', 'kmc-workspace-note', 'Module Cash & dÃ©pÃ´ts indisponible.'));
      } else {
        cashModule.mount({
          root: host, document: doc, ui, fetch: context.fetch, user: context.user || {},
          adminContext: null, requestedMarket: context.marketCode,
          contextContract: { resolveMarketView: () => ({ marketCode: context.marketCode }) },
        }).catch(error => host.appendChild(text(doc, 'p', 'kmc-workspace-note', error.message)));
      }
    }
  }

  // L9c : le workspace Hub & Relais lit les files Hub ; les gestes Hub s'exÃ©cutent uniquement dans Hub live.
  function isHubReadOnly(context) {
    return context.mode !== 'execution';
  }

  function renderExecuteLink(rootNode, doc, context) {
    const bar = doc.createElement('p');
    bar.className = 'kmc-workspace-muted kmc-workspace-execute-link';
    const link = doc.createElement('a');
    link.href = `/admin/hub-live?view=execute&market=${encodeURIComponent(context.marketCode)}`;
    link.textContent = 'ExÃ©cuter dans Hub live';
    link.setAttribute('data-action', 'open-hub-live');
    bar.appendChild(link);
    rootNode.appendChild(bar);
  }

  function renderOrderActionSection(rootNode, ui, doc, context, config) {
    const slot = createSection(rootNode, ui, config.title, config.description);
    if (config.jumpId && slot.parentElement) slot.parentElement.id=config.jumpId;
    renderActionRows(slot, doc, context, config, 'order');
  }

  // Attestation rÃ©elle au relais : le statut d'une commande n'est jamais une
  // preuve physique. L'agent coche explicitement la possession et ajoute une
  // rÃ©fÃ©rence/observation ; le serveur conserve la preuve canonique dans scans.
  function renderDirectLocalReceiptSection(rootNode, ui, doc, context, rows) {
    const slot = createSection(rootNode, ui, 'Relais Â· RÃ©ception locale directe',
      'Commande payÃ©e avec articles en stock local : rÃ©ception physique au relais, sans Hub ni expÃ©dition fictive.');
    slot.setAttribute('data-relay-direct-local-receipts', '');
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune commande locale en attente de rÃ©ception physique.'));
      return;
    }
    rows.forEach(row => {
      // Seul l'identifiant serveur est utilisÃ© ; le marchÃ© client n'est jamais
      // une source d'autoritÃ© pour cette mutation.
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(String(row.id || ''))) return;
      const card = doc.createElement('div');
      card.className = 'kmc-workspace-manual-reason';
      card.setAttribute('data-relay-local-order', row.reference);
      const heading = text(doc, 'strong', 'kmc-workspace-ref-text', row.reference);
      const meta = text(doc, 'span', 'kmc-workspace-muted',
        [row.client_name, row.relais_name, 'Articles ' + (row.item_count || 'â€”')].filter(Boolean).join(' Â· '));
      const label = doc.createElement('label');
      const received = doc.createElement('input');
      received.type = 'checkbox';
      received.setAttribute('data-local-physical-proof', '');
      label.append(received, doc.createTextNode(' Articles physiquement reÃ§us et contrÃ´lÃ©s'));
      const note = doc.createElement('input');
      note.type = 'text';
      note.maxLength = 500;
      note.placeholder = 'RÃ©fÃ©rence ou observation de rÃ©ception (obligatoire)';
      note.setAttribute('aria-label', 'RÃ©fÃ©rence ou observation de rÃ©ception pour ' + row.reference);
      note.setAttribute('data-local-receipt-note', '');
      const button = makeActionButton(doc, 'Attester la rÃ©ception', 'local-relay-receipt');
      button.addEventListener('click', () => {
        if (button.disabled) return;
        if (!received.checked || !note.value.trim()) {
          setFeedback(context.root, 'Confirmez la rÃ©ception physique et renseignez une rÃ©fÃ©rence ou observation.', 'critical');
          return;
        }
        runAction(context, button, {
