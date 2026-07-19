#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fail(message, code = 1) {
  console.error(`STOP: ${message}`);
  process.exit(code);
}

function findRepoRoot() {
  let current = process.cwd();
  while (!fs.existsSync(path.join(current, '.agent', 'MANIFEST.json'))) {
    const parent = path.dirname(current);
    if (parent === current) fail('dépôt .agent introuvable');
    current = parent;
  }
  return current;
}

function run(repo, args, { inherit = false } = {}) {
  return spawnSync(args[0], args.slice(1), {
    cwd: repo,
    encoding: 'utf8',
    shell: false,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024
  });
}

function git(repo, ...args) {
  return run(repo, ['git', ...args]);
}

function output(result, label) {
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`${label}${detail ? `\n${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  const optionArgs = separator === -1 ? argv : argv.slice(0, separator);
  const files = separator === -1 ? [] : argv.slice(separator + 1).filter(Boolean);
  let message = '';

  for (let index = 0; index < optionArgs.length; index += 1) {
    if (optionArgs[index] === '--message') {
      message = optionArgs[index + 1] || '';
      index += 1;
      continue;
    }
    fail(`option inconnue: ${optionArgs[index]}`);
  }

  if (!message.trim()) fail('option obligatoire: --message "..."');
  if (!files.length) fail('au moins un chemin est requis après --');
  return { message: message.trim(), files };
}

function taskIdFromMessage(message) {
  const match = /\bT-\d+\b/i.exec(message);
  if (!match) fail('le message de checkpoint doit contenir un identifiant T-XXX');
  return match[0].toUpperCase();
}

function normalize(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function dirtyPaths(repo) {
  const result = git(repo, 'status', '--porcelain=v1', '-uall');
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`git status${detail ? `\n${detail}` : ''}`);
  }
  const text = result.stdout || '';
  if (!text.trim()) return [];
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const raw = line.slice(3).trim();
    const target = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
    return normalize(target);
  });
}

function coveredBySelection(file, selections) {
  return selections.some(selection => file === selection || file.startsWith(`${selection}/`));
}

function printDivergence(repo, branchName) {
  const local = git(repo, 'rev-parse', 'HEAD');
  const remote = git(repo, 'rev-parse', `origin/${branchName}`);
  console.error(`LOCAL=${local.status === 0 ? local.stdout.trim() : 'inconnu'}`);
  console.error(`REMOTE=${remote.status === 0 ? remote.stdout.trim() : 'inconnu'}`);

  const log = git(repo, 'log', '--oneline', '--decorate', '-10');
  if (log.status === 0 && log.stdout.trim()) {
    console.error('\nDix derniers commits locaux:');
    console.error(log.stdout.trim());
  }

  const graph = git(repo, 'log', '--left-right', '--graph', '--oneline', '-20', `origin/${branchName}...HEAD`);
  if (graph.status === 0 && graph.stdout.trim()) {
    console.error('\nDivergence local/distant:');
    console.error(graph.stdout.trim());
  }
}

function resolvedCurrentTask(repo) {
  const resolver = run(repo, [process.execPath, path.join(repo, 'scripts', 'agent-resolve-status.mjs')]);
  const text = output(resolver, 'résolution du statut');
  const line = text.split(/\r?\n/).find(item => item.startsWith('RESOLVED_STATUS_JSON='));
  if (!line) fail('le résolveur n’a pas produit RESOLVED_STATUS_JSON');

  try {
    const resolved = JSON.parse(line.slice('RESOLVED_STATUS_JSON='.length));
    if (!resolved.current_task) fail('aucune tâche courante résolue');
    return resolved;
  } catch (error) {
    fail(`sortie du résolveur invalide: ${error.message}`);
  }
}

const repo = findRepoRoot();
const { message, files } = parseArgs(process.argv.slice(2));
const messageTaskId = taskIdFromMessage(message);
const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.agent', 'MANIFEST.json'), 'utf8'));
const executionBranch = manifest.execution_branch;

if (!executionBranch) fail('MANIFEST.execution_branch absent');

const currentBranch = output(git(repo, 'branch', '--show-current'), 'git branch');
if (currentBranch !== executionBranch) {
  fail(`branche courante incorrecte: ${currentBranch || '(HEAD détaché)'}; attendu: ${executionBranch}`);
}

const stagedBefore = output(git(repo, 'diff', '--cached', '--name-only'), 'git diff --cached');
if (stagedBefore) {
  fail(`index déjà rempli avant checkpoint:\n${stagedBefore}`);
}

output(git(repo, 'fetch', 'origin', '--prune'), 'git fetch origin');

const localBefore = output(git(repo, 'rev-parse', 'HEAD'), 'git rev-parse HEAD');
const remoteBefore = output(git(repo, 'rev-parse', `origin/${executionBranch}`), 'git rev-parse distant');
if (localBefore !== remoteBefore) {
  printDivergence(repo, executionBranch);
  fail('HEAD local différent du HEAD distant avant checkpoint; aucune intégration automatique', 2);
}

const resolved = resolvedCurrentTask(repo);
if (resolved.current_task !== messageTaskId) {
  fail(`tâche du checkpoint incorrecte: message=${messageTaskId}; résolue=${resolved.current_task}`);
}

const selections = [...new Set(files.map(normalize))];
const dirty = dirtyPaths(repo);
if (!dirty.length) fail('aucune modification à checkpoint');

const uncovered = dirty.filter(file => !coveredBySelection(file, selections));
if (uncovered.length) {
  fail(`modifications hors du lot sélectionné:\n${uncovered.join('\n')}`);
}

for (const file of selections) {
  output(git(repo, 'add', '-A', '--', file), `git add ${file}`);
}

const staged = output(git(repo, 'diff', '--cached', '--name-only'), 'git diff --cached');
if (!staged) fail('aucune modification indexée');

const commit = git(repo, 'commit', '-m', message);
if (commit.status !== 0) {
  const detail = `${commit.stdout || ''}${commit.stderr || ''}`.trim();
  fail(`commit refusé${detail ? `\n${detail}` : ''}`);
}

const localAfterCommit = output(git(repo, 'rev-parse', 'HEAD'), 'git rev-parse après commit');
const push = git(repo, 'push', 'origin', `HEAD:${executionBranch}`);
if (push.status !== 0) {
  const detail = `${push.stdout || ''}${push.stderr || ''}`.trim();
  console.error(detail);
  output(git(repo, 'fetch', 'origin', '--prune'), 'git fetch après rejet');
  printDivergence(repo, executionBranch);
  fail('push rejeté; ne pas merge, rebase, reset, stash ou force-push automatiquement', 3);
}

output(git(repo, 'fetch', 'origin', '--prune'), 'git fetch de confirmation');
const remoteAfter = output(git(repo, 'rev-parse', `origin/${executionBranch}`), 'git rev-parse distant après push');

if (localAfterCommit !== remoteAfter) {
  printDivergence(repo, executionBranch);
  fail('checkpoint non confirmé à distance', 4);
}

console.log(`CHECKPOINT_DISTANT=${remoteAfter}`);
console.log(`BRANCHE=${executionBranch}`);
console.log(`TACHE=${messageTaskId}`);
console.log(`FICHIERS=${staged.split(/\r?\n/).join(',')}`);
