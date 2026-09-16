'use strict';

/**
 * KOMERCE — CI/test reference-data reconstruction.
 *
 * The canonical Railway snapshot is intentionally schema-only. That means
 * reference rows historically introduced by migrations are not present when
 * CI rebuilds PostgreSQL from docs/db/railway-live-schema.sql. This script
 * restores only deterministic reference data required for a faithful
 * from-scratch runtime. It is idempotent and never copies business data.
 *
 * IMPORTANT: this is a CI/test reconstruction primitive, not a production
 * seeder. Production remains migration-driven.
 */

const db = require('../db');
const { CAPABILITIES } = require('../config/market-delegation-capabilities');

const REFERENCE_MARKETS = Object.freeze([
  Object.freeze({ code: 'KM', name: 'Comores', currency: 'KMF', minor_unit: 0, is_active: true }),
  Object.freeze({ code: 'YT', name: 'Mayotte', currency: 'EUR', minor_unit: 2, is_active: true }),
  Object.freeze({ code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0, is_active: true }),
  Object.freeze({ code: 'CG', name: 'Congo', currency: 'XAF', minor_unit: 0, is_active: true }),
]);

// Données de référence déterministes de migrations/142_currency_parities.sql.
// Le snapshot schema-only conserve la table mais pas ces lignes historiques.
const FIXED_CURRENCY_PARITIES = Object.freeze([
  Object.freeze({ currency: 'EUR', eur_rate: 1, source_note: 'Référence — identité, pas un ancrage' }),
  Object.freeze({ currency: 'KMF', eur_rate: 491.96775, source_note: 'Ancrage comorien, garanti Trésor français, en vigueur depuis 1999' }),
  Object.freeze({ currency: 'XAF', eur_rate: 655.957, source_note: 'Franc CFA d’Afrique centrale (CEMAC), garanti Trésor français' }),
]);

async function tableExists(client, tableName) {
  const { rows: [row] } = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [`public.${tableName}`]
  );
  return row?.present === true;
}

async function seedMarkets(client) {
  if (!(await tableExists(client, 'markets'))) return { skipped: true, count: 0 };

  for (const market of REFERENCE_MARKETS) {
    await client.query(
      `INSERT INTO markets (code, name, currency, minor_unit, is_active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         currency = EXCLUDED.currency,
         minor_unit = EXCLUDED.minor_unit,
         is_active = EXCLUDED.is_active`,
      [market.code, market.name, market.currency, market.minor_unit, market.is_active]
    );
  }
  return { skipped: false, count: REFERENCE_MARKETS.length };
}

async function seedCurrencyParities(client) {
  if (!(await tableExists(client, 'currency_parities'))) return { skipped: true, count: 0 };

  for (const parity of FIXED_CURRENCY_PARITIES) {
    await client.query(
      `INSERT INTO currency_parities (currency, eur_rate, source_note)
       VALUES ($1,$2,$3)
       ON CONFLICT (currency) DO UPDATE SET
         eur_rate = EXCLUDED.eur_rate,
         source_note = EXCLUDED.source_note,
         updated_at = NOW()`,
      [parity.currency, parity.eur_rate, parity.source_note]
    );
  }
  return { skipped: false, count: FIXED_CURRENCY_PARITIES.length };
}

async function seedCapabilities(client) {
  if (!(await tableExists(client, 'capability_registry'))) return { skipped: true, count: 0 };

  for (const row of CAPABILITIES) {
    await client.query(
      `INSERT INTO capability_registry
         (capability, class, domain, authority_scope, delegation_mode, requires_audit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (capability) DO UPDATE SET
         class = EXCLUDED.class,
         domain = EXCLUDED.domain,
         authority_scope = EXCLUDED.authority_scope,
         delegation_mode = EXCLUDED.delegation_mode,
         requires_audit = EXCLUDED.requires_audit,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [
        row.capability,
        row.class,
        row.domain,
        row.authority_scope,
        row.delegation_mode,
        row.requires_audit,
        row.status,
      ]
    );
  }
  return { skipped: false, count: CAPABILITIES.length };
}

async function ensureCurrentCeilingTemplate(client) {
  if (!(await tableExists(client, 'ceiling_templates'))) return null;

  const { rows: current } = await client.query(
    `SELECT id FROM ceiling_templates WHERE is_current = TRUE ORDER BY version DESC LIMIT 1`
  );
  if (current[0]) return current[0].id;

  const { rows } = await client.query(
    `INSERT INTO ceiling_templates (name, version, is_current)
     VALUES ('market-operator-default', 1, TRUE)
     ON CONFLICT (name, version) DO UPDATE SET is_current = TRUE
     RETURNING id`
  );
  return rows[0]?.id || null;
}

async function seedCeilingCapabilities(client, templateId) {
  if (!templateId) return { skipped: true, count: 0 };
  if (!(await tableExists(client, 'ceiling_template_capabilities'))) return { skipped: true, count: 0 };

  const eligible = CAPABILITIES.filter((row) =>
    row.authority_scope === 'MARKET'
    && row.delegation_mode === 'DELEGABLE'
    && (row.class === 'DELEGATION' || (row.class === 'EXECUTION' && row.status === 'LIVE'))
  );

  for (const row of eligible) {
    await client.query(
      `INSERT INTO ceiling_template_capabilities (template_id, capability)
       VALUES ($1::uuid,$2)
       ON CONFLICT DO NOTHING`,
      [templateId, row.capability]
    );
  }
  return { skipped: false, count: eligible.length };
}

async function seedReferenceData(client) {
  const ownClient = !client;
  const connection = client || await db.getClient();
  try {
    const markets = await seedMarkets(connection);
    const currencyParities = await seedCurrencyParities(connection);
    const capabilities = await seedCapabilities(connection);
    const templateId = await ensureCurrentCeilingTemplate(connection);
    const ceiling = await seedCeilingCapabilities(connection, templateId);
    return { markets, currencyParities, capabilities, ceiling, templateId };
  } finally {
    if (ownClient) connection.release();
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-reference-data is CI/test-only and must not run in production');
  }
  const result = await seedReferenceData();
  console.log(
    `[seed-reference-data] markets=${result.markets.count}, currency_parities=${result.currencyParities.count}, capabilities=${result.capabilities.count}, ceiling=${result.ceiling.count}`
  );
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[seed-reference-data] ÉCHEC :', error.message);
      process.exit(1);
    });
}

module.exports = {
  REFERENCE_MARKETS,
  FIXED_CURRENCY_PARITIES,
  seedReferenceData,
  seedMarkets,
  seedCurrencyParities,
  seedCapabilities,
  ensureCurrentCeilingTemplate,
  seedCeilingCapabilities,
};
