#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          provision-market-operator-cli
 * @domain        admin-dashboard
 * @layer         script
 * @owner         backend-core
 * @purpose       Créer un opérateur pays (market_operator) avec une membership
 *                de délégation (assignment/membership/capabilities), en une
 *                seule commande CLI idempotente.
 * @impact-areas  admin-dashboard, market-authorization, market-delegation
 * @doctrine      operator_market_scopes_is_market_owned_projection
 * @version       2026-09
 *
 * Usage :
 *   node scripts/provision-market-operator.js \
 *     --name "Ibrahim Diallo" \
 *     --email ibrahim@komerce.cm \
 *     --market CM \
 *     --scope manager \
 *     --password "TempPass2026!"
 *
 * Si l'email existe déjà, le script vérifie le rôle et la membership sans
 * recréer.
 *
 * Autorité canonique : assignment/membership/capabilities (market-delegation).
 * Ce script n'écrit JAMAIS `operator_market_scopes` — cette table est une
 * projection de compatibilité reconstruite par `projectAssignment()`
 * (services/market-scope-projector.js), exactement comme le fait
 * routes/market-delegation-team.js pour toute mutation d'équipe faite depuis
 * le dashboard. Un changement de rôle pour un opérateur déjà provisionné se
 * fait via la route d'administration d'équipe
 * (PUT /markets/:marketCode/team/:membershipId/capabilities), jamais en
 * relançant ce script avec un --scope différent : ce script vérifie, il ne
 * mute jamais silencieusement un rôle existant (voir ensureDelegationMembership).
 *
 * Le mot de passe est affiché une seule fois et jamais loggé.
 */

'use strict';

const db = require('../db');
const bcrypt = require('bcryptjs');
const delegation = require('../services/market-delegation-service');
const {
  projectAssignment,
  desiredScopesForAssignment,
  LEGACY_VIEWER_CAPABILITIES,
} = require('../services/market-scope-projector');

const VALID_SCOPES = ['viewer', 'manager'];

const MANAGER_CEILING_QUERY = `
  SELECT acc.capability
    FROM assignment_capability_ceiling acc
    JOIN capability_registry registry ON registry.capability = acc.capability
   WHERE acc.assignment_id = $1
     AND acc.revoked_at IS NULL
     AND registry.class = 'DELEGATION'
     AND registry.authority_scope = 'MARKET'
     AND registry.delegation_mode = 'DELEGABLE'
     AND registry.status = 'LIVE'
`;

// Un manager reçoit tout le ceiling LIVE de l'assignment. Un viewer reçoit le
// baseline de lecture canonique du projecteur — la même liste qui détermine,
// côté projectAssignment(), si une membership est reconnue comme "viewer"
// pour operator_market_scopes. Une seule source de vérité pour ce baseline :
// services/market-scope-projector.js.
async function targetCapabilitiesForScope(executor, { assignmentId, scope }) {
  if (scope === 'manager') {
    const { rows } = await executor.query(MANAGER_CEILING_QUERY, [assignmentId]);
    return rows.map(row => row.capability);
  }
  return LEGACY_VIEWER_CAPABILITIES.slice();
}

// Dérive le rôle viewer/manager d'un utilisateur EXACTEMENT comme le fait
// projectAssignment() (même fonction, même requête) — pour ne jamais avoir
// une notion de "rôle actuel" divergente entre ce script et le projecteur.
// Retourne null si la membership existe mais ne correspond à aucun des deux
// baselines (capabilities personnalisées) : ce script ne sait alors pas
// classer la membership et échoue fermé plutôt que de deviner.
async function derivedRoleForUser(executor, { assignmentId, userId }) {
  const desired = await desiredScopesForAssignment(executor, assignmentId);
  const row = desired.find(r => String(r.user_id) === String(userId));
  return row ? row.scope_role : null;
}

async function resolveOrCreateAssignment(client, { marketId, marketCode }) {
  const assignment = await delegation.resolveActiveAssignmentByMarketCode(client, marketCode).catch(err => {
    if (err && err.code === 'MARKET_ASSIGNMENT_NOT_ACTIVE') return null;
    if (err && err.code === 'MARKET_NOT_FOUND') {
      throw new Error(`Marché ${marketCode} inactif ou introuvable — impossible de résoudre/créer le Market Operating Assignment. Réactivez le marché avant de provisionner.`);
    }
    throw err;
  });
  if (assignment) return assignment.assignment_id;

  const created = await delegation.createAssignment(client, { marketId, status: 'ACTIVE' });
  console.log(`✅ Market Operating Assignment créé pour ${marketCode}`);
  return created.id;
}

