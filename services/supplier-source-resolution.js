/**
 * @komerce-arch
 * @role          supplier-source-resolution
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        product_id, supplier_order_identity.provider, product_suppliers
 * @outputs       resolved_supplier_source, eligibility_sql, removal_blockers
 * @depends       none
 * @used-by       services/purchasing-trigger-service.js, services/catalog-public-view.js, services/hub-procurement-dossier.js, services/purchasing-admin-service.js, scripts/recette/audit-sku-supplier-link.js
 * @db-read       product_suppliers, suppliers, product_skus, products, purchase_orders, purchase_lines
 * @db-write      none
 * @db-txn        caller_owned
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog, purchasing, sourcing
 * @version       2026-11-v1
 */
'use strict';

// Source unique du fournisseur d'achat : l'association produit ↔ fournisseur (product_suppliers) avec priorité.
// Le SKU ne désigne jamais un fournisseur : il donne le produit et la plateforme (supplier_order_identity.provider).
// Une seule définition d'« admissible » (SQL) et une seule fonction de résolution (JS) servent le Catalogue,
// le Sourcing, la création de ligne d'achat, le dossier Hub et les gardes de désactivation.

// eBay : connecteur conservé, mais interdit comme source de SKU en V1 (écriture ET résolution).
const FORBIDDEN_SKU_PROVIDERS = Object.freeze(['ebay']);

const SOURCE_STATUS = Object.freeze({
  RESOLVED: 'RESOLVED',
  UNRESOLVED: 'UNRESOLVED',
  AMBIGUOUS: 'AMBIGUOUS',
  FORBIDDEN_PROVIDER: 'FORBIDDEN_PROVIDER',
});

function isForbiddenSkuProvider(provider) {
  return FORBIDDEN_SKU_PROVIDERS.includes(String(provider || '').trim().toLowerCase());
}

function forbiddenProviderError(provider) {
  const err = new Error(`FORBIDDEN_SKU_PROVIDER: le provider ${provider} n'est pas autorisé comme source de SKU`);
  err.code = 'FORBIDDEN_SKU_PROVIDER';
  err.details = { provider };
  return err;
}

/** Refuse (throw) une identité dont le provider est interdit comme source de SKU. No-op si identité absente. */
function assertSkuProviderAllowed(identity) {
  const provider = identity && typeof identity === 'object' ? identity.provider : null;
  if (provider && isForbiddenSkuProvider(provider)) throw forbiddenProviderError(provider);
}

const FORBIDDEN_SQL_LIST = FORBIDDEN_SKU_PROVIDERS.map((p) => `'${p}'`).join(', ');

/**
 * Fragment « FROM … WHERE … » des associations ADMISSIBLES pour un produit (alias `ps`, `s`).
 * Admissible = association active non supprimée, fournisseur actif non supprimé du catalogue global
 * (owner_scope NULL) ou fiche système central Hub, plateforme du fournisseur = provider du SKU
 * (provider NULL : produit sans SKU exact),
 * provider non interdit. `excludeSql` retire un fournisseur/une association (simulation de désactivation).
 */
function eligibleSourceFromWhereSql({ productSql, providerSql = 'NULL', excludeSql = null }) {
  return `
    FROM product_suppliers ps
    JOIN suppliers s ON s.id = ps.supplier_id
   WHERE ps.product_id = ${productSql}
     AND ps.is_active = TRUE AND ps.deleted_at IS NULL
     AND s.is_active = TRUE AND s.deleted_at IS NULL
     AND (s.owner_scope IS NULL OR s.system_key = 'central_hub')
     AND ((${providerSql}) IS NULL OR lower(s.platform) = lower(${providerSql}))
     AND lower(COALESCE(${providerSql}, '')) NOT IN (${FORBIDDEN_SQL_LIST})
     ${excludeSql ? `AND NOT (${excludeSql})` : ''}`;
}

/** EXISTS(...) : le produit a au moins une source admissible pour ce provider. */
function hasEligibleSourceSql(args) {
  return `EXISTS (SELECT 1 ${eligibleSourceFromWhereSql(args)})`;
}

/** Garde SQL SKU : source SUPPLIER ⇒ une source admissible existe (alias de product_skus). */
function skuSourceResolvedSql(skuAlias) {
  return `(
    COALESCE(${skuAlias}.source, 'MANUAL') <> 'SUPPLIER'
    OR ${hasEligibleSourceSql({
      productSql: `${skuAlias}.product_id`,
      providerSql: `${skuAlias}.supplier_order_identity->>'provider'`,
    })}
  )`;
}

/**
 * Résolution unique. Retourne { status, mapping, candidates }.
 * Plus haute priorité (plus petit nombre) ; égalité en tête = AMBIGUOUS (refus, jamais de choix arbitraire).
 */
