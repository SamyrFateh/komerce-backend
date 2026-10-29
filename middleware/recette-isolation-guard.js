/**
 * @komerce-arch
 * @role          isolated-recette-write-firewall
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   high
 * @db-read       none
 * @db-write      none
 * @doctrine      no_live_payments, no_real_notifications, narrow_sourcing_catalog_pricing_writes
 */
'use strict';

/**
 * Deny every mutation by default in the isolated public-preview environment.
 * The only allowed writes are operator corrections in Sourcing/Catalogue/
 * Pricing and login. These still pass through normal auth/authorization.
 * Unknown endpoints fail closed. Real app environments are not affected.
 */
function recetteIsolationGuard(req, res, next) {
  if (process.env.KOMERCE_RECETTE_ISOLATED !== 'true') return next();
  const method=String(req.method||'GET').toUpperCase();
  if (['GET','HEAD','OPTIONS'].includes(method)) return next();
  const path=String(req.path||req.url||'');
  if (method==='POST' && /^\/api\/auth\/login\/?$/.test(path)) return next();
  if (/^\/api\/admin\/workspaces\/(catalog|sourcing|pricing)\//.test(path)) return next();
  return res.status(403).json({
    code:'RECETTE_MUTATION_BLOCKED',
    error:'Recette isolée : paiements, commandes, notifications et mutations non autorisées sont désactivés',
  });
}
module.exports={recetteIsolationGuard};
