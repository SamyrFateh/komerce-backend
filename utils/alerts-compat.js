/**
 * @komerce-arch
 * @role          alerts-compat
 * @domain        infrastructure
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       side_effects
 * @depends       db.js
 * @db-write      alerts
 * @db-read       none
 * @used-by       db.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  alerts
 * @version       2026-07
 */

'use strict';

/**
 * KOMERCE — utils/alerts-compat.js
 *
 * @feature    infrastructure
 * @layer      utils
 * @db-read    none
 * @db-write   alerts
 *
 * Couche de compatibilité pour les INSERT INTO alerts legacy.
 *
 * Contexte (PR563 — alerts schema drift) :
 *   Le code métier écrit `INSERT INTO alerts (level, source, message, payload)`
 *   mais le schéma réel utilise `(type, entity_type, entity_id, severity, title, description)`.
 *   Ce module intercepte les requêtes legacy et les réécrit sans toucher aux 15 fichiers sources.
 *
 * Colonnes legacy → colonnes réelles :
 *   level   → severity  (avec mapping : elevated → high, critical → high, low → low, medium → medium)
 *   source  → type
 *   message → title
 *   payload → description (JSON stringifié si objet, sinon tel quel)
 *
 * entity_type et entity_id sont déduits du payload JSON (best-effort, nullable en schema).
 */

// Regex détectant un INSERT INTO alerts avec les colonnes legacy
const LEGACY_ALERTS_RE = /^\s*INSERT\s+INTO\s+alerts\s*\(\s*level\s*,\s*source\s*,\s*message\s*,\s*payload\s*\)/i;

/**
 * Map legacy level → severity (colonnes enum DB : 'low' | 'medium' | 'high').
 */
const SEVERITY_MAP = {
  // Haute sévérité
  critical: 'high',
  elevated: 'high',
  high:     'high',
  error:    'high',
  fatal:    'high',
  // Sévérité moyenne
  medium:   'medium',
  warning:  'medium',
  warn:     'medium',
  // Basse sévérité
  low:      'low',
  info:     'low',
  debug:    'low',
  notice:   'low',
  trace:    'low',
};

/**
 * Déduit entity_type + entity_id depuis le payload JSON (best-effort).
 * Retourne { entity_type, entity_id } ou les valeurs par défaut.
 */
function pickEntity(payload) {
  let parsed = payload;
  if (typeof payload === 'string') {
    try { parsed = JSON.parse(payload); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { entity_type: 'system', entity_id: null };
  }

  // UUID regex (v4 / any format)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const ENTITY_KEYS = [
    ['parcel_id',        'parcel'],
    ['parcelId',         'parcel'],
    ['order_id',         'order'],
    ['orderId',          'order'],
    ['product_id',       'product'],
    ['productId',        'product'],
    ['user_id',          'user'],
    ['userId',           'user'],
    ['purchase_order_id','purchase_order'],
    ['purchaseOrderId',  'purchase_order'],
    ['payment_id',       'payment'],
    ['paymentId',        'payment'],
    ['dispute_id',       'dispute'],
    ['disputeId',        'dispute'],
  ];

  for (const [key, entityType] of ENTITY_KEYS) {
    const val = parsed[key];
    if (val && typeof val === 'string' && UUID_RE.test(val)) {
      return { entity_type: entityType, entity_id: val };
    }
  }

  return { entity_type: 'system', entity_id: null };
}

/**
 * Réécrit un INSERT INTO alerts legacy vers le schéma réel.
 *
 * @param {string} sql      SQL legacy (doit matcher LEGACY_ALERTS_RE)
 * @param {Array}  params   Paramètres positionnels ($1, $2, $3, $4)
 * @returns {{ sql: string, params: Array }}  Requête réécrite
 */
function rewriteLegacyAlertInsert(sql, params) {
  // Normaliser les params — supporte ON CONFLICT DO NOTHING en fin de SQL
  // Paramètres attendus : [level, source, message, payload]
  // mais certains sites passent les littéraux directement dans le SQL
  // → extraire level, source, message, payload depuis sql + params

  // Détecter si des valeurs sont inline (littéraux dans VALUES)
  const VALUES_RE = /VALUES\s*\(([^)]+)\)/i;
  const valuesMatch = sql.match(VALUES_RE);
  if (!valuesMatch) return { sql, params }; // ne devrait pas arriver

  const rawValues = valuesMatch[1].split(',').map(v => v.trim());

  // Résoudre chaque valeur : soit un littéral SQL ('xxx'), soit un param ($N)
  const resolvedValues = rawValues.map(v => {
    const literalMatch = v.match(/^'([^']*)'$/);
    if (literalMatch) return literalMatch[1];
    const paramMatch = v.match(/^\$(\d+)$/);
    if (paramMatch) return params[parseInt(paramMatch[1]) - 1];
    return null;
  });

  const [rawLevel, rawSource, rawMessage, rawPayload] = resolvedValues;

  const severity = SEVERITY_MAP[String(rawLevel).toLowerCase()] ?? 'medium';
  const type = rawSource ?? 'system';
  const title = rawMessage ?? 'Alerte système';

  // description : sérialiser le payload
  let description = null;
  if (rawPayload !== null && rawPayload !== undefined) {
    description = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
  }

  const { entity_type, entity_id } = pickEntity(rawPayload);

  const hasConflict = /ON\s+CONFLICT\s+DO\s+NOTHING/i.test(sql);
  const conflictClause = hasConflict ? ' ON CONFLICT DO NOTHING' : '';

  const newSql = `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description)
     VALUES ($1, $2, $3, $4::text, $5, $6)${conflictClause}`;

  return {
    sql: newSql,
    params: [type, entity_type, entity_id, severity, title, description],
  };
}

module.exports = { rewriteLegacyAlertInsert, LEGACY_ALERTS_RE, pickEntity };
