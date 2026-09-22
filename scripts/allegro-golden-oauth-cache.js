#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          allegro-golden-oauth-cache
 * @domain        sourcing
 * @layer         tooling
 * @owner         scripts/sourcing-continuity-allegro-stock-delta-proof.js
 * @purpose       Persist only the rotated READ-ONLY Golden refresh token as encrypted GitHub Actions cache data.
 * @impact-areas  sourcing, supplier-integration, secrets
 * @version       2026-09
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AAD = Buffer.from('komerce:supplier-oauth:allegro_sandbox:refresh');
const CACHE_DIR = 'komerce-allegro-golden-refresh-v1';
const CACHE_FILE = 'vault.json';
const CACHE_AAD_PREFIX = 'komerce:allegro:golden:refresh-cache:v1:';
const KEY_SALT = Buffer.from('komerce:allegro:golden:cache-key:v1');
const TOKEN_RE = /^[^\x00-\x1f\x7f\r\n]{20,12000}$/;

function isolated(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.KOMERCE_ENV !== 'staging' || env.KOMERCE_ALLOW_ALLEGRO_SANDBOX !== '1' ||
      env.DATABASE_URL !== 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_sourcing_proof' ||
      env.TEST_ONLY_OFFER_ACK !== 'true' ||
      !/^[0-9]{1,30}$/.test(env.OFFER_ID || '') ||
      !env.RUNNER_TEMP || !env.ALLEGRO_SANDBOX_CLIENT_ID?.trim() ||
      !env.ALLEGRO_SANDBOX_CLIENT_SECRET?.trim()) {
    throw new Error('GOLDEN_REFRESH_CACHE_ISOLATION_REQUIRED');
  }
}

function vaultPath(env) {
  isolated(env);
  return path.join(env.RUNNER_TEMP, CACHE_DIR, CACHE_FILE);
}

function vaultKey(clientId, clientSecret) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(clientSecret, 'utf8'),
    KEY_SALT, Buffer.from('read-only-golden:' + clientId, 'utf8'), 32));
}

function seal(token, clientId, clientSecret) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token) ||
      !clientId?.trim() || !clientSecret?.trim()) throw new Error('GOLDEN_REFRESH_CACHE_INVALID_INPUT');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(clientId, clientSecret), iv);
  cipher.setAAD(Buffer.from(CACHE_AAD_PREFIX + clientId));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    client_fingerprint: crypto.createHash('sha256').update(clientId).digest('hex'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  });
}

function unseal(raw, clientId, clientSecret) {
  let item;
  try {
    item = JSON.parse(raw);
    if (item.version !== 1 || item.client_fingerprint !==
      crypto.createHash('sha256').update(clientId).digest('hex')) {
      throw new Error('mismatched application');
    }
    for (const part of ['iv', 'ciphertext', 'tag']) {
      if (typeof item[part] !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(item[part])) {
        throw new Error('invalid cache');
      }
    }
    const iv = Buffer.from(item.iv, 'base64');
    const tag = Buffer.from(item.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16 ||
      Buffer.byteLength(item.ciphertext, 'base64') > 16000) throw new Error('invalid cache');
    const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey(clientId, clientSecret), iv);
    decipher.setAAD(Buffer.from(CACHE_AAD_PREFIX + clientId));
    decipher.setAuthTag(tag);
    const token = Buffer.concat([
      decipher.update(Buffer.from(item.ciphertext, 'base64')), decipher.final(),
    ]).toString('utf8');
    if (!TOKEN_RE.test(token)) throw new Error('invalid token');
    return token;
  } catch {
    throw new Error('GOLDEN_REFRESH_CACHE_UNREADABLE');
  }
}

function fromEphemeralDbRow(row, keyHex) {
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex || '')) throw new Error('GOLDEN_REFRESH_CACHE_KEY_REQUIRED');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'),
      Buffer.from(row.refresh_token_iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(row.refresh_token_tag, 'base64'));
    const token = Buffer.concat([
      decipher.update(Buffer.from(row.refresh_token_ciphertext, 'base64')), decipher.final(),
    ]).toString('utf8');
    if (!TOKEN_RE.test(token)) throw new Error('invalid token');
    return token;
  } catch {
    throw new Error('GOLDEN_REFRESH_CACHE_DB_TOKEN_UNREADABLE');
  }
}

async function main(mode, env = process.env) {
  const file = vaultPath(env);
  const clientId = env.ALLEGRO_SANDBOX_CLIENT_ID.trim();
  const clientSecret = env.ALLEGRO_SANDBOX_CLIENT_SECRET.trim();
  if (mode === 'restore') {
    if (!fs.existsSync(file)) {
      process.stdout.write('GOLDEN_REFRESH_CACHE_MISS\n');
      return;
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 32768) throw new Error('GOLDEN_REFRESH_CACHE_UNREADABLE');
    const token = unseal(fs.readFileSync(file, 'utf8'), clientId, clientSecret);
    if (!env.GITHUB_ENV) throw new Error('GOLDEN_REFRESH_CACHE_GITHUB_ENV_REQUIRED');
    // Mask before putting the restored token in the environment of later steps.
    process.stdout.write('::add-mask::' + token + '\n');
    fs.appendFileSync(env.GITHUB_ENV, 'ALLEGRO_SANDBOX_REFRESH_TOKEN=' + token + '\n',
      { encoding: 'utf8' });
    process.stdout.write('GOLDEN_REFRESH_CACHE_RESTORED\n');
    return;
  }
  if (mode !== 'save') throw new Error('GOLDEN_REFRESH_CACHE_MODE_INVALID');
  if (!env.GITHUB_OUTPUT) throw new Error('GOLDEN_REFRESH_CACHE_GITHUB_OUTPUT_REQUIRED');
  const db = require('../db');
  try {
    const { rows } = await db.query(
      'SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_tag FROM supplier_oauth_connections WHERE supplier_key=$1',
      ['allegro_sandbox']);
    if (!rows.length) {
      fs.appendFileSync(env.GITHUB_OUTPUT, 'has_rotated_token=false\n');
      process.stdout.write('GOLDEN_REFRESH_CACHE_NO_ROTATION\n');
      return;
    }
    const token = fromEphemeralDbRow(rows[0], env.ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY);
    const encrypted = seal(token, clientId, clientSecret);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, encrypted, { encoding: 'utf8', mode: 0o600, flag: 'w' });
    fs.appendFileSync(env.GITHUB_OUTPUT, 'has_rotated_token=true\n');
    process.stdout.write('GOLDEN_REFRESH_CACHE_SEALED\n');
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) {
  main(process.argv[2]).catch(() => {
    // NEVER print raw OAuth responses, token, DB diagnostics, or exception texts.
    process.stderr.write('GOLDEN_REFRESH_CACHE_STEP_FAILED\n');
    process.exitCode = 1;
  });
}

module.exports = { isolated, vaultPath, seal, unseal, fromEphemeralDbRow, main };
