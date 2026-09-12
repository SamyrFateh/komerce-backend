/**
 * @komerce-arch
 * @role          staging-market-relay-seed
 * @domain        logistics
 * @layer         tooling
 * @criticality   low
 * @inputs        KOMERCE_ENV, markets CM/CG
 * @outputs       deterministic active staging relays for boutique checkout
 * @depends       db.js, middleware/require-non-production.js
 * @used-by       manual Railway staging operation
 * @db-read       markets, relais
 * @db-write      relais
 * @db-txn        write
 * @doctrine      staging_only, market_scoped_test_data, no_silent_fallback
 * @impact-areas  staging, boutique, checkout, mobile-money
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');

const RELAYS = Object.freeze([
  {
    id: '5eed0000-0000-4000-8000-000000000001',
    marketCode: 'CM',
    name: 'Relais Komerce Yaoundé Centre',
    phone: '+237600000001',
    address: 'Yaoundé Centre, Cameroun',
    zone: 'Yaoundé',
    latitude: 3.8480,
    longitude: 11.5021,
  },
  {
    id: '5eed0000-0000-4000-8000-000000000002',
    marketCode: 'CG',
    name: 'Relais Komerce Brazzaville Centre',
    phone: '+242060000001',
    address: 'Brazzaville Centre, République du Congo',
    zone: 'Brazzaville',
    latitude: -4.2634,
    longitude: 15.2429,
  },
]);

async function assertStaging() {
  const { env, source } = resolveRuntimeEnvironment();
  if (env !== 'staging') {
    throw new Error(`refus seed relais hors staging (${source}=${env || 'vide'})`);
  }
}

async function upsertRelay(fixture) {
  const { rows: markets } = await db.query(
    `SELECT id FROM markets WHERE code = $1 AND is_active = TRUE LIMIT 1`,
    [fixture.marketCode]
  );
  if (!markets.length) throw new Error(`marché ${fixture.marketCode} introuvable ou inactif`);
  const marketId = markets[0].id;

  const { rows: existing } = await db.query(
    `SELECT id FROM relais WHERE market_id = $1::uuid AND name = $2 LIMIT 1`,
    [marketId, fixture.name]
  );

  if (existing.length) {
    const { rows } = await db.query(
      `UPDATE relais
          SET phone = $2,
              address = $3,
              zone = $4,
              island = NULL,
              island_code = NULL,
              is_active = TRUE,
              latitude = $5,
              longitude = $6
        WHERE id = $1::uuid
        RETURNING id, market_id, name, zone, is_active`,
      [existing[0].id, fixture.phone, fixture.address, fixture.zone, fixture.latitude, fixture.longitude]
    );
    return rows[0];
  }

  const { rows } = await db.query(
    `INSERT INTO relais
       (id, market_id, name, agent_name, phone, address, zone, hours,
        island, island_code, is_active, latitude, longitude, photo_url)
     VALUES
       ($1::uuid, $2::uuid, $3, NULL, $4, $5, $6, NULL,
        NULL, NULL, TRUE, $7, $8, NULL)
     ON CONFLICT (id) DO UPDATE SET
       market_id = EXCLUDED.market_id,
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       address = EXCLUDED.address,
       zone = EXCLUDED.zone,
       island = NULL,
       island_code = NULL,
       is_active = TRUE,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude
     RETURNING id, market_id, name, zone, is_active`,
    [fixture.id, marketId, fixture.name, fixture.phone, fixture.address, fixture.zone,
      fixture.latitude, fixture.longitude]
  );
  return rows[0];
}

async function seedStagingMarketRelays() {
  await assertStaging();
  const written = [];
  for (const fixture of RELAYS) written.push(await upsertRelay(fixture));
  return written;
}

async function runCli() {
  const rows = await seedStagingMarketRelays();
  console.log(`[seed:market-relays] PASS ${rows.length} relais staging actifs (CM/CG)`);
}

if (require.main === module) {
  runCli()
    .catch(err => {
      console.error('[seed:market-relays] FAIL', err.message);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = { RELAYS, assertStaging, seedStagingMarketRelays };
