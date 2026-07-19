#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const BRANCH = 'agent/lane-mobile-renderer';

function run(args, { cwd, allowFailure = false, inherit = false } = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stderr || result.stdout || `${args.join(' ')} failed\n`);
    process.exit(result.status || 1);
  }

  return (result.stdout || '').trim();
}

const root = run(['git', 'rev-parse', '--show-toplevel']);
run(['git', 'fetch', 'origin', '--prune'], { cwd: root });

const dirty = run(['git', 'status', '--porcelain=v1'], { cwd: root });
if (dirty) {
  console.error('WORKTREE_DIRTY=1');
  console.error(dirty);
  console.error('Preserve local work. Do not switch, reset, stash, or delete anything.');
  process.exit(2);
}

const current = run(['git', 'branch', '--show-current'], { cwd: root });
if (current !== BRANCH) {
  const localExists = spawnSync(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/heads/${BRANCH}`],
    { cwd: root },
  ).status === 0;

  if (localExists) {
    run(['git', 'switch', BRANCH], { cwd: root, inherit: true });
  } else {
    run(['git', 'switch', '--track', '-c', BRANCH, `origin/${BRANCH}`], { cwd: root, inherit: true });
  }
}

run(['git', 'pull', '--ff-only', 'origin', BRANCH], { cwd: root, inherit: true });

const localSha = run(['git', 'rev-parse', 'HEAD'], { cwd: root });
const remoteSha = run(['git', 'rev-parse', `origin/${BRANCH}`], { cwd: root });
if (localSha !== remoteSha) {
  console.error(`LOCAL_SHA=${localSha}`);
  console.error(`REMOTE_SHA=${remoteSha}`);
  console.error('Branch is not synchronized. Stop before editing.');
  process.exit(3);
}

const resolver = spawnSync(process.execPath, [join(root, 'scripts', 'agent-resolve-status.mjs')], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});
if (resolver.status !== 0) process.exit(resolver.status || 4);

console.log('BOOTSTRAP_OK=1');