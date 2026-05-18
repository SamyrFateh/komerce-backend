# Démarche de découpage modulaire métier

> Statut : note d'architecture — pas un lot exécutable
> Date : 17 mai 2026
> But : cadrer comment on découpe utilement, sans tomber dans la refacto pour la refacto.

---

## 1. La règle non négociable avant tout découpage

**On ne refactor jamais pour des raisons esthétiques.** Une refacto se justifie par un gain mesurable sur l'un de ces axes :

| Axe | Question concrète | Si non, on ne touche pas |
|---|---|---|
| **Risque** | Est-ce que ce fichier concentre du risque qui rend une modif anxiogène ? | Non = on laisse |
| **Onboarding** | Est-ce qu'un nouvel agent met > 1 h à comprendre où ajouter une feature ? | Non = on laisse |
| **Conflits Git** | Est-ce qu'il y a régulièrement des conflits de merge sur ce fichier ? | Non = on laisse |
| **Test** | Est-ce qu'on ne peut pas tester une fonction sans monter toute l'app ? | Non = on laisse |
| **Réutilisation** | Est-ce que la même logique est dupliquée ailleurs ? | Non = on laisse |

Si aucun de ces axes ne s'allume, **la taille du fichier seule ne justifie rien**. Un fichier de 1500 lignes bien organisé vaut mieux que 8 fichiers de 200 lignes mal couplés.

---

## 2. Inventaire factuel — où on en est aujourd'hui

Top 10 des plus gros fichiers métier du repo :

| Fichier | Lignes | Catégorie | Score risque |
|---|---:|---|:-:|
| `routes/dashboard.js` | 2614 | Route admin agrégée | 🟡 |
| `services/pricing-engine.js` | 1483 | Service métier coeur | 🔴 |
| `routes/pricing.js` | 1316 | Route admin pricing | 🟡 |
| `routes/parcel-api-v2.js` | 1299 | Route logistique | 🟠 |
| `routes/admin.js` | 1207 | Route admin générique | 🟠 |
| `routes/pickup-secret.js` | 1122 | Route sécurité | 🔴 |
| `services/dashboard-metrics.js` | 1052 | Service KPIs | 🟢 |
| `services/shared-cart-engine.js` | 1037 | Service métier | 🟢 |
| `routes/hub-dashboard.js` | 1015 | Route admin dashboard | 🟡 |
| `services/collective-workspace-engine.js` | 965 | Service métier | 🟢 |

Légende :
- 🔴 = haut risque (argent, sécurité, ou doctrine économique)
- 🟠 = à surveiller (volume + transversalité)
- 🟡 = grosse taille mais bien isolé (par exemple : dashboards admin)
- 🟢 = grosse taille mais structuré et stable

---

## 3. Méthode en 4 questions pour chaque candidat

Avant de découper un fichier, on l'évalue selon les 5 axes de §1. Voici la méthode appliquée aux 3 candidats les plus visibles.

### 3.1 `services/pricing-engine.js` (1483 lignes) — 🔴 vraie cible

| Axe | Évaluation |
|---|---|
| Risque | **Oui critique.** Ce fichier contient `computeCDR` (256 lignes), la doctrine économique. Toute erreur ici impacte directement les marges. |
| Onboarding | **Oui difficile.** Un nouvel agent qui veut ajouter une composante de coût doit lire 1500 lignes pour comprendre où l'insérer. |
| Conflits Git | À vérifier dans l'historique, probablement modérés. |
| Test | **Oui problème.** `computeCDR` à 256 lignes ne peut pas être testée unitairement par étape — il faut tester l'ensemble. |
| Réutilisation | Pas un problème ici. |

**Verdict : à découper.** 3 axes sur 5 s'allument, dont risque ET test. C'est un vrai gain.

**Découpage proposé** (à valider en lot dédié) :

