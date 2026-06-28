#!/usr/bin/env node
'use strict';

/**
 * pr-governance-check.js — Gate PR : plan d'attaque obligatoire
 *
 *   Principe : toute PR doit contenir un "plan d'attaque" structuré dans
 *   son body. Ce script est déclenché par CI sur pull_request et lit le
 *   body via l'API GitHub (GITHUB_TOKEN requis).
 *
 *   Un body valide doit contenir au minimum :
 *     1. Une section "## Pourquoi" (ou "## Why" / "## Motivation") — cause racine
 *     2. Une section "## Quoi" (ou "## What" / "## Changes") — périmètre des changements
 *     3. Une section "## Tests" (ou "## Vérification" / "## Verification") — preuve
 *
 *   Les PRs de type "chore", "docs", "hotfix" déclarées en préfixe de titre
 *   bénéficient d'un mode allégé (seul ## Pourquoi requis).
 *
 *   Variables d'environnement requises (injectées par GitHub Actions) :
 *     GITHUB_TOKEN         — token d'accès API
 *     GITHUB_REPOSITORY    — "owner/repo"
 *     PR_NUMBER            — numéro de PR (ex: ${{ github.event.pull_request.number }})
 *
 * Usage :
 *   node scripts/pr-governance-check.js
 *   node scripts/pr-governance-check.js --dry-run   # rapport seul, exit 0
 */

const https = require('https');

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const C = {
  red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m',
  dim: '\x1b[2m',  bld: '\x1b[1m',  r:   '\x1b[0m',
};

// ── Variables CI ─────────────────────────────────────────────────────────────
const GITHUB_TOKEN      = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;         // "owner/repo"
const PR_NUMBER         = process.env.PR_NUMBER
                        || process.env.GITHUB_PR_NUMBER
                        || extractPrFromRef(process.env.GITHUB_REF);

function extractPrFromRef(ref) {
  // GITHUB_REF = refs/pull/42/merge  →  42
  const m = (ref || '').match(/refs\/pull\/(\d+)\//);
  return m ? m[1] : null;
}

// ── Sections requises ─────────────────────────────────────────────────────────
const SECTIONS_FULL = [
  { label: 'Pourquoi / Why / Motivation', patterns: [/^##\s+(pourquoi|why|motivation)/im] },
  { label: 'Quoi / What / Changes',       patterns: [/^##\s+(quoi|what|changes?|périmètre)/im] },
  { label: 'Tests / Vérification',        patterns: [/^##\s+(tests?|vérification|verification)/im] },
];

// Mode allégé : chore / docs / hotfix / bump / release
const SECTIONS_LITE = [
  { label: 'Pourquoi / Why', patterns: [/^##\s+(pourquoi|why|motivation)/im] },
];

const LITE_PREFIXES = /^(chore|docs|doc|hotfix|bump|release|revert)(\([\w-]+\))?[!:]/i;

// ── Fetch PR body via API GitHub ─────────────────────────────────────────────
function apiFetch(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent':    'komerce-pr-governance',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept':        'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Analyse du body ──────────────────────────────────────────────────────────
function checkBody(title, body) {
  const isLite    = LITE_PREFIXES.test(title || '');
  const sections  = isLite ? SECTIONS_LITE : SECTIONS_FULL;
  const bodyText  = body || '';
  const missing   = [];

  for (const sec of sections) {
    const found = sec.patterns.some(p => p.test(bodyText));
    if (!found) missing.push(sec.label);
  }

  return { isLite, sections, missing };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bld}╔═══════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.bld}║  PR GOVERNANCE — plan d'attaque obligatoire   ║${C.r}`);
  console.log(`${C.bld}╚═══════════════════════════════════════════════╝${C.r}\n`);

  // Pré-conditions
  if (!GITHUB_TOKEN) {
    console.error(`${C.red}✖ GITHUB_TOKEN absent — impossible de lire la PR via l'API.${C.r}`);
    console.error(`  Ajouter : env: { GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }} } dans le workflow.`);
    process.exit(DRY_RUN ? 0 : 1);
  }

  if (!GITHUB_REPOSITORY || !PR_NUMBER) {
    // Hors contexte PR (push sur main) — on passe silencieusement
    console.log(`${C.dim}Hors contexte PR (pas de PR_NUMBER) — gate ignoré.${C.r}\n`);
    process.exit(0);
  }

  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  console.log(`${C.dim}Repo : ${owner}/${repo}  ·  PR #${PR_NUMBER}${C.r}\n`);

  // Fetch
  let pr;
  try {
    const { status, body } = await apiFetch(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}`);
    if (status !== 200) {
      console.error(`${C.red}✖ API GitHub : HTTP ${status}${C.r}`);
      console.error(`  ${JSON.stringify(body.message || body)}`);
      process.exit(DRY_RUN ? 0 : 1);
    }
    pr = body;
  } catch (e) {
    console.error(`${C.red}✖ Erreur réseau API GitHub : ${e.message}${C.r}`);
    process.exit(DRY_RUN ? 0 : 1);
  }

  const title  = pr.title  || '';
  const body   = pr.body   || '';
  const draft  = pr.draft;
  const author = pr.user && pr.user.login;

  console.log(`Titre : ${C.bld}${title}${C.r}`);
  console.log(`Auteur: ${author}  ·  Draft: ${draft ? 'oui' : 'non'}`);
  console.log(`Body  : ${body.length} caractères\n`);

  // Body totalement absent → blocage immédiat, même en draft
  if (!body.trim()) {
    console.log(`${C.red}✖ Body PR vide.${C.r}`);
    console.log(`  Ajouter au minimum :\n`);
    console.log(`  ## Pourquoi\n  <cause racine>\n`);
    console.log(`  ## Quoi\n  <périmètre des changements>\n`);
    console.log(`  ## Tests\n  <preuve de non-régression>\n`);
    process.exit(DRY_RUN ? 0 : 1);
  }

  const { isLite, sections, missing } = checkBody(title, body);

  if (isLite) {
    console.log(`${C.dim}Mode allégé (préfixe chore/docs/hotfix/…)${C.r}`);
  }

  // Rapport sections
  for (const sec of sections) {
    const found = !missing.includes(sec.label);
    console.log(`  ${found ? C.grn + '✔' : C.red + '✖'}${C.r} ${sec.label}`);
  }

  console.log();

  if (missing.length === 0) {
    console.log(`${C.grn}✔ Plan d'attaque complet — PR conforme.${C.r}\n`);
    process.exit(0);
  }

  // Sections manquantes
  console.log(`${C.red}✖ Section(s) manquante(s) dans le body PR :${C.r}`);
  for (const m of missing) console.log(`    – ${m}`);
  console.log();
  console.log(`  Ajouter ces sections en markdown (## Titre) dans la description de la PR.`);
  console.log(`  Voir docs/CONTRIBUTING.md §PR pour le template complet.\n`);

  if (DRY_RUN) {
    console.log(`${C.ylw}▲ --dry-run : exit 0 (rapport seul).${C.r}\n`);
    process.exit(0);
  }

  process.exit(1);
}

main().catch(e => {
  console.error(`${C.red}✖ Erreur inattendue : ${e.message}${C.r}`);
  process.exit(1);
});
