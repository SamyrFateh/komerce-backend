'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * S6 — preuve paramétrée d'ouverture/isolation Market.
 * Mutualise CM/CG/YT sans réduire les invariants auparavant dispersés.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('market-open matrix (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const CASES = [
    { code: 'CM', currency: 'XAF', minorUnit: 0, amount: 15000, formatted: '15\u202f000 XAF' },
    { code: 'CG', currency: 'XAF', minorUnit: 0, amount: 15000, formatted: '15\u202f000 XAF' },
    { code: 'YT', currency: 'EUR', minorUnit: 2, amount: 1499.9, formatted: '1\u202f499,90 €' },
  ];
  const PFX = 'itest-market-matrix+';
  const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';
  let db, getMarketCurrency, formatAmountForMarket, resolveAuthorizedMarkets, provisioning, kmId;
  const marketIds = new Map(), delegationMemberships = [], createdAssignments = [];

  beforeAll(async () => {
    db = require('../../db');
    ({ getMarketCurrency, formatAmountForMarket } = require('../../utils/currency'));
    ({ resolveAuthorizedMarkets } = require('../../middleware/require-market-scope'));
    provisioning = require('../../services/market-operator-provisioning');
    const { rows } = await db.query("SELECT id, code FROM markets WHERE code IN ('KM','CM','CG','YT')");
    for (const row of rows) marketIds.set(row.code, row.id);
    kmId = marketIds.get('KM');
  });

  afterAll(async () => {
    if (delegationMemberships.length) {
      await db.query('DELETE FROM operator_market_scopes WHERE projected_from_membership_id = ANY($1)', [delegationMemberships]);
      await db.query('DELETE FROM market_delegation_audit WHERE membership_id = ANY($1)', [delegationMemberships]);
      await db.query('DELETE FROM membership_capabilities WHERE membership_id = ANY($1)', [delegationMemberships]);
      await db.query('DELETE FROM assignment_memberships WHERE id = ANY($1)', [delegationMemberships]);
    }
    if (createdAssignments.length) {
      await db.query('DELETE FROM assignment_capability_ceiling WHERE assignment_id = ANY($1)', [createdAssignments]);
      await db.query('DELETE FROM market_operating_assignments WHERE id = ANY($1)', [createdAssignments]);
    }
    await db.query('DELETE FROM users WHERE email LIKE $1', [PFX + '%']);
  });

  describe('market opening matrix', () => {
    test.each(CASES)('$code existe avec sa devise/minor_unit canonique', async ({ code, currency, minorUnit }) => {
    const id = marketIds.get(code);
    expect(id).toBeDefined();
    const { rows } = await db.query('SELECT currency, minor_unit, is_active FROM markets WHERE id=$1', [id]);
    expect(rows[0]).toEqual({ currency, minor_unit: minorUnit, is_active: true });
  });

  test.each(CASES)('$code traverse M5 sans branche spécifique', async ({ code, currency, minorUnit, amount, formatted }) => {
    const id = marketIds.get(code);
    await expect(getMarketCurrency(id)).resolves.toEqual({ currency, minor_unit: minorUnit });
    await expect(formatAmountForMarket(amount, id)).resolves.toBe(formatted);
  });

  test.each(CASES)('un grant KM n’autorise jamais $code', async ({ code }) => {
    const targetId = marketIds.get(code);
    const u = await db.query(
      "INSERT INTO users (email,full_name,phone,role,password_hash) VALUES ($1,$2,$3,'admin',$4) RETURNING id",
      [PFX + code.toLowerCase() + '-' + Date.now() + '@test.local', 'ITest ' + code, '+2693' + Math.floor(1000000 + Math.random()*8999999), CI_PLACEHOLDER_HASH]
    );
    const existing = await db.query("SELECT id FROM market_operating_assignments WHERE market_id=$1 AND status='ACTIVE' LIMIT 1", [kmId]);
    const delegated = await provisioning.ensureOperatorMembership(db, { userId: u.rows[0].id, marketId: kmId, marketCode: 'KM', scope: 'manager', allowRoleChange: true });
    delegationMemberships.push(delegated.membershipId);
    if (!existing.rows.length) createdAssignments.push(delegated.assignmentId);
    const scopes = await resolveAuthorizedMarkets(u.rows[0].id);
    expect(scopes.has(kmId)).toBe(true);
    expect(scopes.has(targetId)).toBe(false);
  });

  test('KM, CM, CG et YT coexistent sans interférence', async () => {
    const { rows } = await db.query("SELECT code FROM markets WHERE code IN ('KM','CM','CG','YT') ORDER BY code");
    expect(rows.map(r => r.code)).toEqual(['CG','CM','KM','YT']);
  });

  test('YT conserve la preuve M1b relais sur schéma commun', async () => {
    const r = await db.query("INSERT INTO relais (name,agent_name,phone,address,island_code,market_id) VALUES ('ITest Relais Mayotte','Agent Test','0269000000','Adresse Test','YT',$1) RETURNING id,market_id", [marketIds.get('YT')]);
    expect(r.rows[0].market_id).toBe(marketIds.get('YT'));
    await db.query('DELETE FROM relais WHERE id=$1', [r.rows[0].id]);
  });
  });
}
