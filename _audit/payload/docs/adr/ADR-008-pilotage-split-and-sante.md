# ADR-008 — Réorganisation Pilotage + Vue Santé business (Phase 3 audit)

**Date :** avril 2026
**Statut :** Implémenté
**Contexte :** Phase 3 finale du plan d'audit architectural. Trois chantiers liés :
- **3A** : Splitter la mégavue `pilotage` (8 fonctions render mélangées)
- **3B** : Créer la **Vue Santé business** demandée par le user (chiffres corrélés)
- **3C** : Réorganiser les sections CT pour matérialiser la séparation Op/Fin

---

## Problème détecté pendant l'audit

### 1. La mégavue `pilotage` mélangeait 6 sujets dans 1 fichier (85 KB)

```
Pilotage Stratégique (1 vue, 6 tabs)
├── 📅 Temporel       ← financier (projections CA/marges)
├── 🗂️ Mix Catégories ← financier (allocation, marges pondérées)
├── 📊 Dashboard Live ← doublon avec 'dashboard' Cockpit
├── 🚦 Opérationnel   ← opérationnel (SLA, blocages)
├── ⭐ Fidélité       ← financier
└── 👥 Clients & Ventes ← doublon avec 'clients' (ADR-006)
```

Cette concentration empêchait :
- Une **séparation cognitive claire** entre opérationnel et financier
- Une **lecture rapide** : 6 tabs à scanner pour trouver l'info
- Des **rôles différenciés** : un comptable n'a pas besoin du tab "Opérationnel", un OPS pas du tab "Mix Catégories"

### 2. Aucune vue agrégée transverse

Les KPI étaient juxtaposés dans le Dashboard, mais **rien ne les corrélait** :
- "La marge baisse" → mais POURQUOI ? Mystère, il fallait recouper soi-même
- "Le cash en retard augmente" → mais sur QUEL relais ? Idem
- "Les clients à risque montent" → combien ça représente vraiment ?

User a explicitement demandé : *"une vue qui agrège en définitif tous les indicateurs corrélés qui se parlent les uns aux autres"*.

## Décisions

### Décision 3A — Splitter pilotage par wrapping (Strangler Fig Pattern)

**Pourquoi ne pas réécrire ?** Le fichier `ct-views-pilotage.js` (85 KB) est complexe et fonctionnel. Le réécrire prendrait 8h et risquerait des régressions invisibles. À la place :

**Stratégie :** créer 2 vues fines qui **enveloppent** la mégavue et masquent les tabs non pertinents.

**Fichier 1** : `public/js/ct-views-pilotage-op.js` (60 lignes)
- Appelle `CT.views.pilotage(main)`
- Cache les tabs `temporel`, `mix`, `dashboard`, `clients`
- Active par défaut le tab `ops`
- Adapte le titre : "🚦 Pilotage Opérationnel"

**Fichier 2** : `public/js/ct-views-pilotage-fin.js` (50 lignes)
- Appelle `CT.views.pilotage(main)`
- Cache les tabs `ops`, `dashboard`, `clients`
- Garde par défaut `temporel`
- Adapte le titre : "💰 Pilotage Financier"

