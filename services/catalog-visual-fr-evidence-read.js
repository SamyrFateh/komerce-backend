/**
 * @komerce-arch-lite
 * @role catalog-visual-fr-evidence-read
 * @domain catalog
 * @layer service
 * @owner catalog
 * @purpose Read persisted visual French review proofs without publication mutations.
 * @db-read catalog_media, catalog_media_visual_fr_reviews
 * @db-write none
 * @db-txn none
 * @impact-areas catalog,sourcing
 */
'use strict';

const { inspectMediaSet } = require('./catalog-media-visual-fr-proof');

async function inspectCatalogVisualFrEvidence(q, productId) {
  if (!q || typeof q.query !== 'function') throw new Error('VISUAL_FR_QUERY_REQUIRED');
  if (typeof productId !== 'string' || !productId.trim()) throw new Error('VISUAL_FR_PRODUCT_ID_REQUIRED');
  const { rows } = await q.query(
    `SELECT cm.source_media_id AS supplier_media_id, cm.url, cm.option_values,
            vr.source_media_id AS review_source_media_id, vr.source_url,
            vr.option_values AS review_option_values, vr.text_presence,
            vr.source_transcription, vr.french_translation, vr.french_presentation,
            vr.reviewed_by, vr.reviewed_at
       FROM catalog_media cm
       LEFT JOIN catalog_media_visual_fr_reviews vr ON vr.media_id = cm.id
      WHERE cm.product_id=$1 AND cm.is_active=TRUE
      ORDER BY cm.display_order NULLS LAST, cm.id`,
    [productId]
  );
  const media = rows.map(row => ({
    supplier_media_id: row.supplier_media_id,
    url: row.url,
    option_values: row.option_values,
  }));
  const reviews = rows.filter(row => row.review_source_media_id != null).map(row => ({
    source_media_id: row.review_source_media_id,
    source_url: row.source_url,
    option_values: row.review_option_values,
    text_presence: row.text_presence,
    source_transcription: row.source_transcription,
    french_translation: row.french_translation,
    french_presentation: row.french_presentation,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at,
  }));
  return inspectMediaSet(media, reviews);
}

module.exports = { inspectCatalogVisualFrEvidence };
