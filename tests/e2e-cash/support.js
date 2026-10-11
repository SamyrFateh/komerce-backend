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

/**
 * Prévalidation SANS écriture, avant toute fixture : cible, état du service, identité de la base
 * (l'id de l'admin vu par l'API doit être celui de la base jointe), authentification admin et
 * surveillance des effets externes. Échoue (rien n'est créé) si l'une des garanties manque.
 */
async function preflight({ db, request, adminEmail, adminPassword }) {
  const t = target();
  const health = await (await request.get('/health')).json().catch(() => ({}));
  if (health.status !== 'ok' || health.db !== 'connected') throw new Error('prévalidation : service indisponible');
  if (!t.local && health.komerce_env !== 'staging') throw new Error(`prévalidation : komerce_env=${health.komerce_env} (staging attendu)`);

  if (!process.env.DATABASE_URL) throw new Error('prévalidation : DATABASE_URL requise (base du service ciblé)');
  const dbHost = new URL(process.env.DATABASE_URL).hostname;
  if (!['localhost', '127.0.0.1'].includes(dbHost) && process.env.E2E_CASH_DB_HOST_CONFIRMED !== dbHost) {
    throw new Error(`prévalidation : hôte PostgreSQL ${dbHost} non confirmé (E2E_CASH_DB_HOST_CONFIRMED=${dbHost})`);
  }
  const { rows: [ident] } = await db.query('SELECT current_database() AS name, now() AS started_at');

  const user = await login(request, adminEmail, adminPassword);
  if (user.role !== 'admin') throw new Error('prévalidation : le compte n’est pas admin');
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [adminEmail.toLowerCase()]);
  if (!rows.length || String(rows[0].id) !== String(user.id)) {
    throw new Error('prévalidation : la base jointe n’est pas celle du service (identité admin différente)');
  }

  // Surveillance des effets externes : toute table de notification/outbox portant created_at.
  const { rows: monitors } = await db.query(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'created_at' AND c.table_name ~ '(notif|outbox|sms|whatsapp)'
      ORDER BY 1`);
  if (!monitors.length) throw new Error('prévalidation : aucune table de notification à surveiller — garantie d’absence d’effet externe indisponible');
  return { target: t, database: ident.name, dbHost, started_at: ident.started_at, monitors: monitors.map(m => m.table_name) };
}

async function externalEffects(db, { monitors, started_at }) {
  const out = {};
  for (const table of monitors) {
    const { rows: [r] } = await db.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE created_at >= $1`, [started_at]);
    out[table] = r.n;
  }
  return out;
}

module.exports = { PREFIX, PASSWORD, rnd, target, api, login, preflight, externalEffects };
