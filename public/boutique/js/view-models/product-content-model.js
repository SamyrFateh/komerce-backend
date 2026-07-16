/**
 * @komerce-arch
 * @role          product-enriched-content-model
 * @domain        catalog
 * @layer         view-model
 * @criticality   medium
 * @inputs        public_product_detail_v1.content
 * @outputs       product_content_view_model
 * @depends       none
 * @used-by       b-modal-mobile-product.js, b-modal-desktop-product.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile, desktop, product-content
 * @version       2026-07 — Lot Content, commit 4 (rendu partagé)
 *
 * Une intelligence produit, deux compositions responsive. Ce module décide
 * ORDRE, FILTRAGE, REGROUPEMENT et "faut-il un Lire la suite" à partir de
 * `content` — jamais de DOM, jamais de breakpoint, jamais un pixel. Le
 * mobile (b-modal-mobile-product.js) et le desktop (b-modal-desktop-product.js)
 * consomment cette même sortie et ne font que la composer visuellement.
 *
 * `content` est une clé optionnelle du contrat (produit non promu / ancien
 * produit) : buildProductContentViewModel(undefined) et
 * buildProductContentViewModel(null) sont des entrées valides et renvoient
 * un view-model vide (hasEnrichedContent: false), jamais une exception.
 */

'use strict';

/** Libellés éditoriaux partagés — une seule source de copy pour mobile et desktop. */
export const CONTENT_LABELS = Object.freeze({
  highlights: 'Points forts',
  specifications: 'Caractéristiques',
  materials: 'Composition',
  care: 'Entretien',
  warnings: 'À savoir',
});

// Au-delà de ce nombre de caractères, un texte long propose "Lire la suite"
// plutôt que de s'afficher intégralement d'emblée. Seuil unique partagé —
// mobile et desktop décident "faut-il replier" de la même façon.
const READ_MORE_CHAR_THRESHOLD = 220;

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.trim());
}

function normalizeDisplayOrder(value) {
  return Number.isFinite(value) ? value : 0;
}

/** highlights : filtre les entrées sans label exploitable. Aucune limite de tri — l'ordre fournisseur/promotion fait foi. */
function buildHighlights(highlights) {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .filter((item) => item && normalizeText(item.label))
    .map((item) => ({ key: item.key, label: normalizeText(item.label) }));
}

/**
 * specifications : regroupées par `group` (une spec sans groupe rejoint un
 * groupe implicite `null`, rendu sans en-tête de sous-groupe), triées par
 * display_order à l'intérieur d'un groupe. L'ordre des groupes suit leur
 * première apparition dans le tableau source (déjà ordonné côté backend) —
 * jamais un tri alphabétique qui romprait l'intention du promoteur catalogue.
 */
function buildSpecificationGroups(specifications) {
  if (!Array.isArray(specifications)) return [];

  const order = [];
  const byGroup = new Map();

  specifications.forEach((spec) => {
    if (!spec || !normalizeText(spec.label) || !normalizeText(spec.value)) return;
    const groupKey = spec.group ? normalizeText(spec.group) : null;
    const mapKey = groupKey === null ? '\u0000__ungrouped__' : groupKey;
    if (!byGroup.has(mapKey)) {
      byGroup.set(mapKey, { group: groupKey, items: [] });
      order.push(mapKey);
    }
    byGroup.get(mapKey).items.push({
      key: spec.key,
      label: normalizeText(spec.label),
      value: normalizeText(spec.value),
      unit: spec.unit ? normalizeText(spec.unit) : null,
      display_order: normalizeDisplayOrder(spec.display_order),
    });
  });

  return order
    .map((mapKey) => byGroup.get(mapKey))
    .map((entry) => ({
      group: entry.group,
      items: entry.items
        .slice()
        .sort((a, b) => a.display_order - b.display_order),
    }));
}

/** Une section n'a de sens que si son type porte réellement du contenu. */
function isMeaningfulSection(section) {
  if (!section || !normalizeText(section.title)) return false;
  if (section.type === 'TEXT') return Boolean(normalizeText(section.text));
  if (section.type === 'BULLETS') {
    return Array.isArray(section.items) && normalizeStringList(section.items).length > 0;
  }
  if (section.type === 'KEY_VALUE') {
    return (
      Array.isArray(section.entries) &&
      section.entries.some((entry) => entry && normalizeText(entry.label) && normalizeText(entry.value))
    );
  }
  return false;
}

/** sections éditoriales complémentaires (le backend a déjà retiré materials/care/warnings de ce tableau). */
function buildSections(sections) {
  if (!Array.isArray(sections)) return [];

  return sections
    .filter(isMeaningfulSection)
    .map((section) => ({
      key: section.key,
      title: normalizeText(section.title),
      type: section.type,
      text: section.type === 'TEXT' ? normalizeText(section.text) : null,
      items: section.type === 'BULLETS' ? normalizeStringList(section.items) : [],
      entries:
        section.type === 'KEY_VALUE'
          ? section.entries
              .filter((entry) => entry && normalizeText(entry.label) && normalizeText(entry.value))
              .map((entry) => ({ label: normalizeText(entry.label), value: normalizeText(entry.value) }))
          : [],
      display_order: normalizeDisplayOrder(section.display_order),
      offer_read_more: section.type === 'TEXT' && normalizeText(section.text).length > READ_MORE_CHAR_THRESHOLD,
    }))
    .sort((a, b) => a.display_order - b.display_order);
}

/**
 * Décide si un texte libre (description longue, section TEXT) doit
 * proposer "Lire la suite" — seulement s'il y a réellement du contenu
 * masqué par le clamp visuel, jamais un bouton systématique.
 */
export function shouldOfferReadMore(text) {
  return normalizeText(text).length > READ_MORE_CHAR_THRESHOLD;
}

/**
 * Construit le view-model partagé consommé tel quel par mobile et desktop.
 * Entrée facultative (produit pauvre / non promu) → sortie toujours valide,
 * jamais d'exception, `hasEnrichedContent: false` pour un produit sans
 * matière enrichie (le mobile garde alors sa description seule, MDM-9).
 */
export function buildProductContentViewModel(content) {
  const safe = content && typeof content === 'object' ? content : {};

  const brand = normalizeText(safe.brand) || null;
  const shortDescription = normalizeText(safe.short_description) || null;
  const highlights = buildHighlights(safe.highlights);
  const specificationGroups = buildSpecificationGroups(safe.specifications);
  const sections = buildSections(safe.sections);
  const materials = normalizeStringList(safe.materials);
  const care = normalizeStringList(safe.care);
  const warnings = normalizeStringList(safe.warnings);
  const provenance = safe.provenance && typeof safe.provenance === 'object' ? safe.provenance : null;

  const hasEnrichedContent = Boolean(
    brand ||
      shortDescription ||
      highlights.length ||
      specificationGroups.length ||
      sections.length ||
      materials.length ||
      care.length ||
      warnings.length
  );

  return {
    brand,
    shortDescription,
    highlights,
    specificationGroups,
    sections,
    materials,
    care,
    warnings,
    provenance,
    hasEnrichedContent,
  };
}
