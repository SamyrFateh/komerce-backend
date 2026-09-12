'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 *
 * Rejoue les sept migrations de promotion Market Delegation sur un assignment
 * actif artificiellement ramené à un état pré-promotion. Le but n'est pas de
 * relire le SQL : PostgreSQL l'exécute réellement, dans son ordre historique.
 */

const fs = require('fs');
const path = require('path');
const { describeE2E } = require('../helpers/e2eDbKit');
const { createMarketDelegationFixture } = require('../helpers/marketDelegationE2EKit');

jest.setTimeout(60000);

const ROOT = path.join(__dirname, '..', '..');

const PROMOTIONS = Object.freeze([
  { migration: 201, file: '201_market_network_promotion_agent_optional.sql', capabilities: ['network.create', 'network.update', 'network.suspend'] },
  { migration: 203, file: '203_market_delegation_provider_manage_live.sql', capabilities: ['provider.manage'] },
  { migration: 204, file: '204_market_delegation_local_offer_manage_live.sql', capabilities: ['local_offer.manage'] },
  { migration: 205, file: '205_market_delegation_client_case_handle_live.sql', capabilities: ['client.case.handle'] },
  { migration: 207, file: '207_market_delegation_catalog_expose_live.sql', capabilities: ['catalog.expose'] },
  { migration: 209, file: '209_market_delegation_settlement_live.sql', capabilities: ['finance.act', 'settlement.receive'] },
  { migration: 210, file: '210_market_delegation_structure_event_record_live.sql', capabilities: ['structure.event.record'] },
]);

const TARGET_CAPABILITIES = Object.freeze(PROMOTIONS.flatMap(row => row.capabilities));
const BUSINESS_TABLES = Object.freeze([
  'providers',
  'services',
  'physical_offers',
  'disputes',
  'product_market_exposure',
  'market_settlements',
  'market_settlement_events',
  'economic_structure_cost_events',
]);

function migrationSql(file) {
  return fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');
}

async function counts(db, tables) {
  const result = {};
  for (const table of tables) {
    // Table names are a closed constant above, never user input.
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    result[table] = rows[0].n;
  }
  return result;
}

async function activeCaps(db, table, ownerColumn, ownerId) {
  const { rows } = await db.query(
    `SELECT capability, COUNT(*)::int AS n
       FROM ${table}
      WHERE ${ownerColumn} = $1
        AND revoked_at IS NULL
        AND capability = ANY($2::text[])
      GROUP BY capability
      ORDER BY capability`,
    [ownerId, TARGET_CAPABILITIES]
  );
  return new Map(rows.map(row => [row.capability, row.n]));
}

async function runPromotion(db, promotion) {
  await db.query(migrationSql(promotion.file));
}

