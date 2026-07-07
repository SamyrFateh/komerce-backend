/**
 * @komerce-arch
 * @role          connector-utils
 * @domain        catalog
 * @layer         util
 * @criticality   medium
 * @inputs        raw_value
 * @outputs       parsed_value_or_invalid_flag
 * @depends       @none
 * @used-by       services/suppliers/connectors/csv-connector.js, services/suppliers/connectors/manual-connector.js
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        resolve_before_behavior_change
 * @doctrine      DOCTRINE_INGESTION_CATALOGUE (ING-I2)
 * @impact-areas  catalog
 * @version       2026-07
 */

/**
 * KOMERCE — Utilitaires de parsing strict (ING-2)
 * ═══════════════════════════════════════════════════════════════════
 *
 * ING-I2 : « jamais inventer, jamais deviner en silence ». Une valeur
 * numérique/entière fournie mais illisible ("many", "12 units", "120 USD")
 * ne doit jamais être silencieusement droppée ou tronquée — elle doit être
 * signalée comme invalide pour que la ligne soit rejetée avec une raison.
 *
 * Ce module est le SEUL endroit qui décide « est-ce un nombre ? ». Les
 * connecteurs (csv, manual) l'utilisent tous les deux pour ne jamais
 * diverger sur ce qui est jugé propre.
 */

'use strict';

// Nombre : entier ou décimal (point OU virgule FR), signe optionnel.
// Rejette explicitement tout ce qui traîne un suffixe/préfixe ("120 USD", "~120").
const STRICT_NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/;
// Entier strict : pas de décimale, pas de mot ("many", "12 units", "12.9").
const STRICT_INTEGER_RE = /^-?\d+$/;

/**
 * @param {*} raw
 * @returns {{ value?: number, invalid?: boolean }}
 *          value === undefined ET invalid absent → champ non fourni (vide), légitime.
 *          invalid === true                      → fourni mais illisible, DOIT rejeter la ligne.
 */
function parseStrictNumber(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw } : { invalid: true };
  }
  const s = String(raw).trim();
  if (s === '') return {};
  if (!STRICT_NUMBER_RE.test(s)) return { invalid: true };
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? { value: n } : { invalid: true };
}

/**
 * @param {*} raw
 * @returns {{ value?: number, invalid?: boolean }}
 */
function parseStrictInteger(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? { value: raw } : { invalid: true };
  }
  const s = String(raw).trim();
  if (s === '') return {};
  if (!STRICT_INTEGER_RE.test(s)) return { invalid: true };
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? { value: n } : { invalid: true };
}

/**
 * Dimension (l_cm/w_cm/h_cm) : nombre strict ET strictement positif.
 * @param {*} raw
 * @returns {{ value?: number, invalid?: boolean }}
 */
function parsePositiveDimension(raw) {
  const r = parseStrictNumber(raw);
  if (r.invalid) return r;
  if (r.value !== undefined && r.value <= 0) return { invalid: true };
  return r;
}

module.exports = {
  parseStrictNumber,
  parseStrictInteger,
  parsePositiveDimension,
  STRICT_NUMBER_RE,
  STRICT_INTEGER_RE,
};
