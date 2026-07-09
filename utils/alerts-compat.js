/**
 * @komerce-arch
 * @role          alerts-schema-compat
 * @domain        infrastructure
 * @layer         util
 * @criticality   high
 * @inputs        sql_query, sql_params
 * @outputs       rewritten_sql_query, rewritten_sql_params
 * @depends       none
 * @used-by       db.js
 * @db-read       none
 * @db-write      alerts
 * @db-txn        compatible_with_caller
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  operations, payment, logistics, catalog, refunds
 * @version       2026-07-09b
 */

'use strict';

/**
 * KOMERCE — utils/alerts-compat.js
 *
 * Contexte (PR563 — alerts schema drift) :
 *   Plusieurs services historiques écrivent encore dans l'ancien contrat
 *   implicite `INSERT INTO alerts (level, source, message, payload)`,
 *   alors que le schéma réel (Railway) est :
 *   `alerts(type, entity_type, entity_id, severity, title, description, created_at, ...)`.
 *
 * Cette couche intercepte ces INSERT legacy et les réécrit vers le schéma réel,
 * sans toucher aux fichiers sources historiques.
 *
 * Contraintes tenues (audit PR563 — points corrigés) :
 *   - Colonnes legacy détectées indépendamment de leur ordre dans la requête
 *     (pas de dépendance à `(level, source, message, payload)` exactement).
 *   - Parsing des VALUES par comptage de profondeur de parenthèses/quotes,
 *     pas de `split(',')` naïf — robuste aux valeurs contenant des virgules
 *     (ex. JSON stringifié dans payload).
 *   - Suffixe SQL (`RETURNING ...`, `ON CONFLICT DO NOTHING`, etc.) préservé
 *     tant qu'il ne référence pas une colonne legacy.
 *
 * Colonnes legacy → colonnes réelles :
 *   level   → severity  (mapping ci-dessous)
 *   source  → type
 *   message → title
 *   payload → description (JSON stringifié si objet, sinon tel quel)
 *
 * entity_type et entity_id sont déduits du payload JSON (best-effort, nullable en schema).
 * Fallback si aucun ID métier n'est trouvé : entity_type = `source` legacy normalisé
 * (ex. 'parcel_sync', 'refund_manual_cash'), entity_id = null. Générique 'system'
 * uniquement si `source` est lui-même vide/absent.
 */

// Détection "classique" — ordre exact des colonnes. Conservée telle quelle
// pour compatibilité (utilisée par des tests et éventuellement d'autres
// appelants). rewriteLegacyAlertInsert() ne s'appuie PAS sur cette regex :
// sa propre détection interne (extractLegacyAlertInsert + vérification des
// 4 colonnes legacy) fonctionne quel que soit l'ordre des colonnes — c'est
// elle qui fait foi pour décider si une requête doit être réécrite.
const LEGACY_ALERTS_RE = /^\s*INSERT\s+INTO\s+alerts\s*\(\s*level\s*,\s*source\s*,\s*message\s*,\s*payload\s*\)/i;

const LEGACY_COLUMNS = new Set(['level', 'source', 'message', 'payload']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map legacy level → severity (colonne enum DB : 'low' | 'medium' | 'high').
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

function severityFromLegacy(level) {
  return SEVERITY_MAP[String(level || '').toLowerCase()] ?? 'medium';
}

const ENTITY_KEYS = [
  ['parcel_id',         'parcel'],
  ['parcelId',          'parcel'],
  ['order_id',          'order'],
  ['orderId',           'order'],
  ['product_id',        'product'],
  ['productId',         'product'],
  ['user_id',           'user'],
  ['userId',            'user'],
  ['refund_id',         'refund'],
  ['refundId',          'refund'],
  ['purchase_order_id', 'purchase_order'],
  ['purchaseOrderId',   'purchase_order'],
  ['payment_id',        'payment'],
  ['paymentId',         'payment'],
  ['dispute_id',        'dispute'],
  ['disputeId',         'dispute'],
  ['session_id',        'collective_session'],
  ['sessionId',         'collective_session'],
  ['workspace_id',      'collective_workspace'],
  ['workspaceId',       'collective_workspace'],
];

function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

/**
 * Normalise une valeur `source` legacy en identifiant entity_type utilisable
 * (minuscules, underscores, sans caractères spéciaux). Retourne 'system'
 * si la source est vide ou ne contient aucun caractère alphanumérique.
 */
function normalizeSource(source) {
  const cleaned = String(source || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'system';
}

/**
 * Déduit entity_type + entity_id depuis le payload JSON (best-effort).
 * Si aucun ID métier n'est trouvé dans le payload, le fallback utilise le
 * `source` legacy normalisé comme entity_type (ex. 'parcel_sync',
 * 'refund_manual_cash') plutôt qu'un générique 'system', afin de conserver
 * un minimum de contexte de triage. `source` est optionnel : à défaut,
 * le fallback reste 'system'.
 *
 * @param {*} payload
 * @param {string} [source]
 * @returns {{ entity_type: string, entity_id: string|null }}
 */
function pickEntity(payload, source) {
  const parsed = safeJsonParse(payload);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, entityType] of ENTITY_KEYS) {
      const val = parsed[key];
      if (val && typeof val === 'string' && UUID_RE.test(val)) {
        return { entity_type: entityType, entity_id: val };
      }
    }
  }

  return { entity_type: source ? normalizeSource(source) : 'system', entity_id: null };
}

