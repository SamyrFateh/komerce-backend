#!/usr/bin/env node
/**
 * KOMERCE — Script CLI de reset du mot de passe admin
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Remplace la route POST /api/auth/admin-reset pour les opérations manuelles.
 *
 * POURQUOI un script CLI plutôt qu'une route web ?
 *   1. Pas de surface d'attaque réseau — la route /admin-reset est soumise
 *      au bruteforce (même durcie avec clé 32+ chars, le risque reste > 0).
 *   2. Exige un accès shell au serveur / DB → confirmation d'autorité légitime.
 *   3. Aucun secret hardcodé dans le code source.
 *   4. Log clair dans l'historique shell + timestamps des actions.
 *
 * USAGE
 * ─────
 *
 * Interactif (recommandé — saisie masquée du mot de passe) :
 *   node scripts/reset-admin.js
 *
 * Automatisé (CI/test, avec mot de passe en argument — ⚠️ il reste en history shell) :
 *   node scripts/reset-admin.js --password 'MonMotDePasse12!'
 *
 * Reset un admin spécifique (par défaut admin@komerce.km) :
 *   node scripts/reset-admin.js --email autre-admin@komerce.km
 *
 * Créer l'admin s'il n'existe pas (comportement admin-reset historique) :
 *   node scripts/reset-admin.js --create
 *
 * Vérifier qu'un admin existe sans rien modifier :
 *   node scripts/reset-admin.js --check
 *
 * PRÉREQUIS
 * ─────────
 *   · DATABASE_URL défini dans l'environnement (ou .env)
 *   · bcryptjs installé (déjà dans les dépendances Komerce)
 *
 * CHECKS DE SÉCURITÉ
 * ─────────────────
 *   · Mot de passe min 12 caractères + 1 majuscule + 1 chiffre
 *   · Refuse les mots de passe trop évidents (admin, password, 123456, etc.)
 *   · Connexion DB via pg pool, credentials jamais logués
 *   · Hash bcrypt cost 12
 *   · Log horodaté de chaque action (succès ou échec)
 */

'use strict';

// ── Load .env si disponible (pour DATABASE_URL) ────────────────────────────
try { require('dotenv').config(); } catch (_) { /* dotenv optionnel */ }

const readline = require('readline');

// ── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_ADMIN_EMAIL  = 'admin@komerce.km';
const DEFAULT_ADMIN_PHONE  = '+269000000';
const DEFAULT_ADMIN_NAME   = 'Admin Komerce';
const MIN_PASSWORD_LENGTH  = 12;

// Liste de mots de passe évidents à refuser (non exhaustive, défense de base)
const WEAK_PASSWORDS = new Set([
  'adminadmin12', 'passwordpwd1', 'komerce12345', 'password1234',
  'administrator', '123456789012', 'motdepasse12', 'adminpassword',
]);

// ── Parsing des arguments ──────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { email: DEFAULT_ADMIN_EMAIL, password: null, create: false, check: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--email':    opts.email    = argv[++i]; break;
      case '--password': opts.password = argv[++i]; break;
      case '--create':   opts.create   = true;      break;
      case '--check':    opts.check    = true;      break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Option inconnue : ${argv[i]}`);
        printUsage();
        process.exit(2);
    }
  }
  return opts;
}

function printUsage() {
  console.log(`
Usage: node scripts/reset-admin.js [options]

Options:
  --email <email>      Email de l'admin à reset (défaut: ${DEFAULT_ADMIN_EMAIL})
  --password <pwd>     Nouveau mot de passe (sinon saisie interactive)
  --create             Crée l'admin s'il n'existe pas
  --check              Vérifie l'existence sans modifier
  --help, -h           Affiche cette aide

Exemples:
  node scripts/reset-admin.js
  node scripts/reset-admin.js --password 'TestAdmin12Strong!'
  node scripts/reset-admin.js --check
  node scripts/reset-admin.js --create --email new-admin@komerce.km
