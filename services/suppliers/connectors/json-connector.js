/**
 * @komerce-arch
 * @role          json-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        raw_json_source_batch, import_profile_v1
 * @outputs       connector_result_v1 (ready/quarantined/rejected/statistics/batchFindings)
 * @depends       services/suppliers/json-source-pipeline.js
 * @used-by       scripts/dry-run-import.js (l'orchestrateur n'est PAS encore branché)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md (ING-I1..I4, ING-I9 proposé)
 * @impact-areas  catalog, product-discovery
 * @version       2026-07 (ING-6)
 */

/**
 * KOMERCE — JSON Connector (ING-6)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Connecteur pour une source JSON « à plat + galerie » (portée exacte : cf.
 * services/suppliers/json-source-pipeline.js). Aucune règle de mapping ici :
 * ce fichier orchestre profil → prévalidation batch → pipeline → statistiques.
 *
 * AUCUN accès réseau, AUCUN accès DB. Il reçoit la racine JSON déjà lue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONTRAT COMMUN DES CONNECTEURS — connector_contract_version "1"
 * ─────────────────────────────────────────────────────────────────────────
 * Les connecteurs csv/manual/api retournent aujourd'hui { products, invalid }
 * — une taxonomie à deux issues. Elle ne peut pas exprimer un produit
 * structurellement VALIDE mais volontairement non promu (vidéo non
 * représentable, mapping avec perte, politique de devise). Ces produits ne
 * sont ni prêts ni invalides ; les faire tomber dans l'une ou l'autre case
 * est un mensonge dans les deux sens.
 *
 * Ce connecteur retourne donc la forme cible à trois populations :
 *
 *   {
 *     connector_contract_version: '1',
 *     connector: { name, version, pipeline_version },
 *     profile:   { profile_id, profile_version },
 *     ready:       [ ENTRY ],
 *     quarantined: [ ENTRY ],
 *     rejected:    [ ENTRY + { errors } ],
 *     statistics:  { total, ready, quarantined, rejected, by_status,
 *                    by_reason_code, invalid_pct, quarantined_pct,
 *                    threshold_evaluation },
 *     batchFindings: [ { code, detail, ... } ],
 *   }
 *
 * ENTRY est UNIFORME pour les trois populations :
 *
 *   { source_index, supplier_product_id, status, reason_code|null,
 *     contract|null, raw_payload, diagnostics }
 *
 *   • source_index — position dans le tableau source. C'est la seule clé
 *     toujours disponible : un rejet MISSING_SUPPLIER_PRODUCT_ID n'a
 *     précisément pas d'identité fournisseur. C'est aussi la clé de reprise
 *     idempotente d'un même batch (UNIQUE (import_id, source_index)).
 *   • raw_payload — exposé même sur `ready`, bien qu'il soit aussi dans
 *     contract.raw_payload. Ce doublon est délibéré : le RAW dans le contrat
 *     est une garantie du contrat de PRODUIT (ING-I3), qui pourrait évoluer.
 *     Le RAW dans l'entrée est une garantie du contrat de CONNECTEUR. Les
 *     deux ne doivent pas dépendre l'un de l'autre.
 *
 * total = ready + quarantined + rejected. Les trois populations sont
 * TOUJOURS retournées : un produit vidéo ne disparaît jamais parce qu'il
 * n'est pas dans `ready`, et une ligne fautive ne fait jamais disparaître
 * les 81 autres.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FRONTIÈRE ENVELOPPE / LIGNE
 * ─────────────────────────────────────────────────────────────────────────
 * Lèvent une exception, empêchent la naissance du batch :
 *   BATCH_CONFIGURATION_ERROR  — profil absent, AJV-invalide, source_type
 *   BATCH_SOURCE_FORMAT_ERROR  — JSON illisible, racine non-objet, products
 *                                absent ou non-tableau, fichier trop gros,
 *                                nombre total au-delà de la limite, tableau
 *                                vide interdit par le profil
 *
 * Deviennent des REJETS DE LIGNE dans `rejected`, batch non interrompu :
 *   produit null ou non-objet, identifiant absent, identifiant dupliqué,
 *   champ trop volumineux, profondeur excessive, prix/stock illisible,
 *   contrat AJV invalide.
 *
 * Un défaut de ligne n'est pas un défaut de structure du fichier.
 *
 * ATTENTION — catalog-import-orchestrator.js consomme aujourd'hui
 * `connectorResult.products` et `connectorResult.invalid`, et rien d'autre.
 * Brancher cette forme telle quelle ferait lire `undefined`. Le branchement
 * n'est PAS fait dans ce lot (cf. projet de modification transactionnelle).
 * Aucun alias `products`/`invalid` n'est fourni ici : un alias ferait
 * silencieusement disparaître `quarantined` chez un appelant qui croirait
 * avoir tout lu. La conversion doit être explicite et visible.
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const {
  PIPELINE_VERSION,
  FINDINGS,
  resolveImportProfile,
  preflightSourceEnvelope,
  analyzeSourceRows,
} = require('../json-source-pipeline');

const CONNECTOR_CONTRACT_VERSION = '1';
const CONNECTOR_NAME = 'json-connector';
const CONNECTOR_VERSION = '2026-07-ING6';

function batchError(code, errors) {
  const err = new Error(`${code} : ${errors.join(' | ')}`);
  err.code = code;
  err.errors = errors;
  return err;
}

/**
 * @param {Object} input
 * @param {Object} input.source           racine JSON déjà parsée (PAS un tableau)
 * @param {Object} input.import_profile   profil brut (validé ici, jamais supposé)
 * @param {number} [input.source_bytes]   taille du fichier source, pour batch.max_file_bytes
 * @returns {Object} connector_result_v1
 * @throws {Error} code=BATCH_CONFIGURATION_ERROR | BATCH_SOURCE_FORMAT_ERROR
 *                 — uniquement pour un défaut d'enveloppe. Jamais pour une
 *                 ligne : une donnée produit incorrecte revient dans
 *                 `rejected`, elle ne lève pas.
 */
