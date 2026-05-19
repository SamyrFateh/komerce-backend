# 🗼 Tour de Contrôle — Dashboards Komerce

> v1.0 — 10 avril 2026
> Statut : **SPEC ACTIVE** — tout dashboard doit s'y conformer

---

## Philosophie

Chaque écran Komerce existe pour **une seule raison** : aider une personne à prendre sa prochaine décision ou exécuter sa prochaine action. Rien de plus.

---

## 10 Lois

| # | Loi | Conséquence |
|---|-----|-------------|
| 1 | Chaque dashboard est recréé from scratch | Aucun copier-coller depuis les fichiers legacy |
| 2 | Aucun composant legacy repris sans justification métier | Le style visuel est conservé, pas le code |
| 3 | Un dashboard = une mission principale | Si tu ne peux pas la dire en 1 phrase, c'est 2 dashboards |
| 4 | Une source de données dominante par dashboard | Les joins sont tolérés, pas les mélanges de responsabilité |
| 5 | Pas plus de 5 blocs majeurs par écran | Au-delà = scission obligatoire |
| 6 | Pas de graphiques décoratifs | Un graph sans action associée = supprimé |
| 7 | Toute information affichée doit justifier une décision ou une action | Sinon elle dégage |
| 8 | Les listes prioritaires passent avant les analytics | Ce qui bloque > ce qui informe |
| 9 | Recherche rapide obligatoire sur les écrans opérationnels | Par référence, téléphone, nom |
| 10 | Les KPI transporteur viennent des `parcel_events`, pas des statuts business | Statuts ≠ événements — 2 vérités, 2 sources |

---

## Inventaire existant → Décisions

| Fichier | Taille | Verdict | Raison |
|---------|--------|---------|--------|
| `Komerce_Backend.html` | 512 KB | 🔴 **SUPPRIMER** | Monolithe legacy, aucune mission claire |
| `Komerce_Dashboard.html` | 42 KB | 🔴 **SUPPRIMER** | Remplacé par Admin v2 |
| `Komerce_Pilotage.html` | 0.3 KB | 🔴 **SUPPRIMER** | Placeholder vide |
| `Komerce_Pilotage_v2.html` | 0.3 KB | 🔴 **SUPPRIMER** | Placeholder vide |
| `Komerce_Simulateur.html` | 106 KB | 🟡 **GELER** | Utile mais hors scope opérationnel — pas prioritaire |
| `Komerce_Admin.html` | 145 KB | 🟠 **RÉÉCRIRE** | Mission valide, code legacy |
| `Komerce_Pipeline.html` | 35 KB | 🟠 **RÉÉCRIRE** | Mission valide, statuts à aligner |
| `Komerce_Hub.html` | 29 KB | 🟠 **RÉÉCRIRE** | Mission valide |
| `Komerce_Relais.html` | 32 KB | 🟠 **RÉÉCRIRE** | Mission valide |
| `Komerce_Boutique.html` | 189 KB | 🟠 **RÉÉCRIRE** | Mission valide, monolithe inline |
| `portal.html` | 15 KB | 🟢 **GARDER** | Point d'entrée — juste mettre à jour les liens |

**Résultat : 5 dashboards opérationnels + 1 portail + 1 simulateur gelé.**

---

## Les 5 Dashboards

---

### 1. 🛒 Boutique (`Komerce_Boutique.html`)

**Mission** : Le client trouve son produit, commande et suit sa livraison.

**Source dominante** : `products` (catalogue) + `orders` (mes commandes)

**Rôle** : `client` (authentifié ou visiteur)

| Bloc | Contenu | Action déclenchée |
|------|---------|-------------------|
| **B1 — Catalogue** | Grille produits par catégorie, recherche, filtres | Ajouter au panier |
| **B2 — Panier** | Récap items, quantités, prix, choix relais | Passer commande |
| **B3 — Checkout** | Paiement (wallet / cash relais), adresse, validation | Confirmer |
| **B4 — Mes commandes** | Liste mes commandes, statut simplifié, référence | Voir détail / annuler |
| **B5 — Suivi commande** | Timeline visuelle : commandé → en route → disponible → récupéré | Rien — information pure |

**Statuts affichés** (mapping business → label client) :

