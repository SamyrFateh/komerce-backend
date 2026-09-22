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

## Prochaine preuve indépendante

Lire et formaliser le contrat de livraison et de vérification de notification PayPal : origine, signature, ID d'événement, anti-rejeu, ordre d'arrivée et relecture serveur du statut de l'objet métier. Ne pas créer ni capturer de paiement pour tenter de démontrer ce contrat tant que les prérequis élémentaires ne sont pas caractérisés.

Les valeurs des credentials restent dans leur service d'origine : ne pas copier de secret Railway dans cette fiche, un artifact GitHub ou un terminal partagé.
