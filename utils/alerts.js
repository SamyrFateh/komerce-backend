/**
 * @komerce-arch
 * @role          alerts-persistence-boundary
 * @domain        notification
 * @layer         util
 * @criticality   high
 * @inputs        db_or_client, alert_fields
 * @outputs       persisted_alert_row
 * @depends       none
 * @used-by       services/payment-stripe.js, services/payment-paypal.js, services/payment-cash-confirm.js,
 *                services/cash-operations.js, services/confirm-pickup-cash-payment.js,
 *                services/admin-order-refund.js, services/order-payment-confirmation.js,
 *                services/cancel-order-purchase-orders.js, services/purchasing-trigger-service.js,
 *                services/scan-operations.js, services/product-publication-guard.js,
 *                services/repair-ordered-without-purchase-orders.js,
 *                services/repair-collective-ready-to-capture.js,
 *                services/repair-collective-stock-reservations.js, utils/parcelSync.js
 * @db-read       none
 * @db-write      alerts
 * @db-txn        compatible_with_caller
 * @doctrine      lifecycle_owner_persistence_boundary
 * @impact-areas  operations, payment, logistics, catalog, refunds, purchasing
 * @version       2026-07-14
 */

'use strict';

/**
 * KOMERCE — utils/alerts.js
 *
 * Boundary de persistance UNIQUE pour la table physique `alerts`
 * (contrat courant : type, entity_type, entity_id, severity, title,
 * description, created_at, resolved_at, resolved_by).
 *
 * Contexte (ALERTS CONTRACT RECOVERY — fermeture PR563) :
 *   PR563 avait tenté de corriger le drift entre les writers legacy
 *   (`level, source, message, payload`) et le schéma réel en interceptant
 *   le pool PostgreSQL au niveau db.js (rewriteLegacyAlertInsert / wrapClient
 *   / patchedQuery / patchedConnect). Cette interception globale a saturé le
 *   pool (incident documenté) et a été rollback (V2.10). utils/alerts-compat.js
 *   reste dans le repo mais n'est plus branché dans db.js.
 *
 *   Ce module ferme la dette applicative correctement : chaque writer legacy
 *   est migré explicitement vers ce helper, qui persiste dans le contrat
 *   physique réel. Aucune interception SQL globale.
 *
 * Doctrine (non négociable) :
 *   - `createAlert()` décide COMMENT persister une alerte. Il ne décide
 *     JAMAIS QUAND ou POURQUOI une alerte métier doit exister — ça reste
 *     la responsabilité du domaine appelant (payments, orders, logistics,
 *     catalog, shared-cart, purchasing...).
 *   - Le helper n'est pas systématiquement best-effort : il propage l'erreur
 *     SQL par défaut. Le caractère bloquant/non-bloquant appartient à
 *     l'appelant (`await createAlert(...)` dans la transaction métier, ou
 *     `try { await createAlert(...) } catch { log }` si best-effort explicite).
 *   - Accepte tout objet exposant `.query()` compatible node-pg : `Pool`,
 *     le module `db` (wrapper autour du pool), ou un `PoolClient` transactionnel.
 *   - Ne monkey-patch jamais l'objet DB reçu ; n'ouvre jamais de transaction
 *     implicite ; ne fait qu'un seul INSERT.
 */

// Mapping sévérité — repris de la doctrine PR563 (utils/alerts-compat.js),
// conservé uniquement s'il correspond au schéma courant : la colonne
// `severity` est contrainte par `alerts_severity_check` à
// ANY (ARRAY['low','medium','high']).
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

const SEVERITY_MAP = Object.freeze({
  // Haute sévérité
  critical: 'high',
  elevated: 'high',
  high: 'high',
  error: 'high',
  fatal: 'high',
  // Sévérité moyenne
  medium: 'medium',
  warning: 'medium',
  warn: 'medium',
  // Basse sévérité
  low: 'low',
  info: 'low',
  debug: 'low',
  notice: 'low',
});

/**
 * Normalise une valeur de sévérité (schéma courant OU vocabulaire legacy)
 * vers l'enum contraint par la DB : 'low' | 'medium' | 'high'.
 *
 * Toute valeur inconnue est traitée EXPLICITEMENT : elle retombe sur
 * 'medium' (valeur par défaut du schéma physique — cf. schema_railway.sql,
 * `severity text DEFAULT 'medium'`) plutôt que d'être masquée silencieusement
 * en amont. L'appelant peut inspecter `mapSeverity.wasUnknown(value)` s'il a
 * besoin de logger la divergence.
 *
 * @param {string} input
 * @returns {'low'|'medium'|'high'}
 */
