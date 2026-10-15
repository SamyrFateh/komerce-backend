#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          cj-kir-category-evidence-audit
 * @domain        sourcing
 * @layer         tooling
 * @criticality   medium
 * @inputs        one CJ KIR, persisted raw supplier evidence, current category config
 * @outputs       read-only sanitized classification audit report
 * @depends       db.js, services/pricing-engine.js, services/customs-dynamic-category-classifier.js
 * @used-by       admin operator audit before classification changes
 * @db-read       import_runtime_runs, import_runtime_item_events, sourcing_candidates, customs_categories
 * @db-write      none
 * @db-txn        none
 * @doctrine      source_evidence_first, no_provider_calls, no_replay, no_mutations
 * @impact-areas  sourcing, customs, catalog
 * @version       2026-10
 */
'use strict';

const db = require('../db');
const pricing = require('../services/pricing-engine');
const classifier = require('../services/customs-dynamic-category-classifier');

const DEFERRED = new Set(['WATCH', 'AVOID', 'LOSS']);
const shorten = (value, length = 180) => String(value ?? '').trim().slice(0, length);
const asObject = value => {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};
function tally(counts, value) {
  const key = shorten(value || '<absent>');
  counts[key] = (counts[key] || 0) + 1;
}
function sourceCategories(rawPayload) {
  const cj = asObject(asObject(rawPayload).cj);
  const path = [cj.oneCategoryName, cj.twoCategoryName, cj.threeCategoryName]
    .map(x => shorten(x, 100)).filter(Boolean);
  if (!path.length && cj.categoryName) path.push(shorten(cj.categoryName, 200));
  const ids = {};
  for (const key of ['oneCategoryId', 'twoCategoryId', 'threeCategoryId', 'categoryId', 'categoryID']) {
    if (cj[key] != null && String(cj[key]).trim()) ids[key] = shorten(cj[key], 96);
  }
  return {
    path, ids, payload_present:Object.keys(cj).length > 0,
    title_present:Boolean(cj.nameEn || cj.productNameEn || cj.productName),
    description_present:Boolean(cj.description),
    materials_present:Array.isArray(cj.materialNameEnSet) && cj.materialNameEnSet.length > 0,
  };
}

