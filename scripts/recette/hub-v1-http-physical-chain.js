#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          hub-v1-http-physical-chain
 * @domain        logistics
 * @layer         tooling
 * @criticality   high
 * @inputs        fixture RUN8 deja passee par hub-v1-http-action-runner (PO confirmees), BASE_URL, identites E2E, DATABASE_URL (lecture)
 * @outputs       JSON : une ligne par action (route UI, acteur, HTTP, readback, verdict) + blocages
 * @depends       scripts/recette/hub-v1-http-action-runner.js (Actor, assertTarget), routes UI d'operations-workspace.js
 * @used-by       .github/workflows/hub-v1-http-actions-staging.yml (mode physical)
 * @db-read       orders, order_items, product_sku_physical_codes
 * @db-write      none (toutes les ecritures passent par les routes HTTP que l'UI appelle)
 * @doctrine      same_http_call_as_ui, real_role_login, no_api_hub_from_ui, blocked_action_is_a_finding
 * @impact-areas  staging, hub, relais
 * @version       2026-11
 *
 * Chaque etape appelle la route EXACTE que le front canonique appelle (fichier:ligne dans `ui`). Un prerequis manquant
 * (code physique, id d'unite, allocation) est un BLOCAGE consigne, jamais un PASS ni un contournement par un service.
 */
const fs = require('fs');
const path = require('path');
const { Actor, assertTarget } = require('./hub-v1-http-action-runner');

const WS = '/api/admin/workspaces/operations/market/KM';
const JS = 'public/dashboards/canonical/js/operations-workspace.js';
const ROLE_ENV = { hub_agent: 'E2E_AGENT_HUB_', agent_relais: 'E2E_AGENT_RELAIS_', market_operator: 'E2E_MARKET_OPERATOR_' };

async function run({ env = process.env, db, run8 } = {}) {
  const { base, local } = assertTarget(env);
  if (!/^[A-F0-9]{8}$/.test(run8 || '')) throw new Error('RUN8_REQUIRED');
  const report = { schema: 'hub-v1-http-physical/1', run8, base: local ? 'LOCAL_REHEARSAL' : 'OFFICIAL_STAGING', started_at: new Date().toISOString(), actions: [] };
  const actors = {};
  for (const [label, prefix] of Object.entries(ROLE_ENV)) {
    const a = new Actor(label, base, env[prefix + 'EMAIL'], env[prefix + 'PASSWORD']);
    try { await a.login(); actors[label] = a; report.actions.push({ key: `login:${label}`, actor: label, route: 'POST /api/auth/login', http: 200, verdict: 'PASS' }); }
    catch (e) { report.actions.push({ key: `login:${label}`, actor: label, verdict: 'BLOCKED', note: String(e.message).slice(0, 120) }); }
  }
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const orders = await q('SELECT id, reference FROM orders WHERE reference LIKE $1 ORDER BY reference', [`E2E-HUB-V1-${run8}-%`]);
  const orderOf = (s) => orders.find((o) => o.reference.endsWith(s));

  // rec : attendu vs observe ; `ui` = fichier:ligne du front qui appelle cette route.
  const rec = async (key, actorLabel, method, route, body, expect, ui, after) => {
    const row = { key, actor: actorLabel, route: `${method} ${route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`, ui, expected_http: expect.http, verdict: 'FAIL' };
    report.actions.push(row);
    const actor = actors[actorLabel];
    if (!actor) { row.verdict = 'BLOCKED'; row.note = 'acteur non connecte'; return null; }
    const r = await actor.call(method, route, body);
    Object.assign(row, { http: r.http, code: r.code });
    const ok = Array.isArray(expect.http) ? expect.http.includes(r.http) : r.http === expect.http;
    if (r.code === 'csrf_origin_required') { row.note = 'HARNAIS : Origin manquant'; return r; }
    row.verdict = ok && (!expect.code || r.code === expect.code) ? 'PASS' : (r.http === 403 && !expect.deny ? 'BLOCKED' : 'FAIL');
    if (row.verdict !== 'PASS') row.note = `observe ${r.http} ${r.code || ''} ${String(r.json && (r.json.error || r.json.message) || '').slice(0, 100)}`;
    if (row.verdict === 'PASS' && after) { try { Object.assign(row, await after(r)); } catch (e) { row.verdict = 'FAIL'; row.note = String(e.message).slice(0, 200); } }
    return r;
  };
  const blocked = (key, actor, route, ui, note) => report.actions.push({ key, actor, route, ui, verdict: 'BLOCKED', note });
  const unitId = (r) => { const u = r && r.json && (r.json.physical_unit || r.json.result && r.json.result.physical_unit || {}); return u.id || u.unit_id || null; };

  // 1. Reception hub : liste des receptions attendues puis enregistrement, comme l'ecran Reception.
  const rcv = await rec('hub:receivable', 'hub_agent', 'GET', '/api/scans/hub/receivable', null, { http: 200 }, `${JS}:1708`,
    async (r) => ({ readback: { purchase_orders: ((r.json && r.json.purchase_orders) || []).length } }));
  const fixturePos = new Set((await q(`SELECT DISTINCT pl.purchase_order_id FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
                                         WHERE oi.order_id = ANY($1::uuid[])`, [orders.map((o) => o.id)])).map((x) => x.purchase_order_id));
  const pos = ((rcv && rcv.json && rcv.json.purchase_orders) || []).filter((p) => fixturePos.has(p.purchase_order_id));
  if (!pos.length) blocked('hub:receive', 'hub_agent', 'POST /api/scans/hub/receive', `${JS}:542`, 'aucune PO de la fixture dans la liste de reception attendue (deja recues par un run precedent ?)');
  for (const po of pos) {
    const lines = (po.lines || po.items || []).filter((l) => Number(l.remaining_quantity) > 0);
    const contents = [];
    for (const l of lines) {
      const skuId = l.product_sku_id;
      const [code] = skuId ? await q('SELECT code, trust FROM product_sku_physical_codes WHERE product_sku_id=$1 ORDER BY (trust=\'CONFIRMED\') DESC LIMIT 1', [skuId]).catch(() => []) : [];
      if (!code) { blocked(`hub:physical-code:${String(po.purchase_order_id).slice(0, 8)}`, 'hub_agent', `GET ${WS}/supply/physical-code`, `${JS}:510`, `aucun code physique connu pour le SKU ${skuId || '?'} (l'UI ne propose pas de saisie/confirmation de code dans le Workspace)`); continue; }
      await rec(`hub:physical-code:${String(po.purchase_order_id).slice(0, 8)}`, 'hub_agent', 'GET', `${WS}/supply/physical-code?purchase_order_id=${po.purchase_order_id}&code=${encodeURIComponent(code.code)}`, null, { http: 200 }, `${JS}:510`,
        async (r) => ({ readback: { confirmed: r.json.confirmed, sku_match: String(r.json.product_sku_id) === String(skuId) } }));
      contents.push({ purchase_order_id: po.purchase_order_id, product_sku_id: skuId, evidence_code: code.code, quantity: Number(l.remaining_quantity) });
    }
    if (!contents.length) { blocked(`hub:receive:${String(po.purchase_order_id).slice(0, 8)}`, 'hub_agent', 'POST /api/scans/hub/receive', `${JS}:542`, 'aucune ligne recevable avec code physique : reception impossible par l\'UI'); continue; }
    const body = { reference: `HTTP-RCV-${run8}-${String(po.purchase_order_id).slice(0, 8)}`, contents };
    for (const bad of ['agent_relais', 'market_operator']) await rec(`hub:receive:deny:${bad}`, bad, 'POST', '/api/scans/hub/receive', body, { http: 403, deny: true }, `${JS}:542`);
    await rec(`hub:receive:${String(po.purchase_order_id).slice(0, 8)}`, 'hub_agent', 'POST', '/api/scans/hub/receive', body, { http: [200, 201] }, `${JS}:542`,
      async (r) => ({ readback: { quarantined: Boolean(r.json && r.json.quarantined) } }));
  }

  // 2. Sac client puis depot/fermeture, comme l'ecran Preparer les sacs (le dossier GET supply est la source de l'UI).
  const dossierOf = async () => { const r = await actors.hub_agent.call('GET', `${WS}/supply`); return (r.json && (r.json.dossier || r.json)) || {}; };
  const bagOrder = orderOf('KOM-101');
  let bagId = null; let bagRef = null;
  if (bagOrder) {
    const items = await q('SELECT oi.id, oi.quantity, (SELECT pl.product_sku_id FROM purchase_lines pl WHERE pl.order_item_id=oi.id AND pl.cancelled_at IS NULL LIMIT 1) AS product_sku_id FROM order_items oi WHERE oi.order_id=$1 ORDER BY oi.id', [bagOrder.id]);
    const plan = items.map((i) => ({ order_item_id: i.id, quantity: Number(i.quantity) }));
    const d0 = await dossierOf();
    const existing = (d0.bags_open || []).find((b) => String(b.order_id) === String(bagOrder.id));
    var left0 = null;
    if (existing) {
      bagId = existing.unit_id; bagRef = existing.reference;
      const actual = new Map((existing.actual_contents || []).map((i) => [String(i.order_item_id), Number(i.quantity)]));
      left0 = new Map((existing.bag_plan || []).map((i) => [String(i.order_item_id), Number(i.quantity) - (actual.get(String(i.order_item_id)) || 0)]));
      report.actions.push({ key: 'hub:bag-resume', actor: 'hub_agent', route: `GET ${WS}/supply`, ui: `${JS}:1052`, verdict: 'PASS', readback: { bag_reference: bagRef, reprise_d_un_sac_ouvert: true } });
    } else {
      for (const bad of ['agent_relais', 'market_operator']) await rec(`hub:bag-create:deny:${bad}`, bad, 'POST', `${WS}/bags`, { order_id: bagOrder.id, bag_plan: plan }, { http: 403, deny: true }, `${JS}:1042`);
      await rec('hub:bag-create', 'hub_agent', 'POST', `${WS}/bags`, { order_id: bagOrder.id, bag_plan: plan }, { http: [200, 201] }, `${JS}:1042`, async (x) => {
        bagId = unitId(x); bagRef = (x.json.physical_unit || {}).reference; if (!bagId) throw new Error('UNIT_ID_ABSENT:' + Object.keys(x.json || {}).join(','));
        return { readback: { bag_reference: bagRef } };
      });
    }
    if (bagId) {
      // Une ligne du dossier par (article, unite source) : on depose pour l'article du plan, exactement sa quantite planifiee.
      const d = await dossierOf();
      const lines = (d.fillable || []).filter((l) => String(l.order_id) === String(bagOrder.id));
      if (!lines.length) blocked('hub:bag-deposit', 'hub_agent', `POST ${WS}/bags/:id/deposit`, `${JS}:1084`, `aucune ligne fillable pour KOM-101 dans GET supply (cles ${Object.keys(d).join(',')})`);
      const left = left0 || new Map(items.map((i) => [String(i.id), Number(i.quantity)]));
      for (const line of lines) {
        const need = left.get(String(line.order_item_id)) || 0; if (need < 1) continue;
        const sku = line.product_sku_id || (items.find((i) => String(i.id) === String(line.order_item_id)) || {}).product_sku_id;
        const [code] = sku ? await q('SELECT code FROM product_sku_physical_codes WHERE product_sku_id=$1 ORDER BY (trust=\'CONFIRMED\') DESC LIMIT 1', [sku]).catch(() => []) : [];
        if (!code) { blocked('hub:bag-deposit', 'hub_agent', `POST ${WS}/bags/:id/deposit`, `${JS}:1084`, `pas de code a scanner pour l'article ${line.order_item_id}`); continue; }
        const quantity = Math.min(need, Number(line.quantity));
        const r = await rec('hub:bag-deposit', 'hub_agent', 'POST', `${WS}/bags/${bagId}/deposit`, { from_unit_id: line.from_unit_id, allocation_id: line.allocation_id, quantity, evidence_method: 'SCAN', evidence_code: code.code }, { http: [200, 201] }, `${JS}:1084`);
        if (r && (r.http === 200 || r.http === 201)) left.set(String(line.order_item_id), need - quantity);
      }
      await rec('hub:bag-close', 'hub_agent', 'POST', `${WS}/bags/${bagId}/close`, {}, { http: [200, 201] }, `${JS}:1099`);
    }
  } else blocked('hub:bag-create', 'hub_agent', `POST ${WS}/bags`, `${JS}:1042`, 'commande KOM-101 absente');

  // 3. KOM-BOX : creation, sac dans la box (double scan sac + box), avancement jusqu'a PACKED, dossier d'expedition.
  let boxId = null; let boxRef = null;
  await rec('hub:box-create', 'hub_agent', 'POST', `${WS}/boxes`, {}, { http: [200, 201] }, `${JS}:994`, async (x) => { boxId = unitId(x); boxRef = (x.json.physical_unit || {}).reference; if (!boxId) throw new Error('BOX_ID_ABSENT'); return { readback: { box_reference: boxRef } }; });
  let shipmentRef = null;
  if (boxId && bagId) {
    const d = await dossierOf();
    const ready = (d.bags_ready || []).find((b) => String(b.unit_id) === String(bagId) || b.reference === bagRef);
    const parcel = ready && (d.client_parcels || []).find((p) => String(p.order_id) === String(ready.order_id));
    if (!ready || !parcel) blocked('hub:box-add-bag', 'hub_agent', `POST ${WS}/boxes/:id/bags`, `${JS}:1161`, `sac pret ou colis client absent du dossier (bags_ready=${(d.bags_ready || []).length}, client_parcels=${(d.client_parcels || []).length})`);
    else {
      await rec('hub:box-add-bag', 'hub_agent', 'POST', `${WS}/boxes/${boxId}/bags`, { bag_unit_id: ready.unit_id, parcel_id: parcel.id, bag_reference_scan: ready.reference, box_reference_scan: boxRef }, { http: [200, 201] }, `${JS}:1161`);
      const NEXT = { RECEIVED: 'IDENTIFIED', IDENTIFIED: 'QUALITY_CHECKED', QUALITY_CHECKED: 'LOCATED', LOCATED: 'ALLOCATED', ALLOCATED: 'PICKED', PICKED: 'PACKED' };
      for (let i = 0; i < 8; i++) {
        const cur = ((await dossierOf()).boxes || []).find((b) => String(b.unit_id) === String(boxId));
        if (!cur) { blocked('hub:box-advance', 'hub_agent', `POST ${WS}/boxes/:id/advance`, `${JS}:1181`, 'box absente du dossier'); break; }
        if (['PACKED', 'DISPATCHED'].includes(cur.state)) break;
        const to = NEXT[cur.state]; if (!to) { blocked('hub:box-advance', 'hub_agent', `POST ${WS}/boxes/:id/advance`, `${JS}:1181`, `etat ${cur.state} sans suite connue`); break; }
        const r = await rec(`hub:box-advance:${to}`, 'hub_agent', 'POST', `${WS}/boxes/${boxId}/advance`, { to_state: to }, { http: [200, 201] }, `${JS}:1181`);
        if (!r || ![200, 201].includes(r.http)) break;
      }
      shipmentRef = `HTTP-EXP-${run8}`;
      await rec('hub:shipment-open', 'hub_agent', 'POST', `${WS}/boxes/shipment`, { reference: shipmentRef, hub_unit_ids: [boxId] }, { http: [200, 201] }, `${JS}:973`, async (x) => ({ readback: { reference: x.json && x.json.result && x.json.result.reference } }));
    }
  }

  // 4. Relais : expedition visible/recevable ? attestation article par article, puis remise client.
  const rs = await rec('relay:shipments', 'agent_relais', 'GET', `${WS}/relay-shipments`, null, { http: 200 }, `${JS}:1724`,
    async (r) => ({ readback: { shipments: ((r.json && (r.json.shipments || r.json.items)) || []).length, keys: Object.keys(r.json || {}).slice(0, 6) } }));
  const shipments = (rs && rs.json && (rs.json.shipments || rs.json.items)) || [];
  const sh = shipments.find((x) => x.reference === shipmentRef) || null;
  if (!sh) blocked('relay:attest', 'agent_relais', `POST ${WS}/relay-shipments/:ref/receive`, `${JS}:1579`, `expedition ${shipmentRef || '(non ouverte)'} absente de la liste relais : l'etape de remise au transitaire / arrivee au relais n'a pas de geste UI cartographie`);
  else if (!sh.receivable) blocked('relay:attest', 'agent_relais', `POST ${WS}/relay-shipments/:ref/receive`, `${JS}:1579`, `expedition visible mais non recevable (statut ${sh.status || '?'})`);
  else {
    const lines = (sh.items || sh.lines || []).map((i) => ({ order_item_id: i.order_item_id, received_qty: Number(i.expected_qty || i.quantity) }));
    await rec('relay:attest', 'agent_relais', 'POST', `${WS}/relay-shipments/${sh.reference}/receive`, { proof_ref: `SIM-RELAIS-${run8}`, lines }, { http: [200, 201] }, `${JS}:1579`);
  }
  const ws = await actors.agent_relais.call('GET', WS);
  const toCollect = (((ws.json || {}).queues || {}).relay || {}).to_collect || [];
  const parcelRow = toCollect.find((x) => bagOrder && String(x.order_id || '') === String(bagOrder.id)) || null;
  if (!parcelRow) blocked('relay:collect', 'agent_relais', `POST ${WS}/parcels/:ref/collect`, `${JS}:1350`, `colis KOM-101 absent de queues.relay.to_collect (${toCollect.length} colis a remettre)`);
  else await rec('relay:collect', 'agent_relais', 'POST', `${WS}/parcels/${encodeURIComponent(parcelRow.reference)}/collect`, {}, { http: [200, 201] }, `${JS}:1350`);

  report.finished_at = new Date().toISOString();
  report.counts = report.actions.reduce((m, a) => { m[a.verdict] = (m[a.verdict] || 0) + 1; return m; }, {});
  report.verdict = report.actions.some((a) => a.verdict === 'FAIL') ? 'PHYSICAL_CHAIN_FAIL' : (report.actions.some((a) => a.verdict === 'BLOCKED') ? 'PHYSICAL_CHAIN_BLOCKED_STEPS' : 'PHYSICAL_CHAIN_PASS');
  return report;
}

async function main() {
  const db = require('../../db');
  try {
    const run8 = String(process.env.HTTP_RUNNER_RUN8 || '').toUpperCase();
    const report = await run({ db, run8 });
    const dir = process.env.HTTP_RUNNER_OUT || 'test-results/hub-v1-http';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `hub-v1-http-physical-${run8}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ verdict: report.verdict, counts: report.counts }));
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch((e) => { console.error('HTTP_PHYSICAL_REFUSED:' + String(e.message).slice(0, 200)); process.exitCode = 2; });
module.exports = { run };
