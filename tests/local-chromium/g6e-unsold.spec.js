/**
 * @komerce-arch-lite
 * @role g6e-unsold-chromium
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Geste Invendus G6-E dans Chromium local : lister, modifier, résoudre, scan refusé (F3), commande payée absente.
 * @impact-areas unsold, f3
 */
'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { test, expect } = require('@playwright/test');
const db = require('../../db');

const tag = crypto.randomBytes(3).toString('hex');
const PASSWORD = 'G6eLocal#Pass2026';
const ids = { admin: crypto.randomUUID(), buyer: crypto.randomUUID(), relay: crypto.randomUUID(), orders: [] };

async function seedOrder(label, paymentStatus, marketId) {
  const id = crypto.randomUUID();
  ids.orders.push(id);
  await db.query(
    `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status, available_at)
     VALUES ($1,$2,$3,$4,$5,8000,'cash_relais',$6,'available', NOW() - interval '30 days')`,
    [id, `G6E-UNS-${tag}-${label}`, ids.buyer, ids.relay, marketId, paymentStatus]);
  return id;
}

test.beforeAll(async () => {
  const { rows: [m] } = await db.query(`SELECT id FROM markets WHERE code='KM'`);
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.query(`INSERT INTO users (id, full_name, email, phone, role, password_hash) VALUES
    ($1,'G6E Admin',$2,$3,'admin',$4), ($5,'G6E Acheteur',$6,$7,'client',NULL)`,
  [ids.admin, `g6e-admin-${tag}@komerce.test`, `+2693${Math.floor(Math.random()*9e6+1e6)}`, hash,
    ids.buyer, `g6e-buyer-${tag}@komerce.test`, `+2693${Math.floor(Math.random()*9e6+1e6)}`]);
  await db.query(`INSERT INTO relais (id,name,agent_name,phone,address,island,market_id) VALUES ($1,'G6E Relais','Agent','+269000222','Moroni','Ngazidja',$2)`, [ids.relay, m.id]);
  for (const label of ['A', 'B']) {
    const oid = await seedOrder(label, 'pending', m.id);
    await db.query(`INSERT INTO unsold_items (order_id, product_name, original_price_kmf, unsold_price_kmf, channel)
                    VALUES ($1, $2, 8000, 6000, 'both')`, [oid, `Produit ${label}`]);
  }
  const paidId = await seedOrder('PAID', 'paid', m.id);
  // Garde F3 en base : un invendu ne peut pas être créé sur une commande payée.
  await expect(db.query(`INSERT INTO unsold_items (order_id, product_name, original_price_kmf, unsold_price_kmf)
                         VALUES ($1, 'Produit payé', 8000, 6000)`, [paidId])).rejects.toThrow(/UNSOLD_PAID_ITEM_PROTECTED/);
});

test.afterAll(async () => {
  await db.query('DELETE FROM unsold_items WHERE order_id = ANY($1::uuid[])', [ids.orders]);
  await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [ids.orders]);
  await db.query('DELETE FROM relais WHERE id=$1', [ids.relay]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ids.admin, ids.buyer]]);
  await db.end?.();
});

test('Invendus : garde F3 et gestes admin à l’écran', async ({ page }) => {
  await page.goto('/login.html?next=' + encodeURIComponent('/dashboards/canonical/unsold.html'));
  await page.locator('#email').fill(`g6e-admin-${tag}@komerce.test`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#btn-submit').click();
  await page.waitForURL(/unsold\.html/, { timeout: 20000 });

  const rowA = page.locator(`[data-unsold-row]`, { hasText: `G6E-UNS-${tag}-A` });
  const rowB = page.locator(`[data-unsold-row]`, { hasText: `G6E-UNS-${tag}-B` });
  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();
  // Commande payée : jamais listée, donc aucune action possible.
  await expect(page.getByText(`G6E-UNS-${tag}-PAID`)).toHaveCount(0);

  // Scan : le 409 F3 est affiché clairement.
  await page.locator('[data-unsold-scan]').click();
  await expect(page.locator('[data-unsold-feedback]')).toContainText('409');
  await expect(page.locator('[data-unsold-feedback]')).toContainText('colis payé');

  // Modification prix + canal.
  await rowA.locator('[data-unsold-price]').fill('5000');
  await rowA.locator('[data-unsold-channel]').selectOption('reseller');
  await rowA.locator('[data-unsold-save]').click();
  await expect(page.locator('[data-unsold-feedback]')).toContainText('mis à jour');
  const a = (await db.query(`SELECT ui.unsold_price_kmf, ui.channel FROM unsold_items ui JOIN orders o ON o.id=ui.order_id WHERE o.reference=$1`, [`G6E-UNS-${tag}-A`])).rows[0];
  expect(Number(a.unsold_price_kmf)).toBe(5000);
  expect(a.channel).toBe('reseller');

  // Message WhatsApp.
  await rowB.locator('[data-unsold-whatsapp]').click();
  await expect(rowB.locator('[data-unsold-wa-message]')).toContainText('PROMOTION KOMERCE');

  // Résolution.
  await rowB.locator('[data-unsold-resolve-status]').selectOption('donated');
  await rowB.locator('[data-unsold-resolve]').click();
  await expect(page.locator('[data-unsold-feedback]')).toContainText('résolu');
  await expect(rowB).toHaveCount(0);
  const b = (await db.query(`SELECT ui.status FROM unsold_items ui JOIN orders o ON o.id=ui.order_id WHERE o.reference=$1`, [`G6E-UNS-${tag}-B`])).rows[0];
  expect(b.status).toBe('donated');

  // Garde serveur indépendante de l'écran : une commande payée ne se liquide pas.
  const paidOrder = ids.orders[2];
  const unsoldPaid = (await db.query('SELECT count(*)::int n FROM unsold_items WHERE order_id=$1', [paidOrder])).rows[0].n;
  expect(unsoldPaid).toBe(0);
});
