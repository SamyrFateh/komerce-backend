'use strict';

jest.mock('../../db', () => ({ pool: { end: jest.fn() } }));

const cleanup = require('../../scripts/staging-central-authority-cleanup');

describe('staging-central-authority-cleanup', () => {
  test('keeper is pinned to Admin Komerce', () => {
    expect(cleanup.KEEPER).toEqual({
      id: '51eda5e1-b915-4f08-bba6-ba825ee36001',
      email: 'admin@komerce.km',
      full_name: 'Admin Komerce',
    });
  });

  test('dry-run is allowed with DATABASE_URL only', () => {
    expect(() => cleanup.assertRuntime('dry-run', {
      DATABASE_URL: 'postgres://example',
      KOMERCE_ENV: 'production',
    })).not.toThrow();
  });

  test('execute fails closed outside staging', () => {
    expect(() => cleanup.assertRuntime('execute', {
      DATABASE_URL: 'postgres://example',
      KOMERCE_ENV: 'production',
      KOMERCE_CENTRAL_AUTHORITY_CLEANUP_ACK: cleanup.ACK,
    })).toThrow(/KOMERCE_ENV=staging/);
  });

  test('execute requires explicit acknowledgement', () => {
    expect(() => cleanup.assertRuntime('execute', {
      DATABASE_URL: 'postgres://example',
      KOMERCE_ENV: 'staging',
    })).toThrow(/KOMERCE_CENTRAL_AUTHORITY_CLEANUP_ACK/);
  });

  test('safe before requires keeper active in every domain', () => {
    expect(() => cleanup.assertSafeBefore({
      domains: [
        { domain: 'dashboard', keeper_active: true },
        { domain: 'catalog', keeper_active: false },
      ],
    })).toThrow(/keeper absent/);
  });

  test('canonical registry exposes five authority domains', () => {
    expect(cleanup.authorityTables().map(x => x.domain).sort()).toEqual(
      ['catalog', 'dashboard', 'decision_signal', 'pricing', 'sourcing'].sort()
    );
  });
});
