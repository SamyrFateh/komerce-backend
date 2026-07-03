/**
 * @komerce-arch
 * @role          catalog-field-overrides
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, field_name, field_value, reason, admin_user
 * @outputs       override_row, applied_product_row
 * @depends       db.js, services/catalog-enrichment.js
 * @used-by       services/product-admin-service.js, services/catalog-approval.js
 * @db-read       catalog_field_overrides, products
 * @db-write      catalog_field_overrides, products
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-07
 */

'use strict';

/**
 * KOMERCE — Overrides tracés, module partagé (K-4, DOCTRINE_CATALOGUE.md §5, §7)
 * ═══════════════════════════════════════════════════════════════════════════
 * §5 — une retouche manuelle sur une fiche générée n'édite JAMAIS la fiche
 *      directement : elle se pose en override tracé (catalog_field_overrides),
 *      réappliqué après chaque re-raffinage (catalog-enrichment.js§loadOverrides).
 * §7 — "Ne jamais éditer une fiche sans override tracé."
 *
 * Whitelist PARTAGÉE avec l'enrichissement IA (OVERRIDABLE_FIELDS,
 * catalog-enrichment.js) : un seul contrat "champs publiés retouchables",
 * côté IA et côté admin — jamais deux vérités qui divergent.
 *
 * Corollaire doctrine §5 : "le CRUD admin existant devient l'éditeur
 * d'overrides — même formulaire, sémantique nouvelle." C'est ce module qui
 * porte cette sémantique ; product-admin-service.js et catalog-approval.js
 * l'appellent tous les deux plutôt que de faire chacun leur propre UPDATE.
 */

const { OVERRIDABLE_FIELDS } = require('./catalog-enrichment');

/**
 * Un produit est-il "issu du pipeline" (connecteur ou IA) ? Seuls ceux-là
 * passent par le régime override — §5 ne s'applique qu'à ce qui est
 * régénérable depuis une source. Le contenu manuel legacy (content_source
 * NULL ou 'manual', saisi avant K-1) reste en édition directe : il n'y a
 * pas de pipeline à rejouer, donc pas de risque d'écrasement (doctrine
 * §7, note d'audit 2026-07-03 : "défendable pour le legacy manual").
 */
function isPipelineSourced(product) {
  return !!product && (product.content_source === 'connector_raw' || product.content_source === 'ai_enriched');
}

/**
 * Pose ou remplace un override pour UN champ, l'applique immédiatement sur
 * la colonne réelle, et retourne les deux lignes. UPSERT sur
 * (product_id, field_name) — dernier override gagne (contrainte 098).
 *
 * Défense en profondeur : le nom de colonne interpolé dans l'UPDATE n'est
 * JAMAIS pris tel quel — il doit d'abord matcher un littéral de
 * OVERRIDABLE_FIELDS. Un field_name vérolé est rejeté avant toute requête.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} q
 * @param {{productId:string, fieldName:string, fieldValue:string, reason?:string, setBy?:string}} params
 * @returns {Promise<{override:object, product:object}>}
 */
async function upsertOverride(q, { productId, fieldName, fieldValue, reason = null, setBy = null }) {
  if (!OVERRIDABLE_FIELDS.includes(fieldName)) {
    const err = new Error(`Champ non retouchable par override: "${fieldName}"`);
    err.code = 'OVERRIDE_FIELD_NOT_ALLOWED';
    throw err;
  }

  const { rows: [override] } = await q.query(
    `INSERT INTO catalog_field_overrides (product_id, field_name, field_value, reason, set_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, field_name)
     DO UPDATE SET field_value = EXCLUDED.field_value,
                    reason      = EXCLUDED.reason,
                    set_by      = EXCLUDED.set_by,
                    updated_at  = NOW()
     RETURNING *`,
    [productId, fieldName, String(fieldValue), reason, setBy]
  );

  // Colonne interpolée : whitelist déjà vérifiée ci-dessus, jamais le
  // field_name brut de la requête client.
  const safeColumn = OVERRIDABLE_FIELDS.find((f) => f === fieldName);
  const { rows: [product] } = await q.query(
    `UPDATE products SET ${safeColumn} = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [fieldValue, productId]
  );

  return { override, product };
}

/**
 * Pose plusieurs overrides d'un coup (écran K-4 : correction multi-champs
 * avant approbation). S'arrête au premier champ invalide — tout ou rien
 * côté validation, mais chaque upsert reste une requête indépendante
 * (pas de transaction explicite : cohérent avec le reste du service admin,
 * qui n'ouvre pas de txn pour de simples UPDATE mono-ligne).
 *
 * @param {import('pg').Pool|import('pg').PoolClient} q
 * @param {string} productId
 * @param {Object<string,string>} fields  ex: { name: "...", description: "..." }
 * @param {{reason?:string, setBy?:string}} meta
 * @returns {Promise<{overridden:string[], product:object}>}
 */
async function upsertOverrides(q, productId, fields, { reason = null, setBy = null } = {}) {
  const entries = Object.entries(fields || {});
  const unknown = entries.map(([f]) => f).filter((f) => !OVERRIDABLE_FIELDS.includes(f));
  if (unknown.length) {
    const err = new Error(`Champs non retouchables par override: ${unknown.join(', ')}`);
    err.code = 'OVERRIDE_FIELD_NOT_ALLOWED';
    throw err;
  }

  let product = null;
  const overridden = [];
  for (const [fieldName, fieldValue] of entries) {
    const result = await upsertOverride(q, { productId, fieldName, fieldValue, reason, setBy });
    product = result.product;
    overridden.push(fieldName);
  }
  return { overridden, product };
}

module.exports = { OVERRIDABLE_FIELDS, isPipelineSourced, upsertOverride, upsertOverrides };
