# Doctrine V3 — Leviers de marge & simulateur d'imputation

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> *Komerce ne donne pas un seul prix. Komerce donne plusieurs scénarios
> argumentés et laisse l'humain décider, en pleine conscience.*

---

## 1. Principe fondateur

L'imputation des coûts (Phase 3a, doctrine v1) répond à la question :
*« Combien cet article coûte-t-il à Komerce, en moyenne ? »*

Mais pour **fixer un prix de vente**, l'imputation seule ne suffit pas. Il faut
**décider** quelle stratégie Komerce adopte vis-à-vis de ce coût. Trois leviers
existent. Le simulateur les expose tous, recalcule le prix automatiquement, et
laisse l'humain trancher.

---

## 2. Les 3 leviers de marge

### Levier 1 — Sous-couverture acceptée temporairement
> *« J'accepte de ne pas couvrir 100% de mes coûts maintenant, parce que je sais
> que le volume va monter. C'est un investissement borné dans le temps. »*

**Mécanisme** : pricer en mode "volume cible espéré" alors que le volume réel
est inférieur. Komerce sous-collecte mais reste compétitif.

**Paramètres** :
- `acceptable_undercoverage_pct` : 0 à 30% (par défaut 15%)
- `target_volume_horizon_months` : combien de mois pour atteindre le volume
  cible (par défaut 6)

**Exigence** : la sous-couverture doit être **mesurée en continu** dans la
Santé Éco. Sinon elle devient invisible et indéfinie.

**Pertinent pour** : pré-launch, lancement, conquête de marché.

---

### Levier 2 — Redistribution sélective entre articles
> *« Sur certains articles que je veux pousser, j'impute moins. Sur d'autres
> qui peuvent absorber, j'impute plus. La marge globale reste juste. »*

**Mécanisme** : un coefficient `cost_loading_factor` par produit (ou par
catégorie) qui dit *« ce produit porte 0.7x sa part normale »* ou *« 1.3x ».*
La somme des chargements doit faire approximativement 1.0 sur le portefeuille
pour que la marge globale ne dérive pas.

**Paramètres** :
- `cost_loading_factor` : 0.5 à 2.0 (par défaut 1.0)
- Niveau d'application : produit / catégorie / shipment

**Exigence** : avoir des données de vente pour identifier "étoiles" vs "vaches
à lait". Sinon c'est de la pure intuition.

**Pertinent pour** : maturité 6-12 mois, catalogue stable, KPI ventes connus.

---

### Levier 3 — Promo volume / commande groupée
> *« Si le client commande plusieurs articles, je dilue mieux mes coûts par
> commande et par colis. Je peux partager ce gain avec lui. »*

**Mécanisme** : remise calculée sur la base de **gains de dilution réels**.
Si une commande contient 5 articles au lieu de la moyenne 2.5, les coûts
`kmf_per_order` sont divisés par 5 au lieu de 2.5 → on gagne 3 KMF sur chaque
article. On en redonne tout ou partie au client sous forme de remise.

**Paramètres** :
- `volume_thresholds` : seuils de panier (ex: 3, 5, 10 articles)
- `share_back_pct` : part du gain redistribuée (ex: 50% au client, 50% à Komerce)

**Exigence** : avoir un volume de commandes suffisant pour que les promos
volume aient un sens commercial.

**Pertinent pour** : maturité 3-6 mois, premiers clients récurrents.

---

## 3. Le simulateur de scénarios

Pour chaque produit, le moteur produit **plusieurs scénarios de prix
possibles**, calculés à partir du même baseline imputation. L'humain les voit
côte à côte, choisit, et le système locke la décision.

### Scénarios standards proposés

```
┌────────────────────────────────────────────────────────────┐
│ Scénario              | Prix      | Marge | Logique        │
├────────────────────────────────────────────────────────────┤
│ 1. Honnête baseline   | 17 200    | 15%   | Couverture 100%│
│                       |           |       | au volume actuel│
│                       |           |       | (recommandé)   │
├────────────────────────────────────────────────────────────┤
│ 2. Sous-couverture    | 14 500    |  1%   | Levier 1       │
│    -15%               |           |       | À récupérer    │
│                       |           |       | au volume cible│
├────────────────────────────────────────────────────────────┤
│ 3. Volume cible       | 13 800    | 18%   | Si on atteint  │
│    atteint            |           |       | 200 art/ship   │
│                       |           |       | et 50 cmd/mois │
├────────────────────────────────────────────────────────────┤
│ 4. Promo 5 articles   | 12 900    |  4%   | Levier 3       │
│                       |           |       | Si panier >= 5 │
├────────────────────────────────────────────────────────────┤
│ 5. Loading 0.7×       | 12 100    | 12%   | Levier 2       │
│                       |           |       | Subventionné   │
│                       |           |       | par autres prod│
└────────────────────────────────────────────────────────────┘
```

