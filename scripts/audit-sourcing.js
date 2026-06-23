#!/usr/bin/env node
/**
 * audit-sourcing.js — Garde-fou sourcing Komerce (Lot C7)
 *
 * Vérifie les invariants DB du module sourcing.
 * Plante (exit 1) si une violation est détectée.
 *
 * Usage : node scripts/audit-sourcing.js
 *         npm run sourcing:audit
 *
 * Nécessite DATABASE_URL en variable d'environnement.
 * En CI, passer DATABASE_URL=... ou utiliser les secrets Railway.
 *
 * Sortie : exit 0 si tout passe, exit 1 sinon.
 * En mode --check (CI bloquant) : même comportement.
 * En mode --observe : affiche les problèmes sans planter.
 */

'use strict';

const { Client } = require('pg');

const OBSERVE = process.argv.includes('--observe');

// ──────────────────────────────────────────────────────────────────────────────
// Rails et partner_types valides (doit rester synchronisé avec sourcing-mutations.js)
// ──────────────────────────────────────────────────────────────────────────────

const VALID_RAILS = new Set(['A', 'B', 'C', 'D']);

const VALID_PARTNER_TYPES = new Set([
  'relais_simple',
  'relais_showroom',
  'partenaire_avance',
  'atelier_couture',
  'artisan_retouche',
  'franchise_s5',
]);

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const violations = [];
const warnings   = [];

function violation(check, message, rows) {
  violations.push({ check, message, count: rows.length, examples: rows.slice(0, 3) });
}

function warning(check, message, rows) {
  warnings.push({ check, message, count: rows.length, examples: rows.slice(0, 3) });
}

// ──────────────────────────────────────────────────────────────────────────────
// Checks
// ──────────────────────────────────────────────────────────────────────────────

