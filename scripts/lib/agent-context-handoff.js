/**
 * @komerce-arch
 * @role          agent-context-handoff-projection
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   medium
 * @inputs        context packs (agent-context-pack), impact projections, AGENTS.md
 * @outputs       self-contained mission brief for a token-limited agent (--handoff)
 * @depends       scripts/lib/agent-context-pack.js, scripts/lib/agent-context-impact.js
 * @used-by       scripts/agent-context.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/AGENT_TOKEN_ECONOMY.md
 * @impact-areas  governance, developer-workflow
 * @version       2026-10-v1
 */
'use strict';

/**
 * `agent:context --handoff <type>` : brief de mission AUTONOME à coller dans
 * un agent externe (GPT, Sonnet gratuit…) qui n'a ni le dépôt complet ni le
 * budget pour lire AGENTS.md. Aucune règle nouvelle : les règles sont extraites
 * d'AGENTS.md (§0.1 dette, §8, §9) et le contexte vient des packs/impacts.
 */

const packLib = require('./agent-context-pack');
const impactLib = require('./agent-context-impact');

const DONE = Object.freeze([
  'annoncer un plan d’attaque court (demande, feature, opération, périmètre, hors périmètre, invariants, tests) avant de modifier',
  'ne toucher que des fichiers de la feature ci-dessus ; un fichier hors carte rend gate:touched-files rouge',
  'ajouter ou adapter un test pour chaque comportement changé',
  'si l’intention métier change : mettre à jour la carte dans le même changement',
  'npm run pr:preflight vert sur un arbre propre, puis un seul push (le hook pre-push refuse un commit sans preflight vert)',
  'si un élément de la mission repose sur une hypothèse fausse du dépôt : s’arrêter et proposer l’ajustement minimal',
]);

function section(markdown, heading) {
  const lines = String(markdown || '').split('\n');
  const start = lines.findIndex(l => l.startsWith(heading));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function bullets(lines) {
  const out = [];
  for (const line of lines) {
    if (/^- /.test(line)) out.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

/** Règles non négociables, extraites d'AGENTS.md (source unique). */
function rulesFromAgents(markdown) {
  const rules = bullets(section(markdown, '## 8.'));
  const debt = section(markdown, '## 0.1.').find(l => l.startsWith('Règle dette'));
  if (debt) rules.unshift(debt.replace(/^Règle dette\s*:\s*/, 'Dette : '));
  const divergence = section(markdown, '## 9.').map(l => l.trim()).filter(Boolean)[0];
  if (divergence) rules.push(divergence);
  return rules;
}

function withoutBudget(text) {
  return String(text).replace(/\nbudget: .*$/, '');
}

function renderHandoff({ task, packs, impacts = [], agentsMd }) {
  const rules = rulesFromAgents(agentsMd);
  if (!rules.length) throw new Error('--handoff : règles introuvables dans AGENTS.md (§8 attendu)');
  const out = [];
  out.push(`MISSION KOMERCE${task ? ` : ${task}` : ''}`);
  out.push('Ce brief se suffit à lui-même ; AGENTS.md fait foi en cas de doute.');
  out.push(`\nRÈGLES NON NÉGOCIABLES (${rules.length}):\n${rules.map(r => `  - ${r}`).join('\n')}`);
  for (const pack of packs) out.push(`\n${withoutBudget(packLib.renderPack(pack))}`);
  for (const impact of impacts) out.push(`\n${withoutBudget(impactLib.renderImpact(impact))}`);
  out.push(`\nDÉFINITION DE FINI (${DONE.length}):\n${DONE.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`);
  const body = out.join('\n');
  return `${body}\nbudget: ${body.length} chars ≈ ${Math.ceil(body.length / 4)} tokens`;
}

module.exports = { DONE, renderHandoff, rulesFromAgents };
