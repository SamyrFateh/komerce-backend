/**
 * @komerce-arch
 * @role          aliexpress-oauth-session-manager
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        AliExpress OAuth code/refresh token, provider app credentials
 * @outputs       valid AliExpress access token/session key, safe connection status
 * @depends       db.js, node:crypto
 * @used-by       routes/integrations-aliexpress.js, services/suppliers/connectors/aliexpress-connected-connector.js
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, supplier-import, secrets
 * @version       2026-09-v2
 */
'use strict';

const crypto = require('crypto');
const db = require('../../db');

const SUPPLIER_KEY = 'aliexpress';
const AUTHORIZE_URL = 'https://api-sg.aliexpress.com/oauth/authorize';
const OPEN_API_BASE_URL = 'https://api-sg.aliexpress.com/rest';
const TOKEN_CREATE_PATH = '/auth/token/create';
const TOKEN_REFRESH_PATH = '/auth/token/refresh';
const DEFAULT_REDIRECT_URI = 'https://komerce.co/api/integrations/aliexpress/oauth/callback';
const DEFAULT_ACCESS_REFRESH_SKEW_SECONDS = 4 * 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 2 * 24 * 60 * 60;

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function config(env = process.env) {
  return {
    appKey: env.ALIEXPRESS_APP_KEY || '',
    appSecret: env.ALIEXPRESS_APP_SECRET || '',
    encryptionKeyRaw: env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY || '',
    redirectUri: env.ALIEXPRESS_OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    authorizeUrl: env.ALIEXPRESS_OAUTH_AUTHORIZE_URL || AUTHORIZE_URL,
    openApiBaseUrl: env.ALIEXPRESS_OPEN_API_BASE_URL || OPEN_API_BASE_URL,
    refreshSkewSeconds: positiveInt(env.ALIEXPRESS_ACCESS_REFRESH_SKEW_SECONDS, DEFAULT_ACCESS_REFRESH_SKEW_SECONDS),
    refreshTokenTtlSeconds: positiveInt(env.ALIEXPRESS_REFRESH_TOKEN_TTL_SECONDS, DEFAULT_REFRESH_TOKEN_TTL_SECONDS),
  };
}

function assertOAuthConfigured(env = process.env) {
  const c = config(env);
  const missing = [];
  if (!c.appKey) missing.push('ALIEXPRESS_APP_KEY');
  if (!c.appSecret) missing.push('ALIEXPRESS_APP_SECRET');
  if (!c.encryptionKeyRaw) missing.push('ALIEXPRESS_TOKEN_ENCRYPTION_KEY');
  if (missing.length) throw new Error(`[AliExpress OAuth] variables manquantes: ${missing.join(', ')}`);
  decodeEncryptionKey(c.encryptionKeyRaw);
  return c;
}

function decodeEncryptionKey(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('[AliExpress OAuth] ALIEXPRESS_TOKEN_ENCRYPTION_KEY manquante');

  let key = null;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    try {
      const decoded = Buffer.from(value, 'base64');
      if (decoded.length === 32 && decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')) key = decoded;
    } catch { /* invalid base64 */ }
  }
  if (!key || key.length !== 32) {
    throw new Error('[AliExpress OAuth] ALIEXPRESS_TOKEN_ENCRYPTION_KEY doit contenir exactement 32 octets (base64 ou 64 caractères hex)');
  }
  return key;
}

function aad(kind) {
  return Buffer.from(`komerce:supplier-oauth:${SUPPLIER_KEY}:${kind}`, 'utf8');
}

