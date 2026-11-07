#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          staging-local-stock-real-relay-cert
 * @domain        logistics
 * @layer         tooling
 * @criticality   high
 * @inputs        Fresh E2E-HUB-V1 RUN8 stopped after step 2; HTTP_RUNNER_*; real E2E identities; read-only DB access
 * @outputs       JSON with HTTP role refusals, physical receipts, pickup and zero-Hub invariants
 * @depends       hub-v1-http-action-runner (Actor, assertTarget), local-relay-receipt route, operations workspace parcel collect
 * @used-by       .github/workflows/staging-local-stock-certification.yml
 * @db-read       orders, order_items, parcels, parcel_items, scans, purchase_lines, purchase_orders, hub_purchase_allocations, hub_physical_units, order_status_history, local_stock_allocations
 * @db-write      none (all mutations via real HTTP routes, not DB/service shortcuts)
 * @doctrine      staging_only, no_fictitious_hub, local_relay_proof, deny_cross_role, fail_closed
 * @impact-areas  staging, relais, orders, logistics
 * @version       2026-11
 *
 * This is a SEPARATE LOCAL_STOCK proof. The historical physical runner
 * makes a Hub "ship" call for LOCAL and must not be cited as local certification.
 * Never run this against a previously distributed/processed fixture.
 */
const fs = require('fs');
const path = require('path');
const { Actor, assertTarget } = require('./hub-v1-http-action-runner');

const ROLES = Object.freeze({
  admin: 'E2E_ADMIN_',
  hub_agent: 'E2E_AGENT_HUB_',
  market_operator: 'E2E_MARKET_OPERATOR_',
  agent_relais: 'E2E_AGENT_RELAIS_',
  transitaire: 'E2E_TRANSITAIRE_',
});
const MARKETS = new Set(['KM', 'CM', 'CG']);
const EXPECTED_ROLES = Object.freeze({ hub_agent: 'agent_hub', transitaire: 'agent_transitaire' });
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function assess(snapshot, phase) {
  const errors = [];
  const o = snapshot.order;
  const p = snapshot.parcels;
  const lines = snapshot.lines;
  const c = snapshot.counts;
  const expect = (condition, code) => { if (!condition) errors.push(code); };
  expect(Boolean(o), 'LOCAL_ORDER_MISSING');
  if (!o) return errors;
  expect(o.payment_status === 'paid', 'LOCAL_PAYMENT_NOT_PAID');
  expect(lines.length > 0 && lines.every(x => x.fulfillment_source === 'LOCAL_STOCK' && Number(x.quantity) > 0),
    'LOCAL_PROVENANCE_INVALID');
  expect(Number(c.purchase_lines) === 0 && Number(c.purchase_orders) === 0 &&
    Number(c.hub_allocations) === 0 && Number(c.hub_units) === 0 &&
    Number(c.shipment_receipts) === 0, 'LOCAL_TOUCHED_HUB');
  expect(Number(c.shipped_scans) === 0 && Number(c.shipping_history) === 0, 'LOCAL_ARTIFICIAL_SHIPPING');
  expect(Number(c.consumed_allocations) === lines.reduce((n, x) => n + Number(x.quantity || 0), 0),
    'LOCAL_PAID_ALLOCATIONS_NOT_COVERED');
  expect(Number(c.cash_collections) === 0 && !o.stripe_payment_id && !o.cash_paid_at,
    'SIMULATED_PAYMENT_EXTERNAL_EFFECT');
  if (phase === 'before') {
    expect(['confirmed', 'ordered'].includes(o.status), 'LOCAL_NOT_READY');
    expect(p.length === 0, 'LOCAL_ALREADY_HAS_PARCEL');
    expect(Number(c.relay_receipts) === 0, 'LOCAL_ALREADY_RECEIVED');
  } else {
    expect(p.length === 1, 'LOCAL_PARCEL_COUNT');
    expect(Number(c.relay_receipts) === 1, 'LOCAL_RECEIPT_PROOF_COUNT');
    expect(Number(c.available_history) === 1, 'LOCAL_AVAILABLE_HISTORY_COUNT');
    if (p.length === 1) {
      expect(String(p[0].relais_id) === String(o.relais_id), 'LOCAL_PARCEL_WRONG_RELAIS');
      expect(p[0].shipment_id == null && p[0].shipped_at == null && p[0].in_transit_at == null,
        'LOCAL_PARCEL_LINKED_TO_SHIPMENT');
      expect(p[0].status === (phase === 'collected' ? 'collected' : 'available'), 'LOCAL_PARCEL_STATUS');
      expect(lines.every(x => Number(x.qty_shipped) === 0 &&
        Number(x.qty_received) === Number(x.quantity)), 'LOCAL_RECEIPT_QUANTITIES');
      expect(lines.every(x => Number(x.qty_collected) === (phase === 'collected' ? Number(x.quantity) : 0)),
        'LOCAL_COLLECTED_QUANTITIES');
    }
    expect(o.status === (phase === 'collected' ? 'collected' : 'available'), 'LOCAL_ORDER_STATUS');
    if (phase === 'collected') expect(Number(c.collected_history) === 1, 'LOCAL_PICKUP_HISTORY_COUNT');
  }
  return errors;
}

