/**
 * KOMERCE — Serveur principal
 * Node.js + Express + PostgreSQL
 * Version 1.0 · Mars 2026
 *
 * Routes disponibles :
 *   /api/products   → catalogue produits
 *   /api/orders     → commandes (création, suivi, tracking)
 *   /api/scans      → scan logistique (4 étapes)
 *   /api/payments   → Stripe EUR + Cash relais
 *   /api/baskets    → panier partagé + cadeaux M10
 *   /api/ceremony   → tissus + tenues cérémonie M11
 *   /api/logistics  → colisage + PDF étiquettes + manifeste M12
 *   /api/pricing    → simulation prix + taux de change
 *   /api/health     → vérification état du serveur
 *
 * Interfaces front servies en statique :
 *   /               → Komerce_Web.html   (diaspora/web universel)
 *   /pwa            → Komerce_PWA_Mobile.html (mobile Anjouan)
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { processChashRelaisReminders } = require('./utils/sms');

const app = express();

// ── Sécurité ──────────────────────────────────────────────────────────────────
app.use(helmet({
  // Nécessaire pour servir les HTML avec scripts inline
  contentSecurityPolicy: false,
}));

// CORS : en dev tout est autorisé, en prod restreindre au domaine
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://komerce.km', 'https://www.komerce.km']
    : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// Rate limiting : 100 requêtes par 15 minutes par IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes — réessayez dans 15 minutes' },
});
app.use('/api/', limiter);

// ── Parsers ───────────────────────────────────────────────────────────────────
// Le webhook Stripe nécessite le body brut (raw) — doit être avant express.json()
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Interfaces HTML statiques ─────────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'Komerce_Web.html')));
app.get('/pwa', (req, res) => res.sendFile(path.join(publicDir, 'Komerce_PWA_Mobile.html')));

// ── Routes API ────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/products',   require('./routes/products'));
app.use('/api/orders',     require('./routes/orders'));
app.use('/api/scans',      require('./routes/scans'));
app.use('/api/payments',   require('./routes/payments'));
app.use('/api/relais', require('./routes/relais'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/dashboard',  require('./routes/dashboard'));
// ── Routes v6.4 ────────────────────────────────────────────────────────────
app.use('/api/baskets',    require('./routes/baskets'));    // M10 Panier partagé + cadeaux
app.use('/api/ceremony',   require('./routes/ceremony'));   // M11 Tissus & tenues cérémonie
app.use('/api/logistics',  require('./routes/logistics'));  // M12 Colisage + PDF étiquettes/manifeste
app.use('/api/pricing',    require('./routes/pricing'));    // Moteur pricing v6.4 + taux admin


// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    version: '1.0',
    env:     process.env.NODE_ENV || 'development',
    time:    new Date().toISOString(),
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` });
});

// ── Gestion des erreurs globales ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Erreur non gérée :', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Komerce API démarrée sur http://localhost:${PORT}`);
  console.log(`   → Web :  http://localhost:${PORT}/`);
  console.log(`   → PWA :  http://localhost:${PORT}/pwa`);
  console.log(`   → API :  http://localhost:${PORT}/api/health\n`);
});

// ── Cron : rappels Cash relais (toutes les heures) ────────────────────────────
// Vérifie les commandes cash non payées et envoie les rappels H+12 / annule H+36
setInterval(async () => {
  try {
    await processChashRelaisReminders();
  } catch (err) {
    console.error('❌ Erreur cron cash relais :', err.message);
  }
}, 60 * 60 * 1000); // toutes les heures

module.exports = app;
