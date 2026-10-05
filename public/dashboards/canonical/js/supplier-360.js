/**
 * @komerce-arch
 * @role          canonical-supplier-360-entity
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, supplier_uuid
 * @outputs       canonical_supplier_360
 * @depends       primitives, navigation
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, supplier_secrets_never_exposed
 * @impact-areas  admin-dashboard, purchasing, catalog, supplier-connectivity
 * @version       2026-10
 */
'use strict';

(function initSupplier360(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalSupplier360 = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createSupplier360() {
  const ENDPOINT_PREFIX = '/api/admin/entities/suppliers/';

  function supplierIdFromPath(pathname) {
    const match = String(pathname || '').match(/^\/admin\/suppliers\/([^/]+)$/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch (_) { return null; }
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function contextualHref(path, returnTo, label) {
    const nav = globalThis.KomerceCanonicalNavigation;
    return nav && typeof nav.withReturnTo === 'function' ? nav.withReturnTo(path, returnTo, label) : path;
  }

  function renderTable(rootNode, ui, options) {
    const section = ui.Section.create({ title: options.title, description: options.description });
    rootNode.appendChild(section.element);
    ui.DataTable.render(section.slot, { columns: options.columns, rows: options.rows, emptyText: options.emptyText });
  }

  function metricItems(payload) {
    const mappings = payload.mappings || [];
    const pos = payload.purchase_orders || [];
    const execution = payload.execution || [];
    const payments = payload.payments || [];
    return [
      { key: 'mappings', label: 'Mappings actifs', value: String(mappings.filter(row => row.is_active).length) },
      { key: 'po', label: 'PO affichées', value: String(pos.length) },
      { key: 'execution', label: 'Ordres fournisseur', value: String(execution.reduce((sum, row) => sum + Number(row.count || 0), 0)) },
      { key: 'payments', label: 'Paiements observés', value: String(payments.reduce((sum, row) => sum + Number(row.count || 0), 0)) },
    ];
  }

  function renderPayload(rootNode, ui, doc, payload) {
    const supplier = payload.supplier;
    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();

    const header = doc.createElement('header');
    header.className = 'kmc-entity-header';
    header.appendChild(text(doc, 'span', 'kmc-entity-kicker', 'SUPPLIER 360'));
    header.appendChild(text(doc, 'h1', 'kmc-entity-title', supplier.name));
    header.appendChild(text(doc, 'p', 'kmc-entity-subtitle', [supplier.platform, supplier.is_active ? 'Actif' : 'Inactif'].filter(Boolean).join(' · ')));
    const nav = doc.createElement('nav');
    nav.className = 'kmc-entity-nav';
    [['/admin/workspaces/sourcing', '← Sourcing'], ['/admin/workspaces/purchasing', 'Achats fournisseurs']].forEach(([href, label]) => {
      const link = text(doc, 'a', 'kmc-entity-nav-link', label);
      link.setAttribute('href', href);
      nav.appendChild(link);
    });
    header.appendChild(nav);
    rootNode.appendChild(header);

    const metrics = doc.createElement('section');
    metrics.className = 'kmc-entity-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload) });

    renderTable(rootNode, ui, {
      title: 'Identité & configuration visible',
      description: 'La fiche n’expose jamais les credentials : uniquement leur présence.',
      columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
      rows: [
        { champ: 'Plateforme', valeur: supplier.platform },
        { champ: 'Contact', valeur: supplier.contact_name },
        { champ: 'Téléphone', valeur: supplier.contact_phone },
        { champ: 'Email', valeur: supplier.contact_email },
        { champ: 'Auto-order configuré', valeur: supplier.auto_order ? 'Oui' : 'Non' },
        { champ: 'Lead time', valeur: supplier.lead_time_days == null ? '—' : supplier.lead_time_days + ' j' },
        { champ: 'Clé API présente', valeur: supplier.has_api_key ? 'Oui' : 'Non' },
        { champ: 'Secret API présent', valeur: supplier.has_api_secret ? 'Oui' : 'Non' },
      ],
      emptyText: 'Aucune identité fournisseur.',
    });

    const returnTo = '/admin/suppliers/' + encodeURIComponent(supplier.id);
    renderTable(rootNode, ui, {
      title: 'Mappings catalogue',
      columns: [
        { key: 'product', label: 'Produit' }, { key: 'sku', label: 'SKU fournisseur' },
        { key: 'price', label: 'Prix AED' }, { key: 'active', label: 'Actif' },
      ],
      rows: (payload.mappings || []).map(row => ({
        product: row.product_ref
          ? { text: row.product_name || row.product_ref, href: contextualHref('/admin/products/' + encodeURIComponent(row.product_ref), returnTo, 'Retour au fournisseur') }
          : row.product_name,
        sku: row.supplier_sku,
        price: row.supplier_price_aed,
        active: row.is_active ? 'Oui' : 'Non',
      })),
      emptyText: 'Aucun mapping catalogue.',
    });

    renderTable(rootNode, ui, {
      title: 'Purchase Orders récentes',
      description: '100 dernières au maximum ; aucun agrégat financier multi-devise.',
      columns: [
        { key: 'po', label: 'PO' }, { key: 'order', label: 'Commande' }, { key: 'status', label: 'Statut' },
        { key: 'hub', label: 'Hub' }, { key: 'supplier_ref', label: 'Réf. fournisseur' }, { key: 'date', label: 'Créée' },
      ],
      rows: (payload.purchase_orders || []).map(row => ({
        po: { text: String(row.id || '').slice(0, 8), href: contextualHref('/admin/workspaces/purchasing?po=' + encodeURIComponent(row.id), returnTo, 'Retour au fournisseur') },
        order: row.order_reference || '—',
        status: row.status,
        hub: row.procurement_hub_ref,
        supplier_ref: row.supplier_order_id,
        date: formatDate(row.created_at),
      })),
      emptyText: 'Aucune Purchase Order.',
    });

    renderTable(rootNode, ui, {
      title: 'Exécution fournisseur',
      columns: [{ key: 'provider', label: 'Provider' }, { key: 'status', label: 'Statut provider' }, { key: 'count', label: 'Ordres' }],
      rows: (payload.execution || []).map(row => ({ provider: row.provider, status: row.provider_status, count: row.count })),
      emptyText: 'Aucun ordre fournisseur persisté.',
    });

    renderTable(rootNode, ui, {
      title: 'Paiements fournisseur',
      description: 'Les états et devises restent séparés ; aucune somme multi-devise.',
      columns: [
        { key: 'provider', label: 'Provider' }, { key: 'status', label: 'Statut' },
        { key: 'reconciliation', label: 'Rapprochement' }, { key: 'currency', label: 'Devise' },
        { key: 'count', label: 'Paiements' }, { key: 'verified', label: 'Débits prouvés' },
      ],
      rows: (payload.payments || []).map(row => ({
        provider: row.provider, status: row.status, reconciliation: row.reconciliation_status,
        currency: row.currency, count: row.count, verified: row.real_debit_verified_count,
      })),
      emptyText: 'Aucun paiement fournisseur persisté.',
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
    const supplierId = options.supplierId || supplierIdFromPath(options.pathname || '');
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') throw new Error('canonical_supplier_360_dependencies_missing');
    if (!supplierId) throw new Error('canonical_supplier_360_id_missing');

    ui.UIState.render(rootNode, 'loading', 'Chargement du fournisseur…');
    try {
      const endpoint = ENDPOINT_PREFIX + encodeURIComponent(supplierId);
      const payload = await jsonRequest(fetchFn, endpoint);
      renderPayload(rootNode, ui, doc, payload);
      return Object.freeze({ payload, endpoint, supplierId });
    } catch (error) {
      ui.UIState.render(rootNode, 'error', error.message);
      throw error;
    }
  }

  return Object.freeze({ ENDPOINT_PREFIX, supplierIdFromPath, metricItems, renderPayload, jsonRequest, mount });
});
