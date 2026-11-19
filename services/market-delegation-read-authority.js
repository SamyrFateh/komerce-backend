/**
 * @komerce-arch-lite
 * @role market-scoped-read-capability-fallback
 * @domain market-delegation
 * @layer service
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

module.exports = { resolveReadAuthority };
