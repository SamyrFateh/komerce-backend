/**
 * @komerce-arch
 * @role          canonical-shipping-customs-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        server_resolved_admin_context, explicit_market_code, shipping_customs_work_queue
 * @outputs       canonical_shipping_customs_workspace_dom, authorized_action_requests
 * @depends       canonical primitives, admin-context
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, browser_never_supplies_market_id_authority
 * @impact-areas  admin-dashboard, logistics, customs
 * @version       2026-08
 */

'use strict';

(function initShippingCustomsWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalShippingCustomsWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createShippingCustomsWorkspace() {
  const ENDPOINT_PREFIX = '/api/admin/workspaces/shipping-customs/market/';
  const MARKET_CODE = /^[A-Z]{2}$/;

  function endpointFor(marketCode, suffix = '') {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_shipping_customs_workspace_market_required');
    const tail = suffix ? '/' + String(suffix).replace(/^\/+/, '') : '';
    return ENDPOINT_PREFIX + encodeURIComponent(code) + tail;
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
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · EXPÉDITIONS & DOUANE'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Faire avancer le flux international'));
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} · ${payload.scope.name} · aucune action globale`
    ));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const operations = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Opérations');
    operations.setAttribute('href', '/admin/operations');
    nav.appendChild(operations);
    const hub = text(doc, 'a', 'kmc-workspace-nav-link', 'Hub / Relais');
    hub.setAttribute('href', '/admin/workspaces/operations');
    nav.appendChild(hub);
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
      { key: 'transit-ready', label: 'À mettre en transit', value: formatNumber(summary.transit_ready), tone: summary.transit_ready ? 'warning' : 'neutral' },
      { key: 'transit-active', label: 'En transit', value: formatNumber(summary.transit_active), tone: 'neutral' },
      { key: 'customs-candidates', label: 'À rattacher douane', value: formatNumber(summary.customs_candidates), tone: summary.customs_candidates ? 'warning' : 'neutral' },
      { key: 'customs-pending', label: 'Douane à déclarer', value: formatNumber(summary.customs_pending), tone: summary.customs_pending ? 'warning' : 'neutral' },
      { key: 'customs-declared', label: 'Douane déclarée', value: formatNumber(summary.customs_declared), tone: 'neutral' },
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

  function renderTransit(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Transitaire · Confirmer le transit',
      'Seuls les colis déjà expédiés de ce marché sont actionnables. Le scan transit_confirmed est appliqué par le moteur logistique.'
    );
    const rows = payload.transit.ready || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun colis à mettre en transit.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Colis</th><th>Commande</th><th>Client</th><th>Destination</th><th>Poids</th><th>Depuis</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      [row.reference, row.order_ref, row.client_name, row.relais_name || row.destination_island, row.weight_kg == null ? '—' : `${row.weight_kg} kg`, formatDate(row.shipped_at)].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      const actionCell = doc.createElement('td');
      const button = makeButton(doc, 'Mettre en transit', 'confirm-transit');
      actionCell.appendChild(button);
      tr.appendChild(actionCell);
      button.addEventListener('click', () => runAction(context, button, {
        url: endpointFor(context.marketCode, `parcels/${encodeURIComponent(row.reference)}/confirm-transit`),
        confirmMessage: `Confirmer le transit de ${row.reference} ?`,
        successMessage: `${row.reference} est maintenant en transit.`,
      }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function candidateRefs(payload) {
    return (payload.customs && Array.isArray(payload.customs.candidates) ? payload.customs.candidates : [])
      .map(row => row.reference)
      .filter(Boolean);
  }

  function renderCustoms(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Douane · Expéditions',
      'Création, déclaration et activation restent limitées au marché sélectionné. Les identifiants techniques ne quittent pas le serveur.'
    );

    if (context.user && context.user.role === 'admin') {
      const actions = doc.createElement('div');
      actions.className = 'kmc-workspace-section-actions';
      const create = makeButton(doc, 'Nouvelle expédition douane', 'create-customs');
      actions.appendChild(create);
      slot.appendChild(actions);
      create.addEventListener('click', async () => {
        const promptFn = context.prompt || (() => null);
        const reference = promptFn('Référence expédition douane');
        if (!reference) return;
        const shipmentDate = promptFn('Date expédition (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
        if (!shipmentDate) return;
        const cif = promptFn('Valeur CIF (KMF)');
        if (!cif) return;
        const suggested = candidateRefs(payload).join(',');
        const refsRaw = promptFn('Colis à rattacher (références séparées par des virgules)', suggested) || '';
        const parcelRefs = refsRaw.split(',').map(value => value.trim()).filter(Boolean);
        await runAction(context, create, {
          url: endpointFor(context.marketCode, 'customs/shipments'),
          body: { reference, shipment_date: shipmentDate, cif_value_kmf: Number(cif), parcel_refs: parcelRefs },
          successMessage: `Expédition douane ${reference} créée.`,
        });
      });
    }

    const rows = payload.customs.shipments || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune expédition douane pour ce marché.'));
      return;
    }

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Date</th><th>Statut</th><th>Colis</th><th>CIF</th><th>Douane</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      [row.reference, String(row.shipment_date || '').slice(0, 10), row.status, row.linked_parcels, formatKmf(row.cif_value_kmf), formatKmf(row.customs_paid_kmf), row.is_active ? 'Active' : 'Inactive'].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value == null || value === '' ? '—' : String(value);
        tr.appendChild(td);
      });
      const td = doc.createElement('td');
      if (context.user && context.user.role === 'admin') {
        if (row.status === 'pending' && row.is_active) {
          const declare = makeButton(doc, 'Déclarer', 'declare-customs');
          declare.addEventListener('click', () => {
            const amount = (context.prompt || (() => null))(`Montant douane payé pour ${row.reference} (KMF)`);
            if (!amount) return;
            runAction(context, declare, {
              url: endpointFor(context.marketCode, `customs/shipments/${encodeURIComponent(row.reference)}/declare`),
              body: { customs_paid_kmf: Number(amount) },
              confirmMessage: `Déclarer ${formatKmf(amount)} pour ${row.reference} ?`,
              successMessage: `Douane déclarée pour ${row.reference}.`,
            });
          });
          td.appendChild(declare);
        }
        const toggle = makeButton(doc, row.is_active ? 'Désactiver' : 'Réactiver', row.is_active ? 'deactivate-customs' : 'activate-customs');
        toggle.addEventListener('click', () => {
          const suffix = row.is_active ? 'deactivate' : 'activate';
          let body = {};
          if (!row.is_active) {
            const refsRaw = (context.prompt || (() => ''))('Colis à rattacher lors de la réactivation (références séparées par des virgules)', candidateRefs(payload).join(',')) || '';
            body = { parcel_refs: refsRaw.split(',').map(value => value.trim()).filter(Boolean) };
          }
          runAction(context, toggle, {
            url: endpointFor(context.marketCode, `customs/shipments/${encodeURIComponent(row.reference)}/${suffix}`),
            body,
            confirmMessage: `${row.is_active ? 'Désactiver' : 'Réactiver'} ${row.reference} ?`,
            successMessage: `${row.reference} mis à jour.`,
          });
        });
        td.appendChild(toggle);
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderHistory(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Historique transit', 'Événements transit_confirmed appliqués dans ce marché.');
    const rows = payload.transit.history || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun transit confirmé récemment.'));
      return;
    }
    ui.DataTable.render(slot, {
      columns: [
        { key: 'created_at', label: 'Date', format: formatDate },
        { key: 'parcel_ref', label: 'Colis' },
        { key: 'order_ref', label: 'Commande' },
        { key: 'actor_name', label: 'Acteur' },
        { key: 'notes', label: 'Note' },
      ],
      rows,
      emptyText: 'Aucun événement.',
    });
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));
    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload.summary) });
    renderTransit(rootNode, ui, doc, payload, context);
    renderCustoms(rootNode, ui, doc, payload, context);
    renderHistory(rootNode, ui, doc, payload);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_shipping_customs_workspace_dependencies_missing');
    }
    const resolved = options.contextContract.resolveMarketView(options.adminContext, options.requestedMarket);
    if (!resolved.marketCode) throw new Error('canonical_shipping_customs_workspace_market_required');

    const context = {
      root: rootNode,
      user: options.user || {},
      marketCode: resolved.marketCode,
      fetch: fetchFn,
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      reload: null,
    };
    context.reload = async () => {
      const payload = await jsonRequest(fetchFn, endpointFor(context.marketCode));
      renderPayload(rootNode, ui, doc, payload, context);
      return payload;
    };
    return context.reload();
  }

  return Object.freeze({ endpointFor, metricItems, mount, _test: { candidateRefs } });
});
