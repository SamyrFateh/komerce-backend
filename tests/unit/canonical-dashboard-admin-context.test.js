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
    expect(SCOPE_MODES).toEqual(['global', 'market', 'hub']);

    const context = validateAdminContext(scopedContext());

    expect(context.actor).toEqual({ id: 'operator-cm', role: 'admin' });
    expect(context.access.mode).toBe('market');
    expect(context.access.allowedMarkets).toEqual(['CM']);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.actor)).toBe(true);
    expect(Object.isFrozen(context.access)).toBe(true);
    expect(Object.isFrozen(context.access.allowedMarkets)).toBe(true);
    expect(Object.isFrozen(context.access.capabilities)).toBe(true);
    expect(context.access.delegatedCapabilities).toEqual({ CM: [] });
    expect(Object.isFrozen(context.access.delegatedCapabilities)).toBe(true);
  });

  test('conserve les capacités déléguées par marché pour les projections UI', () => {
    const context = validateAdminContext(scopedContext({
      delegatedCapabilities: { CM: ['operations.read', 'client.read'] },
    }));
    expect(context.access.delegatedCapabilities).toEqual({
      CM: ['operations.read', 'client.read'],
    });
    expect(Object.isFrozen(context.access.delegatedCapabilities.CM)).toBe(true);
  });

  test('refuse les capacités déléguées d’un marché hors périmètre serveur', () => {
    expect(() => validateAdminContext(scopedContext({
      delegatedCapabilities: { CG: ['operations.read'] },
    }))).toThrow(/marché non autorisé/);
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

  test('Hub central : filtre logistique tous marchés, jamais dashboard global', () => {
    const hubContext = {
      actor: { id: 'hub-1', role: 'agent_hub' },
      access: {
        mode: 'hub', allowedMarkets: ['CM', 'KM'], defaultMarket: 'CM',
        capabilities: [],
      },
    };
    expect(validateAdminContext(hubContext).access.mode).toBe('hub');
    expect(resolveMarketView(hubContext, 'KM')).toEqual({
      mode: 'market', marketCode: 'KM', crossMarket: false,
    });
    expect(() => resolveMarketView(hubContext, null)).toThrow(/scope global/);
    expect(() => resolveMarketView(hubContext, 'CG')).toThrow(/autorisés par le serveur/);
    expect(() => validateAdminContext({
      ...hubContext, actor: { id: 'op-1', role: 'market_operator' },
    })).toThrow(/scope hub réservé/);
    expect(() => validateAdminContext({
      ...hubContext, access: { ...hubContext.access, allowedMarkets: [] },
    })).toThrow(/au moins un marché/);
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

describe('L1 resolveExplicitMarket (contrat front)', () => {
  const contract = require('../../public/dashboards/canonical/js/admin-context.js');
  const g = markets => ({ actor: { id: 'a', role: 'admin' }, access: { mode: 'global', allowedMarkets: markets, defaultMarket: null, capabilities: [] } });
  const m = (markets, def) => ({ actor: { id: 'o', role: 'market_operator' }, access: { mode: 'market', allowedMarkets: markets, defaultMarket: def, capabilities: [] } });

  test.each([
    ['global sans ?market', g(['CG', 'CM']), '', 'prompt', null],
    ['global ?market autorisé (casse)', g(['CG', 'CM']), '?market=cm', 'selected', 'CM'],
    ['global ?market=XX', g(['CG', 'CM']), '?market=XX', 'unauthorized', null],
    ['multi-marchés sans choix', m(['KM', 'CM'], 'KM'), '', 'prompt', null],
    ['mono-marché', m(['CM'], 'CM'), '', 'selected', 'CM'],
    ['mono-marché ?market non autorisé', m(['CM'], 'CM'), '?market=KM', 'unauthorized', null],
    ['hub central avec choix explicite', { actor: { id: 'h', role: 'agent_hub' }, access: { mode: 'hub', allowedMarkets: ['KM', 'CM'], defaultMarket: 'KM', capabilities: [] } }, '', 'prompt', null],
    ['hub mono-marché', { actor: { id: 'h', role: 'agent_hub' }, access: { mode: 'hub', allowedMarkets: ['KM'], defaultMarket: 'KM', capabilities: [] } }, '', 'selected', 'KM'],
    ['global sans marché', g([]), '', 'no_access', null],
  ])('%s', (_label, ctx, search, state, code) => {
    const r = contract.resolveExplicitMarket(ctx, search);
    expect(r.state).toBe(state);
    expect(r.marketCode).toBe(code);
  });
});

describe('V5.4 — projection de devise de contexte', () => {
  const { withMarketCurrencyLabel } = require('../../public/dashboards/canonical/js/admin-context');
  test('devise réelle dynamique, inconnue explicite, aucun droit supplémentaire', () => {
    const context = validateAdminContext(scopedContext({
      allowedMarkets:['CM','ZZ','CG'], marketCurrencies:{CM:'XAF',ZZ:'JPY'}
    }));
    expect(context.access.marketCurrencies).toEqual({CM:'XAF',ZZ:'JPY',CG:null});
    expect(Object.isFrozen(context.access.marketCurrencies)).toBe(true);
    expect(withMarketCurrencyLabel('CM',context,'CM')).toBe('CM · XAF');
    expect(withMarketCurrencyLabel('ZZ',context,'ZZ')).toBe('ZZ · JPY');
    expect(withMarketCurrencyLabel('CG',context,'CG')).toBe('CG · Devise non déterminée');
    expect(withMarketCurrencyLabel('KM',context,'KM')).toBe('KM');
    expect(() => resolveMarketView(context,'KM')).toThrow(/autorisés par le serveur/);
  });
  test('EUR réservé au périmètre groupe global et non au Hub logistique', () => {
    const globalContext=validateAdminContext(scopedContext({mode:'global',defaultMarket:null,marketCurrencies:{CM:'XAF'}}));
    const hubContext=validateAdminContext({...scopedContext({mode:'hub',marketCurrencies:{CM:'XAF'}}),actor:{id:'h',role:'agent_hub'}});
    expect(withMarketCurrencyLabel('Global',globalContext,null)).toBe('Global · EUR');
    expect(withMarketCurrencyLabel('Hub',hubContext,null)).toBe('Hub');
  });
  test.each([{KM:'KMF'},{CM:'xaf'},{CM:12},[]])('refuse la projection invalide %j', marketCurrencies => {
    expect(() => validateAdminContext(scopedContext({marketCurrencies}))).toThrow(/AdminContext invalide/);
  });
});
