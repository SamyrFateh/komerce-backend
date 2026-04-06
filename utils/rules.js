/**
 * KOMERCE — Moteur de règles centralisé (utils/rules.js)
 *
 * Source de vérité : table `business_rules` en DB
 * Cache mémoire TTL 60s pour performance
 * Fallback sur valeurs par défaut si DB vide ou inaccessible
 *
 * Usage :
 *   const { getRule } = require('../utils/rules');
 *   const maxQty = await getRule('MAX_QUANTITY_PER_ITEM', 100);
 *   //                                                    ^^^
 *   //                     Fallback = valeur actuelle hardcodée
 *   //                     → Si la DB est vide, RIEN NE CHANGE
 */

'use strict';

const db = require('../db');

// ── Cache mémoire ────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000; // 1 minute
let _cache = null;
let _cacheAt = 0;

// ── getRule(key, defaultValue) ───────────────────────────────────────────────
// Retourne la valeur d'une règle métier.
// Si la règle n'existe pas ou la DB est inaccessible → retourne defaultValue.
// Le fallback garantit : zéro breaking change, zéro régression.

async function getRule(key, defaultValue) {
  try {
    if (!_cache || Date.now() - _cacheAt > CACHE_TTL_MS) {
      const { rows } = await db.query(
        'SELECT key, value FROM business_rules WHERE is_active = TRUE'
      );
      _cache = {};
      for (const r of rows) {
        _cache[r.key] = r.value?.value;
      }
      _cacheAt = Date.now();
    }
    const val = _cache[key];
    return val !== undefined ? val : defaultValue;
  } catch (err) {
    // DB inaccessible → fallback silencieux
    console.error('[RULES] getRule error (fallback used):', err.message);
    return defaultValue;
  }
}


// ── getRuleNumber(key, defaultValue) ─────────────────────────────────────────
// Safe wrapper — always returns a Number. Prevents SQL injection if value
// is ever interpolated into a query string (cast guarantees no SQL payload).

async function getRuleNumber(key, defaultValue) {
  const val = await getRule(key, defaultValue);
  const num = Number(val);
  return Number.isFinite(num) ? num : defaultValue;
}

// ── getRuleString(key, defaultValue) ─────────────────────────────────────────
// Safe wrapper — always returns a String.

async function getRuleString(key, defaultValue) {
  const val = await getRule(key, defaultValue);
  return typeof val === 'string' ? val : String(defaultValue);
}

// ── getAllRules() ─────────────────────────────────────────────────────────────
// Retourne toutes les règles groupées par catégorie (pour l'API admin).

async function getAllRules() {
  const { rows } = await db.query(
    'SELECT * FROM business_rules ORDER BY category, key'
  );

  // Grouper par catégorie
  const categories = {};
  for (const rule of rows) {
    if (!categories[rule.category]) {
      categories[rule.category] = { label: getCategoryLabel(rule.category), rules: [] };
    }
    categories[rule.category].rules.push({
      key:        rule.key,
      label_fr:   rule.label_fr,
      description: rule.description,
      value:      rule.value?.value,
      value_type: rule.value_type,
      min_value:  rule.min_value ? Number(rule.min_value) : null,
      max_value:  rule.max_value ? Number(rule.max_value) : null,
      is_active:  rule.is_active,
      updated_at: rule.updated_at,
    });
  }
  return categories;
}

// ── getRuleByKey(key) ────────────────────────────────────────────────────────
// Retourne une règle complète + son historique récent.

async function getRuleByKey(key) {
  const { rows: [rule] } = await db.query(
    'SELECT * FROM business_rules WHERE key = $1', [key]
  );
  return rule || null;
}

// ── updateRule(key, value, userId, reason) ───────────────────────────────────
// Met à jour une règle, valide les contraintes, enregistre l'historique.

async function updateRule(key, value, userId, reason) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [rule] } = await client.query(
      'SELECT * FROM business_rules WHERE key = $1', [key]
    );
    if (!rule) throw new Error(`Règle introuvable: ${key}`);

    // Validation type
    if (rule.value_type === 'number' && typeof value !== 'number') {
      throw new Error(`Type attendu: number, reçu: ${typeof value}`);
    }
    if (rule.value_type === 'boolean' && typeof value !== 'boolean') {
      throw new Error(`Type attendu: boolean, reçu: ${typeof value}`);
    }
    if (rule.value_type === 'string' && typeof value !== 'string') {
      throw new Error(`Type attendu: string, reçu: ${typeof value}`);
    }

    // Contraintes min/max (nombres uniquement)
    if (rule.value_type === 'number') {
      if (rule.min_value !== null && value < Number(rule.min_value)) {
        throw new Error(`Valeur minimum: ${rule.min_value}`);
      }
      if (rule.max_value !== null && value > Number(rule.max_value)) {
        throw new Error(`Valeur maximum: ${rule.max_value}`);
      }
    }

    const newValue = { value };

    // Historiser le changement
    await client.query(
      `INSERT INTO business_rules_history (rule_id, old_value, new_value, changed_by, change_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [rule.id, rule.value, newValue, userId || null, reason || null]
    );

    // Mettre à jour
    await client.query(
      'UPDATE business_rules SET value = $1, updated_at = NOW() WHERE key = $2',
      [JSON.stringify(newValue), key]
    );

    await client.query('COMMIT');

    // Invalider le cache
    invalidateCache();

    return { ...rule, value: newValue };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── resetRule(key, userId) ───────────────────────────────────────────────────
// Remet une règle à sa valeur d'origine (première valeur avant tout changement).

async function resetRule(key, userId) {
  const rule = await getRuleByKey(key);
  if (!rule) throw new Error(`Règle introuvable: ${key}`);

  // Trouver la valeur d'origine = old_value du premier changement
  const { rows: [first] } = await db.query(
    `SELECT old_value FROM business_rules_history
     WHERE rule_id = $1
     ORDER BY created_at ASC LIMIT 1`,
    [rule.id]
  );

  if (!first) {
    // Aucun historique → la valeur actuelle EST la valeur par défaut
    return rule;
  }

  const defaultValue = first.old_value?.value;
  if (defaultValue === undefined) return rule;

  return updateRule(key, defaultValue, userId, 'Remise à zéro — valeur par défaut');
}

// ── getRuleHistory(key) ──────────────────────────────────────────────────────
// Retourne l'historique des modifications d'une règle (50 dernières).

async function getRuleHistory(key) {
  const { rows } = await db.query(
    `SELECT h.id, h.old_value, h.new_value, h.change_reason, h.created_at,
            u.full_name AS changed_by_name
     FROM business_rules_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.rule_id = (SELECT id FROM business_rules WHERE key = $1)
     ORDER BY h.created_at DESC
     LIMIT 50`,
    [key]
  );
  return rows;
}

// ── invalidateCache() ────────────────────────────────────────────────────────
// Force le rechargement du cache au prochain appel getRule().

function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

// ── Helper : labels catégories ───────────────────────────────────────────────

function getCategoryLabel(category) {
  const labels = {
    orders:       'Commandes',
    shipping:     'Expédition',
    sla:          'Niveaux de service (SLA)',
    compensation: 'Compensations automatiques',
    loyalty:      'Programme fidélité',
    pricing:      'Tarification',
    system:       'Système',
  };
  return labels[category] || category;
}

module.exports = {
  getRule,
  getRuleNumber,
  getRuleString,
  getAllRules,
  getRuleByKey,
  updateRule,
  resetRule,
  getRuleHistory,
  invalidateCache,
};
