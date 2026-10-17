'use strict';
/** @komerce-arch
 * @role golden-staging-deep-clean
 * @domain infrastructure
 * @layer script
 * @criticality critical
 * @inputs governance/golden-staging-clean-policy.json, operator manifest (identity, backup, retention), database catalog
 * @outputs deterministic deletion plan (sha256), blockers, protections; gated execution
 * @depends db.js
 * @used-by operator one-shot job only
 * @db-read pg_catalog, public business tables
 * @db-write none
 * @db-txn owned
 * @doctrine staging_identity_proven_out_of_band_backup_restorable_no_truncate_no_cascade
 * @version 2026-10
 */

/**
 * KOMERCE — Golden staging deep clean V2.
 *
 *   node scripts/audit-golden-staging-deep-clean.js [--dry-run] [--out=plan.json] [--keep-emails=a@x,b@y] [--test-emails=file.txt]
 *       → LECTURE SEULE (session PostgreSQL read-only imposée avant la connexion). Inventaire, plan, dépendances,
 *         protections, blocages, prérequis d'exécution (MET/MISSING) et plan_sha256.
 *   node scripts/audit-golden-staging-deep-clean.js --execute --manifest=m.json --plan-sha256=<hash> --confirm=DELETE_GOLDEN_STAGING_TEST_DATA
 *       → mode distinct, REFUSÉ tant que tous les prérequis ne sont pas prouvés (identité, sauvegarde restaurable
 *         vérifiée et égale à l'état courant, plan relu, renonciation de rétention exportée, admin/sessions).
 *
 * Jamais de TRUNCATE ... CASCADE, jamais session_replication_role, aucun trigger désactivé. Suppressions = DELETE explicites
 * dans l'ordre FK (chaque statement doit supprimer EXACTEMENT le nombre de lignes planifié) ; TRUNCATE d'une liste
 * explicite fermée par FK uniquement pour les tables protégées par trigger d'immutabilité (accord lié par empreinte), post-contrôles dans la transaction,
 * ROLLBACK au moindre écart. Identité staging : jamais déduite de NODE_ENV, du nom de base ou d'une IP.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes('--execute');
if (!EXECUTE) {
  // Lecture seule imposée AVANT le chargement de db.js (pg lit PGOPTIONS).
  process.env.PGOPTIONS = `${process.env.PGOPTIONS ? process.env.PGOPTIONS + ' ' : ''}-c default_transaction_read_only=on`;
}

const POLICY_PATH = path.join(__dirname, '..', 'governance', 'golden-staging-clean-policy.json');
const CONFIRM_TOKEN = 'DELETE_GOLDEN_STAGING_TEST_DATA';
const MAX_BACKUP_AGE_H = 24;

const ident = (x) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(x)) throw new Error('UNSAFE_IDENTIFIER');
  return `"${x}"`;
};
const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const maskEmail = (e) => (e ? e.replace(/^(.{2}).*(@.*)$/, '$1***$2') : null);

function loadPolicy() {
  const raw = fs.readFileSync(POLICY_PATH, 'utf8');
  return { ...JSON.parse(raw), policy_sha256: sha(raw) };
}

// ── Fonctions pures (testées sans base) ────────────────────────────────────────────────

/** Classe chaque table ; rapporte non classées et entrées périmées de la politique. */
function classifyTables(existing, policy) {
  const cls = new Map();
  const dup = [];
  for (const [name, list] of Object.entries(policy.classes)) {
    for (const t of list) { if (cls.has(t)) dup.push(t); cls.set(t, name); }
  }
  for (const t of Object.keys(policy.user_scoped_delete || {})) { if (cls.has(t)) dup.push(t); cls.set(t, 'user_scoped'); }
  cls.set('users', 'users');
  const unclassified = existing.filter((t) => !cls.has(t)).sort();
  const stale = [...cls.keys()].filter((t) => !existing.includes(t)).sort();
  return { cls, unclassified, stale, duplicates: dup };
}

/**
 * Utilisateurs : classification déterministe par identifiant. AUCUNE protection implicite par rôle :
 * keep = liste explicite de l'opérateur (e-mail ou id) ; test = liste explicite ou motif ; sinon unclassified.
 * Un keep explicite l'emporte toujours sur un motif de test. Chaque compte reçoit un motif (reason).
 */
