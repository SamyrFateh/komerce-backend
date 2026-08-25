/**
 * @komerce-arch
 * @role          canonical-order-360-entity
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, order_reference
 * @outputs       canonical_order_360
 * @depends       primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, canonical_admin_no_legacy_imports
 * @impact-areas  admin-dashboard, orders, logistics, notifications, documents, finance
 * @version       2026-08
 */

'use strict';

(function initOrder360(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalOrder360 = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createOrder360() {
  const ENDPOINT_PREFIX = '/api/admin/entities/orders/';

  function referenceFromPath(pathname) {
    const match = String(pathname || '').match(/^\/admin\/orders\/([^/]+)$/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch (_) { return null; }
  }

  function formatNumber(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
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

  function createHeader(doc, payload) {
    const order = payload.order;
    const header = doc.createElement('header');
    header.className = 'kmc-entity-header';
    header.appendChild(text(doc, 'span', 'kmc-entity-kicker', 'ORDER 360'));
    header.appendChild(text(doc, 'h1', 'kmc-entity-title', order.reference));
    header.appendChild(text(
      doc,
      'p',
      'kmc-entity-subtitle',
      [order.market && order.market.code, order.customer && order.customer.name, order.destination && order.destination.relais && order.destination.relais.name]
        .filter(Boolean)
        .join(' · ')
    ));

    const nav = doc.createElement('nav');
    nav.className = 'kmc-entity-nav';
    [
      ['/admin/operations', '← Opérations'],
      ['/admin/pilotage', 'Pilotage'],
      ['/admin/finance', 'Finance'],
    ].forEach(([href, label]) => {
      const link = text(doc, 'a', 'kmc-entity-nav-link', label);
      link.setAttribute('href', href);
      nav.appendChild(link);
    });
    header.appendChild(nav);
    return header;
  }

  function metricItems(payload) {
    const order = payload.order;
    const summary = payload.summary || {};
    return [
      { key: 'status', label: 'Statut', value: order.status || '—' },
      { key: 'payment', label: 'Paiement', value: order.payment && order.payment.status || '—', tone: order.payment && order.payment.status === 'paid' ? 'positive' : 'warning' },
      { key: 'total', label: 'Total', value: formatKmf(order.payment && order.payment.total_kmf) },
      { key: 'parcels', label: 'Colis', value: formatNumber(summary.parcels) },
      { key: 'incidents', label: 'Incidents ouverts', value: formatNumber(summary.open_incidents), tone: Number(summary.open_incidents) > 0 ? 'critical' : 'positive' },
      { key: 'documents', label: 'Documents', value: formatNumber(summary.documents) },
    ];
  }

  function renderTableSection(rootNode, ui, doc, options) {
    const section = ui.Section.create({ title: options.title, description: options.description });
    rootNode.appendChild(section.element);
    ui.DataTable.render(section.slot, {
      columns: options.columns,
      rows: options.rows,
      emptyText: options.emptyText,
    });
  }

  function renderPayload(rootNode, ui, doc, payload) {
    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));

    const metrics = doc.createElement('section');
    metrics.className = 'kmc-entity-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload) });

    renderTableSection(rootNode, ui, doc, {
      title: 'Commande',
      description: 'Identité client, destination et routage constatés sur la commande.',
      columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
      rows: [
        { champ: 'Client', valeur: payload.order.customer && payload.order.customer.name },
        { champ: 'Téléphone', valeur: payload.order.customer && payload.order.customer.phone },
        { champ: 'Email', valeur: payload.order.customer && payload.order.customer.email },
        { champ: 'Marché', valeur: payload.order.market && [payload.order.market.code, payload.order.market.name].filter(Boolean).join(' · ') },
        { champ: 'Relais', valeur: payload.order.destination && payload.order.destination.relais && payload.order.destination.relais.name },
        { champ: 'Île', valeur: payload.order.destination && payload.order.destination.island },
        { champ: 'Routage', valeur: payload.order.destination && payload.order.destination.routing_mode },
        { champ: 'Créée', valeur: formatDate(payload.order.created_at) },
      ],
      emptyText: 'Aucune information commande.',
    });

    renderTableSection(rootNode, ui, doc, {
      title: 'Articles',
      columns: [
        { key: 'produit', label: 'Produit' },
        { key: 'categorie', label: 'Catégorie' },
        { key: 'quantite', label: 'Qté', align: 'right' },
        { key: 'prix', label: 'Prix unitaire', align: 'right' },
      ],
      rows: (payload.items || []).map(row => ({
        produit: row.product_name,
        categorie: row.category,
        quantite: formatNumber(row.quantity),
        prix: formatKmf(row.unit_price_kmf),
      })),
      emptyText: 'Aucun article.',
    });

    renderTableSection(rootNode, ui, doc, {
      title: 'Colis',
      description: 'Colis actifs rattachés à cette commande.',
      columns: [
        { key: 'reference', label: 'Colis' },
        { key: 'tracking', label: 'Tracking' },
        { key: 'status', label: 'Statut' },
        { key: 'poids', label: 'Poids', align: 'right' },
        { key: 'articles', label: 'Articles', align: 'right' },
        { key: 'expedie', label: 'Expédié' },
      ],
      rows: (payload.parcels || []).map(row => ({
        reference: row.reference,
        tracking: row.tracking_number,
        status: row.status,
        poids: row.weight_kg == null ? '—' : `${formatNumber(row.weight_kg, 2)} kg`,
        articles: formatNumber(row.items_quantity),
        expedie: formatDate(row.shipped_at),
      })),
      emptyText: 'Aucun colis actif.',
    });

    const alerts = doc.createElement('section');
    rootNode.appendChild(alerts);
    ui.AlertPanel.render(alerts, {
      title: 'Incidents',
      emptyText: 'Aucun incident sur cette commande.',
      items: (payload.incidents || []).map(row => ({
        level: ['urgent', 'high'].includes(row.priority) && !['resolved', 'closed'].includes(row.status) ? 'critical' : (row.status === 'resolved' || row.status === 'closed' ? 'info' : 'warning'),
        title: `${row.type || 'Incident'} · ${row.status || '—'}`,
        message: [row.description, row.reporter, formatDate(row.created_at)].filter(Boolean).join(' · '),
      })),
    });

    renderTableSection(rootNode, ui, doc, {
      title: 'Historique de statut',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'status', label: 'Statut' },
        { key: 'acteur', label: 'Acteur' },
        { key: 'note', label: 'Note' },
      ],
      rows: (payload.history || []).map(row => ({ date: formatDate(row.created_at), status: row.status, acteur: row.changed_by, note: row.note })),
      emptyText: 'Aucun historique de statut.',
    });

    renderTableSection(rootNode, ui, doc, {
      title: 'Scans logistiques',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'step', label: 'Étape' },
        { key: 'acteur', label: 'Scanné par' },
        { key: 'note', label: 'Note' },
      ],
      rows: (payload.scans || []).map(row => ({ date: formatDate(row.created_at), step: row.step, acteur: row.scanned_by, note: row.notes })),
      emptyText: 'Aucun scan.',
    });

    renderTableSection(rootNode, ui, doc, {
      title: 'Notifications client',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'titre', label: 'Notification' },
        { key: 'status', label: 'Statut' },
        { key: 'message', label: 'Message' },
      ],
      rows: (payload.notifications || []).map(row => ({ date: formatDate(row.created_at), titre: row.title, status: row.status, message: row.message })),
      emptyText: 'Aucune notification client.',
    });

    renderTableSection(rootNode, ui, doc, {
      title: 'Factures & documents',
      columns: [
        { key: 'type', label: 'Type' },
        { key: 'reference', label: 'Référence' },
        { key: 'status', label: 'Statut' },
        { key: 'date', label: 'Date' },
      ],
      rows: [
        ...(payload.invoices || []).map(row => ({ type: 'Facture', reference: row.invoice_number, status: row.payment_status, date: formatDate(row.created_at) })),
        ...(payload.documents || []).map(row => ({ type: row.document_type, reference: row.reference, status: row.status, date: formatDate(row.issued_at) })),
      ],
      emptyText: 'Aucun document.',
    });

    renderTableSection(rootNode, ui, doc, {
      title: 'Commentaires terrain',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'auteur', label: 'Auteur' },
        { key: 'texte', label: 'Commentaire' },
      ],
      rows: (payload.comments || []).map(row => ({ date: formatDate(row.created_at), auteur: row.author, texte: row.text })),
      emptyText: 'Aucun commentaire terrain.',
    });
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  async function mount(options) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    const reference = options.reference || referenceFromPath(options.pathname || '');

    if (!rootNode) throw new Error('canonical_order_360_root_missing');
    if (!ui || !ui.UIState || !ui.DataTable || !ui.Section || !ui.MetricStrip || !ui.AlertPanel) {
      throw new Error('canonical_order_360_primitives_missing');
    }
    if (!reference) throw new Error('canonical_order_360_reference_missing');

    ui.UIState.render(rootNode, 'loading', 'Chargement de la commande…');
    try {
      const endpoint = ENDPOINT_PREFIX + encodeURIComponent(reference);
      const payload = await jsonRequest(fetchFn, endpoint);
      renderPayload(rootNode, ui, doc, payload);
      return Object.freeze({ payload, endpoint, reference });
    } catch (error) {
      ui.UIState.render(rootNode, 'error', error.message);
      throw error;
    }
  }

  return Object.freeze({
    ENDPOINT_PREFIX,
    referenceFromPath,
    formatNumber,
    formatKmf,
    formatDate,
    metricItems,
    renderPayload,
    jsonRequest,
    mount,
  });
});
