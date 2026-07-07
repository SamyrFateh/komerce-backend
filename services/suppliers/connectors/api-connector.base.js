/**
 * @komerce-arch
 * @role          api-connector-base
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/suppliers/normalized-product.js
 * @used-by       services/suppliers/connectors/noon-connector.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */

/**
 * KOMERCE — API Connector Base (interface abstraite)
 * ═══════════════════════════════════════════════════════════════════
 *
 * IMPORTANT — Ce fichier est une INTERFACE.
 * Il ne contient AUCUN appel HTTP, AUCUN endpoint, AUCUNE authentification.
 *
 * Pour intégrer un fournisseur API réel (Noon, Shein, Temu, etc.),
 * créer un fichier dédié qui hérite de cette base, par exemple :
 *   services/suppliers/connectors/noon-connector.js
 *
 * Et SEULEMENT lorsque tu disposes de :
 *   - documentation officielle de l'API fournisseur
 *   - credentials valides (clé API, OAuth, etc.)
 *   - format réel des réponses
 *   - règles de pagination
 *   - limites d'usage (rate limiting)
 *   - mapping catégories
 *
 * Tant que ces éléments ne sont pas réunis, le connecteur fournisseur
 * reste un placeholder qui retourne un message clair.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Contrat attendu d'un connecteur API héritant de cette base :
 *   - exposer fetchProducts(config) → Promise<{ products, invalid, total }>
 *   - lever une erreur claire si non configuré
 *   - ne JAMAIS hardcoder de credentials
 *   - lire credentials depuis process.env (jamais en dur)
 */

'use strict';

const { partitionValid } = require('../normalized-product');

/**
 * Configuration attendue pour un connecteur API supplier.
 *
 * @typedef {Object} SupplierApiConfig
 * @property {string}  supplier_name      ex: 'Noon', 'Shein'
 * @property {string} [base_url]          URL racine de l'API (à fournir à l'init)
 * @property {string} [auth_type]         'apikey' | 'bearer' | 'oauth' | 'none'
 * @property {string} [api_key_env]       Nom de la variable d'environnement contenant la clé
 * @property {Object} [extra_headers]     Headers additionnels
 * @property {Object} [pagination]        { type: 'cursor' | 'page' | 'offset', page_size: number }
 * @property {Object} [category_mapping]  { 'noon-cat-id': 'komerce-cat-key', ... }
 */

/**
 * Classe de base pour un connecteur API fournisseur.
 *
 * Les sous-classes doivent surcharger fetchProducts().
 * Cette classe fournit les helpers génériques (config, headers, validation).
 */
class ApiConnectorBase {
  /**
   * @param {SupplierApiConfig} config
   */
  constructor(config = {}) {
    this.config = {
      supplier_name: config.supplier_name || 'Unknown API supplier',
      base_url: config.base_url || null,
      auth_type: config.auth_type || 'none',
      api_key_env: config.api_key_env || null,
      extra_headers: config.extra_headers || {},
      pagination: config.pagination || null,
      category_mapping: config.category_mapping || {},
    };
  }

  /**
   * Vérifie que la configuration minimale est présente.
   * À appeler en début de fetchProducts() avant tout call HTTP.
   *
   * @throws {Error} si non configuré
   */
  ensureConfigured() {
    const { supplier_name, base_url, auth_type, api_key_env } = this.config;
    if (!base_url) {
      throw new Error(
        `[${supplier_name}] API non configurée : base_url manquante. ` +
        `Voir doc fournisseur avant activation.`
      );
    }
    if (auth_type !== 'none' && !api_key_env) {
      throw new Error(
        `[${supplier_name}] API non configurée : api_key_env manquante. ` +
        `Définir le nom de la variable d'environnement avant activation.`
      );
    }
    if (api_key_env && !process.env[api_key_env]) {
      throw new Error(
        `[${supplier_name}] API non configurée : variable d'environnement "${api_key_env}" non définie.`
      );
    }
  }

  /**
   * Construit les headers HTTP à envoyer.
   * Ne JAMAIS hardcoder de credentials ici — tout vient de process.env.
   *
   * @returns {Object} headers
   */
  buildHeaders() {
    const { auth_type, api_key_env, extra_headers } = this.config;
    const headers = { 'Accept': 'application/json', ...extra_headers };
    if (auth_type === 'apikey' && api_key_env) {
      headers['X-API-Key'] = process.env[api_key_env];
    } else if (auth_type === 'bearer' && api_key_env) {
      headers['Authorization'] = 'Bearer ' + process.env[api_key_env];
    }
    // 'oauth' à implémenter dans la sous-classe (flow spécifique)
    // 'none' : pas de header auth
    return headers;
  }

  /**
   * Méthode à surcharger par chaque sous-classe.
   *
   * Doit retourner :
   *   { products: NormalizedSupplierProduct[], invalid: [], total: number }
   *
   * @abstract
   * @param {Object} options
   * @returns {Promise<{ products, invalid, total }>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetchProducts(options = {}) {
    throw new Error(
      `[${this.config.supplier_name}] fetchProducts() non implémenté. ` +
      `Le connecteur API fournisseur n'est pas activé. ` +
      `Pour l'activer : (1) obtenir la doc et les credentials, ` +
      `(2) créer une sous-classe qui surcharge fetchProducts(), ` +
      `(3) câbler le routeur vers le bon connecteur.`
    );
  }

  /**
   * Helper : valide une liste de produits normalisés et retourne le résultat
   * au format attendu par les routes.
   *
   * @param {Array<NormalizedSupplierProduct>} products
   * @returns {{ products, invalid, total }}
   */
  finalize(products) {
    const { valid, invalid } = partitionValid(products || []);
    return {
      products: valid,
      invalid,
      total: (products || []).length,
    };
  }
}

module.exports = {
  ApiConnectorBase,
};
