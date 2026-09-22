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

**Observation réelle déclarée par l'opérateur le 22 septembre 2026 :** une sonde ponctuelle exécutée dans l'instance Railway existante avec ses variables MTN Sandbox préexistantes a rapporté `PASS` / `MTN_SANDBOX_COLLECTION_OAUTH_PROVED`. Source et limitations de provenance : [rapport expurgé Railway du 22 septembre 2026](../evidence/RAILWAY_SANDBOX_AUTH_2026-09-22.md). Cette observation concerne **uniquement l'authentification Collections Sandbox**, pas le contrat `RequestToPay` ni une preuve d'encaissement. Le registre conserve `highest_proof=UNQUALIFIED` au niveau du fournisseur global : un PASS d'authentification local ne qualifie pas toutes ses opérations.

Un PASS ultérieur ne prouve **pas** la capacité RequestToPay, les montants et devises, le statut de transaction, les callbacks, une opération d'encaissement, ni les droits de production au Congo. Ces opérations nécessitent leurs propres contrats et preuves. Les scripts historiques `scripts/mtn-momo-sandbox-probe.js` initient une transaction de test et sont **exclus** de cette campagne read-only.

## Exécution manuelle

Dans l'environnement GitHub `provider-contract-sandbox`, configurer les secrets **dédiés** `KOMERCE_MTN_PROOF_COLLECTION_SUBSCRIPTION_KEY`, `KOMERCE_MTN_PROOF_API_USER` et `KOMERCE_MTN_PROOF_API_KEY`. La campagne GitHub exige ces secrets distincts. **Voie alternative observée le 22 septembre :** la sonde ponctuelle, exécutée *dans* l'instance Railway existante, peut réutiliser les variables Sandbox déjà présentes sans les copier vers GitHub ni modifier leur valeur. Les deux chemins ne sont pas interchangeables et leurs preuves doivent garder leur propre provenance.

Sur `main`, lancer manuellement `External provider contract batch (read-only)` avec `mode=sandbox-read`, `providers=mtn-momo-cg`, `include_proven=false`. La sonde effectue au plus un POST d'authentification, sans abonnement nouveau, sans approbation sur téléphone, sans commande et sans message.
