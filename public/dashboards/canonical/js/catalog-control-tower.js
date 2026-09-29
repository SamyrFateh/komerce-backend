/**
 * @komerce-arch
 * @role          canonical-catalog-commercial-shell
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_catalog_workspace
 * @outputs       canonical_catalog_workspace
 * @depends       public/dashboards/canonical/js/catalog-workspace.js, public/dashboards/canonical/js/catalog-workspace-decision.js
 * @used-by       canonical admin catalog workspace
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      one_shell_one_truth_no_duplicate_dashboard, catalog_does_not_repeat_import_pipeline, commercial_assortment_is_primary_catalog_read
 * @impact-areas  admin-dashboard, catalog
 * @version       2026-09-commercial-canon
 */
'use strict';

(function initCatalogCommercialShell(root, factory) {
  const base = root && root.KomerceCanonicalCatalogWorkspace;
  const api = factory(base);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && base) root.KomerceCanonicalCatalogWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCatalogCommercialShell(baseModule) {
  if (!baseModule || typeof baseModule.mount !== 'function') {
    return Object.freeze({
      mount() {
        throw new Error('canonical_catalog_workspace_missing');
      },
    });
  }

  // Compatibility shell only. The previous Control Tower duplicated the import
  // pipeline (sourced → ready → published → visible). Import truth now belongs
  // to the KIR cockpit; Catalog renders its own commercial assortment + actions.
  return Object.freeze({
    ...baseModule,
    _base: baseModule,
  });
});
