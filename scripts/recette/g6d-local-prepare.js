'use strict';
/** @komerce-arch-lite
 * @role g6d-local-chromium-prepare
 * @domain refunds
 * @layer tooling
 * @owner backend-core
 * @purpose Prepare F1/F2 refund liabilities (via the G8 fixture) and a cash-deposit case on a disposable local PG16 only.
 * @db-write disposable postgres only (never Railway)
 * @impact-areas refunds, cash-custody, test-only
 */
const crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const runner = require('./hub-v1-certification-runner');
const { createMarketDelegationFixture, READ_ONLY_CAPABILITIES } = require('../../tests/helpers/marketDelegationE2EKit');
const { projectAssignment, LEGACY_VIEWER_CAPABILITIES } = require('../../services/market-scope-projector');
const uuid = () => crypto.randomUUID();

async function main() {
  runner.assertEphemeralTarget(process.env.DATABASE_URL, []);
  if (process.env.G6D_LOCAL !== '1' || process.env.NODE_ENV !== 'test' || process.env.KOMERCE_ENV !== 'test' ||
      process.env.STAGING_BASE_URL || process.env.E2E_STAGING_BASE_URL) throw Error('G6D_DISPOSABLE_ONLY');
  // 1) F1/F2 liabilities: reuse the G8 fixture (its guard wants a CI-like env, supplied here for the child only).
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g6d-')), 'env.txt');
  fs.writeFileSync(tmp, '', { mode: 0o600 });
  const child = spawnSync(process.execPath, [path.join(__dirname, 'g8-isolated-positive-prepare.js')], {
    env: { ...process.env, G8_ISOLATED_LOCAL: '1', GITHUB_ACTIONS: 'true', GITHUB_ENV: tmp }, encoding: 'utf8' });
  if (child.status !== 0) throw Error('G6D_G8_FIXTURE_FAILED:' + String(child.stderr).slice(-300));
  const env = Object.fromEntries(fs.readFileSync(tmp, 'utf8').split('\n').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const plan = JSON.parse(fs.readFileSync('test-results/g8-positive-isolated/prepare.json', 'utf8'));
  // 2) Cash deposit case: market with delegation, relay agent holding cash, admin recipient with custody grants.
  const fx = await createMarketDelegationFixture(db);
  const tag = crypto.randomBytes(3).toString('hex');
  const password = env.G8_PASSWORD;
  const hash = await bcrypt.hash(password, 10);
  const baseline = [...new Set([...READ_ONLY_CAPABILITIES, ...LEGACY_VIEWER_CAPABILITIES])].filter(c => fx.liveCapabilities.includes(c));
  const { rows: [relais] } = await db.query(
    "INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2690000000','Adresse recette',$2) RETURNING id", ['G6D Relais ' + tag, fx.marketA.id]);
  const mkUser = async (label, role, relaisId) => {
    const id = uuid(), email = `g6d-${label}-${tag}@komerce.test`;
    await db.query('INSERT INTO users(id,full_name,email,phone,role,relais_id,password_hash,account_activation_required) VALUES ($1,$2,$3,$4,$5,$6,$7,false)',
      [id, 'G6D ' + label + ' ' + tag, email, '+2693' + Math.floor(Math.random() * 9e6 + 1e6), role, relaisId || null, hash]);
    return { id, email };
  };
  const agent = await mkUser('agent', 'agent_relais', relais.id);
  const recipient = await mkUser('admin-caisse', 'admin');
  const grant = async (user, caps) => {
    const { rows: [m] } = await db.query("INSERT INTO assignment_memberships(assignment_id,user_id,status,granted_by) VALUES ($1,$2,'ACTIVE',$3) RETURNING id", [fx.assignmentA.id, user.id, fx.central.id]);
    for (const c of caps) await db.query('INSERT INTO membership_capabilities(membership_id,capability,granted_by) VALUES ($1,$2,$3)', [m.id, c, fx.central.id]);
  };
  await grant(agent, baseline);
  await grant(recipient, [...baseline, 'finance.act', 'cash.custody.receive']);
  await projectAssignment(db, fx.assignmentA.id);
  const { rows: [order] } = await db.query(
    "INSERT INTO orders(reference,relais_id,total_kmf,payment_mode,market_id,status) VALUES ($1,$2,100000,'cash_relais',$3,'collected') RETURNING id", ['G6D-DEP-' + tag, relais.id, fx.marketA.id]);
  await db.query("INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id,confirmed_at) VALUES ($1,100000,$2,$3,NOW()-INTERVAL '2 days')", [order.id, agent.id, relais.id]);
  const out = { ...env, G6D_DEP_MARKET: fx.marketA.code, G6D_DEP_AGENT_EMAIL: agent.email, G6D_DEP_ADMIN_EMAIL: recipient.email,
    G6D_DEP_ADMIN_NAME: 'G6D admin-caisse ' + tag, G6D_DEP_AGENT_ID: agent.id, G6D_DEP_ADMIN_ID: recipient.id };
  const dir = 'test-results/g6d'; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'env.json'), JSON.stringify(out), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'prepare.json'), JSON.stringify({ kind: 'G6D_LOCAL_SYNTHETIC', realMoney: 0, g8: plan.cases, ids: plan.ids, deposit: { market: fx.marketA.code, order: order.id } }, null, 2));
  console.log(JSON.stringify({ ready: true, depositMarket: fx.marketA.code, realMoney: 0 }));
}
main().catch(e => { console.error('G6D_PREP_FAIL:' + String(e.message).slice(0, 400)); process.exitCode = 2; }).finally(() => db.pool?.end?.());
