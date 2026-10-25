'use strict';

/**
 * @komerce-arch
 * @role          logic-risk-static-detectors
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        JavaScript source text + tracked file path
 * @outputs       read-only heuristic findings; never a confirmed business bug
 * @depends       none
 * @used-by       scripts/audit-logic.js, tests/unit/logic-detectors.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      invariant_executable_non_speculatif
 */
const RULES = Object.freeze({
  'LS-01': { category: 'WF', priority: 'P1', title: 'Changement direct de statut commande hors machine canonique (suspect)' },
  'LS-06': { category: 'FIN', priority: 'P2', title: 'Appel PSP externe : vérifier intention durable et rapprochement après réponse' },
  'LS-02': { category: 'FIN', priority: 'P1', title: 'Appel PSP potentiellement inclus dans une transaction SQL' },
  'LS-03': { category: 'FIN', priority: 'P1', title: 'Cle d idempotence derivee du temps (instable au rejeu)' },
  'LS-04': { category: 'DAT', priority: 'P1', title: 'Mutation directe de la composition des colis hors service canonique' },
  'LS-05': { category: 'DAT', priority: 'P1', title: 'Conflit silencieux pendant une operation sur les colis' },
});

function lineOf(src, offset) {
  return src.slice(0, offset).split('\n').length;
}
function normalizedSnippet(src) {
  return String(src).trim().replace(/\s+/g, ' ').slice(0, 170);
}
function scanSource(source, name) {
  const file = String(name).replace(/\\/g, '/').replace(/^\.\//, '');
  const findings = [];
  const seen = new Set();
  function add(rule, offset, matched) {
    const line = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset + 1).trim();
    if (/^(?:\/\/|\*|#)/.test(line)) return;
    const snippet = normalizedSnippet(matched);
    const fingerprint = [file, rule, snippet.toLowerCase()].join('|');
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    findings.push({
      rule, category: RULES[rule].category, priority: RULES[rule].priority,
      status: 'SUSPICION_STATIQUE', propagation: 'NON_ETABLIE',
      title: RULES[rule].title, file, line: lineOf(source, offset),
      snippet, fingerprint,
    });
  }
  // Contrôle plus large : un appel PSP est une frontière non atomique avec SQL.
  const externalCall = /\b(?:stripe\.refunds\.create|paypal\.refundCapture|paypal\.captureOrder)\s*\(/g;
  for (const match of source.matchAll(externalCall)) {
    add('LS-06', match.index, match[0]);
    const recent = source.slice(Math.max(0, match.index - 3000), match.index);
    const begin = Math.max(recent.lastIndexOf("'BEGIN'"), recent.lastIndexOf('"BEGIN"'));
    const end = Math.max(recent.lastIndexOf("'COMMIT'"), recent.lastIndexOf("'ROLLBACK'"), recent.lastIndexOf('"COMMIT"'), recent.lastIndexOf('"ROLLBACK"'));
    if (begin >= 0 && begin > end) add('LS-02', match.index, match[0]);
  }
  // Autorise les valeurs sur plusieurs lignes ; évite de s'arrêter au premier \n.
  const transientKey = /(?:idempotencyKey|PayPal-Request-Id|Request-Id)\s*['"`]?\s*[:=]\s*[\s\S]{0,240}?\bDate\.now\s*\(/g;
  for (const match of source.matchAll(transientKey)) add('LS-03', match.index, match[0]);
  // SQL potentiellement caché dans un gabarit multi-lignes ; idem Opus, juste suspicion.
  const directStatus = /\bUPDATE\s+(?:public\.)?orders(?:\s+(?:AS\s+)?[a-z_]+)?\s+SET\s+(?:status|payment_status)\s*=/gi;
  for (const match of source.matchAll(directStatus)) {
    if (!file.endsWith('services/order-status-machine.js')) add('LS-01', match.index, match[0]);
  }
  const membership = /\b(?:INSERT\s+INTO|DELETE\s+FROM)\s+(?:public\.)?parcel_items\b/gi;
  for (const match of source.matchAll(membership)) {
    if (!file.endsWith('services/parcel-item-mutation-service.js')) add('LS-04', match.index, match[0]);
  }
  const conflict = /\bON\s+CONFLICT(?:\s*\([^)]*\))?\s+DO\s+NOTHING\b/gi;
  for (const match of source.matchAll(conflict)) {
    const nearby = source.slice(Math.max(0, match.index - 2000), match.index + 220);
    if (/\bparcel_items\b/i.test(nearby)) add('LS-05', match.index, match[0]);
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
module.exports = { RULES, scanSource, lineOf, normalizedSnippet };
