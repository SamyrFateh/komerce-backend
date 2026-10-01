/**
 * @komerce-arch
 * @role          provider-credential-service
 * @domain        sourcing
 * @layer         service
 * @criticality   critical
 * @inputs        provider_credentials, sourcing_sources, connector_auth_contract, KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY
 * @outputs       credential_status_without_secret, server_side_connector_credentials
 * @depends       db.js, services/sourcing-import-dispatch.js
 * @used-by       routes/admin-sourcing-workspace.js, services/sourcing-workspace.js, services/sourcing-source-autopilot.js, services/sourcing-source-registry.js
 * @db-read       provider_credentials, sourcing_sources
 * @db-write      provider_credentials, sourcing_sources, sourcing_provider_control_events
 * @db-txn        atomic_credential_switch
 * @doctrine      provider_credential_authority, browser_never_rereads_a_secret, aes_256_gcm_aad_bound_envelope, rotation_tests_before_switch, fail_closed_credentials
 * @impact-areas  sourcing, security
 * @version       2026-10
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const importDispatch = require('./sourcing-import-dispatch');

const MASTER_KEY_ENV = 'KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY';
const KEY_VERSION_ENV = 'KOMERCE_PROVIDER_CREDENTIALS_KEY_VERSION';
const ENVELOPE_FORMAT = 1;
const MAX_FIELD_LENGTH = 4096;

class ProviderCredentialError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'ProviderCredentialError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => new ProviderCredentialError(status, message, code);

// ── Chiffrement ───────────────────────────────────────────────────────────────

function currentKeyVersion(env = process.env) {
  const parsed = Number.parseInt(env[KEY_VERSION_ENV] || '1', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function masterKey(env = process.env) {
  const raw = String(env[MASTER_KEY_ENV] || '').trim();
  if (!raw) throw fail(503, 'credentials_vault_unavailable', 'Le coffre des identifiants n’est pas disponible sur ce serveur.');
  let key = null;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) key = Buffer.from(raw, 'base64');
  if (!key || key.length !== 32) {
    throw fail(503, 'credentials_vault_unavailable', 'Le coffre des identifiants n’est pas disponible sur ce serveur.');
  }
  return key;
}

function aadFor({ provider, credentialRef, keyVersion, authType }) {
  return Buffer.from(
    `komerce:provider-credential:${ENVELOPE_FORMAT}:${provider}:${credentialRef}:v${keyVersion}:${authType}`,
    'utf8'
  );
}

function encryptEnvelope({ provider, credentialRef, authType, secrets }, env = process.env) {
  const keyVersion = currentKeyVersion(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(env), iv);
  cipher.setAAD(aadFor({ provider, credentialRef, keyVersion, authType }));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

function decryptEnvelope({ provider, credentialRef, authType, envelope }, env = process.env) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(env), Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(aadFor({ provider, credentialRef, keyVersion: envelope.keyVersion, authType }));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch (error) {
    if (error instanceof ProviderCredentialError) throw error;
    // Message volontairement muet : aucune indication sur la cause (clé, tag, AAD).
    throw fail(409, 'credentials_unreadable', 'Les identifiants enregistrés sont illisibles : nouvelle saisie nécessaire.');
  }
}

// ── Assainissement commun ─────────────────────────────────────────────────────

// Retire toute valeur secrète connue d'un texte avant journalisation ou réponse.
function redactSecrets(text, secrets) {
  let out = String(text ?? '');
  for (const value of Object.values(secrets || {})) {
    const secret = String(value ?? '');
    if (secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function validateSecrets(contract, input) {
  if (!contract || !['api_key', 'client_credentials'].includes(contract.mode) || contract.scope !== 'source') {
    throw fail(409, 'credentials_not_configurable', 'Ce connecteur ne se configure pas avec des identifiants saisis.');
  }
  const allowed = new Set(contract.fields.map((field) => field.key));
  const provided = input && typeof input === 'object' ? input : {};
  for (const key of Object.keys(provided)) {
    if (!allowed.has(key)) throw fail(400, 'credentials_field_unknown', 'Champ d’identifiant inconnu.');
  }
  const secrets = {};
  for (const field of contract.fields) {
    const value = provided[field.key];
    if (typeof value !== 'string' || !value.trim()) {
      throw fail(400, 'credentials_field_required', `${field.label} est obligatoire.`);
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_FIELD_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw fail(400, 'credentials_field_invalid', `${field.label} est invalide.`);
    }
    secrets[field.key] = trimmed;
  }
  return secrets;
}

// ── Accès base ────────────────────────────────────────────────────────────────

const newCredentialRef = () => `cred_${crypto.randomBytes(16).toString('hex')}`;

async function loadSource(sourceRef, q, { lock = false } = {}) {
  const { rows: [source] } = await q.query(
    `SELECT source_id AS source_ref, adapter_type, status, autopilot_enabled, credential_ref,
            connection_test_status, production_certified_at
       FROM sourcing_sources WHERE source_id = $1${lock ? ' FOR UPDATE' : ''}`,
    [sourceRef]
  );
  if (!source) throw fail(404, 'sourcing_source_not_found', 'Source sourcing introuvable');
  const contract = importDispatch.authContract(source.adapter_type);
  if (!contract) throw fail(409, 'credentials_not_configurable', 'Ce connecteur ne se configure pas avec des identifiants saisis.');
  return { source, contract };
}

async function loadActiveRow(source, q) {
  if (!source.credential_ref) return null;
  const { rows: [row] } = await q.query(
    `SELECT * FROM provider_credentials WHERE credential_ref = $1 AND status = 'active'`,
    [source.credential_ref]
  );
  return row || null;
}

async function recordEvent(q, source, wasValid, isValid, actor, reason) {
  await q.query(
    `INSERT INTO sourcing_provider_control_events (source_id, capability, old_value, new_value, actor_id, reason)
     VALUES ($1, 'credentials', $2, $3, $4, $5)`,
    [source.source_ref, Boolean(wasValid), Boolean(isValid), actor?.id ? String(actor.id) : null, reason]
  );
}

const rowEnvelope = (row) => ({
  ciphertext: row.envelope_ciphertext, iv: row.envelope_iv, tag: row.envelope_tag, keyVersion: row.key_version,
});

function secretsOf(row, env) {
  if (!row || !row.envelope_ciphertext) return null;
  return decryptEnvelope({
    provider: row.provider_key, credentialRef: row.credential_ref, authType: row.auth_type, envelope: rowEnvelope(row),
  }, env);
}

// ── Opérations ────────────────────────────────────────────────────────────────

// Secrets hors-bande pour le connecteur : uniquement côté serveur, jamais renvoyés.
async function forSource(sourceRef, { q = db, env = process.env } = {}) {
  const { source } = await loadSource(sourceRef, q);
  const row = await loadActiveRow(source, q);
  if (!row || row.auth_type === 'oauth') return { credentialRef: row?.credential_ref || null, credentials: null };
  return { credentialRef: row.credential_ref, credentials: secretsOf(row, env) };
}

// Première configuration : enregistre le credential (actif, non testé). Le test est une action
// distincte. Une source déjà configurée se remplace par rotate() (testé avant bascule).
async function configure(sourceRef, input, actor, { q = db, env = process.env } = {}) {
  const { source, contract } = await loadSource(sourceRef, q);
  const secrets = validateSecrets(contract, input);
  const credentialRef = newCredentialRef();
  const envelope = encryptEnvelope({ provider: source.adapter_type, credentialRef, authType: contract.mode, secrets }, env);
  await db.withTransaction(async (client) => {
    const locked = (await loadSource(sourceRef, client, { lock: true })).source;
    if (await loadActiveRow(locked, client)) {
      throw fail(409, 'credentials_already_configured', 'Des identifiants existent déjà : utilisez le remplacement.');
    }
    await client.query(
      `INSERT INTO provider_credentials
         (credential_ref, provider_key, auth_type, status, envelope_ciphertext, envelope_iv, envelope_tag,
          key_version, created_by, activated_at)
       VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,NOW())`,
      [credentialRef, source.adapter_type, contract.mode, envelope.ciphertext, envelope.iv, envelope.tag,
        envelope.keyVersion, actor?.id ? String(actor.id) : null]
    );
    await client.query(
      `UPDATE sourcing_sources
          SET credential_ref = $2, connection_test_status = NULL, connection_test_code = NULL,
              connection_tested_at = NULL, updated_at = NOW()
        WHERE source_id = $1`,
      [source.source_ref, credentialRef]
    );
    await recordEvent(client, source, false, false, actor, 'credentials_configured');
  });
  return status(sourceRef, { q, env });
}

// Teste le credential actif (vault) et mémorise le résultat. Sans credential vault, teste le
// repli d'environnement / la session OAuth, comme avant.
async function test(sourceRef, { q = db, env = process.env } = {}) {
  const { source } = await loadSource(sourceRef, q);
  const row = await loadActiveRow(source, q);
  let credentials = null;
  if (row && row.auth_type !== 'oauth') {
    try { credentials = secretsOf(row, env); } catch (error) {
      return persistTest(source, row, { ok: false, code: 'credentials_unreadable', message: error.message }, q);
    }
  }
  const result = await importDispatch.testConnection(source.adapter_type, { credentials });
  return persistTest(source, row, result, q);
}

async function persistTest(source, row, result, q) {
  const code = result.ok ? null : result.code;
  const { rows: [tested] } = await q.query(
    `UPDATE sourcing_sources
        SET connection_test_status = $2, connection_test_code = $3, connection_tested_at = NOW()
      WHERE source_id = $1
      RETURNING connection_tested_at`,
    [source.source_ref, result.ok ? 'ok' : 'failed', code]
  );
  if (row) {
    await q.query(
      `UPDATE provider_credentials
          SET last_tested_at = NOW(), last_test_status = $2, last_test_code = $3, updated_at = NOW()
        WHERE credential_ref = $1`,
      [row.credential_ref, result.ok ? 'ok' : 'failed', code]
    );
  }
  return {
    source_ref: source.source_ref,
    ok: Boolean(result.ok),
    code: result.code,
    message: result.message,
    tested_at: tested?.connection_tested_at || null,
  };
}

// Remplacement sûr : le nouveau credential est testé AVANT toute bascule. En cas d'échec,
// l'ancien reste actif et inchangé ; le nouveau est marqué « failed » et son secret effacé.
async function rotate(sourceRef, input, actor, { q = db, env = process.env } = {}) {
  const { source, contract } = await loadSource(sourceRef, q);
  const secrets = validateSecrets(contract, input);
  const current = await loadActiveRow(source, q);
  if (!current) throw fail(409, 'credentials_not_configured', 'Aucun identifiant à remplacer : configurez la connexion.');

  const credentialRef = newCredentialRef();
  const envelope = encryptEnvelope({ provider: source.adapter_type, credentialRef, authType: contract.mode, secrets }, env);
  await q.query(
    `INSERT INTO provider_credentials
       (credential_ref, provider_key, auth_type, status, envelope_ciphertext, envelope_iv, envelope_tag,
        key_version, replaces_ref, created_by)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9)`,
    [credentialRef, source.adapter_type, contract.mode, envelope.ciphertext, envelope.iv, envelope.tag,
      envelope.keyVersion, current.credential_ref, actor?.id ? String(actor.id) : null]
  );

  const result = await importDispatch.testConnection(source.adapter_type, { credentials: secrets });
  if (!result.ok) {
    await q.query(
      `UPDATE provider_credentials
          SET status = 'failed', envelope_ciphertext = NULL, envelope_iv = NULL, envelope_tag = NULL,
              key_version = NULL, last_tested_at = NOW(), last_test_status = 'failed', last_test_code = $2,
              updated_at = NOW()
        WHERE credential_ref = $1`,
      [credentialRef, result.code]
    );
    return { source_ref: source.source_ref, ok: false, code: result.code, message: result.message, rotated: false };
  }

  await db.withTransaction(async (client) => {
    const locked = (await loadSource(sourceRef, client, { lock: true })).source;
    if (locked.credential_ref !== current.credential_ref) {
      throw fail(409, 'credentials_changed_concurrently', 'Les identifiants ont changé entre-temps : réessayez.');
    }
    await client.query(
      `UPDATE provider_credentials
          SET status = 'superseded', envelope_ciphertext = NULL, envelope_iv = NULL, envelope_tag = NULL,
              key_version = NULL, rotated_at = NOW(), updated_at = NOW()
        WHERE credential_ref = $1`,
      [current.credential_ref]
    );
    await client.query(
      `UPDATE provider_credentials
          SET status = 'active', activated_at = NOW(), last_tested_at = NOW(), last_test_status = 'ok',
              last_test_code = NULL, updated_at = NOW()
        WHERE credential_ref = $1`,
      [credentialRef]
    );
    await client.query(
      `UPDATE sourcing_sources
          SET credential_ref = $2, connection_test_status = 'ok', connection_test_code = NULL,
              connection_tested_at = NOW(), updated_at = NOW()
        WHERE source_id = $1`,
      [source.source_ref, credentialRef]
    );
    await recordEvent(client, source, current.last_test_status === 'ok', true, actor, 'credentials_rotated');
  });
  return { source_ref: source.source_ref, ok: true, code: 'connection_ok', message: 'Connexion valide', rotated: true };
}

// Révocation : le secret est effacé, la source n'a plus de credential et l'autopilot passe OFF.
async function revoke(sourceRef, actor, { q = db } = {}) {
  const { source } = await loadSource(sourceRef, q);
  await db.withTransaction(async (client) => {
    const locked = (await loadSource(sourceRef, client, { lock: true })).source;
    const row = await loadActiveRow(locked, client);
    if (!row) throw fail(409, 'credentials_not_configured', 'Aucun identifiant enregistré pour cette source.');
    await client.query(
      `UPDATE provider_credentials
          SET status = 'revoked', envelope_ciphertext = NULL, envelope_iv = NULL, envelope_tag = NULL,
              key_version = NULL, revoked_at = NOW(), updated_at = NOW()
        WHERE credential_ref = $1`,
      [row.credential_ref]
    );
    await client.query(
      `UPDATE sourcing_sources
          SET credential_ref = NULL, autopilot_enabled = false, connection_test_status = NULL,
              connection_test_code = NULL, connection_tested_at = NULL, updated_at = NOW()
        WHERE source_id = $1`,
      [source.source_ref]
    );
    await recordEvent(client, source, row.last_test_status === 'ok', false, actor, 'credentials_revoked');
  });
  return status(sourceRef, { q });
}

// Après le callback OAuth : la source pointe vers une ligne oauth (aucun token ici).
async function linkOAuthSession(sourceRef, { sessionKey, accountLabel = null, accessExpiresAt = null, refreshExpiresAt = null }, actor, { q = db } = {}) {
  const { source, contract } = await loadSource(sourceRef, q);
  if (contract.mode !== 'oauth' || contract.sessionKey !== sessionKey) {
    throw fail(409, 'credentials_not_configurable', 'Ce connecteur ne se connecte pas par autorisation.');
  }
  const credentialRef = newCredentialRef();
  await db.withTransaction(async (client) => {
    const locked = (await loadSource(sourceRef, client, { lock: true })).source;
    const previous = await loadActiveRow(locked, client);
    if (previous) {
      await client.query(
        `UPDATE provider_credentials SET status = 'superseded', rotated_at = NOW(), updated_at = NOW()
          WHERE credential_ref = $1`, [previous.credential_ref]);
    }
    await client.query(
      `INSERT INTO provider_credentials
         (credential_ref, provider_key, auth_type, status, oauth_session_key, provider_account_label,
          access_expires_at, refresh_expires_at, replaces_ref, created_by, activated_at)
       VALUES ($1,$2,'oauth','active',$3,$4,$5,$6,$7,$8,NOW())`,
      [credentialRef, source.adapter_type, sessionKey, accountLabel, accessExpiresAt, refreshExpiresAt,
        previous?.credential_ref || null, actor?.id ? String(actor.id) : null]
    );
    await client.query(
      `UPDATE sourcing_sources
          SET credential_ref = $2, connection_test_status = NULL, connection_test_code = NULL,
              connection_tested_at = NULL, updated_at = NOW()
        WHERE source_id = $1`,
      [source.source_ref, credentialRef]
    );
    await recordEvent(client, source, previous?.last_test_status === 'ok', false, actor, 'credentials_oauth_linked');
  });
  return status(sourceRef, { q });
}

// Pour un cycle d'exécution (autopilote, import opérateur) : état crédentiel + secrets déchiffrés
// côté serveur. Tout ce qui n'est pas « valid » ou « not_required » doit bloquer l'appelant.
async function resolveForRun(sourceRef, { q = db, env = process.env } = {}) {
  const { source, contract } = await loadSource(sourceRef, q);
  const row = await loadActiveRow(source, q);
  const session = await oauthSession(contract, env);
  let state = deriveCredentialState({
    contract, vault: row, connectionTestStatus: source.connection_test_status,
    productionCertified: Boolean(source.production_certified_at),
    oauthConnected: session ? session.connected !== false : undefined,
  });
  let credentials = null;
  if (row && row.auth_type !== 'oauth') {
    try { credentials = secretsOf(row, env); } catch (_) { state = 'invalid'; }
  }
  return { state, credentials, ok: state === 'valid' || state === 'not_required' };
}

// ── Statut (jamais un secret, pas même masqué) ────────────────────────────────

// Lecteurs de session OAuth serveur (aucun token : seulement l'état et les échéances).
const OAUTH_SESSION_READERS = Object.freeze({
  aliexpress: (env) => require('./suppliers/aliexpress-oauth').getConnectionStatus({ env }),
});

async function oauthSession(contract, env = process.env) {
  if (!contract || contract.mode !== 'oauth') return undefined;
  const reader = OAUTH_SESSION_READERS[contract.sessionKey];
  if (!reader) return { connected: false };
  try { return await reader(env); } catch (_) { return { connected: false }; }
}

// État crédentiel unique, autorité backend : valid | untested | invalid | missing | not_required.
// `oauthConnected` (false = session absente) ne concerne que les contrats oauth.
function deriveCredentialState({ contract, vault, connectionTestStatus, productionCertified = false, oauthConnected }) {
  if (!contract || contract.mode === 'none') return 'not_required';
  if (contract.mode === 'oauth' && oauthConnected === false) return 'missing';
  if (vault) {
    if (vault.last_test_status === 'ok') return 'valid';
    if (vault.last_test_status === 'failed') return 'invalid';
    return 'untested';
  }
  const available = contract.hasEnvironmentCredentials || contract.mode === 'oauth';
  if (!available) return 'missing';
  if (connectionTestStatus === 'failed') return 'invalid';
  return connectionTestStatus === 'ok' || productionCertified ? 'valid' : 'untested';
}

async function status(sourceRef, { q = db, env = process.env } = {}) {
  const { source, contract } = await loadSource(sourceRef, q);
  const row = await loadActiveRow(source, q);
  const session = await oauthSession(contract, env);
  const state = deriveCredentialState({
    contract, vault: row, connectionTestStatus: source.connection_test_status,
    productionCertified: Boolean(source.production_certified_at),
    oauthConnected: session ? session.connected !== false : undefined,
  });
  // Session OAuth : échéances lues en direct (le refresh automatique les fait évoluer).
  const expires = session?.refresh_expires_at || session?.access_expires_at
    || row?.refresh_expires_at || row?.access_expires_at || null;
  const expired = Boolean(expires && new Date(expires).getTime() <= Date.now());
  const outdatedKey = Boolean(row?.key_version && row.key_version < currentKeyVersion(env));
  return {
    source_ref: source.source_ref,
    auth_type: contract.mode,
    configured: state !== 'missing' && state !== 'not_required',
    connected: state === 'valid',
    credential_status: state,
    last_tested_at: row?.last_tested_at || null,
    last_test_status: row?.last_test_status || source.connection_test_status || null,
    expires_at: expires,
    rotation_required: state === 'invalid' || expired || outdatedKey,
    provider_account_label: session?.provider_user_nick || row?.provider_account_label || null,
  };
}

module.exports = {
  ProviderCredentialError,
  MASTER_KEY_ENV,
  configure,
  test,
  rotate,
  revoke,
  status,
  forSource,
  resolveForRun,
  linkOAuthSession,
  deriveCredentialState,
  oauthSession,
  redactSecrets,
  _encryptEnvelope: encryptEnvelope,
  _decryptEnvelope: decryptEnvelope,
  _validateSecrets: validateSecrets,
};