// Prévisualisation en lecture seule pour --dry-run : aucune écriture, mais on
// va quand même lire l'état réel pour annoncer l'issue correcte (création,
// idempotent, ou fail-closed) plutôt qu'un message générique.
async function previewDelegationOutcome({ userId, marketCode, scope }) {
  const assignment = await delegation.resolveActiveAssignmentByMarketCode(db, marketCode).catch(err => {
    if (err && err.code === 'MARKET_ASSIGNMENT_NOT_ACTIVE') return null;
    if (err && err.code === 'MARKET_NOT_FOUND') return { notFound: true };
    throw err;
  });

  if (assignment && assignment.notFound) {
    return `Marché ${marketCode} inactif ou introuvable — la résolution de l'assignment échouerait (aucune écriture n'est de toute façon tentée en dry-run).`;
  }

  if (!assignment) {
    return `Créerait un Market Operating Assignment ACTIVE pour ${marketCode}, une membership "${scope}", puis reconstruirait operator_market_scopes via projectAssignment().`;
  }

  const existingMembership = await delegation.activeMembershipForUser(db, assignment.assignment_id, userId);
  if (!existingMembership) {
    return `Créerait une membership "${scope}" sur l'assignment existant de ${marketCode}, puis reconstruirait operator_market_scopes via projectAssignment().`;
  }

  const derivedRole = await derivedRoleForUser(db, { assignmentId: assignment.assignment_id, userId });
  if (derivedRole === scope) {
    return `Membership déjà conforme ("${scope}") sur ${marketCode} — ne ferait que revérifier/réparer la projection operator_market_scopes.`;
  }
  const observed = derivedRole || 'personnalisé (capabilities hors baseline viewer/manager)';
  return `Rôle demandé "${scope}" ≠ rôle dérivé des capabilities actuelles ("${observed}") sur ${marketCode} — échouerait fail-closed, aucune écriture.`;
}

