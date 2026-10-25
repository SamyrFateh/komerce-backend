# Komerce — analyse des signaux du scanner métier
**État : expérimental / lecture seule / aucune correction métier ni écriture Railway.**

Référence des chiffres : CI [#40188824871](https://github.com/SamyrFateh/komerce-backend/actions/runs/40188824871), SHA `c005a16c5fb2f8a548e29d2701521b699bf4ac6f`.
Ce document contient une **classification** ; les fichiers machine détaillés sont les artefacts `audit-results/discovery/findings.json`, `audit-results/triage/signal-triage.json`, et `audit-results/calibration/calibration.json`.

## 1. Ne pas confondre un signal, une preuve manquante et un bug

**331 signaux** (recouvrements possibles, pas 331 problèmes indépendants) sur **36 cartes métier, 200 tables, 476 invariants et 2 692 déclarations de fichiers**.

| Famille | Signaux | Niveau de preuve |
|---|---:|---|
| Invariant métier sans preuve exécutable | 244 | Déficit de certification, pas démonstration de bug |
| Invariant BD testé uniquement avec mock | 13 | Déficit de certification |
| Test déclaré avec parcours skip | 8 | À inspecter selon les conditions CI, pas échec démontré |
| Écriture interdomaines déclarée | 59 | À relier à une véritable mutation et une autorité colonne |
| Patterns source nouveaux | 7 | Suspicions de séquences métiers à étalonner |
| **Total** | **331** | Aucun compteur statique ne certifie un bug |

**Interdomaines (59) :** 22 ont un indice textuel SQL direct, 37 n'ont que le `@db-write` / une déclaration. Le tri de ces 59 aboutit à **6 sites de dette connus**, **14 opérations de simulation/admin/maintenance à recontextualiser**, **2 écritures SQL non enregistrées à examiner**, et **37 déclarations sans SQL visible**. Un commentaire `UPDATE orders` ne compte plus comme une écriture.

## 2. Les cinq anomalies reproduites sur vraie base isolée

| Cas | Nominal | Contradiction prouvée | Pattern |
|---|---|---|---|
| Inventory / Orders | Une ligne A est reçue dans A | La ligne A peut être reçue dans la commande B ; réception B créditée | `CALLER_IDENTITY_OVERRIDES_CANONICAL_ROW` |
| Auto-parcel | INSERT 1 ligne → compteur 1 | Conflit PostgreSQL `rowCount=0` → compteur quand même 1 | `SILENT_CONFLICT_COUNT_AS_SUCCESS` |
| Hub / Sourcing | Produit reconditionnable : 30 000 → 10 000 cm³, densité 600 | Produit exempt : même valeur acceptée et utilisée, 600 au lieu de 200 | `AUTHORITATIVE_EXEMPTION_IGNORED_BY_DOWNSTREAM_CONSUMER` |
| Catalogue JSON / Sourcing | Nouveau prix fournisseur 100 → 120, non manuel | Prix marqué `manual` 100 écrasé à 120 par l'UPSERT du writer extérieur | `CROSS_OWNER_UPSERT_DISCARDS_MANUAL_FIELD_AUTHORITY` |
| Sourcing owner / Sourcing | Prix fournisseur non manuel actualisé, provenance cohérente | Le premier import garde la valeur manuelle mais écrase le marqueur `manual` ; le second import écrase la valeur | `JSONB_MERGE_OVERRIDES_MANUAL_FIELD_AUTHORITY` |

**Éléments de preuve :** `tests/integration/inventory-cross-order-governance-discovery.test.js`, `auto-parcel-calibration-real-db.test.js`, `hub-repack-exemption-calibration-real-db.test.js`, `catalog-json-manual-override-calibration-real-db.test.js`. Le contrat `scripts/audits/calibration-cases.json` exige 5 paires NOMINAL/DEVIATION et échoue si un membre manque. Les 5 ruptures ont été reproduites sur le **même schéma PostgreSQL de CI**, avec lecture des lignes et nettoyage `ROLLBACK`. Auto-parcel utilise un entrelacement déterministe dans une transaction et non une course physique de deux sessions.

**Issues :** Inventory [#2939](https://github.com/SamyrFateh/komerce-backend/issues/2939), Auto-parcel [#2949](https://github.com/SamyrFateh/komerce-backend/issues/2949), Hub [#2951](https://github.com/SamyrFateh/komerce-backend/issues/2951), import JSON [#2952](https://github.com/SamyrFateh/komerce-backend/issues/2952), Sourcing re-import [#2953](https://github.com/SamyrFateh/komerce-backend/issues/2953).

**Il ne s'agit pas d'une observation sur Railway.** Un test de diagnostic vert démontre qu'un défaut est reproductible, pas qu'il est corrigé.

## 3. Ce que les faux positifs nous ont appris

- **Header ≠ écriture :** `cash-deposit-service` délègue l'audit ; `admin-finance-config` délègue les taux.
- **Commentaire ≠ SQL :** mentions `UPDATE orders` dans `payment-paypal` et `pickup-secret-service` étaient des faux indices ; filtrées.
- **Table technique de démo ≠ owner métier :** la table backup `demo_kpr_backup_20261024` n'entre pas dans l'analyse d'exemptions, limitée aux tables déclarées dans la gouvernance.
- **Un writer JSONB qui casse cinq champs ≠ cinq bugs démontrés :** regroupement en un signal par site de fusion, avec liste des champs exposés.
- **Dette connue ≠ bug retrouvé :** `governance/writer-not-owner-debt.json` enregistre 6 frontières, dont des délégations légitimes ; leur présence n'autorise pas un verdict.

## 4. Candidats à vérifier ensuite, sans présumer du résultat

1. **Suppression admin d'une commande** — `routes/admin/delete-order-cascade.js` supprime `scans` ainsi que plusieurs journaux dépendants. Les erreurs de chaque DELETE enfant sont absorbées sous savepoint : vérifier les conditions d'autorisation, l'atomicité du parent appelant, la conservation de l'audit et le résultat effectif selon l'état des dépendances. Une suppression administrative peut être légitime ; aucune anomalie prouvée.
2. **Suppression admin d'un utilisateur** — `routes/admin/users.js` met `scan_events.scanned_by` à NULL sur un hard-delete, mais ignore des erreurs de nettoyage. Il existe un chemin soft-delete pour utilisateur ayant commandes ou historique de scopes. Vérifier que l'historique de preuve et la désactivation sont conformes dans chaque cas ; aucune anomalie prouvée.
3. **Projection des quantités Orders depuis scans** — `services/scan-engine.js#syncOrderFromParcels` est une dette inscrite : vérifier la couverture des lignes après retrait/remplacement de colis, malgré le garde `RC-2` déjà présent. Ne pas ré-annoncer comme nouveau le défaut initial couvert par RC-2.
4. **Désactivation douane → allocations coûts** — suppression hors owner par `customs-shipment-service` inscrite en dette ; vérifier les journaux économiques et l'idempotence du recalcul, pas seulement le `DELETE` SQL.
5. **Borne P1 de provenance manuelle** — traiter [#2952](https://github.com/SamyrFateh/komerce-backend/issues/2952) et [#2953](https://github.com/SamyrFateh/komerce-backend/issues/2953) comme **une chaîne à deux corrections distinctes**. Corriger un seul writer ne protège pas la valeur.

## 5. La méthode pour challenger la généralisation

Chaque pattern doit découvrir ses cibles à partir du schéma, de l'ownership ou des protections déjà connues **sans encoder uniquement les noms des bugs déjà trouvés**. Les détecteurs `EXEMPTION_*` infèrent la relation depuis les colonnes du schéma, le détecteur de provenance compare le writer owner au writer non owner et recherche une fusion JSONB destructrice.

Pour quantifier les faux positifs/négatifs, il reste à construire un **corpus aveugle représentatif**, stratifié par domaine et classe, avec verdicts humains et contre-exemples PostgreSQL indépendants. Les 331 alertes ne permettent pas encore un taux de précision fiable.

**Suite proposée :** traiter d'abord les deux opérations admin destructrices et les deux dettes logistiques/douanières avec des règles métier formalisées, sans changement dans `main`. Réécrire les tests diagnostiques comme non-régressions au moment des futures corrections en PR séparées.