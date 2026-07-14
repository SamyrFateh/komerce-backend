'use strict';
/**
 * TXG-03 — RED-avant / GREEN-après (REAL_DB_INTEGRATION)
 * Cible: routes/hub-dashboard.js — POST /orders/:id/auto-prepare (~l.287-296)
 *
 * Mécanisme: l'INSERT scans best-effort échoue (table absente, simulée par
 * rename) => sans SAVEPOINT le client devient "aborted", l'INSERT
 * order_comments suivant échoue à son tour => catch global fait ROLLBACK =>
 * le colis (parcels) et l'assignation des articles (parcel_items), pourtant
 * légitimes, sont perdus (auto-prepare annulé silencieusement, 500 renvoyé).
 *
 * RED-avant : la requête échoue (500) et aucun colis n'est créé.
 * GREEN-après : la requête réussit (201), le colis + parcel_items +
 *               order_comments sont bien committés, seul le scan
 *               auto-prepare est sauté (loggué best-effort).
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../routes/hub-dashboard.js');
const BASELINE = fs.readFileSync('/home/claude/baseline/hub-dashboard.js', 'utf8');
const FIXED = fs.readFileSync('/home/claude/fixed/hub-dashboard.js', 'utf8');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORDER_ID = '00000000-0000-0000-0000-0000000000c1';
const HUB_USER_ID = '00000000-0000-0000-0000-000000000002';

jest.setTimeout(30000);

function loadRouter() {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: HUB_USER_ID, role: 'agent_hub' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
  }));
  return require(TARGET);
}

function buildApp() {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.use('/api/hub', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

async function hideScans() {
  await pool.query('ALTER TABLE scans RENAME TO scans_hidden');
}
async function restoreScans() {
  await pool.query('ALTER TABLE scans_hidden RENAME TO scans');
}

async function resetOrderState() {
  // Ré-assure l'existence de la fixture order/order_items : le mode
  // 'factory' de TXG-04 exécute TRUNCATE orders CASCADE de façon
  // inconditionnelle (hors du bloc if(mode==='factory')) et peut donc
  // purger cette commande si les suites tournent dans un ordre différent
  // de celui du fichier. On upsert ici pour rester auto-suffisant.
  //
  // Le mode 'factory' exécute aussi `DELETE FROM users WHERE role !=
  // 'admin'`, ce qui supprime HUB_USER_ID (agent_hub) dont dépend la FK
  // order_comments.author_id de la route auto-prepare. On le réhydrate ici
  // aussi pour ne pas dépendre de l'ordre d'exécution des suites jest (le
  // séquenceur par défaut ne garantit aucun ordre stable entre fichiers).
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ('${HUB_USER_ID}', 'Hub Agent Test', 'hub-test@komerce.test', 'agent_hub')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ('00000000-0000-0000-0000-0000000000b1', 'Produit Test TXG', 10000)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO relais (id, name, agent_name, phone, address)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'Relais Test Moroni', 'Agent Relais Test', '+269000000', 'Adresse Test Moroni')
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
    VALUES ($1, 'KOM-TEST-TXG03', '00000000-0000-0000-0000-0000000000a1', 10000, 'cash_relais', 'preparation')
    ON CONFLICT (id) DO UPDATE SET status = 'preparation'
  `, [ORDER_ID]);
  await pool.query(`
    INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity)
    VALUES ('00000000-0000-0000-0000-0000000000d1', $1, '00000000-0000-0000-0000-0000000000b1', 10000, 1)
    ON CONFLICT (id) DO UPDATE SET quantity = 1
  `, [ORDER_ID]);

  // Nettoyer tout colis / assignation créés par des runs précédents
  await pool.query(`
    DELETE FROM parcel_items WHERE order_item_id IN (
      SELECT id FROM order_items WHERE order_id = $1
    )
  `, [ORDER_ID]);
  // Trigger DB interdit le DELETE sur parcels (RAISE EXCEPTION, cf. db/schema.sql:458) —
  // on neutralise les colis des runs précédents via status=cancelled au lieu de les supprimer.
  await pool.query("UPDATE parcels SET status = 'cancelled' WHERE order_id = $1", [ORDER_ID]);
  await pool.query('DELETE FROM order_comments WHERE order_id = $1', [ORDER_ID]);
  await pool.query("UPDATE orders SET status = 'preparation' WHERE id = $1", [ORDER_ID]);
}

beforeAll(async () => {
  await resetOrderState();
});

afterAll(async () => {
  await pool.end();
});

describe('TXG-03 — auto-prepare scans SAVEPOINT', () => {
  test('RED-avant: fix absent -> scans KO fait échouer toute la route, aucun colis créé', async () => {
    fs.writeFileSync(TARGET, BASELINE);
    await resetOrderState();
    const app = buildApp();
    await hideScans();
    try {
      const res = await request(app)
        .post(`/api/hub/orders/${ORDER_ID}/auto-prepare`)
        .send({});

      expect(res.status).toBe(500); // <- la route échoue entièrement

      const { rows } = await pool.query('SELECT id FROM parcels WHERE order_id = $1', [ORDER_ID]);
      expect(rows.length).toBe(0); // <- aucun colis créé, auto-prepare perdu
    } finally {
      await restoreScans();
    }
  });

  test('GREEN-après: fix present -> colis créé et committé malgré scans indisponible', async () => {
    fs.writeFileSync(TARGET, FIXED);
    await resetOrderState();
    const app = buildApp();
    await hideScans();
    try {
      const res = await request(app)
        .post(`/api/hub/orders/${ORDER_ID}/auto-prepare`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.items_assigned).toBe(1);

      const { rows: parcelRows } = await pool.query('SELECT id FROM parcels WHERE order_id = $1', [ORDER_ID]);
      expect(parcelRows.length).toBe(1); // <- colis bien committé

      const { rows: commentRows } = await pool.query('SELECT id FROM order_comments WHERE order_id = $1', [ORDER_ID]);
      expect(commentRows.length).toBe(1); // <- commentaire bien committé
    } finally {
      await restoreScans();
      fs.writeFileSync(TARGET, FIXED); // leave repo in fixed state
    }
  });
});
