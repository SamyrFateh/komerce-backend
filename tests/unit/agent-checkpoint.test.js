'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkpoint, restore, wipBranch, main } = require('../../scripts/agent-checkpoint');

const SANDBOX = { CLAUDE_CODE_REMOTE: 'true', CLAUDE_CODE_REMOTE_SESSION_ID: 'session_01ABCDEFGHIJKL' };
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function run(cwd, ...args) {
  return cp.execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...ID } }).trim();
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-ckpt-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  run(root, 'init', '-q', '--bare', remote);
  run(root, 'clone', '-q', remote, work);
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(work, '.gitignore'), 'ignored.txt\n');
  run(work, 'add', '-A');
  run(work, 'commit', '-q', '-m', 'init');
  run(work, 'branch', '-M', 'feat/x');
  return { root, remote, work };
}

describe('agent-checkpoint', () => {
  test('hors sandbox et en CI : rien', () => {
    expect(checkpoint({ env: {} }).skipped).toMatch(/hors sandbox/);
    expect(checkpoint({ env: { CI: 'true', CLAUDE_CODE_REMOTE: 'true' } }).skipped).toBe('CI');
  });

  test('photo de l’arbre (suivis, non suivis, suppressions) poussée vers wip/<branche> sans toucher branche ni index', () => {
    const { remote, work } = setup();
    expect(checkpoint({ cwd: work, env: SANDBOX }).skipped).toBe('rien à sauvegarder');

    fs.writeFileSync(path.join(work, 'a.txt'), 'modifié\n');
    fs.writeFileSync(path.join(work, 'new.txt'), 'nouveau\n');
    fs.writeFileSync(path.join(work, 'ignored.txt'), 'secret\n');
    const head = run(work, 'rev-parse', 'HEAD');
    const r = checkpoint({ cwd: work, env: SANDBOX, now: 1000 });
    expect(r.pushed).toBe('wip/feat/x');
    expect(run(work, 'rev-parse', 'HEAD')).toBe(head);
    expect(run(work, 'status', '--porcelain')).toBe('M a.txt\n?? new.txt');
    expect(run(remote, 'show', 'wip/feat/x:new.txt')).toBe('nouveau');
    expect(run(remote, 'rev-parse', 'wip/feat/x~1')).toBe(head);
    expect(() => run(remote, 'show', 'wip/feat/x:ignored.txt')).toThrow();

    expect(checkpoint({ cwd: work, env: SANDBOX, now: 2000 }).skipped).toBe('inchangé');
    fs.writeFileSync(path.join(work, 'a.txt'), 'encore\n');
    expect(checkpoint({ cwd: work, env: SANDBOX, now: 3000, minInterval: 120 }).skipped).toBe('intervalle minimal');
    expect(checkpoint({ cwd: work, env: SANDBOX, now: 200000, minInterval: 120 }).pushed).toBe('wip/feat/x');
  });

  test('restore : un sandbox neuf retrouve commits et modifications non committées', () => {
    const { root, remote, work } = setup();
    run(work, 'push', '-q', 'origin', 'feat/x');
    fs.writeFileSync(path.join(work, 'b.txt'), 'b\n');
    run(work, 'add', 'b.txt');
    run(work, 'commit', '-q', '-m', 'non poussé');
    fs.writeFileSync(path.join(work, 'a.txt'), 'en cours\n');
    fs.writeFileSync(path.join(work, 'c.txt'), 'c\n');
    checkpoint({ cwd: work, env: SANDBOX });

    const fresh = path.join(root, 'fresh');
    run(root, 'clone', '-q', remote, fresh);
    expect(restore('feat/x', { cwd: fresh })).toEqual({ restored: 'feat/x', from: 'wip/feat/x' });
    expect(run(fresh, 'log', '-1', '--format=%s')).toBe('non poussé');
    expect(fs.readFileSync(path.join(fresh, 'a.txt'), 'utf8')).toBe('en cours\n');
    expect(fs.readFileSync(path.join(fresh, 'c.txt'), 'utf8')).toBe('c\n');

    fs.writeFileSync(path.join(fresh, 'a.txt'), 'sale\n');
    expect(() => restore('wip/feat/x', { cwd: fresh })).toThrow(/non propre/);
    expect(() => restore('', { cwd: fresh })).toThrow(/branche manquante/);
  });

  test('nom de branche wip : main par session, HEAD détachée', () => {
    const git = args => ({ 'rev-parse --abbrev-ref HEAD': 'main', 'rev-parse --short=8 HEAD': 'abcd1234' })[args.join(' ')];
    expect(wipBranch(git, SANDBOX)).toBe('wip/main-ABCDEFGHIJKL');
    expect(wipBranch(git, {})).toBe('wip/main-local');
    const detached = args => (args.includes('--abbrev-ref') ? 'HEAD' : 'abcd1234');
    expect(wipBranch(detached, {})).toBe('wip/detached-abcd1234');
  });

  test('main : une sauvegarde ratée n’échoue jamais (hook), --verbose explique un saut', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const before = process.env.CLAUDE_CODE_REMOTE;
    try {
      delete process.env.CLAUDE_CODE_REMOTE;
      main(['--verbose']);
      expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/ignoré : hors sandbox/));
      main(['--force', '--min-interval', 'x']);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CODE_REMOTE; else process.env.CLAUDE_CODE_REMOTE = before;
      log.mockRestore();
    }
  });
});
