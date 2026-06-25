# Spec fonctionnelle — Keystone douane : instrumenter la déclaration

> Doctrine de référence : [`DOUANE_DECLARATION_PIVOT`](../doctrine/DOUANE_DECLARATION_PIVOT.md).
> Cette spec décrit le **quoi**, pas le **comment**. Le prompt d'ingénierie (graphe, migrations, invariants machine) vient *après* validation de cette spec.

---

## 0. Objet

Faire de la déclaration douanière une **donnée de première classe** : figée à la commande, matérialisée en facture classifiée par colis, et confrontée au réalisé. C'est la pièce angulaire : elle alimente l'argent (coût débarqué → marge) et la traçabilité (l'histoire douanière réelle du colis).

La spec ne calcule rien, ne prédit rien, n'optimise rien. Elle **instrumente l'écart** entre ce que Komerce déclare et ce que l'agent applique.

---

## 1. Ce qui existe déjà — NE PAS refaire

Le volet « mesurer · absorber · réconcilier » est construit :

- `customs_categories` — grille de référence : `key`, `sh_code`, `douane_pct`, `tva_pct`, `taxe_add_pct`. Résolution actuelle : `product.category` (texte) → `customs_categories.key`, avec repli `'default'` si pas de correspondance (`pricing-output.js` flague alors `missing: customs_category`).
- `products.customs_risk_coeff` — estimation de charge douane par produit, alimente le pricing.
- `customs_shipments` — réalisé par expédition : `cif_value_kmf`, `customs_paid_kmf`, `effective_rate_pct` (colonne générée).
- `customs_shipment_parcels` — allocation du réalisé par colis (`cif_kmf`, `customs_share_kmf`, `allocation_basis`).
- `customs-shipment-service.js` — `allocateCustoms()` répartit le payé, `propagateCostDouane()` remonte vers `orders.cost_douane_kmf → cost_real_kmf → marge`.
- `customs_effective_rates` (vue) — distribution des taux réalisés.

**Le keystone n'est pas ça. C'est le côté déclaré, qui manque.**

---

## 2. Les trois manques — le keystone réel

**Gap A — la classification déclarée n'est pas figée sur la ligne.**
`order_items` ne fige que `price_kmf`. La catégorie douane d'une commande est aujourd'hui recalculée à la volée depuis `product.category` *actuel* — donc dérive si la catégorie du produit change après l'achat. La déclaration repose sur du sable.

**Gap B — pas de facture / packing list classifiée par colis.**
`services/documents/` produit reçus pickup, refund, wallet — mais aucun document douanier. L'entrée que l'agent lit n'est pas produite par Komerce.

**Gap C — le déclaré n'est pas stocké pour être confronté à l'appliqué.**
On capture l'appliqué (`customs_paid_kmf` → `effective_rate_pct` → allocation). On ne stocke nulle part la **base déclarée** (catégorie / taux attendu par colis) à laquelle le comparer. L'écart — le cœur de la connaissance — n'est pas queryable.

---

## 3. Comportements attendus

**3.1 — Geler la classification à la création de commande (Gap A).**
À la création d'une `order_item`, on résout `product.category → customs_categories` (mécanisme existant) et on **fige sur la ligne** la sortie : `key`, `sh_code`, `douane_pct`, `tva_pct`, `taxe_add_pct`, plus un drapeau `classification_defaulted` si la résolution est tombée sur `'default'`. Ces valeurs sont **immuables** ensuite, exactement comme `price_kmf`. La déclaration future s'appuie sur elles, jamais sur la catégorie produit recalculée.

**3.2 — Produire la déclaration classifiée par colis (Gap B).**
À la constitution du colis déclaré, Komerce génère une facture / packing list par colis : lignes (bien, quantité, valeur, **catégorie SH figée**), CIF du colis. C'est l'input remis au transitaire / agent. Document **vrai** : il reflète la classification figée, jamais ajustée pour alléger.

**3.3 — Dériver le droit attendu et exposer l'écart au grain expédition (Gap C).**
L'agent rend un **montant global d'expédition** (`customs_shipments.customs_paid_kmf`, déjà capturé → `effective_rate_pct` généré). On ne capture donc **pas** de classification « retenue » par colis. On **dérive le droit attendu** depuis les lignes déclarées figées (catégorie × valeur, §3.1), on le remonte au grain expédition via la chaîne ligne → colis (`customs_shipment_parcels.cif_kmf`) → expédition, et on expose l'**écart attendu vs payé global** + le taux effectif réel, par expédition et par période. La méthode de l'agent (forfait / doigt mouillé / pièce par pièce), si elle est communiquée, se note en texte libre sur l'expédition — ce n'est pas une donnée structurée à capturer.

---

## 4. Invariants (à porter en `I-DOUANE-*`)

- **I-DOUANE-1** — Toute `order_item` porte une classification douane figée à la création. Jamais recalculée après coup.
- **I-DOUANE-2** — La déclaration par colis ne contient que des catégories **vraies** (la catégorie figée du produit). Jamais ajustée pour alléger un droit. Pas de reclassement de complaisance.
- **I-DOUANE-3** — Le coût douane réel d'une commande vient **toujours** de l'allocation `customs_shipments` (chemin existant), jamais d'une estimation.
- **I-DOUANE-4** — Estimation (`customs_risk_coeff`) et réalisé (`effective_rate_pct`) restent deux vérités distinctes. On ne réécrit jamais l'une avec l'autre.
- **I-DOUANE-5** — Le pricing porte un **tampon** douane large, calibré sur la distribution réalisée. Jamais un taux fixe.
- **I-DOUANE-6** — Aucun composant ne calcule, prédit ou « optimise » le droit. La douane est une issue discrétionnaire qu'on instrumente, pas une fonction.

---

## 5. Données — esquisse (pas du DDL)

- **`order_items`** : colonnes snapshot — `customs_category_key`, `sh_code`, `douane_pct`, `tva_pct`, `taxe_add_pct`, `classification_defaulted`. Figées à l'INSERT, immuables, comme `price_kmf`. **C'est le cœur du keystone.**
- **Lignes déclarées** : ce sont les `order_items` figés eux-mêmes, regroupés par colis. **Pas de nouvelle table** — le colis (`customs_shipment_parcels`) porte déjà le CIF, les lignes sont les `order_items` de la commande rattachée.
- **Droit attendu / écart** : **dérivé** (calculé) depuis les lignes figées, comparé au `customs_paid_kmf` global de l'expédition. Pas de champ « classification retenue » — l'agent rend un global. Méthode agent éventuelle = note libre sur `customs_shipments`.

---

## 6. Frontières — ce que la spec NE fait pas

- Pas de calcul ni d'optimisation du droit.
- Pas de prédiction du taux.
- Pas de découpage algorithmique commande → colis (reste une politique humaine ; la spec fournit la donnée, pas l'optimiseur).
- Pas de stratégie « agent-client » (vit côté acquisition / partenaires, hors de ce pivot).
- Pas de résurrection du moteur de colisage (démantelé).

---

## 7. Ordre de mise en œuvre

1. **Gap A en premier — la fondation.** On n'est pas en prod : pas d'horloge, pas de backfill. L'enjeu est de poser le gel de classification **avant** la prod, pour qu'elle démarre propre et qu'aucun rattrapage ne soit jamais nécessaire. Prérequis de B et C.
2. **Gap B et Gap C ensuite**, tous deux adossés aux lignes figées de A :
   - **Gap C** (dérivation du droit attendu + écart vs payé global) est en lecture seule, peu coûteux, mais ne devient utile qu'une fois des expéditions réelles accumulées.
   - **Gap B** (facture classifiée par colis) est le document opérationnel ; nécessaire avant les premières vraies déclarations.

   Ordre B vs C au choix selon le besoin : déclarer bientôt → B d'abord ; analyser l'écart → C d'abord.

---

## 8. Décisions arrêtées (2026-06-24)

1. **Grain de l'appliqué** : l'agent rend un **montant global d'expédition**. Gap C est au grain expédition (droit attendu dérivé des lignes figées vs payé global). Pas de capture par colis.
2. **Déclaration par colis** : **le colis est l'unité qui porte la valeur**. Les lignes déclarées sont les `order_items` figés regroupés dans le colis ; pas de nouvelle table de lignes.
3. **Classifications `defaulted`** : **non bloquant**. Un produit dont `category` ne matche aucune `customs_categories.key` est figé sur la catégorie `'default'` avec `classification_defaulted = true`, et le compte est exposé comme liste de travail. L'alignement des catégories se fait à terme, pas maintenant.
4. **Rétroactif** : **non — on est en build, pas en prod.** Migration purement additive, aucun backfill, aucun drapeau « reconstruit ». Les commandes de test existantes peuvent rester à NULL ou être régénérées.

---

> Quand cette spec est validée et les 4 questions tranchées, le prompt d'ingénierie suit : consultation `komerce-arch-header-graph.json`, respect des `@komerce-arch` et invariants `I-BACK-*`, migration `order_items`, et câblage dans le chemin de création de commande + `customs-shipment-service`.
