/**
 * @komerce-arch-lite
 * @role staging-claude-par-g6-buyers-provision
 * @domain recette
 * @layer tooling
 * @owner backend-core
 * @purpose Creer N acheteurs fictifs marques CLAUDE-PAR par marche (KM, CM, CG) et preparer leur connexion OTP par le mecanisme existant du harnais G6.
 * @db-read users
 * @db-write users via user-mutation-service, e2e_test_accounts, otp_codes via g6-staging-buyer-identity-guard (memes chemins que g6-p2-buyer-order-real-chromium.js)
 * @impact-areas recette, auth, checkout
 *
 * Aucun secret affiche. Telephones et codes OTP sont livres uniquement dans test-results/.../buyers.json, chiffre par le workflow
 * (RSA-OAEP + AES-256, cle publique scripts/recette/claude-par/recipient.pub.pem).
 *
 * Code de retrait client dans le parcours reel (aucune fixture base de donnees) :
 *  - cash_relais : le code est genere a l'encaissement (POST /api/pickup/pay-cash/:orderId, agent) et remis par le recu agent
 *    (GET /api/pickup/receipt/:orderId, usage unique) ;
 *  - cote client : GET /api/pickup/reveal-once/:orderId (proprietaire, une fois, 30 min) ; apres, nouveau code par
 *    POST /api/pickup/customer-regenerate/:orderId depuis la vue client « Mon Komerce » (public/boutique/js/b-tracking.js).
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const { createAdminUser } = require('../../services/user-mutation-service');
const { markE2eTestAccount } = require('./staging-e2e-provision');
const { preseedG6BuyerOtp } = require('../../services/g6-staging-buyer-identity-guard');
const RUN8 = String(process.env.BUYERS_RUN8 || '').toUpperCase();
const N = Math.min(Math.max(parseInt(process.env.BUYERS_PER_MARKET || '2', 10) || 2, 1), 5);
const OUT = path.resolve('test-results/claude-par-g6-buyers');
const MARKETS = {
  KM: { cur: 'KMF', phone: () => '+2693' + String(crypto.randomInt(0, 1e6)).padStart(6, '0') },
  CM: { cur: 'XAF', phone: () => '+2376' + String(crypto.randomInt(0, 1e8)).padStart(8, '0') },
  CG: { cur: 'XAF', phone: () => '+24206' + String(crypto.randomInt(0, 1e7)).padStart(7, '0') },
};
async function main() {
  if (!/^[A-F0-9]{8}$/.test(RUN8)) throw Error('BUYERS_RUN8_REQUIRED');
  if (process.env.KOMERCE_ENV !== 'staging' || process.env.NODE_ENV !== 'test') throw Error('STAGING_TEST_ENV_REQUIRED');
  if (process.env.BUYERS_CONFIRM !== 'CREATE-CLAUDE-PAR-BUYERS') throw Error('CONFIRMATION_REQUIRED');
  if (!(await confirmTarget({ db, env: process.env })).confirmed) throw Error('TARGET_IDENTITY_UNVERIFIED');
  fs.mkdirSync(OUT, { recursive: true });
  const { rows: [actor] } = await db.query(`SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`);
  if (!actor) throw Error('NO_ADMIN_ACTOR');
  const secret = [], report = { run8: RUN8, per_market: N, created: [] };
  for (const [mk, cfg] of Object.entries(MARKETS)) for (let i = 1; i <= N; i++) {
    let phone = null;
    for (let t = 0; t < 20 && !phone; t++) { const p = cfg.phone(); if (!(await db.query('SELECT 1 FROM users WHERE phone=$1 OR whatsapp_phone=$1 LIMIT 1', [p])).rows.length) phone = p; }
    if (!phone) throw Error('UNIQUE_PHONE_NOT_FOUND_' + mk);
    const code = String(crypto.randomInt(100000, 999999)), tag = crypto.randomBytes(4).toString('hex');
    const c = await db.getClient(); let tx = false;
    try {
      await c.query('BEGIN'); tx = true;
      const hash = await bcrypt.hash(crypto.randomBytes(20).toString('base64url'), 10);
      const { rows: [buyer] } = await createAdminUser(c, { fullName: `CLAUDE-PAR-G6 ${RUN8} ${mk}${i}`, email: `g6-e2e-${tag}@komerce.test`, phone, role: 'client', currencyPref: cfg.cur, passwordHash: hash });
      await markE2eTestAccount(c, { userId: buyer.id, actorId: actor.id });
      await preseedG6BuyerOtp(c, { buyer, phone, code, purpose: 'login' });
      await c.query('COMMIT'); tx = false;
      secret.push({ market: mk, n: i, phone, otp: code, buyer_id: buyer.id });
      report.created.push({ market: mk, n: i, marked: true, otp_prepared: true });
    } catch (e) { if (tx) await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP || OUT, 'buyers.json'), JSON.stringify(secret), { mode: 0o600 });
  console.log(JSON.stringify({ created: report.created.length, run8: RUN8 }));
}
main().catch(e => { console.error('FAIL', String(e.message).slice(0, 200)); process.exitCode = 1; }).finally(() => db.pool && db.pool.end && db.pool.end());
