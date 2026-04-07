# REFONTE DASHBOARDS KOMERCE — Philosophie Parcel-Centric

> Généré le 7 avril 2026 — Audit de 16 fichiers frontend `public/`

---

## PARTIE 1 — Diagnostic des écrans actuels

### 1.1 Inventaire

| Fichier | Taille | Rôle actuel | Verdict |
|---------|--------|-------------|---------|
| `Komerce_Backend.html` | 512 KB | Méga-app SPA : back-office + simulateur + agent relais + agent hub + pilotage + fidélité + clients. **191 fonctions, 25 tables, 8 onglets** | 🔴 À démanteler |
| `Komerce_Admin.html` | 121 KB | Panel admin complet : 15 écrans, pipeline order-centric | 🟠 À refondre |
| `Komerce_Tests.html` | 147 KB | Suite E2E : seed, runner, monitoring, pipeline sourcing | 🟡 À conserver (isoler) |
| `Komerce_Simulateur.html` | 106 KB | Simulateur tarification v7 : 6 étapes coût Dubai→Comores | 🟡 À conserver (autonome) |
| `Komerce_Dashboard.html` | 86 KB | Dashboard 9 onglets (overview, pipeline, hub, relais, finance, etc.) | 🟠 À refondre profondément |
| `Komerce_Web.html` | 81 KB | Boutique client (fork ancienne de index.html) | 🔴 À supprimer |
| `Komerce_Backoffice_Admin_v2.html` | 68 KB | Sous-ensemble de Admin.html (10 écrans vs 15) | 🔴 À supprimer |
| `Komerce_Mobile.html` | 54 KB | PWA Anjouan — client mobile | 🟡 À garder / simplifier |
| `Komerce_Config.html` | 34 KB | Éditeur règles métier (7 catégories) | ✅ Unique, à garder |
| `Komerce_Admin_Users.html` | 32 KB | CRUD utilisateurs | ✅ Unique, à garder |
| `portal.html` | 16 KB | Portail login + tuiles navigation | 🟡 À adapter |
| `Komerce_QR_Print.html` | 9 KB | Impression QR codes | ✅ Utilitaire, à garder |
| `index.html` | 144 KB | Boutique client (version évoluée de Web.html) | ✅ À garder comme storefront |
| `Komerce_Hub.html` | 254 B | Redirect → Dashboard.html#hub | 🔴 Redirect → à remplacer |
| `Komerce_Pipeline.html` | 263 B | Redirect → Dashboard.html#pipeline | 🔴 Redirect → à remplacer |
| `Komerce_Relais.html` | 257 B | Redirect → Dashboard.html#relais | 🔴 Redirect → à remplacer |
| `Komerce_Pilotage_v2.html` | 255 B | Redirect → Dashboard.html | 🔴 Redirect → à supprimer |

### 1.2 Incohérences majeures avec la philosophie parcel-centric

#### 🔴 1. Tout est centré commande

Le pipeline affiché partout est :
```
Att. paiement → A acheter → Colisage Dubai → En mer → Au relais
```

C'est un **pipeline de commande**, pas de colis. Un colis n'attend pas le paiement.
Le pipeline logistique devrait être :
```
draft → preparation → shipped → in_transit → arrived → available → collected
```

#### 🔴 2. Hub = onglet dans Dashboard

Le Hub Dubai est un simple onglet dans `Komerce_Dashboard.html`. Ce n'est pas un vrai écran opérateur :
- Pas mobile-first
- Mélangé avec les KPIs finance
- Pas de workflow scan → pack → seal isolé
- L'opérateur terrain voit des données de pilotage qu'il ne devrait pas voir

#### 🔴 3. Pipeline = colonnes de statuts commande

Le pipeline actuel affiche des **commandes** dans des colonnes. Il devrait afficher des **colis** avec leurs statuts logistiques propres.

#### 🔴 4. Backend.html = monolithe de 512 KB

Ce fichier contient **tout** : back-office, simulateur, agent relais, agent hub, pilotage, fidélité, clients. 191 fonctions. C'est impossible à maintenir et crée des duplications massives avec les autres fichiers.

#### 🔴 5. Duplications massives

