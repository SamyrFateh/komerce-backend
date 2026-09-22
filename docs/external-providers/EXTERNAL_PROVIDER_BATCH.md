# Campagne de caractérisation API — lot read-only

## Contrat d'exploitation

Le registre `governance/external-provider-registry.json` est l'inventaire de départ, **pas** une preuve nouvelle. Le collecteur `scripts/external-provider-batch-proof.js` génère un JSON pour chaque fournisseur inscrit. `declared_highest_proof` reprend la qualification historique; seul `probe.status=PASS` indique un **nouveau résultat de sonde dans cette campagne**, limité à l'opération et à l'environnement indiqué. Aucun PASS d'authentification ne prouve achat, paiement ou livraison.

Deux modes :
- `inventory` (par défaut) : tous les fournisseurs, présence de fiche, niveau déclaré, état de la sonde, **aucune connexion fournisseur**. Les APIs non équipées restent `NOT_RUN` dans ce mode.
- `sandbox-read` : nom historique du mode de sondes, **qui inclut désormais CJ et Meta sur compte réel uniquement avec consentement explicite distinct**. Sur `main`, exclusivement par `workflow_dispatch`, une sonde autorisée par fournisseur et une exécution **séquentielle**. Les APIs sans sonde autorisée restent `BLOCKED/NO_APPROVED_READ_ONLY_PROBE`, sans essai en aveugle. Les fournisseurs historiquement qualifiés sont sautés par défaut; `include_proven=true` impose une revalidation explicite.