async function snapshot(db, orderId) {
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const [order] = await q(
    'SELECT id, market_id, relais_id, status::text AS status, payment_status::text AS payment_status, stripe_payment_id, cash_paid_at FROM orders WHERE id=$1',
    [orderId]);
  const parcels = await q(
    'SELECT id, reference, relais_id, status::text AS status, shipment_id, shipped_at, in_transit_at FROM parcels WHERE order_id=$1 AND cancelled_at IS NULL ORDER BY created_at',
    [orderId]);
  const lines = await q(
    'SELECT oi.quantity, oi.fulfillment_source, pi.qty_shipped, pi.qty_received, pi.qty_collected FROM order_items oi LEFT JOIN parcel_items pi ON pi.order_item_id=oi.id AND pi.parcel_id=$2 WHERE oi.order_id=$1',
    [orderId, parcels[0] ? parcels[0].id : null]);
  const [counts] = await q(
    'SELECT ' +
    '(SELECT count(*)::int FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1) AS purchase_lines, ' +
    '(SELECT count(*)::int FROM purchase_orders WHERE order_id=$1) AS purchase_orders, ' +
    '(SELECT count(*)::int FROM hub_purchase_allocations WHERE order_id=$1) AS hub_allocations, ' +
    '(SELECT count(*)::int FROM hub_physical_units WHERE order_id=$1) AS hub_units, ' +
    '(SELECT count(*)::int FROM international_shipment_relay_receipts r JOIN order_items oi ON oi.id=r.order_item_id WHERE oi.order_id=$1) AS shipment_receipts, ' +
    "(SELECT count(*)::int FROM scans WHERE order_id=$1 AND step='relais_received') AS relay_receipts, " +
    "(SELECT count(*)::int FROM scans WHERE order_id=$1 AND step='shipped') AS shipped_scans, " +
    "(SELECT count(*)::int FROM order_status_history WHERE order_id=$1 AND status::text IN ('shipped','in_transit')) AS shipping_history, " +
    "(SELECT count(*)::int FROM order_status_history WHERE order_id=$1 AND status::text='available') AS available_history, " +
    "(SELECT count(*)::int FROM order_status_history WHERE order_id=$1 AND status::text='collected') AS collected_history, " +
    '(SELECT COALESCE(SUM(quantity),0)::int FROM local_stock_allocations WHERE order_id=$1 AND consumed_at IS NOT NULL AND released_at IS NULL) AS consumed_allocations, ' +
    '(SELECT count(*)::int FROM cash_collections WHERE order_id=$1) AS cash_collections',
    [orderId]);
  return { order, parcels, lines, counts };
}

