'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const runner = require('../../scripts/setup-hooks-runner');
const stamp = require('../../scripts/lib/preflight-stamp');

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-hooks-'));
  const git = (...args) => cp.execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  return { dir, git, head: git('rev-parse', 'HEAD') };
}

function prePush(dir, stdin) {
  return cp.spawnSync('sh', [path.join(ROOT, 'scripts/hooks/pre-push')], { cwd: dir, input: stdin, encoding: 'utf8' });
}

describe('hook pre-push : tampon pr:preflight vert', () => {
  test('refuse un commit sans tampon, accepte le commit tamponné, ignore les suppressions', () => {
    const { dir, head } = tempRepo();
    const line = `refs/heads/b ${head} refs/heads/b ${'0'.repeat(40)}\n`;
    const refused = prePush(dir, line);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain('npm run pr:preflight');

    fs.writeFileSync(path.join(dir, '.git', stamp.STAMP_NAME), `${head}\n`);
    expect(prePush(dir, line).status).toBe(0);
    expect(prePush(dir, `(delete) ${'0'.repeat(40)} refs/heads/b ${head}\n`).status).toBe(0);
    expect(prePush(dir, '').status).toBe(0);

    fs.writeFileSync(path.join(dir, '.git', stamp.STAMP_NAME), 'autre\n');
    expect(prePush(dir, line).status).toBe(1);
  });

  test('marqueur géré : réinstallable par setup-hooks, distinct d’un hook personnel', () => {
    expect(fs.readFileSync(path.join(ROOT, 'scripts/hooks/pre-push'), 'utf8')).toMatch(/KOMERCE-HOOK/);
  });
});

describe('setup-hooks.sh : installation du pre-push léger', () => {
  function withInstaller() {
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo.dir, 'scripts/hooks'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/hooks/pre-push'), path.join(repo.dir, 'scripts/hooks/pre-push'));
    const run = () => cp.execFileSync('bash', [path.join(ROOT, 'scripts/setup-hooks.sh')], { cwd: repo.dir, encoding: 'utf8' });
    return { ...repo, run, hook: path.join(repo.dir, '.git/hooks/pre-push') };
  }

  test('installe le pre-push géré et remplace une ancienne version gérée', () => {
    const { run, hook } = withInstaller();
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\n# KOMERCE-HOOK ancien\nexit 1\n');
    expect(run()).toContain('tampon pr:preflight vert');
    expect(fs.readFileSync(hook, 'utf8')).toContain('pre-push-stamp v1');
    expect(fs.statSync(hook).mode & 0o111).toBeTruthy();
  });

  test('conserve un pre-push personnel', () => {
    const { run, hook } = withInstaller();
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    expect(run()).toContain('Hook pre-push personnel conserve');
    expect(fs.readFileSync(hook, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
  });
});

describe('setup-hooks-runner', () => {
  test('commande par plateforme', () => {
    expect(runner.installerCommand('linux')).toEqual(['bash', ['scripts/setup-hooks.sh']]);
    expect(runner.installerCommand('win32')[0]).toBe('powershell.exe');
    expect(runner.installerCommand('win32')[1]).toContain('scripts/setup-hooks.ps1');
  });

  test('ensureInstalled : jamais en CI, hors dépôt, ni si le pre-push existe', () => {
    const exec = jest.fn();
    expect(runner.ensureInstalled({ env: { CI: 'true' }, exec, exists: () => false })).toBe(false);
    expect(runner.ensureInstalled({ env: {}, exec, exists: () => false })).toBe(false);
    expect(runner.ensureInstalled({ env: {}, exec, exists: () => true })).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  test('ensureInstalled : installe silencieusement si le pre-push manque, sans jamais faire échouer l’appelant', () => {
    const exists = file => !file.endsWith('pre-push');
    const exec = jest.fn();
    expect(runner.ensureInstalled({ env: {}, exec, exists, platform: 'linux' })).toBe(true);
    expect(exec).toHaveBeenCalledWith('bash', ['scripts/setup-hooks.sh'], expect.objectContaining({ stdio: 'ignore' }));
    const failing = jest.fn(() => { throw new Error('bash absent'); });
    expect(runner.ensureInstalled({ env: {}, exec: failing, exists })).toBe(false);
  });

  test('install délègue à l’installateur avec la sortie visible par défaut', () => {
    const exec = jest.fn();
    runner.install({ exec, platform: 'linux' });
    expect(exec).toHaveBeenCalledWith('bash', ['scripts/setup-hooks.sh'], expect.objectContaining({ stdio: 'inherit' }));
  });
});

describe('preflight-stamp', () => {
  test('refus : dry-run, head explicite, arbre sale ; accepté sinon', () => {
    expect(stamp.refusal({ dryRun: true, headRef: 'HEAD', dirtyFiles: 0 })).toBe('dry-run');
    expect(stamp.refusal({ dryRun: false, headRef: 'abc', dirtyFiles: 0 })).toMatch(/n'est pas HEAD/);
    expect(stamp.refusal({ dryRun: false, headRef: 'HEAD', dirtyFiles: 2 })).toMatch(/2 fichier/);
    expect(stamp.refusal({ dryRun: false, headRef: 'HEAD', dirtyFiles: 0 })).toBeNull();
  });

  test('writeGreen écrit le SHA à l’emplacement git du tampon', () => {
    const write = jest.fn();
    const file = stamp.writeGreen({ sha: 'abc', gitPath: name => `/repo/.git/${name}`, write });
    expect(file).toBe('/repo/.git/komerce-preflight-green');
    expect(write).toHaveBeenCalledWith('/repo/.git/komerce-preflight-green', 'abc\n');
  });
});
