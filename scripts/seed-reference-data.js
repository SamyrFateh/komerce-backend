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
  // Migration 310 : marché préparé uniquement. Le seeding CI ne l'active jamais.
  Object.freeze({ code: 'DJ', name: 'Djibouti', currency: 'DJF', minor_unit: 0, is_active: false }),
]);

// Données de référence déterministes de migrations/142_currency_parities.sql.
// Le snapshot schema-only conserve la table mais pas ces lignes historiques.
const FIXED_CURRENCY_PARITIES = Object.freeze([
  Object.freeze({ currency: 'EUR', eur_rate: 1, source_note: 'Référence — identité, pas un ancrage' }),
  Object.freeze({ currency: 'KMF', eur_rate: 491.96775, source_note: 'Ancrage comorien, garanti Trésor français, en vigueur depuis 1999' }),
  Object.freeze({ currency: 'XAF', eur_rate: 655.957, source_note: 'Franc CFA d’Afrique centrale (CEMAC), garanti Trésor français' }),
]);
// Parités officielles FIXES des migrations 311/314, pas des taux de marché.
// Le snapshot CI est schema-only et ne conserve pas ces INSERT historiques.
// Ne JAMAIS préremplir EUR/USD : observation humaine approuvée obligatoire.
const OFFICIAL_FX_PEGS = Object.freeze([
  Object.freeze({
    quote_ccy: 'DJF', rate: 177.721,
    source_label: 'Banque centrale de Djibouti — parité officielle 177,721 DJF pour 1 USD',
    source_ref: 'https://en.wikipedia.org/wiki/Djiboutian_franc',
    valid_from: '2000-01-01T00:00:00Z',
  }),
  Object.freeze({
    quote_ccy: 'AED', rate: 3.6725,
    source_label: 'Central Bank of the UAE — parité officielle 3,6725 AED pour 1 USD (depuis 1997)',
    source_ref: 'CBUAE — peg AED/USD',
    valid_from: '2000-01-01T00:00:00Z',
  }),
]);

async function tableExists(client, tableName) {
  const { rows: [row] } = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [`public.${tableName}`]
  );
  return row?.present === true;
}

async function columnExists(client, tableName, columnName) {
  const { rows: [row] } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS present`,
    [tableName, columnName]
  );
  return row?.present === true;
}

async function seedMarkets(client) {
  if (!(await tableExists(client, 'markets'))) return { skipped: true, count: 0 };

  const withLifecycle = await columnExists(client, 'markets', 'lifecycle_status');

  for (const market of REFERENCE_MARKETS) {
    if (withLifecycle) {
      const lifecycleStatus = market.is_active ? 'ACTIVE' : 'PROVISIONING';
      await client.query(
        `INSERT INTO markets (code, name, currency, minor_unit, is_active, lifecycle_status)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           currency = EXCLUDED.currency,
           minor_unit = EXCLUDED.minor_unit,
           is_active = EXCLUDED.is_active,
           lifecycle_status = EXCLUDED.lifecycle_status`,
        [market.code, market.name, market.currency, market.minor_unit, market.is_active, lifecycleStatus]
      );
      continue;
    }

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

/**
 * Restaure uniquement les pegs officiels de migrations 311/314 dans une CI
 * reconstruite depuis le snapshot schema-only. N'effectue jamais d'UPDATE,
 * ne crée aucune observation EUR/USD et respecte le caractère append-only.
 * La passe pre-migration est ignorée si la contrainte multi-devises n'existe
 * pas encore ; ci-db-bootstrap relance le seed après les migrations.
 */
async function seedFxPegs(client) {
  if (!(await tableExists(client, 'fx_pegs'))) return { skipped: true, count: 0 };
  const { rows: [constraint] } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.fx_pegs'::regclass
          AND conname = 'fx_peg_unique_quote_valid_from'
     ) AS present`
  );
  if (!constraint?.present) return { skipped: true, count: 0 };

  let count = 0;
  for (const peg of OFFICIAL_FX_PEGS) {
    const { rowCount } = await client.query(
      `INSERT INTO fx_pegs (quote_ccy, rate, source_label, source_ref, valid_from)
       SELECT $1, $2, $3, $4, $5::timestamptz
       WHERE NOT EXISTS (SELECT 1 FROM fx_pegs WHERE quote_ccy = $1)
       ON CONFLICT (quote_ccy, valid_from) DO NOTHING`,
      [peg.quote_ccy, peg.rate, peg.source_label, peg.source_ref, peg.valid_from]
    );
    count += rowCount;
  }
  return { skipped: false, count };
}

