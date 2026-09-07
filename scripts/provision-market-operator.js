#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role          provision-market-operator-cli
 * @domain        admin-dashboard
 * @layer         script
 * @owner         backend-core
 * @purpose       Créer un opérateur pays (market_operator) avec scope marché,
 *                en une seule commande CLI idempotente.
 * @impact-areas  admin-dashboard, market-authorization
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
 * Si l'email existe déjà, le script vérifie le rôle et le scope sans recréer.
 * Le mot de passe est affiché une seule fois et jamais loggé.
 */

'use strict';

const db = require('../db');
const bcrypt = require('bcryptjs');

const VALID_SCOPES = ['viewer', 'manager'];

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

    // 3. Vérifier/créer le scope marché
    const { rows: [activeScope] } = await db.query(
      `SELECT id, role FROM operator_market_scopes
       WHERE user_id = $1 AND market_id = $2 AND revoked_at IS NULL`,
      [userId, market.id]
    );

    if (activeScope) {
      console.log(`ℹ️  Scope actif existant : ${activeScope.role} sur ${marketCode}`);
      if (activeScope.role !== opts.scope) {
        console.log(`   Le scope demandé est "${opts.scope}" mais l'existant est "${activeScope.role}".`);
        console.log('   Utilisez l\'interface admin pour changer le scope (révocation + re-grant).');
      }
    } else {
      if (dryRun) {
        console.log(`[DRY-RUN] Accorderait scope ${opts.scope} sur ${marketCode}`);
      } else {
        await db.query(`
          INSERT INTO operator_market_scopes (user_id, market_id, role, granted_by)
          VALUES ($1, $2, $3, $1)
        `, [userId, market.id, opts.scope]);
        console.log(`✅ Scope accordé : ${opts.scope} sur ${marketCode}`);
      }
    }

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
    await db.end().catch(() => {});
    process.exit(0);
  }
}

main();
