/**
 * @komerce-arch
 * @role          catalog-promotion-sku-media-linking
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sellable_units_resolved (sku_id + media_refs), catalog_media_by_source_id
 * @outputs       sku_media_link_plan
 * @depends       @none
 * @used-by       services/catalog-promotion.js (Lot 6)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      PDC-8 §RELATION SKU ↔ MEDIA, §DOCTRINE ZÉRO HEURISTIQUE
 * @impact-areas  catalog
 * @version       2026-07
 */

/**
 * KOMERCE — PDC-8 Lot 5 : couture SKU ↔ Media par références explicites
 * ═══════════════════════════════════════════════════════════════════
 *
 * Fonction pure : ne touche jamais la DB. Résout sellable_units[].media_refs
 * (identités supplier_media_id) vers les media_id canoniques déjà promus
 * (Lot 2 / Lot 6), et produit un plan d'association que Lot 6 exécutera.
 *
 * Règle centrale (PDC-8 §RELATION SKU ↔ MEDIA) : les références explicites
 * gagnent TOUJOURS. Cette fonction ne fait JAMAIS de matching par
 * option_values — ce matching heuristique reste dans
 * services/catalog-product-detail.js comme fallback legacy pour les
 * produits sans media_refs, non touché ici.
 *
 * Un media_ref qui ne correspond à aucun média canonique connu est une
 * incohérence de promotion (le média référencé aurait dû être promu avant
 * cette étape) — rejeté explicitement, jamais ignoré silencieusement.
 */

'use strict';

/**
 * @param {Array<{sku_id: string, media_refs: string[]|null|undefined}>} sellableUnitsResolved
 *   Unités vendables déjà résolues à un sku_id réel (après création/mise à
 *   jour DB du Lot 4 — ceci est un maillon suivant, pas un remplacement).
 * @param {Map<string, string>} mediaBySourceId
 *   source_media_id -> media_id canonique, tel que renvoyé par l'upsert
 *   catalog_media (Lot 2/6) pour CE produit.
 *
 * @returns {Array<{sku_id: string, media_id: string}>} paires à associer,
 *   dédoublonnées.
 */
function resolveSkuMediaLinks(sellableUnitsResolved, mediaBySourceId) {
  if (!Array.isArray(sellableUnitsResolved)) {
    const e = new Error('sellableUnitsResolved doit être un tableau'); e.status = 422; throw e;
  }
  if (!(mediaBySourceId instanceof Map)) {
    const e = new Error('mediaBySourceId doit être une Map<source_media_id, media_id>'); e.status = 422; throw e;
  }

  const seenPairs = new Set();
  const links = [];

  for (const unit of sellableUnitsResolved) {
    if (!unit || typeof unit.sku_id !== 'string' || unit.sku_id.trim().length === 0) {
      const e = new Error('sellable_unit résolu sans sku_id'); e.status = 422; throw e;
    }
    if (!unit.media_refs || unit.media_refs.length === 0) continue; // pas de media_refs -> rien à faire ici, fallback legacy hors de ce module

    for (const ref of unit.media_refs) {
      const mediaId = mediaBySourceId.get(ref);
      if (!mediaId) {
        const e = new Error(`media_ref inconnu : "${ref}" ne correspond à aucun média canonique promu pour ce produit`);
        e.status = 422;
        throw e;
      }
      const pairKey = `${unit.sku_id}\u0000${mediaId}`;
      if (seenPairs.has(pairKey)) continue; // même paire référencée deux fois — pas de duplication
      seenPairs.add(pairKey);
      links.push({ sku_id: unit.sku_id, media_id: mediaId });
    }
  }

  return links;
}

module.exports = {
  resolveSkuMediaLinks,
};
