/**
 * @komerce-arch
 * @role          logistics-parcel-api-v2
 * @domain        logistics
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';
// Façade rétrocompat — montage dans bootstrap/api-routes.js inchangé.
module.exports = require('./parcel-api-v2/index');
