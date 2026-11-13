/**
 * @komerce-arch
 * @role          pickup-agent-lockout
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        client, user
 * @outputs       lockout_state
 * @depends       db.js
 * @used-by       services/pickup-collection-service.js
 * @db-read       pickup_collect_failures, users
 * @db-write      pickup_collect_failures
 * @db-txn        compatible_with_caller
 * @doctrine      brute_force_guard
 * @impact-areas  logistics, security
 * @version       2026-11
 */
'use strict';

/**
 * #3900 R2 — anti-bruteforce du retrait par code sans commande désignée.
 * Clé = agent ET relais (relais lu sur users). Choix : par agent (et non par
 * relais seul) pour qu'un agent qui devine ne puisse pas verrouiller ses
 * collègues du même relais (déni de service) ; le relais fait partie de la
 * clé pour qu'un changement de relais ne remette pas le compteur à zéro.
 */
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

/** { locked, retryAfterMin } — à appeler en début de transaction. */
async function checkAgentLockout(client, user) {
  if (!user?.id) return { locked: false };
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pickup_fail:${user.id}`]);
  const { rows } = await client.query(
    `SELECT created_at FROM pickup_collect_failures
      WHERE agent_id = $1
        AND relais_id IS NOT DISTINCT FROM (SELECT relais_id FROM users WHERE id = $1)
        AND created_at > NOW() - make_interval(mins => $2)
      ORDER BY created_at DESC LIMIT $3`,
    [user.id, WINDOW_MINUTES, MAX_FAILURES]
  );
  if (!rows || rows.length < MAX_FAILURES) return { locked: false };
  const oldest = new Date(rows[rows.length - 1].created_at);
  const until = new Date(oldest.getTime() + WINDOW_MINUTES * 60 * 1000);
  const retryAfterMin = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return { locked: true, retryAfterMin, blockedUntil: until };
}

/** Enregistre un échec ; renvoie { count, justLocked }. */
async function recordAgentFailure(client, user) {
  if (!user?.id) return { count: 0, justLocked: false };
  await client.query(
    `INSERT INTO pickup_collect_failures (agent_id, relais_id)
     SELECT $1, relais_id FROM users WHERE id = $1`,
    [user.id]
  );
  const { rows: [c] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM pickup_collect_failures
      WHERE agent_id = $1
        AND relais_id IS NOT DISTINCT FROM (SELECT relais_id FROM users WHERE id = $1)
        AND created_at > NOW() - make_interval(mins => $2)`,
    [user.id, WINDOW_MINUTES]
  );
  const count = c?.n || 0;
  return { count, justLocked: count === MAX_FAILURES };
}

module.exports = { checkAgentLockout, recordAgentFailure, MAX_FAILURES, WINDOW_MINUTES };
