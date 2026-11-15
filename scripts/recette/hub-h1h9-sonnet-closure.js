#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role hub-h1h9-sonnet-closure
 * @domain logistics
 * @layer script
 * @purpose G2 cloture H1-H9 (cohorte Sonnet) sur UNE fixture RUN8 neuve (certification-runner --stop-after=2 + http-action-runner,
 *          PO confirmees, rien recu). C2 : deux receptions HTTP simultanees (agent_hub + admin) ; T3 : rupture soldee ;
 *          T4 : colis perdu en controle. Ecritures = routes HTTP de l'UI ; PostgreSQL en lecture seule. Ne corrige rien :
 *          un ecart est un FAIL ou BLOCKED consigne.
 * @not-covered T6, T10, C3, C4, C5, T5 (voir docs/chantier/STATUS.md G2)
 * @impact-areas hub, staging-only, test-only
 */
const fs = require('node:fs');
const path = require('node:path');
const env_sha = () => String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
const { Actor, assertTarget } = require('./hub-v1-http-action-runner');

async function run({ env = process.env, db, run8 }) {
  if (!/^[A-F0-9]{8}$/.test(run8 || '')) throw Error('RUN8_REQUIRED');
  const { base, local } = assertTarget(env);
  if (local) throw Error('STAGING_ONLY');
  const rep = { schema: 'hub-h1h9-sonnet-closure/1', run8, started_at: new Date().toISOString(), cases: {} };
  const getSha = async () => String((await (await fetch(base + '/health/version')).json()).commit || '');
  rep.sha_start = await getSha();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const hub = new Actor('hub_agent', base, env.E2E_AGENT_HUB_EMAIL, env.E2E_AGENT_HUB_PASSWORD);
  const adm = new Actor('admin', base, env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASSWORD);
  await Promise.all([hub.login(), adm.login()]);
  const ord = (s) => `E2E-HUB-V1-${run8}-${s}`;
  const lineOf = async (suffix, offsetSku) => (await q(
    `SELECT pl.id AS line_id, pl.purchase_order_id AS po, pl.product_sku_id AS sku, oi.id AS item, o.id AS order_id,
            (SELECT code FROM product_sku_physical_codes c WHERE c.product_sku_id=pl.product_sku_id ORDER BY (trust='CONFIRMED') DESC LIMIT 1) AS code
       FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id
      WHERE o.reference=$1 AND pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL ORDER BY oi.id OFFSET $2 LIMIT 1`, [ord(suffix), offsetSku]))[0];
  const received = async (lineId) => Number((await q('SELECT received_quantity FROM v_purchase_line_progress WHERE line_id=$1', [lineId]))[0]?.received_quantity || 0);
  const rcv = (actor, L, qty, ref) => actor.call('POST', '/api/scans/hub/receive',
    { reference: ref, contents: [{ purchase_order_id: L.po, product_sku_id: L.sku, evidence_code: L.code, quantity: qty }] });
  const fin = (k, verdict, extra) => { rep.cases[k] = { verdict, ...extra }; };

  const l101 = [await lineOf('KOM-101', 0), await lineOf('KOM-101', 1)];
    if (!l101[0] || !l101[1] || l101.some((l) => !l.code)) throw Error('FIXTURE_PO_CHAIN_NOT_READY');
  // La ligne A (x2) et la ligne B (x1) de KOM-101 : on distingue par la quantite commandee.
  const qtyOf = async (l) => Number((await q('SELECT quantity FROM order_items WHERE id=$1', [l.item]))[0].quantity);
  const [lA, lB] = (await qtyOf(l101[0])) === 2 ? l101 : [l101[1], l101[0]];

  // C2 : deux operateurs, deux references, UNE unite autorisee (ligne B x1). 201 = recu ; 202 ou 4xx = refus metier explicite.
  const [r1, r2] = await Promise.all([rcv(hub, lB, 1, `E2E-HUB-V1-${run8}-C2-RX1`), rcv(adm, lB, 1, `E2E-HUB-V1-${run8}-C2-RX2`)]);
  const st = [r1.http, r2.http];
  const got = await received(lB.line_id);
  const units = (await q("SELECT reference, state FROM hub_physical_units WHERE reference LIKE $1 ORDER BY reference", [`E2E-HUB-V1-${run8}-C2-RX%`]));
  const explicit = st.every((s) => s === 201 || s === 202 || (s >= 400 && s < 500));
  fin('C2', st.filter((s) => s === 201).length === 1 && explicit && got === 1 ? 'PASS' : 'FAIL',
    { http: st, codes: [r1.code, r2.code], received_after: got, units });

  // T4 : sur la ligne A (x2) : 1 recu puis colis perdu (POST /api/hub/outcome LOST) -> exclu du recu, commande non avancee.
  const t4ref = `E2E-HUB-V1-${run8}-T4-QUAR`;
  const t4r = await rcv(hub, lA, 1, t4ref);
  const [unit] = await q('SELECT id FROM hub_physical_units WHERE reference=$1', [t4ref]);
  const before = await received(lA.line_id);
  const lost = unit ? await hub.call('POST', '/api/hub/outcome', { unit_id: unit.id, outcome_type: 'LOST', details: { reason: 'T4 colis perdu en controle (cohorte Sonnet)' } }) : { http: 0 };
  const after = await received(lA.line_id);
  const st4 = (await q('SELECT status::text s FROM orders WHERE id=$1', [lA.order_id]))[0].s;
  const pi4 = (await q('SELECT COUNT(*)::int n FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1', [lA.order_id]))[0].n;
  const ustate = unit ? (await q('SELECT state, outcome_type FROM hub_physical_units WHERE id=$1', [unit.id]))[0] : null;
  fin('T4', t4r.http === 201 && before === 1 && lost.http === 200 && after === 0 && st4 === 'ordered' && pi4 === 0 ? 'PASS' : 'FAIL',
    { receive: t4r.http, outcome: lost.http, outcome_code: lost.code, received_before: before, received_after: after, order_status: st4, parcel_items: pi4, unit: ustate });

  // T3 : meme ligne A : 1 recu, reste solde sans reliquat -> incident unique, alerte unique, commande avancee (B recu par C2).
  // L'avancement n'est PAS evalue par la route settle (purchasing-engagement-service.js:684) : il vient du balayage
  // sweepStalledOrders (cron 10 min, bootstrap/crons.js:382). On interroge jusqu'a 12 min et on consigne le delai.
  const t3r = await rcv(hub, lA, 1, `E2E-HUB-V1-${run8}-T3-RECU`);
  const t3start = Date.now();
  const settle = await adm.call('POST', `/api/purchasing/lines/${lA.line_id}/settle`,
    { settled_quantity: 1, reason: 'rupture fournisseur definitive T3 (cohorte Sonnet)', reopen_remainder: false });
  const inc = () => q("SELECT id FROM incidents WHERE order_item_id=$1 AND details->>'type'='supplier_shortage'", [lA.item]);
  const stOf = async () => (await q('SELECT status::text s FROM orders WHERE id=$1', [lA.order_id]))[0].s;
  let status = await stOf();
  const immediate = status === 'preparation';
  while (status !== 'preparation' && Date.now() - t3start < 12 * 60 * 1000) { await new Promise((r) => setTimeout(r, 20000)); status = await stOf(); }
  const waited = Math.round((Date.now() - t3start) / 1000);
  // Diagnostic lecture seule si la commande n'avance pas (cause : cron desactive, balayage en echec ou predicat IMPORT).
  const diag = status === 'preparation' ? null : {
    items: await q("SELECT COALESCE(fulfillment_source,'NULL') fs, COUNT(*)::int n FROM order_items WHERE order_id=$1 GROUP BY 1", [lA.order_id]),
    lines: await q('SELECT line_id, effective_quantity::int e, received_quantity::int r, cancelled FROM v_purchase_line_progress WHERE order_id=$1', [lA.order_id]),
    sweep_eligible: (await q(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE o.created_at < (SELECT created_at FROM orders WHERE id=$1))::int AS older
        FROM orders o WHERE o.status='ordered'
         AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.fulfillment_source='IMPORT')
         AND NOT EXISTS (SELECT 1 FROM v_purchase_line_progress v WHERE v.order_id=o.id AND NOT v.cancelled AND v.received_quantity < v.effective_quantity)`, [lA.order_id]))[0],
    distribution_alerts: (await q("SELECT COUNT(*)::int n FROM alerts WHERE type='purchasing_distribution_failed' AND entity_id=$1", [lA.order_id]))[0].n,
    completion_alerts: await q("SELECT type, COUNT(*)::int n FROM alerts WHERE entity_id=$1 GROUP BY type", [lA.order_id]),
  };
  const incs = await inc();
  const alerts = incs.length ? (await q("SELECT COUNT(*)::int n FROM alerts WHERE type='supplier_shortage_refund_required' AND entity_id=$1", [incs[0].id]))[0].n : null;
  const parcelQty = (await q('SELECT COALESCE(SUM(pi.quantity),0)::int n FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id JOIN parcels p ON p.id=pi.parcel_id AND p.cancelled_at IS NULL WHERE oi.order_id=$1', [lA.order_id]))[0].n;
  const replay = await adm.call('POST', `/api/purchasing/lines/${lA.line_id}/settle`, { settled_quantity: 1, reason: 'rejeu T3', reopen_remainder: false });
  const incs2 = await inc();
  fin('T3', t3r.http === 201 && settle.http === 200 && incs.length === 1 && alerts === 1 && status === 'preparation' && parcelQty === 1 && incs2.length === 1 ? 'PASS' : 'FAIL',
    { receive: t3r.http, settle: settle.http, settle_code: settle.code, incidents: incs.length, alerts, order_status: status, advanced_immediately: immediate,
      advanced_after_s: status === 'preparation' ? waited : null, diag, parcel_qty: parcelQty, replay_http: replay.http, incidents_after_replay: incs2.length });

  rep.sha_end = await getSha();
  rep.sha_pinned = env_sha(); rep.sha_stable = rep.sha_end === rep.sha_start && (!rep.sha_pinned || rep.sha_pinned === rep.sha_start);
  rep.finished_at = new Date().toISOString();
  rep.verdict = !rep.sha_stable ? 'RUN_VOID_SHA_CHANGED' : Object.values(rep.cases).some((c) => c.verdict !== 'PASS') ? 'CLOSURE_FAIL' : 'CLOSURE_PASS';
  return rep;
}

async function main() {
  const db = require('../../db');
  try {
    if (process.env.KOMERCE_ENV !== 'staging' || process.env.KOMERCE_TARGET_ENV !== 'staging') throw Error('STAGING_ONLY');
    const { confirmTarget } = require('./target-guard');
    if (!(await confirmTarget({ db })).confirmed) throw Error('TARGET_MISMATCH');
    const run8 = String(process.env.HUB_V1_CERTIFICATION_RUN || '').toUpperCase();
    const rep = await run({ db, run8 });
    const dir = path.join('test-results', 'hub-h1h9-sonnet');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `closure-${run8}.json`), JSON.stringify(rep, null, 2) + '\n');
    console.log(JSON.stringify({ verdict: rep.verdict, cases: Object.fromEntries(Object.entries(rep.cases).map(([k, v]) => [k, v.verdict])) }));
    if (rep.verdict !== 'CLOSURE_PASS') process.exitCode = 1;
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch((e) => { console.error('CLOSURE_REFUSED:' + String(e.message).slice(0, 200)); process.exitCode = 2; });
module.exports = { run };
