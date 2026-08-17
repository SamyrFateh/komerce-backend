'use strict';

/**
 * scripts/lib/table-ownership.js — résolution table -> { writers, readers,
 * lifecycleOwner } et détection WRITER-NOT-OWNER (campagne gouvernance
 * 2026-08, cf. AGENTS.md « WRITES != OWNS »).
 *
 * Extrait de business-graph-gen.js (§5.4) pour être testable en isolation,
 * même pattern que scripts/lib/feature-dependency-conformance.js et
 * scripts/lib/feature-dependency-disposition.js : une fonction pure prenant
 * un modèle en entrée, aucun accès disque.
 *
 * Marqueurs par entrée db.tables (parseDbTables) :
 *   'table: W!'   -> ce feature est le lifecycle owner déclaré de la table
 *   'table: RW~'  -> écriture technique sans décision métier (cron de purge,
 *                    simulateur de démo, migration de démarrage — aucune
 *                    autorité métier) ; ne compte JAMAIS comme "extra
 *                    writer" concurrent d'un owner déjà résolu
 * Le booléen classification.signals.ownsTables + l'ancienne résolution
 * restent le fallback pour toute table qui n'a pas encore reçu de marqueur
 * explicite.
 */

function parseDbTables(manifest) {
  const out = [];
  const tables = (manifest.db && manifest.db.tables) || [];
  for (const t of tables) {
    const m = String(t).match(/^([a-zA-Z0-9_.]+)\s*:\s*(RW|R|W)(!|~)?\s*$/);
    if (!m) { out.push({ raw: t, unparsed: true }); continue; }
    out.push({ table: m[1], mode: m[2], declaredOwner: m[3] === '!', technical: m[3] === '~' });
  }
  return out;
}

/**
 * @param {Array<object>} manifests - manifests chargés (feature/dash/boutique),
 *   chacun avec { name, __broken?, db: { tables: [...] }, classification? }
 * @returns {{ tableOwnership: object, warns: Array<{type,ref,msg}> }}
 */
function resolveTableOwnership(manifests) {
  const warns = [];
  const tableIndex = {}; // table -> { writers:[{feature,mode,declaredOwner,technical}], readers:[feature] }

  for (const m of manifests) {
    if (m.__broken) continue;
    for (const entry of parseDbTables(m)) {
      if (entry.unparsed) {
        warns.push({ type: 'DB-TABLES-ENTRY-UNPARSED', ref: m.name, msg: `entrée db.tables illisible : "${entry.raw}"` });
        continue;
      }
      const rec = (tableIndex[entry.table] = tableIndex[entry.table] || { writers: [], readers: [] });
      if (entry.mode === 'R') rec.readers.push(m.name);
      else rec.writers.push({ feature: m.name, mode: entry.mode, declaredOwner: !!entry.declaredOwner, technical: !!entry.technical });
    }
  }

  const tableOwnership = {};
  for (const [table, rec] of Object.entries(tableIndex)) {
    const writerNames = rec.writers.map(w => w.feature);
    const declaredOwners = rec.writers.filter(w => w.declaredOwner).map(w => w.feature);
    const technicalWriters = new Set(rec.writers.filter(w => w.technical).map(w => w.feature));
    let lifecycleOwner = null, resolution;
    if (declaredOwners.length === 1) {
      lifecycleOwner = declaredOwners[0];
      resolution = 'declared-table-owner';
    } else if (declaredOwners.length > 1) {
      resolution = 'conflicting-declared-owner';
    } else if (writerNames.length === 1) {
      lifecycleOwner = writerNames[0];
      resolution = 'single-writer';
    } else if (writerNames.length > 1) {
      const owningCandidates = writerNames.filter(fn => {
        const m = manifests.find(mm => mm.name === fn);
        return m && m.classification && m.classification.signals && m.classification.signals.ownsTables === true;
      });
      if (owningCandidates.length === 1) {
        lifecycleOwner = owningCandidates[0];
        resolution = 'multi-writer-resolved-by-classification-signal';
      } else {
        resolution = 'ambiguous-multi-writer';
      }
    } else {
      resolution = 'no-declared-writer';
    }

    tableOwnership[table] = {
      writers: rec.writers, readers: rec.readers.slice().sort(),
      lifecycleOwner, resolution,
    };

    if (resolution === 'conflicting-declared-owner') {
      warns.push({
        type: 'WRITER-NOT-OWNER', ref: table,
        msg: `table "${table}" a ${declaredOwners.length} owners déclarés en conflit (${declaredOwners.join(', ')}) via le marqueur "!" — déclaration fautive à corriger, un seul owner autorisé`,
      });
    } else if (resolution === 'ambiguous-multi-writer') {
      warns.push({
        type: 'WRITER-NOT-OWNER', ref: table,
        msg: `table "${table}" a ${writerNames.length} écrivain(s) déclaré(s) (${writerNames.join(', ')}) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur`,
      });
    } else if (
      (resolution === 'multi-writer-resolved-by-classification-signal' || resolution === 'declared-table-owner')
      && writerNames.length > 1
    ) {
      // Un écrivain marqué technical (~) n'exprime aucune décision métier
      // (cron de purge, simulateur de démo, migration de démarrage) : il ne
      // compte jamais comme concurrent de l'owner déjà résolu, et ne doit
      // plus être émis comme warning à la source une fois la preuve établie
      // (cf. governance/data-ownership.json, arbitrage 2026-07-29).
      const others = writerNames.filter(w => w !== lifecycleOwner && !technicalWriters.has(w));
      if (others.length > 0) {
        const ownerLabel = resolution === 'declared-table-owner' ? 'db.tables "!"' : 'classification.signals.ownsTables';
        warns.push({
          type: 'WRITER-NOT-OWNER', ref: table,
          msg: `table "${table}" : lifecycle owner = ${lifecycleOwner} (${ownerLabel}), mais aussi écrite par ${others.join(', ')}`,
        });
      }
    }
  }

  return { tableOwnership, warns };
}

module.exports = { parseDbTables, resolveTableOwnership };
