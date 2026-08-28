/**
 * @komerce-arch
 * @role          runtime-environment-guard
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   high
 * @inputs        KOMERCE_ENV, NODE_ENV, optional_bypass_env_var
 * @outputs       next_or_403
 * @depends       none
 * @used-by       routes/admin/system.js, routes/simulator.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      production_sensitive_routes_fail_closed_on_business_environment
 * @impact-areas  security, admin-dashboard, simulator
 * @version       2026-08
 */
'use strict';

function resolveRuntimeEnvironment() {
  const komerceEnv = String(process.env.KOMERCE_ENV || '').trim().toLowerCase();
  if (komerceEnv) return { env: komerceEnv, source: 'KOMERCE_ENV' };

  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  return { env: nodeEnv, source: 'NODE_ENV' };
}

function requireNonProduction(bypassEnvVar) {
  return (req, res, next) => {
    const { env, source } = resolveRuntimeEnvironment();
    const bypass = Boolean(bypassEnvVar) && process.env[bypassEnvVar] === 'true';

    if (env === 'production' && !bypass) {
      return res.status(403).json({
        error: 'Endpoint désactivé en production',
        environment_source: source,
        ...(bypassEnvVar ? { hint: `Définissez explicitement ${bypassEnvVar}=true pour une activation exceptionnelle` } : {}),
      });
    }

    next();
  };
}

module.exports = { requireNonProduction, resolveRuntimeEnvironment };
