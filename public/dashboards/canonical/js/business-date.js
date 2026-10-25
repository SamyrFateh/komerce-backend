/**
 * @komerce-arch
 * @role          canonical-business-date
 * @domain        dashboard
 * @layer         ui-component
 * @criticality   medium
 * @inputs        iso_instant, server_business_timezone
 * @outputs       formatted_business_date
 * @depends       market
 * @used-by       order-360, client-360, client-index
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      business_timezone_is_server_authority, no_browser_timezone
 * @impact-areas  admin-dashboard
 * @version       2026-10
 */

'use strict';

(function initBusinessDate(root, factory) {
  const api = factory();
  /* istanbul ignore else -- CommonJS sous Jest, global navigateur en production. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  /* istanbul ignore else -- exercé par le navigateur, sans branche métier. */
  if (root) root.KomerceBusinessDate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBusinessDate() {
  // L3 — un seul formateur de date métier. Le fuseau est fourni par le serveur (marché de l'objet) ;
  // sans fuseau valide : UTC, jamais celui du navigateur. Date absente ou invalide : « — ».
  function validTimezone(tz) {
    if (!tz || typeof tz !== 'string') return 'UTC';
    try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return tz; } catch (_) { return 'UTC'; }
  }

  function formatBusinessDate(value, timezone, options = {}) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      ...(options.time === false ? {} : { timeStyle: 'short' }),
      timeZone: validTimezone(timezone),
    }).format(date);
  }

  return Object.freeze({ formatBusinessDate });
});
