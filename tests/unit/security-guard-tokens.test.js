'use strict';

const lib = require('../../scripts/lib/security-guard-tokens');

describe('security-guard-tokens', () => {
  test('tokens : authn, admin, rôles requireRole ; chaîne vide sans garde', () => {
    const t = lib.tokens("authenticate, requireRole(['admin', \"market_operator\"]), handler");
    expect(t.authn).toBe(true);
    expect(Array.from(t.roles).sort()).toEqual(['admin', 'market_operator']);
    expect(lib.hasGuards(lib.tokens('handler'))).toBe(false);
    const admin = lib.tokens('requireAdmin');
    expect(admin.admin).toBe(true);
    expect(admin.roles.has('admin')).toBe(true);
  });

  test('tokens : les quatre gardes scope marché sont distinguées (pas de préfixe commun confondu)', () => {
    const only = name => Array.from(lib.tokens(`router.get('/x', ${name}(), h)`).marketGuards);
    expect(only('requireMarketScope')).toEqual(['requireMarketScope']);
    expect(only('requireMarketScopeRole')).toEqual(['requireMarketScopeRole']);
    expect(only('attachAuthorizedMarkets')).toEqual(['attachAuthorizedMarkets']);
    expect(only('attachAuthorizedMarketsForOperator')).toEqual(['attachAuthorizedMarketsForOperator']);
    expect(only('resolveAuthorizedMarketsSomewhere')).toEqual([]);
    expect(lib.LEGACY_SCOPE_GUARDS).toHaveLength(4);
  });

  test('tokens : une capability exacte est une autorisation forte, distincte du rôle admin', () => {
    for (const name of lib.STRONG_AUTHZ_GUARDS) {
      const t = lib.tokens(`${name}('operations.read')`);
      expect(t.authz).toBe(true);
      expect(t.authn).toBe(true);
      expect(t.admin).toBe(false);
      expect(t.capabilityGuards.has(name)).toBe(true);
      expect(lib.hasGuards(t)).toBe(true);
    }
    expect(lib.tokens('resolveAuthorizationSomewhere')).toMatchObject({ authz: false });
  });

  test('hasGuards : une garde scope marché seule suffit', () => {
    expect(lib.hasGuards(lib.tokens('attachAuthorizedMarkets'))).toBe(true);
    expect(lib.hasGuards(null)).toBe(false);
    expect(lib.hasGuards({ authn: false, admin: false, roles: new Set() })).toBe(false);
  });

  test('mergeInto : union des gardes, tolère un objet sans marketGuards', () => {
    const target = { authn: false, admin: false, roles: new Set(['a']) };
    lib.mergeInto(target, lib.tokens('authenticate, requireMarketScope'));
    lib.mergeInto(target, { authn: false, admin: false, roles: new Set(['b']) });
    expect(target.authn).toBe(true);
    expect(Array.from(target.roles).sort()).toEqual(['a', 'b']);
    expect(Array.from(target.marketGuards)).toEqual(['requireMarketScope']);
  });

  test('cloneGuards : copie indépendante, valeurs par défaut sur source vide', () => {
    const source = lib.tokens('requireAdmin, attachAuthorizedMarkets');
    const copy = lib.cloneGuards(source);
    copy.marketGuards.add('requireMarketScope');
    expect(source.marketGuards.has('requireMarketScope')).toBe(false);
    expect(copy.admin).toBe(true);
    expect(lib.cloneGuards(undefined)).toEqual(lib.emptyGuards());
  });

  test('wrapperAliases : fonction qui appelle une garde = alias ; fonction sans garde ignorée', () => {
    const src = [
      'function requireOrderRead(req, res, next) {',
      '  if (x) { return requireMarketScope(() => id)(req, res, next); }',
      '  return next();',
      '}',
      '',
      'async function helperWithoutGuard(req) {',
      '  return 1;',
      '}',
      '',
      'async function requireAsyncAccess(req, res, next) {',
      '  return attachAuthorizedMarkets(req, res, next);',
      '}',
    ].join('\n');
    const aliases = lib.wrapperAliases(src);
    expect(Object.keys(aliases).sort()).toEqual(['requireAsyncAccess', 'requireOrderRead']);
    expect(Array.from(aliases.requireOrderRead.marketGuards)).toEqual(['requireMarketScope']);
    expect(aliases.requireOrderRead.authn).toBe(false);
    expect(lib.wrapperAliases('')).toEqual({});
  });

  test('wrapperAliases : une fonction qui appelle directement une capability exacte devient une garde forte', () => {
    const src = [
      'function requireOperationsRead(req, res, next) {',
      "  return requireMarketDelegatedCapability('operations.read', { audit: false })(req, res, next);",
      '}',
    ].join('\n');
    const aliases = lib.wrapperAliases(src);
    expect(aliases.requireOperationsRead.authz).toBe(true);
    expect(aliases.requireOperationsRead.authn).toBe(true);
    expect(Array.from(aliases.requireOperationsRead.capabilityGuards)).toEqual(['requireMarketDelegatedCapability']);
  });
});
