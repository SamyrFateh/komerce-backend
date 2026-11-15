/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief T9 readonly real-time projection contract; staged jobs use DB CURRENT_TIMESTAMP.
 */
'use strict';

const { assess } = require('../../scripts/recette/hub-t9-authentic-age-readonly');
const NOW = new Date('2026-11-15T12:00:00Z');
function task(kind, hours, flagged, since = new Date(NOW.getTime() - hours * 3600000).toISOString()) {
  return { kind, since, age_hours: hours, overdue: flagged, market: { code: 'KM' } };
}
const payload = tasks => ({
  overdue_after_hours: 48,
  overdue_count: tasks.filter(t => t.overdue).length,
  tasks,
});

test('T9 : date persistée exactement 48h donne preuve physique PG, mais aucun PASS UI', () => {
  const report = assess(payload([task('RECONCILE_PARCEL', 48, true)]), NOW);
  expect(report).toMatchObject({
    mode: 'READ_ONLY', source_clock: 'POSTGRESQL_CURRENT_TIMESTAMP',
    physical_overdue_count: 1, overdue_count: 1,
    verdict: 'T9_AUTHENTIC_PHYSICAL_TASK_48H_PG_PASS_UI_NOT_PROVEN',
  });
  expect(JSON.stringify(report)).not.toContain('order_id');
  expect(report.not_proven.join(' ')).toContain('Chromium');
});

test('T9 : 47h non échues, aucune promotion artificielle à 48h', () => {
  const report = assess(payload([task('RECONCILE_PARCEL', 47, false)]), NOW);
  expect(report.physical_overdue_count).toBe(0);
  expect(report.verdict).toBe('T9_NO_AGED_TASKS_PRESENT_NOT_PROVEN');
});

test('T9 : sourcing âgé ne vaut pas attente réelle d’un sac ou colis', () => {
  const report = assess(payload([task('SOURCING_REQUIRED', 72, true)]), NOW);
  expect(report.verdict).toBe('T9_AGED_NONPHYSICAL_TASKS_ONLY_PHYSICAL_NOT_PROVEN');
});

test('T9 : horodatage absent reste inconnu et non échu', () => {
  const unknown = { kind: 'RECONCILE_PARCEL', since: null, age_hours: null, overdue: false };
  const report = assess(payload([unknown]), NOW);
  expect(report.unknown_dates).toBe(1);
  expect(report.physical_overdue_count).toBe(0);
});

test('T9 : fail closed si le calcul serveur ou le compteur directrice est incohérent', () => {
  expect(() => assess(payload([task('RECONCILE_PARCEL', 48, false)]), NOW))
    .toThrow('T9_PERSISTED_AGE_PROJECTION_INCONSISTENT');
  expect(() => assess({ ...payload([task('RECONCILE_PARCEL', 48, true)]), overdue_count: 0 }, NOW))
    .toThrow('T9_DIRECTOR_OVERDUE_COUNT_INCONSISTENT');
  expect(() => assess({ ...payload([]), overdue_after_hours: 24 }, NOW))
    .toThrow('T9_UNEXPECTED_THRESHOLD');
});
