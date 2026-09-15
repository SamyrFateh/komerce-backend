'use strict';

/**
 * scripts/lib/hub-authority.js — HUB-000 / F4 : Hub Authority Gate.
 *
 * Doctrine (arbitrage Option C, 2026-09) :
 *   "Logistics peut écrire dans une table partagée pour les colonnes/lifecycles
 *    opérationnels dont il est autorité, mais ne peut jamais écrire directement
 *    les champs représentant une autorité amont."
 *
 * Ce module ne réimplémente PAS extractSqlTableRefsRW (scripts/lib/arch-drift-core.js)
 * — il le réutilise pour F4-A, et ajoute un second parseur, volontairement étroit,
 * pour F4-B (colonnes protégées sur une table partagée). Aucun des deux n'est un
 * moteur SQL générique : le SQL non reconnu échoue fermé (voir extractOrdersColumnTargets).
 *
 * F4-A — TABLE_LEVEL_FORBIDDEN
 *   Tables où logistics n'a aujourd'hui AUCUN writer légitime (vérifié sur le
 *   graphe réel, 2026-09) : purchase_orders (writer unique = purchasing),
 *   product_skus (writer unique = catalog). Toute écriture directe (même
 *   honnêtement déclarée) d'un fichier @domain logistics est un FAIL.
 *
 *   `orders` n'est PAS dans cette liste : c'est une table partagée avec des
 *   écritures logistics légitimes (colonnes opérationnelles), passant toutes
 *   par les boundaries services/order-mutation-service.js et
 *   services/order-status-machine.js (@domain orders). Un ban table-level sur
 *   `orders` casserait ces écritures légitimes — voir F4-B pour la bonne
 *   granularité sur cette table précise.
 *
 * F4-B — PROTECTED_COLUMNS
 *   Colonnes de `orders` dont l'autorité appartient à un domaine amont
 *   (market / orders), jamais à logistics, même si un jour logistics écrivait
 *   du SQL brut sur `orders` :
 *     - market_id  : autorité Market (doctrine M1c, snapshot immuable)
 *     - relais_id  : autorité Orders — aucune écriture existante nulle part
 *                    dans le repo (vérifié, y compris côté orders) ; classé
 *                    protégé par arbitrage explicite (pas de dette à excuser).
 *
 * Domaines soumis au gate (le "Hub" doctrinal correspond au tag @domain
 * logistics dans les headers @komerce-arch existants).
 */

const fs = require('fs');
const path = require('path');

const core = require('./arch-drift-core');

const HUB_DOMAINS = new Set(['logistics']);

const TABLE_LEVEL_FORBIDDEN = new Set(['purchase_orders', 'product_skus']);

const PROTECTED_COLUMNS = {
  orders: new Set(['market_id', 'relais_id']),
};

/**
 * Retire commentaires JS/SQL d'une source, comme arch-drift-core le fait pour
 * extractSqlTableRefsRW — même traitement, dupliqué volontairement pour ne
 * pas coupler ce module à l'implémentation interne de arch-drift-core.
 */
function stripComments(source) {
  let s = String(source);
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/\/\/[^\n]*/g, ' ');
  s = s.replace(/--[^\n]*/g, ' ');
  return s;
}

/**
 * Découpe une liste séparée par des virgules en respectant la profondeur des
 * parenthèses (pour ne pas couper au milieu d'un COALESCE(a, b) par ex.).
 * Volontairement simple : pas de gestion de chaînes contenant des virgules
 * entre guillemets — suffisant pour des listes de colonnes/valeurs SQL.
 */
function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

/**
 * Cherche, dans le SET d'un UPDATE, chaque "colonne = valeur" au niveau
 * top-level (pas dans une sous-expression). Retourne la liste des noms de
 * colonnes à gauche du "=". Si un segment ne matche pas ce motif (ex. colonne
 * dynamique via interpolation JS type ${col} = ...), retourne null pour tout
 * le SET — signal d'échec de parsing, traité en fail-closed par l'appelant.
 */
function parseSetClauseColumns(setClause) {
  const segments = splitTopLevelCommas(setClause);
  const columns = [];
  for (const seg of segments) {
    const m = seg.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (!m) return null; // segment non reconnu -> échec de parsing global
    columns.push(m[1].toLowerCase());
  }
  return columns;
}

/**
 * F4-B — trouve, dans le SQL brut d'un fichier, chaque UPDATE/INSERT visant
 * directement `table` (nom passé en paramètre, ex. 'orders'), et retourne les
 * colonnes mutées. Formes supportées (cf. arbitrage F4, §6) :
 *
 *   UPDATE orders SET market_id = ...
 *   UPDATE orders o SET market_id = ...
 *   UPDATE orders SET status = ..., market_id = ...   (multi-ligne)
 *   INSERT INTO orders (..., market_id, ...) VALUES (...)
 *
 * Chaque occurrence retournée est soit { columns: [...] } soit
 * { unparseable: true } si la forme SQL touche `table` mais que les colonnes
 * n'ont pas pu être extraites avec confiance (fail-closed : jamais interprété
 * comme "aucune colonne protégée trouvée").
 */
