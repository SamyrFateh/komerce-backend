/**
 * @komerce-arch
 * @role          providers-services-status-mutation-service
 * @domain        providers-services
 * @layer         service
 * @criticality   high
 * @inputs        provider_id, market_id, target_status, db_or_transaction_executor
 * @outputs       updated provider row
 * @depends       none (executor fourni par l'appelant)
 * @used-by       services/market-delegation-provider-service.js
 * @db-read       none
 * @db-write      providers
 * @db-txn        caller_transaction_preserved
 * @doctrine      lifecycle_owner_write_boundary, provider_market_is_immutable
 * @impact-areas  providers-services, market-delegation
 * @version       2026-09
 */
'use strict';

const ALLOWED_STATUS = new Set(['pending', 'active', 'suspended']);

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('provider-status-mutation-service: executor.query requis');
  }
  return executor;
}

async function setOwnedProviderStatus(executor, { providerId, marketId, status }) {
  const db = requireExecutor(executor);
  if (!providerId || !marketId) throw new TypeError('providerId et marketId requis');
  if (!ALLOWED_STATUS.has(status)) {
    const error = new Error(`statut provider invalide (${status})`);
    error.code = 'PROVIDER_STATUS_INVALID';
    error.status = 400;
    throw error;
  }

  const { rows } = await db.query(
    `UPDATE providers
        SET status = $3, updated_at = NOW()
      WHERE id = $1
        AND market_id = $2
      RETURNING id, name, phone, market_id, status, public_phone, public_whatsapp, created_at, updated_at`,
    [providerId, marketId, status]
  );
  return rows[0] || null;
}

module.exports = { setOwnedProviderStatus };