// Rattache l'opérateur au système de délégation — seule autorité canonique.
// Contrat :
//   - pas de membership existante  → la crée avec les capabilities du scope
//     demandé, puis reconstruit la projection.
//   - membership existante, rôle dérivé des capabilities == scope demandé
//     → idempotent : aucune mutation de capabilities, on répare seulement
//     une éventuelle dérive de operator_market_scopes.
//   - membership existante, rôle dérivé != scope demandé (y compris rôle
//     indéterminé) → fail-closed : aucune écriture, erreur explicite. Ce
//     script ne fait jamais de grant additif à partir de --scope pour une
//     membership déjà en place ; le changement de rôle passe par la route
//     d'administration d'équipe.
async function ensureDelegationMembership({ userId, marketId, marketCode, scope, dryRun }) {
  if (dryRun) {
    const message = await previewDelegationOutcome({ userId, marketCode, scope });
    console.log(`[DRY-RUN] ${message}`);
    return { dryRun: true };
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const assignmentId = await resolveOrCreateAssignment(client, { marketId, marketCode });
    const existingMembership = await delegation.activeMembershipForUser(client, assignmentId, userId);

    if (existingMembership) {
      const derivedRole = await derivedRoleForUser(client, { assignmentId, userId });

      if (derivedRole !== scope) {
        await client.query('ROLLBACK');
        const observed = derivedRole || 'personnalisé (capabilities hors baseline viewer/manager)';
        const error = new Error(
          `Rôle demandé "${scope}" ≠ rôle dérivé des capabilities actuelles ("${observed}") pour cet utilisateur sur ${marketCode}. ` +
          `Aucune écriture effectuée. Changez les capabilities via la route d'administration d'équipe ` +
          `(PUT /markets/${marketCode}/team/${existingMembership.id}/capabilities), puis relancez ce script pour vérifier.`
        );
        error.code = 'MARKET_DELEGATION_SCOPE_MISMATCH';
        throw error;
      }

      // Idempotent : rien à muter côté capabilities. On répare quand même la
      // projection au cas où operator_market_scopes aurait dérivé (legacy,
      // écriture manuelle antérieure, etc.).
      await projectAssignment(client, assignmentId);
      await client.query('COMMIT');
      console.log(`✅ Membership délégation déjà conforme (${scope}) sur ${marketCode} — projection vérifiée/réparée.`);
      return { status: 'unchanged' };
    }

    const capabilities = await targetCapabilitiesForScope(client, { assignmentId, scope });
    await delegation.addMembership(client, {
      assignmentId,
      userId,
      capabilities,
      actorIsCentral: true,
    });
    await projectAssignment(client, assignmentId);

    await client.query('COMMIT');
    console.log(`✅ Membership délégation créée (${scope}) sur ${marketCode} — projection reconstruite.`);
    return { status: 'created' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = (args[i] || '').replace(/^--/, '');
    opts[key] = args[i + 1] || '';
  }
  return opts;
}

function usage() {
  console.log(`
Usage: node scripts/provision-market-operator.js
  --name     "Nom complet"
  --email    email@domaine
  --market   CODE_PAYS (ex: CM, KM, CG, YT)
  --scope    viewer | manager
  --password "MotDePasseTemporaire"

Options :
  --phone    "+269 XXX XX XX" (optionnel)
  --dry-run  (ne crée rien, affiche ce qui serait fait)
`);
}

async function main() {
  const opts = parseArgs();

  if (!opts.name || !opts.email || !opts.market || !opts.scope || !opts.password) {
    usage();
    process.exit(1);
  }

  if (!VALID_SCOPES.includes(opts.scope)) {
    console.error(`❌ Scope invalide : "${opts.scope}". Valeurs : ${VALID_SCOPES.join(', ')}`);
    process.exit(1);
  }

  const marketCode = opts.market.toUpperCase();
  const dryRun = opts['dry-run'] !== undefined;

  try {
    // 1. Vérifier que le marché existe et est actif
    const { rows: [market] } = await db.query(
      'SELECT id, code, name, currency, is_active FROM markets WHERE code = $1',
      [marketCode]
    );
    if (!market) {
      console.error(`❌ Marché "${marketCode}" introuvable en base.`);
      const { rows: all } = await db.query('SELECT code, name, is_active FROM markets ORDER BY code');
      console.log('Marchés disponibles :', all.map(m => `${m.code} (${m.name}${m.is_active ? '' : ' — inactif'})`).join(', '));
      process.exit(1);
    }
    if (!market.is_active) {
      console.error(`⚠️  Marché "${marketCode}" (${market.name}) existe mais est inactif.`);
    }
    console.log(`✅ Marché : ${market.code} — ${market.name} (${market.currency})`);

    // 2. Vérifier si l'utilisateur existe
    const { rows: [existing] } = await db.query(
      'SELECT id, full_name, email, role FROM users WHERE email = $1',
      [opts.email.toLowerCase().trim()]
    );

    let userId;

    if (existing) {
      console.log(`ℹ️  Utilisateur existant : ${existing.full_name} (${existing.email}), rôle = ${existing.role}`);
      if (existing.role !== 'market_operator') {
        console.error(`❌ L'utilisateur existe avec le rôle "${existing.role}". Changement de rôle non supporté par ce script.`);
        process.exit(1);
      }
      userId = existing.id;
    } else {
      if (dryRun) {
        console.log(`[DRY-RUN] Créerait l'utilisateur ${opts.name} <${opts.email}> avec rôle market_operator`);
        userId = 'dry-run-uuid';
      } else {
        const password_hash = await bcrypt.hash(opts.password, 10);
        const { rows: [user] } = await db.query(`
          INSERT INTO users (full_name, email, phone, password_hash, role)
          VALUES ($1, $2, $3, $4, 'market_operator')
          RETURNING id, full_name, email, role
        `, [opts.name, opts.email.toLowerCase().trim(), opts.phone || null, password_hash]);
        userId = user.id;
        console.log(`✅ Utilisateur créé : ${user.full_name} (${user.email}) — rôle ${user.role}`);
        console.log(`🔑 Mot de passe temporaire : ${opts.password}`);
        console.log('   ⚠️  Ce mot de passe ne sera plus affiché. Le transmettre de façon sécurisée.');
      }
    }

    // 3. Résoudre/créer l'assignment de délégation, créer ou vérifier la
    // membership (capabilities canoniques), puis laisser projectAssignment()
    // reconstruire operator_market_scopes. Ce script n'écrit plus jamais
    // cette table directement — voir ensureDelegationMembership().
    await ensureDelegationMembership({
      userId,
      marketId: market.id,
      marketCode,
      scope: opts.scope,
      dryRun,
    });

    // 4. Résumé
    console.log('\n═══════════════════════════════════════════════');
    console.log(`  Opérateur : ${opts.name}`);
    console.log(`  Email     : ${opts.email}`);
    console.log(`  Marché    : ${market.code} — ${market.name}`);
    console.log(`  Scope     : ${opts.scope}`);
    console.log(`  Login     : /login.html → /admin/pilotage`);
    console.log('═══════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Erreur :', err.message);
    process.exit(1);
  } finally {
    await db.pool.end().catch(() => {});
    process.exit(0);
  }
}

module.exports = {
  ensureDelegationMembership,
  resolveOrCreateAssignment,
  targetCapabilitiesForScope,
  derivedRoleForUser,
};

if (require.main === module) {
  main();
}
