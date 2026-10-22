/**
 * @komerce-arch
 * @role          market-business-day-authority
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        market_code, period_days, instant
 * @outputs       business_timezone, civil_day_period_bounds, business_day_of_instant
 * @depends       none
 * @used-by       services/dashboard-commerce.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      business_day_belongs_to_market_not_browser_or_server, backend_is_time_authority, no_second_time_authority
 * @impact-areas  admin-dashboard, commerce
 * @version       2026-10
 */

'use strict';

// Journée commerciale = jour civil du MARCHÉ (décision métier), jamais celui du navigateur ni du
// serveur. Vue globale consolidée : UTC explicite. Aucune migration : table de décision fermée.
const MARKET_TIMEZONES = Object.freeze({
  KM: 'Indian/Comoro',
  CM: 'Africa/Douala',
  CG: 'Africa/Brazzaville',
  DJ: 'Africa/Djibouti',
});
const GLOBAL_TIMEZONE = 'UTC';

function isValidIana(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; }
}

// Marché hors table (fixtures de recette, futur marché non arbitré) : UTC explicite et signalé,
// jamais un fuseau inventé.
function resolveBusinessTimezone(market) {
  if (!market) return { timezone: GLOBAL_TIMEZONE, source: 'global_utc' };
  const tz = MARKET_TIMEZONES[String(market.code || '').toUpperCase()];
  if (tz && isValidIana(tz)) return { timezone: tz, source: 'market' };
  return { timezone: GLOBAL_TIMEZONE, source: 'unmapped_market_utc' };
}

function civilParts(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = type => Number(parts.find(p => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

// Jour civil (YYYY-MM-DD) d'un instant dans le fuseau du marché.
function businessDayOf(instant, tz) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const { y, m, d } = civilParts(date, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Instant UTC du minuit local (y-m-d 00:00) dans tz.
function zonedMidnight(y, m, d, tz) {
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const p = civilParts(new Date(guess), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    const delta = shown - Date.UTC(y, m - 1, d, 0, 0, 0);
    if (delta === 0) break;
    guess -= delta;
  }
  return new Date(guess);
}

// N jours civils incluant aujourd'hui : du début du premier jour (minuit marché) à l'instant courant.
function civilDayPeriodBounds(now, periodDays, tz) {
  const to = new Date(now);
  const { y, m, d } = civilParts(to, tz);
  const first = new Date(Date.UTC(y, m - 1, d - (periodDays - 1)));
  const from = zonedMidnight(first.getUTCFullYear(), first.getUTCMonth() + 1, first.getUTCDate(), tz);
  return { from, to };
}

module.exports = {
  MARKET_TIMEZONES,
  GLOBAL_TIMEZONE,
  resolveBusinessTimezone,
  businessDayOf,
  civilDayPeriodBounds,
};
