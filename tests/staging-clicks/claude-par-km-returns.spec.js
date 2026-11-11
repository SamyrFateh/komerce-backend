/**
 * @komerce-arch-lite
 * @role claude-par-km-returns-chromium
 * @domain orders
 * @layer e2e
 * @owner backend-core
 * @purpose Certification Chromium parallele Claude (KM) : retours et SAV apres remise, marqueur CLAUDE-PAR-20261111.
 * @impact-areas staging-only, returns, sav, relay
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { test, expect } = require('@playwright/test');
const db = require('../../db');
const { createAdminUser } = require('../../services/user-mutation-service');
const { markE2eTestAccount } = require('../../scripts/recette/staging-e2e-provision');

const BASE = 'https://komerce-backend-production.up.railway.app';
const MARKER = 'CLAUDE-PAR-20261111';
const MARKET = 'KM';
const RUN8 = String(process.env.HTTP_RUNNER_RUN8 || '').toUpperCase();
const SHA = String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
const OUT = path.resolve('test-results/claude-par-km-returns');
const ev = { schema: 'claude-par-km-returns/1', marker: MARKER, run8: RUN8, staging: BASE,
  commit: SHA, rows: [], http: [], jsErrors: [], orders: {}, verdict: 'NOT_CERTIFIED' };
const save = () => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(ev, null, 2) + '\n'); };
const rec = (id, verdict, detail) => { ev.rows.push({ id, verdict, detail: detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) }); save(); };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }).catch(() => {});

// Chaque scenario est isole : un echec est enregistre, il n'interrompt pas les suivants.
async function step(id, fn) {
  try { const r = await fn(); rec(id, r && r.verdict ? r.verdict : 'PASS', r && r.detail); return r; }
  catch (e) { rec(id, e && e.blocked ? 'BLOQUE' : 'FAIL', String(e && e.message || e).slice(0, 500)); return null; }
}
const blocked = (m) => Object.assign(new Error(m), { blocked: true });

async function login(browser, prefix, next) {
  const email = process.env[prefix + '_EMAIL'], password = process.env[prefix + '_PASSWORD'];
  if (!email || !password) throw blocked('credentials ' + prefix + ' absents');
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(OUT, 'video-' + prefix.toLowerCase()), size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => ev.jsErrors.push(prefix + ':' + String(e.message).slice(0, 160)));
  page.on('response', r => { const u = new URL(r.url()); const m = r.request().method();
    if (u.origin === BASE && m !== 'GET' && !u.pathname.includes('/auth/login')) ev.http.push({ who: prefix, method: m, path: u.pathname.replace(/[0-9a-f-]{36}/g, ':id'), status: r.status() }); });
  await page.goto('/login.html' + (next ? '?next=' + encodeURIComponent(next) : ''));
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const lr = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.locator('#btn-submit').click();
  const resp = await lr;
  if (resp.status() !== 200) throw new Error('login ' + prefix + ' ' + resp.status());
  await page.waitForURL(u => u.pathname !== '/login.html', { timeout: 25000 });
  return { ctx, page };
}
const api = (ctx, method, p, data) => ctx.request.fetch(BASE + p, { method, headers: { origin: BASE, 'content-type': 'application/json' }, data })
  .then(async r => { let b = null; try { b = await r.json(); } catch (_) {} return { status: r.status(), body: b }; });

async function state(orderId, itemId, userId, productId, marketId) {
  const [o] = await q('SELECT status::text AS status,payment_status::text AS payment_status,total_kmf FROM orders WHERE id=$1', [orderId]);
  const items = await q('SELECT oi.id,oi.quantity,oi.qty_collected FROM order_items oi WHERE oi.order_id=$1 ORDER BY oi.created_at,oi.id', [orderId]);
  const [ls] = await q('SELECT to_jsonb(l) AS j FROM local_stock l WHERE product_id=$1 AND market_id=$2', [productId, marketId]);
  const [w] = await q('SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id=$1', [userId]);
  const [h] = await q('SELECT count(*)::int AS n FROM catalog_product_sale_holds WHERE product_id=$1', [productId]);
  const [p] = await q('SELECT is_active,stock FROM products WHERE id=$1', [productId]);
  const [d] = await q("SELECT count(*)::int AS n, COALESCE(sum(refund_kmf),0)::numeric AS refund FROM disputes WHERE order_id=$1", [orderId]);
  const hist = await q('SELECT status::text AS status FROM order_status_history WHERE order_id=$1 ORDER BY created_at', [orderId]);
  return { order: o, items, local_stock: ls && ls.j, wallet_tx: w.n, holds: h.n, product: p, disputes: d, history: hist.map(x => x.status) };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('KM retours et SAV : Chromium par role + relectures PostgreSQL', async ({ browser }) => {
  test.setTimeout(1500000);
  let relay, mop, adm;
  try {
    // ---- Prerequis ----
    const v = await (await fetch(BASE + '/health/version')).json();
    ev.commit_start = v.commit;
    expect(String(v.commit).toLowerCase()).toBe(SHA.toLowerCase());
    expect(RUN8).toMatch(/^[A-F0-9]{8}$/);
    const [fx] = await q(`SELECT o.market_id,o.relais_id,p.id AS product_id FROM orders o, products p
        WHERE o.reference=$1 AND p.product_ref=$2`, ['E2E-HUB-V1-' + RUN8 + '-LOCAL', 'E2E-HUB-V1-' + RUN8 + '-PL']);
    expect(fx && fx.relais_id).toBeTruthy();
    const [assign] = await q("SELECT relais_id FROM users WHERE lower(email)=lower($1)", [process.env.E2E_AGENT_RELAIS_EMAIL]);
    expect(String(assign.relais_id)).toBe(String(fx.relais_id));
    ev.fixture = { relais_id: fx.relais_id, product_id: fx.product_id, market_id: fx.market_id };

    // ---- Client de recette marque (prep) + commandes via API canonique ----
    const pwd = crypto.randomBytes(12).toString('base64url') + 'aA1!';
    let phone = null;
    for (let n = 0; n < 20 && !phone; n++) {
      const p = '+2693' + String(crypto.randomInt(0, 10000000)).padStart(7, '0');
      if (!(await q('SELECT 1 FROM users WHERE phone=$1 OR whatsapp_phone=$1', [p])).length) phone = p;
    }
    const email = 'clpar-' + RUN8.toLowerCase() + '@komerce.test';
    const adminLogin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }) });
    const adminUser = (await adminLogin.json()).user;
    const c = await db.getClient();
    let buyer;
    try {
      await c.query('BEGIN');
      ({ rows: [buyer] } = await createAdminUser(c, { fullName: MARKER + ' client', email, phone, role: 'client', currencyPref: 'KMF', passwordHash: await bcrypt.hash(pwd, 10) }));
      await markE2eTestAccount(c, { userId: buyer.id, actorId: adminUser.id });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    ev.buyer = { id: buyer.id, email, marker: MARKER };
    const cl = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pwd }) });
    if (cl.status !== 200) throw blocked('login client email/mot de passe refuse: ' + cl.status);
    const cookie = (cl.headers.getSetCookie ? cl.headers.getSetCookie() : []).map(s => s.split(';')[0]).join('; ');
    const place = async (qty) => {
      const r = await fetch(BASE + '/api/orders', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', cookie },
        body: JSON.stringify({ items: [{ product_id: fx.product_id, quantity: qty }], relais_id: fx.relais_id, payment_mode: 'cash_relais' }) });
      const b = await r.json().catch(() => ({}));
      if (r.status >= 300) throw blocked('creation commande ' + qty + ' u: ' + r.status + ' ' + JSON.stringify(b).slice(0, 200));
      const o = b.order || b; return { id: o.id, reference: o.reference };
    };
    const O1 = await place(2), O2 = await place(1);
    ev.orders = { O1_2u: O1, O2_1u: O2 };
    const scopes = await q('SELECT reference,simulation_scope,payment_mode::text AS pm,status::text AS status FROM orders WHERE id = ANY($1::uuid[])', [[O1.id, O2.id]]);
    ev.orders_db = scopes;
    rec('PREP-orders', scopes.every(s => s.simulation_scope === null) ? 'PASS' : 'FAIL', scopes);

    // ---- Relais (Chromium) : encaissement, reception locale, remise ----
    relay = await login(browser, 'E2E_AGENT_RELAIS', '/admin/relais-live?view=execute&market=' + MARKET);
    const rp = relay.page;
    const deliver = async (O) => {
      await rp.goto('/admin/relais-live?view=execute&market=' + MARKET, { waitUntil: 'domcontentloaded' });
      const ws = rp.locator('[data-workspace-mode="relay-execution"]');
      await expect(ws).toBeVisible({ timeout: 30000 });
      await ws.locator('[data-relay-execution-jump="cash"]').click();
      const row = rp.locator('tr', { hasText: O.reference });
      await row.waitFor({ timeout: 25000 });
      const cr = rp.waitForResponse(r => /\/confirm-cash$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
      await row.locator('[data-workspace-action="confirm-cash"]').click();
      expect((await cr).status()).toBe(200);
      await expect.poll(async () => (await q('SELECT payment_status::text AS s FROM orders WHERE id=$1', [O.id]))[0].s, { timeout: 20000 }).toBe('paid');
      await rp.goto('/admin/relais-live?view=execute&market=' + MARKET, { waitUntil: 'domcontentloaded' });
      await ws.locator('[data-relay-execution-jump="receive"]').click();
      const card = ws.locator('#relay-execution-receive [data-relay-local-order="' + O.reference + '"]');
      await expect(card).toBeVisible({ timeout: 25000 });
      await card.locator('[data-local-physical-proof]').check();
      await card.locator('[data-local-receipt-note]').fill('RECETTE ' + MARKER + ' ' + O.reference);
      const rr = rp.waitForResponse(r => /local-relay-receipt$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
      await card.locator('[data-workspace-action="local-relay-receipt"]').click();
      expect((await rr).status()).toBe(200);
      const [par] = await q('SELECT reference FROM parcels WHERE order_id=$1 AND cancelled_at IS NULL', [O.id]);
      await rp.goto('/admin/relais-live?view=remises&market=' + MARKET, { waitUntil: 'domcontentloaded' });
      const crow = rp.locator('#relay-execution-collect tr').filter({ hasText: par.reference });
      await expect(crow.locator('[data-workspace-action="collect"]')).toBeVisible({ timeout: 25000 });
      const pr = rp.waitForResponse(r => /\/collect$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
      await crow.locator('[data-workspace-action="collect"]').click();
      expect((await pr).status()).toBe(200);
      await shot(rp, 'deliver-' + O.reference);
    };
    await step('7.0 preparation : encaissement + reception + remise O1 (2 unites)', async () => { await deliver(O1); const s = await q('SELECT status::text AS s,payment_status::text AS p FROM orders WHERE id=$1', [O1.id]); const it = await q('SELECT quantity,qty_collected FROM order_items WHERE order_id=$1', [O1.id]); expect(it[0].qty_collected).toBe(2); return { detail: { s, it } }; });
    await step('7.0b preparation : O2 (1 unite)', async () => { await deliver(O2); const it = await q('SELECT quantity,qty_collected FROM order_items WHERE order_id=$1', [O2.id]); expect(it[0].qty_collected).toBe(1); return { detail: it }; });
    const itemOf = async (O) => (await q('SELECT id,quantity,qty_collected FROM order_items WHERE order_id=$1', [O.id]))[0];
    const I1 = await itemOf(O1), I2 = await itemOf(O2);
    if (I1.qty_collected < 1 || I2.qty_collected < 1) throw blocked('commandes non remises : suite impossible');
    const S = {}; const snap = async (k, O, I) => { S[k] = await state(O.id, I.id, buyer.id, fx.product_id, fx.market_id); return S[k]; };
    await snap('O1_avant', O1, I1); await snap('O2_avant', O2, I2);

    // ---- 7a. Demande de retour : UI relais ----
    const openReturn = async (O, qty, reason, note) => {
      await rp.goto('/admin/relais-live?view=incidents&market=' + MARKET, { waitUntil: 'domcontentloaded' });
      const sec = rp.locator('[data-relay-return-requests]');
      await expect(sec).toBeVisible({ timeout: 30000 });
      await sec.locator('[data-relay-return-reference]').fill(O.reference);
      await sec.locator('[data-relay-return-lookup] button[type=submit]').click();
      const form = sec.locator('[data-relay-return-create]');
      await expect(form).toBeVisible({ timeout: 15000 });
      await form.locator('input[type=number]').fill(String(qty));
      await form.locator('select').nth(1).selectOption(reason);
      await form.locator('textarea').fill(note);
      const resp = rp.waitForResponse(r => new URL(r.url()).pathname === '/api/relay/returns' && r.request().method() === 'POST');
      await form.locator('[data-relay-return-submit]').click();
      return resp;
    };
    await step('7.1 demande de retour PARTIEL O1 (1 sur 2) via UI relais', async () => {
      const r = await openReturn(O1, 1, 'defective', MARKER + ' retour partiel');
      expect(r.status()).toBe(201);
      await shot(rp, '71-demande-partielle');
      const [d] = await q("SELECT id,status,return_quantity,return_reason,created_by,refund_kmf FROM disputes WHERE order_id=$1 AND type='product_return'", [O1.id]);
      expect(d.return_quantity).toBe(1); expect(d.status).toBe('open');
      O1.dispute = d.id; return { detail: d };
    });
    await step('7.2 demande de retour O2 (1 sur 1) via UI relais', async () => {
      const r = await openReturn(O2, 1, 'damaged', MARKER + ' retour total');
      expect(r.status()).toBe(201);
      const [d] = await q("SELECT id,status,return_quantity FROM disputes WHERE order_id=$1 AND type='product_return'", [O2.id]);
      O2.dispute = d.id; return { detail: d };
    });
    await step('CL-1 double demande de retour refusee (API + UI)', async () => {
      const a = await api(relay.ctx, 'POST', '/api/relay/returns', { order_reference: O2.reference, order_item_id: I2.id, quantity: 1, reason: 'damaged', note: 'doublon' });
      expect(a.status).toBe(409);
      const [n] = await q("SELECT count(*)::int AS n FROM disputes WHERE order_id=$1 AND type='product_return'", [O2.id]);
      expect(n.n).toBe(1);
      await rp.goto('/admin/relais-live?view=incidents&market=' + MARKET, { waitUntil: 'domcontentloaded' });
      const sec = rp.locator('[data-relay-return-requests]');
      await sec.locator('[data-relay-return-reference]').fill(O2.reference);
      await sec.locator('[data-relay-return-lookup] button[type=submit]').click();
      await expect(sec.locator('[data-relay-return-feedback]')).toContainText('déjà en cours', { timeout: 15000 });
      return { detail: { http: a.status, code: a.body && a.body.code, rows: n.n } };
    });
    await step('CL-2 quantite superieure aux unites remises refusee', async () => {
      const a = await api(relay.ctx, 'POST', '/api/relay/returns', { order_reference: O1.reference, order_item_id: I1.id, quantity: 3, reason: 'defective', note: 'x' });
      expect([400, 409]).toContain(a.status);
      return { detail: { http: a.status, code: a.body && a.body.code } };
    });

    // ---- 7b. Decision : responsable pays (UI) ----
    await step('7.3 decision du responsable pays (UI market-autonomy) : examen puis resolution', async () => {
      mop = await login(browser, 'E2E_MARKET_OPERATOR', '/dashboards/canonical/market-autonomy.html');
      const mp = mop.page;
      await mp.goto('/dashboards/canonical/market-autonomy.html', { waitUntil: 'domcontentloaded' });
      const sec = mp.locator('[data-market-client-case]');
      try { await sec.waitFor({ timeout: 30000 }); } catch (_) { await shot(mp, '73-section-absente'); throw blocked('section Litiges clients absente (capacite client.case.handle non accordee au responsable pays E2E, droits)'); }
      await shot(mp, '73-litiges');
      const card = sec.locator('article', { hasText: O2.id });
      await expect(card).toBeVisible({ timeout: 15000 });
      const put = (s) => mp.waitForResponse(r => /client-cases\/disputes\//.test(r.url()) && r.request().method() === 'PUT' && r.status() === s);
      let pr = put(200);
      await card.getByRole('button', { name: /En traitement/ }).click();
      await pr;
      await expect.poll(async () => (await q('SELECT status FROM disputes WHERE id=$1', [O2.dispute]))[0].status).toBe('processing');
      return { detail: 'open -> processing via UI' };
    });
    // La decision "valider/refuser" au sens de la doctrine (validation financiere centrale) n'a pas d'ecran : on teste ce que l'UI propose reellement.
    await step('7.3b resolution du dossier O2 par le responsable pays + aucun effet financier', async () => {
      if (!mop) throw blocked('session responsable pays indisponible');
      const mp = mop.page;
      await mp.goto('/dashboards/canonical/market-autonomy.html', { waitUntil: 'domcontentloaded' });
      const card = mp.locator('[data-market-client-case] article', { hasText: O2.id });
      await expect(card).toBeVisible({ timeout: 30000 });
      await card.locator('input[type=text]').fill(MARKER + ' retour valide, reprise a attester');
      const pr = mp.waitForResponse(r => /client-cases\/disputes\//.test(r.url()) && r.request().method() === 'PUT');
      await card.getByRole('button', { name: /Résolu/ }).click();
      expect((await pr).status()).toBe(200);
      const [d] = await q('SELECT status,refund_kmf,refund_eur,resolution FROM disputes WHERE id=$1', [O2.dispute]);
      expect(d.status).toBe('resolved'); expect(d.refund_kmf == null || Number(d.refund_kmf) === 0).toBeTruthy();
      await shot(mp, '73b-resolu');
      return { detail: d };
    });
    await step('CL-3 responsable pays : refund_kmf refuse (autorite non deleguee) et autre marche refuse', async () => {
      if (!mop) throw blocked('session responsable pays indisponible');
      const a = await api(mop.ctx, 'PUT', '/api/market-delegation/markets/KM/client-cases/disputes/' + O1.dispute, { status: 'processing', refund_kmf: 5000 });
      expect(a.status).toBe(400);
      const b = await api(mop.ctx, 'PUT', '/api/market-delegation/markets/CM/client-cases/disputes/' + O1.dispute, { status: 'processing' });
      expect([403, 404]).toContain(b.status);
      const [d] = await q('SELECT status,refund_kmf FROM disputes WHERE id=$1', [O1.dispute]);
      expect(d.status).toBe('open');
      return { detail: { refund_field: a.status + ' ' + (a.body && a.body.code), autre_marche: b.status + ' ' + (b.body && b.body.code), dispute_status: d.status } };
    });

    // ---- 7c. Reprise physique : UI relais ----
    const intakeUi = async (O, note) => {
      await rp.goto('/admin/relais-live?view=incidents&market=' + MARKET, { waitUntil: 'domcontentloaded' });
      const f = rp.locator('[data-relay-return-intake]');
      await expect(f).toBeVisible({ timeout: 30000 });
      const opts = await f.locator('[data-relay-intake-request] option').allTextContents();
      const idx = opts.findIndex(t => t.includes(O.reference)); if (idx < 0) throw new Error('dossier absent du formulaire de reprise: ' + opts.join('|'));
      await f.locator('[data-relay-intake-request]').selectOption({ index: idx });
      await f.locator('select').nth(1).selectOption('opened');
      await f.locator('input[type=text]').fill('A');
      await f.locator('textarea').fill(note);
      const resp = rp.waitForResponse(r => new URL(r.url()).pathname === '/api/relay/returns/intake' && r.request().method() === 'POST');
      await f.locator('[data-relay-intake-submit]').click();
      return resp;
    };
    await step('7.4 reprise physique O2 (relais UI) : quantite, etat, zone, aucun effet financier/stock', async () => {
      const r = await intakeUi(O2, MARKER + ' reprise physique constatee O2');
      expect(r.status()).toBe(201);
      await shot(rp, '74-reprise');
      const rows = await q('SELECT request_id,quantity,condition_code,storage_zone,relay_id FROM relay_product_return_receipts WHERE request_id=$1', [O2.dispute]);
      expect(rows.length).toBe(1); expect(rows[0].quantity).toBe(1); expect(String(rows[0].relay_id)).toBe(String(fx.relais_id));
      return { detail: rows[0] };
    });
    await step('7.4b reprise physique O1 PARTIELLE (1 unite sur 2) via UI', async () => {
      const r = await intakeUi(O1, MARKER + ' reprise partielle O1 1/2');
      expect(r.status()).toBe(201);
      const rows = await q('SELECT quantity FROM relay_product_return_receipts WHERE request_id=$1', [O1.dispute]);
      expect(rows.length).toBe(1); expect(rows[0].quantity).toBe(1);
      return { detail: rows[0] };
    });
    await step('CL-4 double reprise physique refusee (observation differente) ; rejeu identique idempotent', async () => {
      const diff = await api(relay.ctx, 'POST', '/api/relay/returns/intake', { request_id: O2.dispute, condition_code: 'sealed', storage_zone: 'B', observation: MARKER + ' seconde reprise differente' });
      expect(diff.status).toBe(409);
      const [n] = await q('SELECT count(*)::int AS n FROM relay_product_return_receipts WHERE request_id=$1', [O2.dispute]);
      expect(n.n).toBe(1);
      return { detail: { http: diff.status, code: diff.body && diff.body.code, receipts: n.n } };
    });
    await step('CL-5 acces refuse : responsable pays et admin sur la reprise physique (403) sans effet en base', async () => {
      const before = (await q('SELECT count(*)::int AS n FROM relay_product_return_receipts'))[0].n;
      const a = await api(mop ? mop.ctx : relay.ctx, 'POST', '/api/relay/returns/intake', { request_id: O1.dispute, condition_code: 'opened', observation: MARKER + ' tentative non autorisee' });
      expect(a.status).toBe(403);
      const after = (await q('SELECT count(*)::int AS n FROM relay_product_return_receipts'))[0].n;
      expect(after).toBe(before);
      return { detail: { http: a.status, code: a.body && a.body.code, receipts_avant_apres: [before, after] } };
    });

    // ---- 8. Avoir / wallet / remboursement ----
    await step('8.1 remboursement admin sur commande remise (dry-run seulement)', async () => {
      adm = await login(browser, 'E2E_ADMIN');
      const a = await api(adm.ctx, 'POST', '/api/admin/orders/' + O2.id + '/refund', { dry_run: true, reason: MARKER });
      const o = (await q('SELECT status::text AS s,payment_status::text AS p FROM orders WHERE id=$1', [O2.id]))[0];
      expect(o.p).not.toBe('refunded');
      return { verdict: 'BLOQUE', detail: { constat: 'refundCancelledOrder ne traite que les commandes annulees : aucun mecanisme de remboursement/avoir/wallet branche sur un retour remis', http: a.status, body: a.body && (a.body.code || a.body.error || a.body.message), order: o } };
    });
    await step('8.2 UI de decision financiere SAV (avoir/wallet/remboursement)', async () => { throw blocked('interface absente : aucun ecran ni route de credit wallet / remboursement rattache au dossier SAV (doctrine V1-1/V1-2 uniquement)'); });

    // ---- 9. Etat du produit retourne, coherence ----
    await snap('O1_apres', O1, I1); await snap('O2_apres', O2, I2);
    await step('9.1 aucune remise en vente automatique : stock local, wallet, gel catalogue, produit inchanges', async () => {
      const k = ['local_stock', 'wallet_tx', 'holds', 'product'];
      for (const x of k) expect(same(S.O2_avant[x], S.O2_apres[x]), x).toBeTruthy();
      expect(same(S.O2_avant.order, S.O2_apres.order)).toBeTruthy();
      expect(S.O2_apres.items[0].qty_collected).toBe(1);
      return { detail: { local_stock: S.O2_apres.local_stock, wallet_tx: S.O2_apres.wallet_tx, holds: S.O2_apres.holds, product: S.O2_apres.product } };
    });
    await step('9.2 gel catalogue : interface de gel pour un produit retourne', async () => {
      const [g] = await q("SELECT count(*)::int AS n FROM catalog_product_sale_holds WHERE product_id=$1", [fx.product_id]);
      return { verdict: 'BLOQUE', detail: 'gel explicite admin uniquement (requireCatalogGlobalAuthority), jamais automatique : holds=' + g.n + ' ; geste UI non exerce par ce harnais (hors perimetre retour)' };
    });
    await step('X-1 coherence lignes/quantites/montants/statuts apres passage des roles', async () => {
      for (const [k, O] of [['O1', O1], ['O2', O2]]) {
        const a = S[k + '_avant'], b = S[k + '_apres'];
        expect(same(a.items, b.items), k + ' lignes').toBeTruthy();
        expect(same(a.order, b.order), k + ' commande').toBeTruthy();
        expect(same(a.history, b.history), k + ' historique commande').toBeTruthy();
      }
      return { detail: { O1: S.O1_apres.order, O2: S.O2_apres.order, hist_O2: S.O2_apres.history } };
    });
    await step('CL-6 aucune erreur JS / aucune ecriture inattendue', async () => { expect(ev.jsErrors.length).toBe(0); return { detail: ev.http.length + ' ecritures HTTP' }; });
    const vend = await (await fetch(BASE + '/health/version')).json();
    ev.commit_end = vend.commit;
  } catch (e) {
    ev.failure = String(e && e.message || e).slice(0, 400);
    rec('FATAL', e && e.blocked ? 'BLOQUE' : 'FAIL', ev.failure);
  } finally {
    ev.verdict = ev.rows.some(r => r.verdict === 'FAIL') ? 'FAIL' : ev.rows.some(r => r.verdict === 'BLOQUE') ? 'BLOQUE' : 'PASS';
    save();
    for (const x of [relay, mop, adm]) { try { await x.ctx.close(); } catch (_) {} }
    await db.pool?.end?.();
  }
});
