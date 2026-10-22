#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          fx-observation-cli
 * @domain        market
 * @layer         script
 * @criticality   high
 * @inputs        cli_args, DATABASE_URL
 * @outputs       fx_rate_observation
 * @depends       services/fx-observation-service.js, db.js
 * @used-by       docs/doctrine/FX_CHAIN_DJF.md
 * @db-read       fx_rate_observations
 * @db-write      fx_rate_observations
 * @doctrine      two_person_rule, no_invented_rate
 * @version       2026-10
 *
 * Saisie / approbation de l'observation EUR/USD hors interface (procédure initiale à deux personnes).
 * AUCUN taux par défaut : le taux, sa source et sa date viennent d'une source publiée (ex. taux de référence BCE).
 *
 *   node scripts/fx-observation-cli.js enter   --by alice@komerce.km --rate <USD pour 1 EUR> --as-of <ISO> --source "BCE taux de référence" [--ref <url|id>]
 *   node scripts/fx-observation-cli.js approve --by bob@komerce.km   --id <uuid>
 *   node scripts/fx-observation-cli.js list
 */
'use strict';

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
  const [cmd] = argv;
  const svc = require('../services/fx-observation-service');
  if (cmd === 'enter') {
    return svc.enterObservation({
      rate: arg(argv, 'rate'), sourceLabel: arg(argv, 'source'), sourceRef: arg(argv, 'ref'),
      asOf: arg(argv, 'as-of'), enteredBy: arg(argv, 'by'),
    });
  }
  if (cmd === 'approve') return svc.approveObservation({ id: arg(argv, 'id'), approvedBy: arg(argv, 'by') });
  if (cmd === 'list') return svc.listObservations({ limit: arg(argv, 'limit') });
  throw new Error('Usage : enter | approve | list (voir l\'en-tête du script)');
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((out) => { console.log(JSON.stringify(out, null, 2)); process.exit(0); })
    .catch((err) => { console.error(`✖ ${err.code || ''} ${err.message}`); process.exit(1); });
}

module.exports = { main };
