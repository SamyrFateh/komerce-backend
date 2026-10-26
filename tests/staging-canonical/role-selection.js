'use strict';

/**
 * Shared Chromium staging profile selection.
 * A baseline run certifies only Admin and Responsable pays while remaining
 * explicit that the five other roles are NOT_PROVEN.
 */
const ALL_ROLES=Object.freeze([
  'admin','market_operator','finance','sourcing',
  'agent_hub','agent_relais','agent_transitaire'
]);
const BASELINE_ROLES=Object.freeze(['admin','market_operator']);
function selectedRoles(raw='all') {
  const mode=String(raw||'all').trim().toLowerCase();
  if(mode==='admin')return ['admin'];
  if(mode==='baseline')return [...BASELINE_ROLES];
  if(mode==='all')return [...ALL_ROLES];
  throw new Error('INVALID_E2E_AUDIT_ROLES: admin, baseline or all only');
}
module.exports={ALL_ROLES,BASELINE_ROLES,selectedRoles};
