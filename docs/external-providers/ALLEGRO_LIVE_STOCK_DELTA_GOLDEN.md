# Golden contrôlé — variation réelle de stock Allegro Sandbox (3 → 0)

Ce jalon est **distinct** du Golden lecture inchangée [run 35660078568](https://github.com/SamyrFateh/komerce-backend/actions/runs/35660078568). Il n'est ni une preuve de commande, ni une activation du cron sourcing, ni une mise à jour du catalogue de production.

## Prérequis

1. Depuis le compte vendeur Sandbox `komerceseller`, choisir **une offre TEST UNIQUEMENT**, active, avec quantité **exactement 3**. Créer une offre Sandbox distincte si nécessaire. **Ne jamais utiliser `7782182471`** : cette référence sert déjà aux preuves Purchasing ; la sonde refuse explicitement cet ID. Ne pas toucher à une offre associée à une commande ou utilisée comme référence produit par la boutique.
2. Disposer d'une autorisation OAuth **Komerce Golden**, application différente de `Komerce Sandbox Sourcing` connectée à Railway. Après un premier succès OAuth, le workflow **chiffre le refresh token tourné** (AES-256-GCM, clé dérivée du Client Secret dédié) et le conserve dans un cache GitHub Actions, y compris si le Golden échoue après l'authentification. Le run suivant restaure ce cache chiffré et réutilise le jeton tourné. **Première exécution après introduction de ce correctif : l'ancien secret GitHub a été invalidé lors du run 35731268007 et le run 35732064631 a échoué au premier GET avec HTTP 400 ; effectuer une seule nouvelle autorisation device_code de Komerce Golden et mettre à jour uniquement `KOMERCE_ALLEGRO_PROOF_REFRESH_TOKEN`**, puis relancer. L'authentification de Railway ne doit pas être touchée ; ne jamais transmettre de jeton dans un ticket/chat. Le cache est temporaire : expiration/éviction, révocation, changement de Client Secret ou nouvelle autorisation en parallèle peuvent nécessiter une autorisation manuelle supplémentaire.
3. L'application Golden peut rester **lecture seule**. La modification du stock **est faite manuellement dans l'interface vendeur Sandbox** et jamais par le code de Komerce.
4. L'opérateur doit être prêt à suivre en direct le journal du workflow et pouvoir changer la quantité de la seule offre de test pendant sa fenêtre de contrôle.

## Exécution — déclenchement manuel sur main exclusivement

Ouvrir **Actions → Allegro LIVE stock delta Golden (manual test offer only) → Run workflow**, choisir `main`, renseigner l'ID numérique exact de l'offre de test et cocher `test_only_offer_ack` après avoir vérifié les prérequis. **Ne pas utiliser « Re-run jobs » d'un ancien commit.**

Le job recrée une base PostgreSQL éphémère et le schéma corrigé. Il prouve d'abord OFF (zéro requête fournisseur), passe ON **dans cette seule DB jetable**, lit et valide stock = 3 au niveau offre ET unité, puis fige sa première observation. **En cas de quantité initiale différente de 3 ou d'offre inactive : échec avant toute invitation à modifier Allegro.**

Dès que le journal affiche `READY_FOR_MANUAL_SANDBOX_TEST_OFFER_STOCK_CHANGE`, aller **sur le compte vendeur Allegro Sandbox**, modifier **uniquement cette offre de test** et mettre sa quantité disponible à **0**, enregistrer. Le script effectue au maximum quatre relectures exactes, à 45 s d'intervalle (3 minutes à partir du signal) et n'écrit **rien** chez Allegro.

Seule une observation réelle, exacte et cohérente **3 → 0** à la fois sur l'offre et sur son unité, sans dérive prix/devise ni état inconnu, permet la sortie `live_stock_delta_proved=true`. Tout échec de lecture, disparition ambiguë, OFF pendant la requête, valeur inattendue ou absence de transition après quatre essais **échoue fermé** et ne prouve pas la rupture. Le résultat ne garantit pas le stock au moment du paiement, ni la publication/visibilité boutique, ni le suivi continu en production.

## Coût et hygiène

Ce jalon n'installe pas de service Railway, n'exécute pas de cron, n'achète rien et n'utilise aucun token ou donnée client de Railway. Un seul run manuel, une référence exacte, jusqu'à 5 GET fournisseur (baseline + 4 vérifications). Lorsqu'une lecture renouvelle le jeton, le workflow l'exporte depuis la base locale **avant la suppression du conteneur**, le chiffre sous une clé dérivée du seul secret client de l'application Golden, et place **uniquement le fichier chiffré** dans un cache GitHub Actions sur main. Le retour du script et les journaux ne contiennent jamais le jeton en clair. La sauvegarde se déclenche aussi après un échec de preuve, si OAuth avait déjà tourné. **Si la sauvegarde chiffrée échoue, ne pas relancer : le secret de bootstrap GitHub peut être obsolète.** En cas d'éviction du cache, revenir à une nouvelle autorisation device_code. Aucun service Railway, compte Production ou jeton Purchasing n'est impliqué.

Après run, transmettre **uniquement l'URL GitHub Actions** à l'équipe ; jamais les secrets OAuth ni un export brut de fournisseur.