```
services/pricing/
├── index.js                    ← façade publique (mêmes exports qu'aujourd'hui)
├── load-config.js              ← loadGlobalConfig (69L)
├── cost-allocation.js          ← computeFixedCostAllocation (36L)
├── compute-cdr/                ← le gros morceau, à découper en 4-5 sous-étapes
│   ├── index.js                ← orchestrateur (40-50L)
│   ├── components-resolver.js  ← résolution composantes DB
│   ├── customs-calc.js         ← calcul douane
│   ├── transport-calc.js       ← transport/logistique
│   └── allocation-applier.js   ← application allocations
├── compute-prices.js           ← arrondi psycho + 4 niveaux de prix
├── compute-scenarios.js        ← scénarios
├── market-confidence.js        ← signal marché
├── health-status.js            ← health
├── sourcing-decision.js        ← décision proceed/caution/revisit/block
├── alerts.js                   ← buildAlerts
└── recommendation.js           ← recommend (orchestrateur)
```

**Garde-fous** : `services/pricing-engine.js` (l'ancien) devient un fichier façade de 10 lignes qui réexporte depuis `pricing/index.js`. **Aucun consommateur n'est cassé.** `CONTRACTS.md` §6 reste intact (mêmes signatures publiques).

**Gain mesurable** : `computeCDR` testable unitairement étape par étape. Onboarding sur la doctrine économique passe de "lire 1500L" à "lire `compute-cdr/index.js` (50L) puis aller voir l'étape concernée".

### 3.2 `routes/dashboard.js` (2614 lignes) — 🟡 candidat secondaire

| Axe | Évaluation |
|---|---|
| Risque | **Non.** C'est de la lecture (GET). Pas de mutation d'état. |
| Onboarding | **Oui modérément.** Le commentaire d'en-tête annonce "10 endpoints", la réalité c'est 19 — dérive itérative. |
| Conflits Git | Probablement oui car beaucoup de mains. |
| Test | Pas critique pour des GET admin. |
| Réutilisation | Probablement oui — chaque endpoint duplique de la logique SQL similaire. |

**Verdict : à découper, mais pas urgent.** 2 axes sur 5 s'allument (onboarding + conflits). C'est un gain de confort, pas un gain critique.

**Découpage proposé** :

```
routes/dashboard/
├── index.js              ← monte le router + auth (50L)
├── ops.js                ← /ops
├── finance.js            ← /finance
├── pilotage.js           ← /pilotage
├── pipeline.js           ← /pipeline
├── retards.js            ← /retards
├── forecast.js           ← /forecast
├── clients.js            ← /clients, /clients/list, /clients/detail
├── history.js            ← /history
├── hub.js                ← /hub, /hub-dubai
├── relais.js             ← /relais
├── annulations.js        ← /annulations-parcels
├── global-stats.js       ← /global, /stats
├── payments.js           ← /payments
└── sales.js              ← /sales
```

**Garde-fous** : `services/dashboard-metrics.js` existe déjà et centralise les KPIs. **Aucun SQL inline dans les routes** après découpage — toute logique métier descend dans le service. C'est le vrai gain : les routes deviennent des wrappers fins, le service devient l'unique source de KPIs.

**À faire en même temps** : aligner le commentaire d'en-tête avec la réalité (19 endpoints, pas 10). Mettre à jour `CARTOGRAPHY_360.md` §3.

### 3.3 `routes/pickup-secret.js` (1122 lignes) — 🔴 à éviter pour l'instant

| Axe | Évaluation |
|---|---|
| Risque | **Oui critique** (codes secrets, paiement cash, **violation I-01 active**). |
| Onboarding | Oui difficile. |
| Conflits Git | Modérés. |
| Test | Oui problème. |
| Réutilisation | Non. |

**Verdict : à découper, mais après I-SWEEP.** Touche fortement au code à corriger pour I-01. **Refacto + correction d'invariant en même temps = catastrophe garantie**. On corrige d'abord I-SWEEP, on teste, on stabilise. Découpage en lot séparé après.

---

## 4. Anti-patterns à éviter absolument

Pendant le découpage, ne pas commettre ces erreurs classiques :

### A. Couper par fichier, pas par responsabilité

❌ `pricing-engine-part1.js` + `pricing-engine-part2.js`
✅ `pricing/cost-allocation.js` + `pricing/compute-prices.js`

Le nom doit dire **ce que le fichier fait**, pas où il se trouve dans l'ordre.

### B. Découper en gardant des dépendances circulaires

Si `a.js` importe de `b.js` qui importe de `a.js`, le découpage a échoué. Avant de couper, dessiner le graphe d'appels et vérifier qu'il est acyclique.

### C. Casser les signatures publiques

Tout module externe qui consommait `require('./pricing-engine').computeCDR` doit continuer à fonctionner sans changement. La façade `services/pricing-engine.js` doit rester avec les mêmes exports. Sinon on casse 30 fichiers en un commit.

### D. Refactor + ajout de feature dans le même PR

Refacto = mouvement sans changement de comportement. Si dans la même PR on ajoute une nouvelle fonctionnalité, plus moyen de savoir ce qui a cassé. Règle absolue : 1 PR = refacto **OU** feature, jamais les deux.

### E. Mauvais lot dans le bon timing

Découper `pricing-engine.js` pendant que ChatGPT audite les flows G1-G5 va créer des conflits permanents. Le découpage attend la fin du chantier d'audits.

---

## 5. Plan de séquence recommandé

Étape par étape, dans cet ordre :

| Ordre | Lot | Conditions de démarrage |
|---|---|---|
| 1 | Fin du chantier d'audits (D2, D7 ✅, D8, G1-G5, E1-E6, F1-F7, H1-H5) | ChatGPT en cours |
| 2 | `I-SWEEP` — correction des violations d'invariants détectées | Audits finis |
| 3 | `TEST-1` — tests d'intégration sur invariants I-01 à I-10 | I-SWEEP fini (filet) |
| 4 | `REFAC-pricing` — découpage `pricing-engine.js` selon §3.1 | TEST-1 fini |
| 5 | `REFAC-dashboard` — découpage `routes/dashboard.js` selon §3.2 | REFAC-pricing fini |
| 6 | `REFAC-pickup-secret` — découpage `routes/pickup-secret.js` | Plus tard, optionnel |

**Critère d'arrêt** : si après REFAC-pricing on ne sent pas de gain réel, **on s'arrête là**. Pas de découpage par principe.

---

## 6. Ce qu'on NE découpe PAS

Les fichiers suivants apparaissent dans le top 10 par taille mais ne doivent **pas** être découpés (ou en tout cas pas maintenant) :

| Fichier | Pourquoi on ne touche pas |
|---|---|
| `services/shared-cart-engine.js` (1037L) | Stable, bien organisé, signatures publiques dans CONTRACTS. Découpage = risque > gain. |
| `services/collective-workspace-engine.js` (965L) | Idem, et orchestration complexe. |
| `services/dashboard-metrics.js` (1052L) | C'est précisément le résultat d'un découpage réussi vs `routes/dashboard.js`. Le toucher = défaire. |
| `routes/parcel-api-v2.js` (1299L) | API logistique, transactions, sécurité. Trop sensible. Plus tard si besoin. |

---

## 7. Synthèse

**Tu as raison** : il y a du clean-up à faire après les itérations successives. Mais le bon découpage suit ces principes :

1. **Mesurable** : un découpage qui n'améliore ni le risque, ni l'onboarding, ni les tests, ni les conflits = pas de découpage.
2. **Séquencé** : pas pendant les audits, pas avant I-SWEEP, pas avant TEST-1.
3. **Conservateur des signatures** : on coupe l'intérieur, pas l'interface (CONTRACTS.md reste intact).
4. **Ciblé** : 2-3 fichiers maximum dans la première vague (pricing-engine + dashboard). Le reste, plus tard.
5. **Une PR = un type de changement** : refacto OU feature, jamais les deux.

**Premier vrai chantier** : `REFAC-pricing` quand le moment sera venu. Gain réel sur `computeCDR` testable étape par étape, et sur la lisibilité de la doctrine économique.
