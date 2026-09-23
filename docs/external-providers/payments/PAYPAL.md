# PayPal — contrat caractérisé : OAuth + lecture de configuration webhook (Sandbox)

## Périmètre de l'opération

La sonde d'authentification lit la configuration du compte **Sandbox** sans créer de commande, capturer de paiement, déclencher de remboursement ou simuler la livraison d'un webhook. Elle ne doit pas être confondue avec le script historique `scripts/paypal-sandbox-probe.js`, qui crée une commande de test.

| Phase | Contrat de la sonde |
|---|---|
| EXPECTS | Qualifier séparément l'authentification et la capacité de lecture du webhook configuré sur le compte Sandbox. |
| REQUIRES | Cible explicite `PAYPAL_ENV=sandbox`, client ID, client secret et webhook ID pour ce compte de test. |
| SENDS | POST `https://api-m.sandbox.paypal.com/v1/oauth2/token` (`grant_type=client_credentials`) puis GET `/v1/notifications/webhooks/{id}` avec jeton obtenu. |
| RECEIVES | Un jeton OAuth non vide et une réponse GET réussie pour la configuration du webhook exact. |
| CONFIRMS | Selon le collecteur GitHub `scripts/external-provider-batch-proof.js`, l'ID renvoyé par le GET doit correspondre exactement à l'ID configuré. Aucun contenu libre ou token ne figure dans le rapport de preuve. |
| EXPOSES | Fait borné « authentification et lecture de la configuration webhook Sandbox possibles lors de cette exécution ». Aucun état de paiement ni événement webhook effectivement livré. |

## Observation du 22 septembre 2026

La sonde lancée sur l'instance Railway existante avec ses **variables Sandbox préexistantes** a produit le code `PAYPAL_SANDBOX_OAUTH_AND_WEBHOOK_GET_PROVED` et `PASS`, selon le JSON expurgé rapporté par l'opérateur. Source complète et limitations de provenance : [preuve Railway Sandbox du 22 septembre 2026](../../_archive/external-provider-proofs/RAILWAY_SANDBOX_AUTH_2026-09-22.md).

Cette observation est un **résultat d'opération P0/P1 limité** à OAuth + lecture du webhook. Elle ne démontre ni réception réelle d'une notification, ni authenticité d'une notification entrante, ni paiement confirmé, ni comportement de l'adapter Komerce, ni droits du compte de production.

## Observation indépendante du 23 septembre 2026 : création et relecture d'une Order Sandbox

L'opérateur a exécuté `scripts/paypal-sandbox-order-contract-proof.js` dans l'instance Railway existante. La sortie JSON expurgée signale `PASS`, création HTTP **201**, relecture HTTP **200**, état fournisseur **CREATED** et `readback_confirmed=true` pour une Order PayPal Sandbox de **1,00 EUR**. La vérification de l'ID, de la référence, du montant et de la devise est effectuée dans le code de la sonde avant émission du PASS. Voir [la preuve opérateur archivée, avec ses limites de provenance](../../_archive/external-provider-proofs/PAYPAL_SANDBOX_ORDER_P1_2026-09-23.md).

**Périmètre : P1 de création et de relecture exacte d'une Order, sans capture.** La sortie indique `capture_attempted=false` ; elle ne prouve ni approbation, ni encaissement, ni livraison de webhook, ni idempotence expérimentale d'un rejeu. Le registre fournisseur global conserve `UNQUALIFIED`. Cette observation est indépendante de la preuve OAuth/webhook du 22 septembre et du rapport GitHub Actions antérieur à 0 PASS.

## Contrat du listener — distinction succès / panne temporaire

La documentation PayPal précise qu'une réponse HTTP 2xx acquitte la livraison et qu'une réponse non-2xx peut entraîner une nouvelle tentative. Le code de la route `POST /api/payments/paypal/webhook` doit donc respecter le contrat suivant :

- JSON malformé / événement incomplet : HTTP 400 ; signature explicitement non valide : HTTP 401 ; aucun effet métier.
- Vérification distante indisponible (OAuth, timeout ou API PayPal) et erreur inattendue du traitement métier : HTTP 503, corps expurgé `paypal_webhook_processing_unavailable` ; ne jamais répondre HTTP 200 en affirmant `received=true`.
- Traitement réussi ou événement déjà traité : HTTP 200 ; l'idempotence de l'événement et de la commande reste nécessaire en cas de nouvelle livraison.
- Une réponse 503 ne démontre pas à elle seule que l'état métier a été restauré. Les incidents de persistance/déduplication et les erreurs métier intentionnellement acquittées ont leur propre audit.

Source officielle : https://developer.paypal.com/api/rest/webhooks ; vérification https://developer.paypal.com/api/rest/webhooks/rest/ .

**Attention au simulateur PayPal :** les événements fictifs ne sont pas rattachés à l'application enregistrée et ne peuvent pas être vérifiés par l'API PayPal `verify-webhook-signature` ; un 401 sur cet événement simulé ne prouve pas que le listener rejette un événement Sandbox authentique. Source : https://developer.paypal.com/api/rest/webhooks/simulator/ .

## Prochaine preuve indépendante

Lire et formaliser le contrat de livraison et de vérification de notification PayPal : origine, signature, ID d'événement, anti-rejeu, ordre d'arrivée et relecture serveur du statut de l'objet métier. Ne pas créer ni capturer de paiement pour tenter de démontrer ce contrat tant que les prérequis élémentaires ne sont pas caractérisés.

Les valeurs des credentials restent dans leur service d'origine : ne pas copier de secret Railway dans cette fiche, un artifact GitHub ou un terminal partagé.
