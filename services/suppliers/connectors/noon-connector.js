/**
 * @komerce-arch
 * @role          noon-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
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
 * KOMERCE — Noon API Connector (PLACEHOLDER DÉSACTIVÉ)
 * ═══════════════════════════════════════════════════════════════════
 *
 * ⚠️  ÉTAT : NON ACTIF — placeholder uniquement.
 *
 * Aucun endpoint Noon n'est inventé.
 * Aucun format JSON n'est inventé.
 * Aucune authentification n'est inventée.
 *
 * Ce fichier existe pour MARQUER la place d'un futur connecteur Noon
 * et donner un message d'erreur clair si quelqu'un essaie de l'activer.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *
 * POUR ACTIVER CE CONNECTEUR (futur) :
 *
 *   1. Obtenir l'accès officiel à l'API Noon (programme partenaires,
 *      API marchand, ou équivalent). À ce jour Komerce ne dispose pas
 *      de ces accès.
 *
 *   2. Récupérer la documentation officielle :
 *      - URL racine de l'API
 *      - schéma d'authentification (clé API, OAuth, signature HMAC, ...)
 *      - format des réponses (champs réels, pas inventés)
 *      - règles de pagination et limites de requêtes (rate limiting)
 *      - mapping des catégories Noon vers customs_categories Komerce
 *
 *   3. Définir les credentials en variables d'environnement (jamais en dur) :
 *      - NOON_API_KEY=xxx  (ou équivalent selon doc)
 *
 *   4. Implémenter fetchProducts() en remplacement du throw ci-dessous.
 *      Tester d'abord en mode dry-run avant de toucher la BDD.
 *
 *   5. Activer côté routes/sourcing-scanner.js :
 *      - source_type='api', supplier='noon' → router vers ce connecteur.
 *
 * Tant que ces 5 étapes ne sont pas faites, ce connecteur reste inactif.
 */

'use strict';

const { ApiConnectorBase } = require('./api-connector.base');

class NoonConnector extends ApiConnectorBase {
  constructor(config = {}) {
    super({
      supplier_name: 'Noon',
      // base_url: à remplir quand on aura la doc officielle
      base_url: config.base_url || null,
      // auth_type: à remplir quand on saura
      auth_type: config.auth_type || 'none',
      // api_key_env: à définir quand on aura les credentials
      api_key_env: config.api_key_env || 'NOON_API_KEY',
      ...config,
    });
  }

  /**
   * NON IMPLÉMENTÉ — voir en-tête du fichier pour la procédure d'activation.
   *
   * Lève une erreur explicite : ne jamais simuler une réponse.
   */
  async fetchProducts(options = {}) {
    throw new Error(
      '[Noon] Connecteur API non actif. ' +
      'Pour activer : obtenir doc officielle Noon + credentials + ' +
      'implémenter fetchProducts() dans ' +
      'services/suppliers/connectors/noon-connector.js. ' +
      'En attendant, utilisez l\'import CSV ou la saisie manuelle.'
    );
  }
}

module.exports = {
  NoonConnector,
  // Indicateur d'état pour les routes / l'UI
  IS_ACTIVE: false,
  // Message à afficher si quelqu'un tente de l'utiliser
  INACTIVE_REASON: 'API Noon non configurée. Voir services/suppliers/connectors/noon-connector.js pour la procédure d\'activation.',
};