| Cluster | Fichiers dupliqués | Problème |
|---------|-------------------|----------|
| Admin | Admin.html ≈ Backoffice_v2.html ≈ Backend.html (tab back-office) | 3 copies du même back-office |
| Simulateur | Simulateur.html ≈ Backend.html (tab simulateur) | 2 copies identiques |
| Storefront | Web.html ≈ index.html | Fork divergente (40 fonctions partagées) |
| Hub | Dashboard.html#hub ≈ Backend.html (tab Agent Hub) | 2 implémentations du hub |
| Relais | Dashboard.html#relais ≈ Backend.html (tab Agent Relais) | 2 implémentations du relais |

#### 🟠 6. API helpers incohérents

Chaque fichier a son propre helper API :
- `fetchApi()` dans Dashboard
- `apiFetch()` + `api()` dans Admin
- `apiGet()` + `apiPost()` dans index/Web

Pas de couche API partagée.

#### 🟠 7. Pas de séparation rôle/mission

L'opérateur hub, le gestionnaire relais, le dirigeant et l'admin accèdent tous aux mêmes fichiers. Aucune restriction par rôle au niveau UI.

---

## PARTIE 2 — Nouvelle cartographie UI

### 2.1 Architecture cible : 8 écrans, 1 mission chacun

```
┌─────────────────────────────────────────────────────────┐
│                    portal.html                          │
│               (Login + Navigation rôle)                 │
├──────────┬──────────┬──────────┬──────────┬────────────┤
│ PILOTAGE │   HUB    │ PIPELINE │  RELAIS  │   ADMIN    │
│ Dirigeant│ Opérateur│ Logistic.│ Agent    │ Super-admin│
│ Desktop  │ Mobile   │ Desktop  │ Mobile   │ Desktop    │
├──────────┴──────────┴──────────┴──────────┴────────────┤
│ CONFIG    │  TESTS   │ SIMULATEUR │ STOREFRONT          │
│ Règles   │  QA      │  Pricing   │ Client (index.html) │
└──────────┴──────────┴────────────┴─────────────────────┘
```

### 2.2 Détail par écran

---

### A. `Komerce_Dashboard.html` — PILOTAGE

**Mission unique :** Vue dirigeant / supervision globale. Pas d'action opérationnelle.

**Persona :** CEO / COO / Directeur logistique

**Device :** Desktop (tablette OK)

| Section | Contenu |
|---------|---------|
| **KPIs Header** | Commandes aujourd'hui, Revenue jour/semaine, Cash pending, Parcels en mouvement |
| **Vue Parcels** | Répartition par statut (draft / preparation / shipped / in_transit / arrived / available / collected) — barres ou donuts |
| **Commandes agrégées** | Commandes partiellement servies, commandes complètes, taux de complétion |
| **SLA & Alertes** | Colis retardés (> X jours), colis bloqués, incidents scan, anomalies |
| **Finance** | CA jour/semaine/mois (KMF + EUR), marge, fret en cours, taux de change |
| **Tendances** | Courbe volumes commandes/parcels sur 30j |

**Ce qui disparaît :** Onglets Hub, Pipeline, Relais, Catalogue, Clients (déplacés vers leurs propres écrans)

**Données clés :**
- `GET /api/parcels/stats` → répartition par statut
- `GET /api/orders/stats` → KPIs commandes agrégées
- `GET /api/pilotage` → SLA, alertes, tendances

---

### B. `Komerce_Hub.html` — HUB DUBAI

**Mission unique :** Écran opérateur terrain. Scan → Pack → Seal. Rien d'autre.

**Persona :** Opérateur hub Dubai

**Device :** Mobile-first / Tactile / Grand écran entrepôt

**Workflow strict :**

```
[SCAN ARTICLE] → auto-affectation colis draft
     ↓
[COLIS EN COURS]
  - Référence colis
  - Liste articles scannés (avec check ✓)
  - Nombre articles / total attendu
     ↓
[SCELLER LE COLIS] → gros bouton
     ↓
[COLIS SCELLÉ] → prêt pour shipment
```

