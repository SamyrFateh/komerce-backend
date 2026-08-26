/**
 * @komerce-arch
 * @role          canonical-finance-accounting-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        server_resolved_admin_context, explicit_market_code, accounting_work_queue
 * @outputs       canonical_accounting_workspace_dom, authorized_cash_deposit_requests
 * @depends       canonical primitives, admin-context
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, browser_never_supplies_market_id_authority
 * @impact-areas  admin-dashboard, payment, accounting
 * @version       2026-08
 */

'use strict';

(function initFinanceAccountingWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalFinanceAccountingWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createFinanceAccountingWorkspace() {
  const ENDPOINT_PREFIX = '/api/admin/workspaces/accounting/market/';
  const MARKET_CODE = /^[A-Z]{2}$/;

  function endpointFor(marketCode, suffix = '', filters = null) {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_accounting_workspace_market_required');
    const tail = suffix ? '/' + String(suffix).replace(/^\/+/, '') : '';
    const query = filters
      ? '?' + new URLSearchParams({ from: filters.from, to: filters.to, hours: String(filters.hours) }).toString()
      : '';
    return ENDPOINT_PREFIX + encodeURIComponent(code) + tail + query;
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value)} KMF`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
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

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function createHeader(doc, payload) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · FINANCE / COMPTABILITÉ'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Rapprocher le cash et contrôler les dépôts'));
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} · ${payload.scope.name} · aucune validation globale`
    ));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const finance = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Finance');
    finance.setAttribute('href', '/admin/finance');
    nav.appendChild(finance);
    const operations = text(doc, 'a', 'kmc-workspace-nav-link', 'Operations / Relais');
    operations.setAttribute('href', '/admin/workspaces/operations');
    nav.appendChild(operations);
    header.appendChild(nav);

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

  function makeButton(doc, label, action) {
    const button = text(doc, 'button', 'kmc-workspace-action', label);
    button.type = 'button';
    button.setAttribute('data-workspace-action', action);
    return button;
  }

  function metricItems(summary = {}) {
    return [
      { key: 'expected', label: 'Cash attendu', value: formatKmf(summary.expected_kmf), tone: 'neutral' },
      { key: 'collected', label: 'Cash collecté', value: formatKmf(summary.collected_kmf), tone: 'neutral' },
      { key: 'verified', label: 'Dépôts vérifiés', value: formatKmf(summary.verified_kmf), tone: 'positive' },
      { key: 'pending', label: 'Dépôts à vérifier', value: formatNumber(summary.pending_deposits), tone: summary.pending_deposits ? 'warning' : 'neutral' },
      { key: 'missing', label: 'Non encaissé', value: formatKmf(summary.uncollected_kmf), tone: summary.uncollected_kmf ? 'critical' : 'neutral' },
    ];
  }

  async function runAction(context, button, options) {
    const confirmFn = context.confirm || (() => true);
    if (options.confirmMessage && !confirmFn(options.confirmMessage)) return null;
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, options.runningMessage || 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, options.url, { method: 'POST', body: options.body });
      setFeedback(context.root, options.successMessage || 'Action appliquée.', 'positive');
      await context.reload();
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    }
  }

  function renderFilters(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Période de rapprochement', 'Le marché reste imposé par le contexte serveur ; seuls la période et le seuil d’alerte sont modifiables.');
    const form = doc.createElement('div');
    form.className = 'kmc-workspace-section-actions';
    const from = doc.createElement('input');
    from.type = 'date';
    from.value = payload.filters.from;
    from.setAttribute('aria-label', 'Début de période');
    const to = doc.createElement('input');
    to.type = 'date';
    to.value = payload.filters.to;
    to.setAttribute('aria-label', 'Fin de période');
    const hours = doc.createElement('select');
    hours.setAttribute('aria-label', 'Seuil non encaissé');
    [24, 48, 72, 168].forEach(value => {
      const option = doc.createElement('option');
      option.value = String(value);
      option.textContent = value === 168 ? '7 jours' : `${value} h`;
      if (Number(payload.filters.hours) === value) option.selected = true;
      hours.appendChild(option);
    });
    const apply = makeButton(doc, 'Appliquer', 'apply-accounting-filters');
    form.appendChild(from);
    form.appendChild(to);
    form.appendChild(hours);
    form.appendChild(apply);
    slot.appendChild(form);
    apply.addEventListener('click', async () => {
      context.filters = { from: from.value, to: to.value, hours: Number(hours.value) };
      await context.reload();
    });
  }

  function renderReconciliation(rootNode, ui, doc, payload) {
    const r = payload.reconciliation || {};
    const slot = createSection(rootNode, ui, 'Rapprochement cash', 'Attendu, collecté et déposé sont calculés exclusivement dans le marché sélectionné.');
    ui.DataTable.render(slot, {
      columns: [
        { key: 'expected', label: 'Attendu' },
        { key: 'collected', label: 'Collecté' },
        { key: 'deposited', label: 'Déposé' },
        { key: 'gap_collection', label: 'Écart collecte' },
        { key: 'gap_deposit', label: 'Écart dépôt' },
      ],
      rows: [{
        expected: formatKmf(r.expected_kmf),
        collected: formatKmf(r.collected_kmf),
        deposited: formatKmf(r.deposited_kmf),
        gap_collection: formatKmf(r.gap_collection_kmf),
        gap_deposit: formatKmf(r.gap_deposit_kmf),
      }],
      emptyText: 'Aucune donnée de rapprochement.',
    });
  }

  function renderDepositCreation(rootNode, ui, doc, context) {
    if (!context.user || context.user.role !== 'agent_relais') return;
    const slot = createSection(rootNode, ui, 'Relais · Déclarer un dépôt', 'Le déposant est toujours la session authentifiée et doit être affecté à un relais du marché.');
    const button = makeButton(doc, 'Déclarer un dépôt', 'create-cash-deposit');
    slot.appendChild(button);
    button.addEventListener('click', async () => {
      const promptFn = context.prompt || (() => null);
      const amount = promptFn('Montant du dépôt (KMF)');
      if (!amount) return;
      const method = promptFn('Méthode : mobile_money, bank ou physical', 'mobile_money');
      if (!method) return;
      const start = promptFn('Début période (YYYY-MM-DD)', context.filters.from);
      if (!start) return;
      const end = promptFn('Fin période (YYYY-MM-DD)', context.filters.to);
      if (!end) return;
      const reference = promptFn('Référence transaction / reçu (optionnel)', '') || '';
      await runAction(context, button, {
        url: endpointFor(context.marketCode, 'deposits'),
        body: {
          amount_kmf: Number(amount),
          deposit_method: method,
          period_start: start,
          period_end: end,
          reference: reference || undefined,
        },
        confirmMessage: `Déclarer ${formatKmf(amount)} pour cette période ?`,
        successMessage: 'Dépôt enregistré et envoyé à la vérification.',
      });
    });
  }

  function renderDeposits(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Dépôts relais', 'Les actions utilisent deposit_ref ; l’UUID du dépôt reste exclusivement côté serveur.');
    const rows = payload.deposits || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun dépôt rattaché à ce marché.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Dépôt</th><th>Relais</th><th>Agent</th><th>Montant</th><th>Méthode</th><th>Période</th><th>Statut</th><th>Déposé</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      [
        row.deposit_ref,
        row.relais_name,
        row.agent_name,
        formatKmf(row.amount_kmf),
        row.deposit_method,
        `${String(row.period_start || '').slice(0, 10)} → ${String(row.period_end || '').slice(0, 10)}`,
        row.status,
        formatDate(row.deposited_at),
      ].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      const actionCell = doc.createElement('td');
      if (context.user && context.user.role === 'admin') {
        if (row.status !== 'verified') {
          const verify = makeButton(doc, 'Vérifier', 'verify-cash-deposit');
          verify.addEventListener('click', () => runAction(context, verify, {
            url: endpointFor(context.marketCode, `deposits/${encodeURIComponent(row.deposit_ref)}/verify`),
            body: {},
            confirmMessage: `Valider le dépôt ${row.deposit_ref} ?`,
            successMessage: `${row.deposit_ref} vérifié.`,
          }));
          actionCell.appendChild(verify);
        }
        if (row.status !== 'disputed') {
          const dispute = makeButton(doc, 'Contester', 'dispute-cash-deposit');
          dispute.addEventListener('click', () => {
            const reason = (context.prompt || (() => null))(`Raison de la contestation pour ${row.deposit_ref}`);
            if (!reason) return;
            runAction(context, dispute, {
              url: endpointFor(context.marketCode, `deposits/${encodeURIComponent(row.deposit_ref)}/dispute`),
              body: { reason },
              confirmMessage: `Contester le dépôt ${row.deposit_ref} ?`,
              successMessage: `${row.deposit_ref} contesté.`,
            });
          });
          actionCell.appendChild(dispute);
        }
      }
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderUncollected(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Cash non encaissé', 'Commandes du marché dépassant le seuil sans cash_collection.');
    const rows = payload.uncollected || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune commande cash en anomalie.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Commande</th><th>Client</th><th>Relais</th><th>Montant</th><th>Statut</th><th>Depuis</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      const orderCell = doc.createElement('td');
      const link = text(doc, 'a', 'kmc-workspace-link', row.order_ref);
      link.setAttribute('href', `/admin/orders/${encodeURIComponent(row.order_ref)}`);
      orderCell.appendChild(link);
      tr.appendChild(orderCell);
      [row.client_name, row.relais_name, formatKmf(row.total_kmf), row.status, formatDate(row.created_at)].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderCollections(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Encaissements récents', 'Traçabilité des cash_collections du marché et de la période.');
    ui.DataTable.render(slot, {
      columns: [
        { key: 'confirmed_at', label: 'Date', format: formatDate },
        { key: 'order_ref', label: 'Commande' },
        { key: 'relais_name', label: 'Relais' },
        { key: 'agent_name', label: 'Agent' },
        { key: 'amount_kmf', label: 'Montant', format: formatKmf },
      ],
      rows: payload.collections || [],
      emptyText: 'Aucun encaissement sur la période.',
    });
  }

  function renderInvoices(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Factures émises', 'Les factures sont des snapshots immuables : 4D les observe et renvoie vers Order 360, sans les éditer.');
    const rows = payload.invoices || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune facture pour ce marché.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Facture</th><th>Commande</th><th>Montant</th><th>Paiement</th><th>Statut</th><th>Émise</th><th>PDF</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      const invoiceCell = doc.createElement('td');
      invoiceCell.textContent = row.invoice_number || '—';
      tr.appendChild(invoiceCell);
      const orderCell = doc.createElement('td');
      const link = text(doc, 'a', 'kmc-workspace-link', row.order_ref);
      link.setAttribute('href', `/admin/orders/${encodeURIComponent(row.order_ref)}`);
      orderCell.appendChild(link);
      tr.appendChild(orderCell);
      const amount = row.payment_mode === 'stripe_eur' || row.payment_mode === 'paypal_eur'
        ? `${Number(row.total_eur || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`
        : formatKmf(row.total_kmf);
      [amount, row.payment_mode, row.payment_status, formatDate(row.created_at), row.pdf_generated_at ? 'Disponible' : 'En attente'].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));
    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload.summary) });
    renderFilters(rootNode, ui, doc, payload, context);
    renderReconciliation(rootNode, ui, doc, payload);
    renderDepositCreation(rootNode, ui, doc, context);
    renderDeposits(rootNode, ui, doc, payload, context);
    renderUncollected(rootNode, ui, doc, payload);
    renderCollections(rootNode, ui, doc, payload);
    renderInvoices(rootNode, ui, doc, payload);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_accounting_workspace_dependencies_missing');
    }
    const resolved = options.contextContract.resolveMarketView(options.adminContext, options.requestedMarket);
    if (!resolved.marketCode) throw new Error('canonical_accounting_workspace_market_required');

    const now = new Date();
    const context = {
      root: rootNode,
      user: options.user || {},
      marketCode: resolved.marketCode,
      fetch: fetchFn,
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      filters: {
        from: new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
        hours: 48,
      },
      reload: null,
    };
    context.reload = async () => {
      const payload = await jsonRequest(fetchFn, endpointFor(context.marketCode, '', context.filters));
      context.filters = payload.filters || context.filters;
      renderPayload(rootNode, ui, doc, payload, context);
      return payload;
    };
    return context.reload();
  }

  return Object.freeze({ endpointFor, metricItems, mount });
});
