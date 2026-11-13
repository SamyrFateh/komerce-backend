/**
 * @komerce-arch-lite
 * @role staging-claude-par-3900-readonly-census
 * @domain hub-relay-chain
 * @layer tooling
 * @owner backend-core
 * @purpose Passe de certification #3900 en mode MANUAL : relire, en lecture seule, la provenance
 *          stockee (SCAN / MANUAL, manual_confirmation) des objets CLAUDE-PAR uniquement.
 * @db-read information_schema, orders, order_items, parcels, scans, physical_units, hub_box_bags
 * @db-write none
 */
'use strict';
// Lecture seule : PGOPTIONS default_transaction_read_only=on + BEGIN READ ONLY + garde statique du workflow.
// Aucun secret ni code de retrait n'est jamais affiche : toute cle contenant secret/hash/password/token
// est masquee, toute cle pickup* est reduite a un booleen de presence.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { confirmTarget } = require('./target-guard');

const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const OUTPUT = path.resolve('test-results/claude-par-3900/census.json');
const ORDER_REF = process.env.ORDER_REF || 'KC692IV';
const MARK = 'CLAUDE-PAR-20261113';

const report = { kind: 'CLAUDE_PAR_3900_READONLY', order_ref: ORDER_REF, generated_at: new Date().toISOString(),
  live_commit: null, sections: {}, errors: {} };

function mask(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (/(secret|hash|password|token)/i.test(k)) out[k] = v == null ? null : '[masque]';
    else if (/pickup/i.test(k) && !/(attempt|blocked|at$|_by$|status|state|collected|method)/i.test(k)) out[k] = v == null ? null : '[present]';
    else out[k] = v;
  }
  return out;
}
async function section(client, name, sql, params = [], opts = {}) {
  try {
    await client.query(`SAVEPOINT s_${name}`);
    const r = await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT s_${name}`);
    report.sections[name] = opts.raw ? r.rows : r.rows.map(mask);
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT s_${name}`).catch(() => {});
    report.errors[name] = String(e.message).slice(0, 300);
  }
}

