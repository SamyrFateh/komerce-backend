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
const ORDER_REFS = (process.env.ORDER_REFS || 'KC692IV,K047L9E,KI98LBZ,K7TIXBV').split(',').map(x => x.trim()).filter(Boolean);
const MARK = 'CLAUDE-PAR-20261113';

const report = { kind: 'CLAUDE_PAR_3900_READONLY', order_refs: ORDER_REFS, generated_at: new Date().toISOString(),
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
    for (const REF of ORDER_REFS) {
      await section(client, 'tables_intl', `SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) AS cols
        FROM information_schema.columns WHERE table_schema='public'
         AND table_name ~ '(international|customs_shipments|document|invoice|receipt_doc|proof)'
        GROUP BY table_name ORDER BY table_name`, [], { raw: true });
      await section(client, REF + '_order', `SELECT * FROM orders WHERE reference = $1`, [REF]);
      await section(client, REF + '_parcels', `SELECT * FROM parcels WHERE order_id = ${O}`, [REF]);
      await section(client, REF + '_units', `SELECT reference, unit_type, state, current_location_ref FROM hub_physical_units WHERE order_id = ${O} ORDER BY created_at`, [REF]);
      await section(client, REF + '_allocations', `SELECT a.id, a.purchase_order_id, a.quantity, a.supplier_order_identity, a.product_sku_id
        FROM hub_purchase_allocations a WHERE a.order_id = ${O}`, [REF]);
      await section(client, REF + '_placements', `SELECT pl.operation_type, pl.quantity, pl.evidence_method, (pl.evidence_code IS NOT NULL) AS has_evidence_code, pl.evidence_ref, pl.placed_at, u.reference, u.unit_type
        FROM hub_physical_unit_placements pl JOIN hub_physical_units u ON u.id = pl.physical_unit_id
        WHERE pl.allocation_id IN (SELECT id FROM hub_purchase_allocations WHERE order_id = ${O}) ORDER BY pl.placed_at`, [REF]);
      await section(client, REF + '_custody_events', `SELECT e.event_type, e.from_state, e.to_state, e.operation_type, e.quantity, e.details, u.reference, e.created_at
        FROM hub_custody_events e JOIN hub_physical_units u ON u.id = e.physical_unit_id WHERE u.order_id = ${O} ORDER BY e.created_at`, [REF]);
      await section(client, REF + '_box_bags', `SELECT bb.bag_reference_scan, bb.box_reference_scan, bb.evidence_method, bb.evidence_ref, bb.linked_at
        FROM hub_box_bags bb WHERE bb.parcel_id IN (SELECT id FROM parcels WHERE order_id = ${O})`, [REF]);
      await section(client, REF + '_scan_events', `SELECT event_type, entry_mode, status, notes, metadata, (scan_code IS NOT NULL) AS has_scan_code, actor_role, created_at
        FROM scan_events WHERE order_id = ${O} OR parcel_id IN (SELECT id FROM parcels WHERE order_id = ${O}) ORDER BY created_at`, [REF]);
      await section(client, REF + '_scans', `SELECT step, pickup_method, authorization_version, document_checked, (scan_code IS NOT NULL) AS has_scan_code, notes, is_anomaly, created_at
        FROM scans WHERE order_id = ${O} ORDER BY created_at`, [REF]);
      await section(client, REF + '_parcel_events', `SELECT event_type, notes, metadata, created_at FROM parcel_events
        WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id = ${O}) ORDER BY created_at`, [REF]);
      await section(client, REF + '_relay_receipts', `SELECT r.expected_qty, r.received_qty, r.proof_ref, r.received_at, s.reference AS shipment
        FROM international_shipment_relay_receipts r LEFT JOIN international_shipments s ON s.id = r.shipment_id
        WHERE r.order_item_id IN (SELECT id FROM order_items WHERE order_id = ${O})`, [REF]);
      await section(client, REF + '_physical_codes', `SELECT code, code_type, trust, confirmation_proof_ref, confirmed_at FROM product_sku_physical_codes WHERE code LIKE 'CLPAR-%' ORDER BY confirmed_at`, []);
      await section(client, REF + '_incidents', `SELECT incident_type, severity, status, title, created_at FROM incidents WHERE order_id = ${O}`, [REF]);
      await section(client, REF + '_pickup_codes_state', `SELECT (pickup_secret_hash IS NOT NULL) AS has_hash, pickup_secret_last4 IS NOT NULL AS has_last4, pickup_secret_attempts, pickup_secret_blocked_until, pickup_secret_revealed_at FROM orders WHERE reference = $1`, [REF]);
      await section(client, REF + '_shipment_events', `SELECT e.event_type, e.from_stage, e.to_stage, e.proof_ref, e.notes, e.payload, e.occurred_at
        FROM international_shipment_events e JOIN international_shipments s ON s.id = e.shipment_id
        WHERE s.reference LIKE 'CLAUDE-PAR-20261113-EXP%' ORDER BY e.occurred_at`, []);
      await section(client, REF + '_transaction_documents', `SELECT document_type, subject_type, reference, status, created_at FROM transaction_documents WHERE order_id = ${O} ORDER BY created_at`, [REF]);
      await section(client, REF + '_return_receipts', `SELECT r.quantity, r.condition_code, r.storage_zone, r.received_at FROM relay_product_return_receipts r
        WHERE r.request_id IN (SELECT id FROM disputes WHERE order_id = ${O})`, [REF]);
      await section(client, REF + '_sav', `SELECT * FROM relay_return_compensations WHERE order_id = ${O}`, [REF]);
  await section(client, REF + '_purchase_orders', `SELECT po.id, po.status, s.name AS supplier,
        (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(to_jsonb(po)) e WHERE e.key ~ '(seller|proof|manual|source|supplier_order_id)') AS seller_and_proof
        FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.id IN (SELECT purchase_order_id FROM hub_purchase_allocations WHERE order_id = ${O})`, [REF]);
  await section(client, REF + '_manual_purchase_executions', `SELECT m.purchase_order_id, m.seller_label, (m.seller_supplier_id IS NOT NULL) AS has_seller_supplier, m.channel, m.quantity, m.amount, m.currency, m.proof_ref, m.recorded_at
        FROM manual_purchase_executions m WHERE m.purchase_order_id IN (SELECT purchase_order_id FROM hub_purchase_allocations WHERE order_id = ${O}) ORDER BY m.recorded_at`, [REF]);
  await section(client, REF + '_parcel_items', `SELECT p.reference, p.status, oi.fulfillment_source, oi.quantity FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id = ${O} ORDER BY p.reference`, [REF]);
      await section(client, REF + '_order_items', `SELECT oi.fulfillment_source, oi.quantity FROM order_items oi WHERE oi.order_id = ${O}`, [REF]);
    }
    await section(client, 'pickup_collect_failures', `SELECT agent_id, COUNT(*)::int AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at FROM pickup_collect_failures WHERE created_at > NOW() - INTERVAL '24 hours' AND agent_id IN (SELECT id FROM users WHERE email LIKE 'claude-par-%') GROUP BY agent_id`, []);
    await section(client, 'security_alerts', `SELECT type, severity, title, entity_id, created_at FROM alerts WHERE type LIKE 'pickup_collect_%' AND created_at > NOW() - INTERVAL '24 hours' AND EXISTS (SELECT 1 FROM users u WHERE u.email LIKE 'claude-par-%' AND alerts.description LIKE '%agent_id=' || u.id::text || '%') ORDER BY created_at`, []);
    await client.query('ROLLBACK'); tx = false;
  } catch (e) { report.fatal = String(e.message || e).slice(0, 300); process.exitCode = 1; }
  finally { if (tx) await client.query('ROLLBACK').catch(() => {}); await client.end().catch(() => {}); }
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ live_commit: report.live_commit, sections: Object.keys(report.sections), errors: report.errors, fatal: report.fatal || null }));
}
main();
