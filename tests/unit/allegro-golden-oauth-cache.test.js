'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
jest.mock('../../db', () => ({ query: jest.fn(), pool: { end: jest.fn(async () => {}) } }));
const db = require('../../db');
const { isolated, vaultPath, seal, unseal, fromEphemeralDbRow, main } =
  require('../../scripts/allegro-golden-oauth-cache');

const CLIENT_ID = 'golden-sandbox-dedicated-test-app';
const CLIENT_SECRET = 'not-a-real-credential-TEST-ONLY-client-secret';
const TOKEN1 = 'dummy-TEST-ONLY-refresh-token-before-rotation';
const TOKEN2 = 'dummy-TEST-ONLY-refresh-token-after-rotation';
let root;
let env;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-golden-cache-test-'));
  env = {
    GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main',
    KOMERCE_ENV: 'staging', KOMERCE_ALLOW_ALLEGRO_SANDBOX: '1',
    DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_sourcing_proof',
    TEST_ONLY_OFFER_ACK: 'true', OFFER_ID: '7782259530',
    RUNNER_TEMP: root, ALLEGRO_SANDBOX_CLIENT_ID: CLIENT_ID,
    ALLEGRO_SANDBOX_CLIENT_SECRET: CLIENT_SECRET,
    ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY: 'f'.repeat(64),
    GITHUB_ENV: path.join(root, 'env.out'),
    GITHUB_OUTPUT: path.join(root, 'step.out'),
  };
  db.query.mockReset();
  db.pool.end.mockClear();
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('only isolated staging + main + explicit test acknowledgement can touch a cache', () => {
  expect(() => isolated(env)).not.toThrow();
  expect(vaultPath(env)).toContain('komerce-allegro-golden-refresh-v1');
  for (const invalid of [
    { GITHUB_REF: 'refs/pull/1/merge' },
    { DATABASE_URL: 'postgres://prod' },
    { KOMERCE_ENV: 'production' },
    { TEST_ONLY_OFFER_ACK: 'false' },
    { ALLEGRO_SANDBOX_CLIENT_SECRET: '' },
  ]) {
    expect(() => isolated({ ...env, ...invalid })).toThrow('GOLDEN_REFRESH_CACHE_ISOLATION_REQUIRED');
  }
});

test('cache contains ciphertext only, bound to this dedicated app and secret, integrity-checked', () => {
  const sealed = seal(TOKEN1, CLIENT_ID, CLIENT_SECRET);
  expect(sealed).not.toContain(TOKEN1);
  expect(unseal(sealed, CLIENT_ID, CLIENT_SECRET)).toBe(TOKEN1);
  expect(() => unseal(sealed, 'other-app', CLIENT_SECRET)).toThrow('GOLDEN_REFRESH_CACHE_UNREADABLE');
  expect(() => unseal(sealed, CLIENT_ID, 'different-secret')).toThrow('GOLDEN_REFRESH_CACHE_UNREADABLE');
  const tampered = JSON.parse(sealed);
  tampered.ciphertext = Buffer.from('malicious').toString('base64');
  expect(() => unseal(JSON.stringify(tampered), CLIENT_ID, CLIENT_SECRET))
    .toThrow('GOLDEN_REFRESH_CACHE_UNREADABLE');
  expect(() => seal('token\nNEW_ENV=inject', CLIENT_ID, CLIENT_SECRET))
    .toThrow('GOLDEN_REFRESH_CACHE_INVALID_INPUT');
});

test('decrypts only the ephemeral DB refresh token for the authenticated app', () => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(env.ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from('komerce:supplier-oauth:allegro_sandbox:refresh'));
  const ciphertext = Buffer.concat([cipher.update(TOKEN2), cipher.final()]);
  const row = {
    refresh_token_ciphertext: ciphertext.toString('base64'),
    refresh_token_iv: iv.toString('base64'),
    refresh_token_tag: cipher.getAuthTag().toString('base64'),
  };
  expect(fromEphemeralDbRow(row, env.ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY)).toBe(TOKEN2);
  expect(() => fromEphemeralDbRow(row, '0'.repeat(64)))
    .toThrow('GOLDEN_REFRESH_CACHE_DB_TOKEN_UNREADABLE');
});

test('saves a rotated token after a failed proof, then restores it for a later run without logging it', async () => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(env.ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from('komerce:supplier-oauth:allegro_sandbox:refresh'));
  const ciphertext = Buffer.concat([cipher.update(TOKEN2), cipher.final()]);
  db.query.mockResolvedValueOnce({ rows: [{
    refresh_token_ciphertext: ciphertext.toString('base64'),
    refresh_token_iv: iv.toString('base64'),
    refresh_token_tag: cipher.getAuthTag().toString('base64'),
  }] });
  const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await main('save', env);
    expect(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('has_rotated_token=true\n');
    expect(fs.readFileSync(vaultPath(env), 'utf8')).not.toContain(TOKEN2);
    await main('restore', env);
    expect(fs.readFileSync(env.GITHUB_ENV, 'utf8')).toBe('ALLEGRO_SANDBOX_REFRESH_TOKEN=' + TOKEN2 + '\n');
    expect(output.mock.calls.some(([line]) => line === '::add-mask::' + TOKEN2 + '\n')).toBe(true);
    expect(output.mock.calls.filter(([line]) => !String(line).startsWith('::add-mask::'))
      .every(([line]) => !String(line).includes(TOKEN2))).toBe(true);
  } finally {
    output.mockRestore();
  }
  expect(db.pool.end).toHaveBeenCalledTimes(1);
});

test('a first-read OAuth failure does not produce an empty or falsely reusable cache', async () => {
  const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    db.query.mockResolvedValueOnce({ rows: [] });
    await main('save', env);
    expect(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('has_rotated_token=false\n');
    expect(fs.existsSync(vaultPath(env))).toBe(false);
    await main('restore', env);
    expect(fs.existsSync(env.GITHUB_ENV)).toBe(false);
  } finally { output.mockRestore(); }
});
