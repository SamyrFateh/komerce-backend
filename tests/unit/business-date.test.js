'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * L3 — formateur de date métier : fuseau du serveur, jamais celui du navigateur.
 */
const { formatBusinessDate } = require('../../public/dashboards/canonical/js/business-date');

const ISO = '2026-10-17T22:48:00Z';

describe.each(['UTC', 'Europe/Paris', 'Asia/Dubai', 'America/Los_Angeles'])('processus en TZ=%s', processTz => {
  const previous = process.env.TZ;
  beforeAll(() => { process.env.TZ = processTz; });
  afterAll(() => { process.env.TZ = previous; });

  test('Comores : 17/10 22:48Z = 18/10 01:48 ; Cameroun : 17/10 23:48 ; sans fuseau : UTC', () => {
    expect(formatBusinessDate(ISO, 'Indian/Comoro')).toBe('18/10/2026 01:48');
    expect(formatBusinessDate(ISO, 'Africa/Douala')).toBe('17/10/2026 23:48');
    expect(formatBusinessDate(ISO, null)).toBe('17/10/2026 22:48');
    expect(formatBusinessDate(ISO, 'Not/AZone')).toBe('17/10/2026 22:48');
  });

  test('date seule et valeurs absentes', () => {
    expect(formatBusinessDate(ISO, 'Indian/Comoro', { time: false })).toBe('18/10/2026');
    expect(formatBusinessDate(null, 'Indian/Comoro')).toBe('—');
    expect(formatBusinessDate('pas une date', 'Indian/Comoro')).toBe('—');
  });
});
