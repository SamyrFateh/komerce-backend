/**
 * @komerce-arch
 * @role          dashboard-admin
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';
// Façade rétrocompat — bootstrap/api-routes.js fait : require('./routes/admin')
// La logique est dans routes/admin/ (GOD-FILES-2, 2026-05-25)
module.exports = require('./admin/index');
