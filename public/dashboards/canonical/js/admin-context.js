/**
 * @komerce-arch
 * @role          canonical-admin-context
 * @domain        dashboard
 * @layer         ui-contract
 * @criticality   high
 * @inputs        server_resolved_admin_context, requested_market_view
 * @outputs       canonical_admin_context, canonical_market_view
 * @depends       market
 * @used-by       canonical admin runtime (LOT 2C+)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority
 * @impact-areas  admin-dashboard, market-authorization, partner-operations
 * @version       2026-08
 */

'use strict';

(function initAdminContext(root, factory) {
  const api = factory();

  /* istanbul ignore else -- CommonJS sous Jest, global navigateur en production. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  /* istanbul ignore else -- exercé par le navigateur, sans branche métier. */
  if (root) root.KomerceAdminContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAdminContextContract() {
  const SCOPE_MODES = Object.freeze(['global', 'market']);
  const MARKET_CODE = /^[A-Z]{2}$/;

  function fail(message) {
    throw new Error(`AdminContext invalide : ${message}`);
  }

  function requiredString(value, label) {
    if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
      fail(`${label} doit être une chaîne non vide sans espaces périphériques`);
    }
    return value;
  }

  function normalizeStringList(value, label, validateItem) {
    if (!Array.isArray(value)) fail(`${label} doit être une liste`);
    const normalized = value.map((item, index) => validateItem(item, `${label}[${index}]`));
    if (new Set(normalized).size !== normalized.length) fail(`${label} contient un doublon`);
    return Object.freeze(normalized);
  }

  function marketCode(value, label) {
    const code = requiredString(value, label);
    if (!MARKET_CODE.test(code)) fail(`${label} doit être un code marché ISO alpha-2 majuscule`);
    return code;
  }

  function validateAdminContext(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('payload serveur attendu');
    if (!raw.actor || typeof raw.actor !== 'object' || Array.isArray(raw.actor)) fail('actor serveur attendu');
    if (!raw.access || typeof raw.access !== 'object' || Array.isArray(raw.access)) fail('access serveur attendu');

    const actor = Object.freeze({
      id: requiredString(raw.actor.id, 'actor.id'),
      role: requiredString(raw.actor.role, 'actor.role'),
    });

    const mode = requiredString(raw.access.mode, 'access.mode');
    if (!SCOPE_MODES.includes(mode)) fail(`access.mode doit être ${SCOPE_MODES.join(' ou ')}`);

    const allowedMarkets = normalizeStringList(raw.access.allowedMarkets, 'access.allowedMarkets', marketCode);
    if (mode === 'market' && allowedMarkets.length === 0) {
      fail('un opérateur scopé doit posséder au moins un marché autorisé');
    }

    const capabilities = normalizeStringList(
      raw.access.capabilities,
      'access.capabilities',
      requiredString
    );

    const defaultMarket = raw.access.defaultMarket === null || raw.access.defaultMarket === undefined
      ? (mode === 'market' ? allowedMarkets[0] : null)
      : marketCode(raw.access.defaultMarket, 'access.defaultMarket');

    if (defaultMarket !== null && !allowedMarkets.includes(defaultMarket)) {
      fail('access.defaultMarket doit appartenir aux marchés autorisés');
    }

    return Object.freeze({
      actor,
      access: Object.freeze({ mode, allowedMarkets, defaultMarket, capabilities }),
    });
  }

  function resolveMarketView(rawContext, requestedMarket) {
    const context = validateAdminContext(rawContext);
    const selectedMarket = requestedMarket === undefined
      ? context.access.defaultMarket
      : requestedMarket;

    if (selectedMarket === null) {
      if (context.access.mode !== 'global') fail('la vue multi-marchés est réservée au scope global');
      return Object.freeze({ mode: 'global', marketCode: null, crossMarket: true });
    }

    const code = marketCode(selectedMarket, 'requestedMarket');
    if (!context.access.allowedMarkets.includes(code)) {
      fail('requestedMarket ne fait pas partie des marchés autorisés par le serveur');
    }

    return Object.freeze({ mode: 'market', marketCode: code, crossMarket: false });
  }

  return Object.freeze({ SCOPE_MODES, validateAdminContext, resolveMarketView });
});
