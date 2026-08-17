'use strict';

const jwt = require('jsonwebtoken');
const { signAuthToken } = require('../../utils/auth-session');

describe('AUTH-7 auth session proof claims', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test_secret_min_32_chars_aaaaaaaaaaaaaaaa';
  });

  it.each(['otp', 'passkey', 'password', 'magic_link'])('signe auth_time + amr=%s côté serveur', method => {
    const token = signAuthToken(
      { id: '11111111-1111-4111-8111-111111111111', role: 'client' },
      { method, phone: '+33612345678', fullName: 'Test' }
    );
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(decoded.amr).toEqual([method]);
    expect(Number.isInteger(decoded.auth_time)).toBe(true);
    expect(decoded.auth_time).toBeGreaterThan(0);
    expect(decoded.jti).toEqual(expect.any(String));
  });

  it('refuse de signer une session sans méthode explicite', () => {
    expect(() => signAuthToken({ id: 'u1', role: 'client' })).toThrow(/méthode/i);
  });
});
