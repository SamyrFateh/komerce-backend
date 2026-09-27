# P2 — replay interne isolé de la baisse Allegro 3 → 1

## Preuve fournisseur déjà acquise (distincte)
Le [run live #35746258763](https://github.com/SamyrFateh/komerce-backend/actions/runs/35746258763) a observé chez Allegro Sandbox la baisse réelle **3 → 1** de l'offre de test `7782259530` ET de son unité. Il n'a pas persisté ces lectures en observations immuables dans une base Komerce de longue durée : la base du job était éphémère. Ne pas présenter ce run comme une preuve de propagation dans le catalogue, de rupture complète ou de validation Purchasing.

## Objet de ce replay (autre contrat)
Le workflow manuel `Sourcing shadow stock replay Golden (offline CI only)` utilise **deux fixtures V2 synthétiques** reproduisant uniquement la forme du changement (3 puis 1), avec un identifiant fictif `7770000001` et une source **namespacée par le run CI** (`api:allegro:golden-offline-replay-...`). Aucune offre réelle, aucun token, aucune API fournisseur, aucune donnée d'une commande ou d'un acheteur.

Il exerce dans **PostgreSQL jetable sur 127.0.0.1** le writer canonique `recordCatalogImportObservationsShadow` (Product/Offer/Unit), les captures et la résolution des identités, puis les projections canoniques Offer et Unit. Il vérifie :

- Deux captures immuables contiennent chacune un Offer et une Unit, d'abord à 3 puis à 1.
- Les deux observations Offer pointent vers **la même identité canonique Offer** ; idem pour la Unit. La Unit conserve le même parent Offer canonique.
- Les projections lisent l'état courant à 1 et un `last_observation_delta` de stock exact 3 → 1, sans dérive de prix/devise, sous `authority=shadow_read_only`.
- L'unique source synthétique reste `autopilot_enabled=false` ; `commandability.ready_now=false`. La preuve n'appelle aucun code d'import catalogue, de promotion, de commande ou de paiement.

Une erreur de résolution, une identité ambiguë, une source ON, une donnée de stock UNKNOWN ou une variation différente **fait échouer le test**. Le test n'écrit que dans les tables shadow de la base jetable (source/capture/observations/résolution). **Ce replay est une preuve interne synthétique, pas un second test API live ni une preuve de propagation effective du stock de l'offre réelle.**

## Exécution ponctuelle

Depuis GitHub Actions, lancer `Sourcing shadow stock replay Golden (offline CI only)` sur **main**. Le workflow ne possède ni secrets Allegro ni permissions GitHub d'écriture, ne crée aucun service Railway et détruit PostgreSQL en fin de job. La sortie attendue est `SYNTHETIC_OFFLINE_SHADOW_3_TO_1_PERSISTED`. Cette sortie n'est légitime qu'après vérification du run réel et des invariants ci-dessus. Une fusion de PR ou une CI unitaire verte **ne prouve pas** le replay PostgreSQL tant que ce workflow n'a pas été exécuté.

## Ce qui reste hors périmètre

La surveillance périodique des Units suivies (P2), le choix fournisseur et l'exposition effective dans une fiche boutique, la rupture à zéro et les contrôles avant engagement/paiement (P4/P5) restent à prouver séparément. La sonde live précédente ne doit pas être reliée au catalogue ou à Purchasing par simple effet de bord.
