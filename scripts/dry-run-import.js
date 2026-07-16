#!/usr/bin/env node
/**
 * KOMERCE — Dry-run d'import officiel (LECTURE SEULE)
 * ============================================================
 *
 * Remplace la lignée dry-run-catalogue-brut.v1..v4.js. N'implémente PLUS
 * aucune règle de normalisation/devise/média/poids/classification : tout
 * vient de services/suppliers/json-source-pipeline.js via
 * services/suppliers/connectors/json-connector.js — les MÊMES fonctions que
 * l'import réel appellera. Ce script ne fait que lire, hacher et mettre en
 * forme les diagnostics produits par le module commun.
 *
 * Toujours : aucune connexion DB, aucun appel réseau, aucun Cloudinary,
 * aucune écriture hors --out, aucun sourcing_candidate.
 *
 * Usage :
 *   node scripts/dry-run-import.js \
 *     --input data/catalogue-test-raw/komerce_catalogue_brut_tests/komerce-catalogue-brut-sample.json \
 *     --profile config/import-profiles/komerce-test-dummyjson.v1.json \
 *     --out /tmp/dry-run-report-official.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchProducts } = require('../services/suppliers/connectors/json-connector');

const REPORT_MODE = 'DRY_RUN_READ_ONLY_NO_DB_NO_NETWORK_NO_CLOUDINARY_NO_PROMOTION';

function parseArgs(argv) {
  const args = { input: null, out: null, profile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--profile') args.profile = argv[++i];
  }
  if (!args.input || !args.out || !args.profile) {
    console.error('Usage: --input <f.json> --out <rapport.json> --profile <import-profile.json>');
    process.exit(1);
  }
  return args;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Hash du profil sur sa forme CANONIQUE (clés triées) : deux profils
 * identiques au formatage près donnent le même profile_hash, sinon un
 * simple reformatage ferait croire à un changement de configuration.
 */
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonicalize(v[k]); return acc; }, {});
  }
  return v;
}

