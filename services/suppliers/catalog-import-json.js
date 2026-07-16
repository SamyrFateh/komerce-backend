/**
 * @komerce-arch
 * @role          catalog-import-json
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        raw_json_source_batch, import_profile_v1
 * @outputs       supplier_catalog_imports (batch), sourcing_candidates (staging), supplier_catalog_import_rejections
 * @depends       db.js, services/suppliers/connectors/json-connector.js
 * @used-by       services/suppliers/catalog-import-orchestrator.js (source_type=json), scripts/pilot-json-import.js
 * @db-read       none
 * @db-write      sourcing_candidates, supplier_catalog_import_rejections, supplier_catalog_imports
 * @db-txn        BEGIN au staging, jamais autour de l'INSERT du batch ni de l'UPDATE FAILED
 * @doctrine      docs/doctrine/PROPOSITION_TRANSACTION_IMPORT_CATALOGUE.md, docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing
 * @version       2026-07 (ING-6)
 */

'use strict';

/**
 * KOMERCE — Import catalogue fournisseur, source JSON (ING-6)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Chemin DÉDIÉ, séparé de services/suppliers/catalog-import-orchestrator.js.
 * Le legacy (csv/manual/api) n'est ni touché ni traversé par ce fichier :
 * son SQL, ses tests (144+), son comportement restent identiques bit à bit.
 *
 * Flux (cf. PROPOSITION_TRANSACTION_IMPORT_CATALOGUE.md §2-3) :
 *   preflight (peut empêcher la naissance du batch)
 *     → INSERT batch PROCESSING (hors transaction)
 *     → classifyRows (pure, ne lève pas pour une ligne)
 *     → BEGIN
 *         staging ready/quarantined/rejected
 *         UPDATE statut final + compteurs
 *       COMMIT  (ou ROLLBACK → UPDATE FAILED, hors transaction)
 *
 * Ce lot ne fait QUE stager (ready/quarantined/rejected, findings, RAW).
 * Aucun scan, aucun pricing, aucune éligibilité, AUCUNE promotion : c'est un
 * chantier distinct, volontairement hors scope ici (cf. barrière de
 * promotion dans routes/sourcing-scanner.js).
 */

const crypto = require('crypto');
const db = require('../../db');
const jsonConnector = require('./connectors/json-connector');

function batchError(code, errors) {
  const err = new Error(`${code} : ${(errors || []).join(' | ')}`);
  err.code = code;
  err.errors = errors;
  return err;
}

/**
 * Hash du profil sur sa forme CANONIQUE (clés triées) — même méthode que
 * scripts/dry-run-import.js, pour que le même profil produise le même hash
 * quel que soit l'appelant (route HTTP, pilote, dry-run). Ne dépend jamais
 * du CALLER : le batch doit toujours porter la preuve du profil qu'il a
 * réellement utilisé (ING-I9), pas une valeur qu'un appelant aurait pu
 * oublier de fournir ou mal recalculer.
 */
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonicalize(v[k]); return acc; }, {});
  }
  return v;
}
function profileHashOf(profile) {
  return crypto.createHash('sha256').update(Buffer.from(JSON.stringify(canonicalize(profile)), 'utf-8')).digest('hex');
}

/**
 * Stage un candidat ready/quarantined. Upsert idempotent sur
 * (supplier_name, supplier_product_id) — même clé d'identité que le legacy,
 * volontairement inchangée (cf. migration 110, note en tête).
 */
