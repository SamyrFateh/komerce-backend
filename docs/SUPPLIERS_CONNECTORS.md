# Komerce — Connecteurs fournisseurs

> Créé : **2026-06-23** (lot C1)
> Source de vérité : `services/suppliers/connectors/`
> Mis à jour automatiquement : non — toute activation d'un connecteur doit mettre ce fichier à jour.

---

## 1. Architecture générale

Le scanner (`services/supplier-catalog-scanner.js`) ne connaît **aucun fournisseur spécifique**.
Il reçoit des `NormalizedSupplierProduct[]` produits par les connecteurs, et les fait passer par le pipeline suivant :

```
Connecteur → NormalizedSupplierProduct[] → Normalisation KMF + catégorie → Scan pricing → Décision sourcing
```

Aucun produit n'est importé automatiquement dans le catalogue. Un `sourcing_candidate` devient un `product` **uniquement après validation admin explicite**.

La structure attendue de tout connecteur est définie par `NormalizedSupplierProduct` dans `services/suppliers/normalized-product.js`.

### Interface commune (`fetchProducts`)

Tout connecteur expose une fonction ou méthode `fetchProducts(input)` qui retourne :

```js
{
  products: NormalizedSupplierProduct[],  // valides (partitionValid)
  invalid:  [],                           // invalides avec raison
  total:    number,                       // total brut avant partition
}
```

---

## 2. Connecteurs disponibles

### 2.1 `api-connector.base.js` — Classe de base API

| Champ | Valeur |
|---|---|
| Fichier | `services/suppliers/connectors/api-connector.base.js` |
| Type | Interface abstraite (classe `ApiConnectorBase`) |
| État | **Fonctionnel — non instancier directement** |
| Lignes | 157 |

**Rôle** : classe parent pour tout connecteur API fournisseur. Fournit :
- `ensureConfigured()` — vérifie que `base_url` et les credentials env sont présents avant tout appel HTTP.
- `buildHeaders()` — construit les headers HTTP (`apikey`, `bearer`, ou aucun). Ne hardcode jamais de credentials.
- `fetchProducts()` — abstract : lève une erreur explicite si la sous-classe ne la surcharge pas.
- `finalize(products)` — appelle `partitionValid` et retourne `{ products, invalid, total }`.

**Configuration attendue** (`SupplierApiConfig`) :

| Champ | Description |
|---|---|
| `supplier_name` | Nom affiché dans les logs et erreurs |
| `base_url` | URL racine de l'API fournisseur |
| `auth_type` | `'apikey'` \| `'bearer'` \| `'oauth'` \| `'none'` |
| `api_key_env` | Nom de la variable d'env contenant la clé (jamais la clé elle-même) |
| `extra_headers` | Headers additionnels optionnels |
| `pagination` | `{ type: 'cursor'|'page'|'offset', page_size: number }` |
| `category_mapping` | `{ 'cat-fournisseur': 'komerce-cat-key' }` |

**Usage** : pour intégrer un nouveau fournisseur API, créer une sous-classe qui surcharge `fetchProducts()`.

---

### 2.2 `manual-connector.js` — Saisie manuelle admin

| Champ | Valeur |
|---|---|
| Fichier | `services/suppliers/connectors/manual-connector.js` |
| Type | Module fonctionnel (pas de classe) |
| État | **✅ Production ready** |
| Lignes | 95 |

**Rôle** : transforme une saisie formulaire admin (vue Scanner) en `NormalizedSupplierProduct[]`. Normalise les types, regroupe les dimensions, valide via `partitionValid`.

**Input** :

```js
{
  supplier_name: string,     // requis
  items: [{
    product_name: string,
    purchase_price: number,
    currency: string,        // défaut 'AED'
    weight_kg: number,
    dim_l_cm, dim_w_cm, dim_h_cm: number,
    image_url, product_url, description: string,
    stock_available, min_order_qty, supplier_delay_days: integer,
    supplier_product_id: string,
    // ou un objet 'dimensions' déjà groupé
  }]
}
```

**Données réelles importées** : produits saisis manuellement par les admins depuis l'interface Scanner. Volume : à la demande, pas de batch automatique.

**Exports** : `fetchProducts(input)`, `normalizeFormItem(item, supplierName)`.

---

### 2.3 `csv-connector.js` — Import CSV

| Champ | Valeur |
|---|---|
| Fichier | `services/suppliers/connectors/csv-connector.js` |
| Type | Module fonctionnel (pas de classe) |
| État | **✅ Production ready** |
| Lignes | 172 |

**Rôle** : parse un texte CSV brut en `NormalizedSupplierProduct[]`. Séparateur `,` ou `;` auto-détecté. Mapping de colonnes flexible (FR + EN).

**Input** :