function writeReport(outPath, report) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(args.out);
  const inputPath = path.resolve(args.input);
  const profilePath = path.resolve(args.profile);

  const profileRaw = fs.readFileSync(profilePath);
  const sourceRaw = fs.readFileSync(inputPath);

  const profileHash = sha256(Buffer.from(JSON.stringify(canonicalize(JSON.parse(profileRaw.toString('utf-8')))), 'utf-8'));
  const sourceSha256 = sha256(sourceRaw);

  const provenance = {
    generated_at: new Date().toISOString(),
    mode: REPORT_MODE,
    input_file: inputPath,
    source_sha256: sourceSha256,
    source_bytes: sourceRaw.length,
    profile_file: profilePath,
    profile_hash: profileHash,
  };

  let profile;
  try {
    profile = JSON.parse(profileRaw.toString('utf-8'));
  } catch (err) {
    writeReport(outPath, { ...provenance, batch_error: 'BATCH_CONFIGURATION_ERROR', errors: [`profil JSON syntaxiquement invalide : ${err.message}`] });
    console.error('BATCH_CONFIGURATION_ERROR : profil JSON illisible —', err.message);
    process.exit(1);
  }

  let source;
  try {
    source = JSON.parse(sourceRaw.toString('utf-8'));
  } catch (err) {
    writeReport(outPath, { ...provenance, batch_error: 'BATCH_SOURCE_FORMAT_ERROR', errors: [`source JSON syntaxiquement invalide : ${err.message}`] });
    console.error('BATCH_SOURCE_FORMAT_ERROR : source JSON illisible —', err.message);
    process.exit(1);
  }

  let result;
  try {
    result = fetchProducts({ source, import_profile: profile, source_bytes: sourceRaw.length });
  } catch (err) {
    // Profil invalide ou batch mal formé : aucun produit n'a été parcouru.
    writeReport(outPath, {
      ...provenance,
      profile_validation: { valid: false, errors: err.errors || [err.message] },
      batch_error: err.code || 'ERROR',
      errors: err.errors || [err.message],
    });
    console.error(`${err.code || 'ERROR'} :`);
    for (const e of err.errors || [err.message]) console.error('  -', e);
    process.exit(1);
  }

  const st = result.statistics;
  const allEntries = [
    ...result.ready.map((r) => r.diagnostics),
    ...result.quarantined.map((q) => q.diagnostics),
    ...result.rejected.map((r) => r.diagnostics),
  ];

  const findingCounts = {};
  for (const d of allEntries) {
    for (const f of d.findings || []) findingCounts[f.code] = (findingCounts[f.code] || 0) + 1;
  }

  const report = {
    ...provenance,
    profile_validation: { valid: true, errors: [] },
    import_profile: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      supplier_name: profile.supplier_name,
      source_type: profile.source_type,
      policies: profile.policies,
      weight: profile.weight,
      batch: profile.batch,
    },
    connector: result.connector,
    connector_contract_version: result.connector_contract_version,
    summary: {
      total: st.total,
      ready: st.ready,
      quarantined: st.quarantined,
      rejected: st.rejected,
      by_status: st.by_status,
      by_reason_code: st.by_reason_code,
      invalid_pct: Number(st.invalid_pct.toFixed(2)),
      quarantined_pct: Number(st.quarantined_pct.toFixed(2)),
      threshold_evaluation: st.threshold_evaluation,
      sum_check: st.ready + st.quarantined + st.rejected,
      sum_check_expected: Array.isArray(source.products) ? source.products.length : null,
    },
    findings_by_code: findingCounts,
    media_audit: {
      thumbnail_fallback_used: allEntries.filter((d) => d.media.thumbnail_fallback_used).map((d) => d.source_id),
      relations_deduplicated: allEntries
        .filter((d) => d.media.deduplicated.length > 0)
        .map((d) => ({ source_id: d.source_id, events: d.media.deduplicated })),
      assets_reused_across_roles: allEntries
        .filter((d) => d.media.reused_across_roles.length > 0)
        .map((d) => ({ source_id: d.source_id, events: d.media.reused_across_roles })),
      assets_shared_across_products: result.batchFindings.filter((f) => f.code === 'ASSET_SHARED_ACROSS_PRODUCTS'),
      gallery_not_preserved: allEntries.filter((d) => d.media.gallery_preserved === false).map((d) => d.source_id),
    },
    weight_audit: {
      unit_confirmed: allEntries.filter((d) => d.weight_provenance && d.weight_provenance.unit_confirmed).length,
      unit_unknown_omitted: allEntries.filter((d) => d.weight_provenance && d.weight_provenance.basis === 'source_unit_unconfirmed').length,
      absent: allEntries.filter((d) => d.weight_provenance && d.weight_provenance.basis === 'source_absent').length,
      note: 'weight_kg=null n\'est PAS un poids nul : le scanner produira ESTIMATED_WEIGHT_FALLBACK_USED / confidence=low. Sa table d\'estimation codée en dur est un chantier distinct, non traité ici.',
    },
    currency_audit: {
      from_source: allEntries.filter((d) => d.currency && d.currency.origin === 'source').length,
      from_profile_default: allEntries.filter((d) => d.currency && d.currency.origin === 'import_profile').length,
      rejected_by_policy: allEntries.filter((d) => d.currency && d.currency.origin === 'source_rejected_by_policy').length,
      unresolved: allEntries.filter((d) => !d.currency).length,
    },
    source_fidelity_audit: {
      complete: allEntries.filter((d) => d.source_fidelity.complete).length,
      partial: allEntries.filter((d) => !d.source_fidelity.complete).length,
    },
    batch_findings: result.batchFindings,
    // Diagnostics complets par produit — l'analyse ne vit plus dans un script
    // v4 isolé : elle sort du module commun, celui qu'appellera l'import réel.
    entries: allEntries,
    ready_contracts: result.ready.map((r) => r.contract),
    quarantined_entries: result.quarantined.map((q) => ({
      supplier_product_id: q.supplier_product_id,
      source_id: q.diagnostics.source_id,
      status: q.status,
      reasons: q.diagnostics.reasons,
      contract: q.contract,
      video_representation: q.diagnostics.video_representation,
    })),
    rejected_entries: result.rejected.map((r) => ({
      source_index: r.source_index,
      supplier_product_id: r.supplier_product_id,
      source_id: r.diagnostics.source_id,
      status: r.status,
      reason_code: r.reason_code,
      errors: r.errors,
    })),
  };

  writeReport(outPath, report);

  console.log('=== DRY-RUN OFFICIEL (LECTURE SEULE) ===');
  console.log('Profil               :', profile.profile_id, 'v' + profile.profile_version, '| hash', profileHash.slice(0, 12));
  console.log('Source sha256        :', sourceSha256.slice(0, 12), `(${sourceRaw.length} octets)`);
  console.log('Total                :', st.total);
  console.log('Ready                :', st.ready);
  console.log('Quarantined          :', st.quarantined, `(${report.summary.quarantined_pct}% / seuil ${profile.batch.max_quarantined_pct}%)`);
  console.log('Rejected             :', st.rejected, `(${report.summary.invalid_pct}% / seuil ${profile.batch.max_invalid_pct}%)`);
  console.log('Par statut           :', JSON.stringify(st.by_status));
  if (Object.keys(st.by_reason_code).length) console.log('Par reason_code      :', JSON.stringify(st.by_reason_code));
  console.log('Statut batch proposé :', st.threshold_evaluation.proposed_batch_status);
  console.log('Somme de contrôle    :', report.summary.sum_check, '/ attendu', report.summary.sum_check_expected);
  console.log('Rapport              :', outPath);
}

main();
