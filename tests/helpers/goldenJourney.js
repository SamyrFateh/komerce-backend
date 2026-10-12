'use strict';

/**
 * @test-kind helper
 * @test-runner jest
 * @test-requires postgres
 *
 * Shared Golden journey seam.
 * Business truth stays in canonical tables/reconcilers; this helper only
 * resolves the Golden order and exposes the same projection as the cockpit.
 */

const { projectGoldenEvidence } = require('../../services/golden-e2e-cockpit');

function assertGoldenReference(reference) {
  if (!/^K-GOLDEN-/i.test(String(reference || ''))) {
    throw new Error('Golden journey requires a K-GOLDEN-* reference');
  }
}

async function resolveGoldenOrder(db, reference) {
  assertGoldenReference(reference);
  const result = await db.query(
    'SELECT * FROM orders WHERE UPPER(reference) = UPPER($1) LIMIT 1',
    [reference]
  );
  const order = result.rows[0] || null;
  if (!order) throw new Error('Golden order not found: ' + reference);
  return order;
}

async function projectGoldenJourney(db, reference) {
  const order = await resolveGoldenOrder(db, reference);
  return projectGoldenEvidence(db, order);
}

module.exports = {
  assertGoldenReference,
  resolveGoldenOrder,
  projectGoldenJourney,
};
