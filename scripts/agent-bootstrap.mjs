#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BRANCH = 'agent/lane-mobile-renderer';

function run(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stderr || result.stdout || `git ${args.join(' ')} failed\n`);
    process.exit(result.status || 1);
  }

  return (result.stdout || '').trim();
}

const root = run(['rev-parse', '--show-toplevel']);
run(['fetch', 'origin', '--prune'], { cwd: root });

const dirty = run(['status', '--porcelain=v1'], { cwd: root });
if (dirty) {
  console.error('WORKTREE_DIRTY=1');
  console.error(dirty);
  console.error('Preserve local work. Do not switch, reset, stash, or delete anything.');
  process.exit(2);
}

const current = run(['branch', '--show-current'], { cwd: root });
if (current !== BRANCH) {
  const localExists = spawnSync(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/heads/${BRANCH}`],
    { cwd: root },
  ).status === 0;

  if (localExists) {
    run(['switch', BRANCH], { cwd: root });
  } else {
    run(['switch', '--track', '-c', BRANCH, `origin/${BRANCH}`], { cwd: root });
  }
}

run(['pull', '--ff-only', 'origin', BRANCH], { cwd: root });

const localSha = run(['rev-parse', 'HEAD'], { cwd: root });
const remoteSha = run(['rev-parse', `origin/${BRANCH}`], { cwd: root });
if (localSha !== remoteSha) {
  console.error(`LOCAL_SHA=${localSha}`);
  console.error(`REMOTE_SHA=${remoteSha}`);
  console.error('Branch is not synchronized. Stop before editing.');
  process.exit(3);
}

const now = JSON.parse(readFileSync(join(root, '.agent', 'NOW.json'), 'utf8'));
if (now.branch !== BRANCH) {
  console.error(`NOW.branch must be ${BRANCH}`);
  process.exit(4);
}

console.log(`BRANCH=${BRANCH}`);
console.log(`REMOTE_SHA=${remoteSha}`);
console.log(`CURRENT_TASK=${now.current_task}`);
console.log(`CURRENT_ACTION=${now.current_action}`);
console.log('BOOTSTRAP_OK=1');
