/**
 * @komerce-arch
 * @role golden-gate-kit
 * @domain admin-dashboard
 * @layer service
 * @criticality medium
 * @inputs gate_checks
 * @outputs fail_closed_gate_verdict
 * @depends none
 * @db-read none
 * @db-write none
 * @doctrine projection_only_no_business_authority
 * @impact-areas dashboard, e2e-certification
 * @version 2026-10
 */
'use strict';
const GATE = Object.freeze({
  PROVED: 'PROVED',
  NON_PROUVE: 'NON_PROUVE',
  ANOMALIE: 'ANOMALIE',
});


const rowsOf = (result) => (result && Array.isArray(result.rows) ? result.rows : []);

function check(key, ok, detail) {
  return { key, ok: Boolean(ok), detail: detail || null };
}

function settle({ key, label, link, expected, checks, anomalies = [], evidence = {}, nextAction, humanChecks = [] }) {
  const failed = checks.filter((c) => !c.ok);
  let status = GATE.PROVED;
  if (anomalies.length) status = GATE.ANOMALIE;
  else if (failed.length) status = GATE.NON_PROUVE;
  return {
    key,
    label,
    link,
    expected,
    status,
    checks,
    anomalies,
    evidence,
    human_checks: humanChecks,
    finding: status === GATE.PROVED
      ? 'Tous les faits canoniques attendus sont présents.'
      : (anomalies[0] || `Preuve manquante : ${failed.map((c) => c.key).join(', ')}`),
    next_action: status === GATE.PROVED ? 'Contrôle humain à l’écran réel (distinct de la preuve automatique).' : nextAction,
  };
}

function unproved(key, label, link, expected, reason, nextAction) {
  return settle({
    key, label, link, expected, nextAction,
    checks: [check(reason, false, 'preuve non lisible ou absente')],
  });
}

async function safeQuery(db, sql, params) {
  try {
    return { rows: rowsOf(await db.query(sql, params)), error: null };
  } catch (err) {
    return { rows: [], error: err.code || err.message || 'read_error' };
  }
}


module.exports = { GATE, rowsOf, check, settle, unproved, safeQuery };
