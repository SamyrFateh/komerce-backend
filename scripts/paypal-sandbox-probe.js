/**
 * @komerce-arch
 * @role          paypal-sandbox-ops-probe
 * @domain        payment
 * @layer         tooling
 * @criticality   medium
 * @inputs        KOMERCE_ENV, PAYPAL_ENV, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
 * @outputs       process_exit_code, redacted_probe_log
 * @depends       middleware/require-non-production.js
 * @db-read       none
 * @db-write      none
 * @doctrine      staging_provider_probe_never_logs_credentials_or_tokens
 * @impact-areas  payment, operations
 * @version       2026-09
 */
'use strict';

const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');

async function main() {
  const { env: runtimeEnv } = resolveRuntimeEnvironment();

  if (runtimeEnv === 'production') {
    console.error('[PAYPAL-PROBE] REFUSED runtime=production');
    process.exitCode = 2;
    return;
  }

  if (process.env.PAYPAL_ENV !== 'sandbox') {
    console.error(`[PAYPAL-PROBE] REFUSED PAYPAL_ENV=${process.env.PAYPAL_ENV || '(absent)'} expected=sandbox`);
    process.exitCode = 2;
    return;
  }

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    console.error('[PAYPAL-PROBE] MISSING_CREDENTIALS');
    process.exitCode = 2;
    return;
  }

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const startedAt = Date.now();

  try {
    const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      let providerError = 'unknown';
      try {
        const body = await response.json();
        providerError = body?.error || providerError;
      } catch {
        // Ne jamais imprimer le body brut : le probe reste volontairement minimal.
      }
      console.error(`[PAYPAL-PROBE] FAIL env=sandbox http=${response.status} error=${providerError} latency_ms=${latencyMs}`);
      process.exitCode = 3;
      return;
    }

    // On consomme la réponse sans jamais afficher access_token ni app credentials.
    const body = await response.json();
    if (!body?.access_token) {
      console.error(`[PAYPAL-PROBE] FAIL env=sandbox http=${response.status} error=missing_access_token latency_ms=${latencyMs}`);
      process.exitCode = 3;
      return;
    }

    console.log(`[PAYPAL-PROBE] OK env=sandbox http=${response.status} latency_ms=${latencyMs}`);
  } catch (error) {
    console.error(`[PAYPAL-PROBE] NETWORK_ERROR env=sandbox type=${error?.name || 'Error'}`);
    process.exitCode = 4;
  }
}

main();
