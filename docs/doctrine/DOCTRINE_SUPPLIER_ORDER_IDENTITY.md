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
10. `requireOrderIdentity: false` est réservé aux chemins historiques de refresh explicitement identifiés ; aucun chemin Purchasing ne peut rendre l'identité optionnelle par défaut ou par inférence.
11. `supplier_sku` est l'identité de réconciliation catalogue ; il ne remplace jamais `supplier_unit_ref + supplier_order_identity` comme identité de commande.
12. Une re-promotion peut compléter une identité de commande précédemment absente uniquement à partir d'une identité native fournie par le fournisseur.
13. Une identité de commande déjà persistée ne peut jamais être remplacée silencieusement. Toute divergence de `supplier_unit_ref` ou de payload canonique bloque avec `BLOCKED_SUPPLIER_IDENTITY`.
14. Le coeur Fulfillment ne parse jamais `supplier_order_identity.payload` : seul l'adapter dont `provider` correspond à l'identité peut interpréter ce payload.
15. Un adapter fournisseur ne peut inventer aucun statut métier propre : il doit ramener son résultat vers le référentiel canonique Supplier Fulfillment Readiness.
16. `ready=true` est réservé exclusivement au statut `FULFILLMENT_READY` ; tout verdict contradictoire est rejeté comme `PREFLIGHT_FAILED`.

## Adaptateurs

Chaque connecteur fournisseur est responsable de deux opérations :

- **ingestion** : traduire son identité native vers `supplier_unit_ref + supplier_order_identity` ;
- **purchasing** : traduire cette identité opaque vers le payload de commande natif.

Le domaine Purchasing ne doit jamais parser directement un payload brut d'import pour deviner une variante.

### Supplier Fulfillment Adapter Contract

L'interface fournisseur côté readiness est volontairement minimale et universelle :

```text
adapter.provider  -> identifie exactement le provider supporté
adapter.evaluate() -> retourne un verdict canonique Purchasing
```

Le moteur générique lui fournit l'identité opaque, le SKU persisté, la quantité, la destination et le contexte technique. Il ne connaît ni `sku_id`, ni `sku_attr`, ni `variant_id`, ni `seller_sku`, ni aucun autre identifiant natif.

Le résultat d'un adapter doit utiliser exclusivement l'un des statuts canoniques :

- `FULFILLMENT_READY`
- `BLOCKED_SUPPLIER_IDENTITY`
- `SKU_INACTIVE`
- `OUT_OF_STOCK`
- `SUPPLIER_UNAVAILABLE`
- `PRICE_DRIFT_BLOCKED`
- `NOT_SHIPPABLE`
- `FREIGHT_UNAVAILABLE`
- `PREFLIGHT_FAILED`

Une erreur technique inattendue qui échappe à l'adapter est normalisée par le coeur en `PREFLIGHT_FAILED`. Un adapter dont le provider déclaré ne correspond pas à `supplier_order_identity.provider` n'est jamais exécuté.

L'universalité est considérée prouvée seulement si un second fournisseur peut utiliser un payload natif différent — par exemple `{ "variant_id": "VAR-42" }` — sans modification du moteur `supplier-fulfillment-readiness`.

## Persistance canonique

Le premier lot a introduit l'identité dans le contrat `NormalizedSupplierProduct V2`. Elle est conservée dans `normalized_source_contract` et survit à la suppression volontaire de `raw_payload` dans ce snapshot.

Le lot de persistance canonique ajoute désormais directement sur `product_skus` :

- `supplier_unit_ref` ;
- `supplier_order_identity`.

Ces colonnes sont nullables par doctrine : aucune identité historique n'est backfillée ou inventée. `NULL` signifie honnêtement que le SKU n'est pas encore **Supplier-Mapped**.

Pendant promotion ou re-promotion, une identité native peut remplir une identité jusque-là absente. Si une identité est déjà persistée, le replay doit soit reproduire la même identité, soit ne pas la modifier ; toute tentative de remap implicite est bloquée.

La présence d'une Supplier Order Identity canonique rend possible le gate **Supplier-Mapped**, mais elle ne suffit pas à elle seule à déclarer le SKU **Fulfillment Ready**. Le statut Fulfillment Ready exige encore les contrôles dynamiques applicables : disponibilité fournisseur, stock, prix dans les tolérances, destination/fret et preflight sur la même identité.

Les promotions historiques sans identité restent utilisables comme point de départ d'un refresh fournisseur, mais jamais comme autorité suffisante pour construire une commande fournisseur.
