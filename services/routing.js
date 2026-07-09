/**
 * @komerce-arch
 * @role          routing
 * @domain        logistics
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/logger.js
 * @used-by       routes/orders/create.js, server.js, services/shared-cart-lifecycle.js
 * @db-read       relais
 * @db-write      orders, relais
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Services / Routing v1.0
 *
 * Module central de routage logistique.
 * La destination d'une commande est déterminée UNIQUEMENT par le point relais.
 * Le frontend ne décide jamais la destination.
 *
 * Hub principal : ANJOUAN (tout transite par Anjouan)
 *
 * Règles :
 *   ANJOUAN  → DIRECT
 *   MORONI   → INTER_ISLAND via ANJOUAN
 *   MOHELI   → INTER_ISLAND via ANJOUAN
 *   MAYOTTE  → SPECIAL_ROUTE via ANJOUAN
 *
 * Usage :
 *   const { resolveRoutingFromRelais } = require('../services/routing');
 *   const routing = resolveRoutingFromRelais(relais);
 *   // → { destination_island, routing_mode, transit_hub }
 */

'use strict';

const log = require('../utils/logger').child({ module: 'routing' });

// ── Destinations supportées ──────────────────────────────────────────────────

const DESTINATIONS = ['ANJOUAN', 'MORONI', 'MOHELI', 'MAYOTTE'];

// ── Hub principal de transit ─────────────────────────────────────────────────

const TRANSIT_HUB = 'ANJOUAN';

// ── Modes de routage ─────────────────────────────────────────────────────────

const ROUTING_MODES = {
  DIRECT:        'DIRECT',
  INTER_ISLAND:  'INTER_ISLAND',
  SPECIAL_ROUTE: 'SPECIAL_ROUTE',
};

// ── Normalisation noms d'île → code standardisé ──────────────────────────────
// Gère les variantes françaises, comoriennes et les accents

const ISLAND_NORMALIZE = {
  'anjouan':       'ANJOUAN',
  'ndzuwani':      'ANJOUAN',
  'grande comore': 'MORONI',
  'moroni':        'MORONI',
  'ngazidja':      'MORONI',
  'mohéli':        'MOHELI',
  'moheli':        'MOHELI',
  'mwali':         'MOHELI',
  'fomboni':       'MOHELI',
  'mayotte':       'MAYOTTE',
  'maore':         'MAYOTTE',
  'mamoudzou':     'MAYOTTE',
};

// ── Règles de routage par destination ────────────────────────────────────────

const ROUTING_RULES = {
  ANJOUAN: { mode: ROUTING_MODES.DIRECT,        hub: null },
  MORONI:  { mode: ROUTING_MODES.INTER_ISLAND,   hub: TRANSIT_HUB },
  MOHELI:  { mode: ROUTING_MODES.INTER_ISLAND,   hub: TRANSIT_HUB },
  MAYOTTE: { mode: ROUTING_MODES.SPECIAL_ROUTE,  hub: TRANSIT_HUB },
};

// ── Erreur de routage typée ──────────────────────────────────────────────────

class RoutingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
    this.statusCode = 400;
  }
}

// ── Normalisation island → code ──────────────────────────────────────────────

function normalizeIsland(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  // Direct match
  if (ISLAND_NORMALIZE[key]) return ISLAND_NORMALIZE[key];
  // Prefix match — robuste contre les problèmes d'encodage UTF-8
  // (ex: Mohéli peut apparaître comme MohÃƒ©li en DB)
  if (key.startsWith('moh') || key.startsWith('mwa'))  return 'MOHELI';
  if (key.startsWith('anj') || key.startsWith('ndz'))  return 'ANJOUAN';
  if (key.startsWith('gran') || key.startsWith('mor') || key.startsWith('nga')) return 'MORONI';
  if (key.startsWith('may') || key.startsWith('mao') || key.startsWith('mam')) return 'MAYOTTE';
  return null;
}

// ── Résolution routing depuis un relais ──────────────────────────────────────
// Source de vérité unique — ne jamais dupliquer cette logique