function projectEvidence(rows, config, classify = classifier) {
  const categories = Object.values(config.categories || {})
    .filter(c => c && c.key !== 'default' && c.is_active !== false);
  const summary = {
    candidates_present:rows.length, deferred_current:0, decisions:{}, reasons:{},
    provider_category_paths:{}, possible_gaps:{},
    with_cj_raw:0, with_supplier_category:0, with_lexical_candidate:0,
    accepted_baseline:0, accepted_category_drift:0, accepted_category_drift_examples:[],
  };
  const items = [];
  for (const row of rows) {
    const raw = asObject(row.raw_payload);
    const scan = asObject(row.scan_result);
    const decision = shorten(scan.sourcing_decision || 'UNKNOWN').toUpperCase();
    tally(summary.decisions, decision);
    if (!DEFERRED.has(decision)) {
      // Vérifie que les candidats déjà TEST/PRIORITY gardent leur catégorie
      // dans une simulation pure, AVANT toute adoption du moteur amélioré.
      if (decision === 'TEST' || decision === 'PRIORITY') {
        summary.accepted_baseline++;
        const preview=classify.classifySupplierProduct({
          product_name:row.product_name,supplier_category:row.supplier_category,
          description:row.description,raw_payload:asObject(row.raw_payload),
        }, categories, {
          boutique_customs_affinities:config.boutique_customs_affinities || [],
        });
        if (preview.key !== row.komerce_category || preview.source === 'default') {
          summary.accepted_category_drift++;
          summary.accepted_category_drift_examples.push({
            candidate_ref:shorten(row.candidate_ref,80),
            before:shorten(row.komerce_category,80) || null,
            preview:preview.key || null,
            reason:preview.reason,
          });
        }
      }
      continue;
    }
    summary.deferred_current++;
    const cj = sourceCategories(raw);
    if (cj.payload_present) summary.with_cj_raw++;
    if (cj.path.length) summary.with_supplier_category++;
    const original = {
      product_name:row.product_name, supplier_category:row.supplier_category,
      description:row.description, raw_payload:raw,
    };
    const signals = classify.supplierSignals(original);
    const ranked = categories.map(category => classify.scoreCategory(category,signals))
      .filter(result=>result.score>0)
      .sort((a,b)=>b.score-a.score || String(a.category.key).localeCompare(String(b.category.key)));
    if (ranked.length) summary.with_lexical_candidate++;
    const preview = classify.classifySupplierProduct(original, categories,
      { boutique_customs_affinities:config.boutique_customs_affinities || [] });
    const gap = !cj.payload_present ? 'CJ_RAW_NOT_PRESENT'
      : !cj.path.length ? 'CJ_CATEGORY_NOT_PRESENT'
        : !ranked.length ? 'NO_TAXONOMY_TERM_MATCH'
          : preview.reason === 'object_identity_unconfirmed' ? 'OBJECT_IDENTITY_UNCONFIRMED'
            : preview.source === 'default' ? 'AMBIGUOUS_OR_LOW_CONFIDENCE'
              : 'MAPPING_AVAILABLE_ON_CURRENT_RULES';
    tally(summary.possible_gaps, gap);
    tally(summary.reasons, scan.reason);
    tally(summary.provider_category_paths, cj.path.join(' > '));
    items.push({
      candidate_ref:shorten(row.candidate_ref,80),
      supplier_product_id:shorten(row.supplier_product_id,120),
      object_name:shorten(row.product_name,200),
      supplier_category_saved:shorten(row.supplier_category,240) || null,
      cj,
      current:{ decision,reason:shorten(scan.reason,240),
        category:shorten(row.komerce_category,80),
        category_source:shorten(asObject(row.data_sources).category,60),state:shorten(row.state,50) },
      possible_gap:gap,
      preview_using_current_config:{ category:preview.key,source:preview.source,
        confidence:preview.confidence,reason:preview.reason },
      scored_categories:ranked.slice(0,3).map(result=>({
        key:result.category.key,label:shorten(result.category.label || result.category.key,100),
        score:result.score, evidence:result.evidence.slice(0,5).map(e=>({
          signal:e.signal,term:shorten(e.term,80),contribution:e.contribution,
        })),
      })),
    });
  }
  return {summary,items};
}

// Qualifie en TAXONOMY (seule catégorie Raffinerie que ce diagnostic peut
// prouver) les écarts déjà calculés par projectEvidence — aucune nouvelle
// lecture, aucun nouveau moteur de classement, aucun rejet. IDENTITY/
// CONTENT/MEDIA/STRUCTURE ne sont pas qualifiés ici faute de preuve
// disponible dans ce diagnostic (DOCTRINE_CATALOGUE.md §3 : ne qualifier
// que les défauts démontrables).
const GAP_CAUSE = Object.freeze({
  CJ_RAW_NOT_PRESENT:'donnee_source_cj_absente',
  CJ_CATEGORY_NOT_PRESENT:'categorie_fournisseur_absente',
  NO_TAXONOMY_TERM_MATCH:'vocabulaire_taxonomie_insuffisant',
  OBJECT_IDENTITY_UNCONFIRMED:'identite_objet_non_confirmee',
  AMBIGUOUS_OR_LOW_CONFIDENCE:'classement_ambigu_ou_peu_confiant',
});
function qualifyTaxonomyDefects({summary,items}) {
  const defects=[];
  for (const item of items || []) {
    if (item.possible_gap === 'MAPPING_AVAILABLE_ON_CURRENT_RULES') {
      defects.push({category:'TAXONOMY',severity:'informational',
        candidate_ref:item.candidate_ref,
        evidence:`gap=${item.possible_gap}; preview=${item.preview_using_current_config.category}`,
        cause:'referentiel_actif_desormais_suffisant',
        recommended_action:'proposer_reclassement_pour_validation_humaine'});
    } else if (item.possible_gap) {
      defects.push({category:'TAXONOMY',severity:'editorial_review',
        candidate_ref:item.candidate_ref,
        evidence:`gap=${item.possible_gap}`,
        cause:GAP_CAUSE[item.possible_gap] || item.possible_gap.toLowerCase(),
        recommended_action:'classification_manuelle_requise_avant_scan'});
    }
  }
  for (const example of (summary && summary.accepted_category_drift_examples) || []) {
    defects.push({category:'TAXONOMY',severity:'blocking_review',
      candidate_ref:example.candidate_ref,
      evidence:`before=${example.before}; preview=${example.preview}; reason=${example.reason}`,
      cause:'classification_deja_acceptee_divergente_du_referentiel_actuel',
      recommended_action:'revalider_categorie_avant_promotion_catalogue'});
  }
  return defects;
}

