# Client 360 Canonical — LOT 3B

## Mission

Client 360 explique un client à partir des vérités déjà possédées par les domaines Komerce. Il n’est ni un dashboard de portefeuille clients, ni un workspace de mutation, ni une copie de `ClientsView`.

URL stable :

```text
/admin/clients/:clientPhone
```

API :

```text
GET /api/admin/entities/clients/:clientPhone
```

Le téléphone est l’identifiant métier de navigation retenu pour ce premier lot, conformément au détail client historique déjà résolu par téléphone. Aucune UUID utilisateur n’entre dans l’URL ni ne sort dans le payload public.

## Autorité marché

### Opérateur pays

```text
session admin
→ operator_market_scopes côté serveur
→ résolution du téléphone uniquement à travers les commandes des marchés autorisés
→ projection Client 360 limitée aux mêmes marchés
```

Un client qui existe uniquement sur un marché non autorisé est indistinguable d’un client absent : réponse `404 client_not_found`.

Le navigateur ne fournit jamais de `market_id` autoritatif.

### Central global

```text
dashboard_global_access_grants
→ autorité globale explicite
→ projection consolidée cross-market
```

Le rôle `admin` seul ne suffit pas à transformer une vue pays en vue globale.

## Facettes V1

### Identité

- nom ;
- téléphone ;
- email ;
- pays ;
- première et dernière commande visibles.

### Commerce / finance

- commandes valides / annulées ;
- LTV visible ;
- panier moyen ;
- paiements payés / non payés ;
- marchés visibles ;
- produits les plus achetés.

Ces valeurs sont calculées côté serveur à partir des commandes autorisées. Le navigateur ne somme ni commandes, ni montants, ni quantités.

### Notifications

Les notifications sont résolues via la commande (`client_notifications.entity_id → orders.id`) puis filtrées par `orders.market_id`.

### Facettes compte globales

Les éléments suivants sont **global-only** et ne sont jamais exposés à un opérateur pays :

- listes partagées organisées ;
- rôle et métadonnées de compte ;
- état WebAuthn / passkeys.

Cette règle évite de découper artificiellement une liste partagée multi-marchés et empêche un opérateur local de reconstituer l’état global du compte.

La sécurité WebAuthn reste volontairement grossière : nombres de credentials actifs/révoqués et dates d’enrôlement/dernier usage. Aucun `credential_id`, aucune clé publique, aucun AAGUID ni label appareil n’est publié.

## Timeline

La timeline est construite côté serveur à partir des facettes déjà autorisées :

- commandes ;
- notifications ;
- listes partagées uniquement en vue globale ;
- premier enrôlement passkey uniquement en vue globale.

Le navigateur ne fusionne ni ne trie des sources métier concurrentes.

## Invariants de sécurité

1. aucune UUID `user_id`, `order_id`, `market_id` ou `shared_cart_id` n’est publiée ;
2. aucun identifiant WebAuthn sensible n’est publié ;
3. un opérateur sans MarketScope ne peut pas résoudre un client ;
4. un opérateur pays ne peut pas déduire l’existence d’un client hors de son périmètre ;
5. les facettes compte globales exigent l’autorité globale explicite ;
6. la route est read-only et `Cache-Control: private, no-store` ;
7. `/admin/clients` reste Legacy 1 jusqu’à reconstruction d’une vraie surface de recherche/navigation clients ; seul `/admin/clients/:clientPhone` est Client 360 Canonical dans ce lot.

## Sources

- `users`
- `recipients`
- `orders`
- `markets`
- `relais`
- `order_items`
- `products`
- `client_notifications`
- `shared_carts` / `shared_cart_items` (global only)
- `webauthn_credentials` (global only)

## Legacy

`GET /api/dashboard/clients/detail?phone=...` et `ClientsView` restent des témoins historiques. Client 360 ne les appelle pas et ne les importe pas.