| `orders.status` | Label client | Icône |
|-----------------|-------------|-------|
| `confirmed` | Commande reçue | 📋 |
| `ordered` | Paiement confirmé | ✅ |
| `preparation` | En préparation | 📦 |
| `shipped` | Expédié | 🚀 |
| `in_transit` | En transit | ✈️ |
| `available` | Disponible au relais | 📍 |
| `collected` | Récupéré | 🎉 |
| `cancelled` | Annulée | ❌ |
| `refunded` | Remboursée | 💰 |

**Recherche** : par référence commande (barre flottante)

**Ce qu'on NE montre PAS au client** :
- `pickup_code` (uniquement au moment du retrait)
- Détails colis / `parcel_events`
- `scan_step` / données logistiques
- Wallet d'un autre client
- Prix d'achat / marges

---

### 2. 📊 Admin (`Komerce_Admin.html`)

**Mission** : L'admin pilote le business — il voit ce qui bloque et décide quoi débloquer.

**Source dominante** : `orders` (statuts business)

**Rôle** : `admin`

| Bloc | Contenu | Action déclenchée |
|------|---------|-------------------|
| **A1 — File d'attente** | Commandes en attente d'action admin (`confirmed` non payées, `ordered` non préparées) | Confirmer paiement cash / passer en préparation |
| **A2 — Alertes & blocages** | Commandes bloquées > 48h dans un statut, annulations en attente de remboursement | Intervenir / débloquer |
| **A3 — KPI décisionnels** | Aujourd'hui : nb commandes, CA, taux d'annulation, panier moyen | Piloter |
| **A4 — Recherche commande** | Par référence, téléphone, nom client | Voir détail complet → actions contextuelles |
| **A5 — Wallet admin** | Créditer wallet client, voir balance, historique lots | Créditer / investiguer |

**Ce qu'on NE met PAS dans Admin** :
- Graphiques de tendances (→ futur dashboard analytics dédié)
- Gestion des produits (→ futur back-office catalogue)
- Gestion des relais (→ futur back-office relais)
- Détails logistiques parcel_events (→ Hub)

**Pipeline visible ?** Non. L'admin a un lien vers Pipeline mais ne voit pas le kanban ici. Séparation des missions.

---

### 3. 🔄 Pipeline (`Komerce_Pipeline.html`)

**Mission** : Vue kanban temps réel du flux commandes — détecter les blocages visuellement.

**Source dominante** : `orders` + `parcels` (jointure)

**Rôle** : `admin` (lecture seule — les actions se font depuis Admin ou Hub)

| Bloc | Contenu | Action déclenchée |
|------|---------|-------------------|
| **P1 — Kanban** | Colonnes par statut business : `confirmed → ordered → preparation → shipped → in_transit → available → collected` | Cliquer = détail rapide |
| **P2 — Compteurs par colonne** | Nombre de commandes par statut | Identifier les goulots |
| **P3 — Filtre destination** | Par île (Anjouan, Grande Comore, Mohéli, Mayotte) | Isoler un flux |
| **P4 — Alerte stagnation** | Badge rouge sur les cartes > 48h dans le même statut | Prioriser |
| **P5 — Recherche** | Par référence | Localiser une commande |

**Statuts kanban** (alignés sur `order_status` enum — 9 colonnes) :

```
confirmed → ordered → preparation → shipped → in_transit → available → collected
                                                                          ↘ cancelled → refunded
```

**Ce qu'on NE met PAS dans Pipeline** :
- Actions de mutation (pas de bouton "confirmer" ici)
- Détails colis
- Analytics / graphiques

---

### 4. 🏭 Hub (`Komerce_Hub.html`)

**Mission** : L'agent hub prépare, scanne et expédie les colis.

**Source dominante** : `parcels` + `parcel_events` (logistique)

**Rôle** : `agent_hub`

| Bloc | Contenu | Action déclenchée |
|------|---------|-------------------|
| **H1 — À préparer** | Commandes `ordered` assignées à ce hub, triées par ancienneté | Scanner `preparation` |
| **H2 — À expédier** | Colis en `preparation`, prêts pour remise transporteur | Scanner `shipped` |
| **H3 — Scanner** | Interface scan (saisie code-barres ou caméra) | Enregistrer scan_step |
| **H4 — Historique du jour** | Derniers scans effectués, avec horodatage | Vérifier / tracer |
| **H5 — Recherche colis** | Par external_code ou référence commande | Localiser |