function classifyUsers(users, policy, { keepEmails = [], keepIds = [], testEmails = [], testIds = [] } = {}) {
  const pats = policy.users.test_email_patterns.map((p) => new RegExp(p, 'i'));
  const keepSet = new Set(keepEmails.map((e) => e.toLowerCase()));
  const keepIdSet = new Set(keepIds.map(String));
  const testSet = new Set(testEmails.map((e) => e.toLowerCase()));
  const testIdSet = new Set(testIds.map(String));
  const arch = new RegExp(policy.users.archive_email_pattern || '^$a');
  const out = { keep: [], test: [], unclassified: [], archived: [], all: [] };
  const sorted = [...users].sort((x, y) => String(x.id).localeCompare(String(y.id)));
  for (const u of sorted) {
    const email = (u.email || '').toLowerCase();
    let cls; let reason;
    if (keepSet.has(email)) { cls = 'keep'; reason = 'KEEP_EXPLICIT_EMAIL'; }
    else if (keepIdSet.has(String(u.id))) { cls = 'keep'; reason = 'KEEP_EXPLICIT_ID'; }
    else if (arch.test(email)) { cls = 'archived'; reason = 'ALREADY_ARCHIVED'; }
    else if (testIdSet.has(String(u.id))) { cls = 'test'; reason = 'TEST_EXPLICIT_ID'; }
    else if (testSet.has(email)) { cls = 'test'; reason = 'TEST_EXPLICIT_EMAIL'; }
    else {
      const i = pats.findIndex((re) => re.test(email));
      if (i >= 0) { cls = 'test'; reason = `TEST_PATTERN_${i}`; } else { cls = 'unclassified'; reason = 'UNCLASSIFIED_NO_RULE'; }
    }
    const rec = { ...u, cls, reason };
    out[cls].push(u);
    out.all.push(rec);
  }
  return out;
}

function userCounters(all) {
  const c = { total: all.length, by_class: {}, by_reason: {}, by_role_class: {} };
  for (const u of all) {
    c.by_class[u.cls] = (c.by_class[u.cls] || 0) + 1;
    c.by_reason[u.reason] = (c.by_reason[u.reason] || 0) + 1;
    const k = `${u.role}:${u.cls}`; c.by_role_class[k] = (c.by_role_class[k] || 0) + 1;
  }
  return c;
}

/** Ordre de suppression : enfants avant parents (tri topologique déterministe). Auto-références ignorées. */
function deletionOrder(tables, edges) {
  const set = new Set(tables);
  const children = new Map(tables.map((t) => [t, new Set()]));
  const indeg = new Map(tables.map((t) => [t, 0]));
  // edge: child REFERENCES parent  ⇒  child doit être supprimé avant parent
  for (const e of edges) {
    if (!set.has(e.child) || !set.has(e.parent) || e.child === e.parent) continue;
    if (!children.get(e.child).has(e.parent)) { children.get(e.child).add(e.parent); indeg.set(e.parent, indeg.get(e.parent) + 1); }
  }
  const ready = [...tables].filter((t) => indeg.get(t) === 0).sort();
  const order = [];
  while (ready.length) {
    const t = ready.shift();
    order.push(t);
    for (const p of [...children.get(t)].sort()) {
      indeg.set(p, indeg.get(p) - 1);
      if (indeg.get(p) === 0) { ready.push(p); ready.sort(); }
    }
  }
  return { order, cycle: tables.filter((t) => !order.includes(t)).sort() };
}

/**
 * Tables « gardées » (trigger BEFORE DELETE d'immutabilité) : DELETE impossible par conception.
 * Seule voie sans contourner les triggers ni CASCADE : TRUNCATE d'une liste EXPLICITE fermée par FK
 * (PostgreSQL refuse le TRUNCATE si une table hors liste référence un membre → aucun effet de bord possible).
 * Fermeture = tables gardées + toutes les tables supprimées qui les référencent (transitivement).
 */
function truncateSet(doomed, guarded, edges) {
  const doomedSet = new Set(doomed);
  const set = new Set(doomed.filter((t) => guarded.includes(t)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      if (set.has(e.parent) && doomedSet.has(e.child) && !set.has(e.child)) { set.add(e.child); grew = true; }
    }
  }
  return [...set].sort();
}

const scopeOf = (ident_, spec) => (typeof spec === 'string' ? `${ident_(spec)} = ANY($1::uuid[])` : spec.where);

const DELETE_ACTION = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

function hashPlan(plan) {
  return sha({ policy: plan.policy_sha256, steps: plan.steps, preserved: plan.preserved_counts, users: plan.users_plan });
}

/**
 * Prérequis d'exécution. Chaque entrée : { id, status: MET|MISSING, detail }.
 * `live` = { system_identifier, database_name, counts, plan_sha256, retention_rows } relevé en base.
 */
