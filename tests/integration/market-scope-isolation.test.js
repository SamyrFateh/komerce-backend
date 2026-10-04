'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/market-scope-isolation.test.js
 *
 * M2 — tests d'isolation exigés par KOMERCE_MARKET_LAYER_FREEZE.md
 * (§APPLICATION : "tests d'isolation CI").
 *
 * Contre une vraie base (operator_market_scopes, markets réels — pas de
 * mock), on vérifie que requireMarketScope() :
 *
 *   1. autorise un user avec un grant actif sur le marché ciblé
 *   2. refuse un user sans aucun grant (403, isolation cross-market de base)
 *   3. refuse un user dont le grant a été révoqué (revoked_at IS NOT NULL)
 *   4. ré-autorise un user re-grant après révocation (le cycle grant/revoke/
 *      re-grant du freeze §1 — plusieurs lignes distinctes, jamais une
 *      réécriture)
 *   5. n'autorise JAMAIS depuis un market_id fourni par le client — seule
 *      la résolution serveur (operator_market_scopes) compte
 *
 * Sans DATABASE_URL → suite skippée proprement (comme les autres tests
 * d'intégration du dépôt).
 * Run: DATABASE_URL=... npx jest tests/integration/market-scope-isolation.test.js
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('market-scope-isolation (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let db;
  let requireMarketScope, resolveAuthorizedMarkets, attachAuthorizedMarkets, provisioning;
  const delegationMemberships = [];
  let createdAssignmentId = null;
  let currentMembershipId = null;

  const PFX = 'itest-market+';
  const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';

  let userMarketA, userNoScope, marketA, marketB;

  beforeAll(async () => {
    db = require('../../db');
    ({ requireMarketScope, resolveAuthorizedMarkets, attachAuthorizedMarkets } =
      require('../../middleware/require-market-scope'));
    provisioning = require('../../services/market-operator-provisioning');

    // Deux marchés de test, distincts de KM pour ne jamais interférer avec
    // le seed réel (M0 n'insère que KM).
    const mkA = await db.query(
      `INSERT INTO markets (code, name, currency, minor_unit)
       VALUES ('QX', 'Marché Test 1', 'TST', 0)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    marketA = mkA.rows[0].id;

    const mkB = await db.query(
      `INSERT INTO markets (code, name, currency, minor_unit)
       VALUES ('QY', 'Marché Test 2', 'TST', 0)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    marketB = mkB.rows[0].id;

    const email = () => `${PFX}${Date.now()}.${Math.random().toString(36).slice(2, 8)}@test.local`;
    const phone = () => `+2693${Math.floor(1000000 + Math.random() * 8999999)}`;

    const uA = await db.query(
      `INSERT INTO users (email, full_name, phone, role, password_hash)
       VALUES ($1, 'ITest Market A', $2, 'admin', $3) RETURNING id`,
      [email(), phone(), CI_PLACEHOLDER_HASH]
    );
    userMarketA = uA.rows[0].id;

    const uNo = await db.query(
      `INSERT INTO users (email, full_name, phone, role, password_hash)
       VALUES ($1, 'ITest No Scope', $2, 'admin', $3) RETURNING id`,
      [email(), phone(), CI_PLACEHOLDER_HASH]
    );
    userNoScope = uNo.rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM operator_market_scopes WHERE user_id = ANY($1)`, [[userMarketA, userNoScope]]);
    await db.query('DELETE FROM market_delegation_audit WHERE market_id = ANY($1)', [[marketA, marketB]]);
    if (delegationMemberships.length) {
      await db.query('DELETE FROM market_delegation_audit WHERE membership_id = ANY($1)', [delegationMemberships]);
      await db.query('DELETE FROM membership_capabilities WHERE membership_id = ANY($1)', [delegationMemberships]);
      await db.query('DELETE FROM assignment_memberships WHERE id = ANY($1)', [delegationMemberships]);
    }
    if (createdAssignmentId) {
      await db.query('DELETE FROM assignment_capability_ceiling WHERE assignment_id = $1', [createdAssignmentId]);
      await db.query('DELETE FROM market_operating_assignments WHERE id = $1', [createdAssignmentId]);
    }
    await db.query(`DELETE FROM users WHERE email LIKE $1`, [`${PFX}%`]);
    await db.query(`DELETE FROM markets WHERE code IN ('QX', 'QY')`);
  });

  function mockReqRes(user) {
    const req = { user: user ? { id: user } : null };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const next = jest.fn();
    return { req, res, next };
  }

  describe('resolveAuthorizedMarkets — lecture pure', () => {
    test('retourne un Set vide pour un user sans aucun grant', async () => {
      const scopes = await resolveAuthorizedMarkets(userNoScope);
      expect(scopes).toEqual(new Set());
    });

    test('retourne un Set vide pour userId undefined (jamais de crash)', async () => {
      const scopes = await resolveAuthorizedMarkets(undefined);
      expect(scopes).toEqual(new Set());
    });
  });

  describe('requireMarketScope — cycle grant / accès / révocation / re-grant', () => {
    test('1. refuse un user sans req.user (401, avant toute requête DB)', async () => {
      const { req, res, next } = mockReqRes(null);
      const mw = requireMarketScope(() => marketA);
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    test('2. refuse un user sans aucun grant actif (403)', async () => {
      const { req, res, next } = mockReqRes(userNoScope);
      const mw = requireMarketScope(() => marketA);
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('market_scope_denied');
    });

    let grantId;

    test('3. autorise après un grant actif sur le marché ciblé', async () => {
      const delegated = await provisioning.ensureOperatorMembership(db, {
        userId: userMarketA,
        marketId: marketA,
        marketCode: 'QX',
        scope: 'manager',
        allowRoleChange: true,
      });
      currentMembershipId = delegated.membershipId;
      delegationMemberships.push(currentMembershipId);
      createdAssignmentId = delegated.assignmentId;
      const g = await db.query(
        `SELECT id FROM operator_market_scopes
          WHERE projected_from_membership_id = $1 AND revoked_at IS NULL`,
        [currentMembershipId]
      );
      grantId = g.rows[0].id;

      const { req, res, next } = mockReqRes(userMarketA);
      const mw = requireMarketScope(() => marketA);
      await mw(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200); // jamais touché
    });

    test('4. isolation cross-market : le même user n\'est PAS autorisé sur marketB', async () => {
      const { req, res, next } = mockReqRes(userMarketA);
      const mw = requireMarketScope(() => marketB);
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    test('5. refuse après révocation de la membership (projection historique conservée)', async () => {
      const revoked = await provisioning.revokeOperatorScope(db, {
        userId: userMarketA,
        marketCode: 'QX',
      });
      expect(revoked.status).toBe('revoked');

      const { req, res, next } = mockReqRes(userMarketA);
      const mw = requireMarketScope(() => marketA);
      await mw(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);

      // La ligne existe toujours — révocation, pas suppression.
      const { rows } = await db.query(
        `SELECT revoked_at FROM operator_market_scopes WHERE id = $1`,
        [grantId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].revoked_at).not.toBeNull();
    });

    test('6. re-grant après révocation : nouvelle membership, nouvelle projection, réautorise', async () => {
      const delegated = await provisioning.ensureOperatorMembership(db, {
        userId: userMarketA,
        marketId: marketA,
        marketCode: 'QX',
        scope: 'viewer',
        allowRoleChange: true,
      });
      currentMembershipId = delegated.membershipId;
      delegationMemberships.push(currentMembershipId);
      const g2 = await db.query(
        `SELECT id FROM operator_market_scopes
          WHERE projected_from_membership_id = $1 AND revoked_at IS NULL`,
        [currentMembershipId]
      );
      expect(g2.rows[0].id).not.toBe(grantId);

      const { req, res, next } = mockReqRes(userMarketA);
      const mw = requireMarketScope(() => marketA);
      await mw(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Historique complet préservé : 2 lignes pour ce (user, market).
      const { rows } = await db.query(
        `SELECT id, revoked_at FROM operator_market_scopes
         WHERE user_id = $1 AND market_id = $2 ORDER BY granted_at`,
        [userMarketA, marketA]
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].revoked_at).not.toBeNull(); // l'ancien grant reste révoqué
      expect(rows[1].revoked_at).toBeNull();     // le nouveau est actif
    });

    test('7. index unique partiel : impossible d\'avoir 2 projections actives simultanées', async () => {
      await expect(
        db.query(
          `INSERT INTO operator_market_scopes (user_id, market_id, role, projected_from_membership_id)
           VALUES ($1, $2, 'manager', $3)`,
          [userMarketA, marketA, currentMembershipId]
        )
      ).rejects.toThrow(/duplicate key|unique constraint/i);
    });

    test('8. migration 271 : un writer parallèle ne peut plus créer un scope actif sans membership', async () => {
      await expect(
        db.query(
          `INSERT INTO operator_market_scopes (user_id, market_id, role)
           VALUES ($1, $2, 'viewer')`,
          [userNoScope, marketB]
        )
      ).rejects.toThrow(/operator_market_scopes_projection_or_revoked_chk|check constraint/i);
    });
  });

  describe('doctrine : market_id du client ne peut jamais autoriser', () => {
    test('getTargetMarketId ignoré s\'il ne vient pas d\'une ressource serveur — ' +
         'requireMarketScope ne lit jamais req.body.market_id automatiquement',
      async () => {
        const { req, res, next } = mockReqRes(userMarketA);
        req.body = { market_id: marketB }; // tentative client — un attaquant
                                            // pourrait fournir n'importe quoi ici

        // getTargetMarketId n'utilise QUE le paramètre serveur (ici marketA,
        // jamais req.body) — c'est le contrat de l'API, testé en le respectant :
        // si un appelant lisait req.body.market_id par erreur, ce test
        // échouerait car marketB n'a aucun grant actif pour userMarketA.
        const mw = requireMarketScope(() => marketA);
        await mw(req, res, next);
        expect(next).toHaveBeenCalledTimes(1); // autorisé via le VRAI marketA
      });
  });
}
