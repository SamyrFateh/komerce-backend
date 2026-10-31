/**
 * @komerce-arch
 * @role          canonical-orders-dashboard
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, server_resolved_admin_context, requested_market_view
 * @outputs       canonical_orders_dashboard (KPI, files de travail, funnel, panneau de lecture)
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
    return nav && typeof nav.withEntityReturnTo === 'function' && loc
      ? nav.withEntityReturnTo(path, `${loc.pathname || '/admin/orders'}${loc.search || ''}`, 'Retour aux commandes')
      : path;
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

  function renderKpis(doc, payload) {
    const summary = payload.summary || {};
    const signals = payload.signals || {};
    const cards = [
      ['cash', 'Cash à confirmer', summary.cash_to_confirm, 'Paiements en attente de confirmation'],
      ['to_order', 'À commander', summary.orders_to_order, 'Commandes payées à passer au fournisseur'],
      ['awaiting', 'En attente de réception Hub', summary.awaiting_hub_reception, 'Commandées, articles pas encore reçus au Hub'],
      ['parcel', 'Colis à préparer', summary.parcels_to_create, 'Articles reçus au Hub, prêts à être préparés'],
      ['active', 'Commandes à suivre', summary.active_orders, 'Commandes actives en cours'],
      ['blocked', 'Commandes bloquées', signals.commandes_bloquees, 'Incident ou litige ouvert'],
    ];
    const wrap = el(doc, 'section', 'kmc-ord-kpis');
    wrap.setAttribute('aria-label', 'Indicateurs commandes');
    cards.forEach(([key, label, value, hint]) => {
      const card = el(doc, 'article', `kmc-ord-kpi kmc-ord-kpi-${key}`);
      card.setAttribute('data-ord-kpi', key);
      card.appendChild(el(doc, 'span', 'kmc-ord-kpi-label', label));
      const val = el(doc, 'strong', 'kmc-ord-kpi-value', count(value));
      if (!isNumber(value)) val.classList.add('kmc-ord-unavailable');
      card.appendChild(val);
      card.appendChild(el(doc, 'span', 'kmc-ord-kpi-hint', hint));
      wrap.appendChild(card);
    });
    return wrap;
  }

  function renderFunnel(doc, payload) {
    const f = payload.funnel || {};
    const steps = [['creees', 'Créées'], ['payees', 'Payées'], ['expediees', 'Expédiées'],
      ['disponibles_relais', 'Disponibles relais'], ['retirees', 'Retirées']];
    const box = el(doc, 'section', 'kmc-ord-funnel');
    box.appendChild(el(doc, 'h3', 'kmc-ord-h3', 'Parcours des commandes'));
    const list = el(doc, 'ol', 'kmc-ord-funnel-list');
    steps.forEach(([key, label]) => {
      const li = el(doc, 'li', 'kmc-ord-funnel-step');
      li.setAttribute('data-ord-funnel', key);
      li.appendChild(el(doc, 'span', 'kmc-ord-funnel-label', label));
      li.appendChild(el(doc, 'strong', 'kmc-ord-funnel-value', count(f[key])));
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }

  function renderSignals(doc, payload) {
    const s = payload.signals || {};
    const items = [['paiements_en_attente', 'Paiements en attente'], ['retraits_en_retard', 'Retraits en retard'],
      ['litiges_ouverts', 'Litiges ouverts']];
    const box = el(doc, 'section', 'kmc-ord-signals');
    box.appendChild(el(doc, 'h3', 'kmc-ord-h3', 'Signaux'));
    const list = el(doc, 'ul', 'kmc-ord-signal-list');
    items.forEach(([key, label]) => {
      const li = el(doc, 'li', 'kmc-ord-signal');
      li.appendChild(el(doc, 'span', '', label));
      li.appendChild(el(doc, 'strong', isNumber(s[key]) ? '' : 'kmc-ord-unavailable', count(s[key])));
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }

  function renderDetail(doc, row) {
    const box = el(doc, 'aside', 'kmc-ord-detail');
    box.setAttribute('data-ord-detail', '');
    box.appendChild(el(doc, 'h3', 'kmc-ord-h3', 'Détail de la commande'));
    if (!row) {
      box.appendChild(el(doc, 'p', 'kmc-ord-muted', 'Sélectionnez une commande pour voir son résumé.'));
      return box;
    }
    box.appendChild(el(doc, 'strong', 'kmc-ord-detail-ref', row.reference));
    const dl = el(doc, 'dl', 'kmc-ord-detail-list');
    [['Client', row.client_name || 'Non disponible'], ['Statut', statusLabel(row.status)],
      ['Paiement', PAYMENT_LABELS[row.payment_status] || 'Non disponible'],
      ['Mode de paiement', row.payment_mode || 'Non disponible'], ['Montant', money(row.total_kmf)],
      ['Relais', row.relais_name || 'Non disponible'],
      ['Marché', row.market_code || 'Non disponible'], ['Produits', productsLabel(row)], ['Colis', parcelsLabel(row)]].forEach(([k, v]) => {
      dl.appendChild(el(doc, 'dt', '', k));
      dl.appendChild(el(doc, 'dd', '', v));
    });
    box.appendChild(dl);
    const action = el(doc, 'p', 'kmc-ord-action', `Action requise : ${row.action}`);
    box.appendChild(action);
    if (row.actionable && row.market_code) {
      const exec = el(doc, 'a', 'kmc-ord-open', 'Hub live › Exécution');
      exec.href = hubExecutionHref(row.market_code);
      exec.setAttribute('data-ord-hub-execution', row.reference);
      box.appendChild(exec);
    }
    const link = el(doc, 'a', 'kmc-ord-open', 'Ouvrir Order 360');
    link.href = orderHref(row.reference);
    link.setAttribute('data-ord-open', row.reference);
    box.appendChild(link);
    return box;
  }

  function render(doc, rootNode, payload, state) {
    rootNode.textContent = '';
    // Use the same Hero authority and illustration as the other Canonical
    // dashboards. This page used to create an unstyled h2 and silently lost
    // the orders-specific illustration, despite its existing CSS asset.
    const page = el(doc, 'div', 'kmc-ord kmc-domain-cockpit');
    page.setAttribute('data-canonical-orders', '');
    page.setAttribute('data-dashboard-id', 'orders');
    page.setAttribute('data-dashboard-hierarchy', 'hero-attention-primary-secondary');
    const head = el(doc, 'header', 'kmc-dashboard-header kmc-ord-head');
    head.setAttribute('data-dashboard-role', 'hero');
    head.appendChild(el(doc, 'p', 'canonical-eyebrow', 'COMMERCE · COMMANDES'));
    head.appendChild(el(doc, 'h1', 'kmc-dashboard-title', 'Commandes'));
    head.appendChild(el(doc, 'p', 'kmc-dashboard-description',
      'Retrouvez les commandes à suivre et identifiez les prochaines actions. Ouvrez le dossier 360 pour comprendre une commande ; l’exécution reste dans le module métier responsable.'));
    page.appendChild(head);
    const priorities = renderKpis(doc, payload);
    priorities.setAttribute('data-dashboard-role', 'attention');
    page.appendChild(priorities);

    const rows = buildRows(payload);
    const visible = rows.filter(r => state.tab === 'all' || r.queues.includes(state.tab));
    const tabs = el(doc, 'nav', 'kmc-ord-tabs');
    tabs.setAttribute('role', 'tablist');
    TABS.forEach(t => {
      const n = t.id === 'all' ? rows.length : rows.filter(r => r.queues.includes(t.id)).length;
      const b = el(doc, 'button', `kmc-ord-tab${state.tab === t.id ? ' is-active' : ''}`, `${t.label} (${n})`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(state.tab === t.id));
      b.setAttribute('data-ord-tab', t.id);
      b.addEventListener('click', () => { state.tab = t.id; state.selected = null; render(doc, rootNode, payload, state); });
      tabs.appendChild(b);
    });

    const main = el(doc, 'div', 'kmc-ord-main');
    const listBox = el(doc, 'section', 'kmc-ord-list');
    listBox.appendChild(tabs);
    const table = el(doc, 'table', 'kmc-ord-table');
    const thead = el(doc, 'thead');
    const hr = el(doc, 'tr');
    ['Référence', 'Marché', 'Client', 'Produits', 'Colis', 'Statut', 'Paiement', 'Montant', 'Action'].forEach(h => hr.appendChild(el(doc, 'th', '', h)));
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
    const selected = visible.find(r => r.reference === state.selected) || null;
    visible.forEach(r => {
      const tr = el(doc, 'tr', `kmc-ord-row${selected && selected.reference === r.reference ? ' is-selected' : ''}`);
      tr.setAttribute('data-ord-row', r.reference);
      tr.tabIndex = 0;
      const pick = () => { state.selected = r.reference; render(doc, rootNode, payload, state); };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      [r.reference, r.market_code || '—', r.client_name || '—', productsLabel(r), parcelsLabel(r), statusLabel(r.status), PAYMENT_LABELS[r.payment_status] || '—',
        money(r.total_kmf), r.action].forEach((v, i) => tr.appendChild(el(doc, 'td', i === 0 ? 'kmc-ord-ref' : '', v)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const scroller = el(doc, 'div', 'kmc-ord-table-wrap');
    scroller.appendChild(table);
    listBox.appendChild(scroller);
    const q = payload.work_queues || {};
    if (['pending_cash', 'to_order', 'awaiting_hub_reception', 'ready_for_parcel'].some(k => q[`${k}_total`] > q[`${k}_shown`])) {
      listBox.appendChild(el(doc, 'p', 'kmc-ord-muted', 'Liste limitée aux plus anciennes ; les totaux des indicateurs portent sur l’ensemble.'));
    }
    main.appendChild(listBox);
    main.appendChild(renderDetail(doc, selected));
    main.setAttribute('data-dashboard-role', 'primary');
    page.appendChild(main);

    const foot = el(doc, 'div', 'kmc-ord-foot');
    foot.appendChild(renderFunnel(doc, payload));
    foot.appendChild(renderSignals(doc, payload));
    foot.setAttribute('data-dashboard-role', 'secondary');
    page.appendChild(foot);
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
      render(doc, rootNode, payload, { tab: 'all', selected: null });
      return Object.freeze({ payload, endpoint });
    }).catch(error => {
      rootNode.textContent = '';
      const box = el(doc, 'div', 'kmc-ord-error', `Commandes indisponibles : ${error.message}`);
      box.setAttribute('role', 'alert');
      rootNode.appendChild(box);
      throw error;
    });
  }

  return Object.freeze({ mount, buildRows, endpointForContext, hubExecutionHref, STATUS_LABELS, TABS });
});
