# KOMERCE — Contre-expertise A3/A4 et remédiation finance

**État :** revue de conception / investigation, pas un GO métier. **Base examinée :** `main` post #2861. **Sources :** transcript Opus (sandbox non accessible), rapport passe 2, et code de production sur GitHub. Les démonstrations historiques Opus ne sont pas des tests re-exécutés sur le SHA courant.

## Ce que signifie « scanner tout le dépôt »

`npm run audit:logic` analyse les sources JS/TS **suivies par Git** (services, routes, middleware, scripts, bootstrap, utils, etc.), hors tests, migrations, ressources générées. Cela ne signifie **pas** qu'il examine toutes les règles métier ni qu'il certifie les parcours d'écrans. Le rapport doit montrer le nombre réellement lu, les exclusions et les règles effectivement testées. Un fichier illisible ou un périmètre vide est une erreur bloquante.

Couches de preuve à conserver distinctes :
1. **Statique** : LS-01 (écritures directes statut commande), LS-02 (PSP dans transaction suspecte), LS-03 (idempotence temporelle), LS-04/05 (écritures et conflits colis), LS-06 (appel externe PSP sans preuve locale de rapprochement). Ce sont **des soupçons**, y compris si la CI est verte.
2. **PostgreSQL explicite en lecture seule** : LD-01 à LD-07b ; une détection est un **écart de données à investiguer**, jamais automatiquement un bug d'implémentation. Un `NOT_RUN` n'est pas `PASS`.
3. **Reproduction** : vrai service / HTTP authentifié + assertions avant/après dans base jetable, PSP factice ; tests permanents qui échouent réellement si l'invariant est violé.
4. **Recette métier** : produit, rôles, quatre marchés, dashboards, devises et délais ; preuve visuelle et contrôle attendu/observé par un humain. Un PASS technique n'est pas un GO métier.

## Challenge du transcript d'Opus et de l'implémentation reconstruite

| Sujet | Constats / limites | Attendu pour terminer |
|---|---|---|
| Nombre de fichiers | Opus a mesuré **643 fichiers JS** sur son SHA ; ce n'est pas une garantie de périmètre constant. | Comparer à `git ls-files`, rendre les exclusions visibles et bloquer si un fichier est illisible. |
| LS-01 | Détecteur de statut direct présent chez Opus, **absent** de la première reconstruction. | Ajouter le signal, trier les écritures légitimes via responsabilité canonique et preuves. |
| LS-02 | L'analyse « BEGIN dans les 3000 caractères précédents » ne prouve pas une transaction : elle manque les transactions entre fichiers. | Inventorier TOUS les appels PSP, puis relier au caller/transaction et tests injectant des échecs. |
| LS-03 | PayPal `refundCapture` construit `PayPal-Request-Id` avec `Date.now()` ; risque de double remboursement en rejeu. | Identifiant durable propre à l'opération, pas à l'instant ni uniquement à la capture. |
| LS-04/05 | La simple détection `INSERT/DELETE parcel_items` ne prouve pas l'absence de garde de marché/relais ; ne pas confondre `UPDATE qty_*` et changement d'appartenance. | Matrice par écrivain/owner et tests de refus cross-marché, cross-relais, après expédition. |
| LD-01…LD-07b | Neufs SELECT peuvent être verts sur base vide. Les colonnes, filtres de statuts et faux positifs dépendent du schéma courant. | Jeux de données positifs/négatifs, règles de validité du market, vérification des accès SELECT, rapprochement PSP réel séparé. |
| RC-3/RC-4 | La preuve Opus visait les **gestes dans `operations-workspace.js`** et l'autorité de `admin-operations-workspace.js`. Les PR #2860/#2861 sécurisent certains chemins du moteur, mais ne suffisent pas à affirmer que chaque entrée legacy est couverte. | Refaire les tests HTTP authentifiés du workspace (réception/remise, cash pending, relais A→B dans même marché), et exiger la vérification du code de retrait si la doctrine métier le confirme. |
| RC-5 | `processRefund` appelle Stripe après insertion `refunds.pending` **dans la transaction ouverte par `routes/orders/cancel.js`**. Si la transition/commit échoue, la trace `pending` est annulée mais Stripe peut avoir remboursé. **Risque crédible, non reproduit à ce stade.** | Réservation durable **commit avant PSP**, preuve provider durable, réconciliation des issues ambiguës, puis transition métier. Ne jamais « résoudre » par un simple appel Stripe après COMMIT sans état durable. |
| RC-9 | `refundPaypalOrder` n'a pas de réservation concurrente en DB et clôture `refunded` même pour un remboursement partiel ; `paypal-client.refundCapture` utilise Date.now. Les tests témoins montrent deux appels PayPal factices. | Idempotence durable par opération, sérialisation DB, montant restant remboursable, refus/rapprochement si PSP timeout, statut final uniquement si total atteint, vrais tests de concurrence et rejouabilité. |
| RC-6/7/8 | Calcul de complétion par lignes plutôt que quantités, contrôle de pureté colis non récurrent, entrées inventaire parallèles. | Rattacher aux owners, matrice d'actions, tests de couverture physique puis supervision continue. |

## Doctrine de correction financière

Le mécanisme cible n'est **pas** « passer le PSP après COMMIT » simplement. Pour chaque tentative : créer une **intention durable** (`request_id`, order, market, PSP, amount & currency, capture, statut), la committer, effectuer l'appel PSP avec **la même clé stable**, stocker résultat/provider_ref, puis effectuer une transition métier conditionnée à la **preuve de règlement intégral**. Les états `pending/unknown` bloquent les nouveaux essais automatiques tant que le PSP n'a pas été réconcilié. Sérialisation en base : jamais un verrou mémoire process-local. Les remboursements partiels ne changent pas l'ordre en `refunded`.

Une migration finance ou modification des refund writers exige un design review, tests concurrents / crash avant-et-après PSP, analyse des autres callers (`refund-service`, `refund-service-with-fallback`, `utils/refunds`, `admin-order-refund`, PayPal et shared-cart), puis CI et recette. **Aucun vrai remboursement de test**.

## Verdict du présent lot

- Renforce le détecteur statique, ses tests et sa couverture déclarative.
- **Ne prétend pas corriger RC-5 ou RC-9**. Les modifications de flux financiers réels doivent être des PR séparées et vérifiées avec vraies fixtures locales + PSP factice.
- N'autorise ni RESET ni modification de données staging/production et ne transforme pas une CI verte en certification business.
