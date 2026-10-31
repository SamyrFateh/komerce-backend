/**
 * @komerce-arch
 * @role          canonical-order-360-entity
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, order_reference, authorized_purchasing_projection
 * @outputs       canonical_order_360, contextual_purchasing_drills
 * @depends       primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, canonical_admin_no_legacy_imports
 * @impact-areas  admin-dashboard, orders, logistics, notifications, documents, finance, clients, products, purchasing
 * @version       2026-10
 */

'use strict';

(function initOrder360(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalOrder360 = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createOrder360() {
  const ENDPOINT_PREFIX = '/api/admin/entities/orders/';

  function contextualHref(path, returnTo, label) {
    const nav = globalThis.KomerceCanonicalNavigation;
    return nav && typeof nav.withReturnTo === 'function'
      ? nav.withReturnTo(path, returnTo, label)
      : path;
  }

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

  // L3 : fuseau métier du serveur (marché de l'objet), jamais celui du navigateur.
  let activeTimezone = null;
  function formatDate(value, timezone) {
    return globalThis.KomerceBusinessDate
      ? globalThis.KomerceBusinessDate.formatBusinessDate(value, timezone || activeTimezone, { time: true })
      : (value ? String(value).slice(0, 10) : '—');
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
    header.appendChild(text(doc, 'span', 'kmc-entity-kicker', 'DOSSIER COMMANDE'));
    header.appendChild(text(doc, 'h1', 'kmc-entity-title', order.reference));
    header.appendChild(text(
      doc,
      'p',
      'kmc-entity-subtitle',
      [order.market && order.market.code, order.customer && order.customer.name, order.destination && order.destination.relais && order.destination.relais.name]
        .filter(Boolean)
        .join(' · ')
    ));

    // Return to the true origin (including its filters), validated by the
    // shared navigation policy. Deep links without context fall back to the list.
    const navigation = globalThis.KomerceCanonicalNavigation;
    const origin = navigation && typeof navigation.resolveBackTarget === 'function'
      ? navigation.resolveBackTarget('order-360', globalThis.location?.search || '')
      : null;
    const back = text(doc, 'a', 'kmc-entity-return', `← ${origin?.label || 'Retour aux commandes'}`);
    back.setAttribute('href', origin?.href || '/admin/orders');
    back.setAttribute('data-entity-return', 'order-360');
    header.appendChild(back);

    // Navigation transverse belongs to the shared sidebar. This dossier links
    // only to an entity actually related to the order.
    const clientPhone = order.customer && order.customer.phone;
    if (clientPhone) {
      const nav = doc.createElement('nav');
      nav.className = 'kmc-entity-nav';
      const link = text(doc, 'a', 'kmc-entity-nav-link', 'Client 360');
      link.setAttribute('href', contextualHref(
        `/admin/clients/${encodeURIComponent(clientPhone)}`,
        `/admin/orders/${encodeURIComponent(order.reference)}`,
        'Retour à la commande'
      ));
      nav.appendChild(link);
      header.appendChild(nav);
    }
    return header;
  }

  function metricItems(payload) {
    const order = payload.order;
    const summary = payload.summary || {};
    return [
      { key: 'status', label: 'Statut', value: order.status || '—' },
      { key: 'payment', label: 'Paiement', value: order.payment && order.payment.status || '—', tone: order.payment && order.payment.status === 'paid' ? 'positive' : 'warning' },
      { key: 'total', label: 'Total', value: formatKmf(order.payment && order.payment.total_kmf) },
      { key: 'assigned', label: 'Articles affectés', value: `${formatNumber(summary.items_assigned)}/${formatNumber(summary.items)}`, tone: Number(summary.items_assigned) >= Number(summary.items) && Number(summary.items) > 0 ? 'positive' : 'neutral' },
      { key: 'parcels', label: 'Colis', value: formatNumber(summary.parcels) },
      { key: 'incidents', label: 'Incidents ouverts', value: formatNumber(summary.open_incidents), tone: Number(summary.open_incidents) > 0 ? 'critical' : 'positive' },
      { key: 'documents', label: 'Documents', value: formatNumber(summary.documents) },
    ];
  }


  const CONTROL_STAGE_LABELS = Object.freeze({
    ORDER: 'Commande',
    PURCHASING: 'Achats',
    SUPPLIER: 'Fournisseur',
    HUB_RECEIVING: 'Réception HUB',
    HUB_CONTROL: 'Contrôle HUB',
    FORWARDER: 'Transitaire',
    TRANSPORT: 'Transport',
    CUSTOMS: 'Douane',
    RELAY: 'Relais',
  });

  function controlPositionItem(payload) {
    const position = payload && payload.control_position;
    if (!position) return null;

    // Une santé absente ou inconnue est UNKNOWN : jamais présentée comme normale.
    const health = ['GREEN', 'ORANGE', 'RED'].includes(position.health) ? position.health : 'UNKNOWN';
    const stateLabel = health === 'RED' ? 'Bloquée'
      : health === 'ORANGE' ? 'À risque'
        : health === 'GREEN' ? 'Normal'
          : 'Non observé';
    const level = health === 'RED' ? 'critical'
      : health === 'ORANGE' ? 'warning'
        : 'info';
    const envelope = position.envelope || {};
    const refs = Array.isArray(envelope.refs) ? envelope.refs.filter(Boolean) : [];
    const envelopeLabel = envelope.type
      ? [envelope.type, refs.join(', ')].filter(Boolean).join(' · ')
      : null;

    return {
      level,
      title: `${CONTROL_STAGE_LABELS[position.stage] || position.stage || 'Étape'} · ${stateLabel}`,
      message: [
        // Jusqu'à 3 causes fournies par le serveur, avec leur propriétaire.
        ...(Array.isArray(position.exceptions) && position.exceptions.length
          ? position.exceptions.slice(0, 3).map(cause => [cause.summary || cause.code, cause.owner_role].filter(Boolean).join(' — '))
          : [position.exception && position.exception.summary]),
        envelopeLabel,
      ].filter(Boolean).join(' · ') || 'Encapsulation courante disponible.',
    };
  }

  function productDrills(items, orderReference) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter(row => {
      if (!row || !row.product_ref || seen.has(row.product_ref)) return false;
      seen.add(row.product_ref);
      return true;
    }).map(row => ({
      level: 'info',
      title: row.product_name || row.product_ref,
      message: row.product_ref,
      href: contextualHref(`/admin/products/${encodeURIComponent(row.product_ref)}`, `/admin/orders/${encodeURIComponent(orderReference)}`, 'Retour à la commande'),
      actionLabel: 'Product 360',
    }));
  }

  function shortId(value) {
    return String(value || '').slice(0, 8);
  }

  function purchaseOrderDrills(purchasing, orderReference) {
    const rows = purchasing && Array.isArray(purchasing.purchase_orders)
      ? purchasing.purchase_orders
      : [];
    return rows.filter(row => row && row.id).map(row => ({
      level: 'info',
      title: [row.supplier_name || row.supplier_platform || 'Fournisseur', `PO ${shortId(row.id)}`].join(' · '),
      message: [
        row.status || null,
        row.procurement_hub_ref ? `Hub ${row.procurement_hub_ref}` : null,
        row.supplier_order_id ? `Commande fournisseur ${row.supplier_order_id}` : null,
      ].filter(Boolean).join(' · '),
      href: contextualHref(
        `/admin/workspaces/purchasing?po=${encodeURIComponent(row.id)}`,
        `/admin/orders/${encodeURIComponent(orderReference)}`,
        'Retour à la commande'
      ),
      actionLabel: 'Ouvrir dans Achats',
    }));
  }


  // ── Fil de la commande (P2) : statut courant + historique de statut, tels que fournis par le serveur ──
  const STATUS_LABELS = Object.freeze({
    pending: 'En attente', confirmed: 'Confirmée', ordered: 'Commandée', preparation: 'En préparation', shipped: 'Expédiée',
    in_transit: 'En transit', available: 'Disponible au relais', collected: 'Retirée', delivered: 'Livrée',
    cancelled: 'Annulée', refunded: 'Remboursée',
  });

  function statusLabel(status) {
    const key = String(status || '').trim();
    return STATUS_LABELS[key] || key || '—';
  }

  // Historique serveur trié du plus récent au plus ancien : le fil l'affiche chronologiquement. Aucune étape inventée :
  // sans historique, seul le statut courant est montré et le manque est dit (inconnu ≠ vide).
  function threadSteps(payload) {
    const current = payload && payload.order && payload.order.status;
    const history = (Array.isArray(payload && payload.history) ? payload.history : [])
      .filter(row => row && row.status)
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const steps = history.map(row => ({ status: row.status, label: statusLabel(row.status), date: row.created_at, current: false }));
    if (current) {
      const last = steps[steps.length - 1];
      if (last && last.status === current) last.current = true;
      else steps.push({ status: current, label: statusLabel(current), date: null, current: true });
    }
    return steps;
  }

  function renderThread(rootNode, doc, payload) {
    const steps = threadSteps(payload);
    // A single undated current status adds no evidence beyond the header.
    if (!steps.length || (steps.length === 1 && !(Array.isArray(payload.history) && payload.history.length))) return;
    const section = doc.createElement('section');
    section.className = 'kmc-order-thread';
    section.id = 'parcours';
    const title = doc.createElement('h2');
    title.className = 'kmc-order-thread-title';
    title.textContent = 'Parcours de la commande';
    section.appendChild(title);
    const list = doc.createElement('ol');
    list.className = 'kmc-order-thread-steps';
    steps.forEach(step => {
      const item = doc.createElement('li');
      item.className = `kmc-order-thread-step${step.current ? ' is-current' : ''}`;
      if (step.current) item.setAttribute('aria-current', 'step');
      const label = doc.createElement('strong');
      label.textContent = step.label;
      item.appendChild(label);
      const date = doc.createElement('span');
      date.textContent = step.date ? formatDate(step.date) : 'Date non enregistrée';
      item.appendChild(date);
      list.appendChild(item);
    });
    section.appendChild(list);
    if (!(Array.isArray(payload.history) && payload.history.length)) {
      const note = doc.createElement('p');
      note.className = 'kmc-order-thread-note';
      note.textContent = 'Historique de statut non disponible : seul le statut actuel est connu.';
      section.appendChild(note);
    }
    rootNode.appendChild(section);
  }

  // ── Coûts & écarts : projection Finance de cette commande, fournie par le serveur seulement si finance.read ──
  const VARIANCE_LABELS = Object.freeze({
    overrun: 'Surcoût', saving: 'Économie', provisional: 'Provisoire', not_comparable: 'Non comparable', none: 'Aucun écart',
  });
  const COMPONENT_STATE_LABELS = Object.freeze({ confirmed: 'Constaté', provisional: 'Provisoire', unknown: 'Inconnu', expected: 'Pas encore attendu' });

  function signedKmf(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n > 0 ? '+' : ''}${formatKmf(n)}`;
  }

  function costsSummaryRows(costs) {
    const unknown = 'Non établi';
    const variance = costs.variance || {};
    return [
      { poste: 'Prix de vente', valeur: formatKmf(costs.sale_total_kmf), note: '' },
      { poste: 'Coûts estimés (figés à la commande)', valeur: costs.estimated_cost_kmf == null ? unknown : formatKmf(costs.estimated_cost_kmf), note: '' },
      { poste: 'Coûts constatés', valeur: costs.real_cost_kmf == null ? unknown : formatKmf(costs.real_cost_kmf), note: 'Coûts directement imputés à la commande, selon les justificatifs disponibles.' },
      {
        poste: 'Marge réelle finalisée',
        valeur: costs.consolidated_margin_kmf == null ? 'Non finalisée' : formatKmf(costs.consolidated_margin_kmf),
        note: costs.consolidated_margin_kmf == null ? 'La marge réelle n’est calculée que sur une commande finalisée ; elle n’est jamais extrapolée.' : '',
      },
      {
        poste: 'Écart de coût (constaté − estimé)',
        valeur: variance.cost_variance_kmf == null ? (VARIANCE_LABELS[variance.class] || '—') : signedKmf(variance.cost_variance_kmf),
        note: variance.cost_variance_kmf == null ? 'Non comparable à ce stade.' : (VARIANCE_LABELS[variance.class] || ''),
      },
    ];
  }

  function costComponentRows(costs) {
    const components = costs && costs.variance && Array.isArray(costs.variance.components) ? costs.variance.components : [];
    return components.map(row => ({
      composante: row.label || row.type,
      etat: COMPONENT_STATE_LABELS[row.state] || row.state || '—',
      estime: row.estimated_kmf == null ? '—' : formatKmf(row.estimated_kmf),
      constate: row.real_kmf == null ? '—' : formatKmf(row.real_kmf),
      ecart: row.delta_kmf == null ? '—' : signedKmf(row.delta_kmf),
      responsable: row.owner && row.owner.label ? row.owner.label : '—',
    }));
  }

  // Espaces propriétaires des composantes (Achats, Expéditions & Douane, Hub…) : liens directs avec retour à la commande.
  function costOwnerLinks(costs, orderReference) {
    const components = costs && costs.variance && Array.isArray(costs.variance.components) ? costs.variance.components : [];
    const seen = new Set();
    return components.filter(row => row.owner && row.owner.href && !seen.has(row.owner.href) && seen.add(row.owner.href)).map(row => ({
      label: row.owner.label || row.owner.href,
      href: contextualHref(row.owner.href, `/admin/orders/${encodeURIComponent(orderReference)}#couts`, 'Retour à la commande'),
    }));
  }

  function renderCosts(rootNode, ui, doc, payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, 'costs')) return;
    const costs = payload.costs;
    const section = ui.Section.create({
      title: 'Coûts & écarts',
      description: 'Projection Finance de cette commande : coûts constatés, marge réelle finalisée et écarts avec l’estimation figée.',
    });
    section.element.id = 'couts';
    rootNode.appendChild(section.element);
    if (!costs) {
      const empty = doc.createElement('p');
      empty.className = 'kmc-order-costs-note';
      empty.textContent = 'Coûts non applicables : commande annulée ou remboursée.';
      section.slot.appendChild(empty);
      return;
    }
    ui.DataTable.render(section.slot, {
      columns: [{ key: 'poste', label: 'Poste' }, { key: 'valeur', label: 'Valeur', align: 'right' }, { key: 'note', label: 'Lecture' }],
      rows: costsSummaryRows(costs),
      emptyText: 'Aucune donnée de coût.',
    });
    const missing = Array.isArray(costs.missing_cost_types) ? costs.missing_cost_types : [];
    if (missing.length) {
      const note = doc.createElement('p');
      note.className = 'kmc-order-costs-note';
      note.textContent = `Coûts restant à établir : ${missing.join(', ')}. Un coût non établi est inconnu, jamais zéro.`;
      section.slot.appendChild(note);
    }
    const components = costComponentRows(costs);
    if (components.length) {
      const host = doc.createElement('div');
      host.className = 'kmc-order-costs-components';
      section.slot.appendChild(host);
      ui.DataTable.render(host, {
        columns: [
          { key: 'composante', label: 'Composante' }, { key: 'etat', label: 'État' },
          { key: 'estime', label: 'Estimé', align: 'right' }, { key: 'constate', label: 'Constaté', align: 'right' },
          { key: 'ecart', label: 'Écart', align: 'right' }, { key: 'responsable', label: 'Responsable' },
        ],
        rows: components,
        emptyText: 'Aucune composante.',
      });
    }
    const owners = costOwnerLinks(costs, payload.order.reference);
    const links = doc.createElement('p');
    links.className = 'kmc-order-costs-links';
    owners.forEach(owner => {
      const a = doc.createElement('a');
      a.setAttribute('href', owner.href);
      a.textContent = `${owner.label} →`;
      links.appendChild(a);
    });
    const finance = doc.createElement('a');
    finance.setAttribute('href', contextualHref('/admin/finance', `/admin/orders/${encodeURIComponent(payload.order.reference)}#couts`, 'Retour à la commande'));
    finance.textContent = 'Vue Finance →';
    links.appendChild(finance);
    section.slot.appendChild(links);
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
    activeTimezone = (payload.order && payload.order.business_timezone) || payload.business_timezone || null;
    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));

    const metrics = doc.createElement('section');
    metrics.className = 'kmc-entity-metrics';
    rootNode.appendChild(metrics);
    // Compact first view; critical incidents and missing assignment never disappear.
    const summary = payload.summary || {};
    const headline = metricItems(payload).filter(item =>
      ['status', 'payment', 'total', 'parcels'].includes(item.key)
      || (item.key === 'incidents' && Number(summary.open_incidents) > 0)
      || (item.key === 'assigned' && Number(summary.items) > 0 &&
          Number(summary.items_assigned) < Number(summary.items))
    );
    ui.MetricStrip.render(metrics, { items: headline });

    const controlPosition = controlPositionItem(payload);
    if (controlPosition) {
      const control = doc.createElement('section');
      rootNode.appendChild(control);
      ui.AlertPanel.render(control, {
        title: 'Position actuelle',
        emptyText: 'Aucune position opérationnelle active.',
        items: [controlPosition],
      });
    }

    renderThread(rootNode, doc, payload);

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
        { key: 'reference', label: 'Réf. Komerce' },
        { key: 'produit', label: 'Produit' },
        { key: 'categorie', label: 'Catégorie' },
        { key: 'quantite', label: 'Qté', align: 'right' },
        { key: 'prix', label: 'Prix unitaire', align: 'right' },
      ],
      rows: (payload.items || []).map(row => ({
        reference: row.product_ref,
        produit: row.product_name,
        categorie: row.category,
        quantite: formatNumber(row.quantity),
        prix: formatKmf(row.unit_price_kmf),
      })),
      emptyText: 'Aucun article.',
    });

    const more = doc.createElement('details');
    more.className = 'kmc-entity-extras';
    // Costs and other deep-link destinations must be reachable after refresh.
    const currentHash = String(globalThis.location?.hash || '');
    more.open = ['#couts'].includes(currentHash);
    const summaryLabel = text(doc, 'summary', 'kmc-entity-extras-summary',
      'Informations complémentaires · coûts, achats, colis, historique et documents');
    more.appendChild(summaryLabel);
    const moreContent = doc.createElement('div');
    moreContent.className = 'kmc-entity-extras-content';
    more.appendChild(moreContent);
    rootNode.appendChild(more);

    renderCosts(moreContent, ui, doc, payload);

    const products = doc.createElement('section');
    moreContent.appendChild(products);
    ui.AlertPanel.render(products, {
      title: 'Produits de la commande',
      emptyText: 'Aucune référence produit navigable.',
      items: productDrills(payload.items, payload.order.reference),
    });

    if (payload.purchasing) {
      const purchasing = doc.createElement('section');
      moreContent.appendChild(purchasing);
      ui.AlertPanel.render(purchasing, {
        title: 'Achats fournisseurs',
        emptyText: 'Aucun bon de commande fournisseur lié à cette commande.',
        items: purchaseOrderDrills(payload.purchasing, payload.order.reference),
      });
    }

    renderTableSection(moreContent, ui, doc, {
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
    moreContent.appendChild(alerts);
    ui.AlertPanel.render(alerts, {
      title: 'Incidents',
      emptyText: 'Aucun incident sur cette commande.',
      items: (payload.incidents || []).map(row => ({
        level: ['urgent', 'high'].includes(row.priority) && !['resolved', 'closed'].includes(row.status) ? 'critical' : (row.status === 'resolved' || row.status === 'closed' ? 'info' : 'warning'),
        title: `${row.type || 'Incident'} · ${row.status || '—'}`,
        message: [row.description, row.reporter, formatDate(row.created_at)].filter(Boolean).join(' · '),
      })),
    });

    renderTableSection(moreContent, ui, doc, {
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

    renderTableSection(moreContent, ui, doc, {
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

    renderTableSection(moreContent, ui, doc, {
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

    renderTableSection(moreContent, ui, doc, {
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

    renderTableSection(moreContent, ui, doc, {
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
      // Ancre #couts (lien depuis Finance) : la section n'existe qu'après le rendu, le navigateur ne peut pas y défiler seul.
      const hash = options.location ? options.location.hash : (globalThis.location && globalThis.location.hash);
      if (hash === '#couts') {
        const target = rootNode.querySelector && rootNode.querySelector('#couts');
        if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView();
      }
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
    productDrills,
    purchaseOrderDrills,
    metricItems,
    controlPositionItem,
    threadSteps,
    costsSummaryRows,
    costComponentRows,
    costOwnerLinks,
    renderPayload,
    jsonRequest,
    mount,
  });
});