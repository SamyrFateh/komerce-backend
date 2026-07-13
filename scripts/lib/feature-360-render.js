'use strict';

/**
 * feature-360-render.js — rendu docs/FEATURE_360.md (mission §19, Lot O8).
 *
 *   Vue de pilotage, pas un dump JSON : scorecard global, table de synthèse,
 *   puis une section par feature (service, owns/exposes/consumes/consumed by,
 *   projections, boundary/governance health, dette, résumé d'implémentation).
 *   Détails complets (fichiers, tables, interfaces) disponibles dans
 *   docs/FEATURE_360.json — le Markdown masque le bruit, jamais la vérité.
 *
 * Exporte renderMd(model) -> string (déterministe, même ordre que model.features).
 */

function esc(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|');
}

function statusBadge(status) {
  return { HEALTHY: '🟢 HEALTHY', ATTENTION: '🟡 ATTENTION', BLOCKED: '🔴 BLOCKED' }[status] || status;
}

function listOrNone(arr, fn) {
  if (!arr || !arr.length) return '_aucune_';
  return arr.map(fn).join(', ');
}

// perimeter est soit une chaîne libre, soit la forme Feature Card { in: [...], out: [...] }.
// Projeter tel quel — jamais reformuler le contenu déclaré.
function renderPerimeter(perimeter) {
  if (!perimeter) return null;
  if (typeof perimeter === 'string') return [`**Perimeter** : ${perimeter}`, ''];
  const lines = ['**Perimeter** :'];
  if (perimeter.in && perimeter.in.length) {
    lines.push('- _in_ :');
    for (const x of perimeter.in) lines.push(`  - ${x}`);
  }
  if (perimeter.out && perimeter.out.length) {
    lines.push('- _out_ :');
    for (const x of perimeter.out) lines.push(`  - ${x}`);
  }
  lines.push('');
  return lines;
}

function renderScorecard(s) {
  return [
    '## Global scorecard',
    '',
    `- Features : **${s.features}**`,
    `- Healthy : **${s.healthy}**`,
    `- Attention : **${s.attention}**`,
    `- Blocked : **${s.blocked}**`,
    `- Business dependencies : **${s.businessDependencies}**`,
    `- Direct cross-feature imports : **${s.directCrossFeatureImports}**`,
    `- Runtime cycles : **${s.runtimeCycles}**`,
    `- Ambiguous ownership signals : **${s.ambiguousOwnershipSignals}**`,
    `- Ontology gaps : **${s.ontologyGaps}**`,
    `- Debt items (total) : **${s.debtItemsTotal}**`,
    '',
  ].join('\n');
}

