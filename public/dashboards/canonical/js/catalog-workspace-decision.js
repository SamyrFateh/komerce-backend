/**
 * @komerce-arch
 * @role          canonical-catalog-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_catalog_workspace_payload, decision_primitives
 * @outputs       decision_first_catalog_dom
 * @depends       catalog-workspace, primitives, decision-primitives
 * @used-by       canonical admin Catalogue runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, decision_first_dashboard_visuals, curated_catalog_not_crud
 * @impact-areas  admin-dashboard, catalog
 * @version       2026-09
 */
'use strict';

(function initCatalogDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalCatalogWorkspace && root.KomerceDecisionUI) {
    root.KomerceCanonicalCatalogWorkspace = api.enhance(root.KomerceCanonicalCatalogWorkspace, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCatalogDecision() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function activeProducts(payload) {
    return (Array.isArray(payload && payload.products) ? payload.products : []).filter(row => row && row.is_active);
  }

  function reviewProducts(payload) {
    return activeProducts(payload).filter(row => row.needs_review);
  }

  function decisionItems(payload) {
    const items = [];
    const summary = payload && payload.summary ? payload.summary : {};
    const curation = payload && payload.curation ? payload.curation : {};
    const approval = Array.isArray(payload && payload.approval) ? payload.approval : [];
    const review = reviewProducts(payload);

    if (approval.length > 0) {
      items.push({
        key: 'approval-pending',
        label: 'Produits à curater',
        helper: 'Validation humaine requise avant première publication',
        value: String(approval.length),
        tone: 'warning',
        icon: '✓',
        href: '#catalog-curation',
        actionLabel: 'Voir la file →',
      });
    }

    if (review.length > 0 || Number(summary.needs_review) > 0) {
      items.push({
        key: 'needs-review',
        label: 'Produits à relire',
        helper: 'Références publiées signalées par la source canonique',
        value: String(review.length || Number(summary.needs_review)),
        tone: 'warning',
        icon: 'i',
        href: '#catalog-products',
        actionLabel: 'Voir la sélection →',
      });
    }

    if (curation.at_cap) {
      items.push({
        key: 'catalog-cap',
        label: 'Cap catalogue atteint',
        helper: 'Toute nouvelle entrée doit remplacer une référence sortie',
        value: `${curation.published_products || 0}/${curation.catalog_cap_mvp || 0}`,
        tone: 'critical',
        icon: '!',
      });
    }

    return items.slice(0, 4);
  }

  function metricItems(payload, base) {
    const summary = payload && payload.summary ? payload.summary : {};
    const curation = payload && payload.curation ? payload.curation : {};
    return [
      { key: 'published', label: 'Produits publiés', value: base.metricItems(summary, curation)[0].value, tone: 'neutral' },
      { key: 'approval', label: 'À curater', value: String(Number(summary.approval_pending) || 0), tone: Number(summary.approval_pending) > 0 ? 'warning' : 'neutral' },
      { key: 'review', label: 'À relire', value: String(Number(summary.needs_review) || 0), tone: Number(summary.needs_review) > 0 ? 'warning' : 'neutral' },
      { key: 'categories', label: 'Catégories actives', value: String(Number(summary.categories) || 0), tone: 'neutral' },
      { key: 'fill', label: 'Cap utilisé', value: curation.fill_pct == null ? '—' : `${curation.fill_pct} %`, tone: curation.at_cap ? 'critical' : 'neutral' },
    ];
  }

  function categoryItems(payload) {
    return (Array.isArray(payload && payload.categories) ? payload.categories : [])
      .filter(row => row && row.is_active)
      .map(row => ({
        title: row.label || row.key || 'Catégorie',
        helper: `${(Array.isArray(row.subcategories) ? row.subcategories : []).filter(sub => sub && sub.is_active).length} sous-catégorie(s) active(s)`,
        value: row.show_in_rail ? 'Rail actif' : 'Hors rail',
        tone: row.show_in_rail ? 'positive' : 'neutral',
      }));
  }

  function productItems(payload) {
    return activeProducts(payload).map(row => ({
      title: row.name || row.product_ref || 'Produit',
      helper: [row.category, row.subcategory, row.content_source].filter(Boolean).join(' · '),
      value: row.needs_review ? 'À relire' : 'Publiée',
      tone: row.needs_review ? 'warning' : 'positive',
      href: row.product_ref ? `/admin/products/${encodeURIComponent(row.product_ref)}` : undefined,
      actionLabel: 'Product 360 →',
    }));
  }

  function trust(payload) {
    const curation = payload && payload.curation ? payload.curation : {};
    const scope = payload && payload.scope ? payload.scope : {};
    return {
      stateLabel: 'Source canonique',
      scopeLabel: scope.label || 'Catalogue commun Komerce',
      qualityLabel: curation.first_publication_authority === 'human_approval'
        ? 'Première publication : validation humaine'
        : undefined,
    };
  }

  function cardSection(doc, title, description, id) {
    const section = doc.createElement('section');
    section.className = 'kmc-decision-surface-card';
    if (id) section.setAttribute('id', id);
    section.appendChild(text(doc, 'h2', 'kmc-decision-dashboard-section-title', title));
    if (description) section.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy', description));
    const body = doc.createElement('div');
    section.appendChild(body);
    return { section, body };
  }

  function prependDecisionView(rootNode, payload, options, base, decisionUi) {
    const doc = options.document;
    const ui = options.ui;
    const host = doc.createElement('section');
    host.className = 'kmc-dashboard kmc-decision-dashboard kmc-catalog-decision-overview';
    host.setAttribute('data-dashboard-id', 'catalog');
    host.setAttribute('data-dashboard-visual', 'decision-first-v1');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'CATALOGUE · VUE D’ENSEMBLE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Catalogue curaté'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Voir la santé de la sélection globale avant d’agir dans le workspace de curation.'));
    host.appendChild(header);

    const decisions = decisionItems(payload);
    if (decisions.length) {
      const decisionHost = doc.createElement('div');
      decisionUi.DecisionStrip.render(decisionHost, { items: decisions });
      host.appendChild(decisionHost);
    }

    const metrics = cardSection(doc, 'État du catalogue', 'Les compteurs viennent du workspace canonique, sans reconstruction métier côté navigateur.', 'catalog-kpis');
    ui.MetricStrip.render(metrics.body, { items: metricItems(payload, base) });
    host.appendChild(metrics.section);

    const grid = doc.createElement('div');
    grid.className = 'kmc-decision-dashboard-grid-2';
    const products = cardSection(doc, 'Sélection publiée', 'Les références actives et leur état de relecture.', 'catalog-products');
    decisionUi.RankedList.render(products.body, { items: productItems(payload) });
    grid.appendChild(products.section);
    const categories = cardSection(doc, 'Santé de la taxonomie', 'Catégories globales actives et présence dans les rails.', 'catalog-categories');
    decisionUi.RankedList.render(categories.body, { items: categoryItems(payload) });
    grid.appendChild(categories.section);
    host.appendChild(grid);

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, trust(payload));
    host.appendChild(footer);

    const firstChild = rootNode.children && rootNode.children.length ? rootNode.children[0] : null;
    if (firstChild && typeof rootNode.insertBefore === 'function') rootNode.insertBefore(host, firstChild);
    else if (typeof rootNode.prepend === 'function') rootNode.prepend(host);
    else rootNode.appendChild(host);

    const approvalSection = rootNode.querySelector && rootNode.querySelector('.kmc-workspace-table');
    if (approvalSection && approvalSection.parentNode && approvalSection.parentNode.parentNode) {
      approvalSection.parentNode.parentNode.setAttribute('id', 'catalog-curation');
    }
    return host;
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('catalog_decision_base_missing');
    const baseMount = base.mount;
    return Object.freeze({
      ...base,
      mount(options) {
        return Promise.resolve(baseMount(options)).then(payload => {
          prependDecisionView(options.root, payload, options, base, decisionUi);
          return payload;
        });
      },
      projectDecisionItems: decisionItems,
      projectMetricItems: payload => metricItems(payload, base),
      projectCategoryItems: categoryItems,
      projectProductItems: productItems,
      projectTrust: trust,
    });
  }

  return Object.freeze({ activeProducts, reviewProducts, decisionItems, metricItems, categoryItems, productItems, trust, prependDecisionView, enhance });
});
