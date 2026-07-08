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
 * Elle couvre les formes simples, ainsi que les suffixes SQL non liés aux
 * anciennes colonnes (`RETURNING ...`, `ON CONFLICT DO NOTHING`, etc.).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_COLUMNS = new Set(['level', 'source', 'message', 'payload']);

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

function rewriteLegacyAlertInsert(text, params = []) {
  if (typeof text !== 'string' || !/insert\s+into\s+alerts/i.test(text)) {
    return { text, params, rewritten: false };
  }

  const parsed = extractLegacyAlertInsert(text);
  if (!parsed) return { text, params, rewritten: false };

  const columns = splitSqlArgs(parsed.columnsText).map(cleanIdentifier);
  const values = splitSqlArgs(parsed.valuesText);

  const hasLegacyColumns = [...LEGACY_COLUMNS].every((c) => columns.includes(c));
  if (!hasLegacyColumns) return { text, params, rewritten: false };

  if (!suffixIsSafeToPreserve(parsed.suffix)) {
    return { text, params, rewritten: false };
  }

  const legacyLevel = resolveSqlToken(values[columns.indexOf('level')], params);
  const legacySource = resolveSqlToken(values[columns.indexOf('source')], params);
  const legacyMessage = resolveSqlToken(values[columns.indexOf('message')], params);
  const legacyPayload = resolveSqlToken(values[columns.indexOf('payload')], params);

  const { entityType, entityId } = pickEntity(legacyPayload, legacySource);
  const title = String(legacyMessage || `${legacySource || 'system'} alert`).slice(0, 500);
  const suffix = parsed.suffix ? ` ${parsed.suffix}` : '';

  return {
    text: `INSERT INTO alerts (type, entity_type, entity_id, severity, title, description, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())${suffix}`,
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
