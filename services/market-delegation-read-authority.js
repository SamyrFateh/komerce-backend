/**
 * @komerce-arch-lite
 * @role market-scoped-read-capability-fallback
 * @domain market-delegation
 * @layer service
 * @owner backend-core
 * @purpose Grant read-only projections through an existing read capability without granting writer rights.
 * @depends services/market-delegation-service.js
 * @impact-areas market-authorization, dashboard
 */
'use strict';

async function resolveReadAuthority(resolveAuthorization, db, { userId, marketCode, primaryCapability, fallbackCapability }) {
  if (typeof resolveAuthorization !== 'function' || !primaryCapability || !fallbackCapability) {
    throw new TypeError('resolveReadAuthority requires a resolver and both capabilities');
  }
  try {
    return await resolveAuthorization(db, { userId, marketCode, requiredCapability: primaryCapability });
  } catch (error) {
    // Never bypass absent membership, inactive market, revoked assignment or suspended writer rights.
    if (!error || !['MARKET_CAPABILITY_REQUIRED', 'MARKET_CAPABILITY_OUTSIDE_CEILING'].includes(error.code)
      || error.status !== 403) throw error;
    return resolveAuthorization(db, { userId, marketCode, requiredCapability: fallbackCapability });
  }
}

// The central lens uses the same restricted read model, not a delegated
// membership and never a synthetic ACT/EXEC grant. A1: authenticated admin is
// central for READ; all other roles retain the delegated checks. Only the explicit GET call sites in CMU0_MATRIX opt in.
async function resolveCanonicalMarketRead(resolveAuthorization, executor, {
  userId, actorRole, marketCode, primaryCapability, fallbackCapability = null,
}) {
  const capabilities = ['team.read','network.read','client.read','catalog.read','finance.read','operations.read','market_config.read'];
  if (!capabilities.includes(primaryCapability)) throw new TypeError('canonical market READ capability required');
  if (actorRole === 'admin') {
    if (!userId) throw Object.assign(new Error('Authentication required'), {status:401,code:'AUTH_REQUIRED'});
    const row = await require('./market-delegation-service').resolveActiveAssignmentByMarketCode(executor, marketCode);
    return { ...row, membership_id: null, capabilities: [primaryCapability], canonical_central_read: true };
  }
  return fallbackCapability
    ? resolveReadAuthority(resolveAuthorization, executor, { userId, marketCode, primaryCapability, fallbackCapability })
    : resolveAuthorization(executor, { userId, marketCode, requiredCapability: primaryCapability });
}

module.exports = { resolveReadAuthority, resolveCanonicalMarketRead };