async function seedCapabilities(client) {
  if (!(await tableExists(client, 'capability_registry'))) return { skipped: true, count: 0 };

  // Le pré-seed de ci-db-bootstrap s'exécute AVANT les migrations : effect et amount_bearing
  // (migration 270) peuvent ne pas exister encore. La passe finale, après migrations, les écrit.
  const withEffect = await columnExists(client, 'capability_registry', 'effect')
    && await columnExists(client, 'capability_registry', 'amount_bearing');

  for (const row of CAPABILITIES) {
    const columns = ['capability', 'class', 'domain', 'authority_scope', 'delegation_mode', 'requires_audit', 'status'];
    const values = [
      row.capability, row.class, row.domain, row.authority_scope, row.delegation_mode, row.requires_audit, row.status,
    ];
    if (withEffect) {
      columns.push('effect', 'amount_bearing');
      values.push(row.effect, row.amount_bearing);
    }
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
    const updates = columns.filter(column => column !== 'capability')
      .map(column => `${column} = EXCLUDED.${column}`).join(',\n         ');
    await client.query(
      `INSERT INTO capability_registry
         (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (capability) DO UPDATE SET
         ${updates},
         updated_at = NOW()`,
      values
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

// finance_config est un singleton (id=1) normalement instancié par
// bootstrap/startup-migrations.js au démarrage réel du serveur (migration
// 049, colonnes à leurs valeurs par défaut du schéma). La reconstruction
// from-scratch CI ne passe jamais par ce démarrage — les E2E montent
// l'app Express directement depuis routes/ — donc sans ce seed la ligne
// id=1 n'existe simplement pas, et tout ce qui en dépend (taux EUR/AED via
// utils/rates.js, finance_config lui-même) échoue. Volontairement un
// simple INSERT ... ON CONFLICT DO NOTHING (comme la migration 049) : on ne
// touche jamais une ligne déjà là, les valeurs viennent des DEFAULT de la
// colonne, jamais dupliquées ici.
async function seedFinanceConfig(client) {
  if (!(await tableExists(client, 'finance_config'))) return { skipped: true, count: 0 };

  const { rowCount } = await client.query(
    `INSERT INTO finance_config (id) VALUES (1) ON CONFLICT DO NOTHING`
  );
  return { skipped: false, count: rowCount };
}

async function seedReferenceData(client) {
  const ownClient = !client;
  const connection = client || await db.getClient();
  try {
    const markets = await seedMarkets(connection);
    const currencyParities = await seedCurrencyParities(connection);
    const fxPegs = await seedFxPegs(connection);
    const capabilities = await seedCapabilities(connection);
    const templateId = await ensureCurrentCeilingTemplate(connection);
    const ceiling = await seedCeilingCapabilities(connection, templateId);
    const financeConfig = await seedFinanceConfig(connection);
    return { markets, currencyParities, fxPegs, capabilities, ceiling, templateId, financeConfig };
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
    `[seed-reference-data] markets=${result.markets.count}, currency_parities=${result.currencyParities.count}, fx_pegs=${result.fxPegs.count}, capabilities=${result.capabilities.count}, ceiling=${result.ceiling.count}`
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
  OFFICIAL_FX_PEGS,
  seedReferenceData,
  seedMarkets,
  seedCurrencyParities,
  seedFxPegs,
  seedCapabilities,
  ensureCurrentCeilingTemplate,
  seedCeilingCapabilities,
};
