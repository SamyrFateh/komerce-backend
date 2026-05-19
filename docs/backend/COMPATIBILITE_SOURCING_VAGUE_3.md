# Compatibilité Sourcing ↔ Vague 3 (Variantes)

> Audit ciblé du pipeline de sourcing pour vérifier l'interaction
> avec la migration `063_product_variants.sql` proposée.

---

## TL;DR — Réponse courte

**Oui, c'est compatible.** Le pipeline sourcing existant n'est pas impacté
par la migration de variantes. Plus précisément :

- Le sourcing crée des produits sans variantes (`is_active=FALSE`,
  `lifecycle_status='candidate'`, `has_variants=false` par défaut).
- Le format pivot `NormalizedSupplierProduct` ne porte aujourd'hui aucune
  notion de variante — donc rien ne se perd à l'import.
- Le frontend de la modal (déjà déployé) reste invisible tant que
  `has_variants=false`. Comportement identique à aujourd'hui.

**Mais il y a un point à anticiper** pour quand tu activeras vraiment des
variantes (Vague 3 phase 4). Voir §3 ci-dessous.

---

## 1. Pipeline sourcing tel qu'il existe

```
┌─────────────────────┐
│ CSV / manuel / API  │  → connecteurs (csv, manual, noon-stub)
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ NormalizedSupplier  │  → format pivot, simple, SANS variantes
│ Product (validé)    │     (cf. services/suppliers/normalized-product.js)
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ supplier_catalog_   │  → trace l'import
│ imports             │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ sourcing_candidates │  → un par produit candidat, état = 'raw_imported'
│ (state machine)     │     puis 'normalized' → 'scanned' → ...
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ pricing-engine scan │  → calcule prix de vente, marge, decision
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Décision admin      │  → 'imported_to_catalog' | 'rejected' | 'watchlist'
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ INSERT INTO products│  → is_active=FALSE, lifecycle_status='candidate'
│ (sourcing-scanner   │     pas de variantes posées ici
│  .js ligne 506)     │
└─────────────────────┘
```

## 2. Ce qui touche / ne touche pas

### ✅ Ne touche PAS le sourcing

| Élément Vague 3 | Impact sourcing |
|-----------------|-----------------|
| Nouvelle table `product_variants` | Aucun. Les candidats n'y écrivent pas. |
| Colonne `order_items.variant_combo` | Aucun. Le sourcing ne crée pas d'`order_items`. |
| Colonne `products.has_variants` | Default `FALSE` → tous les produits importés depuis le sourcing seront créés avec `has_variants=false`. Comportement identique à aujourd'hui. |
| Modif `GET /api/products/:id` | Si `has_variants=false` → ne charge pas les variantes. Aucune différence sur les produits issus du sourcing. |
| Modif `confirmPaymentCycle` | Si `item.variant_combo` est NULL (cas par défaut) → comportement strictement identique à aujourd'hui. |

### ⚠️ Pourrait toucher le sourcing dans le futur

| Cas | Quand ? | Comment gérer ? |
|-----|---------|-----------------|
| Un fournisseur fournit déjà des variantes (CSV avec colonnes "size", "color") | Quand un nouveau connecteur ou un CSV vendor inclut ces colonnes | Étendre `NormalizedSupplierProduct` avec un champ optionnel `variants?: {type, value, ...}[]` et adapter `csv-connector.js` pour le mapper. **Hors scope Vague 3 actuelle.** |
| L'admin importe un candidat ET veut poser des variantes en même temps | Quand l'UI admin de saisie variantes existera (phase 5) | Soit l'admin importe nu puis pose les variantes en 2 temps (workflow simple), soit on ajoute un endpoint combiné. **Choix UX à faire.** |
| Le pricing-engine doit-il scanner par variante ou par produit ? | Quand les vendeurs auront des variantes avec prix différents | Le `purchase_price_kmf` du candidat reste au niveau produit. Si une variante a `price_kmf` override, le scan reste au niveau candidat (ce qui est ok parce que la marge se calcule au niveau produit, pas variante). **Pas d'impact dans la Vague 3.** |

---

## 3. Le seul point à anticiper (mais pas pour cette PR)

Le `INSERT INTO products` du sourcing-scanner (ligne 506-523 de `routes/sourcing-scanner.js`) crée le produit **sans** poser `has_variants=true`. C'est le comportement correct par défaut.

