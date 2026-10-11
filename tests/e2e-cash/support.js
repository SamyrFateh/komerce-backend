'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires postgres
 */

/**
 * Support de la recette cash multi-utilisateurs (service réellement déployé ou local).
 * Provisioning : fixture de délégation existante (Market, assignation, memberships, capacités),
 * rôles et mots de passe via les routes admin officielles, destination finale via la route
 * officielle de garde. Seul le rattachement agent↔relais et les 100 000 encaissés passent par SQL
 * (aucune route officielle ne les crée). Aucun JWT forgé : chaque acteur ouvre une vraie session.
 * Fixtures identifiables (préfixe E2E-CASH-) ; les faits financiers append-only ne sont jamais purgés.
 */

const crypto = require('crypto');

const PREFIX = 'E2E-CASH';
const PASSWORD = process.env.E2E_CASH_PASSWORD || `E2eCash-${crypto.randomBytes(6).toString('hex')}-Aa1!`;
const rnd = () => crypto.randomBytes(3).toString('hex');

function target() {
  const base = (process.env.E2E_BASE_URL || 'http://localhost:3911').replace(/\/$/, '');
  const host = new URL(base).hostname;
  const local = ['localhost', '127.0.0.1'].includes(host);
  // Cible distante : confirmation explicite du nom d'hôte exact, sinon refus (aucun effet par défaut).
  if (!local && process.env.E2E_CASH_TARGET_CONFIRMED !== host) {
    throw new Error(`Cible ${host} non confirmée : définir E2E_CASH_TARGET_CONFIRMED=${host} (environnement de test uniquement).`);
  }
  return { base, host, local };
}

async function api(request, method, path, body) {
  const response = await request.fetch(path, {
    method,
    headers: { 'content-type': 'application/json', origin: target().base },
    data: body === undefined ? undefined : JSON.stringify(body),
    failOnStatusCode: false,
  });
  let json = null;
  try { json = await response.json(); } catch (_) { /* corps vide */ }
  return { status: response.status(), json };
}

async function login(request, email, password) {
  const res = await api(request, 'POST', '/api/auth/login', { email, password });
  if (res.status !== 200) throw new Error(`login ${email} → ${res.status}`);
  return res.json.user;
}

module.exports = { PREFIX, PASSWORD, rnd, target, api, login };
