# Dashboard — protocole de certification finale (21 novembre 2026)

Relie les issues [#4948](https://github.com/SamyrFateh/komerce-backend/issues/4948), [#4949](https://github.com/SamyrFateh/komerce-backend/issues/4949) et la campagne G6 [#4550](https://github.com/SamyrFateh/komerce-backend/issues/4550).

## Préconditions impératives

1. **Staging uniquement** : environnement Railway `superb-presence / staging`, base et origine fixées. Le garde `staging-chromium-deployment-preflight.js` impose l'identité du commit servi (ou l'équivalence prouvée sans changement runtime), sinon STOP.
2. **Sérialisation G6** : workflow `dashboard-final-intersession-readonly.yml` rattaché à la même clé de concurrence que le writer G6, `komerce-g6-canonical-real-transaction`, sans annulation de la campagne en cours.
3. **Droits** : six identités vérifiées via login Chromium, admin, directrice Hub, responsables KM/CM/CG, agent relais. Aucun secret, identifiant client, donnée de commande ou copie d'écran n'est archivé.
4. **Aucune mutation métier** : Playwright refuse tout appel hors GET/HEAD/OPTIONS et POST d'authentification. PostgreSQL est forcé en `default_transaction_read_only=on`, et la transaction est en `BEGIN READ ONLY`. Un `pg_notify` ne constitue *pas* la validation d'un changement métier ; c'est une vérification limitée du transport événementiel.
5. **Flux SSE** : `KOMERCE_DASHBOARD_LIVE_ENABLED=true` est nécessaire pour ce test, uniquement lors d'un essai coordonné en staging. Si désactivé, verdict `NOT_PROVEN`. Ne jamais l'activer en production par ce workflow.

## Exécution

Ouvrir une issue, en tant que propriétaire du dépôt, avec le **titre exact** :

`[staging-op] dashboard-final-intersession-readonly`

Le workflow lit `main`, contrôle le staging, installe Chromium, connecte les six comptes avec les secrets du runner existant puis archive `test-results/dashboard-final/dashboard-intersession-proof.json` même en cas de blocage.

Le verdict `PASS_SYNTHETIC_NOTIFY_READONLY` exige : deux sessions simultanées validées, 4 colonnes Kanban et compteurs strictement égaux à l'API Hub, références PO contrôlées par une lecture PostgreSQL indépendante, refus SSE 403 pour pays et relais, absence de notification sur `ROLLBACK`, notifications sur `COMMIT` et re-fetch de l'API canonique, retour navigateur après perte réseau, 0 mutation navigateur, 0 HTTP 429, et commit servi stable.

Le p95 mesuré sur trois notifications synthétiques indique la latence de *transport* observée, **pas** la latence de chaque transition métier sur un parc d'instances réel.

## Ce que ce protocole NE certifie PAS

- Un événement métier réel (commande, PO, remboursement...) de bout en bout depuis l'écran de l'acteur A jusqu'aux dashboards de B, avec les lignes PG finales. Nécessite une campagne mutative G6 coordonnée, jamais un `UPDATE` direct dans la base partagée.
- Deux ou plusieurs workers Railway : l'environnement observé est mono-réplique. La notification inter-workers doit être prouvée sur une topologie multi-instance isolée.
- 401/403 à la révocation **pendant un flux SSE ouvert** : le middleware n'authentifie qu'à l'établissement/reconnexion, le canal a une durée max de 60 s. Une révocation instantanée ne doit pas être déclarée prouvée par un test 403 à l'ouverture.
- L'actualisation strictement événementielle pour `market_operator` / `agent_relais`, actuellement en fallback ; ces comptes ne sont pas autorisés au SSE central.
- Chaque dashboard de Finance/SAV/Relais/Market-specific. Couverture à distinguer explicitement par surface.
- Le blocage sécurité commandes inter-clients et inter-relais [#4550](https://github.com/SamyrFateh/komerce-backend/issues/4550) N21/N22/N32, indépendant du présent transport SSE.

## Décision

Ne fermer les issues #4948/#4949 ni annoncer un **GO fonctionnel global** qu'après preuve des critères restant ouverts. Un PASS du test de transport = certification partielle, pas une preuve sur tous les writers métier.