function mapSeverity(input) {
  const key = String(input == null ? '' : input).trim().toLowerCase();
  if (VALID_SEVERITIES.has(key)) return key;
  if (Object.prototype.hasOwnProperty.call(SEVERITY_MAP, key)) return SEVERITY_MAP[key];
  return 'medium';
}

/**
 * true si `input` n'est reconnu ni par le schéma courant ni par le mapping
 * legacy documenté — utile pour les appelants qui veulent logger un warning
 * plutôt que de laisser tomber silencieusement sur le défaut.
 */
mapSeverity.isKnown = function isKnown(input) {
  const key = String(input == null ? '' : input).trim().toLowerCase();
  return VALID_SEVERITIES.has(key) || Object.prototype.hasOwnProperty.call(SEVERITY_MAP, key);
};

/**
 * Persiste une alerte dans le contrat physique réel de `alerts`.
 *
 * NE décide jamais si une alerte doit exister : c'est la responsabilité du
 * domaine appelant. Ne fait qu'un seul INSERT, ne wrap/monkey-patch rien,
 * n'ouvre pas de transaction. Propage l'erreur SQL par défaut — l'appelant
 * choisit explicitement s'il veut absorber l'échec (best-effort) ou le
 * laisser remonter (bloquant).
 *
 * @param {{query: Function}} dbOrClient - Pool, module db, ou PoolClient
 * @param {object} alert
 * @param {string} alert.type            - identifiant machine de l'évènement (ex: 'paid_but_stock_blocked')
 * @param {string} alert.entityType      - ex: 'order', 'product', 'purchase_order'
 * @param {string|null} [alert.entityId] - uuid de l'entité concernée, ou null
 * @param {string} [alert.severity]      - 'low'|'medium'|'high' ou vocabulaire legacy (mappé)
 * @param {string} alert.title           - titre opérationnel stable (tronqué à 500 caractères)
 * @param {string} [alert.description]   - contexte humain. Préférer ce champ à `payload`.
 * @param {object} [alert.payload]       - fallback UNIQUEMENT si `description` est absent :
 *                                          sérialisé dans `description` avec un préfixe explicite.
 *                                          La table physique n'a pas de colonne `payload` — ne pas
 *                                          l'utiliser comme un dépotoir JSON par défaut, préférer
 *                                          construire `description` côté appelant.
 * @returns {Promise<object>} la ligne insérée (id, type, entity_type, entity_id, severity, title, description, created_at)
 */
async function createAlert(dbOrClient, alert) {
  if (!dbOrClient || typeof dbOrClient.query !== 'function') {
    throw new TypeError(
      '[createAlert] dbOrClient must expose a .query() method (Pool, db module, or PoolClient)'
    );
  }

  const {
    type,
    entityType,
    entityId = null,
    severity,
    title,
    description,
    payload,
  } = alert || {};

  if (!type || typeof type !== 'string') {
    throw new TypeError('[createAlert] "type" is required (non-empty string)');
  }
  if (!entityType || typeof entityType !== 'string') {
    throw new TypeError('[createAlert] "entityType" is required (non-empty string)');
  }
  if (!title || typeof title !== 'string') {
    throw new TypeError('[createAlert] "title" is required (non-empty string)');
  }
  if (entityId != null && typeof entityId !== 'string') {
    throw new TypeError('[createAlert] "entityId" must be a string (uuid) or null');
  }

  const finalSeverity = mapSeverity(severity);

  let finalDescription = description != null ? String(description) : null;
  if (finalDescription == null && payload != null) {
    // Fallback explicite et documenté — ne remplace pas un vrai `description`.
    try {
      finalDescription = `[payload_fallback] ${JSON.stringify(payload)}`.slice(0, 8000);
    } catch (_e) {
      finalDescription = '[payload_fallback] <non-serializable>';
    }
  }

  const { rows: [row] } = await dbOrClient.query(
    `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, type, entity_type, entity_id, severity, title, description, created_at`,
    [
      String(type).slice(0, 120),
      String(entityType).slice(0, 60),
      entityId,
      finalSeverity,
      String(title).slice(0, 500),
      finalDescription,
    ]
  );

  return row;
}

module.exports = { createAlert, mapSeverity, SEVERITY_MAP };
