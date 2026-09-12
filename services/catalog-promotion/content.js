/**
 * @komerce-arch
 * @role          catalog-promotion-content-mapping
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        normalized_source_contract V2
 * @outputs       product_content_profile_row, product_content_sections_rows,
 *                product_attributes_rows
 * @depends       @none
 * @used-by       services/catalog-promotion.js (Lot Content)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      PDC-8 (fiche produit enrichie), docs/doctrine/DOCTRINE_CATALOGUE.md §5
 * @impact-areas  catalog
 * @version       2026-09-v2
 */

'use strict';

const RESERVED_SECTION_KEYS = new Set(['materials', 'care', 'warnings']);
const ALLOWED_SECTION_TYPES = new Set(['TEXT', 'BULLETS', 'KEY_VALUE']);
const MAX_ATTRIBUTE_KEY_LENGTH = 128;

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

function nonEmptyTrimmedStringArrayOrNull(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw invalid(`${fieldName} doit être un tableau de chaînes ou null`);
  const items = value.map((item) => {
    if (typeof item !== 'string') throw invalid(`${fieldName}[] contient une valeur non textuelle`);
    return item.trim();
  }).filter((item) => item.length > 0);
  return items.length > 0 ? items : null;
}

function projectedAttributeKey(kind, groupKey, baseKey, seenTriplets) {
  const normalizedBase = String(baseKey || '').trim();
  let occurrence = 1;

  while (true) {
    const suffix = occurrence === 1 ? '' : `~${occurrence}`;
    const room = Math.max(1, MAX_ATTRIBUTE_KEY_LENGTH - suffix.length);
    const candidate = `${normalizedBase.slice(0, room)}${suffix}`;
    const triplet = `${kind}\u0000${groupKey}\u0000${candidate}`;
    if (!seenTriplets.has(triplet)) {
      seenTriplets.add(triplet);
      return candidate;
    }
    occurrence += 1;
  }
}

function attributeKeyFromLabel(label) {
  const normalizedLabel = nonEmptyTrimmedStringOrNull(label);
  if (!normalizedLabel) return null;

  const folded = normalizedLabel
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

  const token = folded || Array.from(normalizedLabel)
    .map((char) => char.codePointAt(0).toString(16))
    .join('_');

  return `label_${token}`.slice(0, MAX_ATTRIBUTE_KEY_LENGTH);
}

function mapContentToProfileRow(contract, options = {}) {
  if (!contract || typeof contract !== 'object') {
    throw invalid('contract requis pour la projection du profil éditorial');
  }

  return {
    brand: nonEmptyTrimmedStringOrNull(contract.brand),
    // short_description n'est pas un champ du NormalizedSupplierProduct V2
    // canonique. Il reste accepté ici pour les contrats enrichis historiques,
    // sans jamais fabriquer une valeur depuis description.
    short_description: nonEmptyTrimmedStringOrNull(contract.short_description),
    source: options.source || 'SUPPLIER',
    enrichment_version: options.enrichmentVersion ?? null,
    reviewed: options.reviewed ?? false,
  };
}

const RESERVED_SECTION_TITLES = {
  materials: 'Matériaux',
  care: 'Entretien',
  warnings: 'Avertissements',
};

function reservedSectionRow(sectionKey, items, displayOrder, source) {
  if (!items || items.length === 0) return null;
  return {
    section_key: sectionKey,
    title: RESERVED_SECTION_TITLES[sectionKey] || sectionKey,
    section_type: 'BULLETS',
    content_json: { items },
    display_order: displayOrder,
    source,
  };
}

function canonicalSectionContent(section, sectionType) {
  // Compatibilité de projection uniquement : `content` appartient à l'ancienne
  // forme interne et n'est pas produit par le schéma V2 canonique.
  if (Object.prototype.hasOwnProperty.call(section, 'content')) return section.content ?? null;

  if (sectionType === 'TEXT') {
    const text = nonEmptyTrimmedStringOrNull(section.text);
    return text == null ? null : { text };
  }
  if (sectionType === 'BULLETS') {
    const items = nonEmptyTrimmedStringArrayOrNull(section.items, 'sections[].items');
    return items == null ? null : { items };
  }
  if (sectionType === 'KEY_VALUE') {
    if (section.entries === null || section.entries === undefined) return null;
    if (!Array.isArray(section.entries)) throw invalid('sections[].entries doit être un tableau ou null');
    const entries = section.entries.map((entry) => {
      if (!entry || typeof entry !== 'object') throw invalid('sections[].entries contient une entrée invalide');
      const label = nonEmptyTrimmedStringOrNull(entry.label);
      const value = nonEmptyTrimmedStringOrNull(entry.value);
      if (!label || !value) throw invalid('sections[].entries exige label et value non vides');
      return { label, value };
    });
    return entries.length ? { entries } : null;
  }
  return null;
}

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
      const rawKey = section?.key ?? section?.section_key;
      if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
        throw invalid('sections[].key requis et non vide (section_key requis pour compatibilité)');
      }
      const sectionKey = rawKey.trim();
      if (RESERVED_SECTION_KEYS.has(sectionKey)) {
        throw invalid(`sections[].key "${sectionKey}" est réservé (materials/care/warnings ont leur propre champ contrat)`);
      }
      if (seenKeys.has(sectionKey)) throw invalid(`section_key dupliqué : "${sectionKey}"`);
      seenKeys.add(sectionKey);

      const sectionType = section.type ?? section.section_type ?? 'TEXT';
      if (!ALLOWED_SECTION_TYPES.has(sectionType)) {
        throw invalid(`sections["${sectionKey}"].type invalide (section_type invalide) : "${sectionType}" (attendu : ${[...ALLOWED_SECTION_TYPES].join(', ')})`);
      }

      rows.push({
        section_key: sectionKey,
        title: nonEmptyTrimmedStringOrNull(section.title),
        section_type: sectionType,
        content_json: canonicalSectionContent(section, sectionType),
        display_order: typeof section.display_order === 'number' ? section.display_order : index,
        source,
      });
    });
  }

  const baseOrder = rows.length;
  [
    ['materials', contract.materials],
    ['care', contract.care],
    ['warnings', contract.warnings],
  ].forEach(([key, value], i) => {
    const items = nonEmptyTrimmedStringArrayOrNull(value, key);
    const row = reservedSectionRow(key, items, baseOrder + i, source);
    if (row) rows.push(row);
  });

  return rows;
}

