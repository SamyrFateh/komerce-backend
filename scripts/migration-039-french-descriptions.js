/**
 * Migration 039 — RETIRED TOMBSTONE
 *
 * Historical behavior replayed `description_fr` from db/seed-products-v2.json
 * over active products. That dataset is no longer a canonical content source
 * and must never overwrite curated staging copy during application startup.
 *
 * The exported function intentionally remains for bootstrap compatibility:
 * startup-migrations.js may still invoke migration039(), but this hook is now
 * a deterministic no-op. Product copy is owned by explicit curated catalogue
 * tooling, not startup migrations.
 *
 * @retired 2026-09
 */

'use strict';

module.exports = async function migration039() {
  console.log('[Migration 039] retired — legacy description replay skipped');
};
