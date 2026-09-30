# Audit E2E — navigation canonique Sourcing

Date : 2026-09-30  
Périmètre : `/admin/import-runtime` après PR #1980  
Principe contrôlé : **AGRÉGAT → POPULATION → OBJET → ACTION → PREUVE**

## 1. Objet utilisateur canonique

Le seul objet de navigation exposé à l'opérateur est le **passage Sourcing**, identifié par une référence `KIR-xxxxxx`.

Le mot **lot** reste un nom historique/interne :
- `import_runtime_runs` porte le run opérationnel KIR ;
- `import-lot-registry` projette des informations métier autour du même KIR.

Il ne s'agit pas de deux objets que l'utilisateur devrait apprendre. L'UI doit donc parler de **passage** partout. Les noms de classes et variables internes historiques peuvent rester inchangés tant qu'ils ne sont pas affichés.

## 2. Matrice de navigation attendue

| Départ | Clic | Vue attendue | Retour attendu |
| --- | --- | --- | --- |
| Live | Passages | Historique des passages, vue exclusive | navigateur ou Live |
| Live | Sources | Inventaire fournisseurs/autopilot, vue exclusive | navigateur ou Live |
| Passages | ligne KIR | Live du passage sélectionné | retour navigateur → même liste Passages |
| Live | Produits reçus | population exacte reçue | Retour au passage |
| Live | Prêts Catalogue | population exacte certified | Retour au passage |
| Live | Écartés | population exacte écartée | Retour au passage |
| Live | Action requise | objets exacts à traiter | Retour au passage |
| Population | produit | détail métier de l'objet dans le passage | retour à la population |
| Objet | fiche Catalogue | produit Catalogue avec `return_to` vers l'objet du passage | retour contextuel |
| Live | Source | état de la source de ce passage | Retour au passage |
| Live | Contrôle automatique | Préparation / Classement / Validation | Retour au passage |
| Contrôle | Détail technique | six étapes backend | Retour au contrôle |
| Détail technique | une étape | preuve filtrée de cette étape | Retour au contrôle si le détail vient du contrôle |
| Live | Catalogue | frontière Sourcing → Catalogue | Retour au passage |

Une vue secondaire **remplace** la vue précédente ; elle ne s'empile jamais dessous.

## 3. Diagnostic production observé

Déploiement Railway inspecté : commit merge #1980 `fc0c8c1495bcff18520debd2f2b6e01a13f22af1`.

Sur les requêtes récentes inspectées autour du cockpit :
- `/admin/import-runtime` : réponses 200/304 ;
- `/api/admin/workspaces/sourcing/import-cockpit` : réponses 200 ;
- `/api/admin/workspaces/sourcing/import-passages` : réponses 200 ;
- `/api/admin/workspaces/sourcing/import-runs/KIR-000006/population` : réponses 200 ;
- aucun 4xx/5xx observé sur les 116 requêtes cockpit pertinentes du lot de logs consulté.

Conclusion : les retours incohérents observés ne sont pas expliqués par une erreur HTTP serveur. Le défaut confirmé était dans la conservation du **contexte de navigation client**.

## 4. Défaut de retour confirmé

Chemin :
`Contrôle automatique → Voir le détail technique → Raffinerie/Taxonomie/Certification`.

Le premier lien ajoutait `from=control`, mais un clic sur une sous-étape technique reconstruisait l'URL sans ce paramètre. Le parent était donc perdu et le retour devenait générique.

Correction :
- `stageUrl(..., from)` conserve le parent ;
- les liens des six étapes transmettent `from=control` ;
- E2E : contrôle → détail → Raffinerie → retour contrôle → retour passage.

## 5. Drill-down incomplet confirmé

Avant cet audit, le parcours s'arrêtait à :

`AGRÉGAT → POPULATION`.

Les lignes produit d'une population n'ouvraient pas d'objet. Cela rendait la doctrine de navigation incomplète.

Correction :
- ajout d'une vue `item` dans le cockpit ;
- population → produit par `supplier_product_id` ;
- détail : situation, préparation, classement, validation Sourcing, état Catalogue ;
- si un `product_ref` existe, lien vers la fiche Catalogue avec retour contextuel vers l'objet du passage.

## 6. Pourquoi les passages s'arrêtent avant Catalogue

Ce comportement n'est pas un bug de navigation.

La projection runtime distingue :
- `certified` = prêt côté Sourcing ;
- `catalogued` = candidat réellement devenu produit Catalogue (`state=imported_to_catalog` + `product_ref`).

Le passage Catalogue reste en attente lorsque `certified > catalogued`.

La cause structurelle actuelle est dans `promoteCandidate()` :
- la promotion exige `requireExplicitPromotionPrice(body)` ;
- le produit créé reçoit ce prix ;
- `products.price_kmf` est `NOT NULL` et contraint à `> 0` ;
- l'événement enregistre `price_decision: EXPLICIT_HUMAN_INPUT`.

Donc un produit propre et certifié Sourcing **ne peut pas être remis au Catalogue sans décision de prix humaine** dans le modèle actuel.

C'est une tension avec la séparation de domaines retenue pour le cockpit :
- Sourcing doit remettre un produit propre ;
- le prix et l'exposition appartiennent au domaine Catalogue/économique.

Cet audit ne contourne pas cette contrainte avec un faux prix. Une décision d'architecture séparée est nécessaire : permettre un brouillon Catalogue incomplet sans prix final, ou introduire une frontière de handoff distincte avant `products`.

## 7. Scénarios E2E ajoutés

- Live → Passages → KIR → retour navigateur → Passages.
- Live → Sources → retour arrière → Passages → retour arrière → Live → avant.
- navigation KIR précédent/suivant.
- pagination Passages anciens/récents.
- Produits reçus → population → objet → retour population → retour passage.
- Contrôle automatique → détail technique → sous-étape → retour contrôle.
- Source → retour passage.
- Catalogue → retour passage.
- conservation exacte du `return_to` lorsqu'un objet a déjà une fiche Catalogue.
- vocabulaire métier affiché : **passage**, pas lot.

## 8. Invariant UX retenu

> Un KIR est un **passage Sourcing**.
>
> Un nombre ouvre sa population exacte.
>
> Une ligne de population ouvre l'objet.
>
> Une action ouvre l'endroit où elle est résolue.
>
> Une preuve technique conserve toujours son parent métier.
>
> Le navigateur Back/Forward doit reproduire le même parcours que les liens visibles.
