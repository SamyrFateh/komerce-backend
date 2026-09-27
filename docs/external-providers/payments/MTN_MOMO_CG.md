# MTN MoMo Congo — contrat de caractérisation initiale (Collections Sandbox)

## Source officielle et frontières

- MTN publie le parcours développeur officiel : subscription key Collections, API User, API Key, puis obtention d'un access token avant les appels métier : https://momoapi.mtn.com/content/html_widgets/90azl.html .
- La FAQ officielle distingue les identifiants provisionnés dans l'environnement Sandbox des identifiants de production : https://momoapi.mtn.com/content/html_widgets/hcswd.html .
- Cible contractuelle de la sonde : POST `https://sandbox.momodeveloper.mtn.com/collection/token/`, header Basic `api_user:api_key` et `Ocp-Apim-Subscription-Key`. L'adapter Komerce courant utilise déjà ce même contrat dans `services/mobile-money/mtn-momo-cg.js`.
- **Aucune création** d'API user/key par cette sonde : le compte Sandbox doit être provisionné au préalable et les clés doivent rester séparées des secrets du backend/Railway.

## Conversation limitée : authentification Collections

| Phase | Contrat |
|---|---|
| EXPECTS | Vérifier uniquement l'accès à la génération d'un token Collections sur le Sandbox MTN. |
| REQUIRES | `MTN_PROOF_TARGET_ENVIRONMENT=sandbox` et trois secrets de preuve dédiés : `MTN_PROOF_COLLECTION_SUBSCRIPTION_KEY`, `MTN_PROOF_API_USER`, `MTN_PROOF_API_KEY`. |
| SENDS | Un unique POST vers l'URL Sandbox figée, avec Basic auth et subscription key ; **aucun** `requesttopay`, provisionnement ou manipulation d'un wallet. |
| RECEIVES | HTTP réussi avec `access_token` non vide et expiration positive. |
| CONFIRMS | Identifiants Collections Sandbox acceptés lors de cette exécution précise ; aucune valeur de secret ou token dans les résultats publiés. |
| EXPOSES | Seulement `MTN_COLLECTION_SANDBOX_OAUTH_ONLY`, environnement SANDBOX, état et codes de contrôle P0/P1 ; jamais le token ou la réponse provider brute. |

## État et limites de preuve

**Observation réelle déclarée par l'opérateur le 22 septembre 2026 :** une sonde ponctuelle exécutée dans l'instance Railway existante avec ses variables MTN Sandbox préexistantes a rapporté `PASS` / `MTN_SANDBOX_COLLECTION_OAUTH_PROVED`. Source et limitations de provenance : [rapport expurgé Railway du 22 septembre 2026](../../_archive/external-provider-proofs/RAILWAY_SANDBOX_AUTH_2026-09-22.md). Cette observation concerne **uniquement l'authentification Collections Sandbox**, pas le contrat `RequestToPay` ni une preuve d'encaissement. Le registre conserve `highest_proof=UNQUALIFIED` au niveau du fournisseur global : un PASS d'authentification local ne qualifie pas toutes ses opérations.

Un PASS ultérieur ne prouve **pas** la capacité RequestToPay, les montants et devises, le statut de transaction, les callbacks, une opération d'encaissement, ni les droits de production au Congo. Ces opérations nécessitent leurs propres contrats et preuves. Les scripts historiques `scripts/mtn-momo-sandbox-probe.js` initient une transaction de test et sont **exclus** de cette campagne read-only.

## Contrat métier suivant — RequestToPay (non exécuté)

La documentation officielle MTN distingue **acceptation de la requête** et **résultat du paiement** : POST `/collection/v1_0/requesttopay` avec `X-Reference-Id` UUID v4 unique, `X-Target-Environment=sandbox`, bearer Collections, subscription key, `externalId`, `payer`, montant et devise de transport ; HTTP **202 Accepted** indique uniquement la mise en file d'attente. L'état final `SUCCESSFUL` / `FAILED` doit être **relu** par GET `/collection/v1_0/requesttopay/{referenceId}`. La callback ne part qu'une fois et n'est pas retentée en cas d'échec de livraison ; le GET de statut reste donc l'autorité de confirmation.

Source : https://momodeveloper.mtn.com/content/html_widgets/v98wn.html et https://momodeveloper.mtn.com/content/html_widgets/nqxho.html .

**Correspondance avec Komerce vérifiée dans le code (pas encore sur une transaction réelle) :**
- `services/mobile-money/mtn-momo-cg.js` prépare `X-Reference-Id`, le bearer et le POST ; il attend 202, puis `getStatus` relit par GET. En Sandbox, l'adapter transporte le couple synthétique `1000 EUR` sans écraser la vérité métier XAF.
- `services/payment-mobile-money.js` possède une couche de réconciliation distincte ; une réponse 202 ne doit jamais devenir `paid`.
- `routes/payments-mobile-money.js` expose le callback par **POST**. La configuration `X-Callback-Url` doit correspondre au domaine `providerCallbackHost` du compte Sandbox ; le fonctionnement effectif de ce callback **n'est pas encore prouvé**. Les pages officielles MTN consultées présentent des formulations divergentes sur le schéma HTTP/HTTPS en Sandbox : ne pas inventer une validation de la callback sans son essai borné et sans confirmation du contrat de l'environnement.
- L'accès OAuth Collections observé le 22 septembre ne vérifie **ni la capacité RequestToPay du compte, ni les données du payeur de test, ni la livraison du callback**.

**Prochaine preuve minimale autorisable séparément :** préflight du contrat exact et des données de test non personnelles, puis **une seule** tentative `RequestToPay` Sandbox explicitement autorisée, suivie du GET exact de l'ID créé et d'un rapport expurgé `ACCEPTED` / `PENDING` / `SUCCESSFUL` / `FAILED`. Pas de mutation de commande Komerce ni de mode de paiement public avant obtention de cette preuve.

## Exécution manuelle

Dans l'environnement GitHub `provider-contract-sandbox`, configurer les secrets **dédiés** `KOMERCE_MTN_PROOF_COLLECTION_SUBSCRIPTION_KEY`, `KOMERCE_MTN_PROOF_API_USER` et `KOMERCE_MTN_PROOF_API_KEY`. La campagne GitHub exige ces secrets distincts. **Voie alternative observée le 22 septembre :** la sonde ponctuelle, exécutée *dans* l'instance Railway existante, peut réutiliser les variables Sandbox déjà présentes sans les copier vers GitHub ni modifier leur valeur. Les deux chemins ne sont pas interchangeables et leurs preuves doivent garder leur propre provenance.

Sur `main`, lancer manuellement `External provider contract batch (read-only)` avec `mode=sandbox-read`, `providers=mtn-momo-cg`, `include_proven=false`. La sonde effectue au plus un POST d'authentification, sans abonnement nouveau, sans approbation sur téléphone, sans commande et sans message.
