/**
 * @komerce-arch-lite
 * @role          catalog-media-visual-fr-proof
 * @domain        catalog
 * @layer         service
 * @owner         catalog
 * @purpose       Pure provider-independent validation of reviewed source-image text and French customer presentation.
 * @impact-areas  catalog, sourcing
 */
'use strict';

// Never infer pixel content from language metadata, URL, filename, an alt tag or the
// presence of a generated description. This module checks an explicit source-linked
// editorial REVIEW record, not OCR/provider availability.
const STATES = Object.freeze({
  NOT_INSPECTED: 'NOT_INSPECTED',
  NO_RELEVANT_TEXT_REVIEWED: 'NO_RELEVANT_TEXT_REVIEWED',
  TRANSCRIBED_REVIEW_REQUIRED: 'TRANSCRIBED_REVIEW_REQUIRED',
  FR_PRESENTATION_REVIEWED: 'FR_PRESENTATION_REVIEWED',
  BLOCKED_UNREADABLE_OR_UNSUPPORTED: 'BLOCKED_UNREADABLE_OR_UNSUPPORTED',
});

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function sameOptions(a, b) {
  const x = a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  const y = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  const kx = Object.keys(x).sort(), ky = Object.keys(y).sort();
  return kx.length === ky.length && kx.every((key, i) => key === ky[i] && x[key] === y[key]);
}
function inspectOne(media, review) {
  const sourceId = media?.supplier_media_id ?? media?.source_media_id;
  const result = { source_media_id: sourceId || null, state: STATES.NOT_INSPECTED, ready: false };
  if (!nonempty(sourceId) || !nonempty(media?.url)) {
    return { ...result, state: STATES.BLOCKED_UNREADABLE_OR_UNSUPPORTED, reason: 'SOURCE_MEDIA_IDENTITY_OR_URL_MISSING' };
  }
  if (!review) return { ...result, reason: 'VISUAL_REVIEW_MISSING' };
  // Review MUST refer to the same media and exact original URL. A changed supplier
  // image, however subtle, invalidates the review automatically.
  if (review.source_media_id !== sourceId || review.source_url !== media.url
    || !sameOptions(review.option_values, media.option_values)) {
    return { ...result, reason: 'SOURCE_IMAGE_OR_VARIANT_CHANGED' };
  }
  if (!nonempty(review.reviewed_by) || !nonempty(review.reviewed_at)
    || !Number.isFinite(Date.parse(review.reviewed_at))) {
    return { ...result, reason: 'REVIEWER_OR_TIMESTAMP_MISSING' };
  }
  if (review.text_presence === 'NONE') {
    return {
      ...result, state: STATES.NO_RELEVANT_TEXT_REVIEWED,
      reason: 'REVIEWED_NO_CUSTOMER_FACING_TEXT', ready: true,
    };
  }
  if (review.text_presence === 'UNREADABLE') {
    return { ...result, state: STATES.BLOCKED_UNREADABLE_OR_UNSUPPORTED, reason: 'CRITICAL_TEXT_UNREADABLE' };
  }
  if (review.text_presence !== 'PRESENT') return { ...result, reason: 'TEXT_PRESENCE_UNDETERMINED' };
  const presentation = review.french_presentation;
  if (!nonempty(review.source_transcription) || !nonempty(review.french_translation)
    || !presentation || presentation.reviewed !== true) {
    return { ...result, state: STATES.TRANSCRIBED_REVIEW_REQUIRED, reason: 'FR_TRANSCRIPTION_OR_PRESENTATION_NOT_REVIEWED' };
  }
  if (presentation.kind === 'caption') {
    if (presentation.text !== review.french_translation || !nonempty(presentation.text)) {
      return { ...result, state: STATES.TRANSCRIBED_REVIEW_REQUIRED, reason: 'CUSTOMER_FRENCH_CAPTION_NOT_PROVEN' };
    }
  } else if (presentation.kind === 'localized_image') {
    if (!nonempty(presentation.url) || presentation.url === media.url || !/^https:\/\//i.test(presentation.url)) {
      return { ...result, state: STATES.TRANSCRIBED_REVIEW_REQUIRED, reason: 'CUSTOMER_LOCALIZED_IMAGE_NOT_PROVEN' };
    }
  } else {
    return { ...result, state: STATES.TRANSCRIBED_REVIEW_REQUIRED, reason: 'CUSTOMER_PRESENTATION_KIND_UNSUPPORTED' };
  }
  return { ...result, state: STATES.FR_PRESENTATION_REVIEWED, reason: 'SOURCE_LINKED_FRENCH_PRESENTATION_REVIEWED', ready: true };
}

function inspectMediaSet(media, reviews = []) {
  if (!Array.isArray(media) || media.length === 0) {
    return { ready: false, code: 'SOURCE_MEDIA_MISSING', results: [] };
  }
  if (!Array.isArray(reviews)) return { ready: false, code: 'VISUAL_REVIEWS_INVALID', results: [] };
  const ids = media.map(m => m?.supplier_media_id ?? m?.source_media_id);
  if (ids.some(id => !nonempty(id)) || new Set(ids).size !== ids.length) {
    return { ready: false, code: 'SOURCE_MEDIA_IDENTITY_NOT_UNIQUE', results: [] };
  }
  const results = media.map(m => inspectOne(m, reviews.find(r =>
    r?.source_media_id === (m.supplier_media_id ?? m.source_media_id)
  )));
  const ready = results.every(r => r.ready);
  return { ready, code: ready ? 'VISUAL_FR_REVIEWED' : 'VISUAL_FR_REVIEW_PENDING', results };
}

module.exports = { STATES, inspectOne, inspectMediaSet };