function encryptToken(token, keyRaw, kind) {
  if (!token) return null;
  const key = decodeEncryptionKey(keyRaw);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(kind));
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptToken(parts, keyRaw, kind) {
  if (!parts || !parts.ciphertext) return null;
  const key = decodeEncryptionKey(keyRaw);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts.iv, 'base64'));
  decipher.setAAD(aad(kind));
  decipher.setAuthTag(Buffer.from(parts.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function buildAuthorizationUrl(state, { env = process.env } = {}) {
  const c = assertOAuthConfigured(env);
  if (!state || String(state).length < 32) throw new Error('[AliExpress OAuth] state OAuth invalide');
  const url = new URL(c.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('force_auth', 'true');
  url.searchParams.set('redirect_uri', c.redirectUri);
  url.searchParams.set('client_id', c.appKey);
  url.searchParams.set('state', String(state));
  return url.toString();
}

function stringifyParam(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function signGopParams(path, params, secret) {
  const canonical = String(path || '') + Object.keys(params || {})
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}${stringifyParam(params[key])}`)
    .join('');
  return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex').toUpperCase();
}

function buildSystemRequest(path, businessParams = {}, { env = process.env, now = new Date() } = {}) {
  const c = assertOAuthConfigured(env);
  if (!/^\/auth\/token\//.test(path)) throw new Error('[AliExpress OAuth] chemin système non autorisé');

  const params = {
    app_key: c.appKey,
    simplify: 'true',
    sign_method: 'sha256',
    timestamp: String(now.getTime()),
  };
  for (const [key, value] of Object.entries(businessParams || {})) {
    if (value !== undefined && value !== null && value !== '') params[key] = stringifyParam(value);
  }
  params.sign = signGopParams(path, params, c.appSecret);
  const query = new URLSearchParams(params);
  return `${c.openApiBaseUrl.replace(/\/$/, '')}${path}?${query.toString()}`;
}

function parseProviderBody(text) {
  if (!text) return {};
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { /* continue */ }
  return Object.fromEntries(new URLSearchParams(String(text)));
}

function unwrapProviderPayload(value) {
  let payload = parseProviderBody(value);
  for (let depth = 0; depth < 4; depth += 1) {
    if (!payload || typeof payload !== 'object') return {};
    if (payload.access_token || payload.error_response || payload.error || payload.error_code) return payload;
    if (payload.gopResponseBody !== undefined && payload.gopResponseBody !== null) {
      payload = parseProviderBody(payload.gopResponseBody);
      continue;
    }
    if (payload.result && typeof payload.result === 'object') {
      payload = payload.result;
      continue;
    }
    if (payload.data && typeof payload.data === 'object') {
      payload = payload.data;
      continue;
    }
    break;
  }
  return payload || {};
}

function providerError(payload, status) {
  const err = payload?.error_response || payload || {};
  return err.sub_msg || err.error_description || err.error_msg || err.msg || err.message || err.error || err.error_code || `HTTP ${status}`;
}

async function requestSystemToken(path, businessParams, { env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const url = buildSystemRequest(path, businessParams, { env, now });
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  const raw = parseProviderBody(text);
  const payload = unwrapProviderPayload(raw);
  if (!response.ok || payload.error_response || payload.error || payload.error_code) {
    throw new Error(`[AliExpress OAuth] échange token refusé: ${String(providerError(payload, response.status)).slice(0, 300)}`);
  }
  if (!payload.access_token) throw new Error('[AliExpress OAuth] access_token absent de la réponse fournisseur');
  return payload;
}

function secondsFromPayload(payload, names) {
  for (const name of names) {
    const n = Number(payload?.[name]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function dateFromProviderTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const millis = n < 1e12 ? n * 1000 : n;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTokenPayload(payload, { now = new Date(), env = process.env, previousRefreshToken = null, previousRefreshExpiresAt = null } = {}) {
  const c = config(env);
  const accessSeconds = secondsFromPayload(payload, ['expires_in']) || 24 * 60 * 60;
  const accessExpiresAt = dateFromProviderTimestamp(payload.expire_time)
    || new Date(now.getTime() + accessSeconds * 1000);

  const refreshToken = payload.refresh_token || previousRefreshToken || null;
  let refreshExpiresAt = null;
  if (refreshToken) {
    refreshExpiresAt = dateFromProviderTimestamp(payload.refresh_token_valid_time);
    if (!refreshExpiresAt) {
      const refreshSeconds = secondsFromPayload(payload, ['refresh_expires_in', 're_expires_in', 'refresh_token_expires_in']);
      if (refreshSeconds) refreshExpiresAt = new Date(now.getTime() + refreshSeconds * 1000);
      else if (payload.refresh_token && payload.refresh_token !== previousRefreshToken) {
        refreshExpiresAt = new Date(now.getTime() + c.refreshTokenTtlSeconds * 1000);
      } else if (previousRefreshExpiresAt) {
        refreshExpiresAt = new Date(previousRefreshExpiresAt);
      } else {
        refreshExpiresAt = new Date(now.getTime() + c.refreshTokenTtlSeconds * 1000);
      }
    }
  }

  return {
    accessToken: payload.access_token,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    providerUserId: payload.user_id != null ? String(payload.user_id) : (payload.account_id != null ? String(payload.account_id) : null),
    providerUserNick: payload.user_nick != null ? String(payload.user_nick) : (payload.account != null ? String(payload.account) : null),
    tokenType: payload.token_type ? String(payload.token_type) : 'Bearer',
  };
}

async function saveConnection(tokens, { env = process.env, dbImpl = db, now = new Date(), refreshed = false } = {}) {
  const c = assertOAuthConfigured(env);
  const access = encryptToken(tokens.accessToken, c.encryptionKeyRaw, 'access');
  const refresh = encryptToken(tokens.refreshToken, c.encryptionKeyRaw, 'refresh');
  await dbImpl.query(`
    INSERT INTO supplier_oauth_connections (
      supplier_key,
      access_token_ciphertext, access_token_iv, access_token_tag,
      refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
      access_expires_at, refresh_expires_at,
      provider_user_id, provider_user_nick, token_type,
      updated_at, last_refreshed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (supplier_key) DO UPDATE SET
      access_token_ciphertext = EXCLUDED.access_token_ciphertext,
      access_token_iv = EXCLUDED.access_token_iv,
      access_token_tag = EXCLUDED.access_token_tag,
      refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
      refresh_token_iv = EXCLUDED.refresh_token_iv,
      refresh_token_tag = EXCLUDED.refresh_token_tag,
      access_expires_at = EXCLUDED.access_expires_at,
      refresh_expires_at = EXCLUDED.refresh_expires_at,
      provider_user_id = COALESCE(EXCLUDED.provider_user_id, supplier_oauth_connections.provider_user_id),
      provider_user_nick = COALESCE(EXCLUDED.provider_user_nick, supplier_oauth_connections.provider_user_nick),
      token_type = EXCLUDED.token_type,
      updated_at = EXCLUDED.updated_at,
      last_refreshed_at = EXCLUDED.last_refreshed_at
  `, [
    SUPPLIER_KEY,
    access.ciphertext, access.iv, access.tag,
    refresh?.ciphertext || null, refresh?.iv || null, refresh?.tag || null,
    tokens.accessExpiresAt, tokens.refreshExpiresAt,
    tokens.providerUserId, tokens.providerUserNick, tokens.tokenType,
    now, refreshed ? now : null,
  ]);
}

async function loadConnection({ env = process.env, dbImpl = db } = {}) {
  const c = assertOAuthConfigured(env);
  const { rows } = await dbImpl.query(`
    SELECT supplier_key,
           access_token_ciphertext, access_token_iv, access_token_tag,
           refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
           access_expires_at, refresh_expires_at,
           provider_user_id, provider_user_nick, token_type,
           created_at, updated_at, last_refreshed_at
      FROM supplier_oauth_connections
     WHERE supplier_key = $1
  `, [SUPPLIER_KEY]);
  const row = rows?.[0];
  if (!row) return null;
  return {
    accessToken: decryptToken({ ciphertext: row.access_token_ciphertext, iv: row.access_token_iv, tag: row.access_token_tag }, c.encryptionKeyRaw, 'access'),
    refreshToken: row.refresh_token_ciphertext ? decryptToken({ ciphertext: row.refresh_token_ciphertext, iv: row.refresh_token_iv, tag: row.refresh_token_tag }, c.encryptionKeyRaw, 'refresh') : null,
    accessExpiresAt: new Date(row.access_expires_at),
    refreshExpiresAt: row.refresh_expires_at ? new Date(row.refresh_expires_at) : null,
    providerUserId: row.provider_user_id || null,
    providerUserNick: row.provider_user_nick || null,
    tokenType: row.token_type || 'Bearer',
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    lastRefreshedAt: row.last_refreshed_at ? new Date(row.last_refreshed_at) : null,
  };
}

async function exchangeAuthorizationCode(code, options = {}) {
  if (!code) throw new Error('[AliExpress OAuth] code d’autorisation manquant');
  const payload = await requestSystemToken(TOKEN_CREATE_PATH, { code: String(code) }, options);
  const tokens = normalizeTokenPayload(payload, options);
  await saveConnection(tokens, { ...options, refreshed: false });
  return safeStatus(tokens, { source: 'oauth_callback' });
}

async function refreshConnection(connection, options = {}) {
  const now = options.now || new Date();
  if (!connection?.refreshToken) throw new Error('[AliExpress OAuth] aucun refresh token disponible; nouvelle autorisation requise');
  if (connection.refreshExpiresAt && connection.refreshExpiresAt.getTime() <= now.getTime()) {
    throw new Error('[AliExpress OAuth] refresh token expiré; nouvelle autorisation AliExpress requise');
  }
  const payload = await requestSystemToken(TOKEN_REFRESH_PATH, { refresh_token: connection.refreshToken }, options);
  const tokens = normalizeTokenPayload(payload, {
    ...options,
    previousRefreshToken: connection.refreshToken,
    previousRefreshExpiresAt: connection.refreshExpiresAt,
  });
  await saveConnection(tokens, { ...options, refreshed: true });
  return tokens;
}

let refreshInFlight = null;
async function getValidAccessToken(options = {}) {
  const env = options.env || process.env;
  if (env.ALIEXPRESS_SESSION) return env.ALIEXPRESS_SESSION;

  const connection = await loadConnection(options);
  if (!connection) throw new Error('[AliExpress OAuth] compte AliExpress non autorisé; ouvrir /api/integrations/aliexpress/oauth/start');
  const now = options.now || new Date();
  const skewMs = config(env).refreshSkewSeconds * 1000;
  if (connection.accessExpiresAt.getTime() - now.getTime() > skewMs) return connection.accessToken;

  if (!refreshInFlight) {
    refreshInFlight = refreshConnection(connection, options)
      .finally(() => { refreshInFlight = null; });
  }
  const refreshed = await refreshInFlight;
  return refreshed.accessToken;
}

function safeStatus(connection, extra = {}) {
  if (!connection) return { connected: false, supplier: SUPPLIER_KEY, ...extra };
  return {
    connected: true,
    supplier: SUPPLIER_KEY,
    access_expires_at: connection.accessExpiresAt?.toISOString?.() || null,
    refresh_expires_at: connection.refreshExpiresAt?.toISOString?.() || null,
    provider_user_id: connection.providerUserId || null,
    provider_user_nick: connection.providerUserNick || null,
    last_refreshed_at: connection.lastRefreshedAt?.toISOString?.() || null,
    ...extra,
  };
}

async function getConnectionStatus(options = {}) {
  const env = options.env || process.env;
  if (env.ALIEXPRESS_SESSION) {
    return { connected: true, supplier: SUPPLIER_KEY, source: 'environment_session', access_expires_at: null, refresh_expires_at: null };
  }
  try {
    return safeStatus(await loadConnection(options), { source: 'encrypted_database' });
  } catch (err) {
    if (/variables manquantes|ENCRYPTION_KEY/.test(err.message)) {
      return { connected: false, supplier: SUPPLIER_KEY, source: 'not_configured', reason: err.message };
    }
    throw err;
  }
}

module.exports = {
  SUPPLIER_KEY,
  AUTHORIZE_URL,
  OPEN_API_BASE_URL,
  TOKEN_CREATE_PATH,
  TOKEN_REFRESH_PATH,
  DEFAULT_REDIRECT_URI,
  config,
  assertOAuthConfigured,
  decodeEncryptionKey,
  encryptToken,
  decryptToken,
  buildAuthorizationUrl,
  signGopParams,
  buildSystemRequest,
  parseProviderBody,
  unwrapProviderPayload,
  requestSystemToken,
  dateFromProviderTimestamp,
  normalizeTokenPayload,
  saveConnection,
  loadConnection,
  exchangeAuthorizationCode,
  refreshConnection,
  getValidAccessToken,
  getConnectionStatus,
  safeStatus,
};
