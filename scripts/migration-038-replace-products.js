/**
 * Migration 038 — RETIRED TOMBSTONE
 *
 * Historical behavior replaced the whole product catalog from
 * db/seed-products-v2.json. That dataset is no longer a canonical staging
 * source and must never be replayed on a fresh/rebuilt database.
 *
 * The exported function intentionally remains for bootstrap compatibility:
 * startup-migrations.js may still invoke migration038(db), but this hook is
 * now a deterministic no-op. Catalogue population belongs to explicit,
 * curated staging tooling (`scripts/showcase-catalog.js` and market seeds),
 * never to application startup.
 *
 * @retired 2026-09
 */

'use strict';

module.exports = async function migration038() {
  console.log('  Migration 038: retired — legacy catalog replacement skipped');
};
