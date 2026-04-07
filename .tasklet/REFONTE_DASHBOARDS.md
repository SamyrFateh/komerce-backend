# REFONTE DASHBOARDS KOMERCE — Philosophie Parcel-Centric

> Généré le 7 avril 2026 — Audit de 16 fichiers frontend `public/`

---

## ⛔ VERROUS ABSOLUS — À respecter AVANT et PENDANT toute exécution

### 🔴 VERROU 1 — HUB = IDIOT-PROOF (zéro contexte commande)

L'opérateur hub ne doit **JAMAIS** voir :

| Interdit | Pourquoi |
|----------|----------|
| ❌ La commande complète | L'opérateur n'a pas besoin de savoir ce que le client a commandé |
| ❌ Le nombre total d'articles attendus | Ça pousse l'opérateur à "compléter" → erreur terrain |
| ❌ Une notion de "reste à scanner" | Ça casse le modèle asynchrone / partiel |
| ❌ Une progression de type "3/5 articles" | Idem — implique qu'il y a un total à atteindre |
| ❌ Le statut de la commande | Le hub ne gère pas les commandes |

**Ce que l'opérateur voit :**
- L'article qu'il vient de scanner ✓
- La liste des articles **déjà scannés** dans le colis courant
- La référence du colis draft
- Le bouton SCELLER (quand il a fini)
- Ses stats session (articles scannés, colis scellés)

**Philosophie :** L'opérateur scanne ce qui est devant lui. Point. Il ne sait pas combien il en reste, il ne sait pas si la commande est "complète". Le système s'en occupe via `parcelSync.js`.

### 🔴 VERROU 2 — PIPELINE = ZÉRO LOGIQUE COMMANDE

Une carte pipeline ne doit **JAMAIS** dépendre du statut de la commande.

| Interdit | Pourquoi |
|----------|----------|
| ❌ "Commande en attente" | C'est un statut commande, pas colis |
| ❌ "Commande incomplète" | Idem |
| ❌ "En attente de paiement" | Le colis ne sait pas si on l'a payé |
| ❌ Toute colonne basée sur `orders.status` | Le pipeline est logistique, pas commercial |
| ❌ Couleur/badge basé sur le statut commande | Pollution visuelle hors périmètre |

**Le pipeline est 100% driven par `parcels.status` :**
```
draft → preparation → shipped → in_transit → arrived → available → collected → cancelled
```

**La commande liée** peut apparaître comme contexte secondaire (petit, en gris, `#CMD-1234`) mais ne doit **jamais conditionner** l'affichage, le tri, le filtrage ou le positionnement d'une carte.

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
  - Liste articles DÉJÀ scannés (avec check ✓)
     ↓
[SCELLER LE COLIS] → gros bouton
     ↓
[COLIS SCELLÉ] → prêt pour shipment
```

| Zone UI | Contenu |
|---------|---------|
| **Header** | Logo + Opérateur connecté + Session stats (articles scannés, colis scellés aujourd'hui) |
| **Zone scan** | Input auto-focus + caméra QR. Gros. Central. |
| **Colis courant** | Carte principale : ref colis, type, articles dedans |
| **Articles scannés** | Liste simple : nom article, heure scan ✓ |
| **Action** | Bouton SCELLER (désactivé si 0 articles). Confirmation modale. |
| **Historique session** | Bas de page : colis scellés cette session (collapsible) |

**⛔ VERROU 1 appliqué — Ce qui NE doit PAS être là :**
- ❌ KPIs finance
- ❌ Pipeline commande
- ❌ Statut commande
- ❌ Décision de split/backorder
- ❌ Choix du transporteur
- ❌ **Nombre total d'articles attendus**
- ❌ **Notion de "reste à scanner"**
- ❌ **Progression de type "3/5 articles"**
- ❌ **Contenu de la commande complète**

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

**⛔ VERROU 2 appliqué — Chaque carte = 1 parcel, driven par `parcels.status` uniquement :**

| Info | Exemple |
|------|---------|
| Référence colis | `PCL-2026-0042` |
| Type | `standard` / `partial` / `backorder` / `awaiting_stock` |
| Commande liée | `#CMD-1234` *(contexte secondaire, petit, gris)* |
| Nb articles dans le colis | `3 articles` *(PAS "3/5")* |
| Transporteur | `Emirates Post` |
| Shipment | `SHP-0012` |
| Relais destination | `Relais Mutsamudu` |
| Âge | `3j` (badge rouge si > seuil SLA) |
| ETA | `12 avril` |

**Filtres :** Par type, par carrier, par relais destination, par âge, par shipment

**Actions :** Clic → détail colis (modale avec historique scans, timeline)

