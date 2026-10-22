'use strict';

const {
  MARKET_TIMEZONES, resolveBusinessTimezone, businessDayOf, civilDayPeriodBounds,
} = require('../../services/market-business-day');

describe('market-business-day — journée commerciale du marché', () => {
  test('table de décision métier', () => {
    expect(MARKET_TIMEZONES).toEqual({
      KM: 'Indian/Comoro', CM: 'Africa/Douala', CG: 'Africa/Brazzaville', DJ: 'Africa/Djibouti',
    });
    expect(resolveBusinessTimezone(null)).toEqual({ timezone: 'UTC', source: 'global_utc' });
    expect(resolveBusinessTimezone({ code: 'cm' })).toEqual({ timezone: 'Africa/Douala', source: 'market' });
    // marché non arbitré : UTC signalé, jamais un fuseau inventé
    expect(resolveBusinessTimezone({ code: 'ZZ' })).toEqual({ timezone: 'UTC', source: 'unmapped_market_utc' });
  });

  test('17/10 22h30 UTC : 18/10 aux Comores, 17/10 au Cameroun/Congo, 18/10 à Djibouti (UTC+3)', () => {
    const i = '2026-10-17T22:30:00Z';
    expect(businessDayOf(i, 'Indian/Comoro')).toBe('2026-10-18');
    expect(businessDayOf(i, 'Africa/Douala')).toBe('2026-10-17');
    expect(businessDayOf(i, 'Africa/Brazzaville')).toBe('2026-10-17');
    expect(businessDayOf(i, 'Africa/Djibouti')).toBe('2026-10-18');
    expect(businessDayOf(i, 'UTC')).toBe('2026-10-17');
  });

  test.each([
    ['KM', 'Indian/Comoro', 3],
    ['CM', 'Africa/Douala', 1],
    ['CG', 'Africa/Brazzaville', 1],
    ['DJ', 'Africa/Djibouti', 3],
    ['global', 'UTC', 0],
  ])('passage de minuit %s : 1 ms avant / pile à minuit local', (_c, tz, off) => {
    const midnightUtc = Date.UTC(2026, 9, 18, 0, 0, 0) - off * 3600e3; // 18/10 00:00 local
    expect(businessDayOf(new Date(midnightUtc - 1), tz)).toBe('2026-10-17');
    expect(businessDayOf(new Date(midnightUtc), tz)).toBe('2026-10-18');
  });

  test.each([7, 30, 90])('période %i jours civils incluant aujourd\'hui : bornes exactes', n => {
    const now = new Date('2026-10-17T22:30:00Z');
    // Comores (UTC+3) : aujourd'hui = 18/10 → premier jour = 18/10 - (n-1), minuit local
    const km = civilDayPeriodBounds(now, n, 'Indian/Comoro');
    const firstKm = new Date(Date.UTC(2026, 9, 18 - (n - 1)) - 3 * 3600e3);
    expect(km.from.toISOString()).toBe(firstKm.toISOString());
    expect(km.to.toISOString()).toBe(now.toISOString());
    expect(businessDayOf(km.from, 'Indian/Comoro')).toBe(businessDayOf(firstKm, 'Indian/Comoro'));
    // Cameroun (UTC+1) : aujourd'hui = 17/10
    const cm = civilDayPeriodBounds(now, n, 'Africa/Douala');
    expect(cm.from.toISOString()).toBe(new Date(Date.UTC(2026, 9, 17 - (n - 1)) - 3600e3).toISOString());
    // global UTC
    const g = civilDayPeriodBounds(now, n, 'UTC');
    expect(g.from.toISOString()).toBe(new Date(Date.UTC(2026, 9, 17 - (n - 1))).toISOString());
  });

  test('inclusion exacte : la dernière ms avant la borne est hors période, la borne est dans la période', () => {
    const { from } = civilDayPeriodBounds(new Date('2026-10-17T22:30:00Z'), 7, 'Africa/Douala');
    expect(businessDayOf(new Date(from.getTime() - 1), 'Africa/Douala')).toBe('2026-10-10');
    expect(businessDayOf(from, 'Africa/Douala')).toBe('2026-10-11');
  });

  test('résultat identique quel que soit le fuseau du navigateur/processus (Paris, Dubaï, UTC)', () => {
    const initial = process.env.TZ;
    const out = [];
    try {
      for (const z of ['Europe/Paris', 'Asia/Dubai', 'UTC']) {
        process.env.TZ = z;
        const b = civilDayPeriodBounds(new Date('2026-10-17T22:30:00Z'), 30, 'Indian/Comoro');
        out.push([businessDayOf('2026-10-17T22:30:00Z', 'Indian/Comoro'), b.from.toISOString()]);
      }
    } finally {
      if (initial === undefined) delete process.env.TZ; else process.env.TZ = initial;
    }
    expect(new Set(out.map(o => JSON.stringify(o))).size).toBe(1);
  });

  test('date invalide : null, pas de jour inventé', () => {
    expect(businessDayOf('pas-une-date', 'UTC')).toBeNull();
  });
});
