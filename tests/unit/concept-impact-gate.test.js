'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SOURCE_GATE = path.resolve(__dirname, '../../scripts/concept-impact-gate.js');

function run(cmd, cwd) {
  return cp.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeJson(root, rel, value) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-concept-gate-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/doctrine'), { recursive: true });
  fs.copyFileSync(SOURCE_GATE, path.join(root, 'scripts/concept-impact-gate.js'));

  writeJson(root, 'governance/concepts.json', {
    concepts: [{
      id: 'transport-rail', version: 1, revision: 'r1', owner: 'logistics',
      contractPaths: ['docs/doctrine/RAILS.md'],
      consumers: [{ feature: 'orders', critical: true }],
    }],
  });
  writeJson(root, 'governance/concept-impact-acks.json', {
    acks: [{ concept: 'transport-rail@1', revision: 'r1', feature: 'orders', status: 'compatible', reason: 'Initial contract is explicitly acknowledged.' }],
  });
  fs.writeFileSync(path.join(root, 'docs/doctrine/RAILS.md'), '# rails r1\n');

  run('git init -q', root);
  run('git config user.email "gate@test.local"', root);
  run('git config user.name "Gate Test"', root);
  run('git add . && git commit -qm "base"', root);
  return root;
}

function gate(root) {
  try {
    return { ok: true, out: run('node scripts/concept-impact-gate.js --base HEAD~1', root) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

describe('concept-impact-gate', () => {
  let root;
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test('bloque un contrat modifie sans bump de revision', () => {
    root = setupRepo();
    fs.appendFileSync(path.join(root, 'docs/doctrine/RAILS.md'), 'AIR_EXPRESS\n');
    run('git add . && git commit -qm "change contract"', root);

    const result = gate(root);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('contrat modifie mais revision inchangee');
  });

  test('bloque une nouvelle revision sans ACK consommateur exact', () => {
    root = setupRepo();
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'governance/concepts.json')));
    registry.concepts[0].revision = 'r2';
    writeJson(root, 'governance/concepts.json', registry);
    fs.appendFileSync(path.join(root, 'docs/doctrine/RAILS.md'), 'AIR_EXPRESS\n');
    run('git add . && git commit -qm "bump without ack"', root);

    const result = gate(root);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('orders               MISSING [CRITICAL]');
  });

  test('passe apres bump de revision et ACK de chaque consommateur', () => {
    root = setupRepo();
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'governance/concepts.json')));
    registry.concepts[0].revision = 'r2';
    writeJson(root, 'governance/concepts.json', registry);
    writeJson(root, 'governance/concept-impact-acks.json', {
      acks: [{ concept: 'transport-rail@1', revision: 'r2', feature: 'orders', status: 'adapted', reason: 'Orders explicitly accepts and persists the revised rail contract.' }],
    });
    fs.appendFileSync(path.join(root, 'docs/doctrine/RAILS.md'), 'AIR_EXPRESS\n');
    run('git add . && git commit -qm "bump with ack"', root);

    const result = gate(root);
    expect(result.ok).toBe(true);
    expect(result.out).toContain('concept-impact PASS');
  });
});