**⛔ VERROU 2 appliqué — Ce qui NE doit PAS être là :**
- ❌ Colonnes de statuts commande (Att. paiement, A acheter...)
- ❌ Détail paiement
- ❌ Info client
- ❌ **Toute donnée conditionnée par `orders.status`**
- ❌ **Couleur/badge/tri basé sur le statut commande**
- ❌ **Libellés "commande en attente", "commande incomplète"**

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

---

### D. `Komerce_Relais.html` — RELAIS

**Mission unique :** Réception colis, mise en disponibilité, remise client.

**Persona :** Agent relais (Anjouan)

**Device :** Mobile-first / Tactile

| Zone UI | Contenu |
|---------|---------|
| **Header** | Nom relais + Agent connecté + Stats (colis disponibles, remis aujourd'hui) |
| **Scan réception** | Input/QR : scanner colis arrivé → marquer `available` |
| **Colis disponibles** | Liste : ref colis, pickup code (gros), client, nb colis liés commande, ancienneté |
| **Remise client** | Scan pickup code → confirmation → marquer `collected` |
| **Historique** | Colis remis aujourd'hui (collapsible) |

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

### F–H. Fichiers à conserver tels quels

- `Komerce_Config.html` — Paramétrage règles métier (ajouts : seuils SLA, config types colis)
- `Komerce_Tests.html` — Tests E2E (ajouts : tests workflow parcel, tests safety)
- `Komerce_Simulateur.html` — Simulateur tarification (aucun changement)

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

---

## PARTIE 3 — Recommandation fichier par fichier

| Fichier | Action | Raison |
|---------|--------|--------|
| `Komerce_Dashboard.html` | **REFONDRE** | Supprimer onglets Hub/Pipeline/Relais/Catalogue/Clients. Garder uniquement pilotage KPIs. |
| `Komerce_Hub.html` | **RECRÉER** | Vrai écran mobile-first scan→pack→seal. ⛔ VERROU 1 |
| `Komerce_Pipeline.html` | **RECRÉER** | Vrai kanban parcel-centric. ⛔ VERROU 2 |
| `Komerce_Relais.html` | **RECRÉER** | Vrai écran mobile-first réception/remise. |
| `Komerce_Admin.html` | **REFONDRE** | Garder sidebar. Absorber Admin_Users. Ajouter vue parcels. |
| `Komerce_Admin_Users.html` | **ABSORBER** | Fusionner dans Komerce_Admin.html. |
| `Komerce_Config.html` | **GARDER** | Ajouter seuils SLA et config types colis. |
| `Komerce_Tests.html` | **GARDER** | Ajouter tests workflow parcel. |
| `Komerce_Simulateur.html` | **GARDER** | Aucun changement. |
| `Komerce_Backend.html` | **SUPPRIMER** | Monolithe 512KB redistribué. |
| `Komerce_Backoffice_Admin_v2.html` | **SUPPRIMER** | Doublon de Admin. |
| `Komerce_Web.html` | **SUPPRIMER** | Doublon de index.html. |
| `Komerce_Pilotage_v2.html` | **SUPPRIMER** | Redirect obsolète. |
| `index.html` | **GARDER** | Storefront client. |
| `Komerce_Mobile.html` | **GARDER** | PWA Anjouan. |
| `portal.html` | **ADAPTER** | Tuiles + filtrage par rôle. |
| `komerce-api.js` | **CRÉER** | Couche API unifiée pour tous les écrans. |

---

## PARTIE 4 — Couche API unifiée

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
};
```

---

## PARTIE 5 — Ordre d'exécution

1. `komerce-api.js` — couche API unifiée (base pour tout)
2. `Komerce_Hub.html` — écran terrain prioritaire ⛔ VERROU 1
3. `Komerce_Pipeline.html` — suivi logistique ⛔ VERROU 2
4. `Komerce_Relais.html` — écran agent relais
5. `Komerce_Dashboard.html` — refonte pilotage
6. `Komerce_Admin.html` — refonte admin + absorption Users
7. `portal.html` — adaptation tuiles et rôles
8. Suppression des fichiers obsolètes

---

## Principes UX

- Un écran = une mission
- Mobile-first pour Hub et Relais
- Desktop propre pour Pilotage et Admin
- Le parcel est l'unité logistique partout
- La commande n'apparaît que comme contexte secondaire dans les écrans logistiques
- Couleurs Komerce : ambré/doré (#d97706), fond clair, typographie DM Sans
- Stack : Vanilla JS, Chart.js, html5-qrcode, DM Sans + DM Serif Display

---

*Document mis à jour le 7 avril 2026 — Verrous 1 & 2 intégrés*
