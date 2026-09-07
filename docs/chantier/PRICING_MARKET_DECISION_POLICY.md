# Chantier — Politique canonique de décision marché

> **Statut** : contrat technique du gate économique market-scoped
> **Doctrine** : `DOCTRINE_PRICING_ANCRE_MARCHE_VIABILITE.md`
> **Migration** : 168 — `pricing_market_decision_policy_events`
> **Surface cible** : Pricing Workspace pays

## 1. But

Le gate de couverture sait désormais calculer une vérité économique par marché. Ce lot retire la dernière liberté silencieuse qui empêchait d'en faire un outil de décision utilisable : la fenêtre et les seuils ne sont plus fournis ad hoc par l'appelant.

La politique canonique d'un marché définit explicitement :

```text
window_days
maturity_threshold
coverage_threshold
max_disposition_ratio
disposed_contribution_treatment
version + source + preuve + justification
```

Aucune valeur numérique par défaut n'est inventée par le moteur.

## 2. Fenêtre canonique

Le navigateur ne choisit jamais `from/to` pour le gate de décision.

Le serveur résout la politique effective puis dérive :

```text
canonical_to   = instant d'évaluation serveur
canonical_from = canonical_to - window_days
```

La maturité et le watermark restent ensuite les garde-fous anti cherry-picking à l'intérieur de cette cohorte. Une commande non franchissable rend le résultat `NOT_DECISIONAL` ; elle ne déplace pas opportunément la fenêtre pour améliorer le ratio.

Les périodes libres restent possibles pour l'analyse et la simulation, jamais pour l'autorisation canonique.

## 3. Persistance append-only

`pricing_market_decision_policy_events` est un journal append-only par `market_id`.

Toute modification de politique crée une nouvelle version. `UPDATE` et `DELETE` sont bloqués en base.

Une politique porte obligatoirement :

- version ;
- source ;
- référence de preuve ;
- justification ;
- auteur ;
- date d'enregistrement ;
- date d'effet.

Une nouvelle politique ne peut pas être antidatée par l'API canonique. Elle peut être immédiate ou planifiée.

## 4. Autorité

### Lecture

- `global_admin` avec autorité Pricing : lecture de tous les marchés ;
- `market_operator viewer` : lecture de son marché ;
- `market_operator manager` : lecture de son marché.

### Écriture

- `global_admin` avec autorité Pricing ;
- `market_operator manager` uniquement sur son `market_id` serveur.

Le navigateur ne fournit jamais `market_id`.

Le manager pays est autonome sur sa stratégie locale, mais chaque changement reste versionné, justifié et visible. L'autonomie n'est jamais une suppression de la traçabilité.

## 5. API canonique

Sous :

```text
/api/admin/workspaces/pricing/market/:marketCode
```

Routes :

```text
GET  /decision
GET  /decision-policy/history
POST /decision-policy
```

`GET /decision` ne reçoit aucune date : la fenêtre vient de la politique effective.

## 6. Décision rendue

La projection de décision publie au minimum :

```text
COVERED | UNCOVERED | NOT_DECISIONAL
authorization
reason
policy
canonical_period
coverage
```

Le sens métier reste strict :

- `COVERED` → une **nouvelle position sous CDR** peut être envisagée ;
- `UNCOVERED` → aucune nouvelle position sous CDR ;
- `NOT_DECISIONAL` → même refus d'autorisation, mais sans fabriquer de ratio rassurant.

Le gate ne modifie aucun prix et n'applique aucune stratégie automatiquement.

## 7. Surface de décision cible

La finalité n'est pas d'exposer une API technique. Dans le Pricing Workspace pays, la première zone doit devenir une **Décision marché** immédiatement lisible :

```text
État du gate
Fenêtre canonique
Maturité / dispositions
Contribution réconciliée
N3 attribué
Couverture actuelle / seuil
Blocage éventuel
Politique effective
```

Le manager doit pouvoir :

1. comprendre en quelques secondes si le marché est économiquement couvert ;
2. voir exactement pourquoi le moteur refuse de décider ;
3. ouvrir le détail des preuves sans lire des IDs techniques ;
4. simuler avant de changer une règle ;
5. enregistrer une nouvelle version de politique avec justification ;
6. voir l'historique des décisions et politiques.

Le dashboard observe. Le Workspace permet d'agir. La décision finale reste humaine.

## 8. Fail-closed assumé

Le lot ne persiste pas encore les politiques d'allocation des pools N3 `GROUP`.

Donc, si un pool partagé existe et qu'aucune politique d'allocation gouvernée n'est fournie au moteur :

```text
MARKET_N3_NOT_DECISIONAL
```

Le système doit afficher ce blocage clairement. Il est interdit de le contourner par une répartition égalitaire implicite ou `markets.is_active`.

Ce verrou sera le lot suivant avant de considérer la surface de décision complète.

## 9. Non-objectifs

- aucun changement de `computePrices` ;
- aucun seed arbitraire de seuils ;
- aucun corridor marché inventé ;
- aucune application automatique de prix ;
- aucun budget de conquête implicite ;
- aucune refacturation partenaire ;
- aucune allocation GROUP silencieuse.

## 10. Invariant final

> **Le moteur ne choisit ni sa fenêtre ni ses seuils au moment de calculer. Il applique une politique de marché explicite, versionnée et auditable ; si une vérité manque, il dit `NOT_DECISIONAL`.**
