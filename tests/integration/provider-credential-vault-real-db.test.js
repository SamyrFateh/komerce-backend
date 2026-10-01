'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * Provider Credential Authority — sécurité du coffre sur vraie base :
 * secret jamais en clair, rotation atomique testée avant bascule, échec = ancien intact,
 * révocation = secret effacé + autopilot OFF, clé maître erronée = illisible, aucune fuite.
 * Le fournisseur est simulé au niveau connecteur ; chiffrement et base sont réels.
 */

const crypto = require('crypto');
const { describeE2E } = require('../helpers/e2eDbKit');

process.env.KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
delete process.env.CJ_ACCESS_TOKEN;
delete process.env.CJ_API_KEY;

const mockTest = jest.fn();
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  IS_ACTIVE: true,
  INACTIVE_REASON: null,
  hasEnvironmentCredentials: () => false,
  testConnection: (...args) => mockTest(...args),
  fetchProducts: jest.fn(),
}));

describeE2E('Coffre des identifiants — chiffrement, rotation, révocation', ({ db }) => {
  jest.setTimeout(60000);
  const SOURCE = 'api:cj-vault-e2e';
  const OLD = 'cj-old-secret-AAAA-1111';
  const NEW = 'cj-new-secret-BBBB-2222';
  const BAD = 'cj-bad-secret-CCCC-3333';
  const actor = { id: null, role: 'admin' };
  let vault;

  // Isolation : on ignore les credentials cj créés par d'autres suites sur la même base.
  const preexisting = new Set();
  const rows = async () => (await db.query(
    `SELECT * FROM provider_credentials WHERE provider_key = 'cj' ORDER BY created_at`)).rows
    .filter((r) => !preexisting.has(r.credential_ref));
  const source = async () => (await db.query('SELECT * FROM sourcing_sources WHERE source_id = $1', [SOURCE])).rows[0];
  const noSecretAnywhere = async (...secrets) => {
    const dump = JSON.stringify(await rows())
      + JSON.stringify((await db.query('SELECT * FROM sourcing_provider_control_events')).rows)
      + JSON.stringify(await source());
    for (const secret of secrets) expect(dump).not.toContain(secret);
  };

  beforeAll(async () => {
    vault = require('../../services/provider-credential-service');
    (await db.query(`SELECT credential_ref FROM provider_credentials`)).rows.forEach((r) => preexisting.add(r.credential_ref));
    await db.query(
      `INSERT INTO sourcing_sources (source_id, adapter_type, acquisition, continuity, status, autopilot_enabled)
       VALUES ($1, 'cj', 'pull', 'recurring', 'active', true) ON CONFLICT (source_id) DO NOTHING`, [SOURCE]);
  });

  afterAll(async () => {
    await db.query('UPDATE sourcing_sources SET credential_ref = NULL WHERE source_id = $1', [SOURCE]).catch(() => {});
    await db.query('DELETE FROM sourcing_provider_control_events WHERE source_id = $1', [SOURCE]).catch(() => {});
    await db.query('DELETE FROM sourcing_sources WHERE source_id = $1', [SOURCE]).catch(() => {});
    const mine = (await rows().catch(() => [])).map((r) => r.credential_ref);
    if (mine.length) {
      await db.query('UPDATE provider_credentials SET replaces_ref = NULL WHERE credential_ref = ANY($1)', [mine]).catch(() => {});
      await db.query('DELETE FROM provider_credentials WHERE credential_ref = ANY($1)', [mine]).catch(() => {});
    }
  });

  test('1 — enregistrement : chiffré (jamais en clair), IV aléatoire, état À TESTER', async () => {
    const status = await vault.configure(SOURCE, { api_key: OLD }, actor);
    expect(status).toMatchObject({ configured: true, connected: false, credential_status: 'untested', auth_type: 'api_key' });
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'active', key_version: 1 });
    expect(row.envelope_iv).toBeTruthy();
    await noSecretAnywhere(OLD);
    expect(JSON.stringify(status)).not.toContain(OLD);
  });

  test('2 — le coffre rend le secret au serveur seulement (forSource / resolveForRun)', async () => {
    const { credentials } = await vault.forSource(SOURCE);
    expect(credentials).toEqual({ api_key: OLD });
    const run = await vault.resolveForRun(SOURCE);
    expect(run).toMatchObject({ state: 'untested', ok: false });
  });

  test('3 — test réussi : valide, le connecteur reçoit le secret hors-bande', async () => {
    mockTest.mockResolvedValueOnce({ ok: true });
    const result = await vault.test(SOURCE);
    expect(result).toMatchObject({ ok: true, code: 'connection_ok' });
    expect(mockTest).toHaveBeenLastCalledWith({ credentials: { api_key: OLD } });
    expect(await vault.resolveForRun(SOURCE)).toMatchObject({ state: 'valid', ok: true });
    expect(await vault.status(SOURCE)).toMatchObject({ connected: true, credential_status: 'valid', last_test_status: 'ok' });
  });

  test('4 — rotation refusée par le fournisseur : ancien actif et inchangé, nouveau effacé', async () => {
    const before = (await rows())[0];
    mockTest.mockRejectedValueOnce(new Error('HTTP 401 unauthorized'));
    const result = await vault.rotate(SOURCE, { api_key: BAD }, actor);
    expect(result).toMatchObject({ ok: false, rotated: false, code: 'credentials_rejected' });
    expect(JSON.stringify(result)).not.toContain(BAD);
    const all = await rows();
    const failed = all.find((r) => r.status === 'failed');
    expect(failed).toMatchObject({ envelope_ciphertext: null, envelope_iv: null, envelope_tag: null, last_test_status: 'failed' });
    expect(all.find((r) => r.credential_ref === before.credential_ref)).toMatchObject({
      status: 'active', envelope_ciphertext: before.envelope_ciphertext, envelope_iv: before.envelope_iv,
    });
    expect((await source()).credential_ref).toBe(before.credential_ref);
    expect((await vault.forSource(SOURCE)).credentials).toEqual({ api_key: OLD });
    await noSecretAnywhere(BAD);
  });

  test('5 — rotation réussie : bascule atomique, ancien effacé, lignée conservée', async () => {
    const before = (await rows()).find((r) => r.status === 'active');
    mockTest.mockResolvedValueOnce({ ok: true });
    const result = await vault.rotate(SOURCE, { api_key: NEW }, actor);
    expect(result).toMatchObject({ ok: true, rotated: true });
    expect(mockTest).toHaveBeenLastCalledWith({ credentials: { api_key: NEW } });
    const all = await rows();
    expect(all.filter((r) => r.status === 'active')).toHaveLength(1);
    const active = all.find((r) => r.status === 'active');
    expect(active.replaces_ref).toBe(before.credential_ref);
    expect((await source()).credential_ref).toBe(active.credential_ref);
    const old = all.find((r) => r.credential_ref === before.credential_ref);
    expect(old).toMatchObject({ status: 'superseded', envelope_ciphertext: null, envelope_iv: null, envelope_tag: null, key_version: null });
    expect((await vault.forSource(SOURCE)).credentials).toEqual({ api_key: NEW });
    expect(await vault.status(SOURCE)).toMatchObject({ credential_status: 'valid', connected: true });
    await noSecretAnywhere(OLD, NEW, BAD);
  });

  test('6 — mauvaise clé maître : illisible, fail-closed, sans fuite', async () => {
    const previous = process.env.KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY;
    process.env.KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
    try {
      await expect(vault.forSource(SOURCE)).rejects.toMatchObject({ code: 'credentials_unreadable' });
      expect(await vault.resolveForRun(SOURCE)).toMatchObject({ state: 'invalid', ok: false, credentials: null });
      delete process.env.KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY;
      await expect(vault.forSource(SOURCE)).rejects.toMatchObject({ code: 'credentials_vault_unavailable' });
    } finally {
      process.env.KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY = previous;
    }
  });

  test('7 — enveloppe altérée en base : illisible, jamais exécutée', async () => {
    const active = (await rows()).find((r) => r.status === 'active');
    const tampered = Buffer.from(active.envelope_tag, 'base64');
    tampered[0] ^= 0xff;
    await db.query('UPDATE provider_credentials SET envelope_tag = $2 WHERE credential_ref = $1', [active.credential_ref, tampered.toString('base64')]);
    expect(await vault.resolveForRun(SOURCE)).toMatchObject({ state: 'invalid', ok: false });
    await db.query('UPDATE provider_credentials SET envelope_tag = $2 WHERE credential_ref = $1', [active.credential_ref, active.envelope_tag]);
    expect(await vault.resolveForRun(SOURCE)).toMatchObject({ state: 'valid', ok: true });
  });

  test('8 — entrée invalide refusée sans écriture', async () => {
    const count = (await rows()).length;
    await expect(vault.rotate(SOURCE, {}, actor)).rejects.toMatchObject({ code: 'credentials_field_required' });
    await expect(vault.rotate(SOURCE, { api_key: 'x', evil: 'y' }, actor)).rejects.toMatchObject({ code: 'credentials_field_unknown' });
    expect((await rows()).length).toBe(count);
  });

  test('9 — révocation : secret effacé, source sans credential, autopilot OFF, trace', async () => {
    const result = await vault.revoke(SOURCE, actor);
    expect(result).toMatchObject({ configured: false, credential_status: 'missing', connected: false });
    const s = await source();
    expect(s).toMatchObject({ credential_ref: null, autopilot_enabled: false, connection_test_status: null });
    expect((await rows()).filter((r) => r.envelope_ciphertext !== null)).toHaveLength(0);
    expect((await vault.resolveForRun(SOURCE)).ok).toBe(false);
    const events = (await db.query(
      `SELECT reason FROM sourcing_provider_control_events WHERE source_id = $1 AND capability = 'credentials' ORDER BY created_at`, [SOURCE])).rows;
    expect(events.map((e) => e.reason)).toEqual(expect.arrayContaining(['credentials_configured', 'credentials_rotated', 'credentials_revoked']));
    await noSecretAnywhere(OLD, NEW, BAD);
  });

  test('10 — garde-fous de schéma : un statut non actif ne peut pas porter de secret', async () => {
    const anyRow = (await rows()).find((r) => r.status !== 'active');
    await expect(db.query(
      `UPDATE provider_credentials SET envelope_ciphertext = 'x', envelope_iv = 'y', envelope_tag = 'z', key_version = 1
        WHERE credential_ref = $1`, [anyRow.credential_ref])).rejects.toThrow(/provider_credentials_shredded_chk/);
  });
});