function resolveRoutingFromRelais(relais) {
  // Règle 1 : relais obligatoire
  if (!relais) {
    throw new RoutingError(
      'Relais obligatoire pour déterminer la destination',
      'RELAIS_MISSING'
    );
  }

  // Résoudre le code : priorité à island_code (standardisé), fallback sur island (human)
  const code = relais.island_code || normalizeIsland(relais.island);

  // Règle 2 : island_code obligatoire
  if (!code) {
    throw new RoutingError(
      `Relais "${relais.name}" (${relais.id}) n'a pas d'île configurée — island_code manquant`,
      'ISLAND_CODE_MISSING'
    );
  }

  // Règle 3 : destination reconnue
  if (!DESTINATIONS.includes(code)) {
    throw new RoutingError(
      `Destination "${code}" non supportée pour relais "${relais.name}" — valeurs : ${DESTINATIONS.join(', ')}`,
      'DESTINATION_UNKNOWN'
    );
  }

  const rule = ROUTING_RULES[code];

  return {
    destination_island: code,
    routing_mode:       rule.mode,
    transit_hub:        rule.hub,
  };
}

// ── Migration DB safe (additive, idempotente) ────────────────────────────────
// Ajoute les colonnes routing si elles n'existent pas (DDL seule, rapide et sûre au boot)

async function ensureRoutingColumns(db) {
  const migrations = [
    // Relais : ajouter island_code standardisé
    `ALTER TABLE relais ADD COLUMN IF NOT EXISTS island_code VARCHAR(20)`,
    // Orders : ajouter les 3 champs routing (nullable = rétrocompatible)
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_island VARCHAR(20)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_mode VARCHAR(20)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS transit_hub VARCHAR(20)`,
  ];

  for (const sql of migrations) {
    try {
      await db.query(sql);
    } catch (e) {
      // Colonne existe déjà ou autre erreur non critique
      if (!e.message.includes('already exists')) {
        log.warn(`[Routing] Migration warning: ${e.message}`);
      }
    }
  }

  log.info('✅ Routing columns ready');
}

/**
 * FIX 2026-07-09 : ce backfill (UPDATE ... FROM sur toute la table `orders`)
 * tournait auparavant DANS ensureRoutingColumns, exécuté au boot du serveur
 * public. Sur une table `orders` sous trafic live, l'UPDATE peut entrer en
 * contention avec les écritures concurrentes et bloquer largement au-delà du
 * timeout boot-guard (15s), saturant le pool de connexions au démarrage.
 * Sorti du chemin de boot : à lancer manuellement (scripts/backfill-routing.js),
 * idéalement en heure creuse.
 */
async function backfillRoutingData(db) {
  // ── Backfill island_code dans relais (depuis island human-readable) ────────
  const BACKFILL_MAP = {
    'Anjouan':       'ANJOUAN',
    'Grande Comore': 'MORONI',
    'Mohéli':        'MOHELI',
    'Mayotte':       'MAYOTTE',
  };

  for (const [humanName, code] of Object.entries(BACKFILL_MAP)) {
    try {
      const { rowCount } = await db.query(
        `UPDATE relais SET island_code = $1
         WHERE island = $2 AND (island_code IS NULL OR island_code = '')`,
        [code, humanName]
      );
      if (rowCount > 0) {
        log.info(`[Routing] Backfill: ${rowCount} relais "${humanName}" → ${code}`);
      }
    } catch (e) {
      log.warn(`[Routing] Backfill error: ${e.message}`);
    }
  }

  // ── Backfill orders existantes (si relais a un code mais la commande non) ──
  try {
    const { rowCount } = await db.query(`
      UPDATE orders o SET
        destination_island = r.island_code,
        routing_mode = CASE
          WHEN r.island_code = 'ANJOUAN' THEN 'DIRECT'
          WHEN r.island_code IN ('MORONI', 'MOHELI') THEN 'INTER_ISLAND'
          WHEN r.island_code = 'MAYOTTE' THEN 'SPECIAL_ROUTE'
        END,
        transit_hub = CASE
          WHEN r.island_code = 'ANJOUAN' THEN NULL
          ELSE 'ANJOUAN'
        END
      FROM relais r
      WHERE o.relais_id = r.id
        AND o.destination_island IS NULL
        AND r.island_code IS NOT NULL
    `);
    if (rowCount > 0) {
      log.info(`[Routing] Backfill: ${rowCount} commandes existantes enrichies`);
    }
  } catch (e) {
    log.warn(`[Routing] Order backfill error: ${e.message}`);
  }

  log.info('✅ Routing backfill terminé');
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  resolveRoutingFromRelais,
  normalizeIsland,
  ensureRoutingColumns,
  backfillRoutingData,
  RoutingError,
  DESTINATIONS,
  ROUTING_MODES,
  TRANSIT_HUB,
  ROUTING_RULES,
};