**Scan steps autorisés au hub** :

| Scan step | Signification | Rôle autorisé |
|-----------|--------------|---------------|
| `preparation` | Colis prêt | `agent_hub` |
| `shipped` | Remis au transporteur | `agent_hub` |
| `in_transit` | En déplacement (si hub fait aussi le départ) | `agent_hub` + `admin` |

**Source des KPI transporteur** : `parcel_events` — pas `orders.status`

| KPI | Source | Calcul |
|-----|--------|--------|
| Temps moyen préparation | `parcel_events` | `shipped_at - preparation_at` |
| Temps moyen transit | `parcel_events` | `relais_received_at - shipped_at` |
| Colis en attente > 24h | `parcel_events` | Dernier event > 24h sans suivant |

**Ce qu'on NE met PAS dans Hub** :
- Prix / wallet / paiement
- Statuts business (on parle en scan_steps ici)
- Gestion clients

---

### 5. 📍 Relais (`Komerce_Relais.html`)

**Mission** : L'agent relais réceptionne les colis et les remet aux clients.

**Source dominante** : `parcels` (destination = mon relais) + `parcel_events`

**Rôle** : `agent_relais`

| Bloc | Contenu | Action déclenchée |
|------|---------|-------------------|
| **R1 — En attente de réception** | Colis `in_transit` vers mon relais | Scanner `relais_received` |
| **R2 — À remettre** | Colis `available` (reçus, clients pas encore venus) | Scanner `collected` + vérifier pickup_code |
| **R3 — Scanner** | Interface scan réception / remise | Enregistrer scan_step |
| **R4 — Historique du jour** | Derniers scans effectués | Vérifier |
| **R5 — Recherche** | Par external_code, référence, téléphone client | Localiser |

**Scan steps autorisés au relais** :

| Scan step | Signification | Rôle autorisé |
|-----------|--------------|---------------|
| `relais_received` | Colis arrivé au relais | `agent_relais` |
| `collected` | Remis au client (pickup_code vérifié) | `agent_relais` |

**Sécurité** :
- L'agent relais ne voit QUE les colis destinés à son relais (`parcels.relais_id = agent.relais_id`)
- Le `pickup_code` est vérifié côté serveur au moment du scan `collected`
- Aucune donnée wallet / paiement visible

**Ce qu'on NE met PAS dans Relais** :
- Commandes d'autres relais
- Détails business (prix, wallet)
- Statuts business (on parle en scan_steps)

---

## Matrice des données par dashboard

| Donnée | Boutique | Admin | Pipeline | Hub | Relais |
|--------|----------|-------|----------|-----|--------|
| `orders.status` | ✅ (label client) | ✅ | ✅ (kanban) | ❌ | ❌ |
| `orders.*` (prix, items) | ✅ (mes commandes) | ✅ | ❌ | ❌ | ❌ |
| `parcels.*` | ❌ | 🔗 (via recherche) | 🔗 (compteur) | ✅ | ✅ (mon relais) |
| `parcel_events` | ❌ | ❌ | ❌ | ✅ (KPI) | ✅ (mon relais) |
| `scan_step` | ❌ | ❌ | ❌ | ✅ | ✅ |
| `products` | ✅ (catalogue) | ❌ | ❌ | ❌ | ❌ |
| `wallets` | ✅ (mon wallet) | ✅ (créditer) | ❌ | ❌ | ❌ |
| `pickup_code` | ⚠️ (au retrait) | ✅ | ❌ | ❌ | ✅ (vérification) |
| `users` | ❌ | 🔗 (recherche) | ❌ | ❌ | ❌ |

✅ = source dominante · 🔗 = join/lookup · ⚠️ = contextuel · ❌ = jamais

---

## Endpoints API par dashboard

### Boutique
```
GET  /api/products                    → catalogue
POST /api/orders                      → créer commande
GET  /api/orders?user_id=me           → mes commandes
GET  /api/orders/:ref                 → suivi (public)
POST /api/orders/:id/cancel           → annuler
GET  /api/wallet/balance              → mon wallet
POST /api/wallet/use                  → payer avec wallet
```

