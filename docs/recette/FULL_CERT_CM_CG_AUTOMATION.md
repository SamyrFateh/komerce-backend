# Reprise automatique de la certification CM puis CG

Workflow : `.github/workflows/staging-market-full-certification.yml`. À lancer **après** activation des tarifs RECETTE par la route de vente gouvernée, jamais à leur place.

Déclenchement autorisé au propriétaire du dépôt uniquement :
- Manuellement (Actions → « Staging — certification métier V1 complète CM ou CG ») avec `market=CM` / `market=CG` et confirmation exacte `RUN-FULL-CERT-CM` / `RUN-FULL-CERT-CG`.
- Par issue owner au titre exact `[staging-op] full-cert-CM` puis, si succès CM, `[staging-op] full-cert-CG`.

Le run effectue dans l'ordre : SHA staging, garde d'empreinte DB, vérification des deux tarifs RECETTE ; fixture API neuve ; rattachement réversible du seul relais E2E ; chaîne achats HTTP ; chaîne physique HTTP, y compris distribution ; seconde fixture neuve ; achats HTTP ; clics Chromium réels (les gestes physiques) ; isolation entre trois marchés. Aucun paiement réel, PSP désactivés, pas de modification des transporteurs ni d'élargissement de permissions.

Le passage du compte de relais E2E de KM vers CM/CG est autorisé seulement si les deux marchés sont KM/CM/CG et si le compte détient **déjà** `execution.parcel.collect` dans le marché de destination. Les autres transferts demeurent refusés.

Chaque run publie deux RUN8 dans son résumé et conserve ses preuves sous `test-results/` comme artefacts GitHub, même en cas d'échec. **Une CI verte de ce workflow n'est pas un GO métier automatique** : consulter les décomptes de chaque runner et les captures. En cas d'échec, ne jamais réutiliser une fixture partiellement exécutée. Ajouter les rapports réussis à `docs/recette/evidence/<marché>-<date>/` et mettre à jour `docs/recette/CERTIFICATION_V1_HANDOFF.md`.

La distribution automatique concerne le marché entier, pas seulement la fixture : ce workflow est strictement réservé au staging jetable et aux données de recette.

L'isolation actuelle porte sur le seul agent relais, dont le relais actif change d'un run à l'autre. Pour certifier les responsables pays, il faudra créer un compte E2E dédié à CM et un autre à CG ; le responsable pays mutualisé sur trois marchés n'est pas un test d'isolation recevable.
