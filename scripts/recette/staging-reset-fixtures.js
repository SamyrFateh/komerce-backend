/**
 * @komerce-arch
 * @role          staging-reset-fixtures
 * @domain        infrastructure
 * @layer         script
 * @criticality   critical
 * @inputs        client PostgreSQL, regles de scripts/recette/staging-reset-classification.js, KOMERCE_STAGING_RESET_KEEP_EMAILS
 * @outputs       plan (lecture seule) et retrait transactionnel des comptes/relais/partenaires de test
 * @depends       scripts/recette/staging-reset-classification.js
 * @used-by       scripts/controlled-business-purge.js
 * @db-read       users, relais, partners, pg_catalog, tables fixture_scoped
 * @db-write      users, relais, partners, assignment_memberships, membership_capabilities, operator_market_scopes, market_team_invitations, webauthn_credentials, *_global_access_grants
 * @db-txn        caller-owned (transaction ouverte par controlled-business-purge)
 * @doctrine      staging_environment_reset_not_a_business_transaction_targeted_delete_fk_respected_blockers_never_forced
 * @impact-areas  database, staging, auth, recette
 * @version       2026-11
 */
'use strict';

/**
 * Pourquoi un DELETE cible est legitime ici : c'est un reset d'ENVIRONNEMENT Staging, pas une transaction metier.
 * Aucun service canonique ne supprime un compte (user-mutation-service ne cree/modifie que ; le cycle metier
 * desactive, il ne supprime jamais) ; les scripts de retrait existants (staging-rct1-retire-*) ne couvrent que
 * les produits. Garde-fous : seules les lignes designees par les regles deterministes de la classification
 * (jamais par role), allowlist explicite, FK respectees (aucun CASCADE implicite sur la fondation : toute
 * reference non resolue devient un BLOCAGE rapporte, jamais force), au moins un admin doit subsister,
 * chaque DELETE doit supprimer exactement le nombre planifie.
 */

const {
  FIXTURE_OWNER_COLUMNS, FIXTURE_ROOT_TABLES, classOf, allowlistFrom,
  userFixtureReason, relaisFixtureReason, partnerFixtureReason,
} = require('./staging-reset-classification');

const ident = (name) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
};
const maskEmail = (e) => (e ? String(e).replace(/^(.{2}).*(@.*)$/, '$1***$2') : null);
const ROOT_PARAM = Object.freeze({ users: '$1', relais: '$2', partners: '$3' });

async function foreignKeys(q) {
  const { rows } = await q.query(
    `SELECT child.relname AS child, parent.relname AS parent, c.confdeltype AS deltype,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS parent_cols
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_class parent ON parent.oid = c.confrelid
       JOIN pg_namespace nc ON nc.oid = child.relnamespace AND nc.nspname = 'public'
       JOIN pg_namespace np ON np.oid = parent.relnamespace AND np.nspname = 'public'
      WHERE c.contype = 'f'
      ORDER BY child.relname, parent.relname, c.conname`
  );
  return rows;
}

/** Identifie fixtures et comptes conserves. Lecture seule. */
async function findFixtures(q, env = process.env) {
  const allow = allowlistFrom(env);
  const { rows: users } = await q.query(`SELECT id, email, full_name, role::text AS role FROM users ORDER BY id`);
  const { rows: relais } = await q.query(`SELECT id, name, address FROM relais ORDER BY id`);
  const { rows: partners } = await q.query(`SELECT id, name, email FROM partners ORDER BY id`);
  const fx = {
    users: users.map((u) => ({ u, reason: userFixtureReason(u, allow) })).filter((x) => x.reason),
    relais: relais.map((r) => ({ r, reason: relaisFixtureReason(r) })).filter((x) => x.reason),
    partners: partners.map((p) => ({ p, reason: partnerFixtureReason(p) })).filter((x) => x.reason),
  };
  const fixtureUserIds = new Set(fx.users.map((x) => x.u.id));
  const kept = users.filter((u) => !fixtureUserIds.has(u.id));
  const keptByRole = {};
  for (const u of kept) keptByRole[u.role] = (keptByRole[u.role] || 0) + 1;
  return {
    ids: { users: fx.users.map((x) => x.u.id), relais: fx.relais.map((x) => x.r.id), partners: fx.partners.map((x) => x.p.id) },
    summary: {
      users: fx.users.length,
      relais: fx.relais.length,
      partners: fx.partners.length,
      users_by_reason: fx.users.reduce((a, x) => ({ ...a, [x.reason]: (a[x.reason] || 0) + 1 }), {}),
      users_removed_sample: fx.users.slice(0, 20).map((x) => ({ email: maskEmail(x.u.email), role: x.u.role })),
      users_kept_by_role: keptByRole,
      users_kept_allowlisted: kept.filter((u) => allow.has(String(u.email || '').toLowerCase())).map((u) => maskEmail(u.email)),
      users_kept_unmatched: kept.filter((u) => !allow.has(String(u.email || '').toLowerCase()))
        .map((u) => ({ email: maskEmail(u.email), role: u.role })),
    },
    admins_remaining: kept.filter((u) => u.role === 'admin').length,
  };
}