describeE2E('E2E-MA — replay migrations de promotion 201→210', ({ db }) => {
  let fx;
  let businessBefore;

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);

    // Fabrique un assignment "ancien" : manager et ceiling conservent le socle
    // de reconnaissance (team.grant/team.revoke/network.read/finance.read), mais
    // aucune capability qui doit être ajoutée par les migrations de promotion.
    await db.query(
      `DELETE FROM membership_capabilities
        WHERE membership_id = $1
          AND capability = ANY($2::text[])`,
      [fx.managerAMembership.id, TARGET_CAPABILITIES]
    );
    await db.query(
      `DELETE FROM assignment_capability_ceiling
        WHERE assignment_id = $1
          AND capability = ANY($2::text[])`,
      [fx.assignmentA.id, TARGET_CAPABILITIES]
    );

    const managerBaseline = await db.query(
      `SELECT capability
         FROM membership_capabilities
        WHERE membership_id=$1 AND revoked_at IS NULL`,
      [fx.managerAMembership.id]
    );
    const baseline = new Set(managerBaseline.rows.map(row => row.capability));
    for (const required of ['team.grant', 'team.revoke', 'network.read', 'finance.read']) {
      expect(baseline.has(required)).toBe(true);
    }

    businessBefore = await counts(db, BUSINESS_TABLES);
  });

  afterAll(async () => {
    if (!fx) return;
    await db.query('DELETE FROM market_delegation_audit WHERE assignment_id=$1', [fx.assignmentA.id]);
    await db.query(
      `DELETE FROM membership_capabilities
        WHERE membership_id=$1 AND capability = ANY($2::text[])`,
      [fx.managerAMembership.id, TARGET_CAPABILITIES]
    );
    await db.query(
      `DELETE FROM assignment_capability_ceiling
        WHERE assignment_id=$1 AND capability = ANY($2::text[])`,
      [fx.assignmentA.id, TARGET_CAPABILITIES]
    );
    await fx.cleanup.run();
  });

  it('1 — chaque migration compile, promeut le manager, jamais le viewer, et audite avec acteur système', async () => {
    for (const promotion of PROMOTIONS) {
      // Exécution SQL réelle : couvre CTE/INSERT/RETURNING et contraintes DB.
      // eslint-disable-next-line no-await-in-loop
      await runPromotion(db, promotion);

      for (const capability of promotion.capabilities) {
        // eslint-disable-next-line no-await-in-loop
        const ceiling = await db.query(
          `SELECT COUNT(*)::int AS n
             FROM assignment_capability_ceiling
            WHERE assignment_id=$1 AND capability=$2 AND revoked_at IS NULL`,
          [fx.assignmentA.id, capability]
        );
        expect(ceiling.rows[0].n).toBe(1);

        // eslint-disable-next-line no-await-in-loop
        const manager = await db.query(
          `SELECT COUNT(*)::int AS n
             FROM membership_capabilities
            WHERE membership_id=$1 AND capability=$2 AND revoked_at IS NULL`,
          [fx.managerAMembership.id, capability]
        );
        expect(manager.rows[0].n).toBe(1);

        // eslint-disable-next-line no-await-in-loop
        const viewer = await db.query(
          `SELECT COUNT(*)::int AS n
             FROM membership_capabilities
            WHERE membership_id=$1 AND capability=$2 AND revoked_at IS NULL`,
          [fx.viewerAMembership.id, capability]
        );
        expect(viewer.rows[0].n).toBe(0);

        // eslint-disable-next-line no-await-in-loop
        const audit = await db.query(
          `SELECT actor_user_id, action, correlation_id
             FROM market_delegation_audit
            WHERE assignment_id=$1
              AND membership_id=$2
              AND capability=$3
              AND correlation_id=$4`,
          [fx.assignmentA.id, fx.managerAMembership.id, capability, `migration-${promotion.migration}`]
        );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]).toMatchObject({
          actor_user_id: null,
          action: 'CAPABILITY_GRANTED_BY_PROMOTION',
          correlation_id: `migration-${promotion.migration}`,
        });
      }
    }
  });

  it('2 — les migrations de droits ne mutent aucune vérité métier', async () => {
    expect(await counts(db, BUSINESS_TABLES)).toEqual(businessBefore);
  });

  it('3 — rejouer les sept migrations est idempotent : aucun doublon de ceiling, grant ou audit', async () => {
    const auditBefore = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM market_delegation_audit
        WHERE assignment_id=$1
          AND membership_id=$2
          AND action='CAPABILITY_GRANTED_BY_PROMOTION'
          AND capability = ANY($3::text[])`,
      [fx.assignmentA.id, fx.managerAMembership.id, TARGET_CAPABILITIES]
    );
    expect(auditBefore.rows[0].n).toBe(TARGET_CAPABILITIES.length);

    for (const promotion of PROMOTIONS) {
      // eslint-disable-next-line no-await-in-loop
      await runPromotion(db, promotion);
    }

    const ceilings = await activeCaps(db, 'assignment_capability_ceiling', 'assignment_id', fx.assignmentA.id);
    const grants = await activeCaps(db, 'membership_capabilities', 'membership_id', fx.managerAMembership.id);
    for (const capability of TARGET_CAPABILITIES) {
      expect(ceilings.get(capability)).toBe(1);
      expect(grants.get(capability)).toBe(1);
    }

    const viewer = await activeCaps(db, 'membership_capabilities', 'membership_id', fx.viewerAMembership.id);
    expect(viewer.size).toBe(0);

    const auditAfter = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM market_delegation_audit
        WHERE assignment_id=$1
          AND membership_id=$2
          AND action='CAPABILITY_GRANTED_BY_PROMOTION'
          AND capability = ANY($3::text[])`,
      [fx.assignmentA.id, fx.managerAMembership.id, TARGET_CAPABILITIES]
    );
    expect(auditAfter.rows[0].n).toBe(auditBefore.rows[0].n);
    expect(await counts(db, BUSINESS_TABLES)).toEqual(businessBefore);
  });
});