async function runChecks(client) {

  // ── S-01 : Produits actifs sans aucun coût (aucun fallback possible) ────────
  {
    const { rows } = await client.query(`
      SELECT id, name, price_kmf
      FROM products
      WHERE is_active = true
        AND (cost_kmf IS NULL OR cost_kmf = 0)
        AND (cost_price_kmf IS NULL OR cost_price_kmf = 0)
      ORDER BY name
      LIMIT 20
    `);
    if (rows.length > 0) {
      violation(
        'S-01',
        `${rows.length} produits actifs sans coût (cost_kmf et cost_price_kmf absents) — décision sourcing impossible`,
        rows.map(r => `${r.id} "${r.name}" prix=${r.price_kmf}KMF`)
      );
    }
  }

  // ── S-02 : Divergence entre colonnes coût dupliquées ───────────────────────
  // (quand les deux sont renseignées et non nulles, elles doivent être égales)
  {
    const { rows } = await client.query(`
      SELECT id, name, cost_kmf, cost_price_kmf,
             ABS(cost_kmf - cost_price_kmf) AS diff_kmf
      FROM products
      WHERE cost_kmf IS NOT NULL AND cost_kmf > 0
        AND cost_price_kmf IS NOT NULL AND cost_price_kmf > 0
        AND cost_kmf <> cost_price_kmf
      ORDER BY diff_kmf DESC
      LIMIT 20
    `);
    if (rows.length > 0) {
      violation(
        'S-02',
        `${rows.length} produits avec cost_kmf ≠ cost_price_kmf (divergence doublon — Lot C5 requis)`,
        rows.map(r => `${r.id} "${r.name}" cost_kmf=${r.cost_kmf} cost_price_kmf=${r.cost_price_kmf} (diff=${r.diff_kmf}KMF)`)
      );
    }
  }

  // ── S-03 : Poids négatif ou aberrant (> 100 kg) ────────────────────────────
  {
    const { rows } = await client.query(`
      SELECT id, name, weight_kg, weight_g
      FROM products
      WHERE weight_kg < 0
         OR (weight_g IS NOT NULL AND weight_g < 0)
         OR weight_kg > 100
         OR (weight_g IS NOT NULL AND weight_g > 100000)
      ORDER BY name
      LIMIT 20
    `);
    if (rows.length > 0) {
      violation(
        'S-03',
        `${rows.length} produits avec poids négatif ou aberrant (> 100 kg)`,
        rows.map(r => `${r.id} "${r.name}" weight_kg=${r.weight_kg} weight_g=${r.weight_g}`)
      );
    }
  }

  // ── S-04 : Rails invalides ─────────────────────────────────────────────────
  {
    const { rows } = await client.query(`
      SELECT id, name, sourcing_rail
      FROM products
      WHERE sourcing_rail IS NOT NULL
        AND sourcing_rail NOT IN ('A', 'B', 'C', 'D')
      ORDER BY sourcing_rail, name
      LIMIT 20
    `);
    if (rows.length > 0) {
      violation(
        'S-04',
        `${rows.length} produits avec sourcing_rail invalide (valeurs attendues : A, B, C, D)`,
        rows.map(r => `${r.id} "${r.name}" rail="${r.sourcing_rail}"`)
      );
    }
  }

  // ── S-05 : partner_type inconnu ────────────────────────────────────────────
  {
    const { rows } = await client.query(`
      SELECT id, name, partner_type
      FROM partners
      WHERE partner_type NOT IN (
        'relais_simple', 'relais_showroom', 'partenaire_avance',
        'atelier_couture', 'artisan_retouche', 'franchise_s5'
      )
      ORDER BY partner_type, name
      LIMIT 20
    `);
    if (rows.length > 0) {
      violation(
        'S-05',
        `${rows.length} partners avec partner_type inconnu (hors liste des 6 types valides)`,
        rows.map(r => `${r.id} "${r.name}" type="${r.partner_type}"`)
      );
    }
  }

  // ── S-06 : sourcing_candidates avec komerce_category orpheline ─────────────
  // (warn uniquement — customs_categories peut avoir des clés variables)
  {
    const { rows } = await client.query(`
      SELECT sc.id, sc.product_name, sc.komerce_category
      FROM sourcing_candidates sc
      WHERE sc.komerce_category IS NOT NULL
        AND sc.state NOT IN ('rejected', 'archived')
        AND NOT EXISTS (
          SELECT 1 FROM customs_categories cc
          WHERE cc.key = sc.komerce_category
        )
      ORDER BY sc.komerce_category
      LIMIT 20
    `).catch(() => ({ rows: [] })); // customs_categories peut ne pas exister en CI

    if (rows.length > 0) {
      warning(
        'S-06',
        `${rows.length} sourcing_candidates avec komerce_category introuvable dans customs_categories`,
        rows.map(r => `${r.id} "${r.product_name}" catégorie="${r.komerce_category}"`)
      );
    }
  }

  // ── S-07 : Divergence colonnes poids dupliquées ────────────────────────────
  // (warn — même pattern que S-02 mais pour le poids, moins critique car
  //  le pricing utilise weight_kg directement)
  {
    const { rows } = await client.query(`
      SELECT id, name, weight_kg,
             weight_g,
             ABS(ROUND(weight_kg::numeric * 1000) - weight_g) AS diff_g
      FROM products
      WHERE weight_kg IS NOT NULL AND weight_kg > 0
        AND weight_g IS NOT NULL AND weight_g > 0
        AND ABS(ROUND(weight_kg::numeric * 1000) - weight_g) > 10
      ORDER BY diff_g DESC
      LIMIT 20
    `);
    if (rows.length > 0) {
      warning(
        'S-07',
        `${rows.length} produits avec weight_kg et weight_g divergents (diff > 10g — Lot C5 requis)`,
        rows.map(r => `${r.id} "${r.name}" weight_kg=${r.weight_kg} weight_g=${r.weight_g} (diff=${r.diff_g}g)`)
      );
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[audit-sourcing] DATABASE_URL non définie — skip (mode CI sans DB)');
    process.exit(0);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await runChecks(client);
  } finally {
    await client.end();
  }

  // ── Rapport ────────────────────────────────────────────────────────────────

  const ok = violations.length === 0;

  if (warnings.length > 0) {
    console.warn('\n⚠️  audit-sourcing — avertissements :');
    for (const w of warnings) {
      console.warn(`  [${w.check}] ${w.message}`);
      for (const ex of w.examples) console.warn(`    → ${ex}`);
    }
  }

  if (violations.length > 0) {
    console.error('\n❌ audit-sourcing — violations :');
    for (const v of violations) {
      console.error(`  [${v.check}] ${v.message}`);
      for (const ex of v.examples) console.error(`    → ${ex}`);
    }
  }

  if (ok && warnings.length === 0) {
    console.log('✅ audit-sourcing — 0 violation, 0 avertissement');
  } else if (ok) {
    console.log(`✅ audit-sourcing — 0 violation, ${warnings.length} avertissement(s)`);
  }

  if (!ok && !OBSERVE) {
    console.error(`\naudit-sourcing EXIT 1 — ${violations.length} violation(s). Corriger avant déploiement.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[audit-sourcing] Erreur inattendue :', err.message);
  process.exit(1);
});
