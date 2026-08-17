'use strict';

const jwt = require('jsonwebtoken');
const { signAuthToken } = require('../../utils/auth-session');

const ORIGINAL_JWT_EXPIRES = process.env.JWT_EXPIRES;

describe('AUTH-7/8 auth session proof claims', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test_secret_min_32_chars_aaaaaaaaaaaaaaaa';
    delete process.env.JWT_EXPIRES;
  });

  afterAll(() => {
    if (ORIGINAL_JWT_EXPIRES === undefined) delete process.env.JWT_EXPIRES;
    else process.env.JWT_EXPIRES = ORIGINAL_JWT_EXPIRES;
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

  it('durée par défaut = 7 jours maximum', () => {
    const token = signAuthToken({ id: 'u1', role: 'client' }, { method: 'passkey' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
  });

  it('une config historique 30d est plafonnée à 7 jours', () => {
    process.env.JWT_EXPIRES = '30d';
    const token = signAuthToken({ id: 'u1', role: 'client' }, { method: 'otp' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
  });

  it('une durée plus courte reste possible', () => {
    process.env.JWT_EXPIRES = '12h';
    const token = signAuthToken({ id: 'u1', role: 'client' }, { method: 'passkey' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.exp - decoded.iat).toBe(12 * 60 * 60);
  });

  it('chaque authentification/step-up produit une nouvelle jti', () => {
    const first = jwt.verify(
      signAuthToken({ id: 'u1', role: 'client' }, { method: 'passkey' }),
      process.env.JWT_SECRET
    );
    const second = jwt.verify(
      signAuthToken({ id: 'u1', role: 'client' }, { method: 'passkey' }),
      process.env.JWT_SECRET
    );
    expect(first.jti).not.toBe(second.jti);
  });

  it('refuse de signer une session sans méthode explicite', () => {
    expect(() => signAuthToken({ id: 'u1', role: 'client' })).toThrow(/méthode/i);
  });
});
