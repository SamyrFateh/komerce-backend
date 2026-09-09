'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const team = require('../../services/market-delegation-team-service');
const delegation = require('../../services/market-delegation-service');

const ROOT = path.join(__dirname, '..', '..');

function executor() {
  return { query: jest.fn() };
}

describe('market-delegation team service', () => {
  test('normalise market/email and hashes invitation tokens without storing raw value', () => {
    expect(team.normalizeMarketCode(' cg ')).toBe('CG');
    expect(team.normalizeMarketCode('Congo')).toBeNull();
    expect(team.normalizeEmail(' Manager@Example.COM ')).toBe('manager@example.com');
    expect(team.normalizeEmail('bad')).toBeNull();
    const token = 'raw-token-that-must-not-be-persisted-123456';
    const hash = team.invitationTokenHash(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hash).toBe(team.invitationTokenHash(token));
  });

  test('new-email invitation persists only SHA-256 and returns raw token once', async () => {
    const db = executor();
    db.query
      // assertGrantAllowed: ceiling
      .mockResolvedValueOnce({ rows: [{ capability: 'team.read' }] })
      // assertGrantAllowed: grantor membership
      .mockResolvedValueOnce({ rows: [{ id: 'grantor-m', assignment_id: 'a1', user_id: 'u1', status: 'ACTIVE' }] })
      // activeMembershipCapabilities(grantor)
      .mockResolvedValueOnce({ rows: [{ capability: 'team.read' }, { capability: 'team.invite' }] })
      // user lookup
      .mockResolvedValueOnce({ rows: [] })
      // revoke prior pending invitation
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // insert invitation
      .mockImplementationOnce(async (sql, params) => ({
        rows: [{
          id: 'inv1',
          assignment_id: 'a1',
          email: params[1],
          requested_capabilities: JSON.parse(params[3]),
          invited_by_membership_id: params[4],
          status: 'PENDING',
          expires_at: '2026-09-12T20:00:00Z',
          created_at: '2026-09-09T20:00:00Z',
        }],
      }))
      // audit
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await team.inviteTeamMember(db, {
      assignmentId: 'a1',
      actorUserId: 'u1',
      actorMembershipId: 'grantor-m',
      email: 'New.Member@Example.com',
      capabilities: ['team.read'],
    });

    expect(result.kind).toBe('invitation');
    expect(result.token).toBeTruthy();
    expect(result.invitation.email).toBe('new.member@example.com');
    const insertCall = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO market_team_invitations'));
    expect(insertCall).toBeTruthy();
    const persistedTokenHash = insertCall[1][2];
    expect(persistedTokenHash).toBe(team.invitationTokenHash(result.token));
    expect(persistedTokenHash).not.toBe(result.token);
  });

  test('acceptance code revalidates invitation capabilities through non-central addMembership', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-team-service.js'), 'utf8');
    expect(source).toMatch(/actorUserId:\s*invitation\.inviter_user_id/);
    expect(source).toMatch(/capabilities:\s*requested/);
    expect(source).toMatch(/actorIsCentral:\s*false/);
    expect(source).toMatch(/TEAM_INVITATION_EMAIL_MISMATCH/);
    expect(source).toMatch(/TEAM_INVITER_NOT_ACTIVE/);
  });

  test('revoking the last team.grant membership fails closed', async () => {
    const db = executor();
    db.query
      // target membership FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'm1', assignment_id: 'a1', user_id: 'u1' }] })
      // activeMembershipCapabilities(target)
      .mockResolvedValueOnce({ rows: [{ capability: 'team.grant' }, { capability: 'team.read' }] })
      // assertTeamGrantContinuity: no other grantor
      .mockResolvedValueOnce({ rows: [{ has_other_grantor: false }] });

    await expect(delegation.revokeMembership(db, {
      membershipId: 'm1',
      actorUserId: 'u1',
    })).rejects.toMatchObject({ code: 'MARKET_DELEGATION_LAST_TEAM_GRANTOR' });

    expect(db.query.mock.calls.some(([sql]) => sql.includes("SET status='REVOKED'"))).toBe(false);
  });

  test('LOT 1A migration activates exactly the four team capabilities', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', '196_market_delegation_team.sql'), 'utf8');
    expect(sql).toMatch(/market_team_invitations/);
    for (const capability of ['team.read', 'team.grant', 'team.revoke', 'team.invite']) {
      expect(sql).toContain(`'${capability}'`);
    }
    expect(sql).toMatch(/SET status = 'LIVE'/);
    expect(sql).toMatch(/token_hash TEXT NOT NULL UNIQUE/);
  });
});
