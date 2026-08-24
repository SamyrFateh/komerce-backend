/**
 * @komerce-arch
 * @role          dashboard-global-authorization-guard
 * @domain        admin-dashboard
 * @layer         middleware
 * @criticality   high
 * @inputs        req.user.id, dashboard_global_access_grants
 * @outputs       req.dashboardGlobalAuthority, next_or_403
 * @depends       db.js
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_global_context_explicit, admin_role_never_implies_global
 * @impact-areas  admin-dashboard, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

async function hasDashboardGlobalAuthority(userId) {
  if (!userId) return false;

  const { rows } = await db.query(
    `SELECT 1
     FROM dashboard_global_access_grants
     WHERE user_id = $1
       AND revoked_at IS NULL
     LIMIT 1`,
    [userId]
  );

  return rows.length > 0;
}

function requireDashboardGlobalAuthority(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });

  if (req.dashboardGlobalAuthority === true) return next();

  return hasDashboardGlobalAuthority(req.user.id)
    .then(allowed => {
      if (!allowed) {
        return res.status(403).json({
          error: 'Accès refusé — autorité dashboard globale requise',
          code: 'dashboard_global_access_denied',
        });
      }

      req.dashboardGlobalAuthority = true;
      next();
    })
    .catch(next);
}

module.exports = {
  hasDashboardGlobalAuthority,
  requireDashboardGlobalAuthority,
};
