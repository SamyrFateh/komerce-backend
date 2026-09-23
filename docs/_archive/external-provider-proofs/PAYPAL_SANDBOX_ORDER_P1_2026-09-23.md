# Preuve opérateur — PayPal Sandbox Order P1 : création et relecture exacte

**Date de transmission :** 23 septembre 2026, vers 07:34 (Europe/Paris) ; la sortie JSON de ce probe ne contient pas d'horodatage d'exécution.  
**Source :** sortie PowerShell rapportée par l'opérateur après une exécution ponctuelle via Railway SSH dans le conteneur existant `komerce-backend`. La commande exécutée est celle documentée dans `docs/external-providers/payments/TRANSACTION_P1_PROBES.md`, avec `KOMERCE_PAYPAL_P1_ALLOW_PRODUCTION_RUNTIME_SANDBOX=1` pour **ce processus seulement**.  
**Conservation :** transcription exacte du JSON fourni dans la conversation ; aucun ID d'Order, retour brut PayPal, journal serveur signé ou capture de paiement n'a été fourni. La réponse du fournisseur n'a pas été reconsultée de manière indépendante par la personne ayant archivé ce rapport.

## Sortie JSON transmise par l'opérateur

```json
{"schema_version":1,"provider":"paypal","environment":"SANDBOX","operation":"ORDER_CREATE_AND_EXACT_READBACK","status":"PASS","reason_code":"PAYPAL_SANDBOX_ORDER_CREATE_AND_EXACT_READBACK_PROVED","create_http_status":201,"read_http_status":200,"provider_status":"CREATED","readback_confirmed":true,"capture_attempted":false}
```

## Qualification exacte

- Le probe `scripts/paypal-sandbox-order-contract-proof.js` utilise l'API PayPal **Sandbox**, crée une seule Order de **1,00 EUR** avec un `PayPal-Request-Id`, puis interroge par GET l'Order créée. Le code vérifie le même ID fournisseur, la même référence d'unité d'achat, le même montant et la même devise dans la réponse GET.
- Dans le rapport opérateur, `create_http_status=201`, `read_http_status=200`, `provider_status=CREATED` et `readback_confirmed=true` attestent le **succès déclaré de l'opération P1 create + exact readback** au moment de cette exécution.
- `capture_attempted=false` : aucune approbation du payeur, capture, encaissement, notification PayPal livrée, remboursement ou écriture de commande Komerce n'est démontrée. Il ne faut pas assimiler `CREATED` à `COMPLETED` ou à un paiement confirmé.
- Un `PayPal-Request-Id` était envoyé par le probe, mais le rapport ne prouve **pas** le résultat d'un rejeu de la même requête : la résistance aux doublons n'a pas été éprouvée expérimentalement.
- Le niveau `highest_proof=UNQUALIFIED` reste inchangé dans le registre fournisseur global ; seule l'opération `ORDER_CREATE_AND_EXACT_READBACK` dispose ici d'un résultat P1 rapporté.

**Précédentes observations indépendantes :** [OAuth + lecture de configuration webhook PayPal/MTN depuis Railway](RAILWAY_SANDBOX_AUTH_2026-09-22.md). Le rapport GitHub Actions [35753825169](https://github.com/SamyrFateh/komerce-backend/actions/runs/35753825169) reste à **0 nouveau PASS** : ces preuves n'y ont jamais été exécutées.

## Suite à qualifier

1. Pour PayPal, caractériser le contrat d'approbation payeur Sandbox, de capture explicite, de lecture de la capture et de validation de webhook **séparément** avant de prétendre prouver une transaction encaissée.
2. Vérifier hors réseau le mapping de l'Order réellement créée dans l'adapter Komerce (P2) en conservant l'état `CREATED` comme « non payé » ; aucun Golden E2E ni transaction sur l'API live.
3. Ne pas relancer mécaniquement la création d'une nouvelle Order de test pour une simple tâche documentaire ou un manque de CI.
