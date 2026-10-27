# Feature Fingerprint — Golden à commande et identité uniques (27 octobre 2026)

**Statut :** étalonnage R&D ÉCO réussi, **aucun nouveau bug métier confirmé**. Cette expérience réutilise le Golden existant `tests/e2e-api/customer-to-customer.golden.e2e.test.js`. Elle n'implémente pas une nouvelle recette, et n'exécute ni production Railway ni staging.

## Preuve

- [Run GitHub Actions #40473602926](https://github.com/SamyrFateh/komerce-backend/actions/runs/40473602926) : **vert**.
- [Artefact JSON](https://github.com/SamyrFateh/komerce-backend/actions/runs/40473602926/artifacts/12719917272), stocké 5 jours.
- **8/8** tests du moteur pur via `node --test scripts/research/golden-identity-trail.test.js`.
- **1/1** véritable test d'intégration Golden existant (PostgreSQL 16 isolé, données transactionnelles nettoyées à la fin).
- Source : `scripts/research/golden-identity-trail.js` et extension lecture seule du test Golden canonique.

## Graphe d'identité et checkpoints

Une *seule commande* `orders.id` et ses véritables clés étrangères suivies dans les tables canoniques :

`order_item_id → purchase_line_id → supplier_execution_order_id → supplier_payment_id / fulfillment_id → hub_allocation_id → hub_physical_unit_id → parcel_id → scan_id`.

Le même article vendu, la même variante SKU, le même marché et la même commande doivent garder leurs identités. Le détecteur ne compare pas les prix pour identifier les marchandises, et **n'exige pas `parcels.order_id = order_items.order_id`** (colis partagés autorisés). Une PO regroupée n'a pas obligatoirement de `purchase_orders.order_id` ; elle est rattachée par `purchase_lines.order_item_id`.

| Instant sur **la même commande** | Observations du collecteur | Résultat |
|---|---|---|
| Exécution fournisseur prouvée, avant réception Hub | Absences d'allocation, placement, colis, scan | `MISSING_IDENTITY_EVIDENCE` |
| Après réception Hub, avant constitution du colis | Absence de colis et scan | `MISSING_IDENTITY_EVIDENCE` |
| Colis arrivé au relais, avant preuve de retrait | Absence du scan client | `MISSING_IDENTITY_EVIDENCE` |
| Après retrait et clôture financière par les vrais réconciliateurs | Neuf catégories d'identifiants retrouvées, aucune rupture | `NO_IDENTITY_CONTRADICTION_OBSERVED` ; `FINANCIAL_CLOSE_MATCHED` canonique |

Les étapes qui manquent sont des **lacunes attendues de preuves**, pas des bugs détectés. Le résultat du collecteur ne fait jamais foi comme acceptation humaine ou GO.

## Étalonnage A/B

1. **Nominal :** mêmes `order_item`, `sku_id`, `purchase_line`, exécution, Hub, colis et scan persistés en PostgreSQL. Zéro contradiction et zéro trou d'identité en fin de parcours.
2. **Perturbation pure du graphe (sans modification SQL) :** remplacer le SKU de la ligne d'achat tout en gardant le même volume. Le scanner retrouve `PURCHASE_SKU_SUBSTITUTION` et `HUB_ALLOCATION_SKU_MISMATCH`. Ces signaux sont des anomalies **injectées intentionnellement** pour étalonner l'oracle, pas de nouveaux bugs.
3. **Perturbation SQL indépendante** : tentative réelle de remplacer après confirmation le SKU d'une ligne d'achat par une seconde variante valide du même produit. La base refuse `SQLSTATE 23514 / purchase_line_frozen`. Toute la tentative se déroule dans `BEGIN/ROLLBACK`, et l'empreinte nominale demeure identique après la transaction. **C'est une protection canonique validée, et non une nouvelle faille.**

## Limites de l'expérience

Le Golden source crée ses faits persistants dans une base isolée par fixture puis appelle les vrais services/reconcilieurs. Il **ne réalise pas un vrai achat chez le fournisseur**, ni son débit réel, ni un transport réel, ni une session navigateur de client en staging, ni une approbation humaine. Le collecteur vérifie les identités et liens, mais ne déclare pas les paiements ou expéditions « prouvés » sans les verdicts des propriétaires canoniques.

Le contrôle conserve le statut `approvedOracle:false`, `certifiedE2E:false` : une absence de divergence n'est pas une preuve globale de validité des processus.

## Prochain protocole minimal

Réutiliser ces mêmes checkpoints sur un **second parcours de même intention**, par exemple la variante de commande groupée/commande standard ou une autre route Purchasing-Hub. Comparer les empreintes structurelles et les motifs, **sans comparer les UUID générés entre deux commandes**. Chaque signal doit être rejoué par un oracle propriétaire indépendant avant d'être promu en bug. Pas de campagne massive et pas de PR métier en l'absence de défaut réel.

**Action Git :** recherche uniquement sur `research/golden-continuity-checkpoints-20261026`, aucune PR corrective supplémentaire, aucun merge, aucune migration et aucun déploiement.
