/**
 * @komerce-arch
 * @role          catalog-promotion-content-mapping
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        normalized_source_contract (brand, short_description, highlights[],
 *                specifications[], sections[], materials, care, warnings)
 * @outputs       product_content_profile_row, product_content_sections_rows,
 *                product_attributes_rows
 * @depends       @none
 * @used-by       services/catalog-promotion.js (Lot Content)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      PDC-8 (fiche produit enrichie), docs/doctrine/DOCTRINE_CATALOGUE.md §5
 * @impact-areas  catalog
 * @version       2026-07
 */

/**
 * KOMERCE — Lot Content : projection contenu éditorial V2 → product_content_profile /
 * product_content_sections / product_attributes
 * ═══════════════════════════════════════════════════════════════════════════════════
 *
 * Fonctions pures, aucune écriture DB ici (l'upsert transactionnel réel appartient à
 * services/catalog-promotion.js — promoteContent()), suivant le même partage plan/DB
 * que axes.js, sku.js et sku-media.js.
 *
 * PÉRIMÈTRE CONTRAT V2 (tous champs optionnels — un produit pauvre en contenu reste
 * valide, jamais rejeté pour absence d'éditorial) :
 *   - brand              : string|null
 *   - short_description  : string|null
 *   - highlights[]       : string[] — puces courtes, ordre porté par la position
 *   - specifications[]   : { group_key?, attribute_key, label?, value, unit? }[]
 *   - sections[]         : { section_key, title, section_type, content, display_order? }[]
 *   - materials          : string[]|null — puces courtes, aplaties en content.materials
 *   - care               : string[]|null — idem, content.care
 *   - warnings           : string[]|null — idem, content.warnings
 *
 * CLÉS RÉSERVÉES (DOCTRINE ZÉRO HEURISTIQUE) : 'materials', 'care', 'warnings' sont des
 * section_key réservées à ces trois champs dédiés du contrat — un contrat qui tente de
 * définir une section custom portant l'une de ces clés dans `sections[]` est rejeté
 * explicitement (collision de clé, jamais une fusion silencieuse).
 *
 * SOURCE / OVERRIDE MANUEL : chaque ligne projetée porte `source` (par défaut
 * 'SUPPLIER', ou options.source si fourni — ex. 'AI_ENRICHED'). C'est
 * services/catalog-promotion.js qui applique la préservation des lignes 'MANUAL'
 * existantes (clause SQL WHERE source <> 'MANUAL') — ce module ne lit jamais l'état
 * existant, il ne fait que projeter le contrat.
 */

'use strict';

const RESERVED_SECTION_KEYS = new Set(['materials', 'care', 'warnings']);
// Doit rester en couture exacte avec l'enum "type" de
// schemas/catalog/product-detail.v1.schema.json et avec ce que
// services/catalog-product-detail.js::buildSections sait projeter
// (content_json.text pour TEXT, .items pour BULLETS, .entries pour
// KEY_VALUE) — un HTML/TABLE ici serait accepté à la promotion puis
// silencieusement vidé à la lecture (aucun champ text/items/entries connu).
const ALLOWED_SECTION_TYPES = new Set(['TEXT', 'BULLETS', 'KEY_VALUE']);

function invalid(message) {
  const e = new Error(message);
  e.status = 422;
  return e;
}

function nonEmptyTrimmedStringOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalid('valeur textuelle attendue (string) ou null');
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * materials/care/warnings sont des tableaux de puces courtes dans le contrat
 * public (schemas/catalog/product-detail.v1.schema.json), jamais un bloc de
 * texte libre — aligné sur content.materials/care/warnings côté lecture
 * (services/catalog-product-detail.js::buildSections, RESERVED_SECTION_TARGETS).
 */
function nonEmptyTrimmedStringArrayOrNull(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw invalid(`${fieldName} doit être un tableau de chaînes ou null`);
  const items = value.map((item) => {
    if (typeof item !== 'string') throw invalid(`${fieldName}[] contient une valeur non textuelle`);
    return item.trim();
  }).filter((item) => item.length > 0);
  return items.length > 0 ? items : null;
}

/**
 * @param {object} contract normalized_source_contract V2
 * @param {{source?: string, enrichmentVersion?: string|null, reviewed?: boolean}} [options]
 * @returns {{brand: string|null, short_description: string|null, source: string,
 *   enrichment_version: string|null, reviewed: boolean}}
 */
function mapContentToProfileRow(contract, options = {}) {
  if (!contract || typeof contract !== 'object') {
    throw invalid('contract requis pour la projection du profil éditorial');
  }

  return {
    brand: nonEmptyTrimmedStringOrNull(contract.brand),
    short_description: nonEmptyTrimmedStringOrNull(contract.short_description),
    source: options.source || 'SUPPLIER',
    enrichment_version: options.enrichmentVersion ?? null,
    reviewed: options.reviewed ?? false,
  };
}

/**
 * Projette une section réservée (materials/care/warnings) si le contrat porte le champ
 * correspondant. Toujours `section_type: 'BULLETS'`, `content_json: { items }` — ces
 * trois champs sont des listes de puces par construction (schéma public), jamais un
 * bloc de texte libre. Couture exacte avec services/catalog-product-detail.js::buildSections,
 * qui aplatit RESERVED_SECTION_TARGETS[section_key] en lisant `content_json.items`,
 * quel que soit section_type déclaré.
 */
function reservedSectionRow(sectionKey, items, displayOrder, source) {
  if (!items || items.length === 0) return null;
  return {
    section_key: sectionKey,
    title: null,
    section_type: 'BULLETS',
    content_json: { items },
    display_order: displayOrder,
    source,
  };
}

