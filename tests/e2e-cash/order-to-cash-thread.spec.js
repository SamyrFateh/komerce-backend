'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires postgres
 */

/**
 * Lot S3 — fil réel commande → encaissement → garde (niveau L4 local intégré, jamais L5 staging).
 *
 * Une seule commande traverse des routes applicatives RÉELLES, chacune par son propre acteur et sa
 * propre session : le client crée la commande (POST /api/orders), le relais confirme le cash, le hub
 * expédie, le relais réceptionne puis encaisse (POST /api/cash/collect), puis la chaîne de garde
 * (annonce → réception intermédiaire → remise finale → contrôle indépendant) repart du cash
 * RÉELLEMENT encaissé par le fil — plus d'encaissement injecté par SQL.
 *
 * Jusqu'où c'est prouvé : serveur Komerce + PostgreSQL réels, acteurs réels, SQL = oracle écrit ici.
 * Ce qui n'est PAS prouvé : aucun fournisseur (paiement électronique, transporteur, SMS/WhatsApp) :
 * le paiement est un cash relais, la logistique est portée par les scans de l'application, et la
 * recette échoue si un effet externe (notification/outbox) apparaît. Aucune purge des faits financiers.
 * Rapport : test-results/order-to-cash-thread/report.{json,md}.
 */
const fs = require('fs');
const path = require('path');
const { test, expect, request: pwRequest } = require('@playwright/test');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { createMarketDelegationFixture, READ_ONLY_CAPABILITIES } = require('../helpers/marketDelegationE2EKit');
const { projectAssignment, LEGACY_VIEWER_CAPABILITIES } = require('../../services/market-scope-projector');
const { PREFIX, PASSWORD, rnd, target, api, login, preflight, externalEffects, provisionActors } = require('./support');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'order-to-cash-thread');
const report = { level: 'L4 local intégré (jamais L5 staging)', target: null, started_at: new Date().toISOString(), steps: [], refusals: [], not_proven: [
  'paiement électronique réel (Stripe/PayPal/mobile money) : ce fil est un cash relais',
  'transporteur et fournisseur réels : la logistique est portée par les scans de l’application',
  'notifications SMS/WhatsApp réelles : leur absence est surveillée, jamais certifiée',
  'staging déployé (recette séparée)'] };
const q = (sql, p) => db.query(sql, p);
let fx; let base; let admin; let guard; let tag; let M; const who = {}; const sessions = {}; const ids = {};
const step = (text, detail) => report.steps.push({ text, detail: detail || null });
const call = (key, method, url, data) => api(sessions[key], method, url, data);
const ok = (res, label) => { expect(res.status, `${label}: ${res.status} ${JSON.stringify(res.json)}`).toBeLessThan(300); return res; };
const refuse = (name, res, codes = [403, 404, 409]) => {
  report.refusals.push({ name, status: res.status, code: (res.json && res.json.code) || null });
  expect(codes, `${name}: ${res.status} ${JSON.stringify(res.json)}`).toContain(res.status);
};
const histOf = async orderId => (await q('SELECT status::text s, changed_by FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id', [orderId])).rows;
const orderOf = async id => (await q('SELECT status::text status, payment_status::text payment_status, total_kmf::int total, market_id, reference FROM orders WHERE id = $1', [id])).rows[0];