**Bénéfices :**
- Zero régression (le code original n'est pas touché)
- Migration progressive (à terme on pourra splitter physiquement le code)
- Les anciens liens `#pilotage` continuent de marcher

### Décision 3C — Réorganiser les sections CT

**Avant :**
```
ct/
├── cockpit (1)
├── pilotage (2)  ← fourre-tout
└── strategie (3)
```

**Après :**
```
ct/
├── cockpit (1)        ← 🏥 Santé · 🎯 Dashboard · ⚡ Actions · 🚨 Problèmes
├── pilotage_op (2)    ← 🚦 SLA & Pipeline
├── pilotage_fin (3)   ← 💰 Projection · 💰 Ventes · 👥 Clients
└── strategie (4)      ← 🧠 Économique · 🧮 Pricing · 🔍 Sourcing
```

**Vues remappées vers `pilotage_fin` :**
- `sales` (ADR-002) ← financier par essence
- `clients` (ADR-006) ← analyse client = revenus

**Vue `pilotage` legacy** : conservée mais avec `roles: []` pour ne plus apparaître dans la sidebar. Les anciens liens fonctionnent toujours.

### Décision 3B — Créer la Vue Santé business

C'est la pièce maîtresse qui matérialise la vision : **chiffres qui se parlent**.

**Localisation** : `cockpit` en **première position** (avant Dashboard) car c'est le 1er écran à regarder.

**Architecture :**

#### 1. Hero — Score global

```
🏥 Santé Business
Score 78/100 · 💚 La machine tourne bien
```

Score pondéré (Cash 30% · Marge 30% · Pipeline 25% · Clients 15%) basé sur la santé des 4 piliers.

#### 2. Quatre piliers (vert/jaune/rouge avec pulse)

| Pilier | Mesure | Seuils |
|---|---|---|
| 🩸 **Cash** | Cash relais en attente / retard | Vert si 0 retard, Rouge si > 7j ou > 30% |
| 📈 **Marge** | Marge réelle vs cible 25% | Vert si ≥ cible, Rouge si > 5pp sous |
| ⚙️ **Pipeline** | Commandes bloquées / total actif | Vert si 0, Rouge si > 15% bloqués |
| 👥 **Clients** | Clients à risque + LTV | Vert si 0, Rouge si LTV en jeu > 500k KMF |

Chaque pilier a un `why` qui explique son état en 1 phrase :
> "270 000 KMF en retard > 7 jours" (rouge)
> "1.5pp sous la cible" (jaune)
> "Pipeline fluide, aucun blocage" (vert)

#### 3. Corrélations détectées (le cœur)

Le moteur scanne 6 patterns de corrélation :

| Pattern | Quand ça se déclenche | Insight produit |
|---|---|---|
| Marge ↘ + Douane ↗ | marge sous cible ET douane 30j > 90j+1.5pp | "Le taux douane est passé de X à Y, c'est probablement la cause" |
| Marge ↘ + Panier ↘ | marge sous cible ET panier moyen 30j < 92% précédent | "Promotions trop fortes ou mix dégradé ?" |
| Cash retard concentré | retards cash ET certains relais en écart > 50k | "Top relais : X (Y KMF d'écart) — à contacter en priorité" |
| Clients à risque LTV | nb at_risk > 0 | "X KMF de LTV silencieuse, soit Y KMF/client en moyenne" |
| Pipeline bloqué | blocages > 0 ET payements en attente | "Ces commandes ne génèrent ni CA ni satisfaction" |
| Mix catégories défavorable | catégorie marge < 15% mais CA > 100k | "Catégorie X : Y KMF de CA mais seulement Z% de marge" |

**Chaque corrélation a un bouton d'action** qui amène à la vue concernée :
- "→ Voir Historique Douane" (corrélation douane)
- "→ Voir Comptabilité" (corrélation cash relais)
- "→ Voir Clients à risque" (corrélation clients)
- etc.

#### 4. Drill-down détails

Pour les piliers Rouge/Jaune, des tableaux complémentaires apparaissent :
- **Top 5 clients à risque** (avec LTV, jours de silence)
- **Buckets cash** (24h / 48h / 72h / 7j+ avec montants)

## Données utilisées (rien de nouveau côté backend)

La vue Santé est un **agrégat client-side** de 7 endpoints existants :

```js
Promise.all([
  CT.api.get('/api/dashboard/ops'),                    // pipeline
  CT.api.get('/api/dashboard/finance'),                // KPI compta
  CT.api.get('/api/dashboard/clients'),                // segments + at_risk
  CT.api.get('/api/dashboard/sales?period=30'),        // marge réelle
  CT.api.get('/api/admin/cash/reconciliation?days=30'),// cash par relais
  CT.api.get('/api/admin/cash/uncollected'),           // buckets retard
  CT.api.get('/api/admin/customs-shipments/rates/effective'), // taux douane
])
```

Aucun nouvel endpoint à coder. Aucune migration SQL. La cohérence entre vues est assurée car ce sont les mêmes endpoints qui alimentent le Dashboard, Comptabilité, Clients, etc.

## Compatibilité ascendante (alias dans `_resolveViewFn`)

Tous les anciens liens fonctionnent :

```js
var legacy = {
  'action-center': 'actionCenter',
  'parcels': 'orders',
  'parcel_reconciliation': 'reconciliation',  // ADR-007
  'finances': 'finances',                     // ADR-007
};
```

Les vues `pilotage_op` et `pilotage_fin` sont dispatchées normalement (correspondance directe `CT.views[id]`).

## Fichiers livrés

**Créés :**
- `public/js/ct-views-pilotage-op.js` — wrapper opérationnel (60 lignes)
- `public/js/ct-views-pilotage-fin.js` — wrapper financier (50 lignes)
- `public/js/ct-views-sante.js` — Vue Santé business (637 lignes)
- `docs/ADR-008-pilotage-split-and-sante.md` — ce document

**Modifiés :**
- `public/js/ct-platform.js` — sections splittées + 3 nouvelles entrées + remap sales/clients
- `control-tower.html` — chargement des 3 nouveaux scripts

## Bénéfices mesurables

- **Séparation cognitive** : Op vs Fin enfin matérialisée dans la navigation
- **Vue agrégée existante** : la Santé répond à "comment ça va" en 1 écran
- **Corrélations explicites** : finie l'analyse manuelle des chiffres juxtaposés
- **Aucune régression** : Strangler Fig Pattern, code legacy intact
- **Aucun coût backend** : agrégation client-side d'endpoints existants

## Limites & évolutions possibles

1. **Seuils en dur** : la cible marge (25%), seuil VIP (200k), seuil cash retard (15%) sont codés. Devraient être paramétrables (table `settings`).
2. **Détection de tendances primitive** : panier moyen 30j vs 30j précédent — pourrait être plus fin avec lissage (moving average).
3. **Pas de score historique** : on ne stocke pas l'évolution du score Santé jour par jour. À ajouter si on veut "Score il y a 7 jours : 82" → "aujourd'hui : 71, → en baisse".
4. **Wrappers pilotage Op/Fin sont des façades** : le code physique reste mélangé. À splitter physiquement quand le besoin sera clair.
5. **Corrélations limitées à 6 patterns** : on peut en ajouter (ex: relais X corrélé à un transitaire mauvais).

## Déploiement

```bash
git add public/js/ct-platform.js \
        public/js/ct-views-pilotage-op.js \
        public/js/ct-views-pilotage-fin.js \
        public/js/ct-views-sante.js \
        control-tower.html \
        docs/ADR-008-pilotage-split-and-sante.md

git commit -m "feat(ct): Phase 3 audit — split pilotage + vue Santé business + sections Op/Fin (ADR-008)"
git push
```

Aucune migration SQL nécessaire. Ouverture immédiate dans la Control Tower :
- **Cockpit** → 🏥 **Santé Business** (nouvelle vue principale)
- **Pilotage Op** → 🚦 **SLA & Pipeline**
- **Pilotage Financier** → 💰 **Projection & Mix** + 💰 Ventes + 👥 Clients
