# LOT 4L — Sourcing entrypoint cutover

## But

Réduire les deux anciennes pages strictement Sourcing déjà absorbées par le Workspace 4E à **une seule surface Canonical**, sans masquer les capacités partenaires qui ne lui appartiennent pas.

## Convergence

- `/admin/sourcing` → `/admin/workspaces/sourcing`
- `/admin/sourcing-scanner` → `/admin/workspaces/sourcing`

La redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.

## Exception volontaire — Suppliers

`/admin/suppliers` reste Legacy. `SuppliersView` historique administre plusieurs familles de partenaires ; le Workspace 4E ne possède volontairement que `partner_type = sourcing`.

Le cutover ne doit donc ni masquer ni réattribuer :
- transitaires ;
- relais ;
- partenaires personnalisés ;
- équipes Hub.

## Invariants

- aucune API Sourcing modifiée ;
- aucun lifecycle `sourcing_candidates` modifié ;
- le moteur margin/rail homonyme reste `economic-engine` ;
- aucune fusion d’ownership `sourcing` / `economic-engine` / `catalog` ;
- aucune autorité marché inventée : le sourcing reste global sous `sourcing_global_access_grants` ;
- aucun UUID interne exposé par le navigateur Canonical ;
- Product 360 reste le drill-down produit ;
- RESET n’est pas touché.

## Preuve

Le bootstrap doit prouver les deux redirections, les deux rollbacks `?legacy=1` et le maintien de `/admin/suppliers` en Legacy 1. Les tests du Workspace, du lifecycle candidat, du moteur margin/rail réutilisé et du grant global doivent rester verts, ainsi que les gates Backend/Governance.
