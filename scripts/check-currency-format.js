'use strict';

/**
 * @komerce-arch
 * @role         governance-currency-format-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Gate anti-dette devise : refuse toute NOUVELLE colonne
 *               monetaire suffixee d'un code devise (montant_kmf, price_eur,
 *               cost_aed...). Le format canonique est un montant `numeric`
 *               accompagne d'une colonne `currency` explicite — celui
 *               qu'utilise deja market_settlements (amount NUMERIC(24,6) +
 *               currency TEXT).
 *
 *               Contexte (audit devise, 09-2026) : 121 colonnes monetaires
 *               existent deja, dont 73 en `integer`. Un `integer` ne peut
 *               structurellement pas porter de centimes ; sur un marche en
 *               EUR (Mayotte, deja nomme dans DOCTRINE_AUTONOMIE_RESPONSABLE_
 *               PAYS §4), chaque montant perdrait ses centimes par
 *               troncature silencieuse. Ce gate ne repare pas l'existant : il
 *               empeche la dette de croitre pendant que les lots de
 *               conversion avancent domaine par domaine.
 *
 *               Sans ce gate, on convertirait d'un cote pendant qu'on
 *               ajouterait de l'autre.
 * @inputs       migrations/*.sql
 * @outputs      stdout report, exit code
 * @depends      none
 * @used-by      npm run arch:gate (local + CI)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci, economic-engine
 * @version      2026-09
 *
 * Principe :
 *   On ne lit que les migrations dont le numero est STRICTEMENT SUPERIEUR au
 *   plus haut numero existant au moment ou ce gate est introduit (BASELINE).
 *   L'historique est immuable (cf. check-migration-immutability.js) et n'a
 *   donc pas a etre juge : le retro-corriger serait reecrire le passe. Seul
 *   ce qui s'ajoute apres doit respecter le format cible.
 *
 * Limites assumees (heuristique, pas un parseur SQL complet) :
 *   - Ne detecte que les declarations de colonnes dans CREATE TABLE et
 *     ALTER TABLE ... ADD COLUMN. Une colonne creee par un DO $$ dynamique
 *     passerait au travers.
 *   - Le jeu de devises surveille est explicite (voir CURRENCY_CODES) plutot
 *     que "3 lettres majuscules", pour ne pas confondre un suffixe metier
 *     legitime avec un code ISO.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

// Numero de la derniere migration existante a l'introduction du gate.
// Tout ce qui est <= BASELINE releve de l'historique immuable et des lots de
// conversion planifies (audit devise, etapes 2 a 4), pas de ce gate.
const BASELINE = 210;

// Codes devise reellement manipules par Komerce aujourd'hui. Liste explicite
// et non "[A-Z]{3}" : `total_ttc` ou `poids_net` ne doivent jamais etre pris
// pour des colonnes monetaires.
const CURRENCY_CODES = ['kmf', 'eur', 'aed', 'usd', 'xaf', 'cdf', 'cny', 'mga'];

// Deux formes reconnues :
//   1. Declaration de colonne dans un CREATE TABLE (la colonne ouvre la ligne)
//   2. ADD COLUMN, y compris inline dans un ALTER TABLE sur une seule ligne
//      (`ALTER TABLE t ADD COLUMN x_kmf INTEGER;`) — forme courante que la
//      version initiale de ce gate ratait, trouvee par test de mutation.
const CURRENCY_GROUP = `[a-z0-9_]+_(?:${CURRENCY_CODES.join('|')})`;
const CREATE_COLUMN_RE = new RegExp(`^\\s*(${CURRENCY_GROUP})\\s+`, 'i');
const ADD_COLUMN_RE = new RegExp(
  `\\bADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${CURRENCY_GROUP})\\b`,
  'i'
);

function migrationNumber(filename) {
  const match = filename.match(/^(\d+)_/);
  return match ? Number(match[1]) : null;
}

const DROP_COLUMN_RE = new RegExp(
  String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${CURRENCY_GROUP})\b`,
  'i'
);

function scanMigration(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const offenders = [];

  // Une colonne DROP puis re-ADD dans la MEME migration n'est pas une
  // nouvelle colonne : c'est la meme, restauree. Cas reel rencontre en
  // migration 221 — customs_delta_kmf est une colonne GENEREE, et Postgres
  // refuse d'alterer le type de ses sources tant qu'elle existe : la seule
  // voie est DROP + recreation a l'identique. Compter cette recreation comme
  // une violation forcerait soit a renommer la colonne (changement de
  // contrat pour ses consommateurs), soit a contourner le gate — deux
  // mauvaises reponses a une operation legitime.
  const recreated = new Set();
  for (const line of content.split('\n')) {
    const withoutComment = line.split('--')[0];
    const drop = withoutComment.match(DROP_COLUMN_RE);
    if (drop) recreated.add(drop[1].toLowerCase());
  }

  content.split('\n').forEach((line, index) => {
    // Ignore les commentaires : une explication qui mentionne price_kmf n'est
    // pas une declaration de colonne.
    const withoutComment = line.split('--')[0];
    if (!withoutComment.trim()) return;

    const match = withoutComment.match(ADD_COLUMN_RE) || withoutComment.match(CREATE_COLUMN_RE);
    if (match) {
      if (recreated.has(match[1].toLowerCase())) return;
      offenders.push({ line: index + 1, column: match[1], raw: withoutComment.trim() });
    }
  });

  return offenders;
}

function runCheck({ root = ROOT, print = true } = {}) {
  const dir = path.join(root, 'migrations');
  const files = fs.readdirSync(dir)
    .filter(name => name.endsWith('.sql'))
    .filter(name => {
      const number = migrationNumber(name);
      return number !== null && number > BASELINE;
    })
    .sort();

  const violations = [];
  for (const file of files) {
    for (const offender of scanMigration(path.join(dir, file))) {
      violations.push({ file, ...offender });
    }
  }

  const ok = violations.length === 0;

  if (print) {
    console.log('============================================================');
    console.log(' KOMERCE - Porte format devise (nouvelles colonnes)');
    console.log('============================================================');
    console.log(`Baseline                : migration ${BASELINE} (historique non juge)`);
    console.log(`Migrations examinees    : ${files.length}`);
    console.log(`Violations              : ${violations.length}`);
    console.log('');

    if (!ok) {
      console.error('--- COLONNES MONETAIRES SUFFIXEES D\'UNE DEVISE ---');
      for (const violation of violations) {
        console.error(`  ${violation.file}:${violation.line}`);
        console.error(`      ${violation.column}  →  ${violation.raw}`);
      }
      console.error('');
      console.error('Format attendu : un montant `numeric` + une colonne `currency` explicite.');
      console.error('Exemple deja en place dans le repo (migration 208, market_settlements) :');
      console.error('      amount    NUMERIC(24,6) NOT NULL CHECK (amount > 0),');
      console.error("      currency  TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),");
      console.error('');
      console.error('Pourquoi : un montant dont la devise est dans le NOM de la colonne ne peut');
      console.error('pas suivre le marche. 73 colonnes `integer` existantes perdront leurs');
      console.error('centimes des qu\'un marche en EUR sera actif (Mayotte). On n\'en ajoute plus.');
      console.error('');
      console.error('============================================================');
      console.error(`🚫 ${violations.length} nouvelle(s) colonne(s) monetaire(s) au mauvais format.`);
    } else {
      console.log('============================================================');
      console.log('✅ Aucune nouvelle colonne monetaire suffixee d\'une devise.');
    }
  }

  return { ok, violations, scanned: files.length, baseline: BASELINE };
}

if (require.main === module) {
  const result = runCheck();
  if (!result.ok) process.exitCode = 1;
}

module.exports = { runCheck, scanMigration, BASELINE, CURRENCY_CODES };
