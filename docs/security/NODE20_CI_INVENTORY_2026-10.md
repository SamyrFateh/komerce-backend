# GitHub Actions Node 20 inventory — 2026-10-26

GitHub code search identified **47 active workflow files** containing a Node 20 version pin. This is a discovery inventory, **not** proof every runtime path has been migrated or that search captured all formats. Do not bulk replace without validating each pipeline and dependent actions.

- `.github/workflows/golden-l4-isolated.yml`
- `.github/workflows/staging-p1-readonly.yml`
- `.github/workflows/showcase-v2-media-realism.yml`
- `.github/workflows/showcase-v2-staging-deploy.yml`
- `.github/workflows/isolated-cj-p1-create-readback.yml`
- `.github/workflows/staging-e2e-logistics-reconcile.yml`
- `.github/workflows/discovery-isolated-visual-proof.yml`
- `.github/workflows/staging-canonical-chromium-audit.yml`
- `.github/workflows/staging-sql-demo-cleanup-preview.yml`
- `.github/workflows/external-provider-contract-batch.yml`
- `.github/workflows/staging-aliexpress-pool-integrity.yml`
- `.github/workflows/staging-aliexpress-refinery-audit.yml`
- `.github/workflows/golden-p2-boutique-isolated.yml`
- `.github/workflows/isolated-cj-p2-confirm-pay-sandbox.yml`
- `.github/workflows/staging-p1-one-real-inactive-draft.yml`
- `.github/workflows/cj-three-real-staging-refinery-pilot.yml`
- `.github/workflows/isolated-cj-billing-history-readonly.yml`
- `.github/workflows/nightly-e2e-certification.yml`
- `.github/workflows/staging-p1-source-unit-reconciliation.yml`
- `.github/workflows/isolated-cj-p2-grouped-parent-sandbox.yml`
- `.github/workflows/staging-storefront-e2e-audit.yml`
- `.github/workflows/staging-aliexpress-catalog-pilot-audit.yml`
- `.github/workflows/sourcing-shadow-stock-replay-golden.yml`
- `.github/workflows/isolated-cj-golden-trigger-purchasing.yml`
- `.github/workflows/pr-enforcement.yml`
- `.github/workflows/allegro-isolated-continuity-golden.yml`
- `.github/workflows/isolated-catalog-curation-census.yml`
- `.github/workflows/isolated-fr-glossary-batch001.yml`
- `.github/workflows/isolated-cj-fr-quality-workpack.yml`
- `.github/workflows/schema-refresh.yml`
- `.github/workflows/staging-discovery-modal-v2-ops.yml`
- `.github/workflows/staging-discovery-ops.yml`
- `.github/workflows/staging-catalog-ops.yml`
- `.github/workflows/isolated-cj-refinery-continuation.yml`
- `.github/workflows/isolated-catalog-refinery-final-acceptance.yml`
- `.github/workflows/staging-aliexpress-public-hero-pilot.yml`
- `.github/workflows/staging-pdp-aliexpress-live-audit.yml`
- `.github/workflows/isolated-catalog-termium-memory.yml`
- `.github/workflows/staging-real-supplier-1000-stress.yml`
- `.github/workflows/allegro-continuity-live-stock-delta-golden.yml`
- `.github/workflows/staging-aliexpress-catalog-publish-pilot.yml`
- `.github/workflows/isolated-cj-balanced-e2e-500.yml`
- `.github/workflows/staging-aliexpress-catalog-manual-pilot.yml`
- `.github/workflows/isolated-catalog-fr-quality-campaign.yml`
- `.github/workflows/isolated-cj-fr-cold-start-challenge.yml`
- `.github/workflows/isolated-real-cj-1000-catalog-stress.yml`
- `.github/workflows/isolated-aliexpress-business-certification.yml`

## Migration rule
In candidate PR, keep workflows unchanged until CI compatibility proven; follow-up migrate setup-node pin in controlled batches, retest each relevant runner and dependencies, keep production/staging dispatch guards. Scan for unquoted 20, Node 18 and 22 separately.
