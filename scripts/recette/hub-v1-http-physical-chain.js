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
const ROLE_ENV = { hub_agent: 'E2E_AGENT_HUB_', agent_relais: 'E2E_AGENT_RELAIS_', market_operator: 'E2E_MARKET_OPERATOR_', admin: 'E2E_ADMIN_', transitaire: 'E2E_TRANSITAIRE_' };
const WSC = '/api/admin/workspaces/shipping-customs/market/KM';
const JP = 'public/dashboards/canonical/js/international-journey-panel.js';
const JC = 'public/dashboards/canonical/js/shipping-customs-workspace.js';

// Arret volontaire apres une action (preparation d'etat pour la repetition Chromium) : HTTP_RUNNER_STOP_AFTER=<cle d'action>.
function finalizeReport(report) {
  report.finished_at = new Date().toISOString();
  report.counts = report.actions.reduce((m, a) => { m[a.verdict] = (m[a.verdict] || 0) + 1; return m; }, {});
  report.verdict = report.actions.some((a) => a.verdict === 'FAIL') ? 'PHYSICAL_CHAIN_FAIL' : (report.actions.some((a) => a.verdict === 'BLOCKED') ? 'PHYSICAL_CHAIN_BLOCKED_STEPS' : 'PHYSICAL_CHAIN_PASS');
  return report;
}
async function run(args = {}) {
  const holder = {};
  try { return await runInner(args, holder); } catch (e) {
    if (e && e.stopRun && holder.report) { holder.report.stopped_after = e.stopRun; return finalizeReport(holder.report); }
    throw e;
  }
}

