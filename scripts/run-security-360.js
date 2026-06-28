#!/usr/bin/env node
'use strict';

/**
 * run-security-360.js — runner de cartographie sécurité.
 *
 * Le générateur Security 360 introspecte les routeurs Express en chargeant une
 * partie de l'application. En prod, l'app doit refuser de démarrer sans vrai
 * JWT_SECRET. En cartographie locale/CI, on a seulement besoin de construire le
 * graphe des routes : ce runner fournit donc un secret factice si l'environnement
 * n'en fournit pas déjà un.
 */

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'security-360-local-audit-only-not-for-runtime';
}

require('./gen-security-360.js');
