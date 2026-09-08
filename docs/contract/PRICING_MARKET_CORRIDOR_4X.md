# LOT 4X — Corridor marché & chaîne de décision économique

> **Statut** : contrat Canonical  
> **Date** : 2026-09-08  
> **Complète** : `PRICING_WORKSPACE_4F.md`, `DOCTRINE_ADMIN_DASHBOARDS.md`, `DOCTRINE_ECONOMIQUE_KOMERCE.md`.

## 1. Doctrine de surface

La règle Admin reste intangible :

> **Le Dashboard observe. Le Workspace agit. Le 360 explique. La Variable pilote. Le moteur calcule.**

Le corridor marché et la chaîne économique appartiennent au **Pricing Workspace** parce qu'ils servent à comprendre une décision de prix, renseigner des preuves terrain, décider un prix local et demander son activation.

Ils ne créent pas un cinquième dashboard et ne déplacent aucun calcul économique dans le navigateur.

Chaîne obligatoire :

```text
SOURCE MÉTIER → MOTEUR / PROJECTION SERVEUR → WORKSPACE
```

Le navigateur formate et ordonne la projection. Il ne recalcule ni coût variable, ni contribution, ni couverture, ni résultat, ni corridor.

---

## 2. Chaîne de lecture

La surface marché rend lisible :

```text
coût d'achat
→ coût variable complet
→ bornes marché observées
→ prix retenu / acheteur effectif
→ contribution unitaire

puis, sur la fenêtre canonique réellement réconciliée :

volume / mix observé
→ contribution totale
→ charges de structure à couvrir
→ couverture
→ résultat de période
```

Les deux blocs ne sont pas confondus : la décision unitaire décrit le prix actuellement effectif et ses frontières ; le bloc de période décrit le flux réellement réconcilié. Le frontend ne multiplie jamais la contribution unitaire courante par un volume observé pour fabriquer une contribution totale.

---

## 3. Corridor marché

Le marché borne le possible ; il ne remplace jamais la vérité économique des coûts.

### 3.1 Source locale

Les observations pays sont stockées dans :

- `market_price_observations` ;
- journal append-only `market_price_observation_events`.

Chaque observation possède une référence métier `KMO-...`, un produit, un marché résolu côté serveur, un concurrent / une enseigne, un prix dans la devise du marché, sa projection KMF côté serveur, une date, une source et éventuellement une note.

Le navigateur n'envoie jamais `market_id`.

### 3.2 Bornes

Le service `services/pricing-market-corridor.js` ordonne les prix observés et projette :

- borne basse : observation proche du quartile 25 % ;
- cible observée : médiane observée ;
- borne haute : observation proche du quartile 75 %.

Les bornes sont toujours des **faits observés existants** ; le service ne fabrique pas un prix interpolé entre deux observations.

Le corridor porte :

```text
authority = OBSERVED_REFERENCE_NOT_GATE
```

Il éclaire une décision humaine ; il ne fixe pas automatiquement le prix et ne constitue pas un gate d'activation.

### 3.3 Maturité

```text
0 observation  → LOCAL_EVIDENCE_MISSING / confidence none
1–2            → EMERGING / confidence low
3–7            → READY / confidence medium
8+             → READY / confidence high
```

Un petit échantillon reste visible mais n'est jamais présenté comme une vérité forte.

---

## 4. Référence globale ≠ corridor pays

`competitor_prices` reste une référence globale / historique de stratégie centrale.

Si aucune preuve locale n'existe :

```text
corridor.local.status = LOCAL_EVIDENCE_MISSING
```

Le service peut publier séparément `corridor.global_reference`, mais **ne copie jamais** ses bornes dans `corridor.local`.

Le Workspace affiche cette référence dans une zone secondaire explicitement informative.

Aucun fallback global silencieux n'est autorisé.

---

## 5. Prix retenu et autonomie pays

La stratégie commerciale locale reste la responsabilité du manager du marché.

Le Workspace peut :

- enregistrer une décision de prix local via l'autorité `market-commercial-price-service` ;
- afficher cette décision comme candidate tant qu'elle n'est pas buyer-effective ;
- demander son activation ;
- afficher le prix réellement acheteur effectif.

L'autorité centrale ne choisit pas silencieusement le prix local à la place du pays.

Le système contrôle cependant les invariants déjà canoniques :

- un prix sous le coût variable complet est destructif et ne peut pas être activé ;
- une nouvelle position sous CDR complet exige le gate de couverture du marché ;
- le passage `LOCAL_ACTIVE` reste la seule vérité buyer-effective.

---

## 6. Projection économique unitaire

Pour le prix acheteur effectif — et séparément pour une décision candidate — le serveur utilise `pricing-engine` avec la configuration effective du marché.

La projection Canonical publie notamment :

```text
purchase_cost_kmf
variable_cost_complete_kmf
selected_price_kmf
contribution_unit_kmf
cdr_reference_kmf
minimum_safe_price_kmf
coverage_reference_price_kmf
strategy_risk
```

Le CDR complet reste une **référence de couverture imputée**. Il ne transforme pas la structure de période en dette du SKU.

La décision marché ne se déduit donc jamais d'un simple `CDR × coefficient`.

---

## 7. Projection du flux de période

La chaîne consomme directement la décision serveur déjà gouvernée :

```text
decision.flow_break_even.observed_mix
decision.flow_break_even.economic_state
```

Les champs principaux sont :

```text
period_contribution_kmf
period_n3_kmf
coverage_ratio
period_result_kmf
```

et, comme vues opérationnelles du même pool :

```text
article_units
mature_orders
parcels
contribution_per_article_kmf
contribution_per_order_kmf
contribution_per_parcel_kmf
```

Article, commande et colis ne constituent jamais trois contributions additionnables. Ce sont plusieurs vues du même flux.

---

## 8. Routes Canonical marché

Sous `/api/admin/workspaces/pricing/market/:marketCode` :

### Lecture

- `GET /corridor?product_ref=...`
- `GET /decision`
- `GET /commercial-prices`
- `GET /products/:productRef/local-price/activation-preview`

### Preuve terrain

- `POST /price-observations`
- `POST /price-observations/:observationRef/deactivate`

Ces mutations appartiennent au manager pays.

### Décision locale

- `POST /products/:productRef/local-price`
- `POST /products/:productRef/local-price/activate`
- `POST /products/:productRef/local-price/reset`

Le serveur résout toujours le marché depuis l'URL puis applique `operator_market_scopes`. Aucun identifiant interne envoyé par le navigateur ne devient une autorité.

---

## 9. Invariants UI

`public/dashboards/canonical/js/pricing-decision-chain.js` :

- fonctionne uniquement en mode marché ;
- appelle les projections Canonical serveur ;
- ne contient aucun `market_id` / `marketId` ;
- ne calcule pas la contribution totale ;
- ne calcule pas le résultat de période ;
- ne calcule pas les quartiles du corridor ;
- ne convertit aucune devise ;
- ne remplace jamais un corridor local manquant par la référence globale ;
- permet les mutations uniquement lorsque les capabilities serveur l'autorisent.

---

## 10. Phrase de contrôle

> **Le coût dit ce qu'une vente consomme. Le marché dit ce qui est plausible. Le responsable pays choisit le prix. La contribution dit ce que la vente apporte. Le flux dit si la structure est absorbée.**

Et toujours :

> **Le moteur calcule ; le Workspace agit à partir de cette vérité, il ne la réinvente pas.**
