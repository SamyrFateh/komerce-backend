'use strict';

/**
 * scripts/lib/feature-dependency-observer.js
 *
 * Lot O5 — Canal A (static local import/require observation).
 *
 * Ce module ne fait QUE deux choses :
 *   1. extraction regex des cibles require()/import() STATIQUES (littéral
 *      string) dans un fichier source, et des appels DYNAMIQUES non résolvables
 *      statiquement (variable, template avec interpolation, concaténation) ;
 *   2. résolution PHYSIQUE sur disque de la cible relative (candidats
 *      d'extension standards Node), puis conversion en fileId via la fonction
 *      `resolveAbsToFileId` fournie par l'appelant.
 *
 * Il ne fait JAMAIS de résolution métier : pas de owner, pas de feature, pas
 * de collapse. Ces responsabilités appartiennent exclusivement à
 * feature-dependency-conformance.js (bridges O4). Ce module ignore aussi
 * délibérément les spécificateurs "bare" (packages npm, builtins Node type
 * "fs", "path", alias non relatifs type "@scope/x") : ce ne sont pas des
 * dépendances locales au sens du Canal A, et ne sont donc ni "resolved" ni
 * "dynamic" — elles ne génèrent aucune preuve, silencieusement.
 *
 * Résolution volontairement PERMISSIVE côté frontière de scope (mission O5
 * §2, décisions de conception point 2) : un import relatif qui traverse
 * physiquement une racine de scope (ex. depuis public/boutique/js/x.js vers
 * ../../../services/payment-service.js) DOIT être observé s'il se résout
 * réellement sur disque — la restriction "bridges O4 uniquement" s'applique
 * au COLLAPSE vers l'identité canonique (fait par le module appelant), pas à
 * cette observation physique.
 */

const fs = require('fs');
const path = require('path');

// ── Extraction ──────────────────────────────────────────────────────────
// Appels require(...) / import(...) — capture l'argument brut jusqu'à la
// PREMIÈRE parenthèse fermante (limitation connue et documentée : un appel
// avec parenthèses imbriquées dans l'argument, ex. require(path.join(a,b)),
// n'est pas reconstitué au-delà de cette première fermeture — traité comme
// dynamique dans ce cas, jamais deviné).
const REQUIRE_CALL_RE = /\brequire\(([^)]*)\)/g;
const IMPORT_CALL_RE = /\bimport\(([^)]*)\)/g;
// Un argument est un littéral statique SIMPLE seulement s'il est ENTIÈREMENT
// une chaîne quote->quote, sans rien avant/après (donc "'./x' + name" ou
// "cond ? 'a' : 'b'" ne matchent pas ce test et tombent en dynamique).
const PURE_STRING_LITERAL_RE = /^(['"])((?:(?!\1).)*)\1$/;
// ES import statique : "import x from 'y'", "import 'y'", "import x, {a} from 'y'"
const STATIC_IMPORT_RE = /\bimport\s+(?:[^'";]*?\sfrom\s+)?(['"])((?:(?!\1).)+)\1/g;
// ES re-export : "export ... from 'y'"
const STATIC_EXPORT_FROM_RE = /\bexport\s+(?:[^'";]*?\sfrom\s+)?(['"])((?:(?!\1).)+)\1/g;

const RESOLVE_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.json'];
const RESOLVE_INDEX_FILES = ['index.js', 'index.mjs', 'index.cjs', 'index.json'];

function truncateRaw(s) {
  const t = s.trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/**
 * Résout un spécificateur relatif ('./x', '../../y') depuis le dossier d'un
 * fichier source vers un chemin absolu réel sur disque, ou null si aucune
 * variante candidate n'existe (fichier supprimé/déplacé, ou cible qui n'est
 * simplement pas un fichier — hors périmètre observable, pas une dette).
 */
function resolveRelativeOnDisk(sourceAbsPath, spec) {
  const baseDir = path.dirname(sourceAbsPath);
  const rawResolved = path.resolve(baseDir, spec);

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = rawResolved + ext;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* accès impossible, on continue */ }
  }
  for (const idx of RESOLVE_INDEX_FILES) {
    const candidate = path.join(rawResolved, idx);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* accès impossible, on continue */ }
  }
  return null;
}

function isLocalSpecifier(spec) {
  // Relatif (./x, ../x) ou racine disque explicite (/x) — jamais un bare
  // specifier (paquet npm, builtin Node, alias non relatif).
  return spec.startsWith('.') || spec.startsWith('/');
}

/**
 * @param {Array<{fileId:string, absPath:string}>} files
 * @param {(absPath:string) => (string|null)} resolveAbsToFileId
 * @returns {{ byFile: Map<string, {resolved:Array<{targetFile:string}>, dynamic:Array<{kind:string, raw:string}>}> }}
 */
function scanLocalDependencies(files, resolveAbsToFileId) {
  const byFile = new Map();

  for (const { fileId, absPath } of files) {
    let content;
    try {
      content = fs.readFileSync(absPath, 'utf8');
    } catch {
      // Fichier illisible (déjà censé exister — cas limite, on l'ignore
      // silencieusement plutôt que de faire échouer tout le scan O5).
      byFile.set(fileId, { resolved: [], dynamic: [] });
      continue;
    }

    const resolved = [];
    const dynamic = [];
    const seenTargets = new Set();

    const handleStaticSpec = (spec) => {
      if (!spec || !isLocalSpecifier(spec)) return; // bare specifier : hors Canal A, silencieux
      const abs = resolveRelativeOnDisk(absPath, spec);
      if (!abs) return; // cible relative introuvable sur disque : rien à affirmer
      const targetFile = resolveAbsToFileId(abs);
      if (!targetFile) return; // hors de toute racine de scope connue
      if (targetFile === fileId) return; // self-reference triviale
      if (seenTargets.has(targetFile)) return;
      seenTargets.add(targetFile);
      resolved.push({ targetFile });
    };

    const runStatic = (re, group) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content))) {
        handleStaticSpec(m[group]);
        if (m[0].length === 0) re.lastIndex++; // garde-fou anti-boucle infinie
      }
    };

    // require(...) / import(...) : argument entièrement littéral -> statique,
    // sinon (variable, concaténation, ternaire, template avec interpolation,
    // appel imbriqué non capturé en entier) -> dynamique non résolu.
    const runCall = (re, kind) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content))) {
        const argRaw = (m[1] || '').trim();
        if (argRaw) {
          const lit = PURE_STRING_LITERAL_RE.exec(argRaw);
          if (lit) {
            handleStaticSpec(lit[2]);
          } else {
            dynamic.push({ kind, raw: truncateRaw(argRaw) });
          }
        }
        if (m[0].length === 0) re.lastIndex++;
      }
    };

    runCall(REQUIRE_CALL_RE, 'require');
    runCall(IMPORT_CALL_RE, 'import');
    runStatic(STATIC_IMPORT_RE, 2);
    runStatic(STATIC_EXPORT_FROM_RE, 2);

    byFile.set(fileId, { resolved, dynamic });
  }

  return { byFile };
}

module.exports = { scanLocalDependencies, resolveRelativeOnDisk, isLocalSpecifier };
