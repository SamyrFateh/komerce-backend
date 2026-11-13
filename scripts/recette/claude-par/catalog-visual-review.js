'use strict';
// CLAUDE-PAR-20261113 : enregistre les revues visuelles FR AUTOMATED_STAGING des seules images APPROUVEES
// dans catalog-visual-verdicts.json (verdict issu d'une inspection reelle image par image).
// Jamais HUMAN. Le writer canonique impose KOMERCE_ENV=staging, run_id GitHub reel et candidat de decision TEST.
const db = require('../../../db');
const { recordVisualFrReview } = require('../../../services/catalog-visual-fr-human-review-write');
const verdicts = require('./catalog-visual-verdicts.json');
const targets = require('./catalog-targets.json');

(async () => {
  const runId = String(process.env.GITHUB_RUN_ID || '');
  if (process.env.KOMERCE_ENV !== 'staging' || !/^\d{5,20}$/.test(runId)) throw new Error('CONTEXTE_STAGING_ACTIONS_REQUIS');
  const { rows: [rv] } = await db.query(
    `SELECT id FROM users WHERE role='admin' AND lower(email)=lower($1) LIMIT 1`, [process.env.REVIEWER_EMAIL || '']);
  if (!rv) throw new Error('REVIEWER_ADMIN_INTROUVABLE');
  const summary = [];
  for (const [productId, spec] of Object.entries(verdicts.products)) {
    if (!targets.products.includes(productId)) throw new Error('PRODUIT_HORS_CIBLES');
    const { rows } = await db.query(
      `SELECT id, source_media_id, url, option_values FROM catalog_media WHERE product_id=$1::uuid AND is_active=TRUE`, [productId]);
    let ok = 0, refused = 0;
    for (const m of rows) {
      const v = spec.media[m.source_media_id];
      if (!v || v.verdict !== 'APPROVED') { refused += 1; continue; }
      const review = {
        execution_mode: 'AUTOMATED_STAGING', run_id: runId,
        source_media_id: m.source_media_id, source_url: m.url, option_values: m.option_values ?? {},
        text_presence: v.text_presence, source_transcription: v.source_transcription ?? null,
        french_translation: v.french_translation ?? null, french_presentation: v.french_presentation ?? null,
      };
      const res = await recordVisualFrReview(db, { productId, mediaId: m.id, review, reviewerId: rv.id });
      if (res.status === 200) ok += 1; else { refused += 1; console.error('REFUS', productId.slice(0, 8), m.source_media_id, res.status, res.code); }
    }
    summary.push({ product: productId.slice(0, 8), recorded: ok, not_recorded: refused, active_media: rows.length });
  }
  console.log('REVIEW_SUMMARY ' + JSON.stringify(summary));
  await db.pool.end();
})().catch(e => { console.error('REFUS', e.message); process.exit(1); });
