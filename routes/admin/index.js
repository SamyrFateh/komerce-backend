/**
 * @komerce-arch
 * @role          dashboard-index
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

/**
 * routes/admin/index.js
 * Monte les sous-routers du domaine admin.
 * Importé par routes/admin.js (façade rétrocompat).
 *
 * Ordre de montage : du plus spécifique au plus général
 * pour éviter les conflits de paramètres (:id).
 */

const express = require('express');
const router  = express.Router();

// Groupe Documents — visibilité transaction_documents (diagnostic + admin)
router.use('/', require('./documents'));

// Groupe K-4 — file d'approbation catalogue : monté directement par
// bootstrap/api-routes.js (composition root), plus ici. Voir O7.3,
// docs/O7_3_BOUNDARY_ANALYSIS.md, provider catalog.

// Groupe B — douane (stub)
router.use('/', require('./customs'));

// Groupe C — partenaires / fournisseurs
router.use('/', require('./partners'));

// Groupe D — utilisateurs et rôles
router.use('/', require('./users'));

// Groupe F — redirections rétro-compatibles dashboard/margins/alerts
router.use('/', require('./dashboard'));

// LOT 2C — cockpit de démonstration canonique (trace métier en lecture)
router.use('/', require('./demo-order-flow'));

// Groupe E — opérations système (reset, seed-test, counts)
router.use('/', require('./system'));

// Groupe A — commandes (deleteOrderCascade — en dernier, le plus sensible)
router.use('/', require('./orders'));

module.exports = router;
