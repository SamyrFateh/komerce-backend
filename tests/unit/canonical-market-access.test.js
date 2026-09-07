'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

function loadModule() {
  jest.resetModules();
  const document = {
    readyState: 'loading',
    addEventListener: jest.fn(),
  };
  global.window = {
    document,
    location: { replace: jest.fn() },
    crypto: {
      getRandomValues(buffer) {
        for (let i = 0; i < buffer.length; i += 1) buffer[i] = i + 1;
        return buffer;
      },
    },
  };
  global.document = document;
  require('../../public/dashboards/canonical/js/market-access.js');
  return global.window.KomerceCanonicalMarketAccess;
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('canonical market access', () => {
  test('la démo préfère CM et génère un manager avec mot de passe non trivial', () => {
    const api = loadModule();
    const credentials = api.buildDemoCredentials([
      { code: 'KM', name: 'Comores' },
      { code: 'CM', name: 'Cameroun' },
    ]);

    expect(credentials.marketCode).toBe('CM');
    expect(credentials.scopeRole).toBe('manager');
    expect(credentials.fullName).toContain('Démo');
    expect(credentials.email).toMatch(/^demo\.market\..+@example\.com$/);
    expect(credentials.password.length).toBeGreaterThanOrEqual(16);
  });

  test('requireAdmin accepte uniquement un admin central', async () => {
    const api = loadModule();
    const adminFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 'admin-1', role: 'admin' }),
    });
    await expect(api.requireAdmin(adminFetch)).resolves.toEqual({ id: 'admin-1', role: 'admin' });
    expect(adminFetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include' }));

    const operatorFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 'op-1', role: 'market_operator' }),
    });
    await expect(api.requireAdmin(operatorFetch)).rejects.toMatchObject({ message: 'admin_required', status: 403 });
  });

  test('requestJson conserve cookies et sérialisation JSON pour les mutations', async () => {
    const api = loadModule();
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue({ success: true }),
    });

    await api.requestJson(fetch, '/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        role: 'market_operator',
        market_scope: { market_code: 'CM', scope_role: 'manager' },
      }),
    });

    expect(fetch).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({
      credentials: 'include',
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });

  test('la surface utilise market_code/scope_role et ne construit jamais une autorité market_id', () => {
    loadModule();
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'market-access.js'),
      'utf8'
    );

    expect(source).toContain("market_scope: { market_code: market.value, scope_role: role.value }");
    expect(source).toContain("JSON.stringify({ market_code: market.value, scope_role: role.value })");
    expect(source).not.toMatch(/JSON\.stringify\([^)]*market_id/s);
  });
});
