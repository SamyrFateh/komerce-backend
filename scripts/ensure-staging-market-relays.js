#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          staging-market-relay-fixture
 * @domain        logistics
 * @layer         script
 * @owner         backend-core
 * @purpose       Canonicaliser les relais de recette CM/CG en vraies villes
 *                afin que le checkout multi-market ne réutilise jamais le
 *                vocabulaire insulaire KM pour les marchés XAF.
 * @impact-areas  staging-only, logistics, boutique, mobile-money
 */
'use strict';

const db = require('../db');
const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');

const PROFILES = Object.freeze({
  CM: Object.freeze({
    code: 'CM',
    city: 'Yaoundé',
    name: 'Relais Komerce Yaoundé Centre',
    address: 'Yaoundé Centre, Cameroun',
    phone: '+237600000001',
  }),
  CG: Object.freeze({
    code: 'CG',
    city: 'Brazzaville',
    name: 'Relais Komerce Brazzaville Centre',
    address: 'Brazzaville Centre, Congo',
    phone: '+242060000001',
  }),
});

function assertNonProduction() {
  const { env, source } = resolveRuntimeEnvironment();
  if (env === 'production') {
    throw new Error(`Refusé en production (${source})`);
  }
}

async function ensureMarket(code) {
  const { rows } = await db.query(
    'SELECT id, code, name FROM markets WHERE code = $1 LIMIT 1',
    [code]
  );
  if (!rows.length) throw new Error(`Marché ${code} introuvable`);
  return rows[0];
}

async function ensureCanonicalRelay(profile) {
  const market = await ensureMarket(profile.code);

  // On réutilise en priorité le relais canonique s'il existe. Sinon on recycle
  // uniquement une fixture SEEDTEST du même Market ID afin de préserver les FK
  // des commandes de recette déjà créées.
  const { rows: candidates } = await db.query(
    `SELECT id, name
       FROM relais
      WHERE market_id = $1
        AND (name = $2 OR name ILIKE 'SEEDTEST%')
      ORDER BY CASE WHEN name = $2 THEN 0 ELSE 1 END, id
      LIMIT 1`,
    [market.id, profile.name]
  );

  let relayId;
  if (candidates.length) {
    relayId = candidates[0].id;
    await db.query(
      `UPDATE relais
          SET name = $2,
              agent_name = 'Komerce Staging',
              phone = COALESCE(NULLIF(phone, ''), $3),
              address = $4,
              zone = $5,
              island = $5,
              is_active = TRUE
        WHERE id = $1
          AND market_id = $6`,
      [relayId, profile.name, profile.phone, profile.address, profile.city, market.id]
    );
  } else {
    const { rows: created } = await db.query(
      `INSERT INTO relais
         (name, agent_name, phone, address, zone, island, market_id, is_active)
       VALUES ($1, 'Komerce Staging', $2, $3, $4, $4, $5, TRUE)
       RETURNING id`,
      [profile.name, profile.phone, profile.address, profile.city, market.id]
    );
    relayId = created[0].id;
  }

  // Une ancienne fixture publique du même marché ne doit plus réapparaître
  // dans le picker. On la garde en base (pour les FK historiques) mais inactive.
  await db.query(
    `UPDATE relais
        SET is_active = FALSE
      WHERE market_id = $1
        AND id <> $2
        AND name ILIKE 'SEEDTEST%'`,
    [market.id, relayId]
  );

  return { market: profile.code, relayId, name: profile.name, city: profile.city };
}

async function main() {
  assertNonProduction();
  const results = [];
  for (const profile of Object.values(PROFILES)) {
    results.push(await ensureCanonicalRelay(profile));
  }
  results.forEach(result => {
    console.log(`[staging-relay] ${result.market}: ${result.name} — ${result.city}`);
  });
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[staging-relay] failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      try { await db.pool?.end?.(); } catch (_) {}
    });
}

module.exports = {
  PROFILES,
  assertNonProduction,
  ensureCanonicalRelay,
  main,
};
