'use strict';

/**
 * KOMERCE — Backfill manuel routing + parcel external_code
 * ============================================================================
 * FIX 2026-07-09 : ces deux backfills tournaient auparavant au boot du
 * serveur public (dans ensureRoutingColumns / ensureSecurityTables), sur une
 * table `orders`/`parcels` sous trafic live. Résultat en prod : timeout
 * boot-guard (15s) sur les deux étapes, connexions du pool immobilisées par
 * des requêtes toujours en cours côté DB (Promise.race ne les annule pas),
 * catalogue en spinner pendant que le pool se vide.
 *
 * Ce script les exécute désormais hors du chemin de boot, en une passe
 * manuelle et contrôlée — idéalement en heure creuse, avec `lock_timeout`
 * court pour échouer vite (et pouvoir relancer plus tard) plutôt que de
 * bloquer indéfiniment derrière du trafic concurrent.
 *
 * Usage :
 *   node scripts/backfill-boot-data.js               # les deux backfills
 *   node scripts/backfill-boot-data.js --routing-only
 *   node scripts/backfill-boot-data.js --parcels-only
 *   node scripts/backfill-boot-data.js --lock-timeout-ms=5000   # défaut 5000
 */

const db = require('../db');
const routingService = require('../services/routing');
const parcelSecurity = require('../services/parcel-security');
const log = require('../utils/logger').forModule('backfill-boot-data');

function parseArgs(argv) {
  const args = { routing: true, parcels: true, lockTimeoutMs: 5000 };
  for (const arg of argv) {
    if (arg === '--routing-only') { args.parcels = false; }
    else if (arg === '--parcels-only') { args.routing = false; }
    else if (arg.startsWith('--lock-timeout-ms=')) {
      args.lockTimeoutMs = parseInt(arg.split('=')[1], 10) || args.lockTimeoutMs;
    }
  }
  return args;
}

async function withShortLockTimeout(lockTimeoutMs, fn) {
  // lock_timeout : si la requête ne peut pas obtenir son verrou tout de
  // suite (contention avec du trafic live), elle échoue immédiatement au
  // lieu d'attendre — on préfère un échec explicite (à relancer plus tard)
  // à un blocage silencieux qui immobilise une connexion du pool.
  await db.query(`SET lock_timeout = '${lockTimeoutMs}ms'`);
  try {
    return await fn();
  } finally {
    await db.query(`SET lock_timeout = DEFAULT`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log.info({ args }, 'Backfill boot-data — démarrage');

  if (args.routing) {
    log.info('→ Backfill routing (relais.island_code + orders.destination_island/routing_mode/transit_hub)');
    await withShortLockTimeout(args.lockTimeoutMs, () => routingService.backfillRoutingData(db));
  } else {
    log.info('→ Backfill routing ignoré (--parcels-only)');
  }

  if (args.parcels) {
    log.info('→ Backfill parcels.external_code (colis orphelins)');
    await withShortLockTimeout(args.lockTimeoutMs, () => parcelSecurity.backfillParcelExternalCodes(db));
  } else {
    log.info('→ Backfill parcels ignoré (--routing-only)');
  }

  log.info('Backfill boot-data — terminé');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
