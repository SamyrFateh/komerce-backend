'use strict';

/**
 * Initialiseur de recette « prix » (C2) — STAGING UNIQUEMENT, rejouable.
 *
 * - Refuse de tourner hors KOMERCE_TARGET_ENV=staging.
 * - Ne contient AUCUNE valeur de taux : elles viennent d'un fichier fourni par
 *   le responsable (--params fichier.json) avec leur source justifiée.
 *   Sans fichier ou sans valeur : statut « à renseigner », aucune écriture.
 * - Passe par le service canonique services/pricing-rates.updateRates
 *   (finance_config + historique exchange_rates). N'écrase rien si la valeur
 *   demandée est déjà en place (rejouable sans doublon).
 * - Sans --apply : simulation (dry-run), rien n'est écrit.
 *
 * Format du fichier : { "exchange_rates": { "eur_kmf": n, "aed_kmf": n,
 *   "source": "texte justifiant l'origine" }, "recette_label": "..." }
 */

const fs = require('fs');

function isPositive(n) { return typeof n === 'number' && Number.isFinite(n) && n > 0; }

async function runInit({ env = process.env, params = null, apply = false, db, ratesService, log = () => {} } = {}) {
  if (env.KOMERCE_TARGET_ENV !== 'staging') {
    const err = new Error('init-pricing-recette refusé : KOMERCE_TARGET_ENV doit valoir "staging".');
    err.code = 'TARGET_ENV_NOT_STAGING';
    throw err;
  }

  const report = { env: 'staging', mode: apply ? 'apply' : 'dry-run', items: [] };
  const wanted = params && params.exchange_rates ? params.exchange_rates : null;

  const hasValues = wanted && isPositive(wanted.eur_kmf) && isPositive(wanted.aed_kmf);
  if (!hasValues) {
    report.items.push({ key: 'exchange_rates', status: 'a_renseigner', reason: 'Aucune valeur fournie (eur_kmf et aed_kmf) : aucune écriture.' });
  } else if (!wanted.source || !String(wanted.source).trim()) {
    report.items.push({ key: 'exchange_rates', status: 'a_renseigner', reason: 'Valeurs fournies sans source justifiée : refusées.' });
  } else {
    const { rows: [cur] } = await db.query('SELECT taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id = 1');
    const same = cur && Number(cur.taux_change_eur_kmf) === wanted.eur_kmf && Number(cur.taux_aed_kmf) === wanted.aed_kmf;
    if (same) {
      report.items.push({ key: 'exchange_rates', status: 'deja_en_place' });
    } else if (!apply) {
      report.items.push({ key: 'exchange_rates', status: 'a_appliquer', from: cur || null, to: { eur_kmf: wanted.eur_kmf, aed_kmf: wanted.aed_kmf }, source: wanted.source });
    } else {
      await ratesService.updateRates({ eur_kmf: wanted.eur_kmf, aed_kmf: wanted.aed_kmf }, null);
      report.items.push({ key: 'exchange_rates', status: 'applique', from: cur || null, to: { eur_kmf: wanted.eur_kmf, aed_kmf: wanted.aed_kmf }, source: wanted.source, recette: params.recette_label || 'recette' });
    }
  }

  report.items.push({ key: 'relay_commission', status: 'a_renseigner', reason: 'Valeur et source à fournir par le responsable ; édition via le composant de coût canonique (hors de ce script).' });
  log(report);
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const idx = argv.indexOf('--params');
  const params = idx >= 0 ? JSON.parse(fs.readFileSync(argv[idx + 1], 'utf8')) : null;
  const db = require('../../db');
  const ratesService = require('../../services/pricing-rates');
  const report = await runInit({ params, apply, db, ratesService });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (db.pool && db.pool.end) await db.pool.end();
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}

module.exports = { runInit };
