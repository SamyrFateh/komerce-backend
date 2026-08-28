# LOT 4J — Pricing entrypoint cutover

## But

Réduire quatre anciennes pages Pricing déjà absorbées par le Workspace 4F à **une seule surface Canonical**, sans nouveau dashboard ni nouvelle logique métier.

## Convergence

- `/admin/pricing` → `/admin/workspaces/pricing`
- `/admin/pricing-workshop` → `/admin/workspaces/pricing`
- `/admin/pricing-strategy` → `/admin/workspaces/pricing`
- `/admin/economic-flow` → `/admin/workspaces/pricing`

La redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.

## Invariants

- aucune API Pricing modifiée ;
- aucune autorité de prix/coût/stratégie modifiée ;
- aucun calcul déplacé dans le navigateur ;
- aucun MarketScope ajouté au Pricing global ;
- aucun import Legacy dans `canonical/**` ;
- `SimulatorView` reste hors Pricing ;
- RESET n’est pas touché.

## Hors périmètre

`/admin/costing`, `/admin/economic`, `/admin/settings`, `/admin/simulator` et les vues non explicitement absorbées par 4F restent inchangées.

## Preuve

Le test de bootstrap doit prouver les quatre redirections et les quatre rollbacks `?legacy=1`. Les tests du Pricing Workspace et les gates Backend/Governance doivent rester verts.
