'use strict';
/** @komerce-arch-lite
 * @role g6d-refund-and-cash-deposit-real-chromium
 * @domain refunds
 * @layer e2e
 * @owner backend-core
 * @purpose F1 cash, F2 manual mobile money and relay cash deposit, played only through screens (real HTTP, disposable PG16, synthetic facts).
 * @impact-areas refunds, cash-custody
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const db = require('../../db');
const LOCAL = 'http://localhost:3917', ROOT = 'test-results/g6d';
const env = JSON.parse(fs.readFileSync(path.join(ROOT, 'env.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'prepare.json'), 'utf8'));
const run = env.G8_RUN8;
const blocked = [], jsErrors = [];
const sessions = [];

async function open(browser, email, landing) {
  const ctx = await browser.newContext({ baseURL: LOCAL }), page = await ctx.newPage();
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== LOCAL) { blocked.push(u.origin); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  page.on('pageerror', e => jsErrors.push(String(e.message).slice(0, 160)));
  await page.goto('/login.html?next=' + encodeURIComponent(landing), { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(env.G8_PASSWORD);
  await page.locator('#btn-submit').click();
  await page.waitForURL(u => u.pathname + u.search !== '/login.html', { timeout: 20000 });
  sessions.push(ctx);
  return page;
}
const g8 = (browser, email) => open(browser, email, '/g8-remboursements.html').then(async p => {
  p.on('dialog', d => d.accept());
  await expect(p.locator('#g8-env')).toHaveText('Recette autorisée', { timeout: 20000 });
  return p;
});
async function act(page, where, fields, name, suffix) {
  const node = page.locator(where);
  await expect(node).toBeVisible();
  for (const [k, v] of Object.entries(fields || {})) await node.locator(`[name="${k}"]`).fill(String(v));
  const resp = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(suffix));
  await node.getByRole('button', { name }).click();
  const r = await resp;
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}
async function replay(page, url, body) {
  const r = await page.request.post(url, { data: body || {}, headers: { origin: LOCAL } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}
async function reserve(admin, c, label) {
  await admin.locator('#g8-new-reservation summary').click();
  const out = await act(admin, '#g8-new-reservation', { order_id: c.orderId, order_item_id: c.itemId,
    incident_id: c.incidentId, quantity: 1, reason: `G6D ${label} manquant synthetique ${run}` }, 'Réserver cette dette', '/local-refund-reservations');
  expect(out.status).toBe(202);
  expect(out.body.paid).toBe(false);
  await expect(admin.locator(`[data-g8-case="${out.body.reservationId}"]`)).toBeVisible();
  return out.body;
}
const refunds = ids => db.query("SELECT COUNT(*)::int n FROM refunds WHERE order_id=ANY($1::uuid[]) AND status='completed'", [ids]).then(r => r.rows[0].n);

test.afterAll(async () => {
  for (const c of sessions) await c.close().catch(() => {});
  fs.writeFileSync(path.join(ROOT, 'g6d-evidence.json'), JSON.stringify({ blocked, jsErrors, realMoney: 0 }, null, 2));
});

test('G1 cash F1: reservation, admin authorizes, relay agent hands over and confirms with receipt, replay refused', async ({ browser }) => {
  const cash = plan.g8.cash, admin = await g8(browser, env.G8_ADMIN_EMAIL), relay = await g8(browser, env.G8_RELAY_EMAIL);
  const reserved = await reserve(admin, cash, 'cash');
  const caseId = reserved.reservationId;
  const authz = await act(admin, `[data-g8-case="${caseId}"]`, { holder_id: plan.ids.relay,
    original_payer_proof_ref: 'G6D-PAYER-' + run, identity_check_proof_ref: 'G6D-IDENT-' + run }, 'Autoriser la remise au relais', '/authorize-cash');
  expect(authz.status).toBe(201);
  expect(authz.body.paid).toBeFalsy();
  const authId = authz.body.authorizationId;
  const base = `/api/relay/orders/${cash.orderId}/items/${cash.itemId}/local-cash-handoffs/${authId}`;
  // The admin cannot hand cash over in the relay's place.
  expect((await replay(admin, base + '/start')).status).toBe(403);
  await relay.locator('#g8-refresh').click();
  const rel = `[data-g8-case="${authId}"]`;
  await expect(relay.locator(rel)).toBeVisible();
  const start = await act(relay, rel, null, 'Engager une remise physique', '/start');
  expect(start.status).toBe(202);
  await relay.locator('#g8-refresh').click();
  const ev = { signed_receipt_ref: 'G6D-RECEIPT-' + run, payer_signature_proof_ref: 'G6D-SIGN-' + run, witness_proof_ref: 'G6D-WITNESS-' + run };
  const done = await act(relay, rel, ev, 'Confirmer après remise réelle des espèces', '/confirm');
  expect(done.status).toBe(200);
  expect(done.body.paid).toBe(true);
  await expect(relay.locator('#g8-status')).toContainText('reçu');
  // Screen after settlement: no remaining action, only the closed notice.
  await expect(relay.locator(`${rel} button`)).toHaveCount(0);
  await expect(relay.locator(rel)).toContainText('Remise clôturée');
  await relay.locator('#g8-refresh').click();
  await expect(relay.locator(`${rel} button`)).toHaveCount(0);
  // Replays: no second start, no second payout, divergent evidence refused.
  const restart = await replay(relay, base + '/start');
  expect(restart.body.paid).toBe(true);            // answers with the settled state, engages nothing new
  expect(restart.body.status).toBe('settled');
  const again = await replay(relay, base + '/confirm', ev);
  expect(again.body.replayed).toBe(true);
  expect(again.body.refundId).toBe(done.body.refundId);
  expect((await replay(relay, base + '/confirm', { ...ev, signed_receipt_ref: 'G6D-OTHER-' + run })).status).toBe(409);
  expect(await refunds([cash.orderId])).toBe(1);
  expect((await db.query('SELECT COUNT(*)::int n FROM local_cash_refund_payouts WHERE order_id=$1', [cash.orderId])).rows[0].n).toBe(1);
  await relay.screenshot({ path: path.join(ROOT, 'f1-cash.png'), fullPage: true });
});

test('G2 mobile money F2: reservation, admin authorizes, manual transfer with proof, replay refused', async ({ browser }) => {
  const mm = plan.g8.mobile;
  const admin = await g8(browser, env.G8_ADMIN_EMAIL), operator = await g8(browser, env.G8_OPERATOR_EMAIL), reviewer = await g8(browser, env.G8_REVIEWER_EMAIL);
  const reserved = await reserve(admin, mm, 'mobile');
  const id = reserved.reservationId, sel = `[data-g8-case="${id}"]`;
  const payer = crypto.createHash('sha256').update('G6D-' + run).digest('hex');
  const approved = await act(admin, sel, { operator_id: plan.ids.operator, payer_fingerprint: payer,
    original_payer_proof_ref: 'G6D-MM-PAYER-' + run }, 'Autoriser le virement manuel', '/approve');
  expect(approved.status).toBe(202);
  const stem = `/api/admin/orders/${mm.orderId}/items/${mm.itemId}/local-refund-reservations/${id}/manual-mobile`;
  expect((await replay(admin, stem + '/start')).status).toBe(403);
  await operator.locator('#g8-refresh').click();
  const started = await act(operator, sel, null, 'Prendre en charge le transfert externe', '/start');
  expect(started.status).toBe(202);
  const proof = { amount_minor: reserved.amountMinor, currency: 'KMF', payee_fingerprint: payer,
    capture_external_transaction_id: mm.captureRef, transfer_ref: 'G6D-TRANSFER-' + run,
    transfer_proof_ref: 'G6D-PROVIDER-RECEIPT-' + run, operator_verification_ref: 'G6D-REVIEW-' + run };
  expect((await replay(operator, stem + '/confirm', proof)).status).toBe(403); // not their own transfer
  await reviewer.locator('#g8-refresh').click();
  const done = await act(reviewer, sel, proof, 'Rapprocher le virement déjà exécuté', '/confirm');
  expect(done.status).toBe(200);
  expect(done.body.paid).toBe(true);
  await expect(reviewer.locator('#g8-status')).toContainText('reçu');
  await expect(reviewer.locator(`${sel} button`)).toHaveCount(0);
  await expect(reviewer.locator(sel)).toContainText('Virement rapproché');
  expect((await replay(reviewer, stem + '/start')).body.status).not.toBe('transfer_pending'); // nothing re-engaged
  const again = await replay(reviewer, stem + '/confirm', proof);
  expect(again.body.replayed).toBe(true);
  expect(again.body.refundId).toBe(done.body.refundId);
  expect(await refunds([mm.orderId])).toBe(1);
  await reviewer.screenshot({ path: path.join(ROOT, 'f2-mobile.png'), fullPage: true });
});

test('G3 cash deposit: declared by the relay agent on screen, then accepted by the admin on screen', async ({ browser }) => {
  const M = env.G6D_DEP_MARKET;
  const answers = a => p => { p.removeAllListeners('dialog'); p.on('dialog', d => {
    if (d.type() === 'confirm') return d.accept();
    const next = a.shift();
    return next == null ? d.dismiss() : d.accept(typeof next === 'function' ? next(d.message()) : String(next)); }); };
  const agent = await open(browser, env.G6D_DEP_AGENT_EMAIL, `/admin/relais-live?view=execute&market=${M}`);
  await agent.getByText('Cash & dépôts').first().click();       // the relay's own workstation tab
  await expect(agent.getByText('Remettre des espèces').first()).toBeVisible({ timeout: 20000 });
  const pickAdmin = msg => msg.split('\n').find(l => l.includes(env.G6D_DEP_ADMIN_NAME)).split('.')[0];
  answers([pickAdmin, 'KMF', '40000', 'G6D-REC-' + run, ''])(agent);
  const declared = agent.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/deposits'));
  await agent.locator('[data-workspace-action="create-cash-deposit"]').click();
  const d = await declared;
  expect(d.status()).toBe(201);
  const ref = JSON.stringify(await d.json()).match(/KDP-\d+/)[0];
  const row = () => db.query(`SELECT d.status, (SELECT COUNT(*)::int FROM cash_custody_receipts r WHERE r.deposit_id=d.id) AS receipts,
      (SELECT COALESCE(SUM(delta_kmf),0)::int FROM cash_custody_movements WHERE holder_id=$2) AS held
      FROM cash_deposits d WHERE d.deposit_ref=$1`, [ref, env.G6D_DEP_AGENT_ID]).then(r => r.rows[0]);
  const before = await row();
  expect(before.receipts).toBe(0);
  expect(before.held).toBe(100000);   // declaration alone discharges nobody
  const admin = await open(browser, env.G6D_DEP_ADMIN_EMAIL, `/admin/relais-live?view=execute&market=${M}`);
  await admin.getByText('Cash & dépôts').first().click();
  await expect(admin.getByText(ref).first()).toBeVisible({ timeout: 20000 });
  answers(['40000', ''])(admin);
  const received = admin.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/custody/${ref}/receipt`));
  await admin.locator('[data-workspace-action="record-custody-receipt"]').first().click();
  expect((await received).status()).toBe(201);
  const after = await row();
  expect(after.receipts).toBe(1);
  expect(after.held).toBe(60000);     // 40 000 transferred on acceptance only
  // Replay refused: no button left, and the API refuses a second reception.
  await admin.reload();
  await admin.getByText('Cash & dépôts').first().click();
  await expect(admin.getByText(ref).first()).toBeVisible({ timeout: 20000 });
  await expect(admin.locator('[data-workspace-action="record-custody-receipt"]')).toHaveCount(0);
  const second = await replay(admin, `/api/admin/workspaces/accounting/market/${M}/custody/${ref}/receipt`, { outcome: 'received', received_amount: 40000 });
  expect(second.status).toBeGreaterThanOrEqual(400);
  expect((await row()).receipts).toBe(1);
  await admin.screenshot({ path: path.join(ROOT, 'deposit-admin.png'), fullPage: true });
  expect(blocked).toEqual([]);
  expect(jsErrors).toEqual([]);
});
