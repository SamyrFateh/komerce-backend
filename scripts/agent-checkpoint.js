#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          agent-sandbox-checkpoint
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   medium
 * @inputs        working tree of an ephemeral agent sandbox (CLAUDE_CODE_REMOTE=true)
 * @outputs       remote branch wip/<branch> holding a snapshot commit of the working tree; restore into a fresh sandbox
 * @depends       git
 * @used-by       .claude/settings.json hooks (PostToolUse, Stop), npm run agent:checkpoint, npm run agent:restore
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      AGENTS.md
 * @impact-areas  developer-workflow
 * @version       2026-10-v1
 */
'use strict';

/**
 * Un sandbox d'agent est jetable : quand la session s'arrête (budget épuisé,
 * VM récupérée), tout ce qui n'est pas poussé est perdu. Ce script photographie
 * l'arbre de travail (fichiers suivis + non suivis non ignorés) dans un commit
 * posé SUR HEAD via un index temporaire, et le pousse en force vers
 * `wip/<branche>`. La branche locale, l'index et l'arbre ne bougent pas, aucun
 * gate ne tourne : c'est une sauvegarde, pas une livraison. `wip/*` ne déclenche
 * aucune CI (pull_request sur main seulement) et le pre-push l'exempte du
 * tampon pr:preflight. Ne fait jamais échouer l'appelant (hooks).
 *
 *   node scripts/agent-checkpoint.js [--min-interval <s>] [--force]
 *   node scripts/agent-checkpoint.js --restore <branche>
 */

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE = 'komerce-checkpoint.json';
const INDEX = 'komerce-checkpoint.index';

function makeGit(cwd, extraEnv = {}) {
  return (args, envOverride = {}) => {
    const r = cp.spawnSync('git', args, {
      cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv, ...envOverride },
    });
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim());
    return String(r.stdout || '').trim();
  };
}

function wipBranch(git, env) {
  let branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') branch = `detached-${git(['rev-parse', '--short=8', 'HEAD'])}`;
  if (branch === 'main') {
    // Plusieurs sessions sur main ne doivent pas s'écraser mutuellement.
    const session = String(env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || 'local');
    branch = `main-${session.replace(/[^\w-]/g, '').slice(-12)}`;
  }
  return `wip/${branch}`;
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function checkpoint({
  cwd = process.cwd(), env = process.env, minInterval = 0, force = false, now = Date.now(), remote = 'origin',
} = {}) {
  if (env.CI) return { skipped: 'CI' };
  if (env.CLAUDE_CODE_REMOTE !== 'true' && !force) return { skipped: 'hors sandbox d’agent (--force pour forcer)' };
  const git = makeGit(cwd);
  const stateFile = path.resolve(cwd, git(['rev-parse', '--git-path', STATE]));
  const state = readState(stateFile);
  if (minInterval > 0 && state.at && now - state.at < minInterval * 1000) return { skipped: 'intervalle minimal' };

  const head = git(['rev-parse', 'HEAD']);
  const indexFile = path.resolve(cwd, git(['rev-parse', '--git-path', INDEX]));
  const withIndex = { GIT_INDEX_FILE: indexFile };
  git(['read-tree', 'HEAD'], withIndex);
  git(['add', '-A'], withIndex);
  const tree = git(['write-tree'], withIndex);
  fs.rmSync(indexFile, { force: true });

  const target = wipBranch(git, env);
  if (state.tree === tree && state.head === head && state.target === target) return { skipped: 'inchangé', target };
  if (tree === git(['rev-parse', 'HEAD^{tree}']) && !state.tree) return { skipped: 'rien à sauvegarder', target };

  const commit = git(['commit-tree', tree, '-p', head, '-m', `wip: checkpoint ${target} ${new Date(now).toISOString()}`],
    { GIT_AUTHOR_NAME: 'komerce-checkpoint', GIT_AUTHOR_EMAIL: 'checkpoint@komerce.invalid',
      GIT_COMMITTER_NAME: 'komerce-checkpoint', GIT_COMMITTER_EMAIL: 'checkpoint@komerce.invalid' });
  git(['push', '--force', '--quiet', remote, `${commit}:refs/heads/${target}`]);
  fs.writeFileSync(stateFile, JSON.stringify({ at: now, tree, head, target }));
  return { pushed: target, commit };
}

/**
 * Reprend dans un sandbox neuf le travail sauvegardé : la branche locale pointe
 * sur le parent du checkpoint (commits compris) et l'arbre de travail reçoit la
 * photo, en modifications non committées.
 */
function restore(branch, { cwd = process.cwd(), remote = 'origin' } = {}) {
  if (!branch) throw new Error('--restore <branche> : branche manquante');
  const git = makeGit(cwd);
  if (git(['status', '--porcelain'])) throw new Error('arbre de travail non propre : committer ou annuler avant --restore');
  const target = branch.startsWith('wip/') ? branch : `wip/${branch}`;
  const local = target.replace(/^wip\//, '');
  git(['fetch', '--quiet', remote, `refs/heads/${target}`]);
  git(['checkout', '--quiet', '-B', local, 'FETCH_HEAD']);
  git(['reset', '--quiet', '--mixed', 'HEAD~1']);
  return { restored: local, from: target };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args = process.argv.slice(2)) {
  const restoreBranch = argValue(args, '--restore');
  if (args.includes('--restore')) {
    const r = restore(restoreBranch);
    console.log(`✔ ${r.from} restauré sur ${r.restored} (modifications non committées).`);
    return;
  }
  try {
    const r = checkpoint({ minInterval: Number(argValue(args, '--min-interval')) || 0, force: args.includes('--force') });
    if (r.pushed) console.log(`checkpoint → ${r.pushed}`);
    else if (args.includes('--verbose')) console.log(`checkpoint ignoré : ${r.skipped}`);
  } catch (error) {
    // Une sauvegarde ratée ne doit jamais bloquer le travail de l'agent.
    console.log(`checkpoint non poussé : ${error.message.split('\n')[0]}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`agent-checkpoint: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkpoint, main, restore, wipBranch };
