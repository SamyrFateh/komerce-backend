/**
 * @komerce-arch
 * @role          catalog-global-authorization-guard
 * @domain        catalog
 * @layer         middleware
 * @criticality   high
 * @inputs        req.user.id, catalog_global_access_grants
 * @outputs       req.catalogGlobalAuthority, next_or_403
 * @depends       db.js
 * @used-by       routes/admin-catalog-workspace.js
 * @db-read       catalog_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      catalog_global_authority_explicit, admin_role_never_implies_catalog_write
 * @impact-areas  catalog, admin-dashboard, authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

async function hasCatalogGlobalAuthority(userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM catalog_global_access_grants
      WHERE user_id = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

function requireCatalogGlobalAuthority(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  if (req.catalogGlobalAuthority === true) return next();

  return hasCatalogGlobalAuthority(req.user.id)
    .then(allowed => {
      if (!allowed) {
        return res.status(403).json({
          error: 'Accès refusé — autorité catalogue globale requise',
          code: 'catalog_global_access_denied',
        });
      }
      req.catalogGlobalAuthority = true;
      next();
    })
    .catch(next);
}

module.exports = {
  hasCatalogGlobalAuthority,
  requireCatalogGlobalAuthority,
};
