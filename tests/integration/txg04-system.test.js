'use strict';
/**
 * TXG-04 — RED-avant / GREEN-après (REAL_DB_INTEGRATION)
 * Cible: routes/admin/system.js — POST /api/admin/reset mode=factory (~l.155)
 *
 * Mécanisme: le DELETE FROM partners best-effort échoue (table absente,
 * simulée par rename) => sans SAVEPOINT le client devient "aborted" =>
 * le COMMIT suivant ne lève PAS d'erreur côté pg mais exécute un ROLLBACK
 * silencieux (même mécanisme que TXG-01) => le DELETE products/relais
 * pourtant déjà exécutés dans la même transaction sont annulés, MAIS la
 * route renvoie quand même 200/success:true avec un report mensonger.
 *
 * RED-avant : la requête renvoie 200/success:true (mensonge), mais
 *             products/relais NE sont PAS vidés (rollback silencieux).
 * GREEN-après : la requête réussit (200 success:true, cette fois honnête),
 *               products/relais sont bien vidés, seul le DELETE partners
 *               est sauté (loggué best-effort).
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { Pool } = require('pg');

const TARGET = path.join(__dirname, '../../routes/admin/system.js');
const BASELINE = fs.readFileSync('/home/claude/baseline/system.js', 'utf8');
const FIXED = fs.readFileSync('/home/claude/fixed/system.js', 'utf8');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

jest.setTimeout(30000);

function loadRouter() {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authenticate: (req, _res, next) => { req.user = { id: ADMIN_ID, role: 'admin', email: 'admin-test@komerce.test' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
  }));
  return require(TARGET);
}

function buildApp() {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

async function hidePartners() {
  await pool.query('ALTER TABLE partners RENAME TO partners_hidden');
}
async function restorePartners() {
  await pool.query('ALTER TABLE partners_hidden RENAME TO partners');
}

async function seedFactoryFixtures() {
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
}

async function restoreSharedSeed() {
  // Réhydrate TOUTES les fixtures partagées avec les autres TXG. Le mode
  // 'factory' ne se contente pas de vider products/relais : la route exécute
  // TRUNCATE orders CASCADE de façon inconditionnelle en tête de handler
  // (hors du bloc if(mode==='factory')), ce qui purge aussi orders/
  // order_items utilisés par TXG-03 (order c1) — sans reseed complet ici,
  // TXG-03 échoue en 404 si jest exécute les suites dans un ordre différent
  // de celui du fichier (constaté : TXG-04 avant TXG-03 dans un run groupé).
  //
  // De plus, mode 'factory' exécute aussi `DELETE FROM users WHERE role !=
  // 'admin'` (l.148) — ce qui supprime le user agent_hub (HUB_USER_ID) dont
  // dépend la FK order_comments.author_id utilisée par TXG-03. Sans reseed
  // ici, TXG-03/GREEN échoue en 500 (violation FK) quand TXG-04 s'exécute
  // avant lui dans un run groupé (constaté : jest peut ordonner txg03 avant
  // OU après txg04 selon son séquenceur interne — ce n'est jamais garanti).
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES
      ('00000000-0000-0000-0000-000000000001', 'Admin Test', 'admin-test@komerce.test', 'admin'),
      ('00000000-0000-0000-0000-000000000002', 'Hub Agent Test', 'hub-test@komerce.test', 'agent_hub')
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
    INSERT INTO pricing_category_dims (category, label_fr, length_cm, width_cm, height_cm)
    VALUES ('electronique', 'Électronique', 30, 20, 10)
    ON CONFLICT (category) DO UPDATE SET length_cm=30, width_cm=20, height_cm=10;
  `);
  await pool.query(`
    INSERT INTO pricing_category_taxes (category, label_fr, douane_pct, tva_pct, taxe_add_pct)
    VALUES ('electronique', 'Électronique', 0.10, 0.20, 0)
    ON CONFLICT (category) DO UPDATE SET douane_pct=0.10, tva_pct=0.20, taxe_add_pct=0;
  `);
  await pool.query(`
    INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'KOM-TEST-TXG03', '00000000-0000-0000-0000-0000000000a1', 10000, 'cash_relais', 'preparation')
    ON CONFLICT (id) DO UPDATE SET status='preparation';
  `);
  await pool.query(`
    INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 10000, 1)
    ON CONFLICT (id) DO UPDATE SET quantity=1;
  `);
}

beforeAll(async () => {
  await seedFactoryFixtures();
});

afterAll(async () => {
  await restoreSharedSeed();
  await pool.end();
});

describe('TXG-04 — factory reset partners SAVEPOINT', () => {
  test('RED-avant: fix absent -> partners KO fait échouer tout le reset factory, products/relais non vidés', async () => {
    fs.writeFileSync(TARGET, BASELINE);
    await seedFactoryFixtures();
    const app = buildApp();
    await hidePartners();
    try {
      const res = await request(app)
        .post('/api/admin/reset')
        .send({ mode: 'factory', confirm: true });

      // Comportement réel observé (diffère de l'hypothèse initiale en
      // en-tête) : sans SAVEPOINT, le COMMIT sur un client "aborted" ne
      // lève PAS d'erreur côté pg — il exécute un ROLLBACK silencieux et
      // renvoie quand même 200/success:true. Même mécanisme que TXG-01
      // (COMMIT-devient-ROLLBACK-silencieux), pas une 500.
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true); // <- le mensonge du bug : le report ment

      const { rows: prodRows } = await pool.query(
        "SELECT id FROM products WHERE id = '00000000-0000-0000-0000-0000000000b1'"
      );
      expect(prodRows.length).toBe(1); // <- le DELETE products a été annulé (rollback silencieux), rien de vidé
    } finally {
      await restorePartners();
    }
  });

  test('GREEN-après: fix present -> products/relais vidés malgré partners indisponible', async () => {
    fs.writeFileSync(TARGET, FIXED);
    await seedFactoryFixtures();
    const app = buildApp();
    await hidePartners();
    try {
      const res = await request(app)
        .post('/api/admin/reset')
        .send({ mode: 'factory', confirm: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { rows: prodRows } = await pool.query(
        "SELECT id FROM products WHERE id = '00000000-0000-0000-0000-0000000000b1'"
      );
      expect(prodRows.length).toBe(0); // <- products bien vidés malgré partners KO

      const { rows: relaisRows } = await pool.query(
        "SELECT id FROM relais WHERE id = '00000000-0000-0000-0000-0000000000a1'"
      );
      expect(relaisRows.length).toBe(0); // <- relais bien vidés
    } finally {
      await restorePartners();
      fs.writeFileSync(TARGET, FIXED); // leave repo in fixed state
    }
  });
});
