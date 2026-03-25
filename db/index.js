/**
 * KOMERCE — Connexion PostgreSQL
 * Utilise un pool de connexions pg pour gérer les requêtes concurrentes.
 * La variable DATABASE_URL est définie dans .env
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // En production (Railway, Render) : activer SSL
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,               // max connexions simultanées
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Vérification au démarrage
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erreur connexion PostgreSQL :', err.message);
  } else {
    console.log('✅ PostgreSQL connecté');
    release();
  }
});

/**
 * Helper : exécute une requête SQL avec paramètres
 * Usage : await query('SELECT * FROM orders WHERE id = $1', [id])
 */
const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
