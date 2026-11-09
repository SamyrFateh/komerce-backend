'use strict';

/**
 * Read-only navigation audit policy, limited to declared canonical redirects.
 * Source of truth: bootstrap/html-routes.js OPERATIONS_CANONICAL_ENTRYPOINTS.
 * These are not business authorizations and never whitelist auth 401/403.
 * ?legacy=1 intentionally keeps the legacy destination and is not redirected.
 */
const KNOWN_CANONICAL_ALIASES=Object.freeze({
  '/admin/orders-logistics':'/admin/operations',
  '/admin/hub-relais':'/admin/workspaces/operations',
  '/admin/inventory':'/admin/workspaces/operations',
});
function expectedPath(rawUrl,origin='https://komerce-backend-production.up.railway.app',options={}) {
  const url=new URL(rawUrl,origin);
  if(url.origin!==origin)throw new Error('OUT_OF_SCOPE_NAVIGATION_ORIGIN');
  if(url.searchParams.get('legacy')==='1')return url.pathname;
  // Le cockpit Sourcing Live remplace l'ancien workspace de sourcing pour
  // les acteurs autorisés. La redirection se fait après boot(), sans 302 HTTP.
  if(url.pathname==='/admin/workspaces/sourcing' && ['admin','sourcing'].includes(options.role))
    return '/admin/import-runtime';
  // L'ancien écran opérationnel est retiré par app.js::boot(), après résolution
  // du rôle. Ce redirect ne doit pas masquer un 403 sur la destination finale.
  if(url.pathname==='/admin/workspaces/operations') {
    const role=options.role;
    if(role==='agent_relais')return '/admin/relais-live';
    if(['admin','agent_hub','market_operator'].includes(role))return '/admin/hub-live';
  }
  return KNOWN_CANONICAL_ALIASES[url.pathname]||url.pathname;
}
module.exports={KNOWN_CANONICAL_ALIASES,expectedPath};
