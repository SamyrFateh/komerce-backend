/**
 * @komerce-arch
 * @role          preflight-green-stamp
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   medium
 * @inputs        git HEAD, résultat de pr:preflight
 * @outputs       .git/komerce-preflight-green (SHA vérifié par scripts/hooks/pre-push)
 * @depends       none
 * @used-by       scripts/pr-preflight.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      AGENTS.md
 * @impact-areas  governance, developer-workflow
 * @version       2026-10-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STAMP_NAME = 'komerce-preflight-green';

/**
 * Le tampon n'est posé que si le preflight a validé exactement le commit qui
 * sera poussé : exécution réelle (pas --dry-run), sur HEAD, arbre suivi propre
 * au départ (sinon le preflight a validé un état qui n'est pas committé).
 * Retourne la raison du refus, ou null si le tampon peut être posé.
 */
function refusal({ dryRun, headRef, dirtyFiles }) {
  if (dryRun) return 'dry-run';
  if (headRef !== 'HEAD') return `--head ${headRef} n'est pas HEAD`;
  if (dirtyFiles > 0) return `${dirtyFiles} fichier(s) suivi(s) non committé(s)`;
  return null;
}

function writeGreen({ sha, gitPath, write = fs.writeFileSync }) {
  const file = gitPath(STAMP_NAME);
  write(path.resolve(file), `${sha}\n`);
  return file;
}

module.exports = { STAMP_NAME, refusal, writeGreen };
