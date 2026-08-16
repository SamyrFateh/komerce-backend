'use strict';

const KNOWN_ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production']);
const MUTANT_SAFE_ENVIRONMENTS = new Set(['test', 'staging']);

function normalizeEnvironment(value) {
  return String(value || '').trim().toLowerCase();
}

function getDeclaredEnvironment(env = process.env) {
  const declared = normalizeEnvironment(env.KOMERCE_ENV);
  if (!declared) {
    throw new Error(
      '[R5][FAIL-CLOSED] KOMERCE_ENV absent. ' +
      'Déclarer explicitement test, staging ou production ; le domaine ne définit jamais l’environnement.'
    );
  }
  if (!KNOWN_ENVIRONMENTS.has(declared)) {
    throw new Error(`[R5][FAIL-CLOSED] KOMERCE_ENV inconnu: "${declared}".`);
  }
  return declared;
}

function assertDeclaredMutantTargetSafe(env = process.env) {
  const declared = getDeclaredEnvironment(env);
  if (!MUTANT_SAFE_ENVIRONMENTS.has(declared)) {
    throw new Error(
      `[R5][FAIL-CLOSED] Tests mutants refusés avec KOMERCE_ENV="${declared}". ` +
      'Ils ne sont autorisés que sur test ou staging.'
    );
  }
  return declared;
}

async function assertRemoteMutantTargetSafe({ env = process.env, fetchImpl = global.fetch } = {}) {
  const declared = assertDeclaredMutantTargetSafe(env);
  const base = env.BASE_URL || 'http://localhost:3000/boutique/';
  const healthUrl = new URL('/health', base).href;

  if (typeof fetchImpl !== 'function') {
    throw new Error('[R5][FAIL-CLOSED] fetch indisponible pour vérifier /health.');
  }

  let response;
  try {
    response = await fetchImpl(healthUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    throw new Error(`[R5][FAIL-CLOSED] /health inaccessible (${healthUrl}) : ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`[R5][FAIL-CLOSED] /health a répondu HTTP ${response.status}.`);
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new Error(`[R5][FAIL-CLOSED] /health JSON illisible : ${err.message}`);
  }

  const serverEnvironment = normalizeEnvironment(body.komerce_env);
  if (!serverEnvironment || !KNOWN_ENVIRONMENTS.has(serverEnvironment)) {
    throw new Error(
      `[R5][FAIL-CLOSED] Le serveur ne publie pas un komerce_env valide ` +
      `(reçu: "${body.komerce_env ?? 'absent'}").`
    );
  }

  if (serverEnvironment !== declared) {
    throw new Error(
      `[R5][FAIL-CLOSED] Environnement cible incohérent : runner="${declared}", ` +
      `serveur="${serverEnvironment}". Aucun test mutant exécuté.`
    );
  }

  if (!MUTANT_SAFE_ENVIRONMENTS.has(serverEnvironment)) {
    throw new Error(
      `[R5][FAIL-CLOSED] Le serveur cible est "${serverEnvironment}" ; ` +
      'les mutations financières sont interdites.'
    );
  }

  return { environment: serverEnvironment, healthUrl };
}

module.exports = {
  KNOWN_ENVIRONMENTS,
  MUTANT_SAFE_ENVIRONMENTS,
  getDeclaredEnvironment,
  assertDeclaredMutantTargetSafe,
  assertRemoteMutantTargetSafe,
};
