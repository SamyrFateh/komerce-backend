/**
 * @komerce-arch
 * @role          shared-cart-saved-access-http
 * @domain        shared-cart
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_user, shared_cart_id
 * @outputs       saved_access_removal_result
 * @depends       middleware/auth.js, services/shared-cart-library.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/group/group-api.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      retirer_le_signet_jamais_la_liste
 * @impact-areas  shared-cart, mon-komerce, participant-flow
 * @version       2026-08
 */

'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  removeSavedSharedCartForUser,
} = require('../services/shared-cart-library');

const router = express.Router();

/**
 * DELETE /api/shared-carts/saved/:sharedCartId
 *
 * Retire uniquement l'accès sauvegardé de l'utilisateur courant.
 * La liste, ses articles, ses commandes et son token public restent intacts.
 */
router.delete('/:sharedCartId', authenticate, async (req, res, next) => {
  try {
    const result = await removeSavedSharedCartForUser(
      req.user.id,
      req.params.sharedCartId
    );
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        code: err.code || undefined,
      });
    }
    next(err);
  }
});

module.exports = router;
