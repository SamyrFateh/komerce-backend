'use strict';

/**
 * Rebuild a CI/test database from the schema-only canonical snapshot.
 *
 * Reference data is seeded both before and after migration reconciliation:
 * - before: migrations such as 237 may require canonical reference rows;
 * - after: if an older snapshot caused reference tables to be created by a
 *   pending migration, the final pass converges them to the canonical state.
 */

const { seedReferenceData } = require('./seed-reference-data');
const { main: migrate } = require('./ci-migrate');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ci-db-bootstrap is CI/test-only and must not run in production');
  }

  console.log('[ci-db-bootstrap] 1/3 reference data pre-seed');
  await seedReferenceData();

  console.log('[ci-db-bootstrap] 2/3 migration reconciliation');
  await migrate();

  console.log('[ci-db-bootstrap] 3/3 reference data convergence');
  await seedReferenceData();

  console.log('[ci-db-bootstrap] ✅ from-scratch database reconstructed');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[ci-db-bootstrap] ÉCHEC :', error.message);
      process.exit(1);
    });
}

module.exports = { main };
