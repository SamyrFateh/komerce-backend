# R&D ÉCO — Revue ciblée des 10 dépendances d'autorité (26 octobre 2026)

**Statut :** examen statique des dix relations + une preuve A/B PostgreSQL réelle. Les verdicts statiques ne sont pas des certifications E2E, et les dix relations ne sont pas dix bugs.

**Provenance :** `scripts/research/feature-fd-authority-hypotheses-report.json` (213 tables, 36 features, 574 sources; 105 observations brutes, 47 relations dédupliquées, top 10 borné). Sans coût LLM par ligne.

| Rang | Dépendance | Résultat de l'examen | Prochain contrôle |
|---|---|---|---|
| 1 | order_items → order_item_cost_imputations | Source canonique lue depuis `order_items` par `order-cost-snapshot.js` avant INSERT ; risque direct de substitution faible | Vérifier le gel économique lors d'une mutation concurrente, séparément |
| 2 | order_items → parcel_items | Garde du writer `assignParcelItem` validée en PR #3015, **mais plusieurs autres writers** apparaissent dans le même groupe | Examiner les autres points d'écriture, sans compter un nouveau bug avant preuve |
| 3 | shared_cart_items → order_items | Intégrité du claim vérifiée en amont par `order-checkout-item-resolution.js` avec `FOR UPDATE OF sci`, vérification produit/SKU/statut | Conserver comme contre-exemple pour mesurer les faux positifs |
| 4 | order_items → hub_purchase_allocations | `hub-physical-identity.js` construit un snapshot PO et compare l'allocation existante ; invariants partie PO à vérifier plus complètement | Perturber la quantité/identité entre purchase_line et order_item |
| 5 | orders → cash_confirmation_controls | INSERT reçoit l'objet ordre résolu par l'appelant ; `prepareCashConfirmation` documente la nécessité du verrou sur la commande | Vérifier que tous les appelants tiennent effectivement le verrou |
| 6 | orders → economic_risk_cost_events | Résolution explicite `resolveMarketAndOrder` ou conservation de la provenance originale lors d'une correction | Contrôle statique des appels à la résolution |
| 7 | orders → hub_purchase_allocations | Même site que rang 4, dépendance supplémentaire vers le marché/fournisseur ; pas une découverte indépendante | Mutualiser la preuve avec rang 4 |
| 8 | orders → mobile_money_transactions | `loadOrderForPayment` et `computeAuthoritativeAmount` fournissent le marché et le montant avant INSERT | Test de cohérence sur callback/réconciliation, pas un nouveau compteur |
| 9 | orders → pricing_maturity_disposition_events | `recordMaturityDisposition` relit id et market_id directement dans `orders` | Vérifier concurrence transitionnelle indépendamment |
| 10 | providers → physical_offers | **NOUVEAU DÉFAUT REPRODUIT** : provider KM et offre CM insérée avant correctif. Service frère `createService` porte la même absence de garde. | PR #3018 ; conservation des cas avant/après |

## Preuve indépendante de la découverte

- Avant correctif : [GitHub Actions 40396085159](https://github.com/SamyrFateh/komerce-backend/actions/runs/40396085159) ; étape PG verte, 2 contradictions / 4 cas, transaction annulée ; publication du rapport échouée mais artefact Actions conservé.
- Après correctif : [GitHub Actions 40396907895](https://github.com/SamyrFateh/komerce-backend/actions/runs/40396907895) ; PostgreSQL + tests ciblés + publication des preuves **verts**.
- [Preuve complète après correctif](./feature-fingerprint-provider-market-pg-proof.json) : 4 cas, 0 contradiction. Les marchés utilisés sont KM et CM.
- [PR #3018](https://github.com/SamyrFateh/komerce-backend/pull/3018) : vérification des rattachements à la création des services et offres et au moment de leur exposition. Deux fichiers modifiés, aucune migration.
- [Protocole de rejeu](./feature-fingerprint-provider-market-pg.js) : vrai corps du service réutilisé avec un exécuteur PostgreSQL transactionnel injecté ; pas d'appel HTTP.

## Calibration du scanner

- **Une nouvelle classe de découverte obtenue à partir d'un classement non spécifique**, avec rapprochement manuel contractuel puis A/B ciblé.
- **Ne pas compter** les neuf autres relations comme neufs bugs ; ni conclure qu'elles sont toutes correctes : six ont des protections amont directement visibles, trois méritent encore un contrôle complémentaire.
- **Ne pas traiter l'absence de route de création publique comme une vulnérabilité accessible** : la preuve concerne le service interne.
- Réduction du bruit : conserver les 105 sites bruts pour traçabilité, présenter un seul représentant par dépendance fonctionnelle et limiter le tri humain à dix relations par cycle.

**Prochaine expérience prioritaire :** rang 4/7, `hub_purchase_allocations`, en vérifiant product SKU, quantité, marché et commande entre PO, ligne d'achat et order_item ; nominals + perturbations sur PostgreSQL jetable.
