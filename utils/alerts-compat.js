/**
 * @komerce-arch
 * @role          alerts-schema-compat
 * @domain        operations
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
 * @version       2026-07
 */

'use strict';

/**
 * KOMERCE — Compatibilité schéma alerts
 *
 * Historique : plusieurs services écrivaient dans l'ancien contrat implicite :
 *   alerts(level, source, message, payload[, created_at])
 *
 * Le schéma réel Railway est :
 *   alerts(type, entity_type, entity_id, severity, title, description, created_at, ...)
 *
 * Cette couche réécrit uniquement ces anciens INSERT au moment d'appeler pg.
 * Elle couvre db.query(...) et les clients transactionnels client.query(...)
 * via db.js, sans modifier le comportement des autres requêtes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function cleanIdentifier(value) {
  return String(value || '')
    .trim()
    .replace(/^"|"$/g, '')
    .toLowerCase();
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

function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return value; }
}

function severityFromLegacy(level) {
  const raw = String(level || '').toLowerCase();
  if (['critical', 'elevated', 'high', 'error', 'fatal'].includes(raw)) return 'high';
  if (['low', 'info', 'debug', 'notice'].includes(raw)) return 'low';
  return 'medium';
}

function pickEntity(payload, source) {
  const p = safeJsonParse(payload);

  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const candidates = [
      ['parcel_id', 'parcel'],
      ['order_id', 'order'],
      ['product_id', 'product'],
      ['user_id', 'user'],
      ['refund_id', 'refund'],
      ['purchase_order_id', 'purchase_order'],
      ['session_id', 'collective_session'],
      ['workspace_id', 'collective_workspace'],
    ];

    for (const [key, type] of candidates) {
      if (UUID_RE.test(String(p[key] || ''))) return { entityType: type, entityId: p[key] };
    }
  }

  const normalizedSource = String(source || 'system')
    .replace(/[^a-zA-Z0-9_:-]+/g, '_')
    .slice(0, 80) || 'system';

  return { entityType: normalizedSource, entityId: null };
}

function descriptionFromLegacy({ source, level, payload }) {
  const p = safeJsonParse(payload);
  const payloadText = typeof p === 'string' ? p : JSON.stringify(p || {}, null, 2);
  return [
    `legacy_source=${source || 'unknown'}`,
    `legacy_level=${level || 'unknown'}`,
    '',
    payloadText,
  ].join('\n');
}

function rewriteLegacyAlertInsert(text, params = []) {
  if (typeof text !== 'string' || !/insert\s+into\s+alerts/i.test(text)) {
    return { text, params, rewritten: false };
  }

  const normalized = text.replace(/\s+/g, ' ').trim().replace(/;$/, '');
  const match = /^INSERT\s+INTO\s+alerts\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)$/i.exec(normalized);
  if (!match) return { text, params, rewritten: false };

  const columns = splitSqlArgs(match[1]).map(cleanIdentifier);
  const values = splitSqlArgs(match[2]);

  const hasLegacyColumns = ['level', 'source', 'message', 'payload'].every((c) => columns.includes(c));
  if (!hasLegacyColumns) return { text, params, rewritten: false };

  const legacyLevel = resolveSqlToken(values[columns.indexOf('level')], params);
  const legacySource = resolveSqlToken(values[columns.indexOf('source')], params);
  const legacyMessage = resolveSqlToken(values[columns.indexOf('message')], params);
  const legacyPayload = resolveSqlToken(values[columns.indexOf('payload')], params);

  const { entityType, entityId } = pickEntity(legacyPayload, legacySource);
  const title = String(legacyMessage || `${legacySource || 'system'} alert`).slice(0, 500);

  return {
    text: `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    params: [
      String(legacySource || 'legacy_alert').slice(0, 120),
      entityType,
      entityId,
      severityFromLegacy(legacyLevel),
      title,
      descriptionFromLegacy({ source: legacySource, level: legacyLevel, payload: legacyPayload }),
    ],
    rewritten: true,
  };
}

module.exports = { rewriteLegacyAlertInsert, severityFromLegacy };