Sondes autorisées dans ce premier lot :
| Fournisseur | Contrat de sonde | Effets et limites |
|---|---|---|
| PayPal | OAuth Sandbox (POST d'authentification) puis GET exact du webhook configuré | Aucun createOrder/capture/refund; le succès prouve uniquement OAuth + lecture webhook. |
| eBay | Réutilise la sonde Buy Browse Sandbox existante (OAuth, recherche bornée, lecture exacte) | Aucune offre publiée, aucun checkout; preuve limitée à P0/P1 Browse. |
| CJdropshipping | Deux GET au maximum sur le catalogue réel CJ : liste bornée à 1, puis lecture du produit exact. | **CJ ne passe pas par une Sandbox dans ce contrat** : consentement explicite `allow_cj_live_read=true` et jeton dédié `KOMERCE_CJ_PROOF_ACCESS_TOKEN` nécessaires. Aucun renouvellement de jeton, import, achat ou mutation. Ne prouve ni stock en temps réel ni achat. |
| Stripe | Réutilise la sonde existante avec une clé **test** (balance retrieve, PaymentIntent list limit=1, webhook list limit=100) | Aucun PaymentIntent créé, aucune capture; présence d'une configuration de webhook requise. |
| Meta WhatsApp | Un GET de métadonnées exactes du numéro (ID + nom vérifié) sur Graph API. | **Compte réel**, pas de Sandbox présumée : consentement explicite `allow_meta_account_read=true`, token de lecture séparé et ID exact requis ; aucune émission de message/OTP, ni preuve de livraison. Voir `docs/external-providers/messaging/META_WHATSAPP.md`. |

Tous les autres fournisseurs demeurent dans le rapport consolidé, mais leur sonde réseau ne sera autorisée qu'après revue séparée du contrat officiel, des prérequis business et du code d'appel existant. **Ne pas brancher** directement `scripts/paypal-sandbox-probe.js` ou `scripts/mtn-momo-sandbox-probe.js` : ils initient respectivement une commande et un RequestToPay de test.

## Déclenchement

GitHub Actions → **External provider contract batch (read-only)** → Run workflow sur `main`.

1. D'abord lancer `mode=inventory`, `providers=all`. Télécharger l'artifact `provider-contract-inventory-<run_id>`.
2. Configurer les identifiants **dédiés Sandbox/test**, séparés des tokens du backend et de Railway, dans l'environnement GitHub `provider-contract-sandbox`. Restreindre l'environnement à la branche `main` et, si souhaité, ajouter une approbation manuelle.
3. Lancer `mode=sandbox-read`, `providers=all`, `include_proven=false`, **`allow_cj_live_read=false` et `allow_meta_account_read=false` par défaut**. Sans autorisation explicite, CJ reste BLOCKED et ne reçoit aucun appel. Cette campagne tente PayPal uniquement si ses identifiants dédiés existent; eBay/Stripe historiquement qualifiés restent non relancés. Pour CJ, configurer un jeton dédié et choisir explicitement `providers=cj`, `allow_cj_live_read=true` afin d'effectuer deux GET au plus sur son catalogue réel. Lancer `providers=ebay,stripe`, `include_proven=true` **uniquement** pour une requalification explicitement nécessaire.
4. Télécharger `provider-contract-sandbox-read-<run_id>` (rétention 30 jours). Chaque artifact contient un seul `report.json` consolidé avec les résultats indépendants; le job n'imprime pas les réponses externes.

Variables d'environnement GitHub pour les sondes opt-in :
- Secrets Meta : `KOMERCE_META_PROOF_READ_TOKEN`, `KOMERCE_META_PROOF_PHONE_NUMBER_ID` ; variable de version `KOMERCE_META_PROOF_GRAPH_VERSION` (facultative, `v23.0` par défaut). Le token doit être distinct de `META_WA_TOKEN` du backend ; ne jamais copier de clé de production dans GitHub pour satisfaire une sonde. Pour cette opération précise sur un compte réel, utiliser exclusivement `providers=meta-whatsapp` et `allow_meta_account_read=true` après vérification des droits de lecture du compte. L'artifact ne contient ni ID de numéro, ni nom de compte, ni token. La preuve d'envoi et de livraison reste inconnue.
- Secret CJ : `KOMERCE_CJ_PROOF_ACCESS_TOKEN` (jeton dédié, révoquable et limité à la lecture du catalogue si les permissions fournisseur le permettent). Ne pas recopier le jeton du backend ou Railway. CJ n'est pas une Sandbox : l'opt-in explicite est obligatoire et l'opération est signalée `LIVE_CATALOG_READ_ONLY` dans les preuves.
- Secrets PayPal : `KOMERCE_PAYPAL_PROOF_CLIENT_ID`, `KOMERCE_PAYPAL_PROOF_CLIENT_SECRET`, `KOMERCE_PAYPAL_PROOF_WEBHOOK_ID`.
- Secrets eBay : `KOMERCE_EBAY_PROOF_CLIENT_ID`, `KOMERCE_EBAY_PROOF_CLIENT_SECRET` (Sandbox dédié).
- Secrets Stripe : `KOMERCE_STRIPE_PROOF_TEST_SECRET_KEY`, `KOMERCE_STRIPE_PROOF_TEST_WEBHOOK_SECRET`.
- Variables Stripe : `KOMERCE_STRIPE_PROOF_TEST_WEBHOOK_URL`, `KOMERCE_STRIPE_PROOF_TEST_API_VERSION` si nécessaire.

Les clés absentes, ou l'absence de consentement CJ/Meta, donnent `BLOCKED`, **jamais** des valeurs factices ni un PASS. Une clé Stripe Live est rejetée par le collecteur, indépendamment du nom du secret. Pour l'ensemble du lot, la durée du job est limitée à 7 minutes; les appels PayPal ont un timeout individuel de 7 s, et le client Stripe désactive les retries automatiques. Les opérations restent bornées, en lecture seule métier, et séquentielles.

## Sortie et suivi

`report.json` contient : `provider`, `family`, `declared_highest_proof` (historique), `analysis_document_exists`, et `probe` (opération précise, environnement, statut, code d'écart, P0/P1 si effectivement testés). Il **n'inclut** aucun token, clé, réponse brute, identifiant client, facture, ou payload personnel.

La tâche quotidienne ChatGPT peut comparer les artifacts récents aux précédents et ne signaler que les avancées et blocages significatifs. **Elle ne déclenche pas le workflow.** La campagne réseau ne tourne pas en cron, ne crée aucun service Railway et ne publie aucun changement métier. Ajouter plus tard une sonde par opération après validation de son caractère non mutatif, de son périmètre de compte et du coût API; ne pas rejouer les preuves inchangées.

Commande locale, sans credentials ni réseau :

```bash
node scripts/external-provider-batch-proof.js --mode=inventory --providers=all \
  --out=artifacts/provider-contract-batch/report.json
```

La fermeture d'un écart nécessite une **preuve propre à l'opération**, et non le PASS d'une autre opération du même fournisseur.
