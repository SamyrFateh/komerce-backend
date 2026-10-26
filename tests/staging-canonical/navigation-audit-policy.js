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
function expectedPath(rawUrl,origin='https://komerce-backend-production.up.railway.app') {
  const url=new URL(rawUrl,origin);
  if(url.origin!==origin)throw new Error('OUT_OF_SCOPE_NAVIGATION_ORIGIN');
  if(url.searchParams.get('legacy')==='1')return url.pathname;
  return KNOWN_CANONICAL_ALIASES[url.pathname]||url.pathname;
}
module.exports={KNOWN_CANONICAL_ALIASES,expectedPath};
