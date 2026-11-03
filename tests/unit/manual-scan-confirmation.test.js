'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { buildManualConfirmation, MANUAL_REASONS } = require('../../services/manual-scan-confirmation');

test('un motif de la liste fermée est requis', () => {
  for (const bad of [undefined, null, {}, { reason: '' }, { reason: 'because' }]) {
    expect(() => buildManualConfirmation(bad)).toThrow(expect.objectContaining({ code: 'manual_reason_required', status: 400 }));
  }
});

test('« Autre » exige une précision', () => {
  expect(() => buildManualConfirmation({ reason: 'other' })).toThrow(expect.objectContaining({ code: 'manual_note_required' }));
  expect(buildManualConfirmation({ reason: 'other', note: 'Panne courant' }).metadata)
    .toEqual({ entry_mode: 'manual_confirmation', manual_reason: 'other', manual_note: 'Panne courant' });
});

test.each(Object.keys(MANUAL_REASONS))('motif %s → métadonnées dégradées et note lisible', (reason) => {
  const out = buildManualConfirmation({ reason, note: 'précision' });
  expect(out.metadata).toEqual(expect.objectContaining({ entry_mode: 'manual_confirmation', manual_reason: reason }));
  expect(out.notes).toContain('Confirmation manuelle');
});

test('la note est bornée à 500 caractères', () => {
  expect(buildManualConfirmation({ reason: 'offline', note: 'x'.repeat(900) }).metadata.manual_note).toHaveLength(500);
});
