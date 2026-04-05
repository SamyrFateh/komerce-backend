# 🚀 Guide de Déploiement — Komerce Backend

> Guide complet pour déployer et maintenir le backend Komerce en production.  
> **Version API :** v9.3 | **Dernière mise à jour :** 05/04/2026

---

## 📋 Table des matières

1. [Prérequis](#-prérequis)
2. [Déploiement sur Railway](#-déploiement-sur-railway)
3. [Variables d'environnement](#-variables-denvironnement)
4. [Base de données PostgreSQL](#-base-de-données-postgresql)
5. [Migrations automatiques](#-migrations-automatiques)
6. [Configuration Stripe](#-configuration-stripe)
7. [Configuration SMS — Africa's Talking](#-configuration-sms--africas-talking)
8. [Configuration Cloudinary](#-configuration-cloudinary)
9. [Domaine & SSL](#-domaine--ssl)
10. [Monitoring & Health Checks](#-monitoring--health-checks)
11. [Pipeline CI/CD](#-pipeline-cicd)
12. [Dépannage](#-dépannage)
13. [Procédure de rollback](#-procédure-de-rollback)
14. [Checklist de production](#-checklist-de-production)

---

## 📦 Prérequis

### Logiciels requis

| Outil | Version minimale | Usage |
|-------|-----------------|-------|
| Node.js | 18.x+ | Runtime serveur |
| npm | 9.x+ | Gestionnaire de paquets |
| PostgreSQL | 14+ | Base de données |
| Git | 2.x+ | Gestion de version |

### Comptes & services externes

| Service | Obligatoire | Usage |
|---------|:-----------:|-------|
| [Railway](https://railway.app) | ✅ | Hébergement (serveur + BDD) |
| [GitHub](https://github.com) | ✅ | Dépôt source + CI/CD |
| [Stripe](https://stripe.com) | ✅ | Paiements EUR (diaspora) |
| [Africa's Talking](https://africastalking.com) | ✅ | SMS transactionnels |
| [Cloudinary](https://cloudinary.com) | ✅ | Hébergement images produits |
| [Mailjet](https://mailjet.com) | ⚠️ Optionnel | Emails transactionnels |

---

## 🚂 Déploiement sur Railway

### Étape 1 — Créer un projet Railway

1. Connectez-vous sur [railway.app](https://railway.app)
2. Cliquez sur **"New Project"**
3. Sélectionnez **"Deploy from GitHub repo"**
4. Autorisez l'accès au dépôt `komerce-backend`

### Étape 2 — Ajouter PostgreSQL

1. Dans votre projet Railway, cliquez **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway crée automatiquement la base et expose la variable `DATABASE_URL`
3. Vérifiez que la variable est bien injectée dans le service backend :
   - Allez dans l'onglet **Variables** de votre service
   - Confirmez la présence de `DATABASE_URL` (référencée depuis le service PostgreSQL)

### Étape 3 — Configurer les variables d'environnement

1. Dans le service backend, ouvrez l'onglet **Variables**
2. Ajoutez toutes les variables listées dans la section [Variables d'environnement](#-variables-denvironnement)
3. Railway redéploie automatiquement à chaque modification de variable

### Étape 4 — Configurer le déploiement

1. **Build Command :** `npm install` (par défaut)
2. **Start Command :** `node server.js` (ou `npm start`)
3. **Watch Path :** `/` (redéploiement sur chaque push)
4. **Branch :** `main` (production)

### Étape 5 — Premier déploiement

```bash
# Vérifiez les logs Railway pour confirmer :
# ✅ "Database connected successfully"
# ✅ "Auto-migration completed"
# ✅ "Server running on port XXXX"
```

### Étape 6 — Seed initial (si nécessaire)

Si la base est vide, exécutez le seed via le shell Railway :

```bash
# Via Railway CLI
railway run node seeds/seed.js

# Ou depuis la console Railway
node seeds/seed.js
```

Cela insère :
- 20 produits (électronique, mode, cosmétique, bijoux)
- 5 points relais (3 îles)
- Paliers de fidélité (Bronze/Silver/Gold/Platinum)
- Taux de change EUR/KMF et AED/KMF
- Compte admin initial

---

## 🔐 Variables d'environnement

### Référence complète

| Variable | Description | Requis | Exemple |
|----------|-------------|:------:|---------|
| `NODE_ENV` | Environnement d'exécution | ✅ | `production` |
| `PORT` | Port du serveur (Railway le définit auto) | ⚠️ | `3000` |
| `DATABASE_URL` | URL de connexion PostgreSQL | ✅ | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Clé secrète pour les tokens JWT | ✅ | `votre-secret-jwt-long-et-aleatoire` |
| `QR_SECRET` | Clé secrète pour la génération QR codes | ✅ | `votre-secret-qr-long-et-aleatoire` |
| `AT_API_KEY` | Clé API Africa's Talking | ✅ | `atsk_xxxxxxxxxxxxxxx` |
| `AT_USERNAME` | Nom d'utilisateur Africa's Talking | ✅ | `komerce` |
| `AT_SENDER_ID` | ID expéditeur SMS | ✅ | `KOMERCE` |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe | ✅ | `sk_live_xxxxxxxxxxxxxxx` |
| `STRIPE_WEBHOOK_SECRET` | Secret webhook Stripe | ✅ | `whsec_xxxxxxxxxxxxxxx` |
| `CLOUDINARY_CLOUD_NAME` | Nom du cloud Cloudinary | ✅ | `komerce-prod` |
| `CLOUDINARY_API_KEY` | Clé API Cloudinary | ✅ | `123456789012345` |
| `CLOUDINARY_API_SECRET` | Secret API Cloudinary | ✅ | `aBcDeFgHiJkLmNoPqRsTuVwXyZ` |
| `RATE_EUR_KMF` | Taux de change EUR → KMF | ✅ | `492.00` |
| `RATE_AED_KMF` | Taux de change AED → KMF | ✅ | `134.00` |
| `FRONTEND_URL` | URL du frontend (CORS) | ✅ | `https://komerce.km` |
| `ADMIN_PASSWORD` | Mot de passe admin initial | ✅ | `mot-de-passe-admin-securise` |

### Bonnes pratiques

- ⚠️ **Ne jamais commiter** de secrets dans le code source
- 🔄 Utilisez des valeurs **différentes** entre développement et production
- 🔑 Générez des secrets avec : `openssl rand -hex 32`
- 📋 Le fichier `.env.example` sert de modèle (sans valeurs sensibles)

### Configuration locale (.env)

```bash
# Copier le modèle
cp .env.example .env

# Éditer avec vos valeurs
nano .env
```

---

## 🗄️ Base de données PostgreSQL

### Architecture

La base comporte **27 tables**, **2 vues**, **2 fonctions** et **6 triggers** :

```
Tables critiques (5+ routes) :
├── products         (13 routes dépendantes)
├── users            (11 routes)
├── orders           (10 routes)
├── order_items      (9 routes)
├── relais           (9 routes)
└── recipients       (5 routes)

Vues :
├── v_loyalty_summary      (résumé fidélité)
└── v_unsold_pipeline      (pipeline invendus)
```

### Provisioning sur Railway

Railway fournit PostgreSQL en un clic :

1. La variable `DATABASE_URL` est automatiquement liée
2. Format : `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`
3. SSL activé par défaut en production

### Connexion manuelle (debug)

```bash
# Via Railway CLI
railway connect postgres

# Ou avec psql
psql $DATABASE_URL
```

### Sauvegardes

- Railway effectue des **snapshots automatiques** quotidiens
- Pour un backup manuel :

```bash
# Export
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Import
psql $DATABASE_URL < backup_20260405.sql
```

---

## 🔄 Migrations automatiques

### Fonctionnement

Au démarrage du serveur, le système exécute automatiquement les migrations :

```
server.js → connectDB() → auto-migrate → seed (si vide) → listen()
```

- Les migrations créent/mettent à jour les 27 tables
- Les vues `v_loyalty_summary` et `v_unsold_pipeline` sont créées/mises à jour
- Les 2 fonctions et 6 triggers sont installés
- Le processus est **idempotent** (sans risque de doublon)

### Vérification post-migration

```sql
-- Vérifier les tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Attendu : 27 tables

-- Vérifier les vues
SELECT viewname FROM pg_views WHERE schemaname = 'public';
-- Attendu : v_loyalty_summary, v_unsold_pipeline

-- Vérifier les triggers
SELECT trigger_name, event_object_table FROM information_schema.triggers;
-- Attendu : 6 triggers
```

---

## 💳 Configuration Stripe

### 1. Créer un compte Stripe

1. Inscrivez-vous sur [stripe.com](https://stripe.com)
2. Activez votre compte (vérification d'identité requise pour le mode live)

### 2. Récupérer les clés

1. Dashboard Stripe → **Développeurs** → **Clés API**
2. Copiez la **clé secrète** (`sk_live_...`) → `STRIPE_SECRET_KEY`

### 3. Configurer le webhook

Le webhook est essentiel pour confirmer les paiements :

1. Dashboard Stripe → **Développeurs** → **Webhooks**
2. Cliquez **"Ajouter un endpoint"**
3. URL : `https://votre-domaine.com/api/payments/webhook`
4. Événements à écouter :
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Copiez le **secret de signature** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

### 4. Vérification

```bash
# Tester le webhook (Stripe CLI)
stripe listen --forward-to localhost:3000/api/payments/webhook

# Déclencher un événement test
stripe trigger checkout.session.completed
```

### Flux de paiement

```
Client (diaspora) → Stripe Checkout (EUR)
       ↓
Webhook confirmation → order.status = "paid"
       ↓
Déclenchement automatique → purchasing (triggerPurchasing)
```

> **Note :** Les paiements en KMF (cash local) sont gérés manuellement par l'admin via l'endpoint de confirmation.

---

## 📱 Configuration SMS — Africa's Talking

### 1. Créer un compte

1. Inscrivez-vous sur [africastalking.com](https://africastalking.com)
2. Créez une application (sandbox d'abord, puis production)

### 2. Récupérer les identifiants

1. Dashboard → **Settings** → **API Key** → Générer
2. Notez :
   - `AT_API_KEY` : clé API générée
   - `AT_USERNAME` : nom de votre app (ex: `komerce`)
   - `AT_SENDER_ID` : ID expéditeur approuvé (ex: `KOMERCE`)

### 3. Configuration du Sender ID

- Soumettez une demande de **Sender ID** pour les Comores (+269)
- Délai d'approbation : 2-5 jours ouvrés
- En attendant, utilisez le mode sandbox

### 4. Types de SMS envoyés

| Événement | Destinataire | Message |
|-----------|-------------|---------|
| Commande créée | Client | Confirmation + numéro de commande |
| Paiement reçu | Client | Confirmation de paiement |
| Colis au hub | Client | Notification d'arrivée |
| Colis expédié | Client | Suivi d'expédition |
| Colis au relais | Client | Invitation à récupérer + code QR |
| Colis collecté | Client | Confirmation de collecte |

### 5. Alternative Orange

Le système supporte également l'envoi via Orange Comores en fallback.

---

## 🖼️ Configuration Cloudinary

### 1. Créer un compte

1. Inscrivez-vous sur [cloudinary.com](https://cloudinary.com) (plan gratuit : 25 crédits/mois)
2. Dashboard → récupérez les identifiants

### 2. Variables

```env
CLOUDINARY_CLOUD_NAME=votre-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=aBcDeFgHiJkLmNoPqRsTuVwXyZ
```

### 3. Configuration recommandée

- **Dossier** : `komerce/products/` pour les images produits
- **Transformations** : redimensionnement automatique (800x800 max)
- **Format** : WebP auto pour optimiser la performance

### 4. Upload

Les images sont uploadées via Multer (middleware `upload`) puis transférées à Cloudinary :

```
Client → POST /api/products (multipart) → Multer (temp) → Cloudinary (permanent)
```

---

## 🌐 Domaine & SSL

### Domaine personnalisé sur Railway

1. Service backend → **Settings** → **Domains**
2. Cliquez **"+ Custom Domain"**
3. Entrez votre domaine (ex: `api.komerce.km`)
4. Configurez le DNS chez votre registrar :
   - Type : `CNAME`
   - Nom : `api`
   - Valeur : fournie par Railway (ex: `xxx.up.railway.app`)

### SSL/TLS

- Railway fournit un certificat **Let's Encrypt** automatique
- HTTPS activé par défaut, pas de configuration nécessaire
- Redirection HTTP → HTTPS automatique

### CORS

Vérifiez que `FRONTEND_URL` correspond exactement à l'URL du frontend :

```env
# ✅ Correct
FRONTEND_URL=https://komerce.km

# ❌ Incorrect (trailing slash)
FRONTEND_URL=https://komerce.km/
```

---

## 📊 Monitoring & Health Checks

### Endpoints de santé

| Endpoint | Méthode | Auth | Description |
|----------|---------|:----:|-------------|
| `/health` | GET | ❌ | État du serveur (uptime, version) |
| `/health/db` | GET | ❌ | État de la connexion PostgreSQL |

### Réponse type `/health`

```json
{
  "status": "ok",
  "version": "9.3",
  "uptime": 86400,
  "timestamp": "2026-04-05T13:46:00.000Z"
}
```

### Configuration Railway Health Check

1. Service → **Settings** → **Health Check**
2. Path : `/health`
3. Timeout : `10s`
4. Interval : `30s`

### Alertes recommandées

- ⚠️ Configurez des alertes Railway pour :
  - Redémarrages fréquents
  - Utilisation mémoire > 80%
  - Erreurs 5xx en hausse
  - Temps de réponse > 2s

### Logs

```bash
# Voir les logs en temps réel
railway logs --follow

# Filtrer les erreurs
railway logs | grep "ERROR"
```

---

## ⚙️ Pipeline CI/CD

### GitHub Actions — 2 workflows

Le projet utilise le système **coffre-fort** avec 2 workflows automatisés :

#### 1. Impact Check (sur Pull Request)

**Fichier :** `.github/workflows/impact-check.yml`

```
PR ouverte/modifiée
    ↓
Analyse des fichiers modifiés
    ↓
Détection des dépendances inter-routes
    ↓
Commentaire PR avec :
  - Fichiers impactés
  - Routes affectées
  - Tables touchées
  - Niveau de risque (LOW/MEDIUM/HIGH/CRITICAL)
  - Tests recommandés
```

#### 2. Auto-Cartography (sur merge dans main)

**Fichier :** `.github/workflows/auto-cartography.yml`

```
Merge dans main
    ↓
Analyse complète du codebase
    ↓
Mise à jour de docs/CARTOGRAPHY_360.md
    ↓
Commit automatique de la cartographie
```

### Flux de déploiement complet

```
Developer push → GitHub PR
       ↓
Impact Check → Analyse automatique
       ↓
Code Review → Approbation
       ↓
Merge → main
       ↓
Auto-Cartography → Mise à jour docs
       ↓
Railway auto-deploy → Production
       ↓
Health Check → Validation
```

### Protections de branche recommandées

- ✅ Require pull request reviews (1 minimum)
- ✅ Require status checks (impact-check)
- ✅ Require branches to be up to date
- ❌ Allow force pushes (désactivé)

---

## 🔧 Dépannage

### Problèmes courants

#### 1. Le serveur ne démarre pas

```
❌ Error: connect ECONNREFUSED — Database connection failed
```

**Solution :**
- Vérifiez que `DATABASE_URL` est correctement définie
- Vérifiez que le service PostgreSQL Railway est actif
- Testez la connexion : `psql $DATABASE_URL`

#### 2. Erreurs de migration

```
❌ Error: relation "xxx" already exists
```

**Solution :**
- Les migrations sont idempotentes (`CREATE TABLE IF NOT EXISTS`)
- Si problème persistant, vérifiez les scripts de migration pour des conflits
- En dernier recours : backup → drop → re-migrate

#### 3. Stripe webhook échoue

```
❌ Webhook signature verification failed
```

**Solution :**
- Vérifiez `STRIPE_WEBHOOK_SECRET` (doit correspondre à l'endpoint configuré)
- Assurez-vous que le body de la requête n'est pas parsé avant Stripe (`express.raw()`)
- Vérifiez l'URL du webhook dans le dashboard Stripe

#### 4. SMS non envoyés

```
❌ Africa's Talking: Invalid sender ID
```

**Solution :**
- Vérifiez que le Sender ID est approuvé pour les Comores
- Vérifiez `AT_API_KEY` et `AT_USERNAME`
- Testez en mode sandbox d'abord

#### 5. Upload d'images échoue

```
❌ Cloudinary: Invalid API credentials
```

**Solution :**
- Vérifiez les 3 variables Cloudinary
- Vérifiez les quotas (plan gratuit : 25 crédits/mois)
- Vérifiez la taille max des fichiers (Multer config)

#### 6. Erreurs CORS

```
❌ Access-Control-Allow-Origin: blocked
```

**Solution :**
- Vérifiez `FRONTEND_URL` (pas de trailing slash)
- En développement, ajoutez `http://localhost:3000`
- Vérifiez la configuration Helmet/CORS dans `server.js`

#### 7. Rate limiting trop agressif

```
❌ 429 Too Many Requests
```

**Solution :**
- Le système comporte 6 limiteurs différents
- Vérifiez quel limiteur bloque (logs)
- Ajustez les paramètres dans la configuration rate-limit si nécessaire

#### 8. Mémoire insuffisante

```
❌ JavaScript heap out of memory
```

**Solution :**
- Augmentez la mémoire Railway (Settings → Resources)
- Vérifiez les fuites mémoire (rapports PDF volumineux, uploads non nettoyés)
- Ajoutez `--max-old-space-size=512` si nécessaire

---

## ⏪ Procédure de rollback

### Rollback rapide via Railway

1. Dashboard Railway → Service backend → **Deployments**
2. Identifiez le dernier déploiement stable
3. Cliquez sur **"Redeploy"** sur ce déploiement

### Rollback Git

```bash
# Identifier le commit stable
git log --oneline -10

# Revert le dernier commit
git revert HEAD
git push origin main
# → Railway redéploie automatiquement

# OU revert vers un commit spécifique
git revert <commit-hash>
git push origin main
```

### Rollback base de données

```bash
# 1. Restaurer un backup
psql $DATABASE_URL < backup_YYYYMMDD.sql

# 2. Ou utiliser les snapshots Railway
# Dashboard → PostgreSQL → Backups → Restore
```

### Checklist rollback

- [ ] Identifier la cause du problème
- [ ] Sauvegarder l'état actuel (logs, DB)
- [ ] Effectuer le rollback (app et/ou DB)
- [ ] Vérifier le health check
- [ ] Tester les endpoints critiques
- [ ] Notifier l'équipe
- [ ] Documenter l'incident

---

## ✅ Checklist de production

### Avant le déploiement

- [ ] **Code** : tous les tests passent
- [ ] **Impact Check** : CI/CD vert sur la PR
- [ ] **Variables** : toutes les variables d'environnement sont définies
- [ ] **Secrets** : valeurs de production (pas de sandbox/test)
- [ ] **Base de données** : backup effectué avant la mise à jour

### Configuration serveur

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` : clé forte (≥ 32 caractères aléatoires)
- [ ] `QR_SECRET` : clé forte (≥ 32 caractères aléatoires)
- [ ] `ADMIN_PASSWORD` : mot de passe fort et unique
- [ ] `FRONTEND_URL` : URL exacte du frontend en production

### Sécurité

- [ ] **Helmet** : activé (headers HTTP sécurisés)
- [ ] **CORS** : restreint au domaine frontend uniquement
- [ ] **Rate limiting** : 6 limiteurs actifs et configurés
- [ ] **JWT** : cookies httpOnly, Secure, SameSite
- [ ] **Stripe webhook** : signature vérifiée
- [ ] Pas de secrets dans le code source ou les logs

### Services externes

- [ ] **Stripe** : mode live activé, webhook configuré
- [ ] **Africa's Talking** : mode production, Sender ID approuvé
- [ ] **Cloudinary** : compte actif, quotas suffisants
- [ ] **Mailjet** : domaine vérifié (si emails activés)

### Base de données

- [ ] PostgreSQL provisionné et accessible
- [ ] Migrations exécutées (27 tables, 2 vues, 6 triggers)
- [ ] Seed initial exécuté (produits, relais, tiers fidélité)
- [ ] Backups automatiques configurés

### Monitoring

- [ ] Health check configuré (`/health`)
- [ ] Logs accessibles
- [ ] Alertes configurées (Railway)

### DNS & SSL

- [ ] Domaine configuré (CNAME → Railway)
- [ ] SSL actif (Let's Encrypt)
- [ ] HTTPS forcé

### Documentation

- [ ] `README.md` à jour
- [ ] `ARCHITECTURE.md` disponible
- [ ] `DEPLOYMENT.md` (ce fichier) à jour
- [ ] `CARTOGRAPHY_360.md` générée
- [ ] `IMPACT_SYSTEM.md` disponible

---

## 📚 Ressources

| Ressource | Lien |
|-----------|------|
| Railway Docs | [docs.railway.app](https://docs.railway.app) |
| Stripe Docs | [stripe.com/docs](https://stripe.com/docs) |
| Africa's Talking | [africastalking.com/docs](https://africastalking.com/docs) |
| Cloudinary Docs | [cloudinary.com/documentation](https://cloudinary.com/documentation) |
| PostgreSQL Docs | [postgresql.org/docs](https://www.postgresql.org/docs/) |
| Express.js | [expressjs.com](https://expressjs.com) |

---

> 📝 **Ce guide est maintenu par l'équipe Komerce.**  
> Pour toute question, consultez la documentation interne ou contactez l'équipe technique.