| Zone UI | Contenu |
|---------|---------|
| **Header** | Logo + Opérateur connecté + Session stats (articles scannés, colis scellés aujourd'hui) |
| **Zone scan** | Input auto-focus + caméra QR. Gros. Central. |
| **Colis courant** | Carte principale : ref colis, type, articles dedans, progression |
| **Articles scannés** | Liste simple : nom article, commande liée (petit), heure scan |
| **Action** | Bouton SCELLER (désactivé si 0 articles). Confirmation modale. |
| **Historique session** | Bas de page : colis scellés cette session (collapsible) |

**Ce qui NE doit PAS être là :**
- ❌ KPIs finance
- ❌ Pipeline commande
- ❌ Statut commande
- ❌ Décision de split/backorder
- ❌ Choix du transporteur

**API :**
- `POST /api/scans/hub/scan-item` → scan article
- `GET /api/parcels?status=draft&hub=current` → colis ouvert
- `POST /api/scans/hub/pack` → pack
- `POST /api/scans/hub/seal` → sceller

---

### C. `Komerce_Pipeline.html` — PIPELINE LOGISTIQUE

**Mission unique :** Suivi visuel des colis dans le flux logistique. Kanban parcel-centric.

**Persona :** Responsable logistique / Coordinateur

**Device :** Desktop (grand écran)

**Colonnes Kanban :**

```
| draft | preparation | shipped | in_transit | arrived | available | collected | cancelled |
```

**Chaque carte = 1 parcel :**

| Info | Exemple |
|------|---------|
| Référence colis | `PCL-2026-0042` |
| Type | `standard` / `partial` / `backorder` / `awaiting_stock` |
| Commande liée | `#CMD-1234` (contexte secondaire, petit) |
| Nb articles | `3/5 articles` |
| Transporteur | `Emirates Post` |
| Shipment | `SHP-0012` |
| Relais destination | `Relais Mutsamudu` |
| Âge | `3j` (badge rouge si > seuil SLA) |
| ETA | `12 avril` |

**Filtres :** Par type, par carrier, par relais destination, par âge, par shipment

**Actions :** Clic → détail colis (modale avec historique scans, timeline)

**Ce qui NE doit PAS être là :**
- ❌ Colonnes de statuts commande (Att. paiement, A acheter...)
- ❌ Détail paiement
- ❌ Info client

---

### D. `Komerce_Relais.html` — RELAIS

**Mission unique :** Réception colis, mise en disponibilité, remise client.

**Persona :** Agent relais (Anjouan)

**Device :** Mobile-first / Tactile

| Zone UI | Contenu |
|---------|---------|
| **Header** | Nom relais + Agent connecté + Stats (colis disponibles, remis aujourd'hui) |
| **Scan réception** | Input/QR : scanner colis arrivé → marquer `available` |
| **Colis disponibles** | Liste : ref colis, pickup code, client, nb colis liés commande, ancienneté |
| **Remise client** | Scan pickup code → confirmation → marquer `collected` |
| **Historique** | Colis remis aujourd'hui (collapsible) |

**Info affichée par colis :**
- Référence colis
- Pickup code (gros, lisible)
- Client / destinataire
- Nombre de colis total pour cette commande (ex: "Colis 2/3")
- Ancienneté au relais (badge rouge si > 7j)
- Bouton REMETTRE

---

### E. `Komerce_Admin.html` — ADMINISTRATION

**Mission unique :** Gestion back-office complète. Données, CRUD, supervision.

**Persona :** Admin / Super-admin

**Device :** Desktop

| Section | Contenu |
|---------|---------|
| **Commandes** | Liste commandes, détail, historique statuts (vue commerciale) |
| **Logistique** | Shipments, cargos, conteneurs (vue logistique agrégée) |
| **Litiges** | Réclamations, remboursements, suivi SAV |
| **Produits** | Catalogue, stock, fournisseurs |
| **Comptabilité** | Export, flux devises, récap financier |
| **Utilisateurs** | (absorbe Admin_Users.html) CRUD users, rôles |
| **Agents** | Gestion agents relais/hub |
| **Modules** | Cérémonie, fidélité |

**Ce qui change :**
- Le pipeline commande reste ici (vue commerciale = normal)
- Ajout d'une vue parcels dans la section Logistique
- Suppression de tout ce qui est opérationnel terrain (ça va dans Hub/Relais)

---

### F. `Komerce_Config.html` — CONFIGURATION

**Mission unique :** Paramétrage des règles métier.

**Aucun changement majeur.** Fichier unique, bien structuré.

Ajouts possibles :
- Seuils SLA (jours max par statut parcel)
- Règles de draft auto (quand créer un nouveau colis vs ajouter à l'existant)
- Configuration types de colis

---

### G. `Komerce_Tests.html` — TESTS / QA

**Mission unique :** Tests E2E, seed données, monitoring debug.

**Aucun changement majeur.** Isolé par nature.

Ajouts possibles :
- Tests du workflow parcel (scan → pack → seal)
- Tests des contraintes safety (unique item, one draft per order)
- Simulation race conditions

---

### H. `Komerce_Simulateur.html` — SIMULATEUR TARIFICATION

**Mission unique :** Calcul de coûts supply chain Dubai → Comores.

**Aucun changement majeur.** Bien isolé, standalone.

---

### 2.3 Navigation cible

```
portal.html (login + rôle)
  ├── admin    → Komerce_Admin.html
  ├── hub      → Komerce_Hub.html
  ├── logistic → Komerce_Pipeline.html
  ├── relais   → Komerce_Relais.html
  ├── ceo      → Komerce_Dashboard.html
  ├── config   → Komerce_Config.html
  ├── pricing  → Komerce_Simulateur.html
  ├── tests    → Komerce_Tests.html
  └── shop     → index.html
```

Chaque rôle voit uniquement ses tuiles dans le portail.

---

## PARTIE 3 — Recommandation fichier par fichier

| Fichier | Action | Raison |
|---------|--------|--------|
| `Komerce_Dashboard.html` | **REFONDRE** | Supprimer onglets Hub/Pipeline/Relais/Catalogue/Clients. Garder uniquement pilotage KPIs. Remplacer pipeline commande par répartition parcels par statut. |
| `Komerce_Hub.html` | **RECRÉER** | Actuellement = redirect. Créer un vrai écran mobile-first scan→pack→seal. |
| `Komerce_Pipeline.html` | **RECRÉER** | Actuellement = redirect. Créer un vrai kanban parcel-centric (8 colonnes de statuts). |
| `Komerce_Relais.html` | **RECRÉER** | Actuellement = redirect. Créer un vrai écran mobile-first réception/remise. |
| `Komerce_Admin.html` | **REFONDRE** | Garder la structure sidebar. Absorber Admin_Users. Ajouter vue parcels dans Logistique. Retirer tout ce qui est opérationnel terrain. |
| `Komerce_Admin_Users.html` | **ABSORBER** | Fusionner dans Komerce_Admin.html comme section "Utilisateurs". |
| `Komerce_Config.html` | **GARDER** | Ajouter seuils SLA et config types colis. |
| `Komerce_Tests.html` | **GARDER** | Ajouter tests workflow parcel. |
| `Komerce_Simulateur.html` | **GARDER** | Aucun changement nécessaire. |
| `Komerce_Backend.html` | **SUPPRIMER** | Monolithe 512KB. Son contenu est redistribué dans les écrans dédiés. |
| `Komerce_Backoffice_Admin_v2.html` | **SUPPRIMER** | Sous-ensemble de Admin.html. Doublon. |
| `Komerce_Web.html` | **SUPPRIMER** | Fork ancienne de index.html. Doublon. |
| `Komerce_Pilotage_v2.html` | **SUPPRIMER** | Redirect inutile. |
| `index.html` | **GARDER** | Storefront client. Pas impacté par la refonte back-office. |
| `Komerce_Mobile.html` | **GARDER** | PWA Anjouan client. Pas impacté. |
| `portal.html` | **ADAPTER** | Mettre à jour les tuiles pour pointer vers les nouveaux écrans. Filtrer par rôle. |
| `Komerce_QR_Print.html` | **GARDER** | Utilitaire impression QR. |
| `komerce-api.js` | **REFONDRE** | Créer une couche API unifiée utilisée par tous les écrans. Un seul helper, un seul pattern. |

### Résumé des actions

| Action | Nombre | Fichiers |
|--------|--------|----------|
| ✅ Garder tel quel | 5 | Config, Tests, Simulateur, index, Mobile, QR_Print |
| 🟠 Refondre | 3 | Dashboard, Admin, komerce-api.js |
| 🆕 Recréer | 3 | Hub, Pipeline, Relais |
| 🔀 Absorber | 1 | Admin_Users → Admin |
| 🔄 Adapter | 1 | portal.html |
| 🔴 Supprimer | 4 | Backend, Backoffice_v2, Web, Pilotage_v2 |

---

## PARTIE 4 — Prompt de refonte exécutable

### Prompt à donner à un agent code/UI

---

```
# PROMPT — Construction des dashboards Komerce Parcel-Centric

## Contexte

Tu travailles sur le repo `SamyrFateh/komerce-backend`.
Le backend est Node.js / Express / PostgreSQL, déployé sur Railway.
Les fichiers frontend sont dans `public/`.

Le système Komerce est parcel-centric :
- `order` = vue commerciale (paiement, client)
- `parcel` = unité logistique réelle (le colis physique)
- `scan` = événement terrain (preuve)
- `shipment` = transport de parcels
- `orders.status` = calculé par `utils/parcelSync.js`, jamais écrit directement

## Règle d'or

> La commande vend. Le colis voyage. Le scan prouve. Le système calcule.

## API existantes

Backend routes :
- `routes/hub.js` → POST scan-item, pack, seal (avec FOR UPDATE + transactions)
- `routes/parcels.js` → CRUD parcels + parcel_items
- `routes/scans.js` → Scan logistique
- `routes/logistics.js` → Shipments, conteneurs
- `routes/carriers.js` → Transporteurs
- `middleware/auth.js` → JWT authenticate + requireRole
- `utils/parcelSync.js` → Synchronisation statuts parcels → orders

Tables clés :
- `parcels` (id, order_id, status, type, sealed_at, tracking_number, relay_id, pickup_code, ...)
- `parcel_items` (id, parcel_id, order_item_id, quantity, scanned_at, scanned_by)
- `scans` (id, parcel_id, type, scanned_by, ...)
- `orders` (id, status, ...)
- `shipments`, `carriers`, `relay_points`

Statuts parcel : draft, preparation, shipped, in_transit, arrived, available, collected, cancelled
Types parcel : standard, partial, backorder, awaiting_stock

## Fichiers à créer / refondre

### 1. `Komerce_Hub.html` — ÉCRAN HUB OPÉRATEUR

Remplacer le redirect actuel par un vrai écran autonome.

Spécifications :
- Mobile-first, tactile, gros boutons, peu de texte
- Login opérateur (JWT)
- Zone scan principale : input auto-focus + bouton caméra QR
- Appel `POST /api/scans/hub/scan-item` avec { barcode, scanned_by }
- Affichage du colis draft en cours (ref, articles dedans, progression)
- Liste articles scannés dans le colis courant
- Bouton SCELLER (appel POST /api/scans/hub/seal)
- Stats session : articles scannés, colis scellés
- PAS de KPIs finance, PAS de pipeline commande, PAS de choix transporteur
- Couleurs : ambré/doré Komerce
- Responsive : fonctionne sur mobile ET grand écran entrepôt

### 2. `Komerce_Pipeline.html` — PIPELINE LOGISTIQUE PARCEL-CENTRIC

Remplacer le redirect actuel par un vrai kanban.

Spécifications :
- Desktop-first, grand écran
- 8 colonnes : draft | preparation | shipped | in_transit | arrived | available | collected | cancelled
- Chaque carte = 1 parcel avec : ref colis, type (badge), commande liée (petit), nb articles, carrier, shipment, relais destination, âge (badge rouge si retard), ETA
- Données : `GET /api/parcels` (tous les parcels avec filtres)
- Filtres : par type, carrier, relais, shipment, âge
- Clic carte → modale détail : timeline scans, articles, historique statuts
- Scroll horizontal smooth entre colonnes
- Compteur par colonne
- Auto-refresh toutes les 30s
- PAS de colonnes de statuts commande

### 3. `Komerce_Relais.html` — ÉCRAN RELAIS

Remplacer le redirect actuel par un vrai écran opérationnel.

Spécifications :
- Mobile-first, tactile
- Login agent relais (JWT)
- Zone scan réception : scanner colis arrivé → marquer `available`
- Liste colis disponibles : ref, pickup code (gros), client, nb colis commande, ancienneté
- Zone remise : scan/saisie pickup code → confirmation → marquer `collected`
- Badge rouge si ancienneté > 7 jours
- Stats : colis disponibles, remis aujourd'hui
- PAS de gestion commande, PAS de finance

### 4. `Komerce_Dashboard.html` — PILOTAGE (REFONTE)

Garder le fichier, supprimer les onglets Hub/Pipeline/Relais/Catalogue/Clients.

Spécifications :
- Desktop, vue dirigeant
- KPIs header : commandes jour, revenue, cash pending, parcels en mouvement
- Répartition parcels par statut (barres horizontales ou donut)
- Commandes agrégées : partiellement servies, complètes, taux complétion
- Alertes : colis retardés, bloqués, incidents scan
- Finance : CA, marge, fret, taux de change
- Tendances : courbe 30j commandes + parcels
- Auto-refresh 60s
- PAS d'onglets opérationnels (Hub, Pipeline, Relais)

### 5. `Komerce_Admin.html` — ADMIN (REFONTE)

Garder la structure sidebar, intégrer Admin_Users.

Spécifications :
- Sidebar sections : Tableau de bord, Commandes, Logistique (avec sous-section Parcels), Litiges, Produits, Utilisateurs (absorbe Admin_Users), Agents, Comptabilité, Pricing, Relais, Paramètres
- Section Logistique : ajouter tableau des parcels avec filtres par statut/type
- Section Commandes : garder vue commerciale (c'est légitime ici)
- Retirer tout workflow opérationnel terrain
- Absorber le CRUD utilisateurs de Admin_Users.html

### 6. `portal.html` — PORTAIL (ADAPTATION)

Mettre à jour les tuiles de navigation :
- Pilotage → /Komerce_Dashboard.html (rôle: ceo, admin)
- Hub Dubai → /Komerce_Hub.html (rôle: hub_operator, admin)
- Pipeline → /Komerce_Pipeline.html (rôle: logistics, admin)
- Relais → /Komerce_Relais.html (rôle: relay_agent, admin)
- Administration → /Komerce_Admin.html (rôle: admin)
- Configuration → /Komerce_Config.html (rôle: admin)
- Simulateur → /Komerce_Simulateur.html (rôle: admin, pricing)
- Tests → /Komerce_Tests.html (rôle: admin, dev)
- Boutique → /index.html (public)

Filtrer les tuiles visibles selon le rôle de l'utilisateur connecté.

### 7. `komerce-api.js` — COUCHE API UNIFIÉE (REFONTE)

Créer un module API partagé importé par tous les écrans.

```js
// komerce-api.js — API unifiée
const API = {
  base: window.KOMERCE_API || '',
  token: null,

  async request(method, path, body) { ... },
  async get(path) { ... },
  async post(path, body) { ... },
  async put(path, body) { ... },
  async del(path) { ... },

  // Raccourcis métier
  parcels: {
    list(filters) { return API.get('/api/parcels?' + new URLSearchParams(filters)); },
    get(id) { return API.get(`/api/parcels/${id}`); },
    stats() { return API.get('/api/parcels/stats'); },
  },
  hub: {
    scanItem(barcode, by) { return API.post('/api/scans/hub/scan-item', { barcode, scanned_by: by }); },
    pack(parcelId) { return API.post('/api/scans/hub/pack', { parcel_id: parcelId }); },
    seal(parcelId) { return API.post('/api/scans/hub/seal', { parcel_id: parcelId }); },
  },
  orders: {
    list(filters) { return API.get('/api/orders?' + new URLSearchParams(filters)); },
    stats() { return API.get('/api/orders/stats'); },
  },
  // etc.
};
```

## Fichiers à supprimer

- `Komerce_Backend.html` → remplacé par les écrans dédiés
- `Komerce_Backoffice_Admin_v2.html` → doublon de Admin
- `Komerce_Web.html` → doublon de index.html
- `Komerce_Pilotage_v2.html` → redirect obsolète
- `Komerce_Admin_Users.html` → absorbé dans Admin

## Principes UX

- Un écran = une mission
- Mobile-first pour Hub et Relais
- Desktop propre pour Pilotage et Admin
- Moins de jargon technique, plus de visuel opérationnel
- Pas de surcharge en badges inutiles
- Le parcel est l'unité logistique partout
- La commande n'apparaît que comme contexte secondaire dans les écrans logistiques
- Couleurs Komerce : ambré/doré (#d97706), fond clair, typographie DM Sans

## Stack technique

- Vanilla JS (pas de framework)
- Chart.js pour les graphiques
- html5-qrcode pour le scan QR
- DM Sans + DM Serif Display (Google Fonts)
- CSS custom properties (design tokens déjà en place dans portal.html)

## Ordre d'exécution recommandé

1. `komerce-api.js` — couche API unifiée (base pour tout)
2. `Komerce_Hub.html` — écran terrain prioritaire
3. `Komerce_Pipeline.html` — suivi logistique
4. `Komerce_Relais.html` — écran agent relais
5. `Komerce_Dashboard.html` — refonte pilotage
6. `Komerce_Admin.html` — refonte admin + absorption Users
7. `portal.html` — adaptation tuiles et rôles
8. Suppression des fichiers obsolètes
```

---

*Document généré par Tasklet — 7 avril 2026*