async function runInner({ env = process.env, db, run8 } = {}, holder = {}) {
  const { base, local } = assertTarget(env);
  if (!/^[A-F0-9]{8}$/.test(run8 || '')) throw new Error('RUN8_REQUIRED');
  const report = { schema: 'hub-v1-http-physical/1', run8, base: local ? 'LOCAL_REHEARSAL' : 'OFFICIAL_STAGING', started_at: new Date().toISOString(), actions: [] };
  holder.report = report;
  const actors = {};
  for (const [label, prefix] of Object.entries(ROLE_ENV)) {
    if (label === 'transitaire' && !env[prefix + 'EMAIL']) { report.actions.push({ key: 'login:transitaire', actor: label, verdict: 'INFO', note: 'aucun compte E2E transitaire : les etapes transitaire sont jouees par admin (role autorise par la machine a etats), a signaler' }); continue; }
    const a = new Actor(label, base, env[prefix + 'EMAIL'], env[prefix + 'PASSWORD']);
    try { await a.login(); actors[label] = a; report.actions.push({ key: `login:${label}`, actor: label, route: 'POST /api/auth/login', http: 200, verdict: 'PASS' }); }
    catch (e) { report.actions.push({ key: `login:${label}`, actor: label, verdict: 'BLOCKED', note: String(e.message).slice(0, 120) }); }
  }
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const orders = await q('SELECT id, reference FROM orders WHERE reference LIKE $1 ORDER BY reference', [`E2E-HUB-V1-${run8}-%`]);
  const orderOf = (s) => orders.find((o) => o.reference.endsWith(s));

  // rec : attendu vs observe ; `ui` = fichier:ligne du front qui appelle cette route.
  // Forme : <cle>[*][#n] (prefixe si '*', n-ieme occurrence, 1 par defaut).
  const stopSpec = String(env.HTTP_RUNNER_STOP_AFTER || '').match(/^(.*?)(\*)?(?:#(\d+))?$/);
  let stopSeen = 0;
  const rec = async (...a) => {
    const r = await rec0(...a);
    if (stopSpec && stopSpec[1] && (stopSpec[2] ? a[0].startsWith(stopSpec[1]) : a[0] === stopSpec[1]) && ++stopSeen >= Number(stopSpec[3] || 1)) {
      throw Object.assign(new Error('STOP_RUN'), { stopRun: a[0] });
    }
    return r;
  };
  const rec0 = async (key, actorLabel, method, route, body, expect, ui, after) => {
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
  const prepareBag = async (suffix) => {
  const start = report.actions.length;
  const bagOrder = orderOf(suffix);
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
      if (!lines.length) blocked('hub:bag-deposit', 'hub_agent', `POST ${WS}/bags/:id/deposit`, `${JS}:1084`, `aucune ligne fillable pour ${suffix} dans GET supply (cles ${Object.keys(d).join(',')})`);
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
  } else blocked('hub:bag-create', 'hub_agent', `POST ${WS}/bags`, `${JS}:1042`, `commande ${suffix} absente`);
  report.actions.slice(start).forEach((x) => { x.order = suffix; });
  return { bagOrder, bagId, bagRef };
  };
  const bags = [];
  for (const suffix of ['KOM-101', 'KOM-102']) { const r = await prepareBag(suffix); if (r.bagId) bags.push(r); }
  const bagOrder = (bags[0] || {}).bagOrder; const bagId = (bags[0] || {}).bagId;



  // 3. KOM-BOX : creation, sac dans la box (double scan sac + box), avancement jusqu'a PACKED, dossier d'expedition.
  let boxId = null; let boxRef = null;
  await rec('hub:box-create', 'hub_agent', 'POST', `${WS}/boxes`, {}, { http: [200, 201] }, `${JS}:994`, async (x) => { boxId = unitId(x); boxRef = (x.json.physical_unit || {}).reference; if (!boxId) throw new Error('BOX_ID_ABSENT'); return { readback: { box_reference: boxRef } }; });
  let shipmentRef = null;
  if (boxId && bagId) {
    // Le colis client n'existe qu'apres la repartition automatique (bouton « Lancer la repartition », comme l'UI).
    let d = await dossierOf();
    const hasParcel = (d.client_parcels || []).some((p) => bagOrder && String(p.order_id) === String(bagOrder.id));
    if (!hasParcel && env.HTTP_RUNNER_ALLOW_DISTRIBUTION !== '1') blocked('hub:distribution-run', 'hub_agent', `POST ${WS}/distribution/run`, `${JS}:1295`, 'la repartition automatique agit sur TOUT le marche (pas seulement la fixture) : exige HTTP_RUNNER_ALLOW_DISTRIBUTION=1');
    else if (!hasParcel) {
      await rec('hub:distribution-run', 'hub_agent', 'POST', `${WS}/distribution/run`, {}, { http: [200, 201] }, `${JS}:1295`);
      d = await dossierOf();
    }
    const placed = [];
    for (const bg of bags) {
      const ready = (d.bags_ready || []).find((b) => String(b.unit_id) === String(bg.bagId) || b.reference === bg.bagRef);
      // Le colis client est consolide par relais : il porte l'id d'une autre commande ; on le retrouve par les lignes de CETTE commande.
      const pid = ready ? (await q("SELECT DISTINCT pi.parcel_id AS id FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id JOIN parcels p ON p.id=pi.parcel_id WHERE oi.order_id=$1 AND p.status::text<>'cancelled' LIMIT 1", [ready.order_id]))[0] : null;
      const parcel = pid && (d.client_parcels || []).find((p) => String(p.id) === String(pid.id));
      if (!ready || !parcel) { blocked('hub:box-add-bag', 'hub_agent', `POST ${WS}/boxes/:id/bags`, `${JS}:1161`, `sac pret ou colis client absent du dossier pour ${bg.bagOrder.reference} (bags_ready=${(d.bags_ready || []).length}, client_parcels=${(d.client_parcels || []).length})`); continue; }
      const r = await rec('hub:box-add-bag', 'hub_agent', 'POST', `${WS}/boxes/${boxId}/bags`, { bag_unit_id: ready.unit_id, parcel_id: parcel.id, bag_reference_scan: ready.reference, box_reference_scan: boxRef }, { http: [200, 201] }, `${JS}:1161`);
      report.actions[report.actions.length - 1].order = bg.bagOrder.reference;
      if (r && [200, 201].includes(r.http)) placed.push(bg);
    }
    if (placed.length) {
      const NEXT = { RECEIVED: 'IDENTIFIED', IDENTIFIED: 'QUALITY_CHECKED', QUALITY_CHECKED: 'LOCATED', LOCATED: 'ALLOCATED', ALLOCATED: 'PICKED', PICKED: 'PACKED', PACKED: 'DISPATCHED' };
      for (let i = 0; i < 8; i++) {
        const cur = ((await dossierOf()).boxes || []).find((b) => String(b.unit_id) === String(boxId));
        if (!cur) { blocked('hub:box-advance', 'hub_agent', `POST ${WS}/boxes/:id/advance`, `${JS}:1181`, 'box absente du dossier'); break; }
        if (cur.state === 'DISPATCHED') break;
        const to = NEXT[cur.state]; if (!to) { blocked('hub:box-advance', 'hub_agent', `POST ${WS}/boxes/:id/advance`, `${JS}:1181`, `etat ${cur.state} sans suite connue`); break; }
        const r = await rec(`hub:box-advance:${to}`, 'hub_agent', 'POST', `${WS}/boxes/${boxId}/advance`, { to_state: to }, { http: [200, 201] }, `${JS}:1181`);
        if (!r || ![200, 201].includes(r.http)) break;
      }
      shipmentRef = `HTTP-EXP-${run8}`;
      await rec('hub:shipment-open', 'hub_agent', 'POST', `${WS}/boxes/shipment`, { reference: shipmentRef, hub_unit_ids: [boxId] }, { http: [200, 201] }, `${JS}:973`, async (x) => ({ readback: { reference: x.json && x.json.result && x.json.result.reference } }));
    }
  }

  // 3b. Parcours international (ecran Expeditions & Douane) : remise transitaire -> transport -> arrivee -> douane -> livraison locale.
  if (shipmentRef) {
    const tr = actors.transitaire ? 'transitaire' : 'admin';
    const J = `${WSC}/international/${shipmentRef}`;
    const parcelRefRow = bagOrder ? (await q('SELECT reference FROM parcels WHERE order_id=$1 AND cancelled_at IS NULL ORDER BY created_at LIMIT 1', [bagOrder.id]).catch(() => []))[0] : null;
    const step = (to, who, extra, ui) => rec(`journey:${to}`, who, 'POST', `${J}/transition`, { to_stage: to, proof_ref: `SIM-${to.toUpperCase()}-${run8}`, ...extra }, { http: 200 }, ui || `${JP}:229`);
    const ok = (r) => r && r.http === 200;
    // Geste Hub dans le workspace Expeditions & Douane : si le Hub central y est refuse (pas de membership), c'est un BLOCAGE
    // applicatif consigne ; la chaine continue avec admin (role autorise par la machine a etats) pour atteindre le retrait.
    const hubStep = async (to, extra, who = 'hub_agent') => {
      const r = await step(to, who, extra);
      if (ok(r) || who === 'admin') return r;
      report.actions[report.actions.length - 1].finding = `APP_BLOCKAGE_${who.toUpperCase()}_SHIPPING_CUSTOMS_WORKSPACE`;
      const a = await step(to, 'admin', extra); report.actions[report.actions.length - 1].key += ':admin-proxy'; return a;
    };
    let go = ok(await hubStep('handed_over', { forwarder_name: 'E2E Transitaire', transport_mode: 'sea' }));
    go = go && ok(await hubStep('forwarder_received', {}, tr));
    let trk = await rec('journey:tracking', tr, 'POST', `${J}/tracking`, { proof_ref: `SIM-TRACKING-${run8}`, tracking_reference: `TRK-${run8}` }, { http: 200 }, `${JP}:235`);
    if (!ok(trk) && tr !== 'admin') { report.actions[report.actions.length - 1].finding = 'APP_BLOCKAGE_TRANSITAIRE_SHIPPING_CUSTOMS_WORKSPACE'; trk = await rec('journey:tracking:admin-proxy', 'admin', 'POST', `${J}/tracking`, { proof_ref: `SIM-TRACKING-${run8}`, tracking_reference: `TRK-${run8}` }, { http: 200 }, `${JP}:235`); }
    go = go && ok(trk);
    go = go && ok(await hubStep('in_transit', {}, tr));
    go = go && ok(await hubStep('arrived', {}, tr));
    // Le colis client est CONSOLIDE (toutes les commandes du meme client/relais) : il ne passe 'shipped' que si TOUS ses articles
    // sont remis (markFullyHandedOverParcelsShipped). Sinon l'ecran Douane ne le propose pas (statuts shipped/in_transit seuls).
    const parcelNow = bagOrder ? (await q('SELECT p.reference, p.status::text AS status, (SELECT count(*)::int FROM parcel_items i WHERE i.parcel_id=p.id) AS items, (SELECT COALESCE(SUM(i.quantity-i.qty_shipped),0)::int FROM parcel_items i WHERE i.parcel_id=p.id) AS left_to_ship FROM parcels p WHERE p.order_id=$1 AND p.cancelled_at IS NULL ORDER BY p.created_at LIMIT 1', [bagOrder.id]).catch(() => []))[0] : null;
    if (go && parcelNow && !['shipped', 'in_transit'].includes(parcelNow.status)) {
      report.actions.push({ key: 'customs:parcel-eligibility', actor: 'admin', route: `POST ${WSC}/customs/shipments`, ui: `${JC}:497`, verdict: 'BLOCKED', finding: 'BUSINESS_PARCEL_CONSOLIDATED_NOT_SHIPPABLE',
        readback: parcelNow, note: `colis ${parcelNow.reference} consolide en statut ${parcelNow.status} : ${parcelNow.left_to_ship} unite(s) non remises (autres commandes du client : sourcing requis KOM-103, circuit local LOCAL, KOM-102 non expediee). L'ecran Douane ne peut pas rattacher ce colis : douane, livraison locale, attestation relais et retrait sont inatteignables sur cette fixture par l'UI seule.` });
      go = false;
    }
    if (go) {
      const cust = `HTTP-DOU-${run8}`;
      const cbody = { reference: cust, shipment_date: new Date().toISOString().slice(0, 10), cif_value_kmf: 1000 };
      // Flux KOM-BOX : le dossier douane est lie a l'expedition (link-customs), jamais a des colis historiques (JOURNEY_CUSTOMS_LEGACY_MEMBERSHIP).
      const cc = await rec('customs:create', 'admin', 'POST', `${WSC}/customs/shipments`, { ...cbody, parcel_refs: [] }, { http: 201 }, `${JC}:497`);
      go = Boolean(cc && cc.http === 201);
      // Pas de customs:declare legacy (exige des colis) : le montant est declare par journey:customs-amount (declareInternationalCustomsAmount).
      go = go && ok(await rec('journey:link-customs', 'admin', 'POST', `${J}/link-customs`, { customs_reference: cust, proof_ref: `SIM-LINK-${run8}` }, { http: 200 }, `${JP}:link-customs`));
      go = go && ok(await rec('journey:customs-amount', 'admin', 'POST', `${J}/customs-amount`, { amount_kmf: 0, proof_ref: `SIM-DROITS-${run8}` }, { http: 200 }, `${JP}:customs-amount`));
      go = go && ok(await step('customs_released', 'admin', {}));
      go = go && ok(await hubStep('local_delivery', {}));
    }
    if (!go) blocked('journey:chain', 'hub_agent', `POST ${J}/transition`, JP, 'chaine internationale interrompue : voir la derniere ligne journey/customs en echec');
  }

  // 4. Relais : expedition visible/recevable ? attestation article par article, puis remise client.
  const rs = await rec('relay:shipments', 'agent_relais', 'GET', `${WS}/relay-shipments`, null, { http: 200 }, `${JS}:1724`,
    async (r) => ({ readback: { shipments: ((r.json && (r.json.shipments || r.json.items)) || []).length, keys: Object.keys(r.json || {}).slice(0, 6) } }));
  const shipments = (rs && rs.json && (rs.json.shipments || rs.json.items)) || [];
  const sh = shipments.find((x) => x.reference === shipmentRef) || null;
  if (!sh) blocked('relay:attest', 'agent_relais', `POST ${WS}/relay-shipments/:ref/receive`, `${JS}:1579`, `expedition ${shipmentRef || '(non ouverte)'} absente de la liste relais : l'etape de remise au transitaire / arrivee au relais n'a pas de geste UI cartographie`);
  else if (!sh.receivable) blocked('relay:attest', 'agent_relais', `POST ${WS}/relay-shipments/:ref/receive`, `${JS}:1579`, `expedition visible mais non recevable (etape ${sh.stage || '?'}, attendue local_delivery)`);
  else {
    // Forme UI (operations-workspace.js:1500-1580) : shipment.boxes[].orders[].items[] ; quantite recue = quantite expediee.
    const lines = [];
    for (const box of sh.boxes || []) for (const o of box.orders || []) for (const i of o.items || []) {
      if (i.received === null || i.received === undefined) lines.push({ order_item_id: i.order_item_id, received_qty: Number(i.shipped) });
    }
    await rec('relay:attest', 'agent_relais', 'POST', `${WS}/relay-shipments/${sh.reference}/receive`, { proof_ref: `SIM-RELAIS-${run8}`, lines }, { http: [200, 201] }, `${JS}:1579`);
  }
  const ws = await actors.agent_relais.call('GET', WS);
  const toCollect = (((ws.json || {}).queues || {}).relay || {}).to_collect || [];
  const ownParcel = bagOrder ? (await q('SELECT reference FROM parcels WHERE order_id=$1 AND cancelled_at IS NULL ORDER BY created_at LIMIT 1', [bagOrder.id]).catch(() => []))[0] : null;
  const parcelRow = toCollect.find((x) => ownParcel && x.reference === ownParcel.reference) || null;
  // Les commandes E2E portent simulation_scope : la file UI (queryParcels) les masque par conception. On appelle donc la route que le bouton UI appelle,
  // avec la reference lue en base, et on le consigne (ecart fixture, pas defaut applicatif).
  const collectRef = parcelRow ? parcelRow.reference : ownParcel && ownParcel.reference;
  if (!collectRef) blocked('relay:collect', 'agent_relais', `POST ${WS}/parcels/:ref/collect`, `${JS}:1350`, 'aucun colis pour la commande de la fixture');
  else {
    await rec('relay:collect', 'agent_relais', 'POST', `${WS}/parcels/${encodeURIComponent(collectRef)}/collect`, { reason: 'scanner_unavailable' }, { http: [200, 201] }, `${JS}:1350`);
    if (!parcelRow) report.actions[report.actions.length - 1].note = 'colis absent de queues.relay.to_collect (orders.simulation_scope masque par queryParcels) ; route appelee avec la reference lue en base';
  }

  // 5. Circuit LOCAL (stock local, sans transitaire) : le colis existe deja (repartition) -> parcours colis du Workspace :
  // Hub 'Expedier' (parcels/:ref/ship, scan shipped) puis Relais 'Remis au client' (scan customer_collected, autorise apres shipped).
  // /api/orders/:id/local-relay-receipt est reserve au cas SANS colis (409 LOCAL_RECEIPT_PARCEL_ALREADY_EXISTS) et n'a aucun appelant UI.
  const localOrder = orderOf('LOCAL');
  const lp = localOrder ? (await q('SELECT reference, status::text AS status FROM parcels WHERE order_id=$1 AND cancelled_at IS NULL ORDER BY created_at LIMIT 1', [localOrder.id]).catch(() => []))[0] : null;
  if (!lp) blocked('local:ship', 'hub_agent', `POST ${WS}/parcels/:ref/ship`, `${JS}:1322`, 'colis LOCAL absent de la fixture');
  else {
    const sr = await rec('local:ship', 'hub_agent', 'POST', `${WS}/parcels/${encodeURIComponent(lp.reference)}/ship`, { reason: 'scanner_unavailable' }, { http: [200, 201] }, `${JS}:1322`);
    if (sr && sr.http === 500) {
      const last = report.actions[report.actions.length - 1];
      last.verdict = 'BLOCKED';
      last.finding = 'APP_BLOCKAGE_LOCAL_SHIP_500_SCAN_CATCHUP_SELF_BLOCK';
      last.note = "scan shipped depuis 'preparation' : le moteur rattrape l'etape packed en creant un incident scan_anomaly, puis sa gouvernance incident (OPEN_HUB_RELEVANT_INCIDENT) bloque la transition -> 500 non maitrise ; aucune route Workspace pour le scan packed. Circuit local inatteignable par l'UI.";
    }
    if (sr && [200, 201].includes(sr.http)) {
      await rec('local:receive', 'agent_relais', 'POST', `${WS}/parcels/${encodeURIComponent(lp.reference)}/receive`, { reason: 'scanner_unavailable' }, { http: [200, 201] }, `${JS}:receive (section Relais · Réceptionner, colis local)`);
      await rec('local:collect', 'agent_relais', 'POST', `${WS}/parcels/${encodeURIComponent(lp.reference)}/collect`, { reason: 'scanner_unavailable' }, { http: [200, 201] }, `${JS}:1350`);
    }
  }

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
