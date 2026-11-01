'use strict';

/**
 * @test-kind helper
 * @test-runner jest
 * @test-requires postgres
 *
 * Outillage du test d'integration du reset Staging : base PostgreSQL ephemere (schema canonique + bootstrap CI),
 * insertion generique de lignes "sales" (colonnes obligatoires remplies par introspection, parents FK crees a la demande)
 * et empreinte de contenu de toutes les tables. Ne touche jamais la base de la suite : il cree sa propre base.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..');

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function createEphemeralDatabase(baseUrl) {
  const name = `komerce_reset_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = withDatabase(baseUrl, name);
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(fs.readFileSync(path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql'), 'utf8'));
  await c.end();
  const boot = spawnSync(process.execPath, ['scripts/ci-db-bootstrap.js'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' }, encoding: 'utf8',
  });
  if (boot.status !== 0) throw new Error(`ci-db-bootstrap failed: ${boot.stdout}\n${boot.stderr}`);
  const drop = async () => {
    const a = new Client({ connectionString: baseUrl });
    await a.connect();
    await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await a.end();
  };
  return { name, url, drop };
}

async function tableMeta(c, table) {
  const { rows: cols } = await c.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default, is_identity, is_generated, character_maximum_length
       FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
  const { rows: fks } = await c.query(
    `SELECT a.attname AS col, parent.relname AS parent, pa.attname AS parent_col
       FROM pg_constraint k
       JOIN pg_class child ON child.oid = k.conrelid AND child.relname = $1
       JOIN pg_class parent ON parent.oid = k.confrelid
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
      WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND child.relnamespace = 'public'::regnamespace`, [table]);
  return { cols, fks: Object.fromEntries(fks.map((f) => [f.col, f])) };
}

// Valeurs valides pour les CHECK de tables rencontrees (ligne cree directement ou comme parent FK).
const TABLE_DEFAULTS = Object.freeze({
  suppliers: { platform: 'local' },
  hub_physical_units: { unit_type: 'HANDLING_UNIT' },
  order_cost_entry_events: { event_type: 'manual_cost_entered' },
  wallet_transactions: { type: 'credit' },
  webauthn_challenges: { ceremony_type: 'login' },
  client_notifications: { entity_type: 'order' },
  financial_movements: { currency: 'EUR', direction: 'inflow', fx_status: 'unavailable', source_kind: 'sk', source_id: 'si', facet: 'f', movement_key: 'sk:si:f', state: 'observed' },
  customs_shipment_fees: { currency: 'EUR', fee_type: 'handling' },
  sourcing_sources: { acquisition: 'pull', continuity: 'recurring' },
  market_delivery_attestations: { valid_until: '2099-01-01T00:00:00Z', mode: 'SEA', rate_currency: 'EUR', rate_unit: 'PER_KG' },
  economic_structure_cost_events: { event_kind: 'ACCRUAL', currency: 'EUR', economic_from: '2026-01-01', economic_to: '2026-02-01', scope_kind: 'GROUP', source_kind: 'MANUAL' },
  operator_market_scopes: { revoked_at: '2026-01-01T00:00:00Z', role: 'viewer' },
  market_team_invitations: { expires_at: '2099-01-01T00:00:00Z', channel: 'EMAIL', email_normalized: 'invite@komerce.test', token_hash: 'a'.repeat(64) },
  market_cost_attributions: { event_kind: 'ATTRIBUTION' },
  orders: {
    relais_id: async (c) => (await c.query('SELECT id FROM relais ORDER BY created_at LIMIT 1')).rows[0]?.id
      || (await insertRow(c, 'relais')).id,
    market_id: async (c, v) => (await c.query('SELECT market_id FROM relais WHERE id = $1', [v.relais_id])).rows[0].market_id,
  },
  partners: { partner_type: 'relais_simple' },
  purchase_orders: { order_id: async (c) => (await insertRow(c, 'orders')).id, supplier_sku: 'SKU-FX', qty: 1 },
});

let counter = 0;
async function literalFor(c, col, table) {
  counter += 1;
  const t = col.data_type;
  if (t === 'uuid') return crypto.randomUUID();
  if (['text', 'character varying', 'character'].includes(t)) {
    const s = `fx-${table}-${col.column_name}-${counter}`;
    return col.character_maximum_length ? s.slice(-col.character_maximum_length) : s;
  }
  if (['integer', 'bigint', 'smallint', 'numeric', 'double precision', 'real'].includes(t)) return 1;
  if (t === 'boolean') return false;
  if (t.startsWith('timestamp') || t === 'date') return new Date().toISOString();
  if (t === 'jsonb' || t === 'json') return '{}';
  if (t === 'ARRAY') return '{}';
  if (t === 'USER-DEFINED') {
    const { rows } = await c.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid WHERE ty.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [col.udt_name]);
    if (rows[0]) return rows[0].enumlabel;
  }
  throw new Error(`no literal for ${table}.${col.column_name} (${t})`);
}

/** Insere une ligne en remplissant toutes les colonnes obligatoires ; cree (ou reutilise) les parents FK. Retourne la ligne. */
async function insertRow(c, table, overrides = {}, depth = 0) {
  if (depth > 6) throw new Error(`FK depth exceeded at ${table}`);
  const meta = await tableMeta(c, table);
  const values = { ...(TABLE_DEFAULTS[table] || {}), ...overrides };
  for (const k of Object.keys(values)) if (typeof values[k] === 'function') values[k] = await values[k](c, values);
  for (const col of meta.cols) {
    const name = col.column_name;
    if (name in values) continue;
    const required = col.is_nullable === 'NO' && col.column_default === null && col.is_identity === 'NO' && col.is_generated === 'NEVER';
    if (!required) continue;
    const fk = meta.fks[name];
    if (fk) {
      const { rows } = await c.query(`SELECT ${fk.parent_col} AS v FROM ${fk.parent} LIMIT 1`);
      values[name] = rows[0] ? rows[0].v : (await insertRow(c, fk.parent, {}, depth + 1))[fk.parent_col];
    } else values[name] = await literalFor(c, col, table);
  }
  const names = Object.keys(values);
  const sql = names.length
    ? `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`
    : `INSERT INTO ${table} DEFAULT VALUES RETURNING *`;
  const { rows } = await c.query(sql, names.map((n) => values[n]));
  return rows[0];
}

/** Empreinte (count + md5 du contenu) de CHAQUE table du schema public. */
async function fingerprintAll(c) {
  const { rows } = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  const out = {};
  for (const { tablename } of rows) {
    const { rows: [r] } = await c.query(
      `SELECT COUNT(*)::int AS n, COALESCE(md5(string_agg((to_jsonb(t) - 'updated_at')::text, '|' ORDER BY (to_jsonb(t) - 'updated_at')::text)), '') AS h FROM "${tablename}" t`);
    out[tablename] = `${r.n}:${r.h}`;
  }
  return out;
}

module.exports = { createEphemeralDatabase, insertRow, fingerprintAll, withDatabase, ROOT };
