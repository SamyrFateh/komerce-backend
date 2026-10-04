# Doctrine — INTERNAL_MANAGED Catalogue & Fulfillment

## Objet

Komerce doit supporter des catalogues sans API fournisseur : CSV, XLSX, saisie manuelle, import issu d'un ERP ou d'un partenaire humain.

Ce mode ne doit créer ni second catalogue, ni backdoor d'écriture vers `products`, ni fournisseur fictif utilisé pour contourner Purchasing.

La règle est :

    source humaine / fichier
    → connecteur d'ingestion
    → NormalizedSupplierProduct V1/V2
    → Raffinerie
    → Catalogue canonique
    → mode de fulfillment explicite

Les connecteurs CSV et Manual existants constituent déjà la porte d'entrée. INTERNAL_MANAGED les organise ; il ne les remplace pas.

## 1. Trois axes indépendants

Ne jamais confondre :

### 1.1 Canal d'ingestion

Comment la donnée entre :

    API
    CSV
    XLSX
    MANUAL

Le canal ne dit rien sur l'identité économique du fournisseur ni sur la manière de livrer.

### 1.2 Identité fournisseur

Qui porte le coût / l'obligation B2B lorsqu'il y en a une.

Une source fichier peut représenter :
- un fournisseur tiers sans API ;
- Komerce lui-même ;
- un stock acheté antérieurement ;
- un partenaire local.

Le nom du canal (`csv`, `manual`) ne devient jamais un provider.

### 1.3 Mode de fulfillment

Comment la vente B2C est satisfaite :

    SUPPLIER_DIRECT
    INTERNAL_STOCK

Ces deux modes ont des conséquences Purchasing différentes.

## 2. INTERNAL_MANAGED n'est pas un provider

`INTERNAL_MANAGED` est un mode de gestion du catalogue et de l'exécution, pas une identité fournisseur.

Il ne doit donc pas être ajouté à `provider-authority.js` comme faux provider.

Cette décision respecte la doctrine déjà établie :

    provider identity ≠ execution mode

Même règle pour `manual` : ce n'est pas un provider.

## 3. Deux parcours métier distincts

### 3.1 Catalogue géré par Komerce, fournisseur tiers sans API

Exemple : grossiste envoyant un Excel.

    XLSX / CSV
    → adapter fichier
    → fournisseur tiers identifié
    → V2 exact SKU/SOI interne au contrat Komerce
    → Catalogue
    → vente B2C
    → purchase_line / PO
    → exécution MANUAL_EXTERNAL
    → confirmation / rapprochement

Ici Purchasing reste nécessaire après la vente si Komerce n'a pas déjà le stock.

### 3.2 Catalogue et stock possédés/gérés par Komerce

    CSV / XLSX / saisie
    → Catalogue
    → stock interne disponible
    → vente B2C
    → réservation stock
    → préparation / sortie stock
    → coût de stock consommé
    → comptabilité B2C + coût interne

Ici la vente B2C ne crée PAS une nouvelle obligation fournisseur.

Le comportement actuel `fulfillment_source = LOCAL_STOCK` qui fait ignorer la ligne par `triggerPurchasing()` est donc cohérent avec ce parcours.

Le coût B2B existe en amont, au moment où le stock a été acquis ou produit, pas sous forme d'une nouvelle PO fournisseur à chaque vente.

## 4. Contrat d'ingestion unique

CSV, XLSX et saisie manuelle doivent converger vers le même pivot :

    NormalizedSupplierProduct V1 / V2

Aucune source gérée manuellement ne peut écrire directement :
- `products` ;
- `product_skus` ;
- `product_variants` ;
- `catalog_media`.

La promotion appartient aux propriétaires Catalogue existants.

## 5. Identité des unités sans API

Une unité vendable doit rester déterministe.

Pour un fournisseur tiers sans API, Komerce peut porter une Supplier Order Identity interne dérivée de références métier explicitement fournies, par exemple :

    provider = identité réelle du fournisseur supporté
    supplier_unit_ref = référence fournisseur stable
    payload = référence(s) nécessaires à une commande manuelle non ambiguë

Pour du stock interne, la traçabilité repose d'abord sur :
- `product_sku_id` ;
- référence interne SKU ;
- lot / coût de stock lorsqu'un modèle de lot existe ;
- `fulfillment_source = LOCAL_STOCK`.

Ne jamais inventer une SOI fournisseur externe pour un stock qui n'a plus d'obligation fournisseur au moment de la vente.

## 6. CSV et XLSX

### CSV

Le connecteur existant `csv-connector.js` :
- parse RFC-4180 ;
- conserve `raw_payload` ;
- rejette devise absente, valeurs numériques invalides, doublons ;
- ne fabrique pas de défaut silencieux.

