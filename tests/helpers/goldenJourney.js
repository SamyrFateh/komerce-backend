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

const PROGRESSIVE_BOUNDARIES = Object.freeze([
  'HUB_INBOUND',
  'CUSTOMS',
  'RELAY_AVAILABLE',
  'CUSTOMER_HANDOFF',
  'FINANCIAL_CLOSE',
]);

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

function nextGoldenBoundary(projection) {
  const steps = Array.isArray(projection && projection.steps) ? projection.steps : [];
  for (const key of PROGRESSIVE_BOUNDARIES) {
    const step = steps.find(candidate => candidate.key === key);
    if (step && !step.passed) return step;
  }
  return null;
}

async function inspectGoldenJourney(db, reference) {
  const projection = await projectGoldenJourney(db, reference);
  return {
    projection,
    next: nextGoldenBoundary(projection),
    complete: !nextGoldenBoundary(projection),
  };
}

module.exports = {
  PROGRESSIVE_BOUNDARIES,
  assertGoldenReference,
  resolveGoldenOrder,
  projectGoldenJourney,
  nextGoldenBoundary,
  inspectGoldenJourney,
};
