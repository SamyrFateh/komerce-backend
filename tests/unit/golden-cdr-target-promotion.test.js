'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  sameWitnessSet,
  objectFingerprint,
  behaviorFingerprint,
  buildTargetDocument,
  assertPromotionPreconditions,
  buildPromotedDocument,
} = require('../../tools/golden-cdr/target-promotion');

function currentDoc() {
  const frozen_config = { transport_policies: { SEA_WM_KG_PER_M3: 1000 } };
  return {
    _kind: 'golden-cdr',
    captured_at: '2026-08-18T12:13:00.076Z',
    config_fingerprint: objectFingerprint(frozen_config),
    witness_count: 2,
    frozen_config,
    snapshots: [
      { id: 'a', totals: { total: 100 } },
      { id: 'b', totals: { total: 200 } },
    ],
  };
}

describe('Golden CDR — promotion TARGET 1B-1', () => {
  test('TARGET conserve exactement la config et les témoins du CURRENT', () => {
    const current = currentDoc();
    const target = buildTargetDocument(current, [
      { id: 'a', totals: { total: 90 } },
      { id: 'b', totals: { total: 180 } },
    ], '2026-08-19T10:00:00.000Z');

    expect(target._kind).toBe('golden-cdr-target');
    expect(target._lot).toBe('1B-1');
    expect(target.config_fingerprint).toBe(current.config_fingerprint);
    expect(target.frozen_config).toEqual(current.frozen_config);
    expect(sameWitnessSet(current, target)).toBe(true);
    expect(target._based_on_current_behavior).toBe(behaviorFingerprint(current));
  });

  test('promotion refuse si le CURRENT officiel a dérivé depuis son archive', () => {
    const archive = currentDoc();
    const official = currentDoc();
    official.snapshots[0].totals.total = 999;
    const target = buildTargetDocument(archive, archive.snapshots, '2026-08-19T10:00:00.000Z');

    expect(() => assertPromotionPreconditions({ official, archive, target }))
      .toThrow(/CURRENT officiel a dérivé/);
  });

  test('promotion refuse un TARGET avec un autre fingerprint ou d’autres témoins', () => {
    const current = currentDoc();
    const target = buildTargetDocument(current, current.snapshots, '2026-08-19T10:00:00.000Z');

    expect(() => assertPromotionPreconditions({
      official: current,
      archive: current,
      target: { ...target, config_fingerprint: 'different' },
    })).toThrow(/fingerprint TARGET incohérent/);

    expect(() => assertPromotionPreconditions({
      official: current,
      archive: current,
      target: { ...target, snapshots: [{ id: 'a' }, { id: 'c' }] },
    })).toThrow(/ensemble de témoins différent/);
  });

  test('promotion garde la preuve du CURRENT précédent', () => {
    const current = currentDoc();
    const target = buildTargetDocument(current, current.snapshots, '2026-08-19T10:00:00.000Z');
    assertPromotionPreconditions({ official: current, archive: current, target });

    const promoted = buildPromotedDocument(target, current, '2026-08-19T10:05:00.000Z');
    expect(promoted._kind).toBe('golden-cdr');
    expect(promoted._promoted_lot).toBe('1B-1');
    expect(promoted._previous_current_behavior).toBe(behaviorFingerprint(current));
    expect(promoted.snapshots).toEqual(target.snapshots);
  });
});
