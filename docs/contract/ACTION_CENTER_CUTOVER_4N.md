# LOT 4N — Action Center entrypoint cutover

## But

Réduire les deux anciennes surfaces de constats (`AlertsView`, `ProblemsView`) à **un seul Action Center Canonical**, sans recréer un second moteur d’anomalies.

## Convergence

- `/admin/alerts` → `/admin/action-center`
- `/admin/problems` → `/admin/action-center`

La redirection est HTTP 302 pendant la fenêtre de cutover. Sur chacun de ces pathnames, `?legacy=1` sert encore `public/dashboards/admin/index.html`.

## Vérité Problems

LOT 4H a audité les 10 règles de `ProblemsView` :
- règles prouvables réécrites dans `decision-signals` ;
- règles déjà couvertes non dupliquées ;
- règles non canoniques rejetées ;
- générateurs historiques trompeurs retirés.

Le cutover 4N ne réintroduit donc aucune règle rejetée pour obtenir une parité visuelle artificielle.

## Invariants

- aucune mutation de commande/colis/produit/cash depuis Action Center ;
- lifecycle limité aux signaux (`acknowledge`, `snooze`, `resolve`) ;
- aucun `market_id` inventé tant que `signals` n’en possède pas ;
- `signal_ref` reste l’identité navigateur ;
- drill-down résolu serveur vers références métier publiques ;
- API Legacy `/api/admin/signals` non supprimée par ce lot ;
- RESET n’est pas touché.

## Preuve

Le bootstrap et le témoin Action Center doivent prouver les deux redirections et les deux rollbacks. Les tests `decision-signals`, Action Center et signal-service doivent rester verts, ainsi que les gates Backend/Governance et Security360.
