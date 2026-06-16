/**
 * @komerce-arch
 * @role          baskets
 * @domain        unknown
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — routes/baskets.js — TOMBSTONE
 *
 * Ce module est déclassé (2026-05-30).
 * Le panier partagé est désormais géré par /api/shared-carts (shared_carts).
 * /api/baskets n'est plus appelé par aucun client actif.
 *
 * Migration : shared_carts expose POST /from-basket pour les clients qui
 * auraient encore un basket_id en mémoire.
 *
 * Les tables baskets + basket_items restent en DB (données historiques —
 * ne pas supprimer sans audit de données).
 */
'use strict';

const express = require('express');
const log = require('../utils/logger').child({ module: 'baskets-tombstone' });
const router = express.Router();

function disabled(req, res) {
  log.warn({ method: req.method, path: req.originalUrl }, '[baskets tombstone] legacy endpoint called');
  res.status(410).json({
    error: 'baskets_disabled',
    message: 'Ce parcours est désactivé. Utilisez /api/shared-carts pour le panier partagé.',
    migration: 'POST /api/shared-carts/from-basket si vous avez un basket_id existant.',
  });
}

router.use(disabled);

module.exports = router;