`);
}

// ── Saisie interactive masquée du mot de passe ─────────────────────────────
// Note : la saisie n'est pas parfaitement invisible en Node pur (pas d'équivalent
// getpass). On met au moins des étoiles pour ne pas afficher le mdp en clair.

function promptPassword(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.openStdin();

    process.stdout.write(promptText);

    let pwd = '';
    const onData = (char) => {
      const str = char.toString();
      if (str === '\n' || str === '\r' || str === '\u0004') {
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(pwd);
      } else if (str === '\u0003') { // Ctrl+C
        process.stdout.write('\n');
        process.exit(130);
      } else if (str === '\u007f' || str === '\b') { // backspace
        if (pwd.length > 0) {
          pwd = pwd.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        pwd += str;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
    // Mode raw pour intercepter chaque touche
    if (stdin.setRawMode) stdin.setRawMode(true);
  });
}

// ── Validation du mot de passe ─────────────────────────────────────────────

function validatePassword(pwd) {
  if (!pwd || typeof pwd !== 'string') {
    return 'Mot de passe vide';
  }
  if (pwd.length < MIN_PASSWORD_LENGTH) {
    return `Mot de passe trop court (min ${MIN_PASSWORD_LENGTH} caractères)`;
  }
  if (!/[A-Z]/.test(pwd)) {
    return 'Le mot de passe doit contenir au moins une majuscule';
  }
  if (!/[0-9]/.test(pwd)) {
    return 'Le mot de passe doit contenir au moins un chiffre';
  }
  if (WEAK_PASSWORDS.has(pwd.toLowerCase())) {
    return 'Mot de passe trop évident — choisissez-en un moins commun';
  }
  // Pas de répétition de 4+ chars identiques (aaaa, 1111, etc.)
  if (/(.)\1{3,}/.test(pwd)) {
    return 'Mot de passe contient une répétition suspecte';
  }
  return null;
}

// ── Opérations DB ──────────────────────────────────────────────────────────

async function findAdmin(pool, email) {
  const { rows } = await pool.query(
    `SELECT id, full_name, email, role, created_at, updated_at
     FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function updateAdminPassword(pool, email, hash) {
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = NOW()
     WHERE email = $2 AND role = 'admin'
     RETURNING id, full_name, email, role`,
    [hash, email]
  );
  return rows[0] || null;
}

async function createAdmin(pool, email, hash) {
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
     VALUES ($1, $2, $3, 'admin', 'KMF', 'KM', $4)
     RETURNING id, full_name, email, role`,
    [DEFAULT_ADMIN_NAME, email, DEFAULT_ADMIN_PHONE, hash]
  );
  return rows[0] || null;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  const ts = new Date().toISOString();

  // Pré-requis : DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL non défini. Exportez la variable ou créez un .env.');
    process.exit(1);
  }

  // Requires locaux (après parse des args → --help ne nécessite pas pg)
  let Pool, bcrypt;
  try {
    Pool = require('pg').Pool;
    bcrypt = require('bcryptjs');
  } catch (e) {
    console.error('❌ Dépendances manquantes : npm install pg bcryptjs');
    console.error(`   Détail : ${e.message}`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /amazonaws|railway|neon|supabase/i.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    console.log(`[${ts}] Connexion DB...`);
    const existing = await findAdmin(pool, opts.email);

    // Mode --check
    if (opts.check) {
      if (!existing) {
        console.log(`❌ Aucun utilisateur avec l'email ${opts.email}`);
        process.exit(1);
      }
      console.log(`✅ Utilisateur trouvé :`);
      console.log(`   id:          ${existing.id}`);
      console.log(`   email:       ${existing.email}`);
      console.log(`   full_name:   ${existing.full_name}`);
      console.log(`   role:        ${existing.role}`);
      console.log(`   created_at:  ${existing.created_at}`);
      console.log(`   updated_at:  ${existing.updated_at}`);
      if (existing.role !== 'admin') {
        console.warn(`⚠️  Ce compte n'a PAS le rôle admin (rôle actuel : ${existing.role})`);
      }
      process.exit(0);
    }

    // Vérifier que l'admin existe, sauf si --create
    if (!existing) {
      if (!opts.create) {
        console.error(`❌ Aucun admin trouvé avec email=${opts.email}`);
        console.error(`   Utilisez --create pour le créer, ou --email pour cibler un autre compte.`);
        process.exit(1);
      }
    } else if (existing.role !== 'admin') {
      console.error(`❌ Le compte ${opts.email} existe mais n'est PAS admin (rôle : ${existing.role})`);
      console.error(`   Refus de modifier un compte non-admin depuis ce script.`);
      process.exit(1);
    }

    // Obtenir le mot de passe
    let pwd = opts.password;
    if (!pwd) {
      pwd = await promptPassword('Nouveau mot de passe (masqué) : ');
      const pwd2 = await promptPassword('Confirmer : ');
      if (pwd !== pwd2) {
        console.error('❌ Les mots de passe ne correspondent pas.');
        process.exit(1);
      }
    }

    // Valider
    const errMsg = validatePassword(pwd);
    if (errMsg) {
      console.error(`❌ ${errMsg}`);
      process.exit(1);
    }

    // Hash
    console.log('Hashage bcrypt (cost 12)...');
    const hash = await bcrypt.hash(pwd, 12);

    // Upsert
    let result;
    if (existing) {
      result = await updateAdminPassword(pool, opts.email, hash);
      if (!result) {
        console.error(`❌ UPDATE a échoué (compte ${opts.email} non-admin ?)`);
        process.exit(1);
      }
      console.log(`✅ [${new Date().toISOString()}] Mot de passe admin réinitialisé`);
    } else {
      result = await createAdmin(pool, opts.email, hash);
      if (!result) {
        console.error(`❌ INSERT a échoué`);
        process.exit(1);
      }
      console.log(`✅ [${new Date().toISOString()}] Nouvel admin créé`);
    }
    console.log(`   id:    ${result.id}`);
    console.log(`   email: ${result.email}`);
    console.log(`   role:  ${result.role}`);

    // Rappel sécurité
    console.log('');
    console.log('ℹ️  Pense à :');
    console.log('   · Invalider les sessions actives (redémarrer le serveur ou purger le cache JWT)');
    console.log('   · Stocker ce mot de passe dans un gestionnaire sûr (pas en clair dans un fichier)');
    console.log('   · Vérifier via /api/auth/login que la connexion fonctionne');

  } catch (err) {
    console.error(`❌ Erreur: ${err.message}`);
    if (err.code) console.error(`   Code PG: ${err.code}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
