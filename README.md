# 🛒 Komerce Backend

<!-- Logo placeholder -->
<p align="center">
  <img src="docs/assets/komerce-logo.png" alt="Komerce Logo" width="200" />
</p>

<p align="center">
  <strong>Backend e-commerce pour l'Union des Comores</strong><br/>
  <em>Connecter la diaspora comorienne à ses îles, un colis à la fois.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Deploy-Railway-0B0D0E?logo=railway&logoColor=white" alt="Railway" />
  <img src="https://img.shields.io/badge/API-v9.3-blue" alt="API Version" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## ⚠️ AGENT IA — LIRE EN PREMIER

> **Tout agent IA** (Tasklet, Cursor, Copilot, Claude, GPT, Windsurf, etc.) **DOIT lire et respecter** [`AGENT_RULES.md`](./AGENT_RULES.md) **avant toute action sur ce projet.**
>
> Ce fichier contient 6 règles obligatoires incluant la lecture de la cartographie, la mise à jour de la documentation, et le respect de l'architecture.
>
> **Sans cette lecture, aucun code ne doit être écrit.**



## 📋 Table des matières

- [Présentation](#-présentation)
- [Fonctionnalités](#-fonctionnalités)
- [Stack technique](#-stack-technique)
- [Démarrage rapide](#-démarrage-rapide)
- [Endpoints API](#-endpoints-api)
- [Structure du projet](#-structure-du-projet)
- [Sécurité](#-sécurité)
- [Coffre-fort (Vault)](#-coffre-fort-vault)
- [Documentation](#-documentation)
- [Contribuer](#-contribuer)
- [Licence](#-licence)

---

## 🌍 Présentation

**Komerce** est un backend e-commerce spécialement conçu pour les Comores (Moroni, Anjouan, Mohéli). Il permet à la **diaspora comorienne** (principalement en France) de commander et payer des produits en **EUR via Stripe**, tandis que les clients locaux paient en **KMF** (franc comorien) en espèces.

Les colis sont livrés via un réseau de **5 points relais** répartis sur les 3 îles, avec un suivi complet par **QR code** et des notifications par **SMS** et **WhatsApp**.

### Pourquoi Komerce ?

- 🇰🇲 Adapté aux réalités logistiques comoriennes (pas de Chronopost ici !)
- 💶 Double devise EUR / KMF avec taux de change dynamique
- 📱 Notifications SMS via Africa's Talking (réseau local)
- 📦 Suivi QR code de bout en bout
- 🎁 Système de cadeaux et paniers partagés

---

## ✨ Fonctionnalités

| Domaine | Description |
|---------|-------------|
| 🛍️ **Catalogue** | 20 produits : électronique, mode, cosmétique, bijoux |
| 📦 **Commandes** | Pipeline MVP : confirmed → ordered → preparation → shipped → available → collected |
| 💳 **Paiements** | Stripe (EUR diaspora) + cash (KMF local) |
| 📍 **Points relais** | 5 relais sur Grande Comore, Anjouan et Mohéli |
| 📱 **Notifications** | SMS (Africa's Talking) + WhatsApp |
| ⭐ **Fidélité** | 4 niveaux : Bronze → Silver → Gold → Platinum |
| 📷 **QR Tracking** | Scan QR à chaque étape du parcours colis |
| ✂️ **Couture** | Module sur-mesure : tissus + modèles de vêtements |
| 🧺 **Paniers partagés** | Commandes groupées et système de cadeaux |
| 📊 **Dashboards** | Admin ops, ventes, délais, prévisions, pipeline |
| 🏭 **Achats** | Gestion fournisseurs et bons de commande |
| 📄 **Rapports PDF** | Rapports financiers générés via PDFKit |

---

## 🔧 Stack technique

| Composant | Technologie |
|-----------|-------------|
| **Runtime** | Node.js 18+ / Express.js |
| **Base de données** | PostgreSQL (27 tables, 2 vues, 6 triggers) |
| **Authentification** | JWT + bcrypt (cookies httpOnly) |
| **Paiements** | Stripe |
| **SMS** | Africa's Talking / Orange |
| **Messagerie** | WhatsApp |
| **Email** | Mailjet |
| **Fichiers** | Multer + Cloudinary |
| **PDF** | PDFKit |
| **QR Code** | QRCode |
| **Sécurité** | Helmet, CORS, 6 rate-limiters |
| **Déploiement** | Railway |
| **CI/CD** | GitHub Actions |

---

## 🚀 Démarrage rapide

### Prérequis

- **Node.js** 18+ ([télécharger](https://nodejs.org/))
- **PostgreSQL** 15+ ([télécharger](https://www.postgresql.org/))
- **npm** ou **yarn**
- Un compte **Stripe** (pour les paiements)

### Installation

```bash
# 1. Cloner le dépôt
git clone https://github.com/votre-org/komerce-backend.git
cd komerce-backend

# 2. Installer les dépendances
npm install

# 3. Configurer les variables d'environnement
cp .env.example .env
# Éditer .env avec vos valeurs (voir DEPLOYMENT.md)

# 4. Initialiser la base de données
npm run db:migrate
npm run db:seed

# 5. Lancer le serveur
npm run dev
```

Le serveur démarre sur `http://localhost:3000` par défaut.

### Vérification

```bash
# Health check
curl http://localhost:3000/health

# Réponse attendue :
# { "status": "ok", "version": "9.3", "timestamp": "..." }
```

### Variables d'environnement essentielles

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/komerce
JWT_SECRET=votre_secret_jwt
STRIPE_SECRET_KEY=sk_test_...
FRONTEND_URL=http://localhost:5173
```

> 📖 Voir [DEPLOYMENT.md](docs/DEPLOYMENT.md) pour la liste complète des variables.

---

## 📡 Endpoints API

**18 fichiers de routes — 118 endpoints au total**

| Route | Endpoints | Auth | Description |
|-------|:---------:|:----:|-------------|
| `/api/auth` | 9 | Mixte | Inscription, connexion, JWT, guest checkout |
| `/api/products` | 8 | Mixte | CRUD produits + upload images |
| `/api/orders` | 15 | 🔒 | Cycle de vie complet des commandes |
| `/api/payments` | 5 | 🔒 | Paiements Stripe + cash |
| `/api/relais` | 3 | 🌐 | Points relais (public) |
| `/api/admin` | 11 | 🔑 | Dashboard administrateur |
| `/api/dashboard` | 5 | 🔑 | Tableaux de bord opérationnels |
| `/api/admin/pilotage` | 3 | 🔑 | Pilotage business |
| `/api/admin/finance` | 4 | 🔑 | Finance + rapports PDF |
| `/api/pricing` | 4 | 🔒 | Calculateur de prix |
| `/api/modules` | 7 | 🔒 | Module couture |
| `/api/baskets` | 7 | 🔒 | Paniers partagés |
| `/api/logistics` | 5 | 🔑 | Expéditions + étiquettes |
| `/api/scans` | 6 | 🔑 | Suivi QR code |
| `/api/purchasing` | 10 | 🔑 | Fournisseurs + achats |
| `/api/loyalty` | 7 | 🔒 | Programme de fidélité |
| `/api/unsold` | 7 | 🔑 | Gestion des invendus |
| `/health` | 2 | 🌐 | Vérification santé (public) |

**Légende :** 🌐 Public · 🔒 Authentifié · 🔑 Admin

### Dépendances inter-routes

```
orders ──→ loyalty (calcul réduction, recalcul fidélité)
payments ──→ purchasing (déclenchement achat fournisseur)
purchasing ──→ scans (déclenchement scan étape 3)
scans ──→ loyalty (recalcul fidélité à la collecte)
```

---

## 📁 Structure du projet

```
komerce-backend/
├── server.js                 # Point d'entrée
├── package.json
├── .env.example              # Template variables d'environnement
│
├── routes/                   # 18 fichiers de routes (118 endpoints)
│   ├── auth.js
│   ├── products.js
│   ├── orders.js
│   ├── payments.js
│   ├── relais.js
│   ├── admin.js
│   ├── dashboard.js
│   ├── pilotage.js
│   ├── finance.js
│   ├── pricing.js
│   ├── modules.js
│   ├── baskets.js
│   ├── logistics.js
│   ├── scans.js
│   ├── purchasing.js
│   ├── loyalty.js
│   ├── unsold.js
│   └── health.js
│
├── middleware/                # Middleware Express
│   ├── authenticate.js       # Vérification JWT
│   ├── requireRole.js        # Contrôle de rôle
│   ├── requireAdmin.js       # Accès administrateur
│   ├── rateLimiter.js        # 6 limiteurs de débit
│   └── upload.js             # Multer (upload fichiers)
│
├── utils/                    # Utilitaires
│   ├── db.js                 # Pool PostgreSQL
│   ├── sms.js                # Africa's Talking SMS
│   ├── whatsapp.js           # Notifications WhatsApp
│   ├── email.js              # Mailjet
│   ├── qrcode.js             # Génération QR
│   └── pdf.js                # Génération PDF (PDFKit)
│
├── scripts/                  # Scripts et coffre-fort
│   ├── impact-config.json    # Configuration impact analysis
│   ├── impact-check.js       # Moteur d'analyse (~500 lignes)
│   └── setup-hooks.sh        # Hook pre-push local
│
├── .github/workflows/        # CI/CD
│   ├── impact-check.yml      # Analyse d'impact sur PR
│   └── auto-cartography.yml  # Cartographie auto au merge
│
├── docs/                     # Documentation
│   ├── ARCHITECTURE.md       # Architecture technique
│   ├── DEPLOYMENT.md         # Guide de déploiement
│   ├── CARTOGRAPHY_360.md    # Cartographie 360°
│   ├── IMPACT_SYSTEM.md      # Système coffre-fort
│   └── audit/                # Rapports d'audit
│
├── uploads/                  # Fichiers uploadés (local)
└── SESSION_STATUS.md         # Suivi de session
```

---

## 🔐 Sécurité

Komerce intègre plusieurs couches de sécurité :

### Authentification
- **JWT** avec cookies **httpOnly** (protection XSS)
- **bcrypt** pour le hachage des mots de passe
- Secret QR dédié (`QR_SECRET`) pour les tokens de scan

### Protection réseau
- **Helmet** — En-têtes HTTP sécurisés
- **CORS** — Origines autorisées configurables
- **6 Rate Limiters** — Protection contre les abus :
  - Global, Auth, API, Admin, Upload, Webhook

### Audit de sécurité
- **~32 issues critiques** identifiées et corrigées
- **~21 issues importantes** identifiées et corrigées
- **~5 issues mineures** documentées
- Audit complet avec rapports dans `audit/`

---

## 🏰 Coffre-fort (Vault)

Le système **coffre-fort** protège le code en production via une analyse d'impact automatisée.

### Composants (6 fichiers)

| Fichier | Rôle |
|---------|------|
| `scripts/impact-config.json` | Règles et graphe de dépendances |
| `scripts/impact-check.js` | Moteur d'analyse (0 dépendances, ~500 lignes) |
| `.github/workflows/impact-check.yml` | Action GitHub : analyse sur chaque PR |
| `.github/workflows/auto-cartography.yml` | Mise à jour cartographie au merge |
| `scripts/setup-hooks.sh` | Hook git pre-push local |
| `IMPACT_SYSTEM.md` | Documentation complète |

### Fonctionnement

1. **À chaque PR** → `impact-check.js` analyse les fichiers modifiés
2. **Détection automatique** des routes, tables et dépendances impactées
3. **Rapport d'impact** posté en commentaire sur la PR
4. **Au merge** → Cartographie 360° mise à jour automatiquement

> 📖 Voir [IMPACT_SYSTEM.md](docs/IMPACT_SYSTEM.md) pour les détails.

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture technique détaillée |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Guide de déploiement complet |
| [CARTOGRAPHY_360.md](docs/CARTOGRAPHY_360.md) | Cartographie d'impact 360° |
| [IMPACT_SYSTEM.md](docs/IMPACT_SYSTEM.md) | Documentation du coffre-fort |
| [SESSION_STATUS.md](docs/SESSION_STATUS.md) | Suivi des sessions de travail |

---

## 🤝 Contribuer

1. **Fork** le dépôt
2. **Créer** une branche (`git checkout -b feature/ma-fonctionnalite`)
3. **Installer** le hook pre-push : `bash scripts/setup-hooks.sh`
4. **Commiter** vos changements (`git commit -m "feat: description"`)
5. **Pousser** la branche (`git push origin feature/ma-fonctionnalite`)
6. **Ouvrir** une Pull Request

> ⚠️ Le système d'analyse d'impact commentera automatiquement votre PR avec les fichiers et tables impactés. Vérifiez le rapport avant de demander une review.

### Conventions

- **Commits** : format conventionnel (`feat:`, `fix:`, `docs:`, `refactor:`)
- **Branches** : `feature/`, `fix/`, `docs/`, `hotfix/`
- **Code** : JavaScript ES6+, async/await, gestion d'erreurs systématique

---

## 📄 Licence

Ce projet est sous licence **MIT**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

<p align="center">
  Fait avec ❤️ pour les Comores 🇰🇲
</p>
