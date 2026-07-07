/**
 * @komerce-arch
 * @role          catalog-normalized-product
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */

/**
 * KOMERCE — Format pivot NormalizedSupplierProduct
 * ═══════════════════════════════════════════════════════════════════
 *
 * Tous les connecteurs (CSV, manuel, API) doivent retourner des
 * objets dans ce format. Le scanner ne connaît AUCUNE spécificité
 * fournisseur — il consomme uniquement ce format pivot.
 *
 * Architecture cible :
 *   ┌─────────┐   ┌──────────┐   ┌──────────────────────┐
 *   │   CSV   │──▶│ csv      │──▶│                      │
 *   ├─────────┤   ├──────────┤   │   NormalizedSupplier │
 *   │ Manual  │──▶│ manual   │──▶│        Product[]     │──▶ scanner
 *   ├─────────┤   ├──────────┤   │                      │
 *   │   API   │──▶│ api/noon │──▶│                      │
 *   └─────────┘   └──────────┘   └──────────────────────┘
 *
 * @typedef {Object} NormalizedSupplierProduct
 * @property {string}  supplier_name        Identifiant fournisseur (ex: 'Noon', 'Manual', 'Dragon Mart')
 * @property {string} [supplier_product_id] Référence interne fournisseur (SKU, ASIN…)
 * @property {string}  product_name         Nom du produit
 * @property {string} [supplier_category]   Catégorie selon le fournisseur (texte libre)
 * @property {number} [purchase_price]      Prix d'achat
 * @property {string} [currency]            'AED' | 'EUR' | 'USD' | 'KMF'
 * @property {string} [image_url]
 * @property {string} [product_url]
 * @property {string} [description]
 * @property {number} [stock_available]
 * @property {number} [min_order_qty]
 * @property {number} [supplier_delay_days]
 * @property {number} [weight_kg]           Poids fourni si disponible
 * @property {Object} [dimensions]          { l_cm, w_cm, h_cm }
 * @property {Object} [raw_payload]         Payload brut original (pour debug / re-traitement)
 */

'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schemaV1 = require('../../schemas/catalog/normalized-supplier-product.v1.schema.json');

// ING-1 — le contrat pivot est désormais un schéma versionné compilé au
// require, pas une convention JSDoc vérifiée à la main. Un connecteur qui
// contourne le schéma n'existe pas (doctrine ING-I1).
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schemaV1);

// Messages lisibles par champ + par règle violée. Le fallback générique
// couvre toute règle non listée ici (bornes, format...) — cf. doctrine ING-1 :
// « weight_kg hors bornes (0, 500] », traduit depuis le schéma, pas en dur.
const FIELD_MESSAGES = {
  product_name:  { required: 'product_name requis', minLength: 'product_name requis' },
  supplier_name: { required: 'supplier_name requis' },
  currency:      { required: 'currency requise', enum: 'currency doit être AED, EUR, USD ou KMF' },
  purchase_price: {
    type: 'purchase_price doit être un nombre positif',
    exclusiveMinimum: 'purchase_price doit être un nombre positif',
  },
  weight_kg: {
    type: 'weight_kg doit être un nombre positif',
    exclusiveMinimum: 'weight_kg doit être un nombre positif',
  },
  raw_payload: { required: 'raw_payload requis (ING-I3 : le brut ne se perd jamais)' },
};

function boundsPhrase(err) {
  const schema = err.parentSchema || {};
  const lo = schema.exclusiveMinimum != null ? `(${schema.exclusiveMinimum}` : (schema.minimum != null ? `[${schema.minimum}` : '(-∞');
  const hi = schema.maximum != null ? `${schema.maximum}]` : '∞)';
  return `${lo}, ${hi}`;
}

/**
 * Traduit une erreur ajv en message lisible pour l'admin (doctrine ING-1).
 * Ces messages remontent jusqu'à l'écran admin — ils ne doivent jamais
 * exposer le jargon JSON Schema brut.
 */
function humanizeError(err) {
  const field = err.keyword === 'required'
    ? err.params.missingProperty
    : (err.instancePath || '').replace(/^\//, '').split('/')[0] || '(objet)';

  const known = FIELD_MESSAGES[field]?.[err.keyword];
  if (known) return known;

  switch (err.keyword) {
    case 'required':
      return `${err.params.missingProperty} requis`;
    case 'additionalProperties':
      return `champ inconnu hors contrat : "${err.params.additionalProperty}"`;
    case 'enum':
      return `${field} doit être l'une de : ${err.params.allowedValues.join(', ')}`;
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return `${field} hors bornes ${boundsPhrase(err)}`;
    case 'minLength':
      return `${field} trop court (minimum ${err.params.limit} caractères)`;
    case 'maxLength':
      return `${field} trop long (maximum ${err.params.limit} caractères)`;
    case 'format':
      return `${field} format invalide (${err.params.format} attendu)`;
    case 'type':
      return `${field} doit être de type ${[].concat(err.schema).join('/')}`;
    default:
      return `${field} invalide (${err.keyword})`;
  }
}

/**
 * Valide qu'un objet est un NormalizedSupplierProduct conforme au contrat v1.
 * Utilisé par tous les connecteurs avant de retourner leurs résultats.
 *
 * @param {Object} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateNormalizedProduct(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['Objet invalide'] };
  }
  const ok = validateSchema(obj);
  if (ok) return { valid: true, errors: [] };
  const errors = (validateSchema.errors || []).map(humanizeError);
  return { valid: false, errors };
}

/**
 * Filtre une liste pour ne garder que les produits valides.
 * Retourne aussi les invalides séparément avec leurs erreurs.
 *
 * @param {Array<Object>} products
 * @returns {{ valid: Array, invalid: Array<{ product, errors }> }}
 */
function partitionValid(products) {
  const valid = [];
  const invalid = [];
  for (const p of products || []) {
    const v = validateNormalizedProduct(p);
    if (v.valid) valid.push(p);
    else invalid.push({ product: p, errors: v.errors });
  }
  return { valid, invalid };
}

module.exports = {
  validateNormalizedProduct,
  partitionValid,
};
