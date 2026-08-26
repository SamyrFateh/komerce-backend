/**
 * @komerce-arch
 * @role          sourcing-global-authorization-guard
 * @domain        sourcing
 * @layer         middleware
 * @criticality   high
 * @inputs        req.user.id, sourcing_global_access_grants
 * @outputs       req.sourcingGlobalAuthority, next_or_403
 * @depends       db.js
 * @used-by       routes/admin-sourcing-workspace.js
 * @db-read       sourcing_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      sourcing_global_authority_explicit, admin_role_never_implies_sourcing_write
 * @impact-areas  sourcing, admin-dashboard, authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

async function hasSourcingGlobalAuthority(userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM sourcing_global_access_grants
      WHERE user_id = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

function requireSourcingGlobalAuthority(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  if (req.sourcingGlobalAuthority === true) return next();

  return hasSourcingGlobalAuthority(req.user.id)
    .then(allowed => {
      if (!allowed) {
        return res.status(403).json({
          error: 'Accès refusé — autorité sourcing globale requise',
          code: 'sourcing_global_access_denied',
        });
      }
      req.sourcingGlobalAuthority = true;
      return next();
    })
    .catch(next);
}

module.exports = {
  hasSourcingGlobalAuthority,
  requireSourcingGlobalAuthority,
};
