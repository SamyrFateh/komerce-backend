/**
 * @komerce-arch-lite
 * @role local-interactive-staging-domain-catalog
 * @domain dashboard
 * @layer test-fixture
 * @owner backend-core
 * @purpose UI-only domain routes, never a substitute for P1-P7 business certification.
 * @impact-areas dashboard, staging-only
 */
'use strict';
const {pages}=require('../staging-canonical/matrix');

// Every entry is an existing canonical route from the full Chromium matrix.
// "raffinerie" and "publication" inspect available surfaces; they do NOT
// exercise ingestion, supplier purchase, product publication or payments.
const DOMAINS=Object.freeze({
  pilotage:Object.freeze(['/admin/pilotage','/admin/action-center']),
  commerce:Object.freeze(['/admin/commerce']),
  commandes:Object.freeze(['/admin/orders']),
  sourcing:Object.freeze(['/admin/workspaces/sourcing','/admin/import-runtime']),
  raffinerie:Object.freeze(['/admin/import-runtime']),
  catalogue:Object.freeze(['/admin/workspaces/catalog','/dashboards/canonical/market-catalog.html']),
  publication:Object.freeze(['/admin/workspaces/catalog','/dashboards/canonical/market-catalog.html']),
  prix:Object.freeze(['/admin/workspaces/pricing']),
  operations:Object.freeze(['/admin/operations','/admin/workspaces/operations','/admin/hub-live','/admin/relais-live']),
  transit:Object.freeze(['/admin/workspaces/shipping-customs']),
  finance:Object.freeze(['/admin/finance','/admin/workspaces/accounting']),
  marches:Object.freeze(['/dashboards/canonical/market-autonomy.html','/dashboards/canonical/access.html']),
  administration:Object.freeze(['/admin/clients','/admin/users','/admin/providers','/admin/settings']),
});

function interactiveRoutes(role,domain='all'){
  if(!Object.prototype.hasOwnProperty.call(pages,role))throw Error('UNKNOWN_E2E_ROLE');
  if(domain!=='all'&&!Object.prototype.hasOwnProperty.call(DOMAINS,domain))throw Error('UNKNOWN_E2E_DOMAIN');
  const names=domain==='all'?Object.keys(DOMAINS):[domain];
  const allowed=new Set(pages[role]);
  return names.flatMap(name=>DOMAINS[name]
    .filter(route=>allowed.has(route))
    .map(route=>({domain:name,route})));
}
module.exports={DOMAINS,interactiveRoutes};
