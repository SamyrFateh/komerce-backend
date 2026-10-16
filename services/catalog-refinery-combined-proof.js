/**
 * @komerce-arch-lite
 * @role catalog-refinery-combined-proof
 * @domain catalog
 * @layer service
 * @owner catalog
 * @purpose Read-only combined technical and persisted visual FR certification.
 * @db-read none
 * @db-write none
 * @db-txn none
 * @impact-areas catalog,sourcing
 */
'use strict';
const { certifyCatalogProduct } = require('./catalog-certification');
const { inspectCatalogVisualFrEvidence } = require('./catalog-visual-fr-evidence-read');

async function certifyCatalogProductWithVisualEvidence(q, productId, options = {}) {
  const technical = await certifyCatalogProduct(q, productId, options);
  if (!technical) return null;
  const visual = await inspectCatalogVisualFrEvidence(q, productId);
  return {
    product_id: productId,
    certified: technical.certification.certified && visual.ready,
    technical_certified: technical.certification.certified,
    technical_reasons: technical.certification.reasons,
    visual_fr_certified: visual.ready,
    visual_fr_reason: visual.code,
    visual_fr_results: visual.results,
    publication_performed: false,
  };
}
module.exports = { certifyCatalogProductWithVisualEvidence };
