'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  LEGACY_AUTH_COOKIE_NAME,
  HOST_AUTH_COOKIE_NAME,
  getAuthCookieName,
  cookieOptions,
  setAuthCookie,
  clearAuthCookie,
  readAuthToken,
} = require('../../utils/auth-cookie');

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  KOMERCE_ENV: process.env.KOMERCE_ENV,
  JWT_EXPIRES: process.env.JWT_EXPIRES,
};

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('NODE_ENV', ORIGINAL_ENV.NODE_ENV);
  restore('KOMERCE_ENV', ORIGINAL_ENV.KOMERCE_ENV);
  restore('JWT_EXPIRES', ORIGINAL_ENV.JWT_EXPIRES);
});

describe('AUTH-8c __Host- session cookie', () => {
  test.each(['staging', 'production'])('%s utilise __Host-kmrc_jwt', (runtime) => {
    process.env.KOMERCE_ENV = runtime;
    process.env.NODE_ENV = 'production';

    expect(getAuthCookieName()).toBe(HOST_AUTH_COOKIE_NAME);
    expect(cookieOptions()).toEqual(expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    }));
    expect(cookieOptions()).not.toHaveProperty('domain');
  });

  test.each(['development', 'test'])('%s garde le cookie local sans préfixe', (runtime) => {
    process.env.KOMERCE_ENV = runtime;
    process.env.NODE_ENV = 'test';

    expect(getAuthCookieName()).toBe(LEGACY_AUTH_COOKIE_NAME);
    expect(cookieOptions().secure).toBe(false);
  });

  it('fallback fail-closed : NODE_ENV=production sans KOMERCE_ENV active __Host-', () => {
    delete process.env.KOMERCE_ENV;
    process.env.NODE_ENV = 'production';
    expect(getAuthCookieName()).toBe(HOST_AUTH_COOKIE_NAME);
    expect(cookieOptions().secure).toBe(true);
  });

  it('émet uniquement le cookie actif du runtime', () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'production';
    const res = { cookie: jest.fn() };

    setAuthCookie(res, 'jwt-value');

    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      HOST_AUTH_COOKIE_NAME,
      'jwt-value',
      expect.objectContaining({ secure: true, path: '/', sameSite: 'Lax' })
    );
  });

  it('en runtime __Host-, ne relit jamais l’ancien kmrc_jwt', () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'production';

    expect(readAuthToken({
      cookies: { [LEGACY_AUTH_COOKIE_NAME]: 'legacy-token' },
      headers: {},
    })).toBeNull();

    expect(readAuthToken({
      cookies: { [HOST_AUTH_COOKIE_NAME]: 'host-token' },
      headers: {},
    })).toBe('host-token');
  });

  it('la suppression en runtime __Host- purge aussi le cookie legacy', () => {
    process.env.KOMERCE_ENV = 'staging';
    process.env.NODE_ENV = 'production';
    const res = { clearCookie: jest.fn() };

    clearAuthCookie(res);

    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    expect(res.clearCookie).toHaveBeenNthCalledWith(
      1,
      HOST_AUTH_COOKIE_NAME,
      expect.objectContaining({ secure: true, path: '/' })
    );
    expect(res.clearCookie).toHaveBeenNthCalledWith(
      2,
      LEGACY_AUTH_COOKIE_NAME,
      expect.objectContaining({ secure: true, path: '/' })
    );
  });

  it('Bearer reste un fallback distinct du nom de cookie jusqu’à AUTH-8e', () => {
    process.env.KOMERCE_ENV = 'production';
    process.env.NODE_ENV = 'production';
    expect(readAuthToken({
      cookies: {},
      headers: { authorization: 'Bearer api-token' },
    })).toBe('api-token');
  });
});