/**
 * PHASE 1 — tout ce qui peut EMPÊCHER LA NAISSANCE du batch, et rien d'autre.
 * À appeler AVANT l'INSERT du batch. Ne touche à aucune ligne.
 *
 * @throws {Error} code=BATCH_CONFIGURATION_ERROR | BATCH_SOURCE_FORMAT_ERROR
 */
function preflight(input) {
  const inp = input || {};
  const profile = inp.import_profile;

  const profileCheck = resolveImportProfile(profile, { expectedSourceType: 'json' });
  if (!profileCheck.ok) throw batchError('BATCH_CONFIGURATION_ERROR', profileCheck.errors);

  const envelope = preflightSourceEnvelope(inp.source, profile, { sourceBytes: inp.source_bytes });
  if (!envelope.ok) throw batchError('BATCH_SOURCE_FORMAT_ERROR', envelope.errors);

  return { ok: true, profile };
}

/**
 * PHASE 2 — classification des lignes. À appeler APRÈS l'INSERT du batch en
 * PROCESSING : à partir d'ici, plus rien ne doit disparaître. Ne lève jamais
 * pour une donnée produit incorrecte ; une exception ici est un bug, et le
 * batch existe déjà pour le dire (statut FAILED).
 *
 * Suppose le préflight DÉJÀ passé. Ne le rejoue pas : le rejouer donnerait
 * l'illusion qu'un défaut d'enveloppe peut encore survenir après la
 * naissance du batch, alors que la frontière est justement là.
 *
 * @returns {Object} connector_result_v1
 */