**Quand un admin voudra ajouter des variantes à un produit issu du sourcing**, il appellera l'endpoint que je propose :

```
POST /api/products/:id/variants
```

Cet endpoint (cf. spec V2 §3.3) fait exactement ce qu'il faut :
1. Insère les variantes dans `product_variants`
2. Met `products.has_variants = true`

Donc **le workflow est déjà cohérent** :
- Import candidat → produit nu (`has_variants=false`)
- Admin valide / active le produit
- (Optionnel) Admin ajoute des variantes via le futur endpoint POST variantes
- Le frontend affiche l'UI variantes uniquement à partir de cet ajout

**Aucune modification du sourcing-scanner n'est nécessaire pour la Vague 3.**

---

## 4. Question subsidiaire : et si un fournisseur livre déjà des variantes en CSV ?

Cas concret : ton vendeur Komerce fait un export Excel avec des lignes du genre :

```
SKU       | Name              | Color | Size | Price | Stock
TS-BLU-S  | T-shirt artisanal | Bleu  | S    | 5000  | 3
TS-BLU-M  | T-shirt artisanal | Bleu  | M    | 5000  | 5
TS-RED-S  | T-shirt artisanal | Rouge | S    | 5000  | 2
```

**Aujourd'hui**, le CSV connecteur traite chaque ligne comme **un produit
distinct**. Tu te retrouverais avec 3 candidats séparés, alors qu'en réalité
c'est 1 produit avec 2×2 variantes.

**Pour gérer ce cas dans le futur** (hors Vague 3 actuelle), il faudra :

1. **Étendre `NormalizedSupplierProduct`** avec un champ optionnel :
   ```js
   /**
    * @property {Array} [variants]  Variantes de ce produit (taille, couleur, etc.)
    *   Format: [{ type: 'Couleur', value: 'Bleu', stock: 3, ... }, ...]
    *   Si absent, le produit n'a pas de variantes (cas par défaut).
    */
   ```

2. **Adapter `csv-connector.js`** pour grouper les lignes par "produit pivot"
   (clé naturelle : nom + catégorie, ou un nouveau champ `parent_sku`).

3. **Adapter le scanner** pour propager `variants` dans `sourcing_candidates`
   (nouvelle colonne JSON, ou table de variantes liée).

4. **Adapter `routes/sourcing-scanner.js::import-product`** pour, après
   l'INSERT du produit, faire automatiquement le `POST /api/products/:id/variants`
   avec les variantes du candidat.

**Effort estimé** : 4h, à faire séparément quand tu auras un cas concret.
**Pas un blocker pour la Vague 3 actuelle.**

---

## 5. Vérifications à faire avant la phase 4 (déploiement)

Avant de pousser la modif `confirmPaymentCycle` (la plus risquée car elle
touche à la décrémentation de stock R5), faire un test d'intégration sur
un produit issu du sourcing :

- [ ] Importer un candidat via le sourcing scanner.
- [ ] Activer le produit (passer `is_active=TRUE`, `lifecycle_status='active'`).
- [ ] Passer une commande sur ce produit **sans** variant_combo.
- [ ] Vérifier que `confirmPaymentCycle` décrémente bien le stock global.
- [ ] **Vérifier qu'aucune entrée `product_variants` n'a été touchée** (puisque
      `has_variants=false`).

Si ce test passe → sourcing 100% compatible.

---

## 6. Récap

| Question | Réponse |
|----------|---------|
| Le sourcing existant continue-t-il à fonctionner après la migration `063_product_variants.sql` ? | **Oui**, sans aucune modification de code. |
| Les produits issus du sourcing peuvent-ils ensuite avoir des variantes ? | **Oui**, via le nouveau endpoint POST variantes (Vague 3 phase 3). |
| Faut-il modifier `routes/sourcing-scanner.js` pour la Vague 3 ? | **Non**, pas pour cette vague. |
| Y a-t-il un risque que la migration casse une fonctionnalité existante ? | **Non**. `has_variants` default `FALSE`, `variant_combo` default `NULL`, et le code de `confirmPaymentCycle` reste comportement-identique sur les items sans `variant_combo`. |
| Le format `NormalizedSupplierProduct` doit-il évoluer ? | **Pas tout de suite**. À faire séparément si/quand un fournisseur fournit des variantes en CSV. |

**Le sourcing et la Vague 3 sont des couches indépendantes qui se branchent
proprement via l'interface `products.has_variants`.**
