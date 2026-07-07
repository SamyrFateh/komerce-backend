/**
 * @komerce-arch
 * @role          manual-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */

/**
 * KOMERCE — Manual Connector
 * ═══════════════════════════════════════════════════════════════════
 *
 * Connecteur fonctionnel : transforme une saisie manuelle (formulaire admin)
 * en NormalizedSupplierProduct[].
 *
 * L'admin saisit un ou plusieurs produits via le formulaire de la vue
 * Scanner. Le connecteur :
 *   - normalise les types (parsing STRICT — ING-I2, ING-2 : une valeur
 *     fournie mais illisible ne devient jamais null en silence)
 *   - regroupe et re-valide les dimensions champ par champ
 *   - valide la structure (via partitionValid, contrat v1)
 *
 * ING-2 : plus de défaut inventé (`currency || 'AED'`). Une devise absente
 * n'est plus devinée — le contrat v1 la rejette (`currency requise`).
 */

'use strict';

const { partitionValid } = require('../normalized-product');
const { parseStrictNumber, parseStrictInteger, parsePositiveDimension } = require('./_connector-utils');

/**
 * Normalise un item de formulaire en NormalizedSupplierProduct.
 * En cas de valeur illisible (ex: purchase_price:"beaucoup"), l'item porte
 * une propriété non-énumérable `_connectorErrors` — fetchProducts() la
 * détecte et route l'item directement en `invalid`, sans passer par le
 * contrat (ING-I2 : la donnée n'est même pas structurellement exploitable).
 *
 * @param {Object} item   — payload form (ex: { product_name, purchase_price, weight_kg, dim_l_cm, ... })
 * @param {string} supplierName
 * @returns {NormalizedSupplierProduct}
 */
function normalizeFormItem(item, supplierName) {
  const errors = [];

  function numField(field, label) {
    const r = parseStrictNumber(item[field]);
    if (r.invalid) errors.push(`${label} invalide : "${item[field]}"`);
    return r.value != null ? r.value : null;
  }
  function intField(field, label) {
    const r = parseStrictInteger(item[field]);
    if (r.invalid) errors.push(`${label} invalide : "${item[field]}"`);
    return r.value != null ? r.value : null;
  }

  const purchasePrice = numField('purchase_price', 'purchase_price');
  const stockAvailable = intField('stock_available', 'stock_available');
  const minOrderQty = intField('min_order_qty', 'min_order_qty');
  const supplierDelayDays = intField('supplier_delay_days', 'supplier_delay_days');
  const weightKg = numField('weight_kg', 'weight_kg');

  // Dimensions : re-validées champ par champ, qu'elles arrivent en dim_l_cm/
  // dim_w_cm/dim_h_cm séparés OU déjà groupées dans un objet `dimensions`
  // (ING-2 : plus d'objet libre accepté tel quel — chaque valeur est
  // parsée strictement, une valeur illisible rejette la ligne).
  const dimSource = item.dimensions && typeof item.dimensions === 'object'
    ? item.dimensions
    : { l_cm: item.dim_l_cm, w_cm: item.dim_w_cm, h_cm: item.dim_h_cm };

  const dimensions = {};
  for (const key of ['l_cm', 'w_cm', 'h_cm']) {
    const r = parsePositiveDimension(dimSource[key]);
    if (r.invalid) errors.push(`dimensions.${key} invalide : "${dimSource[key]}"`);
    else if (r.value !== undefined) dimensions[key] = r.value;
  }
  const finalDimensions = Object.keys(dimensions).length ? dimensions : null;

  const currency = item.currency ? String(item.currency).toUpperCase() : null;

  const obj = {
    supplier_name: supplierName,
    supplier_product_id: item.supplier_product_id || null,
    product_name: (item.product_name || '').trim(),
    supplier_category: item.supplier_category || null,
    purchase_price: purchasePrice,
    currency,
    image_url: item.image_url || null,
    product_url: item.product_url || null,
    description: item.description || null,
    stock_available: stockAvailable,
    min_order_qty: minOrderQty,
    supplier_delay_days: supplierDelayDays,
    weight_kg: weightKg,
    dimensions: finalDimensions,
    raw_payload: { ...item },
  };

  if (errors.length) {
    Object.defineProperty(obj, '_connectorErrors', {
      value: errors,
      enumerable: false,
    });
  }

  return obj;
}

// ═══════════════════════════════════════════════════════════════════════
// API CONNECTEUR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Transforme une liste d'items du formulaire en NormalizedSupplierProduct[].
 *
 * @param {Object} input
 * @param {string} input.supplier_name
 * @param {Array<Object>} input.items   — items du formulaire
 *
 * @returns {{ products, invalid, total }}
 */
function fetchProducts(input) {
  const supplierName = (input?.supplier_name || '').trim();
  if (!supplierName) throw new Error('supplier_name requis');
  if (!Array.isArray(input.items) || !input.items.length) {
    throw new Error('items requis (tableau non vide)');
  }
  const normalized = input.items.map(it => normalizeFormItem(it, supplierName));

  // ING-2 : les items structurellement illisibles (parsing strict échoué)
  // sont écartés AVANT le contrat v1 — inutile de leur faire subir une
  // validation de schéma sur des champs qu'on sait déjà invalides.
  const connectorInvalid = [];
  const toValidate = [];
  for (const n of normalized) {
    if (n._connectorErrors && n._connectorErrors.length) {
      connectorInvalid.push({ product: { ...n }, errors: n._connectorErrors });
    } else {
      toValidate.push(n);
    }
  }

  const { valid, invalid: schemaInvalid } = partitionValid(toValidate);
  return {
    products: valid,
    invalid: [...connectorInvalid, ...schemaInvalid],
    total: normalized.length,
  };
}

module.exports = {
  fetchProducts,
  normalizeFormItem,
};