function descriptionFromLegacy({ source, level, payload }) {
  const parsed = safeJsonParse(payload);
  if (parsed !== null) return JSON.stringify(parsed);
  if (payload !== null && payload !== undefined) return String(payload);
  return `legacy_source=${source || 'unknown'} legacy_level=${level || 'unknown'}`;
}

// ── Parsing SQL robuste (profondeur parenthèses + quotes) ──────────────────

function splitSqlArgs(input) {
  const out = [];
  let cur = '';
  let depth = 0;
  let inQuote = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === "'") {
      cur += ch;
      if (inQuote && next === "'") {
        cur += next;
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }

    if (!inQuote) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }

    cur += ch;
  }

  if (cur.trim()) out.push(cur.trim());
  return out;
}

function findMatchingParen(input, openIndex) {
  let depth = 0;
  let inQuote = false;

  for (let i = openIndex; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === "'") {
      if (inQuote && next === "'") {
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }

    if (inQuote) continue;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function cleanIdentifier(value) {
  return String(value || '').trim().replace(/^"|"$/g, '').toLowerCase();
}

function unquoteSqlString(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function resolveSqlToken(token, params = []) {
  const trimmed = String(token || '').trim();
  const placeholder = /^\$(\d+)$/.exec(trimmed);
  if (placeholder) return params[Number(placeholder[1]) - 1];
  if (/^null$/i.test(trimmed)) return null;
  if (/^now\(\)$/i.test(trimmed)) return new Date();
  return unquoteSqlString(trimmed);
}

function extractLegacyAlertInsert(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
  const prefix = /^INSERT\s+INTO\s+alerts\s*/i.exec(normalized);
  if (!prefix) return null;

  const columnsOpen = normalized.indexOf('(', prefix[0].length - 1);
  if (columnsOpen < 0) return null;

  const columnsClose = findMatchingParen(normalized, columnsOpen);
  if (columnsClose < 0) return null;

  const columnsText = normalized.slice(columnsOpen + 1, columnsClose);
  const afterColumns = normalized.slice(columnsClose + 1).trim();
  const valuesPrefix = /^VALUES\s*/i.exec(afterColumns);
  if (!valuesPrefix) return null;

  const valuesOpen = normalized.indexOf('(', columnsClose + 1);
  if (valuesOpen < 0) return null;

  const valuesClose = findMatchingParen(normalized, valuesOpen);
  if (valuesClose < 0) return null;

  const valuesText = normalized.slice(valuesOpen + 1, valuesClose);
  const suffix = normalized.slice(valuesClose + 1).trim();

  return { columnsText, valuesText, suffix };
}

function suffixIsSafeToPreserve(suffix) {
  if (!suffix) return true;
  const lowered = suffix.toLowerCase();
  return ![...LEGACY_COLUMNS].some((column) => new RegExp(`\\b${column}\\b`, 'i').test(lowered));
}

/**
 * Réécrit un INSERT INTO alerts legacy vers le schéma réel.
 * Colonnes acceptées dans n'importe quel ordre, tant que les 4 colonnes
 * legacy (level, source, message, payload) sont toutes présentes.
 *
 * @param {string} sql
 * @param {Array}  params
 * @returns {{ sql: string, params: Array, rewritten: boolean }}
 */
function rewriteLegacyAlertInsert(sql, params = []) {
  if (typeof sql !== 'string' || !/insert\s+into\s+alerts/i.test(sql)) {
    return { sql, params, rewritten: false };
  }

  const parsed = extractLegacyAlertInsert(sql);
  if (!parsed) return { sql, params, rewritten: false };

  const columns = splitSqlArgs(parsed.columnsText).map(cleanIdentifier);
  const values = splitSqlArgs(parsed.valuesText);

  const hasLegacyColumns = [...LEGACY_COLUMNS].every((c) => columns.includes(c));
  if (!hasLegacyColumns) return { sql, params, rewritten: false };

  if (!suffixIsSafeToPreserve(parsed.suffix)) {
    return { sql, params, rewritten: false };
  }

  const legacyLevel = resolveSqlToken(values[columns.indexOf('level')], params);
  const legacySource = resolveSqlToken(values[columns.indexOf('source')], params);
  const legacyMessage = resolveSqlToken(values[columns.indexOf('message')], params);
  const legacyPayload = resolveSqlToken(values[columns.indexOf('payload')], params);

  const { entity_type, entity_id } = pickEntity(legacyPayload, legacySource);
  const title = String(legacyMessage || `${legacySource || 'system'} alert`).slice(0, 500);
  const severity = severityFromLegacy(legacyLevel);
  const description = descriptionFromLegacy({ source: legacySource, level: legacyLevel, payload: legacyPayload });
  const suffix = parsed.suffix ? ` ${parsed.suffix}` : '';

  return {
    sql: `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description)
          VALUES ($1, $2, $3, $4, $5, $6)${suffix}`,
    params: [
      String(legacySource || 'legacy_alert').slice(0, 120),
      entity_type,
      entity_id,
      severity,
      title,
      description,
    ],
    rewritten: true,
  };
}

module.exports = { rewriteLegacyAlertInsert, LEGACY_ALERTS_RE, severityFromLegacy, pickEntity, normalizeSource };