function classifyRows(input) {
  const inp = input || {};
  const profile = inp.import_profile;
  const entries = analyzeSourceRows(inp.source.products, profile);

  const ready = [];
  const quarantined = [];
  const rejected = [];
  const byStatus = {};
  const byReasonCode = {};
  const assetOwners = new Map();

  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    if (e.reason_code) byReasonCode[e.reason_code] = (byReasonCode[e.reason_code] || 0) + 1;

    // Forme UNIFORME pour les trois populations, raw_payload inclus même pour
    // ready : `contract.raw_payload` est une garantie du contrat de PRODUIT,
    // pas du contrat de CONNECTEUR. Un futur contrat pourrait cesser de le
    // porter ; l'interface, elle, ne doit pas bouger.
    if (e.status === 'READY_FOR_PROMOTION') ready.push(e);
    else if (e.status.startsWith('QUARANTINED_')) quarantined.push(e);
    else rejected.push({ ...e, errors: e.diagnostics.reasons });

    // Réutilisation d'asset ENTRE produits : hors de portée d'un produit,
    // constatée ici (policies.asset_reuse = ALLOW_AND_AUDIT).
    if (e.contract) {
      const urls = Array.isArray(e.contract.media)
        ? e.contract.media.map((m) => m.url)
        : (e.contract.image_url ? [e.contract.image_url] : []);
      for (const u of new Set(urls)) {
        const owners = assetOwners.get(u) || [];
        owners.push(e.supplier_product_id);
        assetOwners.set(u, owners);
      }
    }
  }

  // ── 4. Findings de batch ───────────────────────────────────────────────
  const batchFindings = [];
  for (const [url, owners] of assetOwners.entries()) {
    if (owners.length > 1) {
      batchFindings.push({
        code: FINDINGS.ASSET_SHARED_ACROSS_PRODUCTS,
        detail: `asset partagé par ${owners.length} produits — autorisé et audité (policies.asset_reuse=${profile.policies.asset_reuse}), jamais supprimé`,
        url,
        supplier_product_ids: owners,
      });
    }
  }

  // ── 5. Statistiques et seuils — DEUX populations, DEUX seuils ──────────
  // ING-I4 protège contre une source INVALIDE : numérateur = rejected seul,
  // défauts de ligne compris (identité absente ou dupliquée). Le seuil de
  // quarantaine protège contre une source majoritairement NON REPRÉSENTABLE,
  // sans prétendre que ses données sont invalides. Jamais le même numérateur.
  const total = ready.length + quarantined.length + rejected.length;
  const invalidPct = total > 0 ? (rejected.length / total) * 100 : 0;
  const quarantinedPct = total > 0 ? (quarantined.length / total) * 100 : 0;
  const invalidExceeded = invalidPct > profile.batch.max_invalid_pct;
  const quarantinedExceeded = quarantinedPct > profile.batch.max_quarantined_pct;

  // Statut PROPOSÉ : la décision appartient à l'orchestrateur, qui seul
  // connaît l'état du batch en base. Le connecteur ne fait que constater.
  let proposedBatchStatus;
  if (invalidExceeded) proposedBatchStatus = 'BLOCKED_INVALID_THRESHOLD';
  else if (quarantinedExceeded) proposedBatchStatus = 'BLOCKED_QUARANTINE_THRESHOLD';
  else if (quarantined.length > 0) proposedBatchStatus = 'COMPLETED_WITH_QUARANTINE';
  else proposedBatchStatus = 'COMPLETED';

  return {
    connector_contract_version: CONNECTOR_CONTRACT_VERSION,
    connector: { name: CONNECTOR_NAME, version: CONNECTOR_VERSION, pipeline_version: PIPELINE_VERSION },
    profile: { profile_id: profile.profile_id, profile_version: profile.profile_version },
    ready,
    quarantined,
    rejected,
    statistics: {
      total,
      ready: ready.length,
      quarantined: quarantined.length,
      rejected: rejected.length,
      by_status: byStatus,
      by_reason_code: byReasonCode,
      invalid_pct: invalidPct,
      quarantined_pct: quarantinedPct,
      threshold_evaluation: {
        max_invalid_pct: profile.batch.max_invalid_pct,
        max_quarantined_pct: profile.batch.max_quarantined_pct,
        invalid_exceeded: invalidExceeded,
        quarantined_exceeded: quarantinedExceeded,
        proposed_batch_status: proposedBatchStatus,
      },
    },
    batchFindings,
  };
}

/**
 * Enchaînement des deux phases — pour le dry-run, où aucun batch DB n'existe
 * et où la frontière n'a donc rien à protéger. L'orchestrateur, lui, appelle
 * preflight() et classifyRows() SÉPARÉMENT, avec l'INSERT du batch entre les
 * deux : c'est toute la raison d'être de la scission.
 *
 * @param {Object} input
 * @param {Object} input.source           racine JSON déjà parsée (PAS un tableau)
 * @param {Object} input.import_profile   profil brut (validé ici, jamais supposé)
 * @param {number} [input.source_bytes]   taille du fichier, pour batch.max_file_bytes
 * @returns {Object} connector_result_v1
 * @throws {Error} code=BATCH_CONFIGURATION_ERROR | BATCH_SOURCE_FORMAT_ERROR
 */
function fetchProducts(input) {
  preflight(input);
  return classifyRows(input);
}

module.exports = {
  preflight,
  classifyRows,
  fetchProducts,
  CONNECTOR_CONTRACT_VERSION,
  CONNECTOR_NAME,
  CONNECTOR_VERSION,
};