### Admin
```
GET  /api/orders?status=confirmed     → file d'attente
GET  /api/orders?status=ordered       → à préparer
PATCH /api/orders/:id/status          → transition machine
POST /api/payments/cash/confirm       → confirmer cash
GET  /api/orders/:ref                 → recherche (authentifié → détail complet)
POST /api/wallet/credit               → créditer client
GET  /api/wallet/balance?user_id=X    → balance client
GET  /api/wallet/transactions?user_id=X → historique client
```

### Pipeline
```
GET  /api/orders                      → toutes commandes (admin)
GET  /api/orders?status=X             → filtre par statut
GET  /api/orders/:ref                 → détail carte
```

### Hub
```
GET  /api/parcels                     → colis du hub
POST /api/scans                       → enregistrer scan
GET  /api/parcels/:id/events          → événements colis
```

### Relais
```
GET  /api/parcels?relais_id=me        → mes colis
POST /api/scans                       → scanner réception/remise
GET  /api/parcels/:id/events          → événements colis
```

---

## Principes visuels (hérités)

On conserve **uniquement** le style visuel des anciens fichiers :

| Élément | Spec |
|---------|------|
| **Couleurs** | Palette Komerce existante (vert primaire, gris, blanc) |
| **Typo** | Système actuel (Inter / system-ui) |
| **Layout** | Sidebar gauche + contenu principal |
| **Cards** | Bordures arrondies, ombres légères |
| **Responsive** | Mobile-first (les agents sont sur téléphone) |

On NE conserve PAS :
- Le code JS inline (→ modules)
- Les variables globales (`_products`, `_orders`)
- Le CSS inline (→ fichier partagé `komerce-ui.css`)
- Les appels API sans gestion d'erreur
- Les endpoints hardcodés

---

## Architecture cible

```
portal.html                          → choix du dashboard
  ├── Komerce_Boutique.html          → client
  ├── Komerce_Admin.html             → admin
  ├── Komerce_Pipeline.html          → admin (lecture seule)
  ├── Komerce_Hub.html               → agent_hub
  └── Komerce_Relais.html            → agent_relais
```

Chaque fichier HTML :
```
<html>
  <head>
    <link rel="stylesheet" href="komerce-ui.css">    ← style partagé
  </head>
  <body>
    [sidebar] [main content]
    <script type="module">
      import { KApi } from './komerce-api.js';        ← API centralisée
      import { KState } from './komerce-state.js';    ← état local
      // ... logique spécifique au dashboard
    </script>
  </body>
</html>
```

**Pattern** : `API → STATE → UI` (jamais `API → UI` direct)

---

## Fichiers à supprimer

| Fichier | Raison |
|---------|--------|
| `Komerce_Backend.html` | 512 KB monolithe — aucune mission claire |
| `Komerce_Dashboard.html` | Remplacé par Admin v2 |
| `Komerce_Pilotage.html` | Placeholder vide |
| `Komerce_Pilotage_v2.html` | Placeholder vide |

→ Déplacer dans `public/archive/` avant suppression définitive.

---

## Séquence d'implémentation

| Ordre | Dashboard | Raison |
|-------|-----------|--------|
| **1** | 🏭 Hub | Le plus simple (5 blocs, 1 source, scans uniquement) |
| **2** | 📍 Relais | Même structure que Hub, périmètre relais |
| **3** | 📊 Admin | Central mais plus complexe (wallet, recherche) |
| **4** | 🔄 Pipeline | Read-only kanban, dépend d'Admin pour les actions |
| **5** | 🛒 Boutique | Le plus gros (catalogue + checkout + suivi) — dernier |

---

## Limitations connues

| Point | Statut | Impact |
|-------|--------|--------|
| `GET /orders/:ref` pas authentifié | 🟡 TODO | Admin ne peut pas voir le détail complet via cet endpoint |
| `pickup_code` non retourné par l'API | 🟡 TODO | Relais ne peut pas vérifier le code |
| Pas de `GET /parcels?relais_id=me` RBAC | 🟡 À vérifier | Relais pourrait voir les colis d'un autre relais |
| `parcel_events` sans agrégation API | 🟡 TODO | Hub devra calculer les KPI côté client |
| Pas de WebSocket / SSE | 🟢 Later | Pas de temps réel — polling OK pour v1 |

---

## Règle d'or

> **Si tu ne peux pas dire en une phrase pourquoi cette donnée est sur cet écran, elle ne doit pas y être.**
