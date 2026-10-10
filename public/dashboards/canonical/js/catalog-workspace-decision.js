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

  function requestedProductRef(options = {}) {
    const search = options.location && typeof options.location.search === 'string'
      ? options.location.search
      : (typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location.search : '');
    try {
      return new URLSearchParams(search || '').get('product_ref');
    } catch (_) {
      return null;
    }
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

    if (review.length > 0 || Number(summary.needs_review) > 0) {
      items.push({
        key: 'needs-review',
        label: 'Produits à relire',
        helper: 'Références publiées signalées par la source canonique',
        value: String(review.length || Number(summary.needs_review)),
        tone: 'warning',
        icon: 'i',
        href: '#catalog-curation',
        actionLabel: 'Voir les produits →',
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
      { key: 'approved', label: 'Approuvés vente', value: String(Number(summary.commercial_approved) || 0), tone: 'neutral' },
      { key: 'approval', label: 'À curater', value: String(Number(summary.approval_pending) || 0), tone: Number(summary.approval_pending) > 0 ? 'warning' : 'neutral' },
      { key: 'review', label: 'À relire', value: String(Number(summary.needs_review) || 0), tone: Number(summary.needs_review) > 0 ? 'warning' : 'neutral' },
      { key: 'lots', label: 'KIR clos contributeurs', value: String(Number(summary.commercial_closed_lots) || 0), tone: 'neutral' },
      { key: 'markets', label: 'Marchés servis', value: String(Number(summary.commercial_markets) || 0), tone: 'neutral' },
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
      value: row.needs_review ? 'À relire' : 'Approuvé vente',
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
    host.setAttribute('data-dashboard-hierarchy', 'hero-attention-primary');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.setAttribute('data-dashboard-role', 'hero');
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'CATALOGUE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Produits à valider'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Voir ce qui doit être relu, corrigé ou ajouté au catalogue.'));
    host.appendChild(header);

    const decisions = decisionItems(payload);
    if (decisions.length) {
      const decisionHost = doc.createElement('div');
      decisionHost.className = 'kmc-cockpit-decisions kmc-dashboard-attention-band';
      decisionHost.setAttribute('data-dashboard-role', 'attention');
      decisionUi.DecisionStrip.render(decisionHost, { items: decisions });
      host.appendChild(decisionHost);
    }

    const firstChild = rootNode.children && rootNode.children.length ? rootNode.children[0] : null;
    if (firstChild && typeof rootNode.insertBefore === 'function') rootNode.insertBefore(host, firstChild);
    else if (typeof rootNode.prepend === 'function') rootNode.prepend(host);
    else rootNode.appendChild(host);

    const approvalTable = rootNode.querySelector && rootNode.querySelector('.kmc-workspace-table');
    const approvalBody = approvalTable && approvalTable.parentNode && approvalTable.parentNode.parentNode;
    const approvalSection = approvalBody && approvalBody.parentNode;
    if (approvalBody) approvalBody.setAttribute('id', 'catalog-curation');

    // La liste de curation est le travail principal : elle vient immédiatement
    // sous le titre Catalogue, avant les KPI et l'assortiment déjà approuvé.
    if (approvalSection && approvalSection.classList && approvalSection.classList.contains('kmc-section')) {
      approvalSection.setAttribute('data-dashboard-role', 'primary');
      const attention = host.querySelector('[data-dashboard-role="attention"]');
      if (attention && attention.nextSibling) host.insertBefore(approvalSection, attention.nextSibling);
      else host.appendChild(approvalSection);
    }

    const focusedRef = requestedProductRef(options);
    if (focusedRef && approvalTable) {
      const rows = approvalTable.querySelectorAll ? approvalTable.querySelectorAll('[data-product-ref]') : [];
      const focusedRow = Array.from(rows || []).find(row => row.getAttribute('data-product-ref') === focusedRef);
      if (focusedRow) {
        focusedRow.classList.add('is-context-target');
        focusedRow.setAttribute('aria-current', 'true');
        const marker = text(doc, 'div', 'kmc-catalog-context-banner', `Produit suivi · ${focusedRef}`);
        approvalSection.insertBefore(marker, approvalSection.firstChild);
        if (typeof focusedRow.scrollIntoView === 'function') {
          focusedRow.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      }
    }
    return host;
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('catalog_decision_base_missing');
    const baseMount = base.mount;
    return Object.freeze({
      ...base,
      mount(options) {
        // Le Hero « Produits à valider » doit survivre aux rechargements (après une action,
        // renderPayload vide la racine) : on le repose après chaque rendu, pas seulement au montage.
        let first = true;
        const afterRender = payload => {
          // Le focus produit (scroll) ne vaut que pour le premier rendu.
          const renderOptions = first ? options : { ...options, location: { search: '' } };
          first = false;
          prependDecisionView(options.root, payload, renderOptions, base, decisionUi);
        };
        return Promise.resolve(baseMount({ ...options, afterRender }));
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
