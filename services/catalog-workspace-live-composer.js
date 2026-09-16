/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-live-composer
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        catalog_workspace_projection, sourcing_live_flow_projection, catalog_business_truth
 * @outputs       catalog_workspace_with_live_flow_and_business_truth
 * @depends       services/catalog-workspace.js, services/catalog-live-flow.js, services/catalog-business-truth.js
 * @used-by       routes/admin-catalog-workspace.js
 * @db-read       delegated
 * @db-write      none
 * @db-txn        delegated
 * @doctrine      catalog_composes_live_sourcing_projection_without_stealing_sourcing_mutation_authority, dashboard_exposes_business_truth
 * @impact-areas  catalog, sourcing, boutique, admin-dashboard
 * @version       2026-09-business-truth
 */
'use strict';

const catalogWorkspace = require('./catalog-workspace');
const liveFlow = require('./catalog-live-flow');
const businessTruth = require('./catalog-business-truth');

async function buildWorkspace(query = {}) {
  const [catalog, live, business] = await Promise.all([
    catalogWorkspace.buildWorkspace(query),
    liveFlow.buildProjection({ incomingLimit: query.live_limit }),
    businessTruth.buildProjection(),
  ]);
  return { ...catalog, live, business };
}

module.exports = {
  ...catalogWorkspace,
  buildWorkspace,
};