async function stageCandidate(client, importId, entry, state, profile) {
  const c = entry.contract || {};
  const promotionStatus = entry.status || null;
  const findings = (entry.diagnostics && entry.diagnostics.findings) || [];
  // normalized_source_contract : snapshot COMPLET du contrat (V1 ou V2, avec
  // media[] le cas échéant), tel que produit par classifyPromotion. Sans ce
  // champ, le contrat n'existe qu'en mémoire le temps du staging : la
  // barrière de promotion (services/catalog-promotion.js) lit
  // sourcing_candidates.normalized_source_contract, jamais les colonnes
  // scalaires extraites ci-dessous. Null pour les entrées sans contrat
  // (ex. QUARANTINED_CURRENCY_POLICY) — même sémantique que le chemin legacy.
  const normalizedSourceContract = entry.contract ? JSON.stringify(entry.contract) : null;

  await client.query(
    `INSERT INTO sourcing_candidates (
       import_id, supplier_name, supplier_product_id,
       product_name, supplier_category, purchase_price, currency,
       image_url, product_url, description, stock_available,
       min_order_qty, supplier_delay_days, weight_kg,
       data_sources, state, raw_payload, normalized_source_contract,
       promotion_status, findings,
       profile_id, profile_version, profile_hash,
       source_sha256, source_row_sha256, connector_version, observed_at
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9, $10, $11,
       $12, $13, $14,
       $15::jsonb, $16, $17::jsonb, $18::jsonb,
       $19, $20::jsonb,
       $21, $22, $23,
       $24, $25, $26, NOW()
     )
     ON CONFLICT (supplier_name, supplier_product_id)
       WHERE supplier_product_id IS NOT NULL
     DO UPDATE SET
       import_id           = EXCLUDED.import_id,
       product_name         = EXCLUDED.product_name,
       supplier_category    = EXCLUDED.supplier_category,
       purchase_price       = EXCLUDED.purchase_price,
       currency             = EXCLUDED.currency,
       image_url            = EXCLUDED.image_url,
       product_url          = EXCLUDED.product_url,
       description          = EXCLUDED.description,
       stock_available      = EXCLUDED.stock_available,
       min_order_qty        = EXCLUDED.min_order_qty,
       supplier_delay_days  = EXCLUDED.supplier_delay_days,
       weight_kg            = EXCLUDED.weight_kg,
       raw_payload          = EXCLUDED.raw_payload,
       normalized_source_contract = EXCLUDED.normalized_source_contract,
       promotion_status     = EXCLUDED.promotion_status,
       findings             = EXCLUDED.findings,
       profile_id           = EXCLUDED.profile_id,
       profile_version      = EXCLUDED.profile_version,
       profile_hash         = EXCLUDED.profile_hash,
       source_sha256        = EXCLUDED.source_sha256,
       source_row_sha256    = EXCLUDED.source_row_sha256,
       connector_version    = EXCLUDED.connector_version,
       observed_at          = NOW(),
       state                = EXCLUDED.state
     -- ING-I5 : un candidat terminal reste un snapshot cohérent. On ne
     -- conserve pas seulement son state tout en écrasant son contrat, son
     -- batch et ses diagnostics par une observation plus récente.
     WHERE sourcing_candidates.state NOT IN ('imported_to_catalog', 'rejected')
     `,
    [
      importId, profile.supplier_name, entry.supplier_product_id,
      c.product_name ?? null, c.supplier_category ?? null, c.purchase_price ?? null, c.currency ?? null,
      c.image_url ?? null, c.product_url ?? null, c.description ?? null, c.stock_available ?? null,
      c.min_order_qty ?? null, c.supplier_delay_days ?? null, c.weight_kg ?? null,
      JSON.stringify({ source: 'json_connector' }), state, JSON.stringify(entry.raw_payload ?? null), normalizedSourceContract,
      promotionStatus, JSON.stringify(findings),
      profile.profile_id, profile.profile_version, profile.profile_hash || null,
      profile.source_sha256 || null, entry.source_row_sha256 || null, profile.connector_version || null,
    ]
  );
}

/**
 * Stage un rejet dans la table dédiée (jamais dans sourcing_candidates :
 * product_name NOT NULL et clé d'identité supplier_product_id peuvent être
 * absents — cf. migration 110 §4).
 */
async function stageRejection(client, importId, entry, profile) {
  await client.query(
    `INSERT INTO supplier_catalog_import_rejections (
       import_id, supplier_name, supplier_product_id, source_index,
       promotion_status, reason_code, reasons, findings, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
     ON CONFLICT (import_id, source_index) DO NOTHING`,
    [
      importId, profile.supplier_name, entry.supplier_product_id || null, entry.source_index,
      entry.status, entry.reason_code,
      JSON.stringify((entry.diagnostics && entry.diagnostics.reasons) || [entry.reason_code]),
      JSON.stringify((entry.diagnostics && entry.diagnostics.findings) || []),
      JSON.stringify(entry.raw_payload === undefined ? null : entry.raw_payload),
    ]
  );
}

/**
 * @param {Object} body
 * @param {string} body.supplier_name
 * @param {Object} body.import_profile   profil brut (validé par le connecteur)
 * @param {Object} body.source           racine JSON déjà parsée { products: [...] }
 * @param {number} [body.source_bytes]
 * @param {string} [body.source_sha256]  précalculé par l'appelant (dry-run/pilote) si connu
 * @param {string|null} userId
 * @returns {Object} { status, body }
 */
