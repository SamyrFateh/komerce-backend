'use strict';
/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires postgres
 */
/**
 * @komerce-arch-lite
 * @role g6e-relay-cash-chromium
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Geste Relais « Encaisser » dans Chromium local sur commande cash en attente au relais de l'agent.
 * @impact-areas relay, cash
 */
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const db = require('../../db');

const EMAIL = process.env.E2E_AGENT_RELAIS_EMAIL;
const PASSWORD = process.env.E2E_AGENT_RELAIS_PASSWORD;
const ref = 'G6E-CASH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
let orderId;

test.beforeAll(async () => {
  const { rows: [agent] } = await db.query('SELECT relais_id FROM users WHERE lower(email)=lower($1)', [EMAIL]);
  const { rows: [tpl] } = await db.query('SELECT user_id, market_id FROM orders WHERE relais_id=$1 LIMIT 1', [agent.relais_id]);
  orderId = crypto.randomUUID();
  await db.query(
    `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status, simulation_scope, cash_ref_code)
     VALUES ($1,$2,$3,$4,$5,8000,'cash_relais','pending','pending','E2E-HUB-V1',$6)`,
    [orderId, ref, tpl.user_id, agent.relais_id, tpl.market_id, 'CASH' + ref.slice(-6)]);
});

test.afterAll(async () => { await db.pool?.end?.(); });

test('Relais : Encaisser un paiement cash en attente', async ({ page }) => {
  expect(EMAIL && PASSWORD).toBeTruthy();
  const target = '/admin/relais-live?view=execute&market=KM';
  await page.goto('/login.html?next=' + encodeURIComponent(target));
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#btn-submit').click();
  await page.waitForURL(u => u.pathname === '/admin/relais-live', { timeout: 20000 });
  const workspace = page.locator('[data-workspace-mode="relay-execution"]');
  await expect(workspace).toBeVisible({ timeout: 25000 });
  const jump = workspace.locator('[data-relay-execution-jump="cash"]');
  await expect(jump).toBeVisible();
  await jump.click();
  const row = workspace.locator('tr', { hasText: ref });
  await expect(row).toBeVisible({ timeout: 20000 });
  page.on('dialog', d => d.accept());
  await row.locator('[data-workspace-action="confirm-cash"]').click();
  await expect(page.locator('[data-workspace-feedback]')).toContainText('action appliquée', { timeout: 20000 });
  const { rows: [o] } = await db.query('SELECT payment_status FROM orders WHERE id=$1', [orderId]);
  expect(o.payment_status).toBe('paid');
});
