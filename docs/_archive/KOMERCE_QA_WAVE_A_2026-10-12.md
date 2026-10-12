# Contre-recette indépendante — vague A (après S3)

Référence : #2439 ; anomalies #2440, #2441, #2442. **État : spécification, non exécutée.**

## Règles de preuve

- Serveur et PostgreSQL éphémères, aucun secret prestataire, aucune notification sortante, aucune production.
- Réutiliser `tests/e2e-cash/support.js`, `order-to-cash-thread.spec.js` et `dashboard-truth.spec.js`. Ne pas réinitialiser/purger les faits financiers.
- Oracle indépendant SQL (ne pas importer les CTE/services de production) ; tester état initial → action HTTP par acteur → état final SQL → API → écran.
- Chaque anomalie doit produire un test **rouge avant correctif**, puis vert après correctif ; archiver rapport, trace, état financier et refus.
- Ne jamais assimiler L4 local intégré à une preuve de prestataire réel ou de staging.

## A1 — Cash confirmé sans collecte (#2440)

1. Créer commande cash synthétique via `POST /api/orders` et relever `order_id`, `market_id`, `payment_status`.
2. Déclencher `confirm-cash` depuis le workspace avec un acteur autorisé ; comparer au flux officiel `/api/payments/cash/confirm` sur commande distincte.
3. Oracle : `SELECT COUNT(*), COALESCE(SUM(amount),0) FROM cash_collections WHERE order_id=$1` (adapter le nom de la colonne de montant après lecture du schéma réel).
4. Vérifier absence de paiement déclaré `paid` sans fait financier canonique ; vérifier les KPIs Finance, cash détenu, signal de réconciliation.
5. Rejouer la confirmation ; 0 écriture financière supplémentaire ; acteur non autorisé et autre Market refusés.
6. Si divergence confirmée, bloquer la certification Finance jusqu'à correction dans le propriétaire canonique du paiement.

## A2 — Faux succès de l'expédition (#2441)

1. Construire commande et colis destinés à un relais, préparés et prêts, via routes réelles.
2. Injecter un échec déterministe de `safeSyncScanToParcels` dans une recette isolée de la route `POST /api/hub-dash/parcels/:id/ship`.
3. Capturer HTTP, corps, `parcels.status`, scan, historique et projection Hub/Relais.
4. Assertion : jamais de `2xx` représentant une expédition totalement réussie si la synchronisation indispensable a échoué. Si la synchronisation est asynchrone/non bloquante par contrat, exposer explicitement un état partiel et sa reprise.
5. Rejeu : pas de double expédition ni double événement, visibilité d'une cause/action traçable.

## A3 — Expédition sans emballage (#2442)

1. Appeler l'action `ship` du workspace pour un colis sans étape « emballé », avec rôle et Market autorisés.
2. Capturer code métier, incident créé, statut SQL, historique, écran.
3. Assertion : précondition explicitement refusée en 4xx métier, ou parcours valide documenté ; jamais 500 opaque ni incident contradictoire.
4. Refaire après emballage ; transition unique ; vérifier acteur sans droit et autre Market.

## Critères de sortie vague A

- Trois reproductions datées, chacune avec verdict PASS/FAIL et référence de test.
- Zéro faux paiement confirmé, zéro faux succès de livraison, zéro 500 de précondition métier.
- CI/preflight verts sur les correctifs ; aucun changement de comportement des paiements électroniques.
- Reprendre ensuite S4 (signaux cause → action → disparition → résolution) et S5 (Mobile Money : duplications, désordre, retards, fautes).
