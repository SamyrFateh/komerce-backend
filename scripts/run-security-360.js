#!/usr/bin/env node
'use strict';

/**
 * run-security-360.js — runner de cartographie sécurité.
 *
 * Le générateur Security 360 introspecte les routeurs Express en chargeant une
 * partie de l'application. En prod, l'app doit refuser de démarrer sans vrais
 * secrets. En cartographie locale/CI, on a seulement besoin de construire le
 * graphe des routes : ce runner fournit donc des valeurs factices si
 * l'environnement n'en fournit pas déjà.
 */

const AUDIT_ENV = {
  JWT_SECRET: 'security-360-local-audit-only-not-for-runtime',
  META_WA_APP_SECRET: 'security-360-meta-app-secret-audit-only',
  META_WA_VERIFY_TOKEN: 'security-360-meta-verify-token-audit-only',
  META_WA_TOKEN: 'security-360-meta-token-audit-only',
  META_WA_PHONE_NUMBER_ID: '000000000000000',
  ADMIN_WHATSAPP: '0000000000',
};

for (const [key, value] of Object.entries(AUDIT_ENV)) {
  if (!process.env[key]) process.env[key] = value;
}

require('./gen-security-360.js');