test.describe.serial('Fil commande → encaissement → garde — routes réelles, acteurs réels', () => {
  test.beforeAll(async () => {
    const t = target(); base = t.base; report.target = t.host;
    admin = await pwRequest.newContext({ baseURL: base });
    guard = await preflight({ db, request: admin, adminEmail: 'admin@komerce.km', adminPassword: process.env.E2E_ADMIN_PASSWORD });
    report.preflight = { database: guard.database, monitored_tables: guard.monitors, started_at: guard.started_at };
    fx = await createMarketDelegationFixture(db);
    M = fx.marketA.code; tag = rnd();
    await q('UPDATE markets SET name = $2 WHERE id = $1', [fx.marketA.id, `${PREFIX} Thread ${tag}`]);
    const baseline = [...new Set([...READ_ONLY_CAPABILITIES, ...LEGACY_VIEWER_CAPABILITIES])].filter(c => fx.liveCapabilities.includes(c));
    const relais = (await q(`INSERT INTO relais(name,phone,address,market_id,island,island_code) VALUES ($1,'+2690000000','Adresse recette',$2,'Ngazidja','MORONI') RETURNING id`, [`${PREFIX} Relais thread ${tag}`, fx.marketA.id])).rows[0].id;
    const phone = () => `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`;
    const mkUser = async (key, role, relaisId) => {
      const { rows: [u] } = await q(`INSERT INTO users(full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,email`,
        [`${PREFIX} ${key} ${tag}`, `${PREFIX}.${key}.${tag}@e2e-cash.test`.toLowerCase(), phone(), role, relaisId || null]);
      who[key] = { id: u.id, email: u.email };
      return u;
    };
    await mkUser('client', 'client');
    const agentRelais = await mkUser('agentRelais', 'agent_relais', relais);
    const agentHub = await mkUser('agentHub', 'agent_hub');
    // CASH : second agent du même relais (second visa) et agent d'un AUTRE relais (contrôle cross-relais).
    await mkUser('agentRelais2', 'agent_relais', relais);
    const relaisOther = (await q(`INSERT INTO relais(name,phone,address,market_id,island,island_code) VALUES ($1,'+2690000001','Autre adresse',$2,'Ngazidja','MORONI') RETURNING id`, [`${PREFIX} Relais autre ${tag}`, fx.marketA.id])).rows[0].id;
    await mkUser('agentOther', 'agent_relais', relaisOther);
    const controller = await mkUser('controller', 'client');
    // Habilitations d'exécution accordées par la délégation officielle (plafond d'assignation + membre + projection).
    const exec = { [agentRelais.id]: ['execution.cash.confirm', 'execution.parcel.receive', 'execution.parcel.collect'], [agentHub.id]: ['execution.parcel.ship'] };
    for (const c of new Set(Object.values(exec).flat())) {
      await q(`INSERT INTO assignment_capability_ceiling(assignment_id,capability,granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [fx.assignmentA.id, c, fx.central.id]);
    }
    for (const [uid, caps] of [[agentRelais.id, [...baseline, ...exec[agentRelais.id]]], [agentHub.id, [...baseline, ...exec[agentHub.id]]], [controller.id, [...baseline, 'finance.act', 'cash_control.policy.manage', 'cash.custody.receive']]]) {
      const { rows: [mem] } = await q(`INSERT INTO assignment_memberships(assignment_id,user_id,status,granted_by) VALUES ($1,$2,'ACTIVE',$3) RETURNING id`, [fx.assignmentA.id, uid, fx.central.id]);
      for (const c of [...new Set(caps)]) await q(`INSERT INTO membership_capabilities(membership_id,capability,granted_by) VALUES ($1,$2,$3)`, [mem.id, c, fx.central.id]);
    }
    await projectAssignment(db, fx.assignmentA.id);
    who.controller.scope = 'viewer';
    who.collector = { id: fx.managerA.id, email: fx.managerA.email, scope: 'manager' };
    who.receiver = { id: fx.viewerA.id, email: fx.viewerA.email, scope: 'viewer' };
    await provisionActors({ db, admin, who, tag, defaultMarket: M, bcrypt });
    // Catalogue : un produit à prix local actif sur le Market (précondition métier de l'achat).
    const product = (await q(`INSERT INTO products(name,price_kmf,stock) VALUES ($1,50000,50) RETURNING id`, [`${PREFIX} Produit thread ${tag}`])).rows[0].id;
    await q(`INSERT INTO product_market_price_drafts(market_id,product_id,amount,currency,status,reason,authorized_at,authorization_snapshot,active_at)
             VALUES ($1,$2,50000,(SELECT currency FROM markets WHERE id = $1),'LOCAL_ACTIVE','E2E thread — activation directe de test',NOW(),'{}'::jsonb,NOW())`, [fx.marketA.id, product]);
    await q(`INSERT INTO product_market_exposure(product_id,market_id,commercial_exposure) VALUES ($1,$2,'ENABLED')
             ON CONFLICT (product_id, market_id) DO UPDATE SET commercial_exposure='ENABLED'`, [product, fx.marketA.id]);
    if (!(await q(`SELECT 1 FROM market_delivery_attestations WHERE market_id=$1 AND revoked_at IS NULL AND valid_until>NOW()`, [fx.marketA.id])).rows.length) {
      const carrier = (await q(`INSERT INTO carriers(name,type,is_active) VALUES ('E2E carrier','maritime',TRUE) RETURNING id`)).rows[0].id;
      await q(`INSERT INTO market_delivery_attestations(market_id,carrier_id,mode,origin_ref,freight_rate,rate_currency,rate_unit,transit_days,evidence_ref,attested_by,valid_until)
               VALUES ($1,$2,'SEA','E2E-ORIGIN',1,'KMF','PER_KG',30,'E2E-EVIDENCE',(SELECT id FROM users ORDER BY created_at LIMIT 1),NOW()+INTERVAL '30 days')`, [fx.marketA.id, carrier]);
    }
    ids.relais = relais; ids.product = product;
    report.fixtures = { market: M, tag, users: Object.fromEntries(Object.entries(who).map(([k, v]) => [k, v.email])) };
    for (const key of Object.keys(who)) {
      const context = await pwRequest.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
      await login(context, who[key].email, PASSWORD);
      sessions[key] = context;
    }
  });

  test.afterAll(async () => {
    for (const s of Object.values(sessions)) await s.dispose().catch(() => {});
    await admin?.dispose();
    report.finished_at = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const md = ['# Fil commande → encaissement → garde — niveau L4 local intégré', '',
      `Cible : ${report.target} (serveur et base de test ; jamais un staging déployé). Market synthétique : ${M}.`, '',
      '## Étapes prouvées (routes réelles, acteurs réels)', ...report.steps.map(s => `- ✅ ${s.text}${s.detail ? ` — ${s.detail}` : ''}`), '',
      '## Refus vérifiés', ...report.refusals.map(r => `- ✅ ${r.name} → ${r.status}${r.code ? ` (${r.code})` : ''}`), '',
      '## Observations à arbitrer', ...(report.observations || []).map(o => `- ⚠️ ${o}`), '', '## Non prouvé par cette recette', ...report.not_proven.map(n => `- ${n}`), '',
      '## Fixtures (identifiables, faits financiers conservés)', '```json', JSON.stringify(report.fixtures, null, 2), '```'];
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
    await db.end?.();
  });

  test('1 · le client crée sa commande cash relais par la route publique', async () => {
    const res = ok(await call('client', 'POST', '/api/orders', {
      items: [{ product_id: ids.product, quantity: 2 }], relais_id: ids.relais, payment_mode: 'cash_relais',
      recipient_name: 'Destinataire thread', recipient_phone: '+269000333', tracking_phone: '+269000333',
    }), 'création commande');
    ids.order = res.json.order.id; ids.ref = res.json.order.reference;
    const o = await orderOf(ids.order);
    expect(o).toMatchObject({ payment_status: 'pending', total: Math.round((2 * 50000 * 3) / 4) /* 100 000 XAF = 75 000 KMF (parité 4/3) */, market_id: fx.marketA.id });
    ids.total = o.total;
    step('Client : commande créée par POST /api/orders', `${ids.ref}, ${o.total} KMF, statut ${o.status}, paiement ${o.payment_status}`);
  });

  const wsApi = suffix => `/api/admin/workspaces/operations/market/${M}/${suffix}`;
  const parcelOf = async () => (await q('SELECT id, reference, status::text status FROM parcels WHERE order_id = $1 ORDER BY created_at LIMIT 1', [ids.order])).rows[0];
  const collectionsOf = async () => (await q('SELECT amount_kmf::int amount, collected_by FROM cash_collections WHERE order_id = $1', [ids.order])).rows;

  test('2 · le relais confirme le cash par la route de paiement : paiement, encaissement et traçabilité naissent de SA route', async () => {
    const code = (await q('SELECT cash_ref_code c FROM orders WHERE id = $1', [ids.order])).rows[0].c;
    expect(code, 'la commande cash porte un code de référence cash').toBeTruthy();
    refuse('le client ne peut pas confirmer le cash', await call('client', 'POST', '/api/payments/cash/confirm', { cash_ref_code: code }));
    expect(await collectionsOf()).toHaveLength(0);
    ok(await call('agentRelais', 'POST', '/api/payments/cash/confirm', { cash_ref_code: code }), 'cash/confirm');
    const o = await orderOf(ids.order);
    expect(o.payment_status).toBe('paid');
    expect(await collectionsOf()).toEqual([{ amount: ids.total, collected_by: who.agentRelais.id }]);
    refuse('double confirmation refusée', await call('agentRelais', 'POST', '/api/payments/cash/confirm', { cash_ref_code: code }), [400, 404, 409]);
    expect(await collectionsOf()).toHaveLength(1);
    ids.parcel = await parcelOf();
    step('Relais : cash confirmé et encaissé une seule fois par sa route', `paiement ${o.payment_status}, commande ${o.status}, encaissement ${ids.total} KMF, colis ${ids.parcel ? ids.parcel.reference : 'aucun'}`);
  });

  test('3 · le hub prépare et expédie, le relais réceptionne : chaque statut ne bouge que par sa frontière', async () => {
    const hub = suffix => `/api/hub-dash/${suffix}`;
    refuse('le client ne peut pas préparer', await call('client', 'POST', hub(`orders/${ids.order}/start-prep`), {}));
    expect((await orderOf(ids.order)).status).not.toBe('preparation');
    ok(await call('agentHub', 'POST', hub(`orders/${ids.order}/start-prep`), {}), 'start-prep');
    expect((await orderOf(ids.order)).status).toBe('preparation');
    const items = (await q('SELECT id FROM order_items WHERE order_id = $1', [ids.order])).rows.map(r => r.id);
    expect(items.length).toBeGreaterThan(0);
    const created = ok(await call('agentHub', 'POST', hub(`orders/${ids.order}/create-parcel`), { item_ids: items }), 'create-parcel');
    ids.parcel = { id: created.json.parcel.id, reference: created.json.parcel.reference };
    ok(await call('agentHub', 'POST', hub(`parcels/${ids.parcel.id}/ready`), {}), 'colis prêt');
    refuse('le relais ne peut pas expédier à la place du hub', await call('agentRelais', 'POST', wsApi(`parcels/${ids.parcel.reference}/ship`), {}));
    ok(await call('agentHub', 'POST', hub(`parcels/${ids.parcel.id}/ship`), { transport: 'E2E thread' }), 'ship');
    const afterShip = await orderOf(ids.order);
    expect(['shipped', 'in_transit']).toContain(afterShip.status);
    refuse('le hub ne peut pas réceptionner à la place du relais', await call('agentHub', 'POST', wsApi(`parcels/${ids.parcel.reference}/receive`), {}));
    ok(await call('agentRelais', 'POST', wsApi(`parcels/${ids.parcel.reference}/receive`), {}), 'receive');
    const afterReceive = await orderOf(ids.order);
    expect(afterReceive.status).toBe('available');
    step('Hub puis relais : préparation, colis, expédition et réception par leurs routes', `après expédition ${afterShip.status}, après réception ${afterReceive.status}`);
  });

  test('4 · le relais remet le colis : commande collectée, trace de chaque frontière, cash inchangé', async () => {
    ok(await call('agentRelais', 'POST', wsApi(`parcels/${ids.parcel.reference}/collect`), {}), 'collect');
    expect(await orderOf(ids.order)).toMatchObject({ status: 'collected', payment_status: 'paid' });
    const hist = (await histOf(ids.order)).map(h => h.s);
    for (const st of ['preparation', 'collected']) expect(hist, 'trace de transition').toContain(st);
    expect(await collectionsOf()).toHaveLength(1);
    step('Relais : colis remis, commande collectée', `historique : ${hist.join(' → ')}`);
  });

  const recon = async () => ok(await call('controller', 'GET', `/api/admin/workspaces/accounting/market/${M}`), 'comptabilité').json.reconciliation;
  const cashOf = async () => (await q(`SELECT COALESCE(SUM(cc.amount_kmf),0)::int n FROM cash_collections cc JOIN orders o ON o.id = cc.order_id WHERE o.market_id = $1`, [fx.marketA.id])).rows[0].n;

  test('5 · la comptabilité voit exactement le cash produit par le fil (détenu = encaissement réel)', async () => {
    const sqlCollected = await cashOf();
    expect(sqlCollected).toBe(ids.total);
    const r = await recon();
    expect(r).toMatchObject({ expected_kmf: ids.total, collected_kmf: sqlCollected, held_kmf: sqlCollected, closed_kmf: 0, lost_kmf: 0 });
    step('Comptabilité : attendu = encaissé = détenu = cash produit par le fil', `${r.expected_kmf} / ${r.collected_kmf} / ${r.held_kmf} KMF, clôturé ${r.closed_kmf}`);
  });

  test('6 · la chaîne de garde repart du cash réel : 45 000 clôturés, 30 000 encore détenus', async () => {
    const custody = suffix => (/^destinations/.test(suffix) ? `/api/market-delegation/markets/${M}/cash-custody/${suffix}` : `/api/admin/workspaces/accounting/market/${M}/${suffix}`);
    await q(`INSERT INTO membership_capabilities(membership_id,capability,granted_by) VALUES ($1,'cash.custody.receive',$2) ON CONFLICT DO NOTHING`, [fx.viewerAMembership.id, fx.central.id]);
    await projectAssignment(db, fx.assignmentA.id);
    const dest = ok(await call('collector', 'POST', custody('destinations'), { kind: 'BANK', label: `${PREFIX} Banque thread ${tag}`, currency: 'XAF', account_ref: `IBAN-${PREFIX}-${rnd()}` }), 'destination');
    ok(await call('controller', 'POST', custody(`destinations/${dest.json.destination.id}/activate`), {}), 'activation destination');
    // 1) l'agent annonce 45 000 au collecteur — rien ne bouge
    const t1 = ok(await call('agentRelais', 'POST', custody('deposits'), { recipient_user_id: who.collector.id, declared_amount: 45000, declared_currency: 'KMF' }), 'annonce');
    const ref1 = JSON.stringify(t1.json).match(/KDP-\d+/)[0];
    expect(await recon()).toMatchObject({ collected_kmf: ids.total, held_kmf: ids.total, closed_kmf: 0 });
    refuse('le remettant ne reçoit pas sa propre remise', await call('agentRelais', 'POST', custody(`custody/${ref1}/receipt`), { outcome: 'received', received_amount: 45000 }));
    // 2) le collecteur accepte : responsabilité transférée, rien de clôturé
    ok(await call('collector', 'POST', custody(`custody/${ref1}/receipt`), { outcome: 'received', received_amount: 45000 }), 'réception intermédiaire');
    expect(await recon()).toMatchObject({ transferred_kmf: 45000, closed_kmf: 0, held_kmf: ids.total });
    // 3) le collecteur remet 45 000 KMF = 60 000 XAF à la destination finale ; preuve par une autre personne, contrôle par une troisième
    const t2 = ok(await call('collector', 'POST', custody('deposits'), { destination_id: dest.json.destination.id, declared_amount: 60000, declared_currency: 'XAF' }), 'remise finale');
    const ref2 = JSON.stringify(t2.json).match(/KDP-\d+/)[0];
    refuse('le remettant ne prouve pas sa propre remise finale', await call('collector', 'POST', custody(`custody/${ref2}/receipt`), { outcome: 'received', received_amount: 60000, proof_ref: 'x' }));
    ok(await call('receiver', 'POST', custody(`custody/${ref2}/receipt`), { outcome: 'received', received_amount: 60000, proof_ref: `BORD-${PREFIX}-${tag}` }), 'preuve finale');
    expect(await recon()).toMatchObject({ closed_kmf: 0 });
    refuse('celui qui a prouvé ne contrôle pas', await call('receiver', 'POST', custody(`custody/${ref2}/control`), { controlled_kmf: 45000 }));
    ok(await call('controller', 'POST', custody(`custody/${ref2}/control`), { controlled_kmf: 45000 }), 'contrôle indépendant');
    const r = await recon();
    expect(r).toMatchObject({ collected_kmf: ids.total, closed_kmf: 45000, held_kmf: ids.total - 45000, lost_kmf: 0 });
    step('Garde : 75 000 encaissés par le fil → 45 000 clôturés (preuve + contrôle indépendants), 30 000 encore détenus', `${ref1}, ${ref2}`);
  });

  const newCashOrder = async (qty = 1) => {
    const res = ok(await call('client', 'POST', '/api/orders', {
      items: [{ product_id: ids.product, quantity: qty }], relais_id: ids.relais, payment_mode: 'cash_relais',
      recipient_name: 'Destinataire CASH', recipient_phone: '+269000555', tracking_phone: '+269000555',
    }), 'commande cash');
    return { id: res.json.order.id, ref: res.json.order.reference };
  };
  const v2Confirm = (key, ref) => call(key, 'POST', `/api/v2/orders/${ref}/confirm-cash`, {});
  const collectionRows = async id => (await q('SELECT collected_by FROM cash_collections WHERE order_id = $1', [id])).rows;
  const parcelCount = async id => (await q('SELECT COUNT(*)::int n FROM parcels WHERE order_id = $1', [id])).rows[0].n;

  test('7 · la confirmation cash du workspace converge sur l’autorité unique : payé AVEC trace d’encaissement', async () => {
    const o = await newCashOrder();
    ok(await call('agentRelais', 'POST', wsApi(`orders/${o.ref}/confirm-cash`), {}), 'confirm-cash workspace');
    expect((await orderOf(o.id)).payment_status).toBe('paid');
    expect(await collectionRows(o.id)).toHaveLength(1);
    step('Workspace Opérations : confirm-cash passe par l’autorité unique', 'paiement + 1 ligne cash_collections');
  });

  test('7b · CASH : POST /api/v2/orders/:ref/confirm-cash converge sur la même autorité (paiement, cash_collections, colis, rejeu idempotent)', async () => {
    const o = await newCashOrder(2);
    refuse('le client ne peut pas confirmer', await v2Confirm('client', o.ref), [403]);
    refuse('l’agent hub n’a pas le droit d’encaisser (droits de l’autorité)', await v2Confirm('agentHub', o.ref), [403]);
    expect((await orderOf(o.id)).payment_status).toBe('pending');
    expect(await collectionRows(o.id)).toHaveLength(0);
    const res = ok(await v2Confirm('agentRelais', o.ref), 'v2 confirm-cash');
    expect(res.json).toMatchObject({ success: true, state: 'confirmed', order: { payment_status: 'paid' } });
    expect(await collectionRows(o.id)).toEqual([{ collected_by: who.agentRelais.id }]);
    expect((await orderOf(o.id)).payment_status).toBe('paid');
    expect(await parcelCount(o.id)).toBe(1);
    const replay = ok(await v2Confirm('agentRelais', o.ref), 'rejeu');
    expect(replay.json.state).toBe('already_confirmed');
    expect(await collectionRows(o.id)).toHaveLength(1);
    expect(await parcelCount(o.id)).toBe(1);
    step('V2 confirm-cash : une seule vérité d’encaissement', `paiement paid, 1 cash_collections, 1 colis, rejeu ${replay.json.state}`);
  });

  test('7c · CASH : un agent d’un autre relais est refusé (cross-relais) : ni paiement, ni encaissement, ni colis', async () => {
    const o = await newCashOrder();
    refuse('cross-relais refusé', await v2Confirm('agentOther', o.ref), [403]);
    expect((await orderOf(o.id)).payment_status).toBe('pending');
    expect(await collectionRows(o.id)).toHaveLength(0);
    expect(await parcelCount(o.id)).toBe(0);
  });

  test('7d · CASH : deux confirmations simultanées → un seul encaissement, un seul colis', async () => {
    const o = await newCashOrder();
    const [a, b] = await Promise.all([v2Confirm('agentRelais', o.ref), v2Confirm('agentRelais2', o.ref)]);
    const states = [a, b].map(r => `${r.status}:${(r.json && (r.json.state || r.json.code)) || ''}`);
    expect([a.status, b.status].filter(c => c === 200).length, JSON.stringify(states)).toBeGreaterThanOrEqual(1);
    for (const r of [a, b]) expect([200, 404, 409], JSON.stringify(states)).toContain(r.status);
    expect((await orderOf(o.id)).payment_status).toBe('paid');
    expect(await collectionRows(o.id)).toHaveLength(1);
    expect(await parcelCount(o.id)).toBe(1);
    step('Concurrence v2 confirm-cash', states.join(' | '));
  });

  test('7e · CASH : double validation — le premier visa ne paie rien (202), le même acteur ne peut pas valider seul, le second acteur confirme', async () => {
    await q(`DELETE FROM market_cash_control_policies WHERE market_id = $1`, [fx.marketA.id]);
    await q(`INSERT INTO market_cash_control_policies(assignment_id, market_id, confirmation_mode) VALUES ($1,$2,'DUAL_ALWAYS')`, [fx.assignmentA.id, fx.marketA.id]);
    try {
      const o = await newCashOrder();
      const first = await v2Confirm('agentRelais', o.ref);
      expect(first.status, JSON.stringify(first.json)).toBe(202);
      expect(first.json).toMatchObject({ success: false, state: 'pending_second_approval', pending_second_approval: true, parcel: null, order: { payment_status: 'pending' } });
      expect((await orderOf(o.id)).payment_status).toBe('pending');
      expect(await collectionRows(o.id)).toHaveLength(0);
      expect(await parcelCount(o.id)).toBe(0);
      const same = await v2Confirm('agentRelais', o.ref);
      expect(same.status).toBe(202);
      expect((await orderOf(o.id)).payment_status).toBe('pending');
      const second = ok(await v2Confirm('agentRelais2', o.ref), 'second visa');
      expect(second.json).toMatchObject({ success: true, state: 'confirmed', order: { payment_status: 'paid' } });
      expect(await collectionRows(o.id)).toHaveLength(1);
      expect(await parcelCount(o.id)).toBe(1);
      step('Double validation via v2', 'visa 1 → 202 sans paiement ni colis ; même acteur → 202 ; second acteur → payé + 1 encaissement + 1 colis');
    } finally {
      await q(`DELETE FROM market_cash_control_policies WHERE market_id = $1`, [fx.marketA.id]);
    }
  });

  test('8 · aucune notification n’a atteint un fournisseur pendant tout le fil', async () => {
    // Les vraies routes émettent des notifications : leurs TENTATIVES sont attendues, leur LIVRAISON est interdite.
    // Le serveur de recette n'a que des clés placeholders : toute tentative doit rester failed/logged/pending.
    const effects = await externalEffects(db, guard);
    const log = (await q(`SELECT status, COUNT(*)::int n FROM notification_log WHERE created_at >= $1 GROUP BY status`, [guard.started_at])).rows;
    report.external_effects = { ...effects, notification_log_par_statut: Object.fromEntries(log.map(r => [r.status, r.n])) };
    expect(log.filter(r => !['failed', 'logged', 'pending'].includes(r.status)), JSON.stringify(log)).toEqual([]);
    expect(effects.sms_log, JSON.stringify(effects)).toBe(0);
    // Le schéma canonique peut ne pas exposer outbox_events : prouver son absence
    // plutôt que d'exiger undefined === 0 ou de masquer une table non surveillée.
    const { rows: [outboxSchema] } = await q("SELECT to_regclass('public.outbox_events') IS NOT NULL AS present");
    if (outboxSchema.present) {
      expect(guard.monitors, 'outbox_events existe mais n’est pas surveillée').toContain('outbox_events');
      expect(effects.outbox_events, JSON.stringify(effects)).toBe(0);
    } else {
      expect(effects.outbox_events, 'aucune table outbox_events ne doit produire des faits').toBeUndefined();
    }
    step('Notifications : tentatives internes seulement, aucune livraison fournisseur', JSON.stringify(report.external_effects));
  });
});