Il produit aujourd'hui principalement le contrat plat historique.

### XLSX

XLSX doit être un adapter de transport vers le même modèle de lignes que CSV, pas un second moteur d'import.

Principe :

    XLSX workbook
    → feuille explicite
    → lignes structurées
    → mapping canonique
    → mêmes validations que CSV
    → NormalizedSupplierProduct

Les règles de rejet doivent être identiques à données équivalentes.

## 7. Richesse V2 pour les fichiers

Le format fichier doit pouvoir exprimer, sans heuristique :

- médias multiples ;
- axes de variantes ;
- unités vendables ;
- `supplier_sku` ;
- `supplier_unit_ref` ;
- stock unité ;
- coût unité + devise ;
- associations média ↔ options ;
- identité de commande lorsque nécessaire.

Un fichier plat incomplet reste V1 honnêtement.

Un fichier riche ne doit jamais être aplati en V1 puis reconstruit plus tard.

## 8. Réimport et idempotence

Un même produit / SKU ne doit pas être dupliqué par rejeu du même fichier.

Le contrat M1/M2 doit définir :
- clé source stable ;
- clé produit fournisseur ;
- clé unité/SKU ;
- politique update vs create ;
- traitement explicite des suppressions ;
- traitement du stock zéro ;
- version/import batch ;
- audit de la provenance.

Un nom produit n'est jamais une clé d'idempotence.

## 9. Stock interne

Pour INTERNAL_STOCK, la source de vérité commerciale n'est plus un stock fournisseur live.

Il faut distinguer :

    on_hand
    reserved
    available = on_hand - reserved

Le checkout ne peut consommer qu'un stock disponible confirmé.

La réservation et la décrémentation doivent être idempotentes face aux retries de paiement/order.

Ce chantier appartient à M3/M4 ; M0 ne modifie pas encore le moteur stock.

## 10. Conséquence comptable

### Fournisseur tiers sans API

    vente B2C
    → obligation B2B
    → coût fournisseur confirmé
    → compta B2B scopée
    → rapprochement B2C

### Stock interne

    acquisition / production du stock
    → coût d'inventaire

puis :

    vente B2C
    → consommation du coût du SKU / lot
    → marge réelle

Invariant :

> Une vente sur stock interne ne doit jamais créer artificiellement une dette fournisseur au moment de la vente.

## 11. Certification

INTERNAL_MANAGED utilise la même discipline de preuve, adaptée à une source fichier.

### P0

Process métier et propriétaire du catalogue définis.

### P1

Fichier réel borné et valide :
- CSV/XLSX lisible ;
- colonnes explicites ;
- données obligatoires présentes ;
- aucune correction silencieuse.

### P2

Adapter fichier :

    input fichier
    → NormalizedSupplierProduct exact

### P3

Pipeline :

    import
    → candidate
    → Raffinerie
    → Catalogue
    → SKU/stock/coût exacts

### P4

Golden réel selon le fulfillment.

#### MANUAL_EXTERNAL

    produit fichier
    → vente
    → purchase_line / PO
    → exécution manuelle
    → coût confirmé
    → rapprochement

#### INTERNAL_STOCK

    produit fichier
    → stock interne
    → vente
    → réservation
    → sortie stock
    → coût consommé
    → rapprochement

Les deux P4 ne sont pas interchangeables.

## 12. Ordre M0 → M5

### M0 — Doctrine INTERNAL_MANAGED
Ce document. Aucun nouveau provider, aucune migration, aucune écriture runtime.

### M1 — Contrat fichier canonique
Définir le format riche CSV/XLSX, ses clés et ses rejets.

### M2 — Adapters fichier
CSV riche + XLSX → NormalizedSupplierProduct V2 avec tests de parité.

### M3 — Catalogue / stock interne
Stock, coût, variantes et médias gérés sans API.

### M4 — Exécution
Séparer MANUAL_EXTERNAL de INTERNAL_STOCK ; réservation et fulfillment interne.

### M5 — Golden E2E
Prouver les deux chemins complets.

## 13. Definition of Done M0

M0 est terminé si :

1. INTERNAL_MANAGED n'est pas présenté comme un provider ;
2. canal d'ingestion, identité fournisseur et mode de fulfillment sont séparés ;
3. CSV/Manual passent par le contrat normalisé existant ;
4. XLSX est défini comme adapter vers le même contrat ;
5. fournisseur tiers sans API et stock propre ont deux parcours Purchasing distincts ;
6. LOCAL_STOCK n'entraîne aucune PO fournisseur par vente ;
7. aucune migration ou abstraction hypothétique n'est ajoutée avant M1/M3.
