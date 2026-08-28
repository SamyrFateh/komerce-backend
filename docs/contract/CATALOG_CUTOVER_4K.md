# LOT 4K — Catalog entrypoint cutover

## But

Réduire trois anciennes pages Catalogue déjà absorbées par le Workspace 4C à **une seule surface Canonical**, sans nouveau dashboard ni nouvelle logique métier.

## Convergence

- `/admin/products` → `/admin/workspaces/catalog`
- `/admin/categories` → `/admin/workspaces/catalog`
- `/admin/catalog-approval` → `/admin/workspaces/catalog`

La redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.

## Invariants

- aucune API catalogue modifiée ;
- aucune autorité produit, taxonomie ou approbation modifiée ;
- aucun calcul ou règle de publication déplacé dans le navigateur ;
- aucun catalogue par marché inventé ;
- aucun import Legacy dans `canonical/**` ;
- `/admin/products/:productRef` reste Product 360 ;
- variantes avancées et upload média restent hors périmètre ;
- RESET n’est pas touché.

## Preuve

Le bootstrap et le témoin de frontière Catalogue doivent prouver les trois redirections et les trois rollbacks `?legacy=1`. Le témoin d’autorité doit prouver que Catalogue reste dans le groupe des Workspaces globaux indépendants de Dashboard AdminContext. Les tests du Catalog Workspace et les gates Backend/Governance doivent rester verts.
