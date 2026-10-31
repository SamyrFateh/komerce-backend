/**
 * @komerce-arch
 * @role          canonical-orders-dashboard
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context, requested_market_view
 * @outputs       canonical_orders_register (files de travail, actions contextuelles, lien 360)
 * @depends       admin-context, navigation-policy-v4
 * @used-by       canonical admin entrypoint (/admin/orders)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, missing_data_never_means_zero, server_market_scope_is_authority, dashboard_observes_workspace_acts
 * @impact-areas  admin-dashboard, orders
 * @version       2026-10
 */

'use strict';

(function initCanonicalOrders(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalOrders = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalOrders() {
  const GLOBAL_ENDPOINT = '/api/admin/dashboard/orders';
  const MARKET_ENDPOINT_PREFIX = '/api/admin/dashboard/orders/market/';

  // Libellés d'affichage des statuts existants (order-status-machine) — aucune taxonomie nouvelle.
  const STATUS_LABELS = Object.freeze({
    pending: 'En attente', pending_group_payment: 'Paiement groupé en attente', confirmed: 'Confirmée',
    ordered: 'Commandée au fournisseur', preparation: 'En préparation', shipped: 'Expédiée',
    in_transit: 'En transit', available: 'Disponible au relais', collected: 'Remise client',
    cancelled: 'Annulée', refunded: 'Remboursée',
  });
  const PAYMENT_LABELS = Object.freeze({ pending: 'À confirmer', paid: 'Payé', failed: 'Échec', refunded: 'Remboursé' });

  // Onglets = les trois files que la projection serveur fournit déjà. Aucun statut n'est recalculé ici.
  const TABS = Object.freeze([
    Object.freeze({ id: 'all', label: 'Toutes les files' }),
    Object.freeze({ id: 'cash', label: 'Cash à confirmer' }),
    Object.freeze({ id: 'to_order', label: 'À commander' }),
    Object.freeze({ id: 'awaiting', label: 'En attente de réception Hub' }),
    Object.freeze({ id: 'parcel', label: 'Préparer le colis' }),
    Object.freeze({ id: 'follow', label: 'À suivre / bloquées' }),
  ]);

  function endpointForContext(adminContext, contextContract, requestedMarket) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_orders_admin_context_contract_missing');
    }
    const view = contextContract.resolveMarketView(adminContext, requestedMarket);
    if (view.mode === 'global') return GLOBAL_ENDPOINT;
    return MARKET_ENDPOINT_PREFIX + encodeURIComponent(view.marketCode);
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  function hubExecutionHref(marketCode) {
    return `/admin/hub-live?view=execute&market=${encodeURIComponent(marketCode)}`;
  }

  function orderHref(reference) {
    const path = `/admin/orders/${encodeURIComponent(reference)}`;
    const nav = globalThis.KomerceCanonicalNavigation;
    const loc = globalThis.location;
    const origin = loc && loc.pathname === '/admin/orders'
      ? `${loc.pathname}${loc.search || ''}` : '/admin/orders';
    return nav && typeof nav.withEntityReturnTo === 'function'
      ? nav.withEntityReturnTo(path, origin, 'Retour aux commandes')
      : path;
  }

  // Keep the server-backed file selected after a 360 drill and browser return.
  function initialQueue(search) {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const selected = params.get('queue');
    return TABS.some(tab => tab.id === selected) ? selected : 'all';
  }

  function reflectQueueInUrl(queue) {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || loc.pathname !== '/admin/orders' || !hist || typeof hist.replaceState !== 'function') return;
    const params = new URLSearchParams(String(loc.search || '').replace(/^\?/, ''));
    if (queue === 'all') params.delete('queue');
    else params.set('queue', queue);
    const query = params.toString();
    hist.replaceState(hist.state, '', loc.pathname + (query ? `?${query}` : '') + (loc.hash || ''));
  }

  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function count(v) { return isNumber(v) ? String(v) : 'Non disponible'; }
  function money(v) {
    if (v == null || v === '' || !Number.isFinite(Number(v))) return 'Non disponible';
    return `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(v)))} KMF`;
  }
  function productsLabel(r) {
    if (!isNumber(r.product_lines)) return 'Non disponible';
    if (!r.product_lines) return 'Aucun produit';
    const first = r.first_product_name || 'Produit';
    return r.product_lines > 1 ? `${first} +${r.product_lines - 1}` : first;
  }
  function parcelsLabel(r) { return isNumber(r.parcel_count) ? String(r.parcel_count) : 'Non disponible'; }
  function statusLabel(s) { return STATUS_LABELS[s] || s || 'Non disponible'; }

  // Fusionne les trois files serveur en lignes de lecture. Dédoublonnage par référence ;
  // la première file qui porte la commande fixe l'action requise.
  function buildRows(payload) {
    const queues = payload.work_queues || {};
    const rows = [];
    const seen = new Map();
    function add(kind, item, action, extra) {
      const key = item.reference;
      if (seen.has(key)) { seen.get(key).queues.push(kind); return; }
      const row = { reference: item.reference, status: item.status, payment_mode: item.payment_mode || null,
        payment_status: item.payment_status || (kind === 'cash' ? 'pending' : kind === 'parcel' || kind === 'to_order' || kind === 'awaiting' ? 'paid' : null),
        total_kmf: item.total_kmf, client_name: item.client_name || null, relais_name: item.relais_name || null,
        market_code: item.market_code || null, product_lines: item.product_lines, first_product_name: item.first_product_name || null,
        parcel_count: item.parcel_count, problem: item.problem || null, since_days: item.since_days, action, actionable: item.actionable === false ? false : undefined, queues: [kind], ...extra };
      seen.set(key, row);
      rows.push(row);
    }
    (queues.pending_cash || []).forEach(i => add('cash', i, 'Confirmer le paiement', {}));
    (queues.to_order || []).forEach(i => add('to_order', i, (i.next_action && i.next_action.label) || 'À commander', { actionable: true }));
    (queues.awaiting_hub_reception || []).forEach(i => add('awaiting', i, (i.next_action && i.next_action.label) || 'En attente de réception Hub', { actionable: false }));
    (queues.ready_for_parcel || []).forEach(i => add('parcel', i, (i.next_action && i.next_action.label) || 'Préparer le colis', { actionable: true }));
    (payload.priority_orders || []).forEach(i => add('follow', i, i.problem || 'À suivre', {}));
    return rows;
  }

  function el(doc, tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // The operational priority is in the server-backed queue and next action
  // on each order row. Show only non-duplicated exceptional signals inline.
  // Missing data is *not* rendered as zero.
  function renderAttentionNote(doc, payload) {
    const signals = payload.signals || {};
    const items = [
      ['retraits_en_retard', 'retrait en retard', 'retraits en retard'],
      ['litiges_ouverts', 'litige ouvert', 'litiges ouverts'],
      ['commandes_bloquees', 'commande bloquée', 'commandes bloquées'],
    ].filter(([key]) => isNumber(signals[key]) && signals[key] > 0)
      .map(([key, singular, plural]) => `${signals[key]} ${signals[key] === 1 ? singular : plural}`);
    if (!items.length) return null;
    const notice = el(doc, 'p', 'kmc-ord-attention', `À surveiller : ${items.join(' · ')}`);
    notice.setAttribute('role', 'status');
    return notice;
  }

  function render(doc, rootNode, payload, state) {
    rootNode.textContent = '';
    // Preserve the canonical illustrated Orders Hero; the body matches the
    // Clients index rather than a second operational dashboard.
    const page = el(doc, 'div', 'kmc-ord kmc-domain-cockpit');
    page.setAttribute('data-canonical-orders', '');
    page.setAttribute('data-dashboard-id', 'orders');
    page.setAttribute('data-dashboard-hierarchy', 'hero-primary');
    const head = el(doc, 'header', 'kmc-dashboard-header kmc-ord-head');
    head.setAttribute('data-dashboard-role', 'hero');
    head.appendChild(el(doc, 'p', 'canonical-eyebrow', 'COMMERCE · COMMANDES'));
    head.appendChild(el(doc, 'h1', 'kmc-dashboard-title', 'Commandes'));
    head.appendChild(el(doc, 'p', 'kmc-dashboard-description',
      'Retrouvez les commandes par file et consultez leur dossier 360. Les opérations se réalisent dans les espaces métier concernés.'));
    page.appendChild(head);
    const rows = buildRows(payload);
    const visible = rows.filter(r => state.tab === 'all' || r.queues.includes(state.tab));
    // Same information hierarchy as Clients: hero -> concise filter -> full
    // width register. A selected row is no longer a second Order 360.
    const main = el(doc, 'div', 'kmc-ord-main');
    main.setAttribute('data-dashboard-role', 'primary');
    const listBox = el(doc, 'section', 'kmc-ord-list');
    const listHead = el(doc, 'div', 'kmc-ord-list-head');
    listHead.appendChild(el(doc, 'h2', 'kmc-ord-h3', 'Liste des commandes'));
    listHead.appendChild(el(doc, 'span', 'kmc-ord-list-count',
      `${visible.length} commande${visible.length > 1 ? 's' : ''} affichée${visible.length > 1 ? 's' : ''}`));
    listBox.appendChild(listHead);

    const filters = el(doc, 'div', 'kmc-filter-bar kmc-ord-filters');
    const field = el(doc, 'label', 'kmc-filter-field');
    field.appendChild(el(doc, 'span', 'kmc-filter-label', 'File'));
    const select = el(doc, 'select', 'kmc-filter-control');
    select.name = 'queue';
    select.setAttribute('data-ord-queue', '');
    TABS.forEach(tab => {
      const n = tab.id === 'all' ? rows.length : rows.filter(row => row.queues.includes(tab.id)).length;
      const option = el(doc, 'option', '', `${tab.label} (${n})`);
      option.value = tab.id;
      option.selected = tab.id === state.tab;
      select.appendChild(option);
    });
    select.value = state.tab;
    select.addEventListener('change', () => {
      state.tab = TABS.some(tab => tab.id === select.value) ? select.value : 'all';
      reflectQueueInUrl(state.tab);
      render(doc, rootNode, payload, state);
    });
    field.appendChild(select);
    filters.appendChild(field);
    listBox.appendChild(filters);
    const attention = renderAttentionNote(doc, payload);
    if (attention) listBox.appendChild(attention);

    const table = el(doc, 'table', 'kmc-ord-table');
    const thead = el(doc, 'thead');
    const hr = el(doc, 'tr');
    ['Référence', 'Marché', 'Client', 'Produits', 'Colis', 'Statut', 'Paiement', 'Montant', 'Dossier'].forEach(h => hr.appendChild(el(doc, 'th', '', h)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el(doc, 'tbody');
    if (!visible.length) {
      const tr = el(doc, 'tr');
      const td = el(doc, 'td', 'kmc-ord-empty', 'Aucune commande dans cette file.');
      td.colSpan = 9;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    visible.forEach(r => {
      const tr = el(doc, 'tr', 'kmc-ord-row');
      tr.setAttribute('data-ord-row', r.reference);
      [r.reference, r.market_code || '—', r.client_name || '—', productsLabel(r), parcelsLabel(r), statusLabel(r.status), PAYMENT_LABELS[r.payment_status] || '—',
        money(r.total_kmf)].forEach((v, i) => tr.appendChild(el(doc, 'td', i === 0 ? 'kmc-ord-ref' : '', v)));
      // The list is read-only. Workflow labels are not executable actions here.
      // Match Clients: one dedicated, final “Dossier” cell for the 360 link.
      const dossier = el(doc, 'td', 'kmc-ord-cell-dossier');
      const open = el(doc, 'a', 'kmc-entity-360-action', 'Voir 360');
      open.href = orderHref(r.reference);
      open.setAttribute('data-ord-open', r.reference);
      open.setAttribute('aria-label', `Voir 360 · commande ${r.reference}`);
      open.addEventListener('click', e => e.stopPropagation?.());
      dossier.appendChild(open);
      tr.appendChild(dossier);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const scroller = el(doc, 'div', 'kmc-ord-table-wrap');
    scroller.appendChild(table);
    listBox.appendChild(scroller);
    const q = payload.work_queues || {};
    if (['pending_cash', 'to_order', 'awaiting_hub_reception', 'ready_for_parcel'].some(k => q[`${k}_total`] > q[`${k}_shown`])) {
      listBox.appendChild(el(doc, 'p', 'kmc-ord-muted', 'Liste partielle : seules les commandes les plus anciennes sont affichées pour certaines files.'));
    }
    main.appendChild(listBox);
    page.appendChild(main);
    rootNode.appendChild(page);
  }

  function mount(options) {
    const rootNode = options.root;
    const doc = options.document;
    const fetchFn = options.fetch;
    if (!rootNode) throw new Error('canonical_orders_root_missing');
    const normalEndpoint = endpointForContext(options.adminContext, options.contextContract, options.requestedMarket);
    const endpoint = normalEndpoint;
    rootNode.textContent = 'Chargement de Commandes…';
    return jsonRequest(fetchFn, endpoint).then(payload => {
      render(doc, rootNode, payload, { tab: initialQueue(globalThis.location?.search) });
      return Object.freeze({ payload, endpoint });
    }).catch(error => {
      rootNode.textContent = '';
      const box = el(doc, 'div', 'kmc-ord-error', `Commandes indisponibles : ${error.message}`);
      box.setAttribute('role', 'alert');
      rootNode.appendChild(box);
      throw error;
    });
  }

  return Object.freeze({ mount, buildRows, endpointForContext, hubExecutionHref, STATUS_LABELS, TABS,
    orderHref, initialQueue, reflectQueueInUrl });
});
