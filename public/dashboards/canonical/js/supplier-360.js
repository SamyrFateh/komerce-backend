/**
 * @komerce-arch
 * @role          canonical-supplier-360-entity
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        authenticated_admin, supplier_id, safe_supplier_360_projection
 * @outputs       canonical_supplier_360_dom
 * @depends       canonical primitives, purchasing Supplier 360 API
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_observes_workspace_acts, supplier_configuration_is_not_certification, secrets_never_projected
 * @impact-areas  admin-dashboard, purchasing, supplier-connectivity
 * @version       2026-10
 */
'use strict';

(function initSupplier360(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalSupplier360 = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createSupplier360() {
  const ENDPOINT_PREFIX = '/api/purchasing/suppliers/';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function supplierIdFromPath(pathname) {
    const match = String(pathname || '').match(/^\/admin\/suppliers\/([^/]+)$/);
    if (!match) return null;
    try {
      const id = decodeURIComponent(match[1]);
      return UUID_RE.test(id) ? id : null;
    } catch (_) {
      return null;
    }
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function formatNumber(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function yesNo(value) {
    return value === true ? 'Oui' : 'Non';
  }

  function createHeader(doc, payload) {
    const supplier = payload.supplier;
    const header = doc.createElement('header');
    header.className = 'kmc-entity-header';
    header.appendChild(text(doc, 'span', 'kmc-entity-kicker', 'SUPPLIER 360'));
    header.appendChild(text(doc, 'h1', 'kmc-entity-title', supplier.name));
    header.appendChild(text(
      doc,
      'p',
      'kmc-entity-subtitle',
      [supplier.platform, supplier.is_active ? 'Actif' : 'Inactif'].join(' · ')
    ));

    const nav = doc.createElement('nav');
    nav.className = 'kmc-entity-nav';
    [
      ['/admin/suppliers', '← Administration fournisseurs'],
      ['/admin/workspaces/purchasing', 'Achats fournisseurs'],
    ].forEach(([href, label]) => {
      const link = text(doc, 'a', 'kmc-entity-nav-link', label);
      link.setAttribute('href', href);
      nav.appendChild(link);
    });
    header.appendChild(nav);
    return header;
  }

  function metricItems(payload) {
    const supplier = payload.supplier || {};
    const summary = payload.summary || {};
    return [
      { key: 'status', label: 'État', value: supplier.is_active ? 'Actif' : 'Inactif', tone: supplier.is_active ? 'positive' : 'warning' },
      {
        key: 'auto-order-config',
        label: 'Config auto-order',
        value: supplier.configuration && supplier.configuration.auto_order ? 'Activée' : 'Désactivée',
        tone: 'neutral',
        helper: 'Configuration locale, pas une certification provider',
      },
      { key: 'products', label: 'Produits mappés', value: formatNumber(summary.products_mapped) },
      { key: 'po', label: 'PO', value: formatNumber(summary.purchase_orders_total) },
    ];
  }

  function renderTableSection(rootNode, ui, options) {
    const section = ui.Section.create({ title: options.title, description: options.description });
    rootNode.appendChild(section.element);
    ui.DataTable.render(section.slot, {
      columns: options.columns,
      rows: options.rows,
      emptyText: options.emptyText,
    });
  }

  function renderPayload(rootNode, ui, doc, payload) {
    const supplier = payload.supplier || {};
    const config = supplier.configuration || {};
    const credentials = supplier.credentials || {};
    const authority = payload.provider_authority || {};

    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));

    const metrics = doc.createElement('section');
    metrics.className = 'kmc-entity-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload) });

    renderTableSection(rootNode, ui, {
      title: 'Identité & configuration non secrète',
      description: 'Configuration persistée du fournisseur. La présence d’un credential est visible, jamais sa valeur.',
      columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
      rows: [
        { champ: 'Provider', valeur: supplier.platform },
        { champ: 'Compte provider', valeur: config.account_id || '—' },
        { champ: 'Contact', valeur: [supplier.contact && supplier.contact.name, supplier.contact && supplier.contact.email, supplier.contact && supplier.contact.phone].filter(Boolean).join(' · ') || '—' },
        { champ: 'Délai configuré', valeur: `${formatNumber(config.lead_time_days)} j` },
        { champ: 'Auto-order configuré', valeur: yesNo(config.auto_order) },
        { champ: 'Transport sécurisé requis', valeur: yesNo(config.requires_secure_transport) },
        { champ: 'Frais transport sécurisé', valeur: config.secure_transport_fee_pct == null ? '—' : `${String(config.secure_transport_fee_pct)} %` },
        { champ: 'Contact transport sécurisé', valeur: config.secure_transport_contact || '—' },
        { champ: 'Clé API présente', valeur: yesNo(credentials.has_api_key) },
        { champ: 'Secret API présent', valeur: yesNo(credentials.has_api_secret) },
        { champ: 'Dernière mise à jour', valeur: formatDate(supplier.updated_at) },
      ],
      emptyText: 'Aucune configuration fournisseur.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Autorité provider',
      description: 'Exigences déclarées par supplier-connectivity. Elles ne sont pas dérivées du flag auto-order.',
      columns: [{ key: 'capacite', label: 'Capacité' }, { key: 'verdict', label: 'Exigence' }],
      rows: [
        { capacite: 'Provider supporté', verdict: yesNo(authority.supported) },
        { capacite: 'Preflight distant', verdict: authority.remote_preflight_requirement || 'UNKNOWN' },
        { capacite: 'Réconciliation post-achat', verdict: authority.reconciliation_requirement || 'UNKNOWN' },
      ],
      emptyText: 'Aucune autorité provider.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Certifications provider',
      description: 'Preuves classifiées par capability depuis le ledger canonique. Aucun statut n’est codé en dur dans cet écran.',
      columns: [
        { key: 'capability', label: 'Capability' },
        { key: 'classification', label: 'Classification' },
        { key: 'availability', label: 'Disponibilité' },
        { key: 'proof', label: 'Preuve max' },
        { key: 'environment', label: 'Environnement' },
        { key: 'evidence', label: 'Évidence' },
        { key: 'limitations', label: 'Limites' },
      ],
      rows: (payload.certifications || []).map(row => ({
        capability: row.capability,
        classification: row.classification,
        availability: row.availability,
        proof: row.highest_proof,
        environment: row.environment,
        evidence: (row.evidence || []).join(' · '),
        limitations: (row.limitations || []).join(' · '),
      })),
      emptyText: 'Aucune certification réconciliée pour ce provider.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Bons de commande',
      description: 'Répartition factuelle des PO Komerce par statut pour ce fournisseur.',
      columns: [{ key: 'status', label: 'Statut' }, { key: 'count', label: 'PO', align: 'right' }],
      rows: (payload.purchase_orders_by_status || []).map(row => ({ status: row.status, count: formatNumber(row.count) })),
      emptyText: 'Aucune PO pour ce fournisseur.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Produits mappés',
      description: 'Mappings actifs ou conservés côté Purchasing ; le SKU fournisseur est affiché sans recomposer l’identité produit.',
      columns: [
        { key: 'reference', label: 'Réf. Komerce' },
        { key: 'product', label: 'Produit' },
        { key: 'supplier_sku', label: 'SKU fournisseur' },
        { key: 'min_qty', label: 'MOQ', align: 'right' },
        { key: 'priority', label: 'Priorité', align: 'right' },
        { key: 'active', label: 'Actif' },
      ],
      rows: (payload.mappings || []).map(row => ({
        reference: row.product_ref,
        product: row.product_name,
        supplier_sku: row.supplier_sku,
        min_qty: formatNumber(row.min_order_qty),
        priority: formatNumber(row.priority),
        active: yesNo(row.is_active),
      })),
      emptyText: 'Aucun produit mappé.',
    });
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    const supplierId = options.supplierId || supplierIdFromPath(options.pathname || '');

    if (!rootNode) throw new Error('canonical_supplier_360_root_missing');
    if (!ui || !ui.UIState || !ui.DataTable || !ui.Section || !ui.MetricStrip) {
      throw new Error('canonical_supplier_360_primitives_missing');
    }
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

  return Object.freeze({
    ENDPOINT_PREFIX,
    UUID_RE,
    supplierIdFromPath,
    formatNumber,
    formatDate,
    yesNo,
    metricItems,
    renderPayload,
    jsonRequest,
    mount,
  });
});
