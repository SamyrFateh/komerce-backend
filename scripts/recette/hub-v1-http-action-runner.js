#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          hub-v1-http-action-runner
 * @domain        logistics
 * @layer         tooling
 * @criticality   high
 * @inputs        fixture RUN8 (hub-v1-certification-runner --stop-after=2), BASE_URL, E2E_* identities, DATABASE_URL (verifs PG en lecture)
 * @outputs       JSON/Markdown : une ligne par action (route, acteur, HTTP, readback GET, verif PG, verdict) + refus de mauvais roles
 * @depends       scripts/recette/hub-v1-certification-runner.js (fixture), routes/purchasing.js (routes reelles), services/purchasing-trigger-service.js (seul SEAM non HTTP)
 * @used-by       workflow staging a venir (apres GO), repetition locale PG16 + serveur local
 * @db-read       orders, order_items, purchase_lines, purchase_orders, purchase_order_authorizations, users
 * @db-write      none (toutes les ecritures passent par les routes HTTP ; seul le declenchement d'achat est un seam service explicite)
 * @doctrine      same_http_call_as_ui, real_role_login, no_service_shortcut, blocked_action_is_a_finding
 * @impact-areas  staging, hub, purchasing, authorization
 * @version       2026-11
 *
 * Chaque action metier est declenchee par le MEME appel HTTP que l'UI, avec le compte du bon role (login reel),
 * puis relue par GET et verifiee en PG. Les mauvais roles doivent etre refuses. Toute action inaccessible a son role
 * prevu est consignee BLOCKED (c'est un constat, pas un echec du harnais). Le niveau 1 couvre la chaine PO
 * (preparation -> engagement -> soumission -> envoi -> paiement fournisseur -> confirmation). Les actions physiques
 * (reception, sacs, KOM-BOX, expedition, relais, retrait, circuit local) sont listees NOT_COVERED avec leur route candidate.
 */
const fs = require('fs');
const path = require('path');

const STAGING = 'https://komerce-backend-production.up.railway.app';
const ROLE_ENV = Object.freeze({
  admin: 'E2E_ADMIN_', hub_agent: 'E2E_AGENT_HUB_', hub_director: 'E2E_HUB_DIRECTOR_',
  market_operator: 'E2E_MARKET_OPERATOR_', agent_relais: 'E2E_AGENT_RELAIS_',
});
const NOT_COVERED = Object.freeze([
  ['receive-supplier-package', 'agent_hub', 'POST /api/hub/... (hub-operations receiveSupplierPackageCommand) ou /api/purchasing/:id/receive'],
  ['identify-scan', 'agent_hub', 'POST /api/hub/scan | /api/hub/physical-codes/confirm'],
  ['create-bag / distribute', 'agent_hub', 'POST /api/hub/unit | /api/auto-distribute (auto-parcel)'],
  ['pack-box', 'agent_hub', 'POST /api/hub/pack | /api/hub/seal | bags -> box (admin-operations-workspace)'],
  ['ship / handover', 'agent_hub|agent_transitaire', 'POST /api/hub/box/:unit_id/shipment + journey transition (admin-operations-workspace)'],
  ['relay attestation', 'agent_relais', 'admin-operations-workspace relay receipts (relay-shipment-receipt)'],
  ['pickup', 'agent_relais', 'POST /api/scans/collect | /api/scans/verify-qr'],
  ['local circuit receipt + pickup', 'agent_relais', 'local-relay-receipt-service route + /api/scans/collect'],
]);

class Actor {
  constructor(label, base, email, password) { Object.assign(this, { label, base, email, password, cookie: null, role: null }); }
  async login() {
    const r = await fetch(this.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: this.password }) });
    if (r.status !== 200) throw new Error(`LOGIN_FAILED:${this.label}:${r.status}`);
    const set = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]);
    this.cookie = set.join('; ');
    const me = await this.call('GET', '/api/auth/me');
    this.role = me.json && (me.json.role || (me.json.user && me.json.user.role)) || null;
  }
  async call(method, p, body) {
    const r = await fetch(this.base + p, { method, headers: { cookie: this.cookie || '', origin: this.base, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await r.json().catch(() => null);
    return { http: r.status, json, code: json && json.code || null };
  }
}

function assertTarget(env) {
  const base = String(env.HTTP_RUNNER_BASE_URL || STAGING).replace(/\/$/, '');
  const origin = new URL(base).origin;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin !== STAGING && !(local && env.HTTP_RUNNER_ALLOW_LOCAL === '1')) throw new Error('HTTP_RUNNER_TARGET_REFUSED');
  return { base, local };
}

async function run({ env = process.env, db, run8 } = {}) {
  const { base, local } = assertTarget(env);
  if (!/^[A-F0-9]{8}$/.test(run8 || '')) throw new Error('RUN8_REQUIRED');
  if (local) {
    // Un serveur de test localhost ne peut pas écrire dans la vraie base staging.
    require('./hub-v1-certification-runner').assertEphemeralTarget(env.DATABASE_URL, []);
  }
  if (!local) {
    // Le chemin HTTP ecrit via les vraies routes : meme garde bloquante que
    // l'executeur officiel, avant tout login ou action sur staging.
    await require('./hub-v1-staging-target-authorization').authorizeOfficialStaging({ db, run: run8, env });
    const v = await (await fetch(base + '/health/version')).json();
    if (!/^[a-f0-9]{40}$/i.test(env.E2E_EXPECTED_DEPLOY_SHA || '') || String(v.commit).toLowerCase() !== env.E2E_EXPECTED_DEPLOY_SHA.toLowerCase()) throw new Error('STAGING_SHA_MISMATCH');
  }
  const report = { schema: 'hub-v1-http-actions/1', run8, base: local ? 'LOCAL_REHEARSAL' : 'OFFICIAL_STAGING', started_at: new Date().toISOString(), actions: [], not_covered: NOT_COVERED.map(([action, role, route]) => ({ action, role, candidate_route: route, verdict: 'NOT_COVERED' })) };
  const actors = {};
  for (const [label, prefix] of Object.entries(ROLE_ENV)) {
    const email = env[prefix + 'EMAIL']; const password = env[prefix + 'PASSWORD'];
    if (!email || !password) { report.actions.push({ key: `login:${label}`, actor: label, verdict: 'BLOCKED', note: 'identite E2E absente' }); continue; }
    const a = new Actor(label, base, email, password);
    try { await a.login(); actors[label] = a; report.actions.push({ key: `login:${label}`, actor: label, route: 'POST /api/auth/login', http: 200, role_observed: a.role, verdict: 'PASS' }); } catch (e) { report.actions.push({ key: `login:${label}`, actor: label, verdict: 'BLOCKED', note: String(e.message) }); }
  }
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const orders = await q("SELECT id, reference FROM orders WHERE reference LIKE $1 ORDER BY reference", [`E2E-HUB-V1-${run8}-%`]);
  if (orders.length !== 4) throw new Error(`FIXTURE_ORDERS_EXPECTED_4:${orders.length}`);
  const ref = (s) => orders.find((o) => o.reference.endsWith(s)).id;

  // Enregistrement d'une action : attendu vs observe, jamais de PASS implicite.
  const rec = async (key, actorLabel, method, route, body, expect, extra = {}) => {
    const actor = actors[actorLabel];
    const row = { key, actor: actorLabel, route: `${method} ${route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`, expected_http: expect.http, verdict: 'FAIL' };
    report.actions.push(row);
    if (!actor) { row.verdict = 'BLOCKED'; row.note = 'acteur non connecte'; return null; }
    const r = await actor.call(method, route, body);
    Object.assign(row, { http: r.http, code: r.code });
    const httpOk = Array.isArray(expect.http) ? expect.http.includes(r.http) : r.http === expect.http;
    const codeOk = !expect.code || r.code === expect.code;
    if (r.code === 'csrf_origin_required') { row.verdict = 'FAIL'; row.note = 'HARNAIS : en-tete Origin manquant (refus CSRF, pas un refus metier)'; return r; }
    row.verdict = httpOk && codeOk ? 'PASS' : (r.http === 403 && !expect.deny ? 'BLOCKED' : 'FAIL');
    if (row.verdict === 'BLOCKED') row.note = `action refusee a son role prevu (${r.code || r.http}) : ACTION BLOQUEE`;
    if (row.verdict === 'PASS' && extra.after) { try { Object.assign(row, await extra.after(r)); } catch (e) { row.verdict = 'FAIL'; row.note = String(e.message).slice(0, 200); } }
    return r;
  };

  // SEAM explicite : l'ouverture des lignes d'achat n'a pas de route HTTP propre (declenchee par le paiement confirme).
  const trigger = require('../../services/purchasing-trigger-service');
  process.env.ADMIN_PHONE = '';
  for (const s of ['KOM-101', 'KOM-102']) await trigger.triggerPurchasing(ref(s));
  report.actions.push({ key: 'purchase-lines-open', actor: 'service-seam', route: 'purchasing-trigger-service.triggerPurchasing (aucune route HTTP dediee)', verdict: 'SEAM_NOT_HTTP', note: 'declenche par paiement/caisse en production ; paiement fixture simule' });

  const lines = await q(`SELECT pl.id, pl.supplier_id, pl.purchase_order_id, oi.product_id FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
                          WHERE oi.order_id = ANY($1::uuid[]) AND pl.cancelled_at IS NULL ORDER BY pl.id`, [[ref('KOM-101'), ref('KOM-102')]]);
  const bySupplier = new Map();
  for (const l of lines) { if (!bySupplier.has(l.supplier_id)) bySupplier.set(l.supplier_id, []); bySupplier.get(l.supplier_id).push(l); }
  const pos = {};
  let i = 0;
  for (const [supplier, ls] of bySupplier) {
    const label = String.fromCharCode(65 + i++);
    const lineIds = ls.map((l) => l.id);
    const prep = { supplier_id: supplier, procurement_hub_ref: 'DXB', line_ids: lineIds, execution_mode: 'manual' };
    for (const bad of ['agent_relais', 'market_operator']) await rec(`po-${label}:prepare:deny:${bad}`, bad, 'POST', '/api/purchasing/po/prepare', prep, { http: 403, deny: true });
    const r = await rec(`po-${label}:prepare`, 'hub_agent', 'POST', '/api/purchasing/po/prepare', prep, { http: 201 }, {
      after: async (res) => {
        const id = res.json.purchase_order && res.json.purchase_order.id; if (!id) throw new Error('PO_ID_ABSENT');
        pos[label] = id;
        const rb = await actors.hub_agent.call('GET', `/api/purchasing/po/${id}`);
        const [pg] = await q('SELECT status::text AS status FROM purchase_orders WHERE id=$1', [id]);
        if (rb.http !== 200 || pg.status !== 'draft') throw new Error(`READBACK:${rb.http}/${pg.status}`);
        return { readback: { http: rb.http }, pg: { status: pg.status } };
      } });
    if (!r || !pos[label]) continue;
    const id = pos[label];
    const decide = (type, who, body, exp, key, after) => rec(`po-${label}:${key}`, who, 'POST', `/api/purchasing/po/${id}/${type}`, body, exp, { after });
    const authPg = async (type) => (await q('SELECT decided_by, amount::float AS amount, currency FROM purchase_order_authorizations WHERE purchase_order_id=$1 AND authorization_type=$2', [id, type]));
    // Engagement : refus pour les mauvais roles, puis responsable Hub.
    const cbody = { proof_ref: `SIM-ENGAGEMENT-${run8}-${label}` };
    await decide('authorize-commitment', 'market_operator', cbody, { http: 403, deny: true }, 'commitment:deny:market_operator'); // refuse par le garde de role avant le grant
    for (const who of ['hub_agent', 'admin']) await decide('authorize-commitment', who, cbody, { http: 403, code: 'AUTHORIZATION_GRANT_REQUIRED', deny: true }, `commitment:deny:${who}`);
    await rec(`po-${label}:submit:before-commitment`, 'hub_agent', 'POST', `/api/purchasing/po/${id}/submit`, {}, { http: 409, code: 'PURCHASE_COMMITMENT_NOT_AUTHORIZED', deny: true });
    await decide('authorize-commitment', 'hub_director', cbody, { http: [200, 201] }, 'commitment', async () => {
      const rows = await authPg('purchase_commitment'); if (rows.length !== 1) throw new Error(`COMMITMENT_ROWS:${rows.length}`);
      const rb = await actors.hub_director.call('GET', `/api/purchasing/po/${id}`); if (rb.http !== 200) throw new Error('READBACK_' + rb.http);
      return { readback: { http: rb.http }, pg: { rows: rows.length, amount: rows[0].amount, currency: rows[0].currency } };
    });
    const commit = (await authPg('purchase_commitment'))[0];
    await decide('submit', 'hub_agent', {}, { http: 200 }, 'submit', async () => {
      const [pg] = await q('SELECT status::text AS status FROM purchase_orders WHERE id=$1', [id]);
      return { pg: { status: pg.status } };
    }).then((res) => { const row = report.actions[report.actions.length - 1]; if (res && res.json) { row.channel = res.json.notification && res.json.notification.channel; row.place_order_invoked = res.json.place_order_invoked; if (row.verdict === 'PASS' && (row.channel !== 'simulation_no_notification' || row.place_order_invoked !== false)) { row.verdict = 'FAIL'; row.note = 'EFFET EXTERNE POSSIBLE : canal non simule'; } } });
    await rec(`po-${label}:submit:replay`, 'hub_agent', 'POST', `/api/purchasing/po/${id}/submit`, {}, { http: [400, 409], deny: true });
    await decide('sent', 'hub_agent', { channel: 'phone', note: `ENVOI FOURNISSEUR SIMULE ${run8}` }, { http: 200 }, 'sent', async () => {
      const [pg] = await q('SELECT status::text AS status, sent_channel FROM purchase_orders WHERE id=$1', [id]); return { pg };
    });
    // Paiement fournisseur : agent Hub refuse, directrice autorisee (decision distincte de l'engagement).
    const pbody = { proof_ref: `SIM-PAIEMENT-FOURNISSEUR-${run8}-${label}`, amount: commit && commit.amount, currency: commit && commit.currency };
    await decide('authorize-payment', 'hub_agent', pbody, { http: 403, code: 'AUTHORIZATION_GRANT_REQUIRED', deny: true }, 'payment:deny:hub_agent');
    await decide('authorize-payment', 'hub_director', pbody, { http: [200, 201] }, 'payment', async () => {
      const rows = await authPg('supplier_payment'); if (rows.length !== 1) throw new Error(`PAYMENT_ROWS:${rows.length}`);
      const [{ n }] = await q('SELECT count(*)::int AS n FROM supplier_execution_payments');
      return { pg: { rows: rows.length, supplier_execution_payments_total: n } };
    });
    const lines2 = await q('SELECT id, quantity FROM purchase_lines WHERE purchase_order_id=$1 AND cancelled_at IS NULL', [id]);
    // A2 : meme en recette, une confirmation manuelle doit declarer un vendeur distinct du Hub central.
    // Identite explicitement simulee, canalisable vers manual_purchase_executions ; aucune sortie fournisseur reelle.
    const sellerLabel = `VENDEUR-RECETTE-${run8}-${label}`;
    const cbody2 = { purchase_proof_ref: `SIM-RECU-${run8}-${label}`, supplier_order_id: `SIM-SO-${run8}-${label}`,
      seller_label: sellerLabel, channel: 'in_person',
      lines: lines2.map((l) => ({ purchase_line_id: l.id, confirmed_quantity: l.quantity })) };
    await decide('confirm', 'hub_agent', { ...cbody2, purchase_proof_ref: '' }, { http: [400, 409, 422], deny: true }, 'confirm:no-proof');
    await decide('confirm', 'hub_agent', cbody2, { http: 200 }, 'confirm', async () => {
      const [pg] = await q('SELECT status::text AS status FROM purchase_orders WHERE id=$1', [id]);
      if (['draft', 'notified', 'cancelled'].includes(pg.status)) throw new Error('CONFIRM_STATUS_' + pg.status);
      const [{ n, qty }] = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(quantity),0)::int AS qty
        FROM manual_purchase_executions WHERE purchase_order_id=$1 AND seller_label=$2 AND channel='in_person'`, [id, sellerLabel]);
      const expectedQty = lines2.reduce((total, line) => total + Number(line.quantity), 0);
      if (n !== lines2.length || qty !== expectedQty) throw new Error(`MANUAL_SELLER_EXECUTION_READBACK:${n}/${qty}`);
      return { pg, seller_proof: { executions: n, quantity: qty, channel: 'in_person', simulated: true } };
    });
  }
  report.finished_at = new Date().toISOString();
  const counts = report.actions.reduce((m, a) => { m[a.verdict] = (m[a.verdict] || 0) + 1; return m; }, {});
  report.counts = counts;
  report.verdict = (counts.FAIL || 0) + (counts.BLOCKED || 0) > 0 ? 'HTTP_ACTIONS_FAIL_OR_BLOCKED' : 'HTTP_PO_CHAIN_PASS_PHYSICAL_CHAIN_NOT_COVERED';
  report.limits = ['Seuls la chaine PO (preparation -> confirmation) et ses refus de roles sont couverts', 'Actions physiques, expedition, relais, retrait, circuit local : NOT_COVERED', 'Le declenchement des lignes d achat est un seam service, pas une route HTTP'];
  return report;
}

async function main() {
  const db = require('../../db');
  try {
    const run8 = String(process.env.HTTP_RUNNER_RUN8 || '').toUpperCase();
    const report = await run({ db, run8 });
    const dir = process.env.HTTP_RUNNER_OUT || 'test-results/hub-v1-http';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `hub-v1-http-actions-${run8}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ verdict: report.verdict, counts: report.counts }));
    process.exitCode = report.verdict.startsWith('HTTP_PO_CHAIN_PASS') ? 0 : 1;
  } finally { if (db.pool && db.pool.end) await db.pool.end(); }
}
if (require.main === module) main().catch((e) => { console.error('HTTP_RUNNER_REFUSED:' + String(e.message).slice(0, 200)); process.exitCode = 2; });
module.exports = { run, Actor, assertTarget, NOT_COVERED };
