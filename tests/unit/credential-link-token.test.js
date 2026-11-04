/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const { issueCredentialToken, hashCredentialToken, credentialTokenMatches, TTL_SECONDS } = require('../../services/credential-link-token');

describe('credential link token primitives', () => {
  it('issues a high-entropy 32-byte secret, persists only its hash and expires by purpose', () => {
    const now = new Date('2026-11-02T22:00:00Z');
    const a = issueCredentialToken('account_activation', now);
    const b = issueCredentialToken('account_activation', now);
    expect(a.token).toMatch(/^[a-f0-9]{64}$/);
    expect(a.token).not.toBe(a.tokenHash);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashCredentialToken(a.token));
    expect(a.expiresAt.getTime() - now.getTime()).toBe(TTL_SECONDS.account_activation * 1000);
    expect(issueCredentialToken('password_reset', now).expiresAt.getTime() - now.getTime()).toBe(TTL_SECONDS.password_reset * 1000);
  });
  it('rejects wrong purpose, malformed secrets and incorrect hashes', () => {
    expect(() => issueCredentialToken('login')).toThrow();
    expect(() => hashCredentialToken('bad-token')).toThrow();
    const issued = issueCredentialToken('password_reset');
    expect(credentialTokenMatches(issued.token, issued.tokenHash)).toBe(true);
    expect(credentialTokenMatches('0'.repeat(64), issued.tokenHash)).toBe(false);
    expect(credentialTokenMatches('invalid', issued.tokenHash)).toBe(false);
    expect(credentialTokenMatches(issued.token, 'invalid')).toBe(false);
  });
});
