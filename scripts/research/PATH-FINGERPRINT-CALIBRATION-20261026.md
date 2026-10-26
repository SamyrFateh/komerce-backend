# Feature Fingerprint — Comparaison de parcours métier (R&D ÉCO)

**Date :** 2026-10-26  
**Protocole :** paths ≠ simple statuts ; même intention → comparer décision, motif d'erreur et classe d'effet économique *observée en base*.  
**Preuve :** [GitHub Actions 40408336509](https://github.com/SamyrFateh/komerce-backend/actions/runs/40408336509) ; [artefact complet](https://github.com/SamyrFateh/komerce-backend/actions/runs/40408336509/artifacts/12692241407).

## Résultat de l'étalonnage

- Moteur : `scripts/research/business-path-compare.js`, zéro dépendance, aucune mutation externe.
- Calibration : `node --test scripts/research/business-path-compare.test.js` — **4/4 PASS**. Contrôles : implémentations différentes mais équivalentes ; asymétrie entre acceptation et quarantaine ; **écriture persistée malgré le refus** ; comparaison d'intentions différentes interdite.
- PostgreSQL 16 jetable : schéma propre HUB-001 + migrations, véritable `receiveSupplierPackage`. **Deux tests d'intégration ciblés PASS**, 24 autres non exécutés.
- **10 paires** (5 intentions × 2 répétitions), verdict `NO_PATH_ASYMMETRY_OBSERVED` : zéro divergence sur trois axes vérifiés.

| Intention normalisée | Chemin historique | Chemin regroupé | Verdict après garde #3022 |
|---|---|---|---|
| NON SOUMIS | PO `pending` | PO `draft` | Quarantaine `HUB_PURCHASE_ORDER_NOT_SUBMITTED`, zéro allocation |
| SOUMIS | PO `confirmed` | PO `confirmed` | Acceptation et une allocation par fixture |
| ANNULÉ | PO `cancelled` | PO `cancelled` | Quarantaine `HUB_PURCHASE_ORDER_CANCELLED`, zéro allocation |
| MAUVAIS SKU | SKU déclaré non conforme | SKU déclaré non conforme | Quarantaine `HUB_PURCHASE_SKU_MISMATCH`, zéro allocation |
| SUR-QUANTITÉ | 2 reçus pour 1 acheté | 2 reçus pour 1 acheté | Quarantaine `HUB_ALLOCATION_OVERRECEIVED`, zéro allocation |

**Important :** le résultat « zéro divergence » porte sur le code de la branche de recherche *après* la garde de la [PR #3022](https://github.com/SamyrFateh/komerce-backend/pull/3022). Le [run pré-correctif](https://github.com/SamyrFateh/komerce-backend/actions/runs/40405256772) a **démontré une asymétrie** de parcours sur l'intention « non soumis » : le chemin historique acceptait une PO `pending`, contrairement au chemin regroupé `draft`. Ce sont deux exécutions distinctes, ne pas les confondre.

## Doctrine pour la généralisation

1. **Intention / entrée** : comparer des situations métier réellement équivalentes (mapping `pending` / `draft` explicite, non supposé).
2. **Chemin** : capturer et identifier les chemins réellement parcourus, pas seulement tester une fonction homonyme.
3. **Décision** : `ACCEPT`, `QUARANTINE`, `REJECT` ; motifs canoniques, pas libellés.
4. **Effets** : joindre les écritures SQL indépendantes, états et allocations. Le moteur actuel ne compare que `NONE` / `PERSISTED`, pas les montants, la custody complète ou les cardinalités.
5. **Oracle externe** : une divergence est `PATH_ASYMMETRY_HYPOTHESIS`, jamais automatiquement un bug. Un accord entre chemins ne démontre pas qu'ils sont tous les deux corrects.

## Bornes des preuves

- **Ce qui est prouvé** : un seul segment interne Purchasing → Hub, avec PostgreSQL, cas bornés, après correction ; pas de données Railway.
- **Ce qui n'est pas prouvé** : le parcours réel navigateur/HTTP, paiement, fournisseur externe, transport, relais, remise, clôture finance, ni une couverture générale des features.
- **Statut oracle** : `UNAPPROVED` jusqu'à revue du mapping d'intention par les propriétaires métier.

**Prochaine extension, sans usine à gaz :** mêmes traces normalisées sur un Golden E2E guidé (sourcing → raffinerie → catalogue → marché → paiement → achat → réception Hub → relais → remise → finance), en instrumentant d'abord 2–3 checkpoints transverses déjà certifiés et en réutilisant les preuves canoniques existantes.
