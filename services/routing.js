/**
 * KOMERCE â€” Services / Routing v1.0
 *
 * Module central de routage logistique.
 * La destination d'une commande est dÃ©terminÃ©e UNIQUEMENT par le point relais.
 * Le frontend ne dÃ©cide jamais la destination.
 *
 * Hub principal : ANJOUAN (tout transite par Anjouan)
 *
 * RÃ¨gles :
 *   ANJOUAN  â†’ DIRECT
 *   MORONI   â†’ INTER_ISLAND via ANJOUAN
 *   MOHELI   â†’ INTER_ISLAND via ANJOUAN
 *   MAYOTTE  â†’ SPECIAL_ROUTE via ANJOUAN
 *
 * Usage :
 *   const { resolveRoutingFromRelais } = require('../services/routing');
 *   const routing = resolveRoutingFromRelais(relais);
 *   // â†’ { destination_island, routing_mode, transit_hub }
 */

'use strict';

const log = require('../utils/logger').child({ module: 'routing' });

// â”€â”€ Destinations supportÃ©es â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DESTINATIONS = ['ANJOUAN', 'MORONI', 'MOHELI', 'MAYOTTE'];

// â”€â”€ Hub principal de transit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TRANSIT_HUB = 'ANJOUAN';

// â”€â”€ Modes de routage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROUTING_MODES = {
  DIRECT:        'DIRECT',
  INTER_ISLAND:  'INTER_ISLAND',
  SPECIAL_ROUTE: 'SPECIAL_ROUTE',
};

// â”€â”€ Normalisation noms d'Ã®le â†’ code standardisÃ© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GÃ¨re les variantes franÃ§aises, comoriennes et les accents

const ISLAND_NORMALIZE = {
  'anjouan':       'ANJOUAN',
  'ndzuwani':      'ANJOUAN',
  'grande comore': 'MORONI',
  'moroni':        'MORONI',
  'ngazidja':      'MORONI',
  'mohÃ©li':        'MOHELI',
  'moheli':        'MOHELI',
  'mwali':         'MOHELI',
  'fomboni':       'MOHELI',
  'mayotte':       'MAYOTTE',
  'maore':         'MAYOTTE',
  'mamoudzou':     'MAYOTTE',
};

// â”€â”€ RÃ¨gles de routage par destination â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROUTING_RULES = {
  ANJOUAN: { mode: ROUTING_MODES.DIRECT,        hub: null },
  MORONI:  { mode: ROUTING_MODES.INTER_ISLAND,   hub: TRANSIT_HUB },
  MOHELI:  { mode: ROUTING_MODES.INTER_ISLAND,   hub: TRANSIT_HUB },
  MAYOTTE: { mode: ROUTING_MODES.SPECIAL_ROUTE,  hub: TRANSIT_HUB },
};

// â”€â”€ Erreur de routage typÃ©e â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class RoutingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
    this.statusCode = 400;
  }
}

// â”€â”€ Normalisation island â†’ code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalizeIsland(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  // Direct match
  if (ISLAND_NORMALIZE[key]) return ISLAND_NORMALIZE[key];
  // Prefix match â€” robuste contre les problÃ¨mes d'encodage UTF-8
  // (ex: MohÃ©li peut apparaÃ®tre comme MohÃƒÂ©li en DB)
  if (key.startsWith('moh') || key.startsWith('mwa'))  return 'MOHELI';
  if (key.startsWith('anj') || key.startsWith('ndz'))  return 'ANJOUAN';
  if (key.startsWith('gran') || key.startsWith('mor') || key.startsWith('nga')) return 'MORONI';
  if (key.startsWith('may') || key.startsWith('mao') || key.startsWith('mam')) return 'MAYOTTE';
  return null;
}

// â”€â”€ RÃ©solution routing depuis un relais â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Source de vÃ©ritÃ© unique â€” ne jamais dupliquer cette logique

function resolveRoutingFromRelais(relais) {
  // RÃ¨gle 1 : relais obligatoire
  if (!relais) {
    throw new RoutingError(
      'Relais obligatoire pour dÃ©terminer la destination',
      'RELAIS_MISSING'
    );
  }

  // RÃ©soudre le code : prioritÃ© Ã  island_code (standardisÃ©), fallback sur island (human)
  const code = relais.island_code || normalizeIsland(relais.island);

  // RÃ¨gle 2 : island_code obligatoire
  if (!code) {
    throw new RoutingError(
      `Relais "${relais.name}" (${relais.id}) n'a pas d'Ã®le configurÃ©e â€” island_code manquant`,
      'ISLAND_CODE_MISSING'
    );
  }

  // RÃ¨gle 3 : destination reconnue
  if (!DESTINATIONS.includes(code)) {
    throw new RoutingError(
      `Destination "${code}" non supportÃ©e pour relais "${relais.name}" â€” valeurs : ${DESTINATIONS.join(', ')}`,
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

// â”€â”€ Migration DB safe (additive, idempotente) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Ajoute les colonnes routing si elles n'existent pas + backfill les donnÃ©es

async function ensureRoutingColumns(db) {
  const migrations = [
    // Relais : ajouter island_code standardisÃ©
    `ALTER TABLE relais ADD COLUMN IF NOT EXISTS island_code VARCHAR(20)`,
    // Orders : ajouter les 3 champs routing (nullable = rÃ©trocompatible)
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_island VARCHAR(20)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS routing_mode VARCHAR(20)`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS transit_hub VARCHAR(20)`,
  ];

  for (const sql of migrations) {
    try {
      await db.query(sql);
    } catch (e) {
      // Colonne existe dÃ©jÃ  ou autre erreur non critique
      if (!e.message.includes('already exists')) {
        log.warn(`[Routing] Migration warning: ${e.message}`);
      }
    }
  }

  // â”€â”€ Backfill island_code dans relais (depuis island human-readable) â”€â”€â”€â”€â”€â”€â”€â”€
  const BACKFILL_MAP = {
    'Anjouan':       'ANJOUAN',
    'Grande Comore': 'MORONI',
    'MohÃ©li':        'MOHELI',
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
        log.info(`[Routing] Backfill: ${rowCount} relais "${humanName}" â†’ ${code}`);
      }
    } catch (e) {
      log.warn(`[Routing] Backfill error: ${e.message}`);
    }
  }

  // â”€â”€ Backfill orders existantes (si relais a un code mais la commande non) â”€â”€
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

  log.info('âœ… Routing columns ready');
}

// â”€â”€ Exports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

module.exports = {
  resolveRoutingFromRelais,
  normalizeIsland,
  ensureRoutingColumns,
  RoutingError,
  DESTINATIONS,
  ROUTING_MODES,
  TRANSIT_HUB,
  ROUTING_RULES,
};