/**
 * @param {object} contract normalized_source_contract V2
 * @param {{source?: string}} [options]
 * @returns {Array<{section_key: string, title: string|null, section_type: string,
 *   content_json: object, display_order: number|null, source: string}>}
 */
function mapContentToSectionRows(contract, options = {}) {
  if (!contract || typeof contract !== 'object') {
    throw invalid('contract requis pour la projection des sections éditoriales');
  }
  const source = options.source || 'SUPPLIER';
  const seenKeys = new Set();
  const rows = [];

  const customSections = contract.sections;
  if (customSections !== null && customSections !== undefined) {
    if (!Array.isArray(customSections)) {
      throw invalid('sections doit être un tableau ou null');
    }
    customSections.forEach((section, index) => {
      if (!section || typeof section.section_key !== 'string' || section.section_key.trim().length === 0) {
        throw invalid('sections[].section_key requis et non vide');
      }
      const sectionKey = section.section_key.trim();

      if (RESERVED_SECTION_KEYS.has(sectionKey)) {
        throw invalid(`sections[].section_key "${sectionKey}" est réservé (materials/care/warnings ont leur propre champ contrat) — ne peut pas être défini via sections[]`);
      }
      if (seenKeys.has(sectionKey)) {
        throw invalid(`section_key dupliqué : "${sectionKey}"`);
      }
      seenKeys.add(sectionKey);

      const sectionType = section.section_type || 'TEXT';
      if (!ALLOWED_SECTION_TYPES.has(sectionType)) {
        throw invalid(`sections["${sectionKey}"].section_type invalide : "${sectionType}" (attendu : ${[...ALLOWED_SECTION_TYPES].join(', ')})`);
      }

      const title = nonEmptyTrimmedStringOrNull(section.title);
      const displayOrder = typeof section.display_order === 'number' ? section.display_order : index;

      rows.push({
        section_key: sectionKey,
        title,
        section_type: sectionType,
        content_json: section.content ?? null,
        display_order: displayOrder,
        source,
      });
    });
  }

  // Sections réservées : ajoutées après les sections custom, ordre stable et déterministe
  // (materials, puis care, puis warnings) pour ne jamais dépendre de l'ordre d'itération.
  const baseOrder = rows.length;
  const reservedInOrder = [
    ['materials', contract.materials],
    ['care', contract.care],
    ['warnings', contract.warnings],
  ];
  reservedInOrder.forEach(([key, value], i) => {
    const items = nonEmptyTrimmedStringArrayOrNull(value, key);
    const row = reservedSectionRow(key, items, baseOrder + i, source);
    if (row) rows.push(row);
  });

  return rows;
}

/**
 * @param {object} contract normalized_source_contract V2
 * @param {{source?: string}} [options]
 * @returns {Array<{kind: string, group_key: string, attribute_key: string,
 *   label: string|null, value_text: string, unit: string|null, display_order: number,
 *   source: string}>}
 */
function mapContentToAttributeRows(contract, options = {}) {
  if (!contract || typeof contract !== 'object') {
    throw invalid('contract requis pour la projection des attributs');
  }
  const source = options.source || 'SUPPLIER';
  const rows = [];
  const seenTriplets = new Set();

  const highlights = contract.highlights;
  if (highlights !== null && highlights !== undefined) {
    if (!Array.isArray(highlights)) {
      throw invalid('highlights doit être un tableau ou null');
    }
    highlights.forEach((raw, index) => {
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        throw invalid('highlights[] contient une valeur vide ou invalide');
      }
      const attributeKey = `h${index + 1}`;
      const triplet = `HIGHLIGHT\u0000\u0000${attributeKey}`;
      seenTriplets.add(triplet); // par construction jamais dupliqué (index unique)
      rows.push({
        kind: 'HIGHLIGHT',
        // '' et jamais null : NULL n'est jamais égal à NULL dans une contrainte UNIQUE
        // Postgres — group_key=null romprait l'idempotence de l'ON CONFLICT (product_id,
        // kind, group_key, attribute_key) en migration 111 (deux re-promotions
        // dupliqueraient silencieusement au lieu de mettre à jour la même ligne).
        group_key: '',
        attribute_key: attributeKey,
        label: null,
        value_text: raw.trim(),
        unit: null,
        display_order: index,
        source,
      });
    });
  }

  const specifications = contract.specifications;
  if (specifications !== null && specifications !== undefined) {
    if (!Array.isArray(specifications)) {
      throw invalid('specifications doit être un tableau ou null');
    }
    specifications.forEach((spec, index) => {
      if (!spec || typeof spec.attribute_key !== 'string' || spec.attribute_key.trim().length === 0) {
        throw invalid('specifications[].attribute_key requis et non vide');
      }
      if (spec.value === null || spec.value === undefined || String(spec.value).trim().length === 0) {
        throw invalid(`specifications["${spec.attribute_key}"].value requis et non vide`);
      }
      const groupKey = nonEmptyTrimmedStringOrNull(spec.group_key) || 'general';
      const attributeKey = spec.attribute_key.trim();
      const triplet = `SPECIFICATION\u0000${groupKey}\u0000${attributeKey}`;
      if (seenTriplets.has(triplet)) {
        throw invalid(`attribut dupliqué : (SPECIFICATION, "${groupKey}", "${attributeKey}")`);
      }
      seenTriplets.add(triplet);

      rows.push({
        kind: 'SPECIFICATION',
        group_key: groupKey,
        attribute_key: attributeKey,
        label: nonEmptyTrimmedStringOrNull(spec.label) || attributeKey,
        value_text: String(spec.value).trim(),
        unit: nonEmptyTrimmedStringOrNull(spec.unit),
        display_order: index,
        source,
      });
    });
  }

  return rows;
}

module.exports = {
  mapContentToProfileRow,
  mapContentToSectionRows,
  mapContentToAttributeRows,
};