function renderTable(features) {
  const rows = features.map(f => {
    const owns = listOrNone(f.data.ownsTables, t => t.table);
    const consumes = listOrNone(f.businessDependencies, d => d.provider);
    const consumedBy = listOrNone(f.consumedBy, d => d.consumer);
    return `| ${esc(f.id)} | ${esc(f.kind)} | ${statusBadge(f.boundaryHealth.status)} | ${statusBadge(f.governanceHealth.status)} | ${esc(owns)} | ${esc(consumes)} | ${esc(consumedBy)} | ${f.architecturalDebt.debtCount} |`;
  });
  return [
    '## Features',
    '',
    '| Feature | Kind | Boundary | Governance | Owns | Consumes | Consumed by | Debt |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function renderFeatureSection(f) {
  const lines = [];
  lines.push(`## ${f.id}`, '');
  lines.push(`**Kind** : ${f.kind}  ·  **Status** : ${f.status}`, '');
  if (f.service) lines.push(`**Service** : ${f.service}`, '');
  const perimeterLines = renderPerimeter(f.perimeter);
  if (perimeterLines) lines.push(...perimeterLines);
  if (f.authority) lines.push(`**Authority** : ${f.authority}`, '');
  if (f.invariants && f.invariants.length) {
    lines.push('**Invariants** :');
    for (const inv of f.invariants) lines.push(`- ${inv}`);
    lines.push('');
  }

  // Owns / writes
  lines.push('**Owns** : ' + listOrNone(f.data.ownsTables, t => `\`${t.table}\``));
  const writesNotOwned = f.data.writesTables.filter(t => t.ownershipStatus !== 'owner');
  if (writesNotOwned.length) {
    lines.push('**Writes (not owner)** : ' + writesNotOwned.map(t => `\`${t.table}\` (${t.ownershipStatus})`).join(', '));
  }
  lines.push('');

  // Exposes
  const apiCount = f.interfaces.internalApis.length;
  const httpCount = f.interfaces.httpInterfaces.count;
  lines.push(`**Exposes** : ${apiCount} internal API(s), ${httpCount} HTTP interface(s)`);
  if (apiCount) {
    lines.push(...f.interfaces.internalApis.slice(0, 10).map(a => `  - \`${a.fn}\` ${a.file ? `(${a.file})` : ''} — ${a.status}`));
    if (apiCount > 10) lines.push(`  - _...${apiCount - 10} de plus, voir FEATURE_360.json_`);
  }
  lines.push('');

  // Consumes / Consumed by
  lines.push('**Consumes** : ' + listOrNone(f.businessDependencies, d => `${d.provider} (${d.disposition})`));
  lines.push('**Consumed by** : ' + listOrNone(f.consumedBy, d => `${d.consumer} (${d.disposition})`));
  lines.push('');

  // Projections
  lines.push('**Projections** : ' + listOrNone(f.projections.projectedBy, x => x));
  lines.push('');

  // Technical context (bruit masqué mais traçable)
  const tc = f.technicalContext;
  lines.push(`**Technical context** : ${tc.technicalPrimitiveDependencies} primitive dependencies, ${tc.testOnlyRelations} test-only, ${tc.compositionRootRelations} composition-root`);
  lines.push('');

  // Boundary / Governance health
  const bh = f.boundaryHealth;
  lines.push(`**Boundary health** : ${statusBadge(bh.status)} — cross-feature imports: ${bh.directCrossFeatureImports}, runtime cycles: ${bh.runtimeCycles}, unclassified: ${bh.unclassifiedDependencies}, declared-not-observed: ${bh.declaredNotObserved}`);
  const gh = f.governanceHealth;
  lines.push(`**Governance health** : ${statusBadge(gh.status)} — orphan files: ${gh.orphanFiles}, unresolved internal APIs: ${gh.unresolvedInternalApis}, declared-only deps: ${gh.declaredOnlyDependencyCount}, ambiguous ownership: ${gh.ambiguousOwnershipCount}, ontology gaps: ${gh.ontologyGapsLinked}`);
  lines.push('');

  // Debt
  if (f.architecturalDebt.debtCount) {
    lines.push(`**Architectural debt** (${f.architecturalDebt.debtCount}) :`);
    for (const d of f.architecturalDebt.debtItems) lines.push(`- \`${d.type}\` (${d.severity}) — ${d.evidence}`);
  } else {
    lines.push('**Architectural debt** : _aucune_');
  }
  lines.push('');

  // Implementation summary (résumé, pas de dump)
  const cats = Object.keys(f.implementation.byCategory).sort();
  lines.push(`**Implementation** : ${f.implementation.totalFiles} fichier(s) déclaré(s)` + (f.implementation.boutiqueManifest ? `, boutique: ${f.implementation.boutiqueFiles.count} fichier(s)` : ''));
  if (cats.length) {
    lines.push(...cats.map(c => `  - ${c} : ${f.implementation.byCategory[c].count}`));
  }
  lines.push('');
  lines.push(`_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="${f.id}"]_`);
  lines.push('');

  return lines.join('\n');
}

function renderMd(model) {
  const parts = [];
  parts.push('# FEATURE 360', '');
  parts.push('_Projection déterministe de lecture au-dessus de la chaîne Feature First O2-O7.3 déjà gouvernée. Feature 360 ne crée aucune nouvelle vérité architecturale ; toute correction se fait dans la source autoritaire existante._', '');
  parts.push(renderScorecard(model.summary));
  parts.push(renderTable(model.features));
  for (const f of model.features) parts.push(renderFeatureSection(f));
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = { renderMd };
