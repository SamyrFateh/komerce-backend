#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role hub-h1h9-sonnet-c345
 * @domain logistics
 * @layer script
 * @purpose G2 (cohorte Sonnet) : concurrence operationnelle sur le staging, requetes HTTP reellement simultanees de deux
 *          operateurs (agent_hub + admin), puis releve PostgreSQL en LECTURE SEULE.
 *          c3  : fixture `--stop-after=2` SANS chaine PO ; la PO est preparee, engagee, soumise, envoyee (jamais confirmee),
 *                puis confirmation reduite || reception.
 *          c45 : fixture + chaine PO confirmee ; reception KOM-101, sac client ; C4 = deux depots simultanes du meme scan ;
 *                C5 = deux rattachements simultanes du meme sac a la meme KOM-BOX.
 *          Ne corrige rien : un ecart est un FAIL consigne (fichier:ligne du defaut a rapporter par l'operateur).
 * @impact-areas hub, staging-only, test-only
 */
const fs = require('node:fs');
const path = require('node:path');
const env_sha = () => String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
const { Actor, assertTarget } = require('./hub-v1-http-action-runner');

const MARKET = 'KM';
const WS = `/api/admin/workspaces/operations/market/${MARKET}`;

async function ctx({ env, db, run8 }) {
  if (!/^[A-F0-9]{8}$/.test(run8 || '')) throw Error('RUN8_REQUIRED');
  const { base, local } = assertTarget(env);
  if (local) throw Error('STAGING_ONLY');
  const getSha = async () => String((await (await fetch(base + '/health/version')).json()).commit || '');
  const A = {
    hub: new Actor('hub_agent', base, env.E2E_AGENT_HUB_EMAIL, env.E2E_AGENT_HUB_PASSWORD),
    adm: new Actor('admin', base, env.E2E_ADMIN_EMAIL, env.E2E_ADMIN_PASSWORD),
    hub2: new Actor('hub_agent_session_2', base, env.E2E_AGENT_HUB_EMAIL, env.E2E_AGENT_HUB_PASSWORD),
    dir: new Actor('hub_director', base, env.E2E_HUB_DIRECTOR_EMAIL, env.E2E_HUB_DIRECTOR_PASSWORD),
  };
  await Promise.all(Object.values(A).map((a) => a.login()));
  const q = async (s, p) => (await db.query(s, p)).rows;
  const orderRef = (s) => `E2E-HUB-V1-${run8}-${s}`;
  const code = async (sku) => ((await q("SELECT code FROM product_sku_physical_codes WHERE product_sku_id=$1 ORDER BY (trust='CONFIRMED') DESC LIMIT 1", [sku]))[0] || {}).code;
  const rep = { schema: 'hub-h1h9-sonnet-c345/1', run8, started_at: new Date().toISOString(), sha_start: await getSha(), cases: {} };
  const fin = (k, verdict, extra) => { rep.cases[k] = { verdict, ...extra }; };
  const close = async () => {
    rep.sha_end = await getSha(); rep.sha_pinned = env_sha(); rep.sha_stable = rep.sha_end === rep.sha_start && (!rep.sha_pinned || rep.sha_pinned === rep.sha_start); rep.finished_at = new Date().toISOString();
    rep.verdict = !rep.sha_stable ? 'RUN_VOID_SHA_CHANGED' : Object.values(rep.cases).some((c) => c.verdict !== 'PASS') ? 'FAIL' : 'PASS';
    return rep;
  };
  return { A, q, orderRef, code, rep, fin, close };
}
const noRaw5xx = (rs) => rs.every((r) => r.http >= 200 && r.http < 500);

// ── C3 : confirmation reduite en concurrence avec une reception (PO envoyee, non confirmee) ──
async function c3({ env, db, run8 }) {
  const { A, q, orderRef, code, rep, fin, close } = await ctx({ env, db, run8 });
  // SEAM explicite, comme hub-v1-http-action-runner : l'ouverture des lignes d'achat n'a pas de route HTTP (paiement confirme).
  const trigger = require('../../services/purchasing-trigger-service');
  process.env.ADMIN_PHONE = '';
  for (const sfx of ['KOM-101', 'KOM-102']) { const [ro] = await q('SELECT id FROM orders WHERE reference=$1', [orderRef(sfx)]); if (!ro) throw Error('FIXTURE_ORDER_ABSENT'); await trigger.triggerPurchasing(ro.id); }
  const lines = await q(
    `SELECT pl.id, pl.supplier_id, pl.product_sku_id AS sku, oi.quantity::int AS qty, o.reference
       FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id
      WHERE o.reference = ANY($1::text[]) AND pl.cancelled_at IS NULL AND pl.purchase_order_id IS NULL ORDER BY pl.id`,
    [[orderRef('KOM-101'), orderRef('KOM-102')]]);
  const target = lines.find((l) => l.qty === 2) || lines[0];
  if (!target) throw Error('FIXTURE_LINES_NOT_READY');
  const group = lines.filter((l) => l.supplier_id === target.supplier_id);
  const prep = await A.hub.call('POST', '/api/purchasing/po/prepare',
    { supplier_id: target.supplier_id, procurement_hub_ref: 'DXB', line_ids: group.map((l) => l.id), execution_mode: 'manual' });
  const po = prep.json && prep.json.purchase_order && prep.json.purchase_order.id;
  if (prep.http !== 201 || !po) throw Error(`C3_PREPARE_${prep.http}`);
  const steps = [
    await A.dir.call('POST', `/api/purchasing/po/${po}/authorize-commitment`, { proof_ref: `SIM-ENGAGEMENT-${run8}-C3` }),
    await A.hub.call('POST', `/api/purchasing/po/${po}/submit`, {}),
    await A.hub.call('POST', `/api/purchasing/po/${po}/sent`, { channel: 'phone', note: `ENVOI FOURNISSEUR SIMULE ${run8} C3` }),
  ].map((s) => s.http);
  const [pre] = await q('SELECT status::text s FROM purchase_orders WHERE id=$1', [po]);
  if (!steps.every((s) => s === 200 || s === 201) || ['confirmed', 'draft'].includes(pre.s)) throw Error(`C3_PREP_STATE_${steps}:${pre.s}`);
  const sku = target.sku; const c = await code(sku);
  const cbody = { purchase_proof_ref: `SIM-RECU-${run8}-C3`, supplier_order_id: `SIM-SO-${run8}-C3`, seller_label: `VENDEUR-RECETTE-${run8}-C3`, channel: 'in_person',
    lines: group.map((l) => ({ purchase_line_id: l.id, confirmed_quantity: l.id === target.id ? 1 : l.qty })) };
  const rbody = { reference: `E2E-HUB-V1-${run8}-C3-RECV`, contents: [{ purchase_order_id: po, product_sku_id: sku, evidence_code: c, quantity: target.qty }] };
  // Departs simultanes : les deux requetes sont emises avant toute attente.
  const [conf, recv] = await Promise.all([A.adm.call('POST', `/api/purchasing/po/${po}/confirm`, cbody), A.hub.call('POST', '/api/scans/hub/receive', rbody)]);
  const [pg] = await q('SELECT effective_quantity::int e, received_quantity::int r FROM v_purchase_line_progress WHERE line_id=$1', [target.id]);
  const confOk = conf.http === 200;
  const recvOk = recv.http === 201;
  const ok = noRaw5xx([conf, recv]) && (confOk || recvOk) && pg.r <= pg.e && (pg.r !== target.qty || !confOk || target.qty === 1) && (!confOk || pg.e === 1);
  fin('C3', ok ? 'PASS' : 'FAIL', { po_prepared: true, http: { confirm: conf.http, receive: recv.http }, codes: [conf.code, recv.code], effective: pg.e, received: pg.r, ordered: target.qty });
  return close();
}

// ── C4 + C5 : sac client puis KOM-BOX, deux operateurs simultanes ──
async function c45({ env, db, run8 }) {
  const { A, q, orderRef, code, rep, fin, close } = await ctx({ env, db, run8 });
  const [o] = await q('SELECT id FROM orders WHERE reference=$1', [orderRef('KOM-101')]);
  if (!o) throw Error('FIXTURE_ORDER_ABSENT');
  // Reception complete de KOM-101 (comme l'ecran Reception : une requete par PO, un code par SKU).
  const rows = await q(
    `SELECT pl.purchase_order_id AS po, pl.product_sku_id AS sku, oi.quantity::int AS qty
       FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
      WHERE oi.order_id=$1 AND pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL`, [o.id]);
  const byPo = new Map();
  for (const r of rows) { if (!byPo.has(r.po)) byPo.set(r.po, []); byPo.get(r.po).push(r); }
  for (const [po, ls] of byPo) {
    const contents = []; for (const l of ls) contents.push({ purchase_order_id: po, product_sku_id: l.sku, evidence_code: await code(l.sku), quantity: l.qty });
    const r = await A.hub.call('POST', '/api/scans/hub/receive', { reference: `E2E-HUB-V1-${run8}-C45-RCV-${String(po).slice(0, 8)}`, contents });
    if (![200, 201].includes(r.http)) throw Error(`C45_RECEIVE_${r.http}:${r.code}`);
  }
  const items = await q('SELECT oi.id, oi.quantity::int AS qty FROM order_items oi WHERE oi.order_id=$1 ORDER BY oi.id', [o.id]);
  const plan = items.map((i) => ({ order_item_id: i.id, quantity: i.qty }));
  const bag = await A.hub.call('POST', `${WS}/bags`, { order_id: o.id, bag_plan: plan });
  const bagUnit = bag.json && bag.json.physical_unit; if (![200, 201].includes(bag.http) || !bagUnit) throw Error(`C45_BAG_${bag.http}:${bag.code}`);
  const dossier = async () => { const r = await A.hub.call('GET', `${WS}/supply`); return (r.json && (r.json.dossier || r.json)) || {}; };
  const fillable = ((await dossier()).fillable || []).filter((l) => String(l.order_id) === String(o.id));
  if (!fillable.length) throw Error('C45_NO_FILLABLE_LINE');
  const need = new Map(plan.map((p) => [String(p.order_item_id), p.quantity]));
  const depositBody = async (l) => {
    const qty = Math.min(need.get(String(l.order_item_id)) || 0, Number(l.quantity));
    const sku = l.product_sku_id || (await q('SELECT pl.product_sku_id s FROM purchase_lines pl WHERE pl.order_item_id=$1 AND pl.cancelled_at IS NULL LIMIT 1', [l.order_item_id]))[0].s;
    return { from_unit_id: l.from_unit_id, allocation_id: l.allocation_id, quantity: qty, evidence_method: 'SCAN', evidence_code: await code(sku) };
  };
  // C4 : meme depot, meme scan, deux operateurs au meme instant.
  const first = fillable[0]; const b4 = await depositBody(first);
  const [d1, d2] = await Promise.all([A.hub.call('POST', `${WS}/bags/${bagUnit.id}/deposit`, b4), A.hub2.call('POST', `${WS}/bags/${bagUnit.id}/deposit`, b4)]);
  const [pl] = await q("SELECT COUNT(*)::int n, COALESCE(SUM(quantity),0)::int qty FROM hub_physical_unit_placements WHERE physical_unit_id=$1 AND allocation_id=$2 AND removed_at IS NULL AND operation_type<>'RECEIVE'", [bagUnit.id, first.allocation_id]);
  const ok4 = noRaw5xx([d1, d2]) && ![d1, d2].some((r) => r.http === 403) && [d1, d2].some((r) => r.http === 200 || r.http === 201) && pl.qty === b4.quantity && pl.n === 1;
  fin('C4', ok4 ? 'PASS' : 'FAIL', { http: [d1.http, d2.http], codes: [d1.code, d2.code], active_placements: pl.n, qty: pl.qty, expected_qty: b4.quantity });
  // Fin du remplissage (sequentiel), fermeture, puis C5.
  for (const l of (await dossier()).fillable.filter((x) => String(x.order_id) === String(o.id))) {
    if (!(need.get(String(l.order_item_id)) > 0)) continue;
    const body = await depositBody(l);
    if (body.quantity > 0 && !(String(l.allocation_id) === String(first.allocation_id) && String(l.from_unit_id) === String(first.from_unit_id))) await A.hub.call('POST', `${WS}/bags/${bagUnit.id}/deposit`, body);
  }
  const closed = await A.hub.call('POST', `${WS}/bags/${bagUnit.id}/close`, {});
  const box = await A.hub.call('POST', `${WS}/boxes`, {});
  const boxUnit = box.json && box.json.physical_unit;
  const d = await dossier();
  const ready = (d.bags_ready || []).find((b) => String(b.unit_id) === String(bagUnit.id));
  const [pid] = await q("SELECT DISTINCT pi.parcel_id id FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id JOIN parcels p ON p.id=pi.parcel_id WHERE oi.order_id=$1 AND p.status::text<>'cancelled' LIMIT 1", [o.id]);
  if (![200, 201].includes(closed.http) || !boxUnit || !ready || !pid) {
    fin('C5', 'FAIL', { precondition: { close: closed.http, box: box.http, bag_ready: Boolean(ready), parcel: Boolean(pid) }, note: 'etat C5 non atteint : defaut A1/A2 probable, a rapporter avec la derniere reponse' });
    return close();
  }
  const b5 = { bag_unit_id: ready.unit_id, parcel_id: pid.id, bag_reference_scan: ready.reference, box_reference_scan: boxUnit.reference, evidence_method: 'SCAN' };
  const [x1, x2] = await Promise.all([A.hub.call('POST', `${WS}/boxes/${boxUnit.id}/bags`, b5), A.hub2.call('POST', `${WS}/boxes/${boxUnit.id}/bags`, b5)]);
  const [lk] = await q('SELECT COUNT(*)::int n FROM hub_box_bags WHERE bag_unit_id=$1', [bagUnit.id]);
  const okStatus = [x1, x2].every((r) => (r.http >= 200 && r.http < 300) || (r.http === 409 && r.code === 'HUB_BAG_ALREADY_BOXED'));
  fin('C5', noRaw5xx([x1, x2]) && ![x1, x2].some((r) => r.http === 403) && okStatus && [x1, x2].some((r) => r.http >= 200 && r.http < 300) && lk.n === 1 ? 'PASS' : 'FAIL',
    { http: [x1.http, x2.http], codes: [x1.code, x2.code], links_for_bag: lk.n });
  return close();
}

// ── T5 : etat a redemarrer. Recoit tout KOM-101 puis lit si la commande est restee 'ordered' (callback non joue) ──
// Le callback de completude est synchrone apres COMMIT : par l'API seule l'etat n'est atteint que si le callback a echoue.
// Sinon on rapporte T5_STATE_NOT_REACHABLE_VIA_API (NOT_PROVEN) au lieu de fabriquer l'etat.
async function t5prep({ env, db, run8 }) {
  const { A, q, orderRef, code, rep, fin, close } = await ctx({ env, db, run8 });
  const [o] = await q('SELECT id, reference FROM orders WHERE reference=$1', [orderRef('KOM-101')]);
  if (!o) throw Error('FIXTURE_ORDER_ABSENT');
  const rows = await q(`SELECT pl.purchase_order_id AS po, pl.product_sku_id AS sku, oi.quantity::int AS qty FROM purchase_lines pl
      JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1 AND pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL`, [o.id]);
  const byPo = new Map(); for (const r of rows) { if (!byPo.has(r.po)) byPo.set(r.po, []); byPo.get(r.po).push(r); }
  const https = [];
  for (const [po, ls] of byPo) {
    const contents = []; for (const l of ls) contents.push({ purchase_order_id: po, product_sku_id: l.sku, evidence_code: await code(l.sku), quantity: l.qty });
    https.push((await A.hub.call('POST', '/api/scans/hub/receive', { reference: `E2E-HUB-V1-${run8}-T5-RCV-${String(po).slice(0, 8)}`, contents })).http);
  }
  const [st] = await q('SELECT status::text s FROM orders WHERE id=$1', [o.id]);
  const [pi] = await q('SELECT COUNT(*)::int n FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id WHERE oi.order_id=$1', [o.id]);
  const [pend] = await q(`SELECT COUNT(*)::int n FROM v_purchase_line_progress v WHERE v.order_id=$1 AND NOT v.cancelled AND v.received_quantity < v.effective_quantity`, [o.id]);
  const stalled = (st.s === 'ordered' && pend.n === 0) || (st.s === 'preparation' && pi.n === 0);
  fin('T5', stalled ? 'T5_READY_FOR_RESTART' : 'T5_STATE_NOT_REACHABLE_VIA_API',
    { order_reference: o.reference, receive_http: https, order_status: st.s, parcel_items: pi.n, lines_not_fully_received: pend.n,
      sweep: 'purchasing-completion-service.sweepStalledOrders (cron) doit faire avancer la commande apres redemarrage' });
  const r = await close();
  r.verdict = r.sha_stable ? (stalled ? 'T5_READY_FOR_RESTART' : 'T5_NOT_PROVEN_STATE_NOT_REACHABLE') : r.verdict;
  return r;
}

async function main() {
  const mode = process.argv[2];
  const db = require('../../db');
  try {
    if (process.env.KOMERCE_ENV !== 'staging' || process.env.KOMERCE_TARGET_ENV !== 'staging') throw Error('STAGING_ONLY');
    const { confirmTarget } = require('./target-guard');
    if (!(await confirmTarget({ db })).confirmed) throw Error('TARGET_MISMATCH');
    const run8 = String(process.env.HUB_V1_CERTIFICATION_RUN || '').toUpperCase();
    const fn = { c3, c45, t5prep }[mode]; if (!fn) throw Error('MODE_c3_c45_t5prep');
    const rep = await fn({ env: process.env, db, run8 });
    const dir = path.join('test-results', 'hub-h1h9-sonnet'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${mode}-${run8}.json`), JSON.stringify(rep, null, 2) + '\n');
    console.log(JSON.stringify({ verdict: rep.verdict, cases: Object.fromEntries(Object.entries(rep.cases).map(([k, v]) => [k, v.verdict])) }));
    if (!['PASS', 'T5_READY_FOR_RESTART', 'T5_NOT_PROVEN_STATE_NOT_REACHABLE'].includes(rep.verdict)) process.exitCode = 1;
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch((e) => { console.error('C345_REFUSED:' + String(e.message).slice(0, 200)); process.exitCode = 2; });
module.exports = { c3, c45, t5prep };
