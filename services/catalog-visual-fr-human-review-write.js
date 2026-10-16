/**
 * @komerce-arch-lite
 * @role catalog-visual-fr-human-review-write
 * @domain catalog
 * @layer service
 * @owner catalog
 * @purpose Persist explicit human image review only for exact active source and variant.
 * @db-read catalog_media
 * @db-write catalog_media_visual_fr_reviews
 * @db-txn none
 * @impact-areas catalog,sourcing
 */
'use strict';

const { inspectOne } = require('./catalog-media-visual-fr-proof');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function recordVisualFrReview(q, { productId, mediaId, review, reviewerId }) {
  if (!uuid.test(productId || '') || !uuid.test(mediaId || '')) {
    return { status: 400, code: 'INVALID_MEDIA_OR_PRODUCT_ID' };
  }
  if (typeof reviewerId !== 'string' || !reviewerId.trim()) {
    return { status: 403, code: 'HUMAN_REVIEWER_REQUIRED' };
  }
  const { rows } = await q.query(
    `SELECT id, source_media_id, url, option_values FROM catalog_media
      WHERE id=$1 AND product_id=$2 AND is_active=TRUE`, [mediaId, productId]
  );
  const media = rows[0];
  if (!media) return { status: 404, code: 'ACTIVE_SOURCE_MEDIA_NOT_FOUND' };
  const proof = {
    source_media_id: review?.source_media_id,
    source_url: review?.source_url,
    option_values: review?.option_values ?? null,
    text_presence: review?.text_presence,
    source_transcription: review?.source_transcription ?? null,
    french_translation: review?.french_translation ?? null,
    french_presentation: review?.french_presentation ?? null,
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
  };
  const verdict = inspectOne({ source_media_id: media.source_media_id, url: media.url,
    option_values: media.option_values }, proof);
  if (verdict.reason === 'SOURCE_IMAGE_OR_VARIANT_CHANGED') {
    return { status: 409, code: 'SOURCE_IMAGE_OR_VARIANT_CHANGED' };
  }
  if (verdict.reason === 'SOURCE_MEDIA_IDENTITY_OR_URL_MISSING') {
    return { status: 422, code: verdict.reason };
  }
  if (!['NONE', 'PRESENT', 'UNREADABLE'].includes(proof.text_presence)) {
    return { status: 422, code: 'TEXT_PRESENCE_INVALID' };
  }
  if (proof.text_presence === 'PRESENT' && !verdict.ready) {
    return { status: 422, code: verdict.reason };
  }
  const written = await q.query(
    `INSERT INTO catalog_media_visual_fr_reviews
      (media_id,source_media_id,source_url,option_values,text_presence,source_transcription,
       french_translation,french_presentation,reviewed_by,reviewed_at)
      SELECT cm.id,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11::timestamptz
        FROM catalog_media cm
       WHERE cm.id=$1 AND cm.product_id=$2 AND cm.is_active=TRUE
         AND cm.source_media_id=$3 AND cm.url=$4
         AND COALESCE(cm.option_values,'{}'::jsonb)=COALESCE($5::jsonb,'{}'::jsonb)
      ON CONFLICT (media_id) DO UPDATE
        SET source_media_id=EXCLUDED.source_media_id,source_url=EXCLUDED.source_url,
            option_values=EXCLUDED.option_values,text_presence=EXCLUDED.text_presence,
            source_transcription=EXCLUDED.source_transcription,french_translation=EXCLUDED.french_translation,
            french_presentation=EXCLUDED.french_presentation,reviewed_by=EXCLUDED.reviewed_by,
            reviewed_at=EXCLUDED.reviewed_at,updated_at=now()
      RETURNING media_id, reviewed_at`,
    [mediaId,productId,proof.source_media_id,proof.source_url,
     JSON.stringify(proof.option_values),proof.text_presence,proof.source_transcription,
     proof.french_translation,JSON.stringify(proof.french_presentation),
     proof.reviewed_by,proof.reviewed_at]
  );
  if (!written.rows.length) return { status: 409, code: 'SOURCE_MEDIA_CHANGED_DURING_REVIEW' };
  return { status: 200, code: 'VISUAL_FR_REVIEW_RECORDED', ready: verdict.ready,
    visual_state: verdict.state, media_id: mediaId };
}

module.exports = { recordVisualFrReview };
