/**
 * @komerce-arch-lite
 * @role canonical-chromium-staging-coverage
 * @domain dashboard
 * @layer test-fixture
 * @owner backend-core
 * @purpose Rôles et dimensions des preuves (jamais l'autorité d'accès).
 * @impact-areas dashboard, market, staging-only
 */
'use strict';
const markets=['KM','CM','CG','DJ'];
const pages={
 admin:['/admin/pilotage','/admin/action-center','/admin/commerce','/admin/orders','/admin/operations','/admin/finance',
 '/admin/workspaces/pricing','/admin/workspaces/catalog','/admin/workspaces/sourcing','/admin/workspaces/purchasing',
 '/admin/workspaces/operations','/admin/workspaces/shipping-customs','/admin/workspaces/accounting',
 '/admin/import-runtime','/admin/hub-live','/admin/relais-live','/admin/clients','/admin/users','/admin/providers','/admin/settings',
 '/dashboards/canonical/access.html'],
 market_operator:['/admin/pilotage','/admin/commerce','/admin/orders','/admin/operations','/admin/finance',
 '/admin/workspaces/pricing','/admin/workspaces/operations','/admin/workspaces/shipping-customs',
 '/admin/workspaces/accounting','/dashboards/canonical/market-autonomy.html',
 '/dashboards/canonical/market-catalog.html'],
 finance:['/admin/workspaces/accounting'],
 sourcing:['/admin/import-runtime','/admin/workspaces/sourcing'],
 agent_hub:['/admin/workspaces/operations','/admin/workspaces/shipping-customs','/admin/hub-live'],
 agent_relais:['/admin/workspaces/operations','/admin/relais-live'],
 agent_transitaire:['/admin/workspaces/shipping-customs']
};
const dimensions=['lifecycle PROVISIONING/ACTIVE/SUSPENDED/CLOSED','readiness et activation',
 'délégation équipe, rôles et capabilities','catalogue global','exposition locale ENABLED/DISABLED',
 'LOCAL_ACTIVE prix et FX','checkout livraison et refus','commandes et Order 360',
 'achats, fournisseur, réception Hub','expédition douane relais','encaissement cash et settlements',
 'finance KPI, marge et contexte'];
const processes=['P1 produits','P2 commande et remise','P3 achats','P4 Hub et douane',
 'P5 paiement et cash','P6 coûts et marge','P7 marché'];
module.exports={markets,pages,dimensions,processes};
