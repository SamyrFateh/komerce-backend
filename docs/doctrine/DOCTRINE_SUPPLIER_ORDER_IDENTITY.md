# Doctrine — Supplier Order Identity

## Principe

Une unité vendable Komerce n'est **Fulfillment Ready** que si elle se résout sans ambiguïté vers exactement une unité commandable chez son fournisseur.

La chaîne canonique est :

`product_skus.id → supplier_sku → supplier_unit_ref → supplier_order_identity → adaptateur fournisseur`

`Supplier Order Identity` est universelle. Le coeur Komerce ne connaît jamais les champs techniques propres à AliExpress, CJ, Alibaba, Noon ou un fournisseur local.

## Contrat V2

Une `sellable_unit` peut porter :

- `supplier_sku` : référence métier/source utilisée pour la réconciliation catalogue ;
- `supplier_unit_ref` : référence technique stable de l'unité commandable ;
- `supplier_order_identity` : objet versionné `{ provider, version, payload }`.

Le `payload` est opaque pour le coeur Komerce. Seul l'adaptateur du `provider` peut l'interpréter.

Exemple AliExpress :

```json
{
  "supplier_sku": "14:29#Pink",
  "supplier_unit_ref": "20000098765",
  "supplier_order_identity": {
    "provider": "aliexpress",
    "version": 1,
    "payload": {
      "sku_id": "20000098765",
      "sku_attr": "14:29;5:361386"
    }
  }
}
```

Un autre fournisseur peut utiliser `variant_id`, `seller_sku`, `spec_id` ou tout autre identifiant dans son payload sans modifier le coeur Komerce.

## Séparation identité / état

L'identité est stable :

- fournisseur/provider ;
- référence produit fournisseur ;
- référence unité fournisseur ;
- attributs nécessaires à la commande.

L'état est mouvant et **ne fait jamais partie de l'identité** :

- stock ;
- prix ;
- devise observée ;
- délai ;
- fret ;
- disponibilité ;
- `last_checked_at`.

Un changement de prix ou de stock ne crée donc jamais une nouvelle identité SKU.

## Invariants

1. Zéro heuristique au moment de commander.
2. Une identité doit résoudre exactement une unité fournisseur.
3. `0` résolution ou plusieurs résolutions = `BLOCKED_SUPPLIER_IDENTITY`.
4. Une identité absente n'est jamais reconstruite à partir d'un libellé humain au moment de l'achat.
5. Les anciennes lignes sans identité restent valides pour le catalogue mais ne sont pas déclarées Fulfillment Ready.
6. Un refresh fournisseur peut enrichir/re-promouvoir une identité manquante ; il ne doit jamais l'inventer.
7. Le payload opaque ne doit contenir ni prix, ni stock, ni fret.
8. `placeOrder()` n'est accessible qu'après un preflight qui a revalidé stock, prix, disponibilité et fret contre la même identité.

## Adaptateurs

Chaque connecteur fournisseur est responsable de deux opérations :

- **ingestion** : traduire son identité native vers `supplier_unit_ref + supplier_order_identity` ;
- **purchasing** : traduire cette identité opaque vers le payload de commande natif.

Le domaine Purchasing ne doit jamais parser directement un payload brut d'import pour deviner une variante.

## Migration historique

Les SKU déjà présents avant cette doctrine ne sont pas backfillés artificiellement. Leur `supplier_unit_ref` et `supplier_order_identity` restent `NULL` jusqu'à un refresh/re-import/re-promotion qui fournit une identité native prouvée.
