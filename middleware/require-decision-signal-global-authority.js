/**
 * @komerce-arch
 * @role          decision-signal-global-authorization-guard
 * @domain        decision-signals
 * @layer         middleware
 * @criticality   high
 * @inputs        req.user.id, decision_signal_global_access_grants
 * @outputs       req.decisionSignalGlobalAuthority, next_or_403
 * @depends       db.js
 * @used-by       routes/admin-action-center.js
 * @db-read       decision_signal_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      decision_signal_global_authority_explicit, admin_role_never_implies_action_center_authority
 * @impact-areas  decision-signals, admin-dashboard, authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');

async function hasDecisionSignalGlobalAuthority(userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM decision_signal_global_access_grants
      WHERE user_id = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

function requireDecisionSignalGlobalAuthority(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
  if (req.decisionSignalGlobalAuthority === true) return next();

  return hasDecisionSignalGlobalAuthority(req.user.id)
    .then(allowed => {
      if (!allowed) {
        return res.status(403).json({
          error: 'Accès refusé — autorité globale Centre d’actions requise',
          code: 'decision_signal_global_access_denied',
        });
      }
      req.decisionSignalGlobalAuthority = true;
      return next();
    })
    .catch(next);
}

module.exports = {
  hasDecisionSignalGlobalAuthority,
  requireDecisionSignalGlobalAuthority,
};
