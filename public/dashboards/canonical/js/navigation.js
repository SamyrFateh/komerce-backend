/**
 * @komerce-arch
 * @role          canonical-admin-navigation
 * @domain        admin-dashboard
 * @layer         ui-component
 * @criticality   low
 * @inputs        canonical_surface
 * @outputs       canonical_parent_navigation, canonical_primary_navigation
 * @depends       none
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_admin_no_legacy_imports
 * @impact-areas  admin-dashboard-navigation
 * @version       2026-08
 */

'use strict';

(function initCanonicalNavigation(root, factory) {
  const api = factory();
  /* istanbul ignore else -- CommonJS sous Jest, global navigateur en production. */
  if (typeof module === 'object' && module.exports) module.exports = api;
  /* istanbul ignore else -- exercé par le navigateur. */
  if (root) root.KomerceCanonicalNavigation = api;
})(globalThis, function createCanonicalNavigation() {
  const SURFACES = Object.freeze({
    PILOTAGE: 'pilotage',
    COMMERCE: 'commerce',
    OPERATIONS: 'operations',
    FINANCE: 'finance',
    OPERATIONS_WORKSPACE: 'operations-workspace',
    SHIPPING_CUSTOMS_WORKSPACE: 'shipping-customs-workspace',
    CATALOG_WORKSPACE: 'catalog-workspace',
    ACCOUNTING_WORKSPACE: 'accounting-workspace',
    SOURCING_WORKSPACE: 'sourcing-workspace',
    PRICING_WORKSPACE: 'pricing-workspace',
    ACTION_CENTER: 'action-center',
    ORDER_360: 'order-360',
    CLIENT_INDEX: 'client-index',
    CLIENT_360: 'client-360',
    PRODUCT_360: 'product-360',
    DEMO: 'demo',
  });

  const PRIMARY_NAVIGATION = Object.freeze([
    Object.freeze({ surface: SURFACES.PILOTAGE, href: '/admin/pilotage', label: 'Pilotage' }),
    Object.freeze({ surface: SURFACES.COMMERCE, href: '/admin/commerce', label: 'Commerce' }),
    Object.freeze({ surface: SURFACES.OPERATIONS, href: '/admin/operations', label: 'Opérations' }),
    Object.freeze({ surface: SURFACES.FINANCE, href: '/admin/finance', label: 'Finance' }),
  ]);

  const CONTEXTS = Object.freeze({
    [SURFACES.PILOTAGE]: Object.freeze({ activeSurface: SURFACES.PILOTAGE, parent: null }),
    [SURFACES.COMMERCE]: Object.freeze({ activeSurface: SURFACES.COMMERCE, parent: { href: '/admin/pilotage', label: 'Pilotage' } }),
    [SURFACES.OPERATIONS]: Object.freeze({ activeSurface: SURFACES.OPERATIONS, parent: { href: '/admin/pilotage', label: 'Pilotage' } }),
    [SURFACES.FINANCE]: Object.freeze({ activeSurface: SURFACES.FINANCE, parent: { href: '/admin/pilotage', label: 'Pilotage' } }),
    [SURFACES.OPERATIONS_WORKSPACE]: Object.freeze({ activeSurface: SURFACES.OPERATIONS, parent: { href: '/admin/operations', label: 'Opérations' } }),
    [SURFACES.SHIPPING_CUSTOMS_WORKSPACE]: Object.freeze({ activeSurface: SURFACES.OPERATIONS, parent: { href: '/admin/operations', label: 'Opérations' } }),
    [SURFACES.CATALOG_WORKSPACE]: Object.freeze({ activeSurface: SURFACES.COMMERCE, parent: { href: '/admin/commerce', label: 'Commerce' } }),
    [SURFACES.ACCOUNTING_WORKSPACE]: Object.freeze({ activeSurface: SURFACES.FINANCE, parent: { href: '/admin/finance', label: 'Finance' } }),
    [SURFACES.SOURCING_WORKSPACE]: Object.freeze({ activeSurface: SURFACES.COMMERCE, parent: { href: '/admin/commerce', label: 'Commerce' } }),
    [SURFACES.PRICING_WORKSPACE]: Object.freeze({ activeSurface: SURFACES.FINANCE, parent: { href: '/admin/finance', label: 'Finance' } }),
    [SURFACES.ACTION_CENTER]: Object.freeze({ activeSurface: SURFACES.PILOTAGE, parent: { href: '/admin/pilotage', label: 'Pilotage' } }),
    [SURFACES.ORDER_360]: Object.freeze({ activeSurface: SURFACES.OPERATIONS, parent: { href: '/admin/operations', label: 'Opérations' } }),
    [SURFACES.CLIENT_INDEX]: Object.freeze({ activeSurface: SURFACES.COMMERCE, parent: { href: '/admin/commerce', label: 'Commerce' } }),
    [SURFACES.CLIENT_360]: Object.freeze({ activeSurface: SURFACES.COMMERCE, parent: { href: '/admin/clients', label: 'Clients' } }),
    [SURFACES.PRODUCT_360]: Object.freeze({ activeSurface: SURFACES.COMMERCE, parent: { href: '/admin/workspaces/catalog', label: 'Catalogue' } }),
    [SURFACES.DEMO]: Object.freeze({ activeSurface: SURFACES.PILOTAGE, parent: { href: '/admin/pilotage', label: 'Pilotage' } }),
  });

  function contextForSurface(surface) {
    return CONTEXTS[surface] || CONTEXTS[SURFACES.PILOTAGE];
  }

  function link(doc, className, href, label) {
    const node = doc.createElement('a');
    node.className = className;
    node.textContent = label;
    node.setAttribute('href', href);
    return node;
  }

  function mount(rawOptions) {
    const options = rawOptions || {};
    const root = options.root;
    const doc = options.document;
    if (!root || typeof root.replaceChildren !== 'function' || typeof root.appendChild !== 'function') {
      throw new Error('canonical_navigation_root_missing');
    }
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('canonical_navigation_document_missing');
    }

    const surface = CONTEXTS[options.surface] ? options.surface : SURFACES.PILOTAGE;
    const context = contextForSurface(surface);
    root.className = 'kmc-canonical-app';
    root.replaceChildren();

    const header = doc.createElement('header');
    header.className = 'kmc-canonical-nav';
    const inner = doc.createElement('div');
    inner.className = 'kmc-canonical-nav-inner';
    const location = doc.createElement('div');
    location.className = 'kmc-canonical-nav-location';
    location.appendChild(link(doc, 'kmc-canonical-brand', '/admin/pilotage', 'Komerce Admin'));

    if (context.parent) {
      const back = link(doc, 'kmc-canonical-back', context.parent.href, `← Retour à ${context.parent.label}`);
      back.setAttribute('aria-label', `Retour à ${context.parent.label}`);
      location.appendChild(back);
    }

    const primary = doc.createElement('nav');
    primary.className = 'kmc-canonical-primary-nav';
    primary.setAttribute('aria-label', 'Navigation principale');
    PRIMARY_NAVIGATION.forEach(item => {
      const itemLink = link(doc, 'kmc-canonical-primary-link', item.href, item.label);
      if (item.surface === context.activeSurface) itemLink.setAttribute('aria-current', 'page');
      primary.appendChild(itemLink);
    });

    inner.appendChild(location);
    inner.appendChild(primary);
    header.appendChild(inner);

    const content = doc.createElement('div');
    content.className = 'kmc-canonical-content';
    content.setAttribute('data-canonical-content', surface);
    root.appendChild(header);
    root.appendChild(content);
    return content;
  }

  return Object.freeze({ SURFACES, PRIMARY_NAVIGATION, contextForSurface, mount });
});
