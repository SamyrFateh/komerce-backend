/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  SCOPE_MODES,
  validateAdminContext,
  resolveMarketView,
} = require('../../public/dashboards/canonical/js/admin-context');

const SOURCE = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'dashboards',
  'canonical',
  'js',
  'admin-context.js'
);

function scopedContext(overrides = {}) {
  return {
    actor: { id: 'operator-cm', role: 'admin' },
    access: {
      mode: 'market',
      allowedMarkets: ['CM'],
      defaultMarket: 'CM',
      capabilities: ['operations.read', 'operations.act'],
      ...overrides,
    },
  };
}

describe('LOT 2C-CANON — AdminContext et MarketScope', () => {
  test('fige le contexte serveur sans déduire le scope depuis le rôle', () => {
    expect(SCOPE_MODES).toEqual(['global', 'market']);

    const context = validateAdminContext(scopedContext());

    expect(context.actor).toEqual({ id: 'operator-cm', role: 'admin' });
    expect(context.access.mode).toBe('market');
    expect(context.access.allowedMarkets).toEqual(['CM']);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.actor)).toBe(true);
    expect(Object.isFrozen(context.access)).toBe(true);
    expect(Object.isFrozen(context.access.allowedMarkets)).toBe(true);
    expect(Object.isFrozen(context.access.capabilities)).toBe(true);
  });

  test('enferme un partenaire dans un marché autorisé', () => {
    expect(resolveMarketView(scopedContext())).toEqual({
      mode: 'market',
      marketCode: 'CM',
      crossMarket: false,
    });
    expect(resolveMarketView(scopedContext({ allowedMarkets: ['CM', 'CG'] }), 'CG'))
      .toEqual({ mode: 'market', marketCode: 'CG', crossMarket: false });
    expect(() => resolveMarketView(scopedContext(), 'CG')).toThrow(/autorisés par le serveur/);
    expect(() => resolveMarketView(scopedContext(), null)).toThrow(/scope global/);
  });

  test('autorise Komerce central à agréger ou sélectionner un marché', () => {
    const globalContext = {
      actor: { id: 'hq-admin', role: 'admin' },
      access: {
        mode: 'global',
        allowedMarkets: ['KM', 'CM', 'CG'],
        defaultMarket: null,
        capabilities: ['pilotage.read'],
      },
    };

    expect(resolveMarketView(globalContext)).toEqual({
      mode: 'global',
      marketCode: null,
      crossMarket: true,
    });
    expect(resolveMarketView(globalContext, 'KM'))
      .toEqual({ mode: 'market', marketCode: 'KM', crossMarket: false });
  });

  test('refuse les payloads ambigus ou fabriqués', () => {
    const invalidPayloads = [
      null,
      [],
      {},
      { actor: [], access: {} },
      { actor: { id: 'x', role: 'admin' }, access: [] },
      scopedContext({ mode: 'country' }),
      scopedContext({ allowedMarkets: 'CM' }),
      scopedContext({ allowedMarkets: [] }),
      scopedContext({ allowedMarkets: ['CM', 'CM'] }),
      scopedContext({ allowedMarkets: ['cm'] }),
      scopedContext({ defaultMarket: 'CG' }),
      scopedContext({ capabilities: ['ops', 'ops'] }),
      scopedContext({ capabilities: [42] }),
      { ...scopedContext(), actor: { id: ' operator ', role: 'admin' } },
    ];

    invalidPayloads.forEach(payload => {
      expect(() => validateAdminContext(payload)).toThrow(/AdminContext invalide/);
    });
    expect(() => resolveMarketView(scopedContext(), 'Cameroun')).toThrow(/ISO alpha-2/);
  });

  test('reste un contrat UI pur sans autorité locale ni accès réseau', () => {
    const source = fs.readFileSync(SOURCE, 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/localStorage|sessionStorage|location\.(?:search|hash)/);
    expect(source).not.toMatch(/market_id/);
    expect(source).toContain('server_resolved_admin_context');
    expect(source).toContain('server_market_scope_is_authority');
  });
});
