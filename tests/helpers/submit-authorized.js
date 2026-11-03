'use strict';

/**
 * @test-kind helper
 * @test-runner jest
 * @test-requires postgres
 * @brief P04 — les tests de parcours soumettent une PO après décision d'engagement de la directrice (ligne de décision
 *        insérée directement : le contrôle des grants est prouvé par hub-directrice-authorizations-postgres.test.js).
 */
const db = require('../../db');

async function authorizePurchaseOrder(poId, type = 'purchase_commitment') {
  let { rows: [u] } = await db.query('SELECT id FROM users LIMIT 1');
  if (!u) ({ rows: [u] } = await db.query('INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id'));
  await db.query(
    `INSERT INTO purchase_order_authorizations (purchase_order_id, authorization_type, decided_by, amount, currency, proof_ref)
     VALUES ($1,$2,$3,1,'EUR','TEST-DIRECTRICE') ON CONFLICT (purchase_order_id, authorization_type) DO NOTHING`, [poId, type, u.id]);
}

async function submitAuthorized(engagement, poId, ...rest) {
  await authorizePurchaseOrder(poId);
  return engagement.submitPurchaseOrder(poId, ...rest);
}

module.exports = { authorizePurchaseOrder, submitAuthorized };