function orPreds(set) {
  return [...set].map((p) => `(${p})`).join(' OR ');
}

/**
 * Plan par fermeture FK depuis les racines fixtures. `purgeSet` = tables videes par la purge (ignorees).
 * Retourne { predicates: Map(table -> Set(pred)), classified } sans aucune ecriture. Le predicat d'une table est
 * l'union (OR) des termes de ses aretes "delete" entrantes, evalues recursivement sur le predicat du parent (memoise).
 */
function buildDeleteGraph(edges, purgeSet) {
  const classified = [];
  const inDelete = new Set(FIXTURE_ROOT_TABLES);
  const queue = [...FIXTURE_ROOT_TABLES];
  while (queue.length) {
    const parent = queue.shift();
    for (const e of edges.filter((x) => x.parent === parent && x.child !== parent)) {
      let action;
      if (purgeSet.has(e.child)) action = 'ignore';
      else if (e.deltype === 'n') action = 'null';
      else if (classOf(e.child) === 'fixture_scoped') {
        const owner = (FIXTURE_OWNER_COLUMNS[e.child] || []).some((c) => e.cols.includes(c));
        const rootParent = FIXTURE_ROOT_TABLES.includes(e.parent);
        action = (!rootParent || owner || e.deltype === 'c') ? 'delete' : 'guard';
      } else action = 'guard';
      classified.push({ ...e, action });
      if (action === 'delete' && !inDelete.has(e.child)) { inDelete.add(e.child); queue.push(e.child); }
    }
  }
  const incoming = (t) => classified.filter((e) => e.action === 'delete' && e.child === t);
  const memo = new Map();
  const visiting = new Set();
  const predOf = (t) => {
    if (memo.has(t)) return memo.get(t);
    if (visiting.has(t)) throw new Error(`FIXTURE_PREDICATE_CYCLE:${t}`);
    visiting.add(t);
    const terms = new Set();
    if (FIXTURE_ROOT_TABLES.includes(t)) terms.add(`id = ANY(${ROOT_PARAM[t]}::uuid[])`);
    for (const e of incoming(t)) {
      terms.add(`(${e.cols.map(ident).join(',')}) IN (SELECT ${e.parent_cols.map(ident).join(',')} FROM ${ident(e.parent)} WHERE ${orPreds(predOf(e.parent))})`);
    }
    visiting.delete(t);
    memo.set(t, terms);
    return terms;
  };
  const predicates = new Map([...inDelete].sort().map((t) => [t, predOf(t)]));
  return { predicates, classified };
}

/** Ordre enfants avant parents (Kahn) parmi les tables a supprimer. */
function deleteOrder(tables, edges) {
  const set = new Set(tables);
  const blockers = new Map(tables.map((t) => [t, new Set()])); // t attend que ses enfants soient supprimes
  for (const e of edges) if (set.has(e.child) && set.has(e.parent) && e.child !== e.parent) blockers.get(e.parent).add(e.child);
  const order = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter((t) => [...blockers.get(t)].every((c) => !remaining.has(c))).sort();
    if (!ready.length) throw new Error(`FIXTURE_DELETE_CYCLE:${[...remaining].sort().join(',')}`);
    for (const t of ready) { order.push(t); remaining.delete(t); }
  }
  return order;
}

// PostgreSQL refuse un bind dont un parametre n'est pas reference : on reference toujours $1..$3 (tableaux d'ids non nuls).
const BOUND = '$1::uuid[] IS NOT NULL AND $2::uuid[] IS NOT NULL AND $3::uuid[] IS NOT NULL';

