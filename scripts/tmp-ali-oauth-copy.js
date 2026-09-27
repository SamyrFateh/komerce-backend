#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required');

  const src = new Client({ connectionString: sourceUrl });
  const dst = new Client({ connectionString: targetUrl });
  await src.connect();
  await dst.connect();

  try {
    const ddl = fs.readFileSync('migrations/218_supplier_oauth_connections.sql', 'utf8');
    await dst.query(ddl);

    const { rows } = await src.query(
      'SELECT * FROM supplier_oauth_connections WHERE supplier_key = $1',
      ['aliexpress']
    );
    if (rows.length !== 1) {
      throw new Error('AliExpress OAuth row missing or ambiguous');
    }

    const r = rows[0];
    await dst.query(
      `INSERT INTO supplier_oauth_connections (
         supplier_key,
         access_token_ciphertext, access_token_iv, access_token_tag,
         refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
         access_expires_at, refresh_expires_at,
         provider_user_id, provider_user_nick, token_type,
         created_at, updated_at, last_refreshed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (supplier_key) DO UPDATE SET
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         access_token_iv = EXCLUDED.access_token_iv,
         access_token_tag = EXCLUDED.access_token_tag,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         refresh_token_iv = EXCLUDED.refresh_token_iv,
         refresh_token_tag = EXCLUDED.refresh_token_tag,
         access_expires_at = EXCLUDED.access_expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         provider_user_id = EXCLUDED.provider_user_id,
         provider_user_nick = EXCLUDED.provider_user_nick,
         token_type = EXCLUDED.token_type,
         updated_at = EXCLUDED.updated_at,
         last_refreshed_at = EXCLUDED.last_refreshed_at`,
      [
        r.supplier_key,
        r.access_token_ciphertext, r.access_token_iv, r.access_token_tag,
        r.refresh_token_ciphertext, r.refresh_token_iv, r.refresh_token_tag,
        r.access_expires_at, r.refresh_expires_at,
        r.provider_user_id, r.provider_user_nick, r.token_type,
        r.created_at, r.updated_at, r.last_refreshed_at,
      ]
    );

    console.log('ALI_OAUTH_COPY_OK');
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