### Garde-fous doctrinaux

Aucun scénario ne peut être appliqué s'il :
- Descend sous `survival_price_kmf` (perte certaine, même sans charges fixes)
- Implique une marge négative permanente (Levier 1 borné dans le temps)
- Crée une incohérence (ex: loading 0.5 sur tous les produits → marge globale
  insuffisante)

Si un scénario devient irréaliste, il est **affiché mais marqué non-sélectionnable**
avec explication.

---

## 4. Architecture technique

### Fonction `computeScenarios(product, ctx)` dans `pricing-engine.js`

Retourne un tableau de scénarios :
```js
[
  {
    id: 'honest_baseline',
    label: 'Honnête baseline',
    description: 'Couverture 100% au volume actuel',
    price_kmf: 17200,
    margin_pct: 15.0,
    cost_imputed_kmf: 14620,
    selectable: true,
    is_recommended: true,
    explanation: '...',
    levier: null,
  },
  {
    id: 'undercoverage_15',
    label: 'Sous-couverture acceptée -15%',
    description: 'Tu acceptes de perdre 2 200 KMF/article pour rester compétitif',
    price_kmf: 14500,
    margin_pct: 1.0,
    cost_imputed_kmf: 14620,
    undercoverage_kmf: 2200,
    selectable: true,
    is_recommended: false,
    explanation: '...',
    levier: 'undercoverage',
    levier_params: { undercoverage_pct: 15 },
  },
  // ... 3 autres scénarios
]
```

### Endpoint `/api/pricing/recommend`

Retourne désormais en plus :
- `scenarios: [...]` (tableau de scénarios)
- `recommended_scenario_id: 'honest_baseline'`

### Sélection et application

Quand l'humain clique "Appliquer ce prix au produit", le frontend envoie :
```
POST /api/pricing/apply
{
  "product_id": "...",
  "scenario_id": "undercoverage_15",
  "price_kmf": 14500
}
```

Le backend :
- Vérifie que le scénario est `selectable: true`
- Vérifie que `price_kmf >= survival_price_kmf`
- Met à jour `products.price_kmf`
- Logge dans `pricing_audit` : produit, scénario choisi, paramètres, prix

---

## 5. Tableau de bord "Sous-couverture" (Phase 3d, plus tard)

Quand le Levier 1 est utilisé sur des produits, la Santé Éco doit afficher :

```
SOUS-COUVERTURE EN COURS
─────────────────────────────────
Articles vendus ce mois : 87
Coût imputé théorique total : 1 280 000 KMF
Coûts engagés réels      : 1 540 000 KMF
─────────────────────────────────
ÉCART (sous-collecté)   : -260 000 KMF (-17%)
─────────────────────────────────
Tendance 3 mois : -15%, -16%, -17%
🔴 La sous-couverture s'aggrave. Action requise.
```

Cette vue arrive **plus tard** (Phase 3d). Pour l'instant on se concentre sur
le simulateur.

---

## 6. Roadmap d'implémentation

| Phase | Effort | Contenu | Priorité |
|---|---|---|---|
| **3a** | ✅ FAIT | Moteur impute (division par moyennes) | — |
| **3a-bis** | 5h | Simulateur de scénarios + UI Atelier colonne 4 | **Maintenant** |
| **3b** | 2h | Lock-in BDD au moment du clic "Appliquer" | Suivant |
| **3c** | 2h | UI Atelier colonne 2 affiche imputation détaillée | Suivant |
| **3d** | 4h | Tableau Santé Éco "Sous-couverture" | Quand volume |
| **3e** | 6h | Levier 2 (redistribution) + Levier 3 (promo volume) | 3-6 mois |

---

## 7. Pourquoi cette approche est juste

### Pour Komerce
- **Pas de prix imposé** : tu décides selon ta stratégie du moment
- **Pas de calcul caché** : chaque scénario est expliqué
- **Garde-fous** : tu ne peux pas pricer sous le minimum sûr par erreur
- **Évolutif** : on peut ajouter des scénarios plus tard sans tout refaire

### Pour la doctrine
- Respecte *« Komerce part du coût rendu relais »* : la baseline est honnête
- Respecte *« Le moteur calcule, l'humain décide »* : choix final = humain
- Respecte *« Données qui se parlent + détection des bêtises »* : les scénarios
  irréalistes sont marqués

### Contre les pièges
- ❌ Ne pas avoir de baseline → impossible de mesurer la sous-couverture
- ❌ Ne pas afficher les scénarios → l'humain ne sait pas ce qu'il choisit
- ❌ Ne pas avoir de garde-fou → quelqu'un peut pricer en dessous de survival
- ❌ Imposer le baseline → perte de souplesse commerciale

Le simulateur résout les 4 pièges en même temps.
