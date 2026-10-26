# Golden continuity R&D — Un colis, deux commandes, deux preuves de remise

**Expérience** : 26 octobre 2026 · **Environnement** : PostgreSQL 16 isolé (`komerce_test`), transaction intégralement annulée. **Pas une recette staging ou navigateur.**

## Question métier indépendante

Un colis P porte effectivement **deux `parcel_items`**, dont l'un appartient à la commande A et l'autre à la commande B. Un colis partagé doit être reconnu pour **chaque commande**, mais **la preuve de remise doit rester propre à chaque commande**. Le critère `parcel_flow_closed` de la maturité économique décrit la progression physique du colis ; il ne constitue pas un justificatif de retrait pour tous les clients.

Propriétaires canoniques utilisés **tels quels**, sans moteur de décision parallèle :
- `services/parcel-order-membership.js` — rattachement effectif des colis via les lignes.
- `services/customer-handoff-reconciliation.js` — remise autorisée par commande et par scan.
- `services/pricing-maturity.js` — critères économiques à partir des liens physiques canoniques après PR #3028.
- `services/order-financial-closure-reconciliation.js` — clôture dépendante de la preuve de remise et des faits financiers.

## Protocole

[Script R&D](./golden-shared-multiorder-handoff-pg.js) et [workflow ciblé](https://github.com/SamyrFateh/komerce-backend/blob/research/golden-continuity-checkpoints-20261026/.github/workflows/research-golden-parcel-maturity.yml). Une fixture réelle possède deux commandes et deux lignes distinctes, **un seul colis** porté par A et contenant les deux lignes, sans inventer de commande/fournisseur réel. Un snapshot `landed_relay.relay=200` rend `parcel_flow_closed` **applicable** à chaque commande. Aucun règlement effectif relais n'est ajouté ; aucune clôture complète ne peut être légitimement `MATCHED`. Un scan `PICKUP_CODE` est rattaché explicitement à la commande autorisée.

Chaque scénario a été exécuté deux fois ; huit fixtures distinctes, seize observations (A et B). **ROLLBACK=true**.

| Scénario | Remise A | Remise B | Parcel flow A/B | Finance A | Finance B |
|---|---|---|---|---|---|
| Colis collecté + preuve A et B | `HANDOFF_MATCHED` | `HANDOFF_MATCHED` | satisfait / satisfait | `PENDING` | `PENDING` |
| Colis collecté + preuve A seulement | `HANDOFF_MATCHED` | `HANDOFF_MISMATCH` | satisfait / satisfait | `PENDING` | `MISMATCH` |
| Colis disponible sans retrait | `HANDOFF_PENDING` | `HANDOFF_PENDING` | non / non | `PENDING` | `PENDING` |
| Colis annulé, sans retrait | `HANDOFF_PENDING` | `HANDOFF_PENDING` | non / non, 0 colis actif | `PENDING` | `PENDING` |

Le cas sans scan B démontre que **le statut physique « collected » d'un colis partagé ne constitue pas une preuve client B**. B reçoit `CUSTOMER_HANDOFF_COLLECTED_WITHOUT_PROOF` et la finance refuse sa clôture (`FINANCIAL_CLOSE_HANDOFF_MISMATCH`). A reste `FINANCIAL_CLOSE_PENDING` faute des justificatifs économiques réels, même si son retrait est prouvé.

## Preuves

- [**Run cible entièrement vert #40418964938**](https://github.com/SamyrFateh/komerce-backend/actions/runs/40418964938) : `8/8` scénarios, `28/28` tests `pricing-maturity` ; aucun résultat métier inattendu.
- [**Artefact JSON**](https://github.com/SamyrFateh/komerce-backend/actions/runs/40418964938/artifacts/12697111431) : traces A/B par scénario, horodatées par le run, preuves et raisons de verdict, états du critère, `rollbackVerified=true`.
- [**PR de correction antérieure #3028**](https://github.com/SamyrFateh/komerce-backend/pull/3028) reste en brouillon : les nouveaux scénarios vérifient son comportement sur deux lignes physiquement partagées ; aucune nouvelle modification métier nécessaire.

## Résultat pour le scanner

**Catégorie : CONTRÔLE NÉGATIF / SÉMANTIQUE DE PARCOURS DISTINCTE.** Il serait incorrect de signaler `parcel_flow_closed=true` et `HANDOFF_MISMATCH` comme une contradiction automatique : ces prédicats évaluent des faits différents. En revanche, `FINANCIAL_CLOSE_MATCHED` associé à `HANDOFF_MISMATCH` serait une contradiction à forte priorité. Ce cas n'a pas été observé.

Cela améliore l'oracle, sans fabriquer un bug artificiel : `ZERO_NEW_BUGS_CONFIRMED`, mais le risque initial des colis partagés est bien couvert par la PR #3028. Le rapport est fondé sur fixtures transactionnelles, **pas** sur un P1–P7 de vente réelle, ni sur navigateur/staging, et n'atteste ni règlement relais, ni achat fournisseur, ni douane complète.

**Prochaine extension**, après les gates de PR : un vrai parcours Golden avec les mêmes `order_item_id` et `parcel_id` vérifiés de Sourcing à la preuve de retrait, puis le rapprochement de paiements et frais réels. Garder les limites de preuve explicites.
