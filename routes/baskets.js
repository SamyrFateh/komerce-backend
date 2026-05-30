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
