/**
 * @komerce-arch
 * @role          shared-cart-collective-workspaces
 * @domain        shared-cart
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart
 * @version       2026-06
 */

/**
 * KOMERCE — Legacy Collective Workspace API tombstone
 *
 * Le modèle Panier Événement Collectif / Workspace est déclassé.
 * Doctrine active : boutique-first via le panier partagé.
 *
 * Ce module reste montable par server.js pour compatibilité technique, mais
 * n'expose plus de comportement produit. Les clients doivent utiliser :
 *   - /boutique
 *   - /api/shared-carts/*
 */

'use strict';

const express = require('express');
const log = require('../utils/logger').child({ module: 'collective-workspaces-disabled' });

const router = express.Router();
const paymentsRouter = express.Router();

function disabled(req, res) {
  log.warn('[CollectiveWS disabled] legacy endpoint called', {
    method: req.method,
    path: req.originalUrl,
  });
  res.status(410).json({
    error: 'collective_workspace_disabled',
    message: 'Ce parcours collectif est désactivé. Le panier partagé se crée désormais depuis la boutique.',
    redirect_to: '/boutique',
  });
}

router.use(disabled);
paymentsRouter.use(disabled);

async function stripeWebhookHandler(req, res) {
  log.warn('[CollectiveWS disabled] legacy Stripe webhook ignored');
  res.status(410).json({
    received: true,
    ignored: 'collective_workspace_disabled',
  });
}

module.exports = { router, paymentsRouter, stripeWebhookHandler };
