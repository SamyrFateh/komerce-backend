/**
 * @komerce-arch
 * @role          catalog-media-normalizer
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        raw_json_source_product, import_profile_v1
 * @outputs       normalized_media_gallery, video_detection, findings
 * @depends       services/suppliers/pipeline-constants.js
 * @used-by       services/suppliers/json-source-pipeline.js, services/suppliers/promotion-classifier.js, services/suppliers/source-product-normalizer.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md (ING-I1..I4, ING-I9 proposé), docs/doctrine/CHANTIERS_INGESTION_CATALOGUE.md (ING-6 proposé)
 * @impact-areas  catalog, product-discovery
 * @version       2026-08 (ING-6 — extrait de json-source-pipeline.js, domaine 2/5)
 */

/**
 * KOMERCE — Détection vidéo + galerie média déterministe pour le pipeline
 * JSON « à plat + galerie » (ING-6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extrait de services/suppliers/json-source-pipeline.js (bloc 5 et 6 de
 * l'ordre des décisions documenté dans ce fichier). Ce module ne décide
 * JAMAIS lui-même du statut de promotion : il produit des faits (formes
 * vidéo détectées, galerie normalisée + findings) que
 * services/suppliers/promotion-classifier.js consomme, dans le même ordre
 * qu'avant l'extraction. Aucune règle n'est modifiée ici — copie exacte du
 * comportement d'origine.
 */

'use strict';

const { FINDINGS, finding } = require('./pipeline-constants');

// ── 5. Détection vidéo (3 formes possibles, jamais représentable) ─────────

function classifyUrlSyntactically(u) {
  if (u === null || u === undefined) return { present: false };
  if (typeof u !== 'string' || !u.trim()) return { present: true, syntacticallyValid: false, reason: 'valeur vide ou non-string' };
  if (!/^https?:\/\//i.test(u.trim())) return { present: true, syntacticallyValid: false, reason: 'schéma non http(s)' };
  if (/invalid\.example\.test|not-found|broken/i.test(u)) {
    return { present: true, syntacticallyValid: false, reason: 'marqueur explicite d\'invalidité dans l\'URL' };
  }
  return { present: true, syntacticallyValid: true };
}

function detectVideoForms(p) {
  const forms = [];
  const videoItems = [];
  if (Array.isArray(p.videos) && p.videos.length > 0) {
    forms.push('form1_videos_array');
    for (const v of p.videos) videoItems.push({ form: 'form1_videos_array', url: v.url, poster: v.poster || null, urlCheck: classifyUrlSyntactically(v.url) });
  }
  if (p.video) {
    forms.push('form2_video_string');
    videoItems.push({ form: 'form2_video_string', url: p.video, poster: p.videoPoster || null, urlCheck: classifyUrlSyntactically(p.video) });
  }
  if (Array.isArray(p.media)) {
    const videoMedia = p.media.filter((m) => m && m.type === 'video');
    for (const m of videoMedia) videoItems.push({ form: 'form3_media_array', url: m.url, poster: m.poster || null, urlCheck: classifyUrlSyntactically(m.url) });
    if (videoMedia.length > 0) forms.push('form3_media_array');
  }
  return { forms, videoItems, hasVideo: forms.length > 0 };
}

// ── 6. Galerie médias déterministe + déduplication des relations ──────────

/**
 * Un rôle média n'est JAMAIS déduit d'une position. Toute entrée de la
 * galerie source est role=PRODUCT ; display_order est une position
 * d'affichage, pas une sémantique.
 *
 * Déduplication (policies.duplicate_relation) :
 *   • même (url + type + rôle) dans le même produit -> une seule relation,
 *     événement d'audit MEDIA_RELATION_DEDUPLICATED ;
 *   • même url sous plusieurs rôles -> les DEUX relations sont conservées,
 *     finding ASSET_REUSED_ACROSS_ROLES. Une réutilisation légitime n'est
 *     jamais supprimée ;
 *   • même asset partagé entre produits -> hors de portée d'un produit,
 *     traité au niveau batch par le connecteur (policies.asset_reuse).
 *
 * @returns {{ media: Array, roleAssignmentBasis: string|null, findings: Array }}
 */
function normalizeMedia(p, profile) {
  const field = profile.media.gallery_source_field;
  const findings = [];
  const rawImages = Array.isArray(p[field]) ? p[field] : [];

  let candidates;
  let roleAssignmentBasis;

  if (rawImages.length > 0) {
    // La thumbnail n'est JAMAIS ajoutée à une galerie non vide : c'est un
    // aperçu technique, pas un média catalogue.
    candidates = rawImages.map((url, idx) => ({ url, type: 'image', role: 'PRODUCT', source_index: idx }));
    roleAssignmentBasis = 'source_field_images';
  } else if (profile.media.thumbnail_fallback && typeof p.thumbnail === 'string' && p.thumbnail.trim()) {
    // Point 7 — le fallback est RÉELLEMENT utilisé sur ce dataset (id 15 :
    // images: [], thumbnail valide). La base est exposée en V1 comme en V2,
    // jamais laissée à null.
    candidates = [{ url: p.thumbnail, type: 'image', role: 'PRODUCT', source_index: 0 }];
    roleAssignmentBasis = 'thumbnail_fallback';
    findings.push(finding(FINDINGS.THUMBNAIL_FALLBACK_USED,
      `${field} vide : thumbnail utilisée comme image principale (role=PRODUCT, display_order=0)`));
  } else {
    findings.push(finding(FINDINGS.MISSING_IMAGE,
      `aucun média : ${field} vide et pas de thumbnail exploitable (policies.missing_image=${profile.policies.missing_image})`));
    return { media: [], roleAssignmentBasis: null, findings };
  }

  const kept = [];
  const seenTriples = new Map();
  const urlRoles = new Map();
  for (const c of candidates) {
    const triple = `${c.url}|${c.type}|${c.role}`;
    if (seenTriples.has(triple)) {
      findings.push(finding(FINDINGS.MEDIA_RELATION_DEDUPLICATED,
        `relation média identique (url + type + rôle) déjà présente à la position source ${seenTriples.get(triple)} : position source ${c.source_index} dédupliquée (policies.duplicate_relation=${profile.policies.duplicate_relation})`,
        { url: c.url, role: c.role, media_type: c.type, source_index: c.source_index, kept_source_index: seenTriples.get(triple) }));
      continue;
    }
    seenTriples.set(triple, c.source_index);
    const roles = urlRoles.get(c.url) || new Set();
    roles.add(c.role);
    urlRoles.set(c.url, roles);
    kept.push(c);
  }

  for (const [url, roles] of urlRoles.entries()) {
    if (roles.size > 1) {
      findings.push(finding(FINDINGS.ASSET_REUSED_ACROSS_ROLES,
        `asset réutilisé sous ${roles.size} rôles (${[...roles].join(', ')}) — relations conservées, une réutilisation légitime n'est jamais supprimée (policies.asset_reuse=${profile.policies.asset_reuse})`,
        { url, roles: [...roles] }));
    }
  }

  // display_order = position d'affichage finale, recalculée après dédup pour
  // rester contiguë. La position source d'origine reste dans les findings.
  const media = kept.map((c, idx) => ({ url: c.url, role: c.role, display_order: idx }));
  return { media, roleAssignmentBasis, findings };
}

module.exports = {
  classifyUrlSyntactically,
  detectVideoForms,
  normalizeMedia,
};
