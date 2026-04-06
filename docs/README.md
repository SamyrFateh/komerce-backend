# 🛒 Komerce Backend

<!-- Logo placeholder -->
<p align="center">
  <img src="assets/komerce-logo.png" alt="Komerce Logo" width="200" />
</p>

<p align="center">
  <strong>Backend e-commerce pour l'Union des Comores</strong><br/>
  <em>Connecter la diaspora comorienne à ses îles, un colis à la fois.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Deploy-Railway-0B0D0E?logo=railway&logoColor=white" alt="Railway" />
  <img src="https://img.shields.io/badge/API-v12.0-blue" alt="API Version" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
</p>

---

## 🤖 Agents IA — LIRE EN PREMIER

> **⚠️ [`../AGENT_RULES.md`](../AGENT_RULES.md) → [`AGENTS_PROTOCOL.md`](./AGENTS_PROTOCOL.md)**
>
> Tout agent IA doit lire le protocole de gouvernance AVANT toute modification.

---

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
| 📦 **Commandes** | Cycle complet : pending → paid → purchasing → hub → shipped → relais → collected |
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
git clone https://github.com/SamyrFateh/komerce-backend.git
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
curl http://localhost:3000/health
# { "status": "ok", "version": "12.0", "timestamp": "..." }
```

---

## 📡 Endpoints API

**18 fichiers de routes — 118 endpoints au total**

Voir [`CARTOGRAPHY_360.md`](./CARTOGRAPHY_360.md) pour la liste complète.

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
├── .env.example
├── AGENT_RULES.md            # ⚠️ Point d'entrée agents IA
│
├── routes/                   # 18 fichiers de routes (118 endpoints)
├── middleware/               # authenticate, requireRole, requireAdmin, rateLimiter, upload
├── utils/                    # db, sms, whatsapp, email, qrcode, pdf
├── scripts/                  # Coffre-fort + hooks
├── .github/workflows/        # CI/CD
│
├── docs/                     # Documentation
│   ├── AGENTS_PROTOCOL.md    # 🔗 Protocole de gouvernance
│   ├── CARTOGRAPHY_360.md    # 🗺️ Pilier 1 — La Carte
│   ├── ROADMAP_KOMERCE.md    # 📋 Pilier 2 — Le Plan
│   ├── AUDIT_REPORT.md       # 🔒 Pilier 3 — Le Bouclier
│   ├── audit/                # Rapports d'audit détaillés
│   ├── DEPLOYMENT.md         # Guide de déploiement
│   ├── IMPACT_SYSTEM.md      # Système coffre-fort
│   ├── VALIDATION_GUIDE.md   # Guide validation Joi
│   └── README.md             # Présentation complète
│
├── public/                   # Frontend
└── uploads/                  # Fichiers uploadés
```

---

## 🔐 Sécurité

Voir [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) et le dossier [`audit/`](./audit/) pour le détail complet.

- **JWT** avec cookies **httpOnly**
- **Helmet** + **CORS** + **6 Rate Limiters**
- **14 issues de sécurité ouvertes** (#71-#84) — voir la roadmap
- Système **coffre-fort** (analyse d'impact automatique sur chaque PR)

---

## 🏰 Coffre-fort (Vault)

Voir [`IMPACT_SYSTEM.md`](./IMPACT_SYSTEM.md) pour la documentation complète.

| Fichier | Rôle |
|---------|------|
| `scripts/impact-config.json` | Règles et graphe de dépendances |
| `scripts/impact-check.js` | Moteur d'analyse |
| `.github/workflows/impact-check.yml` | Action GitHub sur PR |
| `.github/workflows/auto-cartography.yml` | Cartographie auto au merge |
| `scripts/setup-hooks.sh` | Hook git pre-push local |

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [`AGENTS_PROTOCOL.md`](./AGENTS_PROTOCOL.md) | 🔗 Protocole de gouvernance — **LIRE EN PREMIER** |
| [`CARTOGRAPHY_360.md`](./CARTOGRAPHY_360.md) | 🗺️ Cartographie 360° — source de vérité |
| [`ROADMAP_KOMERCE.md`](./ROADMAP_KOMERCE.md) | 📋 Roadmap unique de référence |
| [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) | 🔒 Rapport d'audit sécurité |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 🚀 Guide de déploiement Railway |
| [`VALIDATION_GUIDE.md`](./VALIDATION_GUIDE.md) | ✅ Guide validation Joi |
| [`IMPACT_SYSTEM.md`](./IMPACT_SYSTEM.md) | 🛡️ Documentation coffre-fort |

---

## 🤝 Contribuer

1. **Lire** `AGENT_RULES.md` → `docs/AGENTS_PROTOCOL.md`
2. **Fork** le dépôt
3. **Créer** une branche (`git checkout -b feature/ma-fonctionnalite`)
4. **Installer** le hook pre-push : `bash scripts/setup-hooks.sh`
5. **Commiter** vos changements (`git commit -m "feat: description"`)
6. **Pousser** et ouvrir une **Pull Request**

> ⚠️ Le système d'analyse d'impact commentera automatiquement votre PR.

---

## 📄 Licence

**MIT** — Voir [LICENSE](LICENSE)

---

<p align="center">
  Fait avec ❤️ pour les Comores 🇰🇲
</p>