```js
{
  supplier_name: string,
  csv_text: string,          // contenu du fichier CSV complet
  csv_mapping?: {            // optionnel — forcer le mapping si headers exotiques
    product_name: 'colA',
    purchase_price: 'colB',
    // ...
  }
}
```

**Colonnes reconnues automatiquement** (alias FR + EN) :

| Champ cible | Alias reconnus |
|---|---|
| `product_name` | name, titre, title, nom, product, designation |
| `purchase_price` | price, cost, prix, prix_achat, unit_price |
| `currency` | devise, cur |
| `weight_kg` | weight, poids, poids_kg |
| `stock_available` | stock, qty, quantity, available, inventory |
| `min_order_qty` | moq, min_order, min_qty |
| `supplier_delay_days` | delay, lead_time, delai |
| `supplier_product_id` | sku, ref, reference, product_id |
| `dim_l/w/h_cm` | length/width/height, longueur/largeur/hauteur, l/w/h |
| `supplier_category` | category, cat, famille |

**Limitations** : parsing simple sans papaparse — pas de virgules dans les valeurs, pas de multi-lignes dans les champs. Suffisant pour les catalogues admin actuels.

**Données réelles importées** : imports batch depuis catalogues fournisseurs (format tableur exporté en CSV).

**Exports** : `fetchProducts(input)`, `parseCSV(csvText, mapping)`, `rowsToNormalized(rows, supplierName)`, `DEFAULT_HEADER_ALIASES`.

---

### 2.4 `noon-connector.js` — Connecteur Noon (placeholder)

| Champ | Valeur |
|---|---|
| Fichier | `services/suppliers/connectors/noon-connector.js` |
| Type | Sous-classe de `ApiConnectorBase` |
| État | **⛔ INACTIF — placeholder uniquement** |
| Lignes | 81 |
| `IS_ACTIVE` | `false` |

**Rôle** : marque la place d'un futur connecteur vers l'API Noon (marketplace). Lève une erreur explicite si quelqu'un tente de l'activer.

**fetchProducts()** : lance `throw new Error('[Noon] Connecteur API non actif ...')`.

**Pour activer ce connecteur, il faut** (dans l'ordre) :

1. Obtenir l'accès officiel à l'API Noon (programme partenaires / API marchand).
2. Récupérer la documentation officielle : URL racine, schéma d'auth, format des réponses, pagination, rate limits, mapping catégories.
3. Définir les credentials en variables d'environnement (`NOON_API_KEY` ou équivalent, **jamais en dur**).
4. Implémenter `fetchProducts()` dans ce fichier (remplacer le `throw`).
5. Câbler côté `routes/sourcing-scanner.js` : `source_type='api', supplier='noon'` → router vers ce connecteur.

**Aucune de ces 5 étapes n'est faite à ce jour.** Ne pas activer sans les compléter.

---

## 3. Intégration avec `supplier-catalog-scanner.js`

Le scanner (`services/supplier-catalog-scanner.js`, 295 lignes) est appelé **après** que le connecteur a produit les `NormalizedSupplierProduct[]`. Il ne sait pas quel connecteur a été utilisé.

Pipeline complet :

```
1. Route reçoit la requête admin
2. Route choisit le connecteur selon source_type (manual / csv / api)
3. Connecteur.fetchProducts() → { products, invalid, total }
4. supplier-catalog-scanner.js.scanCatalog(products, options)
   ├── convertToKMF()         — prix fournisseur → KMF (AED/EUR/USD)
   ├── mapCategory()          — cat fournisseur → customs_categories.key Komerce
   ├── estimateWeight()       — weight_kg ou estimation volume
   ├── pricingEngine.scan()   — CDR, marges, décision sourcing
   └── → sourcing_decision + reason par produit
5. Route persiste en BDD (sourcing_candidates) + admin décide
```

---

## 4. Fournisseurs supplémentaires prévus

| Fournisseur | État | Priorité |
|---|---|---|
| **Noon** | Placeholder créé, API non obtenue | Basse (accès partenaire requis) |
| **Aliexpress** | Non planifié | Non défini |
| **Amazon** | Non planifié | Non défini |
| **Fournisseurs locaux Comores** | Via saisie manuelle ou CSV | Couvert par connecteurs existants |

Pour ajouter un fournisseur API : créer une sous-classe de `ApiConnectorBase`, câbler dans les routes, mettre à jour ce document.

---

## 5. Ajout d'un nouveau connecteur — checklist

- [ ] Créer `services/suppliers/connectors/<nom>-connector.js`
- [ ] Hériter de `ApiConnectorBase` (si API) ou exporter `fetchProducts(input)` directement (si format custom)
- [ ] Ajouter un header `@komerce-arch` complet
- [ ] Exposer `IS_ACTIVE: false` tant que non prêt en production
- [ ] Câbler dans la route scanner (source_type correspondant)
- [ ] Ajouter une section dans ce document
- [ ] Ajouter une entrée dans `docs/README.md` si le document devient opérationnel