async function run({ env = process.env, db, run8 } = {}) {
  const { base, local } = assertTarget(env);
  const market = String(env.HTTP_RUNNER_MARKET || '').toUpperCase();
  if (!MARKETS.has(market)) throw new Error('LOCAL_CERT_MARKET_INVALID');
  if (!/^[A-F0-9]{8}$/.test(run8 || '')) throw new Error('LOCAL_CERT_RUN8_INVALID');
  if (!db || typeof db.query !== 'function') throw new Error('LOCAL_CERT_DATABASE_REQUIRED');
  if (!local) {
    const v = await (await fetch(base + '/health/version')).json();
    if (!/^[a-f0-9]{40}$/i.test(env.E2E_EXPECTED_DEPLOY_SHA || '') ||
        String(v.commit || '').toLowerCase() !== env.E2E_EXPECTED_DEPLOY_SHA.toLowerCase())
      throw new Error('LOCAL_CERT_STAGING_SHA_MISMATCH');
  }
  const report = { schema: 'local-stock-staging-cert/1', market, run8,
    base: local ? 'LOCAL_REHEARSAL' : 'OFFICIAL_STAGING',
    started_at: new Date().toISOString(), checks: [], verdict: 'LOCAL_STOCK_NOT_CERTIFIED',
    limits: ['HTTP + DB readback only. Chromium Relais Live remains a separate gate.',
      'Fixture payment is simulated; no PSP debit or refund is proven.'] };
  try {
    const add = (key, verdict, extra = {}) => {
      report.checks.push({ key, verdict, ...extra });
      if (verdict !== 'PASS') throw new Error('LOCAL_CERT_FAIL:' + key);
    };
    const ref = 'E2E-HUB-V1-' + run8 + '-LOCAL';
    const rows = (await db.query(
      'SELECT o.id, o.relais_id, o.market_id, m.code AS market_code FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.reference=$1',
      [ref])).rows;
    if (rows.length !== 1 || rows[0].market_code !== market) throw new Error('LOCAL_FIXTURE_MISSING_OR_WRONG_MARKET');
    const orderId = rows[0].id;
    const before = await snapshot(db, orderId);
    add('initial:local-only-no-parcel', assess(before, 'before').length ? 'FAIL' : 'PASS',
      { failures: assess(before, 'before') });
    const actors = {};
    for (const [label, prefix] of Object.entries(ROLES)) {
      if (!env[prefix + 'EMAIL'] || !env[prefix + 'PASSWORD'])
        throw new Error('LOCAL_CERT_E2E_CREDENTIALS_MISSING:' + label);
      const a = new Actor(label, base, env[prefix + 'EMAIL'], env[prefix + 'PASSWORD']);
      await a.login();
      actors[label] = a;
      add('login:' + label, a.role === (EXPECTED_ROLES[label] || label) ? 'PASS' : 'FAIL',
        { role_observed: a.role });
    }
    const route = '/api/orders/' + orderId + '/local-relay-receipt';
    const proof = { physical_received: true, note: 'CERT LOCAL ' + run8 + ' reception attestee au relais' };
    const rec = async (key, who, method, routePath, body, http, code) => {
      const result = await actors[who].call(method, routePath, body);
      const verdict = result.http === http && result.code !== 'csrf_origin_required' &&
        (!code || result.code === code) ? 'PASS' : 'FAIL';
      add(key, verdict, { actor: who, method, route: routePath.replace(orderId, ':order_id'),
        expected_http: http, http: result.http, code: result.code });
      return result;
    };
    await rec('deny:hub', 'hub_agent', 'POST', route, proof, 403);
    await rec('deny:market-operator', 'market_operator', 'POST', route, proof, 403);
    await rec('deny:transitaire', 'transitaire', 'POST', route, proof, 403);
    await rec('deny:missing-proof', 'agent_relais', 'POST', route,
      { physical_received: false }, 400, 'LOCAL_RECEIPT_PROOF_REQUIRED');
    const beforeReceipt = await snapshot(db, orderId);
    add('denials:no-physical-mutation', assess(beforeReceipt, 'before').length ? 'FAIL' : 'PASS',
      { failures: assess(beforeReceipt, 'before') });

    const receipt = await rec('relay:physical-receipt', 'agent_relais',
      'POST', route, proof, 200);
    add('relay:receipt-response', receipt.json && receipt.json.success === true &&
      receipt.json.status === 'available' && UUID.test(receipt.json.parcel_id) ? 'PASS' : 'FAIL');
    const received = await snapshot(db, orderId);
    const receivedErrors = assess(received, 'available');
    add('physical:local-without-hub', receivedErrors.length ? 'FAIL' : 'PASS',
      { failures: receivedErrors, readback: { counts: received.counts,
        parcel_reference: received.parcels[0] && received.parcels[0].reference } });

    await rec('deny:repeated-receipt', 'agent_relais', 'POST', route,
      proof, 409, 'LOCAL_RECEIPT_PARCEL_ALREADY_EXISTS');
    const parcelReference = received.parcels[0].reference;
    const collectPath = '/api/admin/workspaces/operations/market/' + market +
      '/parcels/' + encodeURIComponent(parcelReference) + '/collect';
    await rec('relay:customer-pickup', 'agent_relais', 'POST', collectPath,
      { reason: 'scanner_unavailable' }, 200);
    const collected = await snapshot(db, orderId);
    const collectedErrors = assess(collected, 'collected');
    add('final:collected-zero-hub', collectedErrors.length ? 'FAIL' : 'PASS',
      { failures: collectedErrors, readback: { counts: collected.counts,
        order_status: collected.order.status, parcel_status: collected.parcels[0].status } });
    report.verdict = 'LOCAL_STOCK_HTTP_PASS';
  } catch (error) {
    report.failure = String(error && error.message || error).slice(0, 250);
    report.verdict = 'LOCAL_STOCK_HTTP_FAIL';
  }
  report.finished_at = new Date().toISOString();
  report.counts = report.checks.reduce((m, c) => {
    m[c.verdict] = (m[c.verdict] || 0) + 1; return m;
  }, {});
  return report;
}

async function main() {
  const db = require('../../db');
  try {
    const run8 = String(process.env.HTTP_RUNNER_RUN8 || '').toUpperCase();
    const report = await run({ db, run8 });
    const dir = 'test-results/local-stock-cert';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'local-stock-' + report.market + '-' + run8 + '.json'),
      JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ verdict: report.verdict, counts: report.counts,
      failure: report.failure || null }));
    if (report.verdict !== 'LOCAL_STOCK_HTTP_PASS') process.exitCode = 1;
  } finally {
    if (db.pool && db.pool.end) await db.pool.end();
  }
}

if (require.main === module) main().catch(error => {
  console.error('LOCAL_CERT_REFUSED:' + String(error && error.message || error).slice(0, 200));
  process.exitCode = 2;
});
module.exports = { run, snapshot, assess, MARKETS };
