'use strict';

/**
 * Inventaire historique — LECTURE SEULE (aucune écriture, transaction READ ONLY).
 *
 * Affiche : identité de la base ciblée (nom, version ; jamais l'URL ni de secret),
 * anciennes lignes `monthly_recalc` (par type/source/is_actual), impact par commande
 * (réel actuel vs réel justifié vs legacy), relay `is_actual` sans source composant,
 * colis mélangeant des marchés (garde #2660).
 * Dry-run de réparation : propose pour chaque commande ancienne valeur → nouvelle valeur
 * (sans lignes non justifiées), sans rien modifier ni supprimer.
 */

const { notLegacyUnjustifiedSql, justifiedRealSql } = require('../../services/cost-allocation/cost-expectation');
const { PARCEL_MARKET_VIOLATIONS_SQL } = require('../../services/parcel-item-mutation-service');

async function runInventory({ db, env = process.env, limit = 200 } = {}) {
  if (!env.KOMERCE_TARGET_ENV) {
    const err = new Error('inventaire refusé : définir KOMERCE_TARGET_ENV (staging|production) pour tracer la cible.');
    err.code = 'TARGET_ENV_MISSING';
    throw err;
  }
  await db.query('BEGIN READ ONLY');
  try {
    const { rows: [target] } = await db.query(
      "SELECT current_database() AS database, current_setting('server_version') AS server_version, now() AS at");
    const { rows: legacy } = await db.query(
      `SELECT a.cost_type::text AS cost_type, a.source, a.is_actual, COUNT(*)::int AS lignes,
              COUNT(DISTINCT a.order_id)::int AS commandes, SUM(a.amount_kmf)::bigint AS total_kmf
         FROM order_item_real_cost_allocations a
        WHERE NOT ${notLegacyUnjustifiedSql('a')}
        GROUP BY 1,2,3 ORDER BY 1`);
    const { rows: perOrder } = await db.query(
      `SELECT o.id, o.reference, o.status::text AS status,
              SUM(a.amount_kmf) FILTER (WHERE a.is_actual) AS ancienne_valeur_reelle,
              SUM(a.amount_kmf) FILTER (WHERE ${justifiedRealSql('a')}) AS nouvelle_valeur_justifiee,
              SUM(a.amount_kmf) FILTER (WHERE NOT ${notLegacyUnjustifiedSql('a')}) AS lignes_non_justifiees_kmf,
              COUNT(DISTINCT a.cost_type) FILTER (WHERE ${justifiedRealSql('a')})::int AS types_justifies
         FROM orders o
         JOIN order_item_real_cost_allocations a ON a.order_id = o.id
        GROUP BY o.id
       HAVING BOOL_OR(NOT ${notLegacyUnjustifiedSql('a')})
        ORDER BY o.created_at DESC
        LIMIT $1`, [limit]);
    const { rows: [relay] } = await db.query(
      `SELECT COUNT(*)::int AS lignes_relay_is_actual
         FROM order_item_real_cost_allocations
        WHERE cost_type::text = 'relay' AND is_actual`);
    const { rows: marketViolations } = await db.query(PARCEL_MARKET_VIOLATIONS_SQL);
    return {
      mode: 'lecture_seule',
      target,
      legacy_lines: legacy,
      repair_dry_run: perOrder.map((r) => ({
        ...r,
        note: 'Aucune écriture : proposition d\'affichage uniquement ; les lignes legacy restent en base, non certifiées.',
      })),
      relay_is_actual: relay,
      parcel_market_violations: marketViolations,
    };
  } finally {
    await db.query('ROLLBACK');
  }
}

async function main() {
  const db = require('../../db');
  const out = await runInventory({ db });
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (db.pool && db.pool.end) await db.pool.end();
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}

module.exports = { runInventory };
