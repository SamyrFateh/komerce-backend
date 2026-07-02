'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-promote
 * @domain       governance
 * @layer        tooling
 * @criticality  medium
 * @purpose      Promotion automatique post-deploy : les objets DB declares
 *               "vises par migration" dans SCHEMA.md (blocs schema-pending)
 *               deviennent des lignes de tableau des que le dump live les
 *               confirme. Supprime la corvee manuelle de promotion, sans
 *               jamais permettre au doc de devancer la prod.
 * @inputs       docs/SCHEMA.md, docs/db/railway-live-schema.sql,
 *               scripts/lib/arch-drift-core.js
 * @outputs      stdout report, [--write] reecrit docs/SCHEMA.md, exit code
 * @depends      scripts/lib/arch-drift-core.js
 * @used-by      .github/workflows/schema-refresh.yml (apres regeneration dump)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 * @version      2026-07
 *
 * Asymetrie volontaire (meme philosophie qu'arch-reconcile.js) :
 *   - PROMOUVOIR est automatique : un objet vise qui EXISTE dans le dump live
 *     passe du bloc schema-pending a une ligne de tableau SCHEMA.md.
 *   - DECLARER reste humain : ce script n'ajoute jamais de bloc schema-pending,
 *     ne touche jamais un bloc dont l'objet n'est pas encore live (attendre
 *     n'est pas une dette), et ne supprime jamais une ligne de tableau.
 *   Le doc ne peut donc jamais devancer la prod (gate:schema le garantit),
 *   et ne peut plus etre en retard sur elle par oubli (ce script le garantit).
 *
 * Convention de declaration dans docs/SCHEMA.md (bloc HTML invisible au
 * tokeniseur du gate de drift — seules les 1res cellules backtickees des
 * tableaux sont analysees) :
 *
 *   <!-- schema-pending
 *   object: v_shipment_density
 *   kind: view
 *   migration: 095
 *   section: ## 5. Vues critiques
 *   role: Densite par shipment (W/M, fill_rate_pct, margin_kmf_per_m3).
 *   consumers: Admin logistique / calibration V-5
 *   -->
 *
 *   - object    : nom exact de l'objet DB attendu dans le dump live
 *   - kind      : view | table (informatif)
 *   - migration : numero de la migration qui cree l'objet
 *   - section   : titre EXACT du heading dont le tableau recevra la ligne
 *   - role      : cellule "Role" de la future ligne
 *   - consumers : 3e cellule (tableaux a 3 colonnes uniquement, ex. §5)
 *
 * Modes :
 *   node scripts/schema-promote.js            # dry-run : montre le plan
 *   node scripts/schema-promote.js --write    # applique a SCHEMA.md
 *   node scripts/schema-promote.js --check    # CI : exit 1 si une promotion
 *                                             #      est due et non appliquee
 */

const fs = require('fs');
const core = require('./lib/arch-drift-core');

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

const PENDING_RE = /<!--\s*schema-pending\n([\s\S]*?)-->\n?/g;

function parseBlock(body) {
  const out = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildRow(b) {
  const promoNote = `**Migration ${b.migration} — promue le ${todayISO()} (schema-promote, dump live verifie).**`;
  return b.consumers
    ? `| \`${b.object}\` | ${b.role} ${promoNote} | ${b.consumers} |`
    : `| \`${b.object}\` | ${b.role} ${promoNote} |`;
}

/**
 * Insere une ligne a la fin du tableau markdown situe sous le heading donne.
 * Un tableau = suite contigue de lignes commencant par '|'. On insere apres
 * la derniere. Erreur explicite si le heading ou le tableau est introuvable
 * (fail loud : mieux vaut bloquer qu'ecrire au mauvais endroit).
 */
function insertRowUnderSection(md, sectionHeading, row) {
  const lines = md.split('\n');
  const hIdx = lines.findIndex(l => l.trim() === sectionHeading.trim());
  if (hIdx === -1) throw new Error(`Heading introuvable dans SCHEMA.md : "${sectionHeading}"`);

  let start = -1;
  for (let i = hIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;            // section suivante sans tableau
    if (lines[i].startsWith('|')) { start = i; break; }
  }
  if (start === -1) throw new Error(`Aucun tableau sous "${sectionHeading}"`);

  let end = start;
  while (end + 1 < lines.length && lines[end + 1].startsWith('|')) end++;

  lines.splice(end + 1, 0, row);
  return lines.join('\n');
}

function main() {
  const P = core.paths();
  const liveSql = fs.readFileSync(P.liveSql, 'utf8');
  const live = core.parseLiveSchema(liveSql);
  let md = fs.readFileSync(P.schema, 'utf8');

  const pending = [];
  let m;
  while ((m = PENDING_RE.exec(md)) !== null) {
    pending.push({ raw: m[0], ...parseBlock(m[1]) });
  }

  if (!pending.length) {
    console.log('✅ schema-promote : aucun bloc schema-pending dans SCHEMA.md.');
    process.exit(0);
  }

  const promotable = [];
  const waiting = [];
  const invalid = [];
  for (const b of pending) {
    if (!b.object || !b.section || !b.role || !b.migration) { invalid.push(b); continue; }
    (live.all.has(b.object) ? promotable : waiting).push(b);
  }

  console.log('============================================================');
  console.log('SCHEMA-PROMOTE — objets vises vs dump live');
  console.log(`Blocs schema-pending    : ${pending.length}`);
  console.log(`En attente de deploy    : ${waiting.length}${waiting.length ? ' (' + waiting.map(b => b.object).join(', ') + ')' : ''}`);
  console.log(`Promouvables (live OK)  : ${promotable.length}${promotable.length ? ' (' + promotable.map(b => b.object).join(', ') + ')' : ''}`);
  if (invalid.length) {
    console.log(`🚫 Blocs invalides (champs object/section/role/migration requis) : ${invalid.length}`);
    process.exit(1);
  }

  if (!promotable.length) {
    console.log('✅ Rien a promouvoir (attendre est sain, pas une dette).');
    process.exit(0);
  }

  if (CHECK && !WRITE) {
    console.log('🚫 Promotion(s) due(s) et non appliquee(s). Lancer : npm run schema:promote -- --write');
    process.exit(1);
  }

  for (const b of promotable) {
    md = md.replace(b.raw, '');                       // retirer le bloc
    md = insertRowUnderSection(md, b.section, buildRow(b));
    console.log(`   ↑ ${b.object} → ligne de tableau sous "${b.section}"`);
  }

  if (WRITE) {
    fs.writeFileSync(P.schema, md);
    console.log(`✅ SCHEMA.md mis a jour : ${promotable.length} promotion(s). Relancer gate:schema pour confirmer.`);
  } else {
    console.log('ℹ️  Dry-run : rien n\'a ete ecrit. Ajouter --write pour appliquer.');
  }
  process.exit(0);
}

main();
