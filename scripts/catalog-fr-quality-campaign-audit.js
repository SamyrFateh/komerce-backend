#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-fr-quality-campaign-audit
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        translation/review bundle + disposable catalog checkpoint
 * @outputs       campaign coverage report
 * @depends       db.js, scripts/catalog-fr-quality-apply.js
 * @used-by       isolated-catalog-fr-quality-campaign.yml
 * @db-read       sourcing_candidates, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      complete_campaign_before_final_apply, source_hash_bound_reviews
 * @impact-areas  catalog, product-detail, staging
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  SUPPLIER,
  assertDisposableRuntime,
  loadTranslations,
  loadReviews,
} = require('./catalog-fr-quality-apply');

const DEFAULT_OUTPUT = path.resolve('artifacts/catalog-fr-quality-campaign-audit.json');

function intArg(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} doit être un entier entre ${min} et ${max}`);
  }
  return parsed;
}

function parseArgs(argv = process.argv.slice(2)) {
  let input = null;
  let review = null;
  let output = DEFAULT_OUTPUT;
  let expected = null;
  let requireComplete = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') input = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--input=')) input = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--review') review = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--review=')) review = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--output') output = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output=')) output = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--expected') expected = intArg(argv[++i], null, 1, 100000, '--expected');
    else if (arg.startsWith('--expected=')) expected = intArg(arg.split('=', 2)[1], null, 1, 100000, '--expected');
    else if (arg === '--require-complete') requireComplete = true;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!input) throw new Error('--input requis');
  if (!review) throw new Error('--review requis');
  return { input, review, output, expected, requireComplete };
}

async function loadTargetRefs() {
  const { rows } = await db.query(
    `SELECT p.product_ref,
            p.content_source,
            p.needs_review
       FROM sourcing_candidates sc
       JOIN products p ON p.id=sc.product_id
      WHERE sc.supplier_name=$1
        AND sc.state='imported_to_catalog'
        AND sc.product_id IS NOT NULL
        AND p.lifecycle_status='candidate'
        AND p.is_active=FALSE
      ORDER BY p.product_ref`,
    [SUPPLIER]
  );
  return rows;
}

function difference(left, rightSet) {
  return left.filter(value => !rightSet.has(value));
}

async function run(options = parseArgs()) {
  assertDisposableRuntime();
  const translations = loadTranslations(options.input);
  const reviews = loadReviews(options.review);
  const targets = await loadTargetRefs();

  const translationRefs = translations.map(row => String(row.product_ref || '').trim());
  const reviewRefs = reviews.map(row => String(row.product_ref || '').trim());
  const targetRefs = targets.map(row => String(row.product_ref || '').trim());

  const translationSet = new Set(translationRefs);
  const reviewSet = new Set(reviewRefs);
  const targetSet = new Set(targetRefs);

  const missingTranslations = difference(targetRefs, translationSet);
  const missingReviews = difference(targetRefs, reviewSet);
  const translationsWithoutReview = difference(translationRefs, reviewSet);
  const reviewsWithoutTranslation = difference(reviewRefs, translationSet);
  const extraTranslations = difference(translationRefs, targetSet);
  const extraReviews = difference(reviewRefs, targetSet);

  const summary = {
    target_products: targetRefs.length,
    translations: translationRefs.length,
    reviews: reviewRefs.length,
    translation_review_pairs: translationRefs.filter(ref => reviewSet.has(ref)).length,
    missing_translations: missingTranslations.length,
    missing_reviews: missingReviews.length,
    translations_without_review: translationsWithoutReview.length,
    reviews_without_translation: reviewsWithoutTranslation.length,
    extra_translations: extraTranslations.length,
    extra_reviews: extraReviews.length,
    already_manual_reviewed: targets.filter(row => row.content_source === 'manual' && row.needs_review === false).length,
    expected: options.expected,
    complete: missingTranslations.length === 0
      && missingReviews.length === 0
      && translationsWithoutReview.length === 0
      && reviewsWithoutTranslation.length === 0
      && extraTranslations.length === 0
      && extraReviews.length === 0
      && translationRefs.length === targetRefs.length
      && reviewRefs.length === targetRefs.length,
  };

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    authority: 'FR_QUALITY_CAMPAIGN_COVERAGE_AUDIT',
    summary,
    samples: {
      missing_translations: missingTranslations.slice(0, 50),
      missing_reviews: missingReviews.slice(0, 50),
      translations_without_review: translationsWithoutReview.slice(0, 50),
      reviews_without_translation: reviewsWithoutTranslation.slice(0, 50),
      extra_translations: extraTranslations.slice(0, 50),
      extra_reviews: extraReviews.slice(0, 50),
    },
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');
  console.log(`[catalog-fr-quality-campaign-audit] ${JSON.stringify(summary)}`);

  if (options.expected != null && targetRefs.length !== options.expected) {
    throw new Error(`FR_CAMPAIGN_TARGET_COUNT_MISMATCH expected=${options.expected} actual=${targetRefs.length}`);
  }
  if (options.requireComplete && !summary.complete) {
    throw new Error(
      `FR_CAMPAIGN_INCOMPLETE translations=${translationRefs.length}/${targetRefs.length} reviews=${reviewRefs.length}/${targetRefs.length}`
    );
  }

  return report;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-fr-quality-campaign-audit] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  parseArgs,
  loadTargetRefs,
  difference,
  run,
};
