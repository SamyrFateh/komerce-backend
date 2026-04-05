# 🏗️ Architecture Technique — Komerce Backend

> Document d'architecture détaillé du backend e-commerce pour l'Union des Comores.  
> Version API : **v9.3** | Dernière mise à jour : 05/04/2026

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture haut niveau](#2-architecture-haut-niveau)
3. [Cycle de vie d'une requête](#3-cycle-de-vie-dune-requête)
4. [Composants applicatifs](#4-composants-applicatifs)
5. [Architecture de la base de données](#5-architecture-de-la-base-de-données)
6. [Graphe de dépendances inter-routes](#6-graphe-de-dépendances-inter-routes)
7. [Machine d'états — Cycle de vie d'une commande](#7-machine-détats--cycle-de-vie-dune-commande)
8. [Intégrations de services externes](#8-intégrations-de-services-externes)
9. [Couches de sécurité](#9-couches-de-sécurité)
10. [Système Coffre-fort](#10-système-coffre-fort)
11. [Performance et optimisation](#11-performance-et-optimisation)
12. [Scalabilité](#12-scalabilité)

---

## 1. Vue d'ensemble

Komerce est un backend **Node.js / Express.js** servant une API REST pour une plateforme e-commerce dédiée aux Comores. L'architecture suit un modèle **monolithique modulaire** organisé par domaine métier, avec une base PostgreSQL et des intégrations vers des services tiers (paiement, SMS, email, stockage).

### Chiffres clés

| Métrique | Valeur |
|---|---|
| Routes | 18 fichiers |
| Endpoints | 118 |
| Tables PostgreSQL | 27 |
| Vues | 2 |
| Fonctions DB | 2 |
| Triggers DB | 6 |
| Rate limiters | 6 |
| Services externes | 5 (Stripe, Africa's Talking, WhatsApp, Mailjet, Cloudinary) |

---

## 2. Architecture haut niveau

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                    │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ App Web  │  │ App Diaspora │  │ Admin UI  │  │ Webhook Stripe│  │
│  └────┬─────┘  └──────┬───────┘  └─────┬─────┘  └───────┬───────┘  │
└───────┼────────────────┼────────────────┼────────────────┼──────────┘
        │                │                │                │
        ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (Express.js)                       │
│  ┌─────────┐ ┌──────┐ ┌───────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Helmet  │ │ CORS │ │Rate-Limit │ │  Cookie  │ │   Multer    │  │
│  │(sécurité)│ │      │ │ (6 types) │ │  Parser  │ │  (uploads)  │  │
│  └─────────┘ └──────┘ └───────────┘ └──────────┘ └─────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COUCHE AUTHENTIFICATION                           │
│           ┌──────────────┐    ┌──────────────┐                      │
│           │ authenticate │    │ requireRole  │                      │
│           │   (JWT)      │    │ requireAdmin │                      │
│           └──────────────┘    └──────────────┘                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     COUCHE ROUTES (18 fichiers)                     │
│                                                                     │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  Auth  │ │ Products │ │ Orders │ │ Payments │ │   Admin     │  │
│  │  (9)   │ │   (8)    │ │  (15)  │ │   (5)    │ │   (11)      │  │
│  └────────┘ └──────────┘ └────────┘ └──────────┘ └─────────────┘  │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ Relais │ │Dashboard │ │Pricing │ │ Modules  │ │  Baskets    │  │
│  │  (3)   │ │   (5)    │ │  (4)   │ │   (7)    │ │    (7)      │  │
│  └────────┘ └──────────┘ └────────┘ └──────────┘ └─────────────┘  │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐  │
│  │Logistic│ │  Scans   │ │Purchas.│ │ Loyalty  │ │   Unsold    │  │
│  │  (5)   │ │   (6)    │ │  (10)  │ │   (7)    │ │    (7)      │  │
│  └────────┘ └──────────┘ └────────┘ └──────────┘ └─────────────┘  │
│  ┌────────┐ ┌──────────┐ ┌────────┐                                │
│  │Pilotage│ │ Finance  │ │ Health │                                │
│  │  (3)   │ │   (4)    │ │  (2)   │                                │
│  └────────┘ └──────────┘ └────────┘                                │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COUCHE UTILITAIRES                                │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  SMS   │ │ WhatsApp │ │  Email │ │   PDF    │ │     QR      │  │
│  └────────┘ └──────────┘ └────────┘ └──────────┘ └─────────────┘  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COUCHE DONNÉES                                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  PostgreSQL (Railway)                         │   │
│  │  27 tables │ 2 vues │ 2 fonctions │ 6 triggers              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │
│  │  Cloudinary  │  │    Stripe    │  │  Africa's Talking      │    │
│  │  (images)    │  │  (paiements) │  │  (SMS/WhatsApp)        │    │
│  └──────────────┘  └──────────────┘  └────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Cycle de vie d'une requête

Chaque requête HTTP traverse plusieurs couches avant d'atteindre la logique métier :

```
Client HTTP
    │
    ▼
┌───────────────────────┐
│ 1. Helmet             │  ── Headers de sécurité (CSP, X-Frame, etc.)
├───────────────────────┤
│ 2. CORS               │  ── Vérification origine (FRONTEND_URL)
├───────────────────────┤
│ 3. Rate Limiter        │  ── Limite par IP/endpoint (6 profils)
├───────────────────────┤
│ 4. Cookie Parser       │  ── Extraction des cookies (JWT)
├───────────────────────┤
│ 5. JSON Body Parser    │  ── Parse du body JSON
├───────────────────────┤
│ 6. Router Express      │  ── Routage vers le bon fichier
├───────────────────────┤
│ 7. authenticate(JWT)   │  ── Vérification token (si route protégée)
├───────────────────────┤
│ 8. requireRole/Admin   │  ── Vérification rôle utilisateur
├───────────────────────┤
│ 9. Multer (si upload)  │  ── Traitement fichier uploadé
├───────────────────────┤
│ 10. Handler métier     │  ── Logique métier + requêtes DB
├───────────────────────┤
│ 11. Réponse JSON       │  ── Envoi de la réponse au client
└───────────────────────┘
```

### Exemple concret : Création d'une commande

```
POST /api/orders
    │
    ├── Helmet, CORS, Rate-limit ✓
    ├── authenticate(JWT) → user.id
    ├── Validation du body (items, relais, etc.)
    ├── BEGIN TRANSACTION
    │     ├── Vérification stock produits
    │     ├── Calcul prix (EUR/KMF + taux de change)
    │     ├── Application réduction fidélité → getLoyaltyDiscount()
    │     ├── INSERT INTO orders
    │     ├── INSERT INTO order_items (pour chaque article)
    │     ├── INSERT INTO recipients
    │     └── INSERT INTO order_status_history (status: 'pending')
    ├── COMMIT
    ├── Notification SMS/WhatsApp (async)
    └── Réponse 201 { order }
```

---

## 4. Composants applicatifs

### Structure du projet

```
komerce-backend/
├── server.js                    # Point d'entrée
├── db.js                        # Pool PostgreSQL
├── migrate.js                   # Auto-migrations
├── seed.js                      # Données initiales (20 produits, 5 relais)
│
├── routes/                      # 18 fichiers de routes
│   ├── auth.js                  # Authentification & utilisateurs
│   ├── products.js              # Catalogue produits
│   ├── orders.js                # Gestion commandes
│   ├── payments.js              # Paiements (Stripe + cash)
│   ├── relais.js                # Points relais (public)
│   ├── admin.js                 # Administration générale
│   ├── dashboard.js             # Tableaux de bord ops
│   ├── pilotage.js              # Pilotage business
│   ├── finance.js               # Finance & rapports PDF
│   ├── pricing.js               # Calculateur de prix
│   ├── modules.js               # Module couture
│   ├── baskets.js               # Paniers partagés & cadeaux
│   ├── logistics.js             # Expéditions & étiquettes
│   ├── scans.js                 # Suivi QR code
│   ├── purchasing.js            # Achats & fournisseurs
│   ├── loyalty.js               # Programme fidélité
│   ├── unsold.js                # Gestion invendus
│   └── health.js                # Health check
│
├── middleware/
│   ├── authenticate.js          # JWT cookie extraction
│   ├── requireRole.js           # Vérification rôle
│   ├── requireAdmin.js          # Accès admin
│   └── rateLimiters.js          # 6 profils rate-limit
│
├── utils/
│   ├── sms.js                   # Africa's Talking SMS
│   ├── whatsapp.js              # WhatsApp messaging
│   ├── email.js                 # Mailjet transactionnel
│   ├── pdf.js                   # Génération PDF (PDFKit)
│   └── qr.js                    # Génération QR codes
│
├── scripts/
│   ├── impact-config.json       # Config coffre-fort
│   ├── impact-check.js          # Moteur d'analyse d'impact
│   └── setup-hooks.sh           # Hook Git local
│
├── .github/workflows/
│   ├── impact-check.yml         # CI : analyse d'impact sur PR
│   └── auto-cartography.yml     # CI : cartographie auto au merge
│
└── docs/                        # Documentation
    ├── CARTOGRAPHY_360.md
    ├── IMPACT_SYSTEM.md
    ├── ARCHITECTURE.md           # ← Ce document
    ├── DEPLOYMENT.md
    └── audit/
```

### Responsabilités par composant

| Composant | Responsabilité | Dépendances clés |
|---|---|---|
| `auth.js` | Inscription, connexion, JWT, guest checkout | `users`, bcrypt, JWT |
| `products.js` | CRUD produits, upload images | `products`, Cloudinary, Multer |
| `orders.js` | Cycle de vie complet des commandes | `orders`, `order_items`, `recipients`, loyalty |
| `payments.js` | Stripe (EUR), cash (KMF), webhooks | `orders`, Stripe, purchasing |
| `relais.js` | Points relais (lecture publique) | `relais` |
| `admin.js` | Dashboard admin, gestion utilisateurs | Toutes tables |
| `dashboard.js` | KPIs opérationnels, métriques | `orders`, `products` |
| `pilotage.js` | Pilotage business, prévisions | Vues agrégées |
| `finance.js` | Rapports financiers, export PDF | `orders`, PDFKit |
| `pricing.js` | Calcul prix EUR→KMF, marges | `exchange_rates` |
| `modules.js` | Couture : tissus + modèles | `fabrics`, `garment_models` |
| `baskets.js` | Paniers partagés, cadeaux | `baskets`, `basket_items` |
| `logistics.js` | Expéditions, étiquettes | `shipments`, `via` |
| `scans.js` | Scan QR, traçabilité colis | `scans`, QR |
| `purchasing.js` | Bons d'achat, fournisseurs | `purchase_orders`, `suppliers` |
| `loyalty.js` | Programme fidélité, tiers | `loyalty_tiers`, `v_loyalty_summary` |
| `unsold.js` | Gestion invendus, pipeline | `unsold_items`, `v_unsold_pipeline` |
| `health.js` | Santé applicative (public) | `db.js` |

---

## 5. Architecture de la base de données

### Diagramme entité-relation simplifié

```
                        ┌──────────────┐
                        │    users     │
                        │──────────────│
                        │ id (PK)      │
                        │ email        │
                        │ password     │
                        │ role         │
                        │ phone        │
                        │ loyalty_tier │
                        └──────┬───────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
     ┌────────────┐   ┌──────────────┐  ┌──────────────┐
     │  baskets   │   │   orders     │  │   scans      │
     │────────────│   │──────────────│  │──────────────│
     │ id (PK)    │   │ id (PK)      │  │ id (PK)      │
     │ user_id(FK)│   │ user_id (FK) │  │ order_id(FK) │
     │ name       │   │ status       │  │ scan_type    │
     │ is_gift    │   │ total_eur    │  │ scanned_at   │
     └─────┬──────┘   │ total_kmf    │  │ location     │
           │          │ relais_id(FK)│  └──────────────┘
           ▼          │ payment_type │
  ┌──────────────┐    └──────┬───────┘
  │ basket_items │           │
  │──────────────│    ┌──────┼──────────────────┐
  │ basket_id(FK)│    │      │                  │
  │ product_id   │    ▼      ▼                  ▼
  └──────────────┘  ┌────────────┐  ┌──────────────────┐  ┌──────────────┐
                    │order_items │  │order_status_     │  │ recipients   │
                    │────────────│  │    history        │  │──────────────│
                    │ order_id   │  │──────────────────│  │ order_id(FK) │
                    │ product_id │  │ order_id (FK)    │  │ name         │
                    │ quantity   │  │ status           │  │ phone        │
                    │ unit_price │  │ changed_at       │  │ relais_id    │
                    └─────┬──────┘  └──────────────────┘  └──────────────┘
                          │
                          ▼
                   ┌──────────────┐         ┌──────────────┐
                   │  products    │◄────────│product_      │
                   │──────────────│         │  suppliers   │
                   │ id (PK)      │         │──────────────│
                   │ name         │         │ product_id   │
                   │ description  │         │ supplier_id  │
                   │ price_eur    │         └──────┬───────┘
                   │ price_kmf    │                │
                   │ category     │                ▼
                   │ image_url    │         ┌──────────────┐
                   │ stock        │         │  suppliers   │
                   └──────────────┘         │──────────────│
                                            │ id (PK)      │
                                            │ name         │
       ┌──────────────┐                     │ country      │
       │    relais     │                    └──────────────┘
       │──────────────│
       │ id (PK)      │         ┌──────────────┐
       │ name         │         │ shipments    │
       │ island       │         │──────────────│
       │ address      │         │ order_id(FK) │
       │ phone        │         │ tracking_no  │
       │ is_active    │         │ status       │
       └──────────────┘         └──────────────┘

  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐
  │   fabrics    │  │ garment_models │  │ exchange_rates   │
  │──────────────│  │────────────────│  │──────────────────│
  │ id (PK)      │  │ id (PK)        │  │ pair (EUR/KMF)   │
  │ name         │  │ name           │  │ rate             │
  │ price        │  │ base_price     │  │ updated_at       │
  │ image_url    │  │ image_url      │  └──────────────────┘
  └──────────────┘  └────────────────┘

  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐
  │loyalty_tiers │  │ unsold_items   │  │   sms_log        │
  │──────────────│  │────────────────│  │──────────────────│
  │ name         │  │ product_id(FK) │  │ phone            │
  │ min_orders   │  │ quantity       │  │ message          │
  │ discount_%   │  │ reason         │  │ status           │
  └──────────────┘  └────────────────┘  └──────────────────┘

  Vues :
  ┌───────────────────┐  ┌────────────────────┐
  │v_loyalty_summary  │  │v_unsold_pipeline   │
  │(agrégation users  │  │(pipeline invendus  │
  │ + orders)         │  │ + produits)        │
  └───────────────────┘  └────────────────────┘
```

### Classification des tables par criticité

| Niveau | Tables | Nb de routes dépendantes |
|---|---|---|
| **Critique** | `products`, `users`, `orders`, `order_items`, `relais`, `recipients` | 5–13 |
| **Élevé** | `exchange_rates`, `order_status_history`, `loyalty_tiers` | 3–4 |
| **Moyen** | `customs_history`, `fabrics`, `garment_models`, `product_suppliers`, `purchase_orders`, `via` | 2 |
| **Faible** | `basket_items`, `baskets`, `customs_taux_mensuel`, `partners`, `pour`, `scans`, `shipments`, `suppliers`, `unsold_items`, `sms_log` | 1 |

### Triggers PostgreSQL (6)

| Trigger | Table | Événement | Action |
|---|---|---|---|
| Stock auto-décrémentation | `order_items` | INSERT | Réduit le stock produit |
| Historique statut | `orders` | UPDATE (status) | Insère dans `order_status_history` |
| Taux de change | `exchange_rates` | UPDATE | Met à jour `customs_taux_mensuel` |
| Fidélité auto | `orders` | UPDATE (collected) | Recalcule le tier fidélité |
| Scan validation | `scans` | INSERT | Vérifie la cohérence du parcours |
| Log SMS | `sms_log` | INSERT | Horodatage automatique |

---

## 6. Graphe de dépendances inter-routes

Les routes communiquent entre elles via des appels de fonctions internes. Voici le graphe de dépendances :

```
┌──────────┐     getLoyaltyDiscount()     ┌───────────┐
│  orders  │ ──────────────────────────►  │  loyalty  │
│  (15)    │                              │   (7)     │
└────┬─────┘     recalculateLoyalty()     └───────────┘
     │           ────────────────────────►      ▲
     │                                          │
     │                                          │ recalculateLoyalty()
     ▼                                          │
┌──────────┐     triggerPurchasing()      ┌───────────┐
│ payments │ ──────────────────────────►  │purchasing │
│   (5)    │                              │   (10)    │
└──────────┘                              └─────┬─────┘
                                                │
                                                │ triggerScan3()
                                                ▼
                                          ┌───────────┐
                                          │   scans   │
                                          │    (6)    │
                                          └───────────┘
```

### Flux complet d'une commande payée

```
1. Client passe commande          → orders.js (POST /api/orders)
2. Client paie via Stripe         → payments.js (POST /api/payments/stripe)
3. Webhook Stripe confirme        → payments.js (POST /api/payments/webhook)
   └─► Statut → "paid"
   └─► triggerPurchasing()        → purchasing.js
       └─► Création bon d'achat
       └─► Notification fournisseur (SMS)
4. Colis reçu au hub              → scans.js (POST /api/scans)
   └─► triggerScan3()
   └─► Statut → "hub_received"
5. Expédition vers relais         → logistics.js
   └─► Statut → "shipped"
6. Arrivée au relais              → scans.js
   └─► Statut → "relais_received"
   └─► SMS au destinataire
7. Collecte par le client         → scans.js (QR code)
   └─► Statut → "collected"
   └─► recalculateLoyalty()       → loyalty.js
```

---

## 7. Machine d'états — Cycle de vie d'une commande

```
                    ┌─────────────┐
                    │   pending   │  ← Commande créée
                    └──────┬──────┘
                           │
                    Paiement confirmé
                    (Stripe webhook / cash)
                           │
                           ▼
                    ┌─────────────┐
                    │    paid     │  ← Paiement validé
                    └──────┬──────┘
                           │
                    triggerPurchasing()
                    (Bon d'achat créé)
                           │
                           ▼
                    ┌─────────────┐
                    │ purchasing  │  ← En cours d'achat fournisseur
                    └──────┬──────┘
                           │
                    Scan réception hub
                           │
                           ▼
                    ┌──────────────┐
                    │hub_received  │  ← Colis arrivé au hub central
                    └──────┬───────┘
                           │
                    Expédition inter-îles
                           │
                           ▼
                    ┌─────────────┐
                    │   shipped   │  ← En transit vers le relais
                    └──────┬──────┘
                           │
                    Scan arrivée relais
                           │
                           ▼
                    ┌────────────────┐
                    │relais_received │  ← Disponible au point relais
                    └───────┬────────┘  → SMS/WhatsApp envoyé
                            │
                    Scan QR par client
                            │
                            ▼
                    ┌─────────────┐
                    │  collected  │  ← Livré ✓
                    └─────────────┘  → Fidélité recalculée

         ┌─────────────┐
         │  cancelled   │  ← Peut survenir depuis pending/paid
         └─────────────┘
```

### Transitions autorisées

| De | Vers | Déclencheur |
|---|---|---|
| `pending` | `paid` | Webhook Stripe / validation cash |
| `pending` | `cancelled` | Annulation client/admin |
| `paid` | `purchasing` | `triggerPurchasing()` automatique |
| `paid` | `cancelled` | Remboursement admin |
| `purchasing` | `hub_received` | Scan QR au hub |
| `hub_received` | `shipped` | Création expédition |
| `shipped` | `relais_received` | Scan QR au relais |
| `relais_received` | `collected` | Scan QR par client |

---

## 8. Intégrations de services externes

### 8.1 Stripe (Paiements EUR — Diaspora)

```
┌────────┐    POST /payments/stripe    ┌──────────┐    Payment Intent    ┌────────┐
│ Client │ ──────────────────────────► │ Komerce  │ ──────────────────► │ Stripe │
│(diasp.)│                             │ Backend  │                     │  API   │
└────────┘                             └──────────┘                     └───┬────┘
                                            ▲                               │
                                            │        Webhook                │
                                            └───────────────────────────────┘
                                        POST /payments/webhook
                                        (signature vérifiée)
```

- **Mode** : Payment Intents API
- **Devise** : EUR uniquement
- **Webhook** : Vérifié via `STRIPE_WEBHOOK_SECRET`
- **Actions post-paiement** : Mise à jour statut + `triggerPurchasing()`

### 8.2 Africa's Talking (SMS)

```
┌──────────┐    sendSMS(phone, msg)    ┌──────────────────┐
│ Komerce  │ ────────────────────────► │ Africa's Talking │
│ Backend  │                           │     API          │
└──────────┘                           └──────────────────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │ Destinataire│
                                       │ (+269 xxx)  │
                                       └─────────────┘
```

- **Utilisé pour** : Notifications de commande, codes QR, alertes relais
- **Indicatif** : +269 (Comores)
- **Log** : Table `sms_log` pour audit

### 8.3 WhatsApp (Messaging)

- Notifications complémentaires aux SMS
- Alertes de disponibilité au relais
- Intégré via l'API Africa's Talking / Orange

### 8.4 Mailjet (Email transactionnel)

- Confirmations de commande
- Factures PDF en pièce jointe
- Notifications admin

### 8.5 Cloudinary (Stockage images)

```
┌────────┐   Multer    ┌──────────┐   Upload    ┌────────────┐
│ Client │ ──────────► │ Komerce  │ ──────────► │ Cloudinary │
│(admin) │  multipart  │ Backend  │             │   CDN      │
└────────┘             └──────────┘             └─────┬──────┘
                                                      │
                                                 URL retournée
                                                 (stockée en DB)
```

- **Utilisé pour** : Images produits, tissus, modèles couture
- **Upload** : Via Multer (middleware) → Cloudinary API
- **Stockage** : URL dans les tables `products`, `fabrics`, `garment_models`

---

## 9. Couches de sécurité

### 9.1 Vue d'ensemble de la sécurité

```
┌─────────────────────────────────────────────────────────────────┐
│                    COUCHE 1 : Réseau                            │
│  ┌─────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ HTTPS   │  │ Helmet (headers) │  │ CORS (FRONTEND_URL)   │  │
│  │ (TLS)   │  │ CSP, X-Frame,    │  │ Origines autorisées   │  │
│  │         │  │ HSTS, etc.       │  │ uniquement             │  │
│  └─────────┘  └──────────────────┘  └───────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    COUCHE 2 : Rate Limiting                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 6 profils de limitation par IP :                          │  │
│  │  • Global     : ~100 req/15min (toutes routes)            │  │
│  │  • Auth       : ~10 req/15min (login, register)           │  │
│  │  • API        : ~60 req/15min (endpoints classiques)      │  │
│  │  • Upload     : ~5 req/15min (upload images)              │  │
│  │  • Webhook    : ~30 req/min (Stripe callbacks)            │  │
│  │  • Admin      : ~30 req/15min (admin endpoints)           │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    COUCHE 3 : Authentification                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  JWT stocké en cookie httpOnly + Secure + SameSite        │  │
│  │  • Pas d'accès JavaScript au token (XSS-proof)            │  │
│  │  • bcrypt pour le hashing des mots de passe               │  │
│  │  • Guest checkout (token éphémère)                        │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    COUCHE 4 : Autorisation                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • requireRole('admin', 'ops', ...)                       │  │
│  │  • requireAdmin (raccourci admin-only)                    │  │
│  │  • Vérification propriétaire (user_id sur les ressources) │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    COUCHE 5 : Validation                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  • Validation des entrées (body, params, query)           │  │
│  │  • Requêtes paramétrées ($1, $2) — anti SQL injection     │  │
│  │  • Sanitisation des données utilisateur                   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Flux d'authentification

```
┌────────┐  POST /auth/login     ┌──────────┐
│ Client │ ────────────────────► │  Auth    │
│        │  { email, password }  │  Route   │
└────────┘                       └────┬─────┘
                                      │
                              bcrypt.compare()
                                      │
                                      ▼
                              ┌──────────────┐
                              │ JWT signé    │
                              │ (user.id,    │
                              │  user.role)  │
                              └──────┬───────┘
                                     │
                              Set-Cookie:
                              token=xxx;
                              HttpOnly;
                              Secure;
                              SameSite=Strict
                                     │
                                     ▼
┌────────┐  Cookie auto-envoyé  ┌──────────┐
│ Client │ ◄───────────────────  │ Réponse  │
│        │                       │  200 OK  │
└────────┘                       └──────────┘
```

### 9.3 Audit de sécurité

L'application a subi un audit complet avec :
- **~32 problèmes critiques** identifiés et corrigés
- **~21 problèmes importants** identifiés et corrigés
- **~5 problèmes mineurs** restants (non bloquants)
- Détails dans `docs/audit/`

---

## 10. Système Coffre-fort

Le coffre-fort est un système d'**analyse d'impact automatique** qui protège le projet contre les régressions involontaires.

### Architecture du coffre-fort

```
┌──────────────────────────────────────────────────────────────┐
│                    COFFRE-FORT SYSTEM                         │
│                                                              │
│  ┌────────────────────┐     ┌────────────────────────────┐  │
│  │ impact-config.json │────►│   impact-check.js          │  │
│  │ (règles + graphe   │     │   (~500 lignes, 0 deps)    │  │
│  │  de dépendances)   │     │   Moteur d'analyse         │  │
│  └────────────────────┘     └─────────┬──────────────────┘  │
│                                       │                      │
│              ┌────────────────────────┼──────────────┐       │
│              ▼                        ▼              ▼       │
│  ┌────────────────────┐  ┌──────────────────┐  ┌─────────┐  │
│  │ impact-check.yml   │  │auto-cartography  │  │setup-   │  │
│  │ (PR → analyse      │  │      .yml        │  │hooks.sh │  │
│  │  automatique)      │  │(merge → mise à   │  │(local   │  │
│  └────────────────────┘  │ jour carto)      │  │pre-push)│  │
│                          └──────────────────┘  └─────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              docs/IMPACT_SYSTEM.md                      │  │
│  │              (documentation complète)                   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Flux CI/CD

```
Développeur
    │
    ├── git push (branche feature)
    │   └── setup-hooks.sh → pre-push local (analyse rapide)
    │
    ├── Pull Request ouverte
    │   └── impact-check.yml
    │       ├── Analyse des fichiers modifiés
    │       ├── Calcul de l'impact (via impact-config.json)
    │       ├── Génération rapport dans la PR
    │       └── ⚠️ Alerte si fichier critique touché
    │
    └── Merge dans main
        └── auto-cartography.yml
            └── Mise à jour automatique de CARTOGRAPHY_360.md
```

---

## 11. Performance et optimisation

### Stratégies en place

| Aspect | Approche |
|---|---|
| **Requêtes DB** | Requêtes paramétrées, index sur les colonnes FK |
| **Pool de connexions** | `pg.Pool` avec gestion automatique |
| **Transactions** | Utilisées pour les opérations multi-tables (commandes) |
| **Upload** | Multer avec limites de taille, Cloudinary pour le CDN |
| **Rate limiting** | 6 profils pour protéger contre l'abus |
| **Async** | Notifications SMS/email envoyées de manière non bloquante |
| **Health check** | Endpoint `/health` pour le monitoring Railway |

### Points de vigilance

- **Pas de cache applicatif** : Chaque requête interroge la DB (acceptable pour le volume actuel)
- **Pas de queue** : Les notifications sont envoyées inline (OK pour les volumes comoriens)
- **Pas de CDN pour l'API** : Cloudinary sert de CDN pour les images uniquement

---

## 12. Scalabilité

### Architecture actuelle (Monolithe modulaire)

Le monolithe modulaire est adapté au marché comorien actuel :
- Population : ~900 000 habitants
- Diaspora cible : ~300 000 personnes
- Volume estimé : quelques centaines de commandes/jour max

### Évolution possible vers microservices

Si le volume augmente significativement, les domaines suivants sont les plus facilement extractibles :

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Service Auth    │     │ Service Orders   │     │ Service Payments │
│  (users, JWT)    │     │ (orders, items)  │     │ (Stripe, cash)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Service Notify  │     │ Service Logistics│     │ Service Catalog  │
│  (SMS, email,    │     │ (scans, ship.)   │     │ (products, stock)│
│   WhatsApp)      │     │                  │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### Recommandations de scaling

| Phase | Action | Trigger |
|---|---|---|
| **Court terme** | Optimiser les requêtes SQL, ajouter des index | > 100 req/s |
| **Moyen terme** | Ajouter Redis (cache, sessions, queues) | > 500 req/s |
| **Long terme** | Séparer en microservices (Notify, Payments en premier) | > 2000 req/s |
| **Infra** | Répliques PostgreSQL en lecture | Latence DB > 100ms |

---

## Annexes

### Variables d'environnement clés

| Variable | Usage |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL |
| `JWT_SECRET` | Signature des tokens |
| `QR_SECRET` | Signature des QR codes |
| `STRIPE_SECRET_KEY` | API Stripe |
| `STRIPE_WEBHOOK_SECRET` | Vérification webhooks |
| `AT_API_KEY` | Africa's Talking SMS |
| `CLOUDINARY_*` | Upload images |
| `RATE_EUR_KMF` | Taux de change par défaut |
| `FRONTEND_URL` | CORS origin autorisée |

### Références

- [CARTOGRAPHY_360.md](./CARTOGRAPHY_360.md) — Cartographie complète 360°
- [IMPACT_SYSTEM.md](./IMPACT_SYSTEM.md) — Documentation coffre-fort
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Guide de déploiement
- [README.md](../README.md) — Vue d'ensemble du projet

---

> 📝 *Document généré le 05/04/2026 — Komerce Backend v9.3*