function evaluatePrerequisites({ manifest, flags, env, live, now = Date.now() }) {
  const out = [];
  const add = (id, ok, detail) => out.push({ id, status: ok ? 'MET' : 'MISSING', detail });
  const m = manifest || {};
  const idn = m.identity || {};
  const rw = idn.railway || {};
  add('RUNTIME_RAILWAY_STAGING', env.RAILWAY_ENVIRONMENT_NAME === 'staging', 'RAILWAY_ENVIRONMENT_NAME injecté par le runtime Railway doit valoir "staging" (signal nécessaire, jamais suffisant)');
  add('IDENTITY_ATTESTED', !!(idn.system_identifier && rw.project_id && rw.environment === 'staging' && rw.service && rw.attested_by && rw.attested_at),
    'manifest.identity : system_identifier + railway{project_id, environment:"staging", service, attested_by, attested_at} relevés hors bande');
  add('IDENTITY_MATCHES_DB', !!live.system_identifier && idn.system_identifier === live.system_identifier && idn.database_name === live.database_name,
    `system_identifier/base courants (${live.system_identifier || 'inconnu'} / ${live.database_name}) doivent égaler ceux attestés`);
  add('NOT_DECLARED_PRODUCTION', !(m.identity && Array.isArray(m.identity.production_system_identifiers) && m.identity.production_system_identifiers.includes(live.system_identifier)),
    'le system_identifier courant ne doit figurer dans aucune liste de production déclarée');
  const b = m.backup || {};
  const age = b.restore_verified_at ? (now - Date.parse(b.restore_verified_at)) / 3600000 : Infinity;
  add('BACKUP_RESTORABLE_VERIFIED', !!(b.artifact && /^[0-9a-f]{64}$/.test(b.sha256 || '') && age >= 0 && age <= MAX_BACKUP_AGE_H && b.restore_target),
    `manifest.backup : artifact + sha256 + restore_target + restore_verified_at (< ${MAX_BACKUP_AGE_H} h)`);
  const bc = b.table_counts || {};
  const drift = Object.keys(live.counts || {}).filter((t) => bc[t] !== live.counts[t]);
  add('BACKUP_EQUALS_CURRENT_STATE', Object.keys(bc).length > 0 && drift.length === 0, drift.length ? `écarts sauvegarde/état courant : ${drift.slice(0, 8).join(', ')}` : 'comptes de la sauvegarde restaurée = comptes courants');
  add('PLAN_REVIEWED', !!flags.planSha && flags.planSha === live.plan_sha256, 'plan_sha256 du dry-run relu doit égaler le plan recalculé (aucune dérive)');
  add('OPERATOR_CONFIRMATION', flags.confirm === CONFIRM_TOKEN, `--confirm=${CONFIRM_TOKEN}`);
  const needsWaiver = (live.retention_rows || 0) > 0 || !!live.immutability_tables_sha256;
  const rt = m.retention || {};
  add('RETENTION_WAIVER_EXPORTED', !needsWaiver || !!(rt.waiver_ref && /^[0-9a-f]{64}$/.test(rt.export_sha256 || '')),
    needsWaiver ? `${live.retention_rows} ligne(s) financières à supprimer : renonciation (waiver_ref) + export archivé (export_sha256) requis` : 'aucune ligne financière concernée');
  add('IMMUTABILITY_BYPASS_ACKNOWLEDGED', !live.immutability_tables_sha256 || rt.immutability_bypass_tables_sha256 === live.immutability_tables_sha256,
    live.immutability_tables_sha256 ? 'tables à triggers d\u2019immutabilité supprimées par TRUNCATE de liste : manifest.retention.immutability_bypass_tables_sha256 = immutability_bypass.tables_sha256 du dry-run relu' : 'aucune table gardée concernée');
  const ad = m.admin || {};
  add('ADMIN_REBOOTSTRAP_AND_SESSIONS', !!(ad.rebootstrap_ready === true && ad.session_revocation && ad.admin_email),
    'manifest.admin : admin_email + rebootstrap_ready:true (scripts/reset-admin.js) + session_revocation (ex. rotation JWT_SECRET planifiée)');
  return out;
}

// ── Inspection (lecture seule) ─────────────────────────────────────────────────────────

