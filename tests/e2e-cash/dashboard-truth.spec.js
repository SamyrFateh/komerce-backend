'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires postgres
 */

/**
 * Lot S2 — vérité des dashboards (niveau L4 local intégré, jamais L5 staging).
 * Jonction certifiée : fait PostgreSQL → API réelle → écran réel → décision → workspace habilité →
 * nouvelle vérité (base, API, écran). Chaque indicateur retenu est comparé à un oracle SQL écrit
 * ici à partir de la DÉFINITION MÉTIER (jamais la requête du service testé), sur deux Markets
 * synthétiques aux chiffres volontairement différents, avec des acteurs aux droits différents.
 * Réutilise la fixture de délégation, le preflight (aucune fixture avant prévalidation) et la
 * surveillance des effets externes de la recette cash. Aucune purge : les faits append-only restent.
 * Rapport : test-results/dashboard-truth/report.{json,md} (valeurs SQL / API / écran, Market, rôle).
 *
 *   E2E_BASE_URL=http://localhost:3911 E2E_ADMIN_PASSWORD=… DATABASE_URL=… npm run test:e2e:cash
 */
const fs = require('fs');
const path = require('path');
const { test, expect, request: pwRequest } = require('@playwright/test');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { createMarketDelegationFixture, READ_ONLY_CAPABILITIES } = require('../helpers/marketDelegationE2EKit');
const { projectAssignment, LEGACY_VIEWER_CAPABILITIES } = require('../../services/market-scope-projector');
const { PREFIX, PASSWORD, rnd, target, api, login, preflight, externalEffects, provisionActors } = require('./support');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'dashboard-truth');
const report = { level: 'L4 local intégré (jamais L5 staging)', target: null, started_at: new Date().toISOString(), rows: [], refusals: [], states: [], actions: [], fixtures: {} };
const q = (sql, p) => db.query(sql, p);
let fx; let base; let admin; let guard; let tag; let M; const who = {}; const sessions = {}; const ids = {};
const XAF = kmf => Math.round((kmf * 4) / 3); // parité XAF/KMF : 655,957 / 491,968 = 4/3
const digitsOf = text => Number(String(text).replace(/[^\d-]/g, '')) || 0;
const sqlN = async (text, params) => Number((await q(text, params)).rows[0].n);

