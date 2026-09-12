# Doctrine — Supplier Order Identity

## Principe

Une unité vendable Komerce n'est **Fulfillment Ready** que si elle se résout sans ambiguïté vers exactement une unité commandable chez son fournisseur.

La chaîne cible est :

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
5. Les anciennes données sans identité restent valides pour le catalogue mais ne sont pas déclarées Fulfillment Ready.
6. Un refresh fournisseur peut obtenir une identité native manquante ; il ne doit jamais l'inventer.
7. Le payload opaque ne doit contenir ni prix, ni stock, ni fret.
8. `placeOrder()` n'est accessible qu'après un preflight qui a revalidé stock, prix, disponibilité et fret contre la même identité.
9. Tout blocage lié à l'identité expose le code métier stable `BLOCKED_SUPPLIER_IDENTITY` ; le texte du message d'erreur n'est jamais le contrat d'intégration.

## Adaptateurs

Chaque connecteur fournisseur est responsable de deux opérations :

- **ingestion** : traduire son identité native vers `supplier_unit_ref + supplier_order_identity` ;
- **purchasing** : traduire cette identité opaque vers le payload de commande natif.

Le domaine Purchasing ne doit jamais parser directement un payload brut d'import pour deviner une variante.

## Lots de persistance

Le premier lot introduit l'identité dans le contrat `NormalizedSupplierProduct V2`. Elle est donc conservée dans `normalized_source_contract` et survit à la suppression volontaire de `raw_payload` dans ce snapshot.

La persistance directe de cette identité sur `product_skus` est un lot séparé et obligatoire avant de déclarer le catalogue **Supplier-Mapped / Fulfillment Ready**. Ce lot devra ajouter les colonnes canoniques et les alimenter pendant promotion/re-promotion, sans backfill heuristique des lignes historiques.

Les promotions historiques restent utilisables comme point de départ d'un refresh fournisseur, mais jamais comme autorité suffisante pour construire une commande fournisseur si l'identité canonique n'est pas présente.
