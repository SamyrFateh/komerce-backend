Warning: truncated output (original token count: 12865)
Total output lines: 161

Warning: truncated output (original token count: 39374)
Total output lines: 292

# STATUS — registre commun des chantiers Komerce

> Dernière vérification : **2026-11-14**, GitHub.  
> **Seul tableau de coordination actif** pour ChatGPT/GPT, Sonnet et Opus. Il remplace les journaux de tâches historiques ; il ne remplace ni le code, ni les données live, ni `AGENTS.md`, ni les cartes Feature First, ni les checks GitHub.
> La PR et ses checks font foi pour l'état du code. Un nom d'agent n'est pas une preuve d'exécution.

## Orders/Logistics — référence unique marché–relais–destinataire temporaire–commande (GPT, 23/11/2026)

**Responsable :** GPT. **Statut : code sur branche `feat/staging-order-wave-reference`, NON MERGÉ, NON CERTIFIÉ, NON ACTIVÉ ; préflight et impact non exécutés (pas de checkout exécutable dans cette session).** Issue de coordination [#5168](https://github.com/SamyrFateh/komerce-backend/issues/5168).

**Décision propriétaire :** une seule référence commerciale `CM-YAO1-B7Q4-X8`, avec code marché lu depuis la DB, relais code court stable issu de son vrai nom + un chiffre, client temporaire 4 caractères aléatoires (lettre initiale incluse), 2 caractères aléatoires de commande. Pas de deuxième référence de tri. Aucun code de retrait, client permanent, bac ou sac numérique. Chaque cohorte demeure interne ; aucun écran de création/fermeture manuelle dans le flux normal.

**Code préparé :** migration 426 (`relais.short_code`, `order_delivery_waves`, `orders.delivery_wave_id`), `services/order-delivery-wave-service.js`, réservation du code court dans `services/relais-mutation-service.js`, intégration atomique checkout/persistence, fermeture à la première remise prouvée dans `pickup-collection-recorder.js`, tests unitaires de contrat, cartes orders/logistics. Toutes écritures nouvelles sont **désactivées par défaut**, strictement staging sous `KOMERCE_ORDER_WAVES_ENABLED=1`. Les fixtures G6 dédiées conservent leurs références pour ne pas invalider la campagne transverse en cours.

**Contrôles déjà réalisés :** analyse du code sur GitHub ; syntaxe JS compilée V8 sur 7 fichiers et simulation ciblée du cycle « 2 commandes même groupe → première remise → nouvelle racine » : PASS simulé. **Non prouvés :** `agent:context`, `arch:impact`, `pr:preflight`, suites Jest/PostgreSQL, CI PR, migration staging, affichage réel, intégration checkout/PSP, Chromium. Aucun GO.

**À faire impérativement avant PR et activation :** exécuter les packs `orders` + `logistics` et `arch:impact`, stabiliser le périmètre des writers, tests collision/concurrence + reprise checkout/rollback/flags, vérifier fonctions de remise exceptionnelles et expéditions, gates et preflight, revue privacy/labels, CI PR puis Chromium staging/PG. Ne pas supprimer les tables de preuve de sacs historiques ; elles servent à relire les flux anciens mais ne sont plus un chemin métier autorisé. Aucun sac dans les nouveaux parcours.

## Hub Live — préparation directe en COMBOX (GPT, 22/11/2026)

**Responsable :** GPT. **Statut :** PR [#5127](https://github.com/SamyrFateh/komerce-backend/pull/5127) fusionnée le 22/11/2026 ; aucune preuve de certification staging de la COMBOX directe n'est consignée ici. **Décision :** le cockpit et les ateliers Hub ne proposent plus de sac client ; ils initialisent une COMBOX, placent directement les quantités reçues après scan de la COMBOX et de chaque article, puis ferment la COMBOX. Les allocations restent traçables par commande/article et bornées par les placements reçus ; plusieurs commandes du même marché peuvent partager une COMBOX et une ligne peut être répartie entre COMBOX. Les enregistrements historiques de sacs restent lisibles. **Code touché :** cockpit et workspace Hub Live, projection du dossier Hub, routes de remplissage/fermeture, preuve de placement HUB-001, tests et carte logistics. **Lien M06 :** le geste physique de l’issue [#5042](https://github.com/SamyrFateh/komerce-backend/issues/5042) est ainsi mis à jour ; cela ne lie pas le manifeste M06 (`NOT_BOUND`) et ne certifie pas son parcours complet. **Prochaine action :** finir les checks de PR, fusionner selon les protections du dépôt, puis rejouer le delta Chromium G6/M06 avec readback API/PostgreSQL sur la version déployée.

## MKT-READ — Responsable Marché : lecture seule mono-marché KM/CM/CG CERTIFIÉE staging (20/11/2026)

**GO de clôture MKT-READ mono-marché, STRICTEMENT READ ONLY, pas de GO production ni de GO G6 global.** Le [run Chromium réel #44759551769, tentative 2](https://github.com/SamyrFateh/komerce-backend/actions/runs/44759551769) est **SUCCESS, 3/3 scénarios PASS et rapport strict global PASS** : KM, CM et CG testés sous **trois comptes `market_operator` mono-marché indépendants**, jamais un compte couvrant les trois marchés. [Artefact exact #14641222669](https://github.com/SamyrFateh/komerce-backend/actions/runs/44759551769/artifacts/14641222669), SHA staging attendu/servi/fin **`1a51163fde7e1566461087d9f27bdcfb320fde74`** stable.

**Assertions de preuve par marché** : 23 rubriques et 18 destinations HTTP 200 (rubriques multiples pouvant aboutir à une même URL), vues Hub strictement filtrées avant projection par `market_id`, **oracle PostgreSQL `READ ONLY`** des commandes `IMPORT` actives comparé exactement au tableau (zéro commande active admis uniquement si PostgreSQL confirme zéro), commande M01 terminée distincte du Kanban actif, Order 360 et PO en lecture seule, consultations déléguées, refus HTTP directs des commandes/PO/clients des **deux autres marchés**, aucune fuite de référence ou de marché étranger dans les réponses API, audit réseau JSON complet et contre-lecture GET obligatoire lorsque Chromium perd le corps d'une réponse, **zéro écriture réseau, zéro bouton de mutation, zéro erreur JavaScript**. Références M01 scoppées : KM `KB9VF1H`, CM `KQ95M54`, CG `KCYE1M1`.

**Correctifs de recette fusionnés** : [#4692](https://github.com/SamyrFateh/komerce-backend/pull/4692), [#4701](https://github.com/SamyrFateh/komerce-backend/pull/4701) (trois comptes et matrice stricte), [#4704](https://github.com/SamyrFateh/komerce-backend/pull/4704) (plafonds finis), [#4713](https://github.com/SamyrFateh/komerce-backend/pull/4713) (déclencheur propriétaire), [#4715](https://github.com/SamyrFateh/komerce-backend/pull/4715) (oracle Hub actif), [#4717](https://github.com/SamyrFateh/komerce-backend/pull/4717) (23 rubriques / 18 destinations), [#4719](https://github.com/SamyrFateh/komerce-backend/pull/4719) (audit réponse JSON fail-closed). Les anciens runs FAIL concernaient des références effacées, des assertions de recette incorrectes ou une transition de SHA Railway ; **ils ne servent pas de preuve PASS**. Seule la tentative 2 du run #44759551769 autorise le verdict actuel.

**Historique de la preuve partagée (19/11/2026), non suffisante pour l'isolation mono-marché :**

**GO de clôture du chantier de visibilité en lecture seule**, **pas GO de production ni GO global G6**. [PR fonctionnelle #4663](https://github.com/SamyrFateh/komerce-backend/pull/4663) fusionnée : menu métier complet, vues marché, Hub SQL filtré avant projection, Order 360 achat fournisseur en lecture seule, capacités de lecture distinctes des actions. [PR #4667](https://github.com/SamyrFateh/komerce-backend/pull/4667) : rapport Chromium fail-closed et traces de session protégées. [PR #4669](https://github.com/SamyrFateh/komerce-backend/pull/4669) : évitement des DDL de démarrage déjà satisfaits. [PR #4670](https://github.com/SamyrFateh/komerce-backend/pull/4670) : `SET LOCAL lock_timeout = '3s'` sur transaction DDL dédiée, sans affecter les requêtes métier.

**Preuve réelle** : [Chromium staging run #44590146282](https://github.com/SamyrFateh/komerce-backend/acti