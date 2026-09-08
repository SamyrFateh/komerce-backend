'use strict';

/**
 * Garde-fou anti-dérive de prose pour I-BACK-10.
 *
 * Contexte : migrations/GAPS.md et scripts/backend-audit.js mentionnent en
 * toutes lettres ("sept", "huit"...) le nombre d'ensembles de collisions
 * réaudités. Ce nombre est une chaîne de texte libre — rien ne garantissait
 * qu'il suive l'ajout ou le retrait d'un token COLLISION dans GAPS.md. C'est
 * exactement ce qui s'est produit : le total réel est passé à 8 (ajout du
 * token 157) sans que la prose ne soit mise à jour, et est resté faux
 * plusieurs semaines sans qu'aucun gate ne le détecte.
 *
 * Ce module compare le nombre réel de tokens COLLISION documentés dans
 * GAPS.md (source de vérité, cf. migration-collision-policy.js) au nombre
 * écrit en toutes lettres à chaque emplacement de prose connu. Un nouvel
 * emplacement peut être ajouté à WORDING_LOCATIONS sans toucher au reste.
 */

const fs = require('fs');
const path = require('path');
const { parseReviewedCollisionSets } = require('./migration-collision-policy');

// Nombres français couverts : largement suffisant pour ce compteur, qui ne
// grandit que d'une unité à la fois au fil des collisions historiques.
const FRENCH_NUMBERS = {
  un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14,
  quinze: 15, seize: 16,
};

// Chaque emplacement : un fichier + une regex avec un groupe capturant le
// mot-nombre en toutes lettres. La regex doit matcher exactement une fois.
const WORDING_LOCATIONS = [
  {
    file: path.join('migrations', 'GAPS.md'),
    pattern: /Les (\p{L}+) ensembles ci-dessous ont été réaudités/u,
  },
  {
    file: path.join('scripts', 'backend-audit.js'),
    pattern: /les (\p{L}+) ensembles exacts de/u,
  },
];

function checkCollisionCountWording({ rootDir } = {}) {
  const root = rootDir || process.cwd();
  const migrationsDir = path.join(root, 'migrations');
  const gapsContent = fs.readFileSync(path.join(migrationsDir, 'GAPS.md'), 'utf8');
  const { reviewed } = parseReviewedCollisionSets(gapsContent);
  const actualCount = reviewed.size;

  const violations = [];

  for (const { file, pattern } of WORDING_LOCATIONS) {
    const fullPath = path.join(root, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const match = content.match(pattern);

    if (!match) {
      violations.push({
        file,
        kind: 'pattern-not-found',
        message: `Emplacement de prose introuvable (le texte a peut-être été reformulé) — mettre à jour WORDING_LOCATIONS dans collision-count-wording-check.js`,
      });
      continue;
    }

    const word = match[1].toLowerCase();
    const wordedCount = FRENCH_NUMBERS[word];

    if (wordedCount == null) {
      violations.push({
        file,
        kind: 'unknown-word',
        message: `Mot-nombre "${word}" non reconnu — ajouter à FRENCH_NUMBERS si légitime`,
      });
      continue;
    }

    if (wordedCount !== actualCount) {
      violations.push({
        file,
        kind: 'count-mismatch',
        expected: actualCount,
        found: wordedCount,
        word,
        message: `"${word}" (${wordedCount}) ne correspond pas au nombre réel de collisions documentées dans GAPS.md (${actualCount})`,
      });
    }
  }

  return { actualCount, violations };
}

function main() {
  const { actualCount, violations } = checkCollisionCountWording({ rootDir: process.env.ROOT || process.cwd() });

  if (violations.length > 0) {
    console.error(`\n  ❌  Décompte en toutes lettres désynchronisé (réel : ${actualCount}) :\n`);
    for (const v of violations) {
      console.error(`     ✗  ${v.file} — ${v.message}`);
    }
    console.error('\n  → Mettre à jour le mot-nombre pour refléter le total réel de tokens COLLISION dans migrations/GAPS.md.\n');
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) main();

module.exports = { checkCollisionCountWording, FRENCH_NUMBERS, WORDING_LOCATIONS };