async function resolveSupplierSource(client, { productId, provider = null, assignedSupplierId = null }) {
  if (provider && isForbiddenSkuProvider(provider)) {
    return { status: SOURCE_STATUS.FORBIDDEN_PROVIDER, mapping: null, candidates: [] };
  }
  const { rows } = await client.query(`
    SELECT ps.*, s.name AS supplier_name, s.platform, s.auto_order, s.contact_phone,
           s.account_id, s.api_key_enc, s.api_secret_enc, s.lead_time_days
    ${eligibleSourceFromWhereSql({ productSql: '$1::uuid', providerSql: '$2::text' })}
    ORDER BY ps.priority ASC, ps.created_at ASC, ps.id ASC`, [productId, provider]);
  if (!rows.length) {
    if (!assignedSupplierId) return { status: SOURCE_STATUS.UNRESOLVED, mapping: null, candidates: [] };
    const { rows: [assigned] } = await client.query(`
      SELECT NULL::uuid AS id, s.id AS supplier_id,
             s.name AS supplier_name, s.platform, s.auto_order, s.system_key,
             s.contact_phone, s.account_id, s.api_key_enc, s.api_secret_enc, s.lead_time_days,
             NULL::numeric AS supplier_price_aed, NULL::text AS supplier_sku,
             1::integer AS min_order_qty, 1::integer AS priority
        FROM suppliers s
       WHERE s.id = $1::uuid AND s.is_active = TRUE AND s.deleted_at IS NULL
         AND (s.owner_scope IS NULL OR s.system_key = 'central_hub')
         AND ($2::text IS NULL OR lower(s.platform) = lower($2::text))
         AND lower(COALESCE($2::text, '')) NOT IN (${FORBIDDEN_SQL_LIST})
       LIMIT 1`, [assignedSupplierId, provider]);
    if (assigned) return { status: SOURCE_STATUS.RESOLVED, mapping: assigned, candidates: [assigned] };
    return { status: SOURCE_STATUS.UNRESOLVED, mapping: null, candidates: [] };
  }
  if (rows.length > 1 && rows[0].priority === rows[1].priority) {
    return { status: SOURCE_STATUS.AMBIGUOUS, mapping: null, candidates: rows };
  }
  return { status: SOURCE_STATUS.RESOLVED, mapping: rows[0], candidates: rows };
}

function conflict(message, code, details) {
  const err = new Error(message);
  err.status = 409;
  err.code = code;
  err.details = details;
  return err;
}

/**
 * Garde de désactivation d'un fournisseur (ou d'une association) : retourne les bloqueurs, ne modifie rien.
 *  - engagements : PO non terminées (hors hub_received/cancelled) et lignes ouvertes non annulées du fournisseur ;
 *  - produits vendables dont cette source est la dernière admissible.
 */
async function findSourceRemovalBlockers(client, { supplierId, productSupplierId = null, ignoreEngagements = false }) {
  const engagements = { purchase_orders: [], open_lines: [] };
  if (!ignoreEngagements) {
    const { rows: pos } = await client.query(
      `SELECT id, status FROM purchase_orders
        WHERE supplier_id = $1 AND status NOT IN ('hub_received', 'cancelled') ORDER BY created_at LIMIT 50`, [supplierId]);
    const { rows: lines } = await client.query(
      `SELECT id, order_item_id FROM purchase_lines
        WHERE supplier_id = $1 AND purchase_order_id IS NULL AND cancelled_at IS NULL
          AND ($2::uuid IS NULL OR product_supplier_id = $2) ORDER BY created_at LIMIT 50`, [supplierId, productSupplierId]);
    engagements.purchase_orders = pos;
    engagements.open_lines = lines;
  }
  const excludeSql = productSupplierId ? 'ps.id = $2::uuid' : 'ps.supplier_id = $1::uuid';
  const { rows: products } = await client.query(`
    SELECT DISTINCT p.id, p.name
      FROM product_suppliers dep
      JOIN suppliers ds ON ds.id = dep.supplier_id
      JOIN products p ON p.id = dep.product_id
      JOIN product_skus k ON k.product_id = p.id
     WHERE dep.supplier_id = $1 AND dep.is_active = TRUE AND dep.deleted_at IS NULL
       AND ($2::uuid IS NULL OR dep.id = $2)
       AND k.source = 'SUPPLIER' AND k.is_active = TRUE AND k.stock > 0
       AND lower(k.supplier_order_identity->>'provider') = lower(ds.platform)
       AND ${hasEligibleSourceSql({ productSql: 'k.product_id', providerSql: "k.supplier_order_identity->>'provider'" })}
       AND NOT ${hasEligibleSourceSql({
         productSql: 'k.product_id', providerSql: "k.supplier_order_identity->>'provider'", excludeSql,
       })}
     ORDER BY p.name LIMIT 100`, [supplierId, productSupplierId]);
  return { engagements, products };
}

async function assertSourceRemovable(client, args) {
  const blockers = await findSourceRemovalBlockers(client, args);
  const { engagements, products } = blockers;
  if (engagements.purchase_orders.length || engagements.open_lines.length) {
    throw conflict(
      'Désactivation refusée : des commandes fournisseur ou lignes d\'achat ouvertes existent. Terminez-les ou annulez-les d\'abord.',
      'SUPPLIER_HAS_OPEN_ENGAGEMENTS', { purchase_orders: engagements.purchase_orders, open_lines: engagements.open_lines });
  }
  if (products.length) {
    throw conflict(
      'Désactivation refusée : des produits vendables n\'auraient plus aucun fournisseur admissible. '
      + 'Ajoutez une autre source admissible ou retirez ces produits de la vente.',
      'SUPPLIER_SOLE_SOURCE_OF_SELLABLE_PRODUCTS', { products });
  }
  return blockers;
}

module.exports = {
  FORBIDDEN_SKU_PROVIDERS,
  SOURCE_STATUS,
  isForbiddenSkuProvider,
  assertSkuProviderAllowed,
  eligibleSourceFromWhereSql,
  hasEligibleSourceSql,
  skuSourceResolvedSql,
  resolveSupplierSource,
  findSourceRemovalBlockers,
  assertSourceRemovable,
};
