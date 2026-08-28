# LOT 4I — Client Index Canonical

## But

`/admin/clients` devient une surface Canonical de **recherche et navigation** vers Client 360.
Elle ne devient ni un cinquième Overview Dashboard, ni un Workspace métier, ni un CRM.

## Frontière

- **Commerce** analyse la performance et les segments commerciaux.
- **Client Index** trouve un client visible dans le périmètre autorisé.
- **Client 360** explique ce client et ses facettes visibles.

## Autorité

La sécurité est résolue avant lecture côté serveur :

- `GET /api/admin/entities/clients` : autorité dashboard globale explicite obligatoire ;
- `GET /api/admin/entities/clients/market/:marketCode` : marché actif résolu serveur puis `MarketScope` obligatoire, sauf autorité globale explicite ;
- `market_id` et `marketId` fournis par le navigateur sont refusés ;
- aucune UUID de marché, utilisateur ou commande n'est publiée.

## Projection

L'index expose uniquement des observations préparées côté serveur :

- nom et téléphone métier ;
- nombre de commandes ;
- valeur client et panier moyen ;
- première / dernière commande ;
- marchés métier visibles ;
- pagination et tri bornés.

Aucune segmentation VIP / risque / dormant n'est recalculée dans cette surface.

## Cutover

- `/admin/clients` → Canonical ;
- `/admin/clients/:phone` → Client 360 Canonical ;
- `/admin/clients?legacy=1` → rollback Legacy 1 ;
- `/admin-next/clients` → redirection vers `/admin/clients`.

## Vérification

```bash
npx jest tests/unit/client-index-service.test.js tests/unit/admin-client-index-route.test.js tests/unit/canonical-client-index.test.js --runInBand
npm run feature:registry
npm run gate:schema
npm run gate:touched-files
npm run gate:docs-lint
npm run gate:feature-audit
npm run map:check
```
