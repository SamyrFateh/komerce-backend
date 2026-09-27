# Doctrine — Certification canonique Catalogue & Sourcing

## 1. Objet

La certification Komerce ne valide pas qu'un fournisseur a renvoyé une ligne ni qu'un produit existe en base. Elle valide qu'une entrée a traversé les frontières canoniques applicables, que les invariants métier sont satisfaits et que l'issue reste explicable.

Les fournisseurs et les tailles de campagnes ne définissent jamais la certification. CJ, AliExpress, CSV, JSON, saisie manuelle ou une future source utilisent les mêmes contrats après adaptation à la frontière.

Les campagnes 700 et 712 sont des corpus E2E de preuve et de non-régression. Elles ne sont pas la définition du système.

## 2. Principe de comptabilité totale

Toute campagne de certification possède un nombre d'entrées connu.

La comptabilité canonique est :

```text
INPUT_TOTAL
=
CERTIFIED
+ QUARANTINED
+ REJECTED
+ DUPLICATES
+ ARCHIVED
+ OTHER_TERMINAL
```

Deux quantités sont obligatoires :

```text
UNACCOUNTED = max(0, INPUT_TOTAL - TERMINAL_TOTAL)
OVERFLOW    = max(0, TERMINAL_TOTAL - INPUT_TOTAL)
```

Une certification batch n'est équilibrée que si :

```text
UNACCOUNTED = 0
OVERFLOW    = 0
```

Une entrée non certifiée, non rejetée, non quarantinée et non classée dans un autre état terminal explicite reste **UNACCOUNTED**. Elle ne peut jamais disparaître silencieusement d'un rapport.

Un double comptage produit **OVERFLOW** et invalide également le batch.

## 3. Certification Catalogue

Le contrat canonique est versionné par `services/catalog-certification.js`.

Un candidat catalogue certifié satisfait simultanément les invariants suivants :

- identité fournisseur présente ;
- contrat source normalisé V2 présent ;
- décision Sourcing acceptée lorsqu'elle est requise ;
- titre et description présents ;
- préparation éditoriale française prête ;
- catégorie économique/douanière présente ;
- catégorie boutique canonique présente ;
- sous-catégorie boutique canonique présente ;
- couple catégorie/sous-catégorie actif dans la taxonomie ;
- au moins un média catalogue actif ;
- au moins un SKU fournisseur actif ;
- chaque SKU fournisseur actif possède une Supplier Order Identity complète ;
- le produit reste un candidat inactif avant première publication ;
- aucune exposition marché n'est active avant publication globale ;
- `product-publication-guard` retourne PASS.

Chaque échec produit une raison structurée. Aucun fallback de type `Other`, aucune catégorie racine seule et aucune exception fournisseur ne peuvent transformer un produit incomplet en produit certifié.

## 4. Certification Sourcing

Le miroir Sourcing est versionné par `services/sourcing-certification.js`.

Une observation Sourcing n'est pas certifiée parce qu'elle a été reçue. Elle doit atteindre une issue explicite et traçable.

Les états terminaux canoniques actuels sont :

- `imported_to_catalog` ;
- `quarantined` ;
- `rejected` ;
- `archived`.

Les états de travail comme `raw_imported`, `normalized`, `scanned`, `test_ready` ou `watchlist` ne constituent pas une issue terminale de certification batch.

Pour `imported_to_catalog`, le lien vers un produit catalogue et le contrat source V2 sont obligatoires.

Une quarantaine doit conserver une raison explicite. Un rejet doit conserver sa raison. La provenance brute doit rester traçable.

Les rejets de pré-normalisation stockés dans `supplier_catalog_import_rejections` sont comptés comme rejet ou doublon selon leur `reason_code`.

## 5. Symétrie

```text
SOURCING
Komerce -> fournisseur -> observation -> issue explicite
                                  |
                                  v
                              Raffinerie
                                  |
                                  v
CATALOGUE
source -> normalisation -> produit canonique -> certification
```

Le Sourcing certifie qu'aucune entrée fournisseur ne se perd.

Le Catalogue certifie qu'aucun produit incomplet ne devient une référence prête.

Les deux côtés utilisent la même règle de comptabilité totale.

## 6. Certification positive et négative

Un rejet ou une quarantaine correctement expliqués sont des issues valides du système.

La certification ne signifie donc pas que 100 % des produits sont publiables. Elle signifie que 100 % des inputs ont une issue déterministe et auditable.

```text
VALID        -> CERTIFIED
AMBIGUOUS    -> QUARANTINED
INVALID      -> REJECTED
DUPLICATE    -> DUPLICATES
INEXPLIQUE   -> UNACCOUNTED -> FAIL
```

## 7. Versionnement

Chaque verdict expose une `certification_version`.

Une modification de la définition de la certification doit :

1. modifier explicitement la version ;
2. ajouter ou adapter les tests de mutation correspondants ;
3. conserver les anciennes preuves E2E comme historique ;
4. permettre d'identifier les datasets ou produits qui doivent être re-certifiés.

Le nombre de produits d'un dataset n'est jamais une version de certification.

## 8. Tests de mutation

Pour chaque invariant, au moins un test doit prouver le comportement négatif.

Exemples Catalogue :

- source V2 absente ;
- sous-catégorie absente ;
- taxonomie inactive ;
- média absent ;
- SKU absent ;
- Supplier Order Identity partielle ;
- contenu FR non prêt ;
- exposition marché prématurée ;
- publication guard en échec.

Exemples Sourcing :

- état non terminal ;
- provenance brute absente ;
- identité fournisseur absente ;
- produit catalogue non lié après `imported_to_catalog` ;
- quarantaine sans raison ;
- batch avec une entrée perdue ;
- batch avec double comptage.

La valeur d'un test de certification est de devenir rouge lorsque l'invariant est cassé.

## 9. Gates E2E

Les gates de campagne doivent consommer les contrats canoniques au lieu de recopier leur propre logique.

Un script `catalog-e2e-N-acceptance.js` peut fixer un corpus de preuve, mais il ne doit jamais redéfinir ce qu'est un produit certifié.

Le gate 712 consomme donc le contrat Catalogue partagé et ajoute uniquement les propriétés spécifiques de son corpus : composition des cohortes, identités attendues, absence de doublons et présence exacte des références certifiées.

## 10. Invariants canoniques

> **INV-CAT-CERT-01 — Aucun produit n'est certifié sans identité source, contrat canonique, taxonomie boutique catégorie+sous-catégorie active, contenu prêt, média, unité commandable et Supplier Order Identity complète.**

> **INV-SRC-CERT-01 — Toute entrée Sourcing aboutit à une issue explicite et traçable ; aucune source ne possède son propre chemin de certification.**

> **INV-CERT-BATCH-01 — UNACCOUNTED=0 et OVERFLOW=0 sont des conditions bloquantes de certification batch.**

> **INV-CERT-VERSION-01 — La certification est versionnée ; un dataset et un fournisseur sont des preuves, jamais la définition du contrat.**
