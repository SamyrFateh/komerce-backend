'use strict';

/**
 * Initialiseur de recette « prix » (C2) — STAGING UNIQUEMENT, rejouable.
 *
 * Garanties :
 * - refuse hors KOMERCE_TARGET_ENV=staging ;
 * - ne contient aucune valeur : elles viennent d'un fichier --params, qui doit
 *   déclarer "is_test_data": true et une source pour chaque valeur ;
 * - n'écrase JAMAIS une configuration saisie par un opérateur (updated_by non nul) ;
 * - passe par les services canoniques (pricing-rates.updateRates,
 *   cost-component-admin-service.updateComponent) qui journalisent ;
 * - sans --apply : simulation ;
 * - les valeurs écrites ici n'ont pas d'auteur (updated_by nul) : le système les
 *   continue de présenter comme « non validées » et ne les qualifie pas de réelles ;
 * - EUR/KMF n'est pas touché : la colonne finance_config est en 2 décimales et
 *   ne peut pas porter la parité documentée (arbitrage séparé).
 * - Un fichier absent ou sans valeur donne « à renseigner », jamais une
 *   initialisation déclarée terminée.
 */

const fs = require('fs');

const RELAY_KEY = 'commission_relais_kmf';
const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const hasSource = (o) => Boolean(o && o.source && String(o.source).trim());

async function runInit({ env = process.env, params = null, apply = false, db, ratesService, componentService, log = () => {} } = {}) {
  if (env.KOMERCE_TARGET_ENV !== 'staging') {
    const err = new Error('init-pricing-recette refusé : KOMERCE_TARGET_ENV doit valoir "staging".');
    err.code = 'TARGET_ENV_NOT_STAGING';
    throw err;
  }
  const report = { env: 'staging', mode: apply ? 'apply' : 'dry-run', complete: false, items: [] };
  const add = (i) => report.items.push(i);

  if (!params) {
    add({ key: 'aed_kmf', status: 'a_renseigner', reason: 'Aucun fichier de valeurs fourni.' });
    add({ key: 'relay_commission_kmf', status: 'a_renseigner', reason: 'Aucun fichier de valeurs fourni.' });
    log(report);
    return report;
  }
  if (params.is_test_data !== true) {
    const err = new Error('Fichier refusé : "is_test_data": true est obligatoire (valeurs de recette uniquement).');
    err.code = 'PARAMS_NOT_MARKED_TEST';
    throw err;
  }

  // ── AED/KMF (EUR/KMF conservé tel quel) ───────────────────────────────────
  const aed = params.aed_kmf;
  if (!aed || !isPositive(aed.value) || !hasSource(aed)) {
    add({ key: 'aed_kmf', status: 'a_renseigner', reason: 'Valeur ou source absente : aucune écriture.' });
  } else {
    const { rows: [cur] } = await db.query('SELECT taux_change_eur_kmf, taux_aed_kmf, updated_by FROM finance_config WHERE id = 1');
    if (!cur) add({ key: 'aed_kmf', status: 'a_renseigner', reason: 'finance_config absent.' });
    else if (cur.updated_by) add({ key: 'aed_kmf', status: 'configuration_presente_non_ecrasee', current: Number(cur.taux_aed_kmf) });
    else if (Number(cur.taux_aed_kmf) === aed.value) add({ key: 'aed_kmf', status: 'deja_en_place' });
    else if (!apply) add({ key: 'aed_kmf', status: 'a_appliquer', from: Number(cur.taux_aed_kmf), to: aed.value, source: aed.source });
    else {
      await ratesService.updateRates({ eur_kmf: Number(cur.taux_change_eur_kmf), aed_kmf: aed.value }, null);
      add({ key: 'aed_kmf', status: 'applique', from: Number(cur.taux_aed_kmf), to: aed.value, source: aed.source, recette: params.recette_label });
    }
  }

  // ── Commission relais (composant canonique global) ────────────────────────
  const rel = params.relay_commission_kmf;
  if (!rel || !isPositive(rel.value) || !hasSource(rel)) {
    add({ key: 'relay_commission_kmf', status: 'a_renseigner', reason: 'Valeur ou source absente : aucune écriture.' });
  } else {
    const { rows: [comp] } = await db.query('SELECT default_value, updated_by FROM cost_components WHERE key = $1 AND is_active = TRUE LIMIT 1', [RELAY_KEY]);
    if (!comp) add({ key: 'relay_commission_kmf', status: 'a_renseigner', reason: 'Composant canonique absent.' });
    else if (comp.updated_by) add({ key: 'relay_commission_kmf', status: 'configuration_presente_non_ecrasee', current: Number(comp.default_value) });
    else if (Number(comp.default_value) === rel.value) add({ key: 'relay_commission_kmf', status: 'deja_en_place' });
    else if (!apply) add({ key: 'relay_commission_kmf', status: 'a_appliquer', from: Number(comp.default_value), to: rel.value, source: rel.source });
    else {
      await componentService.updateComponent({ key: RELAY_KEY }, { default_value: rel.value }, null);
      add({ key: 'relay_commission_kmf', status: 'applique', from: Number(comp.default_value), to: rel.value, source: rel.source, recette: params.recette_label });
    }
  }

  report.complete = report.items.every((i) => ['applique', 'deja_en_place'].includes(i.status));
  report.note = 'Valeurs de TEST : le système continue de les afficher comme non validées. Cet état n’est pas une initialisation métier.';
  log(report);
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const idx = argv.indexOf('--params');
  const params = idx >= 0 ? JSON.parse(fs.readFileSync(argv[idx + 1], 'utf8')) : null;
  const db = require('../../db');
  const report = await runInit({
    params, apply, db,
    ratesService: require('../../services/pricing-rates'),
    componentService: require('../../services/cost-component-admin-service'),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (db.pool && db.pool.end) await db.pool.end();
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}

module.exports = { runInit };
