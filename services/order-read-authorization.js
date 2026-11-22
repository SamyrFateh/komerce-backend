/** @komerce-arch-lite
 * @role order-read-authorization
 * @domain orders
 * @layer service
 * @owner backend-core
 * @purpose Fail-closed order detail authorization for customer, relay and market scopes.
 * @db-read users, relais, markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, capability_registry
 * @db-write none
 * @impact-areas orders, security
 */
'use strict';

const db = require('../db');
const { listAuthorizedMarketsForCapability } = require('./market-delegation-service');

const sameId = (left, right) => left != null && right != null && String(left) === String(right);

async function resolveRelayId(actor, executor) {
  if (actor.relais_id) return actor.relais_id;
  const { rows: [user] } = await executor.query(
    'SELECT relais_id, phone FROM users WHERE id = $1', [actor.id]
  );
  if (user?.relais_id) return user.relais_id;
  if (!user?.phone) return null;
  const { rows: [relay] } = await executor.query(
    `SELECT r.id FROM relais r JOIN users u ON u.phone = r.phone
      WHERE u.id = $1 AND r.is_active = TRUE LIMIT 1`, [actor.id]
  );
  return relay?.id || null;
}

async function canReadOrder(actor, order, executor = db) {
  if (!actor?.id || !actor.role || !order?.id) return false;
  if (actor.role === 'admin' || actor.role === 'agent_hub') return true;
  if (actor.role === 'client') return sameId(actor.id, order.user_id);
  if (actor.role === 'agent_relais') {
    const relayId = await resolveRelayId(actor, executor);
    return sameId(relayId, order.relais_id);
  }
  if (actor.role === 'market_operator') {
    if (!order.market_id) return false;
    const grants = await listAuthorizedMarketsForCapability(executor, {
      userId: actor.id,
      requiredCapability: 'operations.read',
    });
    return grants.some(grant => sameId(grant.market_id, order.market_id));
  }
  return false;
}

module.exports = { canReadOrder };
