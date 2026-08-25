/**
 * @komerce-arch
 * @role          canonical-product-360-entity
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_admin_session, product_ref
 * @outputs       canonical_product_360
 * @depends       primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, canonical_admin_no_legacy_imports, product_ref_is_business_identity
 * @impact-areas  admin-dashboard, catalog, commerce, inventory, sourcing, economic-engine
 * @version       2026-08
 */

'use strict';

(function initProduct360(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalProduct360 = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createProduct360() {
  const ENDPOINT_PREFIX = '/api/admin/entities/products/';

  function productRefFromPath(pathname) {
    const match = String(pathname || '').match(/^\/admin\/products\/([^/]+)$/);
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

  function formatAed(value) {
    return `${formatNumber(value, 2)} AED`;
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

  function marketLabel(scope) {
    const markets = scope && Array.isArray(scope.markets) ? scope.markets : [];
    if (!markets.length) return scope && scope.mode === 'global' ? 'Global' : 'Périmètre autorisé';
    return markets.map(row => row.code || row.name).filter(Boolean).join(' · ');
  }

  function createHeader(doc, payload) {
    const product = payload.product || {};
    const header = doc.createElement('header');
    header.className = 'kmc-entity-header';
    header.appendChild(text(doc, 'span', 'kmc-entity-kicker', 'PRODUCT 360'));
    header.appendChild(text(doc, 'h1', 'kmc-entity-title', product.name || product.product_ref || 'Produit'));
    header.appendChild(text(
      doc,
      'p',
      'kmc-entity-subtitle',
      [product.product_ref, product.category, product.inventory_model, marketLabel(payload.scope)].filter(Boolean).join(' · ')
    ));

    const nav = doc.createElement('nav');
    nav.className = 'kmc-entity-nav';
    [
      ['/admin/commerce', '← Commerce'],
      ['/admin/products', 'Catalogue'],
      ['/admin/sourcing', 'Sourcing'],
      ['/admin/pricing', 'Pricing'],
    ].forEach(([href, label]) => {
      const link = text(doc, 'a', 'kmc-entity-nav-link', label);
      link.setAttribute('href', href);
      nav.appendChild(link);
    });
    header.appendChild(nav);
    return header;
  }

  function metricItems(payload) {
    const summary = payload.summary || {};
    const economics = payload.economics || {};
    const central = payload.central || {};

    return [
      { key: 'stock', label: 'Stock', value: formatNumber(summary.stock_total), tone: Number(summary.stock_total) <= 0 ? 'warning' : 'neutral' },
      { key: 'sold', label: 'Qté vendue', value: formatNumber(summary.quantity_sold) },
      { key: 'revenue', label: 'CA observé', value: formatKmf(summary.revenue_kmf) },
      { key: 'orders', label: 'Commandes', value: formatNumber(summary.orders_count) },
      {
        key: 'margin',
        label: 'Marge estimée persistée',
        value: formatKmf(economics.estimated_margin_kmf),
        tone: Number(economics.estimated_margin_kmf) < 0 ? 'critical' : 'neutral',
      },
      central.visibility === 'global'
        ? { key: 'suppliers', label: 'Fournisseurs', value: formatNumber(summary.suppliers) }
        : { key: 'central', label: 'Sourcing & audit', value: 'Central uniquement' },
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

  function variantLabel(combo) {
    if (!combo || typeof combo !== 'object') return 'Défaut';
    return Object.entries(combo).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'Défaut';
  }

  function renderPayload(rootNode, ui, doc, payload) {
    const product = payload.product || {};
    const inventory = payload.inventory || {};
    const economics = payload.economics || {};
    const central = payload.central || { visibility: 'restricted' };

    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload));

    const metrics = doc.createElement('section');
    metrics.className = 'kmc-entity-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload) });

    renderTableSection(rootNode, ui, {
      title: 'Identité catalogue',
      description: 'Référence métier stable Komerce. L’UUID technique n’est jamais exposé.',
      columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
      rows: [
        { champ: 'Référence Komerce', valeur: product.product_ref },
        { champ: 'SKU catalogue', valeur: product.sku },
        { champ: 'Catégorie', valeur: [product.category, product.subcategory].filter(Boolean).join(' · ') },
        { champ: 'Prix boutique', valeur: formatKmf(product.price_kmf) },
        { champ: 'Lifecycle', valeur: product.lifecycle_status },
        { champ: 'Actif', valeur: product.is_active ? 'Oui' : 'Non' },
        { champ: 'Disponible', valeur: product.is_available ? 'Oui' : 'Non' },
        { champ: 'Fragilité', valeur: product.fragility },
        { champ: 'Poids', valeur: product.weight_kg == null ? '—' : `${formatNumber(product.weight_kg, 3)} kg` },
        { champ: 'Mis à jour', valeur: formatDate(product.updated_at) },
      ],
      emptyText: 'Aucune identité produit.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Stock & unités vendables',
      description: inventory.model === 'SKU'
        ? 'Mode SKU : product_skus est la source de vérité du stock.'
        : 'Mode LEGACY_VARIANTS : stock historique conservé tant que la bascule SKU n’est pas explicite.',
      columns: [
        { key: 'type', label: 'Type' },
        { key: 'unite', label: 'Unité' },
        { key: 'sku', label: 'SKU' },
        { key: 'stock', label: 'Stock', align: 'right' },
        { key: 'prix', label: 'Prix', align: 'right' },
      ],
      rows: [
        ...(inventory.skus || []).map(row => ({
          type: row.is_active ? 'SKU actif' : 'SKU inactif',
          unite: variantLabel(row.variant_combo),
          sku: row.sku,
          stock: formatNumber(row.stock),
          prix: row.price_kmf == null ? 'Prix produit' : formatKmf(row.price_kmf),
        })),
        ...(inventory.variants || []).map(row => ({
          type: 'Variante legacy',
          unite: `${row.variant_type}: ${row.variant_value}`,
          sku: row.sku,
          stock: formatNumber(row.stock),
          prix: row.price_kmf == null ? 'Prix produit' : formatKmf(row.price_kmf),
        })),
      ],
      emptyText: `Aucune unité détaillée. Stock produit : ${formatNumber(inventory.legacy_base_stock)}`,
    });

    renderTableSection(rootNode, ui, {
      title: 'Performance par marché',
      description: payload.scope && payload.scope.mode === 'global'
        ? 'Vue centrale consolidée par marché.'
        : 'Uniquement les ventes rattachées aux marchés autorisés.',
      columns: [
        { key: 'market', label: 'Marché' },
        { key: 'orders', label: 'Commandes', align: 'right' },
        { key: 'qty', label: 'Qté', align: 'right' },
        { key: 'ca', label: 'CA', align: 'right' },
        { key: 'clients', label: 'Clients', align: 'right' },
        { key: 'last', label: 'Dernière vente' },
      ],
      rows: (payload.performance || []).map(row => ({
        market: row.market && (row.market.code || row.market.name),
        orders: formatNumber(row.orders_count),
        qty: formatNumber(row.quantity_sold),
        ca: formatKmf(row.revenue_kmf),
        clients: formatNumber(row.customers_count),
        last: formatDate(row.last_order_at),
      })),
      emptyText: 'Aucune vente visible dans le périmètre.',
    });

    renderTableSection(rootNode, ui, {
      title: 'Vérité économique observée',
      description: 'Uniquement des valeurs persistées par le moteur économique ; aucune marge n’est recalculée dans Product 360.',
      columns: [{ key: 'champ', label: 'Mesure' }, { key: 'valeur', label: 'Valeur' }],
      rows: [
        { champ: 'Lignes imputées', valeur: formatNumber(economics.imputation_lines) },
        { champ: 'Qté couverte', valeur: formatNumber(economics.quantity_costed) },
        { champ: 'CA couvert', valeur: formatKmf(economics.revenue_costed_kmf) },
        { champ: 'Coût landed estimé', valeur: formatKmf(economics.estimated_landed_kmf) },
        { champ: 'Coût business estimé', valeur: formatKmf(economics.estimated_business_kmf) },
        { champ: 'Marge estimée persistée', valeur: formatKmf(economics.estimated_margin_kmf) },
        { champ: 'Marge moyenne persistée', valeur: economics.avg_estimated_margin_pct == null ? '—' : `${formatNumber(economics.avg_estimated_margin_pct, 2)} %` },
        { champ: 'Coût réel alloué', valeur: formatKmf(economics.real_allocated_kmf) },
        { champ: 'Lignes avec coût réel', valeur: formatNumber(economics.real_lines_covered) },
      ],
      emptyText: 'Aucune vérité économique persistée.',
    });

    if (central.visibility === 'global') {
      renderTableSection(rootNode, ui, {
        title: 'Sourcing & fournisseurs',
        description: 'Facette centrale uniquement. Aucun secret API fournisseur n’est exposé.',
        columns: [
          { key: 'supplier', label: 'Fournisseur' },
          { key: 'platform', label: 'Plateforme' },
          { key: 'sku', label: 'SKU fournisseur' },
          { key: 'price', label: 'Prix achat', align: 'right' },
          { key: 'moq', label: 'MOQ', align: 'right' },
          { key: 'priority', label: 'Priorité', align: 'right' },
          { key: 'checked', label: 'Dernier contrôle' },
        ],
        rows: (central.suppliers || []).map(row => ({
          supplier: row.name,
          platform: row.platform,
          sku: row.supplier_sku,
          price: formatAed(row.supplier_price_aed),
          moq: formatNumber(row.min_order_qty),
          priority: formatNumber(row.priority),
          checked: formatDate(row.last_checked_at),
        })),
        emptyText: 'Aucun fournisseur mappé.',
      });

      renderTableSection(rootNode, ui, {
        title: 'Historique prix',
        description: 'Audit économique central, alimenté par price_history.',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'old', label: 'Ancien', align: 'right' },
          { key: 'next', label: 'Nouveau', align: 'right' },
          { key: 'source', label: 'Source' },
          { key: 'actor', label: 'Acteur' },
        ],
        rows: (central.price_history || []).map(row => ({
          date: formatDate(row.applied_at),
          old: row.old_price_kmf == null ? '—' : formatKmf(row.old_price_kmf),
          next: row.new_price_kmf == null ? '—' : formatKmf(row.new_price_kmf),
          source: row.source,
          actor: row.applied_by,
        })),
        emptyText: 'Aucun changement de prix audité.',
      });
    } else {
      renderTableSection(rootNode, ui, {
        title: 'Sourcing & audit',
        description: 'Les fournisseurs, prix d’achat et audits catalogue appartiennent au central Komerce.',
        columns: [{ key: 'champ', label: 'Champ' }, { key: 'valeur', label: 'Valeur' }],
        rows: [{ champ: 'Visibilité', valeur: 'Réservée au central Komerce' }],
        emptyText: 'Facette centrale restreinte.',
      });
    }

    renderTableSection(rootNode, ui, {
      title: 'Timeline produit',
      description: 'Chronologie unifiée produite côté serveur à partir des événements autorisés.',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'type', label: 'Type' },
        { key: 'event', label: 'Événement' },
        { key: 'detail', label: 'Détail' },
      ],
      rows: (payload.timeline || []).map(row => ({
        date: formatDate(row.occurred_at),
        type: row.type,
        event: row.title,
        detail: row.detail,
      })),
      emptyText: 'Aucun événement produit.',
    });
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  async function mount(options) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    const productRef = options.productRef || productRefFromPath(options.pathname || '');

    if (!rootNode) throw new Error('canonical_product_360_root_missing');
    if (!ui || !ui.UIState || !ui.DataTable || !ui.Section || !ui.MetricStrip) {
      throw new Error('canonical_product_360_primitives_missing');
    }
    if (!productRef) throw new Error('canonical_product_360_ref_missing');

    ui.UIState.render(rootNode, 'loading', 'Chargement du produit…');
    try {
      const endpoint = ENDPOINT_PREFIX + encodeURIComponent(productRef);
      const payload = await jsonRequest(fetchFn, endpoint);
      renderPayload(rootNode, ui, doc, payload);
      return Object.freeze({ payload, endpoint, productRef });
    } catch (error) {
      ui.UIState.render(rootNode, 'error', error.message);
      throw error;
    }
  }

  return Object.freeze({
    ENDPOINT_PREFIX,
    productRefFromPath,
    formatNumber,
    formatKmf,
    formatAed,
    formatDate,
    marketLabel,
    variantLabel,
    metricItems,
    renderPayload,
    jsonRequest,
    mount,
  });
});