async function auditRun(runRef, deps = {
  query:(...args)=>db.query(...args),loadConfig:()=>pricing.loadGlobalConfig(),
}) {
  if (!/^KIR-\d{6}$/.test(String(runRef || ''))) throw new Error('KIR_REF_INVALID');
  const {rows:[run]}=await deps.query(
    'SELECT id,run_ref,provider,source_total,intake FROM import_runtime_runs WHERE run_ref=$1', [runRef]);
  if (!run) throw new Error('KIR_NOT_FOUND');
  if (run.provider !== 'CJdropshipping') throw new Error('KIR_NOT_CJ');
  // Exact membership KIR -> candidate captured at run time (legacy fallback).
  // Candidate state itself remains mutable after the historical run.
  const {rows}=await deps.query(
    `WITH membership AS (
      SELECT DISTINCT candidate_id FROM import_runtime_item_events
      WHERE run_id=$1 AND candidate_id IS NOT NULL
     ), flag AS (SELECT EXISTS (SELECT 1 FROM membership) AS has_events)
     SELECT sc.candidate_ref,sc.supplier_product_id,sc.product_name,
            sc.supplier_category,sc.description,sc.komerce_category,
            sc.state,sc.raw_payload,sc.scan_result,sc.data_sources
     FROM import_runtime_runs r CROSS JOIN flag
     JOIN sourcing_candidates sc ON
       ((flag.has_events AND sc.id IN (SELECT candidate_id FROM membership))
        OR (NOT flag.has_events AND sc.import_id=r.import_id))
     WHERE r.id=$1 ORDER BY sc.candidate_ref LIMIT 101`, [run.id]);
  if (rows.length>100) throw new Error('AUDIT_LIMIT_100');
  const config=await deps.loadConfig();
  const evidence=projectEvidence(rows,config);
  return {
    run_ref:run.run_ref, source:'CJdropshipping',
    recorded:{received:Number(run.source_total)||0,deferred:Number(asObject(run.intake).deferred)||0},
    ...evidence,
    taxonomy_defects:qualifyTaxonomyDefects(evidence),
    // Inventaire nécessaire pour distinguer « vocabulaire manquant » de
    // « catégorie douanière absente ». Aucun prix, taux, marge ni secret.
    active_taxonomy:Object.values(config.categories || {})
      .filter(cat=>cat && cat.key && cat.key !== 'default' && cat.is_active !== false)
      .slice(0,100).map(cat=>({
        key:shorten(cat.key,80),label:shorten(cat.label || cat.key,120),
        classification_terms:Object.keys(asObject(cat.classification_terms)).slice(0,80),
      })),
    note:'READ ONLY. Aucun appel API CJ, aucune modification DB, aucune reclassification. Les décisions des candidats sont leur état actuel (modifiable depuis le passage). Les scores PREVIEW utilisent le référentiel actif actuellement et ne remplacent pas la preuve historique. accepted_category_drift doit être égal à zéro avant tout re-scan opérationnel.',
    provider_api_calls:0,db_writes:0,
  };
}

if (require.main===module) {
  const ref=process.argv.find(x=>/^--run=/.test(x))?.slice(6) || '';
  auditRun(ref).then(result=>{process.stdout.write(JSON.stringify(result,null,2)+'\n');})
    .catch(error=>{console.error('[AUDIT-CJ-KIR] '+error.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={sourceCategories,projectEvidence,qualifyTaxonomyDefects,auditRun};