async function countWhere(q, table, where, params) {
  const { rows: [r] } = await q.query(`SELECT COUNT(*)::bigint AS c FROM ${ident(table)} WHERE (${where}) AND ${BOUND}`, params);
  return Number(r.c);
}

/** Plan complet, SELECT uniquement. */
async function buildFixturePlan(q, { env = process.env, purgeTables = [] } = {}) {
  const fixtures = await findFixtures(q, env);
  const edges = await foreignKeys(q);
  const purgeSet = new Set(purgeTables);
  const { predicates, classified } = buildDeleteGraph(edges, purgeSet);
  const params = [fixtures.ids.users, fixtures.ids.relais, fixtures.ids.partners];
  const hasAny = params.some((p) => p.length);

  const wherefor = (t) => orPreds(predicates.get(t));
  const order = deleteOrder([...predicates.keys()], edges);
  const wouldDelete = {};
  if (hasAny) for (const t of order) wouldDelete[t] = await countWhere(q, t, wherefor(t), params);

  const blockers = [];
  const nulled = {};
  if (hasAny) {
    for (const e of classified.filter((x) => x.action === 'guard' || x.action === 'null')) {
      const own = predicates.has(e.child) ? ` AND NOT COALESCE((${wherefor(e.child)}), FALSE)` : '';
      const n = await countWhere(
        q, e.child,
        `(${e.cols.map(ident).join(',')}) IN (SELECT ${e.parent_cols.map(ident).join(',')} FROM ${ident(e.parent)} WHERE ${wherefor(e.parent)})${own}`,
        params
      );
      if (!n) continue;
      if (e.action === 'null') nulled[`${e.child}.${e.cols.join('+')}`] = n;
      else blockers.push({ code: 'FIXTURE_REFERENCED_BY_NON_FIXTURE_ROW', table: e.child, columns: e.cols, references: e.parent, rows: n });
    }
  }
  if (fixtures.summary.users > 0 && fixtures.admins_remaining < 1) blockers.push({ code: 'NO_ADMIN_WOULD_REMAIN', table: 'users', rows: 0 });
  return {
    summary: fixtures.summary,
    would_delete: Object.fromEntries(Object.entries(wouldDelete).filter(([, n]) => n > 0)),
    nulled_references: nulled,
    blockers,
    _exec: { order, predicates, params, wouldDelete, hasAny },
  };
}

/** Execute le plan DANS la transaction du client. Echoue (ROLLBACK par l'appelant) au moindre ecart. */
async function retireFixtures(client, plan, { env = process.env } = {}) {
  if (plan.blockers.length) {
    const err = new Error(`FIXTURE_RETIREMENT_BLOCKED:${JSON.stringify(plan.blockers)}`);
    err.report = plan;
    throw err;
  }
  const { order, predicates, params, wouldDelete, hasAny } = plan._exec;
  const deleted = {};
  if (hasAny) {
    for (const t of order) {
      const planned = await countWhere(client, t, orPreds(predicates.get(t)), params);
      if (planned !== (wouldDelete[t] || 0)) throw new Error(`FIXTURE_PLAN_DRIFT:${t}:${wouldDelete[t] || 0}->${planned}`);
      const res = await client.query(`DELETE FROM ${ident(t)} WHERE (${orPreds(predicates.get(t))}) AND ${BOUND}`, params);
      if (res.rowCount !== planned) throw new Error(`FIXTURE_DELETE_COUNT_MISMATCH:${t}:${planned}!=${res.rowCount}`);
      if (res.rowCount) deleted[t] = res.rowCount;
    }
  }
  const after = await findFixtures(client, env);
  const residual = after.summary.users + after.summary.relais + after.summary.partners;
  if (residual) throw new Error(`FIXTURE_RESIDUAL:${JSON.stringify({ users: after.summary.users, relais: after.summary.relais, partners: after.summary.partners })}`);
  if (plan.summary.users > 0 && after.admins_remaining < 1) throw new Error('FIXTURE_NO_ADMIN_REMAINING');
  return deleted;
}

module.exports = { foreignKeys, findFixtures, buildDeleteGraph, deleteOrder, buildFixturePlan, retireFixtures, maskEmail };