async function inspect(q, opts = {}) {
  const policy = opts.policy || loadPolicy();
  const { rows: [ident0] } = await q.query(`SELECT current_database() AS database_name, current_user AS database_user,
      current_setting('server_version') AS server_version`);
  let systemIdentifier = null;
  try { systemIdentifier = (await q.query('SELECT system_identifier::text AS s FROM pg_control_system()')).rows[0].s; } catch (_) { /* droits */ }
  const identity = { ...ident0, system_identifier: systemIdentifier,
    runtime_reported: { RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID || null, RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME || null,
      RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME || null },
    proof: 'AUCUNE : cette sortie ne prouve pas staging (nom de base, IP privée et NODE_ENV ignorés). Preuve = manifest attesté hors bande + system_identifier.' };

  const { rows: tr } = await q.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1");
  const existing = tr.map((r) => r.tablename);
  const { cls, unclassified, stale, duplicates } = classifyTables(existing, policy);

  const { rows: fk } = await q.query(`SELECT c.conname, child.relname AS child, parent.relname AS parent, c.confdeltype AS action,
        array_length(c.conkey,1) AS ncols,
        (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=c.conkey[1]) AS child_col,
        (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attnum=c.confkey[1]) AS parent_col
      FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
      WHERE c.contype='f' AND child.relnamespace='public'::regnamespace AND parent.relnamespace='public'::regnamespace
      ORDER BY child.relname, c.conname`);

  const { rows: users } = await q.query('SELECT id, email, role, last_login_at FROM users ORDER BY id');
  const uc = classifyUsers(users, policy, opts);
  const testIds = uc.test.map((u) => u.id); // candidats (suppression ou archivage)

  const wholesale = (c) => [...cls.entries()].filter(([t, k]) => k === c && existing.includes(t)).map(([t]) => t).sort();
  const deleteAll = wholesale('delete_all');
  const retentionMode = opts.retentionMode === 'delete' ? 'delete' : 'preserve';
  const retentionAll = wholesale('retention_financial');
  const retention = retentionMode === 'delete' ? retentionAll : []; // par défaut les lignes financières sont PRÉSERVÉES
  const userScoped = Object.keys(policy.user_scoped_delete || {}).filter((t) => existing.includes(t));
  const revokeSpecs = Object.entries(policy.user_scoped_revoke || {}).filter(([t]) => existing.includes(t));
  const scope = (t) => scopeOf(ident, policy.user_scoped_delete[t]);

  // Références vers les comptes de test depuis des lignes CONSERVÉES (audit, acteurs, habilitations épinglées) :
  // le compte ne peut pas être supprimé sans rompre la traçabilité => ARCHIVAGE (désactivation), jamais de suppression.
  const userRefs = {};
  const keptClass = (t) => { const k = cls.get(t); return k === 'preserve' || (k === 'retention_financial' && retentionMode === 'preserve') || k === 'user_scoped'; };
  for (const e of fk) {
    if (e.parent !== 'users' || e.ncols > 1 || !keptClass(e.child) || !testIds.length) continue;
    const col = ident(e.child_col);
    const excl = cls.get(e.child) === 'user_scoped' ? ` AND NOT (${scope(e.child)})` : '';
    const { rows: per } = await q.query(`SELECT ${col} AS uid, count(*)::int AS n FROM ${ident(e.child)} WHERE ${col} = ANY($1::uuid[])${excl} GROUP BY ${col}`, [testIds]);
    for (const r of per) (userRefs[r.uid] = userRefs[r.uid] || []).push({ ref: `${e.child}.${e.child_col}`, on_delete: DELETE_ACTION[e.action], rows: r.n });
  }
  const archiveIds = testIds.filter((id) => userRefs[id]);
  const deleteIds = testIds.filter((id) => !userRefs[id]);
  for (const u of uc.all) if (u.cls === 'test' && userRefs[u.id]) { u.cls = 'archive'; u.reason = 'ARCHIVE_AUDIT_REFERENCED'; }

  // Comptes
  const count = async (sql, params) => Number((await q.query(sql, params)).rows[0].n);
  const counts = {};
  for (const t of [...deleteAll, ...retention]) counts[t] = await count(`SELECT count(*)::bigint AS n FROM ${ident(t)}`);
  for (const t of userScoped) counts[t] = await count(`SELECT count(*)::bigint AS n FROM ${ident(t)} WHERE ${scope(t)}`, [testIds]);
  for (const [t, r] of revokeSpecs) counts[`${t}#revoke`] = await count(`SELECT count(*)::bigint AS n FROM ${ident(t)} WHERE (${r.where}) AND ${r.pending}`, [testIds]);
  counts['users#archive'] = (await count('SELECT count(*)::bigint AS n FROM users WHERE id = ANY($1::uuid[])', [archiveIds]));
  counts.users = deleteIds.length;
  const preservedCounts = {};
  for (const t of [...wholesale('preserve'), ...(retentionMode === 'preserve' ? retentionAll : [])]) preservedCounts[t] = await count(`SELECT count(*)::bigint AS n FROM ${ident(t)}`);
  for (const t of userScoped) preservedCounts[`${t}#kept`] = (await count(`SELECT count(*)::bigint AS n FROM ${ident(t)}`)) - counts[t];
  for (const [t] of revokeSpecs) preservedCounts[`${t}#revoked_kept`] = await count(`SELECT count(*)::bigint AS n FROM ${ident(t)}`);
  preservedCounts['users#kept'] = uc.keep.length;
  preservedCounts['users#archived'] = uc.archived.length + archiveIds.length;

  // Dépendances : toute FK dont le parent est (en partie) supprimé
  const doomedWhole = new Set([...deleteAll, ...retention]);
  const doomedUsers = deleteIds.length > 0;
  const blockers = [];
  const dependencies = [];
  for (const e of fk) {
    const parentDoomed = doomedWhole.has(e.parent) || (e.parent === 'users' && doomedUsers);
    if (!parentDoomed) continue;
    let childClass = cls.get(e.child) || 'unclassified';
    if (childClass === 'retention_financial' && !doomedWhole.has(e.child)) childClass = 'preserve';
    if (childClass === 'delete_all' || (childClass === 'retention_financial' && doomedWhole.has(e.child))) {
      dependencies.push({ child: e.child, parent: e.parent, on_delete: DELETE_ACTION[e.action], child_class: childClass, rows_referencing: null });
      continue;
    }
    if (childClass === 'users' && e.parent === 'users') continue; // auto-référence users
    if (childClass === 'user_scoped' && e.parent === 'users') {
      dependencies.push({ child: e.child, parent: e.parent, on_delete: DELETE_ACTION[e.action], child_class: 'user_scoped', rows_referencing: counts[e.child] });
      continue;
    }
    if (e.ncols > 1) { blockers.push({ code: 'COMPOSITE_FK_UNVERIFIED', detail: `${e.child}.${e.conname} → ${e.parent}` }); continue; }
    const col = ident(e.child_col);
    const refSql = e.parent === 'users'
      ? `SELECT count(*)::bigint AS n FROM ${ident(e.child)} WHERE ${col} = ANY($1::uuid[])`
      : `SELECT count(*)::bigint AS n FROM ${ident(e.child)} WHERE ${col} IS NOT NULL`;
    const n = await count(refSql, e.parent === 'users' ? [deleteIds] : []);
    dependencies.push({ child: e.child, parent: e.parent, on_delete: DELETE_ACTION[e.action], child_class: childClass, rows_referencing: n });
    if (n > 0 && childClass === 'preserve') {
      blockers.push({ code: e.action === 'n' ? 'PRESERVED_ROWS_WOULD_BE_NULLIFIED' : e.action === 'c' ? 'PRESERVED_ROWS_WOULD_BE_CASCADE_DELETED' : 'PRESERVED_ROWS_REFERENCE_DOOMED_ROWS',
        detail: `${e.child}.${e.child_col} → ${e.parent} : ${n} ligne(s) conservée(s) pointent vers des données à supprimer (${DELETE_ACTION[e.action]})` });
    } else if (childClass === 'unclassified') {
      blockers.push({ code: 'UNCLASSIFIED_DEPENDENT', detail: `${e.child} → ${e.parent}` });
    }
  }
  // Enfants conservés pointant vers des lignes d'habilitation à supprimer (doit être 0 par construction des règles)
  for (const e of fk) {
    if (cls.get(e.parent) !== 'user_scoped' || e.parent === 'webauthn_credentials' || !keptClass(e.child) || cls.get(e.child) === 'user_scoped' || e.ncols > 1 || !testIds.length) continue;
    const n = await count(`SELECT count(*)::bigint AS n FROM ${ident(e.child)} WHERE ${ident(e.child_col)} IN (SELECT ${ident(e.parent_col)} FROM ${ident(e.parent)} WHERE ${scope(e.parent)})`, [testIds]);
    dependencies.push({ child: e.child, parent: e.parent, on_delete: DELETE_ACTION[e.action], child_class: cls.get(e.child), rows_referencing: n });
    if (n > 0) blockers.push({ code: 'HABILITATION_REFERENCED_BY_PRESERVED_ROWS', detail: `${e.child}.${e.child_col} → ${e.parent} : ${n}` });
  }
  // Structure : FK de tables conservées vers tables supprimées avec CASCADE (dangereux même à 0 ligne aujourd'hui)
  const structural = fk.filter((e) => (doomedWhole.has(e.parent) || e.parent === 'users') && cls.get(e.child) === 'preserve' && e.action === 'c')
    .map((e) => `${e.child}.${e.child_col} → ${e.parent} (CASCADE)`);

  const retentionRows = retention.reduce((n, t) => n + counts[t], 0);
  const retentionPreservedRows = retentionMode === 'preserve' ? (await Promise.all(retentionAll.map((t) => count(`SELECT count(*)::bigint AS n FROM ${ident(t)}`)))).reduce((n, v) => n + v, 0) : 0;
  const ordersN = counts.orders || 0;
  if (unclassified.length) blockers.push({ code: 'UNCLASSIFIED_TABLES', detail: unclassified.join(', ') });
  if (duplicates.length) blockers.push({ code: 'POLICY_DUPLICATE_TABLES', detail: duplicates.join(', ') });
  if (stale.length) blockers.push({ code: 'POLICY_STALE_TABLES', detail: stale.join(', ') });
  if (uc.unclassified.length) blockers.push({ code: 'UNCLASSIFIED_USERS', detail: `${uc.unclassified.length} compte(s) ni protégé ni de test : fournir --keep-emails ou --test-emails` });
  if (ordersN > policy.limits.max_orders) blockers.push({ code: 'LIMIT_ORDERS_EXCEEDED', detail: `${ordersN} > ${policy.limits.max_orders} : environnement inattendu` });
  if (testIds.length > policy.limits.max_users) blockers.push({ code: 'LIMIT_USERS_EXCEEDED', detail: `${testIds.length} > ${policy.limits.max_users}` });
  if (!uc.keep.length) blockers.push({ code: 'NO_ADMIN_PRESERVED', detail: 'aucun compte conservé explicitement (--keep-emails/--keep-ids/--keep-file) : le rôle admin ne protège pas' });

  const doomedAll = [...deleteAll, ...retention];
  const { rows: gr } = await q.query(`SELECT c.relname AS t, array_agg(DISTINCT t.tgname ORDER BY t.tgname) AS triggers
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace AND (t.tgtype & 1)=1 AND (t.tgtype & 2)=2 AND (t.tgtype & 8)=8
     GROUP BY c.relname ORDER BY 1`);
  const guardedAll = gr.map((r) => r.t);
  const allEdges = fk.map((e) => ({ child: e.child, parent: e.parent }));
  const tset = truncateSet(doomedAll, guardedAll, allEdges);
  for (const e of fk) {
    if (tset.includes(e.parent) && !tset.includes(e.child) && e.child !== 'users') {
      blockers.push({ code: 'TRUNCATE_BLOCKED_BY_FK_FROM_OUTSIDE_SET', detail: `${e.child}.${e.child_col} → ${e.parent} : table hors liste (${cls.get(e.child) || '?'}) référence un membre du TRUNCATE` });
    }
  }
  const immutability = { tables: tset, tables_sha256: sha(tset.join(',')), rows: tset.reduce((n, t) => n + counts[t], 0),
    guard_triggers: Object.fromEntries(gr.filter((r) => tset.includes(r.t)).map((r) => [r.t, r.triggers])),
    note: 'DELETE interdit par trigger d\u2019immutabilité sur ces tables : suppression par TRUNCATE de liste explicite (sans CASCADE). Accord explicite requis (manifest.retention.immutability_bypass_tables_sha256).' };
  const { order, cycle } = deletionOrder(doomedAll.filter((t) => !tset.includes(t)), fk.filter((e) => e.action !== 'n').map((e) => ({ child: e.child, parent: e.parent })));
  if (cycle.length) blockers.push({ code: 'FK_CYCLE', detail: cycle.join(', ') });
  const steps = [
    ...(tset.length ? [{ seq: 0, table: tset.join(','), class: 'truncate_group', method: 'TRUNCATE', scope: 'ALL_ROWS (liste explicite fermée par FK)', rows: immutability.rows, members: tset }] : []),
    ...order.map((t) => ({ seq: 0, table: t, class: cls.get(t), method: 'DELETE', scope: 'ALL_ROWS', rows: counts[t] })),
    ...userScoped.map((t) => ({ seq: 0, table: t, class: 'user_scoped', method: 'DELETE', scope: typeof policy.user_scoped_delete[t] === 'string' ? `${policy.user_scoped_delete[t]} IN test_users` : 'habilitations des comptes de test (hors lignes épinglées par l\u2019audit)', rows: counts[t] })),
    ...revokeSpecs.map(([t, r]) => ({ seq: 0, table: t, class: 'user_revoke', method: 'UPDATE', scope: `révocation (${r.set}) des lignes épinglées par l\u2019audit`, rows: counts[`${t}#revoke`] })),
    { seq: 0, table: 'users', class: 'users', method: 'DELETE', scope: 'id IN delete_users', rows: deleteIds.length },
    { seq: 0, table: 'users', class: 'users_archive', method: 'UPDATE', scope: 'id IN archive_users : identifiants neutralisés, e-mail archivé, rôle client, ligne conservée', rows: archiveIds.length },
  ].map((s, i) => ({ ...s, seq: i + 1 }));
  // user_scoped doivent précéder users et suivre leurs propres enfants : ils sont placés avant users (ci-dessus)

  const foundation = {};
  for (const t of policy.foundation_checks) if (existing.includes(t)) foundation[t] = preservedCounts[t] ?? await count(`SELECT count(*)::bigint AS n FROM ${ident(t)}`);
  const plan = { policy_sha256: policy.policy_sha256, steps, preserved_counts: preservedCounts,
    users_plan: { retention_mode: retentionMode, archive: archiveIds.length, archive_ids_sha256: sha(archiveIds.join(',')), delete: deleteIds.length, keep: uc.keep.length, test_ids_sha256: sha(deleteIds.join(',')), keep_ids_sha256: sha(uc.keep.map((u) => u.id).join(',')) } };
  const plan_sha256 = hashPlan(plan);

  const live = { system_identifier: systemIdentifier, database_name: ident0.database_name, counts: { ...counts, ...Object.fromEntries(Object.entries(foundation).map(([k, v]) => [`foundation:${k}`, v])) },
    plan_sha256, retention_rows: retentionRows, testIds, deleteIds, archiveIds };
  live.immutability_tables_sha256 = tset.length ? immutability.tables_sha256 : null;
  const prerequisites = evaluatePrerequisites({ manifest: opts.manifest, flags: opts.flags || {}, env: process.env, live });

  return {
    purpose: 'GOLDEN_STAGING_DEEP_CLEAN_V2', mode: opts.mode || 'DRY_RUN', writes: 0, identity,
    decision: blockers.length ? 'PLAN_BLOCKED' : prerequisites.every((p) => p.status === 'MET') ? 'READY_TO_EXECUTE' : 'PLAN_READY_PREREQUISITES_MISSING',
    plan_sha256, totals: { rows_to_delete: steps.reduce((s, x) => s + x.rows, 0), tables_touched: steps.reduce((n, s) => n + (s.rows > 0 ? (s.members ? s.members.filter((t) => counts[t] > 0).length : 1) : 0), 0),
      financial_retention_rows: retentionRows, financial_rows_preserved: retentionPreservedRows, retention_mode: retentionMode, tables_preserved: Object.keys(preservedCounts).length },
    immutability_bypass: immutability, steps, users: { counters: userCounters(uc.all), delete: deleteIds.length, archive: archiveIds.length, already_archived: uc.archived.length,
      admin_candidates: uc.all.filter((u) => u.role === 'admin').map((u) => ({ id: u.id, email: maskEmail(u.email), class: u.cls, last_login_at: users.find((x) => x.id === u.id).last_login_at })),
      classification: uc.all.map((u) => ({ id: u.id, email: maskEmail(u.email), role: u.role, class: u.cls, reason: u.reason,
        ...(userRefs[u.id] ? { blocked_by: userRefs[u.id] } : {}) })),
      archive_ids: archiveIds, keep: uc.keep.map((u) => ({ id: u.id, email: maskEmail(u.email), role: u.role })),
      unclassified: uc.unclassified.map((u) => ({ id: u.id, email: maskEmail(u.email), role: u.role })) },
    dependencies, protections: { foundation_counts: foundation, preserved_tables: wholesale('preserve').length, structural_cascade_risks: structural,
      guarantees: ['aucun TRUNCATE ... CASCADE', 'triggers jamais désactivés', 'session_replication_role jamais modifié', 'DELETE explicite avec nombre de lignes vérifié par statement', 'TRUNCATE de liste explicite seulement pour les tables gardées par trigger (accord lié par empreinte)'] },
    blockers, execute_prerequisites: prerequisites,
    post_steps: ['scripts/reset-admin.js (rebootstrap admin)', 'rotation JWT_SECRET (révocation des sessions existantes)', 'audit post-purge : node scripts/audit-golden-staging-deep-clean.js --dry-run → 0 ligne à supprimer'],
    _live: live, // retiré de la sortie CLI
  };
}