function extractTableColumnTargets(source, table) {
  const s = stripComments(source);
  const results = [];

  const tblRe = `(?:public\\.)?"?${table}"?`;

  // UPDATE [ONLY] table [alias]? SET <clause> (borné par WHERE/RETURNING/backtick/fin)
  const updateRe = new RegExp(
    `\\bUPDATE\\s+(?:ONLY\\s+)?${tblRe}\\s*(?:AS\\s+)?([a-zA-Z_][a-zA-Z0-9_]*)?\\s+SET\\s+([\\s\\S]*?)(?:\\bWHERE\\b|\\bRETURNING\\b|\`|;|$)`,
    'gi'
  );
  let m;
  while ((m = updateRe.exec(s)) !== null) {
    // Un alias capturé qui vaut lui-même "SET" (ex: pas d'alias, "SET" suit
    // directement le nom de table) ne doit pas être traité comme un alias.
    const setClause = m[2];
    const columns = parseSetClauseColumns(setClause);
    if (columns === null) {
      results.push({ unparseable: true, kind: 'UPDATE' });
    } else {
      results.push({ columns, kind: 'UPDATE' });
    }
  }

  // INSERT INTO table (col1, col2, ...) VALUES (...)
  const insertRe = new RegExp(
    `\\bINSERT\\s+INTO\\s+${tblRe}\\s*\\(([^)]*)\\)`,
    'gi'
  );
  while ((m = insertRe.exec(s)) !== null) {
    const cols = m[1]
      .split(',')
      .map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase())
      .filter((c) => c.length > 0);
    if (cols.length === 0) {
      results.push({ unparseable: true, kind: 'INSERT' });
    } else {
      results.push({ columns: cols, kind: 'INSERT' });
    }
  }

  return results;
}

/**
 * Analyse complète F4-A + F4-B sur le repo réel. Lecture seule, aucun exit.
 * Retourne { violations, scannedFiles } où violations est une liste de
 * { file, domain, type, table, column? }.
 *
 *   type = 'TABLE_LEVEL_FORBIDDEN'        (F4-A)
 *        | 'PROTECTED_COLUMN'             (F4-B, colonne identifiée)
 *        | 'UNPARSEABLE_PROTECTED_TABLE_WRITE'  (F4-B, fail-closed)
 */
function analyzeHubAuthority(root = core.REPO_ROOT) {
  const graphPath = path.join(root, 'docs', 'komerce-arch-header-graph.json');
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const nodes = (graph.nodes || []).filter(
    (n) => (n.type === 'file' || n.type === 'file-lite') && n.file && HUB_DOMAINS.has(n.domain)
  );

  const violations = [];
  const scannedFiles = [];

  for (const n of nodes) {
    const abs = path.join(root, n.file);
    if (!fs.existsSync(abs)) continue;
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    scannedFiles.push(n.file);

    // F4-A : table-level, réutilise le noyau partagé (aucune duplication de
    // logique d'extraction table, uniquement la politique qui l'exploite).
    const { writes } = core.extractSqlTableRefsRW(src);
    for (const t of [...writes].sort()) {
      if (TABLE_LEVEL_FORBIDDEN.has(t)) {
        violations.push({ file: n.file, domain: n.domain, type: 'TABLE_LEVEL_FORBIDDEN', table: t });
      }
    }

    // F4-B : colonnes protégées sur les tables partagées déclarées dans PROTECTED_COLUMNS.
    for (const table of Object.keys(PROTECTED_COLUMNS)) {
      const targets = extractTableColumnTargets(src, table);
      for (const target of targets) {
        if (target.unparseable) {
          violations.push({
            file: n.file,
            domain: n.domain,
            type: 'UNPARSEABLE_PROTECTED_TABLE_WRITE',
            table,
          });
          continue;
        }
        for (const col of target.columns) {
          if (PROTECTED_COLUMNS[table].has(col)) {
            violations.push({ file: n.file, domain: n.domain, type: 'PROTECTED_COLUMN', table, column: col });
          }
        }
      }
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file));
  return { violations, scannedFiles };
}

module.exports = {
  HUB_DOMAINS,
  TABLE_LEVEL_FORBIDDEN,
  PROTECTED_COLUMNS,
  splitTopLevelCommas,
  parseSetClauseColumns,
  extractTableColumnTargets,
  analyzeHubAuthority,
};