function mapContentToAttributeRows(contract, options = {}) {
  if (!contract || typeof contract !== 'object') {
    throw invalid('contract requis pour la projection des attributs');
  }
  const source = options.source || 'SUPPLIER';
  const rows = [];
  const seenTriplets = new Set();

  const highlights = contract.highlights;
  if (highlights !== null && highlights !== undefined) {
    if (!Array.isArray(highlights)) throw invalid('highlights doit être un tableau ou null');

    highlights.forEach((raw, index) => {
      // V2 canonique : { key?, label }. Les strings restent acceptées ici pour
      // rejouabilité des anciens contrats enrichis, jamais comme sortie du V2.
      const label = typeof raw === 'string'
        ? nonEmptyTrimmedStringOrNull(raw)
        : nonEmptyTrimmedStringOrNull(raw?.label);
      if (!label) throw invalid('highlights[] contient une valeur vide ou invalide');

      const canonicalKey = typeof raw === 'object' && raw !== null
        ? nonEmptyTrimmedStringOrNull(raw.key)
        : null;
      const baseAttributeKey = canonicalKey || `h${index + 1}`;
      const attributeKey = projectedAttributeKey('HIGHLIGHT', '', baseAttributeKey, seenTriplets);

      rows.push({
        kind: 'HIGHLIGHT',
        group_key: '',
        attribute_key: attributeKey,
        label,
        value_text: null,
        unit: null,
        display_order: index,
        source,
      });
    });
  }

  const specifications = contract.specifications;
  if (specifications !== null && specifications !== undefined) {
    if (!Array.isArray(specifications)) throw invalid('specifications doit être un tableau ou null');

    specifications.forEach((spec, index) => {
      // V2 canonique : `key` est nullable. La table cible exige néanmoins une
      // identité stable : une clé fournisseur présente est conservée, sinon on
      // dérive une clé déterministe depuis le label canonique du contrat.
      const rawKey = spec?.key ?? spec?.attribute_key;
      const canonicalKey = typeof rawKey === 'string' && rawKey.trim().length > 0
        ? rawKey.trim()
        : null;
      const specLabel = nonEmptyTrimmedStringOrNull(spec.label);
      const baseAttributeKey = canonicalKey || attributeKeyFromLabel(specLabel);
      if (!baseAttributeKey) {
        throw invalid('specifications[] exige une key/attribute_key ou un label non vide pour fabriquer une identité DB stable');
      }
      if (spec.value === null || spec.value === undefined || String(spec.value).trim().length === 0) {
        throw invalid(`specifications["${baseAttributeKey}"].value requis et non vide`);
      }

      const rawGroup = spec.group ?? spec.group_key;
      const groupKey = nonEmptyTrimmedStringOrNull(rawGroup) || 'general';

      // Le contrat V2 n'impose ni présence ni unicité de specifications[].key,
      // alors que product_attributes impose l'identité
      // (kind, group_key, attribute_key). On ne fusionne et on ne jette donc
      // aucune donnée fournisseur : les collisions sont projetées avec un
      // suffixe ordinal déterministe (~2, ~3…). Le même snapshot rejoué produit
      // exactement les mêmes clés DB.
      const attributeKey = projectedAttributeKey('SPECIFICATION', groupKey, baseAttributeKey, seenTriplets);

      rows.push({
        kind: 'SPECIFICATION',
        group_key: groupKey,
        attribute_key: attributeKey,
        label: specLabel || baseAttributeKey,
        value_text: String(spec.value).trim(),
        unit: nonEmptyTrimmedStringOrNull(spec.unit),
        display_order: typeof spec.display_order === 'number' ? spec.display_order : index,
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
