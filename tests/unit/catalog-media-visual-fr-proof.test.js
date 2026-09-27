/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const { STATES, inspectOne, inspectMediaSet } = require('../../services/catalog-media-visual-fr-proof');
const IMAGE = {
  supplier_media_id: 'ali:media:7',
  url: 'https://ae01.alicdn.com/kf/example.jpg',
  option_values: { kind: '1PCS-USB A to C' },
};
const REVIEW = {
  source_media_id: IMAGE.supplier_media_id,
  source_url: IMAGE.url,
  option_values: IMAGE.option_values,
  text_presence: 'PRESENT',
  reviewed_by: 'catalog-editor-1',
  reviewed_at: '2026-09-20T08:00:00Z',
  source_transcription: 'USB A to C 1PCS',
  french_translation: 'Un câble USB-A vers USB-C',
  french_presentation: {
    kind: 'caption',
    text: 'Un câble USB-A vers USB-C',
    reviewed: true,
  },
};
test('an untouched image remains NOT_INSPECTED even with a French-looking alt or source locale', () => {
  expect(inspectOne({ ...IMAGE, alt: 'Câble USB-C', source_locale: 'fr' })).toMatchObject({
    state: STATES.NOT_INSPECTED, ready: false, reason: 'VISUAL_REVIEW_MISSING',
  });
});
test('explicit human inspection confirms absence of relevant embedded text', () => {
  expect(inspectOne(IMAGE, { ...REVIEW, text_presence: 'NONE' }))
    .toMatchObject({ state: STATES.NO_RELEVANT_TEXT_REVIEWED, ready: true });
});
test('transcription alone is not the customer-facing French presentation', () => {
  expect(inspectOne(IMAGE, { ...REVIEW, french_presentation: null }))
    .toMatchObject({ state: STATES.TRANSCRIBED_REVIEW_REQUIRED, ready: false });
  expect(inspectOne(IMAGE, { ...REVIEW, french_presentation: {
    kind: 'caption', reviewed: true, text: 'A different, unapproved caption',
  } })).toMatchObject({ state: STATES.TRANSCRIBED_REVIEW_REQUIRED, ready: false });
});
test('reviewed FR caption is accepted only when tied to exact source and variant', () => {
  expect(inspectOne(IMAGE, REVIEW))
    .toMatchObject({ state: STATES.FR_PRESENTATION_REVIEWED, ready: true });
  expect(inspectOne(IMAGE, { ...REVIEW, source_url: IMAGE.url + '?different=1' }))
    .toMatchObject({ state: STATES.NOT_INSPECTED, ready: false, reason: 'SOURCE_IMAGE_OR_VARIANT_CHANGED' });
  expect(inspectOne(IMAGE, { ...REVIEW, option_values: { kind: '2PCS-USB A to C' } }))
    .toMatchObject({ state: STATES.NOT_INSPECTED, ready: false, reason: 'SOURCE_IMAGE_OR_VARIANT_CHANGED' });
});
test('unreadable text, unknown operator and unverified localized image are blocked', () => {
  expect(inspectOne(IMAGE, { ...REVIEW, text_presence: 'UNREADABLE' }))
    .toMatchObject({ state: STATES.BLOCKED_UNREADABLE_OR_UNSUPPORTED, ready: false });
  expect(inspectOne(IMAGE, { ...REVIEW, reviewed_by: null }))
    .toMatchObject({ state: STATES.NOT_INSPECTED, ready: false });
  expect(inspectOne(IMAGE, { ...REVIEW, french_presentation: {
    kind: 'localized_image', url: IMAGE.url, reviewed: true,
  } })).toMatchObject({ state: STATES.TRANSCRIBED_REVIEW_REQUIRED, ready: false });
});
test('an entire source-media set is ready only when every individual image is reviewed', () => {
  const second = { supplier_media_id: 'ali:media:8', url: 'https://ae01.alicdn.com/kf/second.jpg' };
  expect(inspectMediaSet([IMAGE, second], [REVIEW])).toMatchObject({
    ready: false, code: 'VISUAL_FR_REVIEW_PENDING',
    results: [{ ready: true }, { ready: false, state: STATES.NOT_INSPECTED }],
  });
  expect(inspectMediaSet([IMAGE, second], [REVIEW, {
    ...REVIEW, source_media_id: second.supplier_media_id, source_url: second.url,
    option_values: undefined, text_presence: 'NONE',
  }])).toMatchObject({ ready: true, code: 'VISUAL_FR_REVIEWED' });
  expect(inspectMediaSet([], [])).toMatchObject({ ready: false, code: 'SOURCE_MEDIA_MISSING' });
  expect(inspectMediaSet([IMAGE, { ...IMAGE }], [REVIEW]))
    .toMatchObject({ ready: false, code: 'SOURCE_MEDIA_IDENTITY_NOT_UNIQUE' });
});
