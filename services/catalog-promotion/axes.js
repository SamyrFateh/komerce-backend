/**
 * @komerce-arch
 * @role          catalog-promotion-axes-mapping
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        normalized_source_contract.option_axes[]
 * @outputs       product_variants_descriptive_rows
 * @depends       @none
 * @used-by       services/catalog-promotion.js (Lot 6)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      PDC-8 §OPTION AXES, §DOCTRINE ZÉRO HEURISTIQUE
 * @impact-areas  catalog
 * @version       2026-07
 */

/**
 * KOMERCE — PDC-8 Lot 3 : projection option_axes[] V2 → product_variants
 * ═══════════════════════════════════════════════════════════════════
 *
 * Fonction pure, aucune écriture DB ici (l'upsert transactionnel réel
 * appartient au Lot 6 / services/catalog-promotion.js).
 *
 * Règle stricte (PDC-8) : une ligne descriptive par couple axis.key +
 * valeur. JAMAIS de produit cartésien (Rouge×M, Rouge×L, Noir×M, Noir×L...).
 * product_variants décrit les axes ; product_skus (Lot 4) décrit les unités
 * vendables réelles — les deux ne se mélangent jamais ici.
 *
 * display_name : préservé au niveau de l'axe (PDC-8 Lot 3, migration 107)
 * si la source le fournit. Jamais fabriqué — null sinon.
 *
 * display_order : préservé au niveau de la VALEUR si la source le porte
 * réellement (option_axes[].display_order est un ordre d'AXE, pas de
 * valeur — les schémas V2 ne portent pas d'ordre par valeur individuelle
 * aujourd'hui ; on ne l'invente donc pas ici : display_order reste null
 * pour chaque ligne tant qu'aucune source ne fournit un ordre par valeur).
 */

'use strict';

/**
 * @param {Array<{key: string, display_name?: string|null, values: string[], display_order?: number|null}>} optionAxes
 * @returns {Array<{variant_type: string, variant_value: string, display_name: string|null, display_order: null}>}
 *
 * Dédoublonne par (variant_type, variant_value) au sein de l'appel — la
 * persistance (Lot 6) s'appuie en plus sur la contrainte UNIQUE DB réelle
 * (product_id, variant_type, variant_value) pour l'idempotence inter-appels
 * (re-promotion).
 */
function mapOptionAxesToDescriptiveRows(optionAxes) {
  if (optionAxes === null || optionAxes === undefined) return [];
  if (!Array.isArray(optionAxes)) {
    const e = new Error('option_axes doit être un tableau ou null');
    e.status = 422;
    throw e;
  }

  const seen = new Set();
  const rows = [];

  for (const axis of optionAxes) {
    if (!axis || typeof axis.key !== 'string' || axis.key.trim().length === 0) {
      const e = new Error('option_axes[].key requis et non vide');
      e.status = 422;
      throw e;
    }
    const variantType = axis.key.trim();
    const displayName = (typeof axis.display_name === 'string' && axis.display_name.trim().length > 0)
      ? axis.display_name.trim()
      : null;

    if (!Array.isArray(axis.values) || axis.values.length === 0) {
      const e = new Error(`option_axes["${variantType}"].values doit être un tableau non vide`);
      e.status = 422;
      throw e;
    }

    for (const rawValue of axis.values) {
      if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
        const e = new Error(`option_axes["${variantType}"] contient une valeur vide ou invalide`);
        e.status = 422;
        throw e;
      }
      const variantValue = rawValue.trim();
      const dedupeKey = `${variantType}\u0000${variantValue}`;
      if (seen.has(dedupeKey)) continue; // valeur dupliquée dans la source — ignorée, jamais recréée
      seen.add(dedupeKey);

      rows.push({
        variant_type: variantType,
        variant_value: variantValue,
        display_name: displayName,
        display_order: null,
      });
    }
  }

  return rows;
}

module.exports = {
  mapOptionAxesToDescriptiveRows,
};
