/**
 * @komerce-arch
 * @role          pricing-global-authorization-guard
 * @domain        economic-engine
 * @layer         middleware
 * @criticality   high
 * @inputs        req.user.id, pricing_global_access_grants
 * @outputs       req.pricingGlobalAuthority, next_or_403
 * @depends       db.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       pricing_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      pricing_global_authority_explicit, admin_role_never_implies_canonical_pricing_write
 * @impact-areas  pricing, economic-engine, admin-dashboard, authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

async function hasPricingGlobalAuthority(userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM pricing_global_access_grants
      WHERE user_id = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

function requirePricingGlobalAuthority(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  if (req.pricingGlobalAuthority === true) return next();

  return hasPricingGlobalAuthority(req.user.id)
    .then(allowed => {
      if (!allowed) {
        return res.status(403).json({
          error: 'Accès refusé — autorité pricing globale requise',
          code: 'pricing_global_access_denied',
        });
      }
      req.pricingGlobalAuthority = true;
      return next();
    })
    .catch(next);
}

module.exports = {
  hasPricingGlobalAuthority,
  requirePricingGlobalAuthority,
};
