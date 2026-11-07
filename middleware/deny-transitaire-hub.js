/**
 * @komerce-arch
 * @role          deny-transitaire-hub-scope
 * @domain        market-delegation
 * @layer         middleware
 * @criticality   high
 * @inputs        authenticated session role, persisted role
 * @outputs       403 or next
 * @depends       none
 * @db-read       none
 * @db-write      none
 * @doctrine      transit_role_never_enters_hub_live, persisted_role_wins_over_compat_projection
 */
'use strict';

// Le Transitaire central a accès à Expéditions & Douane uniquement.
// Une ancienne membership « Responsable pays » ne doit jamais
// requalifier agent_transitaire en market_operator sur le cockpit Hub.
function denyTransitaireHub(req, res, next) {
  const role = req.user && (req.user.persisted_role || req.user.role);
  if (role === 'agent_transitaire') {
    return res.status(403).json({
      code: 'HUB_TRANSITAIRE_SCOPE_DENIED',
      error: 'Le poste Transitaire ne donne pas accès au cockpit Hub.',
    });
  }
  return next();
}

module.exports = denyTransitaireHub;
