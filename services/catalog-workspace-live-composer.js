/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-live-composer
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        catalog_workspace_projection, sourcing_live_flow_projection
 * @outputs       catalog_workspace_with_live_flow
 * @depends       services/catalog-workspace.js, services/catalog-live-flow.js
 * @used-by       routes/admin-catalog-workspace.js
 * @db-read       delegated
 * @db-write      none
 * @db-txn        delegated
 * @doctrine      catalog_composes_live_sourcing_projection_without_stealing_sourcing_mutation_authority
 * @impact-areas  catalog, sourcing, admin-dashboard
 * @version       2026-09
 */
'use strict';

const catalogWorkspace = require('./catalog-workspace');
const liveFlow = require('./catalog-live-flow');

async function buildWorkspace(query = {}) {
  const [catalog, live] = await Promise.all([
    catalogWorkspace.buildWorkspace(query),
    liveFlow.buildProjection({ incomingLimit: query.live_limit }),
  ]);
  return { ...catalog, live };
}

module.exports = {
  ...catalogWorkspace,
  buildWorkspace,
};