async function importJsonCatalog(body, userId) {
  const b = body || {};
  const supplierName = (b.supplier_name || '').trim();
  if (!supplierName) {
    return { status: 400, body: { error: 'supplier_name requis' } };
  }

  // ── Phase 1 — avant batch : rien à tracer si la source n'existe pas ──────
  let preflightResult;
  try {
    preflightResult = jsonConnector.preflight({
      source: b.source,
      import_profile: b.import_profile,
      source_bytes: b.source_bytes,
    });
  } catch (err) {
    return {
      status: 400,
      body: { error: err.message, code: err.code, errors: err.errors },
    };
  }
  const profile = preflightResult.profile;

  // Le profil validé est l'autorité. L'appelant ne peut ni rebaptiser le
  // fournisseur ni injecter un hash différent de la configuration réellement
  // exécutée.
  if (supplierName !== profile.supplier_name) {
    return {
      status: 400,
      body: {
        error: 'supplier_name incohérent avec le profil d\'import',
        code: 'BATCH_CONFIGURATION_ERROR',
        errors: [`body=${supplierName}`, `profile=${profile.supplier_name}`],
      },
    };
  }

  const computedProfileHash = profileHashOf(profile);
  if (b.profile_hash && b.profile_hash !== computedProfileHash) {
    return {
      status: 400,
      body: {
        error: 'profile_hash incohérent avec le profil d\'import',
        code: 'BATCH_CONFIGURATION_ERROR',
        errors: [`fourni=${b.profile_hash}`, `calculé=${computedProfileHash}`],
      },
    };
  }
  const profileHash = computedProfileHash;

  const computedSourceSha256 = crypto.createHash('sha256')
    .update(Buffer.from(JSON.stringify(b.source), 'utf-8')).digest('hex');
  if (b.source_sha256 && b.source_sha256 !== computedSourceSha256) {
    return {
      status: 400,
      body: {
        error: 'source_sha256 incohérent avec la source reçue',
        code: 'BATCH_SOURCE_FORMAT_ERROR',
        errors: [`fourni=${b.source_sha256}`, `calculé=${computedSourceSha256}`],
      },
    };
  }
  const sourceSha256 = computedSourceSha256;

  // ── Phase 2 — naissance du batch, HORS transaction, AVANT classification ─
  const importRes = await db.query(
    `INSERT INTO supplier_catalog_imports
       (supplier_name, source_type, source_filename, notes, total_items, imported_by,
        profile_id, profile_version, profile_hash, source_sha256, source_bytes,
        connector_name, connector_version, connector_contract_version, pipeline_version,
        status, started_at)
     VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PROCESSING',now())
     RETURNING id`,
    [
      supplierName, 'json', b.source_filename || null, b.notes || null, userId || null,
      profile.profile_id, profile.profile_version, profileHash,
      sourceSha256, b.source_bytes || null,
      jsonConnector.CONNECTOR_NAME, jsonConnector.CONNECTOR_VERSION,
      jsonConnector.CONNECTOR_CONTRACT_VERSION, null,
    ]
  );
  const importId = importRes.rows[0].id;

  // ── Phase 3 — à partir d'ici, plus rien ne disparaît ─────────────────────
  let client;
  try {
    // classifyRows est pure (hors DB) : une exception ici est un bug, et le
    // batch existe déjà pour le dire (statut FAILED, cf. catch).
    const result = jsonConnector.classifyRows({ source: b.source, import_profile: profile });
    const { ready, quarantined, rejected, statistics } = result;
    const profileForStaging = {
      ...profile,
      profile_hash: profileHash,
      source_sha256: sourceSha256,
      connector_version: jsonConnector.CONNECTOR_VERSION,
    };

    client = await db.getClient();
    await client.query('BEGIN');

    for (const e of ready) await stageCandidate(client, importId, e, 'normalized', profileForStaging);
    for (const e of quarantined) await stageCandidate(client, importId, e, 'quarantined', profileForStaging);
    for (const e of rejected) await stageRejection(client, importId, e, profileForStaging);

    const te = statistics.threshold_evaluation;
    const status = te.proposed_batch_status;

    await client.query(
      `UPDATE supplier_catalog_imports
          SET status=$2, total_items=$3, ready_count=$4, quarantined_count=$5,
              rejected_count=$6, invalid_pct=$7, quarantined_pct=$8,
              batch_findings=$9::jsonb, finished_at=now()
        WHERE id=$1`,
      [
        importId, status, statistics.total, statistics.ready, statistics.quarantined,
        statistics.rejected, statistics.invalid_pct, statistics.quarantined_pct,
        JSON.stringify(result.batchFindings || []),
      ]
    );

    await client.query('COMMIT');

    return {
      status: 200,
      body: {
        import_id: importId,
        status,
        supplier_name: supplierName,
        source_type: 'json',
        statistics,
      },
    };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    // HORS transaction : le batch doit survivre à son propre échec.
    await db.query(
      `UPDATE supplier_catalog_imports
          SET status='FAILED', error_code=$2, error_detail=$3, finished_at=now()
        WHERE id=$1`,
      [importId, err.code || 'ERROR', String(err.message).slice(0, 2000)]
    );
    return { status: 500, body: { import_id: importId, status: 'FAILED', error: err.message } };
  } finally {
    if (client) client.release();
  }
}

module.exports = { importJsonCatalog, stageCandidate, stageRejection };