// ── Exécution (verrouillée) ────────────────────────────────────────────────────────────

async function execute(db, report, opts, policy) {
  const failed = report.execute_prerequisites.filter((p) => p.status !== 'MET');
  if (report.blockers.length || failed.length) {
    const e = new Error('EXECUTION_REFUSED'); e.report = { blockers: report.blockers, prerequisites_missing: failed }; throw e;
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    // Rejoue l'inspection DANS la transaction (verrous) et exige le même plan
    const recheck = await inspect(client, { ...opts, policy, mode: 'EXECUTE_RECHECK' });
    if (recheck.plan_sha256 !== report.plan_sha256 || recheck.blockers.length) throw new Error('PLAN_DRIFT_ABORT');
    for (const s of recheck.steps) {
      if (s.method === 'TRUNCATE') {
        // Liste explicite, jamais de CASCADE ni de RESTART IDENTITY : PostgreSQL refuse si une table hors liste référence un membre.
        await client.query(`TRUNCATE TABLE ${s.members.map(ident).join(', ')}`);
        continue;
      }
      let r;
      if (s.class === 'users') r = await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [recheck._live.deleteIds]);
      else if (s.class === 'user_scoped') r = await client.query(`DELETE FROM ${ident(s.table)} WHERE ${scopeOf(ident, policy.user_scoped_delete[s.table])}`, [recheck._live.testIds]);
      else if (s.class === 'user_revoke') { const rv = policy.user_scoped_revoke[s.table]; r = await client.query(`UPDATE ${ident(s.table)} SET ${rv.set} WHERE (${rv.where}) AND ${rv.pending}`, [recheck._live.testIds]); }
      else if (s.class === 'users_archive') r = await client.query("UPDATE users SET password_hash = NULL, magic_token = NULL, magic_token_expires_at = NULL, email = 'archived+' || id::text || '@archived.invalid', phone = NULL, whatsapp_phone = NULL, phone_payer = NULL, role = 'client' WHERE id = ANY($1::uuid[])", [recheck._live.archiveIds]);
      else r = await client.query(`DELETE FROM ${ident(s.table)}`);
      if (r.rowCount !== s.rows) throw new Error(`ROW_COUNT_MISMATCH ${s.table}: ${r.rowCount} != ${s.rows}`);
    }
    // Post-contrôles : tables conservées inchangées, aucune FK orpheline
    const after = await inspect(client, { ...opts, policy, mode: 'EXECUTE_POSTCHECK' });
    for (const [t, n] of Object.entries(recheck.protections.foundation_counts)) {
      if (after.protections.foundation_counts[t] !== n) throw new Error(`FOUNDATION_CHANGED ${t}`);
    }
    for (const [t, n] of Object.entries(recheck._live.counts)) {
      if (t.startsWith('foundation:')) continue;
      const left = after._live.counts[t];
      if (left !== 0) throw new Error(`RESIDUE ${t}: ${left} (avant ${n})`);
    }
    const { rows: fks } = await client.query(`SELECT c.conname, child.relname AS child, parent.relname AS parent,
        (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=c.conkey[1]) AS child_col,
        (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attnum=c.confkey[1]) AS parent_col
      FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
      WHERE c.contype='f' AND array_length(c.conkey,1)=1 AND child.relnamespace='public'::regnamespace AND parent.relnamespace='public'::regnamespace`);
    for (const f of fks) {
      const { rows: [o] } = await client.query(`SELECT count(*)::bigint AS n FROM ${ident(f.child)} c WHERE c.${ident(f.child_col)} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${ident(f.parent)} p WHERE p.${ident(f.parent_col)} = c.${ident(f.child_col)})`);
      if (Number(o.n) > 0) throw new Error(`ORPHANS ${f.child}.${f.child_col} → ${f.parent}: ${o.n}`);
    }
    await client.query('COMMIT');
    return { executed: true, deleted: recheck.steps.map((s) => ({ table: s.table, rows: s.rows })), plan_sha256: report.plan_sha256 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────

function arg(name) { const a = ARGV.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; }
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
function readList(file) { return file ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : []; }

async function main() {
  const db = require('../db');
  try {
    const policy = loadPolicy();
    const manifest = arg('manifest') ? JSON.parse(fs.readFileSync(arg('manifest'), 'utf8')) : null;
    const opts = { policy, manifest, keepEmails: [...list(arg('keep-emails')), ...readList(arg('keep-file'))], keepIds: list(arg('keep-ids')), testIds: list(arg('test-ids')), retentionMode: arg('retention-mode'),
      testEmails: [...list(arg('test-emails')), ...readList(arg('test-file'))],
      flags: { planSha: arg('plan-sha256'), confirm: arg('confirm') }, mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN' };
    const { rows: [ro] } = await db.query('SHOW default_transaction_read_only');
    if (!EXECUTE && ro.default_transaction_read_only !== 'on') throw new Error('Session non lecture seule : arrêt (garde-fou).');
    const report = await inspect(db, opts);
    if (ARGV.includes('--print-counts')) { process.stdout.write(`${JSON.stringify(report._live.counts, null, 2)}\n`); return; }
    const cli = { ...report }; delete cli._live;
    if (EXECUTE) {
      const result = await execute(db, report, opts, policy);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const json = JSON.stringify(cli, null, 2);
    if (arg('out')) fs.writeFileSync(arg('out'), json);
    process.stdout.write(`${json}\n`);
  } finally { await db.pool.end().catch(() => {}); }
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`${e.message}\n${e.report ? JSON.stringify(e.report, null, 2) + '\n' : ''}`);
    process.exitCode = e.message === 'EXECUTION_REFUSED' ? 3 : 1;
  });
}

module.exports = { truncateSet, inspect, execute, classifyTables, classifyUsers, userCounters, deletionOrder, evaluatePrerequisites, hashPlan, loadPolicy, CONFIRM_TOKEN };