async function open(browser, key) {
  const context = await browser.newContext({ baseURL: base });
  await login(context.request, who[key].email, PASSWORD);
  const page = await context.newPage();
  sessions[key] = { context, page };
  return page;
}
// Charge un écran et rend { api, text } : l'API est celle que CET écran vient d'appeler.
async function visit(key, url, apiPart) {
  const { page } = sessions[key];
  // Le corps est lu à l’instant de la réponse : une navigation cliente ultérieure le rendrait illisible.
  let captured = null;
  const handler = async r => {
    if (!r.url().includes(apiPart) || r.request().method() !== 'GET') return;
    try { captured = { status: r.status(), json: await r.json() }; } catch (_) { /* corps déjà libéré : on attend la prochaine réponse */ }
  };
  page.on('response', handler);
  try {
    await page.goto(url);
    await expect.poll(() => captured !== null, { timeout: 20000, message: `${key} ${url} : aucune réponse ${apiPart}` }).toBe(true);
  } finally { page.off('response', handler); }
  expect(captured.status, `${key} ${url}`).toBe(200);
  await expect(page.locator('body')).not.toContainText('Chargement', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { api: captured.json, text: await page.locator('body').innerText() };
}
// Premier nombre qui suit un libellé (et lui seul) ; anchor limite la recherche à une zone.
function after(text, label, { anchor, gap = 90 } = {}) {
  const from = anchor ? Math.max(text.indexOf(anchor), 0) : 0;
  const m = text.slice(from).match(new RegExp(`${label}[^\\d]{0,${gap}}?(\\d[\\d \u00a0\u202f.,]*)`, 'i'));
  if (!m) throw new Error(`libellé introuvable à l'écran : ${label}`);
  return digitsOf(m[1]);
}
const before = (text, label) => { const m = text.match(new RegExp(`(\\d+)\\s+${label}`)); if (!m) throw new Error(`compteur introuvable avant : ${label}`); return Number(m[1]); };
// Une ligne de preuve = valeur SQL (oracle indépendant) = valeur API = valeur écran.
function prove(screen, indicator, market, role, sql, api, ui) {
  report.rows.push({ screen, indicator, market, role, sql, api, ui });
  expect({ screen, indicator, api }, `API ≠ SQL — ${screen}/${indicator}`).toEqual({ screen, indicator, api: sql });
  expect({ screen, indicator, ui }, `ÉCRAN ≠ SQL — ${screen}/${indicator}`).toEqual({ screen, indicator, ui: sql });
}
const kpi = (list, key) => (list.find(k => k.key === key) || {}).value;
const refuse = (name, res, codes = [403, 404]) => {
  report.refusals.push({ name, status: res.status, code: (res.json && res.json.code) || null });
  expect(codes, `${name}: ${res.status} ${JSON.stringify(res.json)}`).toContain(res.status);
};
const call = (key, method, url, data) => api(sessions[key].context.request, method, url, data);

test.describe.serial('Vérité des dashboards — acteurs réels, deux Markets', () => {
  test.beforeAll(async () => {
    const t = target(); base = t.base; report.target = t.host;
    admin = await pwRequest.newContext({ baseURL: base });
    guard = await preflight({ db, request: admin, adminEmail: 'admin@komerce.km', adminPassword: process.env.E2E_ADMIN_PASSWORD });
    report.preflight = { database: guard.database, monitored_tables: guard.monitors, started_at: guard.started_at };
    fx = await createMarketDelegationFixture(db);
    M = { A: fx.marketA.code, B: fx.marketB.code };
    tag = rnd();
    await q('UPDATE markets SET name = $2 WHERE id = $1', [fx.marketA.id, `${PREFIX} Market A ${tag}`]);
    await q('UPDATE markets SET name = $2 WHERE id = $1', [fx.marketB.id, `${PREFIX} Market B ${tag}`]);
    who.managerA = { id: fx.managerA.id, email: fx.managerA.email, scope: 'manager' };
    who.viewerA = { id: fx.viewerA.id, email: fx.viewerA.email, scope: 'viewer' };
    who.managerB = { id: fx.managerB.id, email: fx.managerB.email, scope: 'manager', market: fx.marketB.code };
    const baseline = [...new Set([...READ_ONLY_CAPABILITIES, ...LEGACY_VIEWER_CAPABILITIES])].filter(c => fx.liveCapabilities.includes(c));
    const rel = {};
    for (const [k, m] of [['A', fx.marketA], ['B', fx.marketB]]) {
      rel[k] = (await q(`INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2690000000','Adresse recette',$2) RETURNING id`, [`${PREFIX} Relais ${k} ${tag}`, m.id])).rows[0].id;
    }
    const mkUser = async (key, role, relaisId) => {
      const { rows: [u] } = await q(`INSERT INTO users(full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,$4,$5) RETURNING id,email`,
        [`${PREFIX} ${key} ${tag}`, `${PREFIX}.${key}.${tag}@e2e-cash.test`.toLowerCase(), `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`, role, relaisId || null]);
      who[key] = { id: u.id, email: u.email };
      return u;
    };
    const agentRelaisA = await mkUser('agentRelaisA', 'agent_relais', rel.A);
    await mkUser('agentRelaisB', 'agent_relais', rel.B);
    await mkUser('agentHub', 'agent_hub', null);
    const relC = (await q(`INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2690000000','Adresse recette',$2) RETURNING id`, [`${PREFIX} Relais C vide ${tag}`, fx.marketA.id])).rows[0].id;
    await mkUser('agentRelaisC', 'agent_relais', relC);
    for (const [uid, assignment] of [[agentRelaisA.id, fx.assignmentA], [who.agentRelaisB.id, fx.assignmentB], [who.agentHub.id, fx.assignmentA], [who.agentRelaisC.id, fx.assignmentA]]) {
      const { rows: [mem] } = await q(`INSERT INTO assignment_memberships(assignment_id,user_id,status,granted_by) VALUES ($1,$2,'ACTIVE',$3) RETURNING id`, [assignment.id, uid, fx.central.id]);
      for (const c of baseline) await q(`INSERT INTO membership_capabilities(membership_id,capability,granted_by) VALUES ($1,$2,$3)`, [mem.id, c, fx.central.id]);
    }
    await projectAssignment(db, fx.assignmentA.id); await projectAssignment(db, fx.assignmentB.id);
    await provisionActors({ db, admin, who, tag, defaultMarket: fx.marketA.code, bcrypt });
    const relais = { [fx.marketA.id]: rel.A, [fx.marketB.id]: rel.B };
    const mk = async (m, ref, total, status, pay, mode = 'stripe_eur') => (await q(
      `INSERT INTO orders(reference,relais_id,total_kmf,payment_mode,market_id,status,payment_status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [`${PREFIX}-${tag}-${ref}`, relais[m.id], total, mode, m.id, status, pay])).rows[0].id;
    const pc = (o, m, ref, st) => q(`INSERT INTO parcels(order_id,relais_id,reference,status) VALUES ($1,$2,$3,$4)`, [o, relais[m.id], `${PREFIX}-${tag}-${ref}`, st]);
    const A = fx.marketA; const B = fx.marketB;
    ids.rel = rel;
    const a1 = await mk(A, 'A1', 120000, 'confirmed', 'paid');
    const a2 = await mk(A, 'A2', 75000, 'in_transit', 'paid');
    const a3 = await mk(A, 'A3', 45000, 'available', 'paid', 'cash_relais');
    await mk(A, 'A4', 99000, 'cancelled', 'paid');
    await mk(A, 'A5', 30000, 'confirmed', 'pending', 'cash_relais');
    const a6 = await mk(A, 'A6', 40000, 'available', 'pending', 'cash_relais');
    const b1 = await mk(B, 'B1', 70000, 'preparation', 'paid');
    const b2 = await mk(B, 'B2', 35000, 'shipped', 'paid');
    const b3 = await mk(B, 'B3', 15000, 'available', 'paid', 'cash_relais');
    await pc(a2, A, 'PA2', 'in_transit'); await pc(a3, A, 'PA3', 'available'); await pc(a6, A, 'PA6', 'available');
    await pc(b2, B, 'PB1', 'in_transit'); await pc(b2, B, 'PB2', 'arrived'); await pc(b3, B, 'PB3', 'available');
    await q(`INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id,confirmed_at) VALUES ($1,45000,$2,$3,NOW()-INTERVAL '1 hour')`, [a3, agentRelaisA.id, rel.A]);
    await q(`INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id,confirmed_at) VALUES ($1,15000,$2,$3,NOW()-INTERVAL '1 hour')`, [b3, who.agentRelaisB.id, rel.B]);
    ids.o = { a1, a2, a3, a6, b1, b2, b3 };
    report.fixtures = { markets: M, tag, users: Object.fromEntries(Object.entries(who).map(([k, v]) => [k, v.email])) };
    const sig = (m, type, sev, title) => q(`INSERT INTO signals(signal_type,severity,title,market_id,entity_type,entity_id,status) VALUES ($1,$2,$3,$4,'e2e',$5,'open')`, [type, sev, title, m.id, `${tag}-${m.code}-${type}`]);
    await sig(A, 'e2e_cash_gap', 'critical', `${PREFIX} signal A1`);
    await sig(A, 'e2e_stock_gap', 'warning', `${PREFIX} signal A2`);
    await sig(B, 'e2e_cash_gap', 'critical', `${PREFIX} signal B1`);
  });

  test.afterAll(async () => {
    for (const s of Object.values(sessions)) await s.context.close().catch(() => {});
    await admin?.dispose();
    report.finished_at = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const byScreen = {};
    for (const r of report.rows) (byScreen[r.screen] = byScreen[r.screen] || []).push(r);
    const md = ['# Vérité des dashboards — niveau L4 local intégré', '',
      `Cible : ${report.target} (serveur et base de test ; jamais un staging déployé). Deux Markets synthétiques : ${JSON.stringify(report.fixtures.markets)}.`, '',
      ...Object.entries(byScreen).flatMap(([screen, rows]) => [`## ${screen}`, '| Indicateur | Market | Rôle | SQL | API | Écran |', '|---|---|---|---|---|---|',
        ...rows.map(r => `| ${r.indicator} | ${r.market} | ${r.role} | ${r.sql} | ${r.api === undefined ? '—' : r.api} | ${r.ui === undefined ? '—' : r.ui} |`), '']),
      '## États vides, isolation et erreurs de lecture', ...report.states.map(s => `- ✅ ${s}`), '',
      '## Actions et vérité observable', ...report.actions.map(a => `- ✅ ${a}`), '',
      '## Observations à traiter (hors périmètre de la recette)', ...(report.observations || []).map(o => `- ⚠️ ${o}`), '',
      '## Refus vérifiés', ...report.refusals.map(r => `- ✅ ${r.name} → ${r.status}${r.code ? ` (${r.code})` : ''}`), '',
      '## Fixtures (identifiables, faits financiers conservés)', '```json', JSON.stringify(report.fixtures, null, 2), '```'];
    fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
    await db.end?.();
  });

  const orderN = (market, where, params = []) => sqlN(`SELECT COUNT(*) n FROM orders WHERE market_id = $1 AND ${where}`, [market, ...params]);
  const parcelN = (market, statuses) => sqlN(`SELECT COUNT(*) n FROM parcels p JOIN orders o ON o.id = p.order_id WHERE o.market_id = $1 AND p.status::text = ANY($2)`, [market, statuses]);
  const paidKmf = market => sqlN(`SELECT COALESCE(SUM(total_kmf),0) n FROM orders WHERE market_id = $1 AND payment_status = 'paid' AND status NOT IN ('cancelled','refunded')`, [market]);
  const sigN = (market, severity) => sqlN(`SELECT COUNT(*) n FROM signals WHERE market_id = $1 AND status IN ('open','acknowledged') AND ($2::text IS NULL OR severity = $2)`, [market, severity]);
  const ACTIVE = ['confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available'];

  test('0 · fixtures : l’oracle SQL retrouve les valeurs construites (A et B distincts)', async () => {
    const a = fx.marketA.id; const b = fx.marketB.id;
    expect([await paidKmf(a), await orderN(a, 'status::text = ANY($2)', [ACTIVE]), await sigN(a, 'critical'), await parcelN(a, ['available'])]).toEqual([240000, 5, 1, 2]);
    expect([await paidKmf(b), await orderN(b, 'status::text = ANY($2)', [ACTIVE]), await sigN(b, 'critical'), await parcelN(b, ['available'])]).toEqual([120000, 3, 1, 1]);
  });

  test('1 · Pilotage (Market A) : critiques, commandes actives, liens vers les workspaces', async ({ browser }) => {
    await open(browser, 'managerA');
    const { api: p, text } = await visit('managerA', `/admin/pilotage?market=${M.A}`, '/unified/market/');
    const A = fx.marketA.id;
    prove('Pilotage', 'Alertes critiques ouvertes', M.A, 'manager A', await sigN(A, 'critical'), kpi(p.kpis_global, 'alertes_critiques'), after(text, 'CRITIQUES OUVERTES'));
    prove('Pilotage', 'Commandes actives', M.A, 'manager A', await orderN(A, 'status::text = ANY($2)', [ACTIVE]), kpi(p.kpis_global, 'cmds_actives'), after(text, 'COMMANDES ACTIVES'));
    // Pilotage est en lecture : il pointe vers le workspace qui porte l’action.
    const hrefs = await sessions.managerA.page.locator('a').evaluateAll(a => a.map(x => x.getAttribute('href') || ''));
    expect(hrefs.some(h => h.includes('/admin/action-center'))).toBe(true);
    expect(hrefs.some(h => h.includes('/admin/operations'))).toBe(true);
    report.states.push('Pilotage : lecture seule — liens vers Action Center et Opérations présents, aucun bouton de mutation');
    expect(await sessions.managerA.page.locator('[data-action-center-action], [data-workspace-action]').count()).toBe(0);
    const generated = Date.parse(p.data_quality.generated_at);
    expect(Date.now() - generated, 'fraîcheur de la lecture').toBeLessThan(60000);
  });

  test('2 · Opérations (Market A) : étapes de la chaîne et commandes dans la chaîne', async () => {
    const A = fx.marketA.id;
    const { api: o, text } = await visit('managerA', `/admin/operations?market=${M.A}`, '/operations/market/');
    const keyOf = label => (o.control_chain.stages.find(s => s.label.toUpperCase() === label) || {}).key;
    const tally = key => o.control_chain.orders.filter(x => x.stage === key).length;
    for (const [label, where] of [['COMMANDE', `status IN ('confirmed','ordered')`], ['TRANSPORT', `status IN ('shipped','in_transit')`], ['RELAIS', `status = 'available'`]]) {
      expect(keyOf(label), `étape ${label} absente de l’API`).toBeTruthy();
      prove('Opérations', `Commandes à l’étape ${label}`, M.A, 'manager A', await orderN(A, where), tally(keyOf(label)), after(text, label, { anchor: 'Chaîne logistique', gap: 6, flags: '' }));
    }
    const uiTotal = ['Normal', 'À risque', 'Bloqué', 'Non observé'].reduce((n, l) => n + before(text, l), 0);
    prove('Opérations', 'Commandes dans la chaîne (tous états de santé)', M.A, 'manager A', await orderN(A, 'status::text = ANY($2)', [ACTIVE]), o.control_chain.orders.length, uiTotal);
    const queueRefs = async heading => (await sessions.managerA.page.locator('section', { has: sessions.managerA.page.getByRole('heading', { name: heading }) }).locator('article strong').allInnerTexts()).map(t => t.trim()).sort().join(',');
    const refsSql = async where => (await q(`SELECT reference FROM orders o WHERE o.market_id = $1 AND ${where} ORDER BY 1`, [A])).rows.map(r => r.reference).join(',');
    const refsApi = list => list.map(x => x.reference).sort().join(',');
    prove('Opérations', 'File « Cash à confirmer » (paiement en attente, commande vivante)', M.A, 'manager A',
      await refsSql(`o.payment_status = 'pending' AND o.status NOT IN ('cancelled','collected','refunded')`), refsApi(o.work_queues.pending_cash), await queueRefs('Cash à confirmer'));
    // L8 : la file unique est répartie en trois files (À commander / En attente de réception Hub / Préparer le colis) ;
    // leur union reste exactement l'ensemble des commandes payées confirmées ou commandées.
    const wq = o.work_queues;
    const unionApi = refsApi([...(wq.to_order || []), ...(wq.awaiting_hub_reception || []), ...(wq.ready_for_parcel || [])]);
    const unionUi = [(await queueRefs('À commander')), (await queueRefs('En attente de réception Hub')), (await queueRefs('Préparer le colis'))].filter(Boolean).join(',').split(',').filter(Boolean).sort().join(',');
    prove('Opérations', 'Files « À commander » + « En attente de réception Hub » + « Préparer le colis » (payée, confirmée ou commandée, sans colis)', M.A, 'manager A',
      await refsSql(`o.payment_status = 'paid' AND o.status IN ('confirmed','ordered') AND NOT EXISTS (SELECT 1 FROM parcels p WHERE p.order_id = o.id)`), unionApi, unionUi);
  });

  test('3 · Finance puis Comptabilité (Market A) : CA, attendu/collecté/détenu, lien entre les deux', async () => {
    const A = fx.marketA.id;
    const { api: f, text } = await visit('managerA', `/admin/finance?market=${M.A}`, '/finance/market/');
    prove('Finance', 'Commandes payées — part hors avoir (XAF = KMF × 4/3)', M.A, 'manager A', XAF(await paidKmf(A)), kpi(f.kpis, 'ca_encaisse'), after(text, 'COMMANDES PAYÉES — PART HORS AVOIR', { gap: 12 }));
    const uiPending = after(text, 'Paiements en attente', { gap: 90 });
    report.rows.push({ screen: 'Finance', indicator: 'Paiements en attente', market: M.A, role: 'manager A', sql: await orderN(A, `payment_status = 'pending' AND status NOT IN ('cancelled','refunded')`), ui: uiPending });
    expect(uiPending).toBe(report.rows[report.rows.length - 1].sql);
    const hrefs = await sessions.managerA.page.locator('a').evaluateAll(a => a.map(x => x.getAttribute('href') || ''));
    expect(hrefs.some(h => h.includes('/admin/workspaces/accounting')), 'lien Finance → Comptabilité').toBe(true);
    const { api: c, page } = { ...(await visit('managerA', `/admin/workspaces/accounting?market=${M.A}`, '/accounting/market/')), page: sessions.managerA.page };
    const table = page.locator('table', { hasText: 'DÉTENU MAINTENANT' }).first();
    const heads = (await table.locator('th').allInnerTexts()).map(t => t.trim().toUpperCase());
    const cells = await table.locator('tbody tr').first().locator('td').allInnerTexts();
    const ui = label => digitsOf(cells[heads.findIndex(h => h.startsWith(label))]);
    const r = c.reconciliation;
    const expected = await sqlN(`SELECT COALESCE(SUM(total_kmf),0) n FROM orders WHERE market_id = $1 AND payment_mode = 'cash_relais' AND status IN ('available','collected')`, [A]);
    const collected = await sqlN(`SELECT COALESCE(SUM(cc.amount_kmf),0) n FROM cash_collections cc JOIN orders o ON o.id = cc.order_id WHERE o.market_id = $1`, [A]);
    prove('Comptabilité · cash', 'Attendu (cash relais disponible ou retiré)', M.A, 'manager A', expected, r.expected_kmf, ui('ATTENDU'));
    prove('Comptabilité · cash', 'Collecté', M.A, 'manager A', collected, r.collected_kmf, ui('COLLECTÉ'));
    prove('Comptabilité · cash', 'Détenu maintenant (aucun transfert dans cette fixture)', M.A, 'manager A', collected, r.held_kmf, ui('DÉTENU'));
    prove('Comptabilité · cash', 'Écart de collecte (attendu − collecté)', M.A, 'manager A', expected - collected, r.gap_collection_kmf, ui('ÉCART COLLECTE'));
  });

  test('4 · Hub Live (agent hub) : suivi global lu depuis les tables, et isolation par Market côté API', async ({ browser }) => {
    await open(browser, 'agentHub');
    const { api: h, text } = await visit('agentHub', '/admin/hub-live', '/hub-dash/dashboard');
    const glob = where => sqlN(`SELECT COUNT(*) n FROM orders WHERE ${where}`);
    prove('Hub Live', 'À préparer (confirmées ou commandées)', 'tous (rôle hub)', 'agent hub', await glob(`status IN ('confirmed','ordered')`), h.orders.to_prepare, after(text, 'À PRÉPARER', { anchor: 'FLUX DU HUB', gap: 6, flags: '' }));
    prove('Hub Live', 'En préparation', 'tous (rôle hub)', 'agent hub', await glob(`status = 'preparation'`), h.orders.in_preparation, after(text, 'EN PRÉPARATION', { anchor: 'FLUX DU HUB', gap: 6, flags: '' }));
    prove('Hub Live', 'Expédiées', 'tous (rôle hub)', 'agent hub', await glob(`status = 'shipped'`), h.orders.shipped_total, after(text, 'EXPÉDIÉES', { anchor: 'FLUX DU HUB', gap: 6, flags: '' }));
    // Le rôle hub est volontairement transversal ; l’isolation se prouve sur les délégués de Market, via la même API.
    await open(browser, 'managerB');
    const a = await call('managerA', 'GET', '/api/hub-dash/dashboard');
    const b = await call('managerB', 'GET', '/api/hub-dash/dashboard');
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    for (const [who_, res, mk, id] of [['manager A', a, M.A, fx.marketA.id], ['manager B', b, M.B, fx.marketB.id]]) {
      const sqlPrep = await orderN(id, `status IN ('confirmed','ordered')`);
      const sqlInPrep = await orderN(id, `status = 'preparation'`);
      report.rows.push({ screen: 'Hub Live (API délégué)', indicator: 'À préparer', market: mk, role: who_, sql: sqlPrep, api: res.json.orders.to_prepare });
      report.rows.push({ screen: 'Hub Live (API délégué)', indicator: 'En préparation', market: mk, role: who_, sql: sqlInPrep, api: res.json.orders.in_preparation });
      expect([res.json.orders.to_prepare, res.json.orders.in_preparation]).toEqual([sqlPrep, sqlInPrep]);
    }
    const aOrder = await call('managerB', 'GET', `/api/hub-dash/orders/${ids.o.a1}`);
    refuse('manager B ne lit pas une commande du Market A (Hub)', aOrder);
  });

  test('5 · Relais Live (agent relais A) : transit, disponibles, cash à encaisser ; B ne voit pas A', async ({ browser }) => {
    await open(browser, 'agentRelaisA');
    const { api: r, text } = await visit('agentRelaisA', '/admin/relais-live', '/relay/dashboard');
    const relA = ids.rel.A; const relB = ids.rel.B;
    const parcels = (rel, st) => sqlN(`SELECT COUNT(*) n FROM parcels WHERE relais_id = $1 AND status::text = ANY($2)`, [rel, st]);
    prove('Relais Live', 'Colis en transit', 'A (relais A)', 'agent relais A', await parcels(relA, ['in_transit']), r.kpi.en_transit, after(text, 'EN TRANSIT', { anchor: 'FLUX DES RELAIS', gap: 6, flags: '' }));
    prove('Relais Live', 'Disponibles au retrait', 'A (relais A)', 'agent relais A', await parcels(relA, ['available']), r.kpi.disponibles, after(text, 'DISPONIBLES AU RETRAIT', { anchor: 'FLUX DES RELAIS', gap: 6, flags: '' }));
    prove('Relais Live', 'Cash à encaisser (commandes)', 'A (relais A)', 'agent relais A', await sqlN(`SELECT COUNT(*) n FROM orders WHERE relais_id = $1 AND status = 'available' AND payment_mode = 'cash_relais' AND payment_status = 'pending'`, [relA]), r.kpi.cash_a_encaisser, after(text, 'CASH À ENCAISSER', { anchor: 'RÉSULTAT DES RELAIS', gap: 6, flags: '' }));
    const amountUi = digitsOf((text.slice(text.indexOf('CASH À ENCAISSER', text.indexOf('RÉSULTAT DES RELAIS'))).match(/\d[\d \u00a0\u202f]*KMF/) || [''])[0]);
    prove('Relais Live', 'Montant cash à encaisser (KMF)', 'A (relais A)', 'agent relais A', await sqlN(`SELECT COALESCE(SUM(total_kmf),0) n FROM orders WHERE relais_id = $1 AND status = 'available' AND payment_mode = 'cash_relais' AND payment_status = 'pending'`, [relA]), r.kpi.montant_cash_pending, amountUi);
    await open(browser, 'agentRelaisB');
    const b = await call('agentRelaisB', 'GET', '/api/relay/dashboard');
    expect(b.status).toBe(200);
    for (const [k, v] of [['disponibles', await parcels(relB, ['available'])], ['en_transit', await parcels(relB, ['in_transit'])], ['cash_a_encaisser', 0]]) {
      report.rows.push({ screen: 'Relais Live (API)', indicator: k, market: 'B (relais B)', role: 'agent relais B', sql: v, api: b.json.kpi[k] });
      expect(b.json.kpi[k], `relais B ${k}`).toBe(v);
    }
    const listA = await call('agentRelaisA', 'GET', '/api/relay/orders?limit=100');
    const listB = await call('agentRelaisB', 'GET', '/api/relay/orders?limit=100');
    const refs = res => JSON.stringify(res.json);
    expect(refs(listA)).not.toMatch(/-B[123]\b/); expect(refs(listB)).not.toMatch(/-A[1-6]\b/);
    report.states.push('Relais Live : agent A ne reçoit aucune commande B et inversement (listes /api/relay/orders)');
    report.observations = report.observations || [];
    report.observations.push('Définitions de « en transit » : Pilotage compte les colis shipped + in_transit + arrived ; Relais Live ne compte que in_transit (un colis shipped ou arrived n’y figure nulle part). Décision métier à prendre sur la taxonomie des statuts colis.');
  });

  test('6 · Action Center (Market A) : signaux, lecture seule du délégué sans droit, isolation B', async ({ browser }) => {
    const A = fx.marketA.id; const B = fx.marketB.id;
    const { api: ac, text } = await visit('managerA', `/admin/action-center?market=${M.A}`, '/action-center/market/');
    prove('Action Center', 'Urgent / critique', M.A, 'manager A', await sigN(A, 'critical'), ac.summary.urgent, after(text, 'Urgent / critique', { gap: 6 }));
    prove('Action Center', 'Avertissements', M.A, 'manager A', await sigN(A, 'warning'), ac.summary.warning, after(text, 'Avertissements', { gap: 6 }));
    prove('Action Center', 'Signaux actifs', M.A, 'manager A', await sigN(A, null), ac.summary.total_active, after(text, 'Signaux actifs', { gap: 6 }));
    // Le délégué en lecture voit les mêmes faits mais aucun bouton d’action ; l’API refuse aussi.
    await open(browser, 'viewerA');
    const v = await visit('viewerA', `/admin/action-center?market=${M.A}`, '/action-center/market/');
    expect(after(v.text, 'Signaux actifs', { gap: 6 })).toBe(await sigN(A, null));
    expect(await sessions.viewerA.page.locator('[data-action-center-action="resolve"], [data-action-center-action="snooze"], [data-action-center-action="acknowledge"]').count()).toBe(0);
    report.states.push('Action Center : le délégué en lecture voit les signaux (même total que la base) sans aucun bouton d’action');
    const refA = (await q(`SELECT signal_ref FROM signals WHERE market_id = $1 AND severity = 'warning'`, [A])).rows[0].signal_ref;
    refuse('viewer A ne peut pas résoudre un signal (API)', await call('viewerA', 'POST', `/api/admin/action-center/market/${M.A}/signals/${refA}/resolve`, { note: 'tentative sans droit' }));
    refuse('manager B ne peut pas résoudre un signal du Market A', await call('managerB', 'POST', `/api/admin/action-center/market/${M.A}/signals/${refA}/resolve`, { note: 'mauvais Market' }));
    refuse('manager B ne lit pas l’Action Center du Market A', await call('managerB', 'GET', `/api/admin/action-center/market/${M.A}`));
    expect(await sqlN(`SELECT COUNT(*) n FROM signals WHERE signal_ref = $1 AND status = 'open'`, [refA])).toBe(1);
    const own = await call('managerB', 'GET', `/api/admin/action-center/market/${M.B}`);
    expect(own.status).toBe(200);
    report.rows.push({ screen: 'Action Center (API)', indicator: 'Signaux actifs', market: M.B, role: 'manager B', sql: await sigN(B, null), api: own.json.summary.total_active });
    expect(own.json.summary.total_active).toBe(await sigN(B, null));
  });

  test('7 · Isolation à l’écran : manager B lit Pilotage et Finance de B, jamais ceux de A', async () => {
    const B = fx.marketB.id;
    for (const path_ of ['/api/admin/dashboard/unified/market', '/api/admin/dashboard/operations/market', '/api/admin/dashboard/finance/market', '/api/admin/workspaces/accounting/market']) {
      refuse(`manager B refusé sur ${path_}/<A>`, await call('managerB', 'GET', `${path_}/${M.A}`));
      refuse(`manager A refusé sur ${path_}/<B>`, await call('managerA', 'GET', `${path_}/${M.B}`));
    }
    const { api: p, text: pt } = await visit('managerB', `/admin/pilotage?market=${M.B}`, '/unified/market/');
    prove('Pilotage', 'Alertes critiques ouvertes', M.B, 'manager B', await sigN(B, 'critical'), kpi(p.kpis_global, 'alertes_critiques'), after(pt, 'CRITIQUES OUVERTES'));
    prove('Pilotage', 'Commandes actives', M.B, 'manager B', await orderN(B, 'status::text = ANY($2)', [ACTIVE]), kpi(p.kpis_global, 'cmds_actives'), after(pt, 'COMMANDES ACTIVES'));
    const { api: f, text: ft } = await visit('managerB', `/admin/finance?market=${M.B}`, '/finance/market/');
    prove('Finance', 'Commandes payées — part hors avoir (XAF = KMF × 4/3)', M.B, 'manager B', XAF(await paidKmf(B)), kpi(f.kpis, 'ca_encaisse'), after(ft, 'COMMANDES PAYÉES — PART HORS AVOIR', { gap: 12 }));
    for (const forbidden of [String(XAF(await paidKmf(fx.marketA.id))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), `${PREFIX}-${tag}-A`]) {
      expect(ft.replace(/ | /g, ' '), `fuite A→B : ${forbidden}`).not.toContain(forbidden);
      expect(pt.replace(/ | /g, ' '), `fuite A→B : ${forbidden}`).not.toContain(forbidden);
    }
    report.states.push('Isolation : manager B voit exclusivement les chiffres et références de B sur Pilotage et Finance ; toutes les lectures du Market voisin sont refusées dans les deux sens');
  });

  test('8 · États vides et erreurs de lecture : jamais présentés comme un succès', async ({ browser }) => {
    await open(browser, 'agentRelaisC');
    const { api: r, text } = await visit('agentRelaisC', '/admin/relais-live', '/relay/dashboard');
    expect([r.kpi.en_transit, r.kpi.disponibles, r.kpi.cash_a_encaisser, r.kpi.montant_cash_pending]).toEqual([0, 0, 0, 0]);
    expect(await sqlN(`SELECT COUNT(*) n FROM orders WHERE relais_id = $1`, [(await q(`SELECT id FROM relais WHERE name LIKE $1`, [`${PREFIX} Relais C vide ${tag}`])).rows[0].id])).toBe(0);
    expect(text).toContain('Aucun colis à traiter');
    expect(text).not.toMatch(/tout est (en ordre|à jour)|aucun problème|succès/i);
    report.states.push('Relais Live d’un relais sans activité : zéros confirmés par la base, message « Aucun colis à traiter », aucun vocabulaire de réussite');
    // Erreur de lecture : l’écran doit le dire, jamais afficher un chiffre faux ou un zéro rassurant.
    const { page } = sessions.managerA;
    await page.route('**/api/admin/dashboard/finance/market/**', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'panne simulée' }) }));
    await page.goto(`/admin/finance?market=${M.A}`);
    await page.waitForTimeout(1500);
    const failed = await page.locator('body').innerText();
    await page.unroute('**/api/admin/dashboard/finance/market/**');
    expect(failed.replace(/ | /g, ' ')).not.toContain('320 000');
    expect(failed, 'une lecture en échec doit être dite à l’écran, avec la cause renvoyée par le serveur').toContain('panne simulée');
    expect(failed, 'aucun indicateur ne doit être affiché quand la lecture a échoué').not.toMatch(/CA ENCAISSÉ|PAIEMENTS EN ATTENTE|COÛT RÉEL/i);
    report.states.push('Finance : lecture API en erreur (500 simulée uniquement pour ce contrôle) → message d’erreur, aucun chiffre ni zéro présenté comme vérité');
  });

  test('9 · Action Center → nouvelle vérité : résolution d’un signal par un délégué habilité', async () => {
    const A = fx.marketA.id;
    const { page } = sessions.managerA;
    const ref = (await q(`SELECT signal_ref FROM signals WHERE market_id = $1 AND severity = 'critical'`, [A])).rows[0].signal_ref;
    const t0 = Date.now();
    await visit('managerA', `/admin/action-center?market=${M.A}`, '/action-center/market/');
    page.removeAllListeners('dialog');
    page.on('dialog', d => d.accept('E2E preuve : écart cash rapproché avec le relais'));
    const done = page.waitForResponse(r => r.url().includes(`/signals/${ref}/resolve`) && r.request().method() === 'POST');
    await page.locator(`[data-action-center-action="resolve"][data-signal-ref="${ref}"]`).click();
    expect((await done).status()).toBe(200);
    // PostgreSQL → API → écran.
    const row = (await q(`SELECT status, resolved_by, resolved_at FROM signals WHERE signal_ref = $1`, [ref])).rows[0];
    expect(row.status).toBe('resolved'); expect(String(row.resolved_by)).toBe(String(who.managerA.id)); expect(row.resolved_at).toBeTruthy();
    expect(await sqlN(`SELECT COUNT(*) n FROM market_delegation_audit WHERE actor_user_id = $1 AND market_id = $2 AND action = 'DECISION_SIGNAL_RESOLVED' AND occurred_at >= to_timestamp($3)`, [who.managerA.id, A, t0 / 1000 - 5])).toBe(1);
    const { api: ac, text } = await visit('managerA', `/admin/action-center?market=${M.A}`, '/action-center/market/');
    prove('Action Center (après résolution)', 'Urgent / critique', M.A, 'manager A', await sigN(A, 'critical'), ac.summary.urgent, after(text, 'Urgent / critique', { gap: 6 }));
    prove('Action Center (après résolution)', 'Signaux actifs', M.A, 'manager A', await sigN(A, null), ac.summary.total_active, after(text, 'Signaux actifs', { gap: 6 }));
    const { api: p, text: pt } = await visit('managerA', `/admin/pilotage?market=${M.A}`, '/unified/market/');
    prove('Pilotage (après résolution)', 'Alertes critiques ouvertes', M.A, 'manager A', 0, kpi(p.kpis_global, 'alertes_critiques'), after(pt, 'CRITIQUES OUVERTES'));
    expect(Date.parse(p.data_quality.generated_at)).toBeGreaterThanOrEqual(t0);
    // Le Market voisin n’a pas bougé.
    expect(await sigN(fx.marketB.id, 'critical')).toBe(1);
    report.actions.push('Action Center : manager A résout le signal critique KSG via l’écran → base (resolved, résolveur, audit), API, écran et Pilotage passent de 1 à 0 critique ; Market B inchangé');
  });

  test('10 · Opérations workspace → nouvelle vérité : remise d’un colis au client par un délégué habilité', async () => {
    const A = fx.marketA.id;
    const { page } = sessions.managerA;
    const pa3 = (await q(`SELECT reference FROM parcels WHERE order_id = $1`, [ids.o.a3])).rows[0].reference;
    const pa6 = (await q(`SELECT reference FROM parcels WHERE order_id = $1`, [ids.o.a6])).rows[0].reference;
    refuse('viewer A ne peut pas remettre un colis (API)', await call('viewerA', 'POST', `/api/admin/workspaces/operations/market/${M.A}/parcels/${pa6}/collect`, {}));
    refuse('manager B ne peut pas remettre un colis du Market A', await call('managerB', 'POST', `/api/admin/workspaces/operations/market/${M.A}/parcels/${pa6}/collect`, {}));
    expect(await sqlN(`SELECT COUNT(*) n FROM parcels WHERE reference = $1 AND status = 'available'`, [pa6])).toBe(1);
    const cashBefore = await sqlN(`SELECT COALESCE(SUM(amount_kmf),0) n FROM cash_collections cc JOIN orders o ON o.id = cc.order_id WHERE o.market_id = $1`, [A]);
    await visit('managerA', `/admin/workspaces/operations?market=${M.A}`, '/workspaces/operations/market/');
    page.removeAllListeners('dialog');
    page.on('dialog', d => d.accept());
    await page.getByText('Relais', { exact: true }).first().click();
    const clickCollect = async () => {
      const response = page.waitForResponse(r => r.url().includes(`/parcels/${pa3}/collect`) && r.request().method() === 'POST');
      await page.locator('tr', { hasText: pa3 }).locator('[data-workspace-action="collect"]').click();
      return response;
    };
    // 1) Sans la capability d’exécution, le serveur refuse — quoi qu’affiche l’écran — et rien ne bouge.
    const denied = await clickCollect();
    report.refusals.push({ name: 'manager A sans execution.parcel.collect : remise refusée par le serveur (clic écran)', status: denied.status(), code: (await denied.json().catch(() => ({}))).code || null });
    expect(denied.status()).toBe(403);
    expect(await sqlN(`SELECT COUNT(*) n FROM parcels WHERE reference = $1 AND status = 'available'`, [pa3])).toBe(1);
    // 2) La capability est accordée par le mécanisme de délégation (membership + projection), puis l’action aboutit.
    await q(`INSERT INTO assignment_capability_ceiling(assignment_id,capability,granted_by) VALUES ($1,'execution.parcel.collect',$2) ON CONFLICT DO NOTHING`, [fx.assignmentA.id, fx.central.id]);
    await q(`INSERT INTO membership_capabilities(membership_id,capability,granted_by) VALUES ($1,'execution.parcel.collect',$2)`, [fx.managerAMembership.id, fx.central.id]);
    await projectAssignment(db, fx.assignmentA.id);
    const collectRes = await clickCollect();
    expect(collectRes.status(), JSON.stringify(await collectRes.json().catch(() => ({})))).toBe(200);
    const st = (await q(`SELECT p.status AS parcel, o.status AS ord FROM parcels p JOIN orders o ON o.id = p.order_id WHERE p.id IN (SELECT id FROM parcels WHERE reference = $1)`, [pa3])).rows[0];
    expect(st.parcel).toBe('collected');
    expect(await sqlN(`SELECT COUNT(*) n FROM scan_events WHERE parcel_id = (SELECT id FROM parcels WHERE reference = $1) AND event_type ILIKE '%collect%'`, [pa3]), 'trace de scan append-only').toBeGreaterThanOrEqual(1);
    // Aucune monnaie fantôme : remettre un colis ne crée ni ne déplace de cash.
    expect(await sqlN(`SELECT COALESCE(SUM(amount_kmf),0) n FROM cash_collections cc JOIN orders o ON o.id = cc.order_id WHERE o.market_id = $1`, [A])).toBe(cashBefore);
    // Nouvelle vérité aux écrans.
    const { api: r, text } = await visit('agentRelaisA', '/admin/relais-live', '/relay/dashboard');
    const parcels = st_ => sqlN(`SELECT COUNT(*) n FROM parcels WHERE relais_id = $1 AND status::text = ANY($2)`, [ids.rel.A, st_]);
    prove('Relais Live (après remise)', 'Disponibles au retrait', 'A (relais A)', 'agent relais A', await parcels(['available']), r.kpi.disponibles, after(text, 'DISPONIBLES AU RETRAIT', { anchor: 'FLUX DES RELAIS', gap: 6, flags: '' }));
    const { api: o, text: ot } = await visit('managerA', `/admin/operations?market=${M.A}`, '/operations/market/');
    const keyRelais = (o.control_chain.stages.find(s => s.label.toUpperCase() === 'RELAIS') || {}).key;
    prove('Opérations (après remise)', 'Commandes à l’étape RELAIS', M.A, 'manager A', await orderN(A, `status = 'available'`), o.control_chain.orders.filter(x => x.stage === keyRelais).length, after(ot, 'RELAIS', { anchor: 'Chaîne logistique', gap: 6, flags: '' }));
    const { api: acc } = await visit('managerA', `/admin/workspaces/accounting?market=${M.A}`, '/accounting/market/');
    expect(acc.reconciliation.held_kmf, 'le cash détenu ne bouge pas à la remise du colis').toBe(cashBefore);
    report.observations = report.observations || [];
    report.observations.push('Opérations (workspace) : le bouton « Remis au client » est affiché à un lecteur sans execution.parcel.collect ; le serveur refuse (403 MARKET_CAPABILITY_REQUIRED). À traiter par une source d’autorité unique des actions autorisées (décision d’architecture).');
    report.actions.push('Opérations : manager A remet le colis de A3 au client via le workspace → colis collected, trace de scan, Relais Live et Opérations décrémentent ; cash détenu inchangé (aucune monnaie créée)');
  });

  test('11 · Aucun effet externe pendant toute la recette', async () => {
    const effects = await externalEffects(db, guard);
    report.external_effects = effects;
    expect(Object.values(effects).reduce((n, v) => n + v, 0), JSON.stringify(effects)).toBe(0);
  });
});
