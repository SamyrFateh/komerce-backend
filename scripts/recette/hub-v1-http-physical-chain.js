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
  if (!pos.length) blocked('hub:receive', 'hub_agent', 'POST /api/scans/hub/receive', `${JS}:542`, 'aucune PO de la fixture dans la liste de reception attendue');
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

  // 2. Sac client puis depot/fermeture.
  const bagOrder = orderOf('KOM-101');
  let bagId = null;
  if (bagOrder) {
    const items = await q('SELECT id, quantity FROM order_items WHERE order_id=$1 ORDER BY id', [bagOrder.id]);
    const plan = items.map((i) => ({ order_item_id: i.id, quantity: Number(i.quantity) }));
    for (const bad of ['agent_relais', 'market_operator']) await rec(`hub:bag-create:deny:${bad}`, bad, 'POST', `${WS}/bags`, { order_id: bagOrder.id, bag_plan: plan }, { http: 403, deny: true }, `${JS}:1042`);
    const r = await rec('hub:bag-create', 'hub_agent', 'POST', `${WS}/bags`, { order_id: bagOrder.id, bag_plan: plan }, { http: [200, 201] }, `${JS}:1042`, async (x) => {
      bagId = unitId(x); if (!bagId) throw new Error('UNIT_ID_ABSENT:' + Object.keys(x.json || {}).join(','));
      return { readback: { bag_reference: (x.json.physical_unit || {}).reference } };
    });
    if (r && r.http === 409) report.actions[report.actions.length - 1].note += ' (reception/completude requise avant sac)';
  } else blocked('hub:bag-create', 'hub_agent', `POST ${WS}/bags`, `${JS}:1042`, 'commande KOM-101 absente');
  if (bagId) {
    const dossier = await actors.hub_agent.call('GET', `${WS}/supply`);
    const walk = (o, k, out = []) => { if (o && typeof o === 'object') { if (k in o) out.push(o); Object.values(o).forEach((v) => walk(v, k, out)); } return out; };
    const cand = walk(dossier.json, 'from_unit_id').filter((x) => x.allocation_id);
    if (!cand.length) blocked('hub:bag-deposit', 'hub_agent', `POST ${WS}/bags/:id/deposit`, `${JS}:1084`, `aucune ligne from_unit_id/allocation_id dans GET supply (http ${dossier.http}, cles ${Object.keys(dossier.json || {}).join(',')})`);
    for (const line of cand.slice(0, 2)) {
      const [code] = await q('SELECT code FROM product_sku_physical_codes WHERE product_sku_id=$1 LIMIT 1', [line.product_sku_id]).catch(() => []);
      if (!code) { blocked('hub:bag-deposit', 'hub_agent', `POST ${WS}/bags/:id/deposit`, `${JS}:1084`, 'pas de code a scanner pour la ligne'); continue; }
      await rec('hub:bag-deposit', 'hub_agent', 'POST', `${WS}/bags/${bagId}/deposit`, { from_unit_id: line.from_unit_id, allocation_id: line.allocation_id, quantity: Number(line.quantity) || 1, evidence_method: 'SCAN', evidence_code: code.code }, { http: [200, 201] }, `${JS}:1084`);
    }
    await rec('hub:bag-close', 'hub_agent', 'POST', `${WS}/bags/${bagId}/close`, {}, { http: [200, 201] }, `${JS}:1099`);
  }

  // 3. KOM-BOX, sac dans la box, expedition.
  let boxId = null; let boxRef = null;
  await rec('hub:box-create', 'hub_agent', 'POST', `${WS}/boxes`, {}, { http: [200, 201] }, `${JS}:994`, async (x) => { boxId = unitId(x); boxRef = (x.json.physical_unit || {}).reference; if (!boxId) throw new Error('BOX_ID_ABSENT'); return { readback: { box_reference: boxRef } }; });
  if (boxId && bagId) {
    blocked('hub:box-add-bag', 'hub_agent', `POST ${WS}/boxes/:id/bags`, `${JS}:1161`, 'necessite parcel_id (colis client) et les references scannees sac/box : a relever depuis GET supply apres fermeture du sac');
  }
  blocked('hub:shipment-open', 'hub_agent', `POST ${WS}/boxes/shipment`, `${JS}:973`, 'depend de la box contenant un sac ferme');
  blocked('relay:attest', 'agent_relais', `POST ${WS}/relay-shipments/:ref/receive`, `${JS}:1579`, 'depend de l\'expedition ouverte et recue au relais');
  blocked('relay:collect', 'agent_relais', `POST ${WS}/parcels/:ref/collect`, `${JS}:1350`, 'depend de l\'attestation relais');

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
