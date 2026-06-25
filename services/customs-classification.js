/**
 * @komerce-arch
 * @role          customs-classification
 * @domain        douane
 * @layer         service
 * @criticality   high
 * @inputs        product_category_key (text), db_client
 * @outputs       frozen_classification_snapshot
 * @depends       db.js
 * @used-by       routes/orders/create.js, services/shared-cart-engine.js, routes/admin/system.js
 * @db-read       customs_categories
 * @db-write      (none)
 * @db-txn        read_within_caller_transaction
 * @doctrine      douane_declaration_pivot
 * @impact-areas  orders, douane, marge
 * @version       2026-06
 */

'use strict';

/**
 * customs-classification.js
 *
 * Résout et fige la classification douanière d'un produit au moment de la
 * création d'une order_item. Résolution une seule fois, immuable ensuite —
 * exactement comme price_kmf.
 *
 * Doctrine : DOUANE_DECLARATION_PIVOT.md — "Komerce déclare vrai."
 * On ne calcule rien, on ne prédit rien, on ne minimise rien.
 * Ce service résout honnêtement la catégorie du produit et la fige.
 *
 * Comportement si le produit n'a pas de catégorie ou si la catégorie
 * ne matche aucune customs_categories.key :
 *   → repli sur 'default' + classification_defaulted = true
 *   → jamais bloquant, jamais null (la déclaration doit toujours passer)
 *
 * Invariant I-DOUANE-1 : tous les sites d'INSERT order_items appellent
 * cette fonction. Sans ça, la classification manque sur la ligne et
 * la déclaration par colis est aveugle.
 * Invariant I-DOUANE-6 : pure résolution de nomenclature — lecture
 * customs_categories et retour du snapshot. Aucun calcul de droit,
 * aucune prédiction de taux, aucune logique d'influence sur le résultat.
 *
 * Exports :
 *   resolveFrozenClassification(client, productCategory)
 *     → { customs_category_key, sh_code, douane_pct, tva_pct, taxe_add_pct, classification_defaulted }
 */

const DEFAULT_KEY = 'default';

/**
 * Résout la classification douanière d'un produit et retourne le snapshot
 * à figer sur la ligne order_item.
 *
 * @param {import('pg').PoolClient} client  — client PG dans la transaction appelante
 * @param {string|null|undefined} productCategory  — valeur de products.category
 * @returns {Promise<{
 *   customs_category_key: string,
 *   sh_code: string|null,
 *   douane_pct: number,
 *   tva_pct: number,
 *   taxe_add_pct: number,
 *   classification_defaulted: boolean
 * }>}
 */
async function resolveFrozenClassification(client, productCategory) {
  // Étape 1 : résolution sur la catégorie du produit
  if (productCategory) {
    const { rows } = await client.query(
      `SELECT key, sh_code, douane_pct, tva_pct, taxe_add_pct
         FROM customs_categories
        WHERE key = $1 AND is_active = TRUE
        LIMIT 1`,
      [productCategory]
    );

    if (rows.length > 0) {
      const cat = rows[0];
      return {
        customs_category_key:    cat.key,
        sh_code:                 cat.sh_code    ?? null,
        douane_pct:              Number(cat.douane_pct),
        tva_pct:                 Number(cat.tva_pct),
        taxe_add_pct:            Number(cat.taxe_add_pct),
        classification_defaulted: false,
      };
    }
  }

  // Étape 2 : repli sur 'default' — jamais bloquant
  // classification_defaulted = true signale la liste de travail pour aligner
  // les catégories produit à terme.
  const { rows: defaultRows } = await client.query(
    `SELECT key, sh_code, douane_pct, tva_pct, taxe_add_pct
       FROM customs_categories
      WHERE key = $1 AND is_active = TRUE
      LIMIT 1`,
    [DEFAULT_KEY]
  );

  if (defaultRows.length > 0) {
    const cat = defaultRows[0];
    return {
      customs_category_key:    cat.key,
      sh_code:                 cat.sh_code    ?? null,
      douane_pct:              Number(cat.douane_pct),
      tva_pct:                 Number(cat.tva_pct),
      taxe_add_pct:            Number(cat.taxe_add_pct),
      classification_defaulted: true,
    };
  }

  // Étape 3 : pas de catégorie 'default' non plus — repli zéro, toujours non-bloquant.
  // Situation de setup incomplet (base vide / is_active = false sur tout).
  // On logge pour alerte mais on ne bloque jamais le flux.
  console.warn(
    '[customs-classification] Aucune customs_categories "default" active trouvée.',
    'Vérifier que la catégorie de repli existe et est active.',
    { productCategory }
  );

  return {
    customs_category_key:    null,
    sh_code:                 null,
    douane_pct:              0,
    tva_pct:                 0,
    taxe_add_pct:            0,
    classification_defaulted: true,
  };
}

module.exports = { resolveFrozenClassification };