async function main() {
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.STAGING_BASE_URL !== ORIGIN || !process.env.DATABASE_URL
    || !/default_transaction_read_only=on/.test(process.env.PGOPTIONS || '')) throw Error('STAGING_READONLY_CONFIGURATION_REQUIRED');
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 7000, query_timeout: 20000,
  });
  let tx = false;
  try {
    await client.connect();
    const verdict = await confirmTarget({ db: { query: (...a) => client.query(...a) },
      env: { ...process.env, EXPECTED_RAILWAY_ENVIRONMENT: 'staging' } });
    if (verdict.confirmed !== true) throw Error('TARGET_IDENTITY_UNVERIFIED');
    try { const v = await fetch(ORIGIN + '/health/version', { signal: AbortSignal.timeout(8000) });
      report.live_commit = String((await v.json()).commit || '').slice(0, 40) || null; } catch (_) {}
    await client.query('BEGIN READ ONLY'); tx = true;
    await client.query("SET LOCAL statement_timeout='15000ms'");
    if ((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only !== 'on') throw Error('READ_ONLY_NOT_ENFORCED');

    const O = '(SELECT id FROM orders WHERE reference = $1)';
    await section(client, 'tables_intl', `SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) AS cols
      FROM information_schema.columns WHERE table_schema='public'
       AND table_name ~ '(international|customs_shipments|document|invoice|receipt_doc|proof)'
      GROUP BY table_name ORDER BY table_name`, [], { raw: true });
    await section(client, 'order', `SELECT * FROM orders WHERE reference = $1`, [ORDER_REF]);
    await section(client, 'parcels', `SELECT * FROM parcels WHERE order_id = ${O}`, [ORDER_REF]);
    await section(client, 'units', `SELECT reference, unit_type, state, current_location_ref FROM hub_physical_units WHERE order_id = ${O} ORDER BY created_at`, [ORDER_REF]);
    await section(client, 'allocations', `SELECT a.id, a.purchase_order_id, a.quantity, a.supplier_order_identity, ps.code AS sku_code
      FROM hub_purchase_allocations a LEFT JOIN product_skus ps ON ps.id = a.product_sku_id WHERE a.order_id = ${O}`, [ORDER_REF]);
    await section(client, 'placements', `SELECT pl.operation_type, pl.quantity, pl.evidence_method, (pl.evidence_code IS NOT NULL) AS has_evidence_code, pl.evidence_ref, pl.placed_at, u.reference, u.unit_type
      FROM hub_physical_unit_placements pl JOIN hub_physical_units u ON u.id = pl.physical_unit_id
      WHERE pl.allocation_id IN (SELECT id FROM hub_purchase_allocations WHERE order_id = ${O}) ORDER BY pl.placed_at`, [ORDER_REF]);
    await section(client, 'custody_events', `SELECT e.event_type, e.from_state, e.to_state, e.operation_type, e.quantity, e.details, u.reference, e.created_at
      FROM hub_custody_events e JOIN hub_physical_units u ON u.id = e.physical_unit_id WHERE u.order_id = ${O} ORDER BY e.created_at`, [ORDER_REF]);
    await section(client, 'box_bags', `SELECT bb.bag_reference_scan, bb.box_reference_scan, bb.evidence_method, bb.evidence_ref, bb.linked_at
      FROM hub_box_bags bb WHERE bb.parcel_id IN (SELECT id FROM parcels WHERE order_id = ${O})`, [ORDER_REF]);
    await section(client, 'scan_events', `SELECT event_type, entry_mode, status, notes, metadata, (scan_code IS NOT NULL) AS has_scan_code, actor_role, created_at
      FROM scan_events WHERE order_id = ${O} OR parcel_id IN (SELECT id FROM parcels WHERE order_id = ${O}) ORDER BY created_at`, [ORDER_REF]);
    await section(client, 'scans', `SELECT step, pickup_method, authorization_version, document_checked, (scan_code IS NOT NULL) AS has_scan_code, notes, is_anomaly, created_at
      FROM scans WHERE order_id = ${O} ORDER BY created_at`, [ORDER_REF]);
    await section(client, 'parcel_events', `SELECT event_type, notes, metadata, created_at FROM parcel_events
      WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id = ${O}) ORDER BY created_at`, [ORDER_REF]);
    await section(client, 'relay_receipts', `SELECT r.expected_qty, r.received_qty, r.proof_ref, r.received_at, s.reference AS shipment
      FROM international_shipment_relay_receipts r LEFT JOIN international_shipments s ON s.id = r.shipment_id
      WHERE r.order_item_id IN (SELECT id FROM order_items WHERE order_id = ${O})`, [ORDER_REF]);
    await section(client, 'physical_codes', `SELECT code, code_type, trust, confirmation_proof_ref, confirmed_at FROM product_sku_physical_codes WHERE code LIKE 'CLPAR-%' ORDER BY confirmed_at`, []);
    await section(client, 'incidents', `SELECT incident_type, severity, status, title, created_at FROM incidents WHERE order_id = ${O}`, [ORDER_REF]);
    await section(client, 'pickup_codes_state', `SELECT (pickup_secret_hash IS NOT NULL) AS has_hash, pickup_secret_last4 IS NOT NULL AS has_last4, pickup_secret_attempts, pickup_secret_blocked_until, pickup_secret_revealed_at FROM orders WHERE reference = $1`, [ORDER_REF]);
    await section(client, 'sav', `SELECT * FROM relay_return_compensations WHERE order_id = ${O}`, [ORDER_REF]);

    await client.query('ROLLBACK'); tx = false;
  } catch (e) { report.fatal = String(e.message || e).slice(0, 300); process.exitCode = 1; }
  finally { if (tx) await client.query('ROLLBACK').catch(() => {}); await client.end().catch(() => {}); }
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ live_commit: report.live_commit, sections: Object.keys(report.sections), errors: report.errors, fatal: report.fatal || null }));
}
main();
